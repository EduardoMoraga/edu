import {
  spawnCli
} from "./chunk-B5FNIIOI.js";

// src/engine/process.ts
import { access } from "fs/promises";
import { constants } from "fs";
import { delimiter, join } from "path";
import { StringDecoder } from "string_decoder";
var MAX_LINE_BYTES = 1024 * 1024;
var STDERR_TAIL_BYTES = 8 * 1024;
async function binaryAvailable(binary) {
  const pathValue = process.env.PATH ?? "";
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      try {
        await access(join(dir, `${binary}${extension}`), process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
      }
    }
  }
  return false;
}
function killProcessGroup(child, signal = "SIGTERM") {
  if (child.pid === void 0) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
    }
  }
}
function errorEvent(agentId, message) {
  return { type: "error", agentId, message, at: (/* @__PURE__ */ new Date()).toISOString() };
}
async function* runJsonlProcess(spec, cwd, agentId, parser, signal, finalize) {
  let child;
  try {
    child = spawnCli(spec.command, spec.args, { cwd, detached: process.platform !== "win32", stdio: [spec.stdin === void 0 ? "ignore" : "pipe", "pipe", "pipe"] });
    if (spec.stdin !== void 0) {
      child.stdin?.on("error", () => void 0);
      child.stdin?.end(spec.stdin);
    }
  } catch (error) {
    yield errorEvent(agentId, `Unable to start ${spec.command}: ${String(error)}`);
    return;
  }
  let stderrTail = "";
  let spawnFailure;
  let closed = false;
  let terminationRequested = false;
  let escalationTimer;
  let escalationPromise;
  let resolveEscalation;
  let resolveClose;
  const closePromise = new Promise((resolve) => {
    resolveClose = resolve;
  });
  child.once("close", (code) => {
    closed = true;
    if (!terminationRequested && escalationTimer) clearTimeout(escalationTimer);
    resolveClose(code);
  });
  child.once("error", (error) => {
    spawnFailure = error;
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
  });
  const abort = () => {
    terminationRequested = true;
    killProcessGroup(child, "SIGTERM");
    if (!escalationTimer) {
      escalationPromise = new Promise((resolve) => {
        resolveEscalation = resolve;
      });
      escalationTimer = setTimeout(() => {
        killProcessGroup(child, "SIGKILL");
        resolveEscalation();
      }, 250);
    }
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  try {
    const decoder = new StringDecoder("utf8");
    const parseContext = { agentId };
    let pending = "";
    let pendingBytes = 0;
    let dropping = false;
    try {
      if (child.stdout) {
        for await (const chunk of child.stdout) {
          const decoded = decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          for (const char of decoded) {
            if (char === "\n") {
              if (!dropping) {
                const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
                if (line.length) yield* parser(line, parseContext);
              }
              pending = "";
              pendingBytes = 0;
              dropping = false;
            } else if (!dropping) {
              pending += char;
              pendingBytes += Buffer.byteLength(char, "utf8");
              if (pendingBytes > MAX_LINE_BYTES) {
                dropping = true;
                pending = "";
                yield errorEvent(agentId, `Dropped JSONL line exceeding ${MAX_LINE_BYTES} bytes`);
              }
            }
          }
        }
      }
      const final = decoder.end();
      if (!dropping && (pending || final)) {
        pending += final;
        pendingBytes += Buffer.byteLength(final, "utf8");
        if (pendingBytes > MAX_LINE_BYTES) yield errorEvent(agentId, `Dropped JSONL line exceeding ${MAX_LINE_BYTES} bytes`);
        else if (pending.trim()) yield* parser(pending, parseContext);
      }
    } catch (error) {
      yield errorEvent(agentId, `Failed reading ${spec.command} output: ${String(error)}`);
    }
    const exitCode = await closePromise;
    if (spawnFailure) yield errorEvent(agentId, `Unable to start ${spec.command}: ${spawnFailure.message}`);
    else if (signal?.aborted) yield errorEvent(agentId, "Process cancelled");
    else if (exitCode !== 0) {
      yield errorEvent(agentId, `${spec.command} exited with code ${String(exitCode)}${stderrTail ? `: ${stderrTail.trim()}` : ""}`);
    } else if (finalize) {
      yield* finalize(exitCode, parseContext);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!closed) {
      abort();
      await Promise.race([closePromise, new Promise((resolve) => setTimeout(resolve, 1e3))]);
    }
    if (terminationRequested && escalationPromise) await escalationPromise;
    else if (escalationTimer) clearTimeout(escalationTimer);
  }
}

// src/engine/adapter.ts
function makeEngine(cli, binary, build, parser) {
  return {
    cli,
    available: () => binaryAvailable(binary),
    run: (req, agentId) => runJsonlProcess(build(req), req.cwd, agentId, parser, req.signal)
  };
}

// src/engine/autonomy.ts
var AUTONOMY_FLAGS = {
  claude: {
    readonly: ["--permission-mode", "plan"],
    ask: ["--permission-mode", "default"],
    auto: ["--permission-mode", "acceptEdits"],
    full: ["--permission-mode", "bypassPermissions"]
  },
  codex: {
    readonly: ["-s", "read-only"],
    ask: ["-s", "workspace-write"],
    auto: ["-s", "workspace-write"],
    full: ["-s", "danger-full-access"]
  },
  pi: { readonly: [], ask: [], auto: [], full: [] },
  opencode: { readonly: [], ask: [], auto: [], full: [] },
  agy: { readonly: [], ask: [], auto: [], full: ["--dangerously-skip-permissions"] }
};
function autonomyFlags(cli, autonomy) {
  return [...AUTONOMY_FLAGS[cli][autonomy]];
}

// src/engine/parse.ts
function eventAt(ctx) {
  return ctx.at ?? (/* @__PURE__ */ new Date()).toISOString();
}
function parseJson(line) {
  try {
    const value = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
function str(value) {
  return typeof value === "string" ? value : void 0;
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function makeUsage(ctx, values) {
  const pick = (...keys) => {
    for (const key of keys) {
      const found = num(values[key]);
      if (found !== void 0) return found;
    }
    return void 0;
  };
  const usage = {
    inputTokens: pick("input_tokens", "inputTokens", "prompt_tokens", "input") ?? 0,
    outputTokens: pick("output_tokens", "outputTokens", "completion_tokens", "output") ?? 0
  };
  const cacheReadTokens = pick("cache_read_input_tokens", "cached_input_tokens", "cache_read_tokens", "cacheReadTokens", "cacheRead");
  const cacheWriteTokens = pick("cache_creation_input_tokens", "cache_write_tokens", "cache_write_input_tokens", "cacheWriteTokens", "cacheWrite");
  const costUsd = pick("cost_usd", "costUsd", "total_cost_usd", "cost");
  if (cacheReadTokens !== void 0) usage.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== void 0) usage.cacheWriteTokens = cacheWriteTokens;
  if (costUsd !== void 0) usage.costUsd = costUsd;
  return [{ type: "usage", agentId: ctx.agentId, usage, at: eventAt(ctx) }];
}
function textEvent(ctx, text, thinking = false) {
  return { type: thinking ? "agent.thinking" : "agent.text", agentId: ctx.agentId, text, at: eventAt(ctx) };
}
function endEvent(ctx, ok = true, summary = "", sessionId) {
  const id = sessionId ?? ctx.sessionId;
  return { type: "agent.end", agentId: ctx.agentId, ok, summary, ...id ? { sessionId: id } : {}, at: eventAt(ctx) };
}
function toolCall(ctx, name, input, callId) {
  return {
    type: "tool.call",
    agentId: ctx.agentId,
    tool: name,
    callId: callId ?? `${ctx.agentId}-${name}-${eventAt(ctx)}`,
    input: typeof input === "string" ? input : JSON.stringify(input ?? {}),
    at: eventAt(ctx)
  };
}
function toolResult(ctx, output, callId, ok = true) {
  return {
    type: "tool.result",
    agentId: ctx.agentId,
    callId: callId ?? `${ctx.agentId}-tool-${eventAt(ctx)}`,
    ok,
    output: typeof output === "string" ? output : JSON.stringify(output ?? ""),
    at: eventAt(ctx)
  };
}

// src/engine/codex.ts
var SYSTEM_PROMPT_SEPARATOR = "\n\n--- System instructions ---\n";
function buildCodexArgv(req) {
  const prompt = req.systemPrompt ? `${req.systemPrompt}${SYSTEM_PROMPT_SEPARATOR}${req.prompt}` : req.prompt;
  const args = ["exec", "--json", ...autonomyFlags("codex", req.autonomy), "--skip-git-repo-check"];
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("resume", req.resumeSessionId);
  return { command: "codex", args, stdin: prompt };
}
function parseLine(line, ctx) {
  const data = parseJson(line);
  if (!data) return [];
  const type = str(data.type) ?? "";
  if (type === "thread.started") {
    ctx.sessionId = str(data.thread_id) ?? ctx.sessionId;
    return [];
  }
  const item = data.item && typeof data.item === "object" ? data.item : data;
  const itemType = str(item.type) ?? type;
  const itemId = str(item.id) ?? str(item.call_id);
  if (type === "item.started" || type === "item.completed") {
    if (itemType === "agent_message" || itemType === "message") {
      return type === "item.completed" && typeof item.text === "string" ? [textEvent(ctx, item.text)] : [];
    }
    if (itemType === "reasoning") {
      const text = str(item.text) ?? str(item.summary);
      return type === "item.completed" && text !== void 0 ? [textEvent(ctx, text, true)] : [];
    }
    if (["command_execution", "function_call", "mcp_tool_call", "tool_call"].includes(itemType)) {
      if (type === "item.started") return [toolCall(ctx, str(item.name) ?? str(item.command) ?? itemType, item.arguments ?? item.input ?? item.command, itemId)];
      return [toolResult(ctx, item.output ?? item.result ?? item.aggregated_output, itemId, item.status !== "failed")];
    }
  }
  if (type === "turn.completed" || type === "turn.failed") {
    const events = data.usage && typeof data.usage === "object" ? makeUsage(ctx, data.usage) : [];
    events.push(endEvent(ctx, type !== "turn.failed", str(data.error) ?? "", str(data.thread_id)));
    return events;
  }
  if (type === "response.output_text.delta" && typeof data.delta === "string") return [textEvent(ctx, data.delta)];
  if (type === "response.reasoning_summary_text.delta" && typeof data.delta === "string") return [textEvent(ctx, data.delta, true)];
  return [];
}
var codexEngine = makeEngine("codex", "codex", buildCodexArgv, parseLine);

// src/engine/agy.ts
function buildAgyArgv(req) {
  const prompt = req.systemPrompt ? `${req.systemPrompt}${SYSTEM_PROMPT_SEPARATOR}${req.prompt}` : req.prompt;
  const args = ["-p", prompt, "--output-format", "stream-json", ...autonomyFlags("agy", req.autonomy)];
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("--conversation", req.resumeSessionId);
  return { command: "agy", args };
}
function parseLine2(line, ctx) {
  const data = parseJson(line);
  if (!data) return [];
  const event = str(data.event) ?? "";
  const session = str(data.conversation_id);
  if (session) ctx.sessionId = session;
  if (event === "step_update") {
    const step = data.step_update && typeof data.step_update === "object" ? data.step_update : {};
    const stepSession = str(step.conversation_id);
    if (stepSession) ctx.sessionId = stepSession;
    if (step.step_type === "agent_response" && typeof step.text_delta === "string") return [textEvent(ctx, step.text_delta)];
    if (step.step_type === "tool" && step.tool_info && typeof step.tool_info === "object") {
      const info = step.tool_info;
      const name = str(info.name) ?? "tool";
      const callId = `${ctx.sessionId ?? ctx.agentId}-tool-${String(step.step_index ?? "unknown")}`;
      const events = [toolCall(ctx, name, info.parameters ?? {}, callId)];
      events.push(toolResult(ctx, info.output ?? info.error, callId, info.error === void 0));
      return events;
    }
    return [];
  }
  if (event === "result") {
    const result = data.result && typeof data.result === "object" ? data.result : {};
    const resultSession = str(result.conversation_id);
    if (resultSession) ctx.sessionId = resultSession;
    const events = result.usage && typeof result.usage === "object" ? makeUsage(ctx, result.usage) : [];
    const status = str(result.status) ?? "";
    events.push(endEvent(ctx, status === "SUCCESS", str(result.response) ?? str(result.error) ?? "", ctx.sessionId));
    return events;
  }
  return [];
}
var agyEngine = makeEngine("agy", "agy", buildAgyArgv, parseLine2);

// src/engine/claude.ts
function buildClaudeArgv(req) {
  const args = ["-p", "--output-format", "stream-json", "--verbose", ...autonomyFlags("claude", req.autonomy)];
  if (req.systemPrompt) args.push("--append-system-prompt", req.systemPrompt);
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("--resume", req.resumeSessionId);
  return { command: "claude", args, stdin: req.prompt };
}
function parseLine3(line, ctx) {
  const data = parseJson(line);
  if (!data) return [];
  const type = str(data.type);
  const session = str(data.session_id) ?? str(data.sessionId);
  if (type === "assistant") {
    const message = data.message;
    const content = Array.isArray(message?.content) ? message.content : [];
    return content.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const part = raw;
      if (part.type === "text" && typeof part.text === "string") return [textEvent(ctx, part.text)];
      if ((part.type === "thinking" || part.type === "redacted_thinking") && typeof part.thinking === "string") return [textEvent(ctx, part.thinking, true)];
      if (part.type === "tool_use") return [toolCall(ctx, str(part.name) ?? "tool", part.input, str(part.id))];
      return [];
    });
  }
  if (type === "user") {
    const message = data.message;
    const content = Array.isArray(message?.content) ? message.content : [];
    return content.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const part = raw;
      return part.type === "tool_result" ? [toolResult(ctx, part.content, str(part.tool_use_id), part.is_error !== true)] : [];
    });
  }
  if (type === "result") {
    const events = data.usage && typeof data.usage === "object" ? makeUsage(ctx, { ...data.usage, total_cost_usd: data.total_cost_usd }) : typeof data.total_cost_usd === "number" ? makeUsage(ctx, { cost_usd: data.total_cost_usd }) : [];
    events.push(endEvent(ctx, !String(data.subtype ?? "").includes("error"), str(data.result) ?? "", session));
    return events;
  }
  if (type === "system" && typeof data.session_id === "string") {
    ctx.sessionId = data.session_id;
  }
  return [];
}
var claudeEngine = makeEngine("claude", "claude", buildClaudeArgv, parseLine3);

