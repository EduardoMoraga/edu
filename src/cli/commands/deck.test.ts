import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureContext, out, runCli } from '../testkit.js';
import { deckSnapshot } from './deck.js';

async function fixture(root: string, path: string, content: string, at: number): Promise<void> {
  const target = join(root, '.edu', path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
  await utimes(target, at / 1000, at / 1000);
}

describe('edu deck', () => {
  it('returns a versioned empty snapshot without a brain', async () => {
    const c = await captureContext();
    const snapshot = await deckSnapshot(c.dirs.cwd);
    expect(snapshot).toMatchObject({
      version: 1,
      project: { name: 'project', root: c.dirs.cwd },
      identity: 'Edu',
      brain: { present: false, canonical: 0, proposed: 0, episodic: 0, transitive: 0, lessons: 0 },
      spec: null, jobs: [], approvals: 0, recent: [],
    });
    await runCli(c, ['deck', '--json']);
    expect(JSON.parse(out(c))).toMatchObject({ version: 1, brain: { present: false }, jobs: [] });
    expect(c.stderr).toEqual([]);
  });

  it('reads note tiers, latest spec, jobs and human output', async () => {
    const c = await captureContext();
    const root = c.dirs.cwd;
    await fixture(root, 'EDU.md', '# Ada — the contract\n', 1000);
    await fixture(root, 'brain/1-canonical/identity/accepted.md', '---\nstatus: accepted\ntitle: Metadata title\n---\n# Heading title\n', 2000);
    await fixture(root, 'brain/1-canonical/domain/proposed.md', '---\nstatus: proposed\ntitle: Proposed idea\n---\nText\n', 3000);
    await fixture(root, 'brain/2-episodic/session.md', '# Session summary\n', 4000);
    await fixture(root, 'brain/3-transitive/L-first.md', '---\nkind: lesson\nstatus: candidate\ntitle: First lesson\n---\nBody\n', 5000);
    await fixture(root, 'brain/3-transitive/L-second.md', '---\nkind: lesson\nstatus: proven\ntitle: Second lesson\n---\nBody\n', 6000);
    await fixture(root, 'brain/3-transitive/H-idea.md', '---\nkind: hypothesis\nstatus: open\ntitle: Open idea\n---\nBody\n', 7000);
    await fixture(root, 'specs/old.md', '- **R-1** old\n', 1000);
    await fixture(root, 'specs/new.md', '- **R-1** one\n- **R-2** two\n### C-test\n', 8000);
    await fixture(root, 'crew/one.json', JSON.stringify({ id: 'abcdef123456', cli: 'codex', goal: '  Build\n deck  ', status: 'awaiting-approval', kind: 'orchestration', createdAt: '2026-01-01T00:00:00Z', usage: { inputTokens: 12, outputTokens: 3 } }), 9000);
    await fixture(root, 'crew/two.json', JSON.stringify({ id: '111111112222', cli: 'pi', task: 'Verify', status: 'done', mode: 'pane', createdAt: '2026-01-02T00:00:00Z', endedAt: '2026-01-02T00:01:00Z' }), 10000);

    const snapshot = await deckSnapshot(root);
    expect(snapshot.identity).toBe('Ada');
    expect(snapshot.brain).toEqual({ present: true, canonical: 1, proposed: 1, episodic: 1, transitive: 3, lessons: 2 });
    expect(snapshot.spec).toEqual({ name: 'new', requirements: 2, checks: 1 });
    expect(snapshot.jobs).toHaveLength(2);
    expect(snapshot.jobs[0]).toMatchObject({ id: '11111111', cli: 'pi', task: 'Verify', status: 'done', mode: 'pane', tokens: 0 });
    expect(snapshot.jobs[1]).toMatchObject({ id: 'abcdef12', task: 'Build deck', status: 'awaiting-approval', mode: 'run', tokens: 15, endedAt: null });
    expect(snapshot.approvals).toBe(1);
    expect(snapshot.recent).toHaveLength(5);
    expect(snapshot.recent[0]).toMatchObject({ title: 'Open idea', tier: 'transitive' });
    expect(snapshot.recent.at(-1)).toMatchObject({ title: 'Proposed idea', tier: 'canonical' });

    await runCli(c, ['deck']);
    expect(out(c)).toContain('EDU');
    expect(out(c)).toContain('Ada');
    expect(out(c)).toContain('new · 2 requirements · 1 check');
    expect(out(c)).toContain('1 approval');
    c.stdout.length = 0;
    await runCli(c, ['--cwd', root, 'deck', '--json']);
    expect(JSON.parse(out(c)).spec).toEqual(snapshot.spec);

    const nested = join(root, 'src', 'nested');
    await mkdir(nested, { recursive: true });
    expect((await deckSnapshot(nested)).project.root).toBe(root);
  });

  it('skips malformed job JSON and unreadable note metadata', async () => {
    const c = await captureContext();
    const root = c.dirs.cwd;
    await fixture(root, 'brain/3-transitive/L-odd.md', '---\ntitle: broken: yaml\n---\n# Still readable\n', 1000);
    await fixture(root, 'crew/good.json', JSON.stringify({ id: '123456789', status: 'running', task: 'Fine' }), 2000);
    await fixture(root, 'crew/bad.json', '{not json', 3000);
    const snapshot = await deckSnapshot(root);
    expect(snapshot.brain.transitive).toBe(1);
    expect(snapshot.recent[0]?.title).toBe('Still readable');
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0]).toMatchObject({ id: '12345678', status: 'running', task: 'Fine' });
  });
});
