import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { openBrain } from '../brain/index.js';
import { brief, truncateToTokens } from '../context/index.js';
import type { BrainLocation, ClaimBand, Note, Tier } from '../core/contracts.js';
import { createCrew, type CrewOptions } from '../crew/index.js';

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
  edu_brief: READ, edu_recall: READ, edu_read: READ, edu_commitments: READ, edu_crew_status: READ, edu_crew_result: READ,
  edu_remember: BRAIN_WRITE, edu_feedback: BRAIN_WRITE, edu_propose_canonical: BRAIN_WRITE,
  edu_session_open: BRAIN_WRITE, edu_session_close: BRAIN_WRITE,
  edu_crew_dispatch: STARTS_AGENTS, edu_crew_review: STARTS_AGENTS,
};

export function createEduMcpServer(opts: EduMcpOptions): McpServer {
  const server = new McpServer({ name: 'edu', version: '0.2.0' });
  let brain = openBrain(opts.locations);
  let crew = createCrew({ ...opts.crewOptions, locations: opts.crewOptions?.locations ?? opts.locations });
  let eduMdPath = opts.eduMdPath ?? join(opts.locations[0]!.root, 'EDU.md');
  let bound: Promise<void> | undefined;
  const bind = () => (bound ??= (async () => {
    const locations = await opts.resolveLocations?.(server).catch(() => undefined);
    if (!locations?.length) return;
    brain = openBrain(locations);
    crew = createCrew({ ...opts.crewOptions, locations });
    eduMdPath = join(locations[0]!.root, 'EDU.md');
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
    const strict = z.object(shape);
    // The SDK validates before invoking a tool. Catch invalid field values at its
    // boundary, then validate with the original schema inside our bounded reply.
    const sdkShape = Object.fromEntries(Object.entries(shape).map(([key, schema]) => [
      key, (schema as z.ZodType<unknown>).catch(null),
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

  register('edu_read', 'Read a brain note by id', { id: z.string().min(1), maxTokens: tokenLimit },
    async ({ id }) => {
      const note = await brain.read(id);
      if (!note) throw new Error(`Note not found: ${id}`);
      return `${line(note)}\n\n${note.body}`;
    });

  register('edu_remember', 'Create an episodic or transitive note', {
    tier: z.enum(['episodic', 'transitive']), kind: transitiveKinds.optional(), title: z.string().min(1), body: z.string(),
    band: bands.optional(), tags: z.array(z.string()).optional(), owner: z.string().optional(), due: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ tier, kind, title, body, band, tags, owner, due }) => {
    if (tier === 'episodic' && kind) throw new Error('Episodic notes cannot use a transitive kind');
    const note = await brain.write({ tier, kind: tier === 'transitive' ? kind ?? 'lesson' : undefined, title, body, band: band as ClaimBand | undefined, tags, owner, due, source: 'mcp' });
    return `Created ${line(note)}`;
  });

  register('edu_feedback', 'Record whether a note was useful', {
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

  register('edu_session_open', 'Open a work session', {
    title: z.string().min(1), source: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ title, source }) => {
    const note = await brain.openSession(title, source ?? 'mcp');
    return `Opened ${line(note)}`;
  });

  register('edu_session_close', 'Close a work session with a summary', {
    id: z.string().min(1), summary: z.string(), maxTokens: tokenLimit,
  }, async ({ id, summary }) => {
    const current = await brain.read(id);
    if (!current || current.meta.kind !== 'session') throw new Error(`Session not found: ${id}`);
    const note = await brain.closeSession(id, summary);
    return `Closed ${line(note)}`;
  });

  const cliIds = z.enum(['claude', 'codex', 'pi', 'opencode', 'agy']);
  const autonomy = z.enum(['readonly', 'ask', 'auto', 'full']);
  register('edu_crew_dispatch', 'Dispatch a crew job to a coding CLI', {
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

  register('edu_crew_review', 'Dispatch a read-only review using a different available CLI', {
    cli: cliIds.optional(), base: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ cli, base }) => JSON.stringify(await crew.review({ cli, base, callerCli: detectCallerCli(process.env) })));

  return server;
}

export function detectCallerCli(env: NodeJS.ProcessEnv): import('../core/contracts.js').CliId | undefined {
  if (env.CLAUDECODE) return 'claude';
  if (Object.keys(env).some(key => key.startsWith('CODEX_'))) return 'codex';
  if (Object.keys(env).some(key => key.startsWith('PI_'))) return 'pi';
  if (env.OPENCODE) return 'opencode';
  return undefined;
}
