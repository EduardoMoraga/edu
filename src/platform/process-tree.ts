/**
 * Ending the process trees Edu starts, on every platform.
 *
 * POSIX: Edu starts CLIs and checks detached, so each child leads its own process group. A signal sent
 * to `-pid` reaches every descendant still in that group (a CLI's native binary, the shell commands it ran).
 *
 * Windows: there are no process groups and no POSIX signals. `taskkill /pid <pid> /t /f` ends the whole
 * tree; it needs the root still running, because an exited root's pid may already name another process.
 * A descendant that inherited the child's stdout/stderr can keep those pipes open after the kill, so they
 * are drained for a bounded time and then destroyed: a reader never waits for a `close` that never comes.
 *
 * The child registry kills tracked trees when Edu itself is told to stop (SIGINT, SIGTERM, SIGHUP) or
 * exits, so closing the terminal does not orphan agents that run in their own process group.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { constants } from 'node:os';
import type { Readable } from 'node:stream';

/** A started child, or just a pid (a detached worker recorded in a job file). */
export type TreeRoot = Pick<ChildProcess, 'pid'> & Partial<Pick<ChildProcess, 'kill' | 'exitCode' | 'signalCode'>> & {
  stdout?: Readable | null;
  stderr?: Readable | null;
};

export interface KillTreeOptions {
  platform?: NodeJS.Platform;
  /** Windows: starts `taskkill` (tests inject a fake). */
  taskkill?: (args: string[]) => Pick<ChildProcess, 'once'>;
  /** Windows: how long the child's pipes may stay open after the kill before they are destroyed. */
  drainMs?: number;
  /** Windows: the longest wait for taskkill itself. */
  taskkillTimeoutMs?: number;
}

const DEFAULT_DRAIN_MS = 200;
const DEFAULT_TASKKILL_TIMEOUT_MS = 5000;

/** True while `pid` names a running process (EPERM: it exists but belongs to someone else). */
export function processAlive(pid: number | undefined): boolean {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function exited(child: TreeRoot): boolean {
  return (child.exitCode ?? null) !== null || (child.signalCode ?? null) !== null;
}

function startTaskkill(args: string[]): Pick<ChildProcess, 'once'> {
  const killer = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
  killer.on('error', () => undefined);
  return killer;
}

function waitFor(emitter: Pick<ChildProcess, 'once'>, events: string[], ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    for (const event of events) emitter.once(event, () => { clearTimeout(timer); resolve(); });
  });
}

async function drain(child: TreeRoot, ms: number): Promise<void> {
  const open = [child.stdout, child.stderr].filter((stream): stream is Readable => Boolean(stream) && !stream!.destroyed && !stream!.readableEnded);
  if (!open.length) return;
  await Promise.race([
    Promise.all(open.map(stream => new Promise<void>(resolve => stream.once('close', () => resolve())))),
    new Promise<void>(resolve => setTimeout(resolve, ms)),
  ]);
  for (const stream of open) if (!stream.destroyed) stream.destroy();
}

/**
 * Ends `child` and every descendant. POSIX sends `signal` to the process group (falling back to the child
 * alone when it has no group). Windows always force-kills the tree, whatever the signal, then drains the pipes.
 */
export async function killTree(child: TreeRoot, signal: NodeJS.Signals = 'SIGTERM', options: KillTreeOptions = {}): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if ((options.platform ?? process.platform) !== 'win32') {
    try { process.kill(-pid, signal); }
    catch {
      try { child.kill?.(signal); } catch { /* already gone */ }
    }
    return;
  }
  if (!exited(child)) {
    const killer = (options.taskkill ?? startTaskkill)(['/pid', String(pid), '/t', '/f']);
    await waitFor(killer, ['exit', 'error'], options.taskkillTimeoutMs ?? DEFAULT_TASKKILL_TIMEOUT_MS);
  }
  await drain(child, options.drainMs ?? DEFAULT_DRAIN_MS);
}

