import {
  killTree,
  trackChild
} from "./chunk-B7KZAX6U.js";
import {
  measuredEngine
} from "./chunk-5G4RNW33.js";
import {
  childEnv
} from "./chunk-6O2RRLWR.js";
import {
  spawnCli
} from "./chunk-KLV4TDB7.js";

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
var UNPARSED_TAIL_LINES = 5;
var UNPARSED_LINE_CHARS = 300;
function errorEvent(agentId, message) {
  return { type: "error", agentId, message, at: (/* @__PURE__ */ new Date()).toISOString() };
}
async function* runJsonlProcess(spec, cwd, agentId, parser, signal, finalize) {
  let child;
  try {
    child = spawnCli(spec.command, spec.args, { cwd, env: childEnv(spec.command, { EDU_CREW_JOB: agentId }), detached: process.platform !== "win32", stdio: [spec.stdin === void 0 ? "ignore" : "pipe", "pipe", "pipe"] });
    if (spec.stdin !== void 0) {
      child.stdin?.on("error", () => void 0);
      child.stdin?.end(spec.stdin);
    }
  } catch (error) {
    yield errorEvent(agentId, `Unable to start ${spec.command}: ${String(error)}`);
    return;
  }
  const untrack = trackChild(child);
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
    void killTree(child, "SIGTERM");
    if (!escalationTimer) {
      escalationPromise = new Promise((resolve) => {
        resolveEscalation = resolve;
      });
      escalationTimer = setTimeout(() => {
        void killTree(child, "SIGKILL").finally(resolveEscalation);
      }, 250);
    }
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  try {
    const decoder = new StringDecoder("utf8");
    const parseContext = { agentId };
    let ended = false;
    const unparsed = [];
    const parse = (line) => {
      const events = parser(line, parseContext);
      if (events.some((event) => event.type === "agent.end" || event.type === "run.end")) ended = true;
      if (!events.length && !line.trimStart().startsWith("{")) {
        unparsed.push(line.trim().slice(0, UNPARSED_LINE_CHARS));
        if (unparsed.length > UNPARSED_TAIL_LINES) unparsed.shift();
      }
      return events;
    };
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
                if (line.length) yield* parse(line);
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
        else if (pending.trim()) yield* parse(pending);
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
    } else if (!ended) {
      const detail = [parseContext.lastError, unparsed.join("\n"), stderrTail.trim()].filter(Boolean).join("\n");
      yield errorEvent(agentId, `${spec.command} exited without reporting a result${detail ? `: ${detail}` : ""}`);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!closed) {
      abort();
      await Promise.race([closePromise, new Promise((resolve) => setTimeout(resolve, 1e3))]);
    }
    if (terminationRequested && escalationPromise) await escalationPromise;
    else if (escalationTimer) clearTimeout(escalationTimer);
    untrack();
  }
}

