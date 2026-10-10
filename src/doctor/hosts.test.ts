import { expect, it } from 'vitest';
import { join } from 'node:path';
import { hostFiles } from './hosts.js';

it('uses USERPROFILE and APPDATA for Windows host locations', () => {
  const files = hostFiles('C:\\Users\\Owner', { USERPROFILE: 'C:\\Users\\Owner', APPDATA: 'C:\\Users\\Owner\\AppData\\Roaming' }, ['codex', 'opencode']);
  expect(files.find((file) => file.relative === '.codex/config.toml')?.path).toBe('C:\\Users\\Owner\\.codex\\config.toml');
  expect(files.find((file) => file.relative === '.config/opencode/opencode.jsonc')?.path).toBe('C:\\Users\\Owner\\AppData\\Roaming\\opencode\\opencode.jsonc');
});

it('includes the OpenCode TUI config files that hold TUI plugins', () => {
  const files = hostFiles('/home/me', {}, ['opencode']);
  expect(files.filter((file) => file.relative.startsWith('.config/opencode/tui.')).map(({ relative, kind }) => [relative, kind])).toEqual([
    ['.config/opencode/tui.json', 'json'], ['.config/opencode/tui.jsonc', 'jsonc'],
  ]);
});

it('includes OpenCode 2 cli.json, where TUI plugins are listed under `plugins`, parsed as JSONC', () => {
  const files = hostFiles('/home/me', {}, ['opencode']);
  expect(files.find((file) => file.relative === '.config/opencode/cli.json')).toEqual({
    host: 'opencode', path: join('/home/me', '.config/opencode/cli.json'), relative: '.config/opencode/cli.json', kind: 'jsonc',
  });
});
