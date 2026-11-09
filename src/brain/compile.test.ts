import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from './brain.js';
import { resetLedgerCache } from './ledger.js';
import { resetNoteCache } from './store.js';

const dirs: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-compile-')); dirs.push(path); return path; }
afterEach(async () => { resetNoteCache(); resetLedgerCache(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('compile on write (remember)', () => {
  it('links related live notes, keeps caller links, skips sessions and unrelated notes, and never edits other notes', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const retry = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Payment retries need idempotency keys', body: 'Retrying a payment without an idempotency key charged twice.' });
    const webhook = await brain.write({ tier: 'transitive', kind: 'hypothesis', title: 'Payment webhooks arrive twice', body: 'Duplicate payment webhooks cause double charges.' });
    const unrelated = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Prefer small pull requests', body: 'Small diffs get reviewed faster.' });
    const session = await brain.openSession('Payment retries idempotency debugging', 'claude');
    await brain.closeSession(session.meta.id, 'Payment retries without idempotency keys charged twice.');
    const before = await readFile(retry.path, 'utf8');

    const { note, report } = await brain.remember({
      tier: 'transitive', kind: 'lesson', title: 'Idempotency keys on payment retries',
      body: 'Every payment retry must reuse the idempotency key of the first attempt.', links: ['K-billing'],
    });
    expect(note.meta.links[0]).toBe('K-billing');
    expect(note.meta.links).toContain(retry.meta.id);
    expect(report.linked).toContain(retry.meta.id);
    expect(report.linked).not.toContain('K-billing');
    expect(note.meta.links).not.toContain(unrelated.meta.id);
    expect(note.meta.links).not.toContain(session.meta.id);
    expect(note.meta.links).not.toContain(note.meta.id);
    expect(report.linked.length).toBeLessThanOrEqual(5);
    expect(report.possibleConflicts).toEqual([]);
    expect(await readFile(retry.path, 'utf8')).toBe(before);
    expect(webhook.meta.id).toBeTruthy();
  });

  it('reports a possible contradiction between active decisions and suggests supersedes', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const old = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Store sessions in Redis', body: 'Session storage uses Redis with a one hour expiry.' });
    const { note, report } = await brain.remember({ tier: 'transitive', kind: 'decision', title: 'Store sessions in Postgres', body: 'Session storage uses Postgres with a one hour expiry.' });
    expect(report.possibleConflicts).toEqual([expect.objectContaining({ id: old.meta.id, title: old.meta.title, reason: expect.stringContaining('active decisions') })]);
    expect(report.suggestedSupersedes).toBe(old.meta.id);
    expect(note.meta.status).toBe('active');
    expect((await brain.read(old.meta.id))?.meta.status).toBe('active');
  });

  it('does not flag the decision it supersedes, nor notes of another kind', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const old = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Store sessions in Redis', body: 'Session storage uses Redis with a one hour expiry.' });
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Session storage expiry', body: 'Session storage with a one hour expiry logged users out.' });
    const { report } = await brain.remember({ tier: 'transitive', kind: 'decision', title: 'Store sessions in Postgres', body: 'Session storage uses Postgres with a one hour expiry.', supersedes: old.meta.id });
    expect(report.possibleConflicts).toEqual([]);
    expect(report.suggestedSupersedes).toBeUndefined();
    expect((await brain.read(old.meta.id))?.meta.status).toBe('reverted');
  });

  it('flags a canonical proposal that overlaps an accepted canonical note of the same kind', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const rule = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Tests run before merge', body: 'Every pull request runs the full test suite before merge.' });
    await brain.acceptCanonical(rule.meta.id);
    const { report } = await brain.remember({ tier: 'canonical', kind: 'standard', title: 'Tests run before every merge', body: 'Each pull request runs the unit test suite before merge.' });
    expect(report.possibleConflicts.map(conflict => conflict.id)).toEqual([rule.meta.id]);
  });

  it('does not compile episodic notes', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Pairing notes', body: 'Pairing helps.' });
    const { note, report } = await brain.remember({ tier: 'episodic', kind: 'session', title: 'Pairing notes', body: 'Pairing helps.' });
    expect(note.meta.links).toEqual([]);
    expect(report).toEqual({ linked: [], possibleConflicts: [], redacted: [] });
  });
});
