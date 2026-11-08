import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { contentHash, openBrain } from '../brain/index.js';
import { resetLedgerCache } from '../brain/ledger.js';
import { resetNoteCache } from '../brain/store.js';
import { agentOfClient, createEduMcpServer } from './server.js';

const roots: string[] = [];
afterEach(async () => { resetNoteCache(); resetLedgerCache(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function connected(clientName = 'claude-code') {
  const root = await mkdtemp(join(tmpdir(), 'edu-mcp-compiled-'));
  roots.push(root);
  const location = { scope: 'project' as const, root };
  const brain = openBrain([location]);
  await brain.init(location);
  const server = createEduMcpServer({ locations: [location], env: {} });
  const client = new Client({ name: clientName, version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: result.isError === true, text: (result.content as { type: string; text: string }[]).filter(item => item.type === 'text').map(item => item.text).join('') };
  };
  return { brain, call, close: async () => { await client.close(); await server.close(); } };
}

describe('agentOfClient', () => {
  it('maps MCP client names to provenance agents and leaves unknown clients undefined', () => {
    expect(agentOfClient('claude-code')).toBe('claude-code');
    expect(agentOfClient('codex-mcp-client')).toBe('codex');
    expect(agentOfClient('pi')).toBe('pi');
    expect(agentOfClient('opencode')).toBe('opencode');
    expect(agentOfClient('antigravity')).toBe('antigravity');
    expect(agentOfClient('some-editor')).toBeUndefined();
    expect(agentOfClient(undefined)).toBeUndefined();
  });
});

describe('edu_remember compiles on write', () => {
  it('accepts links and supersedes, reports conflicts with a supersedes hint and records provenance', async () => {
    const t = await connected('codex-mcp-client');
    try {
      const old = await t.brain.write({ tier: 'transitive', kind: 'decision', title: 'Store sessions in Redis', body: 'Session storage uses Redis with a one hour expiry.' });
      const opened = await t.call('edu_session_open', { title: 'Storage work' });
      const sessionId = /Session id: (\S+)/.exec(opened.text)![1]!;

      const conflicting = await t.call('edu_remember', { tier: 'transitive', kind: 'decision', title: 'Store sessions in Postgres', body: 'Session storage uses Postgres with a one hour expiry.', links: ['K-storage'] });
      expect(conflicting.isError).toBe(false);
      expect(conflicting.text).toMatch(/^Created D-store-sessions-in-postgres/);
      expect(conflicting.text).toContain(`Possible conflict: ${old.meta.id}`);
      expect(conflicting.text).toContain(`consider supersedes: ${old.meta.id}`);
      const written = (await t.brain.list({ kind: 'decision' })).find(note => note.meta.title === 'Store sessions in Postgres')!;
      expect(written.meta.links[0]).toBe('K-storage');
      expect(written.meta).toMatchObject({ agent: 'codex', session: sessionId, source: 'mcp' });

      const replacing = await t.call('edu_remember', { tier: 'transitive', kind: 'decision', title: 'Store sessions in SQLite', body: 'Session storage moves to SQLite.', supersedes: written.meta.id });
      expect(replacing.isError).toBe(false);
      expect((await t.brain.read(written.meta.id))?.meta.status).toBe('reverted');

      await t.call('edu_session_close', { id: sessionId, summary: 'Done.' });
      await t.call('edu_remember', { tier: 'transitive', kind: 'lesson', title: 'After the session', body: 'Written after the close.' });
      const after = (await t.brain.list({ kind: 'lesson' })).find(note => note.meta.title === 'After the session')!;
      expect(after.meta.session).toBeUndefined();
      expect(after.meta.agent).toBe('codex');
    } finally { await t.close(); }
  });

  it('says when secrets were redacted', async () => {
    const t = await connected('some-editor');
    try {
      const result = await t.call('edu_remember', { tier: 'transitive', kind: 'lesson', title: 'Deploy key', body: 'Use AKIAIOSFODNN7EXAMPLE for deploys.' });
      expect(result.text).toMatch(/Redacted secrets \(.+\)/);
      const note = (await t.brain.list({ kind: 'lesson' }))[0]!;
      expect(note.body).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(note.meta.agent).toBeUndefined();
    } finally { await t.close(); }
  });
});

describe('hash-guarded session close', () => {
  it('edu_read shows the hash; a stale expected_hash is refused with a clear message and the current hash', async () => {
    const t = await connected();
    try {
      const opened = await t.call('edu_session_open', { title: 'Guarded' });
      const id = /Session id: (\S+)/.exec(opened.text)![1]!;
      const read = await t.call('edu_read', { id });
      const hash = /^hash: ([0-9a-f]{12})$/m.exec(read.text)?.[1];
      expect(hash).toBe(contentHash((await t.brain.read(id))!));

      // Another writer changes the session after it was read.
      await t.brain.update(id, {}, 'Progress noted by another writer.');
      const now = (await t.brain.hashOf(id))!;
      const stale = await t.call('edu_session_close', { id, summary: 'Finished.', expected_hash: hash });
      expect(stale.isError).toBe(true);
      expect(stale.text).toBe(`Error: Note changed since you read it (now ${now}). Re-read with edu_read and retry.`);
      expect((await t.brain.read(id))?.meta.status).toBe('open-session');

      const staleLessons = await t.call('edu_session_close', { id, summary: 'Finished.', expected_hash: hash, lessons: [{ title: 'Guarded lesson', body: 'Body.' }] });
      expect(staleLessons.text).toContain(`now ${now}`);
      expect((await t.brain.list({ kind: 'lesson' }))).toEqual([]);

      const fresh = await t.call('edu_session_close', { id, summary: 'Finished.', expected_hash: now });
      expect(fresh.isError).toBe(false);
      expect((await t.brain.read(id))?.meta).toMatchObject({ status: 'closed', agent: 'claude-code' });
    } finally { await t.close(); }
  });
});
