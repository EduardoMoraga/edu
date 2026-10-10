import { describe, expect, it } from 'vitest';
import type { EduEvent } from '../core/contracts.js';
import { logLines } from './lines.js';
import { UNICODE_GLYPHS } from '../identity/index.js';
import { parseRunJsonl } from './replay.js';
import { reduceAll } from './state.js';
import { chatEvents } from './fixtures.js';

const at = (s: number) => new Date(Date.parse('2026-10-08T12:00:00.000Z') + s * 1000).toISOString();

describe('chat slice', () => {
  it('folds a user message and Edu answer, attaching the notes recalled for it', () => {
    const { chat } = reduceAll(chatEvents());
    expect(chat.turns).toMatchObject([
      { role: 'user', text: 'Hola' },
      { role: 'edu', text: expect.stringContaining('¡Hola!'), recalled: ['C-entregar-informe-semanal-cheil', 'D-usar-bun'], ok: true },
    ]);
    expect(chat.recalled).toEqual([]);
  });
  it('keeps a home notice (`say`) from absorbing the next chat answer', () => {
    const events: EduEvent[] = [
      ...chatEvents(),
      { type: 'agent.text', agentId: 'edu', text: 'Edu will run this as a task: x', at: at(10) },
      { type: 'chat.user', text: 'and now?', at: at(11) },
      { type: 'agent.spawn', agentId: 'edu', role: 'lead', cli: 'claude', task: 'and now?', at: at(11) },
      { type: 'agent.text', agentId: 'edu', text: 'Second answer', at: at(12) },
      { type: 'agent.end', agentId: 'edu', ok: true, summary: 'Second answer', at: at(12) },
    ];
    const texts = reduceAll(events).chat.turns.map((t) => `${t.role}:${t.text}`);
    expect(texts.slice(2)).toEqual(['edu:Edu will run this as a task: x', 'user:and now?', 'edu:Second answer']);
  });
  it('records a failed turn with its reason', () => {
    const events: EduEvent[] = [
      { type: 'chat.user', text: 'hi', at: at(0) },
      { type: 'agent.spawn', agentId: 'edu', role: 'lead', cli: 'claude', task: 'hi', at: at(0) },
      { type: 'agent.end', agentId: 'edu', ok: false, summary: 'claude is not installed', at: at(1) },
    ];
    expect(reduceAll(events).chat.turns.at(-1)).toMatchObject({ role: 'edu', ok: false, error: 'claude is not installed' });
  });
  it('ignores other agents', () => {
    const events: EduEvent[] = [{ type: 'agent.text', agentId: 'lead-1', text: 'plan', at: at(0) }];
    expect(reduceAll(events).chat.turns).toEqual([]);
  });
});

describe('bus and log without duplicates', () => {
  it('labels the user line `you → edu`, drops the self-spawn, and logs the end as just "done"', () => {
    const bus = reduceAll(chatEvents()).mission.bus.map((e) => `${e.from}>${e.to}:${e.text}`);
    expect(bus[0]).toBe('you>edu:Hola');
    expect(bus.some((l) => l.startsWith('edu>edu'))).toBe(false);
    expect(bus.filter((l) => l.includes('¡Hola!'))).toHaveLength(1);
    expect(bus.at(-1)).toBe('edu>you:done');
  });
  it('keeps an end summary that says something new', () => {
    const events: EduEvent[] = [
      { type: 'agent.spawn', agentId: 'b', role: 'builder', cli: 'codex', task: 't', at: at(0) },
      { type: 'agent.text', agentId: 'b', text: 'working', at: at(1) },
      { type: 'agent.end', agentId: 'b', ok: true, summary: 'Built 3 files', at: at(2) },
    ];
    expect(reduceAll(events).mission.bus.at(-1)?.text).toBe('Built 3 files');
  });
  it('the deck log prints the answer once and then a bare done', () => {
    const agent = reduceAll(chatEvents()).agents.edu!;
    const text = logLines(agent.log, 60, UNICODE_GLYPHS).map((l) => l.map((s) => s.text).join('')).join('\n');
    expect(text.match(/¡Hola!/g)).toHaveLength(1);
    expect(text.trimEnd().split('\n').at(-1)).toBe('✓ done');
  });
});

describe('replay contract', () => {
  it('accepts chat.user and rejects one without text', () => {
    const ok = parseRunJsonl(JSON.stringify({ type: 'chat.user', text: 'Hola', at: at(0) }));
    expect(ok.events).toHaveLength(1);
    const bad = parseRunJsonl(JSON.stringify({ type: 'chat.user', at: at(0) }));
    expect(bad.issues[0]?.message).toContain('"text"');
  });
});
