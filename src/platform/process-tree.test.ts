import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createChildRegistry, describeProcess, imageFromTasklist, killTree, killTreeSync, type ProcessHooks, type TreeRoot } from './process-tree.js';

const posix = process.platform !== 'win32';

async function gone(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

/** A detached parent that starts a SIGTERM-resistant grandchild in its group and prints both pids. */
function resistantTree(): Promise<{ child: ChildProcess; pids: number[] }> {
  const script = `const c=require('node:child_process').spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});process.on('SIGTERM',()=>{});console.log(JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout!.once('data', (chunk: Buffer) => resolve({ child, pids: JSON.parse(chunk.toString()) as number[] }));
  });
}

function fakeWindowsChild(overrides: Partial<TreeRoot> = {}) {
  return { pid: 4242, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), ...overrides } as TreeRoot & { stdout: PassThrough; stderr: PassThrough };
}

describe('killTree', () => {
  it.runIf(posix)('kills the whole process group, including a descendant that ignores SIGTERM', async () => {
    const { child, pids } = await resistantTree();
    await killTree(child, 'SIGKILL');
    for (const pid of pids) expect(await gone(pid)).toBe(true);
  });

  it.runIf(posix)('reaches a descendant whose parent already exited', async () => {
    const { child, pids } = await resistantTree();
    process.kill(pids[0]!, 'SIGKILL');
    await new Promise(resolve => child.once('exit', resolve));
    await killTree(child, 'SIGKILL');
    expect(await gone(pids[1]!)).toBe(true);
  });

  it('runs taskkill on the whole tree on Windows, then destroys pipes a descendant keeps open', async () => {
    const calls: string[][] = [];
    const child = fakeWindowsChild();
    await killTree(child, 'SIGTERM', {
      platform: 'win32', drainMs: 5,
      taskkill: args => { calls.push(args); const killer = new EventEmitter(); queueMicrotask(() => killer.emit('exit', 0)); return killer as unknown as ChildProcess; },
    });
    expect(calls).toEqual([['/pid', '4242', '/t', '/f']]);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
  });

  it('does not taskkill a Windows child that already exited, because its pid may be reused', async () => {
    const taskkill = vi.fn();
    const child = fakeWindowsChild({ exitCode: 0 });
    await killTree(child, 'SIGKILL', { platform: 'win32', drainMs: 1, taskkill });
    expect(taskkill).not.toHaveBeenCalled();
    expect(child.stdout.destroyed).toBe(true);
  });

  it('stops waiting for a taskkill that never reports back', async () => {
    const child = fakeWindowsChild({ stdout: null, stderr: null });
    await killTree(child, 'SIGTERM', { platform: 'win32', taskkillTimeoutMs: 5, taskkill: () => new EventEmitter() as unknown as ChildProcess });
  });

  it('kills synchronously on Windows only while the root still runs', () => {
    const taskkill = vi.fn();
    killTreeSync(fakeWindowsChild(), 'SIGKILL', 'win32', taskkill);
    killTreeSync(fakeWindowsChild({ exitCode: 1 }), 'SIGKILL', 'win32', taskkill);
    expect(taskkill).toHaveBeenCalledTimes(1);
    expect(taskkill).toHaveBeenCalledWith(['/pid', '4242', '/t', '/f']);
  });
});

describe('describeProcess', () => {
  it('reads the image name for exactly the asked pid from tasklist CSV', () => {
    const output = '"node.exe","4242","Console","1","52,120 K"\r\n"node.exe","42421","Console","1","1,000 K"\r\n';
    expect(imageFromTasklist(output, 4242)).toBe('node.exe');
    expect(imageFromTasklist(output, 424)).toBeUndefined();
    expect(imageFromTasklist('INFO: No tasks are running which match the specified criteria.\r\n', 4242)).toBeUndefined();
  });

  it.runIf(posix)('returns the command line of a running process', async () => {
    expect(await describeProcess(process.pid)).toContain(process.argv0.split('/').pop() ?? 'node');
  });
});

class FakeProcess extends EventEmitter implements ProcessHooks {
  exit = vi.fn();
  override prependListener(event: string, listener: (...args: unknown[]) => void) { return super.prependListener(event, listener); }
}

function fakeChild(pid = 77): ChildProcess {
  return Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null }) as unknown as ChildProcess;
}

describe('child registry', () => {
  it('ends tracked trees on SIGTERM (terminate, grace, kill) and exits with 128+signal', () => {
    const proc = new FakeProcess();
    const steps: string[] = [];
    const registry = createChildRegistry({ proc, graceMs: 10, kill: (_child, signal) => steps.push(signal), pause: ms => steps.push(`pause ${ms}`) });
    registry.track(fakeChild());
    proc.emit('SIGTERM', 'SIGTERM');
    expect(steps).toEqual(['SIGTERM', 'pause 10', 'SIGKILL']);
    expect(proc.exit).toHaveBeenCalledWith(143);
  });

  it('kills the trees, then leaves shutdown to another listener of the signal, even a one-shot one', () => {
    const proc = new FakeProcess();
    const kill = vi.fn();
    const onSigint = vi.fn();
    proc.once('SIGINT', onSigint);
    const registry = createChildRegistry({ proc, kill, pause: () => undefined });
    const child = fakeChild();
    registry.track(child);
    proc.emit('SIGINT', 'SIGINT');
    expect(onSigint).toHaveBeenCalled();
    expect(kill.mock.calls).toEqual([[child, 'SIGTERM'], [child, 'SIGKILL']]);
    expect(proc.exit).not.toHaveBeenCalled();
    expect(proc.listenerCount('SIGINT')).toBe(0);
    expect(proc.listenerCount('exit')).toBe(1);
  });

  it('steps aside for a library that re-raises the signal only when it is the last listener', () => {
    const proc = new FakeProcess();
    const reraised = vi.fn();
    // signal-exit (used by Ink) exits only when it is alone on the signal.
    const signalExit = () => { if (proc.listenerCount('SIGTERM') === 1) reraised(); };
    proc.on('SIGTERM', signalExit);
    const kill = vi.fn();
    const registry = createChildRegistry({ proc, kill, pause: () => undefined });
    registry.track(fakeChild());
    proc.emit('SIGTERM', 'SIGTERM');
    expect(reraised).toHaveBeenCalled();
    // The escalation already happened: the re-raise cannot cut it short.
    expect(kill.mock.calls.map(call => call[1])).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('force-kills what is still tracked when the process exits', () => {
    const proc = new FakeProcess();
    const kill = vi.fn();
    const registry = createChildRegistry({ proc, kill });
    const child = fakeChild();
    registry.track(child);
    proc.emit('exit', 0);
    expect(kill).toHaveBeenCalledWith(child, 'SIGKILL');
  });

  it('keeps a child whose leader exited until its owner untracks it, then removes its listeners', () => {
    const proc = new FakeProcess();
    const registry = createChildRegistry({ proc, kill: vi.fn() });
    const first = fakeChild(1);
    const untrackFirst = registry.track(first);
    const untrackSecond = registry.track(fakeChild(2));
    expect(proc.listenerCount('SIGHUP')).toBe(1);
    // The leader exited, but a descendant in its process group may not have.
    first.emit('exit', 0);
    expect(registry.size).toBe(2);
    untrackFirst();
    untrackSecond();
    expect(registry.size).toBe(0);
    for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit']) expect(proc.listenerCount(event)).toBe(0);
  });

  it('ignores children that never started', () => {
    const proc = new FakeProcess();
    const registry = createChildRegistry({ proc, kill: vi.fn() });
    registry.track(Object.assign(new EventEmitter(), { pid: undefined }) as unknown as ChildProcess);
    expect(registry.size).toBe(0);
    expect(proc.listenerCount('SIGTERM')).toBe(0);
  });

  it.runIf(posix)('still SIGKILLs a descendant that ignored SIGTERM after its parent exited', async () => {
    const proc = new FakeProcess();
    const registry = createChildRegistry({ proc, graceMs: 50 });
    // The parent exits on SIGTERM; its grandchild in the same group ignores it. The pids are printed only
    // once the grandchild has installed its handler, so the SIGTERM cannot beat Node's startup.
    const script = `const c=require('node:child_process').spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']});c.stdout.once('data',()=>console.log(JSON.stringify([process.pid,c.pid])));setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const pids = await new Promise<number[]>(resolve => child.stdout!.once('data', (chunk: Buffer) => resolve(JSON.parse(chunk.toString()) as number[])));
    registry.track(child);
    proc.emit('SIGTERM', 'SIGTERM');
    expect(await gone(pids[0]!)).toBe(true);
    expect(await gone(pids[1]!)).toBe(true);
  });

  it.runIf(posix)('kills a real tracked tree when the owning process is terminated', async () => {
    const proc = new FakeProcess();
    const registry = createChildRegistry({ proc, graceMs: 0 });
    const { child, pids } = await resistantTree();
    registry.track(child);
    proc.emit('SIGTERM', 'SIGTERM');
    for (const pid of pids) expect(await gone(pid)).toBe(true);
    expect(proc.exit).toHaveBeenCalledWith(143);
  });
});
