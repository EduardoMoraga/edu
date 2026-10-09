import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { Brain } from '../brain/index.js';

export interface SkillProposal { id: string; name: string; rationale: string; content: string; diff?: string; created: string; status: 'proposed' | 'accepted' | 'rejected'; path: string }

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
      if (value.kind === 'skill' && value.id && value.name && /^[a-z0-9_-]+$/.test(value.name) && value.rationale) result.push({ id: value.id, name: value.name, rationale: value.rationale, content: value.content ?? '', ...(value.diff ? { diff: value.diff } : {}), created: value.created ?? '', status: value.status ?? 'proposed', path });
    } catch { /* Ignore unrelated or malformed proposal files. */ }
  }
  return result.sort((a, b) => a.created.localeCompare(b.created));
}

export async function acceptProposal(brain: Brain, id: string, brainRoot?: string): Promise<SkillProposal> {
  const root = await resolveRoot(brain, brainRoot);
  const proposal = (await listProposals(brain, root)).find(item => item.id === id);
  if (!proposal || proposal.status !== 'proposed') throw new Error(`Proposed skill not found: ${id}`);
  if (!proposal.content.trim()) {
    if (proposal.diff) throw new Error(`Cannot accept diff-only skill proposal '${id}': a reviewed full skill document is required.`);
    throw new Error(`Cannot accept empty skill proposal '${id}'.`);
  }
  const skillPath = join(root, 'skills', proposal.name, 'SKILL.md');
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(skillPath, proposal.content, 'utf8');
  await saveStatus(proposal.path, proposal, 'accepted');
  const episode = await brain.openSession(`Accepted skill proposal: ${proposal.name}`, 'edu:reflect');
  await brain.closeSession(episode.meta.id, `Accepted skill proposal ${proposal.id}; wrote skills/${proposal.name}/SKILL.md.`);
  return { ...proposal, status: 'accepted' };
}

export async function rejectProposal(brain: Brain, id: string, brainRoot?: string): Promise<void> {
  const root = await resolveRoot(brain, brainRoot);
  const proposal = (await listProposals(brain, root)).find(item => item.id === id);
  if (!proposal || proposal.status !== 'proposed') throw new Error(`Proposed skill not found: ${id}`);
  await saveStatus(proposal.path, proposal, 'rejected');
}

async function saveStatus(path: string, proposal: SkillProposal, status: SkillProposal['status']) {
  const metadata = { id: proposal.id, kind: 'skill', name: proposal.name, rationale: proposal.rationale, content: proposal.content, ...(proposal.diff ? { diff: proposal.diff } : {}), created: proposal.created, status };
  await writeFile(path, `---\n${stringify(metadata)}---\n`, 'utf8');
}
async function resolveRoot(brain: Brain, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const note = (await brain.list())[0];
  if (!note) throw new Error('A brainRoot is required when the brain has no notes.');
  return dirname(dirname(dirname(note.path)));
}
