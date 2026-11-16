import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import type { BrainLocation } from '../core/contracts.js';
import { createCrewStore } from '../crew/store.js';
import { createEduMcpServer, MAX_RESULT_WAIT_SECONDS, type EduMcpOptions } from './server.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

/** A workspace with a project brain (`<base>/work/.edu`) and its own global brain (`<base>/home/.edu`). */
async function workspace() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'edu-mcp-trust-')));
  roots.push(base);
  const cwd = join(base, 'work');
  const project: BrainLocation = { scope: 'project', root: join(cwd, '.edu') };
  const global: BrainLocation = { scope: 'global', root: join(base, 'home', '.edu') };
  for (const location of [project, global]) { await mkdir(location.root, { recursive: true }); await openBrain([location]).init(location); }
  const env = { HOME: join(base, 'home'), EDU_HOME: global.root };
  return { base, cwd, project, global, env };
}

async function connect(options: EduMcpOptions) {
  const server = createEduMcpServer(options);
  const client = new Client({ name: 'trust-test', version: '1.0.0' }, { capabilities: { roots: { listChanged: true } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: result.isError === true, text: (result.content as Array<{ text?: string }>).map(item => item.text ?? '').join('') };
  };
  return { call, client, close: async () => { await client.close(); await server.close(); } };
}

describe('MCP trust boundaries', () => {
  it('closes only sessions this server opened or that live in its own brain, and never lists ids', async () => {
    const w = await workspace();
    // Another scope's session (the global brain) and another source's session in this brain.
    const foreign = await openBrain([w.global]).openSession('Global work', 'hermes');
    const local = await openBrain([w.project]).openSession('Local work', 'pi');
    const mcp = await connect({ locations: [w.project, w.global], env: w.env });
    try {
      const refused = await mcp.call('edu_session_close', { id: foreign.meta.id, summary: 'Hijacked.' });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('Session not found');
      expect(refused.text).not.toContain(local.meta.id);
      expect((await openBrain([w.global]).read(foreign.meta.id))?.meta.status).toBe('open-session');
      const unknown = await mcp.call('edu_session_close', { id: 'wrong', summary: 'Done.' });
      expect(unknown.text).not.toContain(local.meta.id);
      expect(unknown.text).not.toMatch(/Open session ids/);
      // A session in this server's own brain may be closed even though another host opened it.
      expect((await mcp.call('edu_session_close', { id: local.meta.id, summary: 'Done.' })).isError).toBe(false);
      // One this server opened may be closed wherever it lives.
      const opened = await mcp.call('edu_session_open', { title: 'Mine' });
      const id = /Session id: (\S+)/.exec(opened.text)![1]!;
      expect((await mcp.call('edu_session_close', { id, summary: 'Done.' })).isError).toBe(false);
    } finally { await mcp.close(); }
  });

  it('never adopts another brain\'s open session with the same source and title', async () => {
    const w = await workspace();
    // Server A, on the global brain, opened "Shared"; server B works in the project.
    const foreign = await openBrain([w.global]).openSession('Shared', 'mcp');
    const mcp = await connect({ locations: [w.project, w.global], env: w.env });
    try {
      const opened = await mcp.call('edu_session_open', { title: 'Shared' });
      const id = /Session id: (\S+)/.exec(opened.text)![1]!;
      expect(id).not.toBe(foreign.meta.id);
      expect(opened.text).toContain('Opened');
      expect((await mcp.call('edu_session_close', { id, summary: 'Done.' })).isError).toBe(false);
      expect((await openBrain([w.global]).read(foreign.meta.id))?.meta.status).toBe('open-session');
      // Its own brain's session is still reused.
      const again = await mcp.call('edu_session_open', { title: 'Local' });
      const reused = await mcp.call('edu_session_open', { title: 'Local' });
      expect(/Session id: (\S+)/.exec(reused.text)![1]).toBe(/Session id: (\S+)/.exec(again.text)![1]);
    } finally { await mcp.close(); }
  });

  it('shows brain and workspace paths relative to them in errors', async () => {
    const w = await workspace();
    // A file where the crew folder should be: the filesystem error names the absolute path.
    await writeFile(join(w.project.root, 'crew'), 'not a folder');
    const mcp = await connect({ locations: [w.project, w.global], env: w.env, crewOptions: { brainRoot: w.project.root, workspaceRoot: w.cwd } });
    try {
      const failed = await mcp.call('edu_crew_status');
      expect(failed.isError).toBe(true);
      expect(failed.text).toContain('.edu/crew');
      expect(failed.text).not.toContain(w.base);
    } finally { await mcp.close(); }
  });

  it('caps the edu_crew_result wait', async () => {
    const w = await workspace();
    const store = createCrewStore(w.project.root);
    const job = await store.create({ cli: 'codex', task: 'work', mode: 'headless', cwd: w.cwd, autonomy: 'ask' });
    const mcp = await connect({ locations: [w.project], env: w.env, crewOptions: { brainRoot: w.project.root, store } });
    try {
      const forever = await mcp.call('edu_crew_result', { jobId: job.id, waitSeconds: 1e9 });
      expect(forever.isError).toBe(true);
      expect(forever.text).toContain(String(MAX_RESULT_WAIT_SECONDS));
      expect((await mcp.call('edu_crew_result', { jobId: job.id, waitSeconds: 0 })).isError).toBe(false);
    } finally { await mcp.close(); }
  });

  it('refuses autonomy full over MCP until a person raises crew.maxAutonomy in the global config', async () => {
    const w = await workspace();
    const started: string[] = [];
    const crewOptions = { brainRoot: w.project.root, workspaceRoot: w.cwd, startHeadless: async (job: { id: string; autonomy: string }) => { started.push(job.autonomy); return job as never; } };
    // A project config inside the workspace cannot raise it.
    await writeFile(join(w.project.root, 'config.json'), JSON.stringify({ crew: { maxAutonomy: 'full' } }));
    const mcp = await connect({ locations: [w.project, w.global], env: w.env, crewOptions });
    try {
      const refused = await mcp.call('edu_crew_dispatch', { cli: 'codex', task: 'Delete everything', autonomy: 'full' });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('crew.maxAutonomy');
      expect((await mcp.call('edu_crew_dispatch', { cli: 'codex', task: 'Fix the test', autonomy: 'auto' })).isError).toBe(false);
      // An invalid crew section fails closed to the default ceiling.
      await writeFile(join(w.global.root, 'config.json'), JSON.stringify({ crew: { maxAutonomy: 'root', extra: true } }));
      expect((await mcp.call('edu_crew_dispatch', { cli: 'codex', task: 'Delete everything', autonomy: 'full' })).isError).toBe(true);
      await writeFile(join(w.global.root, 'config.json'), JSON.stringify({ crew: { maxAutonomy: 'full' } }));
      expect((await mcp.call('edu_crew_dispatch', { cli: 'codex', task: 'Fix the test', autonomy: 'full' })).isError).toBe(false);
      expect(started).toEqual(['auto', 'full']);
    } finally { await mcp.close(); }
  });

  it('asks the client for its roots again when they were not ready, and on roots/list_changed', async () => {
    const w = await workspace();
    let calls = 0;
    const answers: Array<BrainLocation[] | Error> = [new Error('no roots yet'), [w.project, w.global], [w.global]];
    const mcp = await connect({
      locations: [w.global], env: w.env,
      resolveLocations: async () => {
        const answer = answers[Math.min(calls++, answers.length - 1)]!;
        if (answer instanceof Error) throw answer;
        return answer;
      },
    });
    try {
      expect((await mcp.call('edu_projects')).text).toContain('Active: global');
      expect((await mcp.call('edu_projects')).text).toContain(`Active: ${w.cwd}`);
      expect(calls).toBe(2);
      await mcp.call('edu_projects');
      expect(calls).toBe(2); // bound: no more roots/list round trips
      await mcp.client.sendRootsListChanged();
      await expect.poll(async () => (await mcp.call('edu_projects')).text).toContain('Active: global');
      expect(calls).toBe(3);
    } finally { await mcp.close(); }
  });

  it('keeps a worker read-only: it cannot approve, switch workspaces or dispatch', async () => {
    const w = await workspace();
    const mcp = await connect({ locations: [w.project], env: { ...w.env, EDU_CREW_JOB: 'job-1' } });
    try {
      for (const [name, args] of [
        ['edu_crew_approve', { jobId: 'abcd1234', requestId: 'r', approve: true }],
        ['edu_project_use', { workspace: 'global' }],
        ['edu_crew_dispatch', { cli: 'codex', task: 'x' }],
      ] as const) {
        const result = await mcp.call(name, args);
        expect(result.isError, name).toBe(true);
        expect(result.text).toContain('Edu worker cannot call');
      }
    } finally { await mcp.close(); }
  });
});
