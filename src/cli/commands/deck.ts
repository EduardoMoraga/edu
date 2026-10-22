import { tokenMeasurement } from '../../core/usage.js';
import type { Usage } from '../../core/contracts.js';
/** Fast, filesystem-only snapshot for host CLI deck renderers. */
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { readMaintainState } from '../../brain/auto-maintain.js';
import { brainPath, stopsAtCeiling, withBrainDir } from '../../brain/location.js';
import { parseMarkdownLenient } from '../../brain/frontmatter.js';
import { TIER_DIRS, type Tier } from '../../core/contracts.js';
import { getGlyphs } from '../../identity/index.js';
import { resolveGlobals, type CliContext } from '../context.js';
import { identityName, lessonCount } from '../workspace.js';

export interface DeckSnapshot {
  version: 1;
  project: { name: string; root: string };
  identity: string;
  /** `toApprove`: canonical notes with status proposed, waiting for a human. */
  brain: { present: boolean; canonical: number; proposed: number; toApprove: number; episodic: number; transitive: number; lessons: number };
  /** Last auto-maintenance stamp (promoted/retired from that run) and commitments currently overdue. */
  maintenance: { lastRun: number | null; promoted: number; retired: number; overdue: number };
  spec: { name: string; requirements: number; checks: number } | null;
  jobs: Array<{ id: string; cli: string; task: string; status: string; mode: string; startedAt: number; endedAt: number | null; tokens: number; tokensKnown?: boolean }>;
  approvals: number;
  recent: Array<{ title: string; tier: Tier; at: number }>;
  updatedAt: number;
}

type DatedFile = { path: string; name: string; at: number };
type NoteFile = DatedFile & { tier: Tier };

async function files(dir: string, recursive = false): Promise<DatedFile[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const groups = await Promise.all(entries.map(async entry => {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && recursive) return files(path, true);
      if (!entry.isFile()) return [];
      try {
        const info = await stat(path);
        return [{ path, name: entry.name, at: info.mtimeMs }];
      } catch { return []; }
    }));
    return groups.flat();
  } catch { return []; }
}

