import { describe, expect, it } from 'vitest';
import { containsPatch, mergeJson, mergeJsonFile, parseJsonFile, unmergeJson, unmergeJsonFile, mergeToml, unmergeToml } from './merge.js';

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
    const body = '[mcp_servers.edu]\ncommand = "edu"\nargs = ["mcp"]';
    const source = '[mcp_servers.other]\ncommand = "other"\n';
    const merged = mergeToml(source, body);
    expect(mergeToml(merged, body)).toBe(merged);
    expect(unmergeToml(merged)).toBe(source);
    expect(unmergeToml(mergeToml('key = 1', body))).toBe('key = 1');
    expect(() => mergeToml('[mcp_servers.edu]\ncommand = "custom"\n', body)).toThrow(/Unmanaged/);
  });

  it('keeps top-level keys like Codex notify out of the preceding table scope', () => {
    const body = 'notify = ["edu", "hook", "codex-notify"]\n\n[mcp_servers.edu]\ncommand = "edu"';
    const source = 'model = "gpt-5"\n\n[mcp_servers.engram]\ncommand = "engram"\n';
    const merged = mergeToml(source, body);
    const firstTable = merged.indexOf('[mcp_servers.engram]');
    expect(merged.indexOf('notify =')).toBeLessThan(firstTable);
    expect(mergeToml(merged, body)).toBe(merged);
    expect(unmergeToml(merged)).toBe(source);
  });

  it('never adds notify when the user already owns a top-level notify', () => {
    const source = 'notify = ["my-tool"]\n';
    const merged = mergeToml(source, 'notify = ["edu", "hook", "codex-notify"]\n\n[mcp_servers.edu]\ncommand = "edu"');
    expect(merged.match(/notify =/g)).toHaveLength(1);
    expect(unmergeToml(merged)).toBe(source);
  });
});

describe('$union array patches', () => {
  const patch = { plugin: { $union: ['/h/edu.tsx'] } };

  it('adds once to a shared JSON array and removes only its own items', () => {
    const original = '{"plugin":["a","/h/edu.tsx-not"],"theme":"x"}\n';
    const merged = mergeJsonFile('/h/tui.json', original, patch);
    expect(JSON.parse(merged)).toEqual({ plugin: ['a', '/h/edu.tsx-not', '/h/edu.tsx'], theme: 'x' });
    expect(mergeJsonFile('/h/tui.json', merged, patch)).toBe(merged);
    expect(JSON.parse(unmergeJsonFile('/h/tui.json', merged, patch))).toEqual({ plugin: ['a', '/h/edu.tsx-not'], theme: 'x' });
    expect(containsPatch(JSON.parse(merged), patch)).toBe(true);
    expect(containsPatch(JSON.parse(original), patch)).toBe(false);
  });

  it('edits JSONC in place and round-trips byte for byte, comments included', () => {
    const original = '{\n  // plugins\n  "plugin": [\n    "./herdr.js", // keep me\n  ],\n}\n';
    const merged = mergeJsonFile('/h/tui.jsonc', original, patch);
    expect(merged).toContain('// plugins');
    expect(merged).toContain('"./herdr.js", // keep me');
    expect(parseJsonFile('/h/tui.jsonc', merged)).toEqual({ plugin: ['/h/edu.tsx', './herdr.js'] });
    expect(mergeJsonFile('/h/tui.jsonc', merged, patch)).toBe(merged);
    expect(unmergeJsonFile('/h/tui.jsonc', merged, patch)).toBe(original);
  });
});
