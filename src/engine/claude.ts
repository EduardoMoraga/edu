import type { EngineRunRequest } from '../core/contracts.js';
import { makeEngine } from './adapter.js';
import { autonomyFlags } from './autonomy.js';
import { endEvent, makeUsage, parseJson, str, textEvent, toolCall, toolResult, type ParseContext } from './parse.js';
import type { CommandSpec } from './process.js';

export function buildClaudeArgv(req: EngineRunRequest): CommandSpec {
  // The prompt goes through stdin: no shell quoting, no command-line length limit (Windows caps it).
  const args = ['-p', '--output-format', 'stream-json', '--verbose', ...autonomyFlags('claude', req.autonomy)];
  if (req.systemPrompt) args.push('--append-system-prompt', req.systemPrompt);
  if (req.model) args.push('--model', req.model);
  if (req.resumeSessionId) args.push('--resume', req.resumeSessionId);
  return { command: 'claude', args, stdin: req.prompt };
}

export function parseLine(line: string, ctx: ParseContext) {
  const data = parseJson(line);
  if (!data) return [];
  const type = str(data.type);
  const session = str(data.session_id) ?? str(data.sessionId);
  if (type === 'assistant') {
    const message = data.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    return content.flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const part = raw as Record<string, unknown>;
      if (part.type === 'text' && typeof part.text === 'string') return [textEvent(ctx, part.text)];
      if ((part.type === 'thinking' || part.type === 'redacted_thinking') && typeof part.thinking === 'string') return [textEvent(ctx, part.thinking, true)];
      if (part.type === 'tool_use') return [toolCall(ctx, str(part.name) ?? 'tool', part.input, str(part.id))];
      return [];
    });
  }
  if (type === 'user') {
    const message = data.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    return content.flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const part = raw as Record<string, unknown>;
      return part.type === 'tool_result'
        ? [toolResult(ctx, part.content, str(part.tool_use_id), part.is_error !== true)]
        : [];
    });
  }
  if (type === 'result') {
    const events = data.usage && typeof data.usage === 'object'
      ? makeUsage(ctx, { ...(data.usage as Record<string, unknown>), total_cost_usd: data.total_cost_usd })
      : (typeof data.total_cost_usd === 'number' ? makeUsage(ctx, { cost_usd: data.total_cost_usd }) : []);
    events.push(endEvent(ctx, !String(data.subtype ?? '').includes('error'), str(data.result) ?? '', session));
    return events;
  }
  if (type === 'system' && typeof data.session_id === 'string') {
    ctx.sessionId = data.session_id;
  }
  return [];
}

export const claudeEngine = makeEngine('claude', 'claude', buildClaudeArgv, parseLine);

