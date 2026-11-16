import {
  withHostLock
} from "./chunk-UPSPAYW3.js";
import {
  getGlyphs,
  renderStatusline
} from "./chunk-IK4YS5DS.js";
import {
  exists,
  lessonCount,
  openWorkspace
} from "./chunk-PAAE3O2O.js";
import {
  identityName
} from "./chunk-Z4DEDTJK.js";
import {
  autoMaintain
} from "./chunk-ST6WY46H.js";

// src/cli/hooks.ts
import { createHash } from "crypto";
import { join } from "path";

// src/cli/statusline.ts
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
function parseJsonObject(text) {
  if (!text.trim()) return void 0;
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
function ctxPercentFromClaude(input) {
  if (!input) return void 0;
  const direct = num(input.ctxPercent);
  if (direct !== void 0) return direct;
  const win = input.context_window;
  if (!isObject(win)) return void 0;
  const used = num(win.used_percentage);
  if (used !== void 0) return used;
  const size = num(win.context_window_size);
  if (!size || size <= 0) return void 0;
  const current = win.current_usage;
  if (isObject(current)) {
    const tokens = (num(current.input_tokens) ?? 0) + (num(current.cache_creation_input_tokens) ?? 0) + (num(current.cache_read_input_tokens) ?? 0);
    return tokens / size * 100;
  }
  const total = num(win.total_input_tokens);
  return total === void 0 ? void 0 : total / size * 100;
}
function claudeCwd(input) {
  if (!input) return void 0;
  const ws = input.workspace;
  if (isObject(ws) && typeof ws.current_dir === "string") return ws.current_dir;
  return typeof input.cwd === "string" ? input.cwd : void 0;
}
async function statuslineText(ctx, cwd, stdinText) {
  const input = parseJsonObject(stdinText);
  const { brain, primary } = await openWorkspace(ctx, claudeCwd(input) ?? cwd);
  const [stats, name] = await Promise.all([brain.stats(), identityName(primary.root)]);
  return renderStatusline(
    { brainNotes: stats.total, lessons: lessonCount(stats.byStatus), ctxPercent: ctxPercentFromClaude(input) },
    { glyphs: getGlyphs(ctx.env), name }
  );
}

// src/cli/hooks.ts
var str = (v) => typeof v === "string" && v.trim() ? v : void 0;
var clip = (text, max) => text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
var short = (id) => id.slice(0, 8);
async function safeHook(ctx, name, body) {
  try {
    await body();
  } catch (error) {
    ctx.err(`edu hook ${name}: ${error instanceof Error ? error.message : String(error)} (ignored)`);
  }
  ctx.setExitCode(0);
}
async function initializedWorkspace(ctx, cwd) {
  const ws = await openWorkspace(ctx, cwd);
  return await exists(join(ws.primary.root, "EDU.md")) ? ws : void 0;
}
var SESSION_BRIEF_TOKENS = 1500;
async function workspaceBrief(ctx, cwd) {
  const ws = await initializedWorkspace(ctx, cwd);
  if (!ws) return void 0;
  const { brief } = await import("./context-5G352ZUW.js");
  return { ws, text: await brief(ws.brain, SESSION_BRIEF_TOKENS, { eduMdPath: join(ws.primary.root, "EDU.md") }) };
}
var hostTag = (source, key) => `host:${source}:${key}`;
async function findHostSession(brain, tag) {
  return (await brain.list({ kind: "session" })).find((note) => note.meta.tags.includes(tag));
}
async function hostSession(root, brain, source, key, title, summary) {
  return withHostLock(root, source, key, async () => {
    const tag = hostTag(source, key);
    const note = await findHostSession(brain, tag) ?? await brain.write({ tier: "episodic", kind: "session", status: "open-session", title, body: "", source, tags: [tag] });
    if (summary === void 0 || note.meta.status !== "open-session") return note;
    return brain.closeSession(note.meta.id, summary);
  });
}
var HOSTS = {
  claude: { source: "claude", label: "Claude Code" },
  codex: { source: "codex", label: "Codex" },
  pi: { source: "pi", label: "Pi" }
};
async function sessionStart(ctx, cwd, options = {}) {
  const input = parseJsonObject(await ctx.readStdin(500));
  const result = await workspaceBrief(ctx, str(input?.cwd) ?? cwd);
  if (!result) return;
  const hostId = str(input?.session_id);
  const reported = str(input?.source);
  const host = HOSTS[options.host ?? ""] ?? (reported === "pi" ? HOSTS.pi : HOSTS.claude);
  const session = hostId && reported ? await hostSession(result.ws.primary.root, result.ws.brain, host.source, hostId, `${host.label} session ${short(hostId)}`) : void 0;
  const text = [result.text.trim(), session ? `Edu session id: ${session.meta.id}` : ""].filter(Boolean).join("\n\n");
  if (text) ctx.out(text);
}
async function agySessionStart(ctx, cwd) {
  let text = "";
  try {
    const input = parseJsonObject(await ctx.readStdin(500));
    const paths = Array.isArray(input?.workspacePaths) ? input.workspacePaths.filter((p) => typeof p === "string" && p.trim() !== "") : [];
    const result = await workspaceBrief(ctx, paths[0] ?? cwd);
    if (result) {
      const conversation = str(input?.conversationId);
      const session = conversation ? await hostSession(result.ws.primary.root, result.ws.brain, "agy", conversation, `Antigravity session ${short(conversation)}`) : void 0;
      text = [result.text.trim(), session ? `Edu session id: ${session.meta.id}` : ""].filter(Boolean).join("\n\n");
    }
  } finally {
    ctx.out(JSON.stringify(text ? { injectSteps: [{ systemMessage: { systemMessage: text } }] } : {}));
  }
}
async function sessionEnd(ctx, cwd) {
  const input = parseJsonObject(await ctx.readStdin(1e3));
  const sessionId = str(input?.session_id);
  if (!input || !sessionId) throw new Error("expected Claude SessionEnd JSON with session_id on stdin");
  const ws = await initializedWorkspace(ctx, str(input.cwd) ?? cwd);
  if (!ws) return;
  const host = str(input.source) === "pi" ? { source: "pi", label: "Pi" } : { source: "claude", label: "Claude Code" };
  const transcript = str(input.transcript_path);
  const reason = str(input.reason);
  const summary = [
    `${host.label} session ${sessionId} ended${reason ? ` (${reason})` : ""}.`,
    transcript ? `Transcript: ${transcript} (path only; its content was not read or summarized).` : "Transcript: not reported."
  ].join("\n");
  await hostSession(ws.primary.root, ws.brain, host.source, sessionId, `${host.label} session ${short(sessionId)}`, summary);
  await autoMaintain(ws.brain, ws.primary.root);
}
async function codexNotify(ctx, cwd, payload) {
  const input = parseJsonObject(payload ?? "");
  if (!input) throw new Error("expected Codex notify JSON as the last argument");
  if (input.type !== "agent-turn-complete") return;
  const ws = await initializedWorkspace(ctx, str(input.cwd) ?? cwd);
  if (!ws) return;
  const thread = str(input["thread-id"]) ?? str(input["turn-id"]) ?? "unknown";
  const messages = Array.isArray(input["input-messages"]) ? input["input-messages"].filter((m) => typeof m === "string") : [];
  const last = str(input["last-assistant-message"]);
  const summary = [
    `Codex turn completed (thread ${thread}).`,
    messages[0] ? `Asked: ${clip(messages[0], 200)}` : void 0,
    last ? `Answered: ${clip(last, 400)}` : void 0,
    "Captured: clipped question/answer only; nothing else was extracted."
  ].filter(Boolean).join("\n");
  const turn = str(input["turn-id"]) ?? createHash("sha256").update(JSON.stringify([thread, messages, last ?? ""])).digest("hex").slice(0, 16);
  await hostSession(ws.primary.root, ws.brain, "codex", `${thread}:${turn}`, `Codex turn ${short(thread)}`, summary);
  await autoMaintain(ws.brain, ws.primary.root);
}

export {
  statuslineText,
  safeHook,
  SESSION_BRIEF_TOKENS,
  workspaceBrief,
  sessionStart,
  agySessionStart,
  sessionEnd,
  codexNotify
};
//# sourceMappingURL=chunk-2J7JPHFE.js.map