import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContextPack, EduEvent, Engine, EngineRunRequest } from '../core/contracts.js';
import { FakeEngine } from '../engine/fake.js';
import { defaultConfig, loadConfig, saveConfig } from './config.js';
import { assignCli } from './assign.js';
import { extractPlan, PlanSchema } from './plan.js';
import { orchestrate } from './run.js';

const pack: ContextPack = { text: 'brief', tokens: 1, budgetTokens: 100, sections: [], deferred: [] };
const context = { build: async () => pack };
const at = '2026-01-01T00:00:00.000Z';
const engine = (_cli: Engine['cli'], texts: string[]) => new FakeEngine([
  ...texts.map(text => ({ type: 'agent.text', agentId: 'fake', text, at } as EduEvent)),
  { type: 'agent.end', agentId: 'fake', ok: true, summary: 'done', at },
]);

describe('orchestrator contracts', () => {
  it('validates and round-trips config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-config-'));
    try {
      const path = join(dir, 'config.json');
      const config = defaultConfig('codex');
      await saveConfig(path, config);
      expect(await loadConfig(path)).toEqual(config);
      await expect(readdir(dir)).resolves.toEqual(['config.json']);
      await expect(saveConfig(path, { ...config, mode: 'invalid' } as never)).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('assigns solo uniformly and gives reviewer a different vendor when possible', () => {
    const config = defaultConfig('codex');
    expect(assignCli('builder', config, ['claude', 'codex'])).toBe('codex');
    expect(assignCli('reviewer', { ...config, mode: 'crew', roles: config.roles.map(r => r.id === 'builder' ? { ...r, cli: 'claude' as const } : r) }, ['claude', 'codex'])).toBe('codex');
  });

  it('honors an available configured reviewer CLI unless it matches the builder', () => {
    const config = defaultConfig('claude');
    const crew = { ...config, mode: 'crew' as const, roles: config.roles.map(role => role.id === 'builder' ? { ...role, cli: 'codex' as const } : role.id === 'reviewer' ? { ...role, cli: 'pi' as const } : role) };
    expect(assignCli('reviewer', crew, ['claude', 'codex', 'pi'])).toBe('pi');
    const sameVendor = { ...crew, roles: crew.roles.map(role => role.id === 'reviewer' ? { ...role, cli: 'codex' as const } : role) };
    expect(assignCli('reviewer', sameVendor, ['claude', 'codex', 'pi'])).toBe('claude');
  });

  it('uses the builder fallback CLI when enforcing reviewer vendor diversity', () => {
    const config = defaultConfig('claude');
    const crew = { ...config, mode: 'crew' as const, roles: config.roles.map(role => role.id === 'builder' ? { ...role, cli: 'agy' as const } : role.id === 'reviewer' ? { ...role, cli: 'codex' as const } : role) };
    expect(assignCli('reviewer', crew, ['codex', 'pi'])).toBe('pi');
  });

  it('passes configured role models through to engine requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-role-model-'));
    const config = { ...defaultConfig('claude'), roles: defaultConfig('claude').roles.map(role => role.id === 'lead' ? { ...role, model: 'lead-model' } : role) };
    const requests: EngineRunRequest[] = [];
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      requests.push(request);
      yield { type: 'agent.text', agentId, text: request.prompt.includes('Create a safe') ? '{"steps":[]}' : '{"verdict":"pass","issues":[]}', at };
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at };
    } };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      const result = await orchestrate('goal', { config, brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: () => {}, approve: async () => true });
      expect(result.ok).toBe(true);
      expect(requests[0]?.model).toBe('lead-model');
      expect(await readFile(join(dir, 'reflect-queue', `${result.runId}.json`), 'utf8')).toContain('sessionId');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('extracts fenced or bare valid JSON and rejects invalid plans', () => {
    const raw = 'Plan follows:\n```json\n{"steps":[]}\n```';
    expect(extractPlan(raw)).toEqual({ steps: [], requirements: [], checks: [] });
    expect(() => extractPlan('{"steps":[{"id":"x"}]}')).toThrow();
    expect(PlanSchema.safeParse({ steps: [] }).success).toBe(true);
  });

  it('accepts requirements and checks while preserving old plan responses', () => {
    const plan = extractPlan(JSON.stringify({ steps: [], requirements: [{ id: 'r1', text: 'returns a value' }], checks: [{ id: 'check', requirementIds: ['r1'], command: 'true', expect: {}, timeoutMs: 500 }] }));
    expect(plan.requirements).toEqual([{ id: 'r1', text: 'returns a value' }]);
    expect(plan.checks).toHaveLength(1);
    expect(extractPlan('{"steps":[]}')).toMatchObject({ requirements: [], checks: [] });
  });

  it('executes DAG dependencies, records events, and stops a rejected write approval', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-run-'));
    const events: EduEvent[] = [];
    const plan = { steps: [
      { id: 'read', role: 'explorer', task: 'inspect', dependsOn: [], parallelSafe: true },
      { id: 'write', role: 'builder', task: 'change', dependsOn: ['read'], parallelSafe: false },
    ] };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    const engines = (cli: Engine['cli']) => engine(cli, cli === 'claude' ? [JSON.stringify(plan)] : ['ok']);
    try {
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => events.push(event), approve: async () => false, now: () => new Date(at) });
      expect(result.ok).toBe(false);
      expect(events.some(event => event.type === 'approval.request')).toBe(true);
      expect(events.some(event => event.type === 'approval.resolve' && !event.approved)).toBe(true);
      expect(events.some(event => event.type === 'agent.spawn' && event.role === 'builder')).toBe(false);
      const persisted = (await readFile(join(dir, 'runs', `${result.runId}.jsonl`), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(persisted).toHaveLength(events.length);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('repairs invalid plan JSON once then returns a clear failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-repair-'));
    const prompts: string[] = [];
    const scripts = [engine('claude', ['not json']), engine('claude', ['still not json'])];
    let count = 0;
    const recording: Engine = { cli: 'claude', available: async () => true, async *run(req, id) { prompts.push(req.prompt); yield* scripts[Math.min(count++, 1)]!.run(req, id); } };
    const brain = { openSession: async () => ({ meta: { id: 's' } }), closeSession: async () => undefined } as never;
    try {
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => recording, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: () => {}, approve: async () => true });
      expect(result.ok).toBe(false);
      expect(prompts).toHaveLength(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('runs independent readonly DAG nodes concurrently and waits for dependencies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-dag-'));
    const plan = { steps: [
      { id: 'a', role: 'explorer', task: 'A', dependsOn: [], parallelSafe: true },
      { id: 'b', role: 'explorer', task: 'B', dependsOn: [], parallelSafe: true },
      { id: 'c', role: 'builder', task: 'C', dependsOn: ['a', 'b'], parallelSafe: false },
    ] };
    let active = 0; let maximum = 0;
    const done = new Set<string>();
    const observed: EduEvent[] = [];
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      const text = request.prompt.includes('Create a safe') ? JSON.stringify(plan) : request.prompt.includes('Review the completed') ? '{"verdict":"pass","issues":[]}' : 'done';
      if (request.prompt.startsWith('A') || request.prompt.startsWith('B')) { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 20)); done.add(request.prompt[0]!); active--; }
      yield { type: 'agent.text', agentId, text, at } as EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at } as EduEvent;
    } };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => observed.push(event), approve: async () => true });
      expect(result.ok, result.summary).toBe(true);
      expect(maximum).toBe(2);
      const builderStart = observed.findIndex(event => event.type === 'agent.spawn' && event.role === 'builder');
      const ends = observed.filter(event => event.type === 'agent.end' && ['a', 'b'].some(id => event.agentId.endsWith(`-${id}`)));
      expect(ends).toHaveLength(2);
      const timeline = observed.map(event => event.type === 'agent.spawn' ? `${event.role}:${event.task.slice(0, 4)}` : event.type === 'agent.end' ? `end:${event.agentId.slice(-4)}` : event.type);
      expect(ends.every(event => observed.indexOf(event) < builderStart), timeline.join(', ')).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('cancels and settles parallel siblings before emitting the terminal run event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-parallel-failure-'));
    const plan = { steps: [
      { id: 'fail', role: 'explorer', task: 'fail step', dependsOn: [], parallelSafe: true },
      { id: 'wait', role: 'explorer', task: 'wait step', dependsOn: [], parallelSafe: true },
    ] };
    const observed: EduEvent[] = [];
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      if (request.prompt.startsWith('Create a safe')) { yield { type: 'agent.text', agentId, text: JSON.stringify(plan), at } as EduEvent; return; }
      if (request.prompt.startsWith('fail step')) { yield { type: 'error', agentId, message: 'expected failure', at } as EduEvent; return; }
      await new Promise<void>(resolve => request.signal?.addEventListener('abort', () => resolve(), { once: true }));
      yield { type: 'agent.text', agentId, text: 'settled after cancellation', at } as EduEvent;
    } };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => observed.push(event), approve: async () => true });
      expect(result.ok).toBe(false);
      expect(observed).toContainEqual(expect.objectContaining({ type: 'agent.status', status: 'cancelled' }));
      expect(observed.at(-1)?.type).toBe('run.end');
      expect(observed.slice(0, -1).every(event => event.type !== 'run.end')).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('does not await a blocked composer iterator during terminal teardown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-blocked-composer-'));
    let releaseComposer!: () => void;
    const composerMessages = (async function* () {
      await new Promise<void>(resolve => { releaseComposer = resolve; });
      yield 'late message';
    })();
    const plan = { steps: [] };
    const observed: EduEvent[] = [];
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      const text = request.prompt.startsWith('Create a safe') ? JSON.stringify(plan) : '{"verdict":"pass","issues":[]}';
      yield { type: 'agent.text', agentId, text, at } as EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at } as EduEvent;
    } };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    let running: ReturnType<typeof orchestrate> | undefined;
    try {
      running = orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => observed.push(event), approve: async () => true, harnessLevel: 'H0', composerMessages });
      const completedPromptly = await Promise.race([running.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1_000))]);
      expect(completedPromptly).toBe(true);
      releaseComposer();
      await running;
      const runEndIndex = observed.findIndex(event => event.type === 'run.end');
      expect(observed.slice(runEndIndex + 1)).toEqual([]);
    } finally {
      releaseComposer?.();
      await running?.catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('allows at most one builder fix round after reviewer requests changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-fix-'));
    const plan = { steps: [{ id: 'build', role: 'builder', task: 'Build', dependsOn: [], parallelSafe: false }] };
    let fixes = 0; let reviews = 0;
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      let text = 'done';
      if (request.prompt.includes('Create a safe')) text = JSON.stringify(plan);
      else if (request.prompt.includes('Review the completed')) { reviews++; text = '{"verdict":"fix","issues":["Add a check"]}'; }
      else if (request.prompt.includes('Address these review issues')) fixes++;
      yield { type: 'agent.text', agentId, text, at } as EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at } as EduEvent;
    } };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: () => {}, approve: async () => true });
      expect(result.ok, result.summary).toBe(true);
      expect(reviews).toBe(1);
      expect(fixes).toBe(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('keeps H0 prompts task-only and skips context and registry exposure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-h0-'));
    const requests: EngineRunRequest[] = [];
    let contextBuilds = 0;
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      requests.push(request);
      const text = request.prompt.includes('Create a safe') ? '{"steps":[]}' : '{"verdict":"pass","issues":[]}';
      yield { type: 'agent.text', agentId, text, at } as EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at } as EduEvent;
    } };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      await orchestrate('task only goal', { config: defaultConfig('claude'), brain, context: { build: async () => { contextBuilds++; return pack; } }, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: () => {}, approve: async () => true, harnessLevel: 'H0' });
      expect(contextBuilds).toBe(0);
      expect(requests.every(request => !request.prompt.includes('brief'))).toBe(true);
      expect(requests[0]?.prompt).toContain('task only goal');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('gates registry and brain/task-state exposure at H1 and H2', async () => {
    for (const level of ['H1', 'H2'] as const) {
      const dir = await mkdtemp(join(tmpdir(), `edu-${level.toLowerCase()}-`));
      const requests: EngineRunRequest[] = [];
      let contextBuilds = 0;
      const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
        requests.push(request);
        const text = request.prompt.includes('Create a safe') ? '{"steps":[]}' : '{"verdict":"pass","issues":[]}';
        yield { type: 'agent.text', agentId, text, at } as EduEvent;
        yield { type: 'agent.end', agentId, ok: true, summary: 'done', at } as EduEvent;
      } };
      const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
      try {
        if (level === 'H1') {
          await mkdir(join(dir, '.edu', 'harness'), { recursive: true });
          await writeFile(join(dir, '.edu', 'harness', 'tools.json'), JSON.stringify([{ id: 'local-tool', command: 'echo tool' }]));
        }
        const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context: { build: async () => { contextBuilds++; return pack; } }, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: () => {}, approve: async () => true, harnessLevel: level });
        expect(result.ok).toBe(true);
        expect(contextBuilds).toBe(level === 'H2' ? 1 : 0);
        if (level === 'H1') expect(requests.some(request => request.prompt.includes('local-tool'))).toBe(true);
        else {
          expect(requests.some(request => request.prompt.includes('brief') && request.prompt.includes('Task state'))).toBe(true);
          expect(await readFile(join(dir, 'runs', result.runId, 'task-state.md'), 'utf8')).toContain('## Next steps');
        }
      } finally { await rm(dir, { recursive: true, force: true }); }
    }
  });

  it('runs H3 deterministic checks, exposes the workflow, emits evidence, and writes the episode package', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-h3-'));
    const plan = { requirements: [{ id: 'r1', text: 'prints passing' }], checks: [{ id: 'check-r1', requirementIds: ['r1'], command: 'test -f .marker && printf passing', expect: { stdoutIncludes: 'passing' }, timeoutMs: 1000 }], steps: [{ id: 'build', role: 'builder', task: 'Implement it', dependsOn: [], parallelSafe: false }] };
    const requests: EngineRunRequest[] = [];
    const observed: EduEvent[] = [];
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      requests.push(request);
      if (request.prompt.includes('Implement it')) await writeFile(join(dir, '.marker'), 'ready');
      const text = request.prompt.includes('Create a safe') ? JSON.stringify(plan) : request.prompt.includes('Review the completed') ? '{"verdict":"pass","issues":[]}' : 'done';
      yield { type: 'agent.text', agentId, text, at } as EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at } as EduEvent;
    } };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      await mkdir(join(dir, '.edu', 'harness'), { recursive: true });
      await writeFile(join(dir, '.edu', 'harness', 'checks.json'), JSON.stringify(plan.checks));
      const result = await orchestrate('goal', { config: { ...defaultConfig('claude'), approvals: 'auto' }, brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => observed.push(event), approve: async () => true, harnessLevel: 'H3' });
      expect(result.ok).toBe(true);
      expect(requests.some(request => request.prompt.includes('reproduce') && request.prompt.includes('attribute') && request.prompt.includes('back-edge'))).toBe(true);
      expect(observed.some(event => event.type === 'task.define')).toBe(true);
      expect(observed).toContainEqual(expect.objectContaining({ type: 'verify.result', checkId: 'check-r1', ok: false, kind: 'reproduction' }));
      expect(observed).toContainEqual(expect.objectContaining({ type: 'verify.result', checkId: 'check-r1', ok: true, kind: 'deterministic', exitCode: 0, timedOut: false, durationMs: expect.any(Number) }));
      expect(observed).toContainEqual(expect.objectContaining({ type: 'failure.attribution', failureType: 'verify', evidence: expect.arrayContaining(['registered-check:check-r1']), alternatives: [] }));
      expect(result.events).toContainEqual(expect.objectContaining({ type: 'tool.call', tool: 'deterministic-check' }));
      expect(result.events).toContainEqual(expect.objectContaining({ type: 'tool.result', ok: true }));
      expect(observed).toContainEqual(expect.objectContaining({ type: 'outcome', label: 'autonomous_verified_success' }));
      const taskPackage = JSON.parse(await readFile(join(dir, 'runs', result.runId, 'task.json'), 'utf8'));
      expect(taskPackage.requirements).toEqual(plan.requirements);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('audits changes from the start commit and classifies credible test weakening as unsafe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-entropy-run-'));
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    await writeFile(join(dir, 'service.test.ts'), 'expect(value).toBe(1);\n');
    await exec('git', ['init', '-q'], { cwd: dir });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await exec('git', ['add', '.'], { cwd: dir });
    await exec('git', ['commit', '-qm', 'base'], { cwd: dir });
    const plan = { requirements: [{ id: 'r1', text: 'complete task' }], steps: [{ id: 'build', role: 'builder', task: 'Implement it', dependsOn: [], parallelSafe: false }] };
    const observed: EduEvent[] = [];
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      if (request.prompt.includes('Implement it')) await writeFile(join(dir, 'service.test.ts'), 'export const value = 1;\n');
      const text = request.prompt.includes('Create a safe') ? JSON.stringify(plan) : '{"verdict":"pass","issues":[]}';
      yield { type: 'agent.text', agentId, text, at } as EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at } as EduEvent;
    } };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      const result = await orchestrate('goal', { config: { ...defaultConfig('claude'), approvals: 'auto' }, brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => observed.push(event), approve: async () => true, harnessLevel: 'H0' });
      expect(result.ok).toBe(true);
      expect(observed).toContainEqual(expect.objectContaining({ type: 'entropy.finding', category: 'weakened-tests' }));
      expect(observed).toContainEqual(expect.objectContaining({ type: 'outcome', label: 'unsafe_invalid' }));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('marks an applicable registered H3 check omitted by the plan as bypassed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-h3-check-omission-'));
    const checks = [
      { id: 'required-check', requirementIds: ['r1'], command: 'printf required', expect: { stdoutIncludes: 'required' }, timeoutMs: 1000 },
      { id: 'other-check', requirementIds: ['r1'], command: 'printf other', expect: { stdoutIncludes: 'other' }, timeoutMs: 1000 },
      { id: 'unrelated-check', requirementIds: ['r2'], command: 'printf unrelated', expect: { stdoutIncludes: 'unrelated' }, timeoutMs: 1000 },
    ];
    const plan = { requirements: [{ id: 'r1', text: 'complete task' }], checks: [checks[1]], steps: [] };
    const observed: EduEvent[] = [];
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      yield { type: 'agent.text', agentId, text: request.prompt.includes('Create a safe') ? JSON.stringify(plan) : '{"verdict":"pass","issues":[]}', at } as EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at } as EduEvent;
    } };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      await mkdir(join(dir, '.edu', 'harness'), { recursive: true });
      await writeFile(join(dir, '.edu', 'harness', 'checks.json'), JSON.stringify(checks));
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => observed.push(event), approve: async () => true, harnessLevel: 'H3' });
      expect(result.ok, result.summary).toBe(true);
      expect(observed).toContainEqual(expect.objectContaining({ type: 'entropy.finding', category: 'checks-bypassed', severity: 3 }));
      expect(observed.some(event => event.type === 'entropy.finding' && String(event.detail).includes('unrelated-check'))).toBe(false);
      expect(observed).toContainEqual(expect.objectContaining({ type: 'outcome', label: 'unsafe_invalid' }));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('refuses model-proposed shell commands not present in the trusted check registry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-check-boundary-'));
    const plan = { requirements: [{ id: 'r1', text: 'no side effect' }], checks: [{ id: 'injected', requirementIds: ['r1'], command: 'touch marker', expect: {}, timeoutMs: 1000 }], steps: [] };
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      yield { type: 'agent.text', agentId, text: request.prompt.includes('Create a safe') ? JSON.stringify(plan) : '{"verdict":"pass","issues":[]}', at } as EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at } as EduEvent;
    } };
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: () => {}, approve: async () => true, harnessLevel: 'H3' });
      expect(result.ok).toBe(false);
      expect(result.summary).toContain('does not exactly match a registered');
      await expect(readFile(join(dir, 'marker'), 'utf8')).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('records approval decisions and composer messages as intervention events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-interventions-'));
    const plan = { steps: [{ id: 'build', role: 'builder', task: 'Implement it', dependsOn: [], parallelSafe: false }] };
    const observed: EduEvent[] = [];
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      const text = request.prompt.includes('Create a safe') ? JSON.stringify(plan) : '{"verdict":"pass","issues":[]}';
      yield { type: 'agent.text', agentId, text, at } as EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at } as EduEvent;
    } };
    const messages = (async function* () { yield 'Please include the missing file path in the task.'; })();
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      await orchestrate('goal', { config: { ...defaultConfig('claude'), approvals: 'always-ask' }, brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => observed.push(event), approve: async () => true, composerMessages: messages });
      expect(observed).toContainEqual(expect.objectContaining({ type: 'intervention', action: 'approval:approved', avoidable: false }));
      expect(observed).toContainEqual(expect.objectContaining({ type: 'intervention', action: 'composer-message', avoidable: true, harnessGap: 'context' }));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it.each(['error-event', 'failed-end'] as const)('fails the run on an engine %s', async failureKind => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-engine-failure-'));
    const plan = { steps: [{ id: 'read', role: 'explorer', task: 'inspect', dependsOn: [], parallelSafe: false }] };
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      if (request.prompt.includes('Create a safe')) { yield { type: 'agent.text', agentId, text: JSON.stringify(plan), at } as EduEvent; return; }
      if (failureKind === 'error-event') yield { type: 'error', agentId, message: 'engine failed', at };
      else yield { type: 'agent.end', agentId, ok: false, summary: 'engine failed', at };
    } };
    const events: EduEvent[] = [];
    const brain = { openSession: async () => ({ meta: { id: 's' } }), closeSession: async () => undefined } as never;
    try {
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => events.push(event), approve: async () => true });
      expect(result.ok).toBe(false);
      expect(events.some(event => event.type === 'agent.status' && event.status === 'failed'), result.summary).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('marks an engine error received after abort as cancelled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-cancelled-error-'));
    const controller = new AbortController();
    const plan = { steps: [{ id: 'read', role: 'explorer', task: 'inspect', dependsOn: [], parallelSafe: false }] };
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      if (request.prompt.includes('Create a safe')) { yield { type: 'agent.text', agentId, text: JSON.stringify(plan), at } as EduEvent; return; }
      controller.abort();
      yield { type: 'error', agentId, message: 'cancelled by engine', at };
    } };
    const events: EduEvent[] = [];
    const brain = { openSession: async () => ({ meta: { id: 's' } }), closeSession: async () => undefined } as never;
    try {
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => events.push(event), approve: async () => true, signal: controller.signal });
      expect(result.ok).toBe(false);
      expect(events.some(event => event.type === 'agent.status' && event.status === 'cancelled')).toBe(true);
      expect(events.some(event => event.type === 'agent.status' && event.status === 'failed')).toBe(false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('cancels a run on engine failure and gates review-requested fixes even without a planned builder step', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-fix-gate-'));
    const plan = { steps: [{ id: 'read', role: 'explorer', task: 'inspect', dependsOn: [], parallelSafe: false }] };
    let fixes = 0;
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      if (request.prompt.includes('Create a safe')) yield { type: 'agent.text', agentId, text: JSON.stringify(plan), at };
      else if (request.prompt.includes('Review the completed')) { yield { type: 'agent.text', agentId, text: '{"verdict":"fix","issues":["Inspect more"]}', at }; }
      else if (request.prompt.includes('Address these review issues')) { fixes++; yield { type: 'agent.text', agentId, text: 'fixed', at }; }
      else yield { type: 'agent.text', agentId, text: 'read', at };
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at };
    } };
    const events: EduEvent[] = [];
    const closed: string[] = [];
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async (_id: string, summary: string) => { closed.push(summary); } } as never;
    try {
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => events.push(event), approve: async () => false });
      expect(result.ok).toBe(false);
      expect(fixes).toBe(0);
      expect(events.some(event => event.type === 'approval.request' && event.title.includes('review-fix'))).toBe(true);
      expect(events.some(event => event.type === 'approval.resolve' && !event.approved)).toBe(true);
      expect(events.filter(event => event.type === 'brain.learn' && event.kind === 'episode')).toHaveLength(1);
      expect(closed).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('does not report success when the final review is aborted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-review-abort-'));
    const controller = new AbortController();
    const plan = { steps: [{ id: 'read', role: 'explorer', task: 'inspect', dependsOn: [], parallelSafe: false }] };
    const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
      if (request.prompt.includes('Create a safe')) yield { type: 'agent.text', agentId, text: JSON.stringify(plan), at };
      else if (request.prompt.includes('Review the completed')) { controller.abort(); yield { type: 'agent.text', agentId, text: '{"verdict":"pass","issues":[]}', at }; }
      else yield { type: 'agent.text', agentId, text: 'done', at };
      yield { type: 'agent.end', agentId, ok: true, summary: 'done', at };
    } };
    const events: EduEvent[] = [];
    const brain = { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => undefined } as never;
    try {
      const result = await orchestrate('goal', { config: defaultConfig('claude'), brain, context, engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(dir, 'runs'), onEvent: event => events.push(event), approve: async () => true, signal: controller.signal });
      expect(result.ok).toBe(false);
      expect(events.at(-1)?.type).toBe('run.end');
      expect(events.at(-1)?.type === 'run.end' && events.at(-1)?.ok).toBe(false);
      expect(events.some(event => event.type === 'agent.status' && event.status === 'cancelled')).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
