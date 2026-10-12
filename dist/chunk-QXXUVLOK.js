import {
  createId,
  parseMarkdownLenient,
  slugify
} from "./chunk-7UTDQFLV.js";

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
import { readFile as readFile2, stat } from "fs/promises";
import { basename as basename2, join as join2, relative as nodeRelative, resolve } from "path";

// src/brain/import/shared.ts
import { readdir, readFile } from "fs/promises";
import { basename, join } from "path";
async function markdownFiles(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const target = join(path, entry.name);
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
      const raw = await readFile(path, "utf8");
      const parsed = parseMarkdownLenient(raw);
      const mapping = classify2(path);
      const extra = normalize2?.(parsed.meta, parsed.body, path) ?? {};
      const title = String(extra.title ?? parsed.meta.title ?? basename(path, ".md").replace(/^[DHCAL]-/, "").replace(/[-_]/g, " "));
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
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
async function hasLayers(dir) {
  for (const layer of ALBERT_LAYERS) if (await isDir(join2(dir, layer))) return true;
  return false;
}
async function resolveAlbertRoot(sourceRoot) {
  const source = resolve(sourceRoot);
  const nested = join2(source, "_ALBERT");
  if (await hasLayers(nested)) return nested;
  if (await hasLayers(source)) return source;
  throw new Error(`No Albert vault found at ${source}: expected ${nested} with ${ALBERT_LAYERS.join(", ")} inside, or those folders directly in ${source}. Pass the folder that contains _ALBERT, or _ALBERT itself.`);
}
function albertCorrelative(file) {
  const match = /^([DHCAL])-(\d+)(?=[_\-. ]|$)/i.exec(basename2(file));
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
    ...await markdownFiles(join2(root, "1-CANONICO")),
    ...await markdownFiles(join2(root, "2-EPISODICO")),
    ...await markdownFiles(join2(root, "3-TRANSITIVO"))
  ];
  const report = { source: SOURCE, imported: [], skipped: [], errors: [], warnings: [] };
  const existingNotes = await brain.list();
  const plans = [];
  for (const path of files) {
    try {
      const raw = await readFile2(path, "utf8");
      const parsed = parseMarkdownLenient(raw);
      const meta = parsed.meta && typeof parsed.meta === "object" && !Array.isArray(parsed.meta) ? parsed.meta : {};
      const segments = albertPathSegments(root, path);
      const mapping = classify(segments);
      const extra = normalize(meta, parsed.body, segments);
      const title = String(extra.title ?? meta.title ?? basename2(path, ".md").replace(/^[DHCAL]-(\d+[_-])?/i, "").replace(/[-_]/g, " ")).trim() || basename2(path, ".md");
      const legacyId = albertCorrelative(path);
      const rel = segments.join("/");
      const existing = findExisting(existingNotes, `albert:${rel}`, mapping, title);
      const eduId = existing?.meta.id ?? createId({ tier: mapping.tier, kind: mapping.kind, title, legacy_id: legacyId });
      const eduStem = existing ? basename2(existing.path, ".md") : plannedStem(mapping.tier, eduId, title);
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
    const stem = basename2(plan.rel, ".md").toLowerCase();
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
      const aliases = plan.legacyId ? [.../* @__PURE__ */ new Set([plan.legacyId, basename2(plan.rel, ".md")])] : [];
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
    patch.aliases = [.../* @__PURE__ */ new Set([...note.meta.aliases ?? [], plan.legacyId, basename2(plan.rel, ".md")])];
  }
  await brain.update(note.meta.id, patch);
}

// src/brain/import/moragent.ts
import { join as join3 } from "path";
async function importMoragent(sourceRoot, brain) {
  const root = join3(sourceRoot, ".moragent", "memory");
  const files = [...await markdownFiles(join3(root, "canonical")), ...await markdownFiles(join3(root, "episodic")), ...await markdownFiles(join3(root, "transient"))];
  return importFiles(files, brain, "import:moragent", (path) => {
    const relative = path.slice(root.length + 1).split(/[\\/]/);
    if (relative[0] === "canonical") return { tier: "canonical", kind: canonicalKind(relative[1]), status: "proposed" };
    if (relative[0] === "episodic") return { tier: "episodic", kind: "session" };
    return { tier: "transitive", kind: "lesson", status: "candidate" };
  });
}

export {
  proposalWhy,
  listCanonicalProposals,
  reviewCanonicalProposals,
  importAlbert,
  importMoragent
};
//# sourceMappingURL=chunk-QXXUVLOK.js.map