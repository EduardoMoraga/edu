import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EduEvent, Engine, EngineRunRequest } from '../../src/core/contracts.js';
import { openBrain } from '../../src/brain/index.js';
import { buildContext } from '../../src/context/index.js';
import { reflect } from '../../src/reflect/reflect.js';
import { listProposals, acceptProposal } from '../../src/reflect/proposals.js';

const mk = (resp: unknown, seen: EngineRunRequest[] = []): Engine => ({ cli: 'claude', available: async () => true, async *run(r: EngineRunRequest, agentId: string): AsyncIterable<EduEvent> { seen.push(r); yield { type: 'agent.text', agentId, text: typeof resp === 'string' ? resp : JSON.stringify(resp), at: new Date().toISOString() }; } });
const empty = { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [] };
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'edu-06-'));
  const root = join(dir, '.edu');
  const brain = openBrain([{ scope: 'project', root }]);
  await brain.init({ scope: 'project', root });
  const ep = await brain.openSession('Run: fix login', 'edu:orchestrator');
  await brain.closeSession(ep.meta.id, 'done');
  return { dir, root, brain, ep };
}
async function pkg(root: string, runId: string, lines: object[]) {
  const d = join(root, 'runs', runId); await mkdir(d, { recursive: true });
  await writeFile(join(d, 'task.json'), JSON.stringify({ startedAt: new Date().toISOString() }));
  await writeFile(join(d, 'outcome.json'), '{}');
  await writeFile(join(d, 'intervention.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'));
}

describe('06 reflection probes', () => {
  it('P1 deterministic: avoidable intervention -> specific lesson, no LLM content needed; episode text reaches prompt', async () => {
    const { dir, root, brain } = await setup(); const seen: EngineRunRequest[] = [];
    await pkg(root, 'r1', [{ type: 'intervention', by: 'user', action: 'composer-message', detail: 'you forgot to use the file src/auth.ts', avoidable: true, harnessGap: 'context' }, { type: 'intervention', action: 'approval:approved', avoidable: false, harnessGap: 'unknown' }]);
    const rep = await reflect({ brain, engine: mk(empty, seen), brainRoot: root });
    const lessons = await brain.list({ kind: 'lesson' });
    console.log('P1', JSON.stringify(lessons.map(l => ({ t: l.meta.title, status: l.meta.status, tags: l.meta.tags, links: l.meta.links, band: l.meta.band }))));
    console.log('P1 prompt has mhir:', /"context":\{"episodes":1,"rate":1\}/.test(seen[0]!.prompt), 'autonomy', seen[0]!.autonomy);
    expect(rep.lessons).toHaveLength(1);
    await rm(dir, { recursive: true, force: true });
  });
  it('P2 rerun duplicates LLM lessons; evidence ids unvalidated', async () => {
    const { dir, root, brain } = await setup();
    const out = { ...empty, lessons: [{ title: 'Always read auth.ts first', body: 'x', evidence: ['L-does-not-exist'] }] };
    await reflect({ brain, engine: mk(out), brainRoot: root }); await reflect({ brain, engine: mk(out), brainRoot: root });
    const ls = await brain.list({ kind: 'lesson' });
    console.log('P2 lessons after 2 runs:', ls.length, 'links', JSON.stringify(ls[0]?.meta.links));
    await rm(dir, { recursive: true, force: true });
  });
  it('P3 LLM-only feedback can promote a lesson to proven without real use, then reflect proposes canonical', async () => {
    const { dir, root, brain } = await setup();
    const l = await brain.write({ title: 'Lesson A', body: 'b', tier: 'transitive', kind: 'lesson', band: 'inferred', source: 'x' });
    const out = { ...empty, feedback: [{ id: l.meta.id, helpful: true }] };
    for (let i = 0; i < 3; i++) await reflect({ brain, engine: mk(out), brainRoot: root });
    await brain.maintain();
    const after = (await brain.list({ kind: 'lesson' }))[0]!;
    const canon = await brain.list({ tier: 'canonical' });
    console.log('P3 status', after.meta.status, 'usage', JSON.stringify(after.meta.usage), 'canonical proposals', canon.map(c => c.meta.status + ':' + c.meta.source));
    await rm(dir, { recursive: true, force: true });
  });
  it('P4 bad feedback id throws AFTER lessons written, queue not consumed (partial state)', async () => {
    const { dir, root, brain } = await setup();
    await mkdir(join(root, 'reflect-queue'), { recursive: true }); await writeFile(join(root, 'reflect-queue', 'q.json'), '{}');
    const out = { ...empty, lessons: [{ title: 'L1', body: 'b', evidence: [] }], feedback: [{ id: 'nope', helpful: true }] };
    const r = await reflect({ brain, engine: mk(out), brainRoot: root }).then(() => 'ok', e => String(e.message));
    console.log('P4', r, 'lessons', (await brain.list({ kind: 'lesson' })).length, 'queue', await readdir(join(root, 'reflect-queue')));
    await rm(dir, { recursive: true, force: true });
  });
  it('P5 skill proposal -> accept writes unvalidated content; candidate lesson reaches context pack', async () => {
    const { dir, root, brain } = await setup();
    const out = { ...empty, lessons: [{ title: 'Check auth path', body: 'b', evidence: [] }], skillProposals: [{ name: 'Bad Name!', rationale: 'r', content: 'no frontmatter at all' }] };
    const rep = await reflect({ brain, engine: mk(out), brainRoot: root });
    const props = await listProposals(brain, root);
    await acceptProposal(brain, props[0]!.id, root);
    const skill = await readFile(join(root, 'skills', props[0]!.name, 'SKILL.md'), 'utf8');
    const pack = await buildContext(brain, { budgetTokens: 4000 }, { trackUsage: false });
    console.log('P5 skill name', props[0]!.name, 'content', JSON.stringify(skill), 'lesson in pack:', /Check auth path/.test(pack.text), 'accept in episodes:', /Accepted skill proposal/.test(pack.text));
    await rm(dir, { recursive: true, force: true });
  });
  it('P6 non-JSON / prose response -> hard failure, nothing written', async () => {
    const { dir, root, brain } = await setup();
    const r = await reflect({ brain, engine: mk('Here are lessons: be careful.'), brainRoot: root }).then(() => 'ok', e => String(e.message).slice(0, 80));
    console.log('P6', r);
    await rm(dir, { recursive: true, force: true });
  });
  it('P7 rerun with same avoidable intervention: dedup works?', async () => {
    const { dir, root, brain } = await setup();
    await pkg(root, 'r1', [{ type: 'intervention', by: 'user', action: 'composer-message', detail: 'you forgot to use the file src/auth.ts', avoidable: true, harnessGap: 'context' }]);
    const a = await reflect({ brain, engine: mk(empty), brainRoot: root });
    const b = await reflect({ brain, engine: mk(empty), brainRoot: root }).then(r => 'ok:' + r.lessons.length, e => 'ERR ' + String(e.message));
    console.log('P7 first', a.lessons.length, 'second', b);
    await rm(dir, { recursive: true, force: true });
  });
});
