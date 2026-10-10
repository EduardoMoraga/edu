import {
  eventProblem,
  isEduEvent,
  loadRun,
  parseRunJsonl,
  timedEvents
} from "./chunk-RRIXXRQM.js";
import {
  UNICODE_GLYPHS,
  createTheme,
  detectTheme,
  displayWidth,
  formatCost,
  formatDuration,
  formatPercent,
  formatTokens,
  getGlyphs,
  padEndDisplay,
  roleIcon,
  statusGlyph,
  truncate
} from "./chunk-KP6K4SHS.js";
import {
  fsCrewSource,
  watchCrew
} from "./chunk-CVB7YSGO.js";
import {
  fill,
  glyphSafe,
  langFromEnv,
  uiStrings
} from "./chunk-WRB5MXFD.js";
import {
  demoScript
} from "./chunk-Z4K2UNKS.js";

// src/tui/App.tsx
import { Box as Box10, useWindowSize } from "ink";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

// src/tui/components/AgentTree.tsx
import { Box, Text as Text2 } from "ink";

// src/tui/selectors.ts
function agentTree(state) {
  const children = /* @__PURE__ */ new Map();
  for (const id of state.order) {
    const a = state.agents[id];
    if (!a) continue;
    const parent = a.parentId && state.agents[a.parentId] && a.parentId !== a.id ? a.parentId : void 0;
    children.set(parent, [...children.get(parent) ?? [], id]);
  }
  const rows = [];
  const visit = (parent, depth, rails, seen) => {
    const ids = children.get(parent) ?? [];
    ids.forEach((id, i) => {
      const agent = state.agents[id];
      if (!agent || seen.has(id)) return;
      seen.add(id);
      const last = i === ids.length - 1;
      rows.push({ agent, depth, rails, last });
      visit(id, depth + 1, depth === 0 ? [] : [...rails, !last], seen);
    });
  };
  visit(void 0, 0, [], /* @__PURE__ */ new Set());
  return rows;
}
function focusedAgent(state) {
  const id = state.focus.agentId ?? state.order[0];
  return id ? state.agents[id] : void 0;
}
function selectAgent(state, agentId) {
  if (!state.agents[agentId]) return state;
  return { ...state, focus: { agentId, pinned: true } };
}
function moveFocus(state, delta) {
  const rows = agentTree(state);
  if (rows.length === 0) return state;
  const current = focusedAgent(state)?.id;
  const idx = Math.max(0, rows.findIndex((r) => r.agent.id === current));
  const next = rows[((idx + delta) % rows.length + rows.length) % rows.length];
  return next ? selectAgent(state, next.agent.id) : state;
}
function agentElapsed(agent, now) {
  const start = agent.startedAt ?? agent.spawnedAt;
  return Math.max(0, (agent.endedAt ?? now) - start);
}
function agentTokens(agent) {
  const u = agent.usage;
  return u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
}
function runTotals(state) {
  let tokens = 0;
  let cost;
  let partial = false;
  let running = 0;
  for (const id of state.order) {
    const a = state.agents[id];
    if (!a) continue;
    tokens += agentTokens(a);
    if (a.usage.costUsd !== void 0) cost = (cost ?? 0) + a.usage.costUsd;
    if (a.usage.costPartial) partial = true;
    if (a.status === "running" || a.status === "awaiting-approval") running += 1;
  }
  return { tokens, costUsd: cost, costPartial: partial, agents: state.order.length, running };
}
function runClis(state) {
  const out = [];
  for (const id of state.order) {
    const cli = state.agents[id]?.cli;
    if (cli && !out.includes(cli)) out.push(cli);
  }
  return out;
}

// src/tui/components/ui.tsx
import { Text } from "ink";
import { createContext, use } from "react";
import { jsx } from "react/jsx-runtime";
var EN = uiStrings("en");
var UiContext = createContext({ theme: createTheme(0), glyphs: UNICODE_GLYPHS, strings: uiStrings("en") });
function useUi() {
  const value = use(UiContext);
  return value.strings ? value : { ...value, strings: EN };
}
function Tx({ tone, bold, dim, italic, wrap, children }) {
  const { theme } = useUi();
  if (!theme.styled) return /* @__PURE__ */ jsx(Text, { wrap, children });
  return /* @__PURE__ */ jsx(Text, { color: tone ? theme.color(tone) : void 0, bold, dimColor: dim, italic, wrap, children });
}
function Line({ line }) {
  if (line.length === 0) return /* @__PURE__ */ jsx(Text, { children: " " });
  return /* @__PURE__ */ jsx(Text, { wrap: "truncate-end", children: line.map((s, i) => /* @__PURE__ */ jsx(Tx, { tone: s.tone, bold: s.bold, dim: s.dim, italic: s.italic, children: s.text }, i)) });
}
function Rule({ width }) {
  const { glyphs } = useUi();
  return /* @__PURE__ */ jsx(Tx, { tone: "border", wrap: "truncate-end", children: glyphs.rule.repeat(Math.max(0, width)) });
}
function Label({ children, active }) {
  return /* @__PURE__ */ jsx(Tx, { tone: active ? "accent" : "muted", bold: true, children });
}

// src/tui/components/AgentTree.tsx
import { jsx as jsx2, jsxs } from "react/jsx-runtime";
var STATUS_TONE = {
  queued: "muted",
  running: "accent",
  "awaiting-approval": "accent",
  done: "success",
  failed: "danger",
  cancelled: "muted"
};
function AgentTree({ state, layout, now, active }) {
  const { glyphs, strings } = useUi();
  const rows = agentTree(state);
  const selected = focusedAgent(state)?.id;
  const running = rows.filter((r) => r.agent.status === "running" || r.agent.status === "awaiting-approval").length;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: layout.treeWidth, flexShrink: 0, children: [
    /* @__PURE__ */ jsxs(Text2, { children: [
      /* @__PURE__ */ jsx2(Label, { active, children: strings.tree.title }),
      rows.length > 0 ? /* @__PURE__ */ jsx2(Tx, { tone: "muted", children: `  ${running}/${rows.length} ${strings.tree.active}` }) : null
    ] }),
    rows.length === 0 ? /* @__PURE__ */ jsx2(Tx, { dim: true, children: strings.tree.empty }) : null,
    rows.map((row) => /* @__PURE__ */ jsx2(
      TreeLine,
      {
        row,
        width: layout.treeWidth,
        now,
        selected: row.agent.id === selected,
        showTokens: layout.showTreeTokens,
        glyphs,
        queuedLabel: strings.tree.queued
      },
      row.agent.id
    ))
  ] });
}
function TreeLine({ row, width, now, selected, showTokens, glyphs, queuedLabel }) {
  const { agent } = row;
  const marker = selected ? `${glyphs.selected} ` : "  ";
  const rails = row.depth === 0 ? "" : row.rails.map((r) => r ? glyphs.tree.pipe : glyphs.tree.space).join("") + (row.last ? glyphs.tree.last : glyphs.tree.branch);
  const icon = padEndDisplay(roleIcon(agent.role, glyphs), 2);
  const glyph = statusGlyph(agent.status, glyphs);
  const time = agent.status === "queued" ? queuedLabel : formatDuration(agentElapsed(agent, now));
  const tokens = showTokens && agentTokens(agent) > 0 ? formatTokens(agentTokens(agent)) : "";
  const right = `${glyph} ${time.padStart(6)}${showTokens ? ` ${tokens.padStart(5)}` : ""}`;
  const room = width - displayWidth(marker) - displayWidth(rails) - 3 - displayWidth(right) - 2;
  const label = padEndDisplay(truncate(agent.role, Math.max(1, room), glyphs.ellipsis), Math.max(1, room));
  return /* @__PURE__ */ jsxs(Text2, { wrap: "truncate-end", children: [
    /* @__PURE__ */ jsx2(Tx, { tone: "accent", children: marker }),
    /* @__PURE__ */ jsx2(Tx, { tone: "border", children: rails }),
    /* @__PURE__ */ jsx2(Tx, { tone: selected ? "accent" : void 0, children: `${icon} ` }),
    /* @__PURE__ */ jsx2(Tx, { bold: selected, children: label }),
    /* @__PURE__ */ jsx2(Tx, { children: " " }),
    /* @__PURE__ */ jsx2(Tx, { tone: STATUS_TONE[agent.status], children: glyph }),
    /* @__PURE__ */ jsx2(Tx, { tone: "muted", children: right.slice(glyph.length) })
  ] });
}

// src/tui/components/ApprovalCard.tsx
import { Box as Box2 } from "ink";

