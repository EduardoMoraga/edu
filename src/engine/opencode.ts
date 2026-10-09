import type { EngineRunRequest } from '../core/contracts.js';
import { autonomyFlags } from './autonomy.js';
import type { CliId, Engine } from '../core/contracts.js';
import { endEvent, makeUsage, parseJson, str, textEvent, toolCall, toolResult, type ParseContext } from './parse.js';
import { binaryAvailable, runJsonlProcess, type CommandSpec } from './process.js';

export function buildOpencodeArgv(req: EngineRunRequest): CommandSpec {
  const args = ['run', '--format', 'json', '--thinking', '--dir', req.cwd, ...autonomyFlags('opencode', req.autonomy)];
  if (req.model) args.push('--model', req.model);
  if (req.resumeSessionId) args.push('--session', req.resumeSessionId);
  args.push(req.prompt);
  return { command: 'opencode', args };
}

export function parseLine(line: string, ctx: ParseContext) {
  const data = parseJson(line);
  if (!data) return [];
  const type = str(data.type) ?? '';
  const session = str(data.sessionID) ?? str(data.sessionId) ?? str(data.session_id);
  if (session) ctx.sessionId = session;
  const part = data.part && typeof data.part === 'object' ? data.part as Record<string, unknown> : data;
  if (type === 'text' && typeof part.text === 'string') {
    ctx.summary = part.text;
    return [textEvent(ctx, part.text)];
  }
  if (part.type === 'reasoning' && typeof part.text === 'string') return [textEvent(ctx, part.text, true)];
  if (part.type === 'tool') {
    const state = part.state && typeof part.state === 'object' ? part.state as Record<string, unknown> : {};
    const callId = str(part.callID) ?? str(part.id);
    if (type === 'tool_use' && (state.status === 'completed' || state.status === 'error')) {
      return [
        toolCall(ctx, str(part.tool) ?? 'tool', state.input ?? {}, callId),
        toolResult(ctx, state.output ?? state.error, callId, state.status === 'completed'),
      ];
    }
    if (state.status === 'completed' || state.status === 'error') return [toolResult(ctx, state.output ?? state.error, callId, state.status === 'completed')];
    return [toolCall(ctx, str(part.tool) ?? str(part.name) ?? 'tool', state.input ?? part.input, callId)];
  }
  if (type === 'step_finish' && part.type === 'step-finish') {
    const tokens = part.tokens && typeof part.tokens === 'object' ? part.tokens as Record<string, unknown> : {};
    const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache as Record<string, unknown> : {};
    return makeUsage(ctx, {
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_read_tokens: cache.read,
      cache_write_tokens: cache.write,
      cost_usd: part.cost,
    });
  }
  return [];
}

export function finalizeOpencode(ctx: ParseContext) {
  return [endEvent(ctx, true, ctx.summary ?? '', ctx.sessionId)];
}

export const opencodeEngine: Engine = {
  cli: 'opencode' as CliId,
  available: () => binaryAvailable('opencode'),
  run: (req, agentId) => runJsonlProcess(
    buildOpencodeArgv(req), req.cwd, agentId, parseLine, req.signal,
    (_exitCode, ctx) => finalizeOpencode(ctx),
  ),
};
