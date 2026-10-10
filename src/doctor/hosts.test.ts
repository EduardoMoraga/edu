import { expect, it } from 'vitest';
import { hostFiles } from './hosts.js';

it('uses USERPROFILE and APPDATA for Windows host locations', () => {
  const files = hostFiles('C:\\Users\\Owner', { USERPROFILE: 'C:\\Users\\Owner', APPDATA: 'C:\\Users\\Owner\\AppData\\Roaming' }, ['codex', 'opencode']);
  expect(files.find((file) => file.relative === '.codex/config.toml')?.path).toBe('C:\\Users\\Owner\\.codex\\config.toml');
  expect(files.find((file) => file.relative === '.config/opencode/opencode.jsonc')?.path).toBe('C:\\Users\\Owner\\AppData\\Roaming\\opencode\\opencode.jsonc');
});
