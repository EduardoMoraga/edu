import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openBrain } from '../../src/brain/brain.js';
import { createEduMcpServer } from '../../src/mcp/server.js';
import { autoMaintain } from '../../src/brain/auto-maintain.js';
import { reflect } from '../../src/reflect/reflect.js';
import { brief } from '../../src/context/brief.js';
import { sessionEnd, codexNotify } from '../../src/cli/hooks.js';
import type { Engine } from '../../src/core/contracts.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp('/tmp/01-capture-brain-'); roots.push(dir);
  const root = join(dir, '.edu'); const location = { root, scope: 'project' as const };
  const brain = openBrain([location]); await brain.init(location);
  return { dir, root, location, brain };
}
const empty = { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [] };
function engine(output: unknown, prompts: string[] = []): Engine {
  return { cli: 'codex', available: async () => true, async *run(request, agentId) {
    prompts.push(request.prompt);
    yield { type: 'agent.text', agentId, text: typeof output === 'string' ? output : JSON.stringify(output), at: new Date().toISOString() };
  } };
}
it('MCP brief -> session open -> close keeps summary, creates zero lessons/decisions; explicit reflection is retrievable', async () => {
  const { root, location, brain } = await fixture();
  const server = createEduMcpServer({ locations: [location], env: { EDU_HOME: root } });
  const client = new Client({ name: '01-capture-audit', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  async function call(name: string, args = {}) { const r = await client.callTool({ name, arguments: args }); expect(r.isError).not.toBe(true); return r; }
  try {
    await call('edu_brief');
    await call('edu_session_open', { title: 'Timeout investigation', source: '01-capture-fixture' });
    const session = (await brain.list({ kind: 'session' }))[0]!;
    const summary = 'Decidimos usar maxWorkers=1. Lección: limitar workers evita EAGAIN. Se repitió la prueba sin error.';
    await call('edu_session_close', { id: session.meta.id, summary });
    expect((await brain.read(session.meta.id))?.body.trim()).toBe(summary);
    expect(await brain.list({ tier: 'transitive' })).toHaveLength(0);
    expect(JSON.parse(await readFile(join(root, 'state/maintain.json'), 'utf8')).changed).toBe(0);
    const prompts: string[] = [];
    const output = { ...empty, lessons: [{ title: 'Limitar workers', body: 'Usar maxWorkers=1 evita EAGAIN.', evidence: [session.meta.id] }] };
    await reflect({ brain, brainRoot: root, engine: engine(output, prompts) });
    expect(prompts[0]).toContain(summary);
    const lesson = (await brain.list({ kind: 'lesson' }))[0]!;
    expect(lesson.meta).toMatchObject({ status: 'candidate', band: 'inferred', links: [session.meta.id] });
    expect((await brain.recall('workers')).some(h => h.note.meta.id === lesson.meta.id)).toBe(true);
    expect(await brief(brain)).toContain('Limitar workers');
    expect(await brain.list({ kind: 'decision' })).toHaveLength(0);
    console.log('MCP close: 1 closed episode, 0 transitive; explicit canned reflect: 1 candidate, recall+brief include it, 0 decisions.');
  } finally { await client.close(); await server.close(); }
});
it('automatic hooks store pointers/truncated text, not extracted lessons', async () => {
  const { dir, root, brain } = await fixture();
  const transcript = join(dir, '01-capture-transcript.jsonl');
  await writeFile(transcript, JSON.stringify({ text: 'SECRETLESS_SENTINEL_LESSON: usar timeout' }));
  const ctx: any = { cwd: dir, home: dir, env: { EDU_HOME: root, EDU_CEILING_DIRECTORIES: '/tmp' }, readStdin: async () => JSON.stringify({ session_id: '01-capture', cwd: dir, transcript_path: transcript }) };
  await sessionEnd(ctx, dir);
  await codexNotify(ctx, dir, JSON.stringify({ type: 'agent-turn-complete', cwd: dir, 'thread-id': '01-capture', 'input-messages': ['x'.repeat(250), 'IMPORTANT_SECOND_MESSAGE'], 'last-assistant-message': 'y'.repeat(450) + 'TAIL_LESSON' }));
  const sessions = await brain.list({ kind: 'session' });
  expect(sessions).toHaveLength(2);
  expect(sessions.find(n => n.meta.source === 'claude')?.body).toContain(transcript);
  expect(sessions.map(n => n.body).join('')).not.toMatch(/SECRETLESS_SENTINEL_LESSON|IMPORTANT_SECOND_MESSAGE|TAIL_LESSON/);
  expect(await brain.list({ kind: 'lesson' })).toHaveLength(0);
  console.log('Hooks: 2 episodes, 0 lessons; transcript content, second user message and response tail omitted.');
});
it('repeated reflection crashes on generated lessons and accepts nonexistent evidence', async () => {
  const { root, brain } = await fixture();
  const session = await brain.openSession('Repeated event', 'fixture'); await brain.closeSession(session.meta.id, 'Identical evidence.');
  const fake = engine({ ...empty, lessons: [{ title: 'Same lesson', body: 'Same body', evidence: ['NONEXISTENT'] }] });
  await reflect({ brain, brainRoot: root, engine: fake });
  await expect(reflect({ brain, brainRoot: root, engine: fake })).rejects.toThrow('Note id already exists');
  const lessons = await brain.list({ kind: 'lesson' }); expect(lessons).toHaveLength(1);
  expect(lessons.every(n => n.meta.links.includes('NONEXISTENT'))).toBe(true);
  console.log('Reflect twice: second call throws ID collision; nonexistent evidence accepted on first call.');
});
it('intervention deduplication fails across reflections and failed LLM output leaves a lesson', async () => {
  const { root, brain } = await fixture();
  const session = await brain.openSession('Intervention run', 'fixture'); await brain.closeSession(session.meta.id, 'Asked for missing file.');
  const run = join(root, 'runs', '01-capture-run'); await mkdir(run, { recursive: true });
  await writeFile(join(run, 'task.json'), JSON.stringify({ startedAt: new Date().toISOString() }));
  await writeFile(join(run, 'outcome.json'), JSON.stringify({ label: 'assisted_verified_success' }));
  await writeFile(join(run, 'intervention.jsonl'), JSON.stringify({ type: 'intervention', avoidable: true, harnessGap: 'context', action: 'message', detail: 'Missing file path.' }) + '\n');
  await expect(reflect({ brain, brainRoot: root, engine: engine('bad JSON') })).rejects.toThrow('JSON');
  expect(await brain.list({ kind: 'lesson' })).toHaveLength(1);
  await expect(reflect({ brain, brainRoot: root, engine: engine(empty) })).rejects.toThrow('Note id already exists');
  const lessons = await brain.list({ kind: 'lesson' }); expect(lessons).toHaveLength(1);
  expect(lessons[0]?.meta.tags).toEqual(['harness-gap:context', 'lesson']);
  expect(lessons.every(n => n.meta.links.length === 0)).toBe(true);
  console.log('Malformed reflect: 1 lesson persists; retry fails with ID collision, no evidence links.');
});
it('maintenance promotes only after supplied feedback, not episode capture', async () => {
  const { root, brain } = await fixture();
  const lesson = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Fixture', body: 'Fixture' });
  for (let i = 0; i < 3; i++) await brain.feedback(lesson.meta.id, true);
  const result = await autoMaintain(brain, root, { force: true });
  expect(result.ran).toBe(true); expect((await brain.read(lesson.meta.id))?.meta.status).toBe('proven');
  expect((await brain.list({ tier: 'canonical' }))[0]?.meta.status).toBe('proposed');
  console.log('3 supplied positive feedback events -> proven + proposed canonical; no human acceptance or efficacy measured.');
});
it('reflection consumes unrelated queue entries and excludes an old-created session just closed', async () => {
  const { root, brain } = await fixture();
  const old = await brain.write({ tier: 'episodic', kind: 'session', title: 'Long session', body: '', created: '2020-01-01T00:00:00Z' });
  await brain.closeSession(old.meta.id, 'FRESH_LESSON_FROM_OLD_SESSION');
  const recent = await brain.openSession('Recent session', 'fixture'); await brain.closeSession(recent.meta.id, 'RECENT_LESSON');
  await mkdir(join(root, 'reflect-queue'));
  const queued = join(root, 'reflect-queue', '01-capture-unrelated.json');
  await writeFile(queued, JSON.stringify({ sessionId: old.meta.id, runId: 'unrelated' }));
  const prompts: string[] = [];
  const result = await reflect({ brain, brainRoot: root, engine: engine(empty, prompts) });
  expect(result.episodesRead).toBe(1);
  expect(prompts[0]).not.toContain('FRESH_LESSON_FROM_OLD_SESSION');
  await expect(readFile(queued, 'utf8')).rejects.toThrow();
  console.log('Recent closure of old-created session excluded; unrelated queue entry removed without processing its session.');
});
