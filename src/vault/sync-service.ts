/**
 * Machine integration for `edu sync`: a desktop notification when the sync needs a person, and a
 * per-user schedule (systemd timer on Linux, LaunchAgent on macOS, Task Scheduler on Windows) so every
 * machine runs the same code.
 */
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { whichSync } from '../platform/index.js';

const run = (cmd: string, args: string[]) => new Promise<number>(done =>
  execFile(cmd, args, { timeout: 10_000, windowsHide: true }, error => done(error ? 1 : 0)));

const exists = (path: string) => access(path).then(() => true, () => false);

/** Best effort; silent where no notifier exists (servers, cloud sandboxes). */
export async function notify(title: string, body: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === 'darwin') {
    const quote = (s: string) => JSON.stringify(s);
    await run('osascript', ['-e', `display notification ${quote(body)} with title ${quote(title)}`]);
  } else if (platform === 'linux' && whichSync('notify-send')) {
    await run('notify-send', ['-u', 'critical', '-a', 'Edu', title, body]);
  }
}

export interface ScheduleOptions {
  home: string;
  /** Absolute node binary and Edu CLI script the schedule runs. */
  node: string;
  cli: string;
  minutes?: number;
  /** PATH for the scheduled job (it must find git and its credential helper). */
  path?: string;
  /** Global Edu home; holds the Windows task script. Default `<home>/.edu`. */
  eduHome?: string;
  /** Extra arguments for `edu sync` (for example `--cloud`). */
  args?: string[];
  /** Extra environment for the job (for example a non-default `EDU_HOME`). */
  env?: Record<string, string>;
  platform?: NodeJS.Platform;
  /** Injectable service-manager runner for tests and hosts without the manager. */
  run?: (cmd: string, args: string[]) => Promise<number>;
  /** Repository being synced; used to identify older schedulers. */
  vault?: string;
}

export type ScheduleKind = 'systemd' | 'launchd' | 'schtasks';
export interface ScheduleResult { kind: ScheduleKind; files: string[]; started: boolean; legacy: string[] }

export const WINDOWS_TASK = 'EduSync';

/** The Windows task: a small `.cmd` script (keeps `/TR` under its 261-character limit) and the schtasks calls. */
export function windowsTask(options: ScheduleOptions): { script: string; content: string; create: string[]; remove: string[]; query: string[] } {
  const minutes = options.minutes ?? 5;
  const script = join(options.eduHome ?? join(options.home, '.edu'), 'edu-sync.cmd');
  const batch = (s: string) => s.replace(/%/g, '%%');
  const content = ['@echo off',
    ...Object.entries(options.env ?? {}).map(([key, value]) => `set "${key}=${batch(value)}"`),
    `"${batch(options.node)}" "${batch(options.cli)}" sync --reason timer${(options.args ?? []).map(arg => ` ${batch(arg)}`).join('')}`,
    ''].join('\r\n');
  return {
    script, content,
    // No /RU: the task runs as the current user, only while that user is logged on (no stored password).
    create: ['/Create', '/F', '/TN', WINDOWS_TASK, '/SC', 'MINUTE', '/MO', String(minutes), '/TR', `"${script}"`],
    remove: ['/Delete', '/F', '/TN', WINDOWS_TASK],
    query: ['/Query', '/TN', WINDOWS_TASK],
  };
}

export function scheduleFiles(home: string, eduHome: string | undefined, platform: NodeJS.Platform): { kind: ScheduleKind; files: string[] } | undefined {
  if (platform === 'linux') {
    const dir = join(home, '.config', 'systemd', 'user');
    return { kind: 'systemd', files: [join(dir, 'edu-sync.service'), join(dir, 'edu-sync.timer')] };
  }
  if (platform === 'darwin') return { kind: 'launchd', files: [join(home, 'Library', 'LaunchAgents', 'dev.edu.sync.plist')] };
  if (platform === 'win32') return { kind: 'schtasks', files: [join(eduHome ?? join(home, '.edu'), 'edu-sync.cmd')] };
  return undefined;
}

