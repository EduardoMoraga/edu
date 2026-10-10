import {
  learnedWeight,
  rankNotes
} from "./chunk-NPS5KFAC.js";

// src/context/tokens.ts
var cjk = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu;
var punctuation = /[{}()[\];:=+*/<>|&!?#$%^~\\]/gu;
function estimateTokens(text) {
  if (!text) return 0;
  const cjkCount = [...text.matchAll(cjk)].length;
  const punctuationCount = [...text.matchAll(punctuation)].length;
  return Math.ceil((text.length - cjkCount) / 3.7 + cjkCount * 0.9 + punctuationCount * 0.23);
}
function truncateToTokens(text, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return "";
  const budget = Math.floor(limit);
  if (estimateTokens(text) <= budget) return text;
  const marker = "\u2026";
  if (estimateTokens(marker) > budget) return "";
  const candidates = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(/\n\n|\n/g)) candidates.add(match.index);
  for (const cut of [...candidates].sort((a, b) => b - a)) {
    const candidate = `${text.slice(0, cut).trimEnd()}
${marker}`;
    if (estimateTokens(candidate) <= budget) return candidate;
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(`${text.slice(0, mid).trimEnd()}${marker}`) <= budget) low = mid;
    else high = mid - 1;
  }
  return low ? `${text.slice(0, low).trimEnd()}${marker}` : marker;
}

// src/context/pack.ts
import { readFile } from "fs/promises";
import { join } from "path";
function byNewest(a, b) {
  return b.meta.created.localeCompare(a.meta.created) || a.meta.id.localeCompare(b.meta.id);
}
async function identityCore(path) {
  if (!path) return "";
  try {
    const source = await readFile(path, "utf8");
    const beforeMarker = source.split("<!-- edu:extended -->", 1)[0] ?? "";
    return (beforeMarker === source ? source.split("\n").slice(0, 40).join("\n") : beforeMarker).trim();
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
async function assembleContext(brain, req, opts, trackUsage) {
  const budget = Number.isFinite(req.budgetTokens) ? Math.max(0, Math.floor(req.budgetTokens)) : 0;
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const notes = await brain.list();
  const sections = [];
  const deferred = [];
  const included = /* @__PURE__ */ new Set();
  const fullText = () => sections.map((section) => section.text).join("\n\n");
  const add = (title, line, note) => {
    const existing = sections.find((section) => section.title === title);
    const body = existing ? `${existing.text}
${line}` : `## ${title}
${line}`;
    const prospective = sections.map((section) => section === existing ? body : section.text);
    if (!existing) prospective.push(body);
    if (estimateTokens(prospective.join("\n\n")) > budget) {
      if (note && !deferred.includes(note.meta.id)) deferred.push(note.meta.id);
      return false;
    }
    if (existing) {
      existing.text = body;
      existing.tokens = estimateTokens(body);
      if (note) existing.noteIds.push(note.meta.id);
    } else sections.push({ title, text: body, tokens: estimateTokens(body), noteIds: note ? [note.meta.id] : [] });
    if (note) included.add(note.meta.id);
    return true;
  };
  const identity = await identityCore(opts.eduMdPath ?? join(process.cwd(), ".edu", "EDU.md"));
  if (identity) {
    if (!add("Identity core", identity)) {
      const head = "## Identity core\n";
      const clipped = truncateToTokens(identity, budget - estimateTokens(head));
      if (clipped) add("Identity core", clipped);
    }
  }
  const pending = notes.filter((note) => note.meta.kind === "commitment" && (note.meta.status === "pending" || note.meta.status === "overdue")).sort((a, b) => (a.meta.due ?? "9999").localeCompare(b.meta.due ?? "9999") || a.meta.id.localeCompare(b.meta.id));
  const hypotheses = notes.filter((note) => note.meta.kind === "hypothesis" && note.meta.status === "open").sort(byNewest);
  for (const note of [...pending, ...hypotheses]) {
    const detail = note.meta.kind === "commitment" ? `due ${note.meta.due ?? "unspecified"}` : `band ${note.meta.band ?? "hypothesis"}`;
    add("Active commitments & open hypotheses", `- ${note.meta.title} (${detail})`, note);
  }
  const allLessons = notes.filter((note) => note.meta.kind === "lesson" && (note.meta.status === "proven" || note.meta.status === "candidate"));
  const relevant = req.query ? rankNotes(req.query, allLessons, now, allLessons.length) : [];
  const relevance = new Map(relevant.map((hit, index) => [hit.note.meta.id, index]));
  const lessons = allLessons.filter((note) => note.meta.status === "candidate" || !req.query || relevance.has(note.meta.id));
  lessons.sort((a, b) => Number(b.meta.status === "proven") - Number(a.meta.status === "proven") || (relevance.get(a.meta.id) ?? Infinity) - (relevance.get(b.meta.id) ?? Infinity) || learnedWeight(b.meta.usage, now) - learnedWeight(a.meta.usage, now) || a.meta.id.localeCompare(b.meta.id));
  for (const note of lessons) add("Proven lessons", `- ${note.meta.title} (${note.meta.status}; ${note.meta.band ?? "inferred"})`, note);
  if (req.query) {
    const canonical = notes.filter((note) => note.meta.tier === "canonical" && note.meta.status === "accepted");
    for (const hit of rankNotes(req.query, canonical, now, canonical.length)) {
      const snippet = hit.note.body.split(/\n\s*\n/, 1)[0]?.replace(/\s+/g, " ").trim() ?? "";
      add("Canonical hits", `- ${hit.note.meta.title}: ${truncateToTokens(snippet, 80)}`, hit.note);
    }
  }
  for (const note of notes.filter((note2) => note2.meta.tier === "episodic" && note2.meta.status !== "open-session").sort(byNewest).slice(0, 3)) {
    const summary = note.body.split(/\n/, 1)[0]?.trim() ?? "";
    add("Last 3 episodes", `- ${note.meta.title}${summary ? `: ${truncateToTokens(summary, 50)}` : ""}`, note);
  }
  const remaining = notes.filter((note) => !included.has(note.meta.id)).length;
  add("Index pointer", `${remaining} more notes available via edu_recall/edu_read`);
  if (trackUsage) await brain.recordUse([...included], now);
  const text = fullText();
  return { text, tokens: estimateTokens(text), budgetTokens: budget, sections, deferred };
}
async function buildContext(brain, req, opts = {}) {
  return assembleContext(brain, req, opts, opts.trackUsage ?? true);
}
async function buildBriefContext(brain, budgetTokens, opts) {
  return assembleContext(brain, { budgetTokens }, opts, opts.trackUsage ?? false);
}

// src/context/brief.ts
async function brief(brain, budgetTokens = 1500, opts = {}) {
  return (await buildBriefContext(brain, budgetTokens, { ...opts, trackUsage: opts.trackUsage ?? true })).text;
}

export {
  estimateTokens,
  truncateToTokens,
  buildContext,
  brief
};
//# sourceMappingURL=chunk-QJZCSCYS.js.map