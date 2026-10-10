/**
 * Minimal-diff edits to a YAML file. The `yaml` Document API locates nodes; the edit itself is a
 * text splice, so every other byte (comments, quoting, folded strings, sequence indentation) stays
 * exactly as the owner wrote it. Re-serializing the whole document would reflow long strings and
 * re-indent sequences across the file.
 */
import { isMap, isScalar, isSeq, parseDocument, stringify, type Document, type Pair, type YAMLMap, type YAMLSeq } from 'yaml';

export function parseYaml(text: string): Document.Parsed {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(`Invalid YAML: ${doc.errors[0]!.message}`);
  return doc;
}

const lineStart = (text: string, offset: number) => text.lastIndexOf('\n', offset - 1) + 1;
function lineEnd(text: string, offset: number): number {
  if (offset > 0 && text[offset - 1] === '\n') return offset;
  const next = text.indexOf('\n', offset);
  return next === -1 ? text.length : next + 1;
}

function rootMap(doc: Document.Parsed): YAMLMap {
  if (!isMap(doc.contents)) throw new Error('Expected a YAML mapping at the top level');
  return doc.contents;
}

export function findPair(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find(pair => isScalar(pair.key) && pair.key.value === key) as Pair | undefined;
}

/** Deep equality for plain YAML data (key order ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every(k => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/** Text of `{ key: value }` as a block, indented by `indent` spaces, ending with a newline. */
function block(key: string, value: unknown, indent: number): string {
  return stringify({ [key]: value }, { indent: 2, lineWidth: 0 })
    .split('\n').filter(Boolean).map(line => `${' '.repeat(indent)}${line}\n`).join('');
}

/** Byte range of a pair, from the start of its key line to the end of its value. */
function pairRange(text: string, pair: Pair): [number, number] {
  const key = pair.key as { range?: [number, number, number] };
  const value = pair.value as { range?: [number, number, number] } | null;
  const start = lineStart(text, key.range![0]);
  const end = lineEnd(text, value?.range?.[2] ?? key.range![2]);
  return [start, end];
}

/**
 * Sets `<top>.<key> = value` (top is a top-level block mapping, created at the end of the file
 * when missing). Returns the new text, or the same text when the value is already equal.
 */
export function setNestedEntry(text: string, top: string, key: string, value: unknown): string {
  const doc = parseYaml(text);
  const root = rootMap(doc);
  const topPair = findPair(root, top);
  if (!topPair) {
    const sep = text.length && !text.endsWith('\n') ? '\n' : '';
    return `${text}${sep}${top}:\n${block(key, value, 2)}`;
  }
  const map = topPair.value;
  if (map === null || (isScalar(map) && (map.value === null || map.value === undefined))) {
    const [start, end] = pairRange(text, topPair);
    const indent = (topPair.key as { range: [number] }).range[0] - start;
    return `${text.slice(0, start)}${' '.repeat(indent)}${top}:\n${block(key, value, indent + 2)}${text.slice(end)}`;
  }
  if (!isMap(map) || map.flow) throw new Error(`${top} is not a block mapping; edit it by hand`);
  const existing = findPair(map, key);
  if (existing && sameValue((doc.toJS() as Record<string, Record<string, unknown>>)[top]?.[key], value)) return text;
  const first = map.items[0];
  const indent = first ? (first.key as { range: [number] }).range[0] - lineStart(text, (first.key as { range: [number] }).range[0]) : 2;
  if (existing) {
    const [start, end] = pairRange(text, existing);
    return `${text.slice(0, start)}${block(key, value, indent)}${text.slice(end)}`;
  }
  const insertAt = map.items.length ? pairRange(text, map.items.at(-1) as Pair)[1] : lineEnd(text, (topPair.key as { range: [number, number, number] }).range[2]);
  const sep = insertAt === text.length && text.length && !text.endsWith('\n') ? '\n' : '';
  return `${text.slice(0, insertAt)}${sep}${block(key, value, indent)}${text.slice(insertAt)}`;
}

/** Removes `<top>.<key>` with its whole block; unchanged text when absent. */
export function removeNestedEntry(text: string, top: string, key: string): string {
  const map = findPair(rootMap(parseYaml(text)), top)?.value;
  if (!isMap(map) || map.flow) return text;
  const pair = findPair(map, key);
  if (!pair) return text;
  const [start, end] = pairRange(text, pair);
  return `${text.slice(0, start)}${text.slice(end)}`;
}

/** Appends `item` to the block sequence at `<top>.<key>` (no-op when present or not a block sequence). */
export function appendToSequence(text: string, top: string, key: string, item: string): string {
  const map = findPair(rootMap(parseYaml(text)), top)?.value;
  if (!isMap(map)) return text;
  const seq = findPair(map, key)?.value as YAMLSeq | undefined;
  if (!isSeq(seq) || seq.flow || !seq.items.length) return text;
  if (seq.items.some(entry => isScalar(entry) && entry.value === item)) return text;
  const first = seq.items[0] as { range: [number, number, number] };
  const dash = text.lastIndexOf('-', first.range[0]);
  const indent = dash - lineStart(text, dash);
  const last = seq.items.at(-1) as { range: [number, number, number] };
  const insertAt = lineEnd(text, last.range[2]);
  const sep = insertAt === text.length && !text.endsWith('\n') ? '\n' : '';
  return `${text.slice(0, insertAt)}${sep}${' '.repeat(indent)}- ${item}\n${text.slice(insertAt)}`;
}
