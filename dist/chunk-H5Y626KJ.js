import {
  isClosedEpisode
} from "./chunk-XPGTBTXM.js";
import {
  isOperationalNote,
  resolveReference,
  tokenize
} from "./chunk-2TESNY4V.js";
import {
  atomicWrite
} from "./chunk-2P2KBRRT.js";
import {
  brainPath,
  isInside
} from "./chunk-YPR7PZSQ.js";

// src/brain/tidy.ts
import { copyFile, mkdir, readFile } from "fs/promises";
import { basename, dirname, join, relative } from "path";
var TIDY_KINDS = ["sessions", "hypotheses", "aliases"];
var DAY = 864e5;
var SESSION_GRACE_MS = DAY;
var WIKILINK = /\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g;
var stem = (path) => basename(path).replace(/\.md$/i, "");
var key = (text) => text.trim().toLowerCase();
function linkTargets(body) {
  return [...body.matchAll(WIKILINK)].map((match) => stem(match[1].trim().replace(/\\/g, "/")));
}
async function planTidy(brain, primary, opts = {}) {
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const staleDays = opts.staleDays ?? 30;
  const root = brainPath(primary);
  const notes = (await brain.list()).filter((note) => isInside(root, note.path));
  const names = /* @__PURE__ */ new Set();
  for (const note of notes) {
    for (const name of [note.meta.id, stem(note.path), note.meta.title, ...note.meta.aliases ?? []]) if (name) names.add(key(name));
  }
  const referenced = /* @__PURE__ */ new Set();
  for (const note of notes) for (const target of [...linkTargets(note.body), ...note.meta.links]) referenced.add(key(target));
  const age = (iso) => now.getTime() - new Date(iso ?? now).getTime();
  const sessions = notes.filter((note) => note.meta.kind === "session" && note.meta.status === "open-session" && !note.body.trim() && age(note.meta.created) > SESSION_GRACE_MS && !referenced.has(key(note.meta.id)) && !referenced.has(key(stem(note.path)))).map((note) => ({ id: note.meta.id, title: note.meta.title, created: note.meta.created }));
  const hypotheses = notes.filter((note) => note.meta.kind === "hypothesis" && note.meta.status === "open" && age(note.meta.created) > staleDays * DAY).map((note) => ({ id: note.meta.id, title: note.meta.title, created: note.meta.created, to: "no-evidence" }));
  const byOrigin = /* @__PURE__ */ new Map();
  for (const note of notes) {
    if (!note.meta.origin) continue;
    const name = key(stem(note.meta.origin.replace(/^[a-z]+:/i, "")));
    byOrigin.set(name, [...byOrigin.get(name) ?? [], note]);
  }
  const additions = /* @__PURE__ */ new Map();
  const manual = /* @__PURE__ */ new Map();
  let unresolved = 0;
  const broken = /* @__PURE__ */ new Set();
  for (const note of notes) for (const target of linkTargets(note.body)) if (!names.has(key(target))) broken.add(target);
  for (const target of broken) {
    const candidates = byOrigin.get(key(target)) ?? [];
    if (candidates.length !== 1) {
      unresolved++;
      continue;
    }
    const owner = candidates[0];
    const editable = owner.meta.tier !== "canonical" && !isClosedEpisode(owner.meta);
    if (!editable) {
      manual.set(key(target), { link: target, target: owner.meta.id, reason: owner.meta.tier === "canonical" ? "accepted canonical notes are immutable" : "closed episodes are immutable" });
      continue;
    }
    additions.set(owner.meta.id, (additions.get(owner.meta.id) ?? /* @__PURE__ */ new Set()).add(target));
  }
  const aliases = [...additions].map(([id, add]) => ({ id, title: notes.find((note) => note.meta.id === id).meta.title, add: [...add].sort() }));
  return { version: 1, generated: now.toISOString(), brain: root, staleDays, sessions, hypotheses, aliases, manual: [...manual.values()], unresolved };
}
var tidyPlanPath = (primary) => join(primary.root, "state", "tidy-plan.json");
async function saveTidyPlan(primary, plan) {
  const path = tidyPlanPath(primary);
  await atomicWrite(path, `${JSON.stringify(plan, null, 2)}
`);
  return path;
}
async function loadTidyPlan(primary) {
  const raw = await readFile(tidyPlanPath(primary), "utf8").catch(() => void 0);
  if (raw === void 0) return void 0;
  const plan = JSON.parse(raw);
  if (plan?.version !== 1 || !Array.isArray(plan.sessions) || !Array.isArray(plan.hypotheses) || !Array.isArray(plan.aliases)) throw new Error(`Unreadable tidy plan: ${tidyPlanPath(primary)}`);
  return plan;
}
async function applyTidy(brain, primary, plan, opts = {}) {
  const root = brainPath(primary);
  if (plan.brain !== root) throw new Error(`The tidy plan was made for ${plan.brain}, not ${root}. Run edu brain tidy again.`);
  const only = new Set(opts.only?.length ? opts.only : TIDY_KINDS);
  const stamp = (opts.now ?? /* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backup = join(primary.root, "backups", `tidy-${stamp}`);
  const result = { backup, sessions: 0, hypotheses: 0, aliases: 0, skipped: [] };
  const save = async (note) => {
    const target = join(backup, relative(root, note.path));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(note.path, target);
  };
  const current = async (id) => {
    const note = await brain.read(id);
    if (note && isInside(root, note.path)) return note;
    result.skipped.push({ id, reason: "not found in this brain" });
    return void 0;
  };
  if (only.has("sessions")) for (const { id } of plan.sessions) {
    const note = await current(id);
    if (!note) continue;
    if (note.meta.status !== "open-session" || note.body.trim()) {
      result.skipped.push({ id, reason: "session is no longer open and empty" });
      continue;
    }
    await save(note);
    if (await brain.discardEmptySession(id)) result.sessions++;
    else result.skipped.push({ id, reason: "session changed before it could be discarded" });
  }
  if (only.has("hypotheses")) for (const { id } of plan.hypotheses) {
    const note = await current(id);
    if (!note) continue;
    if (note.meta.status !== "open") {
      result.skipped.push({ id, reason: `hypothesis is already ${note.meta.status}` });
      continue;
    }
    await save(note);
    await brain.update(id, { status: "no-evidence" });
    result.hypotheses++;
  }
  if (only.has("aliases")) for (const { id, add } of plan.aliases) {
    const note = await current(id);
    if (!note) continue;
    const merged = [.../* @__PURE__ */ new Set([...note.meta.aliases ?? [], ...add])];
    if (merged.length === (note.meta.aliases ?? []).length) continue;
    await save(note);
    try {
      await brain.update(id, { aliases: merged });
      result.aliases++;
    } catch (error) {
      result.skipped.push({ id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  await brain.rebuildIndex();
  return result;
}

// src/brain/lint.ts
var LINT_KINDS = ["missing-page", "contradiction", "stale-claim", "overdue", "duplicate", "orphan"];
var DAY2 = 864e5;
var fold = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
var STOPWORDS = new Set("a an the and or but if then else of to in on at by for from with without into over under about as is are was were be been being this that these those it its we you they he she i me my our your their them us do does did done have has had will would should can could may might must shall not no never nor so than too very just also only all any each every some more most other such own same both el la los las un una unos unas de del al a en por para con sin sobre entre y o u pero si no ni que como cuando donde cual cuales es son ser fue era estar esta este estos estas ese esa esos esas lo le les se su sus mi mis tu tus nuestro nuestra hay ya muy mas tambien solo todo todos toda todas cada otro otra otros otras nunca jamas use usar uses using used".split(" "));
function topicTokens(text) {
  return tokenize(text).filter((token) => token.length > 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}
var NEGATION = /\b(?:no|not|never|nunca|jamas|don'?t|doesn'?t|stop|instead|dejar de|deja de|en vez de|en lugar de)\b/g;
function negations(text) {
  return [...new Set([...fold(text).matchAll(NEGATION)].map((match) => match[0]))];
}
var TIME_SENSITIVE = [
  /\b(?:today|currently|right now|now|latest|this week|this month|at the moment|actualmente|hoy|ahora|ultimo|ultima|ultimos|ultimas|esta semana|este mes)\b/g,
  /\bv?\d+\.\d+(?:\.\d+)?\b/g,
  /[$€£]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:usd|eur|clp|dolares|euros)\b/g
];
var AS_OF = /\((?:as of|al)\s+\d{4}-\d{2}-\d{2}\)/i;
var hasAsOfMarker = (text) => AS_OF.test(text);
function timeSensitivePhrases(text) {
  const folded = fold(text);
  return [...new Set(TIME_SENSITIVE.flatMap((pattern) => [...folded.matchAll(pattern)].map((match) => match[0].trim())))];
}
function statements(text) {
  const result = /* @__PURE__ */ new Map();
  for (const line of fold(text).split("\n")) {
    const pair = /^\s*(?:[-*]\s+)?([a-z][\w -]{1,40}?)\s*[:=]\s*(\S.{0,80}?)\s*$/.exec(line);
    if (pair && !/^https?$/.test(pair[1]) && pair[2].split(/\s+/).length <= 3) result.set(`key:${pair[1].trim()}`, pair[2].trim());
  }
  for (const match of fold(text).matchAll(/\b(?:use|usar|usa|usamos|prefer|preferir|preferimos|choose|elegir)\s+([a-z0-9][\w.-]*)/g)) {
    if (!STOPWORDS.has(match[1])) result.set("use", match[1]);
  }
  return result;
}
var jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
};
var normalized = (text) => tokenize(text).join(" ");
var SEVERITY = { "missing-page": "warning", contradiction: "warning", "stale-claim": "warning", overdue: "error", duplicate: "warning", orphan: "info" };
function lintNotes(all, opts = {}) {
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const staleDays = opts.staleDays ?? 90;
  const inScope = (note) => !opts.root || isInside(opts.root, note.path);
  const findings = [];
  const add = (finding) => findings.push({ severity: SEVERITY[finding.kind], ...finding });
  const byId = new Map(all.map((note) => [note.meta.id, note]));
  const cache = /* @__PURE__ */ new Map();
  const resolve = (reference) => {
    if (!cache.has(reference)) cache.set(reference, byId.has(reference) ? { via: "id", note: byId.get(reference) } : resolveReference(all, reference));
    return cache.get(reference);
  };
  const resolvedIds = (result) => !result ? [] : "note" in result ? [result.note.meta.id] : result.candidates.map((note) => note.meta.id);
  const inbound = /* @__PURE__ */ new Map();
  const outbound = /* @__PURE__ */ new Map();
  const missing = /* @__PURE__ */ new Map();
  const bump = (map, id) => map.set(id, (map.get(id) ?? 0) + 1);
  for (const note of all) {
    const references = [...linkTargets(note.body), ...note.meta.links, ...[note.meta.supersedes, note.meta.superseded_by].filter((id) => Boolean(id))];
    for (const target of references) {
      const ids = resolvedIds(resolve(target)).filter((id) => id !== note.meta.id);
      if (!resolve(target)) {
        if (inScope(note)) missing.set(target, (missing.get(target) ?? /* @__PURE__ */ new Set()).add(note.meta.id));
        continue;
      }
      if (ids.length) bump(outbound, note.meta.id);
      for (const id of ids) bump(inbound, id);
    }
  }
  for (const [target, from] of [...missing].sort(([a], [b]) => a.localeCompare(b))) {
    add({ kind: "missing-page", ids: [...from].sort(), target, message: `[[${target}]] does not resolve to any note (linked from ${from.size})`, fix: `Write a note for "${target}", or correct the link to an existing note id, alias or title.` });
  }
  const live = all.filter((note) => note.meta.tier !== "episodic" && isOperationalNote(note));
  for (const note of live) {
    if (!inScope(note) || inbound.get(note.meta.id) || outbound.get(note.meta.id)) continue;
    add({ kind: "orphan", ids: [note.meta.id], message: `${note.meta.title} has no links in or out`, fix: "Link it from a related note (or add [[links]] to it), or retire it if it no longer matters." });
  }
  const claims = all.filter((note) => note.meta.kind === "decision" && note.meta.status === "active" || note.meta.tier === "canonical" && note.meta.status === "accepted");
  const groups = /* @__PURE__ */ new Map();
  for (const note of claims) {
    const group = note.meta.tier === "canonical" ? `canonical/${note.meta.kind ?? "domain"}` : "decision";
    groups.set(group, [...groups.get(group) ?? [], note]);
  }
  for (const notes of groups.values()) {
    const shaped = notes.map((note) => ({ note, title: new Set(topicTokens(note.meta.title)), all: new Set(topicTokens(`${note.meta.title}
${note.body}`)), neg: negations(`${note.meta.title}
${note.body}`), said: statements(note.body) }));
    for (let i = 0; i < shaped.length; i++) for (let j = i + 1; j < shaped.length; j++) {
      const [a, b] = [shaped[i], shaped[j]].sort((x, y) => x.note.meta.created.localeCompare(y.note.meta.created) || x.note.meta.id.localeCompare(y.note.meta.id));
      if (!inScope(a.note) && !inScope(b.note)) continue;
      if (a.note.meta.supersedes === b.note.meta.id || b.note.meta.supersedes === a.note.meta.id) continue;
      const overlap = Math.max(jaccard(a.all, b.all), jaccard(a.title, b.title));
      if (overlap < 0.4) continue;
      const signals = [];
      if (Boolean(a.neg.length) !== Boolean(b.neg.length)) signals.push(`negation: ${[...a.neg, ...b.neg].join(", ")}`);
      for (const [key2, value] of a.said) {
        const other = b.said.get(key2);
        if (other !== void 0 && other !== value) signals.push(`${key2 === "use" ? "use" : key2.slice(4)}: "${value}" vs "${other}"`);
      }
      if (!signals.length) continue;
      const older = a.note, newer = b.note;
      add({ kind: "contradiction", ids: [older.meta.id, newer.meta.id], evidence: signals, message: `Possible contradiction (${Math.round(overlap * 100)}% overlap): "${older.meta.title}" vs "${newer.meta.title}"`, fix: older.meta.kind === "decision" ? `If ${newer.meta.id} replaces ${older.meta.id}, record a new decision that supersedes ${older.meta.id}; otherwise reword one of them.` : `If one replaces the other, propose a revision that supersedes the older note (edu brain approve).` });
    }
  }
  for (const note of claims) {
    if (!inScope(note) || now.getTime() - Date.parse(note.meta.created) <= staleDays * DAY2) continue;
    const text = `${note.meta.title}
${note.body}`;
    if (hasAsOfMarker(text)) continue;
    const phrases = timeSensitivePhrases(text);
    if (!phrases.length) continue;
    add({ kind: "stale-claim", ids: [note.meta.id], evidence: phrases, message: `${note.meta.title}: time-sensitive claim (${phrases.join(", ")}) unchanged since ${note.meta.created.slice(0, 10)}`, fix: 'Check it still holds and record it with an "(as of YYYY-MM-DD)" marker, or supersede it.' });
  }
  for (const note of all) {
    if (!inScope(note) || note.meta.kind !== "commitment" || !note.meta.due || !["pending", "overdue"].includes(note.meta.status ?? "")) continue;
    if (Date.parse(`${note.meta.due.slice(0, 10)}T23:59:59.999Z`) >= now.getTime()) continue;
    add({ kind: "overdue", ids: [note.meta.id], message: `${note.meta.title} was due ${note.meta.due.slice(0, 10)}`, fix: "Deliver it (status delivered) or agree a new date with its stakeholder." });
  }
  const candidates = all.filter((note) => note.meta.tier !== "episodic" && isOperationalNote(note));
  const seen = /* @__PURE__ */ new Set();
  const pair = (a, b, reason, exact) => {
    const [first, second] = [a, b].sort((x, y) => x.meta.created.localeCompare(y.meta.created) || x.meta.id.localeCompare(y.meta.id));
    const key2 = `${first.meta.id}
${second.meta.id}`;
    if (seen.has(key2) || !inScope(first) && !inScope(second)) return;
    seen.add(key2);
    add({ kind: "duplicate", severity: exact ? "error" : "warning", ids: [first.meta.id, second.meta.id], evidence: [reason], message: `"${second.meta.title}" duplicates "${first.meta.title}" (${reason})`, fix: `Keep ${first.meta.id} and retire or supersede ${second.meta.id}, merging anything only the second one says.` });
  };
  const byTitle = /* @__PURE__ */ new Map();
  const byBody = /* @__PURE__ */ new Map();
  for (const note of candidates) {
    const title = normalized(note.meta.title), body = normalized(note.body);
    if (title) byTitle.set(title, [...byTitle.get(title) ?? [], note]);
    if (body.length >= 20) byBody.set(body, [...byBody.get(body) ?? [], note]);
  }
  for (const group of byBody.values()) for (let i = 1; i < group.length; i++) pair(group[0], group[i], normalized(group[0].meta.title) === normalized(group[i].meta.title) ? "same title and body" : "same body", true);
  for (const group of byTitle.values()) for (let i = 1; i < group.length; i++) pair(group[0], group[i], "same title", false);
  const bodies = candidates.map((note) => ({ note, tokens: new Set(topicTokens(note.body)) })).filter((entry) => entry.tokens.size >= 8);
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j];
    if (Math.min(a.tokens.size, b.tokens.size) / Math.max(a.tokens.size, b.tokens.size) < 0.85) continue;
    const similarity = jaccard(a.tokens, b.tokens);
    if (similarity >= 0.9) pair(a.note, b.note, `${Math.round(similarity * 100)}% same words`, false);
  }
  const order = new Map(LINT_KINDS.map((kind, index) => [kind, index]));
  findings.sort((a, b) => order.get(a.kind) - order.get(b.kind) || a.ids[0].localeCompare(b.ids[0]));
  const summary = Object.fromEntries(LINT_KINDS.map((kind) => [kind, 0]));
  summary.error = 0;
  summary.warning = 0;
  summary.info = 0;
  summary.total = findings.length;
  for (const finding of findings) {
    summary[finding.kind]++;
    summary[finding.severity]++;
  }
  return { generated: now.toISOString(), staleDays, notes: all.filter(inScope).length, findings, summary };
}
async function lintBrain(brain, opts = {}) {
  return lintNotes(await brain.list(), opts);
}

export {
  TIDY_KINDS,
  linkTargets,
  planTidy,
  saveTidyPlan,
  loadTidyPlan,
  applyTidy,
  LINT_KINDS,
  topicTokens,
  lintNotes,
  lintBrain
};
//# sourceMappingURL=chunk-H5Y626KJ.js.map