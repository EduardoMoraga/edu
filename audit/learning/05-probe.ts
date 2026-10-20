import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBrain } from '../../src/brain/index.js';
import { buildContext } from '../../src/context/pack.js';

const out: Record<string, unknown> = {};
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000);
async function mk(name: string) {
  const root = await mkdtemp(join(tmpdir(), `edu05-${name}-`));
  const loc = { root, scope: 'project' as const };
  const b = openBrain([loc]); await b.init(loc); return { root, b, loc };
}
const titles = (p: { sections: { title: string; text: string }[] }) => p.sections.map(s => `${s.title}: ${s.text.split('\n').slice(1).map(l => l.slice(0, 50)).join(' | ')}`);
const dirs: string[] = [];

// A. noise: 60 unrelated candidates + 2 relevant proven lessons
{ const { root, b } = await mk('noise'); dirs.push(root);
  for (let i = 0; i < 60; i++) await b.write({ tier: 'transitive', kind: 'lesson', title: `Noise lesson ${i} about topic${i}`, body: `irrelevant ${i}`, created: day(i).toISOString() });
  for (const t of ['Deploy via blue-green', 'Deploy needs migration first']) { const n = await b.write({ tier: 'transitive', kind: 'lesson', title: t, body: t, created: day(70).toISOString() }); await b.update(n.meta.id, { status: 'proven' }); }
  for (const budget of [150, 400, 1500]) { const p = await buildContext(b, { budgetTokens: budget, query: 'deploy' }, { now: day(80), trackUsage: false, eduMdPath: join(root, 'EDU.md') });
    out[`A_noise_budget${budget}`] = { tokens: p.tokens, lessonsInjected: p.sections.find(s => s.title === 'Proven lessons')?.noteIds.length ?? 0, deployInjected: (p.sections.find(s => s.title === 'Proven lessons')?.text.match(/Deploy/g) ?? []).length, deferred: p.deferred.length }; }
}
// B. contradiction + lesson supersedes
{ const { root, b } = await mk('contra'); dirs.push(root);
  const a = await b.write({ tier: 'transitive', kind: 'lesson', title: 'Always use tabs', body: 'use tabs', created: day(1).toISOString() });
  await b.update(a.meta.id, { status: 'proven' });
  const c = await b.write({ tier: 'transitive', kind: 'lesson', title: 'Never use tabs, use spaces', body: 'use spaces', supersedes: a.meta.id, created: day(2).toISOString() });
  await b.update(c.meta.id, { status: 'proven' });
  await b.maintain(day(3));
  const p = await buildContext(b, { budgetTokens: 800, query: 'tabs' }, { now: day(3), trackUsage: false, eduMdPath: join(root, 'EDU.md') });
  out.B_contradiction = { oldStatus: (await b.read(a.meta.id))!.meta.status, newSupersedes: c.meta.supersedes, injected: titles(p) };
}
// C. retire by losses vs by staleness (injection refreshes lastUsed)
{ const { root, b } = await mk('retire'); dirs.push(root);
  const bad = await b.write({ tier: 'transitive', kind: 'lesson', title: 'Bad lesson', body: 'bad advice', created: day(0).toISOString() });
  for (let i = 0; i < 3; i++) await b.feedback(bad.meta.id, false);
  const stale = await b.write({ tier: 'transitive', kind: 'lesson', title: 'Never helps stale lesson', body: 'noop', created: day(0).toISOString() });
  const rep0 = await b.maintain(new Date());
  const p0 = await buildContext(b, { budgetTokens: 800 }, { now: new Date(), trackUsage: false, eduMdPath: join(root, 'EDU.md') });
  out.C_losses = { retired: rep0.retired.length, badInContext: p0.text.includes('Bad lesson') };
  // stale lesson injected at session start every 90 days for 400 days, never any feedback
  let ctxHas = true; let status: unknown;
  for (let d = 90; d <= 400; d += 90) { await buildContext(b, { budgetTokens: 800 }, { now: day(d), trackUsage: true, eduMdPath: join(root, 'EDU.md') }); }
  await b.maintain(day(400)); const s = await b.read(stale.meta.id);
  out.C_staleInjected = { status: s!.meta.status, usage: s!.meta.usage };
  // control: never injected
  const ctl = await mk('retire2'); dirs.push(ctl.root);
  const u = await ctl.b.write({ tier: 'transitive', kind: 'lesson', title: 'Unused', body: 'x', created: day(0).toISOString() });
  await ctl.b.maintain(day(400)); out.C_neverInjected = (await ctl.b.read(u.meta.id))!.meta.status;
}
// D. promotion needs feedback, uses alone do not; proven -> canonical proposal not injected until accepted
{ const { root, b } = await mk('promo'); dirs.push(root);
  const l = await b.write({ tier: 'transitive', kind: 'lesson', title: 'Run lint before push', body: 'lint', created: day(0).toISOString() });
  for (let i = 0; i < 10; i++) await b.recordUse([l.meta.id], new Date(Date.now() + i * 120_000));
  let r = await b.maintain(); const afterUse = (await b.read(l.meta.id))!.meta.status;
  for (let i = 0; i < 3; i++) await b.feedback(l.meta.id, true);
  r = await b.maintain(); const props = await b.list({ tier: 'canonical' });
  out.D_promotion = { afterTenUsesStatus: afterUse, afterThreeWins: (await b.read(l.meta.id))!.meta.status, promoted: r.promoted.length, proposals: props.map(p => `${p.meta.status}:${p.meta.title}`) };
  const r2 = await b.maintain(); out.D_noReproposal = (await b.list({ tier: 'canonical' })).length;
  const p = await buildContext(b, { budgetTokens: 800 }, { now: new Date(), trackUsage: false, eduMdPath: join(root, 'EDU.md') });
  out.D_proposalInjected = p.text.includes('revision') || p.sections.some(s => s.title === 'Who and how');
}
// E. essentials displace lessons
{ const { root, b } = await mk('displace'); dirs.push(root);
  for (let i = 0; i < 40; i++) { const s = await b.write({ tier: 'canonical', kind: 'standard', title: `Standard ${i}`, body: `Standard rule number ${i} `.repeat(6) }); await b.acceptCanonical(s.meta.id); }
  const d = await b.write({ tier: 'transitive', kind: 'decision', title: 'Use Postgres', body: 'pg' });
  const l = await b.write({ tier: 'transitive', kind: 'lesson', title: 'Critical proven lesson', body: 'crit' }); await b.update(l.meta.id, { status: 'proven' });
  for (const budget of [300, 600, 1200, 2500]) { const p = await buildContext(b, { budgetTokens: budget }, { now: new Date(), trackUsage: false, eduMdPath: join(root, 'EDU.md') });
    out[`E_budget${budget}`] = { tokens: p.tokens, standards: p.sections.find(s => s.title === 'Who and how')?.noteIds.length ?? 0, decision: p.text.includes('Use Postgres'), lesson: p.text.includes('Critical proven'), deferred: p.deferred.length }; }
}
// F. decision supersede + isolation
{ const { root, b } = await mk('dec'); dirs.push(root);
  const d1 = await b.write({ tier: 'transitive', kind: 'decision', title: 'Use MySQL', body: 'a' });
  const d2 = await b.write({ tier: 'transitive', kind: 'decision', title: 'Use Postgres', body: 'b', supersedes: d1.meta.id });
  const p = await buildContext(b, { budgetTokens: 800 }, { now: new Date(), trackUsage: false, eduMdPath: join(root, 'EDU.md') });
  out.F_decisions = { d1: (await b.read(d1.meta.id))!.meta.status, mysqlInjected: p.text.includes('MySQL'), pgInjected: p.text.includes('Postgres') };
  const rec = await b.recall('MySQL'); out.F_recallReverted = rec.map(h => `${h.note.meta.status}:${h.note.meta.title}`);
}
{ const g = await mk('glob'); const pr = await mk('projA'); const pb = await mk('projB'); dirs.push(g.root, pr.root, pb.root);
  const gl = await g.b.write({ tier: 'transitive', kind: 'lesson', title: 'Global lesson', body: 'g' });
  const al = await pr.b.write({ tier: 'transitive', kind: 'lesson', title: 'ProjA only lesson', body: 'a' });
  const viewA = openBrain([pr.loc, { ...g.loc, scope: 'global' as const }]); const viewB = openBrain([pb.loc, { ...g.loc, scope: 'global' as const }]);
  out.G_isolation = { A: (await viewA.list()).map(n => n.meta.title), B: (await viewB.list()).map(n => n.meta.title) };
  // writing/feedback through project view on a global note: where does it land?
  await viewB.feedback(gl.meta.id, false);
  out.G_feedbackOnGlobalNote = { landsInGlobalFile: (await g.b.read(gl.meta.id))!.meta.usage ?? null, landsInProjB: (await pb.b.read(gl.meta.id))?.meta.usage ?? null, writtenPath: (await viewB.read(gl.meta.id))!.path.startsWith(g.root) ? 'global' : 'project' };
}
console.log(JSON.stringify(out, null, 1));
for (const d of dirs) await rm(d, { recursive: true, force: true });
