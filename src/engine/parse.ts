import type { EduEvent, Usage } from '../core/contracts.js';

export interface ParseContext {
  agentId: string;
  at?: string;
  sessionId?: string;
  summary?: string;
  usage?: Usage;
  ok?: boolean;
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

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function makeUsage(ctx: ParseContext, values: Record<string, unknown>): EduEvent[] {
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
