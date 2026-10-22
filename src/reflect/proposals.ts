import { ProposalBundleSchema, validateSkillBundle, type ProposalBundle } from '../skills/bundle.js';
import { FileTransaction } from '../adapters/operations.js';
import { applyInstall, resolveTemplatesDir } from '../adapters/installer.js';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { atomicWrite, type Brain } from '../brain/index.js';
import { locked } from './persistence.js';

export interface SkillProposal extends ProposalBundle { id: string; name: string; rationale: string; content: string; diff?: string; created: string; status: 'proposed' | 'accepted' | 'rejected'; path: string }

export async function listProposals(brain: Brain, brainRoot?: string): Promise<SkillProposal[]> {
  const root = await resolveRoot(brain, brainRoot);
  const dir = join(root, 'proposals');
  let files: string[];
  try { files = await readdir(dir); } catch { return []; }
  const result: SkillProposal[] = [];
  for (const file of files.filter(name => name.endsWith('.md'))) {
    const path = join(dir, file);
    try {
      const raw = await readFile(path, 'utf8');
      const frontmatter = /^---\s*\n([\s\S]*?)\n---/.exec(raw)?.[1];
      if (!frontmatter) continue;
      const value = parse(frontmatter) as Partial<SkillProposal> & { kind?: string };
      if (value.kind === 'skill' && value.id && value.name && /^[a-z0-9_-]+$/.test(value.name) && value.rationale) result.push({ id: value.id, name: value.name, rationale: value.rationale, ...ProposalBundleSchema.parse(value), content: value.content ?? '', ...(value.diff ? { diff: value.diff } : {}), created: value.created ?? '', status: value.status ?? 'proposed', path });
    } catch { /* Ignore unrelated or malformed proposal files. */ }
  }
  return result.sort((a, b) => a.created.localeCompare(b.created));
}

export async function acceptProposal(brain: Brain, id: string, brainRoot?: string): Promise<SkillProposal> {
  const root = await resolveRoot(brain, brainRoot);
  const result = await locked(root, async () => {
    const proposal = (await listProposals(brain, root)).find(item => item.id === id);
    if (proposal?.status === 'accepted') return proposal;
    if (!proposal || proposal.status !== 'proposed') throw new Error(`Proposed skill not found: ${id}`);
    if (!proposal.content.trim()) {
      if (proposal.diff) throw new Error(`Cannot accept diff-only skill proposal '${id}': a reviewed full skill document is required.`);
      throw new Error(`Cannot accept empty skill proposal '${id}'.`);
    }
    const bundle = await validateSkillBundle(proposal, { strictDocument: true });
    for (const [path, expected] of Object.entries(proposal.hashes ?? {})) if (!bundle.files.some(file => file.path === path && file.sha256 === expected)) throw new Error(`Proposal hash mismatch: ${path}`);
    const evidence = [...new Set([...(proposal.evidence ?? []), ...bundle.metadata.evidence, ...(proposal.checks ?? []).flatMap(check => check.evidence)])];
    for (const id of evidence) if (!await brain.read(id)) throw new Error(`Invalid skill evidence ID: ${id}`);
    const accepted = { ...proposal, evidence, hashes: Object.fromEntries(bundle.files.map(file => [file.path, file.sha256])) };
    const transaction = new FileTransaction();
    try {
      await applyInstall({ scope: 'project', root, home: root, templatesDir: resolveTemplatesDir(), notes: [], actions: bundle.files.map(file => ({
        cli: 'codex', kind: 'file', path: join(root, 'skills', proposal.name, file.path), description: `Accept ${proposal.name} bundle ${file.path}`, content: file.content,
        bundle: { name: proposal.name, root: join(root, 'skills', proposal.name), anchor: root, scope: 'project', relative: file.path },
      })) }, { manifestPath: join(root, 'skills', '.edu-bundles.json'), transaction });
      await saveStatus(proposal.path, accepted, 'accepted', transaction);
    } catch (error) {
      try { await transaction.rollback(); } catch (rollback) { throw new AggregateError([error, rollback], 'Skill acceptance rollback incomplete'); }
      throw error;
    }
    const episode = await brain.openSession(`Accepted skill proposal: ${proposal.name}`, 'edu:reflect');
    await brain.closeSession(episode.meta.id, `Accepted skill proposal ${proposal.id}; wrote skills/${proposal.name}/SKILL.md.`);
    return { ...accepted, status: 'accepted' as const };
  });
  if (!result) throw new Error('Reflection is already running.');
  return result;
}

export async function rejectProposal(brain: Brain, id: string, brainRoot?: string): Promise<void> {
  const root = await resolveRoot(brain, brainRoot);
  const result = await locked(root, async () => {
    const proposal = (await listProposals(brain, root)).find(item => item.id === id);
    if (!proposal || proposal.status !== 'proposed') throw new Error(`Proposed skill not found: ${id}`);
    await saveStatus(proposal.path, proposal, 'rejected');
    return true;
  });
  if (!result) throw new Error('Reflection is already running.');
}

async function saveStatus(path: string, proposal: SkillProposal, status: SkillProposal['status'], transaction?: FileTransaction) {
  const metadata = { ...ProposalBundleSchema.parse(proposal), id: proposal.id, kind: 'skill', name: proposal.name, rationale: proposal.rationale, content: proposal.content, ...(proposal.diff ? { diff: proposal.diff } : {}), created: proposal.created, status };
  const content = `---\n${stringify(metadata)}---\n`;
  if (transaction) await transaction.write(path, content);
  else await atomicWrite(path, content);
}
async function resolveRoot(brain: Brain, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const note = (await brain.list())[0];
  if (!note) throw new Error('A brainRoot is required when the brain has no notes.');
  return dirname(dirname(dirname(note.path)));
}
