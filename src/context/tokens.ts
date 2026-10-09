const cjk = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu;
const punctuation = /[{}()[\];:=+*/<>|&!?#$%^~\\]/gu;

/** A deliberately cheap upper-biased estimate, not a tokenizer. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = [...text.matchAll(cjk)].length;
  const punctuationCount = [...text.matchAll(punctuation)].length;
  return Math.ceil((text.length - cjkCount) / 3.7 + cjkCount * 0.9 + punctuationCount * 0.23);
}

/** Preserve complete paragraphs or lines when possible; fall back to a character cut. */
export function truncateToTokens(text: string, limit: number): string {
  if (!Number.isFinite(limit) || limit <= 0) return '';
  const budget = Math.floor(limit);
  if (estimateTokens(text) <= budget) return text;
  const marker = '…';
  if (estimateTokens(marker) > budget) return '';
  const candidates = new Set<number>();
  for (const match of text.matchAll(/\n\n|\n/g)) candidates.add(match.index);
  for (const cut of [...candidates].sort((a, b) => b - a)) {
    const candidate = `${text.slice(0, cut).trimEnd()}\n${marker}`;
    if (estimateTokens(candidate) <= budget) return candidate;
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(`${text.slice(0, mid).trimEnd()}${marker}`) <= budget) low = mid;
    else high = mid - 1;
  }
  return low ? `${text.slice(0, low).trimEnd()}${marker}` : marker;
}
