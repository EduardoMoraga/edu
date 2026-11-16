import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { registerProject } from '../brain/registry.js';
import { listWorkspaces, selectWorkspace } from './projects.js';
import { TOOL_ANNOTATIONS } from './server.js';
import { createStdioServer } from './stdio.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

/** A temp HOME with an EDU_HOME registry holding two workspaces: albert (agent Albert) and notes (agent Edu). */
async function registry() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'edu-projects-')));
  roots.push(base);
  const eduHome = join(base, '.edu');
  const env = { HOME: base, EDU_HOME: eduHome };
  for (const [name, agent] of [['albert-ops', 'Albert'], ['notes', undefined]] as const) {
    const root = join(base, name);
    await mkdir(join(root, '.edu'), { recursive: true });
    if (agent) await writeFile(join(root, '.edu', 'config.json'), JSON.stringify({ identity: { name: agent } }));
    await openBrain([{ scope: 'project', root: join(root, '.edu') }]).init({ scope: 'project', root: join(root, '.edu') });
    await registerProject(eduHome, root);
  }
  await openBrain([{ scope: 'global', root: eduHome }]).init({ scope: 'global', root: eduHome });
  return { base, eduHome, env };
}

async function connect(server: Awaited<ReturnType<typeof createStdioServer>>) {
  const client = new Client({ name: 'hermes-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: result.isError === true, text: (result.content as Array<{ type: string; text?: string }>).map(item => item.text ?? '').join('') };
  };
  return { client, call };
}

describe('workspace selection', () => {
  it('lists workspaces with agent names and resolves registry names, agent names, paths and global', async () => {
    const r = await registry();
    expect(await listWorkspaces(r.env)).toEqual([
      { name: 'albert-ops', agent: 'Albert', root: join(r.base, 'albert-ops'), present: true },
      { name: 'notes', agent: 'Edu', root: join(r.base, 'notes'), present: true },
    ]);
    expect((await selectWorkspace('ALBERT', r.env)).locations[0]).toMatchObject({ scope: 'project', root: join(r.base, 'albert-ops', '.edu') });
    expect((await selectWorkspace('notes', r.env)).root).toBe(join(r.base, 'notes'));
    expect((await selectWorkspace(join(r.base, 'notes'), r.env)).label).toBe(join(r.base, 'notes'));
    expect((await selectWorkspace('global', r.env)).locations).toEqual([{ scope: 'global', root: r.eduHome }]);
    await expect(selectWorkspace('bob', r.env)).rejects.toThrow('Unknown workspace "bob". Registered: albert-ops (Albert), notes (Edu)');
  });

  it('selects HOME as one global brain; only a launch-time selection creates a brain for an uninitialized folder', async () => {
    const r = await registry();
    expect((await selectWorkspace(r.base, r.env)).locations).toEqual([{ scope: 'global', root: r.eduHome }]);
    const child = join(r.base, 'new-project'); await mkdir(child);
    await expect(selectWorkspace(child, r.env)).rejects.toThrow('Not an Edu workspace');
    await expect(access(join(child, '.edu'))).rejects.toThrow();
    const selected = await selectWorkspace(child, r.env, undefined, { create: true });
    expect(selected.locations).toEqual([
      { scope: 'project', root: join(child, '.edu') }, { scope: 'global', root: r.eduHome },
    ]);
  });

  it('refuses an agent name shared by several workspaces', async () => {
    const r = await registry();
    await writeFile(join(r.base, 'notes', '.edu', 'config.json'), JSON.stringify({ identity: { name: 'Albert' } }));
    await expect(selectWorkspace('albert', r.env)).rejects.toThrow('agent of several workspaces');
  });
});

describe('edu mcp --project and the project tools', () => {
  it('pins the workspace from --project or EDU_PROJECT and switches with edu_project_use', async () => {
    const r = await registry();
    const albert = openBrain([{ scope: 'project', root: join(r.base, 'albert-ops', '.edu') }]);
    await albert.write({ tier: 'transitive', kind: 'decision', title: 'Visit stores on Mondays', body: 'Decided with the team.', source: 'test' });

    const pinned = await connect(await createStdioServer({ cwd: r.base, env: { ...r.env, EDU_PROJECT: 'albert' } }));
    const names = (await pinned.client.listTools()).tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(['edu_projects', 'edu_project_use', 'edu_recall']));
    const listed = await pinned.call('edu_projects');
    expect(listed.text).toContain(`Active: ${join(r.base, 'albert-ops')}`);
    expect(listed.text).toContain('* albert-ops · agent Albert');
    expect((await pinned.call('edu_recall', { query: 'Mondays' })).text).toContain('Visit stores on Mondays');

    const switched = await pinned.call('edu_project_use', { workspace: 'notes' });
    expect(switched).toEqual({ isError: false, text: `Active workspace: notes (agent Edu) · brain ${join(r.base, 'notes', '.edu')}` });
    expect((await pinned.call('edu_recall', { query: 'Mondays' })).text).toBe('No matching notes.');
    expect((await pinned.call('edu_project_use', { workspace: 'nobody' })).isError).toBe(true);

    // --project wins over EDU_PROJECT.
    const flag = await connect(await createStdioServer({ cwd: r.base, project: 'notes', env: { ...r.env, EDU_PROJECT: 'albert' } }));
    expect((await flag.call('edu_projects')).text).toContain('* notes · agent Edu');
  });

  it('serves the global brain when no project is selected and the launch folder has none', async () => {
    const r = await registry();
    const outside = join(r.base, 'elsewhere');
    await mkdir(outside);
    const server = await connect(await createStdioServer({ cwd: outside, env: r.env }));
    expect((await server.call('edu_projects')).text).toContain('Active: global');
  });

  it('annotates the project tools: listing is a read, switching replaces the session workspace so hosts ask', () => {
    expect(TOOL_ANNOTATIONS.edu_projects).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(TOOL_ANNOTATIONS.edu_project_use).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
  });

  it('edu_project_use switches only to registered workspaces or folders that already hold a brain, and never creates one', async () => {
    const r = await registry();
    const server = await connect(await createStdioServer({ cwd: r.base, env: { ...r.env, EDU_PROJECT: 'albert' } }));
    const stranger = join(r.base, 'stranger'); await mkdir(stranger);
    const refused = await server.call('edu_project_use', { workspace: stranger });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Not an Edu workspace');
    await expect(access(join(stranger, '.edu'))).rejects.toThrow();
    expect((await server.call('edu_projects')).text).toContain('* albert-ops');
    // An unregistered folder that already has a brain is allowed, read as it is.
    const existing = join(r.base, 'existing'); await mkdir(join(existing, '.edu'), { recursive: true });
    expect((await server.call('edu_project_use', { workspace: existing })).text).toContain(`brain ${join(existing, '.edu')}`);
    await expect(access(join(existing, '.edu', 'EDU.md'))).rejects.toThrow();
  });
});