// src/tui/wrap.ts
function wrapSegments(line, width, opts = {}) {
  const w = Math.max(1, Math.floor(width));
  const indent = Math.min(Math.max(0, opts.indent ?? 0), Math.floor(w / 2));
  const out = [];
  let current = [];
  let used = 0;
  let fresh = true;
  let first = true;
  const room = () => w - used;
  const newLine = () => {
    out.push(toLine(current));
    current = indent > 0 ? [{ text: " ".repeat(indent), style: {} }] : [];
    used = indent;
    fresh = true;
    first = false;
  };
  const put = (piece, cells) => {
    current.push(piece);
    used += cells;
    fresh = false;
  };
  for (const item of tokenize(line)) {
    if (item.kind === "break") {
      newLine();
      continue;
    }
    if (item.kind === "space") {
      if (fresh && !first) continue;
      const cells = displayWidth(item.piece.text);
      if (cells <= room()) put(item.piece, cells);
      else newLine();
      continue;
    }
    if (item.width > room() && !fresh) {
      trimTrailingSpace(current, (cells) => used -= cells);
      newLine();
    }
    if (item.width <= room()) {
      for (const p of item.pieces) put(p, displayWidth(p.text));
      continue;
    }
    for (const p of item.pieces) {
      for (const ch of p.text) {
        const cells = displayWidth(ch);
        if (cells > room() && !fresh) newLine();
        put({ text: ch, style: p.style }, cells);
      }
    }
  }
  out.push(toLine(current));
  return cap(out, w, opts);
}
function wrapPlain(text, width, opts = {}) {
  return wrapSegments([{ text }], width, opts).map((l) => l.map((s) => s.text).join(""));
}
function tokenize(line) {
  const items = [];
  let word = [];
  let wordWidth = 0;
  const flush = () => {
    if (word.length) items.push({ kind: "word", pieces: word, width: wordWidth });
    word = [];
    wordWidth = 0;
  };
  for (const segment of line) {
    const { text, ...style } = segment;
    for (const part of text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").split(/(\n| +)/)) {
      if (!part) continue;
      if (part === "\n") {
        flush();
        items.push({ kind: "break" });
      } else if (part.startsWith(" ")) {
        flush();
        items.push({ kind: "space", piece: { text: part, style } });
      } else {
        word.push({ text: part, style });
        wordWidth += displayWidth(part);
      }
    }
  }
  flush();
  return items;
}
function trimTrailingSpace(pieces, release) {
  while (pieces.length && /^ +$/.test(pieces[pieces.length - 1].text)) release(displayWidth(pieces.pop().text));
}
function toLine(pieces) {
  const merged = [];
  for (const { text, style } of pieces) {
    const last = merged[merged.length - 1];
    if (last && sameStyle(last, style)) last.text += text;
    else merged.push({ text, ...style });
  }
  const tail = merged[merged.length - 1];
  if (tail) {
    tail.text = tail.text.replace(/ +$/, "");
    if (!tail.text && merged.length > 1) merged.pop();
  }
  return merged.filter((s) => s.text !== "" || merged.length === 1);
}
function sameStyle(a, b) {
  return a.tone === b.tone && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic;
}
function cap(lines, width, opts) {
  const max = opts.maxLines;
  if (max === void 0 || lines.length <= max) return lines;
  const kept = lines.slice(0, Math.max(1, max));
  const ellipsis = opts.ellipsis ?? "\u2026";
  const last = kept[kept.length - 1];
  const budget = width - displayWidth(ellipsis);
  const clipped = [];
  let used = 0;
  for (const s of last) {
    let text = "";
    for (const ch of s.text) {
      const cells = displayWidth(ch);
      if (used + cells > budget) break;
      text += ch;
      used += cells;
    }
    if (text) clipped.push({ ...s, text });
    if (text.length < s.text.length) break;
  }
  const tail = clipped[clipped.length - 1];
  clipped.push({ ...tail ? { ...tail, text: "" } : {}, text: ellipsis });
  kept[kept.length - 1] = clipped;
  return kept;
}

// src/tui/lines.ts
var THINKING_LINES = 2;
function wrapText(text, width) {
  const w = Math.max(1, width);
  const out = [];
  for (const paragraph of text.replace(/\t/g, "  ").split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (displayWidth(candidate) <= w) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      line = "";
      let rest = word;
      while (displayWidth(rest) > w) {
        const [head, tail] = splitAt(rest, w);
        out.push(head);
        rest = tail;
      }
      line = rest;
    }
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out;
}
function logLines(entries, width, glyphs, strings = uiStrings("en")) {
  const lines = [];
  const w = Math.max(8, width);
  const push = (line, indent = 2) => lines.push(...wrapSegments(line, w, { indent, ellipsis: glyphs.ellipsis }));
  for (const entry of entries) {
    switch (entry.kind) {
      case "text":
        for (const l of wrapText(entry.text.trim(), w)) lines.push([{ text: l }]);
        break;
      case "thinking": {
        const wrapped = wrapText(entry.text.trim(), w - 2);
        const shown = wrapped.slice(0, THINKING_LINES);
        if (wrapped.length > THINKING_LINES) {
          const last = shown.length - 1;
          shown[last] = truncate(`${shown[last]} `, w - 2 - displayWidth(glyphs.ellipsis), "") + glyphs.ellipsis;
        }
        shown.forEach(
          (l, i) => lines.push([{ text: `${i === 0 ? glyphs.thinking : " "} ${l}`, dim: true, italic: true }])
        );
        break;
      }
      case "tool":
        lines.push(...wrapSegments(toolHeader(entry, glyphs), w, { indent: 2, maxLines: TOOL_LINES, ellipsis: glyphs.ellipsis }));
        lines.push(...wrapSegments(toolResult(entry, glyphs, strings), w, { indent: 4, maxLines: TOOL_LINES, ellipsis: glyphs.ellipsis }));
        break;
      case "approval":
        push(approvalLine(entry, glyphs, strings));
        break;
      case "error":
        push([
          { text: `${glyphs.fail} `, tone: "danger" },
          { text: entry.message.trim(), tone: "danger" }
        ]);
        break;
      case "verify":
        push([
          { text: `${entry.ok ? glyphs.ok : glyphs.fail} `, tone: entry.ok ? "success" : "danger", bold: true },
          { text: `${entry.kindName}${entry.checkId ? ` ${entry.checkId}` : ""}: `, bold: true },
          { text: oneLine(entry.output), dim: entry.ok }
        ]);
        break;
      case "attribution":
        push([{ text: `attribution [${entry.failureType}]: ${oneLine(entry.observed)}`, tone: "danger" }]);
        push([{ text: `  next: ${oneLine(entry.next)}`, dim: true }], 4);
        break;
      case "intervention":
        push([{ text: `intervention: ${entry.action}${entry.avoidable ? ` (avoidable; ${entry.harnessGap})` : ""}${entry.detail ? ` \u2014 ${oneLine(entry.detail)}` : ""}`, dim: !entry.avoidable }]);
        break;
      case "end":
        lines.push([]);
        push([
          { text: `${entry.ok ? glyphs.ok : glyphs.fail} `, tone: entry.ok ? "success" : "danger", bold: true },
          { text: entry.ok ? strings.log.done : strings.log.failed, bold: true },
          ...entry.summary ? [{ text: ` ${glyphs.sep} ${entry.summary.trim()}`, dim: true }] : []
        ]);
        break;
    }
  }
  return lines;
}
var TOOL_LINES = 2;
function toolHeader(entry, glyphs) {
  const input = oneLine(entry.input);
  return [
    { text: `${glyphs.arrow} `, tone: "accent" },
    { text: entry.tool, bold: true },
    ...input ? [{ text: ` ${input}`, dim: true }] : []
  ];
}
function toolResult(entry, glyphs, strings) {
  if (entry.state === "pending") return [{ text: `  ${glyphs.pending} ${strings.focus.toolRunning}`, dim: true }];
  const ok = entry.state === "ok";
  const output = entry.output ?? "";
  const nonEmpty = output.split(/\r?\n/).filter((l) => l.trim() !== "");
  const extra = nonEmpty.length > 1 ? ` (+${nonEmpty.length - 1} lines)` : "";
  const first = nonEmpty[0]?.trim() ?? (ok ? "ok" : "failed");
  return [
    { text: `  ${ok ? glyphs.ok : glyphs.fail} `, tone: ok ? "success" : "danger" },
    { text: first, dim: ok },
    ...extra ? [{ text: extra, dim: true }] : []
  ];
}
function approvalLine(entry, glyphs, strings) {
  if (entry.approved === void 0) {
    return [
      { text: `${glyphs.approval} `, tone: "accent" },
      { text: `${strings.log.approvalRequested} ${glyphs.sep} ${entry.title}`, tone: "accent" }
    ];
  }
  const verdict = `${entry.approved ? strings.log.approvedBy : strings.log.rejectedBy} ${entry.by ?? "user"}`;
  return [
    { text: `${entry.approved ? glyphs.ok : glyphs.fail} `, tone: entry.approved ? "success" : "danger" },
    { text: `${verdict} ${glyphs.sep} ${entry.title}`, dim: true }
  ];
}
function oneLine(text) {
  return text.replace(/\s+/g, " ").trim();
}
function splitAt(word, width) {
  let head = "";
  let used = 0;
  const chars2 = [...word];
  let i = 0;
  for (; i < chars2.length; i++) {
    const cw = displayWidth(chars2[i] ?? "");
    if (used + cw > width && head) break;
    head += chars2[i];
    used += cw;
  }
  return [head, chars2.slice(i).join("")];
}

