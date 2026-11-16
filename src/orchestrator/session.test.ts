import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { EduEvent, Engine } from '../core/contracts.js';
import { engineCapabilities } from '../engine/autonomy.js';
import { capRoleAutonomy, defaultConfig } from '../workspace/config.js';
import { NO_CLI_MESSAGE, runSession, type RunRequest } from './session.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const exists = (path: string) => access(path).then(() => true, () => false);

function scriptedEngine(): Engine {
  return { cli: 'claude', capabilities: engineCapabilities('claude'), available: async () => true, async *run(request, agentId) {
    const text = request.prompt.includes('Create a safe') ? JSON.stringify({ requirements: [], checks: [], steps: [] }) : '{"verdict":"pass","issues":[]}';
    yield { type: 'agent.text', agentId, text, at: new Date().toISOString() } satisfies EduEvent;
    yield { type: 'agent.end', agentId, ok: true, summary: text, at: new Date().toISOString() } satisfies EduEvent;
  } };
}

async function host() {
  const home = await mkdtemp(join(tmpdir(), 'edu-session-'));
  roots.push(home);
  const cwd = join(home, 'project');
  await mkdir(cwd);
  // The ceiling keeps brain discovery inside the sandbox.
  const env = { HOME: home, EDU_HOME: join(home, '.edu'), EDU_CEILING_DIRECTORIES: home };
  return { home, cwd, env };
}

const request = (cwd: string, extra: Partial<RunRequest> = {}): RunRequest => ({
  goal: 'Describe the project', cwd, lang: 'en', autoApprove: true, engines: () => scriptedEngine(),
  onEvent: () => {}, approve: async () => true, ...extra,
});

describe('runSession', () => {
  it('creates the workspace brain on first use and runs the goal against it', async () => {
    const { home, cwd, env } = await host();
    const result = await runSession({ available: ['claude'], env, home }, request(cwd));
    const brainRoot = join(home, '.edu');
    expect(await exists(join(brainRoot, 'EDU.md'))).toBe(true);
    expect(JSON.parse(await readFile(join(brainRoot, 'config.json'), 'utf8'))).toMatchObject({ defaultCli: 'claude' });
    expect(result.events[0]).toMatchObject({ type: 'run.start', goal: 'Describe the project' });
    expect(await exists(join(brainRoot, 'runs', `${result.runId}.jsonl`))).toBe(true);
  });

  it('refuses to run without an installed CLI or with a CLI that is not installed', async () => {
    const { home, cwd, env } = await host();
    await expect(runSession({ available: [], env, home }, request(cwd))).rejects.toThrow(NO_CLI_MESSAGE);
    await expect(runSession({ available: ['claude'], env, home }, request(cwd, { cli: 'codex' }))).rejects.toThrow('codex is not installed (found: claude)');
    expect(await exists(join(home, '.edu'))).toBe(false);
  });
});

describe('role autonomy ceiling', () => {
  /** Plans one builder step and records the autonomy each agent was started with. */
  function builderPlanEngine(seen: string[]): Engine {
    return { cli: 'claude', capabilities: engineCapabilities('claude'), available: async () => true, async *run(request, agentId) {
      seen.push(`${request.prompt.includes('Create a safe') ? 'lead' : request.prompt.startsWith('Review the completed') ? 'reviewer' : 'builder'}:${request.autonomy}`);
      const text = request.prompt.includes('Create a safe')
        ? JSON.stringify({ requirements: [], checks: [], steps: [{ id: 's1', role: 'builder', task: 'Change the file', dependsOn: [], parallelSafe: false }] })
        : request.prompt.startsWith('Review the completed') ? '{"verdict":"pass","issues":[]}' : 'Changed.';
      yield { type: 'agent.text', agentId, text, at: new Date().toISOString() } satisfies EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: text, at: new Date().toISOString() } satisfies EduEvent;
    } };
  }

  /** A project brain whose config asks for a `full` builder, as a cloned repository or an agent could write it. */
  async function projectAskingFull(globalCrew?: object) {
    const sandbox = await host();
    const projectBrain = join(sandbox.cwd, '.edu');
    await mkdir(projectBrain, { recursive: true });
    const config = defaultConfig('claude');
    await writeFile(join(projectBrain, 'config.json'), JSON.stringify({ ...config, roles: config.roles.map(role => role.id === 'builder' ? { ...role, autonomy: 'full' } : role) }));
    await mkdir(sandbox.env.EDU_HOME, { recursive: true });
    if (globalCrew) await writeFile(join(sandbox.env.EDU_HOME, 'config.json'), JSON.stringify({ crew: globalCrew }));
    return sandbox;
  }

  it('caps project roles at the global crew.maxAutonomy (default auto)', async () => {
    const { home, cwd, env } = await projectAskingFull();
    const seen: string[] = [];
    const result = await runSession({ available: ['claude'], env, home }, request(cwd, { engines: () => builderPlanEngine(seen) }));
    expect(seen).toContain('builder:auto');
    expect(seen).not.toContain('builder:full');
    const { limitations } = JSON.parse(await readFile(join(result.episodeDir!, 'task.json'), 'utf8')) as { limitations: string[] };
    expect(limitations).toContainEqual(expect.stringContaining('builder asked for full autonomy, above the crew ceiling "auto"'));
  });

  it('lets a project role run full once a person raises the global ceiling', async () => {
    const { home, cwd, env } = await projectAskingFull({ maxAutonomy: 'full' });
    const seen: string[] = [];
    await runSession({ available: ['claude'], env, home }, request(cwd, { engines: () => builderPlanEngine(seen) }));
    expect(seen).toContain('builder:full');
  });

  it('never takes the ceiling from the project config', async () => {
    const { home, cwd, env } = await projectAskingFull();
    const projectConfig = join(cwd, '.edu', 'config.json');
    await writeFile(projectConfig, JSON.stringify({ ...JSON.parse(await readFile(projectConfig, 'utf8')), crew: { maxAutonomy: 'full' } }));
    const seen: string[] = [];
    await runSession({ available: ['claude'], env, home }, request(cwd, { engines: () => builderPlanEngine(seen) }));
    expect(seen).toContain('builder:auto');
  });

  it('lowers only the roles above the ceiling', () => {
    const config = defaultConfig('claude');
    const full = { ...config, roles: config.roles.map(role => role.id === 'builder' ? { ...role, autonomy: 'full' as const } : role) };
    const { config: capped, lowered } = capRoleAutonomy(full, 'ask');
    expect(lowered).toEqual([{ id: 'builder', requested: 'full' }]);
    expect(capped.roles.map(role => role.autonomy)).toEqual(['readonly', 'readonly', 'ask', 'readonly']);
    expect(capRoleAutonomy(config, 'full').config).toBe(config);
  });
});

describe('layering', () => {
  it('keeps the crew and the orchestrator independent of the CLI', async () => {
    const src = fileURLToPath(new URL('..', import.meta.url));
    const offenders: string[] = [];
    for (const area of ['crew', 'orchestrator']) {
      for (const file of await readdir(join(src, area), { recursive: true })) {
        if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
        const text = await readFile(join(src, area, file), 'utf8');
        if (/(?:from\s+|import\()\s*['"](?:\.\.\/)+cli\//.test(text)) offenders.push(`${area}/${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
