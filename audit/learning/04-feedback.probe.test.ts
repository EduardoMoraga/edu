import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openBrain } from '../../src/brain/brain.js';
import { learnedWeight } from '../../src/brain/learning.js';
import { buildContext } from '../../src/context/pack.js';

const T0 = new Date('2026-01-01T00:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);
async function fresh() {
  const root = await mkdtemp(join(tmpdir(), 'edu-04fb-'));
  return { root, brain: openBrain([{ scope: 'project', root }]), done: () => rm(root, { recursive: true, force: true }) };
}
const L = (title: string, body: string) => ({ title, body, tier: 'transitive' as const, kind: 'lesson' as const });
const meta = async (b: ReturnType<typeof openBrain>, id: string) => (await b.read(id))!.meta;

describe('04 feedback/credit probes', () => {
  it('P1 mere use (context injections) never adds wins, never promotes', async () => {
    const { brain, done } = await fresh();
    const n = await brain.write(L('Use pnpm', 'always use pnpm workspace'));
    for (let i = 0; i < 6; i++) await buildContext(brain, { budgetTokens: 4000, query: 'pnpm workspace' }, { eduMdPath: '/nonexistent', now: min(i * 2) });
    const m = await meta(brain, n.meta.id);
    console.log('P1', JSON.stringify(m.usage), m.status, 'w=', learnedWeight(m.usage, min(12)));
    expect(m.usage!.uses).toBeGreaterThanOrEqual(6); expect(m.usage!.wins).toBe(0);
    await brain.maintain(min(12)); expect((await meta(brain, n.meta.id)).status).toBe('candidate');
    await done();
  });

  it('P2 use refreshes lastUsed, so an always-injected, never-confirmed lesson dodges 180d retirement', async () => {
    const { brain, done } = await fresh();
    const n = await brain.write(L('Never confirmed', 'candidate injected forever'));
    await brain.recordUse([n.meta.id], day(100)); // injected on day 100 only
    const rep = await brain.maintain(day(200));   // 200d after creation, 100d after last injection
    console.log('P2 retired?', rep.retired, (await meta(brain, n.meta.id)).status);
    const m = await meta(brain, n.meta.id);
    expect(m.status).toBe('candidate');
    const rep2 = await brain.maintain(day(290)); // 190d after creation, 190d after last use -> retired
    console.log('P2b', rep2.retired);
    await done();
  });

  it('P3 negative feedback: weight floor, ranking, and context inclusion', async () => {
    const { brain, done } = await fresh();
    const bad = await brain.write(L('Bad advice', 'deploy with force flag'));
    const ok = await brain.write(L('Good advice', 'deploy with force flag'));
    await brain.feedback(bad.meta.id, false); await brain.feedback(bad.meta.id, false);
    const mb = await meta(brain, bad.meta.id);
    console.log('P3 bad weight 2 losses', learnedWeight(mb.usage, new Date()));
    const hits = await brain.recall('deploy force flag');
    console.log('P3 recall order', hits.map(h => `${h.note.meta.title}:${h.score.toFixed(3)}`));
    expect(hits[0]!.note.meta.id).toBe(ok.meta.id);
    const pack = await buildContext(brain, { budgetTokens: 4000, query: 'unrelated database migration' }, { eduMdPath: '/nonexistent', trackUsage: false });
    console.log('P3 candidates injected for UNRELATED query:', pack.text.includes('Bad advice'), pack.text.includes('Good advice'));
    await brain.feedback(bad.meta.id, false);
    const rep = await brain.maintain(new Date());
    console.log('P3 after 3 losses retired:', rep.retired.includes(bad.meta.id));
    await done();
  });

  it('P4 proven lesson with lots of old wins survives 3 fresh losses (no window)', async () => {
    const { brain, done } = await fresh();
    const n = await brain.write(L('Was right once', 'old tooling trick'));
    for (let i = 0; i < 10; i++) await brain.feedback(n.meta.id, true);
    await brain.maintain(new Date());
    for (let i = 0; i < 3; i++) await brain.feedback(n.meta.id, false);
    const rep = await brain.maintain(new Date());
    const m = await meta(brain, n.meta.id);
    console.log('P4', JSON.stringify(m.usage), m.status, 'retired:', rep.retired.length, 'w=', learnedWeight(m.usage));
    await done();
  });

  it('P5 self-attested feedback: same id helpful x3 -> proven -> canonical proposal; band untouched; no outcome link', async () => {
    const { brain, done } = await fresh();
    const n = await brain.write(L('Self praise', 'maybe wrong claim'));
    for (let i = 0; i < 3; i++) await brain.feedback(n.meta.id, true);
    const rep = await brain.maintain(new Date());
    const m = await meta(brain, n.meta.id);
    const canon = await brain.list({ tier: 'canonical' });
    console.log('P5', m.status, 'band=', m.band, 'promoted', rep.promoted, 'canonical proposals', canon.map(c => c.meta.status), 'meta keys', Object.keys(m));
    expect(m.status).toBe('proven');
    await done();
  });

  it('P6 feedback rejects unknown ids but does not validate that the note was ever used/injected', async () => {
    const { brain, done } = await fresh();
    await expect(brain.feedback('L-nope', true)).rejects.toThrow();
    const n = await brain.write(L('Never shown', 'never injected'));
    await brain.feedback(n.meta.id, true);
    console.log('P6 uses=', (await meta(brain, n.meta.id)).usage!.uses, 'wins=', (await meta(brain, n.meta.id)).usage!.wins);
    await done();
  });
});
