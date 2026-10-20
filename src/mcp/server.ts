import { dirname, join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { autoMaintain, openBrain } from '../brain/index.js';
import { brief, estimateTokens, truncateToTokens } from '../context/index.js';
import type { BrainLocation, ClaimBand, Note, Tier } from '../core/contracts.js';
import { createCrew, type CrewOptions } from '../crew/index.js';
import { packageVersion } from '../cli/package.js';
import { closeWithLessons, lessonsInput } from './session-learning.js';
import { withHostLock } from '../platform/file-lock.js';
import { eduHomeOf, listWorkspaces, selectWorkspace } from './projects.js';

export interface EduMcpOptions {
  locations: BrainLocation[];
  now?: Date;
  eduMdPath?: string;
  crewOptions?: CrewOptions;
  /**
   * Called once, before the first tool call. Lets the host rebind to the client's real workspace
   * (MCP roots) when the CLI launched the server from another directory, e.g. a plugin folder.
   */
  resolveLocations?: (server: McpServer) => Promise<BrainLocation[] | undefined>;
  /** Environment for the workspace registry (EDU_HOME, HOME). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Label of the workspace the server starts on (e.g. from `--project`); shown by edu_projects. */
  workspace?: string;
  /** Host-owned workspace: tools cannot select a different brain than the host's injected brief. */
  workspaceLocked?: boolean;
  /** Memory-only omits orchestration/crew schemas; full remains the compatibility default. */
  toolProfile?: 'full' | 'memory';
  /**
   * Text for edu_capabilities (e.g. `() => JSON.stringify(getCapabilities())`, wired in stdio). It takes no caller input,
   * so a model cannot claim another version; without it the tool answers with a minimal built-in description.
   */
  capabilities?: () => string | Promise<string>;
}

const tokenLimit = z.number().int().positive().optional().describe('Maximum response tokens (default 800)');
const bands = z.enum(['verified', 'inferred', 'hypothesis']);
const tiers = z.enum(['canonical', 'episodic', 'transitive']);
const transitiveKinds = z.enum(['decision', 'hypothesis', 'commitment', 'lesson']);
const canonicalKinds = z.enum(['identity', 'standard', 'lexicon', 'domain', 'person', 'preference']);

function line(note: Note): string {
  return `${note.meta.id} · ${note.meta.band ?? 'inferred'} · ${note.meta.status ?? 'unspecified'} · ${note.meta.title}`;
}

/**
 * MCP tool annotations. Hosts (Codex, Claude…) use them to decide what can run without asking:
 * reads never prompt, brain writes are local and non-destructive, crew tools start other agents.
 */
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const BRAIN_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const STARTS_AGENTS = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;
export const TOOL_ANNOTATIONS: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean }> = {
  edu_brief: READ, edu_recall: READ, edu_read: READ, edu_capabilities: READ, edu_commitments: READ, edu_crew_status: READ, edu_crew_result: READ,
  edu_projects: READ,
  // Switching only changes which local brain this server process uses; nothing is written or deleted.
  edu_project_use: BRAIN_WRITE,
  edu_remember: BRAIN_WRITE, edu_feedback: BRAIN_WRITE, edu_propose_canonical: BRAIN_WRITE,
  edu_session_open: BRAIN_WRITE, edu_session_close: BRAIN_WRITE,
  edu_crew_dispatch: STARTS_AGENTS, edu_crew_review: STARTS_AGENTS,
  edu_orchestrate: STARTS_AGENTS, edu_crew_approve: STARTS_AGENTS,
};

