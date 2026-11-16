import {
  createEduMcpServer
} from "./chunk-GP7OJNUL.js";
import "./chunk-SNDHWENC.js";
import {
  SESSION_BRIEF_TOKENS,
  sessionStart,
  workspaceBrief
} from "./chunk-BEMLR5O2.js";
import "./chunk-UPSPAYW3.js";
import "./chunk-IK4YS5DS.js";
import "./chunk-RAL3CFMO.js";
import "./chunk-SQPVAE47.js";
import "./chunk-SHLHBIR7.js";
import "./chunk-CMOEIR57.js";
import "./chunk-QKYNQ2TE.js";
import "./chunk-X4DEIY6R.js";
import "./chunk-RJR54O7G.js";
import "./chunk-753L45FB.js";
import "./chunk-FMFRO2B7.js";
import "./chunk-ORYLFQE5.js";
import "./chunk-AINX4RRX.js";
import "./chunk-XEODSS5O.js";
import "./chunk-3U3ZYT3I.js";
import "./chunk-CAQVQMTA.js";
import "./chunk-6GXTQRCF.js";
import "./chunk-LVU7A3FM.js";
import "./chunk-KLV4TDB7.js";
import {
  seedCorpus
} from "./chunk-OFQOCATX.js";
import {
  openBrain
} from "./chunk-BDQUVGCN.js";
import "./chunk-KDSAKUP2.js";
import "./chunk-NMJNTHQG.js";
import "./chunk-2KR4L72V.js";
import {
  estimateTokens
} from "./chunk-ICQNXX6J.js";
import "./chunk-ZJAEVUE2.js";
import "./chunk-NYX2D5YD.js";
import "./chunk-YINGR2DA.js";
import "./chunk-YPR7PZSQ.js";
import "./chunk-VP6QM6H5.js";

// src/cli/bench-context.ts
import { mkdir, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}
var bytes = (text) => Buffer.byteLength(text, "utf8");
function benchContext(base, cwd, stdin, out) {
  return {
    cwd,
    env: { HOME: join(base, "home"), EDU_HOME: join(base, "home", ".edu"), EDU_CEILING_DIRECTORIES: base, NO_COLOR: "1" },
    home: join(base, "home"),
    out: (text) => void out.push(text),
    err: () => void 0,
    readStdin: async () => stdin,
    isTTY: false,
    stdinIsTTY: false,
    confirm: async () => false,
    detectClis: async () => [],
    setExitCode: () => void 0
  };
}
async function hookOutput(base, cwd, sessionId) {
  const out = [];
  await sessionStart(benchContext(base, cwd, JSON.stringify({ session_id: sessionId, source: "startup", cwd }), out), cwd);
  return out.join("\n");
}
async function mcpToolCost(locations, profile) {
  const server = createEduMcpServer({ locations, env: {}, toolProfile: profile });
  const client = new Client({ name: "edu-bench", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const json = JSON.stringify(tools);
    return {
      tools: tools.length,
      tokens: estimateTokens(json),
      bytes: bytes(json),
      perTool: tools.map((tool) => ({ name: tool.name, tokens: estimateTokens(JSON.stringify(tool)) })).sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
    };
  } finally {
    await client.close();
    await server.close();
  }
}
async function runContextBench(options = {}) {
  const base = await mkdtemp(join(options.tmpRoot ?? tmpdir(), "edu-bench-context-"));
  try {
    const cwd = join(base, "project");
    await mkdir(join(base, "home"), { recursive: true });
    await seedCorpus(join(cwd, ".edu"));
    const plain = await workspaceBrief(benchContext(base, cwd, "", []), cwd);
    if (!plain) throw new Error("bench brain was not initialized");
    const first = await hookOutput(base, cwd, "bench-session-a");
    const second = await hookOutput(base, cwd, "bench-session-b");
    await openBrain([{ scope: "project", root: join(cwd, ".edu") }]).recall("scheduler locks");
    const afterRecall = await hookOutput(base, cwd, "bench-session-a");
    const chars = commonPrefixLength(first, second);
    const prefix = first.slice(0, first.lastIndexOf("\n", chars - 1) + 1 || (chars === first.length && chars === second.length ? chars : 0));
    const firstLines = first.split("\n");
    const difference = second.split("\n").find((line, i) => line !== firstLines[i]);
    const secondTokens = estimateTokens(second);
    const prefixTokens = estimateTokens(prefix);
    const locations = [{ scope: "project", root: join(cwd, ".edu") }];
    return {
      brief: { budgetTokens: SESSION_BRIEF_TOKENS, tokens: estimateTokens(plain.text), bytes: bytes(plain.text), hookTokens: estimateTokens(first), hookBytes: bytes(first) },
      stability: {
        identical: first === second,
        firstTokens: estimateTokens(first),
        secondTokens,
        commonPrefixTokens: prefixTokens,
        commonPrefixRatio: secondTokens ? Math.round(prefixTokens / secondTokens * 1e4) / 1e4 : 1,
        firstDifference: first === second ? null : difference ?? "(second output is a prefix of the first)",
        afterRecallIdentical: afterRecall === first
      },
      mcp: { full: await mcpToolCost(locations, "full"), memory: await mcpToolCost(locations, "memory") }
    };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
export {
  commonPrefixLength,
  mcpToolCost,
  runContextBench
};
//# sourceMappingURL=bench-context-PCSEUHZ5.js.map