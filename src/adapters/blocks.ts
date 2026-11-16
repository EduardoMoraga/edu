import { createHash } from 'node:crypto';

export const BLOCK_START = '<!-- edu:core:start -->';
export const BLOCK_END = '<!-- edu:core:end -->';

/** The line ending a file already uses: CRLF files get CRLF blocks. */
export function eolOf(text: string): '\r\n' | '\n' { return text.includes('\r\n') ? '\r\n' : '\n'; }

function bounds(text: string): [number, number] | undefined {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if ((start < 0) !== (end < 0)) throw new Error('Malformed Edu managed block');
  if (start < 0) return undefined;
  if (end < start || text.indexOf(BLOCK_START, start + BLOCK_START.length) >= 0 || text.indexOf(BLOCK_END, end + BLOCK_END.length) >= 0) {
    throw new Error('Malformed Edu managed block');
  }
  return [start, end + BLOCK_END.length];
}

export function upsertManagedBlock(text: string, body: string, eol: '\r\n' | '\n' = eolOf(text)): string {
  const block = [BLOCK_START, ...body.trimEnd().split(/\r?\n/), BLOCK_END].join(eol);
  const span = bounds(text);
  if (span) return text.slice(0, span[0]) + block + text.slice(span[1]);
  const separator = text.length === 0 ? '' : eol;
  return `${text}${separator}${block}${eol}`;
}

/** Edu's block, markers included, or undefined when the text has none. Throws on a malformed block. */
export function managedBlock(text: string): string | undefined {
  const span = bounds(text);
  return span ? text.slice(span[0], span[1]) : undefined;
}

/** The body between the markers, as upsertManagedBlock received it (without the trailing newline). */
export function managedBlockBody(block: string): string {
  return block.slice(BLOCK_START.length, block.length - BLOCK_END.length).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

/** Digest of Edu's own text, line endings normalized, so a CRLF conversion is not an edit. */
export function sectionDigest(section: string): string {
  return createHash('sha256').update(section.replace(/\r\n/g, '\n')).digest('hex');
}

export function removeManagedBlock(text: string): string {
  const span = bounds(text);
  if (!span) return text;
  const [start, end] = span;
  const eol = text.startsWith('\r\n', end) ? '\r\n' : text.startsWith('\n', end) ? '\n' : '';
  if (eol && end + eol.length === text.length) {
    const prefix = text.slice(0, start);
    return prefix.endsWith(eol) ? prefix.slice(0, -eol.length) : prefix;
  }
  // Text the user added after the block keeps its place; the newline Edu wrote after the block goes.
  return text.slice(0, start) + text.slice(end + eol.length);
}