// src/engine/autonomy.ts
var AUTONOMY_FLAGS = {
  claude: {
    readonly: ["--permission-mode", "plan"],
    ask: ["--permission-mode", "default"],
    // acceptEdits alone blocks shell tests; explicitly allow Bash for builder verification.
    auto: ["--permission-mode", "acceptEdits", "--allowedTools", "Bash"],
    full: ["--permission-mode", "bypassPermissions"]
  },
  codex: {
    readonly: ["-s", "read-only"],
    ask: ["-s", "read-only"],
    auto: ["-s", "workspace-write"],
    full: ["-s", "danger-full-access"]
  },
  pi: {
    readonly: ["--tools", "read,grep,find,ls"],
    ask: ["--tools", "read,grep,find,ls"],
    auto: [],
    full: []
  },
  opencode: { readonly: [], ask: [], auto: ["--auto"], full: ["--auto"] },
  agy: { readonly: [], ask: [], auto: [], full: ["--dangerously-skip-permissions"] }
};
var INTERACTIVE_OVERRIDES = {
  codex: {
    readonly: ["-s", "read-only", "-a", "never"],
    ask: ["-s", "workspace-write", "-a", "untrusted"],
    auto: ["-s", "workspace-write", "-a", "on-request"],
    full: ["-s", "danger-full-access", "-a", "never"]
  }
};
function autonomyFlags(cli, autonomy) {
  return [...AUTONOMY_FLAGS[cli][autonomy]];
}
function interactiveAutonomyFlags(cli, autonomy) {
  return [...INTERACTIVE_OVERRIDES[cli]?.[autonomy] ?? AUTONOMY_FLAGS[cli][autonomy]];
}
var READONLY_MECHANISM = {
  claude: "--permission-mode plan",
  codex: "-s read-only",
  pi: "--tools read,grep,find,ls"
};
function enforcesReadonly(cli) {
  return READONLY_MECHANISM[cli] !== void 0;
}
function engineCapabilities(cli) {
  const mechanism = READONLY_MECHANISM[cli];
  return {
    readonly: mechanism ? "enforced" : "unsupported",
    isolation: "host",
    ...mechanism ? { mechanism } : {},
    limitations: [...!mechanism ? ["Readonly enforcement is unsupported; shared-workspace steps run serially."] : [], "Host permission modes are not an Edu OS/network sandbox."]
  };
}

