import {
  CATALOG_FILE,
  appendLog,
  applyLearning,
  assertFeedbackContext,
  feedbackUsage,
  isOperationalNote,
  rankNotes,
  rankQueries,
  resolveReference,
  warnUnsafe,
  withUsageLock,
  writeCatalog
} from "./chunk-5SCDNPRR.js";
import {
  readProjects
} from "./chunk-I6JWASFE.js";
import {
  INDEX_DIR,
  NoteConflictError,
  TIER_DIRS,
  assertInsideBrain,
  atomicWrite,
  contentHash,
  createId,
  encodeNote,
  isUnsafeBrainPath,
  listLocation,
  notePath,
  overlayNotes,
  parseMarkdownLenient,
  readNote,
  slugify
} from "./chunk-GPKNRNOP.js";
import {
  brainPath,
  isInside,
  readWorkspaceSettings,
  vaultFolder,
  vaultPlacement
} from "./chunk-YPR7PZSQ.js";

// src/brain/brain.ts
import { createHash } from "crypto";
import { access, mkdir, readFile as readFile3, readdir, realpath, rm as rm2 } from "fs/promises";
import { hostname } from "os";
import { basename, dirname as dirname2, join as join3, resolve as resolve3 } from "path";

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
  const brain = brainPath(primary);
  const indexDir = join(brain, INDEX_DIR);
  const report = { bases: [], removed: [] };
  for (const file of buildBases(lang, scope)) {
    try {
      await atomicWrite(join(indexDir, file.name), file.content, { root: brain });
      report.bases.push(file.name);
    } catch (error) {
      warnUnsafe(error);
    }
  }
  for (const name of staleBaseFiles(lang)) {
    if (!existsSync(join(indexDir, name))) continue;
    try {
      await assertInsideBrain(brain, join(indexDir, name));
    } catch (error) {
      warnUnsafe(error);
      continue;
    }
    await rm(join(indexDir, name), { force: true });
    report.removed.push(name);
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
  if (existing !== content) {
    try {
      await atomicWrite(target, content, { root: vault });
    } catch (error) {
      warnUnsafe(error);
      report.dashboard = { path: target, written: false };
      return report;
    }
  }
  report.dashboard = { path: target, written: true };
  const other = join(vault, ...DASHBOARD_PATHS[lang === "es" ? "en" : "es"].split("/"));
  const otherText = await readText(other);
  if (otherText !== void 0 && isEduOwned(otherText)) {
    try {
      await assertInsideBrain(vault, other);
    } catch (error) {
      warnUnsafe(error);
      return report;
    }
    await rm(other, { force: true });
    await rmdir(dirname(other)).catch(() => {
    });
  }
  return report;
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
  if (meta.kind === "decision" && patch.status === "reverted" && (!patch.superseded_by || patch.superseded_by === meta.id)) {
    throw new Error("Reverting a decision requires a distinct superseding D- note; create the new decision with supersedes");
  }
}
function isClosedEpisode(meta) {
  return meta.tier === "episodic" && meta.status === "closed";
}

