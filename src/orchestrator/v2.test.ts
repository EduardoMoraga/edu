import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Engine, EngineRunRequest, FeedbackContext, HarnessLevel } from '../core/contracts.js';
import { nodeCommand } from '../test-support/shell.js';
import { classifyPackage } from '../evidence/classify.js';
import { defaultConfig } from './config.js';
import { orchestrate } from './run.js';

async function fixture(options: { rounds?: number; reviews?: string[]; fail?: boolean; repair?: boolean; applied?: string; level?: HarnessLevel; rejectFix?: boolean; noChecks?: boolean; reviewBreaks?: boolean; failFeedback?: boolean; reviewEvidenceFailure?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'edu-orchestrator-v2-'));
  const root = join(dir, '.edu');
  const requests: EngineRunRequest[] = [];
  const feedback = vi.fn(async (_id: string, _helpful: boolean, _context?: FeedbackContext) => { if (options.failFeedback) throw new Error('feedback unavailable'); });
  const approvals: string[] = [];
  let reviews = 0;
  let builders = 0;
  const plan = { requirements: [{ id: 'R-1', text: 'marker exists' }], checks: options.noChecks ? [] : [{ id: 'marker', requirementIds: ['R-1'], command: nodeCommand("require('fs').accessSync('marker')"), expect: { exitCode: 0 }, timeoutMs: 10000 }], steps: [{ id: 'build', role: 'builder', task: 'Build marker', dependsOn: [], parallelSafe: false }] };
  await mkdir(join(dir, '.edu', 'harness'), { recursive: true });
  await writeFile(join(dir, '.edu', 'harness', 'tools.json'), JSON.stringify([{ id: 'UNIQUE_TOOL', command: 'node --version' }]));
  await mkdir(join(root, 'playbooks'), { recursive: true });
  await writeFile(join(root, 'playbooks', 'default.md'), `---\nname: default\ndescription: Fixture\nharness: H3\nrequireSpecApproval: true\nmaxFixRounds: ${options.rounds ?? 1}\n---\n\nFixture method.\n`);
  const runtime: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
    requests.push(request);
    let text: string;
    if (request.prompt.includes('Create a safe')) text = JSON.stringify(plan);
    else if (request.prompt.includes('Review the completed')) text = JSON.stringify({ verdict: options.reviews?.[reviews++] ?? 'pass', issues: ['inspect marker'] });
    else {
      builders++;
      if (!options.fail || (options.repair && builders > 1)) await writeFile(join(dir, 'marker'), 'ok');
      if (options.reviewBreaks && builders > 1) await rm(join(dir, 'marker'), { force: true });
      text = `done\n${options.applied ?? ''}`;
    }
    yield { type: 'agent.text', agentId, text, at: new Date().toISOString() };
    if (options.reviewEvidenceFailure && request.prompt.includes('Review the completed')) {
      yield { type: 'verify.result', checkId: 'engine-review', requirementIds: ['R-1'], kind: 'review', ok: false, output: 'Unresolved reviewer verification failure', at: new Date().toISOString() };
    }
    yield { type: 'agent.end', agentId, ok: true, summary: 'done', at: new Date().toISOString() };
  } };
  try {
    const result = await orchestrate('Create marker', {
      config: { ...defaultConfig('claude'), approvals: options.rejectFix ? 'always-ask' : 'auto' },
      brain: { openSession: async () => ({ meta: { id: 'session' } }), closeSession: async () => {}, feedback } as never,
      context: { build: async () => ({ text: '[[L-used]] UNIQUE_MEMORY\n[[L-idle]] unused memory', tokens: 10, budgetTokens: 100, sections: [{ title: 'Lessons', text: '[[L-used]] UNIQUE_MEMORY\n[[L-idle]] unused memory', tokens: 10, noteIds: ['L-used', 'L-idle', 'L-metadata-only'] }], deferred: ['L-deferred'] }) },
      engines: () => runtime, available: ['claude'], cwd: dir, runsDir: join(root, 'runs'), harnessLevel: options.level,
      onEvent: () => {}, approve: async request => { approvals.push(request.stepId); return !options.rejectFix || !request.stepId.includes('fix'); },
    });
    const terminal = result.events.find(event => event.type === 'outcome');
    expect(await classifyPackage(result.episodeDir!)).toBe(terminal?.type === 'outcome' ? terminal.label : undefined);
    return { result, requests, feedback, approvals, builders, reviews };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const applied = (noteId = 'L-used', requirementIds = ['R-1']) => `EDU_APPLIED ${JSON.stringify({ noteId, requirementIds, application: `Applied [[${noteId}]] to implement the marker requirement.` })}`;

describe('Edu 2.0 orchestration boundaries', () => {
  it('supplies support once per request without losing registry, memory, task state or method', async () => {
    const { result, requests } = await fixture();
    expect(result.ok, result.summary).toBe(true);
    for (const request of requests) {
      expect(request.prompt.split('UNIQUE_MEMORY')).toHaveLength(2);
      expect(request.prompt.split('UNIQUE_TOOL')).toHaveLength(2);
      expect(request.prompt.split('# Task state')).toHaveLength(2);
      expect(`${request.prompt}\n${request.systemPrompt}`).toContain('Fixture method.');
    }
  });

  it('constructs the exact H2 builder request with support in one place', async () => {
    const { result, requests } = await fixture({ level: 'H2', noChecks: true });
    expect(result.ok, result.summary).toBe(true);
    const registry = JSON.stringify({ tools: [{ id: 'UNIQUE_TOOL', command: 'node --version' }], checks: [] }, null, 2);
    const state = '# Task state\n\n## Goal\nCreate marker\n\n## Hypotheses\n- None recorded yet.\n\n## Inspected files\n- None recorded yet.\n\n## Open questions\n- None recorded yet.\n\n## Next steps\n- build: Build marker\n';
    expect(requests[1]).toEqual({
      cli: 'claude', cwd: requests[0]!.cwd, autonomy: 'auto', signal: expect.any(AbortSignal),
      prompt: `Build marker\n\nGoal:\nCreate marker\n\nDependencies:\n\n\nContext pack:\nTool and check registry:\n${registry}\n\nBrain context pack:\n[[L-used]] UNIQUE_MEMORY\n[[L-idle]] unused memory\n\nTask state:\n${state}`,
      systemPrompt: 'Implement the assigned change and verify it.\n\nPlaybook: default\nFixture\n\nFixture method.\n\nIf you actually apply a supplied note, cite it explicitly on a separate line: EDU_APPLIED {"noteId":"L-id","requirementIds":["R-1"],"application":"Applied [[L-id]] by ..."}. Report only concrete application, never mere exposure or presumed benefit.',
    });
    expect(requests[1]!.signal!.aborted).toBe(false);
  });

  it('does not correct a review when maxFixRounds is zero', async () => {
    const { result, builders, reviews } = await fixture({ rounds: 0, reviews: ['fix'] });
    expect(result.ok).toBe(false);
    expect(builders).toBe(1);
    expect(reviews).toBe(1);
  });

  it('shares correction budget between deterministic failure and review', async () => {
    const { result, builders, reviews } = await fixture({ rounds: 1, fail: true, repair: true, reviews: ['fix'] });
    expect(result.ok).toBe(false);
    expect(builders).toBe(2);
    expect(reviews).toBe(1);
  });

  it('reverifies and reviews after a review correction', async () => {
    const { result, builders, reviews } = await fixture({ reviews: ['fix', 'pass'] });
    expect(result.ok, result.summary).toBe(true);
    expect(builders).toBe(2);
    expect(reviews).toBe(2);
    expect(result.events.filter(e => e.type === 'verify.result' && e.kind === 'deterministic')).toHaveLength(2);
  });

  it('stops repeated fix verdicts at the shared budget', async () => {
    const { result, builders, reviews } = await fixture({ rounds: 2, reviews: ['fix', 'fix', 'fix'] });
    expect(result.ok).toBe(false);
    expect(builders).toBe(3);
    expect(reviews).toBe(3);
  });

  it('honors correction rejection without another builder', async () => {
    const { result, builders, approvals } = await fixture({ rejectFix: true, reviews: ['fix'] });
    expect(result.ok).toBe(false);
    expect(builders).toBe(1);
    expect(approvals).toContain('review-fix');
  });

  it('credits only explicitly applied supplied notes, with deterministic evidence and unique run outcome keys', async () => {
    const first = await fixture({ applied: applied() });
    const second = await fixture({ applied: applied() });
    for (const { result, feedback } of [first, second]) {
      expect(result.ok, result.summary).toBe(true);
      expect(feedback).toHaveBeenCalledTimes(1);
      expect(feedback).toHaveBeenCalledWith('L-used', true, {
        eventId: `${result.runId}:autonomous_verified_success`, verified: true,
        evidence: expect.arrayContaining(['deterministic-check:marker', expect.stringContaining('application:')]),
      });
      expect(result.events).toContainEqual(expect.objectContaining({ type: 'context.trace', noteId: 'L-used', influenced: true }));
      expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'context.trace', noteId: 'L-idle', influenced: true }));
    }
    expect(first.feedback.mock.calls[0]![2]!.eventId).not.toBe(second.feedback.mock.calls[0]![2]!.eventId);
  });

  it.each([
    { applied: 'Mention [[L-used]] without application evidence' },
    { applied: applied('L-deferred') },
    { applied: applied('L-metadata-only') },
    { applied: 'EDU_APPLIED {"noteId":"L-used","requirementIds":["R-1"],"application":"No explicit citation"}' },
    { applied: applied('L-used', ['R-missing']) },
    { applied: applied(), noChecks: true },
    { applied: applied(), fail: true, rounds: 0 },
    { applied: applied(), reviewBreaks: true, reviews: ['fix'] },
  ])('does not manufacture verified feedback for %j', async options => {
    const { feedback } = await fixture(options);
    expect(feedback).not.toHaveBeenCalled();
  });

  it('uses API8 terminal classification before feedback and emits only one terminal pair', async () => {
    const { result, feedback } = await fixture({ applied: applied(), reviewEvidenceFailure: true });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Episode verification failed: unresolved verification failure');
    expect(feedback).not.toHaveBeenCalled();
    expect(result.events.filter(e => e.type === 'outcome')).toHaveLength(1);
    expect(result.events.filter(e => e.type === 'run.end')).toHaveLength(1);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'outcome', label: 'failed' }));
  });

  it('deduplicates repeated explicit application inside a run', async () => {
    const { result, feedback } = await fixture({ applied: `${applied()}\n${applied()}`, reviews: ['fix', 'pass'] });
    expect(result.ok, result.summary).toBe(true);
    expect(feedback).toHaveBeenCalledTimes(1);
    expect(result.events.filter(e => e.type === 'context.trace' && e.influenced)).toHaveLength(1);
  });

  it('does not turn feedback persistence failure into a successful vote or a run failure', async () => {
    const { result, feedback } = await fixture({ applied: applied(), failFeedback: true });
    expect(result.ok, result.summary).toBe(true);
    expect(feedback).toHaveBeenCalledTimes(1);
    expect(result.events.filter(e => e.type === 'run.end')).toHaveLength(1);
  });

  it('keeps H0 as an orchestrated baseline without injecting memory or claiming native execution', async () => {
    const { result, requests, feedback } = await fixture({ level: 'H0', applied: applied() });
    expect(result.ok).toBe(true);
    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) {
      expect(request.prompt).not.toContain('UNIQUE_MEMORY');
      expect(request.prompt).not.toContain('# Task state');
    }
    expect(feedback).not.toHaveBeenCalled();
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'outcome', metrics: expect.objectContaining({ harnessLevel: 'H0' }) }));
  });
});
