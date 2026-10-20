import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openBrain } from '../../src/brain/brain.js';
import { autoMaintain } from '../../src/brain/auto-maintain.js';
import { brief } from '../../src/context/brief.js';
import { buildContext } from '../../src/context/pack.js';
import { reflect } from '../../src/reflect/reflect.js';
import { createEduMcpServer } from '../../src/mcp/server.js';
import { orchestrate } from '../../src/orchestrator/run.js';
import { sessionStart, sessionEnd, codexNotify } from '../../src/cli/hooks.js';
import type { CliContext } from '../../src/cli/context.js';
import { defaultConfig } from '../../src/orchestrator/config.js';
import { nodeCommand } from '../../src/test-support/shell.js';
import type { Engine, EngineRunRequest, EduEvent } from '../../src/core/contracts.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp('/tmp/03-autonomy-'); roots.push(root);
  const location = { scope: 'project' as const, root };
  const brain = openBrain([location]);
  await writeFile(join(root, 'EDU.md'), '# Fixture aislado');
  // No init/setup, no discovery of real workspaces.
  expect(await brief(brain, 1500, { eduMdPath: join(root, 'EDU.md') })).toContain('Fixture aislado');
  return { root, location, brain };
}
const empty = { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [] };
function engineFor(output: unknown): Engine { return { cli: 'codex', available: async () => true, async *run(_request, agentId) { yield { type: 'agent.text', agentId, text: JSON.stringify(output), at: new Date().toISOString() }; } }; }
async function episode(brain: ReturnType<typeof openBrain>) { const n = await brain.openSession('Sesión fixture', '03-autonomy'); await brain.closeSession(n.meta.id, 'Se comprobó el resultado.'); return n; }
async function intervention(root: string) {
  const dir = join(root, 'runs', 'fixture-run'); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.json'), JSON.stringify({ startedAt: new Date().toISOString() }));
  await writeFile(join(dir, 'outcome.json'), JSON.stringify({ label: 'assisted_verified_success' }));
  await writeFile(join(dir, 'intervention.jsonl'), JSON.stringify({ type: 'intervention', avoidable: true, harnessGap: 'context', action: 'composer-message', detail: 'Faltó leer el contrato.' }) + '\n');
}
it('lección con feedback reaparece tras reabrir; no implica éxito LLM', async () => {
  const { root, location, brain } = await fixture();
  const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Revisar contrato antes de editar', body: 'Leer contrato y comprobar restricciones.' });
  for (let i = 0; i < 3; i++) await brain.feedback(note.meta.id, true);
  await episode(brain);
  expect((await autoMaintain(brain, root)).ran).toBe(true);
  const reopened = openBrain([location]);
  expect((await reopened.read(note.meta.id))?.meta.status).toBe('proven');
  expect(await brief(reopened, 1500, { eduMdPath: join(root, 'EDU.md') })).toContain('Revisar contrato antes de editar (proven;');
  expect((await reopened.list({ tier: 'canonical' }))[0]?.meta.status).toBe('proposed');
  expect(await autoMaintain(brain, root)).toMatchObject({ ran: false, reason: 'throttled' });
});
it('mantenimiento no consume cola; reflect borra incluso entrada fuera de ventana', async () => {
  const { root, brain } = await fixture(); await episode(brain);
  await mkdir(join(root, 'reflect-queue')); const path = join(root, 'reflect-queue', 'old.json');
  await writeFile(path, JSON.stringify({ runId: 'old', sessionId: 'not-analyzed', queuedAt: '2000-01-01T00:00:00Z' }));
  await autoMaintain(brain, root); expect(await readFile(path, 'utf8')).toContain('not-analyzed');
  const report = await reflect({ brain, brainRoot: root, engine: engineFor(empty), since: '1d' });
  expect(report.episodesRead).toBe(1); expect(await readdir(join(root, 'reflect-queue'))).toEqual([]);
});
it('reflect sin episodios deja cola pendiente', async () => {
  const { root, brain } = await fixture(); await mkdir(join(root, 'reflect-queue')); await writeFile(join(root, 'reflect-queue', 'x.json'), '{}');
  expect((await reflect({ brain, brainRoot: root, engine: engineFor(empty) })).episodesRead).toBe(0);
  expect(await readdir(join(root, 'reflect-queue'))).toEqual(['x.json']);
});
it('repetir reflect con intervención colisiona por ID en vez de deduplicar', async () => {
  const { root, brain } = await fixture(); await episode(brain); await intervention(root);
  await reflect({ brain, brainRoot: root, engine: engineFor(empty) });
  await expect(reflect({ brain, brainRoot: root, engine: engineFor(empty) })).rejects.toThrow('Note id already exists');
  expect((await brain.list({ kind: 'lesson' })).filter(n => n.meta.tags.includes('harness-gap:context'))).toHaveLength(1);
});
it('sin intervenciones, repetir feedback de un único episodio promueve la lección', async () => {
  const { root, brain } = await fixture(); await episode(brain);
  const n = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Objetivo de feedback', body: 'Fixture.' });
  const engine = engineFor({ ...empty, feedback: [{ id: n.meta.id, helpful: true }] });
  for (let i = 0; i < 3; i++) await reflect({ brain, brainRoot: root, engine });
  expect((await brain.read(n.meta.id))?.meta.usage?.wins).toBe(3);
  await autoMaintain(brain, root);
  expect((await brain.read(n.meta.id))?.meta.status).toBe('proven');
});
it('fallo del motor de reflect deja escritura parcial', async () => {
  const { root, brain } = await fixture(); await episode(brain); await intervention(root);
  await expect(reflect({ brain, brainRoot: root, engine: engineFor({ invalid: true }) })).rejects.toThrow();
  expect((await brain.list({ kind: 'lesson' })).filter(n => n.meta.tags.includes('harness-gap:context'))).toHaveLength(1);
});
it('MCP id desconocido sin source cierra sesión ajena más reciente', async () => {
  const { root, location, brain } = await fixture();
  const a = await brain.write({ tier: 'episodic', kind: 'session', title: 'Agente A', source: 'A', body: '', created: '2026-01-01T00:00:00Z' });
  const b = await brain.write({ tier: 'episodic', kind: 'session', title: 'Agente B', source: 'B', body: '', created: '2026-01-02T00:00:00Z' });
  const server = createEduMcpServer({ locations: [location], env: { HOME: root, EDU_HOME: root }, workspace: 'fixture' });
  const client = new Client({ name: '03-autonomy', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: 'edu_session_close', arguments: { id: 'A-typo', summary: 'Resumen de A' } });
    expect(result.isError).not.toBe(true);
    expect((await brain.read(a.meta.id))?.meta.status).toBe('open-session');
    expect((await brain.read(b.meta.id))?.body).toBe('Resumen de A');
    await brain.closeSession(a.meta.id, 'Cierre correcto de fixture A');
  } finally { await client.close(); await server.close(); }
});
it('H3 reemite atribución de evidencia tras fallo, corrige y verifica con motor guionado', async () => {
  const { root, brain } = await fixture(); const requests: EngineRunRequest[] = []; const observed: EduEvent[] = [];
  await mkdir(join(root, 'playbooks'));
  await writeFile(join(root, 'playbooks', 'default.md'), '---\nname: default\ndescription: Isolated audit fixture\nharness: H3\nrequireSpecApproval: true\nmaxFixRounds: 1\n---\nReproduce, attribute, fix, verify.\n');
  const checks = [{ id: 'check-r1', requirementIds: ['r1'], command: nodeCommand("require('fs').accessSync('fixed'); process.stdout.write('passing')"), expect: { stdoutIncludes: 'passing' }, timeoutMs: 5000 }];
  await mkdir(join(root, '.edu', 'harness'), { recursive: true }); await writeFile(join(root, '.edu', 'harness', 'checks.json'), JSON.stringify(checks));
  const plan = { requirements: [{ id: 'r1', text: 'prints passing' }], checks, steps: [{ id: 'build', role: 'builder', task: 'Do initial work', dependsOn: [], parallelSafe: false }] };
  const runtime: Engine = { cli: 'codex', available: async () => true, async *run(request, agentId) {
    requests.push(request);
    if (agentId.includes('verification-fix')) await writeFile(join(root, 'fixed'), 'yes');
    const text = request.prompt.includes('Create a safe') ? JSON.stringify(plan) : request.prompt.includes('Review the completed') ? '{"verdict":"pass","issues":[]}' : 'done';
    yield { type: 'agent.text', agentId, text, at: new Date().toISOString() };
    yield { type: 'agent.end', agentId, ok: true, summary: 'done', at: new Date().toISOString() };
  } };
  const result = await orchestrate('Auditar recuperación', { config: { ...defaultConfig('codex'), approvals: 'auto' }, brain, context: { build: req => buildContext(brain, req, { eduMdPath: join(root, 'EDU.md') }) }, engines: () => runtime, available: ['codex'], cwd: root, runsDir: join(root, 'runs'), onEvent: event => { observed.push(event); }, approve: async () => true, autoApprove: true, harnessLevel: 'H3' });
  expect(result.ok).toBe(true);
  const attrs = observed.filter(e => e.type === 'failure.attribution');
  expect(attrs).toHaveLength(2); expect(attrs.every(e => e.type === 'failure.attribution' && e.alternatives.length === 0)).toBe(true);
  expect(requests.some(r => r.prompt.includes('If verification disproves attribution, return to attribution'))).toBe(true);
  expect(observed.filter(e => e.type === 'verify.result').map(e => e.type === 'verify.result' && e.ok)).toEqual([false, false, true]);
  expect(await readdir(join(root, 'reflect-queue'))).toHaveLength(1);
  expect(await brain.list({ kind: 'lesson' })).toHaveLength(0);
  console.log('03-autonomy H3: checks=false,false,true; attribution=2; alternatives=0; queued=1; lessons=0; engine=scripted; model=none');
});