// src/tui/components/ApprovalCard.tsx
import { Fragment, jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
var DETAIL_LINES = 8;
var TITLE_LINES = 3;
function approvalLayout(props, glyphs, strings = uiStrings("en")) {
  const { approval, role, width, queued, showDetail } = props;
  const a = strings.approval;
  const keys = [
    { text: "[y]", tone: "accent", bold: true },
    { text: ` ${a.approve}  ` },
    { text: "[n]", tone: "accent", bold: true },
    { text: ` ${a.reject}  ` },
    { text: "[d]", tone: "accent", bold: true },
    { text: ` ${a.details}` }
  ];
  const keysWidth = displayWidth(keys.map((s) => s.text).join(""));
  const head = [
    { text: `${glyphs.approval} ${a.title}  `, tone: "accent", bold: true },
    { text: `${roleIcon(role, glyphs)} ${role} ${glyphs.sep} ${approval.title}` },
    ...queued > 0 ? [{ text: `  +${queued} ${a.more}`, tone: "muted" }] : []
  ];
  const single = wrapSegments(head, width - keysWidth - 2);
  const keysInline = single.length === 1;
  const title = keysInline ? single : wrapSegments(head, width, { indent: 2, maxLines: TITLE_LINES, ellipsis: glyphs.ellipsis });
  const detail = showDetail ? wrapText(approval.detail, width - 2).slice(0, DETAIL_LINES) : [];
  return { title, keys, keysInline, detail, height: title.length + (keysInline ? 0 : 1) + detail.length };
}
function approvalCardHeight(props, glyphs, strings) {
  return approvalLayout(props, glyphs, strings).height;
}
function ApprovalCard(props) {
  const { glyphs, strings } = useUi();
  const { title, keys, keysInline, detail } = approvalLayout(props, glyphs, strings);
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", children: [
    keysInline ? /* @__PURE__ */ jsxs2(Box2, { justifyContent: "space-between", children: [
      /* @__PURE__ */ jsx3(Line, { line: title[0] }),
      /* @__PURE__ */ jsx3(Line, { line: keys })
    ] }) : /* @__PURE__ */ jsxs2(Fragment, { children: [
      title.map((l, i) => /* @__PURE__ */ jsx3(Line, { line: l }, i)),
      /* @__PURE__ */ jsx3(Line, { line: keys })
    ] }),
    detail.map((l, i) => /* @__PURE__ */ jsx3(Line, { line: [{ text: `  ${l}`, dim: true }] }, `d${i}`))
  ] });
}

// src/tui/components/BrainStrip.tsx
import { Box as Box3 } from "ink";
import { jsx as jsx4 } from "react/jsx-runtime";
var BRAIN_LINES = 2;
function brainLines(brain, override, width, glyphs, strings = uiStrings("en")) {
  const context = override ?? brain.context;
  const sep = ` ${glyphs.sep} `;
  const parts = [`${strings.brain.recalled} ${brain.recalledIds.length}`, learnedLabel(brain, strings)];
  if (context && context.budgetTokens > 0) {
    parts.push(fill(strings.brain.ctx, { pct: formatPercent(context.usedTokens / context.budgetTokens), budget: formatTokens(context.budgetTokens) }));
  }
  const latest = brain.learnings.at(-1);
  const line = [
    { text: `${glyphs.brain} `, tone: "accent" },
    { text: parts.join(sep), tone: "muted" },
    ...latest ? [{ text: `${sep}${latest.title}`, dim: true, italic: true }] : []
  ];
  return wrapSegments(line, width, { indent: 3, maxLines: BRAIN_LINES, ellipsis: glyphs.ellipsis });
}
function BrainStrip({ brain, context, width }) {
  const { glyphs, strings } = useUi();
  return /* @__PURE__ */ jsx4(Box3, { flexDirection: "column", width, children: brainLines(brain, context, width, glyphs, strings).map((line, i) => /* @__PURE__ */ jsx4(Line, { line }, i)) });
}
function learnedLabel(brain, strings) {
  const n = brain.learnings.length;
  if (n === 0) return strings.brain.nothing;
  const kinds = new Set(brain.learnings.map((l) => l.kind));
  if (kinds.size === 1 && strings.lang === "en") {
    const kind = brain.learnings[0].kind;
    const noun = kind === "canonical-proposal" ? "proposal" : kind;
    return `${strings.brain.learned} ${n} ${noun}${n === 1 ? "" : "s"}`;
  }
  if (kinds.size === 1) return `${strings.brain.learned} ${n} ${brain.learnings[0].kind}`;
  return `${strings.brain.learned} ${n} ${strings.brain.notes}`;
}

// src/tui/components/Composer.tsx
import { Box as Box4, Text as Text3 } from "ink";

// src/tui/editor.ts
var EMPTY_EDITOR = { text: "", cursor: 0 };
var chars = (text) => [...text];
function sanitize(input) {
  return input.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "");
}
function insert(state, input) {
  const add = chars(sanitize(input));
  if (!add.length) return state;
  const all = chars(state.text);
  all.splice(state.cursor, 0, ...add);
  return { text: all.join(""), cursor: state.cursor + add.length };
}
function backspace(state) {
  if (state.cursor === 0) return state;
  const all = chars(state.text);
  all.splice(state.cursor - 1, 1);
  return { text: all.join(""), cursor: state.cursor - 1 };
}
function deleteForward(state) {
  const all = chars(state.text);
  if (state.cursor >= all.length) return state;
  all.splice(state.cursor, 1);
  return { text: all.join(""), cursor: state.cursor };
}
function moveLeft(state) {
  return { ...state, cursor: Math.max(0, state.cursor - 1) };
}
function moveRight(state) {
  return { ...state, cursor: Math.min(chars(state.text).length, state.cursor + 1) };
}
function moveHome(state) {
  const { lineStart } = locate(state);
  return { ...state, cursor: lineStart };
}
function moveEnd(state) {
  const { lineStart, line } = locate(state);
  return { ...state, cursor: lineStart + line.length };
}
function moveLine(state, delta) {
  const lines = state.text.split("\n").map(chars);
  const { row, col } = locate(state);
  const target = row + delta;
  if (target < 0 || target >= lines.length) return void 0;
  let cursor = 0;
  for (let i = 0; i < target; i++) cursor += lines[i].length + 1;
  return { ...state, cursor: cursor + Math.min(col, lines[target].length) };
}
function locate(state) {
  const lines = state.text.split("\n").map(chars);
  let start = 0;
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    if (state.cursor <= start + line.length) return { row, col: state.cursor - start, lineStart: start, line };
    start += line.length + 1;
  }
  const last = lines[lines.length - 1] ?? [];
  return { row: lines.length - 1, col: last.length, lineStart: start - last.length - 1, line: last };
}
function composerView(state, width, maxRows) {
  const room = Math.max(2, width) - 1;
  const rows = [];
  let index = 0;
  let cursorRow = 0;
  for (const line of state.text.split("\n")) {
    let row = "";
    let used = 0;
    let count = 0;
    let cursorAt;
    const flush = () => {
      rows.push(cursorAt === void 0 ? { text: row } : { text: row, cursorAt });
      if (cursorAt !== void 0) cursorRow = rows.length - 1;
      row = "";
      used = 0;
      count = 0;
      cursorAt = void 0;
    };
    for (const ch of chars(line)) {
      const cells = displayWidth(ch);
      if (used + cells > room && row) flush();
      if (index === state.cursor) cursorAt = count;
      row += ch;
      used += cells;
      count++;
      index++;
    }
    if (index === state.cursor) cursorAt = count;
    flush();
    index++;
  }
  const visible = Math.max(1, maxRows);
  const top = Math.min(Math.max(0, cursorRow - visible + 1), Math.max(0, rows.length - visible));
  return { rows: rows.slice(top, top + visible), above: top, below: Math.max(0, rows.length - top - visible) };
}
function editKey(state, input, key) {
  const edit = (next) => next ? { kind: "edit", state: next } : { kind: "ignored" };
  if (key.return) return key.meta || key.shift ? edit(insert(state, "\n")) : { kind: "submit" };
  if (key.backspace) return edit(backspace(state));
  if (key.delete) return edit(deleteForward(state));
  if (key.leftArrow) return edit(moveLeft(state));
  if (key.rightArrow) return edit(moveRight(state));
  if (key.home || key.ctrl && input === "a") return edit(moveHome(state));
  if (key.end || key.ctrl && input === "e") return edit(moveEnd(state));
  if (key.upArrow || key.downArrow) return edit(moveLine(state, key.upArrow ? -1 : 1));
  if (!input || key.ctrl || key.meta) return { kind: "ignored" };
  return edit(insert(state, input));
}

