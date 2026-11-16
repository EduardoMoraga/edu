import {
  eduHomeOf,
  listWorkspaces,
  selectWorkspace
} from "./chunk-SNDHWENC.js";
import {
  withHostLock
} from "./chunk-UPSPAYW3.js";
import {
  autoMaintain
} from "./chunk-SHLHBIR7.js";
import {
  createCrew
} from "./chunk-CMOEIR57.js";
import {
  isTerminalCrewJobStatus
} from "./chunk-X4DEIY6R.js";
import {
  cleanTitle,
  compileReportLines,
  openBrain
} from "./chunk-BDQUVGCN.js";
import {
  packageVersion
} from "./chunk-NMJNTHQG.js";
import {
  brief
} from "./chunk-2KR4L72V.js";
import {
  estimateTokens,
  truncateToTokens
} from "./chunk-ICQNXX6J.js";
import {
  NoteConflictError,
  contentHash,
  createId
} from "./chunk-YINGR2DA.js";
import {
  brainPath,
  isInside
} from "./chunk-YPR7PZSQ.js";

// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z as z9 } from "zod";

// src/mcp/capabilities.ts
var sections = ["features", "limitations", "commands"];
function boundedCapabilities(raw, version, toolProfile, maxTokens = 800) {
  let supplied = {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) supplied = parsed;
    else supplied = { features: [raw] };
  } catch {
    supplied = { features: [raw] };
  }
  const items = (key) => Array.isArray(supplied[key]) ? supplied[key].filter((item) => typeof item === "string") : [];
  const payload = {
    version,
    toolProfile,
    restartRequired: typeof supplied.restartRequired === "boolean" ? supplied.restartRequired : true,
    features: items("features"),
    limitations: items("limitations"),
    commands: items("commands"),
    omitted: { features: 0, limitations: 0, commands: 0 }
  };
  let text = JSON.stringify(payload);
  while (estimateTokens(text) > maxTokens) {
    const candidates = sections.filter((key2) => payload[key2].length > 0);
    if (!candidates.length) break;
    const key = candidates.reduce((largest, candidate) => estimateTokens(payload[candidate].at(-1)) > estimateTokens(payload[largest].at(-1)) ? candidate : largest);
    payload[key].pop();
    payload.omitted[key]++;
    text = JSON.stringify(payload);
  }
  if (estimateTokens(text) <= maxTokens) return text;
  const identity = { version, toolProfile, restartRequired: payload.restartRequired };
  for (const reduced of [{ ...identity, omitted: payload.omitted }, { ...identity, omitted: true }, identity, { version }, {}]) {
    const candidate = JSON.stringify(reduced);
    if (estimateTokens(candidate) <= maxTokens) return candidate;
  }
  return "0";
}

// src/mcp/tools/schema.ts
import { z } from "zod";
var published = /* @__PURE__ */ new WeakMap();
var publishedSchema = (schema) => published.get(schema) ?? schema;
function optionalInt(min, max, description) {
  let strict = z.number().int().min(min);
  if (max !== void 0) strict = strict.max(max);
  const optional = description ? strict.optional().describe(description) : strict.optional();
  const twin = z.number().meta({ type: "integer", minimum: min, ...max !== void 0 ? { maximum: max } : {} }).optional();
  published.set(optional, description ? twin.describe(description) : twin);
  return optional;
}
var tokenLimit = optionalInt(1);
function optionalNumber(min, max, description) {
  const strict = z.number().min(min).max(max).optional().describe(description);
  published.set(strict, z.number().meta({ minimum: min, maximum: max }).optional().describe(description));
  return strict;
}
var altQueries = z.array(z.string().min(1)).max(3).optional();
published.set(altQueries, z.array(z.string()).optional().describe("Up to 3 rephrasings or translations (e.g. Spanish, English)"));
var MAX_TITLE_CHARS = 300;
var titleField = z.string().min(1).max(MAX_TITLE_CHARS, `must be at most ${MAX_TITLE_CHARS} characters; put the detail in the body`);
published.set(titleField, z.string().describe(`At most ${MAX_TITLE_CHARS} characters`));
var oneLine = (value) => value.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
var ISO_DATE = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
var isoDate = z.string().refine((value) => {
  const day = ISO_DATE.exec(value)?.[1];
  return day !== void 0 && !Number.isNaN(Date.parse(value)) && (/* @__PURE__ */ new Date(`${day}T00:00:00Z`)).toISOString().startsWith(day);
}, "must be an ISO date such as 2026-12-31 (or an ISO date-time)");
var dueDate = isoDate.optional().describe("ISO date, e.g. 2026-12-31");
published.set(dueDate, z.string().optional().describe("ISO date, e.g. 2026-12-31"));
var bands = z.enum(["verified", "inferred", "hypothesis"]);
var tiers = z.enum(["canonical", "episodic", "transitive"]);
var transitiveKinds = z.enum(["decision", "hypothesis", "commitment", "lesson"]);
var canonicalKinds = z.enum(["identity", "standard", "lexicon", "domain", "person", "preference"]);
var cliIds = z.enum(["claude", "codex", "pi", "opencode", "agy"]);
var autonomyLevels = z.enum(["readonly", "ask", "auto", "full"]);

