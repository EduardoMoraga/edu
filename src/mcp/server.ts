import { dirname, join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { NoteConflictError, autoMaintain, contentHash, openBrain } from '../brain/index.js';
import { compileReportLines } from '../brain/compile.js';
import { brief, estimateTokens, truncateToTokens } from '../context/index.js';
import type { BrainLocation, ClaimBand, Note, NoteOrigin, Tier } from '../core/contracts.js';
import { createCrew, type CrewOptions } from '../crew/index.js';
import { packageVersion } from '../cli/package.js';
import { closeWithLessons, lessonsInput } from './session-learning.js';
import { withHostLock } from '../platform/file-lock.js';
import { boundedCapabilities } from './capabilities.js';
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
   * Capability JSON (or legacy text, wrapped as a feature) for edu_capabilities. It takes no caller input,
   * so a model cannot claim another version; without it the tool answers with a minimal built-in description.
   */
  capabilities?: () => string | Promise<string>;
}

/**
 * Published (tools/list) schema of a field when it differs from the validating one. `z.number().int()` publishes
 * `maximum: 9007199254740991` on every integer; the published twin says `integer` with the same bounds the strict
 * schema enforces, without that noise. Arguments are always validated with the strict schema.
 */
const published = new WeakMap<z.ZodType, z.ZodType>();
function optionalInt(min: number, max?: number, description?: string) {
  let strict = z.number().int().min(min);
  if (max !== undefined) strict = strict.max(max);
  const optional = description ? strict.optional().describe(description) : strict.optional();
  const twin = z.number().meta({ type: 'integer', minimum: min, ...(max !== undefined ? { maximum: max } : {}) }).optional();
  published.set(optional, description ? twin.describe(description) : twin);
  return optional;
}
const tokenLimit = optionalInt(1);
/**
 * edu_recall `alt`: up to 3 more phrasings, fused with the query. The tool list is paid on every session, so the
 * published twin states the limit in its description instead of `maxItems` and per-item `minLength`.
 */
const altQueries = z.array(z.string().min(1)).max(3).optional();
published.set(altQueries, z.array(z.string()).optional().describe('Up to 3 rephrasings or translations (e.g. Spanish, English)'));
const bands = z.enum(['verified', 'inferred', 'hypothesis']);
const tiers = z.enum(['canonical', 'episodic', 'transitive']);
const transitiveKinds = z.enum(['decision', 'hypothesis', 'commitment', 'lesson']);
const canonicalKinds = z.enum(['identity', 'standard', 'lexicon', 'domain', 'person', 'preference']);

function line(note: Note): string {
  return `${note.meta.id} · ${note.meta.band ?? 'inferred'} · ${note.meta.status ?? 'unspecified'} · ${note.meta.title}`;
}

/** Provenance `agent` for an MCP client name (from initialize); undefined when the client is not a known host. */
export function agentOfClient(clientName: string | undefined): string | undefined {
  if (!clientName?.trim()) return undefined;
  const cli = detectCallerCli({}, clientName);
  if (cli) return ({ claude: 'claude-code', codex: 'codex', pi: 'pi', opencode: 'opencode', agy: 'antigravity' } as const)[cli];
  // Any other MCP client (Copilot, Cursor, …) is recorded by its own name, normalized.
  const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || undefined;
}

/** Compact text of what compiling a new note found (shared with the CLI). */
export const compileReportText = compileReportLines;

const conflictText = (error: NoteConflictError) => `Note changed since you read it (now ${error.currentHash}). Re-read with edu_read and retry.`;

