import { dirname } from 'node:path';
import type { CliId, CrewJob, EduEvent, Engine } from '../core/contracts.js';
import { detectEngines } from '../engine/index.js';
import { runSession } from '../orchestrator/session.js';
import type { CrewStore } from './store.js';

export interface OrchestrationWorkerOptions {
  brainRoot: string;
  store: CrewStore;
  engineFactory?: (cli: CliId) => Engine;
  detectClis?: () => Promise<CliId[]>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/** Runs one persisted orchestration and waits for one-shot approval decisions. */
export async function runOrchestration(job: CrewJob, options: OrchestrationWorkerOptions): Promise<CrewJob> {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const latestChecks = new Map<string, boolean>();
  // The spec path is persisted with the next update so that a spec awaiting approval becomes visible
  // together with `awaiting-approval`: readers that wait for `specPath` (edu_orchestrate) never see the
  // spec while the job still says `running`.
  let pendingSpec: string | undefined;
  const specPatch = () => {
    const patch = pendingSpec ? { specPath: pendingSpec, note: pendingSpec } : {};
    pendingSpec = undefined;
    return patch;
  };
  const flushSpec = async () => { if (pendingSpec) await store.update(job.id, specPatch()); };
  const onEvent = async (event: EduEvent) => {
    await store.appendEvent(job.id, event);
    if (event.type === 'spec.ready') { await flushSpec(); pendingSpec = event.path; return; }
    if (event.type === 'approval.request' && !job.autoApprove) {
      // Every gate gets a fresh requestId; only a decision naming it (written after this point) applies.
      await store.openApproval(job.id, { title: event.title, ...(event.unregisteredChecks?.length ? { unregisteredChecks: event.unregisteredChecks } : {}) }, specPatch());
      await store.appendEvent(job.id, { type: 'agent.status', agentId: job.id, status: 'awaiting-approval', at: event.at });
    }
    await flushSpec();
    if (event.type === 'approval.resolve') await store.update(job.id, { status: 'running', approval: undefined });
    if (event.type === 'verify.result' && event.kind !== 'reproduction') {
      latestChecks.set(event.checkId ?? event.method ?? 'unknown', event.ok);
      const passed = [...latestChecks.values()].filter(Boolean).length;
      const failed = latestChecks.size - passed;
      await store.update(job.id, { verificationSummary: `${passed} passed, ${failed} failed` });
    }
    if (event.type === 'outcome') await store.update(job.id, { outcome: event.label });
  };
  try {
    const available = await (options.detectClis ?? detectEngines)();
    await store.update(job.id, { status: 'running', pid: process.pid });
    const host = { available, env: { ...process.env, EDU_HOME: options.brainRoot }, home: dirname(options.brainRoot) };
    const result = await runSession(host, {
      goal: job.goal ?? job.task, cwd: job.cwd, lang: 'en', mode: job.orchestrationMode,
      cli: job.cli, harnessLevel: job.harnessLevel, playbook: job.playbook,
      autoApprove: job.autoApprove, allowUnregisteredChecks: job.allowUnregisteredChecks, engines: options.engineFactory,
      onEvent,
      approve: async () => {
        if (job.autoApprove) return true;
        while (true) {
          const decision = await store.takeDecision(job.id);
          if (decision !== undefined) return { approved: decision.approve, by: decision.by };
          await sleep(250);
        }
      },
    });
    return await store.update(job.id, { ...specPatch(), status: result.ok ? 'done' : 'failed', endedAt: now().toISOString(), summary: result.summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.appendEvent(job.id, { type: 'error', message, at: now().toISOString() }).catch(() => undefined);
    return store.update(job.id, { ...specPatch(), status: 'failed', endedAt: now().toISOString(), summary: message });
  }
}