export async function installSchedule(options: ScheduleOptions): Promise<ScheduleResult> {
  const platform = options.platform ?? process.platform;
  const call = options.run ?? run;
  const legacy = await legacySchedules(options);
  const minutes = options.minutes ?? 5;
  const path = options.path ?? process.env.PATH ?? '/usr/bin:/bin';
  const extra = (options.args ?? []).map(arg => ` ${arg}`).join('');
  const env = Object.entries(options.env ?? {});
  if (platform === 'linux') {
    const dir = join(options.home, '.config', 'systemd', 'user');
    await mkdir(dir, { recursive: true });
    const service = join(dir, 'edu-sync.service');
    const timer = join(dir, 'edu-sync.timer');
    await writeFile(service, [
      '[Unit]', 'Description=Edu: sync the shared brain with GitHub', '',
      '[Service]', 'Type=oneshot', `Environment=PATH=${path}`, ...env.map(([key, value]) => `Environment=${key}=${value}`),
      `ExecStart=${options.node} ${options.cli} sync --reason timer${extra}`, '',
    ].join('\n'));
    await writeFile(timer, [
      '[Unit]', `Description=Edu: sync the shared brain every ${minutes} minutes`, '',
      '[Timer]', 'OnBootSec=1min', `OnUnitActiveSec=${minutes}min`, 'Persistent=true', '',
      '[Install]', 'WantedBy=timers.target', '',
    ].join('\n'));
    const started = await call('systemctl', ['--user', 'daemon-reload']) === 0
      && await call('systemctl', ['--user', 'enable', '--now', 'edu-sync.timer']) === 0;
    return { kind: 'systemd', files: [service, timer], started, legacy };
  }
  if (platform === 'darwin') {
    const dir = join(options.home, 'Library', 'LaunchAgents');
    await mkdir(dir, { recursive: true });
    const plist = join(dir, 'dev.edu.sync.plist');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const vars = [['PATH', path], ...env].map(([key, value]) => `<key>${esc(key!)}</key><string>${esc(value!)}</string>`).join('');
    await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.edu.sync</string>
  <key>ProgramArguments</key><array>
    <string>${esc(options.node)}</string><string>${esc(options.cli)}</string>
    <string>sync</string><string>--reason</string><string>timer</string>${(options.args ?? []).map(arg => `<string>${esc(arg)}</string>`).join('')}
  </array>
  <key>EnvironmentVariables</key><dict>${vars}</dict>
  <key>StartInterval</key><integer>${minutes * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`);
    await call('launchctl', ['unload', plist]);
    const started = await call('launchctl', ['load', '-w', plist]) === 0;
    return { kind: 'launchd', files: [plist], started, legacy };
  }
  if (platform === 'win32') {
    const task = windowsTask({ ...options, minutes });
    await mkdir(join(task.script, '..'), { recursive: true });
    await writeFile(task.script, task.content);
    const started = await call('schtasks', task.create) === 0;
    return { kind: 'schtasks', files: [task.script], started, legacy };
  }
  throw new Error(`scheduled sync is not supported on ${platform}; run \`edu sync\` from your own scheduler`);
}

export interface UnscheduleResult { kind: ScheduleKind; removed: string[]; stopped: boolean }

export async function uninstallSchedule(options: Pick<ScheduleOptions, 'home' | 'eduHome' | 'platform'> & { run?: (cmd: string, args: string[]) => Promise<number> }): Promise<UnscheduleResult> {
  const call = options.run ?? run;
  const platform = options.platform ?? process.platform;
  const known = scheduleFiles(options.home, options.eduHome, platform);
  if (!known) throw new Error(`scheduled sync is not supported on ${platform}`);
  let stopped = true;
  if (known.kind === 'systemd') stopped = await call('systemctl', ['--user', 'disable', '--now', 'edu-sync.timer']) === 0;
  if (known.kind === 'launchd') stopped = await call('launchctl', ['unload', '-w', known.files[0]!]) === 0;
  if (known.kind === 'schtasks') stopped = await call('schtasks', windowsTask({ home: options.home, eduHome: options.eduHome, node: '', cli: '' }).remove) === 0;
  const removed: string[] = [];
  for (const file of known.files) if (await exists(file)) { await rm(file, { force: true }); removed.push(file); }
  if (known.kind === 'systemd') await call('systemctl', ['--user', 'daemon-reload']);
  return { kind: known.kind, removed, stopped };
}

export interface ScheduleStatus { kind?: ScheduleKind; installed: boolean; files: string[]; legacy: string[] }

/** Whether this machine has Edu's scheduled sync; reads files only (and `schtasks /Query` on Windows). */
export async function scheduleStatus(options: Pick<ScheduleOptions, 'home' | 'eduHome' | 'platform' | 'vault' | 'run'>): Promise<ScheduleStatus> {
  const platform = options.platform ?? process.platform;
  const known = scheduleFiles(options.home, options.eduHome, platform);
  if (!known) return { installed: false, files: [], legacy: [] };
  const present: string[] = [];
  for (const file of known.files) if (await exists(file)) present.push(file);
  const installed = known.kind === 'schtasks'
    ? await (options.run ?? run)('schtasks', windowsTask({ home: options.home, eduHome: options.eduHome, node: '', cli: '' }).query) === 0
    : present.length === known.files.length;
  return { kind: known.kind, installed, files: present, legacy: await legacySchedules(options) };
}

/** Older user agents that explicitly run this vault or a `*-vault-sync` script. */
export async function legacySchedules(options: Pick<ScheduleOptions, 'home' | 'platform' | 'vault'>): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux') return [];
  const dir = platform === 'darwin' ? join(options.home, 'Library', 'LaunchAgents') : join(options.home, '.config', 'systemd', 'user');
  const entries = await readdir(dir).catch(() => [] as string[]);
  const suffix = platform === 'darwin' ? '.plist' : '.service';
  const own = platform === 'darwin' ? 'dev.edu.sync.plist' : 'edu-sync.service';
  const vault = options.vault ? resolve(options.vault) : undefined;
  const found: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(suffix) || name === own) continue;
    const file = join(dir, name);
    const content = await readFile(file, 'utf8').catch(() => '');
    const command = platform === 'darwin'
      ? /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(content)?.[1] ?? ''
      : /^ExecStart=(.*)$/m.exec(content)?.[1] ?? '';
    const vaultPattern = vault ? new RegExp(`${vault.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/\\s<>"']|$)`) : undefined;
    if (/(?:^|[\s/"<>])[^\s/"<>]*-vault-sync(?:\.[\w-]+)?(?:[\s/"<>]|$)/.test(command) || vaultPattern?.test(command)) found.push(file);
  }
  return found.sort();
}

/** Remove only agents that still match the legacy detection rule at removal time. */
export async function replaceLegacySchedules(options: Pick<ScheduleOptions, 'home' | 'platform' | 'vault' | 'run'>): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  const call = options.run ?? run;
  const found = await legacySchedules(options);
  const removed: string[] = [];
  for (const file of found) {
    if (platform === 'darwin') await call('launchctl', ['unload', '-w', file]);
    else {
      const unit = basename(file);
      const timer = join(file, '..', unit.replace(/\.service$/, '.timer'));
      await call('systemctl', ['--user', 'disable', '--now', basename(timer)]);
      if (await exists(timer)) { await rm(timer); removed.push(timer); }
      await call('systemctl', ['--user', 'stop', unit]);
    }
    await rm(file);
    removed.push(file);
  }
  if (removed.length && platform === 'linux') await call('systemctl', ['--user', 'daemon-reload']);
  return removed;
}
