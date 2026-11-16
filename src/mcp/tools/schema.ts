/** Argument schemas shared by the MCP tools, and the leaner twins published in tools/list. */
import { z } from 'zod';

/**
 * Published (tools/list) schema of a field when it differs from the validating one. `z.number().int()` publishes
 * `maximum: 9007199254740991` on every integer; the published twin says `integer` with the same bounds the strict
 * schema enforces, without that noise. Arguments are always validated with the strict schema.
 */
const published = new WeakMap<z.ZodType, z.ZodType>();

/** The schema tools/list shows for a field: its published twin when it has one, else the field itself. */
export const publishedSchema = (schema: z.ZodType): z.ZodType => published.get(schema) ?? schema;

export function optionalInt(min: number, max?: number, description?: string) {
  let strict = z.number().int().min(min);
  if (max !== undefined) strict = strict.max(max);
  const optional = description ? strict.optional().describe(description) : strict.optional();
  const twin = z.number().meta({ type: 'integer', minimum: min, ...(max !== undefined ? { maximum: max } : {}) }).optional();
  published.set(optional, description ? twin.describe(description) : twin);
  return optional;
}
export const tokenLimit = optionalInt(1);
/** An optional number in [min, max]; out-of-range values reach the strict schema, which names the bound. */
export function optionalNumber(min: number, max: number, description: string) {
  const strict = z.number().min(min).max(max).optional().describe(description);
  published.set(strict, z.number().meta({ minimum: min, maximum: max }).optional().describe(description));
  return strict;
}
/**
 * edu_recall `alt`: up to 3 more phrasings, fused with the query. The tool list is paid on every session, so the
 * published twin states the limit in its description instead of `maxItems` and per-item `minLength`.
 */
export const altQueries = z.array(z.string().min(1)).max(3).optional();
published.set(altQueries, z.array(z.string()).optional().describe('Up to 3 rephrasings or translations (e.g. Spanish, English)'));
export const bands = z.enum(['verified', 'inferred', 'hypothesis']);
export const tiers = z.enum(['canonical', 'episodic', 'transitive']);
export const transitiveKinds = z.enum(['decision', 'hypothesis', 'commitment', 'lesson']);
export const canonicalKinds = z.enum(['identity', 'standard', 'lexicon', 'domain', 'person', 'preference']);
export const cliIds = z.enum(['claude', 'codex', 'pi', 'opencode', 'agy']);
export const autonomyLevels = z.enum(['readonly', 'ask', 'auto', 'full']);
