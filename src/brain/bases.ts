/**
 * Obsidian Bases and the Home dashboard Edu generates for a brain.
 *
 * Syntax follows https://obsidian.md/help/bases/syntax and https://obsidian.md/help/bases/functions:
 * top-level `filters`/`formulas`/`properties`/`views`, `properties.<p>.displayName` for column headers,
 * per-view `filters`/`order`, formulas as expression strings. Per-view `sort` ([{property, direction}])
 * is not in the help pages; it is what Obsidian's own view parser reads and writes (checked in the
 * 1.14 app bundle). Embeds use `![[File.base#View]]` (https://obsidian.md/help/bases/views).
 *
 * Pure functions only: brain.ts decides where the files go.
 */
import { parse, stringify } from 'yaml';
import { TIER_DIRS, type Tier } from '../core/contracts.js';

export type BaseLang = 'en' | 'es';

/**
 * Orchestrator: the brain sits directly under the vault root (e.g. `01-CONOCIMIENTO`), so its Bases look
 * across the whole vault by tier folder and kind, and add a project column. Workspace: filter by the
 * brain's own vault-relative folder (`brainRel`; the fallback path when there is no vault).
 */
export type BaseScope = { mode: 'orchestrator'; brainRel: string } | { mode: 'workspace'; brainRel: string };

export interface GeneratedFile { name: string; content: string }

type BaseId = 'knowledge' | 'decisions' | 'lessons' | 'hypotheses' | 'commitments' | 'sessions';
type ViewId = 'all' | 'proposed' | 'active' | 'proven' | 'open' | 'pending' | 'overdue' | 'recent';

interface BaseSpec {
  id: BaseId;
  tier: Tier;
  /** Note kind filter; knowledge filters by tier instead. */
  kind?: string;
  columns: string[];
  sort: { property: string; direction: 'ASC' | 'DESC' };
  views: Array<{ id: ViewId; status?: string }>;
}

const SPECS: BaseSpec[] = [
  { id: 'knowledge', tier: 'canonical', columns: ['kind', 'status', 'band', 'updated', 'tags'], sort: { property: 'updated', direction: 'DESC' }, views: [{ id: 'all' }, { id: 'proposed', status: 'proposed' }] },
  { id: 'decisions', tier: 'transitive', kind: 'decision', columns: ['status', 'band', 'updated', 'tags'], sort: { property: 'updated', direction: 'DESC' }, views: [{ id: 'active', status: 'active' }, { id: 'all' }] },
  { id: 'lessons', tier: 'transitive', kind: 'lesson', columns: ['status', 'band', 'formula.wins', 'formula.losses', 'updated', 'tags'], sort: { property: 'updated', direction: 'DESC' }, views: [{ id: 'all' }, { id: 'proven', status: 'proven' }] },
  { id: 'hypotheses', tier: 'transitive', kind: 'hypothesis', columns: ['status', 'band', 'updated', 'tags'], sort: { property: 'updated', direction: 'DESC' }, views: [{ id: 'open', status: 'open' }, { id: 'all' }] },
  { id: 'commitments', tier: 'transitive', kind: 'commitment', columns: ['status', 'owner', 'due', 'tags'], sort: { property: 'due', direction: 'ASC' }, views: [{ id: 'pending', status: 'pending' }, { id: 'overdue', status: 'overdue' }, { id: 'all' }] },
  { id: 'sessions', tier: 'episodic', kind: 'session', columns: ['status', 'source', 'created'], sort: { property: 'created', direction: 'DESC' }, views: [{ id: 'recent' }] },
];

const FILES: Record<BaseLang, Record<BaseId, string>> = {
  es: { knowledge: 'Conocimiento', decisions: 'Decisiones', lessons: 'Lecciones', hypotheses: 'Hipótesis', commitments: 'Compromisos', sessions: 'Sesiones' },
  en: { knowledge: 'Knowledge', decisions: 'Decisions', lessons: 'Lessons', hypotheses: 'Hypotheses', commitments: 'Commitments', sessions: 'Sessions' },
};

