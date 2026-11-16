import { describe, expect, it } from 'vitest';
import { scanTomlLines, tomlDefines, tomlEnabledTables, tomlKeyParts, tomlKeys, withoutTomlTable } from './toml.js';

describe('TOML line scanner', () => {
  it('parses bare, double- and single-quoted dotted keys', () => {
    expect(tomlKeyParts('a."b.c".\'d\'')).toEqual(['a', 'b.c', 'd']);
    expect(tomlKeyParts(' mcp_servers . "e\\"du" ')).toEqual(['mcp_servers', 'e"du']);
    expect(tomlKeyParts('a b')).toBeUndefined();
    expect(tomlKeyParts('')).toBeUndefined();
  });

  it('gives every line its table, header, key and line ending', () => {
    const lines = scanTomlLines("top = 1\r\n[[ plugins . 'x@y' ]] # array of tables\n[mcp_servers]\nedu = { command = \"edu\" }\n");
    expect(lines.map(line => [line.text, line.eol])).toEqual([
      ['top = 1', '\r\n'], ["[[ plugins . 'x@y' ]] # array of tables", '\n'], ['[mcp_servers]', '\n'], ['edu = { command = "edu" }', '\n'], ['', ''],
    ]);
    expect(lines[0]).toMatchObject({ table: [], key: ['top'], value: '1', continuation: false });
    expect(lines[1]).toMatchObject({ table: ['plugins', 'x@y'], header: { path: ['plugins', 'x@y'], array: true } });
    expect(lines[3]).toMatchObject({ table: ['mcp_servers'], key: ['edu'] });
  });

  it('marks the rest of multi-line strings, arrays and inline tables as continuation, so a header inside one is not a table', () => {
    const lines = scanTomlLines('doc = """\n[mcp_servers.edu]\n"""\nlist = [\n  "a",\n  [1, 2]\n]\nraw = \'\'\'\nx = 1\n\'\'\'\nafter = true\n');
    expect(lines.filter(line => line.continuation).map(line => line.text)).toEqual(['[mcp_servers.edu]', '"""', '  "a",', '  [1, 2]', ']', 'x = 1', "'''"]);
    expect(lines.some(line => line.header)).toBe(false);
    expect(lines.at(-2)).toMatchObject({ key: ['after'], continuation: false });
  });

  it('keeps keys under an unparseable header out of every real table', () => {
    const lines = scanTomlLines('[not a key]\nedu = 1\n');
    expect(lines[0]!.header).toEqual({ path: undefined, array: false });
    expect(tomlDefines('[not a key]\nedu = 1\n', ['edu'])).toBe(false);
  });
});

describe('TOML keys built on the scanner', () => {
  it('lists header and key paths in every spelling', () => {
    expect(tomlKeys('[mcp_servers]\n"edu" = { command = "x" }\nmcp_servers.other.command = "y"\n').map(key => key.path.join('.')))
      .toEqual(['mcp_servers', 'mcp_servers.edu', 'mcp_servers.mcp_servers.other.command']);
    expect(tomlDefines("[ mcp_servers . 'edu' . env ]\nA = 1\n", ['mcp_servers', 'edu'])).toBe(true);
    expect(tomlDefines('[[mcp_servers.edu]]\n', ['mcp_servers', 'edu'])).toBe(true);
  });

  it('reads which `[root.<name>]` tables are enabled, in table and inline form', () => {
    const states = tomlEnabledTables('[plugins."a@x"]\nenabled = true\n[plugins."a@x".sub]\nenabled = false\n[plugins]\nb = { enabled = false }\n[plugins.c]\nenabled = false # off\n[mcp_servers.d]\n', 'plugins');
    expect([...states]).toEqual([['a@x', true], ['b', false], ['c', false]]);
  });

  it('drops a table and its subtables from a generated body', () => {
    expect(withoutTomlTable('[mcp_servers.edu]\ncommand = "edu"\n[mcp_servers.edu.env]\nA = "1"\n[plugins."x"]\nenabled = true\n', ['mcp_servers', 'edu']))
      .toBe('[plugins."x"]\nenabled = true');
  });
});
