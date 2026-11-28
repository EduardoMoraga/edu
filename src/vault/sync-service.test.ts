import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHEIL_VAULT_SYNC_TASK, installSchedule, legacySchedules, PREVIOUS_WINDOWS_TASK, replaceLegacySchedules, scheduleStatus, uninstallSchedule, windowsTask } from './sync-service.js';

const roots: string[] = [];
const home = () => { const dir = mkdtempSync(join(tmpdir(), 'edu-schedule-')); roots.push(dir); return dir; };
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const LEGACY_TASKS = new Set([CHEIL_VAULT_SYNC_TASK, PREVIOUS_WINDOWS_TASK]);
const runner = (present: string[] = []) => {
  const calls: string[][] = [];
  return {
    calls,
    run: async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (cmd === 'schtasks' && args[0] === '/Query') {
        const name = args[args.indexOf('/TN') + 1] ?? '';
        if (LEGACY_TASKS.has(name)) return present.includes(name) ? 0 : 1;
      }
      return 0;
    },
  };
};

describe('Windows scheduled sync', () => {
  const task = windowsTask({
    home: 'C:\\Users\\edu', eduHome: 'C:\\Users\\edu\\.edu', node: 'C:\\Program Files\\nodejs\\node.exe',
    cli: 'C:\\Users\\edu\\AppData\\Roaming\\npm\\node_modules\\edu\\dist\\cli.js', minutes: 5,
    args: ['--cloud'], env: { EDU_HOME: 'D:\\100%\\edu' },
  });

  it('runs edu sync every five minutes as the current user through a script', () => {
    expect(task.script).toBe(join('C:\\Users\\edu\\.edu', 'edu-sync-personal.cmd'));
    expect(task.create).toEqual(['/Create', '/F', '/TN', 'EduSync-personal', '/SC', 'MINUTE', '/MO', '5', '/TR', `"${task.script}"`]);
    expect(task.create).not.toContain('/RU');
    expect(task.remove).toEqual(['/Delete', '/F', '/TN', 'EduSync-personal']);
    expect(task.query).toEqual(['/Query', '/TN', 'EduSync-personal']);
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
    expect(windowsTask({ home: 'C:\\Users\\edu', node: 'n', cli: 'c' }).script).toBe(join('C:\\Users\\edu', '.edu', 'edu-sync-personal.cmd'));
  });

  it('names the cheil task and script apart from personal and defaults to 15 minutes', () => {
    const cheil = windowsTask({
      home: 'C:\\Users\\edu', eduHome: 'D:\\edu-cheil', node: 'n', cli: 'c', profileId: 'cheil',
    });
    expect(cheil.script).toBe(join('D:\\edu-cheil', 'edu-sync-cheil.cmd'));
    expect(cheil.create).toEqual(['/Create', '/F', '/TN', 'EduSync-cheil', '/SC', 'MINUTE', '/MO', '15', '/TR', `"${cheil.script}"`]);
    expect(cheil.remove).toEqual(['/Delete', '/F', '/TN', 'EduSync-cheil']);
    expect(cheil.query).toEqual(['/Query', '/TN', 'EduSync-cheil']);
  });
});

