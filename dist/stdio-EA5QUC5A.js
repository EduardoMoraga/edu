import {
  eduHomeOf,
  listWorkspaces,
  selectWorkspace
} from "./chunk-JJ7AJTSL.js";
import {
  createCrew
} from "./chunk-H2NUAYY5.js";
import "./chunk-AFUH4IVJ.js";
import {
  brief,
  truncateToTokens
} from "./chunk-LE5MNAHZ.js";
import "./chunk-DWK7GEN5.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-DOOFC4UY.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-JWSBCKMM.js";
import "./chunk-42XEKWTU.js";
import "./chunk-ROTDA577.js";
import "./chunk-VHSIB24T.js";
import "./chunk-KQO36KVT.js";
import {
  resolveBrainLocations
} from "./chunk-5A4EJR4Z.js";
import "./chunk-QXXUVLOK.js";
import {
  autoMaintain,
  openBrain
} from "./chunk-XCK7PFLA.js";
import "./chunk-7UTDQFLV.js";

// src/mcp/stdio.ts
import { existsSync, statSync } from "fs";
import { join as join2, resolve as resolve2 } from "path";
import { fileURLToPath } from "url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/mcp/server.ts
import { dirname, join, resolve } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
var tokenLimit = z.number().int().positive().optional().describe("Maximum response tokens (default 800)");
var bands = z.enum(["verified", "inferred", "hypothesis"]);
var tiers = z.enum(["canonical", "episodic", "transitive"]);
var transitiveKinds = z.enum(["decision", "hypothesis", "commitment", "lesson"]);
var canonicalKinds = z.enum(["identity", "standard", "lexicon", "domain", "person", "preference"]);
function line(note) {
  return `${note.meta.id} \xB7 ${note.meta.band ?? "inferred"} \xB7 ${note.meta.status ?? "unspecified"} \xB7 ${note.meta.title}`;
}
var READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
var BRAIN_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
var STARTS_AGENTS = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
var TOOL_ANNOTATIONS = {
  edu_brief: READ,
  edu_recall: READ,
  edu_read: READ,
  edu_commitments: READ,
  edu_crew_status: READ,
  edu_crew_result: READ,
  edu_projects: READ,
  // Switching only changes which local brain this server process uses; nothing is written or deleted.
  edu_project_use: BRAIN_WRITE,
  edu_remember: BRAIN_WRITE,
  edu_feedback: BRAIN_WRITE,
  edu_propose_canonical: BRAIN_WRITE,
  edu_session_open: BRAIN_WRITE,
  edu_session_close: BRAIN_WRITE,
  edu_crew_dispatch: STARTS_AGENTS,
  edu_crew_review: STARTS_AGENTS,
  edu_orchestrate: STARTS_AGENTS,
  edu_crew_approve: STARTS_AGENTS
};
function createEduMcpServer(opts) {
  const server = new McpServer({ name: "edu", version: "0.10.2" });
  let brain = openBrain(opts.locations);
  let crew = createCrew({ ...opts.crewOptions, locations: opts.crewOptions?.locations ?? opts.locations });
  let eduMdPath = opts.eduMdPath ?? join(opts.locations[0].root, "EDU.md");
  let brainRoot = opts.locations[0].root;
  const env = opts.env ?? process.env;
  const label = (locations) => locations[0].scope === "global" || resolve(locations[0].root) === eduHomeOf(env) ? "global" : dirname(locations[0].root);
  let workspace = opts.workspace ?? label(opts.locations);
  let switched = false;
  const use = (locations) => {
    brain = openBrain(locations);
    crew = createCrew({ ...opts.crewOptions, locations });
    eduMdPath = join(locations[0].root, "EDU.md");
    brainRoot = locations[0].root;
  };
  let bound;
  const bind = () => bound ??= (async () => {
    let locations;
    try {
      locations = await opts.resolveLocations?.(server);
    } catch {
      bound = void 0;
      return;
    }
    if (!locations?.length || switched) return;
    use(locations);
    workspace = label(locations);
  })();
  const respond = async (maxTokens, operation) => {
    const limit = maxTokens ?? 800;
    try {
      await bind();
      return { content: [{ type: "text", text: truncateToTokens(await operation(), limit) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: truncateToTokens(`Error: ${message}`, limit) }], isError: true };
    }
  };
  const register = (name, description, shape, operation) => {
    const strict = z.object(shape);
    const sdkShape = Object.fromEntries(Object.entries(shape).map(([key, schema]) => [
      key,
      schema.catch(null)
    ]));
    server.registerTool(name, { description, inputSchema: z.object(sdkShape), annotations: TOOL_ANNOTATIONS[name] }, async (args) => {
      const requested = args.maxTokens;
      const maxTokens = typeof requested === "number" && Number.isSafeInteger(requested) && requested > 0 ? requested : void 0;
      return respond(maxTokens, async () => {
        const parsed = strict.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`).join("; ")}`);
        return operation(parsed.data);
      });
    });
  };
  register(
    "edu_brief",
    "Get a compact session-start brief",
    { maxTokens: tokenLimit },
    async ({ maxTokens }) => brief(brain, maxTokens ?? 800, { eduMdPath, now: opts.now })
  );
  register("edu_recall", "Search brain notes", {
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
    tiers: z.array(tiers).optional(),
    maxTokens: tokenLimit
  }, async ({ query, limit, tiers: selectedTiers }) => {
    const hits = await brain.recall(query, { limit: limit ?? 10, tiers: selectedTiers });
    return hits.length ? hits.map((hit) => `${line(hit.note)} \xB7 ${hit.why}`).join("\n") : "No matching notes.";
  });
  register(
    "edu_read",
    "Read a brain note by id, legacy id or alias (e.g. D-010), unique id prefix, filename or exact title; returns the candidates when ambiguous",
    { id: z.string().min(1), maxTokens: tokenLimit },
    async ({ id }) => {
      const result = await brain.resolve(id);
      if (!result) throw new Error(`Note not found: ${id}`);
      if ("candidates" in result) return [`Ambiguous reference "${id}" (${result.via}): ${result.candidates.length} notes match. Read one by id:`, ...result.candidates.slice(0, 20).map((note) => `- ${line(note)}`)].join("\n");
      return `${line(result.note)}

${result.note.body}`;
    }
  );
  register("edu_remember", "Create an episodic or transitive note", {
    tier: z.enum(["episodic", "transitive"]),
    kind: transitiveKinds.optional(),
    title: z.string().min(1),
    body: z.string(),
    band: bands.optional(),
    tags: z.array(z.string()).optional(),
    owner: z.string().optional(),
    due: z.string().optional(),
    maxTokens: tokenLimit
  }, async ({ tier, kind, title, body, band, tags, owner, due }) => {
    if (tier === "episodic" && kind) throw new Error("Episodic notes cannot use a transitive kind");
    const note = await brain.write({ tier, kind: tier === "transitive" ? kind ?? "lesson" : void 0, title, body, band, tags, owner, due, source: "mcp" });
    return `Created ${line(note)}`;
  });
  register("edu_feedback", "Record whether a note was useful", {
    id: z.string().min(1),
    helpful: z.boolean(),
    maxTokens: tokenLimit
  }, async ({ id, helpful }) => {
    const note = await brain.feedback(id, helpful);
    return `Feedback recorded: ${line(note)}`;
  });
  register("edu_propose_canonical", "Propose a canonical note for human acceptance", {
    kind: canonicalKinds,
    title: z.string().min(1),
    body: z.string(),
    band: bands.optional(),
    maxTokens: tokenLimit
  }, async ({ kind, title, body, band }) => {
    const note = await brain.proposeCanonical({ tier: "canonical", kind, title, body, band, source: "mcp" });
    return `Proposed ${line(note)}`;
  });
  register("edu_commitments", "List commitments", {
    status: z.enum(["pending", "delivered", "overdue"]).optional(),
    maxTokens: tokenLimit
  }, async ({ status }) => {
    const notes = await brain.list({ kind: "commitment", ...status ? { status } : {} });
    return notes.length ? notes.sort((a, b) => (a.meta.due ?? "9999").localeCompare(b.meta.due ?? "9999")).map((note) => `${line(note)} \xB7 due ${note.meta.due ?? "unspecified"}`).join("\n") : "No commitments.";
  });
  register("edu_session_open", "Open a work session", {
    title: z.string().min(1),
    source: z.string().optional(),
    maxTokens: tokenLimit
  }, async ({ title, source }) => {
    const note = await brain.openSession(title, source ?? "mcp");
    return `Session id: ${note.meta.id}
Opened ${line(note)}`;
  });
  register("edu_session_close", "Close a work session with a summary", {
    id: z.string().min(1),
    summary: z.string(),
    source: z.string().optional(),
    maxTokens: tokenLimit
  }, async ({ id, summary, source }) => {
    const current = await brain.read(id);
    if (current && current.meta.kind === "session") {
      const note2 = await brain.closeSession(id, summary);
      await autoMaintain(brain, brainRoot);
      return `Closed ${line(note2)}`;
    }
    const open = await brain.list({ kind: "session", status: "open-session" });
    const matching = source ? open.filter((note2) => note2.meta.source === source) : open;
    const fallback = source && matching.length === 1 ? matching[0] : !source && matching.length ? [...matching].sort((a, b) => b.meta.created.localeCompare(a.meta.created))[0] : void 0;
    if (!fallback) throw new Error(`Session not found: ${id}. Open session ids: ${open.map((note2) => note2.meta.id).join(", ") || "none"}`);
    const note = await brain.closeSession(fallback.meta.id, summary);
    await autoMaintain(brain, brainRoot);
    return `Closed ${line(note)} instead of ${id} (unknown id; selected ${source ? `the only open session from ${source}` : "the most recent open session"}).`;
  });
  register(
    "edu_projects",
    "List the registered Edu workspaces and their agent names, marking the active one",
    { maxTokens: tokenLimit },
    async () => {
      const workspaces = await listWorkspaces(env);
      const rows = workspaces.map((w) => `${w.root === workspace || w.name === workspace ? "* " : "  "}${w.name} \xB7 agent ${w.agent} \xB7 ${w.root}${w.present ? "" : " (missing)"}`);
      return [
        `Active: ${workspace}`,
        ...rows.length ? rows : ["No registered workspaces. Create one with `edu create`."],
        'Switch with edu_project_use (workspace name, agent name, path, or "global").'
      ].join("\n");
    }
  );
  register("edu_project_use", 'Switch the active Edu workspace for this session by workspace name, agent name (e.g. "albert"), path, or "global"', {
    workspace: z.string().min(1),
    maxTokens: tokenLimit
  }, async ({ workspace: selector }) => {
    const selection = await selectWorkspace(selector, env);
    use(selection.locations);
    switched = true;
    workspace = selection.root ?? "global";
    const agent = selection.root ? (await listWorkspaces(env)).find((w) => w.root === selection.root)?.agent : void 0;
    return `Active workspace: ${selection.label}${agent ? ` (agent ${agent})` : ""} \xB7 brain ${selection.locations[0].root}`;
  });
  const cliIds = z.enum(["claude", "codex", "pi", "opencode", "agy"]);
  const autonomy = z.enum(["readonly", "ask", "auto", "full"]);
  register("edu_crew_dispatch", 'Dispatch a crew job to a coding CLI. mode "pane" opens a visible herdr pane (beside the caller inside herdr, otherwise a tab in the herdr "Edu" workspace) and falls back to headless with a note when herdr is unreachable', {
    cli: cliIds,
    task: z.string().min(1),
    mode: z.enum(["headless", "pane"]).optional(),
    cwd: z.string().optional(),
    autonomy: autonomy.optional(),
    maxTokens: tokenLimit
  }, async ({ cli, task, mode, cwd, autonomy: selectedAutonomy }) => {
    const job = await crew.dispatch({ cli, task, mode, cwd, autonomy: selectedAutonomy });
    return JSON.stringify(job);
  });
  register("edu_crew_status", "List crew jobs or inspect one job", {
    jobId: z.string().optional(),
    maxTokens: tokenLimit
  }, async ({ jobId }) => JSON.stringify(await crew.status(jobId)));
  register("edu_crew_result", "Wait for and read a crew job result", {
    jobId: z.string().min(1),
    waitSeconds: z.number().nonnegative().optional(),
    maxTokens: tokenLimit
  }, async ({ jobId, waitSeconds }) => JSON.stringify(await crew.result(jobId, waitSeconds ?? 0)));
  register("edu_orchestrate", "Start a detached orchestration with a visible spec and crew job", {
    goal: z.string().min(1),
    playbook: z.string().optional(),
    mode: z.enum(["solo", "crew"]).optional(),
    autoApprove: z.boolean().optional(),
    maxTokens: tokenLimit
  }, async ({ goal, playbook, mode, autoApprove }) => {
    const job = await crew.orchestrate({ goal, playbook, mode, autoApprove });
    const deadline = Date.now() + 6e4;
    let current = job;
    while (!current.specPath && !["done", "failed", "cancelled"].includes(current.status) && Date.now() < deadline) {
      await new Promise((resolve3) => setTimeout(resolve3, 250));
      current = await crew.status(job.id);
    }
    return JSON.stringify({ jobId: job.id, status: current.status, specPath: current.specPath, outcome: current.outcome, verificationSummary: current.verificationSummary });
  });
  register("edu_crew_approve", "Approve or reject a pending orchestration spec", {
    jobId: z.string().min(1),
    approve: z.boolean(),
    maxTokens: tokenLimit
  }, async ({ jobId, approve }) => JSON.stringify(await crew.approve(jobId, approve)));
  register("edu_crew_review", "Dispatch a read-only review using a different available CLI", {
    cli: cliIds.optional(),
    base: z.string().optional(),
    maxTokens: tokenLimit
  }, async ({ cli, base }) => JSON.stringify(await crew.review({ cli, base, callerCli: detectCallerCli(process.env, server.server.getClientVersion()?.name) })));
  return server;
}
function detectCallerCli(env, clientName) {
  const name = (clientName ?? "").toLowerCase();
  if (name.includes("claude")) return "claude";
  if (name.includes("codex")) return "codex";
  if (name.includes("opencode")) return "opencode";
  if (name.includes("antigravity") || name.includes("gemini") || name.includes("agy")) return "agy";
  if (/(^|[^a-z])pi([^a-z]|$)/.test(name)) return "pi";
  if (env.CLAUDECODE) return "claude";
  if (Object.keys(env).some((key) => key.startsWith("CODEX_"))) return "codex";
  if (Object.keys(env).some((key) => key.startsWith("PI_"))) return "pi";
  if (env.OPENCODE) return "opencode";
  if (env.ANTIGRAVITY || env.ANTIGRAVITY_AGENT || env.GEMINI_CLI) return "agy";
  return void 0;
}

