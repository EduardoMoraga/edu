/**
 * `edu bench context`: what Edu costs in the context window before the agent does any work.
 *
 * - Brief tokens: the text the SessionStart hook injects (`sessionStart` in src/cli/hooks.ts), measured on the
 *   fixture brain with the same estimator Edu uses for its budgets (src/context/tokens.ts).
 * - Brief stability: two session starts with different host session ids. Identical bytes (or a long common
 *   prefix) keep the host's prompt cache warm; every byte after the first difference is re-billed each session.
 *   A third start of the first session after a recall checks that exposure (recall hits) leaves the brief alone.
 * - MCP tool definitions: what a host receives from `tools/list` (name, description, JSON input schema,
 *   annotations), fetched over an in-memory transport, no stdio and no model.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CliContext } from '../cli/context.js';
import { SESSION_BRIEF_TOKENS, sessionStart, workspaceBrief } from '../cli/hooks.js';
import { openBrain } from '../brain/index.js';
import { estimateTokens } from '../context/tokens.js';
import type { BrainLocation } from '../core/contracts.js';
import { createEduMcpServer } from '../mcp/server.js';
import { seedCorpus } from './retrieval.js';

export interface ToolCost { name: string; tokens: number }
export interface ToolProfileCost { tools: number; tokens: number; bytes: number; perTool: ToolCost[] }

export interface ContextReport {
  brief: { budgetTokens: number; tokens: number; bytes: number; hookTokens: number; hookBytes: number };
  stability: {
    identical: boolean;
    firstTokens: number;
    secondTokens: number;
    commonPrefixTokens: number;
    /** Share of the second brief covered by the common prefix (0..1). */
    commonPrefixRatio: number;
    /** First line of the second hook output that differs from the first one (diagnostic). */
    firstDifference: string | null;
    /** The first session's start repeated after a recall is byte-identical to the original start. */
    afterRecallIdentical: boolean;
  };
  mcp: { full: ToolProfileCost; memory: ToolProfileCost };
}

/** Length (code units) of the longest common prefix of two strings. */
export function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

/** A quiet CliContext rooted in `base`: the brain search never leaves it and nothing reaches the terminal. */
function benchContext(base: string, cwd: string, stdin: string, out: string[]): CliContext {
  return {
    cwd,
    env: { HOME: join(base, 'home'), EDU_HOME: join(base, 'home', '.edu'), EDU_CEILING_DIRECTORIES: base, NO_COLOR: '1' },
    home: join(base, 'home'),
    out: text => void out.push(text),
    err: () => undefined,
    readStdin: async () => stdin,
    isTTY: false,
    stdinIsTTY: false,
    confirm: async () => false,
    detectClis: async () => [],
    setExitCode: () => undefined,
  };
}

async function hookOutput(base: string, cwd: string, sessionId: string): Promise<string> {
  const out: string[] = [];
  await sessionStart(benchContext(base, cwd, JSON.stringify({ session_id: sessionId, source: 'startup', cwd }), out), cwd);
  return out.join('\n');
}

/** Tool definitions exactly as a host lists them, per MCP tool profile. */
export async function mcpToolCost(locations: BrainLocation[], profile: 'full' | 'memory'): Promise<ToolProfileCost> {
  const server = createEduMcpServer({ locations, env: {}, toolProfile: profile });
  const client = new Client({ name: 'edu-bench', version: '1.0.0' });
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
      perTool: tools.map(tool => ({ name: tool.name, tokens: estimateTokens(JSON.stringify(tool)) }))
        .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name)),
    };
  } finally {
    await client.close();
    await server.close();
  }
}

export async function runContextBench(options: { tmpRoot?: string } = {}): Promise<ContextReport> {
  const base = await mkdtemp(join(options.tmpRoot ?? tmpdir(), 'edu-bench-context-'));
  try {
    const cwd = join(base, 'project');
    await mkdir(join(base, 'home'), { recursive: true });
    await seedCorpus(join(cwd, '.edu'));
    const plain = await workspaceBrief(benchContext(base, cwd, '', []), cwd);
    if (!plain) throw new Error('bench brain was not initialized');
    const first = await hookOutput(base, cwd, 'bench-session-a');
    const second = await hookOutput(base, cwd, 'bench-session-b');
    await openBrain([{ scope: 'project', root: join(cwd, '.edu') }]).recall('scheduler locks');
    const afterRecall = await hookOutput(base, cwd, 'bench-session-a');
    const prefix = first.slice(0, commonPrefixLength(first, second));
    const firstLines = first.split('\n');
    const difference = second.split('\n').find((line, i) => line !== firstLines[i]);
    const secondTokens = estimateTokens(second);
    const prefixTokens = estimateTokens(prefix);
    const locations: BrainLocation[] = [{ scope: 'project', root: join(cwd, '.edu') }];
    return {
      brief: { budgetTokens: SESSION_BRIEF_TOKENS, tokens: estimateTokens(plain.text), bytes: bytes(plain.text), hookTokens: estimateTokens(first), hookBytes: bytes(first) },
      stability: {
        identical: first === second,
        firstTokens: estimateTokens(first),
        secondTokens,
        commonPrefixTokens: prefixTokens,
        commonPrefixRatio: secondTokens ? Math.round((prefixTokens / secondTokens) * 1e4) / 1e4 : 1,
        firstDifference: first === second ? null : difference ?? '(second output is a prefix of the first)',
        afterRecallIdentical: afterRecall === first,
      },
      mcp: { full: await mcpToolCost(locations, 'full'), memory: await mcpToolCost(locations, 'memory') },
    };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
