import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openBrain } from '../../src/brain/index.js';
import { createEduMcpServer } from '../../src/mcp/server.js';
import { planInstall, resolveTemplatesDir } from '../../src/adapters/installer.js';
import { sessionStart, sessionEnd, codexNotify } from '../../src/cli/hooks.js';
import type { CliContext } from '../../src/cli/context.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const base = await mkdtemp('/tmp/09-opencode-integration-'); roots.push(base);
  const root = join(base, 'project'), home = join(base, 'home');
  await mkdir(root); await mkdir(home);
  const location = { scope: 'project' as const, root: join(root, '.edu') };
  const brain = openBrain([location]); await brain.init(location);
  await writeFile(join(location.root, 'EDU.md'), '# Fixture — the contract\n');
  const env = { HOME: home, EDU_HOME: join(home, '.edu'), EDU_CEILING_DIRECTORIES: base, PATH: '' };
  const output: string[] = [];
  const context = (input: object = {}): CliContext => ({ cwd: root, home, env, out: s => { output.push(s); }, err: s => { output.push(s); }, readStdin: async () => JSON.stringify(input), isTTY: false, stdinIsTTY: false, confirm: async () => false, detectClis: async () => [], setExitCode: () => {} });
  return { root, home, location, brain, env, output, context };
}
async function connect(f: Awaited<ReturnType<typeof fixture>>, name: string) {
  const server = createEduMcpServer({ locations: [f.location], env: f.env });
  const client = new Client({ name, version: 'audit-local' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  return { call: (name: string, args = {}) => client.callTool({ name, arguments: args }), close: async () => { await client.close(); await server.close(); } };
}
const text = (r: any) => r.content.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n');

it('MCP abrir/cerrar por id real funciona igual con los tres nombres de cliente', async () => {
  const f = await fixture();
  for (const host of ['claude', 'codex', 'opencode']) {
    const c = await connect(f, host);
    try {
      const opened = await c.call('edu_session_open', { title: `09 ${host}`, source: host });
      const id = /Session id: (\S+)/.exec(text(opened))![1];
      expect((await c.call('edu_session_close', { id, summary: `09 done ${host}`, source: host })).isError).not.toBe(true);
      expect((await f.brain.read(id))?.meta.status).toBe('closed');
    } finally { await c.close(); }
  }
});

it('MCP: cada productor puede compartir una lección con los tres nombres de cliente', async () => {
  const f = await fixture();
  for (const producer of ['claude', 'codex', 'opencode']) {
    const a = await connect(f, producer);
    try { expect((await a.call('edu_remember', { tier: 'transitive', kind: 'lesson', title: `09 lesson ${producer}`, body: `09probe-${producer}: verify fixtures first.` })).isError).not.toBe(true); }
    finally { await a.close(); }
    for (const consumer of ['claude', 'codex', 'opencode']) {
      const b = await connect(f, consumer);
      try {
        expect(text(await b.call('edu_recall', { query: `09 lesson ${producer}` }))).toContain(`09 lesson ${producer}`);
        expect(text(await b.call('edu_read', { id: `09 lesson ${producer}` }))).toContain(`09probe-${producer}`);
        expect((await b.call('edu_brief')).isError).not.toBe(true);
      } finally { await b.close(); }
    }
  }
  expect((await f.brain.list({ kind: 'lesson' })).every(n => n.meta.source === 'mcp')).toBe(true);
});

it('inicio Claude inyecta contexto pero no abre sesión; cierre MCP del protocolo no basta sin id válido', async () => {
  const f = await fixture(); await sessionStart(f.context({ cwd: f.root }), f.root);
  expect(f.output.join('\n')).toContain('Fixture'); expect(await f.brain.list({ kind: 'session' })).toHaveLength(0);
  const c = await connect(f, 'opencode');
  try { expect((await c.call('edu_session_close', { id: 'host-session-id', summary: 'Done' })).isError).toBe(true); }
  finally { await c.close(); }
});

it('Claude fin no extrae aprendizaje y duplica episodio al repetir evento', async () => {
  const f = await fixture(); const transcript = join(f.root, '09-transcript.jsonl');
  await writeFile(transcript, JSON.stringify({ text: 'LESSON_SENTINEL_09: never repeat this mistake' }));
  const ctx = f.context({ session_id: '09-session', transcript_path: transcript });
  await sessionEnd(ctx, f.root); await sessionEnd(ctx, f.root);
  const episodes = await f.brain.list({ kind: 'session' }); expect(episodes).toHaveLength(2);
  expect(episodes.every(n => !n.body.includes('LESSON_SENTINEL_09') && n.body.includes(transcript))).toBe(true);
  expect(await f.brain.list({ kind: 'lesson' })).toHaveLength(0);
});

it('Codex notify guarda turno truncado, no sesión equivalente ni lesson', async () => {
  const f = await fixture();
  const payload = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': '09-thread', 'input-messages': ['x'.repeat(300)], 'last-assistant-message': 'y'.repeat(500) + 'SENTINEL_09' });
  await codexNotify(f.context(), f.root, payload); await codexNotify(f.context(), f.root, payload);
  const episodes = await f.brain.list({ kind: 'session' }); expect(episodes).toHaveLength(2);
  expect(episodes.every(n => n.meta.source === 'codex' && !n.body.includes('SENTINEL_09'))).toBe(true);
  expect(await f.brain.list({ kind: 'lesson' })).toHaveLength(0);
});

it('MCP sin source puede cerrar sesión de otro host al recibir id desconocido', async () => {
  const f = await fixture(); const note = await f.brain.openSession('09 claude work', 'claude');
  const c = await connect(f, 'opencode');
  try { expect(text(await c.call('edu_session_close', { id: '09-wrong', summary: 'Closed by OpenCode' }))).toContain('instead of'); }
  finally { await c.close(); }
  expect((await f.brain.read(note.meta.id))?.meta.status).toBe('closed');
});

it('planes: protocolo compartido, hooks distintos y configuración OpenCode legacy', async () => {
  const f = await fixture(); const plans = await planInstall({ ...f, templatesDir: resolveTemplatesDir(), scope: 'project', clis: ['claude', 'codex', 'opencode', 'agy'] });
  const claude = plans.actions.find(a => a.path.endsWith('.claude/settings.json'))!;
  expect(claude.jsonPatch).toHaveProperty('hooks.SessionEnd');
  const oc = plans.actions.find(a => a.path.endsWith('opencode.json'))!;
  expect(oc.jsonPatch).toHaveProperty('mcp.edu'); expect(oc.jsonPatch).not.toHaveProperty('mcp.servers');
  expect(plans.actions.find(a => a.cli === 'codex' && a.kind === 'toml-merge')?.tomlBody).toContain('codex-notify');
  expect(plans.actions.filter(a => a.cli === 'opencode').some(a => JSON.stringify(a).includes('session-start'))).toBe(false);
  expect(plans.actions.some(a => a.cli === 'agy' && ['json-merge', 'toml-merge'].includes(a.kind))).toBe(false);
});

it('skills derivadas se copian al plan al reinstalar, no se enlazan en vivo', async () => {
  const f = await fixture(); const skill = join(f.location.root, 'skills/09-fixture'); await mkdir(skill, { recursive: true });
  const path = join(skill, 'SKILL.md'); await writeFile(path, '09 version one');
  const options = { ...f, templatesDir: resolveTemplatesDir(), scope: 'project' as const, clis: ['claude', 'codex', 'opencode'] as const };
  const a = await planInstall({ ...options, clis: [...options.clis] }); await writeFile(path, '09 version two');
  expect(a.actions.filter(x => x.path.endsWith('09-fixture/SKILL.md')).every(x => x.content === '09 version one')).toBe(true);
  const b = await planInstall({ ...options, clis: [...options.clis] });
  const copies = b.actions.filter(x => x.path.endsWith('09-fixture/SKILL.md'));
  expect(copies).toHaveLength(2); expect(copies.every(x => x.content === '09 version two')).toBe(true);
  expect(await readFile(path, 'utf8')).toBe('09 version two');
});
