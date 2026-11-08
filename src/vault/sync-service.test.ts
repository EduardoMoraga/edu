import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINDOWS_TASK, windowsTask } from './sync-service.js';

describe('Windows scheduled sync', () => {
  const task = windowsTask({
    home: 'C:\\Users\\edu', eduHome: 'C:\\Users\\edu\\.edu', node: 'C:\\Program Files\\nodejs\\node.exe',
    cli: 'C:\\Users\\edu\\AppData\\Roaming\\npm\\node_modules\\edu\\dist\\cli.js', minutes: 5,
    args: ['--cloud'], env: { EDU_HOME: 'D:\\100%\\edu' },
  });

  it('runs edu sync every five minutes as the current user through a script', () => {
    expect(task.script).toBe(join('C:\\Users\\edu\\.edu', 'edu-sync.cmd'));
    expect(task.create).toEqual(['/Create', '/F', '/TN', WINDOWS_TASK, '/SC', 'MINUTE', '/MO', '5', '/TR', `"${task.script}"`]);
    expect(task.create).not.toContain('/RU');
    expect(task.remove).toEqual(['/Delete', '/F', '/TN', WINDOWS_TASK]);
    expect(task.query).toEqual(['/Query', '/TN', WINDOWS_TASK]);
  });

  it('writes the resolved node and CLI paths, quoted, with batch escaping', () => {
    expect(task.content.split('\r\n')).toEqual([
      '@echo off',
      'set "EDU_HOME=D:\\100%%\\edu"',
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\edu\\AppData\\Roaming\\npm\\node_modules\\edu\\dist\\cli.js" sync --reason timer --cloud',
      '',
    ]);
  });

  it('defaults the script to ~/.edu', () => {
    expect(windowsTask({ home: 'C:\\Users\\edu', node: 'n', cli: 'c' }).script).toBe(join('C:\\Users\\edu', '.edu', 'edu-sync.cmd'));
  });
});