// src/mcp/stdio.ts
async function runStdioServer(opts = {}) {
  const server = await createStdioServer(opts);
  await server.connect(new StdioServerTransport());
  return server;
}
async function createStdioServer(opts = {}) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? launchDirectory(env);
  const project = opts.project?.trim() || env.EDU_PROJECT?.trim() || void 0;
  if (project) {
    const selection = await selectWorkspace(project, env, cwd);
    return createEduMcpServer({
      locations: selection.locations,
      now: opts.now,
      env,
      workspace: selection.root ?? "global",
      eduMdPath: join2(selection.locations[0].root, "EDU.md")
    });
  }
  const locations = await resolveBrainLocations(cwd, env);
  const brain = openBrain(locations);
  await brain.init(locations[0]);
  return createEduMcpServer({
    locations,
    now: opts.now,
    env,
    eduMdPath: join2(locations[0].root, "EDU.md"),
    resolveLocations: async (mcp) => {
      if (!mcp.server.getClientCapabilities()?.roots) return void 0;
      return resolveReboundLocations(cwd, env, async () => (await mcp.server.listRoots()).roots.map((root) => root.uri));
    }
  });
}
async function resolveReboundLocations(cwd, env, listRoots) {
  let roots;
  try {
    roots = await listRoots();
  } catch {
    roots = await listRoots();
  }
  const uri = roots.find((root) => root.startsWith("file://"));
  if (!uri) return void 0;
  const dir = resolve2(fileURLToPath(uri));
  if (dir === resolve2(cwd)) return void 0;
  const locations = await resolveBrainLocations(dir, env);
  if (locations[0]?.scope !== "project") locations.unshift({ scope: "project", root: join2(dir, ".edu") });
  await openBrain(locations).init(locations[0]);
  return locations;
}
function launchDirectory(env, processCwd = process.cwd()) {
  const pwd = env.PWD;
  if (pwd && resolve2(pwd) !== resolve2(processCwd) && existsSync(pwd) && statSync(pwd).isDirectory() && /[\\/]plugins?[\\/]/.test(processCwd)) return pwd;
  return processCwd;
}
export {
  createStdioServer,
  launchDirectory,
  resolveReboundLocations,
  runStdioServer
};
//# sourceMappingURL=stdio-EA5QUC5A.js.map