const VIEWS: Record<BaseLang, Record<BaseId, Partial<Record<ViewId, string>>>> = {
  es: {
    knowledge: { all: 'Todo', proposed: 'Por aprobar' },
    decisions: { active: 'Activas', all: 'Todas' },
    lessons: { all: 'Todas', proven: 'Probadas' },
    hypotheses: { open: 'Abiertas', all: 'Todas' },
    commitments: { pending: 'Pendientes', overdue: 'Atrasados', all: 'Todos' },
    sessions: { recent: 'Recientes' },
  },
  en: {
    knowledge: { all: 'All', proposed: 'To approve' },
    decisions: { active: 'Active', all: 'All' },
    lessons: { all: 'All', proven: 'Proven' },
    hypotheses: { open: 'Open', all: 'All' },
    commitments: { pending: 'Pending', overdue: 'Overdue', all: 'All' },
    sessions: { recent: 'Recent' },
  },
};

const COLUMNS: Record<BaseLang, Record<string, string>> = {
  es: { note: 'Título', project: 'Proyecto', kind: 'Tipo', status: 'Estado', band: 'Certeza', updated: 'Actualizado', created: 'Creado', tags: 'Etiquetas', owner: 'Responsable', due: 'Vence', source: 'Origen', wins: 'Aciertos', losses: 'Fallos' },
  en: { note: 'Title', project: 'Project', kind: 'Kind', status: 'Status', band: 'Confidence', updated: 'Updated', created: 'Created', tags: 'Tags', owner: 'Owner', due: 'Due', source: 'Source', wins: 'Wins', losses: 'Losses' },
};

/** Formula keys are localized so the YAML reads naturally in the workspace language. */
const FORMULA_KEYS: Record<BaseLang, { note: string; project: string }> = { es: { note: 'titulo', project: 'proyecto' }, en: { note: 'title', project: 'project' } };

/** Base files written by Edu before v0.9 (English names, one table each). */
export const LEGACY_BASE_FILES = ['Lessons.base', 'Commitments.base', 'Hypotheses.base', 'Sessions.base'] as const;

export const baseFileName = (lang: BaseLang, id: BaseId) => `${FILES[lang][id]}.base`;

/** The Base files Edu owns in `0-index` for a language. */
export const baseFileNames = (lang: BaseLang): string[] => SPECS.map(spec => baseFileName(lang, spec.id));

/** Names to delete on rebuild: legacy files and the other language's set, never the current set. */
export function staleBaseFiles(lang: BaseLang): string[] {
  const current = new Set(baseFileNames(lang));
  return [...new Set([...LEGACY_BASE_FILES, ...baseFileNames(lang === 'es' ? 'en' : 'es')])].filter(name => !current.has(name));
}

const q = (value: string) => JSON.stringify(value);

/** Readable labels for the raw values Edu stores in frontmatter (status, band, kind). */
const VALUE_LABELS: Record<BaseLang, Record<'status' | 'band' | 'kind', Record<string, string>>> = {
  es: {
    status: { proposed: 'por aprobar', accepted: 'aceptada', superseded: 'reemplazada', active: 'activa', reverted: 'revertida', open: 'abierta', confirmed: 'confirmada', refuted: 'refutada', 'no-evidence': 'sin evidencia', pending: 'pendiente', delivered: 'entregado', overdue: 'atrasado', candidate: 'candidata', proven: 'probada', retired: 'retirada', closed: 'cerrada' },
    band: { verified: 'verificado', inferred: 'inferido', hypothesis: 'hipótesis' },
    kind: { decision: 'decisión', lesson: 'lección', hypothesis: 'hipótesis', commitment: 'compromiso', session: 'sesión', standard: 'estándar', person: 'persona', preference: 'preferencia', identity: 'identidad', domain: 'dominio', glossary: 'glosario', process: 'proceso', fact: 'hecho', client: 'cliente' },
  },
  en: {
    status: { proposed: 'to approve', 'no-evidence': 'no evidence' },
    band: {},
    kind: {},
  },
};
const DATE_FORMAT: Record<BaseLang, string> = { es: 'DD/MM/YYYY HH:mm', en: 'MMM D, YYYY HH:mm' };
const VALUE_COLUMNS = ['status', 'band', 'kind'] as const;
const DATE_COLUMNS = ['updated', 'created', 'due'] as const;

