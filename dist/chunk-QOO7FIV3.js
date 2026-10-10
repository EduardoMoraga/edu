import {
  roleIcon
} from "./chunk-KP6K4SHS.js";

// src/cli/run/plain.ts
var oneLine = (text, max = 160) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
};
function createPlainFormatter(glyphs) {
  const roles = /* @__PURE__ */ new Map();
  const who = (agentId) => {
    if (!agentId) return "";
    const role = roles.get(agentId) ?? agentId;
    return `${roleIcon(role, glyphs)} ${role} `;
  };
  return (event) => {
    switch (event.type) {
      case "run.start":
        return `${glyphs.roles.lead} run ${event.runId} ${glyphs.sep} ${event.mode} ${glyphs.sep} ${oneLine(event.goal)}`;
      case "agent.spawn":
        roles.set(event.agentId, event.role);
        return `${who(event.agentId)}${glyphs.sep} ${event.cli}${event.model ? `/${event.model}` : ""} ${glyphs.arrow} ${oneLine(event.task)}`;
      case "agent.status":
        return event.status === "running" ? void 0 : `${who(event.agentId)}${glyphs.status[event.status]} ${event.status}`;
      case "agent.text":
        return event.text.trim() ? `${who(event.agentId)}${oneLine(event.text)}` : void 0;
      case "tool.call":
        return `${who(event.agentId)}${glyphs.arrow} ${event.tool} ${oneLine(event.input, 80)}`;
      case "tool.result":
        return `${who(event.agentId)}  ${event.ok ? glyphs.ok : glyphs.fail} ${oneLine(event.output, 80)}`;
      case "approval.request":
        return `${who(event.agentId)}${glyphs.approval} approval: ${oneLine(event.title)}`;
      case "approval.resolve":
        return `${glyphs.approval} ${event.approved ? "approved" : "rejected"} (${event.by})`;
      case "brain.recall":
        return event.noteIds.length ? `${glyphs.brain} recalled ${event.noteIds.join(", ")}` : void 0;
      case "brain.learn":
        return `${glyphs.brain} learned ${event.kind}: ${oneLine(event.title)}`;
      case "agent.end":
        return `${who(event.agentId)}${event.ok ? glyphs.ok : glyphs.fail} ${oneLine(event.summary)}`;
      case "error":
        return `${glyphs.fail} ${who(event.agentId)}${oneLine(event.message)}`;
      case "verify.result":
        return `${event.ok ? glyphs.ok : glyphs.fail} verify ${event.kind}${event.checkId ? ` ${event.checkId}` : ""}: ${oneLine(event.output)}`;
      case "failure.attribution":
        return `${glyphs.fail} attribution ${event.failureType}: ${oneLine(event.observed)}`;
      case "intervention":
        return `${glyphs.approval} intervention ${oneLine(event.action)}${event.avoidable ? ` (avoidable: ${event.harnessGap})` : ""}`;
      case "outcome":
        return `${glyphs.brain} outcome ${event.label}`;
      case "run.end":
        return `${event.ok ? glyphs.ok : glyphs.fail} run ${event.ok ? "finished" : "failed"}: ${oneLine(event.summary)}`;
      default:
        return void 0;
    }
  };
}

export {
  createPlainFormatter
};
//# sourceMappingURL=chunk-QOO7FIV3.js.map