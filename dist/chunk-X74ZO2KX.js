// src/core/contracts.ts
var TIER_DIRS = {
  canonical: "1-canonical",
  episodic: "2-episodic",
  transitive: "3-transitive"
};
var INDEX_DIR = "0-index";
var TRANSITIVE_PREFIX = {
  decision: "D-",
  hypothesis: "H-",
  commitment: "C-",
  lesson: "L-"
};
var CLI_IDS = ["claude", "codex", "pi", "opencode", "agy"];
var HUMAN_APPROVERS = ["user", "cli", "deck"];

// src/brain/frontmatter.ts
import { parse, stringify } from "yaml";
function splitFrontmatter(source) {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(normalized);
  return match ? { yaml: match[1], body: match[2] } : { body: normalized };
}
function parseFrontmatter(source) {
  const { yaml, body } = splitFrontmatter(source);
  if (yaml === void 0) return void 0;
  return { meta: parse(yaml) ?? {}, body: body.trim() };
}
function parseMarkdown(source) {
  return parseFrontmatter(source) ?? { meta: {}, body: splitFrontmatter(source).body.trimEnd() };
}
function serializeMarkdown(meta, body) {
  const yaml = stringify(meta, { lineWidth: 0 }).trimEnd();
  return `---
${yaml}
---

${body.trim()}
`;
}
function parseMarkdownLenient(source) {
  try {
    return { ...parseMarkdown(source), recovered: false };
  } catch {
    const { yaml, body } = splitFrontmatter(source);
    if (yaml === void 0) throw new Error("Unparseable frontmatter");
    const meta = {};
    let lastKey;
    for (const line of yaml.split("\n")) {
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (pair) {
        lastKey = pair[1];
        meta[lastKey] = flatValue(pair[2].trim());
      } else if (lastKey && /^\s+\S/.test(line) && typeof meta[lastKey] === "string") {
        meta[lastKey] = `${meta[lastKey]} ${line.trim()}`.trim();
      }
    }
    return { meta, body: body.trim(), recovered: true };
  }
}
function flatValue(raw) {
  if (/^\[.*\]$/.test(raw)) return raw.slice(1, -1).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  return raw.replace(/^(['"])(.*)\1$/, "$2");
}

export {
  TIER_DIRS,
  INDEX_DIR,
  TRANSITIVE_PREFIX,
  CLI_IDS,
  HUMAN_APPROVERS,
  splitFrontmatter,
  parseFrontmatter,
  parseMarkdown,
  serializeMarkdown,
  parseMarkdownLenient
};
//# sourceMappingURL=chunk-X74ZO2KX.js.map