// src/adapters/blocks.ts
import { createHash } from "crypto";
var BLOCK_START = "<!-- edu:core:start -->";
var BLOCK_END = "<!-- edu:core:end -->";
function eolOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}
function bounds(text) {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start < 0 !== end < 0) throw new Error("Malformed Edu managed block");
  if (start < 0) return void 0;
  if (end < start || text.indexOf(BLOCK_START, start + BLOCK_START.length) >= 0 || text.indexOf(BLOCK_END, end + BLOCK_END.length) >= 0) {
    throw new Error("Malformed Edu managed block");
  }
  return [start, end + BLOCK_END.length];
}
function upsertManagedBlock(text, body, eol = eolOf(text)) {
  const block = [BLOCK_START, ...body.trimEnd().split(/\r?\n/), BLOCK_END].join(eol);
  const span = bounds(text);
  if (span) return text.slice(0, span[0]) + block + text.slice(span[1]);
  const separator = text.length === 0 ? "" : eol;
  return `${text}${separator}${block}${eol}`;
}
function managedBlock(text) {
  const span = bounds(text);
  return span ? text.slice(span[0], span[1]) : void 0;
}
function managedBlockBody(block) {
  return block.slice(BLOCK_START.length, block.length - BLOCK_END.length).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}
function sectionDigest(section) {
  return createHash("sha256").update(section.replace(/\r\n/g, "\n")).digest("hex");
}
function removeManagedBlock(text) {
  const span = bounds(text);
  if (!span) return text;
  const [start, end] = span;
  const eol = text.startsWith("\r\n", end) ? "\r\n" : text.startsWith("\n", end) ? "\n" : "";
  if (eol && end + eol.length === text.length) {
    const prefix = text.slice(0, start);
    return prefix.endsWith(eol) ? prefix.slice(0, -eol.length) : prefix;
  }
  return text.slice(0, start) + text.slice(end + eol.length);
}

export {
  eolOf,
  upsertManagedBlock,
  managedBlock,
  managedBlockBody,
  sectionDigest,
  removeManagedBlock
};
//# sourceMappingURL=chunk-BIXUCKST.js.map