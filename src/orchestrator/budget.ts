import type { EduConfig, Engine } from '../core/contracts.js';

export class BudgetExhausted extends Error {}
/** One run-local authority, shared by planning, recovery, workers and review. */
export class RunBudget {
  readonly limits: NonNullable<EduConfig['execution']>;
  spawns = 0;
  advisorCalls = 0;
  active = 0;
  private waiters: Array<() => void> = [];
  private async acquire(signal?: AbortSignal) {
    while (this.active >= this.limits.maxConcurrency) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(new Error('Run cancelled while waiting for execution slot.')); };
        const cleanup = () => {
          this.waiters = this.waiters.filter(item => item !== wake);
          signal?.removeEventListener('abort', abort);
        };
        this.waiters.push(wake);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
    if (signal?.aborted) throw new Error('Run cancelled.');
    this.active++;
  }
  constructor(config: EduConfig) {
    this.limits = config.execution ?? { maxSpawns: 32, maxConcurrency: 3, timeoutMs: 1_800_000, maxAdvisorCalls: 0 };
  }
  wrap(engine: Engine): Engine {
    const budget = this;
    return {
      ...engine, cli: engine.cli, capabilities: engine.capabilities,
      available: () => engine.available(),
      async *run(request, agentId) {
        if (request.signal?.aborted) throw new Error('Run cancelled.');
        if (budget.spawns >= budget.limits.maxSpawns) throw new BudgetExhausted('Execution budget exhausted: maxSpawns.');
        await budget.acquire(request.signal);
        try {
          if (budget.spawns >= budget.limits.maxSpawns) throw new BudgetExhausted('Execution budget exhausted: maxSpawns.');
          budget.spawns++;
          yield* engine.run(request, agentId);
        } finally { budget.active--; budget.waiters.shift()?.(); }
      },
    };
  }
}