// src/brain/ledger.ts
import { appendFile, readFile as readFile2, rename, stat, writeFile } from "fs/promises";
import { join as join2, resolve as resolve2 } from "path";
var LOCAL_DIR = ".edu-local";
var LEDGER_FILE = "usage.json";
function ledgerPath(root) {
  return join2(root, LOCAL_DIR, LEDGER_FILE);
}
var empty = () => ({ version: 1, notes: {} });
var cache = /* @__PURE__ */ new Map();
function sanitize(raw) {
  const notes = raw && typeof raw === "object" ? raw.notes : void 0;
  const out = empty();
  if (!notes || typeof notes !== "object") return out;
  for (const [id, value] of Object.entries(notes)) {
    const entry = value;
    if (!entry || typeof entry !== "object") continue;
    const uses = typeof entry.uses === "number" && Number.isFinite(entry.uses) && entry.uses >= 0 ? entry.uses : 0;
    out.notes[id] = { uses, ...typeof entry.lastUsed === "string" && Number.isFinite(Date.parse(entry.lastUsed)) ? { lastUsed: entry.lastUsed } : {} };
  }
  return out;
}
async function readLedger(root) {
  const path = resolve2(ledgerPath(root));
  let info;
  try {
    info = await stat(path);
  } catch {
    cache.delete(path);
    return empty();
  }
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size && cached.ino === info.ino) return structuredClone(cached.ledger);
  let ledger;
  try {
    ledger = sanitize(JSON.parse(await readFile2(path, "utf8")));
  } catch {
    return empty();
  }
  cache.set(path, { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino, ledger });
  return structuredClone(ledger);
}
async function updateLedger(root, mutate) {
  const path = ledgerPath(root);
  if (!await safeTarget(root, path)) return;
  const raw = await readFile2(path, "utf8").catch(() => void 0);
  let ledger = empty();
  if (raw !== void 0) {
    try {
      ledger = sanitize(JSON.parse(raw));
    } catch {
      await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => {
      });
    }
  }
  if (!mutate(ledger)) return;
  await ensureLocalIgnored(root);
  cache.delete(resolve2(path));
  try {
    await atomicWrite(path, `${JSON.stringify(ledger)}
`, { root });
  } catch (error) {
    if (!isUnsafeBrainPath(error)) throw error;
    process.emitWarning(`${error.message}; skipped`, "EduWarning");
  }
}
async function safeTarget(root, path) {
  try {
    await assertInsideBrain(root, path);
    return true;
  } catch (error) {
    if (!isUnsafeBrainPath(error)) throw error;
    process.emitWarning(`${error.message}; skipped`, "EduWarning");
    return false;
  }
}
var ignored = /* @__PURE__ */ new Set();
async function ensureLocalIgnored(root) {
  const key = resolve2(root);
  if (ignored.has(key)) return;
  const path = join2(root, ".gitignore");
  if (!await safeTarget(root, path)) return;
  const current = await readFile2(path, "utf8").catch(() => void 0);
  const rules = (current ?? "").split(/\r?\n/).map((line) => line.trim());
  if (!rules.some((rule) => [LOCAL_DIR, `${LOCAL_DIR}/`, `/${LOCAL_DIR}`, `/${LOCAL_DIR}/`].includes(rule))) {
    if (current === void 0) await writeFile(path, `${LOCAL_DIR}/
`, { flag: "wx" }).catch((error) => {
      if (error.code === "EEXIST") return appendFile(path, `${LOCAL_DIR}/
`);
      throw error;
    });
    else await appendFile(path, `${current && !current.endsWith("\n") ? "\n" : ""}${LOCAL_DIR}/
`);
  }
  ignored.add(key);
}
var later = (a, b) => !a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a;
var count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
function mergeExposure(usage, exposure) {
  if (!exposure) return usage;
  const base = usage && typeof usage === "object" ? { ...usage } : { uses: 0, wins: 0, losses: 0 };
  base.uses = Math.max(count(base.uses), exposure.uses);
  const lastUsed = later(typeof base.lastUsed === "string" ? base.lastUsed : void 0, exposure.lastUsed);
  if (lastUsed) base.lastUsed = lastUsed;
  else delete base.lastUsed;
  return base;
}
function nextExposure(merged, now) {
  return { uses: count(merged?.uses) + 1, lastUsed: now.toISOString() };
}
var hasFeedback = (usage) => count(usage.wins) > 0 || count(usage.losses) > 0 || count(usage.verifiedWins) > 0 || count(usage.verifiedLosses) > 0 || Boolean(usage.lastVerified) || Boolean(usage.events?.length);
function frontmatterUsage(next, disk, isNewFile) {
  if (isNewFile || !next) return next ?? (isNewFile ? void 0 : disk);
  const out = { ...next, uses: disk?.uses ?? 0 };
  if (disk?.lastUsed) out.lastUsed = disk.lastUsed;
  else delete out.lastUsed;
  if (!disk && !hasFeedback(out)) return void 0;
  return out;
}

