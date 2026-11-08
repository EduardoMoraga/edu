import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from './brain.js';
import { formatLogLine, noteSummary, parseLog, wikiTarget } from './catalog.js';
import { resetLedgerCache } from './ledger.js';
import { resetNoteCache } from './store.js';

const dirs: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-catalog-')); dirs.push(path); return path; }
afterEach(async () => { resetNoteCache(); resetLedgerCache(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('catalog', () => {
  it('lists one line per live note grouped by tier/kind, with gaps, next to INDEX.md', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const rule = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Tests before merge', body: '# Rule\n\nEvery pull request runs the full suite before it merges.' });
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Small PRs', body: `- Small diffs are reviewed faster, see [[${rule.meta.id}]] and [[Missing page|label]] and [[INDEX]] ![[diagram.png]]` });
    const old = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Use Redis', body: 'Redis for sessions.', links: ['D-ghost'] });
    await brain.write({ tier: 'transitive', kind: 'decision', title: 'Use Postgres', body: 'x'.repeat(300), supersedes: old.meta.id });
    await brain.rebuildIndex();
    const catalog = await readFile(join(root, 'brain', '0-index', 'catalog.md'), 'utf8');
    await expect(stat(join(root, 'brain', '0-index', 'INDEX.md'))).resolves.toBeTruthy();
    expect(catalog).toContain('## canonical/standard\n\n- [[tests-before-merge|K-tests-before-merge]] Tests before merge — Every pull request runs the full suite before it merges.');
    expect(catalog).toContain(`- [[L-small-prs]] Small PRs — Small diffs are reviewed faster, see ${rule.meta.id} and label and INDEX diagram.png`);
    expect(catalog.indexOf('## canonical/')).toBeLessThan(catalog.indexOf('## transitive/'));
    // reverted decisions leave the catalog; their dangling links do not count as gaps
    expect(catalog).not.toContain('[[D-use-redis]]');
    expect(catalog).not.toContain('D-ghost');
    const postgres = catalog.split('\n').find(line => line.startsWith('- [[D-use-postgres]]'))!;
    expect(postgres.length).toBeLessThanOrEqual('- [[D-use-postgres]] Use Postgres — '.length + 120);
    expect(postgres.endsWith('…')).toBe(true);
    expect(catalog).toContain('## Gaps\n\n- [[Missing page]] — referenced by [[L-small-prs]]');
    expect(catalog).not.toMatch(/\[\[INDEX\]\] —|diagram\.png\]\] —/);
  });

  it('is byte-stable and not rewritten when nothing changed', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Stable', body: 'same' });
    await brain.rebuildIndex();
    const path = join(root, 'brain', '0-index', 'catalog.md');
    const first = await readFile(path, 'utf8'); const mtime = (await stat(path)).mtimeMs;
    await new Promise(done => setTimeout(done, 20));
    await brain.rebuildIndex();
    expect(await readFile(path, 'utf8')).toBe(first);
    expect((await stat(path)).mtimeMs).toBe(mtime);
    expect(first).not.toMatch(/Generated|\d{4}-\d{2}-\d{2}T/);
  });

  it('is refreshed by every mutation that changes the live notes, and only rewritten when its content changes', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    await brain.rebuildIndex();
    const path = join(root, 'brain', '0-index', 'catalog.md');
    expect(await readFile(path, 'utf8')).toContain('0 live notes');
    const { note } = await brain.remember({ tier: 'transitive', kind: 'lesson', title: 'Pin node versions', body: 'Use .nvmrc in every repo.' });
    expect(await readFile(path, 'utf8')).toContain(`- [[${note.meta.id}]] Pin node versions — Use .nvmrc in every repo.`);
    await brain.update(note.meta.id, {}, 'Use volta pins instead.');
    expect(await readFile(path, 'utf8')).toContain('Pin node versions — Use volta pins instead.');
    const old = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Use Redis', body: 'r' });
    await brain.write({ tier: 'transitive', kind: 'decision', title: 'Use Valkey', body: 'v', supersedes: old.meta.id });
    let catalog = await readFile(path, 'utf8');
    expect(catalog).toContain('Use Valkey');
    expect(catalog).not.toContain('Use Redis');
    const proposal = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Review every PR', body: 'b' });
    expect(await readFile(path, 'utf8')).toContain('Review every PR');
    await brain.acceptCanonical(proposal.meta.id);
    const session = await brain.openSession('Debugging', 'claude');
    await brain.closeSession(session.meta.id, 'Found the leak.');
    catalog = await readFile(path, 'utf8');
    expect(catalog).toContain('Debugging — Found the leak.');
    // Exposure and feedback change nothing listed: the catalog is not rewritten.
    const mtime = (await stat(path)).mtimeMs;
    await new Promise(done => setTimeout(done, 20));
    await brain.recall('node versions');
    await brain.feedback(note.meta.id, true);
    expect((await stat(path)).mtimeMs).toBe(mtime);
    expect(await readFile(path, 'utf8')).toBe(catalog);
  });

  it('a failing catalog refresh never fails the write', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    await brain.rebuildIndex();
    const { mkdir, rm: remove } = await import('node:fs/promises');
    const path = join(root, 'brain', '0-index', 'catalog.md');
    await remove(path); await mkdir(path); // a directory where the file should be: the atomic rename fails
    const warnings: string[] = [];
    const original = process.emitWarning;
    process.emitWarning = ((warning: string | Error) => { warnings.push(String(warning)); }) as typeof process.emitWarning;
    try {
      const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Still written', body: 'x' });
      expect(await brain.read(note.meta.id)).toBeDefined();
    } finally { process.emitWarning = original; }
    expect(warnings.join('\n')).toMatch(/catalog/);
  });

  it('summarizes the first meaningful line', () => {
    expect(noteSummary('# Title\n\n---\n> - [ ] Ship [[a|the thing]]  now')).toBe('Ship the thing now');
    expect(noteSummary('```\ncode\n```\nreal')).toBe('real');
    expect(noteSummary('')).toBe('');
    expect(wikiTarget('folder/Note#Heading|x')).toBe('Note');
    expect(wikiTarget('file.pdf')).toBeUndefined();
  });
});

