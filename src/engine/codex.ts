import type { EngineRunRequest } from '../core/contracts.js';
import { makeEngine } from './adapter.js';
import { autonomyFlags } from './autonomy.js';
import { endEvent, makeUsage, parseJson, str, textEvent, toolCall, toolResult, type ParseContext } from './parse.js';
import type { CommandSpec } from './process.js';

export const SYSTEM_PROMPT_SEPARATOR = '\n\n--- System instructions ---\n';

export function buildCodexArgv(req: EngineRunRequest): CommandSpec {
  const prompt = req.systemPrompt ? `${req.systemPrompt}${SYSTEM_PROMPT_SEPARATOR}${req.prompt}` : req.prompt;
  const args = ['exec', '--json', ...autonomyFlags('codex', req.autonomy), '--skip-git-repo-check'];
  if (req.model) args.push('--model', req.model);
  if (req.resumeSessionId) args.push('resume', req.resumeSessionId);
  args.push(prompt);
  return { command: 'codex', args };
}

export function parseLine(line: string, ctx: ParseContext) {
  const data = parseJson(line);
  if (!data) return [];
  const type = str(data.type) ?? '';
  if (type === 'thread.started') {
    ctx.sessionId = str(data.thread_id) ?? ctx.sessionId;
    return [];
  }
  const item = data.item && typeof data.item === 'object' ? data.item as Record<string, unknown> : data;
  const itemType = str(item.type) ?? type;
  const itemId = str(item.id) ?? str(item.call_id);
  if (type === 'item.started' || type === 'item.completed') {
    if (itemType === 'agent_message' || itemType === 'message') {
      return type === 'item.completed' && typeof item.text === 'string' ? [textEvent(ctx, item.text)] : [];
    }
    if (itemType === 'reasoning') {
      const text = str(item.text) ?? str(item.summary);
      return type === 'item.completed' && text !== undefined ? [textEvent(ctx, text, true)] : [];
    }
    if (['command_execution', 'function_call', 'mcp_tool_call', 'tool_call'].includes(itemType)) {
      if (type === 'item.started') return [toolCall(ctx, str(item.name) ?? str(item.command) ?? itemType, item.arguments ?? item.input ?? item.command, itemId)];
      return [toolResult(ctx, item.output ?? item.result ?? item.aggregated_output, itemId, item.status !== 'failed')];
    }
  }
  if (type === 'turn.completed' || type === 'turn.failed') {
    const events = data.usage && typeof data.usage === 'object' ? makeUsage(ctx, data.usage as Record<string, unknown>) : [];
    events.push(endEvent(ctx, type !== 'turn.failed', str(data.error) ?? '', str(data.thread_id)));
    return events;
  }
  if (type === 'response.output_text.delta' && typeof data.delta === 'string') return [textEvent(ctx, data.delta)];
  if (type === 'response.reasoning_summary_text.delta' && typeof data.delta === 'string') return [textEvent(ctx, data.delta, true)];
  return [];
}

export const codexEngine = makeEngine('codex', 'codex', buildCodexArgv, parseLine);
