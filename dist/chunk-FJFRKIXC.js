import {
  parseMarkdownLenient
} from "./chunk-MWM3NETH.js";

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
import { basename as basename2, join as join2, relative as nodeRelative } from "path";

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
  const map = { confirmada: "confirmed", refutada: "refuted", sin_evidencia: "no-evidence", vencido: "overdue", entregado: "delivered", pendiente: "pending", abierta: "open", vigente: "active", revertida: "reverted", aceptada: "accepted", aceptado: "accepted", borrador: "open-session" };
  return typeof status === "string" ? map[status.toLowerCase()] ?? status : void 0;
}
async function importFiles(files, brain, source, classify, normalize) {
  const report = { source, imported: [], skipped: [], errors: [] };
  for (const path of files) {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = parseMarkdownLenient(raw);
      const mapping = classify(path);
      const extra = normalize?.(parsed.meta, parsed.body, path) ?? {};
      const title = String(extra.title ?? parsed.meta.title ?? basename(path, ".md").replace(/^[DHCAL]-/, "").replace(/[-_]/g, " "));
      const noteBody = (extra.body ?? parsed.body) || raw;
      const input = { title, body: noteBody, tier: mapping.tier ?? "transitive", kind: mapping.kind ?? "lesson", tags: extra.tags ?? (Array.isArray(parsed.meta.tags) ? parsed.meta.tags : []), links: Array.isArray(parsed.meta.links) ? parsed.meta.links : [], status: extra.acceptedCanonical ? "proposed" : extra.status ?? mapStatus(parsed.meta.status) ?? mapping.status, band: extra.band ?? parsed.meta.band, owner: extra.owner ?? parsed.meta.owner, due: extra.due ?? parsed.meta.due, supersedes: parsed.meta.supersedes, created: extra.created, updated: extra.updated, source: extra.source ?? source };
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
async function importAlbert(sourceRoot, brain) {
  const root = join2(sourceRoot, "_ALBERT");
  const files = [
    ...await markdownFiles(join2(root, "1-CANONICO")),
    ...await markdownFiles(join2(root, "2-EPISODICO")),
    ...await markdownFiles(join2(root, "3-TRANSITIVO"))
  ];
  return importFiles(files, brain, "import:albert", (path) => {
    const relative = albertPathSegments(root, path);
    if (relative[0] === "1-CANONICO") return { tier: "canonical", kind: canonicalKind({ estandares: "standard", lexico: "lexicon", negocio: "domain", personas: "person" }[relative[1] ?? ""] ?? relative[1]), status: "proposed" };
    if (relative[0] === "2-EPISODICO") return { tier: "episodic", kind: "session" };
    const prefix = /^([DHCAL])-/.exec(relative.at(-1) ?? "")?.[1] ?? "L";
    return { tier: "transitive", kind: asTransitiveKind(prefix) };
  }, (meta, body, path) => {
    const rawType = String(meta.tipo ?? "").toLowerCase();
    const status = String(meta.estado ?? "").toLowerCase();
    const confidence = { alta: "verified", media: "inferred", baja: "hypothesis" };
    const relative = albertPathSegments(root, path);
    const canonical = relative[0] === "1-CANONICO";
    const episodic = relative[0] === "2-EPISODICO";
    const prefix = /^([DHCAL])-/.exec(basename2(path))?.[1];
    const kind = rawType || { D: "decision", H: "hipotesis", C: "compromiso", A: "aprendizaje", L: "aprendizaje" }[prefix ?? ""];
    const statusMap = canonical ? { "": "accepted", aceptada: "accepted", aceptado: "accepted" } : kind === "hipotesis" || kind === "hypothesis" ? { "": "open", abierta: "open", confirmada: "confirmed", refutada: "refuted", sin_evidencia: "no-evidence" } : kind === "compromiso" || kind === "commitment" ? { "": "pending", pendiente: "pending", entregado: "delivered", vencido: "overdue" } : kind === "decision" ? { "": "active", vigente: "active", revertida: "reverted" } : kind === "aprendizaje" || kind === "lesson" ? { "": "proven", proven: "proven", permanente: "proven" } : {};
    const summary = typeof meta.resumen === "string" ? meta.resumen.trim() : "";
    const noteBody = summary && !body.includes(summary) ? `> ${summary.replaceAll("\n", "\n> ")}

${body}` : void 0;
    const sourceDetail = typeof meta.fuente === "string" && meta.fuente ? `import:albert \xB7 ${meta.fuente}` : "import:albert";
    const band = typeof meta.banda === "string" && ["verified", "inferred", "hypothesis"].includes(meta.banda) ? meta.banda : confidence[String(meta.confianza ?? "").toLowerCase()];
    return {
      ...typeof meta.titulo === "string" ? { title: meta.titulo } : {},
      ...noteBody ? { body: noteBody } : {},
      source: sourceDetail,
      ...band ? { band } : {},
      ...typeof meta.fecha === "string" ? { created: meta.fecha } : {},
      ...typeof meta.actualizado === "string" ? { updated: meta.actualizado } : {},
      ...typeof meta.due\u00F1o === "string" ? { owner: meta.due\u00F1o } : typeof meta.owner === "string" ? { owner: meta.owner } : {},
      ...typeof meta.plazo === "string" ? { due: meta.plazo } : typeof meta.due === "string" ? { due: meta.due } : {},
      ...Array.isArray(meta.tags) ? { tags: meta.tags.filter((tag) => typeof tag === "string") } : {},
      status: episodic ? status === "borrador" ? "open-session" : "closed" : kind === "aprendizaje" || kind === "lesson" ? "proven" : statusMap[status] ?? (canonical ? "accepted" : void 0),
      acceptedCanonical: canonical
    };
  });
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
//# sourceMappingURL=chunk-FJFRKIXC.js.map