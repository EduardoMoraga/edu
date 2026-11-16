import {
  ReflectionSchema,
  reflect
} from "./chunk-VLNNM7MJ.js";
import {
  consolidatePending,
  locked
} from "./chunk-56CLO3IQ.js";
import {
  FileTransaction,
  applyInstall
} from "./chunk-QBTHH6SX.js";
import "./chunk-BIXUCKST.js";
import {
  ProposalBundleSchema,
  validateSkillBundle
} from "./chunk-6VKNJRFI.js";
import "./chunk-AINX4RRX.js";
import "./chunk-5G4RNW33.js";
import "./chunk-6GXTQRCF.js";
import "./chunk-6O2RRLWR.js";
import "./chunk-KLV4TDB7.js";
import "./chunk-SOBMA5SW.js";
import "./chunk-KDSAKUP2.js";
import {
  packageTemplatesDir
} from "./chunk-NMJNTHQG.js";
import "./chunk-ICQNXX6J.js";
import "./chunk-VXIEHENV.js";
import {
  atomicWrite
} from "./chunk-KVVJCXPU.js";
import "./chunk-YPR7PZSQ.js";
import {
  parseFrontmatter
} from "./chunk-X74ZO2KX.js";

// src/reflect/proposals.ts
import { readdir, readFile } from "fs/promises";
import { dirname, join } from "path";
import { stringify } from "yaml";
async function listProposals(brain, brainRoot) {
  const root = await resolveRoot(brain, brainRoot);
  const dir = join(root, "proposals");
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const result = [];
  for (const file of files.filter((name) => name.endsWith(".md"))) {
    const path = join(dir, file);
    try {
      const raw = await readFile(path, "utf8");
      const value = parseFrontmatter(raw)?.meta;
      if (!value) continue;
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
      await applyInstall({ scope: "project", root, home: root, templatesDir: packageTemplatesDir(), notes: [], actions: bundle.files.map((file) => ({
        cli: "codex",
        kind: "file",
        path: join(root, "skills", proposal.name, file.path),
        description: `Accept ${proposal.name} bundle ${file.path}`,
        content: file.content,
        bundle: { name: proposal.name, root: join(root, "skills", proposal.name), anchor: root, scope: "project", relative: file.path }
      })) }, { manifestPath: join(root, "skills", ".edu-bundles.json"), transaction });
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
${stringify(metadata)}---
`;
  if (transaction) await transaction.write(path, content);
  else await atomicWrite(path, content);
}
async function resolveRoot(brain, explicit) {
  if (explicit) return explicit;
  const note = (await brain.list())[0];
  if (!note) throw new Error("A brainRoot is required when the brain has no notes.");
  return dirname(dirname(dirname(note.path)));
}
export {
  ReflectionSchema,
  acceptProposal,
  consolidatePending,
  listProposals,
  reflect,
  rejectProposal
};
//# sourceMappingURL=reflect-6QZ4RNGR.js.map