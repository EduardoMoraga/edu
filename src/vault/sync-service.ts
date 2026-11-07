/**
 * Machine integration for `edu sync`: a desktop notification when the sync needs a person, and a
 * per-user schedule (systemd timer on Linux, LaunchAgent on macOS) so every machine runs the same code.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { whichSync } from '../platform/index.js';

const run = (cmd: string, args: string[]) => new Promise<number>(done =>
  execFile(cmd, args, { timeout: 10_000 }, error => done(error ? 1 : 0)));

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
  platform?: NodeJS.Platform;
}

export interface ScheduleResult { kind: 'systemd' | 'launchd'; files: string[]; started: boolean }

export async function installSchedule(options: ScheduleOptions): Promise<ScheduleResult> {
  const platform = options.platform ?? process.platform;
  const minutes = options.minutes ?? 5;
  const path = options.path ?? process.env.PATH ?? '/usr/bin:/bin';
  if (platform === 'linux') {
    const dir = join(options.home, '.config', 'systemd', 'user');
    await mkdir(dir, { recursive: true });
    const service = join(dir, 'edu-sync.service');
    const timer = join(dir, 'edu-sync.timer');
    await writeFile(service, [
      '[Unit]', 'Description=Edu: sync the shared brain with GitHub', '',
      '[Service]', 'Type=oneshot', `Environment=PATH=${path}`,
      `ExecStart=${options.node} ${options.cli} sync --reason timer`, '',
    ].join('\n'));
    await writeFile(timer, [
      '[Unit]', `Description=Edu: sync the shared brain every ${minutes} minutes`, '',
      '[Timer]', 'OnBootSec=1min', `OnUnitActiveSec=${minutes}min`, 'Persistent=true', '',
      '[Install]', 'WantedBy=timers.target', '',
    ].join('\n'));
    const started = await run('systemctl', ['--user', 'daemon-reload']) === 0
      && await run('systemctl', ['--user', 'enable', '--now', 'edu-sync.timer']) === 0;
    return { kind: 'systemd', files: [service, timer], started };
  }
  if (platform === 'darwin') {
    const dir = join(options.home, 'Library', 'LaunchAgents');
    await mkdir(dir, { recursive: true });
    const plist = join(dir, 'dev.edu.sync.plist');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.edu.sync</string>
  <key>ProgramArguments</key><array>
    <string>${esc(options.node)}</string><string>${esc(options.cli)}</string>
    <string>sync</string><string>--reason</string><string>timer</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(path)}</string></dict>
  <key>StartInterval</key><integer>${minutes * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`);
    await run('launchctl', ['unload', plist]);
    const started = await run('launchctl', ['load', '-w', plist]) === 0;
    return { kind: 'launchd', files: [plist], started };
  }
  throw new Error(`scheduled sync is not supported on ${platform}; run \`edu sync\` from your own scheduler`);
}
