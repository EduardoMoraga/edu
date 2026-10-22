import { randomUUID } from 'node:crypto';
import type { EduEvent, Engine, EngineCapabilities, Usage } from '../core/contracts.js';
import { USAGE_FIELDS } from '../core/usage.js';

export const UNSUPPORTED_CAPABILITIES: EngineCapabilities = {
  readonly: 'unsupported', isolation: 'host', limitations: ['Readonly enforcement is unsupported; shared-workspace steps must run serially.', 'Host execution is not an Edu OS/network sandbox.'],
};
const wrappers = new WeakMap<Engine, Engine>();

/** Measures actual invocations once, including injected adapters and calls that report no usage. */
export function measuredEngine(engine: Engine): Engine {
  const existing = wrappers.get(engine);
  if (existing) return existing;
  const capabilities = engine.capabilities ?? UNSUPPORTED_CAPABILITIES;
  const wrapped: Engine = {
    cli: engine.cli, capabilities,
    available: () => engine.available(),
    async *run(request, agentId) {
      if (request.requireSandbox) throw new Error('An enforced OS/network sandbox is unsupported by this engine.');
      if (request.requireReadonly && (request.autonomy !== 'readonly' || capabilities.readonly !== 'enforced')) throw new Error(`Enforced readonly is unsupported for ${engine.cli}.`);
      if (request.signal?.aborted) throw new Error('Invocation cancelled before execution.');
      const invocation = request.invocation ?? { id: randomUUID(), purpose: 'task' as const };
      if (!invocation.id.trim()) throw new Error('Invocation id must not be empty.');
      let observations = 0;
      const marker = (receipt: 'pending' | 'complete'): EduEvent => ({
        type: 'usage', agentId, usage: { inputTokens: 0, outputTokens: 0,
          known: Object.fromEntries(USAGE_FIELDS.map(field => [field, false])), receipt,
          observationId: `${invocation.id}:${receipt}`, invocationId: invocation.id, purpose: invocation.purpose }, at: new Date().toISOString(),
      });
      // The consumer must receive this before any adapter event: return()/throw() may discard final yields.
      yield marker('pending');
      if (request.signal?.aborted) return;
      let failed = false;
      for await (const event of engine.run({ ...request, invocation }, agentId)) {
        if (event.type !== 'usage') {
          if (event.type === 'error' || ((event.type === 'agent.end' || event.type === 'run.end') && !event.ok)) failed = true;
          yield event;
          continue;
        }
        const usage: Usage = { ...event.usage, observationId: `${invocation.id}:${observations++}`, invocationId: invocation.id, purpose: invocation.purpose };
        yield { ...event, usage };
      }
      // Early consumer exit or an adapter exception never reaches this point.
      if (!failed && !request.signal?.aborted) {
        if (!observations) yield { type: 'usage', agentId, usage: { inputTokens: 0, outputTokens: 0,
          known: Object.fromEntries(USAGE_FIELDS.map(field => [field, false])), observationId: `${invocation.id}:0`, invocationId: invocation.id, purpose: invocation.purpose }, at: new Date().toISOString() };
        yield marker('complete');
      }
    },
  };
  wrappers.set(engine, wrapped);
  wrappers.set(wrapped, wrapped);
  return wrapped;
}
