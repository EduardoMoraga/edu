/**
 * Conversation slice of the TUI state: the home view's chat turns. The user
 * side comes from `chat.user`; Edu's side is the chat agent's text (the
 * `edu` agent of src/chat/respond.ts), with the notes it recalled for that
 * answer. Folded by `reduce` in state.ts; pure.
 */
import type { EduEvent } from '../core/contracts.js';

/** Agent id the home chat answers with (src/chat/respond.ts). */
export const CHAT_AGENT_ID = 'edu';

export type ChatTurn =
  | { role: 'user'; text: string; at: number }
  | {
      role: 'edu';
      text: string;
      at: number;
      /** Note ids recalled for this answer. */
      recalled: string[];
      /** Set once the answer ended; `false` when the turn failed. */
      ok?: boolean;
      /** Failure reason, when the turn ended without an answer. */
      error?: string;
    };

export interface ChatState {
  turns: ChatTurn[];
  /** Recalled ids waiting for the next answer to attach to. */
  recalled: string[];
}

export const MAX_CHAT_TURNS = 200;

export const initialChat: ChatState = { turns: [], recalled: [] };

export function reduceChat(c: ChatState, event: EduEvent, at: number): ChatState {
  switch (event.type) {
    case 'chat.user': {
      const text = event.text.trim();
      return text ? push({ ...settle(c), recalled: [] }, { role: 'user', text, at }) : c;
    }
    case 'agent.spawn':
      // A new chat turn starts: a notice still open (home `say`) must not absorb it.
      return event.agentId === CHAT_AGENT_ID ? settle(c) : c;
    case 'brain.recall':
      if (event.agentId !== CHAT_AGENT_ID || event.noteIds.length === 0) return c;
      return { ...c, recalled: [...new Set([...c.recalled, ...event.noteIds])] };
    case 'agent.text': {
      if (event.agentId !== CHAT_AGENT_ID || !event.text.trim()) return c;
      const last = c.turns.at(-1);
      if (last?.role === 'edu' && last.ok === undefined) return replaceLast(c, { ...last, text: last.text + event.text });
      return push({ ...c, recalled: [] }, { role: 'edu', text: event.text, at, recalled: c.recalled });
    }
    case 'agent.end': {
      if (event.agentId !== CHAT_AGENT_ID) return c;
      const last = c.turns.at(-1);
      if (last?.role === 'edu' && last.ok === undefined) return replaceLast(c, { ...last, ok: event.ok, ...(event.ok ? {} : { error: event.summary }) });
      if (event.ok) return c;
      // Failed before answering: the reason becomes the turn.
      return push({ ...c, recalled: [] }, { role: 'edu', text: '', at, recalled: c.recalled, ok: false, error: event.summary });
    }
    default:
      return c;
  }
}

/** Closes an open Edu turn (one that never got an `agent.end`). */
function settle(c: ChatState): ChatState {
  const last = c.turns.at(-1);
  return last?.role === 'edu' && last.ok === undefined ? replaceLast(c, { ...last, ok: true }) : c;
}

function push(c: ChatState, turn: ChatTurn): ChatState {
  const turns = [...c.turns, turn];
  return { ...c, turns: turns.length > MAX_CHAT_TURNS ? turns.slice(turns.length - MAX_CHAT_TURNS) : turns };
}

function replaceLast(c: ChatState, turn: ChatTurn): ChatState {
  return { ...c, turns: [...c.turns.slice(0, -1), turn] };
}
