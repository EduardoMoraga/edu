import { measuredEngine } from '../engine/measurement.js';
/** A single read only conversation turn on the configured CLI. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Brain } from '../brain/index.js';
import { buildContext } from '../context/index.js';
import type { CliId, EduConfig, EduEvent, Engine } from '../core/contracts.js';

export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface ChatHistory { turns: ChatTurn[]; sessionId?: string }
export type ChatResult = { kind: 'chat'; text: string } | { kind: 'task'; goal: string };

export interface RespondOptions {
  message: string;
  history: ChatHistory;
  config: EduConfig;
  brain: Brain;
  engines: (cli: CliId) => Engine;
  cwd: string;
  onEvent(event: EduEvent): void | Promise<void>;
  signal?: AbortSignal;
  /** Primary brain contract, when the brain is global rather than `<cwd>/.edu`. */
  contractPath?: string;
  /** `/ask` bypasses task routing for this turn. */
  forceChat?: boolean;
}

const ROUTING_RULE = 'If the user asks for work that should change files or needs a multi-step team, reply with exactly one line `TASK: <the goal, restated precisely>` and nothing else. Otherwise answer directly and concisely in the user\'s language, citing note ids like [[D-…]] and stating claim bands.';
const CHAT_AGENT = 'edu';

function contractCore(source: string): string {
  const marked = /<!-- edu:core -->([\s\S]*?)<!-- \/edu:core -->/.exec(source)?.[1];
  return (marked ?? source.split('<!-- edu:extended -->', 1)[0] ?? source).trim();
}

function promptFor(message: string, history: ChatHistory): string {
  const turns = history.turns.slice(-6);
  return [...turns.map(turn => `${turn.role === 'user' ? 'User' : 'Edu'}: ${turn.content}`), `User: ${message}`].join('\n\n');
}

/** Builds a recalled context pack, asks the configured CLI, and classifies its answer. */
export async function respond(options: RespondOptions): Promise<ChatResult> {
  const { message, history, config, brain, engines, cwd, onEvent, signal } = options;
  const contractPath = options.contractPath ?? join(cwd, '.edu', 'EDU.md');
  const [pack, contract] = await Promise.all([
    buildContext(brain, { query: message, budgetTokens: config.context.budgetTokens }, { eduMdPath: contractPath }),
    readFile(contractPath, 'utf8'),
  ]);
  const at = () => new Date().toISOString();
  const noteIds = [...new Set(pack.sections.flatMap(section => section.noteIds))];
  await onEvent({ type: 'brain.recall', agentId: CHAT_AGENT, noteIds, at: at() });
  await onEvent({ type: 'agent.spawn', agentId: CHAT_AGENT, role: 'lead', cli: config.defaultCli, task: message, at: at() });
  await onEvent({ type: 'agent.status', agentId: CHAT_AGENT, status: 'running', at: at() });

  const systemPrompt = [contractCore(contract), pack.text, ROUTING_RULE, options.forceChat ? 'For this /ask turn, answer directly; do not use TASK routing.' : ''].filter(Boolean).join('\n\n');
  const pending: EduEvent[] = [];
  let output = '';
  let sessionId: string | undefined;
  let ended = false;
  let ok = true;
  try {
    for await (const event of measuredEngine(engines(config.defaultCli)).run({
      invocation: { id: crypto.randomUUID(), purpose: 'chat' },
      cli: config.defaultCli, prompt: promptFor(message, history), systemPrompt, cwd,
      autonomy: 'readonly', resumeSessionId: history.sessionId, signal,
    }, CHAT_AGENT)) {
      if (event.type === 'agent.text') output += event.text;
      else if (event.type === 'agent.end') {
        ended = true;
        ok = event.ok;
        sessionId = event.sessionId;
      } else pending.push(event);
    }
    const text = output.trim();
    if (!ok) throw new Error('Edu chat engine failed');
    if (!text) throw new Error('Edu chat engine returned no answer');
    await onEvent({ type: 'agent.text', agentId: CHAT_AGENT, text, at: at() });
    for (const event of pending) await onEvent(event);
    await onEvent({ type: 'agent.end', agentId: CHAT_AGENT, ok: true, summary: text, ...(sessionId ? { sessionId } : {}), at: at() });
    history.turns.push({ role: 'user', content: message }, { role: 'assistant', content: text });
    history.turns.splice(0, Math.max(0, history.turns.length - 6));
    if (sessionId) history.sessionId = sessionId;
    const task = !options.forceChat && /^TASK: ([^\r\n]+)$/.exec(text);
    return task ? { kind: 'task', goal: task[1]!.trim() } : { kind: 'chat', text };
  } catch (error) {
    for (const event of pending) await onEvent(event);
    await onEvent({ type: 'agent.end', agentId: CHAT_AGENT, ok: false, summary: error instanceof Error ? error.message : String(error), ...(ended && sessionId ? { sessionId } : {}), at: at() });
    throw error;
  }
}
