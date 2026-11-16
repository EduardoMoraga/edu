import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchHeadless, workerEnv } from './headless.js';
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

describe('workerEnv', () => {
  it('gives a task worker only what its CLI and Node need, with EDU_HOME pinned to the brain', async () => {
    const root = await tempRoot();
    const env = workerEnv({ kind: 'task', cli: 'codex' }, root, { source, platform: 'linux' });
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/u', OPENAI_API_KEY: 'sk-openai', NODE_OPTIONS: '--max-old-space-size=4096', NODE_EXTRA_CA_CERTS: '/etc/ca.pem', EDU_HOME: root });
    for (const name of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'SSH_AUTH_SOCK']) expect(env[name]).toBeUndefined();
  });

  it('gives an orchestration worker the auth variables of every CLI it may start, and nothing else', async () => {
    const root = await tempRoot();
    const env = workerEnv({ kind: 'orchestration', cli: 'claude' }, root, { source, platform: 'linux' });
    expect(env).toMatchObject({ OPENAI_API_KEY: 'sk-openai', ANTHROPIC_API_KEY: 'sk-ant' });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('adds the global crew.env.passthrough of the job brain and keeps the crew-worker marker', async () => {
    const root = await tempRoot();
    await writeFile(join(root, 'config.json'), JSON.stringify({ crew: { env: { passthrough: ['GITHUB_TOKEN'] } } }));
    const env = workerEnv({ kind: 'task', cli: 'codex' }, root, { source: { ...source, EDU_CREW_JOB: 'parent-job' }, platform: 'linux' });
    expect(env.GITHUB_TOKEN).toBe('ghp-secret');
    expect(env.EDU_CREW_JOB).toBe('parent-job');
  });

  it('matches Node and Windows variable names case-insensitively on Windows', async () => {
    const root = await tempRoot();
    const env = workerEnv({ kind: 'task', cli: 'codex' }, root, { source: { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', node_options: '--trace-warnings', GITHUB_TOKEN: 'x' }, platform: 'win32' });
    expect(env).toMatchObject({ Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', node_options: '--trace-warnings', EDU_HOME: root });
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });
});

describe('dispatchHeadless', () => {
  it('starts the detached worker with the allowlisted environment', async () => {
    const root = await tempRoot();
    vi.stubEnv('GITHUB_TOKEN', 'ghp-secret');
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai');
    vi.stubEnv('NODE_OPTIONS', '');
    vi.stubEnv('NODE_EDU_TEST', 'kept');
    // Stands in for the Edu CLI: prints the environment it was started with into the job log.
    const entry = join(root, 'print-env.mjs');
    await writeFile(entry, 'process.stdout.write(JSON.stringify(process.env));\n');
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'codex', task: 'Print the environment', mode: 'headless', cwd: root, autonomy: 'readonly' });
    const started = await dispatchHeadless(job, { brainRoot: root, entry });
    expect(started.pid).toBeGreaterThan(0);
    const log = join(root, 'crew', `${job.id}.log`);
    const deadline = Date.now() + 10_000;
    let env: Record<string, string> | undefined;
    while (!env && Date.now() < deadline) {
      try { env = JSON.parse(await readFile(log, 'utf8')) as Record<string, string>; }
      catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    expect(env).toBeDefined();
    expect(env!.EDU_HOME).toBe(root);
    expect(env!.OPENAI_API_KEY).toBe('sk-openai');
    expect(env!.NODE_EDU_TEST).toBe('kept');
    expect(env!.GITHUB_TOKEN).toBeUndefined();
  });
});
