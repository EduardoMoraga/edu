import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { eduFrom } from './deck-edu.ts';
import {
  TABS,
  agentByPrefix,
  completed,
  confirmAsked,
  confirmCleared,
  createTree,
  crewDecided,
  isStopping,
  spawned,
  stopRequested,
  tabChosen,
  toolRan,
} from './deck-model.ts';
import { pressKey, statusText } from './deck-view.tsx';
import type { TreeActions } from './deck-view.tsx';
import { WORDS, logLine, lookChoice, resolveLang, wordsFor } from './deck-words.ts';

const spawnOne = (now = 1000) =>
  spawned(createTree(0), { agentId: 'agent-1234567890', agentType: 'Explore', description: 'Read code', prompt: 'Read it.', background: false, fork: false }, now);

describe('deck model (ported from Agent Tree) with the Edu tab', () => {
  it('puts the Edu tab right after the tree', () => {
    expect(TABS).toEqual(['tree', 'edu', 'reports', 'files', 'log', 'usage', 'help']);
    expect(tabChosen(createTree(0), 'edu').tab).toBe('edu');
    expect(tabChosen(createTree(0), 'nope').tab).toBeUndefined();
  });

  it('asks before a crew verdict, and leaving the tab or cancelling forgets the question', () => {
    const asked = confirmAsked(createTree(0), 'abcd1234', 'approve');
    expect(asked.confirming).toEqual({ jobId: 'abcd1234', verdict: 'approve' });
    expect(confirmCleared(asked)).not.toHaveProperty('confirming');
    expect(tabChosen(asked, 'log')).not.toHaveProperty('confirming');
    const plain = createTree(0);
    expect(confirmCleared(plain)).toBe(plain);
  });

  it('logs a crew verdict', () => {
    const s = crewDecided(createTree(0), 'abcd1234', 'reject', 5);
    expect(s.log.at(-1)).toMatchObject({ at: 5, source: 'session', kind: 'crew' });
    expect(logLine(s.log.at(-1)!)).toBe('Crew run abcd1234 rejected');
  });

  it('tracks a sub-agent from spawn through a stop request to its end', () => {
    let s = spawnOne();
    s = toolRan(s, { agentId: 'agent-1234567890', label: 'Read auth.ts', kind: 'read', file: '/x/auth.ts' }, 1100);
    expect(s.agents[0]).toMatchObject({ status: 'running', toolCount: 1, read: ['auth.ts'] });
    expect(agentByPrefix(s, 'agent-12')?.id).toBe('agent-1234567890');
    s = stopRequested(s, 'agent-1234567890', 1200);
    expect(isStopping(s, 'agent-1234567890')).toBe(true);
    s = completed(s, { agentId: 'agent-1234567890', answer: 'stopped', reason: 'answer', isAborted: false, durationMs: 300 }, 1300);
    expect(s.agents[0]?.status).toBe('done');
    expect(isStopping(s, 'agent-1234567890')).toBe(false);
  });
});

describe('status line', () => {
  const edu = eduFrom(JSON.stringify({ version: 1, jobs: [{ id: 'abcd1234', status: 'running' }, { id: 'beef5678', status: 'done' }] }), 0);

  it('counts sub-agents and active crew jobs', () => {
    expect(statusText(createTree(0))).toBeUndefined();
    expect(statusText(createTree(0), 'en', edu)).toBe('Crew [1]');
    expect(statusText(spawnOne(), 'en', edu)).toMatch(/^Sub-agents \[1\/1\] · Crew \[1\]/);
  });
});