// src/brain/redact.ts
var marker = (kind) => `[REDACTED:${kind}]`;
var KEY_WORDS = String.raw`(?:password|passwd|passphrase|pass|pwd|client[_-]?secret|secret[_ -]?access[_ -]?key|secret|api[_ -]?key|access[_ -]?key(?:[_-]?id)?|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|private[_-]?key|credentials?|conn(?:ection)?[_ -]?str(?:ing)?|auth)`;
var RULES = [
  { kind: "private-key", pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { kind: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai-key", pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { kind: "gitlab-token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    // An Authorization header with a scheme: whatever follows is a credential, whatever its character mix.
    kind: "bearer-token",
    pattern: /\b((?:proxy-)?authorization["']?\s*[:=]\s*["']?(?:bearer|basic|token)\s+)([^\s"'`,;]{8,})/gi,
    replace: (m, prefix, value) => isPlaceholder(value) ? `${prefix}${value}` : `${prefix}${m}`
  },
  {
    // A bare `Bearer <token>` / `Basic <base64>`; a plain (capitalized) word after it is prose, not a credential.
    kind: "bearer-token",
    pattern: /\b(bearer|basic)\s+([A-Za-z0-9\-._~+/]{8,}=*)/gi,
    replace: (m, scheme, value) => /^[A-Z]?[a-z]+$/.test(value) || scheme.toLowerCase() === "bearer" && value.length < 12 ? `${scheme} ${value}` : `${scheme} ${m}`
  },
  {
    kind: "connection-string",
    pattern: /\b([a-z][a-z0-9+.-]{1,20}:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
    replace: (m, scheme, user, password) => isPlaceholder(password) ? `${scheme}${user}:${password}@` : `${scheme}${user}:${m}@`
  },
  {
    // key = value, key: value, "key": "value", KEY=value (env files). Only the value is replaced: a quoted value
    // whole (spaces and escapes included: `\"` in JSON/YAML, `''` in YAML single quotes), an unterminated quoted
    // value to the end of its line, an unquoted one to the end of its token.
    kind: "assignment",
    pattern: new RegExp(String.raw`(\b(?:[\w.-]*[_.-])?${KEY_WORDS}["']?\s*[:=][ \t]*)(?:${[
      String.raw`"((?:[^"\\\r\n]|\\.)+)"`,
      String.raw`'((?:[^'\\\r\n]|\\.|'')+)'`,
      String.raw`"((?:[^"\\\r\n]|\\.)+\\?|\\)(?=[\r\n]|$)`,
      String.raw`'((?:[^'\\\r\n]|\\.)+\\?|\\)(?=[\r\n]|$)`,
      String.raw`([^\s"'\`,;)}\]]{4,})`
    ].join("|")})`, "gi"),
    replace: (m, prefix, double, single, openDouble, openSingle, bare) => {
      const [open, close] = double ? ['"', '"'] : single ? ["'", "'"] : openDouble ? ['"', ""] : openSingle ? ["'", ""] : ["", ""];
      const value = double || single || openDouble || openSingle || bare;
      return `${prefix}${open}${isPlaceholder(value) ? value : m}${close}`;
    }
  },
  {
    // "the api key is 9f8a…" / "token 9f8a…": a long, high-entropy run right after a key-like word.
    kind: "high-entropy",
    pattern: new RegExp(String.raw`(\b${KEY_WORDS}\s+(?:is\s+|was\s+|of\s+)?)([A-Za-z0-9_\-+/=]{32,})`, "gi"),
    replace: (m, prefix, value) => looksRandom(value) ? `${prefix}${m}` : `${prefix}${value}`
  }
];
function isPlaceholder(value) {
  return /^\[REDACTED/.test(value) || /^(?:<.*>|\$\{?.*|\{\{.*|%\w+%?|\*+|x+|\.{3,}|…|null|none|true|false|undefined|changeme|example|redacted|your[-_].*|process\.env\..*|os\.environ.*|env\..*)$/i.test(value);
}
function looksRandom(value) {
  if (!/[a-z]/i.test(value) || !/\d/.test(value)) return false;
  const counts = /* @__PURE__ */ new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy >= 3.5;
}
function redactSecrets(text) {
  const kinds = [];
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match, ...rest) => {
      const groups = rest.slice(0, -2).map((group) => typeof group === "string" ? group : "");
      const replaced = rule.replace ? rule.replace(marker(rule.kind), ...groups) : marker(rule.kind);
      if (replaced !== match && !kinds.includes(rule.kind)) kinds.push(rule.kind);
      return replaced;
    });
  }
  return { text: out, kinds };
}
function redactValue(value) {
  const kinds = [];
  const walk = (item) => {
    if (typeof item === "string") {
      const result = redactSecrets(item);
      for (const kind of result.kinds) if (!kinds.includes(kind)) kinds.push(kind);
      return result.text;
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
    }
    return item;
  };
  const out = walk(value);
  return { value: kinds.length ? out : value, kinds };
}
var REDACTED_TAG = "redacted";

// src/brain/compile.ts
var QUERY_BODY_CHARS = 200;
function compileReportLines(report) {
  const lines = [];
  if (report.linked.length) lines.push(`Linked: ${report.linked.join(", ")}`);
  for (const conflict of report.possibleConflicts) lines.push(`Possible conflict: ${conflict.id} \xB7 ${conflict.title} (${conflict.reason}); consider supersedes: ${conflict.id}`);
  if (report.redacted.length) lines.push(`Redacted secrets (${report.redacted.join(", ")}) before writing; the note is tagged redacted.`);
  return lines;
}
function competing(draft, other) {
  const a = draft.meta, b = other.meta;
  if (a.kind !== b.kind) return void 0;
  if (a.supersedes === b.id || b.supersedes === a.id) return void 0;
  if (a.kind === "decision" && (a.status ?? "active") === "active" && b.status === "active") return "both are active decisions";
  if (a.tier === "canonical" && b.tier === "canonical" && b.status === "accepted") return `an accepted canonical ${b.kind ?? "note"} already covers this`;
  return void 0;
}
function compileNote(draft, existing, options = {}) {
  const { now = /* @__PURE__ */ new Date(), limit = 5, minRatio = 0.3, conflictRatio = 0.55 } = options;
  const own = Array.isArray(draft.meta.links) ? draft.meta.links : [];
  const query = `${draft.meta.title} ${draft.body.slice(0, QUERY_BODY_CHARS)}`;
  const pool = [...existing.filter((note) => note.meta.id !== draft.meta.id), draft];
  const hits = rankNotes(query, pool, now, pool.length, { includeHistory: true, includePassages: false, similarity: true });
  const self = hits.find((hit) => hit.note === draft)?.score ?? hits[0]?.score ?? 0;
  if (!(self > 0)) return { links: [...new Set(own)], linked: [], possibleConflicts: [] };
  const related = hits.filter((hit) => hit.note !== draft && hit.note.meta.id !== draft.meta.id).filter((hit) => hit.note.meta.tier !== "episodic" && hit.note.meta.kind !== "session" && isOperationalNote(hit.note)).filter((hit) => hit.score >= minRatio * self).slice(0, Math.max(0, limit));
  const linked = related.map((hit) => hit.note.meta.id).filter((id) => !own.includes(id));
  const possibleConflicts = [];
  for (const hit of related) {
    const ratio = hit.score / self;
    const why = ratio >= conflictRatio ? competing(draft, hit.note) : void 0;
    if (why) possibleConflicts.push({ id: hit.note.meta.id, title: hit.note.meta.title, reason: `${why}; overlap ${ratio.toFixed(2)}` });
  }
  return {
    links: [.../* @__PURE__ */ new Set([...own, ...linked])],
    linked,
    possibleConflicts,
    ...possibleConflicts.length && !draft.meta.supersedes ? { suggestedSupersedes: possibleConflicts[0].id } : {}
  };
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
var usedThisMinute = (usage, now) => {
  const last = usage?.lastUsed ? Date.parse(usage.lastUsed) : NaN;
  return Number.isFinite(last) && Math.floor(last / 6e4) === Math.floor(now.getTime() / 6e4);
};
var originOf = (by) => {
  const clean = (value) => typeof value === "string" && value.trim() ? value.trim() : void 0;
  const host = clean(by?.host) ?? hostname(), agent = clean(by?.agent), session = clean(by?.session);
  return { ...host ? { host } : {}, ...agent ? { agent } : {}, ...session ? { session } : {} };
};
var updateOp = (meta, patch, authority) => {
  if (authority === "accept-canonical") return "accept";
  if (authority === "supersede-canonical" || authority === "revert-decision") return "supersede";
  if (!patch.status || patch.status === meta.status) return void 0;
  return meta.kind === "session" && patch.status === "closed" ? "close-session" : `status:${patch.status}`;
};
var provenanceOf = (provenance) => Object.fromEntries(Object.entries(provenance ?? {}).filter(([, value]) => value !== void 0 && value !== "" && !(Array.isArray(value) && !value.length)));
var pathExists = (path) => access(path).then(() => true, () => false);
var NEW_NOTE_TEXT = ["tags", "source", "owner", "stakeholder", "provenance", "by"];
var META_TEXT = ["tags", "source", "owner", "stakeholder", "aliases", "origin", "albert", "legacy_id", "import_warning"];
function redactFields(record, keys) {
  const out = { ...record }, kinds = [];
  for (const key of keys) {
    if (out[key] === void 0) continue;
    const result = redactValue(out[key]);
    out[key] = result.value;
    for (const kind of result.kinds) if (!kinds.includes(kind)) kinds.push(kind);
  }
  return { record: out, kinds };
}
function redactInput(input) {
  const title = redactSecrets(input.title), body = redactSecrets(input.body), meta = redactFields(input, NEW_NOTE_TEXT);
  const kinds = [.../* @__PURE__ */ new Set([...title.kinds, ...body.kinds, ...meta.kinds])];
  if (!kinds.length) return { input, kinds };
  return { input: { ...meta.record, title: title.text, body: body.text, tags: [.../* @__PURE__ */ new Set([...meta.record.tags ?? [], REDACTED_TAG])] }, kinds };
}
function openBrain(locations, viewOptions = {}) {
  if (!locations.length) throw new Error("openBrain requires at least one location");
  const primary = locations[0];
  const locationOf = (path) => locations.find((loc) => isInside(brainPath(loc), path)) ?? primary;
  const withExposure = async (notes) => {
    const ledgers = /* @__PURE__ */ new Map();
    for (const note of notes) {
      const root = locationOf(note.path).root;
      let ledger = ledgers.get(root);
      if (!ledger) {
        ledger = await readLedger(root);
        ledgers.set(root, ledger);
      }
      const usage = mergeExposure(note.meta.usage, ledger.notes[note.meta.id]);
      if (usage) note.meta.usage = usage;
    }
    return notes;
  };
  const all = async () => withExposure(await overlayNotes(locations));
  const log = (note, op) => appendLog(brainPath(locationOf(note.path)), { op, id: note.meta.id, title: note.meta.title });
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
  const rootOf = (path) => locationOf(path).root;
  const withRoots = async (roots, body) => {
    const canonical = await Promise.all(roots.map(async (root) => {
      await mkdir(resolve3(root), { recursive: true });
      return realpath(resolve3(root));
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
    const retired = await persistFresh({ ...old, meta: { ...old.meta, status: "retired", superseded_by: successor.meta.id, updated: iso() } });
    await log(retired, "supersede");
    return retired;
  };
  const find = async (id) => (await all()).find((note) => note.meta.id === id);
  let batchDepth = 0;
  let batchPaths = [];
  const refreshCatalogs = async (paths) => {
    if (batchDepth > 0) {
      batchPaths.push(...paths);
      return;
    }
    const deepest = Math.max(0, ...paths.map((path) => locations.indexOf(locationOf(path))));
    const affected = locations.slice(0, deepest + 1);
    try {
      await withRoots(affected.map((loc) => loc.root), async () => {
        for (const [index, loc] of affected.entries()) await writeCatalog(brainPath(loc), await overlayNotes(locations.slice(index)), (note) => note.meta.source !== REJECT_SOURCE);
      });
    } catch (error) {
      process.emitWarning(`catalog not refreshed: ${error instanceof Error ? error.message : String(error)}`, "EduWarning");
    }
  };
  const persist = async (note) => {
    const disk = await readNote(note.path);
    const usage = frontmatterUsage(note.meta.usage, disk?.meta.usage, disk === void 0);
    const meta = { ...note.meta };
    if (usage) meta.usage = usage;
    else delete meta.usage;
    await atomicWrite(note.path, encodeNote({ ...note, meta }), { root: brainPath(locationOf(note.path)) });
    return (await withExposure([{ ...note, meta: structuredClone(meta) }]))[0];
  };
  const updateNote = async (id, patch, body, authority, options = {}) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const seen = await find(id);
      if (!seen) throw new Error(`Note not found: ${id}`);
      const roots = [rootOf(seen.path), primary.root];
      const done = await withRoots(roots, async () => {
        const current = await find(id);
        if (!current) throw new Error(`Note not found: ${id}`);
        if (!roots.includes(rootOf(current.path))) return void 0;
        return applyUpdate(current, patch, body, authority, options);
      });
      if (done) return done;
    }
    throw new Error(`Note could not settle on a stable location: ${id}`);
  };
  const applyUpdate = async (current, patchIn, bodyIn, authority, options = {}) => {
    const id = current.meta.id;
    if (options.expectedHash !== void 0) {
      const currentHash = contentHash(current);
      if (options.expectedHash.trim().toLowerCase() !== currentHash) throw new NoteConflictError(id, options.expectedHash, currentHash);
    }
    const redacted = bodyIn === void 0 ? void 0 : redactSecrets(bodyIn);
    const body = redacted?.text ?? bodyIn;
    const metaRedacted = redactFields(patchIn, META_TEXT);
    const patch = metaRedacted.record;
    if ((redacted?.kinds.length || metaRedacted.kinds.length) && !(patch.tags ?? current.meta.tags).includes(REDACTED_TAG)) patch.tags = [.../* @__PURE__ */ new Set([...patch.tags ?? current.meta.tags, REDACTED_TAG])];
    const protectedKeys = /* @__PURE__ */ new Set(["id", "tier", "kind", "created", "title", "source", "supersedes", "updated", "path", "host", "agent", "session"]);
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
      if (body !== void 0 || patch.title !== void 0 || patch.supersedes !== void 0) throw new Error("Decisions are immutable; create a new D- note with supersedes instead");
      if (patch.status && (authority !== "revert-decision" || patch.status !== "reverted")) throw new Error("Decision status cannot be edited; create a new D- note with supersedes");
      if (patch.status === "reverted") assertDecisionReversion(current.meta, patch);
    }
    if (patch.status && current.meta.kind) validateTransition(current.meta.tier === "canonical" ? "canonical" : current.meta.kind, current.meta.status, patch.status);
    if (patch.usage && (patch.usage.uses !== void 0 || patch.usage.lastUsed !== void 0)) {
      const exposure = { uses: Number(patch.usage.uses) || 0, ...patch.usage.lastUsed ? { lastUsed: patch.usage.lastUsed } : {} };
      await updateLedger(rootOf(current.path), (ledger) => {
        ledger.notes[id] = exposure;
        return true;
      });
    }
    const origin = options.by ? originOf(options.by) : {};
    const meta = { ...current.meta, ...patch, ...origin, id: current.meta.id, tier: current.meta.tier, updated: iso() };
    if (options.by) {
      for (const key of ["agent", "session"]) if (!(key in origin)) delete meta[key];
    }
    const written = await persist({ ...current, meta, body: body ?? current.body });
    const op = updateOp(current.meta, patch, authority);
    if (op) await log(written, op);
    return written;
  };
  const markUsed = (candidates, now) => withRoots(candidates.map((candidate) => rootOf(candidate.path)), async () => {
    const byRoot = /* @__PURE__ */ new Map();
    for (const candidate of candidates) byRoot.set(rootOf(candidate.path), [...byRoot.get(rootOf(candidate.path)) ?? [], candidate]);
    for (const [root, group] of byRoot) {
      const disk = await Promise.all(group.map(async (candidate) => await readNote(candidate.path) ?? candidate));
      await updateLedger(root, (ledger) => {
        let changed = false;
        for (const note of disk) {
          if (isClosedEpisode(note.meta)) continue;
          const merged = mergeExposure(note.meta.usage, ledger.notes[note.meta.id]);
          if (usedThisMinute(merged, now)) continue;
          ledger.notes[note.meta.id] = nextExposure(merged, now);
          changed = true;
        }
        return changed;
      });
    }
  });
  return {
    async init(loc, opts = {}) {
      for (const folder of ["0-index", "1-canonical", "2-episodic", "3-transitive"]) await mkdir(join3(brainPath(loc), folder), { recursive: true });
      for (const folder of ["skills", "agents", "playbooks", "proposals", "runs"]) await mkdir(join3(loc.root, folder), { recursive: true });
      await ensureLocalIgnored(loc.root);
      try {
        const { resolveTemplatesDir } = await import("./adapters-UK3C6UAY.js");
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
          const { resolveTemplatesDir } = await import("./adapters-UK3C6UAY.js");
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
    async write(raw) {
      const input = redactInput(raw).input;
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
        ...provenanceOf(input.provenance),
        ...originOf(input.by)
      };
      if (meta.status && meta.kind) validateStatus(meta.tier === "canonical" ? "canonical" : meta.kind, meta.status);
      const path = notePath(brainPath(primary), meta, now);
      const note = { meta, body: input.body, path };
      let created;
      const touched = [];
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
              await applyUpdate(prior, { status: "reverted", superseded_by: fresh.meta.id }, void 0, "revert-decision");
            } catch (error) {
              await rm2(fresh.path, { force: true });
              throw error;
            }
            touched.push(prior.path);
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
      const openSession = meta.kind === "session" && meta.status === "open-session";
      if (!openSession) await log(created, "write");
      if (meta.kind === "lesson" && meta.supersedes) {
        const retired = await retireSuperseded(created, new Map((await all()).map((note2) => [note2.meta.id, note2])));
        if (retired) touched.push(retired.path);
      }
      if (!openSession) await refreshCatalogs([created.path, ...touched]);
      return created;
    },
    async remember(raw) {
      const { input, kinds } = redactInput(raw);
      const report = { linked: [], possibleConflicts: [], redacted: kinds };
      let links = input.links ?? [];
      if (input.tier === "transitive" || input.tier === "canonical") {
        const created = input.created ? new Date(input.created) : /* @__PURE__ */ new Date();
        const draftMeta = {
          id: createId({ tier: input.tier, kind: input.kind, title: input.title, legacy_id: input.provenance?.legacy_id }, created),
          tier: input.tier,
          title: input.title,
          ...input.kind ? { kind: input.kind } : {},
          status: input.tier === "canonical" ? "proposed" : input.status ?? defaultStatus(input.tier, input.kind),
          tags: input.tags ?? [],
          links,
          created: iso(created),
          ...input.supersedes ? { supersedes: input.supersedes } : {}
        };
        const compiled = compileNote({ meta: draftMeta, body: input.body, path: "" }, await all());
        links = compiled.links;
        report.linked = compiled.linked;
        report.possibleConflicts = compiled.possibleConflicts;
        if (compiled.suggestedSupersedes) report.suggestedSupersedes = compiled.suggestedSupersedes;
      }
      const note = await this.write({ ...input, links });
      return { note, report };
    },
    async update(id, patch, body, options) {
      const updated = await updateNote(id, patch, body, void 0, options);
      if (body !== void 0 || Object.keys(patch).some((key) => key !== "usage" && key !== "updated")) await refreshCatalogs([updated.path]);
      return updated;
    },
    async hashOf(id) {
      const note = await find(id);
      return note && contentHash(note);
    },
    async recall(query, opts = {}) {
      const notes = (await all()).filter((n) => !opts.tiers || opts.tiers.includes(n.meta.tier));
      const hits = typeof query === "string" ? rankNotes(query, notes, /* @__PURE__ */ new Date(), opts.limit) : rankQueries(query, notes, /* @__PURE__ */ new Date(), opts.limit);
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
    async openSession(title, source, by) {
      return this.write({ title, body: "", tier: "episodic", kind: "session", status: "open-session", source, ...by ? { by } : {} });
    },
    async closeSession(id, summary, options) {
      return this.update(id, { status: "closed" }, summary, options);
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
        const touched = [];
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
            touched.push(replaces.path);
          }
          return accepted;
        });
        if (done) {
          await refreshCatalogs([done.path, ...touched]);
          return done;
        }
      }
      throw new Error(`Canonical note could not settle on a stable location: ${id}`);
    },
    async rejectCanonical(id, reason) {
      const note = await find(id);
      if (!note || note.meta.tier !== "canonical") throw new Error(`Canonical note not found: ${id}`);
      if (note.meta.status !== "proposed") throw new Error("Only proposed canonical notes can be rejected");
      await rm2(note.path, { force: true });
      await log(note, "reject");
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
      if (rootOf(note.path) !== rootOf(record.path)) await refreshCatalogs([note.path]);
      return note;
    },
    async discardEmptySession(id) {
      const seen = await find(id);
      if (!seen) return false;
      const removed = await withRoots([rootOf(seen.path)], async () => {
        const current = await readNote(seen.path);
        if (!current || current.meta.id !== id || current.meta.tier !== "episodic" || current.meta.kind !== "session" || current.meta.status !== "open-session" || current.body.trim()) return false;
        await rm2(current.path, { force: true });
        return true;
      });
      if (removed && (await readFile3(join3(brainPath(locationOf(seen.path)), INDEX_DIR, CATALOG_FILE), "utf8").catch(() => "")).includes(id)) await refreshCatalogs([seen.path]);
      return removed;
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
        await log(await persistFresh(next), `maintain:${next.meta.status ?? "unspecified"}`);
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
    async batch(work) {
      batchDepth++;
      try {
        return await work();
      } finally {
        if (--batchDepth === 0 && batchPaths.length) {
          const paths = batchPaths;
          batchPaths = [];
          await refreshCatalogs(paths);
        }
      }
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
        for (const note of group.sort((a, b) => a.meta.title.localeCompare(b.meta.title))) lines.push(`- [[${basename(note.path, ".md")}|${note.meta.title}]] \u2014 ${note.meta.band ?? "inferred"} \xB7 ${note.meta.status ?? "unspecified"}`);
        lines.push("");
      }
      try {
        await atomicWrite(join3(brainPath(primary), INDEX_DIR, "INDEX.md"), `${lines.join("\n")}
