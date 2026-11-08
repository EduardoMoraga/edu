import {
  createCrew
} from "./chunk-IZBYTJKF.js";
import {
  brief
} from "./chunk-N2PZU3T2.js";
import {
  estimateTokens,
  truncateToTokens
} from "./chunk-D45JK3LN.js";
import {
  eduHomeOf,
  listWorkspaces,
  selectWorkspace
} from "./chunk-3OYDFP5V.js";
import {
  packageVersion
} from "./chunk-BXZ573JQ.js";
import {
  compileReportLines,
  openBrain
} from "./chunk-XPGTBTXM.js";
import {
  autoMaintain
} from "./chunk-UTSDLJPR.js";
import {
  NoteConflictError,
  contentHash,
  createId
} from "./chunk-2P2KBRRT.js";

// src/mcp/server.ts
import { dirname, join as join3, resolve } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z as z2 } from "zod";

// src/mcp/session-learning.ts
import { createHash } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
var lessonInput = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2e3),
  evidence: z.array(z.string().min(1).max(200)).max(10).optional().describe("Existing note ids as edu_recall/edu_read print them, not file names; an unknown id rejects the close")
}).strict();
var lessonsInput = z.array(lessonInput).max(3);
var sha = (text) => createHash("sha256").update(text).digest("hex");
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
  await mkdir(join(path, ".."), { recursive: true, mode: 448 });
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
  const journalPath = join(root, "state", "session-learning", `${sha(session.meta.id).slice(0, 32)}.json`);
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

