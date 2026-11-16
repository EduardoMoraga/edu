import { describe, expect, it } from 'vitest';
import type { Autonomy, CliId } from '../core/contracts.js';
import { autonomyFlags, engineCapabilities, enforcesReadonly, interactiveAutonomyFlags } from './autonomy.js';

describe('builder autonomy flags', () => {
  it('allows Claude auto builders to run Bash while keeping readonly in plan mode', () => {
    expect(autonomyFlags('claude', 'auto')).toEqual(['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash']);
    expect(autonomyFlags('claude', 'readonly')).toEqual(['--permission-mode', 'plan']);
  });

  it('keeps Codex auto scoped to workspace writes', () => {
    expect(autonomyFlags('codex', 'auto')).toEqual(['-s', 'workspace-write']);
  });

  it('never lets a headless ask write: nobody can approve it', () => {
    expect(autonomyFlags('codex', 'ask')).toEqual(['-s', 'read-only']);
    expect(autonomyFlags('codex', 'ask')).not.toEqual(autonomyFlags('codex', 'auto'));
    expect(autonomyFlags('pi', 'ask')).toEqual(autonomyFlags('pi', 'readonly'));
  });

  it('restricts Pi readonly to its documented read-only tools', () => {
    expect(autonomyFlags('pi', 'readonly')).toEqual(['--tools', 'read,grep,find,ls']);
  });

  it('lets interactive Codex ask a person at the pane', () => {
    expect(interactiveAutonomyFlags('codex', 'ask')).toEqual(['-s', 'workspace-write', '-a', 'untrusted']);
    expect(interactiveAutonomyFlags('codex', 'readonly')).toEqual(['-s', 'read-only', '-a', 'never']);
    expect(interactiveAutonomyFlags('claude', 'auto')).toEqual(autonomyFlags('claude', 'auto'));
  });

  it('declares enforced readonly exactly for the CLIs with a readonly flag', () => {
    const levels: Autonomy[] = ['readonly'];
    for (const cli of ['claude', 'codex', 'pi', 'opencode', 'agy'] as CliId[]) {
      const enforced = levels.every(level => autonomyFlags(cli, level).length > 0);
      expect(enforcesReadonly(cli)).toBe(enforced);
      expect(engineCapabilities(cli).readonly).toBe(enforced ? 'enforced' : 'unsupported');
    }
  });
});