// src/engine/opencode.ts
function buildOpencodeArgv(req) {
  const args = ["run", "--format", "json", "--thinking", "--dir", req.cwd, ...autonomyFlags("opencode", req.autonomy)];
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("--session", req.resumeSessionId);
  args.push(req.prompt);
  return { command: "opencode", args };
}
function parseLine4(line, ctx) {
  const data = parseJson(line);
  if (!data) return [];
  const type = str(data.type) ?? "";
  const session = str(data.sessionID) ?? str(data.sessionId) ?? str(data.session_id);
  if (session) ctx.sessionId = session;
  const part = data.part && typeof data.part === "object" ? data.part : data;
  if (type === "text" && typeof part.text === "string") {
    ctx.summary = part.text;
    return [textEvent(ctx, part.text)];
  }
  if (part.type === "reasoning" && typeof part.text === "string") return [textEvent(ctx, part.text, true)];
  if (part.type === "tool") {
    const state = part.state && typeof part.state === "object" ? part.state : {};
    const callId = str(part.callID) ?? str(part.id);
    if (type === "tool_use" && (state.status === "completed" || state.status === "error")) {
      return [
        toolCall(ctx, str(part.tool) ?? "tool", state.input ?? {}, callId),
        toolResult(ctx, state.output ?? state.error, callId, state.status === "completed")
      ];
    }
    if (state.status === "completed" || state.status === "error") return [toolResult(ctx, state.output ?? state.error, callId, state.status === "completed")];
    return [toolCall(ctx, str(part.tool) ?? str(part.name) ?? "tool", state.input ?? part.input, callId)];
  }
  if (type === "step_finish" && part.type === "step-finish") {
    const tokens = part.tokens && typeof part.tokens === "object" ? part.tokens : {};
    const cache = tokens.cache && typeof tokens.cache === "object" ? tokens.cache : {};
    return makeUsage(ctx, {
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_read_tokens: cache.read,
      cache_write_tokens: cache.write,
      cost_usd: part.cost
    });
  }
  return [];
}
function finalizeOpencode(ctx) {
  return [endEvent(ctx, true, ctx.summary ?? "", ctx.sessionId)];
}
var opencodeEngine = {
  cli: "opencode",
  available: () => binaryAvailable("opencode"),
  run: (req, agentId) => runJsonlProcess(
    buildOpencodeArgv(req),
    req.cwd,
    agentId,
    parseLine4,
    req.signal,
    (_exitCode, ctx) => finalizeOpencode(ctx)
  )
};