`, { root: brainPath(primary) });
      } catch (error) {
        warnUnsafe(error);
      }
      await writeCatalog(brainPath(primary), notes, (note) => note.meta.source !== REJECT_SOURCE);
      await writeObsidianViews(primary, viewOptions);
    },
    async move(id, targetRoot) {
      const target = locations.find((loc) => resolve3(loc.root) === resolve3(targetRoot));
      if (!target) throw new Error(`Not a location of this brain: ${targetRoot}`);
      const seen = await find(id);
      if (!seen) throw new Error(`Note not found: ${id}`);
      const source = locationOf(seen.path);
      if (source === target) throw new Error(`${id} is already in the ${target.scope} brain (${target.root})`);
      const moved = await withRoots([source.root, target.root], async () => {
        const current = (await listLocation(source)).find((note) => note.meta.id === id);
        if (!current) throw new Error(`Note not found in the ${source.scope} brain: ${id}`);
        if (current.meta.kind === "session" && current.meta.status === "open-session") throw new Error(`${id} is an open session; close it before moving it`);
        if ((await listLocation(target)).some((note) => note.meta.id === id)) throw new Error(`Note id already exists in the ${target.scope} brain: ${id}; nothing was moved`);
        const path = notePath(brainPath(target), current.meta, new Date(current.meta.created));
        if (await pathExists(path)) throw new Error(`${path} already exists; nothing was moved`);
        await atomicWrite(path, await readFile3(current.path, "utf8"), { root: brainPath(target) });
        const copy = await readNote(path);
        if (copy?.meta.id !== id) {
          await rm2(path, { force: true });
          throw new Error(`The copy of ${id} in the ${target.scope} brain could not be read back; nothing was moved`);
        }
        const exposure = (await readLedger(source.root)).notes[id];
        if (exposure) {
          await updateLedger(target.root, (ledger) => {
            if (ledger.notes[id]) return false;
            ledger.notes[id] = exposure;
            return true;
          });
          await updateLedger(source.root, (ledger) => {
            delete ledger.notes[id];
            return true;
          });
        }
        await rm2(current.path);
        return copy;
      });
      for (const loc of [source, target]) await appendLog(brainPath(loc), { op: `move:${target.scope}`, id, title: moved.meta.title });
      for (const loc of [source, target]) {
        if (loc === primary) await this.rebuildIndex();
        else await writeCatalog(brainPath(loc), await overlayNotes(locations.slice(locations.indexOf(loc))), (note) => note.meta.source !== REJECT_SOURCE);
      }
      return (await withExposure([moved]))[0];
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

// src/brain/import/albert.ts
import { readFile as readFile5, stat as stat2 } from "fs/promises";
import { basename as basename3, join as join5, relative as nodeRelative, resolve as resolve4 } from "path";

// src/brain/import/shared.ts
import { readdir as readdir2, readFile as readFile4 } from "fs/promises";
import { basename as basename2, join as join4 } from "path";
async function markdownFiles(path) {
  let entries;
  try {
    entries = await readdir2(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const target = join4(path, entry.name);
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
  return brain.batch ? brain.batch(() => importFilesUnbatched(files, brain, source, classify2, normalize2)) : importFilesUnbatched(files, brain, source, classify2, normalize2);
}
async function importFilesUnbatched(files, brain, source, classify2, normalize2) {
  const report = { source, imported: [], skipped: [], errors: [], warnings: [] };
  for (const path of files) {
    try {
      const raw = await readFile4(path, "utf8");
      const parsed = parseMarkdownLenient(raw);
      const mapping = classify2(path);
      const extra = normalize2?.(parsed.meta, parsed.body, path) ?? {};
      const title = String(extra.title ?? parsed.meta.title ?? basename2(path, ".md").replace(/^[DHCAL]-/, "").replace(/[-_]/g, " "));
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
  for (const layer of ALBERT_LAYERS) if (await isDir(join5(dir, layer))) return true;
  return false;
}
async function resolveAlbertRoot(sourceRoot) {
  const source = resolve4(sourceRoot);
  const nested = join5(source, "_ALBERT");
  if (await hasLayers(nested)) return nested;
  if (await hasLayers(source)) return source;
  throw new Error(`No Albert vault found at ${source}: expected ${nested} with ${ALBERT_LAYERS.join(", ")} inside, or those folders directly in ${source}. Pass the folder that contains _ALBERT, or _ALBERT itself.`);
}
function albertCorrelative(file) {
  const match = /^([DHCAL])-(\d+)(?=[_\-. ]|$)/i.exec(basename3(file));
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
  return brain.batch ? brain.batch(() => importAlbertUnbatched(sourceRoot, brain)) : importAlbertUnbatched(sourceRoot, brain);
}
async function importAlbertUnbatched(sourceRoot, brain) {
  const root = await resolveAlbertRoot(sourceRoot);
  const files = [
    ...await markdownFiles(join5(root, "1-CANONICO")),
    ...await markdownFiles(join5(root, "2-EPISODICO")),
    ...await markdownFiles(join5(root, "3-TRANSITIVO"))
  ];
  const report = { source: SOURCE, imported: [], skipped: [], errors: [], warnings: [] };
  const existingNotes = await brain.list();
  const plans = [];
  for (const path of files) {
    try {
      const raw = await readFile5(path, "utf8");
      const parsed = parseMarkdownLenient(raw);
      const meta = parsed.meta && typeof parsed.meta === "object" && !Array.isArray(parsed.meta) ? parsed.meta : {};
      const segments = albertPathSegments(root, path);
      const mapping = classify(segments);
      const extra = normalize(meta, parsed.body, segments);
      const title = String(extra.title ?? meta.title ?? basename3(path, ".md").replace(/^[DHCAL]-(\d+[_-])?/i, "").replace(/[-_]/g, " ")).trim() || basename3(path, ".md");
      const legacyId = albertCorrelative(path);
      const rel = segments.join("/");
      const existing = findExisting(existingNotes, `albert:${rel}`, mapping, title);
      const eduId = existing?.meta.id ?? createId({ tier: mapping.tier, kind: mapping.kind, title, legacy_id: legacyId });
      const eduStem = existing ? basename3(existing.path, ".md") : plannedStem(mapping.tier, eduId, title);
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
    const stem = basename3(plan.rel, ".md").toLowerCase();
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
      const aliases = plan.legacyId ? [.../* @__PURE__ */ new Set([plan.legacyId, basename3(plan.rel, ".md")])] : [];
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
    patch.aliases = [.../* @__PURE__ */ new Set([...note.meta.aliases ?? [], plan.legacyId, basename3(plan.rel, ".md")])];
  }
  await brain.update(note.meta.id, patch);
}

// src/brain/import/moragent.ts
import { join as join6 } from "path";
async function importMoragent(sourceRoot, brain) {
  const root = join6(sourceRoot, ".moragent", "memory");
  const files = [...await markdownFiles(join6(root, "canonical")), ...await markdownFiles(join6(root, "episodic")), ...await markdownFiles(join6(root, "transient"))];
  return importFiles(files, brain, "import:moragent", (path) => {
    const relative2 = path.slice(root.length + 1).split(/[\\/]/);
    if (relative2[0] === "canonical") return { tier: "canonical", kind: canonicalKind(relative2[1]), status: "proposed" };
    if (relative2[0] === "episodic") return { tier: "episodic", kind: "session" };
    return { tier: "transitive", kind: "lesson", status: "candidate" };
  });
}

export {
  DASHBOARD_PATHS,
  allowedStatuses,
  validateStatus,
  validateTransition,
  isClosedEpisode,
  LOCAL_DIR,
  ledgerPath,
  readLedger,
  redactSecrets,
  REDACTED_TAG,
  compileReportLines,
  compileNote,
  openBrain,
  proposalWhy,
  listCanonicalProposals,
  reviewCanonicalProposals,
  importAlbert,
  importMoragent
};
//# sourceMappingURL=chunk-KWXFE3IE.js.map