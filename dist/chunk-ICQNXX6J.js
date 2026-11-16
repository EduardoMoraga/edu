// src/context/tokens.ts
var PUNCTUATION = new Set([..."{}()[];:=+*/<>|&!?#$%^~\\"].map((char) => char.charCodeAt(0)));
var isCjk = (code) => code >= 12352 && code <= 12543 || code >= 13312 && code <= 40959 || code >= 44032 && code <= 55215 || code >= 63744 && code <= 64255;
function cost(text) {
  let ascii = 0, cjk = 0, other = 0, punctuation = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      ascii++;
      if (PUNCTUATION.has(code)) punctuation++;
    } else if (isCjk(code)) cjk++;
    else other++;
  }
  return ascii / 3.7 + cjk * 1.2 + other * 0.6 + punctuation * 0.23;
}
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(cost(text));
}
function truncateToTokens(text, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return "";
  const budget = Math.floor(limit);
  if (estimateTokens(text) <= budget) return text;
  const marker = "\u2026";
  if (estimateTokens(marker) > budget) return "";
  const cuts = [0];
  let spent = 0;
  for (const part of new Intl.Segmenter(void 0, { granularity: "grapheme" }).segment(text)) {
    cuts.push(part.index + part.segment.length);
    spent += cost(part.segment);
    if (spent > budget) break;
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
//# sourceMappingURL=chunk-ICQNXX6J.js.map