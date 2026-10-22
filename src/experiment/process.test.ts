import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { sha256 } from './contract.js';
const state = vi.hoisted(() => ({ children: [] as any[] }));
vi.mock('node:child_process', () => ({ spawn: () => {
  const child = Object.assign(new EventEmitter(), { pid: undefined, stdout: new PassThrough(), stderr: new PassThrough(), unref: vi.fn() });
  state.children.push(child); return child;
} }));
import { inspectExperiment, runExperiment } from './run.js';
it('settles a process whose close event never arrives, destroys owned streams and preserves timeout evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edu-experiment-never-close-'));
  try {
    const sourceRoot = join(root, 'source'); await mkdir(sourceRoot); await writeFile(join(sourceRoot, 'input'), 'input');
    const spec = { version: 1, sourceRoot, sourceSha256: '0'.repeat(64), baseline: { executable: process.execPath, args: [] }, candidate: { executable: process.execPath, args: [] }, isolation: 'workspace-copy', artifacts: ['result'], limits: { timeoutMs: 20, outputBytes: 100, workspaceBytes: 4096, files: 10 } };
    spec.sourceSha256 = (await inspectExperiment(JSON.stringify(spec))).sourceSha256;
    const manifest = JSON.stringify(spec), started = Date.now();
    const result = await runExperiment(manifest, { approve: sha256(manifest), evidenceRoot: join(root, 'evidence') });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.arms.baseline.status).toBe('timeout'); expect(result.arms.candidate.status).toBe('timeout');
    expect(state.children).toHaveLength(2);
    for (const child of state.children) { expect(child.stdout.destroyed).toBe(true); expect(child.stderr.destroyed).toBe(true); expect(child.unref).toHaveBeenCalled(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 2500);
