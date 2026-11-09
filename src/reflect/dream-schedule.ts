/**
 * `edu dream --install`: a nightly, per-user schedule that writes a fresh dream plan (never applies it).
 * Same approach as `edu sync --install` (systemd user timer on Linux, LaunchAgent on macOS), with one job per
 * project so several brains can dream on the same machine. The scheduled run is deterministic: no model, no cost.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface DreamScheduleOptions {
  home: string;
  /** Global Edu home (EDU_HOME or `<home>/.edu`): holds the registry of installed schedules. */
  eduHome?: string;
  node: string;
  cli: string;
  /** Project directory the job runs in (`edu --cwd <dir> dream`). */
  cwd: string;
  hour?: number;
  minute?: number;
  path?: string;
  platform?: NodeJS.Platform;
  /** Runs systemctl/launchctl; injectable so tests never touch the real service manager. */
  run?: (cmd: string, args: string[]) => Promise<number>;
}
export interface DreamScheduleResult { kind: 'systemd' | 'launchd'; name: string; files: string[]; started: boolean }

const exec = (cmd: string, args: string[]) => new Promise<number>(done => execFile(cmd, args, { timeout: 10_000 }, error => done(error ? 1 : 0)));

/** A crontab line for systems without systemd or launchd (Windows users: Task Scheduler with the same command). */
export const dreamCronLine = (o: Pick<DreamScheduleOptions, 'node' | 'cli' | 'cwd' | 'hour' | 'minute'>) =>
  `${o.minute ?? 30} ${o.hour ?? 3} * * * ${JSON.stringify(o.node)} ${JSON.stringify(o.cli)} --cwd ${JSON.stringify(o.cwd)} dream`;

/** Unit / LaunchAgent name of a project's nightly dream. */
export const dreamScheduleName = (cwd: string) => `edu-dream-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;

const unitDir = (home: string) => join(home, '.config', 'systemd', 'user');
const agentDir = (home: string) => join(home, 'Library', 'LaunchAgents');
const DREAM_NAME = /^edu-dream-[0-9a-f]+$/;

/** Every installed dream schedule is recorded here, so `edu uninstall` can find and remove them all. */
export const dreamRegistryPath = (eduHome: string) => join(eduHome, 'state', 'dream-schedules.json');

export interface DreamScheduleRecord { kind: 'systemd' | 'launchd'; name: string; cwd: string; files: string[] }

async function readRegistry(path: string): Promise<DreamScheduleRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { schedules?: unknown };
    return Array.isArray(parsed.schedules) ? parsed.schedules.filter((s): s is DreamScheduleRecord =>
      Boolean(s) && typeof s.name === 'string' && DREAM_NAME.test(s.name) && (s.kind === 'systemd' || s.kind === 'launchd') && Array.isArray(s.files)) : [];
  } catch { return []; }
}

async function writeRegistry(path: string, schedules: DreamScheduleRecord[]): Promise<void> {
  if (!schedules.length) {
    await rm(path, { force: true });
    await rmdir(dirname(path)).catch(() => undefined);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ version: 1, schedules }, null, 2)}\n`);
  await rename(temp, path);
}

async function record(eduHome: string, entry: DreamScheduleRecord): Promise<void> {
  const path = dreamRegistryPath(eduHome);
  const schedules = (await readRegistry(path)).filter(s => s.name !== entry.name);
  await writeRegistry(path, [...schedules, entry]);
}

export async function installDreamSchedule(options: DreamScheduleOptions): Promise<DreamScheduleResult> {
  const result = await writeDreamSchedule(options);
  await record(options.eduHome ?? join(options.home, '.edu'), { kind: result.kind, name: result.name, cwd: options.cwd, files: result.files });
  return result;
}

export interface DreamUnscheduleOptions {
  home: string;
  eduHome?: string;
  /** Only this project's schedule; every recorded or discovered one when omitted. */
  cwd?: string;
  platform?: NodeJS.Platform;
  run?: (cmd: string, args: string[]) => Promise<number>;
}
export interface DreamUnscheduleResult { kind: 'systemd' | 'launchd'; name: string; removed: string[]; stopped: boolean }

const present = async (dir: string): Promise<string[]> => readdir(dir).catch(() => [] as string[]);

/**
 * Stops and deletes nightly dream schedules: the recorded ones plus any `edu-dream-*` unit or LaunchAgent found
 * under the home (an older Edu did not record them). Idempotent: with nothing left it issues no command.
 * Windows has no installed schedule (`edu dream --install` prints a command to schedule by hand instead).
 */
