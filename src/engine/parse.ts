import type { CliId, EduEvent, Usage } from '../core/contracts.js';

export interface ParseContext {
  agentId: string;
  cli?: CliId;
  at?: string;
  sessionId?: string;
  summary?: string;
  usage?: Usage;
  ok?: boolean;
  /** The last failure the CLI reported, used when it ends (or exits) without a better summary. */
  lastError?: string;
  /** Set once the CLI produced its final answer or a finished step (adapters without an end record). */
  finished?: boolean;
}

export function eventAt(ctx: ParseContext): string {
  return ctx.at ?? new Date().toISOString();
}

export function parseJson(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * One prompt for a CLI with no separate system-prompt option: Edu's instructions first, then the user's
 * task, each under its own heading so the task is never read as part of the instructions. A labelled
 * prompt starts with `#`, so a CLI that takes it as an option value never mistakes it for a flag.
 */
export function combinePrompt(systemPrompt: string | undefined, task: string, alwaysLabel = false): string {
  if (!systemPrompt) return alwaysLabel ? `## User task\n${task}` : task;
  return `## System instructions\n${systemPrompt}\n\n## User task\n${task}`;
}

/** A CLI error as text: a string, `{ message }`, or OpenCode's `{ name, data: { message } }`. */
export function errorText(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
  return str(record.message) || str(data.message) || str(record.error) || str(record.name) || undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function makeUsage(ctx: ParseContext, values: Record<string, unknown>, inputSemantics: NonNullable<Usage['inputSemantics']> = 'inclusive-cache'): EduEvent[] {
  const pick = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const found = num(values[key]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const usage: Usage = {
    inputTokens: pick('input_tokens', 'inputTokens', 'prompt_tokens', 'input') ?? 0,
    outputTokens: pick('output_tokens', 'outputTokens', 'completion_tokens', 'output') ?? 0,
  };
  const cacheReadTokens = pick('cache_read_input_tokens', 'cached_input_tokens', 'cache_read_tokens', 'cacheReadTokens', 'cacheRead');
  const cacheWriteTokens = pick('cache_creation_input_tokens', 'cache_write_tokens', 'cache_write_input_tokens', 'cacheWriteTokens', 'cacheWrite');
  const costUsd = pick('cost_usd', 'costUsd', 'total_cost_usd', 'cost');
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
  if (costUsd !== undefined) usage.costUsd = costUsd;
  usage.known = {
    inputTokens: pick('input_tokens', 'inputTokens', 'prompt_tokens', 'input') !== undefined,
    outputTokens: pick('output_tokens', 'outputTokens', 'completion_tokens', 'output') !== undefined,
    cacheReadTokens: cacheReadTokens !== undefined, cacheWriteTokens: cacheWriteTokens !== undefined, costUsd: costUsd !== undefined,
  };
  usage.raw = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }), ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }), ...(costUsd === undefined ? {} : { costUsd }) };
  if (!usage.known.inputTokens) delete usage.raw.inputTokens;
  if (!usage.known.outputTokens) delete usage.raw.outputTokens;
  usage.inputSemantics = ctx.cli === 'agy' ? 'unknown' : inputSemantics;
  if (usage.inputSemantics === 'exclusive-cache') {
    usage.inputTokens += (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
    usage.known.inputTokens &&= cacheReadTokens !== undefined && cacheWriteTokens !== undefined;
  } else if (usage.inputSemantics === 'unknown') usage.known.inputTokens = false;
  return [{ type: 'usage', agentId: ctx.agentId, usage, at: eventAt(ctx) }];
}

export function textEvent(ctx: ParseContext, text: string, thinking = false): EduEvent {
  return { type: thinking ? 'agent.thinking' : 'agent.text', agentId: ctx.agentId, text, at: eventAt(ctx) };
}

export function endEvent(ctx: ParseContext, ok = true, summary = '', sessionId?: string): EduEvent {
  const id = sessionId ?? ctx.sessionId;
  return { type: 'agent.end', agentId: ctx.agentId, ok, summary, ...(id ? { sessionId: id } : {}), at: eventAt(ctx) };
}

export function toolCall(ctx: ParseContext, name: string, input: unknown, callId?: string): EduEvent {
  return {
    type: 'tool.call', agentId: ctx.agentId, tool: name,
    callId: callId ?? `${ctx.agentId}-${name}-${eventAt(ctx)}`,
    input: typeof input === 'string' ? input : JSON.stringify(input ?? {}), at: eventAt(ctx),
  };
}

export function toolResult(ctx: ParseContext, output: unknown, callId?: string, ok = true): EduEvent {
  return {
    type: 'tool.result', agentId: ctx.agentId, callId: callId ?? `${ctx.agentId}-tool-${eventAt(ctx)}`,
    ok, output: typeof output === 'string' ? output : JSON.stringify(output ?? ''), at: eventAt(ctx),
  };
}
