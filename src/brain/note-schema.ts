/**
 * Frontmatter validation for notes read from disk. A note file is hand-editable Markdown, so its YAML can hold
 * anything: `title: 2024` (a number), `tags: {a: 1}` (a map), or text that is not YAML at all.
 *
 * - Scalars where text is expected (numbers, booleans) are read as text: `title: 2024` is the title "2024".
 * - A single scalar where a list is expected becomes a one-item list (`tags: ops` → `["ops"]`); null items drop.
 * - A list or a map where text is expected, an unknown tier, a missing id/tier/title, invalid YAML or no
 *   frontmatter at all makes the file a *problem*: it is quarantined (reported, never loaded, never overwritten).
 *
 * Keys Edu does not know are kept verbatim. Absent optional keys stay absent (no key is invented), except `tags`
 * and `links`, which every note has (empty when missing), and `created`, which falls back to the file time.
 */
import { z } from 'zod';
import type { NoteMeta } from '../core/contracts.js';
import { parseFrontmatter } from './frontmatter.js';

const TEXT_ERROR = 'must be text, not a list or a map';
/** A YAML scalar read as text. */
const scalarText = z.union([z.string(), z.number(), z.boolean(), z.bigint()], { error: TEXT_ERROR }).transform(String);
const absent = (value: unknown) => (value === null ? undefined : value);
const optionalText = z.preprocess(absent, scalarText.optional());
const requiredText = z.preprocess(absent, z.union([z.string(), z.number(), z.boolean(), z.bigint()], {
  error: issue => (issue.input === undefined ? 'is missing' : TEXT_ERROR),
}).transform(String).refine(value => value.trim().length > 0, 'is empty'));
const asList = (value: unknown) => (Array.isArray(value) ? value.filter(item => item !== null && item !== undefined) : typeof value === 'object' && value !== null ? value : [value]);
const textList = z.preprocess(value => (value === null || value === undefined ? [] : asList(value)), z.array(scalarText, { error: 'must be a list of text' }));
const optionalList = z.preprocess(value => (value === null || value === undefined ? undefined : asList(value)), z.array(scalarText, { error: 'must be a list of text' }).optional());
const optionalMap = z.preprocess(absent, z.record(z.string(), z.unknown(), { error: 'must be a map' }).optional());

const TEXT_KEYS = ['kind', 'status', 'band', 'created', 'updated', 'source', 'owner', 'stakeholder', 'due', 'supersedes', 'superseded_by',
  'legacy_id', 'origin', 'import_warning', 'host', 'agent', 'session'] as const;

const noteMetaSchema = z.looseObject({
  id: requiredText,
  tier: z.preprocess(absent, z.enum(['canonical', 'episodic', 'transitive'], {
    error: issue => (issue.input === undefined ? 'is missing' : 'must be canonical, episodic or transitive'),
  })),
  title: requiredText,
  ...Object.fromEntries(TEXT_KEYS.map(key => [key, optionalText])) as Record<(typeof TEXT_KEYS)[number], typeof optionalText>,
  tags: textList,
  links: textList,
  aliases: optionalList,
  usage: optionalMap,
  albert: optionalMap,
});

export type NoteRead = { meta: NoteMeta; body: string } | { problem: string };

const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n', 1)[0]!.slice(0, 160);

/** Validates parsed frontmatter; `fallbackCreated` (the file time) stands in for a missing `created`. */
export function validateMeta(raw: unknown, fallbackCreated: string): { meta: NoteMeta } | { problem: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'frontmatter is not a map of fields' };
  const result = noteMetaSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || 'frontmatter'} ${issue.message}`);
    return { problem: issues.join('; ') };
  }
  const meta = Object.fromEntries(Object.entries(result.data).filter(([, value]) => value !== undefined)) as unknown as NoteMeta;
  if (!meta.created) meta.created = fallbackCreated;
  return { meta };
}

/** Parses and validates a note file's text. Never throws: what cannot be read as a note is a problem. */
export function readNoteSource(source: string, fallbackCreated: string): NoteRead {
  let parsed;
  try { parsed = parseFrontmatter<Record<string, unknown>>(source); }
  catch (error) { return { problem: `invalid YAML frontmatter: ${firstLine(error)}` }; }
  if (!parsed) return { problem: 'no frontmatter (a note needs id, tier and title)' };
  const checked = validateMeta(parsed.meta, fallbackCreated);
  return 'problem' in checked ? checked : { meta: checked.meta, body: parsed.body };
}