// src/tui/components/Composer.tsx
import { Fragment as Fragment2, jsx as jsx5, jsxs as jsxs3 } from "react/jsx-runtime";
var COMPOSER_ROWS = 5;
var PROMPT_WIDTH = 2;
function composerHeight(editor, width) {
  return editor.text ? composerView(editor, width - PROMPT_WIDTH, COMPOSER_ROWS).rows.length : 1;
}
function Composer({ editor, active, width }) {
  const { glyphs, strings } = useUi();
  const prompt = `${glyphs.arrow} `;
  if (!editor.text) {
    return /* @__PURE__ */ jsxs3(Text3, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsx5(Tx, { tone: active ? "accent" : "muted", bold: active, children: prompt }),
      active ? /* @__PURE__ */ jsx5(Tx, { tone: "accent", children: glyphs.cursor }) : null,
      /* @__PURE__ */ jsx5(Tx, { dim: true, children: active ? ` ${strings.composer.active}` : glyphSafe(strings.composer.idle, glyphs.unicode) })
    ] });
  }
  const view = composerView(editor, width - PROMPT_WIDTH, COMPOSER_ROWS);
  return /* @__PURE__ */ jsx5(Box4, { flexDirection: "column", width, children: view.rows.map((row, i) => {
    const first = i === 0;
    const last = i === view.rows.length - 1;
    const marker = first && view.above > 0 ? glyphs.unicode ? "\u2191 " : "^ " : last && view.below > 0 ? glyphs.unicode ? "\u2193 " : "v " : first ? prompt : "  ";
    const chars2 = [...row.text];
    const at = active ? row.cursorAt : void 0;
    return /* @__PURE__ */ jsxs3(Text3, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsx5(Tx, { tone: active ? "accent" : "muted", bold: active, children: marker }),
      at === void 0 ? /* @__PURE__ */ jsx5(Tx, { children: row.text }) : /* @__PURE__ */ jsxs3(Fragment2, { children: [
        /* @__PURE__ */ jsx5(Tx, { children: chars2.slice(0, at).join("") }),
        /* @__PURE__ */ jsx5(Tx, { tone: "accent", children: glyphs.cursor }),
        /* @__PURE__ */ jsx5(Tx, { children: chars2.slice(at).join("") })
      ] })
    ] }, i);
  }) });
}

// src/tui/components/FocusPane.tsx
import { Box as Box5, Text as Text4 } from "ink";
import { jsx as jsx6, jsxs as jsxs4 } from "react/jsx-runtime";
function FocusPane({ agent, width, now, active, task, view }) {
  const { glyphs, strings } = useUi();
  if (!agent) {
    return /* @__PURE__ */ jsx6(Box5, { flexDirection: "column", width, children: /* @__PURE__ */ jsx6(Tx, { dim: true, children: strings.focus.empty }) });
  }
  const sep = ` ${glyphs.sep} `;
  const status = strings.status[agent.status];
  const time = agent.status === "queued" ? "" : `${sep}${formatDuration(agentElapsed(agent, now))}`;
  const tokens = agentTokens(agent);
  const usage = tokens > 0 ? `${formatTokens(tokens)} tok${sep}${formatCost(agent.usage.costUsd)}` : "";
  const engine = [agent.cli, agent.model].filter(Boolean).join(sep);
  const title = `${roleIcon(agent.role, glyphs)} ${agent.role}`;
  const leftWidth = displayWidth(`${title}${sep}${status}${time}`);
  const right = [[usage, engine].filter(Boolean).join("  "), usage].find((r) => leftWidth + 2 + displayWidth(r) <= width) ?? "";
  return /* @__PURE__ */ jsxs4(Box5, { flexDirection: "column", width, children: [
    /* @__PURE__ */ jsxs4(Box5, { justifyContent: "space-between", children: [
      /* @__PURE__ */ jsxs4(Text4, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx6(Tx, { tone: active ? "accent" : void 0, bold: true, children: title }),
        /* @__PURE__ */ jsx6(Tx, { tone: "muted", children: sep }),
        /* @__PURE__ */ jsx6(Tx, { tone: STATUS_TONE[agent.status], children: status }),
        /* @__PURE__ */ jsx6(Tx, { tone: "muted", children: time })
      ] }),
      right ? /* @__PURE__ */ jsx6(Tx, { tone: "muted", children: right }) : null
    ] }),
    task.map((line, i) => /* @__PURE__ */ jsx6(Line, { line: line.map((s) => ({ ...s, dim: true })) }, `t${i}`)),
    view.lines.length === 0 ? /* @__PURE__ */ jsx6(Tx, { dim: true, children: `${strings.focus.waiting}${glyphs.ellipsis}` }) : null,
    view.lines.map((line, i) => /* @__PURE__ */ jsx6(Line, { line }, i)),
    view.newer > 0 ? /* @__PURE__ */ jsx6(Tx, { tone: "accent", wrap: "truncate-end", children: `${glyphs.unicode ? "\u2193" : "v"} ${fill(strings.focus.newerBelow, { n: view.newer })}` }) : null
  ] });
}

// src/tui/components/Header.tsx
import { Box as Box7, Text as Text5 } from "ink";

// src/tui/components/SpecCard.tsx
import { Box as Box6 } from "ink";
import { jsx as jsx7 } from "react/jsx-runtime";
var SPEC_LINES = 2;
function specLines(spec, width, glyphs) {
  const w = Math.max(1, Math.floor(width));
  const sep = ` ${glyphs.sep} `;
  const counts = [
    plural(spec.requirements, "requirement"),
    plural(spec.checks, "check"),
    ...spec.steps !== void 0 ? [plural(spec.steps, "step")] : []
  ].join(sep);
  const head = [
    { text: `${glyphs.unicode ? "\u2261" : "="} spec  `, tone: "accent", bold: true },
    { text: counts, tone: spec.checks === 0 ? "danger" : void 0 }
  ];
  const headWidth = displayWidth(head.map((s) => s.text).join(""));
  if (headWidth + 2 + displayWidth(spec.path) <= w) {
    return [[...head, { text: `  ${spec.path}`, tone: "muted" }]];
  }
  const first = wrapSegments(head, w, { maxLines: 1, ellipsis: glyphs.ellipsis });
  const path = [{ text: `  ${truncateStart(spec.path, w - 2, glyphs.ellipsis)}`, tone: "muted" }];
  return [...first, path].slice(0, SPEC_LINES);
}
function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
function truncateStart(text, width, ellipsis) {
  if (displayWidth(text) <= width) return text;
  const room = Math.max(0, width - displayWidth(ellipsis));
  const chars2 = Array.from(text);
  let tail = "";
  for (let i = chars2.length - 1; i >= 0; i--) {
    const next = chars2[i] + tail;
    if (displayWidth(next) > room) break;
    tail = next;
  }
  return ellipsis + tail;
}

