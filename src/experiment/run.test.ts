import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectExperiment, runExperiment } from './run.js';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edu-experiment-test-')); roots.push(root);
  const sourceRoot = join(root, 'source'); await mkdir(sourceRoot);
  await writeFile(join(sourceRoot, 'input.txt'), 'initial');
  await writeFile(join(sourceRoot, 'check.js'), 'immutable check');
  const spec = { version: 1, sourceRoot, sourceSha256: '0'.repeat(64),
    baseline: { executable: process.execPath, args: ['-e', "require('fs').writeFileSync('result.txt', require('fs').readFileSync('input.txt'))"] },
    candidate: { executable: process.execPath, args: ['-e', "require('fs').writeFileSync('result.txt', require('fs').readFileSync('input.txt'))"] },
    overlay: { 'input.txt': 'improved' }, protected: ['check.js'], artifacts: ['result.txt'],
    checks: [{ id: 'expected-result', path: 'result.txt', sha256: digest('improved') }],
    criterion: 'artifact-match-gain', isolation: 'workspace-copy', limits: { timeoutMs: 2000, outputBytes: 4096, workspaceBytes: 65536, files: 32 },
  };
  const inspection = await inspectExperiment(JSON.stringify(spec)); spec.sourceSha256 = inspection.sourceSha256;
  return { root, sourceRoot, spec, run: (value = spec, signal?: AbortSignal) => {
    const manifest = JSON.stringify(value);
    return runExperiment(manifest, { approve: digest(manifest), evidenceRoot: join(root, 'evidence'), signal });
  } };
}
it('runs approved real subprocesses from identical snapshots, keeps original intact, and records deterministic gain without activation', async () => {
  const f = await fixture(); const result = await f.run();
  expect(result.decision).toBe('candidate');
  expect(result.arms.baseline.initialSha256).toBe(result.arms.candidate.initialSha256);
  expect(result.arms.baseline.status).toBe('ok'); expect(result.arms.baseline.checks[0]?.ok).toBe(false);
  expect(result.arms.candidate.checks[0]?.ok).toBe(true);
  expect(await readFile(join(f.sourceRoot, 'input.txt'), 'utf8')).toBe('initial');
  expect(result.usage.costUsd).toBeNull(); expect(result.usage.inputTokens).toBeNull();
  expect(JSON.parse(await readFile(result.evidencePath, 'utf8')).decision).toBe('candidate');
});
it('retains baseline on ties and when no improvement criterion is declared', async () => {
  const f = await fixture(); f.spec.overlay = { 'input.txt': 'initial' };
  expect((await f.run()).decision).toBe('baseline');
  expect((await f.run({ ...f.spec, criterion: 'retain-baseline', overlay: { 'input.txt': 'improved' } })).decision).toBe('baseline');
});
it('rejects exact approval mismatch and changed frozen inputs before commands', async () => {
  const f = await fixture();
  await expect(runExperiment(JSON.stringify(f.spec), { approve: '0'.repeat(64) })).rejects.toThrow(/approval/i);
  await writeFile(join(f.sourceRoot, 'input.txt'), 'changed');
  await expect(f.run()).rejects.toThrow(/source.*digest/i);
});
it('refuses unsupported enforced isolation and protected overlays without spawning', async () => {
  const f = await fixture();
  await expect(f.run({ ...f.spec, isolation: 'os-sandbox' })).rejects.toThrow(/isolation/i);
  f.spec.overlay = { 'check.js': 'replacement' };
  await expect(f.run()).rejects.toThrow(/protected/i);
});
it('invalidates candidate check tampering and preserves usable baseline fallback', async () => {
  const f = await fixture(); f.spec.candidate.args = ['-e', "require('fs').writeFileSync('check.js','tampered'); require('fs').writeFileSync('result.txt','improved')"];
  const result = await f.run();
  expect(result.arms.candidate.status).toBe('invalid'); expect(result.decision).toBe('baseline');
  expect(result.fallbackUsable).toBe(true);
});
it.each([
  ['timeout', "setTimeout(()=>{},10000)", 'timeout'],
  ['output', "process.stdout.write('x'.repeat(100000))", 'output-limit'],
  ['exit', 'process.exit(7)', 'nonzero'],
  ['artifact', 'void 0', 'invalid'],
  ['workspace', "require('fs').writeFileSync('huge', 'x'.repeat(100000))", 'invalid'],
] as const)('keeps evidence for baseline %s failure and never promises valid fallback', async (_name, script, status) => {
  const f = await fixture(); f.spec.baseline.args = ['-e', script]; f.spec.limits.timeoutMs = 120;
  const result = await f.run();
  expect(result.arms.baseline.status).toBe(status); expect(result.decision).toBe('inconclusive');
  expect(result.fallbackUsable).toBe(false);
  expect(JSON.parse(await readFile(result.evidencePath, 'utf8')).arms.baseline.status).toBe(status);
});
it('cancels the running arm, persists it, and does not start candidate', async () => {
  const f = await fixture(); f.spec.baseline.args = ['-e', 'setTimeout(()=>{},10000)'];
  const controller = new AbortController(); const running = f.run(f.spec, controller.signal);
  setTimeout(() => controller.abort(), 80);
  const result = await running;
  expect(result.arms.baseline.status).toBe('cancelled'); expect(result.arms.candidate.status).toBe('not-run');
  expect(result.decision).toBe('inconclusive');
});
it('excludes sensitive directories and credentials, and rejects included symlinks and traversal', async () => {
  const f = await fixture();
  await mkdir(join(f.sourceRoot, '.edu')); await writeFile(join(f.sourceRoot, '.edu', 'private'), 'private');
  await writeFile(join(f.sourceRoot, '.env'), 'SECRET=value');
  expect((await inspectExperiment(JSON.stringify(f.spec))).sourceSha256).toBe(f.spec.sourceSha256);
  f.spec.overlay = { '../escape': 'bad' }; await expect(f.run()).rejects.toThrow(/path/i);
  if (process.platform !== 'win32') {
    await symlink(join(f.root, 'missing'), join(f.sourceRoot, 'link'));
    await expect(inspectExperiment(JSON.stringify({ ...f.spec, overlay: {} }))).rejects.toThrow(/symlink/i);
  }
});
it('accepts checkout dotfiles, Unicode and spaces while excluding host/private stores without entering them', async () => {
  const f = await fixture();
  for (const path of ['.github/workflows', '.claude-plugin', '.agents/plugins', 'src']) await mkdir(join(f.sourceRoot, path), { recursive: true });
  for (const path of ['.gitignore', '.github/workflows/check.yml', '.claude-plugin/plugin.json', '.agents/plugins/marketplace.json', 'src/café file.txt']) await writeFile(join(f.sourceRoot, path), 'safe shipped source');
  for (const path of ['.cloudroom', '.codex', '.claude', '.pi']) { await mkdir(join(f.sourceRoot, path)); await writeFile(join(f.sourceRoot, path, 'private'), 'must be excluded'); }
  const inspection = await inspectExperiment(JSON.stringify(f.spec));
  expect(Object.keys(inspection.inputs)).toEqual(expect.arrayContaining(['.gitignore', '.github/workflows/check.yml', '.claude-plugin/plugin.json', '.agents/plugins/marketplace.json', 'src/café file.txt']));
  expect(Object.keys(inspection.inputs).some(path => /(?:cloudroom|\.codex|\.claude\/|\.pi\/)/.test(path))).toBe(false);
  f.spec.sourceSha256 = inspection.sourceSha256;
  expect((await f.run()).arms.baseline.status).toBe('ok');
});
it('preflights overlay size and case collisions before either command can run', async () => {
  const f = await fixture(); f.spec.overlay = { 'oversize': 'x'.repeat(100000) };
  await expect(f.run()).rejects.toThrow(/limit/i);
  f.spec.overlay = { 'INPUT.txt': 'collision' }; await expect(f.run()).rejects.toThrow(/collision/i);
});
it.each(['timeout', 'cancel'] as const)('settles %s when a Node parent exits with a descendant holding inherited pipes', async mode => {
  const f = await fixture();
  // The descendant expires itself even on platforms where cleanup is only best effort.
  const descendant = 'setTimeout(()=>{},3000)';
  f.spec.baseline.args = ['-e', `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'}).unref()`];
  f.spec.limits.timeoutMs = 200;
  const controller = new AbortController(); const started = Date.now();
  const running = f.run(f.spec, controller.signal);
  if (mode === 'cancel') setTimeout(() => controller.abort(), 100);
  const result = await running;
  expect(Date.now() - started).toBeLessThan(1800);
  expect(result.arms.baseline.status).toBe(mode === 'cancel' ? 'cancelled' : 'timeout');
  expect(result.arms.candidate.status).toBe(mode === 'cancel' ? 'not-run' : 'ok');
  expect(JSON.parse(await readFile(result.evidencePath, 'utf8')).decision).toBe('inconclusive');
});
it('preserves empty directories and hashes executable modes in both workspace copies', async () => {
  const { chmod } = await import('node:fs/promises'); const f = await fixture();
  await mkdir(join(f.sourceRoot, 'empty'));
  await mkdir(join(f.sourceRoot, 'scripts'));
  await writeFile(join(f.sourceRoot, 'scripts/helper'), '#!/bin/sh\nprintf improved > result.txt\n');
  await chmod(join(f.sourceRoot, 'scripts/helper'), 0o755);
  const inspection = await inspectExperiment(JSON.stringify(f.spec)); f.spec.sourceSha256 = inspection.sourceSha256;
  f.spec.overlay = {};
  f.spec.baseline.args = ['-e', "if(!require('fs').statSync('empty').isDirectory())process.exit(2);require('fs').writeFileSync('result.txt','improved')"];
  if (process.platform !== 'win32') f.spec.candidate = { executable: process.execPath, args: ['-e', "require('child_process').execFileSync('./scripts/helper')"] };
  const result = await f.run();
  expect(result.arms.baseline.status).toBe('ok'); expect(result.arms.candidate.status).toBe('ok');
  if (process.platform !== 'win32') {
    await chmod(join(f.sourceRoot, 'scripts/helper'), 0o644);
    expect((await inspectExperiment(JSON.stringify(f.spec))).sourceSha256).not.toBe(inspection.sourceSha256);
  }
});
it.each(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.mcp.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.agents/plugins/marketplace.json', '.edu/config.json', '.codex/config.toml'])('rejects declared candidate overlay of policy/config %s', async path => {
  const f = await fixture(); f.spec.overlay = { [path]: 'changed policy' }; await expect(f.run()).rejects.toThrow(/protected/i);
});
it.each(['AGENTS.md', '.agents/plugins/new.json', 'tests/newcheck.js', 'package.json'])('invalidates newly introduced protected inventory %s after candidate execution', async path => {
  const f = await fixture();
  f.spec.candidate.args = ['-e', `const fs=require('fs');fs.mkdirSync(require('path').dirname(${JSON.stringify(path)}),{recursive:true});fs.writeFileSync(${JSON.stringify(path)},'changed');fs.writeFileSync('result.txt','improved')`];
  const result = await f.run(); expect(result.arms.candidate.status).toBe('invalid'); expect(result.decision).toBe('baseline');
});
it('allows ordinary application configuration, logs and proposed skill resources as explicit candidate material', async () => {
  const f = await fixture(); Object.assign(f.spec.overlay, { 'app.config.json': '{}', 'run.log': 'fixture', 'skills/proposed/SKILL.md': 'Proposed skill', 'skills/proposed/resources/example.json': '{}' });
  expect((await f.run()).arms.candidate.status).toBe('ok');
});
it('does not mistake ordinary run logs and state for newly introduced brain permission configuration', async () => {
  const f = await fixture(); f.spec.candidate.args = ['-e', "const fs=require('fs');fs.mkdirSync('.edu/runs/fixture',{recursive:true});fs.writeFileSync('.edu/runs/fixture/state.json','{}');fs.writeFileSync('result.txt','improved')"];
  expect((await f.run()).arms.candidate.status).toBe('ok');
});
it('rejects evidence inside the original source, including an outside alias pointing into it', async () => {
  const f = await fixture(), manifest = JSON.stringify(f.spec);
  await expect(runExperiment(manifest, { approve: digest(manifest), evidenceRoot: join(f.sourceRoot, '.edu/evidence') })).rejects.toThrow(/outside original source/i);
  const evidenceAlias = join(f.root, 'alias'); await symlink(f.sourceRoot, evidenceAlias, 'junction');
  await expect(runExperiment(manifest, { approve: digest(manifest), evidenceRoot: evidenceAlias })).rejects.toThrow(/outside original source/i);
  await expect(readFile(join(f.sourceRoot, 'result.txt'))).rejects.toThrow();
});