// src/mcp/tools/capabilities.ts
function registerCapabilityTools(ctx) {
  const { version, profile } = ctx;
  ctx.register("edu_capabilities", "Running Edu version and features as bounded JSON (takes no caller version)", {
    maxTokens: optionalInt(1, void 0, "Hard budget (default 800); tiny ones may yield {} or 0 (budget too small, not no capabilities)")
  }, async ({ maxTokens }) => boundedCapabilities(ctx.opts.capabilities ? await ctx.opts.capabilities() : [
    `Edu ${version} (MCP, ${profile} profile). Persistent notes, recall, sessions and feedback are available${profile === "full" ? ", plus crew dispatch" : "; crew/orchestration tools are omitted"}.`,
    "Memory is stored notes, not model training; Edu does not guarantee better answers or lower cost.",
    "Feedback from edu_feedback is advisory and is never treated as externally verified."
  ].join("\n"), version, profile, maxTokens ?? 800));
}

// src/mcp/tools/context.ts
import { randomUUID } from "crypto";
import { dirname, join, resolve, sep } from "path";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z as z2 } from "zod";

// src/mcp/caller.ts
function agentOfClient(clientName) {
  if (!clientName?.trim()) return void 0;
  const cli = detectCallerCli({}, clientName);
  if (cli) return { claude: "claude-code", codex: "codex", pi: "pi", opencode: "opencode", agy: "antigravity" }[cli];
  const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || void 0;
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

// src/mcp/tools/annotations.ts
var READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
var BRAIN_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
var STARTS_AGENTS = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
var SWITCHES_WORKSPACE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
var STOPS_AGENT = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
var TOOL_ANNOTATIONS = {
  edu_brief: READ,
  edu_recall: READ,
  edu_read: READ,
  edu_capabilities: READ,
  edu_commitments: READ,
  edu_crew_status: READ,
  edu_crew_result: READ,
  edu_crew_artifact: READ,
  edu_projects: READ,
  // Switching writes nothing, but it replaces the brain this session writes to and the folder crew tools may
  // work in (a non-additive change of the session's environment), so hosts should ask first.
  edu_project_use: SWITCHES_WORKSPACE,
  edu_remember: BRAIN_WRITE,
  edu_feedback: BRAIN_WRITE,
  edu_propose_canonical: BRAIN_WRITE,
  edu_session_open: BRAIN_WRITE,
  edu_session_close: BRAIN_WRITE,
  edu_crew_dispatch: STARTS_AGENTS,
  edu_crew_review: STARTS_AGENTS,
  edu_orchestrate: STARTS_AGENTS,
  edu_crew_approve: STARTS_AGENTS,
  edu_crew_cancel: STOPS_AGENT
};

// src/mcp/tools/context.ts
function noteLine(note) {
  return `${note.meta.id} \xB7 ${note.meta.band ?? "unbanded"} \xB7 ${note.meta.status ?? "unspecified"} \xB7 ${cleanTitle(note.meta.title)}`;
}
var conflictText = (error) => `Note changed since you read it (now ${error.currentHash}). Re-read with edu_read and retry.`;
function createToolContext(server, opts, profile, version) {
  const env = opts.env ?? process.env;
  const crewOptions = { ...opts.crewOptions, globalRoot: opts.crewOptions?.globalRoot ?? eduHomeOf(env) };
  let brain = openBrain(opts.locations);
  let crew = createCrew({ ...crewOptions, locations: opts.crewOptions?.locations ?? opts.locations });
  let eduMdPath = opts.eduMdPath ?? join(opts.locations[0].root, "EDU.md");
  let brainRoot = opts.locations[0].root;
  let activeLocations = opts.locations;
  const workerProcess = Boolean(env.EDU_CREW_JOB?.trim() || env.ALBERT_CREW_JOB?.trim());
  const label = (locations) => locations[0].scope === "global" || resolve(locations[0].root) === eduHomeOf(env) ? "global" : dirname(locations[0].root);
  let workspace = opts.workspace ?? label(opts.locations);
  let switched = false;
  const use = (next) => {
    brain = openBrain(next);
    crew = createCrew({ ...crewOptions, locations: next });
    eduMdPath = join(next[0].root, "EDU.md");
    brainRoot = next[0].root;
    activeLocations = next;
  };
  let bound;
  const bind = () => bound ??= (async () => {
    let rebound;
    try {
      rebound = await opts.resolveLocations?.(server);
    } catch {
      bound = void 0;
      return;
    }
    if (!rebound?.length || switched) return;
    use(rebound);
    workspace = label(rebound);
  })();
  server.server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
    if (!switched) bound = void 0;
  });
  const relativePaths = (message) => {
    const names = /* @__PURE__ */ new Map();
    for (const location of activeLocations) {
      names.set(location.root, location.scope === "global" ? "EDU_HOME" : ".edu");
      if (location.scope === "project") names.set(dirname(location.root), ".");
    }
    let text = message;
    for (const [root, name] of [...names].sort((a, b) => b[0].length - a[0].length)) {
      text = text.split(`${root}${sep}`).join(`${name}/`).replace(new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s'"\`,;:)\\]])`, "g"), name);
    }
    return text;
  };
  const respond = async (maxTokens, operation, jsonCapabilities = false) => {
    const limit = maxTokens ?? 800;
    try {
      await bind();
      const text = await operation();
      return { content: [{ type: "text", text: jsonCapabilities ? text : truncateToTokens(text, limit) }] };
    } catch (error) {
      const message = relativePaths(error instanceof NoteConflictError ? conflictText(error) : error instanceof Error ? error.message : String(error));
      return { content: [{ type: "text", text: jsonCapabilities ? boundedCapabilities(JSON.stringify({ limitations: [`Error: ${message}`] }), version, profile, limit) : truncateToTokens(`Error: ${message}`, limit) }], isError: true };
    }
  };
  const listed = [];
  const register = (name, description, shape, operation) => {
    if (profile === "memory" && (name.startsWith("edu_crew_") || name === "edu_orchestrate")) return;
    const strict = z2.object(shape);
    const sdkShape = Object.fromEntries(Object.entries(shape).map(([key, schema]) => [
      key,
      publishedSchema(schema).catch(null).meta({ default: void 0 })
    ]));
    const inputSchema = z2.object(sdkShape);
    listed.push({ name, description, inputSchema, annotations: TOOL_ANNOTATIONS[name] });
    server.registerTool(name, { description, inputSchema, annotations: TOOL_ANNOTATIONS[name] }, async (args) => {
      const requested = args.maxTokens;
      const maxTokens = typeof requested === "number" && Number.isSafeInteger(requested) && requested > 0 ? requested : void 0;
      return respond(maxTokens, async () => {
        if (workerProcess && TOOL_ANNOTATIONS[name]?.readOnlyHint !== true) {
          throw new Error(`Edu worker cannot call ${name}; read and retrieval tools remain available`);
        }
        const parsed = strict.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`).join("; ")}`);
        return operation(parsed.data);
      }, name === "edu_capabilities");
    });
  };
  const session = {
    current: void 0,
    serverSession: `mcp-${randomUUID()}`,
    openedHere: /* @__PURE__ */ new Set(),
    async proven(claimed) {
      if (!claimed || claimed === session.current) return claimed;
      const note = await brain.read(claimed);
      return note?.meta.tier === "episodic" && note.meta.kind === "session" && note.meta.status === "open-session" ? claimed : void 0;
    },
    inPrimaryBrain: (note) => isInside(brainPath(activeLocations[0]), note.path)
  };
  const clientAgent = () => agentOfClient(server.server.getClientVersion()?.name);
  const context = {
    server,
    opts,
    env,
    version,
    profile,
    get brain() {
      return brain;
    },
    get crew() {
      return crew;
    },
    get brainRoot() {
      return brainRoot;
    },
    get eduMdPath() {
      return eduMdPath;
    },
    get workspace() {
      return workspace;
    },
    switchTo(locations, next) {
      use(locations);
      switched = true;
      workspace = next;
    },
    session,
    clientAgent,
    by: () => ({ agent: clientAgent(), session: session.current }),
    register
  };
  return { context, listed };
}

