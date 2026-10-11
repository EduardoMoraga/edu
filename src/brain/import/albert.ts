import { readFile, stat } from 'node:fs/promises';
import { basename, join, relative as nodeRelative, resolve } from 'node:path';
import type { ClaimBand, Note, NoteMeta } from '../../core/contracts.js';
import type { Brain, NewNote } from '../brain.js';
import { parseMarkdownLenient } from '../frontmatter.js';
import { createId, slugify } from '../store.js';
import { asTransitiveKind, canonicalKind, mapStatus, markdownFiles, type ImportMetadata } from './shared.js';
import type { ImportReport } from './types.js';

export function albertPathSegments(root: string, file: string, relativePath = nodeRelative): string[] {
  return relativePath(root, file).split(/[\\/]/).filter(Boolean);
}

const ALBERT_LAYERS = ['1-CANONICO', '2-EPISODICO', '3-TRANSITIVO'] as const;
const SOURCE = 'import:albert';
/** Albert relation keys: preserved verbatim under `albert:` and translated to Edu ids in links / supersedes. */
const RELATION_KEYS = ['produjo', 'cerro', 'revierte', 'revertida_por'] as const;

async function isDir(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}
async function hasLayers(dir: string): Promise<boolean> {
  for (const layer of ALBERT_LAYERS) if (await isDir(join(dir, layer))) return true;
  return false;
}

/**
 * The `_ALBERT` folder to import from. Accepts the vault folder that contains `_ALBERT`, the `_ALBERT`
 * folder itself, or any folder holding the layer folders (`1-CANONICO`, `2-EPISODICO`, `3-TRANSITIVO`) directly.
 */
export async function resolveAlbertRoot(sourceRoot: string): Promise<string> {
  const source = resolve(sourceRoot);
  const nested = join(source, '_ALBERT');
  if (await hasLayers(nested)) return nested;
  if (await hasLayers(source)) return source;
  throw new Error(`No Albert vault found at ${source}: expected ${nested} with ${ALBERT_LAYERS.join(', ')} inside, or those folders directly in ${source}. Pass the folder that contains _ALBERT, or _ALBERT itself.`);
}

/** `D-010` from `D-010_slug.md` (A-, C-, D-, H-, L- correlatives). */
export function albertCorrelative(file: string): string | undefined {
  const match = /^([DHCAL])-(\d+)(?=[_\-. ]|$)/i.exec(basename(file));
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : undefined;
}

const asList = (value: unknown): string[] => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
  .filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean);

interface Planned {
  path: string;
  /** Path inside `_ALBERT`, with `/` separators on every platform. */
  rel: string;
  raw: string;
  meta: Record<string, unknown>;
  body: string;
  invalid: boolean;
  mapping: Pick<NewNote, 'tier' | 'kind' | 'status'>;
  extra: ImportMetadata;
  title: string;
  legacyId?: string;
  /** The Edu note this source note is (or will be) written as. */
  eduId: string;
  /** The Edu filename stem Obsidian resolves (`[[stem]]`), when it is known before writing. */
  eduStem?: string;
  existing?: Note;
}

function classify(segments: string[]): Pick<NewNote, 'tier' | 'kind' | 'status'> {
  if (segments[0] === '1-CANONICO') return { tier: 'canonical', kind: canonicalKind(({ estandares: 'standard', lexico: 'lexicon', negocio: 'domain', personas: 'person' } as Record<string, string>)[segments[1] ?? ''] ?? segments[1]), status: 'proposed' };
  if (segments[0] === '2-EPISODICO') return { tier: 'episodic', kind: 'session' };
  const prefix = /^([DHCAL])-/i.exec(segments.at(-1) ?? '')?.[1]?.toUpperCase() ?? 'L';
  return { tier: 'transitive', kind: asTransitiveKind(prefix) };
}