// src/tui/components/Header.tsx
import { jsx as jsx8, jsxs as jsxs5 } from "react/jsx-runtime";
var GOAL_LINES = 3;
function headerModel({ state, layout, name, now, cancelling, glyphs, strings }) {
  const totals = runTotals(state);
  const sep = ` ${glyphs.sep} `;
  const mark = `${glyphs.roles.lead} ${name.toUpperCase()}`;
  const clis = runClis(state);
  const meta = [state.run.mode, clis.length ? clis.join("+") : void 0].filter(Boolean).join(sep);
  const clock = now ?? state.now;
  const elapsed = state.run.startedAt !== void 0 ? formatDuration((state.run.endedAt ?? clock) - state.run.startedAt) : "";
  const metaLine = [meta, elapsed, state.run.endedAt !== void 0 ? state.run.outcomeLabel : void 0].filter(Boolean).join(sep);
  const costPrefix = totals.costPartial && totals.costUsd !== void 0 ? glyphs.unicode ? "\u2265" : ">=" : "";
  const money = `${costPrefix}${formatCost(totals.costUsd)}${sep}${formatTokens(totals.tokens)} tok`;
  let status;
  if (state.run.endedAt !== void 0) {
    status = state.run.ok ? { text: `${glyphs.ok} ${strings.header.done}`, tone: "success" } : { text: `${glyphs.fail} ${strings.header.failed}`, tone: "danger" };
  } else if (cancelling) {
    status = { text: `${strings.header.cancelling}${glyphs.ellipsis}`, tone: "accent" };
  }
  const right = [status?.text, metaLine].filter(Boolean).join("  ");
  const rightWidth = displayWidth(right) + 3 + displayWidth(money);
  const goal = `"${state.run.goal ?? strings.header.waiting}"`;
  const room = layout.inner - displayWidth(mark) - 2 - rightWidth - 2;
  const spec = state.spec ? specLines(state.spec, layout.inner, glyphs) : [];
  if (layout.mode !== "narrow" && displayWidth(goal) <= room) {
    return { mark, status, metaLine, money, inlineGoal: goal, goalLines: [], specLines: spec, height: 1 + spec.length };
  }
  const goalLines = wrapPlain(goal, layout.inner, { maxLines: GOAL_LINES, ellipsis: glyphs.ellipsis });
  return { mark, status, metaLine, money, goalLines, specLines: spec, height: 1 + goalLines.length + spec.length };
}
function Header({ model, hasGoal }) {
  const { glyphs } = useUi();
  const { mark, status, metaLine, money, inlineGoal, goalLines, specLines: spec } = model;
  return /* @__PURE__ */ jsxs5(Box7, { flexDirection: "column", children: [
    /* @__PURE__ */ jsxs5(Box7, { justifyContent: "space-between", children: [
      /* @__PURE__ */ jsxs5(Text5, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx8(Tx, { tone: "accent", bold: true, children: mark }),
        inlineGoal ? /* @__PURE__ */ jsx8(Tx, { dim: !hasGoal, children: `  ${inlineGoal}` }) : null
      ] }),
      /* @__PURE__ */ jsxs5(Text5, { wrap: "truncate-end", children: [
        status ? /* @__PURE__ */ jsxs5(Tx, { tone: status.tone, bold: true, children: [
          status.text,
          "  "
        ] }) : null,
        /* @__PURE__ */ jsx8(Tx, { tone: "muted", children: metaLine }),
        metaLine ? /* @__PURE__ */ jsx8(Tx, { tone: "border", children: glyphs.unicode ? " \u2502 " : " | " }) : null,
        /* @__PURE__ */ jsx8(Tx, { bold: true, children: money })
      ] })
    ] }),
    goalLines.map((line, i) => /* @__PURE__ */ jsx8(Tx, { dim: !hasGoal, wrap: "truncate-end", children: line }, i)),
    spec.map((line, i) => /* @__PURE__ */ jsx8(Line, { line }, `s${i}`))
  ] });
}

// src/tui/components/HelpOverlay.tsx
import { Box as Box8, Text as Text6 } from "ink";
import { jsx as jsx9, jsxs as jsxs6 } from "react/jsx-runtime";
function HelpOverlay({ width }) {
  const { glyphs, strings } = useUi();
  const keys = strings.help.keys.map(([k, what]) => [glyphSafe(k, glyphs.unicode), glyphSafe(what, glyphs.unicode)]);
  const keyWidth = Math.max(...keys.map(([k]) => displayWidth(k))) + 2;
  const room = Math.max(10, width - 2 - keyWidth);
  return /* @__PURE__ */ jsxs6(Box8, { flexDirection: "column", width, paddingX: 1, children: [
    /* @__PURE__ */ jsx9(Label, { active: true, children: strings.help.title }),
    keys.map(
      ([key, what]) => wrapPlain(what, room).map((line, i) => /* @__PURE__ */ jsxs6(Text6, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx9(Tx, { tone: "accent", bold: true, children: padEndDisplay(i === 0 ? key : "", keyWidth) }),
        /* @__PURE__ */ jsx9(Tx, { children: line })
      ] }, `${key}${i}`))
    ),
    /* @__PURE__ */ jsx9(Text6, { children: " " }),
    /* @__PURE__ */ jsx9(Tx, { dim: true, children: strings.help.close })
  ] });
}

// src/tui/components/Palette.tsx
import { Box as Box9, Text as Text7 } from "ink";
import { jsx as jsx10, jsxs as jsxs7 } from "react/jsx-runtime";
function Palette({ items, selected, width }) {
  const { glyphs, strings } = useUi();
  const labels = items.map((c) => `/${c.name}${c.args ? ` ${c.args}` : ""}`);
  const labelWidth = Math.max(10, ...labels.map((l) => displayWidth(l))) + 2;
  const room = Math.max(8, width - 4 - labelWidth);
  return /* @__PURE__ */ jsxs7(Box9, { flexDirection: "column", width, paddingX: 1, children: [
    /* @__PURE__ */ jsx10(Label, { active: true, children: strings.palette.title }),
    items.length === 0 ? /* @__PURE__ */ jsx10(Tx, { dim: true, children: strings.palette.empty }) : null,
    items.map((c, i) => {
      const active = i === selected;
      return /* @__PURE__ */ jsxs7(Text7, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx10(Tx, { tone: "accent", children: active ? `${glyphs.selected} ` : "  " }),
        /* @__PURE__ */ jsx10(Tx, { tone: active ? "accent" : void 0, bold: active, children: padEndDisplay(labels[i], labelWidth) }),
        /* @__PURE__ */ jsx10(Tx, { dim: !active, children: truncate(strings.palette.describe[c.name] ?? "", room, glyphs.ellipsis) })
      ] }, c.name);
    }),
    /* @__PURE__ */ jsx10(Text7, { children: " " }),
    /* @__PURE__ */ jsx10(Tx, { dim: true, children: glyphSafe(strings.palette.hint, glyphs.unicode) })
  ] });
}

// src/tui/focus.ts
var FOLLOW = { follow: true };
function maxTop(total, height) {
  return Math.max(0, total - height);
}
function focusWindow(lines, height, scroll) {
  const h = Math.max(1, height);
  if (scroll.follow || lines.length <= h || scroll.top > maxTop(lines.length, h)) {
    return { lines: lines.slice(Math.max(0, lines.length - h)), newer: 0 };
  }
  const top = Math.max(0, scroll.top);
  const shown = lines.slice(top, top + Math.max(1, h - 1));
  return { lines: shown, newer: lines.length - top - shown.length };
}
function scrollBy(scroll, total, height, delta) {
  const bottom = maxTop(total, height);
  if (total <= height) return FOLLOW;
  const current = scroll.follow ? bottom + 1 : Math.min(scroll.top, bottom);
  const next = current + delta;
  if (next > bottom) return FOLLOW;
  return { follow: false, top: Math.max(0, next) };
}
function scrollToTop(total, height) {
  return total <= height ? FOLLOW : { follow: false, top: 0 };
}

// src/tui/layout.ts
var MIN_COLUMNS = 40;
var MIN_ROWS = 12;
var NARROW_TREE_MAX = 44;
function computeLayout(columns, rows) {
  const cols = Math.max(MIN_COLUMNS, Math.floor(columns || 0));
  const r = Math.max(MIN_ROWS, Math.floor(rows || 0));
  const inner = cols - 4;
  if (cols >= 100) {
    const treeWidth2 = 34;
    return { mode: "wide", columns: cols, rows: r, inner, treeWidth: treeWidth2, focusWidth: inner - treeWidth2 - 2, showTreeTokens: true };
  }
  if (cols >= 80) {
    const treeWidth2 = 26;
    return { mode: "medium", columns: cols, rows: r, inner, treeWidth: treeWidth2, focusWidth: inner - treeWidth2 - 2, showTreeTokens: false };
  }
  const treeWidth = Math.min(inner, NARROW_TREE_MAX);
  return { mode: "narrow", columns: cols, rows: r, inner, treeWidth, focusWidth: inner, showTreeTokens: false };
}
function focusLogHeight(layout, opts) {
  const narrow = layout.mode === "narrow";
  const header = opts.headerLines ?? (narrow ? 2 : 1);
  const bottom = opts.bottomLines ?? (narrow ? 2 : 1);
  const tree = narrow ? opts.treeRows + 2 : 0;
  const approval = opts.approvalLines > 0 ? opts.approvalLines + 1 : 0;
  const chrome = 2 + header + 2 + bottom + 1 + (opts.taskLines ?? 1) + approval + tree + (opts.extraLines ?? 0);
  return Math.max(3, layout.rows - chrome);
}

