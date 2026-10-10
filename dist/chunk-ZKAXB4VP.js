import {
  INDEX_DIR,
  atomicWrite,
  createId,
  encodeNote,
  notePath,
  overlayNotes,
  parseMarkdownLenient
} from "./chunk-IULFTIQE.js";

// src/brain/brain.ts
import { access, mkdir, readFile } from "fs/promises";
import { basename, join } from "path";
import { stringify } from "yaml";

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
var fallbackEdu = `# EDU

Edu is the durable, engine-independent memory contract.

- Keep canonical notes human-confirmed.
- Never edit closed session notes.
- Record decisions as new notes when they change.
`;
var iso = (d = /* @__PURE__ */ new Date()) => d.toISOString();
var defaultStatus = (tier, kind) => tier === "canonical" ? "proposed" : { decision: "active", hypothesis: "open", commitment: "pending", lesson: "candidate", session: "open-session" }[kind];
function openBrain(locations) {
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
      for (const folder of ["brain/0-index", "brain/1-canonical", "brain/2-episodic", "brain/3-transitive", "skills", "agents", "proposals", "runs"]) await mkdir(join(loc.root, folder), { recursive: true });
      try {
        await access(join(loc.root, "EDU.md"));
      } catch {
        let contract = fallbackEdu;
        try {
          const { resolveTemplatesDir } = await import("./adapters-EXN32OR6.js");
          contract = await readFile(join(resolveTemplatesDir(), "EDU.md"), "utf8");
        } catch {
        }
        contract = contract.replaceAll("{{name}}", opts.identityName ?? "Edu");
        await atomicWrite(join(loc.root, "EDU.md"), contract);
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
      const path = notePath(primary.root, meta, now);
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
          const proposalExists = (await all()).some((candidate) => candidate.meta.tier === "canonical" && candidate.meta.source === "edu:maintain" && candidate.meta.links.includes(next.meta.id));
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
        for (const note of group.sort((a, b) => a.meta.title.localeCompare(b.meta.title))) lines.push(`- [[${basename(note.path, ".md")}|${note.meta.title}]] \u2014 ${note.meta.band ?? "inferred"} \xB7 ${note.meta.status ?? "unspecified"}`);
        lines.push("");
      }
      await atomicWrite(join(primary.root, "brain", INDEX_DIR, "INDEX.md"), `${lines.join("\n")}
`);
      for (const [kind, file, props] of [
        ["lesson", "Lessons.base", ["title", "status", "tags", "usage.wins", "usage.losses"]],
        ["commitment", "Commitments.base", ["title", "status", "owner", "due", "tags"]],
        ["hypothesis", "Hypotheses.base", ["title", "status", "band", "tags"]],
        ["session", "Sessions.base", ["title", "status", "created", "source"]]
      ]) {
        const folder = kind === "session" ? "2-episodic" : kind === "lesson" || kind === "commitment" || kind === "hypothesis" ? "3-transitive" : "";
        const content = stringify({ filters: { and: [`file.inFolder("brain/${folder}")`, `file.hasTag("${kind}")`] }, views: [{ type: "table", name: kind[0].toUpperCase() + kind.slice(1), order: props.map((prop) => prop.startsWith("usage.") ? `note.${prop}` : `note.${prop}`) }] });
        await atomicWrite(join(primary.root, "brain", INDEX_DIR, file), content);
      }
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

// src/brain/import/albert.ts
import { basename as basename3, join as join3, relative as nodeRelative } from "path";

// src/brain/import/shared.ts
import { readdir, readFile as readFile2 } from "fs/promises";
import { basename as basename2, join as join2 } from "path";
async function markdownFiles(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const target = join2(path, entry.name);
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
      const raw = await readFile2(path, "utf8");
      const parsed = parseMarkdownLenient(raw);
      const mapping = classify(path);
      const extra = normalize?.(parsed.meta, parsed.body, path) ?? {};
      const title = String(extra.title ?? parsed.meta.title ?? basename2(path, ".md").replace(/^[DHCAL]-/, "").replace(/[-_]/g, " "));
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
  const root = join3(sourceRoot, "_ALBERT");
  const files = [
    ...await markdownFiles(join3(root, "1-CANONICO")),
    ...await markdownFiles(join3(root, "2-EPISODICO")),
    ...await markdownFiles(join3(root, "3-TRANSITIVO"))
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
    const prefix = /^([DHCAL])-/.exec(basename3(path))?.[1];
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
import { join as join4 } from "path";
async function importMoragent(sourceRoot, brain) {
  const root = join4(sourceRoot, ".moragent", "memory");
  const files = [...await markdownFiles(join4(root, "canonical")), ...await markdownFiles(join4(root, "episodic")), ...await markdownFiles(join4(root, "transient"))];
  return importFiles(files, brain, "import:moragent", (path) => {
    const relative = path.slice(root.length + 1).split(/[\\/]/);
    if (relative[0] === "canonical") return { tier: "canonical", kind: canonicalKind(relative[1]), status: "proposed" };
    if (relative[0] === "episodic") return { tier: "episodic", kind: "session" };
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
  tokenize,
  rankNotes,
  openBrain,
  importAlbert,
  importMoragent
};
//# sourceMappingURL=chunk-ZKAXB4VP.js.map