// src/mcp/tools/crew.ts
import { z as z3 } from "zod";
var MAX_RESULT_WAIT_SECONDS = 600;
function registerCrewTools(ctx) {
  const { register } = ctx;
  register("edu_crew_dispatch", "Run a crew job on a coding CLI. mode pane: visible herdr pane, headless if herdr is unreachable", {
    cli: cliIds,
    task: z3.string().min(1),
    mode: z3.enum(["headless", "pane"]).optional(),
    cwd: z3.string().optional(),
    autonomy: autonomyLevels.optional(),
    timeoutMinutes: optionalInt(1, 1440, "Stop a headless job after this many minutes (default: crew.timeoutMinutes, else 60)"),
    maxTokens: tokenLimit
  }, async ({ cli, task, mode, cwd, autonomy: selectedAutonomy, timeoutMinutes }) => {
    const requested = selectedAutonomy ?? "ask";
    const job = await ctx.crew.dispatch({ cli, task, mode, cwd, autonomy: requested, ...timeoutMinutes !== void 0 ? { timeoutMinutes } : {} });
    return JSON.stringify(job);
  });
  register("edu_crew_status", "List crew jobs or show one", {
    jobId: z3.string().optional(),
    maxTokens: tokenLimit
  }, async ({ jobId }) => JSON.stringify(await ctx.crew.status(jobId)));
  register("edu_crew_result", "Wait for and read a crew job result", {
    jobId: z3.string().min(1),
    waitSeconds: optionalNumber(0, MAX_RESULT_WAIT_SECONDS, `Seconds to wait, at most ${MAX_RESULT_WAIT_SECONDS}`),
    maxTokens: tokenLimit
  }, async ({ jobId, waitSeconds }) => JSON.stringify(await ctx.crew.result(jobId, waitSeconds ?? 0)));
  register("edu_crew_artifact", "Page a crew job's sanitized output or summary; continue with nextOffset until null", {
    jobId: z3.string().min(1),
    kind: z3.enum(["output", "summary"]),
    offset: optionalInt(0),
    maxBytes: optionalInt(1, 4096),
    maxTokens: optionalInt(100, 2e4)
  }, async ({ jobId, kind, offset, maxBytes, maxTokens }) => {
    const limit = maxTokens ?? 800;
    let pageBytes = Math.min(maxBytes ?? 1e3, 4096);
    while (true) {
      const page = JSON.stringify(await ctx.crew.store.artifact(jobId, kind, offset, pageBytes));
      if (estimateTokens(page) <= limit) return page;
      if (pageBytes <= 4) throw new Error("Artifact page metadata exceeds maxTokens");
      pageBytes = Math.max(4, Math.floor(pageBytes / 2));
    }
  });
  register("edu_crew_cancel", "Cancel a crew job: stop its worker (or close its pane) and mark it cancelled; a finished job is returned unchanged", {
    jobId: z3.string().min(1),
    maxTokens: tokenLimit
  }, async ({ jobId }) => JSON.stringify(await ctx.crew.cancel(jobId)));
}

