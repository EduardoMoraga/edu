import {
  INDEX_DIR,
  TIER_DIRS,
  atomicWrite,
  brainPath,
  createId,
  encodeNote,
  notePath,
  overlayNotes,
  readWorkspaceSettings,
  vaultFolder,
  vaultPlacement,
  withBrainDir
} from "./chunk-MWM3NETH.js";

// src/brain/auto-maintain.ts
import { readFile } from "fs/promises";
import { join } from "path";
var AUTO_MAINTAIN_INTERVAL_MS = 10 * 60 * 1e3;
var maintainStatePath = (root) => join(root, "state", "maintain.json");
var count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
async function readMaintainState(root) {
  try {
    const raw = JSON.parse(await readFile(maintainStatePath(root), "utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    const value = raw;
    if (typeof value.lastRun !== "number" || !Number.isFinite(value.lastRun)) return null;
    return { lastRun: value.lastRun, promoted: count(value.promoted), retired: count(value.retired), overdue: count(value.overdue), changed: count(value.changed) };
  } catch {
    return null;
  }
}
async function autoMaintain(brain, root, opts = {}) {
  try {
    const now = opts.now ?? /* @__PURE__ */ new Date();
    if (!opts.force) {
      const previous = await readMaintainState(root);
      if (previous && now.getTime() - previous.lastRun < AUTO_MAINTAIN_INTERVAL_MS && now.getTime() >= previous.lastRun) return { ran: false, reason: "throttled" };
    }
    const report = await brain.maintain(now);
    const state = { lastRun: now.getTime(), promoted: report.promoted.length, retired: report.retired.length, overdue: report.overdue.length, changed: report.changed.length };
    await atomicWrite(maintainStatePath(root), `${JSON.stringify(state, null, 2)}
`);
    return { ran: true, report, state };
  } catch (error) {
    return { ran: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// src/vault/registry.ts
import { randomUUID } from "crypto";
import { mkdir, readFile as readFile2, realpath, rename, rm, writeFile } from "fs/promises";
import { basename, dirname, join as join2, resolve } from "path";
async function readProjects(eduHome) {
  let raw;
  try {
    raw = await readFile2(join2(eduHome, "projects.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { projects: [] };
    throw error;
  }
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || !("projects" in data) || !Array.isArray(data.projects) || !data.projects.every((entry) => entry && typeof entry === "object" && ["name", "root", "brain", "addedAt"].every((key) => typeof entry[key] === "string"))) {
    throw new Error(`Invalid project registry: ${join2(eduHome, "projects.json")}`);
  }
  return data;
}
async function registerProject(eduHome, projectRoot) {
  const root = await realpath(resolve(projectRoot));
  const name = basename(root);
  const brain = brainPath(await withBrainDir({ scope: "project", root: join2(root, ".edu") }));
  const registry = await readProjects(eduHome);
  const existing = registry.projects.find((entry2) => entry2.root === root);
  if (existing) return existing;
  if (registry.projects.some((entry2) => entry2.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Project name conflict in registry: ${name}`);
  }
  const entry = { name, root, brain, addedAt: (/* @__PURE__ */ new Date()).toISOString() };
  registry.projects.push(entry);
  const path = join2(eduHome, "projects.json");
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(registry, null, 2)}
`);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return entry;
}

// src/brain/lifecycle.ts
var transitions = {
  decision: ["active", "reverted"],
  hypothesis: ["open", "confirmed", "refuted", "no-evidence"],
  commitment: ["pending", "delivered", "overdue"],
  lesson: ["candidate", "proven", "retired"],
  canonical: ["proposed", "accepted", "superseded"],
  session: ["open-session", "closed"]
};
function allowedStatuses(kind) {
  return transitions[kind === void 0 ? "" : kind] ?? [];
}
function validateStatus(kind, status) {
  if (!allowedStatuses(kind).includes(status)) throw new Error(`Invalid status '${status}' for kind '${kind ?? "unknown"}'`);
}
function validateTransition(kind, from, to) {
  validateStatus(kind, to);
  if (from === to) return;
  const legal = {
    decision: ["active>reverted"],
    hypothesis: ["open>confirmed", "open>refuted", "open>no-evidence"],
    commitment: ["pending>delivered", "pending>overdue", "overdue>delivered"],
    lesson: ["candidate>proven", "candidate>retired", "proven>retired"],
    canonical: ["proposed>accepted", "accepted>superseded"],
    session: ["open-session>closed"]
  };
  if (!(legal[kind ?? ""] ?? []).includes(`${from}>${to}`)) throw new Error(`Invalid lifecycle transition ${from ?? "(new)"} -> ${to} for ${kind ?? "unknown"}`);
}
function assertDecisionReversion(meta, patch) {
  if (meta.kind === "decision" && patch.status === "reverted" && (!patch.supersedes || patch.supersedes === meta.id)) {
    throw new Error("Reverting a decision requires a distinct superseding D- note; create the new decision with supersedes");
  }
}
function isClosedEpisode(meta) {
  return meta.tier === "episodic" && meta.status === "closed";
}

// src/brain/learning.ts
function learnedWeight(usage, now = /* @__PURE__ */ new Date(), halfLifeDays = 45) {
  const stats = usage ?? { uses: 0, wins: 0, losses: 0 };
  const laplace = (stats.wins + 1) / (stats.wins + stats.losses + 2);
  const days = stats.lastUsed ? Math.max(0, (now.getTime() - Date.parse(stats.lastUsed)) / 864e5) : 0;
  return Math.max(0.25, laplace * Math.pow(0.5, days / halfLifeDays));
}
function feedbackUsage(usage, helpful, now = /* @__PURE__ */ new Date()) {
  const current = usage ?? { uses: 0, wins: 0, losses: 0 };
  return { ...current, wins: current.wins + Number(helpful), losses: current.losses + Number(!helpful), lastUsed: now.toISOString() };
}
function recordUsage(usage, now = /* @__PURE__ */ new Date()) {
  const current = usage ?? { uses: 0, wins: 0, losses: 0 };
  return { ...current, uses: current.uses + 1, lastUsed: now.toISOString() };
}
function lessonStatus(meta, now = /* @__PURE__ */ new Date()) {
  if (meta.kind !== "lesson") return meta.status;
  if (meta.status === "retired") return "retired";
  const usage = meta.usage ?? { uses: 0, wins: 0, losses: 0 };
  const weight = learnedWeight(usage, now);
  const unusedDays = usage.lastUsed ? (now.getTime() - Date.parse(usage.lastUsed)) / 864e5 : (now.getTime() - Date.parse(meta.created)) / 864e5;
  if (usage.losses >= 3 && weight < 0.35 || unusedDays >= 180) return "retired";
  if (meta.status === "proven") return "proven";
  if (usage.wins >= 3 && weight >= 0.7) return "proven";
  return meta.status ?? "candidate";
}
function overdueStatus(meta, now = /* @__PURE__ */ new Date()) {
  if (meta.kind === "commitment" && meta.status === "pending" && meta.due && Date.parse(`${meta.due.slice(0, 10)}T23:59:59.999Z`) < now.getTime()) return "overdue";
  return meta.status;
}
function applyLearning(note, now = /* @__PURE__ */ new Date()) {
  let status = lessonStatus(note.meta, now);
  status = overdueStatus({ ...note.meta, status }, now);
  return { ...note, meta: { ...note.meta, status, updated: now.toISOString() } };
}

// src/brain/search.ts
function tokenize(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en").match(/[a-z0-9]+/g) ?? [];
}
function rankNotes(query, notes, now = /* @__PURE__ */ new Date(), limit = 10) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const docs = notes.map((note) => ({ note, fields: [tokenize(note.meta.title), tokenize(note.meta.tags.join(" ")), tokenize(note.body)] }));
  const avgdl = docs.reduce((sum, doc) => sum + doc.fields[0].length * 2 + doc.fields[1].length + doc.fields[2].length, 0) / Math.max(docs.length, 1);
  const scored = docs.map(({ note, fields }) => {
    const weighted = [...fields[0], ...fields[0], ...fields[1], ...fields[2]];
    const dl = weighted.length;
    let bm25 = 0;
    const matched = [];
    for (const term of terms) {
      const df = docs.filter((doc) => doc.fields.some((field) => field.includes(term))).length;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      const tf = weighted.filter((token) => token === term).length;
      if (!tf) continue;
      matched.push(term);
      bm25 += idf * (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * dl / Math.max(avgdl, 1)));
    }
    const w = learnedWeight(note.meta.usage, now);
    return { note, score: bm25 * (0.5 + w), why: `Matched ${matched.length ? matched.join(", ") : "no terms"}; learned weight ${w.toFixed(2)}.`, matches: matched.length };
  }).filter((hit) => hit.matches > 0);
  return scored.sort((a, b) => b.score - a.score || a.note.meta.id.localeCompare(b.note.meta.id)).slice(0, Math.max(0, limit)).map(({ matches: _matches, ...hit }) => hit);
}

// src/brain/brain.ts
import { access, mkdir as mkdir2, readFile as readFile4, readdir, rm as rm3 } from "fs/promises";
import { basename as basename2, join as join4 } from "path";

// src/brain/views.ts
import { existsSync, realpathSync } from "fs";
import { readFile as readFile3, rm as rm2, rmdir } from "fs/promises";
import { homedir } from "os";
import { dirname as dirname2, isAbsolute, join as join3, relative, resolve as resolve2, sep } from "path";

// src/brain/bases.ts
import { parse, stringify } from "yaml";
var SPECS = [
  { id: "knowledge", tier: "canonical", columns: ["kind", "status", "band", "updated", "tags"], sort: { property: "updated", direction: "DESC" }, views: [{ id: "all" }, { id: "proposed", status: "proposed" }] },
  { id: "decisions", tier: "transitive", kind: "decision", columns: ["status", "band", "updated", "tags"], sort: { property: "updated", direction: "DESC" }, views: [{ id: "active", status: "active" }, { id: "all" }] },
  { id: "lessons", tier: "transitive", kind: "lesson", columns: ["status", "band", "formula.wins", "formula.losses", "updated", "tags"], sort: { property: "updated", direction: "DESC" }, views: [{ id: "all" }, { id: "proven", status: "proven" }] },
  { id: "hypotheses", tier: "transitive", kind: "hypothesis", columns: ["status", "band", "updated", "tags"], sort: { property: "updated", direction: "DESC" }, views: [{ id: "open", status: "open" }, { id: "all" }] },
  { id: "commitments", tier: "transitive", kind: "commitment", columns: ["status", "owner", "due", "tags"], sort: { property: "due", direction: "ASC" }, views: [{ id: "pending", status: "pending" }, { id: "overdue", status: "overdue" }, { id: "all" }] },
  { id: "sessions", tier: "episodic", kind: "session", columns: ["status", "source", "created"], sort: { property: "created", direction: "DESC" }, views: [{ id: "recent" }] }
];
var FILES = {
  es: { knowledge: "Conocimiento", decisions: "Decisiones", lessons: "Lecciones", hypotheses: "Hip\xF3tesis", commitments: "Compromisos", sessions: "Sesiones" },
  en: { knowledge: "Knowledge", decisions: "Decisions", lessons: "Lessons", hypotheses: "Hypotheses", commitments: "Commitments", sessions: "Sessions" }
};
var VIEWS = {
  es: {
    knowledge: { all: "Todo", proposed: "Por aprobar" },
    decisions: { active: "Activas", all: "Todas" },
    lessons: { all: "Todas", proven: "Probadas" },
    hypotheses: { open: "Abiertas", all: "Todas" },
    commitments: { pending: "Pendientes", overdue: "Atrasados", all: "Todos" },
    sessions: { recent: "Recientes" }
  },
  en: {
    knowledge: { all: "All", proposed: "To approve" },
    decisions: { active: "Active", all: "All" },
    lessons: { all: "All", proven: "Proven" },
    hypotheses: { open: "Open", all: "All" },
    commitments: { pending: "Pending", overdue: "Overdue", all: "All" },
    sessions: { recent: "Recent" }
  }
};
var COLUMNS = {
  es: { note: "T\xEDtulo", project: "Proyecto", kind: "Tipo", status: "Estado", band: "Certeza", updated: "Actualizado", created: "Creado", tags: "Etiquetas", owner: "Responsable", due: "Vence", source: "Origen", wins: "Aciertos", losses: "Fallos" },
  en: { note: "Title", project: "Project", kind: "Kind", status: "Status", band: "Confidence", updated: "Updated", created: "Created", tags: "Tags", owner: "Owner", due: "Due", source: "Source", wins: "Wins", losses: "Losses" }
};
var FORMULA_KEYS = { es: { note: "titulo", project: "proyecto" }, en: { note: "title", project: "project" } };
var LEGACY_BASE_FILES = ["Lessons.base", "Commitments.base", "Hypotheses.base", "Sessions.base"];
var baseFileName = (lang, id) => `${FILES[lang][id]}.base`;
var baseFileNames = (lang) => SPECS.map((spec) => baseFileName(lang, spec.id));
function staleBaseFiles(lang) {
  const current = new Set(baseFileNames(lang));
  return [.../* @__PURE__ */ new Set([...LEGACY_BASE_FILES, ...baseFileNames(lang === "es" ? "en" : "es")])].filter((name) => !current.has(name));
}
var q = (value) => JSON.stringify(value);
var VALUE_LABELS = {
  es: {
    status: { proposed: "por aprobar", accepted: "aceptada", superseded: "reemplazada", active: "activa", reverted: "revertida", open: "abierta", confirmed: "confirmada", refuted: "refutada", "no-evidence": "sin evidencia", pending: "pendiente", delivered: "entregado", overdue: "atrasado", candidate: "candidata", proven: "probada", retired: "retirada", closed: "cerrada" },
    band: { verified: "verificado", inferred: "inferido", hypothesis: "hip\xF3tesis" },
    kind: { decision: "decisi\xF3n", lesson: "lecci\xF3n", hypothesis: "hip\xF3tesis", commitment: "compromiso", session: "sesi\xF3n", standard: "est\xE1ndar", person: "persona", preference: "preferencia", identity: "identidad", domain: "dominio", glossary: "glosario", process: "proceso", fact: "hecho", client: "cliente" }
  },
  en: {
    status: { proposed: "to approve", "no-evidence": "no evidence" },
    band: {},
    kind: {}
  }
};
var DATE_FORMAT = { es: "DD/MM/YYYY HH:mm", en: "MMM D, YYYY HH:mm" };
var VALUE_COLUMNS = ["status", "band", "kind"];
var DATE_COLUMNS = ["updated", "created", "due"];
function labelFormula(property, labels) {
  return Object.entries(labels).reduceRight((rest, [raw, label]) => `if(note.${property} == ${q(raw)}, ${q(label)}, ${rest})`, `note.${property}`);
}
var dateFormula = (property, lang) => `if(note.${property}, date(note.${property}).format(${q(DATE_FORMAT[lang])}), "")`;
function projectFormula(brainRel, tierDir) {
  return `if(file.path.startsWith(${q(`${brainRel}/`)}), "global", file.path.split(${q(`/${tierDir}/`)})[0].split("/").reverse()[1])`;
}
function scopeFilters(scope, spec) {
  const tierDir = TIER_DIRS[spec.tier];
  const where = scope.mode === "orchestrator" ? `file.path.contains(${q(`/${tierDir}/`)})` : `file.inFolder(${q(scope.brainRel ? `${scope.brainRel}/${tierDir}` : tierDir)})`;
  return [where, spec.kind ? `kind == ${q(spec.kind)}` : `tier == ${q(spec.tier)}`];
}
function buildBase(spec, lang, scope) {
  const keys = FORMULA_KEYS[lang];
  const labels = COLUMNS[lang];
  const formulas = { [keys.note]: "file.asLink(if(note.title, note.title, file.basename))" };
  if (scope.mode === "orchestrator") formulas[keys.project] = projectFormula(scope.brainRel, TIER_DIRS[spec.tier]);
  if (spec.id === "lessons") {
    formulas.wins = "usage.wins";
    formulas.losses = "usage.losses";
  }
  const columnKey = (column) => column.startsWith("formula.") ? column : `note.${column}`;
  const display = /* @__PURE__ */ new Map();
  for (const column of spec.columns) {
    const key = column.replace(/^(note|formula)\./, "");
    const name = (labels[key] ?? key).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (VALUE_COLUMNS.includes(key)) {
      formulas[name] = labelFormula(key, VALUE_LABELS[lang][key]);
      display.set(column, name);
    } else if (DATE_COLUMNS.includes(key)) {
      formulas[name] = dateFormula(key, lang);
      display.set(column, name);
    }
  }
  const order = [`formula.${keys.note}`, ...scope.mode === "orchestrator" ? [`formula.${keys.project}`] : [], ...spec.columns.map((column) => display.has(column) ? `formula.${display.get(column)}` : columnKey(column))];
  const properties = {};
  for (const column of spec.columns) if (display.has(column)) properties[`formula.${display.get(column)}`] = { displayName: labels[column.replace(/^(note|formula)\./, "")] };
  for (const key of order) {
    if (properties[key]) continue;
    const bare = key.replace(/^(note|formula)\./, "");
    const label = bare === keys.note ? labels.note : bare === keys.project ? labels.project : labels[bare];
    if (label) properties[key] = { displayName: label };
  }
  const views = spec.views.map((view) => ({
    type: "table",
    name: VIEWS[lang][spec.id][view.id],
    ...view.status ? { filters: { and: [`status == ${q(view.status)}`] } } : {},
    order,
    sort: [{ property: columnKey(spec.sort.property), direction: spec.sort.direction }]
  }));
  return stringify({ filters: { and: scopeFilters(scope, spec) }, formulas, properties, views }, { lineWidth: 0, aliasDuplicateObjects: false });
}
function buildBases(lang, scope) {
  return SPECS.map((spec) => ({ name: baseFileName(lang, spec.id), content: buildBase(spec, lang, scope) }));
}
var DASHBOARD_MARKER = "generated_by";
var DASHBOARD_OWNER = "edu";
var DASHBOARD_PATHS = { es: "00-INICIO/Panel.md", en: "00-START/Dashboard.md" };
function isEduOwned(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return false;
  try {
    const data = parse(match[1]);
    return Boolean(data && typeof data === "object" && data[DASHBOARD_MARKER] === DASHBOARD_OWNER);
  } catch {
    return false;
  }
}
var DASH_TEXT = {
  es: {
    title: "Panel",
    intro: "Generado por Edu en cada mantenimiento. Para editarlo a mano, borra `generated_by: edu` del encabezado y Edu no lo volver\xE1 a tocar.",
    sections: [["Por aprobar", "knowledge", "proposed"], ["Compromisos pendientes", "commitments", "pending"], ["Compromisos atrasados", "commitments", "overdue"], ["Lecciones", "lessons", "all"], ["Hip\xF3tesis abiertas", "hypotheses", "open"], ["Decisiones activas", "decisions", "active"]],
    workspaces: "Espacios de trabajo",
    none: "A\xFAn no hay espacios registrados. Crea uno con `edu init` o `edu create`.",
    missing: "no encontrado"
  },
  en: {
    title: "Dashboard",
    intro: "Generated by Edu on every maintenance run. To edit it by hand, remove `generated_by: edu` from the header and Edu will leave it alone.",
    sections: [["To approve", "knowledge", "proposed"], ["Pending commitments", "commitments", "pending"], ["Overdue commitments", "commitments", "overdue"], ["Lessons", "lessons", "all"], ["Open hypotheses", "hypotheses", "open"], ["Active decisions", "decisions", "active"]],
    workspaces: "Workspaces",
    none: "No workspaces registered yet. Create one with `edu init` or `edu create`.",
    missing: "missing"
  }
};
function buildDashboard(lang, indexRel, workspaces) {
  const text = DASH_TEXT[lang];
  const lines = ["---", `${DASHBOARD_MARKER}: ${DASHBOARD_OWNER}`, "---", "", `# ${text.title}`, "", `> ${text.intro}`, ""];
  for (const [heading, id, view] of text.sections) {
    lines.push(`## ${heading}`, "", `![[${indexRel}/${baseFileName(lang, id)}#${VIEWS[lang][id][view]}]]`, "");
  }
  lines.push(`## ${text.workspaces}`, "");
  if (!workspaces.length) lines.push(text.none);
  for (const ws of [...workspaces].sort((a, b) => a.name.localeCompare(b.name))) {
    if (ws.missing) lines.push(`- ${ws.name} \u2014 \`${ws.path}\` (${text.missing})`);
    else if (ws.link) lines.push(`- [[${ws.link}|${ws.name}]]`);
    else lines.push(`- ${ws.name} \u2014 \`${ws.path}\``);
  }
  return `${lines.join("\n")}
`;
}

// src/brain/views.ts
var defaultEduHome = (primary) => primary.scope === "global" ? primary.root : resolve2(process.env.EDU_HOME || join3(homedir(), ".edu"));
var real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve2(path);
  }
};
var posix = (path) => path.split(sep).join("/");
var insideRel = (parent, child) => {
  const rel = relative(parent, child);
  return rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) ? posix(rel) : void 0;
};
function dashboardWorkspace(vault, entry) {
  if (!existsSync(entry.root)) return { name: entry.name, path: entry.root, missing: true };
  const root = real(entry.root);
  const rel = insideRel(vault, root);
  if (!rel) return { name: entry.name, path: root };
  const candidates = [`00-INICIO/${entry.name}.md`, "00-INICIO/README.md", `00-START/${entry.name}.md`, "00-START/README.md", "README.md"];
  const page = candidates.find((candidate) => existsSync(join3(root, candidate)));
  return page ? { name: entry.name, link: `${rel}/${page.replace(/\.md$/, "")}`, path: rel } : { name: entry.name, path: rel };
}
async function readText(path) {
  try {
    return await readFile3(path, "utf8");
  } catch {
    return void 0;
  }
}
async function writeObsidianViews(primary, options = {}) {
  const lang = (await readWorkspaceSettings(primary.root)).lang ?? "en";
  const placed = vaultPlacement(primary);
  const orchestrator = Boolean(placed && placed.brainRel && !placed.brainRel.includes("/"));
  const scope = orchestrator ? { mode: "orchestrator", brainRel: placed.brainRel } : { mode: "workspace", brainRel: vaultFolder(primary, "").replace(/\/$/, "") };
  const indexDir = join3(brainPath(primary), INDEX_DIR);
  const report = { bases: [], removed: [] };
  for (const file of buildBases(lang, scope)) {
    await atomicWrite(join3(indexDir, file.name), file.content);
    report.bases.push(file.name);
  }
  for (const name of staleBaseFiles(lang)) {
    if (existsSync(join3(indexDir, name))) {
      await rm2(join3(indexDir, name), { force: true });
      report.removed.push(name);
    }
  }
  if (!orchestrator) return report;
  const vault = placed.vault;
  const target = join3(vault, ...DASHBOARD_PATHS[lang].split("/"));
  const existing = await readText(target);
  if (existing !== void 0 && !isEduOwned(existing)) {
    report.dashboard = { path: target, written: false };
    return report;
  }
  let entries = [];
  try {
    entries = await (options.projects ?? (async () => (await readProjects(defaultEduHome(primary))).projects))();
  } catch {
  }
  const content = buildDashboard(lang, `${placed.brainRel}/${INDEX_DIR}`, entries.map((entry) => dashboardWorkspace(vault, entry)));
  if (existing !== content) await atomicWrite(target, content);
  report.dashboard = { path: target, written: true };
  const other = join3(vault, ...DASHBOARD_PATHS[lang === "es" ? "en" : "es"].split("/"));
  const otherText = await readText(other);
  if (otherText !== void 0 && isEduOwned(otherText)) {
    await rm2(other, { force: true });
    await rmdir(dirname2(other)).catch(() => {
    });
  }
  return report;
}

// src/brain/brain.ts
var fallbackEdu = `# EDU

Edu is the durable, engine-independent memory contract.

- Keep canonical notes human-confirmed.
- Never edit closed session notes.
- Record decisions as new notes when they change.
`;
var iso = (d = /* @__PURE__ */ new Date()) => d.toISOString();
var defaultStatus = (tier, kind) => tier === "canonical" ? "proposed" : { decision: "active", hypothesis: "open", commitment: "pending", lesson: "candidate", session: "open-session" }[kind];
var REJECT_SOURCE = "edu:reject";
function openBrain(locations, viewOptions = {}) {
  if (!locations.length) throw new Error("openBrain requires at least one location");
  const primary = locations[0];
  const all = () => overlayNotes(locations);
  const find = async (id) => (await all()).find((note) => note.meta.id === id);
  const persist = async (note) => {
    await atomicWrite(note.path, encodeNote(note));
    return note;
  };
  const updateNote = async (id, patch, body, authority) => {
    const current = await find(id);
    if (!current) throw new Error(`Note not found: ${id}`);
    const protectedKeys = /* @__PURE__ */ new Set(["id", "tier", "kind", "created", "title", "source", "supersedes", "updated", "path"]);
    for (const [key, value] of Object.entries(patch)) {
      if (value === void 0) throw new Error(`Cannot clear '${key}' through update`);
      if (key === "supersedes" && current.meta.kind === "decision" && authority !== "revert-decision") throw new Error("Decisions are immutable; create a new D- note with supersedes instead");
      if (protectedKeys.has(key) && !(key === "supersedes" && authority === "revert-decision")) throw new Error(`Note identity field '${key}' cannot be changed through update`);
    }
    if (isClosedEpisode(current.meta)) throw new Error("Closed episodic notes are immutable");
    if (current.meta.tier === "canonical") {
      if ((current.meta.status === "accepted" || current.meta.status === "superseded") && (body !== void 0 || Object.keys(patch).some((key) => key !== "status" && key !== "updated"))) throw new Error("Accepted and superseded canonical notes are immutable");
      if (patch.status && authority !== "accept-canonical" && authority !== "supersede-canonical") throw new Error("Canonical lifecycle changes require acceptCanonical");
      if (authority === "accept-canonical" && (current.meta.status !== "proposed" || patch.status !== "accepted")) throw new Error("Only a proposed canonical note can be accepted");
      if (authority === "supersede-canonical" && (current.meta.status !== "accepted" || patch.status !== "superseded")) throw new Error("Only an accepted canonical note can be superseded");
    }
    if (current.meta.kind === "decision") {
      if (body !== void 0 || patch.title !== void 0 || patch.supersedes !== void 0 && authority !== "revert-decision") throw new Error("Decisions are immutable; create a new D- note with supersedes instead");
      if (patch.status && (authority !== "revert-decision" || patch.status !== "reverted")) throw new Error("Decision status cannot be edited; create a new D- note with supersedes");
      if (patch.status === "reverted") assertDecisionReversion(current.meta, patch);
    }
    if (patch.status && current.meta.kind) validateTransition(current.meta.tier === "canonical" ? "canonical" : current.meta.kind, current.meta.status, patch.status);
    const meta = { ...current.meta, ...patch, id: current.meta.id, tier: current.meta.tier, updated: iso() };
    return persist({ ...current, meta, body: body ?? current.body });
  };
  return {
    async init(loc, opts = {}) {
      for (const folder of ["0-index", "1-canonical", "2-episodic", "3-transitive"]) await mkdir2(join4(brainPath(loc), folder), { recursive: true });
      for (const folder of ["skills", "agents", "playbooks", "proposals", "runs"]) await mkdir2(join4(loc.root, folder), { recursive: true });
      try {
        const { resolveTemplatesDir } = await import("./adapters-SRTHQPX7.js");
        const source = join4(resolveTemplatesDir(), "playbooks");
        for (const name of await readdir(source)) {
          if (!name.endsWith(".md")) continue;
          const target = join4(loc.root, "playbooks", name);
          try {
            await access(target);
          } catch {
            await atomicWrite(target, await readFile4(join4(source, name), "utf8"));
          }
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        await access(join4(loc.root, "EDU.md"));
      } catch {
        let contract = fallbackEdu;
        try {
          const { resolveTemplatesDir } = await import("./adapters-SRTHQPX7.js");
          contract = await readFile4(join4(resolveTemplatesDir(), "EDU.md"), "utf8");
        } catch {
        }
        contract = contract.replaceAll("{{name}}", opts.identityName ?? "Edu");
        await atomicWrite(join4(loc.root, "EDU.md"), contract);
      }
    },
    async list(filter = {}) {
      return (await all()).filter((n) => Object.entries(filter).every(([key, value]) => value === void 0 || n.meta[key] === value));
    },
    read: find,
    async write(input) {
      if (input.tier === "canonical" && input.kind && !["identity", "standard", "lexicon", "domain", "person", "preference"].includes(input.kind)) {
        throw new Error(`Invalid canonical kind: ${input.kind}`);
      }
      if (input.tier === "canonical" && input.status && input.status !== "proposed") throw new Error("Canonical notes must be written as proposed; use acceptCanonical for human confirmation");
      const now = new Date(input.created ?? Date.now());
      const meta = {
        id: createId({ tier: input.tier, kind: input.kind, title: input.title }, now),
        tier: input.tier,
        title: input.title,
        ...input.kind ? { kind: input.kind } : {},
        ...input.tier === "canonical" ? { status: "proposed" } : input.status || defaultStatus(input.tier, input.kind) ? { status: input.status ?? defaultStatus(input.tier, input.kind) } : {},
        ...input.band ? { band: input.band } : {},
        tags: [.../* @__PURE__ */ new Set([...input.tags ?? [], ...input.kind ? [input.kind] : []])],
        links: input.links ?? [],
        created: iso(now),
        updated: input.updated ? iso(new Date(input.updated)) : iso(now),
        source: input.source ?? "user",
        ...input.owner ? { owner: input.owner } : {},
        ...input.due ? { due: input.due } : {},
        ...input.supersedes ? { supersedes: input.supersedes } : {}
      };
      if (meta.status && meta.kind) validateStatus(meta.tier === "canonical" ? "canonical" : meta.kind, meta.status);
      const path = notePath(brainPath(primary), meta, now);
      const note = { meta, body: input.body, path };
      let priorDecision;
      if (meta.kind === "decision" && meta.supersedes) {
        priorDecision = await find(meta.supersedes);
        if (!priorDecision || priorDecision.meta.kind !== "decision" || priorDecision.meta.status !== "active") throw new Error("A decision can supersede only an existing active decision");
      }
      if (await find(meta.id)) throw new Error(`Note id already exists: ${meta.id}`);
      const created = await persist(note);
      if (priorDecision) await updateNote(priorDecision.meta.id, { status: "reverted", supersedes: created.meta.id }, void 0, "revert-decision");
      return created;
    },
    async update(id, patch, body) {
      return updateNote(id, patch, body);
    },
    async recall(query, opts = {}) {
      const notes = (await all()).filter((n) => !opts.tiers || opts.tiers.includes(n.meta.tier));
      const hits = rankNotes(query, notes, /* @__PURE__ */ new Date(), opts.limit);
      for (const hit of hits) if (!isClosedEpisode(hit.note.meta)) await persist({ ...hit.note, meta: { ...hit.note.meta, usage: recordUsage(hit.note.meta.usage), updated: iso() } });
      return hits;
    },
    async recordUse(ids, now = /* @__PURE__ */ new Date()) {
      for (const id of new Set(ids)) {
        const note = await find(id);
        if (!note || isClosedEpisode(note.meta)) continue;
        await persist({ ...note, meta: { ...note.meta, usage: recordUsage(note.meta.usage, now), updated: iso() } });
      }
    },
    async feedback(id, helpful) {
      const note = await find(id);
      if (!note) throw new Error(`Note not found: ${id}`);
      if (isClosedEpisode(note.meta)) throw new Error("Closed episodic notes are immutable");
      return persist({ ...note, meta: { ...note.meta, usage: feedbackUsage(note.meta.usage, helpful), updated: iso() } });
    },
    async openSession(title, source) {
      return this.write({ title, body: "", tier: "episodic", kind: "session", status: "open-session", source });
    },
    async closeSession(id, summary) {
      return this.update(id, { status: "closed" }, summary);
    },
    async proposeCanonical(input) {
      if (input.tier !== "canonical") throw new Error("Canonical proposals must use tier canonical");
      return this.write({ ...input, status: "proposed" });
    },
    async acceptCanonical(id) {
      const note = await find(id);
      if (!note || note.meta.tier !== "canonical") throw new Error(`Canonical note not found: ${id}`);
      if (note.meta.status !== "proposed") throw new Error("Only proposed canonical notes can be accepted");
      const accepted = await updateNote(id, { status: "accepted" }, void 0, "accept-canonical");
      if (accepted.meta.supersedes) {
        const old = await find(accepted.meta.supersedes);
        if (old?.meta.tier === "canonical" && old.meta.status === "accepted") await updateNote(old.meta.id, { status: "superseded" }, void 0, "supersede-canonical");
      }
      return accepted;
    },
    async rejectCanonical(id, reason) {
      const note = await find(id);
      if (!note || note.meta.tier !== "canonical") throw new Error(`Canonical note not found: ${id}`);
      if (note.meta.status !== "proposed") throw new Error("Only proposed canonical notes can be rejected");
      await rm3(note.path, { force: true });
      const record = await this.write({
        tier: "episodic",
        kind: "session",
        status: "open-session",
        source: REJECT_SOURCE,
        links: [id, ...note.meta.links],
        title: `Rejected canonical proposal: ${note.meta.title}`,
        body: ""
      });
      const quoted = note.body.trim().split("\n").slice(0, 12).map((line) => `> ${line}`);
      await this.closeSession(record.meta.id, [`Rejected ${id} (${note.meta.band ?? "inferred"}, source ${note.meta.source ?? "unknown"}).`, ...reason ? [`Reason: ${reason}`] : [], "", ...quoted].join("\n"));
      return note;
    },
    async maintain(now = /* @__PURE__ */ new Date()) {
      const report = { changed: [], promoted: [], retired: [], overdue: [], indexRebuilt: false };
      for (const note of await all()) {
        const next = applyLearning(note, now);
        if (next.meta.status !== note.meta.status) {
          await persist(next);
          report.changed.push(note.meta.id);
          if (next.meta.status === "proven") report.promoted.push(note.meta.id);
          if (next.meta.status === "retired") report.retired.push(note.meta.id);
          if (next.meta.status === "overdue") report.overdue.push(note.meta.id);
        }
        if (next.meta.kind === "lesson" && next.meta.status === "proven") {
          const proposalExists = (await all()).some((candidate) => (candidate.meta.tier === "canonical" && candidate.meta.source === "edu:maintain" || candidate.meta.source === REJECT_SOURCE) && candidate.meta.links.includes(next.meta.id));
          if (!proposalExists) {
            const prior = (await all()).find((candidate) => candidate.meta.tier === "canonical" && candidate.meta.kind === "standard" && candidate.meta.title === next.meta.title && candidate.meta.status === "accepted");
            await this.proposeCanonical({ tier: "canonical", kind: "standard", title: prior ? `${next.meta.title} (revision)` : next.meta.title, body: next.body, tags: next.meta.tags, links: [next.meta.id], source: "edu:maintain", band: next.meta.band ?? "inferred", ...prior ? { supersedes: prior.meta.id } : {} });
          }
        }
      }
      await this.rebuildIndex();
      report.indexRebuilt = true;
      return report;
    },
    async rebuildIndex() {
      const notes = await all();
      const groups = /* @__PURE__ */ new Map();
      for (const note of notes) {
        const key = `${note.meta.tier}/${note.meta.kind ?? "other"}`;
        groups.set(key, [...groups.get(key) ?? [], note]);
      }
      const lines = ["# Brain index", "", `Generated: ${iso()}`, ""];
      for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`## ${key}`, "");
        for (const note of group.sort((a, b) => a.meta.title.localeCompare(b.meta.title))) lines.push(`- [[${basename2(note.path, ".md")}|${note.meta.title}]] \u2014 ${note.meta.band ?? "inferred"} \xB7 ${note.meta.status ?? "unspecified"}`);
        lines.push("");
      }
      await atomicWrite(join4(brainPath(primary), INDEX_DIR, "INDEX.md"), `${lines.join("\n")}
`);
      await writeObsidianViews(primary, viewOptions);
    },
    async stats() {
      const notes = await all();
      const result = { total: notes.length, byTier: { canonical: 0, episodic: 0, transitive: 0 }, byKind: {}, byStatus: {} };
      for (const note of notes) {
        result.byTier[note.meta.tier]++;
        if (note.meta.kind) result.byKind[note.meta.kind] = (result.byKind[note.meta.kind] ?? 0) + 1;
        if (note.meta.status) result.byStatus[note.meta.status] = (result.byStatus[note.meta.status] ?? 0) + 1;
      }
      return result;
    }
  };
}

export {
  AUTO_MAINTAIN_INTERVAL_MS,
  maintainStatePath,
  readMaintainState,
  autoMaintain,
  readProjects,
  registerProject,
  allowedStatuses,
  validateStatus,
  validateTransition,
  learnedWeight,
  feedbackUsage,
  recordUsage,
  lessonStatus,
  overdueStatus,
  tokenize,
  rankNotes,
  openBrain
};
//# sourceMappingURL=chunk-DUVIFR5X.js.map