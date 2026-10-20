import { access, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { packageVersion } from './package.js';
import { captureContext, out, runCli, type Captured } from './testkit.js';

const contexts: Captured[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(c => rm(dirname(c.dirs.cwd), { recursive: true, force: true })));
});
async function capture() { const c = await captureContext(); contexts.push(c); return c; }

it('reports the installed version and limits without creating a brain or needing a model', async () => {
  const c = await capture();
  expect(await runCli(c, ['capabilities', '--json'])).toBeUndefined();
  const info = JSON.parse(out(c));
  expect(info.version).toBe(packageVersion());
  expect(info.features.length).toBeGreaterThan(0);
  expect(info.limitations.length).toBeGreaterThan(0);
  expect(info.restartRequired).toBe(true);
  await expect(access(join(c.dirs.cwd, '.edu'))).rejects.toThrow();
  await expect(access(c.dirs.eduHome)).rejects.toThrow();
  expect(c.exitCode).not.toBe(1);
});

it('exposes the same machine-readable contract through whats-new', async () => {
  const a = await capture(); const b = await capture();
  await runCli(a, ['capabilities', '--json']);
  await runCli(b, ['whats-new', '--json']);
  expect(JSON.parse(out(b))).toEqual(JSON.parse(out(a)));
});

it('runs a deterministic evaluation without claiming a measured model advantage', async () => {
  const c = await capture();
  expect(await runCli(c, ['eval', 'suite', '--json'])).toBeUndefined();
  const report = JSON.parse(out(c));
  expect(report.aggregate.status).toBe('inconclusive');
  expect(report.aggregate.comparisons.every((comparison: { successRateDelta: unknown }) => comparison.successRateDelta === null)).toBe(true);
  expect(report.trials.every((trial: { provenance: string }) => trial.provenance === 'deterministic-suite')).toBe(true);
  expect(c.exitCode).not.toBe(1);
});
