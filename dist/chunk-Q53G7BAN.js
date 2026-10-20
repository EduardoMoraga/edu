import {
  readProjects
} from "./chunk-I6JWASFE.js";
import {
  INDEX_DIR,
  TIER_DIRS,
  atomicWrite,
  createId,
  encodeNote,
  notePath,
  overlayNotes,
  parseMarkdownLenient,
  readNote,
  slugify
} from "./chunk-TH5GRG3L.js";
import {
  brainPath,
  isInside,
  readWorkspaceSettings,
  vaultFolder,
  vaultPlacement
} from "./chunk-YPR7PZSQ.js";

// src/brain/brain.ts
import { createHash } from "crypto";
import { access, mkdir as mkdir2, readFile as readFile3, readdir, realpath, rm as rm3 } from "fs/promises";
import { basename as basename2, dirname as dirname2, join as join3, resolve as resolve2 } from "path";

// src/brain/views.ts
import { existsSync, realpathSync } from "fs";
import { readFile, rm, rmdir } from "fs/promises";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

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
var defaultEduHome = (primary) => primary.scope === "global" ? primary.root : resolve(process.env.EDU_HOME || join(homedir(), ".edu"));
var real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
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
  const page = candidates.find((candidate) => existsSync(join(root, candidate)));
  return page ? { name: entry.name, link: `${rel}/${page.replace(/\.md$/, "")}`, path: rel } : { name: entry.name, path: rel };
}
async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return void 0;
  }
}
async function writeObsidianViews(primary, options = {}) {
  const lang = (await readWorkspaceSettings(primary.root)).lang ?? "en";
  const placed = vaultPlacement(primary);
  const orchestrator = Boolean(placed && placed.brainRel && !placed.brainRel.includes("/"));
  const scope = orchestrator ? { mode: "orchestrator", brainRel: placed.brainRel } : { mode: "workspace", brainRel: vaultFolder(primary, "").replace(/\/$/, "") };
  const indexDir = join(brainPath(primary), INDEX_DIR);
  const report = { bases: [], removed: [] };
  for (const file of buildBases(lang, scope)) {
    await atomicWrite(join(indexDir, file.name), file.content);
    report.bases.push(file.name);
  }
  for (const name of staleBaseFiles(lang)) {
    if (existsSync(join(indexDir, name))) {
      await rm(join(indexDir, name), { force: true });
      report.removed.push(name);
    }
  }
  if (!orchestrator) return report;
  const vault = placed.vault;
  const target = join(vault, ...DASHBOARD_PATHS[lang].split("/"));
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
  const other = join(vault, ...DASHBOARD_PATHS[lang === "es" ? "en" : "es"].split("/"));
  const otherText = await readText(other);
  if (otherText !== void 0 && isEduOwned(otherText)) {
    await rm(other, { force: true });
    await rmdir(dirname(other)).catch(() => {
    });
  }
  return report;
}

