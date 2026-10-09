import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditGitDiff } from './entropy.js';

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('git entropy audit', () => {
  it('detects residue, weakened tests, dependency churn, and stale docs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-evidence-entropy-'));
    roots.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'src/service.ts'), 'export const service = 1;\n');
    await writeFile(join(root, 'test/service.test.ts'), "it('works', () => { expect(true).toBe(true); });\n");
    await writeFile(join(root, 'package.json'), '{"dependencies":{"old":"1"}}\n');
    await writeFile(join(root, 'docs/service.md'), 'service details\n');
    await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-qm', 'base'], { cwd: root });
    await writeFile(join(root, 'src/service.ts'), "export const service = 2;\nconsole.log('debug');\n");
    await writeFile(join(root, 'test/service.test.ts'), "it.skip('works', () => { expect(true).toBe(true); });\n");
    await writeFile(join(root, 'package.json'), '{"dependencies":{"old":"2"}}\n');
    await writeFile(join(root, 'src/service.ts.orig'), 'backup');
    const audit = await auditGitDiff(root, 'HEAD', ['r1']);
    expect(audit.findings.map((f) => f.category)).toEqual(expect.arrayContaining(['residue', 'weakened-tests', 'dependency-churn', 'stale-docs']));
    expect(audit.severity).toBeGreaterThanOrEqual(2);
  });

  it('does not flag assertion replacements or line moves as weakened tests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-evidence-entropy-balanced-'));
    roots.push(root);
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'test/service.test.ts'), "it('works', () => {\n  expect(value).toBe(1);\n});\n");
    await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-qm', 'base'], { cwd: root });
    await writeFile(join(root, 'test/service.test.ts'), "it('works', () => {\n  expect(value).toBe(2);\n});\n");
    const audit = await auditGitDiff(root, 'HEAD');
    expect(audit.findings.filter((finding) => finding.category === 'weakened-tests')).toHaveLength(0);
  });

  it('detects removal of a configured deterministic check from the run-start registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-evidence-check-bypass-'));
    roots.push(root);
    await mkdir(join(root, '.edu', 'harness'), { recursive: true });
    await writeFile(join(root, '.edu', 'harness', 'checks.json'), JSON.stringify([{ id: 'unit', requirementIds: ['r1'], command: 'npm test', expect: { stdoutIncludes: 'passed' }, timeoutMs: 1000 }]));
    await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-qm', 'base'], { cwd: root });
    await rm(join(root, '.edu', 'harness', 'checks.json'));
    const audit = await auditGitDiff(root, 'HEAD', ['r1']);
    expect(audit.findings).toContainEqual(expect.objectContaining({ category: 'checks-bypassed', severity: 3, path: '.edu/harness/checks.json' }));
  });

  it('detects a cleared configured stdout expectation but ignores registries absent at run start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-evidence-check-relax-'));
    roots.push(root);
    await mkdir(join(root, '.edu', 'harness'), { recursive: true });
    const path = join(root, '.edu', 'harness', 'checks.json');
    await writeFile(path, JSON.stringify([{ id: 'unit', requirementIds: ['r1'], command: 'npm test', expect: { stdoutIncludes: 'passed' }, timeoutMs: 1000 }]));
    await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-qm', 'base'], { cwd: root });
    await writeFile(path, JSON.stringify([{ id: 'unit', requirementIds: ['r1'], command: 'npm test', expect: {}, timeoutMs: 1000 }]));
    const relaxed = await auditGitDiff(root, 'HEAD', ['r1']);
    expect(relaxed.findings).toContainEqual(expect.objectContaining({ category: 'checks-bypassed', severity: 3 }));

    const untrackedRoot = await mkdtemp(join(tmpdir(), 'edu-evidence-no-baseline-checks-'));
    roots.push(untrackedRoot);
    await exec('git', ['init', '-q'], { cwd: untrackedRoot });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: untrackedRoot });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: untrackedRoot });
    await writeFile(join(untrackedRoot, 'base.txt'), 'base\n');
    await exec('git', ['add', '.'], { cwd: untrackedRoot });
    await exec('git', ['commit', '-qm', 'base'], { cwd: untrackedRoot });
    await mkdir(join(untrackedRoot, '.edu', 'harness'), { recursive: true });
    await writeFile(join(untrackedRoot, '.edu', 'harness', 'checks.json'), JSON.stringify([{ id: 'new', requirementIds: ['r1'], command: 'npm test', expect: {}, timeoutMs: 1000 }]));
    const noBaseline = await auditGitDiff(untrackedRoot, 'HEAD', ['r1']);
    expect(noBaseline.findings.filter((finding) => finding.category === 'checks-bypassed')).toHaveLength(0);
  });

  it('ignores removal of a check bound only to unrelated requirements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-evidence-unrelated-check-'));
    roots.push(root);
    await mkdir(join(root, '.edu', 'harness'), { recursive: true });
    const path = join(root, '.edu', 'harness', 'checks.json');
    const applicable = { id: 'unit', requirementIds: ['r1'], command: 'npm test', expect: {}, timeoutMs: 1000 };
    const unrelated = { id: 'other', requirementIds: ['r2'], command: 'npm run other', expect: {}, timeoutMs: 1000 };
    await writeFile(path, JSON.stringify([applicable, unrelated]));
    await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-qm', 'base'], { cwd: root });
    await writeFile(path, JSON.stringify([applicable]));
    const audit = await auditGitDiff(root, 'HEAD', ['r1']);
    expect(audit.findings.filter((finding) => finding.category === 'checks-bypassed')).toHaveLength(0);
  });
});