function normalize(meta: Record<string, unknown>, body: string, segments: string[]): ImportMetadata {
  const rawType = String(meta.tipo ?? '').toLowerCase();
  const status = String(meta.estado ?? '').toLowerCase();
  const confidence: Record<string, ClaimBand> = { alta: 'verified', media: 'inferred', baja: 'hypothesis' };
  const canonical = segments[0] === '1-CANONICO';
  const episodic = segments[0] === '2-EPISODICO';
  const prefix = /^([DHCAL])-/i.exec(segments.at(-1) ?? '')?.[1]?.toUpperCase();
  const kind = rawType || ({ D: 'decision', H: 'hipotesis', C: 'compromiso', A: 'aprendizaje', L: 'aprendizaje' } as Record<string, string>)[prefix ?? ''];
  const statusMap: Record<string, string> = canonical ? { '': 'accepted', aceptada: 'accepted', aceptado: 'accepted' } : kind === 'hipotesis' || kind === 'hypothesis' ? { '': 'open', abierta: 'open', confirmada: 'confirmed', refutada: 'refuted', sin_evidencia: 'no-evidence' } : kind === 'compromiso' || kind === 'commitment' ? { '': 'pending', pendiente: 'pending', entregado: 'delivered', vencido: 'overdue' } : kind === 'decision' ? { '': 'active', vigente: 'active', revertida: 'reverted' } : kind === 'aprendizaje' || kind === 'lesson' ? { '': 'proven', proven: 'proven', permanente: 'proven' } : {};
  const summary = typeof meta.resumen === 'string' ? meta.resumen.trim() : '';
  const noteBody = summary && !body.includes(summary) ? `> ${summary.replaceAll('\n', '\n> ')}\n\n${body}` : undefined;
  const sourceDetail = typeof meta.fuente === 'string' && meta.fuente ? `${SOURCE} · ${meta.fuente}` : SOURCE;
  const band = typeof meta.banda === 'string' && ['verified', 'inferred', 'hypothesis'].includes(meta.banda) ? meta.banda as ClaimBand : confidence[String(meta.confianza ?? '').toLowerCase()];
  return {
    ...(typeof meta.titulo === 'string' ? { title: meta.titulo } : {}), ...(noteBody ? { body: noteBody } : {}), source: sourceDetail,
    ...(band ? { band } : {}), ...(typeof meta.fecha === 'string' ? { created: meta.fecha } : {}), ...(typeof meta.actualizado === 'string' ? { updated: meta.actualizado } : {}),
    ...(typeof meta.dueño === 'string' ? { owner: meta.dueño } : typeof meta.owner === 'string' ? { owner: meta.owner } : {}),
    ...(typeof meta.plazo === 'string' ? { due: meta.plazo } : typeof meta.due === 'string' ? { due: meta.due } : {}),
    ...(Array.isArray(meta.tags) ? { tags: meta.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
    status: episodic ? (status === 'borrador' ? 'open-session' : 'closed') : kind === 'aprendizaje' || kind === 'lesson' ? 'proven' : statusMap[status] ?? (canonical ? 'accepted' : undefined), acceptedCanonical: canonical,
  };
}

/** The Edu filename stem of a note written from this plan, when it does not depend on the write time. */
function plannedStem(tier: NewNote['tier'], eduId: string, title: string): string | undefined {
  if (tier === 'transitive') return eduId;
  if (tier === 'canonical') return slugify(title);
  return undefined;
}

/**
 * Rewrites `[[D-010]]`, `[[D-010_slug]]` and `[[D-010_slug#heading|text]]` to the imported note's Edu filename
 * stem, keeping what the reader saw as the display text. Links to notes outside the vault are left untouched
 * (the target's aliases still resolve `[[D-010]]` in Obsidian when it is imported later).
 */
export function rewriteWikilinks(body: string, resolveTarget: (target: string) => Planned | undefined): { body: string; targets: string[] } {
  const targets: string[] = [];
  const rewritten = body.replace(/\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (whole, target: string, heading: string | undefined, display: string | undefined) => {
    const planned = resolveTarget(target.trim());
    // Sessions get their id when written, so links to a session not yet in the brain stay as they are.
    if (!planned?.eduStem) return whole;
    targets.push(planned.eduId);
    return `[[${planned.eduStem}${heading ?? ''}|${display ?? target.trim()}]]`;
  });
  return { body: rewritten, targets };
}

/** Already imported: same origin, or (imports made before origins were recorded) same source, kind and title. */
function findExisting(notes: Note[], origin: string, mapping: Pick<NewNote, 'tier' | 'kind'>, title: string): Note | undefined {
  return notes.find(note => note.meta.origin === origin)
    ?? notes.find(note => !note.meta.origin && note.meta.source?.startsWith(SOURCE) && note.meta.tier === mapping.tier && note.meta.kind === mapping.kind && note.meta.title === title);
}

export async function importAlbert(sourceRoot: string, brain: Brain): Promise<ImportReport> {
  const root = await resolveAlbertRoot(sourceRoot);
  const files = [
    ...(await markdownFiles(join(root, '1-CANONICO'))),
    ...(await markdownFiles(join(root, '2-EPISODICO'))),
    ...(await markdownFiles(join(root, '3-TRANSITIVO'))),
  ];
  const report: ImportReport = { source: SOURCE, imported: [], skipped: [], errors: [], warnings: [] };
  const existingNotes = await brain.list();

  // Pass 1: parse every file and decide its Edu id, so relations and wikilinks can be translated before
  // anything is written (closed sessions and accepted canonical notes are immutable once written).
  const plans: Planned[] = [];
  for (const path of files) {
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = parseMarkdownLenient<Record<string, unknown>>(raw);
      const meta = parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta) ? parsed.meta : {};
      const segments = albertPathSegments(root, path);
      const mapping = classify(segments);
      const extra = normalize(meta, parsed.body, segments);
      const title = String(extra.title ?? meta.title ?? basename(path, '.md').replace(/^[DHCAL]-(\d+[_-])?/i, '').replace(/[-_]/g, ' ')).trim() || basename(path, '.md');
      const legacyId = albertCorrelative(path);
      const rel = segments.join('/');
      const existing = findExisting(existingNotes, `albert:${rel}`, mapping, title);
      const eduId = existing?.meta.id ?? createId({ tier: mapping.tier!, kind: mapping.kind, title, legacy_id: legacyId });
      const eduStem = existing ? basename(existing.path, '.md') : plannedStem(mapping.tier!, eduId, title);
      plans.push({ path, rel, raw, meta, body: parsed.body, invalid: parsed.recovered, mapping, extra, title, ...(legacyId ? { legacyId } : {}), eduId, ...(eduStem ? { eduStem } : {}), ...(existing ? { existing } : {}) });
    } catch (error) { report.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const byLegacy = new Map<string, Planned>();
  const byStem = new Map<string, Planned>();
  for (const plan of plans) {
    if (plan.legacyId) {
      if (byLegacy.has(plan.legacyId)) report.warnings.push(`${plan.path}: duplicate correlative ${plan.legacyId} (links resolve to ${byLegacy.get(plan.legacyId)!.rel})`);
      else byLegacy.set(plan.legacyId, plan);
    }
    const stem = basename(plan.rel, '.md').toLowerCase();
    if (!byStem.has(stem)) byStem.set(stem, plan);
  }
  const lookup = (reference: string): Planned | undefined => {
    const key = reference.trim();
    return byLegacy.get(key.toUpperCase()) ?? byStem.get(key.replace(/\.md$/i, '').toLowerCase());
  };
  const translate = (values: unknown): string[] => asList(values).map(value => lookup(value)).filter(plan => plan?.eduStem).map(plan => plan!.eduId);

  // Pass 2: write, or skip what is already in the brain.
  for (const plan of plans) {
    const { path, meta, mapping, extra } = plan;
    try {
      if (plan.existing) {
        await backfill(brain, plan);
        report.skipped.push(path);
        continue;
      }
      const relations = Object.fromEntries(RELATION_KEYS.filter(key => meta[key] !== undefined && meta[key] !== null && meta[key] !== '').map(key => [key, meta[key]]));
      const revierte = asList(meta.revierte).filter(value => value.toLowerCase() !== 'ninguna');
      const supersedes = translate(revierte)[0];
      const supersededBy = translate(meta.revertida_por)[0];
      // Invalid YAML: the lenient parser salvages keys for classification, but nothing it could not read may be
      // lost, so the whole source text becomes the body and the note is marked for review.
      if (plan.invalid) report.warnings.push(`${path}: invalid-frontmatter (YAML could not be parsed; the raw text was kept as the body)`);
      const sourceBody = plan.invalid ? plan.raw.replace(/\r\n/g, '\n').trim() : (extra.body ?? plan.body).trim() || plan.raw.trim();
      const { body, targets } = plan.invalid ? { body: sourceBody, targets: [] } : rewriteWikilinks(sourceBody, lookup);
      const links = [...new Set([...translate(meta.produjo), ...translate(meta.cerro), ...(supersedes ? [supersedes] : []), ...(supersededBy ? [supersededBy] : []), ...targets])].filter(id => id !== plan.eduId);
      const aliases = plan.legacyId ? [...new Set([plan.legacyId, basename(plan.rel, '.md')])] : [];
      const input: NewNote = {
        title: plan.title, body, tier: mapping.tier ?? 'transitive', kind: mapping.kind ?? 'lesson',
        tags: extra.tags ?? (Array.isArray(meta.tags) ? meta.tags.filter((tag): tag is string => typeof tag === 'string') : []), links,
        status: (extra.acceptedCanonical ? 'proposed' : extra.status ?? mapStatus(meta.status) ?? mapping.status) as NoteMeta['status'],
        band: extra.band, owner: extra.owner, due: extra.due, supersedes, created: extra.created, updated: extra.updated, source: extra.source ?? SOURCE,
        historical: true,
        provenance: {
          origin: `albert:${plan.rel}`, aliases, legacy_id: plan.legacyId, superseded_by: supersededBy,
          ...(Object.keys(relations).length ? { albert: relations } : {}),
          ...(plan.invalid ? { import_warning: 'invalid-frontmatter' as const } : {}),
        },
      };
      for (const key of ['status', 'owner', 'due', 'band', 'supersedes', 'created', 'updated'] as const) if (!input[key]) delete input[key];
      const note = await brain.write(input);
      report.imported.push(extra.acceptedCanonical && note.meta.tier === 'canonical' ? await brain.acceptCanonical(note.meta.id) : note);
    } catch (error) { report.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return report;
}

/** Notes imported before ids were preserved get their correlative, aliases and origin (only when still mutable). */
async function backfill(brain: Brain, plan: Planned): Promise<void> {
  const note = plan.existing!;
  if (note.meta.origin || note.meta.tier !== 'transitive') return;
  const patch: Partial<NoteMeta> = { origin: `albert:${plan.rel}` };
  if (plan.legacyId && !note.meta.legacy_id) {
    patch.legacy_id = plan.legacyId;
    patch.aliases = [...new Set([...(note.meta.aliases ?? []), plan.legacyId, basename(plan.rel, '.md')])];
  }
  await brain.update(note.meta.id, patch);
}