// src/mcp/tools/memory.ts
import { createHash } from "crypto";
import { z as z4 } from "zod";
var moreHits = (count) => `\u2026 ${count} more hit${count === 1 ? "" : "s"} not shown (raise maxTokens, lower limit or narrow the query)`;
function registerMemoryTools(ctx) {
  const { register } = ctx;
  register(
    "edu_brief",
    "Session-start brief",
    { maxTokens: tokenLimit },
    async ({ maxTokens }) => brief(ctx.brain, maxTokens ?? 800, { eduMdPath: ctx.eduMdPath, now: ctx.opts.now })
  );
  register("edu_recall", "Search notes", {
    query: z4.string().min(1),
    alt: altQueries,
    limit: optionalInt(1),
    tiers: z4.array(tiers).optional(),
    maxTokens: tokenLimit
  }, async ({ query, alt, limit, tiers: selectedTiers, maxTokens }) => {
    const hits = await ctx.brain.recall(alt?.length ? [query, ...alt] : query, { limit: limit ?? 10, tiers: selectedTiers, recordUse: false });
    if (!hits.length) return "No matching notes.";
    const budget = maxTokens ?? 800;
    const lines = hits.map((hit) => `${noteLine(hit.note)} \xB7 ${hit.why}`);
    let shown = 0, spent = 0;
    for (const text of lines) {
      const rest = lines.length - shown - 1;
      const cost = estimateTokens(text) + 1;
      if (spent + cost + (rest ? estimateTokens(moreHits(rest)) + 1 : 0) > budget) break;
      spent += cost;
      shown++;
    }
    if (!shown) {
      lines[0] = truncateToTokens(lines[0], Math.max(1, budget - (lines.length > 1 ? estimateTokens(moreHits(lines.length - 1)) + 1 : 0)));
      shown = 1;
    }
    await ctx.brain.recordUse(hits.slice(0, shown).map((hit) => hit.note));
    return [...lines.slice(0, shown), ...shown < lines.length ? [moreHits(lines.length - shown)] : []].join("\n");
  });
  register("edu_read", "Read a note by id, alias, id prefix, filename or title (ambiguous: lists candidates); shows its hash. Paged: pass offset from the hint; limit = chars per page", {
    id: z4.string().min(1),
    offset: optionalInt(0),
    limit: optionalInt(1),
    maxTokens: tokenLimit
  }, async ({ id, offset, limit, maxTokens }) => {
    const result = await ctx.brain.resolve(id);
    if (!result) throw new Error(`Note not found: ${id}`);
    if ("candidates" in result) return [`Ambiguous reference "${id}" (${result.via}): ${result.candidates.length} notes match. Read one by id:`, ...result.candidates.slice(0, 20).map((note) => `- ${noteLine(note)}`)].join("\n");
    const header = `${noteLine(result.note)}
hash: ${contentHash(result.note)}

`;
    const body = result.note.body;
    const start = Math.min(offset ?? 0, body.length);
    const budget = maxTokens ?? 800;
    const render = (end2) => `${header}${body.slice(start, end2)}${end2 < body.length ? `

[chars ${start}-${end2} of ${body.length}; continue with edu_read id=${result.note.meta.id} offset=${end2}]` : start > 0 ? `

[chars ${start}-${end2} of ${body.length}; end of note]` : ""}`;
    let end = Math.min(body.length, start + (limit ?? body.length));
    if (end >= body.length && start === 0 && estimateTokens(render(end)) <= budget) return render(end);
    while (end > start && estimateTokens(render(end)) > budget) end = start + Math.floor((end - start) * 0.9) - (end - start < 10 ? 1 : 0);
    return render(Math.max(start, end));
  });
  register("edu_remember", "Write an episodic or transitive note; reports new links, possible conflicts, redactions", {
    tier: z4.enum(["episodic", "transitive"]),
    kind: transitiveKinds.optional(),
    title: titleField,
    body: z4.string(),
    band: bands.optional().describe("Claim band; required for transitive notes"),
    tags: z4.array(z4.string()).optional(),
    owner: z4.string().optional(),
    due: dueDate,
    links: z4.array(z4.string().min(1)).optional().describe("Related note ids"),
    supersedes: z4.string().min(1).optional().describe("Id of the note this replaces"),
    session: z4.string().min(1).optional().describe("Your Edu session id, if one was injected"),
    maxTokens: tokenLimit
  }, async ({ tier, kind, title, body, band, tags, owner, due, links, supersedes, session }) => {
    if (tier === "episodic" && kind) throw new Error("Episodic notes cannot use a transitive kind");
    if (tier === "transitive" && !band) throw new Error("Invalid arguments: band is required for transitive notes: verified (backed by checked evidence), inferred (reasoned from evidence) or hypothesis (unproven)");
    const provenSession = await ctx.session.proven(session);
    const cleanTags = tags?.map(oneLine).filter(Boolean);
    const { note, report } = await ctx.brain.remember({
      tier,
      kind: tier === "transitive" ? kind ?? "lesson" : void 0,
      title,
      body,
      band,
      tags: cleanTags,
      owner: owner === void 0 ? void 0 : oneLine(owner) || void 0,
      due,
      ...links?.length ? { links: [...new Set(links)] } : {},
      ...supersedes ? { supersedes } : {},
      source: "mcp",
      by: { ...ctx.by(), ...provenSession ? { session: provenSession } : {} }
    });
    return [`Created ${noteLine(note)}`, ...compileReportLines(report), ...session && !provenSession ? [`Session ${session} ignored: not an open session of this brain`] : []].join("\n");
  });
  register("edu_feedback", "Record whether a note helped (advisory; never marks anything externally verified)", {
    id: z4.string().min(1),
    helpful: z4.boolean(),
    maxTokens: tokenLimit
  }, async ({ id, helpful }) => {
    const eventId = `mcp:${createHash("sha256").update(`${ctx.session.current ?? ctx.session.serverSession}
${id}
${helpful}`).digest("hex").slice(0, 32)}`;
    const note = await ctx.brain.feedback(id, helpful, { eventId, verified: false });
    return `Feedback recorded: ${noteLine(note)}`;
  });
  register("edu_propose_canonical", "Propose a canonical note; a human must accept it", {
    kind: canonicalKinds,
    title: titleField,
    body: z4.string(),
    band: bands.optional(),
    maxTokens: tokenLimit
  }, async ({ kind, title, body, band }) => {
    const note = await ctx.brain.proposeCanonical({ tier: "canonical", kind, title, body, band, source: "mcp", by: ctx.by() });
    return `Proposed ${noteLine(note)}`;
  });
  register("edu_commitments", "List commitments", {
    status: z4.enum(["pending", "delivered", "overdue"]).optional(),
    maxTokens: tokenLimit
  }, async ({ status }) => {
    const notes = await ctx.brain.list({ kind: "commitment", ...status ? { status } : {} });
    return notes.length ? notes.sort((a, b) => (a.meta.due ?? "9999").localeCompare(b.meta.due ?? "9999")).map((note) => `${noteLine(note)} \xB7 due ${note.meta.due ?? "unspecified"}`).join("\n") : "No commitments.";
  });
}

