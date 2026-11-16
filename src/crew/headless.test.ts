import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { childEnv } from '../platform/child-env.js';
import { decodeWorkerPolicy } from '../workspace/config.js';
import { dispatchHeadless, jobDigest, workerEnv } from './headless.js';
import { createCrewStore } from './store.js';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'edu-headless-'));
  roots.push(root);
  return root;
}

const source = {
  PATH: '/usr/bin', HOME: '/home/u', LANG: 'en_US.UTF-8',
  OPENAI_API_KEY: 'sk-openai', ANTHROPIC_API_KEY: 'sk-ant', GITHUB_TOKEN: 'ghp-secret', AWS_SECRET_ACCESS_KEY: 'aws-secret', SSH_AUTH_SOCK: '/tmp/agent.sock',
  NODE_OPTIONS: '--max-old-space-size=4096', NODE_EXTRA_CA_CERTS: '/etc/ca.pem', EDU_HOME: '/elsewhere',
};
const policy = { maxAutonomy: 'auto' as const, passthrough: [], approvals: 'ask-on-write' as const };

describe('workerEnv', () => {
  it('gives a task worker only what its CLI and Node need; EDU_HOME stays the global home and the brain has its own variable', async () => {
    const root = await tempRoot();
    const env = workerEnv({ kind: 'task', cli: 'codex' }, root, { source, platform: 'linux' });
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/u', OPENAI_API_KEY: 'sk-openai', NODE_OPTIONS: '--max-old-space-size=4096', NODE_EXTRA_CA_CERTS: '/etc/ca.pem', EDU_HOME: '/elsewhere', EDU_CREW_BRAIN: root });
    for (const name of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'SSH_AUTH_SOCK']) expect(env[name]).toBeUndefined();
    // The dispatcher's resolved global home wins over whatever its own environment said.
    expect(workerEnv({ kind: 'task', cli: 'codex' }, root, { source, platform: 'linux', globalRoot: '/home/u/.edu' }).EDU_HOME).toBe('/home/u/.edu');
  });

  it('gives an orchestration worker the auth variables of every CLI it may start, and nothing else', async () => {
    const root = await tempRoot();
    const env = workerEnv({ kind: 'orchestration', cli: 'claude' }, root, { source, platform: 'linux' });
    expect(env).toMatchObject({ OPENAI_API_KEY: 'sk-openai', ANTHROPIC_API_KEY: 'sk-ant' });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('never takes crew.env.passthrough from a config planted in the job brain: only from the policy the parent resolved', async () => {
    const root = await tempRoot();
    // A cloned repository (or a worker) plants a passthrough in the project brain.
    await writeFile(join(root, 'config.json'), JSON.stringify({ crew: { env: { passthrough: ['GITHUB_TOKEN'] } } }));
    const planted = workerEnv({ kind: 'task', cli: 'codex' }, root, { source: { ...source, EDU_CREW_JOB: 'parent-job' }, platform: 'linux', policy });
    expect(planted.GITHUB_TOKEN).toBeUndefined();
    expect(planted.EDU_CREW_JOB).toBe('parent-job');
    // Inside the worker, an agent CLI's environment follows the handed-down policy even if EDU_HOME points at the plant.
    expect(childEnv('codex', {}, { source: { ...planted, EDU_HOME: root, GITHUB_TOKEN: 'ghp-secret' }, platform: 'linux' }).GITHUB_TOKEN).toBeUndefined();
    const granted = workerEnv({ kind: 'task', cli: 'codex' }, root, { source, platform: 'linux', policy: { ...policy, passthrough: ['GITHUB_TOKEN'] } });
    expect(granted.GITHUB_TOKEN).toBe('ghp-secret');
    expect(childEnv('codex', {}, { source: { ...granted, GITHUB_TOKEN: 'ghp-secret' }, platform: 'linux' }).GITHUB_TOKEN).toBe('ghp-secret');
    expect(decodeWorkerPolicy(granted.EDU_CREW_POLICY)).toEqual({ ...policy, passthrough: ['GITHUB_TOKEN'] });
  });

  it('matches Node and Windows variable names case-insensitively on Windows', async () => {
    const root = await tempRoot();
    const env = workerEnv({ kind: 'task', cli: 'codex' }, root, { source: { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', node_options: '--trace-warnings', GITHUB_TOKEN: 'x', edu_crew_brain: 'C:\\planted', Edu_Crew_Policy: '{}', Edu_Home: 'C:\\planted' }, platform: 'win32', globalRoot: 'C:\\Users\\u\\.edu' });
    expect(env).toMatchObject({ Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', node_options: '--trace-warnings', EDU_CREW_BRAIN: root, EDU_HOME: 'C:\\Users\\u\\.edu' });
    expect(Object.keys(env).filter(name => ['EDU_CREW_BRAIN', 'EDU_CREW_POLICY', 'EDU_HOME'].includes(name.toUpperCase()))).toEqual(['EDU_CREW_BRAIN', 'EDU_CREW_POLICY', 'EDU_HOME']);
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });
});

describe('dispatchHeadless', () => {
  it('starts the detached worker with the allowlisted environment, the global home and the policy for this job', async () => {
    const root = await tempRoot();
    const globalRoot = join(root, 'home', '.edu');
    const brainRoot = join(root, 'work', '.edu');
    await mkdir(globalRoot, { recursive: true });
    await mkdir(brainRoot, { recursive: true });
    await writeFile(join(brainRoot, 'config.json'), JSON.stringify({ crew: { maxAutonomy: 'full', env: { passthrough: ['GITHUB_TOKEN'] } } }));
    vi.stubEnv('EDU_HOME', globalRoot);
    vi.stubEnv('GITHUB_TOKEN', 'ghp-secret');
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai');
    vi.stubEnv('NODE_OPTIONS', '');
    vi.stubEnv('NODE_EDU_TEST', 'kept');
    // Stands in for the Edu CLI: prints the environment it was started with into the job log.
    const entry = join(root, 'print-env.mjs');
    await writeFile(entry, 'process.stdout.write(JSON.stringify(process.env));\n');
    const store = createCrewStore(brainRoot, { globalRoot });
    const job = await store.create({ cli: 'codex', task: 'Print the environment', mode: 'headless', cwd: root, autonomy: 'readonly' });
    const started = await dispatchHeadless(job, { brainRoot, globalRoot, entry });
    expect(started.pid).toBeGreaterThan(0);
    const log = join(brainRoot, 'crew', `${job.id}.log`);
    const deadline = Date.now() + 10_000;
    let env: Record<string, string> | undefined;
    while (!env && Date.now() < deadline) {
      try { env = JSON.parse(await readFile(log, 'utf8')) as Record<string, string>; }
      catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    expect(env).toBeDefined();
    expect(env!.EDU_HOME).toBe(globalRoot);
    expect(env!.EDU_CREW_BRAIN).toBe(brainRoot);
    expect(decodeWorkerPolicy(env!.EDU_CREW_POLICY)).toEqual({ ...policy, job: jobDigest(job) });
    expect(env!.OPENAI_API_KEY).toBe('sk-openai');
    expect(env!.NODE_EDU_TEST).toBe('kept');
    expect(env!.GITHUB_TOKEN).toBeUndefined();
  });
});
