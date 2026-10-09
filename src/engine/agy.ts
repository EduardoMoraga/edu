import type { EngineRunRequest } from '../core/contracts.js';
import { makeEngine } from './adapter.js';
import { autonomyFlags } from './autonomy.js';
import { SYSTEM_PROMPT_SEPARATOR } from './codex.js';
import { endEvent, makeUsage, parseJson, str, textEvent, toolCall, toolResult, type ParseContext } from './parse.js';
import type { CommandSpec } from './process.js';

export function buildAgyArgv(req: EngineRunRequest): CommandSpec {
  const prompt = req.systemPrompt ? `${req.systemPrompt}${SYSTEM_PROMPT_SEPARATOR}${req.prompt}` : req.prompt;
  const args = ['-p', prompt, '--output-format', 'stream-json', ...autonomyFlags('agy', req.autonomy)];
  if (req.model) args.push('--model', req.model);
  if (req.resumeSessionId) args.push('--conversation', req.resumeSessionId);
  return { command: 'agy', args };
}

export function parseLine(line: string, ctx: ParseContext) {
  const data = parseJson(line);
  if (!data) return [];
  const event = str(data.event) ?? '';
  const session = str(data.conversation_id);
  if (session) ctx.sessionId = session;
  if (event === 'step_update') {
    const step = data.step_update && typeof data.step_update === 'object' ? data.step_update as Record<string, unknown> : {};
    const stepSession = str(step.conversation_id);
    if (stepSession) ctx.sessionId = stepSession;
    if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') return [textEvent(ctx, step.text_delta)];
    if (step.step_type === 'tool' && step.tool_info && typeof step.tool_info === 'object') {
      const info = step.tool_info as Record<string, unknown>;
      const name = str(info.name) ?? 'tool';
      const callId = `${ctx.sessionId ?? ctx.agentId}-tool-${String(step.step_index ?? 'unknown')}`;
      const events = [toolCall(ctx, name, info.parameters ?? {}, callId)];
      events.push(toolResult(ctx, info.output ?? info.error, callId, info.error === undefined));
      return events;
    }
    return [];
  }
  if (event === 'result') {
    const result = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : {};
    const resultSession = str(result.conversation_id);
    if (resultSession) ctx.sessionId = resultSession;
    const events = result.usage && typeof result.usage === 'object'
      ? makeUsage(ctx, result.usage as Record<string, unknown>) : [];
    const status = str(result.status) ?? '';
    events.push(endEvent(ctx, status === 'SUCCESS', str(result.response) ?? str(result.error) ?? '', ctx.sessionId));
    return events;
  }
  return [];
}

export const agyEngine = makeEngine('agy', 'agy', buildAgyArgv, parseLine);
