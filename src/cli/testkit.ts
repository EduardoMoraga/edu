/**
 * Test support: a captured, deterministic CliContext and a one-call runner
 * over `createProgram()`. Used only by `*.test.ts` files.
 */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import type { CliId } from '../core/contracts.js';
import type { CliContext } from './context.js';
import { createProgram } from './program.js';

export interface Captured {
  ctx: CliContext;
  stdout: string[];
  stderr: string[];
  exitCode: number | undefined;
  /** Temp directories: project working dir, HOME and EDU_HOME. */
  dirs: { cwd: string; home: string; eduHome: string };
}

export interface CaptureOptions {
  stdin?: string;
  detected?: CliId[];
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}

export async function captureContext(opts: CaptureOptions = {}): Promise<Captured> {
  const base = await mkdtemp(join(tmpdir(), 'edu-cli-'));
  const dirs = { cwd: join(base, 'project'), home: join(base, 'home'), eduHome: join(base, 'home', '.edu-home') };
  await mkdir(dirs.cwd, { recursive: true });
  await mkdir(dirs.home, { recursive: true });
  const captured: Captured = { stdout: [], stderr: [], exitCode: undefined, dirs, ctx: undefined as never };
  captured.ctx = {
    cwd: dirs.cwd,
    env: { HOME: dirs.home, EDU_HOME: dirs.eduHome, NO_COLOR: '1', PATH: '', ...opts.env },
    home: dirs.home,
    out: (text) => void captured.stdout.push(text),
    err: (text) => void captured.stderr.push(text),
    readStdin: async () => opts.stdin ?? '',
    isTTY: opts.isTTY ?? false,
    stdinIsTTY: false,
    confirm: async () => false,
    detectClis: async () => opts.detected ?? [],
    setExitCode: (code) => {
      captured.exitCode = code;
    },
  };
  return captured;
}

/** Parses `argv` (without the node/script prefix); CommanderError exits are returned, not thrown. */
export async function runCli(captured: Captured, argv: string[]): Promise<CommanderError | undefined> {
  const program = createProgram(captured.ctx, { exitOverride: true });
  try {
    await program.parseAsync(argv, { from: 'user' });
    return undefined;
  } catch (error) {
    if (error instanceof CommanderError) return error;
    throw error;
  }
}

export const out = (c: Captured) => c.stdout.join('\n');
export const err = (c: Captured) => c.stderr.join('\n');
