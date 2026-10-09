/**
 * Process seams for the CLI: output, stdin, TTY state, environment and CLI
 * detection. Commands only talk to the outside world through a CliContext,
 * so tests can drive `createProgram()` without touching the real terminal.
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { CliId, Engine } from '../core/contracts.js';
import type { Lang } from './i18n.js';

export interface CliContext {
  /** Working directory before `--cwd` is applied. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Home directory used for global installs (`HOME`, then os.homedir()). */
  home: string;
  out(text: string): void;
  err(text: string): void;
  /** Reads all of stdin; resolves '' when stdin is a TTY or nothing arrives within `timeoutMs`. */
  readStdin(timeoutMs?: number): Promise<string>;
  /** Whether stdout is an interactive terminal (enables the TUI). */
  isTTY: boolean;
  /** Whether stdin is an interactive terminal (enables prompts). */
  stdinIsTTY: boolean;
  /** Asks a yes/no question on the terminal. */
  confirm(question: string): Promise<boolean>;
  /** Installed coding CLIs, in preference order. */
  detectClis(): Promise<CliId[]>;
  /** Optional engine factory for embedding and deterministic CLI tests. */
  engineFactory?: (cli: CliId) => Engine;
  /** Optional detected CLI list for an injected engine factory. */
  availableClis?: CliId[];
  /** Sets the process exit code without exiting. */
  setExitCode(code: number): void;
}

/** Options every command can read through `optsWithGlobals()`. */
export interface GlobalOptions {
  cwd?: string;
  lang?: string;
  json?: boolean;
}

export interface Resolved {
  cwd: string;
  lang: Lang;
  json: boolean;
}

export function resolveGlobals(ctx: CliContext, opts: GlobalOptions): Resolved {
  // Explicit flag wins, then EDU_LANG, then the system locale (LC_ALL / LANG).
  const locale = ctx.env.LC_ALL || ctx.env.LANG || '';
  const raw = opts.lang ?? ctx.env.EDU_LANG ?? (locale.toLowerCase().startsWith('es') ? 'es' : 'en');
  const lang: Lang = raw === 'es' ? 'es' : 'en';
  return { cwd: resolve(ctx.cwd, opts.cwd ?? '.'), lang, json: Boolean(opts.json) };
}

export function globalHome(ctx: Pick<CliContext, 'env' | 'home'>): string {
  return resolve(ctx.env.EDU_HOME || resolve(ctx.home, '.edu'));
}

export function readStream(stream: NodeJS.ReadableStream & { isTTY?: boolean }, timeoutMs = 1000): Promise<string> {
  if (stream.isTTY) return Promise.resolve('');
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', finish);
      stream.removeListener('error', finish);
      stream.pause?.();
      done(Buffer.concat(chunks).toString('utf8'));
    };
    const onData = (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    stream.on('data', onData);
    stream.once('end', finish);
    stream.once('error', finish);
    stream.resume?.();
  });
}

export function processContext(): CliContext {
  return {
    cwd: process.cwd(),
    env: process.env,
    home: process.env.HOME || homedir(),
    out: (text) => void process.stdout.write(text.endsWith('\n') ? text : `${text}\n`),
    err: (text) => void process.stderr.write(text.endsWith('\n') ? text : `${text}\n`),
    readStdin: (timeoutMs) => readStream(process.stdin, timeoutMs),
    isTTY: Boolean(process.stdout.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    async confirm(question) {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question(`${question} [y/N] `);
        return /^y(es)?$/i.test(answer.trim());
      } finally {
        rl.close();
      }
    },
    async detectClis() {
      const { detectEngines } = await import('../engine/index.js');
      return detectEngines();
    },
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}