// src/engine/pi.ts
function buildPiArgv(req) {
  const args = ["-p", "--mode", "json", ...autonomyFlags("pi", req.autonomy)];
  if (req.systemPrompt) args.push("--append-system-prompt", req.systemPrompt);
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("--session", req.resumeSessionId);
  args.push(req.prompt);
  return { command: "pi", args };
}
function parseLine5(line, ctx) {
  const data = parseJson(line);
  if (!data) return [];
  const type = str(data.type) ?? "";
  if (type === "session") {
    ctx.sessionId = str(data.id) ?? ctx.sessionId;
    return [];
  }
  const session = str(data.session_id) ?? str(data.sessionId);
  if (session) ctx.sessionId = session;
  const message = data.message && typeof data.message === "object" ? data.message : void 0;
  const assistantEvent = data.assistantMessageEvent && typeof data.assistantMessageEvent === "object" ? data.assistantMessageEvent : void 0;
  if (type === "message_update" && assistantEvent) {
    const liveUsage = data.usage && typeof data.usage === "object" ? piUsage(data.usage) : void 0;
    if (liveUsage) ctx.usage = liveUsage;
    const delta = str(assistantEvent.delta);
    if (assistantEvent.type === "text_delta" && delta) return [textEvent(ctx, delta)];
    if (assistantEvent.type === "thinking_delta" && delta) return [textEvent(ctx, delta, true)];
    return [];
  }
  if (type === "tool_execution_start") {
    return [toolCall(ctx, str(data.toolName) ?? "tool", data.args, str(data.toolCallId))];
  }
  if (type === "tool_execution_end") {
    return [toolResult(ctx, data.result, str(data.toolCallId), data.isError !== true)];
  }
  if (type === "message_end" && message?.role === "assistant") {
    const content = Array.isArray(message.content) ? message.content : [];
    ctx.summary = content.flatMap((raw) => raw && typeof raw === "object" && raw.type === "text" ? [str(raw.text) ?? ""] : []).join("");
    if (message.stopReason === "error") ctx.ok = false;
    else if (message.stopReason) ctx.ok = true;
    const usageRaw = message.usage && typeof message.usage === "object" ? message.usage : void 0;
    const usage = usageRaw ? piUsage(usageRaw) : ctx.usage;
    ctx.usage = void 0;
    return usage ? [{ type: "usage", agentId: ctx.agentId, usage, at: ctx.at ?? (/* @__PURE__ */ new Date()).toISOString() }] : [];
  }
  if (type === "auto_retry_end" && data.success === false) {
    ctx.ok = false;
    return [];
  }
  if (type === "agent_settled") {
    const events = [];
    if (ctx.usage) events.push({ type: "usage", agentId: ctx.agentId, usage: ctx.usage, at: ctx.at ?? (/* @__PURE__ */ new Date()).toISOString() });
    ctx.usage = void 0;
    events.push(endEvent(ctx, data.aborted !== true && ctx.ok !== false, ctx.summary ?? "", ctx.sessionId));
    return events;
  }
  return [];
}
function piUsage(raw) {
  const cost = raw.cost && typeof raw.cost === "object" ? raw.cost : {};
  const event = makeUsage({ agentId: "", at: "" }, { ...raw, cost_usd: cost.total })[0];
  if (!event || event.type !== "usage") return { inputTokens: 0, outputTokens: 0 };
  return event.usage;
}
var piEngine = makeEngine("pi", "pi", buildPiArgv, parseLine5);

// src/engine/index.ts
var ENGINES = {
  claude: claudeEngine,
  codex: codexEngine,
  pi: piEngine,
  opencode: opencodeEngine,
  agy: agyEngine
};
function createEngine(cli) {
  return ENGINES[cli];
}
async function detectEngines() {
  const results = await Promise.all(Object.entries(ENGINES).map(async ([cli, engine]) => [cli, await engine.available()]));
  return results.filter(([, available]) => available).map(([cli]) => cli);
}

export {
  MAX_LINE_BYTES,
  binaryAvailable,
  runJsonlProcess,
  AUTONOMY_FLAGS,
  autonomyFlags,
  buildCodexArgv,
  parseLine,
  buildAgyArgv,
  parseLine2,
  buildClaudeArgv,
  parseLine3,
  buildOpencodeArgv,
  parseLine4,
  finalizeOpencode,
  buildPiArgv,
  parseLine5,
  createEngine,
  detectEngines
};
//# sourceMappingURL=chunk-Q7UWRSBU.js.map