// src/mcp/tools/orchestration.ts
import { z as z5 } from "zod";
function registerOrchestrationTools(ctx) {
  const { register, env } = ctx;
  register("edu_orchestrate", "Start a detached orchestration (visible spec and crew job)", {
    goal: z5.string().min(1),
    playbook: z5.string().optional(),
    mode: z5.enum(["solo", "crew"]).optional(),
    maxTokens: tokenLimit
  }, async ({ goal, playbook, mode }) => {
    const job = await ctx.crew.orchestrate({ goal, playbook, mode });
    const deadline = Date.now() + 6e4;
    let current = job;
    while (!current.specPath && !isTerminalCrewJobStatus(current.status) && Date.now() < deadline) {
      await new Promise((resolve2) => setTimeout(resolve2, 250));
      current = await ctx.crew.status(job.id);
    }
    return JSON.stringify({ jobId: job.id, status: current.status, specPath: current.specPath, ...current.approval ? { requestId: current.approval.requestId } : {}, outcome: current.outcome, verificationSummary: current.verificationSummary });
  });
  register("edu_crew_approve", "Approve or reject the approval gate a crew job is waiting on (recorded as the host LLM's decision)", {
    jobId: z5.string().min(1),
    requestId: z5.string().min(1).describe("The requestId of the open gate (edu_orchestrate or edu_crew_status)"),
    approve: z5.boolean(),
    maxTokens: tokenLimit
  }, async ({ jobId, requestId, approve }) => JSON.stringify(await ctx.crew.approve(jobId, approve, { by: "host-llm", requestId, env })));
  register("edu_crew_review", "Read-only review by a different available CLI", {
    cli: cliIds.optional(),
    base: z5.string().optional(),
    maxTokens: tokenLimit
  }, async ({ cli, base }) => JSON.stringify(await ctx.crew.review({ cli, base, callerCli: detectCallerCli(process.env, ctx.server.server.getClientVersion()?.name) })));
}