// src/engine/adapter.ts
function makeEngine(cli, binary, build, parser) {
  return measuredEngine({
    capabilities: engineCapabilities(cli),
    cli,
    available: () => binaryAvailable(binary),
    run: (req, agentId) => runJsonlProcess(build(req), req.cwd, agentId, (line, ctx) => parser(line, Object.assign(ctx, { cli })), req.signal)
  });
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
function combinePrompt(systemPrompt, task, alwaysLabel = false) {
  if (!systemPrompt) return alwaysLabel ? `## User task
${task}` : task;
  return `## System instructions
${systemPrompt}

## User task
${task}`;
}
function errorText(value) {
  if (typeof value === "string") return value || void 0;
  if (!value || typeof value !== "object") return void 0;
  const record = value;
  const data = record.data && typeof record.data === "object" ? record.data : {};
  return str(record.message) || str(data.message) || str(record.error) || str(record.name) || void 0;
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function makeUsage(ctx, values, inputSemantics = "inclusive-cache") {
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
  usage.known = {
    inputTokens: pick("input_tokens", "inputTokens", "prompt_tokens", "input") !== void 0,
    outputTokens: pick("output_tokens", "outputTokens", "completion_tokens", "output") !== void 0,
    cacheReadTokens: cacheReadTokens !== void 0,
    cacheWriteTokens: cacheWriteTokens !== void 0,
    costUsd: costUsd !== void 0
  };
  usage.raw = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ...cacheReadTokens === void 0 ? {} : { cacheReadTokens }, ...cacheWriteTokens === void 0 ? {} : { cacheWriteTokens }, ...costUsd === void 0 ? {} : { costUsd } };
  if (!usage.known.inputTokens) delete usage.raw.inputTokens;
  if (!usage.known.outputTokens) delete usage.raw.outputTokens;
  usage.inputSemantics = ctx.cli === "agy" ? "unknown" : inputSemantics;
  if (usage.inputSemantics === "exclusive-cache") {
    usage.inputTokens += (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
    usage.known.inputTokens &&= cacheReadTokens !== void 0 && cacheWriteTokens !== void 0;
  } else if (usage.inputSemantics === "unknown") usage.known.inputTokens = false;
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

// src/engine/agy.ts
function buildAgyArgv(req) {
  const prompt = combinePrompt(req.systemPrompt, req.prompt, true);
  const args = ["-p", prompt, "--output-format", "stream-json", ...autonomyFlags("agy", req.autonomy)];
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("--conversation", req.resumeSessionId);
  return { command: "agy", args };
}
function parseLine(line, ctx) {
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
      const callId = `${ctx.sessionId ?? ctx.agentId}-tool-${typeof step.step_index === "number" || typeof step.step_index === "string" ? step.step_index : "unknown"}`;
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
var agyEngine = makeEngine("agy", "agy", buildAgyArgv, parseLine);

// src/engine/claude.ts
function buildClaudeArgv(req) {
  const args = ["-p", "--output-format", "stream-json", "--verbose", ...autonomyFlags("claude", req.autonomy)];
  if (req.systemPrompt) args.push("--append-system-prompt", req.systemPrompt);
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("--resume", req.resumeSessionId);
  return { command: "claude", args, stdin: req.prompt };
}
function parseLine2(line, ctx) {
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
    const events = data.usage && typeof data.usage === "object" ? makeUsage(ctx, { ...data.usage, total_cost_usd: data.total_cost_usd }, "exclusive-cache") : typeof data.total_cost_usd === "number" ? makeUsage(ctx, { cost_usd: data.total_cost_usd }, "exclusive-cache") : [];
    const subtype = str(data.subtype);
    const failed = data.is_error === true || (subtype ?? "").includes("error");
    const errors = Array.isArray(data.errors) ? data.errors.map(errorText).filter(Boolean).join("; ") : "";
    events.push(endEvent(ctx, !failed, str(data.result) || errors || (failed ? `Claude ended with ${subtype ?? "an error"}` : ""), session));
    return events;
  }
  if (type === "system" && typeof data.session_id === "string") {
    ctx.sessionId = data.session_id;
  }
  return [];
}
var claudeEngine = makeEngine("claude", "claude", buildClaudeArgv, parseLine2);

// src/engine/codex.ts
function buildCodexArgv(req) {
  const prompt = combinePrompt(req.systemPrompt, req.prompt);
  const args = ["exec", "--json", ...autonomyFlags("codex", req.autonomy), "--skip-git-repo-check"];
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("resume", req.resumeSessionId);
  return { command: "codex", args, stdin: prompt };
}
function parseLine3(line, ctx) {
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
    const events = data.usage && typeof data.usage === "object" ? makeUsage(ctx, data.usage, "inclusive-cache") : [];
    const summary = type === "turn.failed" ? errorText(data.error) ?? ctx.lastError ?? "Codex turn failed" : "";
    events.push(endEvent(ctx, type !== "turn.failed", summary, str(data.thread_id)));
    return events;
  }
  if (type === "error") {
    ctx.lastError = errorText(data.message) ?? errorText(data.error) ?? ctx.lastError;
    return [];
  }
  if (type === "response.output_text.delta" && typeof data.delta === "string") return [textEvent(ctx, data.delta)];
  if (type === "response.reasoning_summary_text.delta" && typeof data.delta === "string") return [textEvent(ctx, data.delta, true)];
  return [];
}
var codexEngine = makeEngine("codex", "codex", buildCodexArgv, parseLine3);

// src/engine/opencode.ts
function buildOpencodeArgv(req) {
  const args = ["run", "--format", "json", "--thinking", ...autonomyFlags("opencode", req.autonomy)];
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("--session", req.resumeSessionId);
  args.push("--", combinePrompt(req.systemPrompt, req.prompt));
  return { command: "opencode", args };
}
function parseLine4(line, ctx) {
  const data = parseJson(line);
  if (!data) return [];
  const type = str(data.type) ?? "";
  const session = str(data.sessionID) ?? str(data.sessionId) ?? str(data.session_id);
  if (session) ctx.sessionId = session;
  const part = data.part && typeof data.part === "object" ? data.part : data;
  if (type === "error") {
    ctx.ok = false;
    ctx.lastError = errorText(data.error) ?? errorText(data.message) ?? "OpenCode reported an error";
    return [];
  }
  if (type === "text" && typeof part.text === "string") {
    ctx.summary = part.text;
    ctx.finished = true;
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
    ctx.finished = true;
    if (part.reason === "error") ctx.ok = false;
    const tokens = part.tokens && typeof part.tokens === "object" ? part.tokens : {};
    const cache = tokens.cache && typeof tokens.cache === "object" ? tokens.cache : {};
    const output = num(tokens.output);
    const reasoning = num(tokens.reasoning);
    return makeUsage({ ...ctx, cli: "opencode" }, {
      input_tokens: tokens.input,
      output_tokens: output === void 0 ? void 0 : output + (reasoning ?? 0),
      cache_read_tokens: cache.read,
      cache_write_tokens: cache.write,
      cost_usd: part.cost
    }, "exclusive-cache");
  }
  return [];
}
function finalizeOpencode(ctx) {
  const ok = ctx.ok !== false && ctx.finished === true;
  const summary = ok ? ctx.summary ?? "" : ctx.lastError ?? (ctx.finished ? "OpenCode step failed" : "OpenCode exited without producing a result");
  return [endEvent(ctx, ok, summary, ctx.sessionId)];
}
var opencodeEngine = measuredEngine({
  capabilities: engineCapabilities("opencode"),
  cli: "opencode",
  available: () => binaryAvailable("opencode"),
  run: (req, agentId) => runJsonlProcess(
    buildOpencodeArgv(req),
    req.cwd,
    agentId,
    (line, ctx) => parseLine4(line, Object.assign(ctx, { cli: "opencode" })),
    req.signal,
    (_exitCode, ctx) => finalizeOpencode(ctx)
  )
});

// src/engine/pi.ts
function buildPiArgv(req) {
  const args = ["-p", "--mode", "json", ...autonomyFlags("pi", req.autonomy)];
  if (req.systemPrompt) args.push("--append-system-prompt", req.systemPrompt);
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("--session", req.resumeSessionId);
  return { command: "pi", args, stdin: req.prompt };
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
    if (message.stopReason === "error") {
      ctx.ok = false;
      ctx.lastError = str(message.errorMessage) ?? ctx.lastError;
    } else if (message.stopReason) ctx.ok = true;
    const usageRaw = message.usage && typeof message.usage === "object" ? message.usage : void 0;
    const usage = usageRaw ? piUsage(usageRaw) : ctx.usage;
    ctx.usage = void 0;
    return usage ? [{ type: "usage", agentId: ctx.agentId, usage, at: ctx.at ?? (/* @__PURE__ */ new Date()).toISOString() }] : makeUsage(ctx, {}, "exclusive-cache");
  }
  if (type === "auto_retry_end" && data.success === false) {
    ctx.ok = false;
    ctx.lastError = str(data.finalError) ?? ctx.lastError;
    return [];
  }
  if (type === "agent_settled") {
    const events = [];
    if (ctx.usage) events.push({ type: "usage", agentId: ctx.agentId, usage: ctx.usage, at: ctx.at ?? (/* @__PURE__ */ new Date()).toISOString() });
    ctx.usage = void 0;
    const ok = data.aborted !== true && ctx.ok !== false;
    events.push(endEvent(ctx, ok, ctx.summary || (ok ? "" : ctx.lastError ?? (data.aborted === true ? "Pi run aborted" : "Pi run failed")), ctx.sessionId));
    return events;
  }
  return [];
}
function piUsage(raw) {
  const cost = raw.cost && typeof raw.cost === "object" ? raw.cost : {};
  const event = makeUsage({ agentId: "", at: "", cli: "pi" }, { ...raw, cost_usd: cost.total }, "exclusive-cache")[0];
  if (!event || event.type !== "usage") return { inputTokens: 0, outputTokens: 0, known: { inputTokens: false, outputTokens: false } };
  return event.usage;
}
var piEngine = makeEngine("pi", "pi", buildPiArgv, parseLine5);

// src/engine/fake.ts
var FakeEngine = class {
  constructor(script, delayMs = 0) {
    this.script = script;
    this.delayMs = delayMs;
  }
  script;
  delayMs;
  cli = "claude";
  /** A scripted replay runs no tools, so it can never write: readonly holds by construction. */
  capabilities = { readonly: "enforced", mechanism: "scripted replay runs no tools", isolation: "host", limitations: [] };
  async available() {
    return true;
  }
  async *run(_req, _agentId) {
    for (const event of this.script) {
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      yield structuredClone(event);
    }
  }
};
function demoScript() {
  const at = "2026-10-08T12:00:00.000Z";
  const events = [
    { type: "run.start", runId: "demo-001", goal: "Prepare a small, reviewed feature", mode: "crew", at },
    { type: "agent.spawn", agentId: "lead-1", role: "lead", cli: "claude", task: "Plan the implementation", at },
    { type: "agent.status", agentId: "lead-1", status: "running", at },
    { type: "agent.text", agentId: "lead-1", text: "I will inspect the API boundary, then split implementation and review.", at },
    { type: "brain.recall", agentId: "lead-1", noteIds: ["D-keep-adapters-small"], at },
    { type: "agent.spawn", agentId: "explorer-1", parentId: "lead-1", role: "explorer", cli: "codex", task: "Map the relevant call path", at },
    { type: "agent.text", agentId: "explorer-1", text: "The change is isolated behind one public interface.", at },
    { type: "agent.end", agentId: "explorer-1", ok: true, summary: "Mapped the interface and its caller.", sessionId: "fake-session-explorer", at },
    { type: "agent.spawn", agentId: "reviewer-1", parentId: "lead-1", role: "reviewer", cli: "pi", task: "Check the planned edge cases", at },
    { type: "agent.thinking", agentId: "reviewer-1", text: "Check cancellation, error propagation, and empty input.", at },
    { type: "agent.end", agentId: "reviewer-1", ok: true, summary: "No additional risks found.", sessionId: "fake-session-reviewer", at },
    { type: "agent.spawn", agentId: "builder-1", parentId: "lead-1", role: "builder", cli: "claude", model: "demo-model", task: "Implement the bounded change", at },
    { type: "tool.call", agentId: "builder-1", callId: "tool-1", tool: "read_file", input: '{"path":"src/example.ts"}', at },
    { type: "tool.result", agentId: "builder-1", callId: "tool-1", ok: true, output: "Read 42 lines.", at },
    { type: "agent.text", agentId: "builder-1", text: "Implementation and focused tests are complete.", at },
    { type: "usage", agentId: "builder-1", usage: { inputTokens: 1840, outputTokens: 520, costUsd: 0.0124 }, at },
    { type: "approval.request", agentId: "builder-1", approvalId: "approval-1", title: "Apply the planned file change?", detail: "This demo pauses before a mutating tool.", at },
    { type: "approval.resolve", approvalId: "approval-1", approved: true, by: "user", at },
    { type: "brain.learn", noteId: "L-check-empty-input", kind: "lesson", title: "Validate empty input at the boundary", at },
    { type: "agent.end", agentId: "builder-1", ok: true, summary: "Change implemented and tested.", sessionId: "fake-session-builder", at },
    { type: "agent.end", agentId: "lead-1", ok: true, summary: "Plan and delegation complete.", at },
    { type: "run.end", runId: "demo-001", ok: true, summary: "Demo crew completed successfully.", at }
  ];
  const base = new Date(at).getTime();
  return events.map((event, index) => ({ ...event, at: new Date(base + index * 450).toISOString() }));
}

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
  interactiveAutonomyFlags,
  enforcesReadonly,
  buildAgyArgv,
  parseLine,
  buildClaudeArgv,
  parseLine2,
  buildCodexArgv,
  parseLine3,
  buildOpencodeArgv,
  parseLine4,
  finalizeOpencode,
  buildPiArgv,
  parseLine5,
  FakeEngine,
  demoScript,
  createEngine,
  detectEngines
};
//# sourceMappingURL=chunk-BE3HXCZV.js.map