it('hooks generan episodios nuevos y dejan abierta la sesión explícita', async () => {
  const { root, brain } = await fixture();
  const explicit = await brain.openSession('Sesión explícita del agente', 'claude');
  const output: string[] = [];
  const ctx: CliContext = { cwd: root, home: root, env: { HOME: root, EDU_HOME: root, EDU_CEILING_DIRECTORIES: '/tmp' }, out: text => { output.push(text); }, err: () => {}, readStdin: async () => JSON.stringify({ session_id: 'fixture-host', cwd: root }), isTTY: false, stdinIsTTY: false, confirm: async () => { throw new Error('No human calls'); }, detectClis: async () => [], setExitCode: () => {} };
  await sessionStart(ctx, root);
  expect(await brain.list({ kind: 'session' })).toHaveLength(1);
  await sessionEnd(ctx, root);
  expect((await brain.read(explicit.meta.id))?.meta.status).toBe('open-session');
  expect(await brain.list({ kind: 'session', status: 'closed' })).toHaveLength(1);
  const payload = JSON.stringify({ type: 'agent-turn-complete', cwd: root, 'thread-id': 'same-thread', 'last-assistant-message': 'Fixture' });
  await codexNotify(ctx, root, payload); await codexNotify(ctx, root, payload);
  expect(await brain.list({ kind: 'session', status: 'closed' })).toHaveLength(3);
  expect(await readFile(join(root, 'state', 'maintain.json'), 'utf8')).toContain('lastRun');
  await brain.closeSession(explicit.meta.id, 'Cierre de fixture; sin notas reales.');
});
