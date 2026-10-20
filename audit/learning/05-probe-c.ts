import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBrain } from '../../src/brain/index.js';
import { buildContext } from '../../src/context/pack.js';
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000);
const root = await mkdtemp(join(tmpdir(), 'edu05-c-')); const loc = { root, scope: 'project' as const };
const b = openBrain([loc]); await b.init(loc);
const mk = (title: string) => b.write({ tier: 'transitive', kind: 'lesson', title, body: title, created: day(0).toISOString() });
const bad = await mk('Bad lesson'); const stale = await mk('Injected-never-rated lesson'); const ctl = await mk('Control never injected');
for (let i = 0; i < 3; i++) await b.feedback(bad.meta.id, false);
const ctx = (d: number, track: boolean) => buildContext(b, { budgetTokens: 900 }, { now: day(d), trackUsage: track, eduMdPath: join(root, 'EDU.md') });
const res: Record<string, unknown> = {};
for (let d = 60; d <= 360; d += 60) { await ctx(d, true); await b.maintain(day(d)); }
const st = async (id: string) => (await b.read(id))!.meta;
res.day360 = { bad: (await st(bad.meta.id)).status, stale: (await st(stale.meta.id)).status, staleUsage: (await st(stale.meta.id)).usage, control: (await st(ctl.meta.id)).status };
const p = await ctx(361, false);
res.injectedAtDay361 = p.text.includes('Injected-never-rated') ? 'stale lesson STILL injected' : 'stale lesson gone';
console.log(JSON.stringify(res, null, 1)); await rm(root, { recursive: true, force: true });
