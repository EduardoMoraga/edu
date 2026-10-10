// src/reflect/reflect.ts
import { readdir, readFile, mkdir, writeFile, unlink } from "fs/promises";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { stringify } from "yaml";
import { z } from "zod";
var Item = z.object({ title: z.string().min(1), body: z.string().min(1), evidence: z.array(z.string()) }).strict();
var ReflectionSchema = z.object({
  lessons: z.array(Item),
  hypotheses: z.array(Item),
  feedback: z.array(z.object({ id: z.string().min(1), helpful: z.boolean() }).strict()),
  skillProposals: z.array(z.object({ name: z.string().min(1), rationale: z.string().min(1), diff: z.string().optional(), content: z.string().optional() }).strict().refine((value) => Boolean(value.content || value.diff), "Skill proposals require content or a diff")),
  canonicalProposals: z.array(z.object({ title: z.string().min(1), body: z.string().min(1), evidence: z.array(z.string()) }).strict())
}).strict();
async function reflect({ brain, engine, since = "7d", now = /* @__PURE__ */ new Date(), brainRoot }) {
  const episodes = (await brain.list({ tier: "episodic", kind: "session", status: "closed" })).filter((note) => note.meta.created >= cutoff(since, now));
  if (!episodes.length) return { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: 0, message: "Nothing to reflect yet." };
  const root = brainRoot ?? (episodes[0] ? dirname(dirname(dirname(episodes[0].path))) : void 0);
  const sinceAt = cutoff(since, now);
  const runSummaries = root ? (await readRunSummaries(join(root, "runs"))).filter((run) => !run.at || run.at >= sinceAt) : [];
  const evidence = root ? await readEpisodeEvidence(join(root, "runs"), sinceAt) : { episodeCount: 0, interventions: [] };
  const interventionLessonIds = await writeInterventionLessons(brain, evidence.interventions);
  const prompt = [
    'Analyze the supplied completed episodes and run summaries. Return JSON only with this schema: {"lessons":[{"title":"...","body":"...","evidence":["note-id"]}],"hypotheses":[{"title":"...","body":"...","evidence":[]}],"feedback":[{"id":"note-id","helpful":true}],"skillProposals":[{"name":"safe-name","rationale":"...","content":"..."}],"canonicalProposals":[{"title":"...","body":"...","evidence":[]}]}.',
    "Only derive claims supported by the input. Do not claim a proposal was applied.",
    `Episodes: ${JSON.stringify(episodes.map((note) => ({ id: note.meta.id, title: note.meta.title, body: note.body, created: note.meta.created })))}`,
    `Run summaries: ${JSON.stringify(runSummaries)}`,
    `M-HIR by gap (episodes with an avoidable intervention / evidence packages): ${JSON.stringify(mhirByGap(evidence.interventions, evidence.episodeCount))}`
  ].join("\n\n");
  let response = "";
  const request = { cli: engine.cli, prompt, cwd: process.cwd(), autonomy: "readonly" };
  for await (const event of engine.run(request, "reflect")) if (event.type === "agent.text") response += event.text;
  const output = ReflectionSchema.parse(parseJson(response));
  const report = { lessons: interventionLessonIds, hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: episodes.length };
  for (const lesson of output.lessons) {
    const note = await brain.write(noteInput(lesson, "lesson", "transitive"));
    report.lessons.push(note.meta.id);
  }
  for (const hypothesis of output.hypotheses) {
    const note = await brain.write(noteInput(hypothesis, "hypothesis", "transitive"));
    report.hypotheses.push(note.meta.id);
  }
  for (const feedback of output.feedback) {
    await brain.feedback(feedback.id, feedback.helpful);
    report.feedback.push(feedback.id);
  }
  if (output.skillProposals.length && !root) throw new Error("Cannot write skill proposals: provide brainRoot or at least one episodic note.");
  for (const skill of output.skillProposals) {
    const safeName = skill.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!safeName) throw new Error("Skill proposal name must contain an alphanumeric character.");
    const id = `skill-${safeName}-${randomUUID().slice(0, 8)}`;
    const path = join(root, "proposals", `${id}.md`);
    const metadata = { id, kind: "skill", name: safeName, rationale: skill.rationale, content: skill.content ?? "", ...skill.diff ? { diff: skill.diff } : {}, created: now.toISOString(), status: "proposed" };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `---
${stringify(metadata)}---
`, "utf8");
    report.skillProposals.push({ id, path });
  }
  for (const proposal of output.canonicalProposals) {
    const note = await brain.proposeCanonical({ tier: "canonical", kind: "standard", title: proposal.title, body: proposal.body, links: proposal.evidence, source: "edu:reflect", band: "inferred" });
    report.canonicalProposals.push(note.meta.id);
  }
  const provenLessons = await brain.list({ tier: "transitive", kind: "lesson", status: "proven" });
  const existingProposals = await brain.list({ tier: "canonical" });
  for (const lesson of provenLessons) {
    if (existingProposals.some((note2) => note2.meta.source === "edu:reflect" && note2.meta.links.includes(lesson.meta.id))) continue;
    const note = await brain.proposeCanonical({ tier: "canonical", kind: "standard", title: lesson.meta.title, body: lesson.body, links: [lesson.meta.id], source: "edu:reflect", band: lesson.meta.band ?? "inferred" });
    report.canonicalProposals.push(note.meta.id);
  }
  if (root) await consumeReflectionQueue(root);
  return report;
}
async function consumeReflectionQueue(root) {
  const queue = join(root, "reflect-queue");
  let entries;
  try {
    entries = await readdir(queue, { withFileTypes: true });
  } catch {
    return;
  }
  const pending = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  for (const entry of pending) await unlink(join(queue, entry.name));
}
async function writeInterventionLessons(brain, interventions) {
  const existingLessons = await brain.list({ tier: "transitive", kind: "lesson" });
  const existingKeys = new Set(existingLessons.map((note) => `${note.meta.title}
${note.meta.tags.join(",")}`));
  const created = [];
  for (const intervention of interventions.filter((event) => event.avoidable)) {
    const gap = safeGap(intervention.harnessGap);
    const tag = `harness-gap:${gap}`;
    const evidenceTitle = intervention.detail ? `: ${intervention.detail.replace(/\s+/g, " ").slice(0, 48)}` : "";
    const title = `Harness gap: ${gap} \u2014 ${intervention.action || "human intervention"}${evidenceTitle}`;
    const key = `${title}
${tag}`;
    if (existingKeys.has(key)) continue;
    const note = await brain.write({
      title,
      body: `An avoidable user intervention identified a ${gap} harness gap.

Action: ${intervention.action || "Not recorded."}${intervention.detail ? `

Evidence: ${intervention.detail}` : ""}`,
      tier: "transitive",
      kind: "lesson",
      band: "inferred",
      tags: [tag],
      source: "edu:reflect"
    });
    created.push(note.meta.id);
    existingKeys.add(key);
  }
  return created;
}
async function readEpisodeEvidence(runsDir, sinceAt) {
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch {
    return { episodeCount: 0, interventions: [] };
  }
  const directories = entries.filter((entry) => entry.isDirectory());
  let episodeCount = 0;
  const interventions = [];
  for (const entry of directories) {
    const dir = join(runsDir, entry.name);
    try {
      const [taskText, outcomeText, eventText] = await Promise.all([
        readFile(join(dir, "task.json"), "utf8"),
        readFile(join(dir, "outcome.json"), "utf8"),
        readFile(join(dir, "intervention.jsonl"), "utf8")
      ]);
      const task = JSON.parse(taskText);
      const outcome = JSON.parse(outcomeText);
      const created = task.startedAt ?? outcome.at;
      if (created && created < sinceAt) continue;
      episodeCount++;
      for (const line of eventText.split(/\r?\n/).filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          if (event.type === "intervention" || event.avoidable !== void 0) interventions.push({ ...event, runId: entry.name });
        } catch {
        }
      }
    } catch {
    }
  }
  return { episodeCount, interventions };
}
function mhirByGap(interventions, episodeCount) {
  const grouped = /* @__PURE__ */ new Map();
  for (const [index, event] of interventions.entries()) {
    if (!event.avoidable) continue;
    const gap = safeGap(event.harnessGap);
    const ids = grouped.get(gap) ?? /* @__PURE__ */ new Set();
    ids.add(event.runId ?? `${event.action ?? "intervention"}:${index}`);
    grouped.set(gap, ids);
  }
  return Object.fromEntries([...grouped].map(([gap, rows]) => [gap, { episodes: rows.size, rate: episodeCount ? rows.size / episodeCount : 0 }]));
}
function safeGap(value) {
  return value && /^[a-z][a-z0-9_-]*$/.test(value) ? value : "unknown";
}
function noteInput(item, kind, tier) {
  return { title: item.title, body: item.body, tier, kind, links: item.evidence, band: kind === "hypothesis" ? "hypothesis" : "inferred", source: "edu:reflect" };
}
function parseJson(text) {
  const candidate = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? text.trim();
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Reflection response must be strict JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function cutoff(since, now) {
  const match = /^([1-9]\d*)([dhm])$/.exec(since);
  if (!match) throw new Error(`Invalid since duration '${since}'; use a positive duration such as 7d, 12h, or 30m.`);
  const amount = Number(match[1]);
  const factor = match[2] === "d" ? 864e5 : match[2] === "h" ? 36e5 : 6e4;
  return new Date(now.getTime() - amount * factor).toISOString();
}
async function readRunSummaries(dir) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const results = [];
  for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
    const rows = (await readFile(join(dir, file), "utf8")).split("\n").filter(Boolean);
    for (const row of rows) {
      try {
        const event = JSON.parse(row);
        if (event.type === "run.end") results.push({ runId: event.runId, summary: event.summary, at: event.at });
      } catch {
      }
    }
  }
  return results;
}