// src/mcp/tools/projects.ts
import { z as z6 } from "zod";
function registerProjectTools(ctx) {
  const { register, env } = ctx;
  register(
    "edu_projects",
    "List workspaces and agent names; marks the active one",
    { maxTokens: tokenLimit },
    async () => {
      const workspaces = await listWorkspaces(env);
      const workspace = ctx.workspace;
      const rows = workspaces.map((w) => `${w.root === workspace || w.name === workspace ? "* " : "  "}${w.name} \xB7 agent ${w.agent} \xB7 ${w.root}${w.present ? "" : " (missing)"}`);
      return [
        `Active: ${workspace}`,
        ...rows.length ? rows : ["No registered workspaces. Create one with `edu create`."],
        'Switch with edu_project_use (workspace name, agent name, path, or "global").'
      ].join("\n");
    }
  );
  register("edu_project_use", `Switch this session's workspace: workspace name, agent name, path or "global"`, {
    workspace: z6.string().min(1),
    maxTokens: tokenLimit
  }, async ({ workspace: selector }) => {
    if (ctx.opts.workspaceLocked) throw new Error("The host owns this workspace. Change the host working directory and restart its Edu MCP server before switching brains.");
    const selection = await selectWorkspace(selector, env, process.cwd(), { create: false });
    ctx.switchTo(selection.locations, selection.root ?? "global");
    const agent = selection.root ? (await listWorkspaces(env)).find((w) => w.root === selection.root)?.agent : void 0;
    return `Active workspace: ${selection.label}${agent ? ` (agent ${agent})` : ""} \xB7 brain ${selection.locations[0].root}`;
  });
}

// src/mcp/tools/sessions.ts
import { z as z8 } from "zod";

