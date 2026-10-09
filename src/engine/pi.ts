import type { EduEvent, EngineRunRequest } from '../core/contracts.js';
import type { Usage } from '../core/contracts.js';
import { makeEngine } from './adapter.js';
import { autonomyFlags } from './autonomy.js';
import { endEvent, makeUsage, parseJson, str, textEvent, toolCall, toolResult, type ParseContext } from './parse.js';
import type { CommandSpec } from './process.js';

export function buildPiArgv(req: EngineRunRequest): CommandSpec {
  const args = ['-p', '--mode', 'json', ...autonomyFlags('pi', req.autonomy)];
  if (req.systemPrompt) args.push('--append-system-prompt', req.systemPrompt);
  if (req.model) args.push('--model', req.model);
  if (req.resumeSessionId) args.push('--session', req.resumeSessionId);
  args.push(req.prompt);
  return { command: 'pi', args };
}

export function parseLine(line: string, ctx: ParseContext) {
  const data = parseJson(line);
  if (!data) return [];
  const type = str(data.type) ?? '';
  if (type === 'session') {
    ctx.sessionId = str(data.id) ?? ctx.sessionId;
    return [];
  }
  const session = str(data.session_id) ?? str(data.sessionId);
  if (session) ctx.sessionId = session;
  const message = data.message && typeof data.message === 'object' ? data.message as Record<string, unknown> : undefined;
  const assistantEvent = data.assistantMessageEvent && typeof data.assistantMessageEvent === 'object'
    ? data.assistantMessageEvent as Record<string, unknown> : undefined;
  if (type === 'message_update' && assistantEvent) {
    const liveUsage = data.usage && typeof data.usage === 'object' ? piUsage(data.usage as Record<string, unknown>) : undefined;
    if (liveUsage) ctx.usage = liveUsage;
    const delta = str(assistantEvent.delta);
    if (assistantEvent.type === 'text_delta' && delta) return [textEvent(ctx, delta)];
    if (assistantEvent.type === 'thinking_delta' && delta) return [textEvent(ctx, delta, true)];
    // Completed message snapshots are authoritative but are intentionally not re-emitted;
    // text/thinking deltas already fed the live stream.
    return [];
  }
  if (type === 'tool_execution_start') {
    return [toolCall(ctx, str(data.toolName) ?? 'tool', data.args, str(data.toolCallId))];
  }
  if (type === 'tool_execution_end') {
    return [toolResult(ctx, data.result, str(data.toolCallId), data.isError !== true)];
  }
  if (type === 'message_end' && message?.role === 'assistant') {
    const content = Array.isArray(message.content) ? message.content : [];
    ctx.summary = content.flatMap((raw) => raw && typeof raw === 'object' && (raw as Record<string, unknown>).type === 'text'
      ? [str((raw as Record<string, unknown>).text) ?? ''] : []).join('');
    if (message.stopReason === 'error') ctx.ok = false;
    else if (message.stopReason) ctx.ok = true;
    const usageRaw = message.usage && typeof message.usage === 'object' ? message.usage as Record<string, unknown> : undefined;
    const usage = usageRaw ? piUsage(usageRaw) : ctx.usage;
    ctx.usage = undefined;
    return usage ? [{ type: 'usage' as const, agentId: ctx.agentId, usage, at: ctx.at ?? new Date().toISOString() }] : [];
  }
  if (type === 'auto_retry_end' && data.success === false) {
    ctx.ok = false;
    return [];
  }
  if (type === 'agent_settled') {
    const events: EduEvent[] = [];
    if (ctx.usage) events.push({ type: 'usage', agentId: ctx.agentId, usage: ctx.usage, at: ctx.at ?? new Date().toISOString() });
    ctx.usage = undefined;
    events.push(endEvent(ctx, data.aborted !== true && ctx.ok !== false, ctx.summary ?? '', ctx.sessionId));
    return events;
  }
  return [];
}

function piUsage(raw: Record<string, unknown>): Usage {
  const cost = raw.cost && typeof raw.cost === 'object' ? raw.cost as Record<string, unknown> : {};
  const event = makeUsage({ agentId: '', at: '' }, { ...raw, cost_usd: cost.total })[0];
  if (!event || event.type !== 'usage') return { inputTokens: 0, outputTokens: 0 };
  return event.usage;
}

export const piEngine = makeEngine('pi', 'pi', buildPiArgv, parseLine);