// src/platform/file-lock.ts
import { createHash as createHash2 } from "crypto";
import { mkdir as mkdir2, readFile as readFile2, rename as rename2, rm, stat, writeFile as writeFile2 } from "fs/promises";
import { join as join2 } from "path";
var LOCK_WAIT_MS = 5e3;
var LOCK_STALE_MS = 3e4;
var pause = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function withHostLock(root, source, key, body, waitMs = LOCK_WAIT_MS) {
  const dir = join2(root, "state", "locks", `${createHash2("sha256").update(`${source}\0${key}`).digest("hex").slice(0, 32)}.lock`);
  await mkdir2(join2(root, "state", "locks"), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (; ; ) {
    try {
      await mkdir2(dir);
      await writeFile2(join2(dir, "owner"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (await staleLock(dir)) {
      const claimed = `${dir}.stale-${process.pid}-${Date.now()}`;
      try {
        await rename2(dir, claimed);
        await rm(claimed, { recursive: true, force: true });
      } catch {
      }
      continue;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for the ${source} session lock`);
    await pause(25);
  }
  try {
    return await body();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function staleLock(dir) {
  try {
    const age = Date.now() - (await stat(dir)).mtimeMs;
    if (age < LOCK_STALE_MS) return false;
    const pid = Number((await readFile2(join2(dir, "owner"), "utf8").catch(() => "")).trim());
    return !(Number.isInteger(pid) && pid > 0 && alive(pid));
  } catch {
    return false;
  }
}

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

// src/mcp/server.ts
var published = /* @__PURE__ */ new WeakMap();
function optionalInt(min, max, description) {
  let strict = z2.number().int().min(min);
  if (max !== void 0) strict = strict.max(max);
  const optional = description ? strict.optional().describe(description) : strict.optional();
  const twin = z2.number().meta({ type: "integer", minimum: min, ...max !== void 0 ? { maximum: max } : {} }).optional();
  published.set(optional, description ? twin.describe(description) : twin);
  return optional;
}
var tokenLimit = optionalInt(1);
var altQueries = z2.array(z2.string().min(1)).max(3).optional();
published.set(altQueries, z2.array(z2.string()).optional().describe("Up to 3 rephrasings or translations (e.g. Spanish, English)"));
var bands = z2.enum(["verified", "inferred", "hypothesis"]);
var tiers = z2.enum(["canonical", "episodic", "transitive"]);
var transitiveKinds = z2.enum(["decision", "hypothesis", "commitment", "lesson"]);
var canonicalKinds = z2.enum(["identity", "standard", "lexicon", "domain", "person", "preference"]);
function line(note) {
  return `${note.meta.id} \xB7 ${note.meta.band ?? "inferred"} \xB7 ${note.meta.status ?? "unspecified"} \xB7 ${note.meta.title}`;
}
function agentOfClient(clientName) {
  if (!clientName?.trim()) return void 0;
  const cli = detectCallerCli({}, clientName);
  if (cli) return { claude: "claude-code", codex: "codex", pi: "pi", opencode: "opencode", agy: "antigravity" }[cli];
  const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || void 0;
}
var compileReportText = compileReportLines;
var conflictText = (error) => `Note changed since you read it (now ${error.currentHash}). Re-read with edu_read and retry.`;
var READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
var BRAIN_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
var STARTS_AGENTS = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
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
  const profile = opts.toolProfile ?? "full";
  if (profile !== "full" && profile !== "memory") throw new Error("Unknown MCP tool profile; use full or memory");
  const SERVER_VERSION = packageVersion();
  const server = new McpServer({ name: "edu", version: SERVER_VERSION });
  let brain = openBrain(opts.locations);
  let crew = createCrew({ ...opts.crewOptions, locations: opts.crewOptions?.locations ?? opts.locations });
  let eduMdPath = opts.eduMdPath ?? join3(opts.locations[0].root, "EDU.md");
  let brainRoot = opts.locations[0].root;
  const env = opts.env ?? process.env;
  const workerProcess = Boolean(env.EDU_CREW_JOB?.trim() || env.ALBERT_CREW_JOB?.trim());
  const label = (locations) => locations[0].scope === "global" || resolve(locations[0].root) === eduHomeOf(env) ? "global" : dirname(locations[0].root);
  let workspace = opts.workspace ?? label(opts.locations);
  let switched = false;
  const use = (locations) => {
    brain = openBrain(locations);
    crew = createCrew({ ...opts.crewOptions, locations });
    eduMdPath = join3(locations[0].root, "EDU.md");
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
  const respond = async (maxTokens, operation, jsonCapabilities = false) => {
    const limit = maxTokens ?? 800;
    try {
      await bind();
      const text = await operation();
      return { content: [{ type: "text", text: jsonCapabilities ? text : truncateToTokens(text, limit) }] };
    } catch (error) {
      const message = error instanceof NoteConflictError ? conflictText(error) : error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: jsonCapabilities ? boundedCapabilities(JSON.stringify({ limitations: [`Error: ${message}`] }), SERVER_VERSION, profile, limit) : truncateToTokens(`Error: ${message}`, limit) }], isError: true };
    }
  };
  const listed = [];
  const register = (name, description, shape, operation) => {
    if (profile === "memory" && (name.startsWith("edu_crew_") || name === "edu_orchestrate")) return;
    const strict = z2.object(shape);
    const sdkShape = Object.fromEntries(Object.entries(shape).map(([key, schema]) => [
      key,
      (published.get(schema) ?? schema).catch(null).meta({ default: void 0 })
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
  let currentSession;
  const clientAgent = () => agentOfClient(server.server.getClientVersion()?.name);
  const by = () => ({ agent: clientAgent(), session: currentSession });
  register(
    "edu_brief",
    "Session-start brief",
    { maxTokens: tokenLimit },
    async ({ maxTokens }) => brief(brain, maxTokens ?? 800, { eduMdPath, now: opts.now })
  );
  register("edu_recall", "Search notes", {
    query: z2.string().min(1),
    alt: altQueries,
    limit: optionalInt(1),
    tiers: z2.array(tiers).optional(),
    maxTokens: tokenLimit
  }, async ({ query, alt, limit, tiers: selectedTiers }) => {
    const hits = await brain.recall(alt?.length ? [query, ...alt] : query, { limit: limit ?? 10, tiers: selectedTiers });
    return hits.length ? hits.map((hit) => `${line(hit.note)} \xB7 ${hit.why}`).join("\n") : "No matching notes.";
  });
  register("edu_read", "Read a note by id, alias, id prefix, filename or title (ambiguous: lists candidates); shows its hash. Paged: pass offset from the hint; limit = chars per page", {
    id: z2.string().min(1),
    offset: optionalInt(0),
    limit: optionalInt(1),
    maxTokens: tokenLimit
  }, async ({ id, offset, limit, maxTokens }) => {
    const result = await brain.resolve(id);
    if (!result) throw new Error(`Note not found: ${id}`);
    if ("candidates" in result) return [`Ambiguous reference "${id}" (${result.via}): ${result.candidates.length} notes match. Read one by id:`, ...result.candidates.slice(0, 20).map((note) => `- ${line(note)}`)].join("\n");
    const header = `${line(result.note)}
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
    tier: z2.enum(["episodic", "transitive"]),
    kind: transitiveKinds.optional(),
    title: z2.string().min(1),
    body: z2.string(),
    band: bands.optional(),
    tags: z2.array(z2.string()).optional(),
    owner: z2.string().optional(),
    due: z2.string().optional(),
    links: z2.array(z2.string().min(1)).optional().describe("Related note ids"),
    supersedes: z2.string().min(1).optional().describe("Id of the note this replaces"),
    session: z2.string().min(1).optional().describe("Your Edu session id, if one was injected"),
    maxTokens: tokenLimit
  }, async ({ tier, kind, title, body, band, tags, owner, due, links, supersedes, session }) => {
    if (tier === "episodic" && kind) throw new Error("Episodic notes cannot use a transitive kind");
    const { note, report } = await brain.remember({
      tier,
      kind: tier === "transitive" ? kind ?? "lesson" : void 0,
      title,
      body,
      band,
      tags,
      owner,
      due,
      ...links?.length ? { links: [...new Set(links)] } : {},
      ...supersedes ? { supersedes } : {},
      source: "mcp",
      by: { ...by(), ...session ? { session } : {} }
    });
    return [`Created ${line(note)}`, ...compileReportText(report)].join("\n");
  });
  register("edu_feedback", "Record whether a note helped (advisory; never marks anything externally verified)", {
    id: z2.string().min(1),
    helpful: z2.boolean(),
    maxTokens: tokenLimit
  }, async ({ id, helpful }) => {
    const note = await brain.feedback(id, helpful);
    return `Feedback recorded: ${line(note)}`;
  });
  register("edu_propose_canonical", "Propose a canonical note; a human must accept it", {
    kind: canonicalKinds,
    title: z2.string().min(1),
    body: z2.string(),
    band: bands.optional(),
    maxTokens: tokenLimit
  }, async ({ kind, title, body, band }) => {
    const note = await brain.proposeCanonical({ tier: "canonical", kind, title, body, band, source: "mcp", by: by() });
    return `Proposed ${line(note)}`;
  });
  register("edu_commitments", "List commitments", {
    status: z2.enum(["pending", "delivered", "overdue"]).optional(),
    maxTokens: tokenLimit
  }, async ({ status }) => {
    const notes = await brain.list({ kind: "commitment", ...status ? { status } : {} });
    return notes.length ? notes.sort((a, b) => (a.meta.due ?? "9999").localeCompare(b.meta.due ?? "9999")).map((note) => `${line(note)} \xB7 due ${note.meta.due ?? "unspecified"}`).join("\n") : "No commitments.";
  });
  register("edu_session_open", "Open a work session (reuses the open one with the same source and title)", {
    title: z2.string().min(1),
    source: z2.string().optional(),
    maxTokens: tokenLimit
  }, async ({ title, source }) => {
    const origin = source ?? "mcp";
    return withHostLock(brainRoot, origin, `open:${title}`, async () => {
      const existing = (await brain.list({ kind: "session", status: "open-session" })).find((note2) => note2.meta.source === origin && note2.meta.title === title);
      if (existing) {
        currentSession = existing.meta.id;
        return `Session id: ${existing.meta.id}
Reused ${line(existing)}`;
      }
      const agent = clientAgent();
      const note = await brain.openSession(title, origin, agent ? { agent } : void 0);
      currentSession = note.meta.id;
      return `Session id: ${note.meta.id}
Opened ${line(note)}`;
    });
  });
  register("edu_session_close", "Close a session by its exact id with a summary. Repeating the same close is a no-op; an unknown id fails", {
    id: z2.string().min(1),
    summary: z2.string(),
    source: z2.string().optional(),
    lessons: lessonsInput.optional().describe("Up to 3 observations YOU made this session; stored as unverified candidates"),
    expected_hash: z2.string().min(1).optional().describe("Hash from edu_read; refuses if the session changed since"),
    maxTokens: tokenLimit
  }, async ({ id, summary, source, lessons, expected_hash: expectedHash }) => {
    const agent = clientAgent();
    const guard = { ...expectedHash ? { expectedHash } : {}, ...agent ? { by: { agent } } : {} };
    const text = await withHostLock(brainRoot, "mcp-close", id, async () => {
      const current = await brain.read(id);
      if (!current || current.meta.kind !== "session") {
        const open = await brain.list({ kind: "session", status: "open-session" });
        throw new Error(`Session not found: ${id}. Close needs the exact id returned by edu_session_open. Open session ids: ${open.map((note2) => note2.meta.id).join(", ") || "none"}`);
      }
      if (source && current.meta.source !== source) throw new Error(`Session ${id} belongs to source ${current.meta.source ?? "unknown"}, not ${source}; not closed`);
      if (lessons?.length) {
        const result = await closeWithLessons(brain, brainRoot, current, summary, lessons, guard);
        if (result.closedNow) await autoMaintain(brain, brainRoot);
        return result.text;
      }
      if (current.meta.status === "closed") {
        if (current.body.trim() === summary.trim()) return `Already closed ${line(current)}`;
        throw new Error(`Session ${id} is already closed with a different summary; it was not changed`);
      }
      const note = await brain.closeSession(id, summary, guard);
      await autoMaintain(brain, brainRoot);
      return `Closed ${line(note)}`;
    });
    if (currentSession === id) currentSession = void 0;
    return text;
  });
  register("edu_capabilities", "Running Edu version and features as bounded JSON (takes no caller version)", {
    maxTokens: optionalInt(1, void 0, "Hard budget (default 800); tiny ones may yield {} or 0 (budget too small, not no capabilities)")
  }, async ({ maxTokens }) => boundedCapabilities(opts.capabilities ? await opts.capabilities() : [
    `Edu ${SERVER_VERSION} (MCP, ${profile} profile). Persistent notes, recall, sessions and feedback are available${profile === "full" ? ", plus crew dispatch" : "; crew/orchestration tools are omitted"}.`,
    "Memory is stored notes, not model training; Edu does not guarantee better answers or lower cost.",
    "Feedback from edu_feedback is advisory and is never treated as externally verified."
  ].join("\n"), SERVER_VERSION, profile, maxTokens ?? 800));
  register(
    "edu_projects",
    "List workspaces and agent names; marks the active one",
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
  register("edu_project_use", `Switch this session's workspace: workspace name, agent name, path or "global"`, {
    workspace: z2.string().min(1),
    maxTokens: tokenLimit
  }, async ({ workspace: selector }) => {
    if (opts.workspaceLocked) throw new Error("The host owns this workspace. Change the host working directory and restart its Edu MCP server before switching brains.");
    const selection = await selectWorkspace(selector, env);
    use(selection.locations);
    switched = true;
    workspace = selection.root ?? "global";
    const agent = selection.root ? (await listWorkspaces(env)).find((w) => w.root === selection.root)?.agent : void 0;
    return `Active workspace: ${selection.label}${agent ? ` (agent ${agent})` : ""} \xB7 brain ${selection.locations[0].root}`;
  });
  const cliIds = z2.enum(["claude", "codex", "pi", "opencode", "agy"]);
  const autonomy = z2.enum(["readonly", "ask", "auto", "full"]);
  register("edu_crew_dispatch", "Run a crew job on a coding CLI. mode pane: visible herdr pane, headless if herdr is unreachable", {
    cli: cliIds,
    task: z2.string().min(1),
    mode: z2.enum(["headless", "pane"]).optional(),
    cwd: z2.string().optional(),
    autonomy: autonomy.optional(),
    maxTokens: tokenLimit
  }, async ({ cli, task, mode, cwd, autonomy: selectedAutonomy }) => {
    const job = await crew.dispatch({ cli, task, mode, cwd, autonomy: selectedAutonomy });
    return JSON.stringify(job);
  });
  register("edu_crew_status", "List crew jobs or show one", {
    jobId: z2.string().optional(),
    maxTokens: tokenLimit
  }, async ({ jobId }) => JSON.stringify(await crew.status(jobId)));
  register("edu_crew_result", "Wait for and read a crew job result", {
    jobId: z2.string().min(1),
    waitSeconds: z2.number().nonnegative().optional(),
    maxTokens: tokenLimit
  }, async ({ jobId, waitSeconds }) => JSON.stringify(await crew.result(jobId, waitSeconds ?? 0)));
  register("edu_crew_artifact", "Page a crew job's sanitized output or summary; continue with nextOffset until null", {
    jobId: z2.string().min(1),
    kind: z2.enum(["output", "summary"]),
    offset: optionalInt(0),
    maxBytes: optionalInt(1, 4096),
    maxTokens: optionalInt(100, 2e4)
  }, async ({ jobId, kind, offset, maxBytes, maxTokens }) => {
    const limit = maxTokens ?? 800;
    let pageBytes = Math.min(maxBytes ?? 1e3, 4096);
    while (true) {
      const page = JSON.stringify(await crew.store.artifact(jobId, kind, offset, pageBytes));
      if (estimateTokens(page) <= limit) return page;
      if (pageBytes <= 4) throw new Error("Artifact page metadata exceeds maxTokens");
      pageBytes = Math.max(4, Math.floor(pageBytes / 2));
    }
  });
  register("edu_orchestrate", "Start a detached orchestration (visible spec and crew job)", {
    goal: z2.string().min(1),
    playbook: z2.string().optional(),
    mode: z2.enum(["solo", "crew"]).optional(),
    autoApprove: z2.boolean().optional(),
    maxTokens: tokenLimit
  }, async ({ goal, playbook, mode, autoApprove }) => {
    const job = await crew.orchestrate({ goal, playbook, mode, autoApprove });
    const deadline = Date.now() + 6e4;
    let current = job;
    while (!current.specPath && !["done", "failed", "cancelled"].includes(current.status) && Date.now() < deadline) {
      await new Promise((resolve2) => setTimeout(resolve2, 250));
      current = await crew.status(job.id);
    }
    return JSON.stringify({ jobId: job.id, status: current.status, specPath: current.specPath, outcome: current.outcome, verificationSummary: current.verificationSummary });
  });
  register("edu_crew_approve", "Approve or reject a pending orchestration spec", {
    jobId: z2.string().min(1),
    approve: z2.boolean(),
    maxTokens: tokenLimit
  }, async ({ jobId, approve }) => JSON.stringify(await crew.approve(jobId, approve)));
  register("edu_crew_review", "Read-only review by a different available CLI", {
    cli: cliIds.optional(),
    base: z2.string().optional(),
    maxTokens: tokenLimit
  }, async ({ cli, base }) => JSON.stringify(await crew.review({ cli, base, callerCli: detectCallerCli(process.env, server.server.getClientVersion()?.name) })));
  const tools = listed.map(({ name, description, inputSchema, annotations }) => {
    const { $schema: _schemaUrl, ...schema } = z2.toJSONSchema(inputSchema, { target: "draft-7", io: "input" });
    return { name, description, inputSchema: schema, ...annotations ? { annotations } : {} };
  });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
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

export {
  withHostLock,
  createEduMcpServer
};
//# sourceMappingURL=chunk-KDOGZZUY.js.map