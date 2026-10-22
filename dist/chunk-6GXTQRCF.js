// src/core/usage.ts
var USAGE_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "costUsd"];
var validUsageNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
function usageValue(usage, field) {
  return usage.known?.[field] === true && validUsageNumber(usage[field]) ? usage[field] : null;
}
function sumUsage(rows) {
  const result = { inputTokens: 0, outputTokens: 0, known: {}, observedKnown: {}, observationIds: [], observations: 0, invocationStates: {} };
  const seen = /* @__PURE__ */ new Set();
  const lifecycle = (id, state) => {
    if (state === "complete" || result.invocationStates[id] !== "complete") result.invocationStates[id] = state;
  };
  for (const row of rows) {
    const ids = row.observationId ? [row.observationId] : row.observationIds ?? [];
    if (row.observations === 0 && !ids.length && !row.receipt && !Object.keys(row.invocationStates ?? {}).length) continue;
    if (ids.length && ids.every((id) => seen.has(id))) continue;
    if (ids.some((id) => seen.has(id))) throw new Error("Overlapping usage aggregates cannot be summed without individual observations.");
    for (const [id, state] of Object.entries(row.invocationStates ?? {})) lifecycle(id, state);
    if (row.receipt && row.invocationId) lifecycle(row.invocationId, row.receipt);
    if (!row.receipt && row.observations !== 0) {
      const first = result.observations === 0;
      for (const field of USAGE_FIELDS) {
        const value = row[field];
        if (validUsageNumber(value)) result[field] = (result[field] ?? 0) + value;
        const intrinsic = row.observedKnown ?? row.known;
        result.observedKnown[field] = (first || result.observedKnown[field] === true) && intrinsic?.[field] === true && validUsageNumber(value);
      }
      result.observations += row.observations ?? 1;
    }
    for (const id of ids) seen.add(id);
  }
  const pending = Object.values(result.invocationStates).includes("pending");
  for (const field of USAGE_FIELDS) result.known[field] = Boolean(result.observations) && !pending && result.observedKnown[field] === true;
  result.observationIds = [...seen];
  return result;
}
function tokenMeasurement(usage) {
  return {
    value: (validUsageNumber(usage.inputTokens) ? usage.inputTokens : 0) + (validUsageNumber(usage.outputTokens) ? usage.outputTokens : 0),
    known: usageValue(usage, "inputTokens") !== null && usageValue(usage, "outputTokens") !== null
  };
}
function measuredText(value, known, format) {
  if (known && validUsageNumber(value)) return format(value);
  return validUsageNumber(value) && value > 0 ? `>=${format(value)} (partial)` : "unknown";
}

export {
  USAGE_FIELDS,
  usageValue,
  sumUsage,
  tokenMeasurement,
  measuredText
};
//# sourceMappingURL=chunk-6GXTQRCF.js.map