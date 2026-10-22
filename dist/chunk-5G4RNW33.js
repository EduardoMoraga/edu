import {
  USAGE_FIELDS
} from "./chunk-6GXTQRCF.js";

// src/engine/measurement.ts
import { randomUUID } from "crypto";
var UNSUPPORTED_CAPABILITIES = {
  readonly: "unsupported",
  isolation: "host",
  limitations: ["Readonly enforcement is unsupported; shared-workspace steps must run serially.", "Host execution is not an Edu OS/network sandbox."]
};
var wrappers = /* @__PURE__ */ new WeakMap();
function measuredEngine(engine) {
  const existing = wrappers.get(engine);
  if (existing) return existing;
  const capabilities = engine.capabilities ?? UNSUPPORTED_CAPABILITIES;
  const wrapped = {
    cli: engine.cli,
    capabilities,
    available: () => engine.available(),
    async *run(request, agentId) {
      if (request.requireSandbox) throw new Error("An enforced OS/network sandbox is unsupported by this engine.");
      if (request.requireReadonly && (request.autonomy !== "readonly" || capabilities.readonly !== "enforced")) throw new Error(`Enforced readonly is unsupported for ${engine.cli}.`);
      if (request.signal?.aborted) throw new Error("Invocation cancelled before execution.");
      const invocation = request.invocation ?? { id: randomUUID(), purpose: "task" };
      if (!invocation.id.trim()) throw new Error("Invocation id must not be empty.");
      let observations = 0;
      const marker = (receipt) => ({
        type: "usage",
        agentId,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          known: Object.fromEntries(USAGE_FIELDS.map((field) => [field, false])),
          receipt,
          observationId: `${invocation.id}:${receipt}`,
          invocationId: invocation.id,
          purpose: invocation.purpose
        },
        at: (/* @__PURE__ */ new Date()).toISOString()
      });
      yield marker("pending");
      if (request.signal?.aborted) return;
      let failed = false;
      for await (const event of engine.run({ ...request, invocation }, agentId)) {
        if (event.type !== "usage") {
          if (event.type === "error" || (event.type === "agent.end" || event.type === "run.end") && !event.ok) failed = true;
          yield event;
          continue;
        }
        const usage = { ...event.usage, observationId: `${invocation.id}:${observations++}`, invocationId: invocation.id, purpose: invocation.purpose };
        yield { ...event, usage };
      }
      if (!failed && !request.signal?.aborted) {
        if (!observations) yield { type: "usage", agentId, usage: {
          inputTokens: 0,
          outputTokens: 0,
          known: Object.fromEntries(USAGE_FIELDS.map((field) => [field, false])),
          observationId: `${invocation.id}:0`,
          invocationId: invocation.id,
          purpose: invocation.purpose
        }, at: (/* @__PURE__ */ new Date()).toISOString() };
        yield marker("complete");
      }
    }
  };
  wrappers.set(engine, wrapped);
  wrappers.set(wrapped, wrapped);
  return wrapped;
}

export {
  measuredEngine
};
//# sourceMappingURL=chunk-5G4RNW33.js.map