/**
 * MCP tool annotations. Hosts (Codex, Claude…) use them to decide what can run without asking:
 * reads never prompt, brain writes are local and non-destructive, crew tools start other agents.
 */
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const BRAIN_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const STARTS_AGENTS = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;
export const TOOL_ANNOTATIONS: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean }> = {
  edu_brief: READ, edu_recall: READ, edu_read: READ, edu_capabilities: READ, edu_commitments: READ, edu_crew_status: READ, edu_crew_result: READ, edu_crew_artifact: READ,
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
  const workerProcess = Boolean(env.EDU_CREW_JOB?.trim() || env.ALBERT_CREW_JOB?.trim());
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
  const respond = async (maxTokens: number | undefined, operation: () => Promise<string>, jsonCapabilities = false) => {
    const limit = maxTokens ?? 800;
    try {
      await bind();
      const text = await operation();
      return { content: [{ type: 'text' as const, text: jsonCapabilities ? text : truncateToTokens(text, limit) }] };
    } catch (error) {
      const message = error instanceof NoteConflictError ? conflictText(error) : error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text' as const, text: jsonCapabilities ? boundedCapabilities(JSON.stringify({ limitations: [`Error: ${message}`] }), SERVER_VERSION, profile, limit) : truncateToTokens(`Error: ${message}`, limit) }], isError: true };
    }
  };

  const listed: { name: string; description: string; inputSchema: z.ZodObject; annotations?: Tool['annotations'] }[] = [];
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
      key, (published.get(schema as z.ZodType) ?? schema as z.ZodType<unknown>).catch(null).meta({ default: undefined }),
    ])) as z.ZodRawShape;
    const inputSchema = z.object(sdkShape);
    listed.push({ name, description, inputSchema, annotations: TOOL_ANNOTATIONS[name] });
    server.registerTool(name, { description, inputSchema, annotations: TOOL_ANNOTATIONS[name] }, async (args) => {
      const requested = (args as Record<string, unknown>).maxTokens;
      const maxTokens = typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0 ? requested : undefined;
      return respond(maxTokens, async () => {
        // A delegated worker may inspect its workspace and retrieve evidence,
        // but cannot mutate Edu memory or recursively dispatch more Edu agents.
        if (workerProcess && TOOL_ANNOTATIONS[name]?.readOnlyHint !== true) {
          throw new Error(`Edu worker cannot call ${name}; read and retrieval tools remain available`);
        }
        const parsed = strict.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'} ${issue.message}`).join('; ')}`);
        return operation(parsed.data);
      }, name === 'edu_capabilities');
    });
  };

  /** The session this server opened (edu_session_open) and has not closed: provenance for notes written meanwhile. */
  let currentSession: string | undefined;
  const clientAgent = () => agentOfClient(server.server.getClientVersion()?.name);
  const by = (): NoteOrigin => ({ agent: clientAgent(), session: currentSession });

  register('edu_brief', 'Session-start brief', { maxTokens: tokenLimit },
    async ({ maxTokens }) => brief(brain, maxTokens ?? 800, { eduMdPath, now: opts.now }));

  register('edu_recall', 'Search notes', {
    query: z.string().min(1),
    alt: altQueries,
    limit: optionalInt(1), tiers: z.array(tiers).optional(), maxTokens: tokenLimit,
  }, async ({ query, alt, limit, tiers: selectedTiers }) => {
    const hits = await brain.recall(alt?.length ? [query, ...alt] : query, { limit: limit ?? 10, tiers: selectedTiers as Tier[] | undefined });
    return hits.length ? hits.map(hit => `${line(hit.note)} · ${hit.why}`).join('\n') : 'No matching notes.';
  });

  register('edu_read', 'Read a note by id, alias, id prefix, filename or title (ambiguous: lists candidates); shows its hash. Paged: pass offset from the hint; limit = chars per page', {
    id: z.string().min(1), offset: optionalInt(0), limit: optionalInt(1), maxTokens: tokenLimit,
  }, async ({ id, offset, limit, maxTokens }) => {
      const result = await brain.resolve(id);
      if (!result) throw new Error(`Note not found: ${id}`);
      if ('candidates' in result) return [`Ambiguous reference "${id}" (${result.via}): ${result.candidates.length} notes match. Read one by id:`, ...result.candidates.slice(0, 20).map(note => `- ${line(note)}`)].join('\n');
      const header = `${line(result.note)}\nhash: ${contentHash(result.note)}\n\n`;
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

  register('edu_remember', 'Write an episodic or transitive note; reports new links, possible conflicts, redactions', {
    tier: z.enum(['episodic', 'transitive']), kind: transitiveKinds.optional(), title: z.string().min(1), body: z.string(),
    band: bands.optional(), tags: z.array(z.string()).optional(), owner: z.string().optional(), due: z.string().optional(),
    links: z.array(z.string().min(1)).optional().describe('Related note ids'), supersedes: z.string().min(1).optional().describe('Id of the note this replaces'),
    session: z.string().min(1).optional().describe('Your Edu session id, if one was injected'),
    maxTokens: tokenLimit,
  }, async ({ tier, kind, title, body, band, tags, owner, due, links, supersedes, session }) => {
    if (tier === 'episodic' && kind) throw new Error('Episodic notes cannot use a transitive kind');
    const { note, report } = await brain.remember({
      tier, kind: tier === 'transitive' ? kind ?? 'lesson' : undefined, title, body, band: band as ClaimBand | undefined, tags, owner, due,
      ...(links?.length ? { links: [...new Set(links)] } : {}), ...(supersedes ? { supersedes } : {}), source: 'mcp', by: { ...by(), ...(session ? { session } : {}) },
    });
    return [`Created ${line(note)}`, ...compileReportText(report)].join('\n');
  });

  register('edu_feedback', 'Record whether a note helped (advisory; never marks anything externally verified)', {
    id: z.string().min(1), helpful: z.boolean(), maxTokens: tokenLimit,
  }, async ({ id, helpful }) => {
    const note = await brain.feedback(id, helpful);
    return `Feedback recorded: ${line(note)}`;
  });

  register('edu_propose_canonical', 'Propose a canonical note; a human must accept it', {
    kind: canonicalKinds, title: z.string().min(1), body: z.string(), band: bands.optional(), maxTokens: tokenLimit,
  }, async ({ kind, title, body, band }) => {
    const note = await brain.proposeCanonical({ tier: 'canonical', kind, title, body, band, source: 'mcp', by: by() });
    return `Proposed ${line(note)}`;
  });

  register('edu_commitments', 'List commitments', {
    status: z.enum(['pending', 'delivered', 'overdue']).optional(), maxTokens: tokenLimit,
  }, async ({ status }) => {
    const notes = await brain.list({ kind: 'commitment', ...(status ? { status } : {}) });
    return notes.length ? notes.sort((a, b) => (a.meta.due ?? '9999').localeCompare(b.meta.due ?? '9999')).map(note => `${line(note)} · due ${note.meta.due ?? 'unspecified'}`).join('\n') : 'No commitments.';
  });

  register('edu_session_open', 'Open a work session (reuses the open one with the same source and title)', {
    title: z.string().min(1), source: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ title, source }) => {
    const origin = source ?? 'mcp';
    // Find-or-open is not atomic; serialize it per source+title across processes so concurrent opens share one session.
    return withHostLock(brainRoot, origin, `open:${title}`, async () => {
      const existing = (await brain.list({ kind: 'session', status: 'open-session' })).find(note => note.meta.source === origin && note.meta.title === title);
      if (existing) { currentSession = existing.meta.id; return `Session id: ${existing.meta.id}\nReused ${line(existing)}`; }
      const agent = clientAgent();
      const note = await brain.openSession(title, origin, agent ? { agent } : undefined);
      currentSession = note.meta.id;
      return `Session id: ${note.meta.id}\nOpened ${line(note)}`;
    });
  });

  register('edu_session_close', 'Close a session by its exact id with a summary. Repeating the same close is a no-op; an unknown id fails', {
    id: z.string().min(1), summary: z.string(), source: z.string().optional(),
    lessons: lessonsInput.optional().describe('Up to 3 observations YOU made this session; stored as unverified candidates'),
    expected_hash: z.string().min(1).optional().describe('Hash from edu_read; refuses if the session changed since'),
    maxTokens: tokenLimit,
  }, async ({ id, summary, source, lessons, expected_hash: expectedHash }) => {
    const agent = clientAgent();
    const guard = { ...(expectedHash ? { expectedHash } : {}), ...(agent ? { by: { agent } } : {}) };
    // Read, compare and close under one lock per session id: concurrent identical closes write once.
    const text = await withHostLock(brainRoot, 'mcp-close', id, async () => {
      const current = await brain.read(id);
      if (!current || current.meta.kind !== 'session') {
        const open = await brain.list({ kind: 'session', status: 'open-session' });
        throw new Error(`Session not found: ${id}. Close needs the exact id returned by edu_session_open. Open session ids: ${open.map(note => note.meta.id).join(', ') || 'none'}`);
      }
      if (source && current.meta.source !== source) throw new Error(`Session ${id} belongs to source ${current.meta.source ?? 'unknown'}, not ${source}; not closed`);
      if (lessons?.length) {
        const result = await closeWithLessons(brain, brainRoot, current, summary, lessons, guard);
        if (result.closedNow) await autoMaintain(brain, brainRoot);
        return result.text;
      }
      if (current.meta.status === 'closed') {
        if (current.body.trim() === summary.trim()) return `Already closed ${line(current)}`;
        throw new Error(`Session ${id} is already closed with a different summary; it was not changed`);
      }
      const note = await brain.closeSession(id, summary, guard);
      await autoMaintain(brain, brainRoot);
      return `Closed ${line(note)}`;
    });
    if (currentSession === id) currentSession = undefined;
    return text;
  });

  register('edu_capabilities', 'Running Edu version and features as bounded JSON (takes no caller version)', {
    maxTokens: optionalInt(1, undefined, 'Hard budget (default 800); tiny ones may yield {} or 0 (budget too small, not no capabilities)'),
  }, async ({ maxTokens }) => boundedCapabilities(opts.capabilities ? await opts.capabilities() : [
    `Edu ${SERVER_VERSION} (MCP, ${profile} profile). Persistent notes, recall, sessions and feedback are available${profile === 'full' ? ', plus crew dispatch' : '; crew/orchestration tools are omitted'}.`,
    'Memory is stored notes, not model training; Edu does not guarantee better answers or lower cost.',
    'Feedback from edu_feedback is advisory and is never treated as externally verified.',
  ].join('\n'), SERVER_VERSION, profile, maxTokens ?? 800));

  register('edu_projects', 'List workspaces and agent names; marks the active one', { maxTokens: tokenLimit },
    async () => {
      const workspaces = await listWorkspaces(env);
      const rows = workspaces.map(w => `${w.root === workspace || w.name === workspace ? '* ' : '  '}${w.name} · agent ${w.agent} · ${w.root}${w.present ? '' : ' (missing)'}`);
      return [`Active: ${workspace}`, ...(rows.length ? rows : ['No registered workspaces. Create one with `edu create`.']),
        'Switch with edu_project_use (workspace name, agent name, path, or "global").'].join('\n');
    });

  register('edu_project_use', 'Switch this session\'s workspace: workspace name, agent name, path or "global"', {
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
  register('edu_crew_dispatch', 'Run a crew job on a coding CLI. mode pane: visible herdr pane, headless if herdr is unreachable', {
    cli: cliIds, task: z.string().min(1), mode: z.enum(['headless', 'pane']).optional(), cwd: z.string().optional(), autonomy: autonomy.optional(), maxTokens: tokenLimit,
  }, async ({ cli, task, mode, cwd, autonomy: selectedAutonomy }) => {
    const job = await crew.dispatch({ cli, task, mode, cwd, autonomy: selectedAutonomy });
    return JSON.stringify(job);
  });

  register('edu_crew_status', 'List crew jobs or show one', {
    jobId: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ jobId }) => JSON.stringify(await crew.status(jobId)));

  register('edu_crew_result', 'Wait for and read a crew job result', {
    jobId: z.string().min(1), waitSeconds: z.number().nonnegative().optional(), maxTokens: tokenLimit,
  }, async ({ jobId, waitSeconds }) => JSON.stringify(await crew.result(jobId, waitSeconds ?? 0)));

  register('edu_crew_artifact', 'Page a crew job\'s sanitized output or summary; continue with nextOffset until null', {
    jobId: z.string().min(1), kind: z.enum(['output', 'summary']), offset: optionalInt(0),
    maxBytes: optionalInt(1, 4096), maxTokens: optionalInt(100, 20000),
  }, async ({ jobId, kind, offset, maxBytes, maxTokens }) => {
    const limit = maxTokens ?? 800;
    let pageBytes = Math.min(maxBytes ?? 1000, 4096);
    while (true) {
      const page = JSON.stringify(await crew.store.artifact(jobId, kind, offset, pageBytes));
      if (estimateTokens(page) <= limit) return page;
      if (pageBytes <= 4) throw new Error('Artifact page metadata exceeds maxTokens');
      pageBytes = Math.max(4, Math.floor(pageBytes / 2));
    }
  });

  register('edu_orchestrate', 'Start a detached orchestration (visible spec and crew job)', {
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

  register('edu_crew_review', 'Read-only review by a different available CLI', {
    cli: cliIds.optional(), base: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ cli, base }) => JSON.stringify(await crew.review({ cli, base, callerCli: detectCallerCli(process.env, server.server.getClientVersion()?.name) })));

  // tools/list is what every host pays for in context on every turn. The SDK's own listing adds a `$schema` URL to
  // each input schema and `execution: {taskSupport: 'forbidden'}` (the protocol default); both carry no information
  // for a model, so the listing is published from the same registrations without them. Calls still go through the SDK.
  const tools: Tool[] = listed.map(({ name, description, inputSchema, annotations }) => {
    const { $schema: _schemaUrl, ...schema } = z.toJSONSchema(inputSchema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
    return { name, description, inputSchema: schema as Tool['inputSchema'], ...(annotations ? { annotations } : {}) };
  });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

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