export function createEduMcpServer(opts: EduMcpOptions): McpServer {
  const profile = opts.toolProfile ?? 'full';
  if (profile !== 'full' && profile !== 'memory') throw new Error('Unknown MCP tool profile; use full or memory');
  const SERVER_VERSION = packageVersion();
  const server = new McpServer({ name: 'edu', version: SERVER_VERSION });
  let brain = openBrain(opts.locations);
  let crew = createCrew({ ...opts.crewOptions, locations: opts.crewOptions?.locations ?? opts.locations });
  let eduMdPath = opts.eduMdPath ?? join(opts.locations[0]!.root, 'EDU.md');
  let brainRoot = opts.locations[0]!.root;
  const env = opts.env ?? process.env;
  // ~/.edu is the global brain even when found by walking up from a folder under HOME.
  const label = (locations: BrainLocation[]) => locations[0]!.scope === 'global' || resolve(locations[0]!.root) === eduHomeOf(env) ? 'global' : dirname(locations[0]!.root);
  let workspace = opts.workspace ?? label(opts.locations);
  let switched = false;
  const use = (locations: BrainLocation[]) => {
    brain = openBrain(locations);
    crew = createCrew({ ...opts.crewOptions, locations });
    eduMdPath = join(locations[0]!.root, 'EDU.md');
    brainRoot = locations[0]!.root;
  };
  let bound: Promise<void> | undefined;
  const bind = () => (bound ??= (async () => {
    let locations: BrainLocation[] | undefined;
    try {
      locations = await opts.resolveLocations?.(server);
    } catch {
      bound = undefined; // transient failure (e.g. roots/list not ready yet): retry on the next call
      return;
    }
    // An explicit edu_project_use wins over the client's roots.
    if (!locations?.length || switched) return;
    use(locations);
    workspace = label(locations);
  })());
  const respond = async (maxTokens: number | undefined, operation: () => Promise<string>) => {
    const limit = maxTokens ?? 800;
    try {
      await bind();
      return { content: [{ type: 'text' as const, text: truncateToTokens(await operation(), limit) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text' as const, text: truncateToTokens(`Error: ${message}`, limit) }], isError: true };
    }
  };

  const register = <Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: Shape,
    operation: (input: z.output<z.ZodObject<Shape>>) => Promise<string>,
  ) => {
    if (profile === 'memory' && (name.startsWith('edu_crew_') || name === 'edu_orchestrate')) return;
    const strict = z.object(shape);
    // The SDK validates before invoking a tool. Catch invalid field values at its
    // boundary, then validate with the original schema inside our bounded reply.
    const sdkShape = Object.fromEntries(Object.entries(shape).map(([key, schema]) => [
      key, (schema as z.ZodType<unknown>).catch(null).meta({ default: undefined }),
    ])) as z.ZodRawShape;
    server.registerTool(name, { description, inputSchema: z.object(sdkShape), annotations: TOOL_ANNOTATIONS[name] }, async (args) => {
      const requested = (args as Record<string, unknown>).maxTokens;
      const maxTokens = typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0 ? requested : undefined;
      return respond(maxTokens, async () => {
        const parsed = strict.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'} ${issue.message}`).join('; ')}`);
        return operation(parsed.data);
      });
    });
  };

  register('edu_brief', 'Get a compact session-start brief', { maxTokens: tokenLimit },
    async ({ maxTokens }) => brief(brain, maxTokens ?? 800, { eduMdPath, now: opts.now }));

  register('edu_recall', 'Search brain notes', {
    query: z.string().min(1), limit: z.number().int().positive().optional(), tiers: z.array(tiers).optional(), maxTokens: tokenLimit,
  }, async ({ query, limit, tiers: selectedTiers }) => {
    const hits = await brain.recall(query, { limit: limit ?? 10, tiers: selectedTiers as Tier[] | undefined });
    return hits.length ? hits.map(hit => `${line(hit.note)} · ${hit.why}`).join('\n') : 'No matching notes.';
  });

  register('edu_read', 'Read a brain note by id, legacy id or alias (e.g. D-010), unique id prefix, filename or exact title; returns the candidates when ambiguous. Long notes are paged: pass offset (characters) from the continuation hint, and optionally limit (characters per page)', {
    id: z.string().min(1), offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional(), maxTokens: tokenLimit,
  }, async ({ id, offset, limit, maxTokens }) => {
      const result = await brain.resolve(id);
      if (!result) throw new Error(`Note not found: ${id}`);
      if ('candidates' in result) return [`Ambiguous reference "${id}" (${result.via}): ${result.candidates.length} notes match. Read one by id:`, ...result.candidates.slice(0, 20).map(note => `- ${line(note)}`)].join('\n');
      const header = `${line(result.note)}\n\n`;
      const body = result.note.body;
      const start = Math.min(offset ?? 0, body.length);
      const budget = maxTokens ?? 800;
      // Fit the page (header + text + continuation hint) in the token budget so the hint is never cut off.
      const render = (end: number) => `${header}${body.slice(start, end)}${end < body.length ? `\n\n[chars ${start}-${end} of ${body.length}; continue with edu_read id=${result.note.meta.id} offset=${end}]` : start > 0 ? `\n\n[chars ${start}-${end} of ${body.length}; end of note]` : ''}`;
      let end = Math.min(body.length, start + (limit ?? body.length));
      if (end >= body.length && start === 0 && estimateTokens(render(end)) <= budget) return render(end);
      while (end > start && estimateTokens(render(end)) > budget) end = start + Math.floor((end - start) * 0.9) - (end - start < 10 ? 1 : 0);
      return render(Math.max(start, end));
    });

  register('edu_remember', 'Create an episodic or transitive note', {
    tier: z.enum(['episodic', 'transitive']), kind: transitiveKinds.optional(), title: z.string().min(1), body: z.string(),
    band: bands.optional(), tags: z.array(z.string()).optional(), owner: z.string().optional(), due: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ tier, kind, title, body, band, tags, owner, due }) => {
    if (tier === 'episodic' && kind) throw new Error('Episodic notes cannot use a transitive kind');
    const note = await brain.write({ tier, kind: tier === 'transitive' ? kind ?? 'lesson' : undefined, title, body, band: band as ClaimBand | undefined, tags, owner, due, source: 'mcp' });
    return `Created ${line(note)}`;
  });

  register('edu_feedback', 'Record whether a note was useful (advisory; cannot mark a result as externally verified)', {
    id: z.string().min(1), helpful: z.boolean(), maxTokens: tokenLimit,
  }, async ({ id, helpful }) => {
    const note = await brain.feedback(id, helpful);
    return `Feedback recorded: ${line(note)}`;
  });

  register('edu_propose_canonical', 'Propose a canonical note for human acceptance', {
    kind: canonicalKinds, title: z.string().min(1), body: z.string(), band: bands.optional(), maxTokens: tokenLimit,
  }, async ({ kind, title, body, band }) => {
    const note = await brain.proposeCanonical({ tier: 'canonical', kind, title, body, band, source: 'mcp' });
    return `Proposed ${line(note)}`;
  });

  register('edu_commitments', 'List commitments', {
    status: z.enum(['pending', 'delivered', 'overdue']).optional(), maxTokens: tokenLimit,
  }, async ({ status }) => {
    const notes = await brain.list({ kind: 'commitment', ...(status ? { status } : {}) });
    return notes.length ? notes.sort((a, b) => (a.meta.due ?? '9999').localeCompare(b.meta.due ?? '9999')).map(note => `${line(note)} · due ${note.meta.due ?? 'unspecified'}`).join('\n') : 'No commitments.';
  });

  register('edu_session_open', 'Open a work session (reuses the open session with the same source and title)', {
    title: z.string().min(1), source: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ title, source }) => {
    const origin = source ?? 'mcp';
    // Find-or-open is not atomic; serialize it per source+title across processes so concurrent opens share one session.
    return withHostLock(brainRoot, origin, `open:${title}`, async () => {
      const existing = (await brain.list({ kind: 'session', status: 'open-session' })).find(note => note.meta.source === origin && note.meta.title === title);
      if (existing) return `Session id: ${existing.meta.id}\nReused ${line(existing)}`;
      const note = await brain.openSession(title, origin);
      return `Session id: ${note.meta.id}\nOpened ${line(note)}`;
    });
  });

  register('edu_session_close', 'Close a work session by its exact id with a summary. Repeating the same close is a no-op; an unknown id is never replaced by another session', {
    id: z.string().min(1), summary: z.string(), source: z.string().optional(),
    lessons: lessonsInput.optional().describe('Up to 3 observations YOU (the calling model) noted in this session: {title, body, evidence?: existing note ids}. Recorded as unverified candidates; Edu infers nothing from the summary'),
    maxTokens: tokenLimit,
  }, async ({ id, summary, source, lessons }) => {
    // Read, compare and close under one lock per session id: concurrent identical closes write once.
    return withHostLock(brainRoot, 'mcp-close', id, async () => {
      const current = await brain.read(id);
      if (!current || current.meta.kind !== 'session') {
        const open = await brain.list({ kind: 'session', status: 'open-session' });
        throw new Error(`Session not found: ${id}. Close needs the exact id returned by edu_session_open. Open session ids: ${open.map(note => note.meta.id).join(', ') || 'none'}`);
      }
      if (source && current.meta.source !== source) throw new Error(`Session ${id} belongs to source ${current.meta.source ?? 'unknown'}, not ${source}; not closed`);
      if (lessons?.length) {
        const result = await closeWithLessons(brain, brainRoot, current, summary, lessons);
        if (result.closedNow) await autoMaintain(brain, brainRoot);
        return result.text;
      }
      if (current.meta.status === 'closed') {
        if (current.body.trim() === summary.trim()) return `Already closed ${line(current)}`;
        throw new Error(`Session ${id} is already closed with a different summary; it was not changed`);
      }
      const note = await brain.closeSession(id, summary);
      await autoMaintain(brain, brainRoot);
      return `Closed ${line(note)}`;
    });
  });

  register('edu_capabilities', 'Describe what the installed Edu version can and cannot do, without claiming self-improvement or efficiency. Takes no version: it always reports the running binary', {
    maxTokens: tokenLimit,
  }, async () => opts.capabilities ? opts.capabilities() : [
    `Edu ${SERVER_VERSION} (MCP, ${profile} profile). Persistent notes, recall, sessions and feedback are available${profile === 'full' ? ', plus crew dispatch' : '; crew/orchestration tools are omitted'}.`,
    'Memory is stored notes, not model training; Edu does not guarantee better answers or lower cost.',
    'Feedback from edu_feedback is advisory and is never treated as externally verified.',
  ].join('\n'));

  register('edu_projects', 'List the registered Edu workspaces and their agent names, marking the active one', { maxTokens: tokenLimit },
    async () => {
      const workspaces = await listWorkspaces(env);
      const rows = workspaces.map(w => `${w.root === workspace || w.name === workspace ? '* ' : '  '}${w.name} · agent ${w.agent} · ${w.root}${w.present ? '' : ' (missing)'}`);
      return [`Active: ${workspace}`, ...(rows.length ? rows : ['No registered workspaces. Create one with `edu create`.']),
        'Switch with edu_project_use (workspace name, agent name, path, or "global").'].join('\n');
    });

  register('edu_project_use', 'Switch the active Edu workspace for this session by workspace name, agent name (e.g. "albert"), path, or "global"', {
    workspace: z.string().min(1), maxTokens: tokenLimit,
  }, async ({ workspace: selector }) => {
    if (opts.workspaceLocked) throw new Error('The host owns this workspace. Change the host working directory and restart its Edu MCP server before switching brains.');
    const selection = await selectWorkspace(selector, env);
    use(selection.locations);
    switched = true;
    workspace = selection.root ?? 'global';
    const agent = selection.root ? (await listWorkspaces(env)).find(w => w.root === selection.root)?.agent : undefined;
    return `Active workspace: ${selection.label}${agent ? ` (agent ${agent})` : ''} · brain ${selection.locations[0]!.root}`;
  });

  const cliIds = z.enum(['claude', 'codex', 'pi', 'opencode', 'agy']);
  const autonomy = z.enum(['readonly', 'ask', 'auto', 'full']);
  register('edu_crew_dispatch', 'Dispatch a crew job to a coding CLI. mode "pane" opens a visible herdr pane (beside the caller inside herdr, otherwise a tab in the herdr "Edu" workspace) and falls back to headless with a note when herdr is unreachable', {
    cli: cliIds, task: z.string().min(1), mode: z.enum(['headless', 'pane']).optional(), cwd: z.string().optional(), autonomy: autonomy.optional(), maxTokens: tokenLimit,
  }, async ({ cli, task, mode, cwd, autonomy: selectedAutonomy }) => {
    const job = await crew.dispatch({ cli, task, mode, cwd, autonomy: selectedAutonomy });
    return JSON.stringify(job);
  });

  register('edu_crew_status', 'List crew jobs or inspect one job', {
    jobId: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ jobId }) => JSON.stringify(await crew.status(jobId)));

  register('edu_crew_result', 'Wait for and read a crew job result', {
    jobId: z.string().min(1), waitSeconds: z.number().nonnegative().optional(), maxTokens: tokenLimit,
  }, async ({ jobId, waitSeconds }) => JSON.stringify(await crew.result(jobId, waitSeconds ?? 0)));

  register('edu_orchestrate', 'Start a detached orchestration with a visible spec and crew job', {
    goal: z.string().min(1), playbook: z.string().optional(), mode: z.enum(['solo', 'crew']).optional(),
    autoApprove: z.boolean().optional(), maxTokens: tokenLimit,
  }, async ({ goal, playbook, mode, autoApprove }) => {
    const job = await crew.orchestrate({ goal, playbook, mode, autoApprove });
    const deadline = Date.now() + 60_000;
    let current = job;
    while (!current.specPath && !['done', 'failed', 'cancelled'].includes(current.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      current = await crew.status(job.id) as typeof job;
    }
    return JSON.stringify({ jobId: job.id, status: current.status, specPath: current.specPath, outcome: current.outcome, verificationSummary: current.verificationSummary });
  });

  register('edu_crew_approve', 'Approve or reject a pending orchestration spec', {
    jobId: z.string().min(1), approve: z.boolean(), maxTokens: tokenLimit,
  }, async ({ jobId, approve }) => JSON.stringify(await crew.approve(jobId, approve)));

  register('edu_crew_review', 'Dispatch a read-only review using a different available CLI', {
    cli: cliIds.optional(), base: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ cli, base }) => JSON.stringify(await crew.review({ cli, base, callerCli: detectCallerCli(process.env, server.server.getClientVersion()?.name) })));

  return server;
}

export function detectCallerCli(env: NodeJS.ProcessEnv, clientName?: string): import('../core/contracts.js').CliId | undefined {
  // The MCP client names itself during initialize; that is more reliable than environment hints.
  const name = (clientName ?? '').toLowerCase();
  if (name.includes('claude')) return 'claude';
  if (name.includes('codex')) return 'codex';
  if (name.includes('opencode')) return 'opencode';
  if (name.includes('antigravity') || name.includes('gemini') || name.includes('agy')) return 'agy';
  if (/(^|[^a-z])pi([^a-z]|$)/.test(name)) return 'pi';
  if (env.CLAUDECODE) return 'claude';
  if (Object.keys(env).some(key => key.startsWith('CODEX_'))) return 'codex';
  if (Object.keys(env).some(key => key.startsWith('PI_'))) return 'pi';
  if (env.OPENCODE) return 'opencode';
  if (env.ANTIGRAVITY || env.ANTIGRAVITY_AGENT || env.GEMINI_CLI) return 'agy';
  return undefined;
}