// src/tui/palette.ts
var COMMANDS = [
  { name: "help" },
  { name: "agents" },
  { name: "approve" },
  { name: "reject" },
  { name: "cancel" },
  { name: "brain" },
  { name: "recall", args: "<query>" },
  { name: "lang", args: "es|en" },
  { name: "dispatch", args: "<cli> <task>", crew: true },
  { name: "status", crew: true },
  { name: "quit" }
];
function availableCommands(crew) {
  return COMMANDS.filter((c) => crew || !c.crew);
}
function filterCommands(commands, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  const prefix = commands.filter((c) => c.name.startsWith(q));
  const inner = commands.filter((c) => !c.name.startsWith(q) && c.name.includes(q));
  return [...prefix, ...inner];
}
function paletteQuery(draft) {
  const match = /^\/(\S*)$/.exec(draft);
  return match ? match[1] : void 0;
}
function parseCommand(text) {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return void 0;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}
function findCommand(commands, name) {
  return commands.find((c) => c.name === name);
}

// src/tui/state.ts
var MAX_LOG_ENTRIES = 500;
var initialState = {
  run: {},
  agents: {},
  order: [],
  approvals: [],
  brain: { recalls: 0, recalledIds: [], learnings: [] },
  errors: [],
  now: 0,
  focus: { pinned: false }
};
var TERMINAL = /* @__PURE__ */ new Set(["done", "failed", "cancelled"]);
function reduce(state, event) {
  const at = parseAt(event.at, state.now);
  const s = at > state.now ? { ...state, now: at } : state;
  if (event.type === "spec.ready") return reduceSpec(s, event);
  switch (event.type) {
    case "run.start":
      return { ...s, run: { ...s.run, runId: event.runId, goal: event.goal, mode: event.mode, startedAt: at } };
    case "run.end":
      return {
        ...s,
        approvals: [],
        run: { ...s.run, runId: s.run.runId ?? event.runId, endedAt: at, ok: event.ok, summary: event.summary }
      };
    case "outcome":
      return { ...s, run: { ...s.run, outcomeLabel: event.label } };
    case "agent.spawn": {
      const prev = s.agents[event.agentId];
      const agent = {
        ...prev ?? newAgent(event.agentId, at),
        parentId: event.parentId,
        role: event.role,
        cli: event.cli,
        model: event.model,
        task: event.task
      };
      const next = putAgent(s, agent);
      return autoFocus(next, agent.id);
    }
    case "agent.status": {
      const next = updateAgent(s, event.agentId, at, (a) => withStatus(a, event.status, at));
      return event.status === "running" || event.status === "awaiting-approval" ? autoFocus(next, event.agentId) : next;
    }
    case "agent.text":
      return updateAgent(s, event.agentId, at, (a) => appendText(a, "text", event.text));
    case "agent.thinking":
      return updateAgent(s, event.agentId, at, (a) => appendText(a, "thinking", event.text));
    case "tool.call":
      return updateAgent(
        s,
        event.agentId,
        at,
        (a) => pushLog(a, { kind: "tool", callId: event.callId, tool: event.tool, input: event.input, state: "pending" })
      );
    case "tool.result":
      return updateAgent(s, event.agentId, at, (a) => resolveTool(a, event.callId, event.ok, event.output));
    case "usage":
      return updateAgent(s, event.agentId, at, (a) => ({ ...a, usage: addUsage(a.usage, event.usage) }));
    case "approval.request": {
      const pending = {
        approvalId: event.approvalId,
        agentId: event.agentId,
        title: event.title,
        detail: event.detail,
        at
      };
      const withCard = {
        ...s,
        approvals: [...s.approvals.filter((p) => p.approvalId !== event.approvalId), pending]
      };
      return updateAgent(withCard, event.agentId, at, (a) => pushLog(a, { kind: "approval", title: event.title }));
    }
    case "approval.resolve": {
      const pending = s.approvals.find((p) => p.approvalId === event.approvalId);
      const rest = s.approvals.filter((p) => p.approvalId !== event.approvalId);
      const next = { ...s, approvals: rest };
      if (!pending) return next;
      return updateAgent(
        next,
        pending.agentId,
        at,
        (a) => pushLog(a, { kind: "approval", title: pending.title, approved: event.approved, by: event.by })
      );
    }
    case "brain.recall": {
      const seen = new Set(s.brain.recalledIds);
      const fresh = [];
      for (const id of event.noteIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        fresh.push(id);
      }
      return {
        ...s,
        brain: {
          ...s.brain,
          recalls: s.brain.recalls + event.noteIds.length,
          recalledIds: fresh.length ? [...s.brain.recalledIds, ...fresh] : s.brain.recalledIds
        }
      };
    }
    case "brain.learn":
      return {
        ...s,
        brain: {
          ...s.brain,
          learnings: [...s.brain.learnings, { noteId: event.noteId, kind: event.kind, title: event.title }]
        }
      };
    case "context.usage":
      if (!(event.windowTokens > 0) || !Number.isFinite(event.usedTokens)) return s;
      return {
        ...s,
        brain: {
          ...s.brain,
          context: { usedTokens: Math.max(0, event.usedTokens), budgetTokens: event.windowTokens, ...event.agentId ? { agentId: event.agentId } : {} }
        }
      };
    case "agent.end": {
      const open = s.approvals.filter((p) => p.agentId !== event.agentId);
      const base = open.length === s.approvals.length ? s : { ...s, approvals: open };
      return updateAgent(base, event.agentId, at, (a) => {
        const status = a.status === "cancelled" ? "cancelled" : event.ok ? "done" : "failed";
        const ended = withStatus(a, status, at);
        return pushLog(
          { ...ended, summary: event.summary, sessionId: event.sessionId ?? a.sessionId },
          { kind: "end", ok: event.ok, summary: event.summary }
        );
      });
    }
    case "error": {
      const next = { ...s, errors: [...s.errors, { agentId: event.agentId, message: event.message, at }] };
      return event.agentId ? updateAgent(next, event.agentId, at, (a) => pushLog(a, { kind: "error", message: event.message })) : next;
    }
    case "verify.result":
      return appendFocusedLog(s, at, {
        kind: "verify",
        ok: event.ok,
        kindName: event.kind,
        ...event.checkId ? { checkId: event.checkId } : {},
        output: event.output
      });
    case "failure.attribution":
      return appendFocusedLog(s, at, { kind: "attribution", observed: event.observed, failureType: event.failureType, next: event.next });
    case "intervention":
      return appendFocusedLog(s, at, { kind: "intervention", action: event.action, ...event.detail ? { detail: event.detail } : {}, avoidable: event.avoidable, harnessGap: event.harnessGap });
    case "task.define":
    case "context.trace":
    case "entropy.finding":
      return s;
    default:
      return s;
  }
}
function reduceAll(events, from = initialState) {
  let state = from;
  for (const e of events) state = reduce(state, e);
  return state;
}
function reduceSpec(s, event) {
  const path = typeof event.path === "string" ? event.path.trim() : "";
  if (!path) return s;
  const steps = countOf(event.steps);
  const spec = {
    path,
    requirements: countOf(event.requirements) ?? 0,
    checks: countOf(event.checks) ?? 0,
    ...steps !== void 0 ? { steps } : {}
  };
  return { ...s, spec };
}
function countOf(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  return void 0;
}
function parseAt(at, fallback) {
  const t = Date.parse(at);
  return Number.isNaN(t) ? fallback : t;
}
function newAgent(id, at) {
  return {
    id,
    role: id,
    task: "",
    status: "queued",
    spawnedAt: at,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costPartial: false },
    log: []
  };
}
function putAgent(s, agent) {
  const known = Boolean(s.agents[agent.id]);
  return {
    ...s,
    agents: { ...s.agents, [agent.id]: agent },
    order: known ? s.order : [...s.order, agent.id]
  };
}
function updateAgent(s, id, at, fn) {
  return putAgent(s, fn(s.agents[id] ?? newAgent(id, at)));
}
function autoFocus(s, agentId) {
  if (s.focus.pinned) return s;
  return { ...s, focus: { agentId, pinned: false } };
}
function appendFocusedLog(s, at, entry) {
  const id = s.focus.agentId ?? s.order.at(-1) ?? "evidence";
  return updateAgent(s, id, at, (agent) => pushLog(agent, entry));
}
function withStatus(a, status, at) {
  const next = { ...a, status };
  if (status === "running" && a.startedAt === void 0) next.startedAt = at;
  if (TERMINAL.has(status)) {
    if (a.endedAt === void 0) next.endedAt = at;
  } else {
    next.endedAt = void 0;
  }
  return next;
}
function pushLog(a, entry) {
  const log = [...a.log, entry];
  return { ...a, log: log.length > MAX_LOG_ENTRIES ? log.slice(log.length - MAX_LOG_ENTRIES) : log };
}
function appendText(a, kind, text) {
  const last = a.log[a.log.length - 1];
  if (last && last.kind === kind) {
    const merged = { kind, text: last.text + text };
    return { ...a, log: [...a.log.slice(0, -1), merged] };
  }
  return pushLog(a, { kind, text });
}
function resolveTool(a, callId, ok, output) {
  for (let i = a.log.length - 1; i >= 0; i--) {
    const e = a.log[i];
    if (e && e.kind === "tool" && e.callId === callId) {
      const log = a.log.slice();
      log[i] = { ...e, state: ok ? "ok" : "failed", output };
      return { ...a, log };
    }
  }
  return pushLog(a, { kind: "tool", callId, tool: "tool", input: "", state: ok ? "ok" : "failed", output });
}
function addUsage(u, d) {
  return {
    inputTokens: u.inputTokens + safe(d.inputTokens),
    outputTokens: u.outputTokens + safe(d.outputTokens),
    cacheReadTokens: u.cacheReadTokens + safe(d.cacheReadTokens),
    cacheWriteTokens: u.cacheWriteTokens + safe(d.cacheWriteTokens),
    costUsd: d.costUsd === void 0 ? u.costUsd : (u.costUsd ?? 0) + safe(d.costUsd),
    costPartial: u.costPartial || d.costUsd === void 0
  };
}
function safe(n) {
  return n !== void 0 && Number.isFinite(n) && n > 0 ? n : 0;
}

