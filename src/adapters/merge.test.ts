import { describe, expect, it } from 'vitest';
import { mergeJson, unmergeJson, mergeToml, unmergeToml } from './merge.js';

describe('configuration merges', () => {
  it('preserves unrelated JSON keys and hooks', () => {
    const source = '{"theme":"dark","hooks":{"SessionStart":[{"matcher":"user"}]}}\n';
    const patch = { mcpServers: { edu: { command: 'edu', args: ['mcp'] } }, hooks: { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'edu hook session-start' }] }] } };
    const merged = mergeJson(source, patch);
    expect(JSON.parse(merged).theme).toBe('dark');
    expect(JSON.parse(merged).hooks.SessionStart).toHaveLength(2);
    expect(mergeJson(merged, patch)).toBe(merged);
    expect(JSON.parse(unmergeJson(merged, patch)).hooks.SessionStart).toHaveLength(1);
  });

  it('keeps user commands when an Edu hook shares their matcher group', () => {
    const patch = { hooks: { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'edu hook session-start' }] }] } };
    const source = JSON.stringify({ hooks: { SessionStart: [{ matcher: '*', hooks: [
      { type: 'command', command: 'user-start' },
      { type: 'command', command: 'edu hook custom' },
      { type: 'command', command: 'edu hook session-start' },
    ] }] } });
    const merged = mergeJson(source, patch);
    const groups = JSON.parse(merged).hooks.SessionStart;
    expect(groups.flatMap((group: { hooks: { command: string }[] }) => group.hooks.map(hook => hook.command))).toEqual(['user-start', 'edu hook custom', 'edu hook session-start']);
    const unmerged = unmergeJson(merged, patch);
    expect(JSON.parse(unmerged).hooks.SessionStart).toEqual([{ matcher: '*', hooks: [{ type: 'command', command: 'user-start' }, { type: 'command', command: 'edu hook custom' }] }]);
  });

  it('adds and removes only a delimited TOML section', () => {
    const source = '[mcp_servers.other]\ncommand = "other"\n';
    const merged = mergeToml(source, 'command = "edu"\nargs = ["mcp"]');
    expect(mergeToml(merged, 'command = "edu"\nargs = ["mcp"]')).toBe(merged);
    expect(unmergeToml(merged)).toBe(source);
    expect(unmergeToml(mergeToml('key = 1', 'command = "edu"'))).toBe('key = 1');
    expect(() => mergeToml('[mcp_servers.edu]\ncommand = "custom"\n', 'command = "edu"')).toThrow(/Unmanaged/);
  });
});
