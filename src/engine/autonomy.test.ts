import { describe, expect, it } from 'vitest';
import { autonomyFlags } from './autonomy.js';

describe('builder autonomy flags', () => {
  it('allows Claude auto builders to run Bash while keeping readonly in plan mode', () => {
    expect(autonomyFlags('claude', 'auto')).toEqual(['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash']);
    expect(autonomyFlags('claude', 'readonly')).toEqual(['--permission-mode', 'plan']);
  });

  it('keeps Codex auto scoped to workspace writes', () => {
    expect(autonomyFlags('codex', 'auto')).toEqual(['-s', 'workspace-write']);
  });
});