// src/brain/note-lock.ts
import { mkdir, readFile as readFile2, rename, rm as rm2, stat, writeFile } from "fs/promises";
import { join as join2 } from "path";
var WAIT_MS = 15e3;
var STALE_MS = 3e4;
var pause = (ms) => new Promise((resolve4) => setTimeout(resolve4, ms));
var alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
async function withUsageLock(root, body) {
  const locks = join2(root, "state", "locks");
  const dir = join2(locks, "brain-usage.lock");
  await mkdir(locks, { recursive: true });
  const deadline = Date.now() + WAIT_MS;
  for (; ; ) {
    try {
      await mkdir(dir);
      await writeFile(join2(dir, "owner"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (await stale(dir)) {
      const claimed = `${dir}.stale-${process.pid}-${Date.now()}`;
      try {
        await rename(dir, claimed);
        await rm2(claimed, { recursive: true, force: true });
      } catch {
      }
      continue;
    }
    if (Date.now() > deadline) throw new Error("timed out waiting for the brain usage lock");
    await pause(10);
  }
  try {
    return await body();
  } finally {
    await rm2(dir, { recursive: true, force: true });
  }
}
async function stale(dir) {
  try {
    if (Date.now() - (await stat(dir)).mtimeMs < STALE_MS) return false;
    const pid = Number((await readFile2(join2(dir, "owner"), "utf8").catch(() => "")).trim());
    return !(Number.isInteger(pid) && pid > 0 && alive(pid));
  } catch {
    return false;
  }
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
var MAX_EVENT_ID_LENGTH = 200;
var PROMOTION_VERIFIED_WINS = 3;
var INACTIVITY_DAYS = 180;
function assertFeedbackContext(context) {
  const value = context;
  if (!value || typeof value !== "object") throw new Error("Feedback context must be an object");
  if (typeof value.eventId !== "string" || !value.eventId.trim() || value.eventId.length > MAX_EVENT_ID_LENGTH) throw new Error(`Feedback context eventId must be a non-empty string of at most ${MAX_EVENT_ID_LENGTH} characters`);
  if (typeof value.verified !== "boolean") throw new Error("Feedback context verified must be a boolean");
  if (value.evidence !== void 0 && !(Array.isArray(value.evidence) && value.evidence.every((item) => typeof item === "string"))) throw new Error("Feedback context evidence must be an array of strings");
}
function sanitizeUsage(usage) {
  const raw = usage && typeof usage === "object" ? usage : {};
  const count2 = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  const out = { ...raw, uses: count2(raw.uses), wins: count2(raw.wins), losses: count2(raw.losses) };
  if ("verifiedWins" in raw) out.verifiedWins = count2(raw.verifiedWins);
  if ("verifiedLosses" in raw) out.verifiedLosses = count2(raw.verifiedLosses);
  if ("events" in raw) out.events = Array.isArray(raw.events) ? raw.events.filter((key) => typeof key === "string") : [];
  return out;
}
function feedbackUsage(usage, helpful, now = /* @__PURE__ */ new Date(), context) {
  if (context !== void 0) assertFeedbackContext(context);
  const current = sanitizeUsage(usage);
  if (context === void 0) return { ...current, wins: current.wins + Number(helpful), losses: current.losses + Number(!helpful) };
  const events = current.events ?? [];
  const advisory = `a:${context.eventId}`, verified = `v:${context.eventId}`;
  if (events.includes(verified) || !context.verified && events.includes(advisory)) return usage;
  const counted = events.includes(advisory);
  const next = { ...current };
  if (!counted) {
    next.wins += Number(helpful);
    next.losses += Number(!helpful);
  }
  if (context.verified) {
    if (helpful) {
      next.verifiedWins = (current.verifiedWins ?? 0) + 1;
      next.lastVerified = now.toISOString();
    } else next.verifiedLosses = (current.verifiedLosses ?? 0) + 1;
  }
  next.events = [...events.filter((key) => key !== advisory || !context.verified), context.verified ? verified : advisory];
  return next;
}
function recordUsage(usage, now = /* @__PURE__ */ new Date()) {
  const current = usage ?? { uses: 0, wins: 0, losses: 0 };
  return { ...current, uses: current.uses + 1, lastUsed: now.toISOString() };
}
function isVerifiedLesson(usage) {
  const wins = usage?.verifiedWins ?? 0, losses = usage?.verifiedLosses ?? 0;
  return wins >= PROMOTION_VERIFIED_WINS && (wins + 1) / (wins + losses + 2) >= 0.7;
}
function lessonStatus(meta, now = /* @__PURE__ */ new Date()) {
  if (meta.kind !== "lesson") return meta.status;
  if (meta.status === "retired") return "retired";
  const usage = sanitizeUsage(meta.usage);
  const weight = learnedWeight(usage, now);
  if (usage.losses >= 3 && weight < 0.35) return "retired";
  const confirmed = meta.status === "proven" || (usage.verifiedWins ?? 0) > 0;
  const since = Date.parse(usage.lastVerified ?? meta.created);
  if (!confirmed && Number.isFinite(since) && (now.getTime() - since) / 864e5 >= INACTIVITY_DAYS) return "retired";
  if (meta.status === "proven") return "proven";
  if (isVerifiedLesson(usage)) return "proven";
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

// src/brain/resolve.ts
import { basename } from "path";
var fold = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
var stemOf = (path) => basename(path.replace(/\\/g, "/"), ".md").toLowerCase();
function pick(via, matches) {
  if (!matches.length) return void 0;
  return matches.length === 1 ? { via, note: matches[0] } : { via, candidates: matches };
}
function normalizeReference(reference) {
  return reference.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
}
function resolveReference(notes, reference) {
  const ref = normalizeReference(reference);
  if (!ref) return void 0;
  const lower = ref.toLowerCase();
  const exact = notes.filter((note) => note.meta.id === ref);
  if (exact.length) return pick("id", exact);
  const alias = pick("alias", notes.filter((note) => note.meta.legacy_id?.toLowerCase() === lower || (note.meta.aliases ?? []).some((name) => name.toLowerCase() === lower)));
  if (alias) return alias;
  const prefixed = notes.filter((note) => note.meta.id.toLowerCase().startsWith(lower));
  const whole = prefixed.filter((note) => /^[-_.]?$|^[-_.]/.test(note.meta.id.slice(lower.length)));
  const prefix = pick("prefix", whole.length ? whole : prefixed);
  if (prefix) return prefix;
  const stemQuery = lower.replace(/\.md$/, "");
  const stem = pick("stem", notes.filter((note) => stemOf(note.path) === stemQuery || (note.meta.origin ? stemOf(note.meta.origin) === stemQuery : false)));
  if (stem) return stem;
  const title = fold(ref);
  return pick("title", notes.filter((note) => fold(note.meta.title) === title));
}

// src/brain/search.ts
function tokenize(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en").match(/[a-z0-9]+/g) ?? [];
}
var vocabulary = [
  "payment payments pago pagos pagar pague cobro cobros",
  "invoice invoices factura facturas",
  "duplicate duplicates duplicated duplicado duplicados duplicada duplicadas repetido repetidos repetida repetidas",
  "retry retries reattempt reintento reintentos reintentar",
  "restore restoration restaurar restauracion",
  "backup backups respaldo respaldos",
  "connection connections conexion conexiones",
  "deploy deployment despliegue desplegar"
];
var concepts = new Map(vocabulary.flatMap((group) => {
  const words = group.split(" ");
  return words.map((word) => [word, words[0]]);
}));
var stopwords = new Set("a an the how what which do does we i to of for in on is are be and or como que cual cuales el la los las un una unos unas de del al para en por y o se su sus".split(" "));
var searchTokens = (text) => tokenize(text).filter((term) => !stopwords.has(term)).map((term) => concepts.get(term) ?? term);
function isOperationalNote(note) {
  return !note.meta.superseded_by && !["retired", "reverted", "superseded"].includes(note.meta.status ?? "") && !(note.meta.tier === "canonical" && note.meta.status === "proposed");
}
var searchReference = (query) => /^\[\[[^\[\]\r\n]*\]\]$/.test(query.trim()) ? normalizeReference(query) : query.trim();
function relevantPassage(body, query, maxChars = 480) {
  const size = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 480;
  if (!size || !body) return "";
  if (body.length <= size) return body.trim();
  const terms = new Set(searchTokens(searchReference(query)));
  if (!terms.size) return body.slice(0, size).trim();
  const hits = [];
  for (const token of body.matchAll(/[\p{L}\p{N}]+/gu)) {
    const matched = searchTokens(token[0]).filter((term) => terms.has(term));
    if (matched.length) hits.push({ start: token.index, end: token.index + token[0].length, terms: matched });
  }
  let bestStart = 0;
  let bestScore = 0;
  let left = 0;
  let right = 0;
  const counts = /* @__PURE__ */ new Map();
  for (const hit of hits) {
    const start = Math.max(0, hit.start - Math.min(80, Math.floor(size / 4)));
    while (right < hits.length && hits[right].end <= start + size) {
      for (const term of hits[right++].terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    while (left < right && hits[left].start < start) {
      for (const term of hits[left++].terms) {
        const remaining = counts.get(term) - 1;
        if (remaining) counts.set(term, remaining);
        else counts.delete(term);
      }
    }
    if (counts.size > bestScore) {
      bestScore = counts.size;
      bestStart = start;
    }
    if (bestScore === terms.size) break;
  }
  const paragraph = body.indexOf("\n\n", bestStart);
  if (paragraph >= bestStart && paragraph < bestStart + 80 && paragraph + 2 < body.length) {
    const prefix = body.slice(bestStart, paragraph);
    if (!searchTokens(prefix).some((term) => terms.has(term))) bestStart = paragraph + 2;
  }
  return body.slice(bestStart, bestStart + size).trim();
}
function rankNotes(query, notes, now = /* @__PURE__ */ new Date(), limit = 10, options = {}) {
  const reference = searchReference(query);
  if (!reference) return [];
  const terms = [...new Set(searchTokens(reference))];
  const key = reference.toLocaleLowerCase("en");
  const named = (note) => [note.meta.id, note.meta.legacy_id, ...Array.isArray(note.meta.aliases) ? note.meta.aliases : []].some((name) => typeof name === "string" && name.toLocaleLowerCase("en") === key);
  const docs = notes.filter((note) => options.includeHistory || isOperationalNote(note) || named(note)).map((note) => ({ note, fields: [searchTokens(note.meta.title), searchTokens(note.meta.tags.join(" ")), searchTokens(note.body)] }));
  const df = new Map(terms.map((term) => [term, docs.filter((doc) => doc.fields.some((field) => field.includes(term))).length]));
  const avgdl = docs.reduce((sum, doc) => sum + doc.fields[0].length * 2 + doc.fields[1].length + doc.fields[2].length, 0) / Math.max(docs.length, 1);
  const scored = docs.map(({ note, fields }) => {
    const weighted = [...fields[0], ...fields[0], ...fields[1], ...fields[2]];
    const dl = weighted.length;
    let bm25 = 0;
    const matched = [];
    for (const term of terms) {
      const termDf = df.get(term);
      const idf = Math.log(1 + (docs.length - termDf + 0.5) / (termDf + 0.5));
      const tf = weighted.filter((token) => token === term).length;
      if (!tf) continue;
      matched.push(term);
      bm25 += idf * (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * dl / Math.max(avgdl, 1)));
    }
    const w = learnedWeight(note.meta.usage, now);
    if (named(note)) return { note, score: 1e6, why: `Named by id or alias "${query.trim()}"; learned weight ${w.toFixed(2)}.`, matches: 1 };
    return { note, score: bm25 * (0.5 + w), why: `Matched ${matched.length ? matched.join(", ") : "no terms"}; learned weight ${w.toFixed(2)}.`, matches: matched.length };
  }).filter((hit) => hit.matches > 0);
  return scored.sort((a, b) => b.score - a.score || a.note.meta.id.localeCompare(b.note.meta.id)).slice(0, Math.max(0, limit)).map(({ matches: _matches, ...hit }) => {
    if (options.includePassages === false) return hit;
    const passage = relevantPassage(hit.note.body, reference);
    return { ...hit, why: `${hit.why}${passage ? ` Passage: ${JSON.stringify(passage)}` : ""}` };
  });
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
var usedThisMinute = (meta, now) => {
  const last = meta.usage?.lastUsed ? Date.parse(meta.usage.lastUsed) : NaN;
  return Number.isFinite(last) && Math.floor(last / 6e4) === Math.floor(now.getTime() / 6e4);
};
var provenanceOf = (provenance) => Object.fromEntries(Object.entries(provenance ?? {}).filter(([, value]) => value !== void 0 && value !== "" && !(Array.isArray(value) && !value.length)));
var pathExists = (path) => access(path).then(() => true, () => false);
function openBrain(locations, viewOptions = {}) {
  if (!locations.length) throw new Error("openBrain requires at least one location");
  const primary = locations[0];
  const all = () => overlayNotes(locations);
  const isolated = async (note) => {
    if (note.meta.tier !== "transitive" || isInside(brainPath(primary), note.path)) return note;
    const preferred = notePath(brainPath(primary), note.meta, new Date(note.meta.created));
    const stem = `shadow-${slugify(note.meta.id)}`;
    for (const path of [preferred, join3(dirname2(preferred), `${stem}.md`), join3(dirname2(preferred), `${stem}-${createHash("sha256").update(note.meta.id).digest("hex").slice(0, 12)}.md`)]) {
      const occupant = await readNote(path);
      if (!occupant || occupant.meta.id === note.meta.id) return { ...note, path };
      if (!await pathExists(path)) return { ...note, path };
    }
    throw new Error(`No safe shadow path for ${note.meta.id}`);
  };
  const rootOf = (path) => (locations.find((loc) => isInside(brainPath(loc), path)) ?? primary).root;
  const withRoots = async (roots, body) => {
    const canonical = await Promise.all(roots.map(async (root) => {
      await mkdir2(resolve2(root), { recursive: true });
      return realpath(resolve2(root));
    }));
    const [first, ...rest] = [...new Map(canonical.map((root) => [process.platform === "win32" ? root.toLowerCase() : root, root])).values()].sort();
    if (first === void 0) return body();
    return withUsageLock(first, () => rest.length ? withRoots(rest, body) : body());
  };
  const persistFresh = (note) => withRoots([rootOf(note.path), primary.root], async () => {
    const fresh = await readNote(note.path);
    return persist(await isolated(fresh?.meta.usage ? { ...note, meta: { ...note.meta, usage: fresh.meta.usage } } : note));
  });
  const retireSuperseded = async (successor, byId) => {
    const old = successor.meta.kind === "lesson" && successor.meta.status !== "retired" && successor.meta.supersedes ? byId.get(successor.meta.supersedes) : void 0;
    if (!old || old.meta.id === successor.meta.id || old.meta.tier !== "transitive" || old.meta.kind !== "lesson" || old.meta.status === "retired" || old.meta.supersedes === successor.meta.id) return void 0;
    return persistFresh({ ...old, meta: { ...old.meta, status: "retired", superseded_by: successor.meta.id, updated: iso() } });
  };
  const find = async (id) => (await all()).find((note) => note.meta.id === id);
  const persist = async (note) => {
    await atomicWrite(note.path, encodeNote(note));
    return note;
  };
  const updateNote = async (id, patch, body, authority) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const seen = await find(id);
      if (!seen) throw new Error(`Note not found: ${id}`);
      const roots = [rootOf(seen.path), primary.root];
      const done = await withRoots(roots, async () => {
        const current = await find(id);
        if (!current) throw new Error(`Note not found: ${id}`);
        if (!roots.includes(rootOf(current.path))) return void 0;
        return applyUpdate(current, patch, body, authority);
      });
      if (done) return done;
    }
    throw new Error(`Note could not settle on a stable location: ${id}`);
  };
  const applyUpdate = async (current, patch, body, authority) => {
    const id = current.meta.id;
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
  const markUsed = (candidates, now) => withRoots(candidates.map((candidate) => rootOf(candidate.path)), async () => {
    for (const candidate of candidates) {
      const note = await readNote(candidate.path) ?? candidate;
      if (isClosedEpisode(note.meta) || usedThisMinute(note.meta, now)) continue;
      await persist({ ...note, meta: { ...note.meta, usage: recordUsage(note.meta.usage, now), updated: iso() } });
    }
  });
  return {
    async init(loc, opts = {}) {
      for (const folder of ["0-index", "1-canonical", "2-episodic", "3-transitive"]) await mkdir2(join3(brainPath(loc), folder), { recursive: true });
      for (const folder of ["skills", "agents", "playbooks", "proposals", "runs"]) await mkdir2(join3(loc.root, folder), { recursive: true });
      try {
        const { resolveTemplatesDir } = await import("./adapters-HI4DQZHS.js");
        const source = join3(resolveTemplatesDir(), "playbooks");
        for (const name of await readdir(source)) {
          if (!name.endsWith(".md")) continue;
          const target = join3(loc.root, "playbooks", name);
          try {
            await access(target);
          } catch {
            await atomicWrite(target, await readFile3(join3(source, name), "utf8"));
          }
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        await access(join3(loc.root, "EDU.md"));
      } catch {
        let contract = fallbackEdu;
        try {
          const { resolveTemplatesDir } = await import("./adapters-HI4DQZHS.js");
          contract = await readFile3(join3(resolveTemplatesDir(), "EDU.md"), "utf8");
        } catch {
        }
        contract = contract.replaceAll("{{name}}", opts.identityName ?? "Edu");
        await atomicWrite(join3(loc.root, "EDU.md"), contract);
      }
    },
    async list(filter = {}) {
      return (await all()).filter((n) => Object.entries(filter).every(([key, value]) => value === void 0 || n.meta[key] === value));
    },
    read: find,
    async resolve(reference) {
      return resolveReference(await all(), reference);
    },
    async write(input) {
      if (input.tier === "canonical" && input.kind && !["identity", "standard", "lexicon", "domain", "person", "preference"].includes(input.kind)) {
        throw new Error(`Invalid canonical kind: ${input.kind}`);
      }
      if (input.tier === "canonical" && input.status && input.status !== "proposed") throw new Error("Canonical notes must be written as proposed; use acceptCanonical for human confirmation");
      const now = new Date(input.created ?? Date.now());
      const meta = {
        id: createId({ tier: input.tier, kind: input.kind, title: input.title, legacy_id: input.provenance?.legacy_id }, now),
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
        ...input.stakeholder ? { stakeholder: input.stakeholder } : {},
        ...input.due ? { due: input.due } : {},
        ...input.supersedes ? { supersedes: input.supersedes } : {},
        ...provenanceOf(input.provenance)
      };
      if (meta.status && meta.kind) validateStatus(meta.tier === "canonical" ? "canonical" : meta.kind, meta.status);
      const path = notePath(brainPath(primary), meta, now);
      const note = { meta, body: input.body, path };
      let created;
      if (meta.kind === "decision" && meta.supersedes && !input.historical) {
        for (let attempt = 0; attempt < 4 && !created; attempt++) {
          const seen = await find(meta.supersedes);
          if (!seen) throw new Error("A decision can supersede only an existing active decision");
          const roots = [primary.root, rootOf(seen.path)];
          created = await withRoots(roots, async () => {
            const prior = await find(meta.supersedes);
            if (!prior || prior.meta.kind !== "decision" || prior.meta.status !== "active") throw new Error("A decision can supersede only an existing active decision");
            if (!roots.includes(rootOf(prior.path))) return void 0;
            if (await find(meta.id)) throw new Error(`Note id already exists: ${meta.id}`);
            const fresh = await persist(note);
            try {
              await applyUpdate(prior, { status: "reverted", supersedes: fresh.meta.id }, void 0, "revert-decision");
            } catch (error) {
              await rm3(fresh.path, { force: true });
              throw error;
            }
            return fresh;
          });
        }
        if (!created) throw new Error(`Decision could not settle on a stable location: ${meta.supersedes}`);
      } else {
        created = await withRoots([primary.root], async () => {
          if (await find(meta.id)) throw new Error(`Note id already exists: ${meta.id}`);
          return persist(note);
        });
      }
      if (meta.kind === "lesson" && meta.supersedes) await retireSuperseded(created, new Map((await all()).map((note2) => [note2.meta.id, note2])));
      return created;
    },
    async update(id, patch, body) {
      return updateNote(id, patch, body);
    },
    async recall(query, opts = {}) {
      const notes = (await all()).filter((n) => !opts.tiers || opts.tiers.includes(n.meta.tier));
      const hits = rankNotes(query, notes, /* @__PURE__ */ new Date(), opts.limit);
      const now = /* @__PURE__ */ new Date();
      await markUsed(hits.map((hit) => hit.note), now);
      return hits;
    },
    async recordUse(ids, now = /* @__PURE__ */ new Date()) {
      const byId = new Map((await all()).map((note) => [note.meta.id, note]));
      await markUsed([...new Set(ids)].flatMap((id) => byId.get(id) ?? []), now);
    },
    async feedback(id, helpful, context) {
      if (context !== void 0) assertFeedbackContext(context);
      let note = await find(id);
      if (!note) throw new Error(`Note not found: ${id}`);
      if (isClosedEpisode(note.meta)) throw new Error("Closed episodic notes are immutable");
      for (let attempt = 0; attempt < 4; attempt++) {
        const roots = [rootOf(note.path), primary.root];
        const done = await withRoots(roots, async () => {
          const current = await find(id);
          if (!current) throw new Error(`Note not found: ${id}`);
          if (!roots.includes(rootOf(current.path))) return void 0;
          if (isClosedEpisode(current.meta)) throw new Error("Closed episodic notes are immutable");
          const usage = feedbackUsage(current.meta.usage, helpful, /* @__PURE__ */ new Date(), context);
          if (current.meta.usage && usage === current.meta.usage) return current;
          return persist(await isolated({ ...current, meta: { ...current.meta, usage, updated: iso() } }));
        });
        if (done) return done;
        note = await find(id) ?? note;
      }
      throw new Error(`Feedback could not settle on a stable note location: ${id}`);
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
      for (let attempt = 0; attempt < 4; attempt++) {
        const seen = await find(id);
        if (!seen || seen.meta.tier !== "canonical") throw new Error(`Canonical note not found: ${id}`);
        const seenOld = seen.meta.supersedes ? await find(seen.meta.supersedes) : void 0;
        const roots = [rootOf(seen.path), primary.root, ...seenOld ? [rootOf(seenOld.path)] : []];
        const done = await withRoots(roots, async () => {
          const note = await find(id);
          if (!note || note.meta.tier !== "canonical") throw new Error(`Canonical note not found: ${id}`);
          if (note.meta.status !== "proposed") throw new Error("Only proposed canonical notes can be accepted");
          const old = note.meta.supersedes ? await find(note.meta.supersedes) : void 0;
          if (!roots.includes(rootOf(note.path)) || old && !roots.includes(rootOf(old.path))) return void 0;
          const replaces = old?.meta.tier === "canonical" ? old : void 0;
          if (replaces?.meta.status === "superseded") throw new Error(`Canonical note ${replaces.meta.id} was already superseded by another proposal`);
          const accepted = await applyUpdate(note, { status: "accepted" }, void 0, "accept-canonical");
          if (replaces?.meta.status === "accepted") {
            try {
              await applyUpdate(replaces, { status: "superseded" }, void 0, "supersede-canonical");
            } catch (error) {
              await persist(note);
              throw error;
            }
          }
          return accepted;
        });
        if (done) return done;
      }
      throw new Error(`Canonical note could not settle on a stable location: ${id}`);
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
      const loaded = await all();
      const byId = new Map(loaded.map((note) => [note.meta.id, note]));
      for (const successor of loaded) {
        const retired = await retireSuperseded(successor, byId);
        if (!retired) continue;
        byId.set(retired.meta.id, retired);
        report.changed.push(retired.meta.id);
        report.retired.push(retired.meta.id);
      }
      const notes = loaded.map((note) => byId.get(note.meta.id) ?? note);
      const proposedOrRejected = /* @__PURE__ */ new Set();
      const acceptedStandards = /* @__PURE__ */ new Map();
      for (const candidate of notes) {
        if (candidate.meta.tier === "canonical" && candidate.meta.source === "edu:maintain" || candidate.meta.source === REJECT_SOURCE) for (const link of candidate.meta.links) proposedOrRejected.add(link);
        if (candidate.meta.tier === "canonical" && candidate.meta.kind === "standard" && candidate.meta.status === "accepted") acceptedStandards.set(candidate.meta.title, candidate);
      }
      for (const note of notes) {
        const next = applyLearning(note, now);
        if (next.meta.status === note.meta.status) continue;
        await persistFresh(next);
        report.changed.push(note.meta.id);
        if (next.meta.status === "proven") report.promoted.push(note.meta.id);
        if (next.meta.status === "retired") report.retired.push(note.meta.id);
        if (next.meta.status === "overdue") report.overdue.push(note.meta.id);
        if (next.meta.kind !== "lesson" || next.meta.status !== "proven" || proposedOrRejected.has(next.meta.id)) continue;
        const prior = acceptedStandards.get(next.meta.title);
        const proposal = await this.proposeCanonical({ tier: "canonical", kind: "standard", title: prior ? `${next.meta.title} (revision)` : next.meta.title, body: next.body, tags: next.meta.tags, links: [next.meta.id], source: "edu:maintain", band: next.meta.band ?? "inferred", ...prior ? { supersedes: prior.meta.id } : {} });
        for (const link of proposal.meta.links) proposedOrRejected.add(link);
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
      await atomicWrite(join3(brainPath(primary), INDEX_DIR, "INDEX.md"), `${lines.join("\n")}
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

// src/brain/proposals.ts
function proposalWhy(note) {
  const { meta } = note;
  const band = meta.band ?? "inferred";
  const parts = [];
  if (meta.source === "edu:maintain") parts.push(`promoted from proven lesson ${meta.links[0] ?? ""}`.trim());
  else if (meta.source?.startsWith("edu:reflect")) parts.push("suggested by edu reflect");
  else if (band === "hypothesis") parts.push("hypothesis, not yet proven");
  else if (band === "inferred") parts.push("interpretation, not stated explicitly in the source");
  else parts.push("needs human confirmation");
  if (meta.supersedes) parts.push(`would replace ${meta.supersedes}`);
  return parts.join("; ");
}
async function listCanonicalProposals(brain) {
  const notes = await brain.list({ tier: "canonical", status: "proposed" });
  return notes.sort((a, b) => a.meta.created.localeCompare(b.meta.created) || a.meta.id.localeCompare(b.meta.id)).map((note) => ({
    id: note.meta.id,
    title: note.meta.title,
    kind: String(note.meta.kind ?? "domain"),
    source: note.meta.source ?? "unknown",
    band: note.meta.band ?? "inferred",
    why: proposalWhy(note),
    ...note.meta.supersedes ? { supersedes: note.meta.supersedes } : {},
    path: note.path
  }));
}
async function reviewCanonicalProposals(brain, input) {
  const result = { accepted: [], rejected: [], errors: [] };
  const rejectIds = [...new Set(input.reject ?? [])];
  for (const id of rejectIds) {
    try {
      await brain.rejectCanonical(id, input.reason);
      result.rejected.push(id);
    } catch (error) {
      result.errors.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const approveIds = input.all ? (await listCanonicalProposals(brain)).map((p) => p.id).filter((id) => !rejectIds.includes(id)) : [...new Set(input.approve ?? [])];
  for (const id of approveIds) {
    try {
      await brain.acceptCanonical(id);
      result.accepted.push(id);
    } catch (error) {
      result.errors.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

// src/brain/auto-maintain.ts
import { access as access2, readFile as readFile4 } from "fs/promises";
import { join as join4 } from "path";
var AUTO_MAINTAIN_INTERVAL_MS = 10 * 60 * 1e3;
async function consolidate(brain, root, now) {
  if (!brain.read || !brain.list || !brain.write || !brain.proposeCanonical) return void 0;
  try {
    await access2(join4(root, "reflect-queue"));
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
  let result;
  try {
    const { consolidatePending } = await import("./consolidate-FVB4UT3N.js");
    const report = await consolidatePending(brain, root, { now, maxEntries: 20, maxInterventions: 50 });
    result = { lessons: report.lessons.length, acknowledged: report.acknowledged.length, skipped: report.skipped.length, busy: report.busy };
  } catch (error) {
    result = { lessons: 0, acknowledged: 0, skipped: 0, busy: false, error: error instanceof Error ? error.message : String(error) };
  }
  await atomicWrite(join4(root, "state", "consolidation.json"), `${JSON.stringify({ at: now.toISOString(), ...result }, null, 2)}
`);
  return result;
}
var maintainStatePath = (root) => join4(root, "state", "maintain.json");
var count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
async function readMaintainState(root) {
  try {
    const raw = JSON.parse(await readFile4(maintainStatePath(root), "utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    const value = raw;
    if (typeof value.lastRun !== "number" || !Number.isFinite(value.lastRun)) return null;
    return { lastRun: value.lastRun, promoted: count(value.promoted), retired: count(value.retired), overdue: count(value.overdue), changed: count(value.changed) };
  } catch {
    return null;
  }
}
async function autoMaintain(brain, root, opts = {}) {
  let consolidation;
  try {
    const now = opts.now ?? /* @__PURE__ */ new Date();
    if (opts.consolidate !== false) consolidation = await consolidate(brain, root, now);
    const extra = consolidation ? { consolidation } : {};
    if (!opts.force) {
      const previous = await readMaintainState(root);
      if (previous && now.getTime() - previous.lastRun < AUTO_MAINTAIN_INTERVAL_MS && now.getTime() >= previous.lastRun) return { ran: false, reason: "throttled", ...extra };
    }
    const report = await brain.maintain(now);
    const state = { lastRun: now.getTime(), promoted: report.promoted.length, retired: report.retired.length, overdue: report.overdue.length, changed: report.changed.length };
    await atomicWrite(maintainStatePath(root), `${JSON.stringify(state, null, 2)}
`);
    return { ran: true, report, state, ...extra };
  } catch (error) {
    return { ran: false, reason: error instanceof Error ? error.message : String(error), ...consolidation ? { consolidation } : {} };
  }
}

// src/brain/import/albert.ts
import { readFile as readFile6, stat as stat2 } from "fs/promises";
import { basename as basename4, join as join6, relative as nodeRelative, resolve as resolve3 } from "path";

// src/brain/import/shared.ts
import { readdir as readdir2, readFile as readFile5 } from "fs/promises";
import { basename as basename3, join as join5 } from "path";
async function markdownFiles(path) {
  let entries;
  try {
    entries = await readdir2(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const target = join5(path, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
  return files.sort();
}
function mapStatus(status) {
  const map = { confirmada: "confirmed", refutada: "refuted", sin_evidencia: "no-evidence", vencido: "overdue", entregado: "delivered", cerrado: "delivered", pendiente: "pending", abierta: "open", vigente: "active", revertida: "reverted", aceptada: "accepted", aceptado: "accepted", borrador: "open-session" };
  return typeof status === "string" ? map[status.toLowerCase()] ?? status : void 0;
}
async function importFiles(files, brain, source, classify2, normalize2) {
  const report = { source, imported: [], skipped: [], errors: [], warnings: [] };
  for (const path of files) {
    try {
      const raw = await readFile5(path, "utf8");
      const parsed = parseMarkdownLenient(raw);
      const mapping = classify2(path);
      const extra = normalize2?.(parsed.meta, parsed.body, path) ?? {};
      const title = String(extra.title ?? parsed.meta.title ?? basename3(path, ".md").replace(/^[DHCAL]-/, "").replace(/[-_]/g, " "));
      const invalid = parsed.recovered;
      if (invalid) report.warnings.push(`${path}: invalid-frontmatter (YAML could not be parsed; the raw text was kept as the body)`);
      const noteBody = invalid ? raw.replace(/\r\n/g, "\n").trim() : (extra.body ?? parsed.body).trim() || raw.trim();
      const input = { title, body: noteBody, tier: mapping.tier ?? "transitive", kind: mapping.kind ?? "lesson", tags: extra.tags ?? (Array.isArray(parsed.meta.tags) ? parsed.meta.tags : []), links: Array.isArray(parsed.meta.links) ? parsed.meta.links : [], status: extra.acceptedCanonical ? "proposed" : extra.status ?? mapStatus(parsed.meta.status) ?? mapping.status, band: extra.band ?? parsed.meta.band, owner: extra.owner ?? parsed.meta.owner, due: extra.due ?? parsed.meta.due, supersedes: parsed.meta.supersedes, created: extra.created, updated: extra.updated, source: extra.source ?? source, ...invalid ? { provenance: { import_warning: "invalid-frontmatter" } } : {} };
      if (!input.status) delete input.status;
      if (!input.owner) delete input.owner;
      if (!input.due) delete input.due;
      const note = await brain.write(input);
      report.imported.push(extra.acceptedCanonical && note.meta.tier === "canonical" ? await brain.acceptCanonical(note.meta.id) : note);
    } catch (error) {
      report.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}
function asTransitiveKind(prefix) {
  return { D: "decision", H: "hypothesis", C: "commitment", A: "lesson", L: "lesson" }[prefix] ?? "lesson";
}
function canonicalKind(value) {
  const allowed = ["identity", "standard", "lexicon", "domain", "person", "preference"];
  return allowed.includes(value) ? value : "domain";
}

// src/brain/import/albert.ts
function albertPathSegments(root, file, relativePath = nodeRelative) {
  return relativePath(root, file).split(/[\\/]/).filter(Boolean);
}
var ALBERT_LAYERS = ["1-CANONICO", "2-EPISODICO", "3-TRANSITIVO"];
var SOURCE = "import:albert";
var RELATION_KEYS = ["produjo", "cerro", "revierte", "revertida_por"];
var NATIVE_KEYS = /* @__PURE__ */ new Set(["titulo", "title", "fecha", "actualizado", "tags", "dueno", "due\xF1o", "owner", "para", "plazo", "due", "fuente", "resumen"]);
var BOOKKEEPING_KEYS = /* @__PURE__ */ new Set(["tipo", "estado", "confianza", "capa", "dominio", "sesion", "banda", "links", "status", ...RELATION_KEYS]);
var SECTION_ORDER = ["kpi", "alcance", "resultado", "decidido_por", "evidencia", "cierra_con", "acerto", "confianza_nota", "costo"];
async function isDir(path) {
  try {
    return (await stat2(path)).isDirectory();
  } catch {
    return false;
  }
}
async function hasLayers(dir) {
  for (const layer of ALBERT_LAYERS) if (await isDir(join6(dir, layer))) return true;
  return false;
}
async function resolveAlbertRoot(sourceRoot) {
  const source = resolve3(sourceRoot);
  const nested = join6(source, "_ALBERT");
  if (await hasLayers(nested)) return nested;
  if (await hasLayers(source)) return source;
  throw new Error(`No Albert vault found at ${source}: expected ${nested} with ${ALBERT_LAYERS.join(", ")} inside, or those folders directly in ${source}. Pass the folder that contains _ALBERT, or _ALBERT itself.`);
}
function albertCorrelative(file) {
  const match = /^([DHCAL])-(\d+)(?=[_\-. ]|$)/i.exec(basename4(file));
  return match ? `${match[1].toUpperCase()}-${match[2]}` : void 0;
}
var asList = (value) => (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []).filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
function classify(segments) {
  if (segments[0] === "1-CANONICO") return { tier: "canonical", kind: canonicalKind({ estandares: "standard", lexico: "lexicon", negocio: "domain", personas: "person" }[segments[1] ?? ""] ?? segments[1]), status: "proposed" };
  if (segments[0] === "2-EPISODICO") return { tier: "episodic", kind: "session" };
  const prefix = /^([DHCAL])-/i.exec(segments.at(-1) ?? "")?.[1]?.toUpperCase() ?? "L";
  return { tier: "transitive", kind: asTransitiveKind(prefix) };
}
function normalize(meta, body, segments) {
  const rawType = String(meta.tipo ?? "").toLowerCase();
  const status = String(meta.estado ?? "").toLowerCase();
  const confidence = { alta: "verified", media: "inferred", baja: "hypothesis" };
  const canonical = segments[0] === "1-CANONICO";
  const episodic = segments[0] === "2-EPISODICO";
  const prefix = /^([DHCAL])-/i.exec(segments.at(-1) ?? "")?.[1]?.toUpperCase();
  const kind = rawType || { D: "decision", H: "hipotesis", C: "compromiso", A: "aprendizaje", L: "aprendizaje" }[prefix ?? ""];
  const statusMap = canonical ? { "": "accepted", aceptada: "accepted", aceptado: "accepted" } : kind === "hipotesis" || kind === "hypothesis" ? { "": "open", abierta: "open", confirmada: "confirmed", refutada: "refuted", sin_evidencia: "no-evidence" } : kind === "compromiso" || kind === "commitment" ? { "": "pending", pendiente: "pending", entregado: "delivered", cerrado: "delivered", vencido: "overdue" } : kind === "decision" ? { "": "active", vigente: "active", revertida: "reverted" } : kind === "aprendizaje" || kind === "lesson" ? { "": "proven", proven: "proven", permanente: "proven" } : {};
  const summary = typeof meta.resumen === "string" ? meta.resumen.trim() : "";
  const noteBody = summary && !body.includes(summary) ? `> ${summary.replaceAll("\n", "\n> ")}

${body}` : void 0;
  const sourceDetail = typeof meta.fuente === "string" && meta.fuente ? `${SOURCE} \xB7 ${meta.fuente}` : SOURCE;
  const created = [meta.fecha, meta.abierta_en].find((value) => typeof value === "string" && !Number.isNaN(Date.parse(value)));
  const owner = [meta.dueno, meta.due\u00F1o, meta.owner].find((value) => typeof value === "string" && value.trim() !== "")?.trim();
  const band = typeof meta.banda === "string" && ["verified", "inferred", "hypothesis"].includes(meta.banda) ? meta.banda : confidence[String(meta.confianza ?? "").toLowerCase()];
  return {
    ...typeof meta.titulo === "string" ? { title: meta.titulo } : {},
    ...noteBody ? { body: noteBody } : {},
    source: sourceDetail,
    ...band ? { band } : {},
    ...created ? { created } : {},
    ...typeof meta.actualizado === "string" ? { updated: meta.actualizado } : {},
    ...owner ? { owner } : {},
    ...typeof meta.para === "string" && meta.para.trim() ? { stakeholder: meta.para.trim() } : {},
    ...typeof meta.plazo === "string" ? { due: meta.plazo } : typeof meta.due === "string" ? { due: meta.due } : {},
    ...Array.isArray(meta.tags) ? { tags: meta.tags.filter((tag) => typeof tag === "string") } : {},
    status: episodic ? status === "borrador" ? "open-session" : "closed" : kind === "aprendizaje" || kind === "lesson" ? "proven" : statusMap[status] ?? (canonical ? "accepted" : void 0),
    acceptedCanonical: canonical
  };
}
function plannedStem(tier, eduId, title) {
  if (tier === "transitive") return eduId;
  if (tier === "canonical") return slugify(title);
  return void 0;
}
function rewriteWikilinks(body, resolveTarget) {
  const targets = [];
  const rewritten = body.replace(/\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (whole, target, heading, display) => {
    const planned = resolveTarget(target.trim());
    if (!planned?.eduStem) return whole;
    targets.push(planned.eduId);
    return `[[${planned.eduStem}${heading ?? ""}|${display ?? target.trim()}]]`;
  });
  return { body: rewritten, targets };
}
function findExisting(notes, origin, mapping, title) {
  return notes.find((note) => note.meta.origin === origin) ?? notes.find((note) => !note.meta.origin && note.meta.source?.startsWith(SOURCE) && note.meta.tier === mapping.tier && note.meta.kind === mapping.kind && note.meta.title === title);
}
async function importAlbert(sourceRoot, brain) {
  const root = await resolveAlbertRoot(sourceRoot);
  const files = [
    ...await markdownFiles(join6(root, "1-CANONICO")),
    ...await markdownFiles(join6(root, "2-EPISODICO")),
    ...await markdownFiles(join6(root, "3-TRANSITIVO"))
  ];
  const report = { source: SOURCE, imported: [], skipped: [], errors: [], warnings: [] };
  const existingNotes = await brain.list();
  const plans = [];
  for (const path of files) {
    try {
      const raw = await readFile6(path, "utf8");
      const parsed = parseMarkdownLenient(raw);
      const meta = parsed.meta && typeof parsed.meta === "object" && !Array.isArray(parsed.meta) ? parsed.meta : {};
      const segments = albertPathSegments(root, path);
      const mapping = classify(segments);
      const extra = normalize(meta, parsed.body, segments);
      const title = String(extra.title ?? meta.title ?? basename4(path, ".md").replace(/^[DHCAL]-(\d+[_-])?/i, "").replace(/[-_]/g, " ")).trim() || basename4(path, ".md");
      const legacyId = albertCorrelative(path);
      const rel = segments.join("/");
      const existing = findExisting(existingNotes, `albert:${rel}`, mapping, title);
      const eduId = existing?.meta.id ?? createId({ tier: mapping.tier, kind: mapping.kind, title, legacy_id: legacyId });
      const eduStem = existing ? basename4(existing.path, ".md") : plannedStem(mapping.tier, eduId, title);
      plans.push({ path, rel, raw, meta, body: parsed.body, invalid: parsed.recovered, mapping, extra, title, ...legacyId ? { legacyId } : {}, eduId, ...eduStem ? { eduStem } : {}, ...existing ? { existing } : {} });
    } catch (error) {
      report.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const byLegacy = /* @__PURE__ */ new Map();
  const byStem = /* @__PURE__ */ new Map();
  for (const plan of plans) {
    if (plan.legacyId) {
      if (byLegacy.has(plan.legacyId)) report.warnings.push(`${plan.path}: duplicate correlative ${plan.legacyId} (links resolve to ${byLegacy.get(plan.legacyId).rel})`);
      else byLegacy.set(plan.legacyId, plan);
    }
    const stem = basename4(plan.rel, ".md").toLowerCase();
    if (!byStem.has(stem)) byStem.set(stem, plan);
  }
  const lookup = (reference) => {
    const key = reference.trim();
    return byLegacy.get(key.toUpperCase()) ?? byStem.get(key.replace(/\.md$/i, "").toLowerCase());
  };
  const translate = (values) => asList(values).map((value) => lookup(value)).filter((plan) => plan?.eduStem).map((plan) => plan.eduId);
  for (const plan of plans) {
    const { path, meta, mapping, extra } = plan;
    try {
      if (plan.existing) {
        await backfill(brain, plan);
        report.skipped.push(path);
        continue;
      }
      const preserved = albertMap(meta, extra);
      const revierte = asList(meta.revierte).filter((value) => value.toLowerCase() !== "ninguna");
      const supersedes = translate(revierte)[0];
      const supersededBy = translate(meta.revertida_por)[0];
      if (plan.invalid) report.warnings.push(`${path}: invalid-frontmatter (YAML could not be parsed; the raw text was kept as the body)`);
      const sourceBody = plan.invalid ? plan.raw.replace(/\r\n/g, "\n").trim() : (extra.body ?? plan.body).trim() || plan.raw.trim();
      const rewritten = plan.invalid ? { body: sourceBody, targets: [] } : rewriteWikilinks(sourceBody, lookup);
      const { targets } = rewritten;
      const body = plan.invalid ? rewritten.body : [rewritten.body, originSection(preserved)].filter(Boolean).join("\n\n");
      const links = [.../* @__PURE__ */ new Set([...translate(meta.produjo), ...translate(meta.cerro), ...supersedes ? [supersedes] : [], ...supersededBy ? [supersededBy] : [], ...targets])].filter((id) => id !== plan.eduId);
      const aliases = plan.legacyId ? [.../* @__PURE__ */ new Set([plan.legacyId, basename4(plan.rel, ".md")])] : [];
      const input = {
        title: plan.title,
        body,
        tier: mapping.tier ?? "transitive",
        kind: mapping.kind ?? "lesson",
        tags: extra.tags ?? (Array.isArray(meta.tags) ? meta.tags.filter((tag) => typeof tag === "string") : []),
        links,
        status: extra.acceptedCanonical ? "proposed" : extra.status ?? mapStatus(meta.status) ?? mapping.status,
        band: extra.band,
        owner: extra.owner,
        stakeholder: extra.stakeholder,
        due: extra.due,
        supersedes,
        created: extra.created,
        updated: extra.updated,
        source: extra.source ?? SOURCE,
        historical: true,
        provenance: {
          origin: `albert:${plan.rel}`,
          aliases,
          legacy_id: plan.legacyId,
          superseded_by: supersededBy,
          ...Object.keys(preserved).length ? { albert: preserved } : {},
          ...plan.invalid ? { import_warning: "invalid-frontmatter" } : {}
        }
      };
      for (const key of ["status", "owner", "stakeholder", "due", "band", "supersedes", "created", "updated"]) if (!input[key]) delete input[key];
      const note = await brain.write(input);
      report.imported.push(extra.acceptedCanonical && note.meta.tier === "canonical" ? await brain.acceptCanonical(note.meta.id) : note);
    } catch (error) {
      report.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}
var present = (value) => value !== void 0 && value !== null && value !== "" && !(Array.isArray(value) && !value.length);
function albertMap(meta, extra) {
  const native = new Set(NATIVE_KEYS);
  if (typeof meta.fecha !== "string" && extra.created === meta.abierta_en) native.add("abierta_en");
  if (extra.band && meta.banda === extra.band) native.add("banda");
  return Object.fromEntries(Object.entries(meta).filter(([key, value]) => !native.has(key) && present(value)));
}
var show = (value) => Array.isArray(value) ? value.map(show).join(", ") : value && typeof value === "object" ? JSON.stringify(value) : String(value);
function originSection(preserved) {
  const keys = Object.keys(preserved).filter((key) => !BOOKKEEPING_KEYS.has(key));
  if (!keys.length) return "";
  const ordered = [...SECTION_ORDER.filter((key) => keys.includes(key)), ...keys.filter((key) => !SECTION_ORDER.includes(key))];
  return ["## Origen Albert", "", ...ordered.map((key) => `- **${key}**: ${show(preserved[key]).replaceAll("\n", " ")}`)].join("\n");
}
async function backfill(brain, plan) {
  const note = plan.existing;
  if (note.meta.origin || note.meta.tier !== "transitive") return;
  const patch = { origin: `albert:${plan.rel}` };
  if (plan.legacyId && !note.meta.legacy_id) {
    patch.legacy_id = plan.legacyId;
    patch.aliases = [.../* @__PURE__ */ new Set([...note.meta.aliases ?? [], plan.legacyId, basename4(plan.rel, ".md")])];
  }
  await brain.update(note.meta.id, patch);
}

// src/brain/import/moragent.ts
import { join as join7 } from "path";
async function importMoragent(sourceRoot, brain) {
  const root = join7(sourceRoot, ".moragent", "memory");
  const files = [...await markdownFiles(join7(root, "canonical")), ...await markdownFiles(join7(root, "episodic")), ...await markdownFiles(join7(root, "transient"))];
  return importFiles(files, brain, "import:moragent", (path) => {
    const relative2 = path.slice(root.length + 1).split(/[\\/]/);
    if (relative2[0] === "canonical") return { tier: "canonical", kind: canonicalKind(relative2[1]), status: "proposed" };
    if (relative2[0] === "episodic") return { tier: "episodic", kind: "session" };
    return { tier: "transitive", kind: "lesson", status: "candidate" };
  });
}

export {
  allowedStatuses,
  validateStatus,
  validateTransition,
  learnedWeight,
  feedbackUsage,
  recordUsage,
  lessonStatus,
  overdueStatus,
  resolveReference,
  tokenize,
  isOperationalNote,
  relevantPassage,
  rankNotes,
  openBrain,
  proposalWhy,
  listCanonicalProposals,
  reviewCanonicalProposals,
  importAlbert,
  importMoragent,
  AUTO_MAINTAIN_INTERVAL_MS,
  maintainStatePath,
  readMaintainState,
  autoMaintain
};
//# sourceMappingURL=chunk-Q53G7BAN.js.map