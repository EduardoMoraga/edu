import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { captureContext, runCli } from '../testkit.js';
import { sha256 } from '../../experiment/contract.js';
it('inspects exact bytes read-only and runs the registered CLI with explicit approval and retained evidence', async () => {
  const c = await captureContext(); const root = await mkdtemp(join(tmpdir(), 'edu-experiment-cli-'));
  try {
    const sourceRoot = join(root, 'source'), evidence = join(root, 'retained'); await mkdir(sourceRoot);
    await writeFile(join(sourceRoot, '.gitignore'), 'generated/\n');
    await writeFile(join(sourceRoot, 'input.txt'), 'baseline');
    const command = { executable: process.execPath, args: ['-e', "require('fs').writeFileSync('result', require('fs').readFileSync('input.txt'))"] };
    const spec = { version: 1, sourceRoot, sourceSha256: '0'.repeat(64), baseline: command, candidate: command, overlay: { 'input.txt': 'candidate' }, artifacts: ['result'], checks: [{ id: 'expected', path: 'result', sha256: sha256('candidate') }], criterion: 'artifact-match-gain', isolation: 'workspace-copy', limits: { timeoutMs: 2000, outputBytes: 4096, workspaceBytes: 65536, files: 32 } };
    const path = join(root, 'manifest.json'); await writeFile(path, JSON.stringify(spec));
    await runCli(c, ['experiment', 'inspect', path]);
    const first = JSON.parse(c.stdout.join('\n')); expect(first.approvalReady).toBe(false);
    expect((await readdir(root)).sort()).toEqual(['manifest.json', 'source']);
    await expect(readFile(evidence)).rejects.toThrow();
    spec.sourceSha256 = first.sourceSha256; const manifest = JSON.stringify(spec); await writeFile(path, manifest);
    c.stdout.length = 0;
    await runCli(c, ['experiment', 'inspect', path]);
    const approved = JSON.parse(c.stdout.join('\n')); expect(approved.manifestSha256).toBe(sha256(manifest)); expect(approved.approvalReady).toBe(true);
    c.stdout.length = 0;
    await runCli(c, ['experiment', 'run', path, '--approve', approved.manifestSha256, '--evidence', evidence]);
    expect(c.exitCode).toBeUndefined();
    const result = JSON.parse(c.stdout.join('\n')); expect(result.decision).toBe('candidate'); expect(result.state).toBe('complete');
    expect(JSON.parse(await readFile(result.evidencePath, 'utf8')).manifestSha256).toBe(approved.manifestSha256);
    expect(await readFile(join(sourceRoot, 'input.txt'), 'utf8')).toBe('baseline');
    c.stdout.length = 0;
    await runCli(c, ['experiment', 'run', path, '--approve', '0'.repeat(64), '--evidence', evidence]);
    expect(c.exitCode).toBe(1); expect(c.stderr.join('\n')).toMatch(/approval/i);
    expect(await readdir(evidence)).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); await rm(dirname(c.dirs.home), { recursive: true, force: true }); }
});
