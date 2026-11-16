const PUNCTUATION = new Set([...'{}()[];:=+*/<>|&!?#$%^~\\'].map(char => char.charCodeAt(0)));
const isCjk = (code: number) => (code >= 0x3040 && code <= 0x30ff) || (code >= 0x3400 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff);

/**
 * Unrounded cost of a text, per UTF-16 code unit: ASCII ~1/3.7 (plus a little for code punctuation), CJK 1.2, any
 * other non-ASCII unit (accented Latin, Cyrillic, Greek, Arabic, Indic, emoji halves…) 0.6. Real tokenizers split
 * non-Latin scripts into far more tokens per character than English, so the estimate errs high there.
 */
function cost(text: string): number {
  let ascii = 0, cjk = 0, other = 0, punctuation = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) { ascii++; if (PUNCTUATION.has(code)) punctuation++; }
    else if (isCjk(code)) cjk++;
    else other++;
  }
  return ascii / 3.7 + cjk * 1.2 + other * 0.6 + punctuation * 0.23;
}

/** A deliberately cheap upper-biased estimate, not a tokenizer. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(cost(text));
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
  let spent = 0;
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
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
  const boundary = prefix.lastIndexOf('\n');
  if (boundary >= 0) {
    const candidate = `${prefix.slice(0, boundary).trimEnd()}\n${marker}`;
    const tokens = estimateTokens(candidate);
    if (tokens <= budget && tokens >= budget * 0.9) return candidate;
  }
  return `${prefix}${marker}`;
}