// src/tui/useAppInput.ts
import { useApp, useInput, usePaste } from "ink";
var PANES = ["agents", "focus", "composer"];
function useAppInput(input) {
  const { exit } = useApp();
  const { props, state, pane, editor, palette, strings, scroll } = input;
  const running = state.run.startedAt !== void 0 && state.run.endedAt === void 0;
  const say = (text) => input.setNotice(text);
  const clear = () => input.setEditor(EMPTY_EDITOR);
  const cancel = () => {
    if (!props.onCancel || input.cancelling || !running) return false;
    input.setCancelling(true);
    props.onCancel();
    return true;
  };
  const decide = (approved) => {
    const approval = input.approval;
    if (!approval) return say(strings.notice.noApproval);
    props.onApprove?.(approval.approvalId, approved);
    input.answer(approval.approvalId);
  };
  const run = (name, args) => {
    switch (name) {
      case "help":
        return input.setHelp(true);
      case "agents":
        return input.setPane("agents");
      case "approve":
      case "reject":
        return decide(name === "approve");
      case "cancel":
        if (!cancel()) say(fill(strings.notice.unavailable, { name: "/cancel" }));
        return;
      case "lang": {
        const lang = args.toLowerCase();
        if (lang !== "es" && lang !== "en") return say(fill(strings.notice.usage, { usage: "/lang es|en" }));
        input.setLang(lang);
        return say(uiStrings(lang).notice.lang);
      }
      case "quit":
        return exit();
      default:
        return host(name, args);
    }
  };
  const host = (name, args) => {
    const fallback = () => name === "brain" ? say(fill(strings.notice.brain, { recalled: state.brain.recalledIds.length, learned: state.brain.learnings.length })) : say(fill(strings.notice.unavailable, { name: `/${name}` }));
    const handler = props.onCommand;
    if (!handler) return fallback();
    void Promise.resolve().then(() => handler(name, args)).then(
      (text) => text ? say(text) : fallback(),
      (error) => say(error instanceof Error ? error.message : String(error))
    );
  };
  const submit = () => {
    const text = editor.text.trim();
    if (!text) return;
    if (palette.query !== void 0) {
      const chosen = palette.matches[palette.selected];
      if (!chosen) {
        clear();
        return say(fill(strings.notice.unknown, { name: text }));
      }
      if (chosen.args) return input.setEditor(insert(EMPTY_EDITOR, `/${chosen.name} `));
      clear();
      return run(chosen.name, "");
    }
    clear();
    const parsed = parseCommand(text);
    if (!parsed) {
      if (props.onSubmit) props.onSubmit(text);
      else say(strings.notice.noLead);
      return;
    }
    const command = findCommand(palette.commands, parsed.name);
    if (!command) return say(fill(strings.notice.unknown, { name: `/${parsed.name}` }));
    if (command.args && !parsed.args) return say(fill(strings.notice.usage, { usage: `/${command.name} ${command.args}` }));
    run(command.name, parsed.args);
  };
  const scrollFocus = (delta) => input.scroll.set((s) => scrollBy(s, scroll.total, scroll.height, delta));
  const page = Math.max(1, scroll.height - 2);
  const onComposerKey = (text, key) => {
    if (palette.query !== void 0) {
      if (key.upArrow || key.downArrow) {
        const n = palette.matches.length;
        if (n) palette.setPick((palette.selected + (key.upArrow ? n - 1 : 1)) % n);
        return;
      }
      if (key.tab) {
        const chosen = palette.matches[palette.selected];
        if (chosen) input.setEditor(insert(EMPTY_EDITOR, `/${chosen.name}${chosen.args ? " " : ""}`));
        return;
      }
    }
    if (key.escape) {
      if (editor.text) clear();
      else input.setPane("agents");
      say(void 0);
      return;
    }
    if (key.tab) return cyclePane(key.shift);
    if (text === "?" && !editor.text) return input.setHelp(true);
    if (editKey(editor, text, key).kind === "submit") return submit();
    input.setEditor((current) => {
      const result = editKey(current, text, key);
      return result.kind === "edit" ? result.state : current;
    });
    say(void 0);
  };
  const cyclePane = (back) => input.setPane((p) => PANES[(PANES.indexOf(p) + (back ? PANES.length - 1 : 1)) % PANES.length]);
  useInput((text, key) => {
    if (key.ctrl && text === "c") {
      if (!cancel()) exit();
      return;
    }
    if (input.help) return input.setHelp(false);
    if (key.pageUp || key.pageDown) return scrollFocus(key.pageUp ? -page : page);
    if (pane === "composer") return onComposerKey(text, key);
    if (key.tab) return cyclePane(key.shift);
    if (text === "/") {
      input.setPane("composer");
      input.setEditor(insert(EMPTY_EDITOR, "/"));
      return;
    }
    if (pane === "focus") {
      if (key.upArrow || key.downArrow) return scrollFocus(key.upArrow ? -1 : 1);
      if (key.home) return input.scroll.set(scrollToTop(scroll.total, scroll.height));
      if (key.end) return input.scroll.set(FOLLOW);
    } else if (key.upArrow || key.downArrow) {
      return input.dispatch({ kind: "move", delta: key.upArrow ? -1 : 1 });
    }
    if (input.approval && (text === "y" || text === "n")) return decide(text === "y");
    if (input.approval && text === "d") return input.setDetail((d) => !d);
    if (text === "?") return input.setHelp(true);
    if (text === "q") exit();
  });
  usePaste((text) => {
    if (input.help) input.setHelp(false);
    input.setPane("composer");
    input.setEditor((e) => insert(e, text));
  });
}