function noteText(source: string): { title: string; status: string; kind: string } {
  try {
    const { meta, body } = parseMarkdownLenient(source);
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    return {
      title: heading || (typeof meta.title === 'string' ? meta.title : ''),
      status: typeof meta.status === 'string' ? meta.status : '',
      kind: typeof meta.kind === 'string' ? meta.kind : '',
    };
  } catch { return { title: /^#\s+(.+)$/m.exec(source)?.[1]?.trim() ?? '', status: '', kind: '' }; }
}

async function latestSpec(root: string): Promise<DeckSnapshot['spec']> {
  const candidates = (await files(join(root, 'specs'))).filter(file => file.name.endsWith('.md'));
  const newest = candidates.sort((a, b) => b.at - a.at)[0];
  if (!newest) return null;
  try {
    const source = await readFile(newest.path, 'utf8');
    return {
      name: newest.name.slice(0, -3),
      requirements: (source.match(/^- \*\*R-/gm) ?? []).length,
      checks: (source.match(/^### C-/gm) ?? []).length,
    };
  } catch { return null; }
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;

async function crewJobs(root: string): Promise<DeckSnapshot['jobs']> {
  const newest = (await files(join(root, 'crew')))
    .filter(file => file.name.endsWith('.json'))
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
  const parsed = await Promise.all(newest.map(async file => {
    try {
      const job: unknown = JSON.parse(await readFile(file.path, 'utf8'));
      if (!object(job)) return null;
      const usage = object(job.usage) ? job.usage : {};
      const started = Date.parse(string(job.createdAt));
      const ended = Date.parse(string(job.endedAt));
      return {
        id: string(job.id, file.name).slice(0, 8),
        cli: string(job.cli, '?'),
        task: string(job.goal, string(job.task)).replace(/\s+/g, ' ').trim(),
        status: string(job.status, 'queued'),
        mode: job.kind === 'orchestration' ? 'run' : string(job.mode, 'headless'),
        startedAt: Number.isFinite(started) ? started : file.at,
        endedAt: Number.isFinite(ended) ? ended : null,
        tokens: tokenMeasurement(usage as unknown as Usage).value,
        tokensKnown: tokenMeasurement(usage as unknown as Usage).known,
      };
    } catch { return null; }
  }));
  return parsed.filter((job): job is NonNullable<typeof job> => job !== null);
}

/** Reads only the project's `.edu` directory; absent or unreadable data degrades to empty fields. */
export async function deckSnapshot(root: string, env: NodeJS.ProcessEnv = process.env): Promise<DeckSnapshot> {
  let projectRoot = resolve(root);
  while (true) {
    try {
      if ((await stat(join(projectRoot, '.edu'))).isDirectory()) break;
    } catch { /* Keep looking for the nearest project brain. */ }
    const parent = dirname(projectRoot);
    if (parent === projectRoot || stopsAtCeiling(parent, env)) { projectRoot = resolve(root); break; }
    projectRoot = parent;
  }
  const eduRoot = join(projectRoot, '.edu');
  const empty: DeckSnapshot = {
    version: 1,
    project: { name: basename(projectRoot), root: projectRoot },
    identity: 'Edu',
    brain: { present: false, canonical: 0, proposed: 0, toApprove: 0, episodic: 0, transitive: 0, lessons: 0 },
    maintenance: { lastRun: null, promoted: 0, retired: 0, overdue: 0 },
    spec: null,
    jobs: [],
    approvals: 0,
    recent: [],
    updatedAt: Date.now(),
  };
  try {
    const brainDir = brainPath(await withBrainDir({ scope: 'project', root: eduRoot }));
    if (!(await stat(brainDir)).isDirectory()) return empty;
    const tiers = Object.entries(TIER_DIRS) as Array<[Tier, string]>;
    const noteFiles: NoteFile[] = (await Promise.all(tiers.map(async ([tier, dir]) =>
      (await files(join(brainDir, dir), true))
        .filter(file => file.name.endsWith('.md') && !file.name.endsWith('.base.md'))
        .map(file => ({ ...file, tier })),
    ))).flat();
    const notes = await Promise.all(noteFiles.map(async file => {
      try { return { ...file, ...noteText(await readFile(file.path, 'utf8')) }; }
      catch { return { ...file, title: '', status: '', kind: '' }; }
    }));
    const byStatus: Record<string, number> = {};
    for (const note of notes) {
      if (note.tier === 'canonical') {
        if (note.status === 'accepted') empty.brain.canonical++;
        if (note.status === 'proposed') empty.brain.proposed++;
      } else if (note.tier === 'episodic') empty.brain.episodic++;
      else {
        empty.brain.transitive++;
        if (note.kind === 'lesson' || note.name.startsWith('L-')) byStatus[note.status] = (byStatus[note.status] ?? 0) + 1;
        if ((note.kind === 'commitment' || note.name.startsWith('C-')) && note.status === 'overdue') empty.maintenance.overdue++;
      }
    }
    empty.brain.toApprove = empty.brain.proposed;
    empty.brain.present = true;
    empty.brain.lessons = lessonCount(byStatus);
    empty.recent = notes
      .filter(note => note.title)
      .sort((a, b) => b.at - a.at)
      .slice(0, 5)
      .map(note => ({ title: note.title, tier: note.tier, at: note.at }));
    const [identity, spec, jobs, stamp] = await Promise.all([identityName(eduRoot), latestSpec(eduRoot), crewJobs(eduRoot), readMaintainState(eduRoot)]);
    if (stamp) Object.assign(empty.maintenance, { lastRun: stamp.lastRun, promoted: stamp.promoted, retired: stamp.retired });
    empty.identity = identity;
    empty.spec = spec;
    empty.jobs = jobs;
    empty.approvals = jobs.filter(job => job.status === 'awaiting-approval').length;
  } catch { /* A missing or unreadable brain is an empty snapshot. */ }
  return empty;
}

export function registerDeck(program: Command, ctx: CliContext): void {
  program.command('deck')
    .description('show the Edu brain, latest spec and crew jobs')
    .option('--json', 'print the versioned snapshot for host renderers')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = resolveGlobals(ctx, cmd.optsWithGlobals());
      const deck = await deckSnapshot(g.cwd, ctx.env);
      if (g.json) { ctx.out(JSON.stringify(deck)); return; }
      const glyphs = getGlyphs(ctx.env);
      ctx.out(`${glyphs.brain} EDU ${glyphs.sep} ${deck.identity} ${glyphs.sep} ${deck.project.name}`);
      const brain = deck.brain;
      const attention = [brain.toApprove ? `${brain.toApprove} to approve` : '', deck.maintenance.overdue ? `${deck.maintenance.overdue} overdue` : ''].filter(Boolean).join(' · ');
      ctx.out(`Brain  ${brain.present ? `${brain.canonical} canonical · ${brain.proposed} proposed · ${brain.episodic} episodic · ${brain.transitive} transitive · ${brain.lessons} lessons${attention ? ` · ${attention}` : ''}` : 'not found'}`);
      ctx.out(`Spec   ${deck.spec ? `${deck.spec.name} · ${deck.spec.requirements} requirements · ${deck.spec.checks} ${deck.spec.checks === 1 ? 'check' : 'checks'}` : 'none'}`);
      ctx.out(`Crew   ${deck.jobs.length} ${deck.jobs.length === 1 ? 'job' : 'jobs'} · ${deck.approvals} ${deck.approvals === 1 ? 'approval' : 'approvals'}`);
      for (const job of deck.jobs) ctx.out(`  ${job.status} ${job.cli} ${job.id} ${glyphs.sep} ${job.task}`);
    });
}