describe('log.md', () => {
  it('appends one grep-parseable line per operation', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const old = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Use Redis | fast', body: 'x' });
    await brain.write({ tier: 'transitive', kind: 'decision', title: 'Use Postgres', body: 'y', supersedes: old.meta.id });
    const hypothesis = await brain.write({ tier: 'transitive', kind: 'hypothesis', title: 'Caching helps', body: 'z' });
    await brain.update(hypothesis.meta.id, { status: 'confirmed' });
    await brain.update(hypothesis.meta.id, { tags: ['x'] });
    const proposal = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Lint first', body: 'a' });
    await brain.acceptCanonical(proposal.meta.id);
    const rejected = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Never test', body: 'b' });
    await brain.rejectCanonical(rejected.meta.id, 'wrong');
    const session = await brain.openSession('Pairing', 'claude');
    await brain.closeSession(session.meta.id, 'done');
    const commitment = await brain.write({ tier: 'transitive', kind: 'commitment', title: 'Ship it', body: 'c', due: '2020-01-01' });
    await brain.maintain();

    const text = await readFile(join(root, 'brain', '0-index', 'log.md'), 'utf8');
    expect(text.startsWith('# Brain log\n')).toBe(true);
    for (const line of text.split('\n').filter(line => line.startsWith('## '))) expect(line).toMatch(/^## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] \S+ \| \S+ \| .*$/);
    const ops = parseLog(text).map(entry => `${entry.op} ${entry.id}`);
    expect(ops).toEqual([
      `write ${old.meta.id}`,
      `supersede ${old.meta.id}`,
      'write D-use-postgres',
      `write ${hypothesis.meta.id}`,
      `status:confirmed ${hypothesis.meta.id}`,
      `write ${proposal.meta.id}`,
      `accept ${proposal.meta.id}`,
      `write ${rejected.meta.id}`,
      `reject ${rejected.meta.id}`,
      expect.stringMatching(/^close-session .*rejected-canonical-proposal/),
      `close-session ${session.meta.id}`,
      `write ${commitment.meta.id}`,
      `maintain:overdue ${commitment.meta.id}`,
    ]);
    expect(parseLog(text)[0]!.title).toBe('Use Redis / fast');
  });

  it('formats UTC minutes', () => {
    expect(formatLogLine({ op: 'write', id: 'L-a', title: 'A\nB', at: new Date('2026-11-08T09:05:59Z') })).toBe('## [2026-11-08 09:05] write | L-a | A B');
  });
});
