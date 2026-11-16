import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { DeterministicCheck } from '../core/contracts.js';
import { atomicWrite } from '../brain/store.js';
import { killTree, trackChild } from '../platform/process-tree.js';

/** Check output kept per stream: enough for a failing test report, bounded for memory and prompts. */
export const CHECK_OUTPUT_HEAD_CHARS = 4 * 1024;
export const CHECK_OUTPUT_TAIL_CHARS = 12 * 1024;

/** Keeps the start and the end of a stream (where a failing test prints its summary) and counts the rest. */
class CappedText {
  private head = '';
  private tail = '';
  private omitted = 0;
  push(text: string): void {
    if (this.head.length < CHECK_OUTPUT_HEAD_CHARS) {
      const room = CHECK_OUTPUT_HEAD_CHARS - this.head.length;
      this.head += text.slice(0, room);
      text = text.slice(room);
    }
    if (!text) return;
    this.tail += text;
    if (this.tail.length > CHECK_OUTPUT_TAIL_CHARS) {
      this.omitted += this.tail.length - CHECK_OUTPUT_TAIL_CHARS;
      this.tail = this.tail.slice(-CHECK_OUTPUT_TAIL_CHARS);
    }
  }
  toString(): string {
    return this.omitted ? `${this.head}\n[… ${this.omitted} characters omitted …]\n${this.tail}` : this.head + this.tail;
  }
}

/** Finds `needle` across chunk boundaries without keeping the whole stream. */
function streamMatcher(needle: string | undefined) {
  let carry = '';
  let found = needle === undefined || needle === '';
  return {
    push(text: string) {
      if (found) return;
      const window = carry + text;
      found = window.includes(needle!);
      carry = window.slice(-(needle!.length - 1) || window.length);
    },
    get found() { return found; },
  };
}

export const ToolSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  description: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
}).strict();
export const CheckSchema = z.object({
  id: z.string().min(1),
  requirementIds: z.array(z.string()),
  command: z.string().min(1),
  expect: z.object({ exitCode: z.number().int().optional(), stdoutIncludes: z.string().optional() }).strict(),
  timeoutMs: z.number().int().positive(),
}).strict();
export const ToolRegistrySchema = z.array(ToolSchema);
export const CheckRegistrySchema = z.array(CheckSchema);
export type HarnessTool = z.infer<typeof ToolSchema>;
export type CheckResult = {
  checkId: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  output: string;
  stdout: string;
  stderr: string;
};

const registryPath = (root: string, file: 'tools.json' | 'checks.json') => join(root, '.edu', 'harness', file);

export async function loadTools(root: string): Promise<HarnessTool[]> {
  return readRegistry(registryPath(root, 'tools.json'), ToolRegistrySchema, []);
}

export async function saveTools(root: string, tools: HarnessTool[]): Promise<void> {
  await writeRegistry(registryPath(root, 'tools.json'), ToolRegistrySchema, tools);
}

export async function loadChecks(root: string): Promise<DeterministicCheck[]> {
  return readRegistry(registryPath(root, 'checks.json'), CheckRegistrySchema, []);
}

export async function saveChecks(root: string, checks: DeterministicCheck[]): Promise<void> {
  await writeRegistry(registryPath(root, 'checks.json'), CheckRegistrySchema, checks);
}

async function readRegistry<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeRegistry<T>(path: string, schema: z.ZodType<T>, value: T): Promise<void> {
  const validated = schema.parse(value);
  await atomicWrite(path, `${JSON.stringify(validated, null, 2)}\n`);
}

/**
 * Executes a trusted check through the platform shell: one a person registered in `.edu/harness/checks.json`,
 * or a planner-proposed one a person approved (the orchestrator never passes any other; see run.ts).
 * It keeps the full environment on purpose, unlike agent CLIs (platform/child-env.ts): a person wrote or
 * approved the exact command, it is not an agent, and project test suites often need their credentials.
 */
export async function runCheck(check: DeterministicCheck, cwd: string, signal?: AbortSignal): Promise<CheckResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ checkId: check.id, ok: false, exitCode: null, durationMs: 0, timedOut: false, output: 'aborted', stdout: '', stderr: '' });
      return;
    }
    const child = spawn(check.command, { cwd, ...checkSpawnOptions(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const untrack = trackChild(child);
    // Output is capped at the source: it is kept in memory, written to events and fed back into prompts.
    const output = new CappedText();
    const stdout = new CappedText();
    const stderr = new CappedText();
    const expected = streamMatcher(check.expect?.stdoutIncludes);
    let timedOut = false;
    // The shell is the child; killTree ends it with the command it runs (Windows: the whole tree via taskkill).
    const stop = () => {
      void killTree(child, 'SIGTERM');
      const forceKill = setTimeout(() => void killTree(child, 'SIGKILL'), 250);
      forceKill.unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, check.timeoutMs);
    timer.unref();
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout.push(chunk); output.push(chunk); expected.push(chunk); });
    child.stderr.on('data', (chunk: string) => { stderr.push(chunk); output.push(chunk); });
    child.once('error', (error) => {
      clearTimeout(timer);
      untrack();
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) {
        resolve({ checkId: check.id, ok: false, exitCode: null, durationMs: Date.now() - started, timedOut: false, output: `${output.toString()}${error.message}`, stdout: stdout.toString(), stderr: stderr.toString() });
      } else reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      untrack();
      signal?.removeEventListener('abort', stop);
      const exitCode = code;
      const expectedExit = check.expect?.exitCode ?? 0;
      const ok = !timedOut && !signal?.aborted && exitCode === expectedExit && expected.found;
      resolve({ checkId: check.id, ok, exitCode, durationMs: Date.now() - started, timedOut, output: output.toString(), stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

export function checkSpawnOptions(platform: NodeJS.Platform = process.platform) {
  return { shell: true, detached: platform !== 'win32' } as const;
}
