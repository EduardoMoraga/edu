/**
 * What every MCP tool family shares: the active workspace (brain, crew, folders), the session this server has open,
 * the worker policy and the `register` helper that validates arguments and bounds every reply.
 */
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RootsListChangedNotificationSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { NoteConflictError, openBrain, type Brain } from '../../brain/index.js';
import { cleanTitle } from '../../brain/clean-text.js';
import { brainPath, isInside } from '../../brain/location.js';
import { truncateToTokens } from '../../context/index.js';
import type { BrainLocation, Note, NoteOrigin } from '../../core/contracts.js';
import { createCrew, type CrewOptions } from '../../crew/index.js';
import { boundedCapabilities } from '../capabilities.js';
import { agentOfClient } from '../caller.js';
import { eduHomeOf } from '../projects.js';
import { TOOL_ANNOTATIONS } from './annotations.js';
import { publishedSchema } from './schema.js';

export type ToolProfile = 'full' | 'memory';
export type Crew = ReturnType<typeof createCrew>;

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
  toolProfile?: ToolProfile;
  /**
   * Capability JSON (or legacy text, wrapped as a feature) for edu_capabilities. It takes no caller input,
   * so a model cannot claim another version; without it the tool answers with a minimal built-in description.
   */
  capabilities?: () => string | Promise<string>;
}

/** The session this server tracks: provenance for writes and the only sessions it may close. */
export interface SessionState {
  /** The session this server opened (edu_session_open) and has not closed: provenance for notes written meanwhile. */
  current: string | undefined;
  /** Stands in for a session in feedback dedupe while none is open: one per server process. */
  readonly serverSession: string;
  /** Every session id this server opened or reused; with the primary brain's own, the only ones it may close. */
  readonly openedHere: Set<string>;
  /**
   * A caller-supplied session is provenance only when it is real: this server's current session, or a session that
   * is open in this brain (a host hook opens one and injects its id). Anything else (made up, closed, another
   * brain's) is ignored, so a note cannot claim a session it was not written in.
   */
  proven(claimed: string | undefined): Promise<string | undefined>;
  /** Whether a note lives in the primary brain of the active workspace. */
  inPrimaryBrain(note: Note): boolean;
}

export type Register = <Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: Shape,
  operation: (input: z.output<z.ZodObject<Shape>>) => Promise<string>,
) => void;

export interface ToolContext {
  readonly server: McpServer;
  readonly opts: EduMcpOptions;
  readonly env: NodeJS.ProcessEnv;
  readonly version: string;
  readonly profile: ToolProfile;
  /** The active workspace's brain, crew and folders. Read them at call time: they change with the workspace. */
  readonly brain: Brain;
  readonly crew: Crew;
  readonly brainRoot: string;
  readonly eduMdPath: string;
  /** Label of the active workspace: 'global' or the folder holding its `.edu`; shown by edu_projects. */
  readonly workspace: string;
  /** Switches workspace on an explicit request (edu_project_use); the client's roots no longer rebind it. */
  switchTo(locations: BrainLocation[], workspace: string): void;
  readonly session: SessionState;
  /** The calling host as a provenance `agent`, from the MCP client name. */
  clientAgent(): string | undefined;
  /** Provenance of a write: the calling host and the session this server has open. */
  by(): NoteOrigin;
  readonly register: Register;
}

export interface ListedTool { name: string; description: string; inputSchema: z.ZodObject; annotations?: Tool['annotations'] }

/** One note as one line: id · claim band (`unbanded` for legacy notes without one) · status · title. */
export function noteLine(note: Note): string {
  return `${note.meta.id} · ${note.meta.band ?? 'unbanded'} · ${note.meta.status ?? 'unspecified'} · ${cleanTitle(note.meta.title)}`;
}

const conflictText = (error: NoteConflictError) => `Note changed since you read it (now ${error.currentHash}). Re-read with edu_read and retry.`;

