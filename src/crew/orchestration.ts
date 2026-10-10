import { dirname } from 'node:path';
import type { CliId, CrewJob, EduEvent, Engine } from '../core/contracts.js';
import { processContext } from '../cli/context.js';
import { executeRun } from '../cli/run/session.js';
import { detectEngines } from '../engine/index.js';
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
  const onEvent = async (event: EduEvent) => {
    await store.appendEvent(job.id, event);
    if (event.type === 'spec.ready') await store.update(job.id, { specPath: event.path, note: event.path });
    if (event.type === 'approval.request' && !job.autoApprove) {
      await store.update(job.id, { status: 'awaiting-approval' });
      await store.appendEvent(job.id, { type: 'agent.status', agentId: job.id, status: 'awaiting-approval', at: event.at });
    }
    if (event.type === 'approval.resolve') await store.update(job.id, { status: 'running' });
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
    const context = processContext();
    context.cwd = job.cwd;
    context.env = { ...process.env, EDU_HOME: options.brainRoot };
    context.home = dirname(options.brainRoot);
    context.availableClis = available;
    context.engineFactory = options.engineFactory;
    await store.update(job.id, { status: 'running', pid: process.pid });
    const result = await executeRun(context, {
      goal: job.goal ?? job.task, cwd: job.cwd, lang: 'en', mode: job.orchestrationMode,
      cli: job.cli, harnessLevel: job.harnessLevel, playbook: job.playbook,
      autoApprove: job.autoApprove, engines: options.engineFactory, available,
      onEvent,
      approve: async () => {
        if (job.autoApprove) return true;
        while (true) {
          const decision = await store.takeDecision(job.id);
          if (decision !== undefined) return decision;
          await sleep(250);
        }
      },
    });
    return store.update(job.id, { status: result.ok ? 'done' : 'failed', endedAt: now().toISOString(), summary: result.summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.appendEvent(job.id, { type: 'error', message, at: now().toISOString() }).catch(() => undefined);
    return store.update(job.id, { status: 'failed', endedAt: now().toISOString(), summary: message });
  }
}