/** Formula that shows a raw frontmatter value through a label map, falling back to the raw value. */
export function labelFormula(property: string, labels: Record<string, string>): string {
  return Object.entries(labels).reduceRight((rest, [raw, label]) => `if(note.${property} == ${q(raw)}, ${q(label)}, ${rest})`, `note.${property}`);
}

/** Formula that renders a stored ISO date readably, empty when the note has none. */
export const dateFormula = (property: string, lang: BaseLang) => `if(note.${property}, date(note.${property}).format(${q(DATE_FORMAT[lang])}), "")`;

/** Formula: the workspace a note belongs to, "global" for the orchestrator brain's own notes. */
export function projectFormula(brainRel: string, tierDir: string): string {
  return `if(file.path.startsWith(${q(`${brainRel}/`)}), "global", file.path.split(${q(`/${tierDir}/`)})[0].split("/").reverse()[1])`;
}

function scopeFilters(scope: BaseScope, spec: BaseSpec): string[] {
  const tierDir = TIER_DIRS[spec.tier];
  const where = scope.mode === 'orchestrator'
    ? `file.path.contains(${q(`/${tierDir}/`)})`
    : `file.inFolder(${q(scope.brainRel ? `${scope.brainRel}/${tierDir}` : tierDir)})`;
  return [where, spec.kind ? `kind == ${q(spec.kind)}` : `tier == ${q(spec.tier)}`];
}

function buildBase(spec: BaseSpec, lang: BaseLang, scope: BaseScope): string {
  const keys = FORMULA_KEYS[lang];
  const labels = COLUMNS[lang];
  const formulas: Record<string, string> = { [keys.note]: 'file.asLink(if(note.title, note.title, file.basename))' };
  if (scope.mode === 'orchestrator') formulas[keys.project] = projectFormula(scope.brainRel, TIER_DIRS[spec.tier]);
  if (spec.id === 'lessons') { formulas.wins = 'usage.wins'; formulas.losses = 'usage.losses'; }

  const columnKey = (column: string) => column.startsWith('formula.') ? column : `note.${column}`;
  // Raw values and ISO dates are shown through localized formulas; sorting still uses the raw property.
  const display = new Map<string, string>();
  for (const column of spec.columns) {
    const key = column.replace(/^(note|formula)\./, '');
    const name = (labels[key] ?? key).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if ((VALUE_COLUMNS as readonly string[]).includes(key)) { formulas[name] = labelFormula(key, VALUE_LABELS[lang][key as typeof VALUE_COLUMNS[number]]); display.set(column, name); }
    else if ((DATE_COLUMNS as readonly string[]).includes(key)) { formulas[name] = dateFormula(key, lang); display.set(column, name); }
  }
  const order = [`formula.${keys.note}`, ...(scope.mode === 'orchestrator' ? [`formula.${keys.project}`] : []), ...spec.columns.map(column => display.has(column) ? `formula.${display.get(column)}` : columnKey(column))];
  const properties: Record<string, { displayName: string }> = {};
  for (const column of spec.columns) if (display.has(column)) properties[`formula.${display.get(column)}`] = { displayName: labels[column.replace(/^(note|formula)\./, '')]! };
  for (const key of order) {
    if (properties[key]) continue;
    const bare = key.replace(/^(note|formula)\./, '');
    const label = bare === keys.note ? labels.note! : bare === keys.project ? labels.project! : labels[bare];
    if (label) properties[key] = { displayName: label };
  }
  const views = spec.views.map(view => ({
    type: 'table',
    name: VIEWS[lang][spec.id][view.id]!,
    ...(view.status ? { filters: { and: [`status == ${q(view.status)}`] } } : {}),
    order,
    sort: [{ property: columnKey(spec.sort.property), direction: spec.sort.direction }],
  }));
  return stringify({ filters: { and: scopeFilters(scope, spec) }, formulas, properties, views }, { lineWidth: 0, aliasDuplicateObjects: false });
}

