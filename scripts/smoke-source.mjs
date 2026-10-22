#!/usr/bin/env node
// Build an exact committed checkout, install a real package copy, then remove its source location.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, mkdtemp, mkdir, readFile, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import spawn from 'cross-spawn';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await realpath(await mkdtemp(join(tmpdir(), 'edu source smoke ')));
const source = join(temp, 'source'), prefix = join(temp, 'prefix');
const home = join(temp, 'home'), work = join(temp, 'work');
const windows = process.platform === 'win32';
const bin = windows ? prefix : join(prefix, 'bin');
const executable = join(bin, windows ? 'edu.cmd' : 'edu');
const installed = join(prefix, ...(windows ? [] : ['lib']), 'node_modules', 'edu-agent');
const env = {
  HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'),
  PATH: [bin, dirname(process.execPath), ...(windows ? [join(process.env.SystemRoot, 'System32'), process.env.SystemRoot] : ['/usr/bin', '/bin'])].join(windows ? ';' : ':'),
  EDU_LANG: 'en', EDU_CEILING_DIRECTORIES: temp, NO_COLOR: '1',
  npm_config_cache: join(temp, 'npm-cache'), npm_config_update_notifier: 'false',
  ...(windows ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, TEMP: temp, TMP: temp } : {}),
};
function run(command, args, cwd = source) {
  const result = spawn.sync(command, args, { cwd, env: command === 'git' ? process.env : env, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
async function mcp() {
  const child = spawn(process.execPath, [join(installed, 'dist/cli.js'), 'mcp'], { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
  await new Promise((resolveDone, reject) => {
    let output = '', errors = '', settled = false;
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); error ? reject(error) : resolveDone(); };
    const timer = setTimeout(() => finish(new Error(`Installed MCP timed out: ${errors}`)), 30000);
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    child.on('error', finish);
    child.stdin.on('error', finish);
    child.on('exit', code => { if (!settled) finish(new Error(`Installed MCP exited ${code}: ${errors}`)); });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8192); });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 1024 * 1024) return finish(new Error('MCP output exceeded smoke bound'));
      for (let i; (i = output.indexOf('\n')) >= 0;) {
        const line = output.slice(0, i).trim(); output = output.slice(i + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.error) throw new Error(JSON.stringify(message.error));
          if (message.id === 1) {
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
          } else if (message.id === 2) {
            assert.ok(message.result.tools.some(tool => tool.name === 'edu_recall'));
            assert.ok(message.result.tools.some(tool => tool.name === 'edu_crew_dispatch'));
            finish();
          }
        } catch (error) { finish(error); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'edu-source-smoke', version: '1' } } });
  });
}
try {
  await Promise.all([source, home, work, prefix].map(path => mkdir(path, { recursive: true })));
  const commit = run('git', ['rev-parse', 'HEAD'], root);
  const archive = join(temp, 'source.tar');
  run('git', ['archive', '--format=tar', `--output=${archive}`, commit], root);
  run('tar', ['-xf', archive, '-C', source], root);
  await rm(join(source, 'dist'), { recursive: true, force: true });
  const version = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version;
  run('npm', ['ci', '--include=dev', '--no-fund', '--no-audit']);
  run('npm', ['run', 'build:plugins', '--', '--check']);
  run('npm', ['run', 'build']);
  run('npm', ['install', '--global', '--install-links', '--prefix', prefix, '--no-fund', '--no-audit', source], work);
  assert.equal(await realpath(installed), installed, 'Global installation must be a package copy, not a checkout symlink');
  await rename(source, join(temp, 'source-moved'));
  assert.equal((await readFile(join(installed, 'dist/cli.js'), 'utf8')).split(/\r?\n/)[0], '#!/usr/bin/env node');
  await access(executable, windows ? constants.F_OK : constants.X_OK);
  assert.equal(run(executable, ['--version'], work), version);
  run(executable, ['--help'], work);
  run(executable, ['init', '--global'], work);
  assert.equal(JSON.parse(run(executable, ['capabilities', '--json'], work)).version, version);
  await mcp();
  console.log(JSON.stringify({ status: 'passed', commit, version, platform: process.platform, sourceMoved: true, globalPackageCopy: true, mcp: true }));
} finally { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
