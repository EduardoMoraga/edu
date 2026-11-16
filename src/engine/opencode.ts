import type { EngineRunRequest } from '../core/contracts.js';
import { measuredEngine } from './measurement.js';
import { autonomyFlags, engineCapabilities } from './autonomy.js';
import type { CliId, Engine } from '../core/contracts.js';
import { combinePrompt, endEvent, errorText, makeUsage, num, parseJson, str, textEvent, toolCall, toolResult, type ParseContext } from './parse.js';
import { binaryAvailable, runJsonlProcess, type CommandSpec } from './process.js';

export function buildOpencodeArgv(req: EngineRunRequest): CommandSpec {
  // No `--dir`: OpenCode 2.x dropped it. The process starts in `req.cwd`, which every version works in.
  const args = ['run', '--format', 'json', '--thinking', ...autonomyFlags('opencode', req.autonomy)];
  if (req.model) args.push('--model', req.model);
  if (req.resumeSessionId) args.push('--session', req.resumeSessionId);
  // OpenCode has no system-prompt option, so Edu's instructions travel labelled with the task. `--` ends
  // option parsing: a task such as `--model x` stays the message.
  args.push('--', combinePrompt(req.systemPrompt, req.prompt));
  return { command: 'opencode', args };
}

export function parseLine(line: string, ctx: ParseContext) {
  const data = parseJson(line);
  if (!data) return [];
  const type = str(data.type) ?? '';
  const session = str(data.sessionID) ?? str(data.sessionId) ?? str(data.session_id);
  if (session) ctx.sessionId = session;
  const part = data.part && typeof data.part === 'object' ? data.part as Record<string, unknown> : data;
  if (type === 'error') {
    ctx.ok = false;
    ctx.lastError = errorText(data.error) ?? errorText(data.message) ?? 'OpenCode reported an error';
    return [];
  }
  if (type === 'text' && typeof part.text === 'string') {
    ctx.summary = part.text;
    ctx.finished = true;
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
    ctx.finished = true;
    if (part.reason === 'error') ctx.ok = false;
    const tokens = part.tokens && typeof part.tokens === 'object' ? part.tokens as Record<string, unknown> : {};
    const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache as Record<string, unknown> : {};
    // OpenCode counts reasoning apart from output and bills it as output.
    const output = num(tokens.output);
    const reasoning = num(tokens.reasoning);
    return makeUsage({ ...ctx, cli: 'opencode' }, {
      input_tokens: tokens.input,
      output_tokens: output === undefined ? undefined : output + (reasoning ?? 0),
      cache_read_tokens: cache.read,
      cache_write_tokens: cache.write,
      cost_usd: part.cost,
    }, 'exclusive-cache');
  }
  return [];
}

/** OpenCode has no end record: a clean exit succeeds only with no reported error and some finished output. */
export function finalizeOpencode(ctx: ParseContext) {
  const ok = ctx.ok !== false && ctx.finished === true;
  const summary = ok ? ctx.summary ?? '' : ctx.lastError ?? (ctx.finished ? 'OpenCode step failed' : 'OpenCode exited without producing a result');
  return [endEvent(ctx, ok, summary, ctx.sessionId)];
}

export const opencodeEngine: Engine = measuredEngine({
  capabilities: engineCapabilities('opencode'),
  cli: 'opencode' as CliId,
  available: () => binaryAvailable('opencode'),
  run: (req, agentId) => runJsonlProcess(
    buildOpencodeArgv(req), req.cwd, agentId, (line, ctx) => parseLine(line, Object.assign(ctx, { cli: 'opencode' as const })), req.signal,
    (_exitCode, ctx) => finalizeOpencode(ctx),
  ),
});
