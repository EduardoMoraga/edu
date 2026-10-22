import {
  estimateTokens,
  truncateToTokens
} from "./chunk-D45JK3LN.js";
import {
  FileTransaction,
  applyInstall,
  resolveTemplatesDir
} from "./chunk-QSTE2VXK.js";
import {
  ProposalBundleSchema,
  validateSkillBundle
} from "./chunk-HITNXL4T.js";
import "./chunk-DGIFDAPF.js";
import {
  acknowledge,
  boundedRead,
  consolidatePending,
  cutoff,
  digest,
  locked,
  queueSnapshot,
  readInterventions,
  writeInterventions,
  writeOnce
} from "./chunk-KKW62UIB.js";
import "./chunk-C3GITKS2.js";
import "./chunk-I6JWASFE.js";
import {
  measuredEngine
} from "./chunk-5G4RNW33.js";
import {
  sumUsage
} from "./chunk-6GXTQRCF.js";
import "./chunk-VHSIB24T.js";
import {
  atomicWrite
} from "./chunk-GURUD2GB.js";
import "./chunk-YPR7PZSQ.js";

// src/reflect/reflect.ts
import { appendFile, mkdir, readFile, readdir } from "fs/promises";
import { dirname, join } from "path";
import { stringify } from "yaml";
import { z } from "zod";
var Item = z.object({ title: z.string().min(1), body: z.string().min(1), evidence: z.array(z.string()) }).strict();
var ReflectionSchema = z.object({
  lessons: z.array(Item),
  hypotheses: z.array(Item),
  feedback: z.array(z.object({ id: z.string().min(1), helpful: z.boolean() }).strict()),
  skillProposals: z.array(ProposalBundleSchema.extend({ name: z.string().min(1), rationale: z.string().min(1), diff: z.string().optional(), content: z.string().optional() }).strict().refine((value) => Boolean(value.content || value.diff), "Skill proposals require content or a diff")),
  canonicalProposals: z.array(z.object({ title: z.string().min(1), body: z.string().min(1), evidence: z.array(z.string()) }).strict())
}).strict();
async function reflect({ brain, engine, since = "7d", now = /* @__PURE__ */ new Date(), brainRoot, budgetTokens = 8e3, maxEpisodes = 20 }) {
  if (!Number.isSafeInteger(budgetTokens) || budgetTokens < 1 || !Number.isSafeInteger(maxEpisodes) || maxEpisodes < 1) throw new Error("Reflection budgetTokens and maxEpisodes must be positive safe integers.");
  const sinceAt = cutoff(since, now);
  const episodes = (await brain.list({ tier: "episodic", kind: "session", status: "closed" })).filter((note) => (note.meta.updated ?? note.meta.created) >= sinceAt).sort(recentFirst);
  if (!episodes.length) return { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: 0, message: "Nothing to reflect yet." };
  const root = brainRoot ?? dirname(dirname(dirname(episodes[0].path)));
  const result = await locked(root, async () => {
    const queue = await queueSnapshot(root);
    const targets = (await brain.list()).filter((note) => note.meta.tier !== "episodic" && note.meta.source !== "edu:reflect").sort(recentFirst);
    const suppliedEpisodes = [];
    const suppliedTargets = [];
    const runSummaries = [];
    const interventions = [];
    const analyzed = [];
    const truncated = [];
    const render = () => [
      'Analyze the supplied completed episodes and run summaries. Return JSON only with this schema: {"lessons":[{"title":"...","body":"...","evidence":["note-id"]}],"hypotheses":[{"title":"...","body":"...","evidence":[]}],"feedback":[{"id":"note-id","helpful":true}],"skillProposals":[{"name":"safe-name","rationale":"...","content":"..."}],"canonicalProposals":[{"title":"...","body":"...","evidence":[]}]}',
      "Only derive claims supported by the supplied text; truncated notes are incomplete. Cite supplied note IDs. Feedback is advisory, not verified success. Do not claim a proposal was applied.",
      `Episodes: ${JSON.stringify(suppliedEpisodes)}`,
      `Memory targets: ${JSON.stringify(suppliedTargets)}`,
      `Run summaries: ${JSON.stringify(runSummaries)}`,
      `Structured interventions: ${JSON.stringify(interventions)}`,
      `M-HIR by gap: ${JSON.stringify(mhirByGap(interventions, analyzed.length))}`
    ].join("\n\n");
    const supplyNote = (note, destination, limit) => {
      for (const bodyBudget of [512, 256, 128, 64]) {
        const title = truncateToTokens(note.meta.title, 64);
        const body = truncateToTokens(note.body, bodyBudget);
        const cut = body !== note.body || title !== note.meta.title;
        destination.push({ id: note.meta.id, title, body, updated: note.meta.updated ?? note.meta.created, ...cut ? { truncated: true } : {} });
        if (estimateTokens(render()) <= limit) {
          if (cut) truncated.push(note.meta.id);
          return true;
        }
        destination.pop();
      }
      return false;
    };
    const queueOrder = new Map(queue.map((entry, index) => [entry.sessionId, index]));
    const candidates = [...episodes].sort((a, b) => (queueOrder.get(a.meta.id) ?? Infinity) - (queueOrder.get(b.meta.id) ?? Infinity) || recentFirst(a, b));
    for (const episode of candidates.slice(0, maxEpisodes)) supplyNote(episode, suppliedEpisodes, Math.floor(budgetTokens * 0.75));
    const selected = new Set(suppliedEpisodes.map((note) => note.id));
    let omittedInterventions = 0;
    for (const entry of queue.filter((entry2) => selected.has(entry2.sessionId))) {
      const events = await readInterventions(root, entry);
      if (!events) continue;
      interventions.push(...events);
      analyzed.push(entry);
      if (estimateTokens(render()) > budgetTokens) {
        interventions.splice(interventions.length - events.length, events.length);
        analyzed.pop();
        omittedInterventions += events.length;
      }
    }
    for (const target of targets.slice(0, 20)) supplyNote(target, suppliedTargets, budgetTokens);
    const summaryScan = await readRunSummaries(join(root, "runs"), sinceAt);
    const summaries = summaryScan.summaries;
    for (const summary of summaries) {
      runSummaries.push({ ...summary, summary: truncateToTokens(summary.summary, 256) });
      if (estimateTokens(render()) > budgetTokens) runSummaries.pop();
    }
    const prompt = render();
    const promptTokens = estimateTokens(prompt);
    const deferred = episodes.filter((note) => !selected.has(note.meta.id)).map((note) => note.meta.id);
    const accounting = { promptTokens, deferred, truncated, omitted: { episodes: deferred.length, targets: targets.length - suppliedTargets.length, runSummaries: summaryScan.omittedSummaries + summaries.length - runSummaries.length, runLogFiles: summaryScan.omittedFiles, interventions: omittedInterventions } };
    if (!suppliedEpisodes.length) return { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: 0, ...accounting, message: "No episode fits the reflection prompt budget; nothing was sent or acknowledged." };
    if (promptTokens > budgetTokens) throw new Error("Reflection prompt exceeds budgetTokens.");
    const suppliedIds = /* @__PURE__ */ new Set([...selected, ...suppliedTargets.map((note) => note.id)]);
    const allowed = new Map([...episodes, ...targets].filter((note) => suppliedIds.has(note.meta.id)).map((note) => [note.meta.id, note]));
    const journal = join(root, ".reflection-results", `${digest(prompt)}.json`);
    const measurementPath = `${journal}.usage.jsonl`;
    let output;
    try {
      output = ReflectionSchema.parse(JSON.parse(await readFile(journal, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      let response = "";
      const request = { cli: engine.cli, prompt, cwd: process.cwd(), autonomy: "readonly" };
      if (estimateTokens(request.prompt) > budgetTokens) throw new Error("Reflection request exceeds budgetTokens.");
      request.invocation = { id: crypto.randomUUID(), purpose: "reflection" };
      await mkdir(dirname(measurementPath), { recursive: true });
      await appendFile(measurementPath, JSON.stringify({ invocationId: request.invocation.id }) + "\n");
      for await (const event of measuredEngine(engine).run(request, "reflect")) {
        if (event.type === "usage") await appendFile(measurementPath, JSON.stringify(event.usage) + "\n");
        if (event.type === "agent.text") response += event.text;
        if (event.type === "error" || event.type === "agent.end" && !event.ok) throw new Error("Reflection engine failed.");
      }
      output = ReflectionSchema.parse(parseJson(response));
    }
    const measurementRows = [];
    try {
      const raw = await readFile(measurementPath, "utf8");
      const records = [];
      let damaged = false;
      for (const line of raw.split("\n").filter((line2) => line2.trim())) {
        try {
          const record = JSON.parse(line);
          if (!record || typeof record !== "object" || Array.isArray(record)) {
            damaged = true;
            continue;
          }
          records.push(record);
        } catch {
          damaged = true;
        }
      }
      if (damaged) measurementRows.push({ inputTokens: 0, outputTokens: 0, observationId: `damaged-ledger:${digest(raw)}` });
      const observed = new Set(records.filter((row) => row.observationId).map((row) => row.invocationId));
      for (const row of records) {
        if (row.observationId) measurementRows.push(row);
        else if (row.invocationId && !observed.has(row.invocationId)) measurementRows.push({ inputTokens: 0, outputTokens: 0, observationId: `${row.invocationId}:missing`, invocationId: row.invocationId });
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const usage = sumUsage(measurementRows);
    for (const item of [...output.lessons, ...output.hypotheses, ...output.canonicalProposals]) {
      for (const id of item.evidence) if (!allowed.has(id)) throw new Error(`Invalid reflection evidence ID: ${id}`);
    }
    for (const skill of output.skillProposals) for (const id of [...skill.evidence ?? [], ...(skill.checks ?? []).flatMap((check) => check.evidence)]) if (!allowed.has(id)) throw new Error(`Invalid reflection skill evidence ID: ${id}`);
    for (const feedback of output.feedback) {
      const note = allowed.get(feedback.id);
      if (!note || note.meta.tier === "episodic") throw new Error(`Invalid reflection feedback ID: ${feedback.id}`);
    }
    const skills = output.skillProposals.map((skill) => {
      const name = skill.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
      if (!name || !/[a-z0-9]/.test(name)) throw new Error("Skill proposal name must contain an alphanumeric character.");
      return { ...skill, name };
    });
    for (const skill of skills) if (skill.files || skill.hashes || skill.evidence || skill.checks || /(?:^|\n)bundle\s*:/.test(skill.content ?? "")) {
      if (!skill.content) throw new Error("Bundle proposals require a full skill document.");
      const bundle = await validateSkillBundle({ name: skill.name, content: skill.content, files: skill.files }, { strictDocument: true, checkRequirements: false });
      for (const id of bundle.metadata.evidence) if (!allowed.has(id)) throw new Error(`Invalid reflection skill evidence ID: ${id}`);
      for (const [path, expected] of Object.entries(skill.hashes ?? {})) if (!bundle.files.some((file) => file.path === path && file.sha256 === expected)) throw new Error(`Proposal hash mismatch: ${path}`);
    }
    await atomicWrite(journal, JSON.stringify(output));
    await atomicWrite(`${journal}.provenance.json`, JSON.stringify({ episodes: [...selected], targets: suppliedTargets.map((note) => note.id) }));
    const report = { lessons: await writeInterventions(brain, interventions), hypotheses: [], feedback: [], advisoryFeedback: [...new Set(output.feedback.map((item) => item.id))], skillProposals: [], canonicalProposals: [], episodesRead: suppliedEpisodes.length, usage, measurementPath, ...accounting };
    const links = (evidence) => [...new Set(evidence)].sort();
    for (const lesson of output.lessons) report.lessons.push((await writeOnce(brain, noteInput({ ...lesson, evidence: links(lesson.evidence) }, "lesson"))).id);
    for (const hypothesis of output.hypotheses) report.hypotheses.push((await writeOnce(brain, noteInput({ ...hypothesis, evidence: links(hypothesis.evidence) }, "hypothesis"))).id);
    for (const skill of skills) {
      const id = `skill-${skill.name}-${digest(skill).slice(0, 24)}`;
      const path = join(root, "proposals", `${id}.md`);
      try {
        await readFile(path, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const metadata = { id, kind: "skill", ...skill, content: skill.content ?? "", created: now.toISOString(), status: "proposed" };
        await atomicWrite(path, `---
${stringify(metadata)}---
`);
        report.skillProposals.push({ id, path });
      }
    }
    for (const proposal of output.canonicalProposals) {
      const result2 = await writeOnce(brain, { tier: "canonical", kind: "standard", title: proposal.title, body: proposal.body, links: links(proposal.evidence), tags: proposal.evidence.length ? [] : ["uncited"], source: "edu:reflect", band: "inferred" });
      if (result2.created) report.canonicalProposals.push(result2.id);
    }
    for (const entry of analyzed) await acknowledge(root, entry);
    return report;
  });
  if (!result) throw new Error("Reflection is already running (or its lock requires recovery).");
  return result;
}
function mhirByGap(events, count) {
  const groups = /* @__PURE__ */ new Map();
  for (const event of events) {
    const ids = groups.get(event.harnessGap) ?? /* @__PURE__ */ new Set();
    ids.add(event.runId);
    groups.set(event.harnessGap, ids);
  }
  return Object.fromEntries([...groups].map(([gap, ids]) => [gap, { episodes: ids.size, rate: count ? ids.size / count : 0 }]));
}
function noteInput(item, kind) {
  return { title: item.title, body: item.body, tier: "transitive", kind, links: item.evidence, tags: item.evidence.length ? [] : ["uncited"], band: kind === "hypothesis" ? "hypothesis" : "inferred", source: "edu:reflect" };
}
function parseJson(text) {
  const candidate = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? text.trim();
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Reflection response must be strict JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function recentFirst(a, b) {
  return (b.meta.updated ?? b.meta.created).localeCompare(a.meta.updated ?? a.meta.created) || a.meta.id.localeCompare(b.meta.id);
}
async function readRunSummaries(dir, sinceAt) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return { summaries: [], omittedFiles: 0, omittedSummaries: 0 };
  }
  const results = [];
  const logs = files.filter((name) => name.endsWith(".jsonl")).sort();
  let omittedFiles = Math.max(0, logs.length - 20);
  for (const file of logs.slice(-20)) {
    let raw;
    try {
      raw = await boundedRead(join(dir, file), 262144);
    } catch {
      omittedFiles++;
      continue;
    }
    for (const row of raw.split("\n").filter(Boolean)) {
      try {
        const event = JSON.parse(row);
        if (event.type === "run.end" && typeof event.runId === "string" && typeof event.summary === "string" && typeof event.at === "string" && event.at >= sinceAt) results.push({ runId: event.runId, summary: event.summary, at: event.at });
      } catch {
      }
    }
  }
  return { summaries: results.sort((a, b) => b.at.localeCompare(a.at) || a.runId.localeCompare(b.runId)).slice(0, 20), omittedFiles, omittedSummaries: Math.max(0, results.length - 20) };
}

// src/reflect/proposals.ts
import { readdir as readdir2, readFile as readFile2 } from "fs/promises";
import { dirname as dirname2, join as join2 } from "path";
import { parse, stringify as stringify2 } from "yaml";
async function listProposals(brain, brainRoot) {
  const root = await resolveRoot(brain, brainRoot);
  const dir = join2(root, "proposals");
  let files;
  try {
    files = await readdir2(dir);
  } catch {
    return [];
  }
  const result = [];
  for (const file of files.filter((name) => name.endsWith(".md"))) {
    const path = join2(dir, file);
    try {
      const raw = await readFile2(path, "utf8");
      const frontmatter = /^---\s*\n([\s\S]*?)\n---/.exec(raw)?.[1];
      if (!frontmatter) continue;
      const value = parse(frontmatter);
      if (value.kind === "skill" && value.id && value.name && /^[a-z0-9_-]+$/.test(value.name) && value.rationale) result.push({ id: value.id, name: value.name, rationale: value.rationale, ...ProposalBundleSchema.parse(value), content: value.content ?? "", ...value.diff ? { diff: value.diff } : {}, created: value.created ?? "", status: value.status ?? "proposed", path });
    } catch {
    }
  }
  return result.sort((a, b) => a.created.localeCompare(b.created));
}
async function acceptProposal(brain, id, brainRoot) {
  const root = await resolveRoot(brain, brainRoot);
  const result = await locked(root, async () => {
    const proposal = (await listProposals(brain, root)).find((item) => item.id === id);
    if (proposal?.status === "accepted") return proposal;
    if (!proposal || proposal.status !== "proposed") throw new Error(`Proposed skill not found: ${id}`);
    if (!proposal.content.trim()) {
      if (proposal.diff) throw new Error(`Cannot accept diff-only skill proposal '${id}': a reviewed full skill document is required.`);
      throw new Error(`Cannot accept empty skill proposal '${id}'.`);
    }
    const bundle = await validateSkillBundle(proposal, { strictDocument: true });
    for (const [path, expected] of Object.entries(proposal.hashes ?? {})) if (!bundle.files.some((file) => file.path === path && file.sha256 === expected)) throw new Error(`Proposal hash mismatch: ${path}`);
    const evidence = [.../* @__PURE__ */ new Set([...proposal.evidence ?? [], ...bundle.metadata.evidence, ...(proposal.checks ?? []).flatMap((check) => check.evidence)])];
    for (const id2 of evidence) if (!await brain.read(id2)) throw new Error(`Invalid skill evidence ID: ${id2}`);
    const accepted = { ...proposal, evidence, hashes: Object.fromEntries(bundle.files.map((file) => [file.path, file.sha256])) };
    const transaction = new FileTransaction();
    try {
      await applyInstall({ scope: "project", root, home: root, templatesDir: resolveTemplatesDir(), notes: [], actions: bundle.files.map((file) => ({
        cli: "codex",
        kind: "file",
        path: join2(root, "skills", proposal.name, file.path),
        description: `Accept ${proposal.name} bundle ${file.path}`,
        content: file.content,
        bundle: { name: proposal.name, root: join2(root, "skills", proposal.name), anchor: root, scope: "project", relative: file.path }
      })) }, { manifestPath: join2(root, "skills", ".edu-bundles.json"), transaction });
      await saveStatus(proposal.path, accepted, "accepted", transaction);
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollback) {
        throw new AggregateError([error, rollback], "Skill acceptance rollback incomplete");
      }
      throw error;
    }
    const episode = await brain.openSession(`Accepted skill proposal: ${proposal.name}`, "edu:reflect");
    await brain.closeSession(episode.meta.id, `Accepted skill proposal ${proposal.id}; wrote skills/${proposal.name}/SKILL.md.`);
    return { ...accepted, status: "accepted" };
  });
  if (!result) throw new Error("Reflection is already running.");
  return result;
}
async function rejectProposal(brain, id, brainRoot) {
  const root = await resolveRoot(brain, brainRoot);
  const result = await locked(root, async () => {
    const proposal = (await listProposals(brain, root)).find((item) => item.id === id);
    if (!proposal || proposal.status !== "proposed") throw new Error(`Proposed skill not found: ${id}`);
    await saveStatus(proposal.path, proposal, "rejected");
    return true;
  });
  if (!result) throw new Error("Reflection is already running.");
}
async function saveStatus(path, proposal, status, transaction) {
  const metadata = { ...ProposalBundleSchema.parse(proposal), id: proposal.id, kind: "skill", name: proposal.name, rationale: proposal.rationale, content: proposal.content, ...proposal.diff ? { diff: proposal.diff } : {}, created: proposal.created, status };
  const content = `---
${stringify2(metadata)}---
`;
  if (transaction) await transaction.write(path, content);
  else await atomicWrite(path, content);
}
async function resolveRoot(brain, explicit) {
  if (explicit) return explicit;
  const note = (await brain.list())[0];
  if (!note) throw new Error("A brainRoot is required when the brain has no notes.");
  return dirname2(dirname2(dirname2(note.path)));
}
export {
  ReflectionSchema,
  acceptProposal,
  consolidatePending,
  listProposals,
  reflect,
  rejectProposal
};
//# sourceMappingURL=reflect-T44TQIQ3.js.map