/** The tool context of one server, and the registrations tools/list publishes. */
export function createToolContext(server: McpServer, opts: EduMcpOptions, profile: ToolProfile, version: string): { context: ToolContext; listed: ListedTool[] } {
  let brain = openBrain(opts.locations);
  let crew = createCrew({ ...opts.crewOptions, locations: opts.crewOptions?.locations ?? opts.locations });
  let eduMdPath = opts.eduMdPath ?? join(opts.locations[0]!.root, 'EDU.md');
  let brainRoot = opts.locations[0]!.root;
  let activeLocations = opts.locations;
  const env = opts.env ?? process.env;
  const workerProcess = Boolean(env.EDU_CREW_JOB?.trim() || env.ALBERT_CREW_JOB?.trim());
  // ~/.edu is the global brain even when found by walking up from a folder under HOME.
  const label = (locations: BrainLocation[]) => locations[0]!.scope === 'global' || resolve(locations[0]!.root) === eduHomeOf(env) ? 'global' : dirname(locations[0]!.root);
  let workspace = opts.workspace ?? label(opts.locations);
  let switched = false;
  const use = (next: BrainLocation[]) => {
    brain = openBrain(next);
    crew = createCrew({ ...opts.crewOptions, locations: next });
    eduMdPath = join(next[0]!.root, 'EDU.md');
    brainRoot = next[0]!.root;
    activeLocations = next;
  };
  let bound: Promise<void> | undefined;
  const bind = () => (bound ??= (async () => {
    let rebound: BrainLocation[] | undefined;
    try {
      rebound = await opts.resolveLocations?.(server);
    } catch {
      bound = undefined; // roots/list failed or reported no folder yet: ask again on the next call
      return;
    }
    // An explicit edu_project_use wins over the client's roots.
    if (!rebound?.length || switched) return;
    use(rebound);
    workspace = label(rebound);
  })());
  // A client that changes its roots later (or reports them late) is read again on the next call.
  server.server.setNotificationHandler(RootsListChangedNotificationSchema, () => { if (!switched) bound = undefined; });
  /**
   * Error text with paths under a brain shown relative to it (`.edu/…` for the project brain, `EDU_HOME/…`
   * for the global one) and paths in the workspace relative to the workspace (`./…`): never absolute.
   */
  const relativePaths = (message: string) => {
    const names = new Map<string, string>();
    for (const location of activeLocations) {
      names.set(location.root, location.scope === 'global' ? 'EDU_HOME' : '.edu');
      if (location.scope === 'project') names.set(dirname(location.root), '.');
    }
    let text = message;
    for (const [root, name] of [...names].sort((a, b) => b[0].length - a[0].length)) {
      text = text.split(`${root}${sep}`).join(`${name}/`)
        .replace(new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s'"\`,;:)\\]])`, 'g'), name);
    }
    return text;
  };
  const respond = async (maxTokens: number | undefined, operation: () => Promise<string>, jsonCapabilities = false) => {
    const limit = maxTokens ?? 800;
    try {
      await bind();
      const text = await operation();
      return { content: [{ type: 'text' as const, text: jsonCapabilities ? text : truncateToTokens(text, limit) }] };
    } catch (error) {
      const message = relativePaths(error instanceof NoteConflictError ? conflictText(error) : error instanceof Error ? error.message : String(error));
      return { content: [{ type: 'text' as const, text: jsonCapabilities ? boundedCapabilities(JSON.stringify({ limitations: [`Error: ${message}`] }), version, profile, limit) : truncateToTokens(`Error: ${message}`, limit) }], isError: true };
    }
  };

  const listed: ListedTool[] = [];
  const register: Register = (name, description, shape, operation) => {
    if (profile === 'memory' && (name.startsWith('edu_crew_') || name === 'edu_orchestrate')) return;
    const strict = z.object(shape);
    // The SDK validates before invoking a tool. Catch invalid field values at its
    // boundary, then validate with the original schema inside our bounded reply.
    const sdkShape = Object.fromEntries(Object.entries(shape).map(([key, schema]) => [
      key, publishedSchema(schema as z.ZodType).catch(null).meta({ default: undefined }),
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

  const session: SessionState = {
    current: undefined,
    serverSession: `mcp-${randomUUID()}`,
    openedHere: new Set<string>(),
    async proven(claimed) {
      if (!claimed || claimed === session.current) return claimed;
      const note = await brain.read(claimed);
      return note?.meta.tier === 'episodic' && note.meta.kind === 'session' && note.meta.status === 'open-session' ? claimed : undefined;
    },
    inPrimaryBrain: note => isInside(brainPath(activeLocations[0]!), note.path),
  };
  const clientAgent = () => agentOfClient(server.server.getClientVersion()?.name);

  const context: ToolContext = {
    server, opts, env, version, profile,
    get brain() { return brain; },
    get crew() { return crew; },
    get brainRoot() { return brainRoot; },
    get eduMdPath() { return eduMdPath; },
    get workspace() { return workspace; },
    switchTo(locations, next) {
      use(locations);
      switched = true;
      workspace = next;
    },
    session,
    clientAgent,
    by: () => ({ agent: clientAgent(), session: session.current }),
    register,
  };
  return { context, listed };
}
