import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);
export type EntropyCategory = 'residue' | 'weakened-tests' | 'dependency-churn' | 'stale-docs' | 'checks-bypassed';
export interface EntropyFinding {
  category: EntropyCategory;
  severity: 0 | 1 | 2 | 3;
  path: string;
  detail: string;
}
export interface EntropyAudit {
  startCommit: string;
  findings: EntropyFinding[];
  severity: 0 | 1 | 2 | 3;
}

/** Audits the working-tree diff from a run's start commit without changing git state. */
export async function auditGitDiff(cwd: string, startCommit: string, applicableRequirementIds: string[] = []): Promise<EntropyAudit> {
  const [{ stdout: diff }, { stdout: names }, { stdout: untracked }] = await Promise.all([
    exec('git', ['diff', '--no-ext-diff', '--unified=0', startCommit, '--'], { cwd, maxBuffer: 16 * 1024 * 1024 }),
    exec('git', ['diff', '--name-only', startCommit, '--'], { cwd }),
    exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd }),
  ]);
  const changed = new Set(names.split(/\r?\n/).filter(Boolean));
  const addedPaths = untracked.split(/\r?\n/).filter(Boolean);
  const findings: EntropyFinding[] = [];
  findings.push(...await checkRegistryFindings(cwd, startCommit, new Set(applicableRequirementIds)));
  for (const path of [...changed, ...addedPaths]) {
    if (/(?:^|\/)(?:debug|scratch|tmp)[^/]*\.(?:js|ts|sh|py)$|\.orig$/i.test(path)) {
      findings.push({ category: 'residue', severity: 2, path, detail: 'Debug, scratch, temporary, or backup file remains in the worktree.' });
    }
  }
  const added = diff.match(/^\+(?!\+).*/gm) ?? [];
  const removed = diff.match(/^-(?!-).*/gm) ?? [];
  if (added.some((line) => /\bconsole\.log\s*\(/.test(line))) {
    findings.push({ category: 'residue', severity: 1, path: 'diff', detail: 'Added console.log call detected.' });
  }
  if (added.some((line) => /\b(?:it|test|describe)\.(?:skip|only)\s*\(/.test(line))) {
    findings.push({ category: 'weakened-tests', severity: 3, path: 'diff', detail: 'A test suite or case was skipped or focused.' });
  }
  const assertionCount = (lines: string[]) => lines.filter((line) => /\bexpect\s*\(|\bassert(?:\.|\s)/.test(line)).length;
  const testCount = (lines: string[]) => lines.filter((line) => /\b(?:it|test)\s*\(/.test(line)).length;
  const weakenedAssertions = Math.max(0, assertionCount(removed) - assertionCount(added));
  const removedTests = Math.max(0, testCount(removed) - testCount(added));
  if (weakenedAssertions || removedTests) {
    findings.push({ category: 'weakened-tests', severity: 3, path: 'diff', detail: `${weakenedAssertions} net assertion line(s) and ${removedTests} net test declaration line(s) removed.` });
  }
  if (changed.has('package.json')) {
    findings.push({ category: 'dependency-churn', severity: 2, path: 'package.json', detail: 'package.json changed; confirm dependency changes are required for this run.' });
  }
  findings.push(...await staleDocFindings(cwd, changed));
  const severity = findings.reduce<number>((highest, finding) => Math.max(highest, finding.severity), 0);
  return { startCommit, findings, severity: severity as 0 | 1 | 2 | 3 };
}

interface CheckSnapshot {
  id: string;
  requirementIds: string[];
  expect: { exitCode?: number; stdoutIncludes?: string };
}

async function checkRegistryFindings(cwd: string, startCommit: string, applicableRequirementIds: Set<string>): Promise<EntropyFinding[]> {
  const path = '.edu/harness/checks.json';
  let baselineText: string;
  try {
    baselineText = (await exec('git', ['show', `${startCommit}:${path}`], { cwd })).stdout;
  } catch {
    // A registry absent at run start cannot establish that checks were bypassed.
    return [];
  }
  const baseline = parseCheckSnapshots(baselineText);
  if (!baseline) return [];
  const applicableBaseline = baseline.filter(check => check.requirementIds.some(id => applicableRequirementIds.has(id)));
  if (!applicableBaseline.length) return [];

  let currentText: string;
  try { currentText = await readFile(join(cwd, path), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return [];
    return applicableBaseline.map((check) => ({ category: 'checks-bypassed', severity: 3, path, detail: `Configured check '${check.id}' was removed after the run-start commit.` }));
  }
  const current = parseCheckSnapshots(currentText);
  if (!current) {
    return [{ category: 'checks-bypassed', severity: 3, path, detail: 'The configured check registry became invalid after the run-start commit.' }];
  }
  const currentById = new Map(current.map((check) => [check.id, check]));
  const findings: EntropyFinding[] = [];
  for (const prior of applicableBaseline) {
    const updated = currentById.get(prior.id);
    if (!updated) {
      findings.push({ category: 'checks-bypassed', severity: 3, path, detail: `Configured check '${prior.id}' was removed after the run-start commit.` });
      continue;
    }
    const lostRequirements = prior.requirementIds.filter((id) => !updated.requirementIds.includes(id));
    const lostOutputExpectation = Boolean(prior.expect.stdoutIncludes?.trim()) && !updated.expect.stdoutIncludes?.trim();
    const lostNonzeroExitExpectation = prior.expect.exitCode !== undefined && prior.expect.exitCode !== 0 && (updated.expect.exitCode === undefined || updated.expect.exitCode === 0);
    if (lostRequirements.length || lostOutputExpectation || lostNonzeroExitExpectation) {
      const reasons = [
        lostRequirements.length ? `removed requirement bindings ${lostRequirements.join(', ')}` : '',
        lostOutputExpectation ? 'removed stdout expectation' : '',
        lostNonzeroExitExpectation ? 'relaxed the expected exit code to success' : '',
      ].filter(Boolean);
      findings.push({ category: 'checks-bypassed', severity: 3, path, detail: `Configured check '${prior.id}' was relaxed: ${reasons.join('; ')}.` });
    }
  }
  return findings;
}

function parseCheckSnapshots(raw: string): CheckSnapshot[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const snapshots: CheckSnapshot[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !Array.isArray(item.requirementIds) || !item.requirementIds.every((id: unknown) => typeof id === 'string') || !item.expect || typeof item.expect !== 'object') return undefined;
      const { exitCode, stdoutIncludes } = item.expect as { exitCode?: unknown; stdoutIncludes?: unknown };
      if ((exitCode !== undefined && typeof exitCode !== 'number') || (stdoutIncludes !== undefined && typeof stdoutIncludes !== 'string')) return undefined;
      snapshots.push({ id: item.id, requirementIds: item.requirementIds, expect: { ...(exitCode !== undefined ? { exitCode } : {}), ...(stdoutIncludes !== undefined ? { stdoutIncludes } : {}) } });
    }
    return snapshots;
  } catch { return undefined; }
}

async function staleDocFindings(cwd: string, changed: Set<string>): Promise<EntropyFinding[]> {
  const sourceFiles = [...changed].filter((path) => /\.(?:ts|tsx|js|jsx|py|go|rs)$/.test(path));
  const changedDocs = new Set([...changed].filter((path) => /\.(?:md|mdx|rst)$/.test(path)));
  const docs = await exec('git', ['ls-files', '*.md', '*.mdx', '*.rst'], { cwd }).then((result) => result.stdout.split(/\r?\n/).filter(Boolean));
  const findings: EntropyFinding[] = [];
  for (const source of sourceFiles) {
    const moduleName = source.split('/').pop()?.replace(/\.[^.]+$/, '');
    if (!moduleName) continue;
    for (const doc of docs) {
      if (changedDocs.has(doc)) continue;
      try {
        if ((await readFile(join(cwd, doc), 'utf8')).includes(moduleName)) {
          findings.push({ category: 'stale-docs', severity: 1, path: doc, detail: `Documentation mentions changed module "${moduleName}" but was not updated.` });
          break;
        }
      } catch { /* An unreadable/deleted document is not reliable evidence of staleness. */ }
    }
  }
  return findings;
}
