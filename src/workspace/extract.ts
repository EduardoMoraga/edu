/**
 * Knowledge extraction for `edu create`: documents in, a structured extraction out.
 *
 * - `extractDeterministic` (`--no-llm`): splits Markdown/text by headings into verified notes whose
 *   source is `file#heading`; the text before the first section becomes an overview note.
 * - `extractWithLlm`: asks the person's installed CLI (headless, injectable runner) for strict JSON,
 *   validates it with zod, retries once with the validation error, chunks large inputs and merges
 *   the chunks (deduplicating titles, playbooks and glossary terms). It throws `ExtractionError` when
 *   both attempts fail so the caller can fall back to the deterministic path.
 */
import { z } from 'zod';
import type { Lang } from '../cli/i18n.js';
import type { SourceDocument } from './readers.js';

export const NOTE_KINDS = ['standard', 'decision', 'glossary', 'process', 'fact', 'person', 'client'] as const;

export const ExtractionSchema = z.object({
  identity: z.object({ name: z.string(), role: z.string(), tone: z.string(), summary: z.string() }),
  notes: z.array(z.object({
    title: z.string().trim().min(1), kind: z.enum(NOTE_KINDS), body: z.string().trim().min(1),
    band: z.enum(['verified', 'inferred']), source: z.string(),
  })),
  playbooks: z.array(z.object({ name: z.string().trim().min(1), title: z.string().trim().min(1), steps: z.array(z.string().trim().min(1)).min(1) })),
  glossary: z.array(z.object({ term: z.string().trim().min(1), meaning: z.string().trim().min(1) })),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
/** `overview` is the deterministic intro note; it becomes the canonical identity/overview note. */
export type ExtractedNote = Omit<Extraction['notes'][number], 'kind'> & { kind: Extraction['notes'][number]['kind'] | 'overview' };
export interface KnowledgeExtraction extends Omit<Extraction, 'notes'> { notes: ExtractedNote[] }

/** Runs one headless prompt and resolves the model's final text. */
export type LlmRunner = (prompt: string) => Promise<string>;

export class ExtractionError extends Error {}

// ─── Deterministic (--no-llm) ─────────────────────────────────────────────────

interface Heading { level: number; text: string; line: number }

function headings(lines: string[]): Heading[] {
  const found: Heading[] = [];
  let fence = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) found.push({ level: match[1]!.length, text: match[2]!.replace(/[*_`]/g, '').trim(), line: index });
  });
  return found;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '');
const firstParagraph = (text: string) => text.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !p.startsWith('#') && !p.startsWith('|')) ?? '';
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Heading-guessed kind: glossary and process sections are labelled; everything else is a fact. */
function guessKind(title: string): ExtractedNote['kind'] {
  if (/glosario|glossary|t[eé]rminos|terminolog|definiciones|definitions/i.test(title)) return 'glossary';
  if (/proceso|procedimiento|process|procedure|paso a paso|step|checklist|flujo|workflow/i.test(title)) return 'process';
  if (/cliente|client|customer|cuenta|account/i.test(title)) return 'client';
  if (/equipo|team|personas|people|contacto|contacts|roles/i.test(title)) return 'person';
  if (/regla|norma|pol[ií]tica|policy|rule|standard|est[aá]ndar|criterio/i.test(title)) return 'standard';
  if (/decisi[oó]n|decision/i.test(title)) return 'decision';
  return 'fact';
}

/** Splits one document into notes. A single leading `#` title names the document; its sections split the rest. */
export function splitDocument(doc: Pick<SourceDocument, 'name' | 'text'>): { title: string; notes: ExtractedNote[] } {
  const lines = doc.text.split('\n');
  const all = headings(lines);
  let title = stem(doc.name);
  let sections = all;
  let introStart = 0;
  if (all[0] && all[0].level === 1 && all.filter(h => h.level === 1).length === 1 && all.length > 1) {
    title = all[0].text;
    sections = all.slice(1);
    introStart = all[0].line + 1;
  }
  const splitLevel = sections.length ? Math.min(...sections.map(h => h.level)) : 0;
  const cuts = sections.filter(h => h.level === splitLevel);
  const notes: ExtractedNote[] = [];
  const intro = lines.slice(introStart, cuts[0]?.line ?? lines.length).join('\n').trim();
  if (intro) notes.push({ title, kind: 'overview', body: intro, band: 'verified', source: doc.name });
  cuts.forEach((cut, index) => {
    const body = lines.slice(cut.line + 1, cuts[index + 1]?.line ?? lines.length).join('\n').trim();
    if (body) notes.push({ title: cut.text, kind: guessKind(cut.text), body, band: 'verified', source: `${doc.name}#${cut.text}` });
  });
  return { title, notes };
}

/** `--no-llm`: deterministic, offline, verifiable. */
export function extractDeterministic(docs: Array<Pick<SourceDocument, 'name' | 'text'>>, agentName: string): KnowledgeExtraction {
  const split = docs.map(splitDocument);
  const overview = split.flatMap(s => s.notes).find(n => n.kind === 'overview');
  const summary = clip(firstParagraph(overview?.body ?? docs[0]?.text ?? '').replace(/\s+/g, ' '), 400);
  const merged = mergeExtractions(split.map(s => ({ identity: { name: agentName, role: '', tone: '', summary: '' }, notes: s.notes, playbooks: [], glossary: [] })));
  return { ...merged, identity: { name: agentName, role: '', tone: '', summary } };
}

// ─── Merge ────────────────────────────────────────────────────────────────────

const key = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Merges chunk extractions: first non-empty identity fields win; notes with the same title merge bodies. */
export function mergeExtractions(parts: KnowledgeExtraction[]): KnowledgeExtraction {
  const identity = { name: '', role: '', tone: '', summary: '' };
  const notes = new Map<string, ExtractedNote>();
  const playbooks = new Map<string, Extraction['playbooks'][number]>();
  const glossary = new Map<string, Extraction['glossary'][number]>();
  for (const part of parts) {
    for (const field of ['name', 'role', 'tone', 'summary'] as const) if (!identity[field] && part.identity[field]?.trim()) identity[field] = part.identity[field].trim();
    for (const note of part.notes) {
      const id = key(note.title);
      const prior = notes.get(id);
      if (!prior) { notes.set(id, { ...note }); continue; }
      if (!prior.body.includes(note.body)) prior.body = `${prior.body}\n\n${note.body}`;
      if (note.band === 'inferred') prior.band = 'inferred';
      if (note.source && !prior.source.split('; ').includes(note.source)) prior.source = `${prior.source}; ${note.source}`;
    }
    for (const playbook of part.playbooks) if (!playbooks.has(key(playbook.name))) playbooks.set(key(playbook.name), playbook);
    for (const entry of part.glossary) if (!glossary.has(key(entry.term))) glossary.set(key(entry.term), entry);
  }
  return { identity, notes: [...notes.values()], playbooks: [...playbooks.values()], glossary: [...glossary.values()] };
}

// ─── LLM ──────────────────────────────────────────────────────────────────────

export const DEFAULT_CHUNK_CHARS = 24_000;

/** Packs documents into chunks of at most `max` characters, cutting at headings, then paragraphs, then hard. */
export function chunkDocuments(docs: Array<Pick<SourceDocument, 'name' | 'text'>>, max = DEFAULT_CHUNK_CHARS): string[] {
  const pieces: string[] = [];
  for (const doc of docs) {
    const header = `=== FILE: ${doc.name} ===\n`;
    const budget = Math.max(500, max - header.length - 50);
    const units = doc.text.split(/\n(?=#{1,6}\s)/).flatMap(section => section.length <= budget ? [section]
      : section.split(/\n\s*\n/).flatMap(paragraph => paragraph.length <= budget ? [paragraph]
        : Array.from({ length: Math.ceil(paragraph.length / budget) }, (_, i) => paragraph.slice(i * budget, (i + 1) * budget))));
    let current = '';
    for (const unit of units) {
      if (current && current.length + unit.length + 2 > budget) { pieces.push(header + current); current = ''; }
      current = current ? `${current}\n\n${unit}` : unit;
    }
    if (current.trim()) pieces.push(header + current);
  }
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > max) { chunks.push(current); current = ''; }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function extractionPrompt(chunk: string, opts: { agentName: string; lang: Lang; part: number; parts: number }): string {
  const language = opts.lang === 'es' ? 'Spanish' : 'English';
  return [
    `You are building the knowledge base of a workspace agent named "${opts.agentName}". Read the documents below (part ${opts.part} of ${opts.parts}) and extract what an agent must know to work in this operation.`,
    '',
    'Return ONLY one JSON object, no prose and no code fences, matching exactly:',
    '{"identity":{"name":string,"role":string,"tone":string,"summary":string},',
    ' "notes":[{"title":string,"kind":"standard"|"decision"|"glossary"|"process"|"fact"|"person"|"client","body":string,"band":"verified"|"inferred","source":string}],',
    ' "playbooks":[{"name":string,"title":string,"steps":[string]}],',
    ' "glossary":[{"term":string,"meaning":string}]}',
    '',
    'Rules:',
    `- identity.name is "${opts.agentName}". role: the agent's role in this operation in one line. tone: how it should speak. summary: the operation in 2-3 sentences.`,
    '- One note per durable topic (clients, channels, KPIs, rules, people, decisions, facts). Titles are short and unique. Body is self-contained Markdown, faithful to the source.',
    '- band "verified" only when the document states it; "inferred" for your interpretation or synthesis.',
    '- source is "<file name>#<section heading>" from the FILE markers and headings.',
    '- playbooks: repeatable procedures with ordered steps; name is a short kebab-case id.',
    '- glossary: acronyms and internal terms with their meaning.',
    `- Write titles, bodies and steps in ${language}. Do not invent facts. Empty arrays are fine.`,
    '',
    chunk,
  ].join('\n');
}

/** Parses a model answer: strips code fences and surrounding prose, then validates. */
export function parseExtraction(answer: string): Extraction {
  const text = answer.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ExtractionError('the answer contains no JSON object');
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); }
  catch (error) { throw new ExtractionError(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const parsed = ExtractionSchema.safeParse(raw);
  if (!parsed.success) throw new ExtractionError(`schema mismatch: ${parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`);
  return parsed.data;
}

export interface LlmExtractOptions {
  agentName: string;
  lang: Lang;
  chunkChars?: number;
  onChunk?: (part: number, parts: number) => void;
}

/** One validated extraction per chunk (one retry with the error), merged. Throws ExtractionError. */
export async function extractWithLlm(docs: Array<Pick<SourceDocument, 'name' | 'text'>>, run: LlmRunner, opts: LlmExtractOptions): Promise<KnowledgeExtraction> {
  const chunks = chunkDocuments(docs, opts.chunkChars);
  const parts: KnowledgeExtraction[] = [];
  for (const [index, chunk] of chunks.entries()) {
    opts.onChunk?.(index + 1, chunks.length);
    const prompt = extractionPrompt(chunk, { agentName: opts.agentName, lang: opts.lang, part: index + 1, parts: chunks.length });
    let result: Extraction;
    try { result = parseExtraction(await run(prompt)); }
    catch (first) {
      const reason = first instanceof Error ? first.message : String(first);
      try { result = parseExtraction(await run(`${prompt}\n\nYour previous answer was rejected (${reason}). Answer again with ONLY the JSON object.`)); }
      catch (second) { throw new ExtractionError(`chunk ${index + 1}/${chunks.length}: ${second instanceof Error ? second.message : String(second)}`); }
    }
    parts.push(result);
  }
  const merged = mergeExtractions(parts);
  return { ...merged, identity: { ...merged.identity, name: opts.agentName } };
}
