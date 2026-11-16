import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { readLedger, resetLedgerCache } from '../brain/ledger.js';
import { resetNoteCache } from '../brain/store.js';
import { estimateTokens } from '../context/index.js';
import { createEduMcpServer } from './server.js';

const roots: string[] = [];
afterEach(async () => { resetNoteCache(); resetLedgerCache(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function connected() {
  const root = await mkdtemp(join(tmpdir(), 'edu-mcp-memory-'));
  roots.push(root);
  const location = { scope: 'project' as const, root };
  const brain = openBrain([location]);
  await brain.init(location);
  const server = createEduMcpServer({ locations: [location], env: {} });
  const client = new Client({ name: 'claude-code', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: result.isError === true, text: (result.content as { type: string; text: string }[]).filter(item => item.type === 'text').map(item => item.text).join('') };
  };
  return { root, brain, call, close: async () => { await client.close(); await server.close(); } };
}

describe('edu_remember claim bands and provenance', () => {
  it('requires a band for transitive notes and shows legacy notes as unbanded', async () => {
    const t = await connected();
    try {
      const missing = await t.call('edu_remember', { tier: 'transitive', kind: 'lesson', title: 'No band', body: 'x' });
      expect(missing.isError).toBe(true);
      expect(missing.text).toMatch(/band is required for transitive notes/);
      expect(await t.brain.list({ tier: 'transitive' })).toEqual([]);
      expect((await t.call('edu_remember', { tier: 'episodic', title: 'Log entry', body: 'Episodes need no band.' })).isError).toBe(false);
      const ok = await t.call('edu_remember', { tier: 'transitive', kind: 'hypothesis', band: 'hypothesis', title: 'Cache misses', body: 'Misses come from TTLs.' });
      expect(ok.text).toMatch(/^Created H-cache-misses · hypothesis · open · Cache misses/);
      const legacy = await t.brain.write({ tier: 'transitive', kind: 'lesson', title: 'Legacy rule', body: 'Written before bands were required.' });
      expect((await t.call('edu_read', { id: legacy.meta.id })).text).toMatch(new RegExp(`^${legacy.meta.id} · unbanded · candidate · Legacy rule`));
    } finally { await t.close(); }
  });

  it('keeps a session as provenance only when it is real: open in this brain', async () => {
    const t = await connected();
    try {
      const forged = await t.call('edu_remember', { tier: 'transitive', kind: 'lesson', band: 'inferred', title: 'Forged session', body: 'x', session: '2026-01-01-made-up-12345678' });
      expect(forged.text).toContain('Session 2026-01-01-made-up-12345678 ignored');
      expect((await t.brain.read('L-forged-session'))?.meta.session).toBeUndefined();
      const hookSession = await t.brain.openSession('Host session', 'hook');
      const real = await t.call('edu_remember', { tier: 'transitive', kind: 'lesson', band: 'inferred', title: 'Real session', body: 'y', session: hookSession.meta.id });
      expect(real.text).not.toContain('ignored');
      expect((await t.brain.read('L-real-session'))?.meta.session).toBe(hookSession.meta.id);
    } finally { await t.close(); }
  });
});

describe('edu_feedback', () => {
  it('counts the same verdict on the same note once per session and never retires a proven lesson', async () => {
    const t = await connected();
    try {
      const proven = await t.brain.write({ tier: 'transitive', kind: 'lesson', status: 'proven', band: 'verified', title: 'Pin versions', body: 'Pin dependency versions.' });
      for (let i = 0; i < 3; i++) expect((await t.call('edu_feedback', { id: proven.meta.id, helpful: false })).isError).toBe(false);
      expect((await t.brain.read(proven.meta.id))?.meta.usage).toMatchObject({ wins: 0, losses: 1 });
      await t.call('edu_feedback', { id: proven.meta.id, helpful: true });
      await t.call('edu_feedback', { id: proven.meta.id, helpful: true });
      expect((await t.brain.read(proven.meta.id))?.meta.usage).toMatchObject({ wins: 1, losses: 1 });
      await t.brain.maintain(new Date());
      expect((await t.brain.read(proven.meta.id))?.meta.status).toBe('proven');
    } finally { await t.close(); }
  });
});

describe('edu_recall', () => {
  it('fits whole hits in the budget, says how many more there are and records only the shown ones as used', async () => {
    const t = await connected();
    try {
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) ids.push((await t.brain.write({ tier: 'transitive', kind: 'lesson', band: 'inferred', title: `Deploy checklist ${i}`, body: `Deploy step ${i}: ${'verify the deploy target and roll back on failure. '.repeat(6)}` })).meta.id);
      const result = await t.call('edu_recall', { query: 'deploy checklist', maxTokens: 400 });
      expect(estimateTokens(result.text)).toBeLessThanOrEqual(400);
      const lines = result.text.split('\n');
      const more = /^… (\d+) more hits? not shown/.exec(lines.at(-1)!);
      expect(more).not.toBeNull();
      const shown = lines.slice(0, -1).map(line => line.split(' · ')[0]!);
      expect(shown.length + Number(more![1])).toBe(10);
      expect(shown.length).toBeGreaterThan(0);
      const ledger = await readLedger(t.root);
      expect(Object.keys(ledger.notes).sort()).toEqual([...shown].sort());
      const all = await t.call('edu_recall', { query: 'deploy checklist', maxTokens: 20_000 });
      expect(all.text).not.toContain('more hit');
      expect(all.text.split('\n')).toHaveLength(10);
    } finally { await t.close(); }
  });

  it('keeps answering when a note file is broken, and the brief reports it', async () => {
    const t = await connected();
    try {
      await mkdir(join(t.root, 'brain', '3-transitive'), { recursive: true });
      await writeFile(join(t.root, 'brain', '3-transitive', 'L-odd.md'), '---\nid: L-odd\ntier: transitive\ntitle: [not, text]\n---\n\nDeploy body.\n');
      await writeFile(join(t.root, 'brain', '3-transitive', 'L-year.md'), '---\nid: L-year\ntier: transitive\nkind: lesson\ntitle: 2024\n---\n\nDeploy freeze for 2024.\n');
      await t.brain.write({ tier: 'transitive', kind: 'lesson', band: 'inferred', title: 'Deploy freeze', body: 'Freeze deploys on Fridays.' });
      const recall = await t.call('edu_recall', { query: 'deploy freeze' });
      expect(recall.isError).toBe(false);
      expect(recall.text).toContain('L-year · unbanded · unspecified · 2024');
      expect(recall.text).not.toContain('L-odd');
      expect((await t.call('edu_brief')).text).toContain('1 note could not be read: 3-transitive/L-odd.md (title must be text, not a list or a map)');
    } finally { await t.close(); }
  });
});

describe('MCP write hygiene', () => {
  it('caps titles, keeps owner, due and tags on one line, and accepts only real ISO dates', async () => {
    const t = await connected();
    try {
      const long = 'x'.repeat(301);
      for (const [name, args] of [
        ['edu_remember', { tier: 'episodic', title: long, body: 'b' }],
        ['edu_propose_canonical', { kind: 'standard', title: long, body: 'b' }],
        ['edu_session_open', { title: long }],
      ] as const) {
        const refused = await t.call(name, args);
        expect(refused.isError, name).toBe(true);
        expect(refused.text).toContain('title must be at most 300 characters');
      }
      expect(await t.brain.list()).toEqual([]);
      expect((await t.call('edu_remember', { tier: 'episodic', title: 'y'.repeat(300), body: 'b' })).isError).toBe(false);
      for (const due of ['2026-02-30', 'tomorrow', '2026-12-31\nstatus: done']) {
        const bad = await t.call('edu_remember', { tier: 'transitive', kind: 'commitment', band: 'inferred', title: `Ship ${due.length}`, body: 'b', due });
        expect(bad.isError, due).toBe(true);
        expect(bad.text).toContain('ISO date');
      }
      const ok = await t.call('edu_remember', { tier: 'transitive', kind: 'commitment', band: 'inferred', title: 'Ship it', body: 'b', due: '2026-12-31', owner: 'Ana\nstatus: done', tags: ['a\r\nb', '\n'] });
      expect(ok.isError, ok.text).toBe(false);
      const note = (await t.brain.list({ kind: 'commitment' }))[0]!;
      expect(note.meta).toMatchObject({ due: '2026-12-31', owner: 'Ana status: done' });
      expect(note.meta.tags).toContain('a b');
      expect(note.meta.tags?.some(tag => /[\r\n]/.test(tag) || !tag.trim())).toBe(false);
    } finally { await t.close(); }
  });
});