describe('scheduled sync lifecycle', () => {
  it('writes, loads, reports and removes a LaunchAgent in a fake HOME', async () => {
    const h = home();
    const r = runner();
    const options = { home: h, node: '/usr/local/bin/node', cli: '/app/cli.js', minutes: 7, path: '/usr/local/bin', env: { EDU_HOME: join(h, '.edu') }, platform: 'darwin' as const, run: r.run };
    const installed = await installSchedule(options);
    expect(installed).toMatchObject({ kind: 'launchd', started: true, legacy: [] });
    const plist = readFileSync(installed.files[0]!, 'utf8');
    expect(plist).toContain('<string>dev.edu.sync.personal</string>');
    expect(plist).toContain('<string>--reason</string><string>timer</string>');
    expect(plist).toContain('<integer>420</integer>');
    expect(plist).toContain(`EDU_HOME</key><string>${join(h, '.edu')}</string>`);
    expect(r.calls).toEqual([['launchctl', 'unload', installed.files[0]], ['launchctl', 'load', '-w', installed.files[0]]]);
    expect(await scheduleStatus(options)).toMatchObject({ installed: true, files: installed.files, legacy: [] });
    expect(await uninstallSchedule(options)).toMatchObject({ removed: installed.files, stopped: true });
    expect((await scheduleStatus(options)).installed).toBe(false);
  });

  it('writes, enables, reports and removes a systemd user timer', async () => {
    const h = home();
    const r = runner();
    const options = { home: h, node: '/opt/node', cli: '/opt/edu/cli.js', minutes: 3, platform: 'linux' as const, run: r.run };
    const installed = await installSchedule(options);
    expect(installed).toMatchObject({ kind: 'systemd', started: true, legacy: [] });
    expect(readFileSync(installed.files[0]!, 'utf8')).toContain('ExecStart=/opt/node /opt/edu/cli.js sync --reason timer');
    expect(readFileSync(installed.files[1]!, 'utf8')).toContain('OnUnitActiveSec=3min');
    expect(r.calls).toContainEqual(['systemctl', '--user', 'enable', '--now', 'edu-sync-personal.timer']);
    expect((await scheduleStatus(options)).installed).toBe(true);
    expect((await uninstallSchedule(options)).removed).toEqual(installed.files);
    expect(r.calls).toContainEqual(['systemctl', '--user', 'disable', '--now', 'edu-sync-personal.timer']);
  });

  it('creates, queries and deletes the Windows task through an injected runner', async () => {
    const h = home();
    const r = runner();
    const options = { home: h, eduHome: join(h, '.edu'), node: 'C:\\node.exe', cli: 'C:\\edu\\cli.js', platform: 'win32' as const, run: r.run };
    const installed = await installSchedule(options);
    expect(installed).toMatchObject({ kind: 'schtasks', started: true, legacy: [] });
    expect(readFileSync(installed.files[0]!, 'utf8')).toContain('sync --reason timer');
    expect((await scheduleStatus(options)).installed).toBe(true);
    expect((await uninstallSchedule(options)).removed).toEqual(installed.files);
    expect(r.calls).toContainEqual(['schtasks', '/Query', '/TN', 'EduSync-personal']);
    expect(r.calls).toContainEqual(['schtasks', '/Delete', '/F', '/TN', 'EduSync-personal']);
  });

  it('keeps two profile tasks and updates cheil in place', async () => {
    const user = home();
    const personalHome = join(user, '.edu');
    const cheilHome = join(user, 'cheil');
    const r = runner();
    const personal = { home: user, eduHome: personalHome, node: 'C:\\node.exe', cli: 'C:\\edu\\personal.js', platform: 'win32' as const, run: r.run, profileId: 'personal' as const };
    const cheil = { home: user, eduHome: cheilHome, node: 'C:\\node.exe', cli: 'C:\\edu\\cheil.js', platform: 'win32' as const, run: r.run, profileId: 'cheil' as const, minutes: 15 };
    await installSchedule(personal);
    await installSchedule(cheil);
    await installSchedule(cheil);
    const creates = r.calls.filter(call => call[0] === 'schtasks' && call[1] === '/Create');
    expect(creates.map(call => call[4])).toEqual(['EduSync-personal', 'EduSync-cheil', 'EduSync-cheil']);
    expect(creates[0]![creates[0]!.indexOf('/MO') + 1]).toBe('5');
    expect(creates[1]![creates[1]!.indexOf('/MO') + 1]).toBe('15');
    expect(creates[2]![creates[2]!.indexOf('/MO') + 1]).toBe('15');
    expect(creates[0]).toContain(`"${join(personalHome, 'edu-sync-personal.cmd')}"`);
    expect(creates[1]).toContain(`"${join(cheilHome, 'edu-sync-cheil.cmd')}"`);
    expect(creates[2]).toContain(`"${join(cheilHome, 'edu-sync-cheil.cmd')}"`);
    const personalScript = readFileSync(join(personalHome, 'edu-sync-personal.cmd'), 'utf8');
    const cheilScript = readFileSync(join(cheilHome, 'edu-sync-cheil.cmd'), 'utf8');
    expect(personalScript).toContain('personal.js');
    expect(cheilScript).toContain('cheil.js');
    expect(personalScript).not.toContain('cheil.js');
  });
});