describe('pane keys', () => {
  const actions = () => {
    const calls: unknown[][] = [];
    const record = (name: string) => (...args: unknown[]) => calls.push([name, ...args]);
    const names = ['select', 'pick', 'choose', 'effort', 'close', 'detail', 'stop', 'write', 'advisor', 'fast', 'look', 'restyle', 'restyleDefault', 'deselect', 'tab', 'logFilter', 'report', 'eduRefresh', 'eduAsk', 'eduConfirm', 'eduCancel'];
    return { calls, actions: Object.fromEntries(names.map(name => [name, vi.fn(record(name))])) as unknown as TreeActions };
  };

  it('routes the Edu keys', () => {
    const { calls, actions: a } = actions();
    for (const key of ['edu:refresh', 'edu:open', 'edu:approve:abcd1234', 'edu:reject:abcd1234', 'edu:confirm', 'edu:cancel']) expect(pressKey(a, key)).toBe(true);
    expect(calls).toEqual([['eduRefresh'], ['tab', 'edu'], ['eduAsk', 'abcd1234', 'approve'], ['eduAsk', 'abcd1234', 'reject'], ['eduConfirm'], ['eduCancel']]);
  });

  it('leaves unknown keys to the engine', () => {
    const { calls, actions: a } = actions();
    for (const key of ['edu:approve:', 'edu:delete:x', 'nothing', 'tab:nope']) expect(pressKey(a, key)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('still routes the Agent Tree keys', () => {
    const { calls, actions: a } = actions();
    expect(pressKey(a, 'halt:agent-1')).toBe(true);
    expect(pressKey(a, 'choose:new:sonnet')).toBe(true);
    expect(pressKey(a, 'effort:main:default')).toBe(true);
    expect(calls).toEqual([['stop', 'agent-1'], ['choose', 'new', 'sonnet'], ['effort', 'main', undefined]]);
  });
});

describe('words', () => {
  it('speaks English and names the Edu Deck, never Agent Tree', async () => {
    expect(resolveLang()).toBe('en');
    expect(wordsFor('de')).toBe(WORDS.en);
    expect(Object.keys(WORDS)).toEqual(['en']);
    const source = await readFile(new URL('./deck-words.ts', import.meta.url), 'utf8');
    // The licence header names the upstream project; the words below it never do.
    const words = source.replace(/^(?:\/\/.*\n)+/, '');
    expect(words).not.toMatch(/Agent Tree|agent-tree|MikeGT4/);
    expect(WORDS.en.commandHint).toMatch(/refresh/);
    expect(WORDS.en.stopAnswer(2)).toBe('Stopped by the user in Edu Deck after 2 tool calls.');
    expect(WORDS.en.correctionFrame('Use the cache', 'SubagentHandback')).toMatch(/^Message from the user via Edu Deck: Use the cache/);
  });

  it('every ported module names Agent Tree, its source and its licence, and the notice lists it', async () => {
    const notice = await readFile(new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
    expect(notice).toMatch(/Source: https:\/\/github\.com\/MikeGT4\/agent-tree\n/);
    expect(notice).toMatch(/Copyright \(c\) 2026 Mike Pollow, Digitalroots/);
    for (const name of ['deck.tsx', 'deck-model.ts', 'deck-looks.ts', 'deck-view.tsx', 'deck-tabs.tsx', 'deck-words.ts', 'deck-state.d.ts']) {
      const head = (await readFile(new URL(`./${name}`, import.meta.url), 'utf8')).split('\n').slice(0, 3).join('\n');
      expect(head, name).toBe([
        '// Edu Deck. Ported from Agent Tree 0.7.5 (https://github.com/MikeGT4/agent-tree, commit 2b5ab2d).',
        '// Copyright (c) 2026 Mike Pollow, Digitalroots. MIT License, full text in THIRD_PARTY_NOTICES.md.',
        '// Edu changes: Copyright (c) 2026 Eduardo Moraga. MIT License.',
      ].join('\n'));
      expect(notice, name).toContain(name === 'deck.tsx' ? 'templates/claude-mod/deck.tsx' : `\`${name}\``);
    }
  });

  it('reads look commands in English', () => {
    expect(lookChoice('style', 'hud')).toEqual({ row: 'style', id: 'hud' });
    expect(lookChoice('glow', 'gold')).toEqual({ row: 'light', id: 'gold' });
    expect(lookChoice('stil', 'hud')).toBeUndefined();
  });
});
