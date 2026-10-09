export const BLOCK_START = '<!-- edu:core:start -->';
export const BLOCK_END = '<!-- edu:core:end -->';

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

export function upsertManagedBlock(text: string, body: string): string {
  const block = `${BLOCK_START}\n${body.trimEnd()}\n${BLOCK_END}`;
  const span = bounds(text);
  if (span) return text.slice(0, span[0]) + block + text.slice(span[1]);
  const separator = text.length === 0 ? '' : '\n';
  return `${text}${separator}${block}\n`;
}

export function removeManagedBlock(text: string): string {
  const span = bounds(text);
  if (!span) return text;
  const [start, end] = span;
  if (end === text.length - 1 && text[end] === '\n') {
    const prefix = text.slice(0, start);
    return prefix.endsWith('\n') ? prefix.slice(0, -1) : prefix;
  }
  return text.slice(0, start) + text.slice(end);
}