// src/reflect/proposals.ts
import { readdir as readdir2, readFile as readFile2, mkdir as mkdir2, writeFile as writeFile2 } from "fs/promises";
import { dirname as dirname2, join as join2 } from "path";
import { parse as parse2, stringify as stringify2 } from "yaml";
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
      const value = parse2(frontmatter);
      if (value.kind === "skill" && value.id && value.name && /^[a-z0-9_-]+$/.test(value.name) && value.rationale) result.push({ id: value.id, name: value.name, rationale: value.rationale, content: value.content ?? "", ...value.diff ? { diff: value.diff } : {}, created: value.created ?? "", status: value.status ?? "proposed", path });
    } catch {
    }
  }
  return result.sort((a, b) => a.created.localeCompare(b.created));
}
async function acceptProposal(brain, id, brainRoot) {
  const root = await resolveRoot(brain, brainRoot);
  const proposal = (await listProposals(brain, root)).find((item) => item.id === id);
  if (!proposal || proposal.status !== "proposed") throw new Error(`Proposed skill not found: ${id}`);
  if (!proposal.content.trim()) {
    if (proposal.diff) throw new Error(`Cannot accept diff-only skill proposal '${id}': a reviewed full skill document is required.`);
    throw new Error(`Cannot accept empty skill proposal '${id}'.`);
  }
  const skillPath = join2(root, "skills", proposal.name, "SKILL.md");
  await mkdir2(dirname2(skillPath), { recursive: true });
  await writeFile2(skillPath, proposal.content, "utf8");
  await saveStatus(proposal.path, proposal, "accepted");
  const episode = await brain.openSession(`Accepted skill proposal: ${proposal.name}`, "edu:reflect");
  await brain.closeSession(episode.meta.id, `Accepted skill proposal ${proposal.id}; wrote skills/${proposal.name}/SKILL.md.`);
  return { ...proposal, status: "accepted" };
}
async function rejectProposal(brain, id, brainRoot) {
  const root = await resolveRoot(brain, brainRoot);
  const proposal = (await listProposals(brain, root)).find((item) => item.id === id);
  if (!proposal || proposal.status !== "proposed") throw new Error(`Proposed skill not found: ${id}`);
  await saveStatus(proposal.path, proposal, "rejected");
}
async function saveStatus(path, proposal, status) {
  const metadata = { id: proposal.id, kind: "skill", name: proposal.name, rationale: proposal.rationale, content: proposal.content, ...proposal.diff ? { diff: proposal.diff } : {}, created: proposal.created, status };
  await writeFile2(path, `---
${stringify2(metadata)}---
`, "utf8");
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
  listProposals,
  reflect,
  rejectProposal
};
//# sourceMappingURL=reflect-AIQCSUYV.js.map