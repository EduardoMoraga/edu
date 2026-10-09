import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { DeterministicCheck } from '../core/contracts.js';
import { atomicWrite } from '../brain/store.js';

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

/** Executes a trusted, project-configured check through the platform shell. */
export async function runCheck(check: DeterministicCheck, cwd: string, signal?: AbortSignal): Promise<CheckResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ checkId: check.id, ok: false, exitCode: null, durationMs: 0, timedOut: false, output: 'aborted', stdout: '', stderr: '' });
      return;
    }
    const child = spawn(check.command, { cwd, ...checkSpawnOptions(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid, 'SIGTERM');
      const forceKill = setTimeout(() => killProcessGroup(child.pid, 'SIGKILL'), 250);
      forceKill.unref();
    }, check.timeoutMs);
    timer.unref();
    const onAbort = () => {
      killProcessGroup(child.pid, 'SIGTERM');
      const forceKill = setTimeout(() => killProcessGroup(child.pid, 'SIGKILL'), 250);
      forceKill.unref();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); output += chunk.toString(); });
    child.once('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        resolve({ checkId: check.id, ok: false, exitCode: null, durationMs: Date.now() - started, timedOut: false, output: `${output}${error.message}`, stdout, stderr });
      } else reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const exitCode = code;
      const expectedExit = check.expect?.exitCode ?? 0;
      const ok = !timedOut && !signal?.aborted && exitCode === expectedExit &&
        (check.expect?.stdoutIncludes === undefined || stdout.includes(check.expect.stdoutIncludes));
      resolve({ checkId: check.id, ok, exitCode, durationMs: Date.now() - started, timedOut, output, stdout, stderr });
    });
  });
}

export function checkSpawnOptions(platform: NodeJS.Platform = process.platform) {
  return { shell: true, detached: platform !== 'win32' } as const;
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    if (signal === 'SIGKILL') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      killer.unref();
    } else {
      try { process.kill(pid, signal); } catch { /* The process may have already exited. */ }
    }
    return;
  }
  try { process.kill(-pid, signal); }
  catch { /* The process may have already exited or the platform may not support groups. */ }
}