export async function uninstallDreamSchedules(options: DreamUnscheduleOptions): Promise<DreamUnscheduleResult[]> {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? exec;
  const registryPath = dreamRegistryPath(options.eduHome ?? join(options.home, '.edu'));
  const recorded = await readRegistry(registryPath);
  const only = options.cwd === undefined ? undefined : dreamScheduleName(options.cwd);
  const wanted = (name: string) => only === undefined || name === only;
  // Files are derived from the name, never taken from the registry: a stale or edited record cannot point elsewhere.
  const targets = new Map<string, 'systemd' | 'launchd'>();
  for (const entry of recorded) if (wanted(entry.name)) targets.set(entry.name, entry.kind);
  if (platform === 'linux') {
    for (const file of await present(unitDir(options.home))) {
      const match = /^(edu-dream-[0-9a-f]+)\.(?:service|timer)$/.exec(file);
      if (match && wanted(match[1]!)) targets.set(match[1]!, 'systemd');
    }
  }
  if (platform === 'darwin') {
    for (const file of await present(agentDir(options.home))) {
      const match = /^dev\.edu\.(edu-dream-[0-9a-f]+)\.plist$/.exec(file);
      if (match && wanted(match[1]!)) targets.set(match[1]!, 'launchd');
    }
  }
  const results: DreamUnscheduleResult[] = [];
  let reload = false;
  for (const [name, kind] of targets) {
    const files = kind === 'systemd'
      ? [join(unitDir(options.home), `${name}.service`), join(unitDir(options.home), `${name}.timer`)]
      : [join(agentDir(options.home), `dev.edu.${name}.plist`)];
    const existing: string[] = [];
    for (const file of files) if (await access(file).then(() => true, () => false)) existing.push(file);
    let stopped = true;
    // A recorded schedule whose files are gone was removed by hand; only the record is left to drop.
    if (existing.length) {
      if (kind === 'systemd') stopped = await run('systemctl', ['--user', 'disable', '--now', `${name}.timer`]) === 0;
      else for (const plist of existing) stopped = await run('launchctl', ['unload', '-w', plist]) === 0 && stopped;
      for (const file of existing) await rm(file, { force: true });
      if (kind === 'systemd') reload = true;
      results.push({ kind, name, removed: existing, stopped });
    }
  }
  if (reload) await run('systemctl', ['--user', 'daemon-reload']);
  const left = recorded.filter(entry => !wanted(entry.name));
  if (left.length !== recorded.length) await writeRegistry(registryPath, left);
  return results;
}

async function writeDreamSchedule(options: DreamScheduleOptions): Promise<DreamScheduleResult> {
  const platform = options.platform ?? process.platform;
  const hour = options.hour ?? 3, minute = options.minute ?? 30;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('The dream schedule needs an hour 0-23 and a minute 0-59.');
  const run = options.run ?? exec;
  const path = options.path ?? process.env.PATH ?? '/usr/bin:/bin';
  const name = dreamScheduleName(options.cwd);
  const at = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (platform === 'linux') {
    const dir = unitDir(options.home);
    await mkdir(dir, { recursive: true });
    const service = join(dir, `${name}.service`), timer = join(dir, `${name}.timer`);
    const quote = (value: string) => `"${value.replace(/(["\\])/g, '\\$1')}"`;
    await writeFile(service, [
      '[Unit]', `Description=Edu: nightly dream plan for ${options.cwd}`, '',
      '[Service]', 'Type=oneshot', `Environment=PATH=${path}`, `WorkingDirectory=${options.cwd}`,
      `ExecStart=${quote(options.node)} ${quote(options.cli)} --cwd ${quote(options.cwd)} dream`, '',
    ].join('\n'));
    await writeFile(timer, [
      '[Unit]', `Description=Edu: dream every night at ${at}`, '',
      '[Timer]', `OnCalendar=*-*-* ${at}:00`, 'Persistent=true', '',
      '[Install]', 'WantedBy=timers.target', '',
    ].join('\n'));
    const started = await run('systemctl', ['--user', 'daemon-reload']) === 0 && await run('systemctl', ['--user', 'enable', '--now', `${name}.timer`]) === 0;
    return { kind: 'systemd', name, files: [service, timer], started };
  }
  if (platform === 'darwin') {
    const dir = agentDir(options.home);
    await mkdir(dir, { recursive: true });
    const label = `dev.edu.${name}`;
    const plist = join(dir, `${label}.plist`);
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${esc(options.node)}</string><string>${esc(options.cli)}</string>
    <string>--cwd</string><string>${esc(options.cwd)}</string><string>dream</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(path)}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`);
    await run('launchctl', ['unload', plist]);
    const started = await run('launchctl', ['load', '-w', plist]) === 0;
    return { kind: 'launchd', name, files: [plist], started };
  }
  throw new Error(`A nightly dream is not installed on ${platform}. Schedule this command yourself: ${dreamCronLine({ ...options, hour, minute })}`);
}
