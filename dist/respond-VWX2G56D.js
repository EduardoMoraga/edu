import {
  buildContext
} from "./chunk-MYNTXVD4.js";
import "./chunk-Z3A63UQL.js";
import "./chunk-SLMZCFBQ.js";
import "./chunk-V372C4AW.js";

// src/chat/respond.ts
import { readFile } from "fs/promises";
import { join } from "path";
var ROUTING_RULE = "If the user asks for work that should change files or needs a multi-step team, reply with exactly one line `TASK: <the goal, restated precisely>` and nothing else. Otherwise answer directly and concisely in the user's language, citing note ids like [[D-\u2026]] and stating claim bands.";
var CHAT_AGENT = "edu";
function contractCore(source) {
  const marked = /<!-- edu:core -->([\s\S]*?)<!-- \/edu:core -->/.exec(source)?.[1];
  return (marked ?? source.split("<!-- edu:extended -->", 1)[0] ?? source).trim();
}
function promptFor(message, history) {
  const turns = history.turns.slice(-6);
  return [...turns.map((turn) => `${turn.role === "user" ? "User" : "Edu"}: ${turn.content}`), `User: ${message}`].join("\n\n");
}
async function respond(options) {
  const { message, history, config, brain, engines, cwd, onEvent, signal } = options;
  const contractPath = options.contractPath ?? join(cwd, ".edu", "EDU.md");
  const [pack, contract] = await Promise.all([
    buildContext(brain, { query: message, budgetTokens: config.context.budgetTokens }, { eduMdPath: contractPath }),
    readFile(contractPath, "utf8")
  ]);
  const at = () => (/* @__PURE__ */ new Date()).toISOString();
  const noteIds = [...new Set(pack.sections.flatMap((section) => section.noteIds))];
  await onEvent({ type: "brain.recall", agentId: CHAT_AGENT, noteIds, at: at() });
  await onEvent({ type: "agent.spawn", agentId: CHAT_AGENT, role: "lead", cli: config.defaultCli, task: message, at: at() });
  await onEvent({ type: "agent.status", agentId: CHAT_AGENT, status: "running", at: at() });
  const systemPrompt = [contractCore(contract), pack.text, ROUTING_RULE, options.forceChat ? "For this /ask turn, answer directly; do not use TASK routing." : ""].filter(Boolean).join("\n\n");
  const pending = [];
  let output = "";
  let sessionId;
  let ended = false;
  let ok = true;
  try {
    for await (const event of engines(config.defaultCli).run({
      cli: config.defaultCli,
      prompt: promptFor(message, history),
      systemPrompt,
      cwd,
      autonomy: "readonly",
      resumeSessionId: history.sessionId,
      signal
    }, CHAT_AGENT)) {
      if (event.type === "agent.text") output += event.text;
      else if (event.type === "agent.end") {
        ended = true;
        ok = event.ok;
        sessionId = event.sessionId;
      } else pending.push(event);
    }
    const text = output.trim();
    if (!ok) throw new Error("Edu chat engine failed");
    if (!text) throw new Error("Edu chat engine returned no answer");
    await onEvent({ type: "agent.text", agentId: CHAT_AGENT, text, at: at() });
    for (const event of pending) await onEvent(event);
    await onEvent({ type: "agent.end", agentId: CHAT_AGENT, ok: true, summary: text, ...sessionId ? { sessionId } : {}, at: at() });
    history.turns.push({ role: "user", content: message }, { role: "assistant", content: text });
    history.turns.splice(0, Math.max(0, history.turns.length - 6));
    if (sessionId) history.sessionId = sessionId;
    const task = !options.forceChat && /^TASK: ([^\r\n]+)$/.exec(text);
    return task ? { kind: "task", goal: task[1].trim() } : { kind: "chat", text };
  } catch (error) {
    for (const event of pending) await onEvent(event);
    await onEvent({ type: "agent.end", agentId: CHAT_AGENT, ok: false, summary: error instanceof Error ? error.message : String(error), ...ended && sessionId ? { sessionId } : {}, at: at() });
    throw error;
  }
}
export {
  respond
};
//# sourceMappingURL=respond-VWX2G56D.js.map