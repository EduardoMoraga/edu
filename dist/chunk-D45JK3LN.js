// src/context/tokens.ts
var cjk = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu;
var punctuation = /[{}()[\];:=+*/<>|&!?#$%^~\\]/gu;
function estimateTokens(text) {
  if (!text) return 0;
  const cjkCount = [...text.matchAll(cjk)].length;
  const punctuationCount = [...text.matchAll(punctuation)].length;
  return Math.ceil((text.length - cjkCount) / 3.7 + cjkCount * 0.9 + punctuationCount * 0.23);
}
function truncateToTokens(text, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return "";
  const budget = Math.floor(limit);
  if (estimateTokens(text) <= budget) return text;
  const marker = "\u2026";
  if (estimateTokens(marker) > budget) return "";
  const cuts = [0];
  let cost = 0;
  for (const part of new Intl.Segmenter(void 0, { granularity: "grapheme" }).segment(text)) {
    cuts.push(part.index + part.segment.length);
    const cjkCount = [...part.segment.matchAll(cjk)].length;
    const punctuationCount = [...part.segment.matchAll(punctuation)].length;
    cost += (part.segment.length - cjkCount) / 3.7 + cjkCount * 0.9 + punctuationCount * 0.23;
    if (cost > budget) break;
  }
  let low = 0;
  let high = cuts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(`${text.slice(0, cuts[mid]).trimEnd()}${marker}`) <= budget) low = mid;
    else high = mid - 1;
  }
  const prefix = text.slice(0, cuts[low]).trimEnd();
  const boundary = prefix.lastIndexOf("\n");
  if (boundary >= 0) {
    const candidate = `${prefix.slice(0, boundary).trimEnd()}
${marker}`;
    const tokens = estimateTokens(candidate);
    if (tokens <= budget && tokens >= budget * 0.9) return candidate;
  }
  return `${prefix}${marker}`;
}

export {
  estimateTokens,
  truncateToTokens
};
//# sourceMappingURL=chunk-D45JK3LN.js.map