// src/mcp/session-learning.ts
import { createHash as createHash2 } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join as join2 } from "path";
import { z as z7 } from "zod";
var lessonInput = z7.object({
  title: z7.string().trim().min(1).max(200),
  body: z7.string().trim().min(1).max(2e3),
  evidence: z7.array(z7.string().min(1).max(200)).max(10).optional().describe("Existing note ids as edu_recall/edu_read print them, not file names; an unknown id rejects the close")
}).strict();
var lessonsInput = z7.array(lessonInput).max(3);
var sha = (text) => createHash2("sha256").update(text).digest("hex");
var noteTag = (sessionId, lesson) => `session-lesson:${sha(JSON.stringify([sessionId, lesson])).slice(0, 16)}`;
var payloadHash = (sessionId, summary, lessons) => sha(JSON.stringify({ session: sessionId, summary: summary.trim(), lessons }));
async function readJournal(path, sessionId) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new Error(`Cannot read the session-learning journal ${path}: ${error instanceof Error ? error.message : String(error)}. Nothing was changed`);
  }
  try {
    const parsed = JSON.parse(raw);
    const lessons = lessonsInput.safeParse(parsed.lessons);
    if (parsed.sessionId === sessionId && typeof parsed.summary === "string" && lessons.success && typeof parsed.done === "boolean" && Array.isArray(parsed.ids) && parsed.ids.every((id) => typeof id === "string") && (!parsed.done || parsed.ids.length === lessons.data.length) && parsed.hash === payloadHash(sessionId, parsed.summary, lessons.data)) return { ...parsed, lessons: lessons.data };
  } catch {
  }
  throw new Error(`The session-learning journal ${path} is corrupt or inconsistent. Nothing was changed; inspect or remove that file to continue`);
}
var titlesOf = (lesson, tag) => [lesson.title, `${lesson.title} \xB7 ${tag.slice(-16)}`, `${lesson.title} \xB7 ${tag.slice(-6)}`];
function isRecordOf(note, sessionId, lesson, tag) {
  const { meta } = note;
  return meta.tier === "transitive" && meta.kind === "lesson" && meta.source === "mcp" && meta.origin === `session:${sessionId}` && ["candidate", "proven", "retired"].includes(meta.status ?? "") && meta.tags.includes(tag) && titlesOf(lesson, tag).includes(meta.title) && meta.links.includes(sessionId) && (lesson.evidence ?? []).every((ref) => meta.links.includes(ref)) && note.body.startsWith(lesson.body) && note.body.includes(`closing session [[${sessionId}]]`);
}
async function writeJournal(path, journal) {
  await mkdir(join2(path, ".."), { recursive: true, mode: 448 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(journal), { mode: 384 });
  await rename(temp, path);
}
async function closeWithLessons(brain, root, session, summary, input, guard = {}) {
  const lessons = input.map((lesson) => ({ title: lesson.title, body: lesson.body, ...lesson.evidence?.length ? { evidence: [...new Set(lesson.evidence)] } : {} }));
  const tags = lessons.map((lesson) => noteTag(session.meta.id, lesson));
  if (new Set(tags).size !== tags.length) throw new Error("The same lesson appears twice in one close");
  for (const lesson of lessons) for (const ref of lesson.evidence ?? []) if (!await brain.read(ref)) throw new Error(`Evidence not found: ${ref}. Cite only existing note ids; nothing was closed or recorded`);
  const hash = payloadHash(session.meta.id, summary, lessons);
  const journalPath = join2(root, "state", "session-learning", `${sha(session.meta.id).slice(0, 32)}.json`);
  const journal = await readJournal(journalPath, session.meta.id);
  const closed = session.meta.status === "closed";
  if (closed && journal?.hash !== hash) {
    if (journal) throw new Error(`Session ${session.meta.id} is already closed with a different summary or lessons; nothing was added`);
    if (session.body.trim() === summary.trim()) throw new Error(`Session ${session.meta.id} was closed without lessons; record them explicitly with edu_remember`);
    throw new Error(`Session ${session.meta.id} is already closed with a different summary; it was not changed`);
  }
  if (!closed) {
    if (guard.expectedHash !== void 0 && guard.expectedHash.trim().toLowerCase() !== contentHash(session)) throw new NoteConflictError(session.meta.id, guard.expectedHash, contentHash(session));
    await writeJournal(journalPath, { sessionId: session.meta.id, hash, summary, lessons, done: false, ids: [] });
    await brain.closeSession(session.meta.id, summary, guard);
  }
  const recorded = [];
  const created = [];
  const candidates = (await brain.list({ kind: "lesson" })).filter((note) => note.meta.tags.some((tag) => tag.startsWith("session-lesson:")));
  for (const [i, lesson] of lessons.entries()) {
    const tag = tags[i];
    try {
      const suffixed = titlesOf(lesson, tag)[1];
      const existing = candidates.find((note2) => isRecordOf(note2, session.meta.id, lesson, tag));
      if (existing) {
        recorded.push(existing.meta.id);
        continue;
      }
      const refs = lesson.evidence ?? [];
      const input2 = {
        tier: "transitive",
        kind: "lesson",
        band: "inferred",
        source: "mcp",
        tags: ["session-lesson", tag],
        links: [session.meta.id, ...refs],
        body: [lesson.body, ...refs.length ? ["", `Evidence: ${refs.map((ref) => `[[${ref}]]`).join(", ")}`] : [], "", `Noted by the host model when closing session [[${session.meta.id}]]; not verified.`].join("\n"),
        provenance: { origin: `session:${session.meta.id}` },
        by: { ...guard.by, session: session.meta.id }
      };
      const note = await brain.read(createId({ tier: "transitive", kind: "lesson", title: lesson.title })) ? await brain.write({ ...input2, title: suffixed }) : await brain.write({ ...input2, title: lesson.title }).catch((error) => {
        if (error instanceof Error && error.message.startsWith("Note id already exists")) return brain.write({ ...input2, title: suffixed });
        throw error;
      });
      recorded.push(note.meta.id);
      created.push(note.meta.id);
    } catch (error) {
      throw new Error(`Session ${session.meta.id} is closed, but ${lessons.length - recorded.length} of ${lessons.length} lessons are pending (${error instanceof Error ? error.message : String(error)}). Recorded: ${recorded.join(", ") || "none"}. Repeat the exact same edu_session_close call to finish`);
    }
  }
  if (!(closed && journal?.done && !created.length))
    await writeJournal(journalPath, { sessionId: session.meta.id, hash, summary, lessons, done: true, ids: recorded }).catch(() => void 0);
  const text = closed && !created.length ? `Already closed ${session.meta.id}; lessons already recorded: ${recorded.join(", ")}` : `Closed ${session.meta.id}; lessons recorded as candidate/inferred (not verified): ${recorded.join(", ")}`;
  return { text, closedNow: !closed };
}

// src/mcp/tools/sessions.ts
function registerSessionTools(ctx) {
  const { register, session } = ctx;
  register("edu_session_open", "Open a work session (reuses the open one with the same source and title)", {
    title: titleField,
    source: z8.string().optional(),
    maxTokens: tokenLimit
  }, async ({ title, source }) => {
    const origin = source ?? "mcp";
    return withHostLock(ctx.brainRoot, origin, `open:${title}`, async () => {
      const existing = (await ctx.brain.list({ kind: "session", status: "open-session" })).find((note2) => note2.meta.source === origin && note2.meta.title === title && session.inPrimaryBrain(note2));
      if (existing) {
        session.current = existing.meta.id;
        session.openedHere.add(existing.meta.id);
        return `Session id: ${existing.meta.id}
Reused ${noteLine(existing)}`;
      }
      const agent = ctx.clientAgent();
      const note = await ctx.brain.openSession(title, origin, agent ? { agent } : void 0);
      session.current = note.meta.id;
      session.openedHere.add(note.meta.id);
      return `Session id: ${note.meta.id}
Opened ${noteLine(note)}`;
    });
  });
  register("edu_session_close", "Close a session by its exact id with a summary. Repeating the same close is a no-op; an unknown id fails", {
    id: z8.string().min(1),
    summary: z8.string(),
    source: z8.string().optional(),
    lessons: lessonsInput.optional().describe("Up to 3 observations YOU made this session; stored as unverified candidates"),
    expected_hash: z8.string().min(1).optional().describe("Hash from edu_read; refuses if the session changed since"),
    maxTokens: tokenLimit
  }, async ({ id, summary, source, lessons, expected_hash: expectedHash }) => {
    const agent = ctx.clientAgent();
    const guard = { ...expectedHash ? { expectedHash } : {}, ...agent ? { by: { agent } } : {} };
    const text = await withHostLock(ctx.brainRoot, "mcp-close", id, async () => {
      const current = await ctx.brain.read(id);
      if (!current || current.meta.kind !== "session" || !(session.openedHere.has(current.meta.id) || session.inPrimaryBrain(current))) {
        throw new Error(`Session not found: ${id}. Close needs the exact id edu_session_open returned in this workspace.`);
      }
      if (source && current.meta.source !== source) throw new Error(`Session ${id} belongs to source ${current.meta.source ?? "unknown"}, not ${source}; not closed`);
      if (lessons?.length) {
        const result = await closeWithLessons(ctx.brain, ctx.brainRoot, current, summary, lessons, guard);
        if (result.closedNow) await autoMaintain(ctx.brain, ctx.brainRoot);
        return result.text;
      }
      if (current.meta.status === "closed") {
        if (current.body.trim() === summary.trim()) return `Already closed ${noteLine(current)}`;
        throw new Error(`Session ${id} is already closed with a different summary; it was not changed`);
      }
      const note = await ctx.brain.closeSession(id, summary, guard);
      await autoMaintain(ctx.brain, ctx.brainRoot);
      return `Closed ${noteLine(note)}`;
    });
    if (session.current === id) session.current = void 0;
    return text;
  });
}

// src/mcp/server.ts
function createEduMcpServer(opts) {
  const profile = opts.toolProfile ?? "full";
  if (profile !== "full" && profile !== "memory") throw new Error("Unknown MCP tool profile; use full or memory");
  const version = packageVersion();
  const server = new McpServer({ name: "edu", version });
  const { context, listed } = createToolContext(server, opts, profile, version);
  registerMemoryTools(context);
  registerSessionTools(context);
  registerCapabilityTools(context);
  registerProjectTools(context);
  registerCrewTools(context);
  registerOrchestrationTools(context);
  const tools = listed.map(({ name, description, inputSchema, annotations }) => {
    const { $schema: _schemaUrl, ...schema } = z9.toJSONSchema(inputSchema, { target: "draft-7", io: "input" });
    return { name, description, inputSchema: schema, ...annotations ? { annotations } : {} };
  });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  return server;
}

export {
  createEduMcpServer
};
//# sourceMappingURL=chunk-GP7OJNUL.js.map