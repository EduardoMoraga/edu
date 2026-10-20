const cjk = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu;
const punctuation = /[{}()[\];:=+*/<>|&!?#$%^~\\]/gu;

/** A deliberately cheap upper-biased estimate, not a tokenizer. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = [...text.matchAll(cjk)].length;
  const punctuationCount = [...text.matchAll(punctuation)].length;
  return Math.ceil((text.length - cjkCount) / 3.7 + cjkCount * 0.9 + punctuationCount * 0.23);
}

/** Prefer boundaries only when they retain at least 90% of the available budget. */
export function truncateToTokens(text: string, limit: number): string {
  if (!Number.isFinite(limit) || limit <= 0) return '';
  const budget = Math.floor(limit);
  if (estimateTokens(text) <= budget) return text;
  const marker = '…';
  if (estimateTokens(marker) > budget) return '';
  // Segmenting protects surrogate pairs, combining marks and emoji sequences.
  const cuts = [0];
  let cost = 0;
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
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
  const boundary = prefix.lastIndexOf('\n');
  if (boundary >= 0) {
    const candidate = `${prefix.slice(0, boundary).trimEnd()}\n${marker}`;
    const tokens = estimateTokens(candidate);
    if (tokens <= budget && tokens >= budget * 0.9) return candidate;
  }
  return `${prefix}${marker}`;
}