/** The full localized Base set for a brain. */
export function buildBases(lang: BaseLang, scope: BaseScope): GeneratedFile[] {
  return SPECS.map(spec => ({ name: baseFileName(lang, spec.id), content: buildBase(spec, lang, scope) }));
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

/** Frontmatter marker on a dashboard Edu owns; remove it to take the file over. */
export const DASHBOARD_MARKER = 'generated_by';
export const DASHBOARD_OWNER = 'edu';

export const DASHBOARD_PATHS: Record<BaseLang, string> = { es: '00-INICIO/Panel.md', en: '00-START/Dashboard.md' };

/** True when a file's frontmatter carries `generated_by: edu`. */
export function isEduOwned(text: string): boolean {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return false;
  try {
    const data: unknown = parse(match[1]!);
    return Boolean(data && typeof data === 'object' && (data as Record<string, unknown>)[DASHBOARD_MARKER] === DASHBOARD_OWNER);
  } catch { return false; }
}

export interface DashboardWorkspace {
  name: string;
  /** Vault-relative link target without `.md` (a start page), when the workspace has one inside the vault. */
  link?: string;
  /** Vault-relative folder when inside the vault without a start page; otherwise the absolute root. */
  path: string;
  missing?: boolean;
}

const DASH_TEXT = {
  es: {
    title: 'Panel', intro: 'Generado por Edu en cada mantenimiento. Para editarlo a mano, borra `generated_by: edu` del encabezado y Edu no lo volverá a tocar.',
    sections: [['Por aprobar', 'knowledge', 'proposed'], ['Compromisos pendientes', 'commitments', 'pending'], ['Compromisos atrasados', 'commitments', 'overdue'], ['Lecciones', 'lessons', 'all'], ['Hipótesis abiertas', 'hypotheses', 'open'], ['Decisiones activas', 'decisions', 'active']],
    workspaces: 'Espacios de trabajo', none: 'Aún no hay espacios registrados. Crea uno con `edu init` o `edu create`.', missing: 'no encontrado',
  },
  en: {
    title: 'Dashboard', intro: 'Generated by Edu on every maintenance run. To edit it by hand, remove `generated_by: edu` from the header and Edu will leave it alone.',
    sections: [['To approve', 'knowledge', 'proposed'], ['Pending commitments', 'commitments', 'pending'], ['Overdue commitments', 'commitments', 'overdue'], ['Lessons', 'lessons', 'all'], ['Open hypotheses', 'hypotheses', 'open'], ['Active decisions', 'decisions', 'active']],
    workspaces: 'Workspaces', none: 'No workspaces registered yet. Create one with `edu init` or `edu create`.', missing: 'missing',
  },
} as const;

/** The dashboard note: embeds of the orchestrator Bases (by vault path, so same-named workspace Bases never collide) and workspace links. */
export function buildDashboard(lang: BaseLang, indexRel: string, workspaces: DashboardWorkspace[]): string {
  const text = DASH_TEXT[lang];
  const lines = ['---', `${DASHBOARD_MARKER}: ${DASHBOARD_OWNER}`, '---', '', `# ${text.title}`, '', `> ${text.intro}`, ''];
  for (const [heading, id, view] of text.sections) {
    lines.push(`## ${heading}`, '', `![[${indexRel}/${baseFileName(lang, id)}#${VIEWS[lang][id][view]}]]`, '');
  }
  lines.push(`## ${text.workspaces}`, '');
  if (!workspaces.length) lines.push(text.none);
  for (const ws of [...workspaces].sort((a, b) => a.name.localeCompare(b.name))) {
    if (ws.missing) lines.push(`- ${ws.name} — \`${ws.path}\` (${text.missing})`);
    else if (ws.link) lines.push(`- [[${ws.link}|${ws.name}]]`);
    else lines.push(`- ${ws.name} — \`${ws.path}\``);
  }
  return `${lines.join('\n')}\n`;
}