/** Synchronous variant for `exit` handlers, where nothing asynchronous runs any more. */
export function killTreeSync(child: TreeRoot, signal: NodeJS.Signals = 'SIGKILL', platform: NodeJS.Platform = process.platform, taskkillSync: (args: string[]) => void = args => { spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true, timeout: DEFAULT_TASKKILL_TIMEOUT_MS }); }): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (platform === 'win32') {
    if (!exited(child)) taskkillSync(['/pid', String(pid), '/t', '/f']);
    return;
  }
  try { process.kill(-pid, signal); }
  catch {
    try { child.kill?.(signal); } catch { /* already gone */ }
  }
}

type StopSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';
const STOP_SIGNALS: readonly StopSignal[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** The parts of `process` the registry uses, injectable for tests. */
export interface ProcessHooks {
  prependListener(event: StopSignal | 'exit', listener: (...args: unknown[]) => void): unknown;
  removeListener(event: StopSignal | 'exit', listener: (...args: unknown[]) => void): unknown;
  listenerCount(event: StopSignal): number;
  exit(code: number): void;
}

export interface ChildRegistryOptions {
  proc?: ProcessHooks;
  /** Kills one tree synchronously (signal handlers and `exit` cannot wait). */
  kill?: (child: TreeRoot, signal: NodeJS.Signals) => void;
  /** Grace between SIGTERM and SIGKILL when Edu itself stops on a signal. */
  graceMs?: number;
}

export interface ChildRegistry {
  /** Tracks a child until it exits; returns an untrack function. */
  track(child: ChildProcess): () => void;
  readonly size: number;
}

/**
 * Remembers the process trees this Edu process owns. On SIGINT/SIGTERM/SIGHUP it ends them, then exits
 * with 128+signal, as Node would have. When another listener handles the signal (for example `edu run`
 * cancelling on Ctrl-C), that listener owns the shutdown and the registry stays out of the way. On `exit`,
 * whatever is still tracked is force-killed. Listeners are installed only while something is tracked.
 */
export function createChildRegistry(options: ChildRegistryOptions = {}): ChildRegistry {
  const proc = options.proc ?? (process as unknown as ProcessHooks);
  const kill = options.kill ?? ((child: TreeRoot, signal: NodeJS.Signals) => killTreeSync(child, signal));
  const graceMs = options.graceMs ?? 250;
  const children = new Set<ChildProcess>();
  let installed = false;
  let stopping = false;

  const killAll = (signal: NodeJS.Signals) => {
    for (const child of children) {
      try { kill(child, signal); } catch { /* best effort */ }
    }
  };
  const handlers = new Map<StopSignal, () => void>();
  for (const signal of STOP_SIGNALS) {
    handlers.set(signal, () => {
      // The registry's own listener is prepended, so it still sees one-shot listeners that run after it.
      if (stopping || proc.listenerCount(signal) > 1) return;
      stopping = true;
      killAll('SIGTERM');
      setTimeout(() => {
        killAll('SIGKILL');
        proc.exit(128 + (constants.signals[signal] ?? 1));
      }, graceMs);
    });
  }
  const onExit = () => killAll('SIGKILL');

  const install = () => {
    if (installed) return;
    installed = true;
    for (const [signal, handler] of handlers) proc.prependListener(signal, handler);
    proc.prependListener('exit', onExit);
  };
  const uninstall = () => {
    if (!installed || stopping) return;
    installed = false;
    for (const [signal, handler] of handlers) proc.removeListener(signal, handler);
    proc.removeListener('exit', onExit);
  };

  return {
    track(child) {
      if (child.pid === undefined || exited(child)) return () => undefined;
      children.add(child);
      install();
      const untrack = () => {
        if (!children.delete(child)) return;
        if (!children.size) uninstall();
      };
      child.once('exit', untrack);
      return untrack;
    },
    get size() { return children.size; },
  };
}

const defaultRegistry = createChildRegistry();

/** Registers a child this process owns, so Edu ends its tree when it is stopped or exits. */
export function trackChild(child: ChildProcess): () => void {
  return defaultRegistry.track(child);
}
