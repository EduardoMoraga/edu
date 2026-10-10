import { describe, expect, it } from 'vitest';
import type { EduEvent } from '../core/contracts.js';
import { watchCrew, type CrewSource } from './crew.js';
import { initialState, reduce } from './state.js';

describe('edu watch orchestration spec', () => {
  it('passes spec.ready through to the TUI spec card', async () => {
    const at = '2026-01-01T00:00:00.000Z';
    const spec: EduEvent = { type: 'spec.ready', path: '/workspace/.edu/specs/spec.md',
      requirements: [{ id: 'R-1', text: 'Works' }], checks: [], steps: [], at };
    const source: CrewSource = {
      list: async () => [{ id: 'job-1', cli: 'claude', task: 'Goal', status: 'running', createdAt: at }],
      read: async () => ({ events: [spec], offset: 1 }),
    };
    let state = initialState;
    for await (const event of watchCrew(source, { follow: false, now: () => new Date(at) })) state = reduce(state, event);
    expect(state.spec).toMatchObject({ path: spec.path, requirements: 1, checks: 0 });
  });
});