describe('legacy sync detection and replacement', () => {
  it('reports a matching LaunchAgent and removes it only when explicitly replaced', async () => {
    const h = home();
    const vault = join(h, 'Vault');
    const dir = join(h, 'Library', 'LaunchAgents');
    mkdirSync(dir, { recursive: true });
    const legacy = join(dir, 'old-vault.plist');
    const unrelated = join(dir, 'calendar.plist');
    const otherVault = join(dir, 'other-vault.plist');
    writeFileSync(legacy, `<plist><dict><key>ProgramArguments</key><array><string>/bin/sh</string><string>${vault}/scripts/run.sh</string></array></dict></plist>`);
    writeFileSync(unrelated, '<plist><dict><key>ProgramArguments</key><array><string>/bin/true</string></array></dict></plist>');
    writeFileSync(otherVault, `<plist><dict><key>ProgramArguments</key><array><string>${vault}2/scripts/sync</string></array></dict></plist>`);
    const r = runner();
    const options = { home: h, vault, platform: 'darwin' as const, run: r.run };
    expect(await legacySchedules(options)).toEqual([legacy]);
    const installed = await installSchedule({ ...options, node: '/bin/node', cli: '/edu/cli.js' });
    expect(installed.legacy).toEqual([legacy]);
    expect((await scheduleStatus(options)).legacy).toEqual([legacy]);
    expect(readFileSync(legacy, 'utf8')).toContain(vault);
    expect(await replaceLegacySchedules(options)).toEqual([legacy]);
    expect(r.calls).toContainEqual(['launchctl', 'unload', '-w', legacy]);
    expect(readFileSync(unrelated, 'utf8')).toContain('/bin/true');
    expect(readFileSync(otherVault, 'utf8')).toContain(`${vault}2`);
  });

  it('recognizes a legacy systemd vault script and removes its matching timer only', async () => {
    const h = home();
    const dir = join(h, '.config', 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    const service = join(dir, 'old.service');
    const timer = join(dir, 'old.timer');
    const unrelated = join(dir, 'other.service');
    writeFileSync(service, '[Service]\nExecStart=/home/user/bin/edu-vault-sync\n');
    writeFileSync(timer, '[Timer]\nOnUnitActiveSec=5min\n');
    writeFileSync(unrelated, '[Service]\nExecStart=/bin/true\n');
    const r = runner();
    const options = { home: h, platform: 'linux' as const, run: r.run };
    expect(await legacySchedules(options)).toEqual([service]);
    expect((await scheduleStatus(options)).legacy).toEqual([service]);
    expect(await replaceLegacySchedules(options)).toEqual([timer, service]);
    expect(r.calls).toContainEqual(['systemctl', '--user', 'disable', '--now', 'old.timer']);
    expect(readFileSync(unrelated, 'utf8')).toContain('/bin/true');
  });

  it('reports CheilVaultSync and the previous EduSync task, and deletes them only when replaced', async () => {
    const h = home();
    const r = runner([CHEIL_VAULT_SYNC_TASK, PREVIOUS_WINDOWS_TASK]);
    const options = { home: h, eduHome: join(h, '.edu'), node: 'C:\\node.exe', cli: 'C:\\edu\\cli.js', platform: 'win32' as const, run: r.run, profileId: 'cheil' as const, minutes: 15 };
    expect(await legacySchedules(options)).toEqual([CHEIL_VAULT_SYNC_TASK, PREVIOUS_WINDOWS_TASK]);
    const installed = await installSchedule(options);
    expect(installed.legacy).toEqual([CHEIL_VAULT_SYNC_TASK, PREVIOUS_WINDOWS_TASK]);
    expect(installed.files[0]).toBe(join(h, '.edu', 'edu-sync-cheil.cmd'));
    expect(r.calls.some(call => call[0] === 'schtasks' && call[1] === '/Delete')).toBe(false);
    expect((await scheduleStatus(options)).legacy).toEqual([CHEIL_VAULT_SYNC_TASK, PREVIOUS_WINDOWS_TASK]);
    expect(await replaceLegacySchedules(options)).toEqual([CHEIL_VAULT_SYNC_TASK, PREVIOUS_WINDOWS_TASK]);
    expect(r.calls).toContainEqual(['schtasks', '/Delete', '/F', '/TN', CHEIL_VAULT_SYNC_TASK]);
    expect(r.calls).toContainEqual(['schtasks', '/Delete', '/F', '/TN', PREVIOUS_WINDOWS_TASK]);
    expect(r.calls).not.toContainEqual(['schtasks', '/Delete', '/F', '/TN', 'EduSync-cheil']);
    expect(r.calls).not.toContainEqual(['schtasks', '/Delete', '/F', '/TN', 'EduSync-personal']);
  });

  it('reports a CheilVaultSync unit by name and leaves the profile unit in place', async () => {
    const h = home();
    const dir = join(h, '.config', 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    const legacy = join(dir, 'CheilVaultSync.service');
    const previous = join(dir, 'edu-sync.service');
    const own = join(dir, 'edu-sync-cheil.service');
    writeFileSync(legacy, '[Service]\nExecStart=/bin/true\n');
    writeFileSync(previous, '[Service]\nExecStart=/bin/true\n');
    writeFileSync(own, '[Service]\nExecStart=/bin/true\n');
    const r = runner();
    const options = { home: h, platform: 'linux' as const, run: r.run, profileId: 'cheil' as const };
    expect(await legacySchedules(options)).toEqual([legacy, previous].sort());
    expect(await replaceLegacySchedules(options)).toEqual(expect.arrayContaining([legacy, previous]));
    expect(readFileSync(own, 'utf8')).toContain('/bin/true');
  });
});
