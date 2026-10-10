import type { ChildProcess } from 'node:child_process';
import { spawnCli } from '../platform/index.js';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { EduEvent } from '../core/contracts.js';
import type { ParseContext } from './parse.js';

export const MAX_LINE_BYTES = 1024 * 1024;
const STDERR_TAIL_BYTES = 8 * 1024;

export interface CommandSpec { command: string; args: string[] }
export type LineParser = (line: string, ctx: ParseContext) => EduEvent[];

export async function binaryAvailable(binary: string): Promise<boolean> {
  const pathValue = process.env.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      try {
        await access(join(dir, `${binary}${extension}`), process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return true;
      } catch { /* try next PATH candidate */ }
    }
  }
  return false;
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* already exited */ }
  }
}

function errorEvent(agentId: string, message: string): EduEvent {
  return { type: 'error', agentId, message, at: new Date().toISOString() };
}

/** Spawn one headless CLI in its own process group and normalize its JSONL stdout. */
export async function* runJsonlProcess(
  spec: CommandSpec,
  cwd: string,
  agentId: string,
  parser: LineParser,
  signal?: AbortSignal,
  finalize?: (exitCode: number | null, ctx: ParseContext) => EduEvent[],
): AsyncIterable<EduEvent> {
  let child: ChildProcess;
  try {
    child = spawnCli(spec.command, spec.args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    yield errorEvent(agentId, `Unable to start ${spec.command}: ${String(error)}`);
    return;
  }

  let stderrTail = '';
  let spawnFailure: Error | undefined;
  let closed = false;
  let terminationRequested = false;
  let escalationTimer: NodeJS.Timeout | undefined;
  let escalationPromise: Promise<void> | undefined;
  let resolveEscalation!: () => void;
  let resolveClose!: (code: number | null) => void;
  const closePromise = new Promise<number | null>((resolve) => { resolveClose = resolve; });
  child.once('close', (code) => {
    closed = true;
    if (!terminationRequested && escalationTimer) clearTimeout(escalationTimer);
    resolveClose(code);
  });
  child.once('error', (error) => { spawnFailure = error; });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
  });
  const abort = (): void => {
    terminationRequested = true;
    killProcessGroup(child, 'SIGTERM');
    if (!escalationTimer) {
      escalationPromise = new Promise((resolve) => { resolveEscalation = resolve; });
      escalationTimer = setTimeout(() => {
        killProcessGroup(child, 'SIGKILL');
        resolveEscalation();
      }, 250);
    }
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });

  try {
  const decoder = new StringDecoder('utf8');
  const parseContext: ParseContext = { agentId };
  let pending = '';
  let pendingBytes = 0;
  let dropping = false;
  try {
    if (child.stdout) {
      for await (const chunk of child.stdout) {
        const decoded = decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        for (const char of decoded) {
          if (char === '\n') {
            if (!dropping) {
              const line = pending.endsWith('\r') ? pending.slice(0, -1) : pending;
              if (line.length) yield* parser(line, parseContext);
            }
            pending = '';
            pendingBytes = 0;
            dropping = false;
          } else if (!dropping) {
            pending += char;
            pendingBytes += Buffer.byteLength(char, 'utf8');
            if (pendingBytes > MAX_LINE_BYTES) {
              dropping = true;
              pending = '';
              yield errorEvent(agentId, `Dropped JSONL line exceeding ${MAX_LINE_BYTES} bytes`);
            }
          }
        }
      }
    }
    const final = decoder.end();
    if (!dropping && (pending || final)) {
      pending += final;
      pendingBytes += Buffer.byteLength(final, 'utf8');
      if (pendingBytes > MAX_LINE_BYTES) yield errorEvent(agentId, `Dropped JSONL line exceeding ${MAX_LINE_BYTES} bytes`);
      else if (pending.trim()) yield* parser(pending, parseContext);
    }
  } catch (error) {
    yield errorEvent(agentId, `Failed reading ${spec.command} output: ${String(error)}`);
  }

  const exitCode = await closePromise;
  if (spawnFailure) yield errorEvent(agentId, `Unable to start ${spec.command}: ${spawnFailure.message}`);
  else if (signal?.aborted) yield errorEvent(agentId, 'Process cancelled');
  else if (exitCode !== 0) {
    yield errorEvent(agentId, `${spec.command} exited with code ${String(exitCode)}${stderrTail ? `: ${stderrTail.trim()}` : ''}`);
  } else if (finalize) {
    yield* finalize(exitCode, parseContext);
  }
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!closed) {
      abort();
      await Promise.race([closePromise, new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
    if (terminationRequested && escalationPromise) await escalationPromise;
    else if (escalationTimer) clearTimeout(escalationTimer);
  }
}