// src/tui/App.tsx
import { Fragment as Fragment3, jsx as jsx11, jsxs as jsxs8 } from "react/jsx-runtime";
var TASK_LINES = 2;
var NOTICE_LINES = 2;
function appReducer(state, action) {
  if (action.kind === "event") return reduce(state, action.event);
  if (action.kind === "move") return moveFocus(state, action.delta);
  return selectAgent(state, action.agentId);
}
function isEventArray(events) {
  return Array.isArray(events);
}
function App(props) {
  const { events } = props;
  const theme = useMemo(() => props.theme ?? detectTheme(), [props.theme]);
  const glyphs = useMemo(() => props.glyphs ?? getGlyphs(), [props.glyphs]);
  const [lang, setLang] = useState(props.lang ?? "en");
  const strings = uiStrings(lang);
  const ui = useMemo(() => ({ theme, glyphs, strings }), [theme, glyphs, strings]);
  const live = !isEventArray(events);
  const [state, dispatch] = useReducer(appReducer, events, (e) => isEventArray(e) ? reduceAll(e) : initialState);
  const window = useWindowSize();
  const layout = computeLayout(props.columns ?? window.columns, props.rows ?? window.rows);
  const [pane, setPane] = useState(props.initialPane ?? (props.onSubmit ? "composer" : "agents"));
  const [help, setHelp] = useState(false);
  const [editor, setEditor] = useState(EMPTY_EDITOR);
  const [pick, setPick] = useState(0);
  const [notice, setNotice] = useState();
  const [detail, setDetail] = useState(false);
  const [answered, setAnswered] = useState(/* @__PURE__ */ new Set());
  const [cancelling, setCancelling] = useState(false);
  const [scroll, setScroll] = useState(FOLLOW);
  const now = useLiveClock(live && state.run.endedAt === void 0, state.now);
  const lastEventWall = now.lastEventWall;
  useEffect(() => {
    if (isEventArray(events)) return;
    let stopped = false;
    void (async () => {
      try {
        for await (const event of events) {
          if (stopped) break;
          lastEventWall.current = Date.now();
          dispatch({ kind: "event", event });
        }
      } catch (err) {
        if (!stopped) {
          const message = err instanceof Error ? err.message : String(err);
          dispatch({ kind: "event", event: { type: "error", message: `event stream: ${message}`, at: (/* @__PURE__ */ new Date()).toISOString() } });
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [events, lastEventWall]);
  const agent = focusedAgent(state);
  const agentId = agent?.id;
  useEffect(() => setScroll(FOLLOW), [agentId]);
  const commands = useMemo(() => availableCommands(Boolean(props.crew)), [props.crew]);
  const query = pane === "composer" && !help ? paletteQuery(editor.text) : void 0;
  const matches = query === void 0 ? [] : filterCommands(commands, query);
  const selected = Math.min(pick, Math.max(0, matches.length - 1));
  useEffect(() => setPick(0), [query]);
  const pending = state.approvals.filter((a) => !answered.has(a.approvalId));
  const approval = pending[0];
  const role = approval ? state.agents[approval.agentId]?.role ?? approval.agentId : "";
  const approvalProps = approval ? { approval, role, width: layout.inner, queued: pending.length - 1, showDetail: detail } : void 0;
  const header = headerModel({ state, layout, name: props.name ?? "Edu", now: now.value, cancelling, glyphs, strings });
  const runError = state.errors.filter((e) => !e.agentId).at(-1)?.message;
  const errorLines = runError ? wrapSegments([{ text: `${glyphs.fail} `, tone: "danger" }, { text: runError, tone: "danger" }], layout.inner, { indent: 2, maxLines: NOTICE_LINES, ellipsis: glyphs.ellipsis }) : [];
  const noticeLines = notice ? wrapPlain(notice, layout.inner, { maxLines: NOTICE_LINES, ellipsis: glyphs.ellipsis }) : [];
  const brainRows = brainLines(state.brain, props.context, layout.inner, glyphs, strings).length;
  const taskLines = agent?.task ? wrapPlain(agent.task, layout.focusWidth, { maxLines: TASK_LINES, ellipsis: glyphs.ellipsis }).map((text) => [{ text }]) : [[{ text: " " }]];
  const logHeight = focusLogHeight(layout, {
    approvalLines: approvalProps ? approvalCardHeight(approvalProps, glyphs, strings) : 0,
    treeRows: Math.max(1, agentTree(state).length),
    headerLines: header.height,
    bottomLines: brainRows + noticeLines.length + composerHeight(editor, layout.inner),
    taskLines: taskLines.length,
    extraLines: errorLines.length ? errorLines.length + 1 : 0
  });
  const lines = useMemo(
    () => agent ? logLines(agent.log, layout.focusWidth, glyphs, strings) : [],
    [agent, layout.focusWidth, glyphs, strings]
  );
  const view = focusWindow(lines, logHeight, scroll);
  useAppInput({
    props,
    state,
    dispatch,
    pane,
    setPane,
    help,
    setHelp,
    editor,
    setEditor,
    palette: { query, matches, selected, setPick, commands },
    setNotice,
    approval,
    answer: (approvalId) => {
      setAnswered((s) => new Set(s).add(approvalId));
      setDetail(false);
    },
    setDetail,
    cancelling,
    setCancelling,
    scroll: { total: lines.length, height: logHeight, set: setScroll },
    setLang,
    strings
  });
  const twoColumns = layout.mode !== "narrow";
  const overlay = help ? /* @__PURE__ */ jsx11(HelpOverlay, { width: layout.inner }) : query !== void 0 ? /* @__PURE__ */ jsx11(Palette, { items: matches, selected, width: layout.inner }) : null;
  return /* @__PURE__ */ jsx11(UiContext, { value: ui, children: /* @__PURE__ */ jsxs8(
    Box10,
    {
      flexDirection: "column",
      width: layout.columns,
      borderStyle: glyphs.unicode ? "round" : "classic",
      borderColor: theme.color("border"),
      paddingX: 1,
      children: [
        /* @__PURE__ */ jsx11(Header, { model: header, hasGoal: Boolean(state.run.goal) }),
        /* @__PURE__ */ jsx11(Rule, { width: layout.inner }),
        overlay ?? /* @__PURE__ */ jsxs8(Box10, { flexDirection: twoColumns ? "row" : "column", children: [
          /* @__PURE__ */ jsx11(AgentTree, { state, layout, now: now.value, active: pane === "agents" }),
          twoColumns ? null : /* @__PURE__ */ jsx11(Rule, { width: layout.inner }),
          /* @__PURE__ */ jsx11(
            Box10,
            {
              borderStyle: glyphs.unicode ? "single" : "classic",
              borderColor: theme.color("border"),
              borderTop: false,
              borderRight: false,
              borderBottom: false,
              borderLeft: twoColumns,
              paddingLeft: twoColumns ? 1 : 0,
              children: /* @__PURE__ */ jsx11(FocusPane, { agent, width: layout.focusWidth, now: now.value, active: pane === "focus", task: taskLines, view })
            }
          )
        ] }),
        approvalProps && !help ? /* @__PURE__ */ jsxs8(Fragment3, { children: [
          /* @__PURE__ */ jsx11(Rule, { width: layout.inner }),
          /* @__PURE__ */ jsx11(ApprovalCard, { ...approvalProps })
        ] }) : null,
        errorLines.length ? /* @__PURE__ */ jsxs8(Fragment3, { children: [
          /* @__PURE__ */ jsx11(Rule, { width: layout.inner }),
          errorLines.map((l, i) => /* @__PURE__ */ jsx11(Line, { line: l }, i))
        ] }) : null,
        /* @__PURE__ */ jsx11(Rule, { width: layout.inner }),
        /* @__PURE__ */ jsx11(BrainStrip, { brain: state.brain, context: props.context, width: layout.inner }),
        noticeLines.map((text, i) => /* @__PURE__ */ jsx11(Line, { line: [{ text, tone: "accent" }] }, `n${i}`)),
        /* @__PURE__ */ jsx11(Composer, { editor, active: pane === "composer", width: layout.inner })
      ]
    }
  ) });
}
function useLiveClock(ticking, eventNow) {
  const lastEventWall = useRef(Date.now());
  const [wall, setWall] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setWall(Date.now()), 1e3);
    return () => clearInterval(timer);
  }, [ticking]);
  const value = ticking && eventNow > 0 ? eventNow + Math.max(0, wall - lastEventWall.current) : eventNow;
  return { value, lastEventWall };
}

// src/tui/render.tsx
import { render } from "ink";
import { jsx as jsx12 } from "react/jsx-runtime";
function renderTui(props, opts = {}) {
  const stdout = opts.stdout ?? process.stdout;
  const env = opts.env ?? process.env;
  const theme = props.theme ?? detectTheme(env, Boolean(stdout.isTTY));
  const glyphs = props.glyphs ?? getGlyphs(env);
  return render(/* @__PURE__ */ jsx12(App, { ...props, theme, glyphs }), {
    stdout,
    stdin: opts.stdin ?? process.stdin,
    stderr: opts.stderr ?? process.stderr,
    exitOnCtrlC: false,
    patchConsole: opts.patchConsole ?? true
  });
}
export {
  App,
  COMMANDS,
  MAX_LOG_ENTRIES,
  MIN_COLUMNS,
  MIN_ROWS,
  agentElapsed,
  agentTokens,
  agentTree,
  computeLayout,
  demoScript as demoEvents,
  eventProblem,
  focusLogHeight,
  focusedAgent,
  fsCrewSource,
  initialState,
  isEduEvent,
  langFromEnv,
  loadRun,
  logLines,
  moveFocus,
  parseRunJsonl,
  reduce,
  reduceAll,
  renderTui,
  runClis,
  runTotals,
  selectAgent,
  timedEvents,
  uiStrings,
  watchCrew,
  wrapPlain,
  wrapSegments,
  wrapText
};
//# sourceMappingURL=tui-M5TLJBVS.js.map