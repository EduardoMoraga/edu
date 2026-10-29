#!/usr/bin/env node
// Real npm install + published updater + candidate setup/migration, all in temporary homes.
// The release HTTP metadata and host CLIs are fixtures; npm and both Edu binaries are real.
import assert from 'node:assert/strict';
import { access, copyFile, cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import spawn from 'cross-spawn';

const [oldArg, nextArg, expectedOldVersion] = process.argv.slice(2);
if (!oldArg || !nextArg || !expectedOldVersion) throw new Error('Usage: node scripts/smoke-upgrade.mjs <old.tgz> <candidate.tgz> <expected-old-version>');
const oldPackage = resolve(oldArg), nextPackage = resolve(nextArg);
const temp = await realpath(await mkdtemp(join(tmpdir(), 'edu upgrade smoke ')));
const home = join(temp, 'home'), prefix = join(temp, 'prefix'), tools = join(temp, 'tools');
const global = join(home, 'private-brain'), project = join(temp, 'work-project');
const windows = process.platform === 'win32';
const entry = join(prefix, ...(windows ? [] : ['lib']), 'node_modules', 'edu-agent', 'dist', 'cli.js');
const packageRoot = dirname(dirname(entry));
const cacheBase = join(home, '.codex', 'plugins', 'cache', 'edu', 'edu');
const nativeState = join(tools, 'native-state.json');
const env = {
  PATH: windows ? `${tools};${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : `${tools}:/usr/bin:/bin`,
  HOME: home, USERPROFILE: home, EDU_HOME: global, EDU_LANG: 'en', NO_COLOR: '1',
  EDU_CEILING_DIRECTORIES: temp, XDG_CONFIG_HOME: join(home, '.config'),
  CODEX_HOME: join(home, '.codex'),
  npm_config_cache: join(temp, 'npm-cache'), npm_config_update_notifier: 'false',
  ...(windows ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, TEMP: temp, TMP: temp } : {}),
};
function run(command, args, extra = {}) {
  const result = spawn.sync(command, args, { cwd: project, env: { ...env, ...extra }, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
async function put(path, text) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); }
const hash = value => createHash('sha256').update(value).digest('hex');
try {
  await Promise.all([mkdir(tools, { recursive: true }), mkdir(project, { recursive: true }), mkdir(prefix, { recursive: true })]);
  // Restrict PATH rather than creating non-working host stubs: detection checks file presence.
  // npm/node remain real, outside the prefix being upgraded.
  const npmRoot = spawn.sync('npm', ['root', '--global'], { encoding: 'utf8' });
  const npmCandidates = [join(npmRoot.stdout?.trim() ?? '', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  let npmCli;
  for (const candidate of npmCandidates) { try { await access(candidate); npmCli = candidate; break; } catch {} }
  assert.ok(npmCli, 'Could not locate the real npm CLI for the isolated PATH');
  if (windows) {
    await copyFile(process.execPath, join(tools, 'node.exe'));
    await writeFile(join(tools, 'npm.cmd'), `@echo off\r\n"${process.execPath}" "${npmCli}" %*\r\n`);
  } else {
    await symlink(process.execPath, join(tools, 'node'));
    await writeFile(join(tools, 'npm'), `#!/bin/sh\nexec "${process.execPath}" "${npmCli}" "$@"\n`, { mode: 0o755 });
  }
  // A single native host fixture never runs an agent. It reports an existing plugin.
  for (const cli of ['codex']) {
    const js = join(tools, `${cli}.cjs`);
    const body = `const fs=require('node:fs'),p=require('node:path');
const pkg=${JSON.stringify(packageRoot)},base=${JSON.stringify(cacheBase)},stateFile=${JSON.stringify(nativeState)},src=p.join(pkg,'plugins/codex');
const state=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
const args=process.argv.slice(2);
if(args[0]==='--version')console.log('codex-cli 0.163.0');
else if(args.slice(0,2).join(' ')==='plugin list')console.log(JSON.stringify({installed:[{pluginId:'edu@edu',name:'edu',marketplaceName:'edu',installed:true,enabled:true,version:state().version,source:{source:'local',path:src},marketplaceSource:{sourceType:'local',source:pkg}}]}));
else if(args.join(' ')==='plugin add edu@edu --json'){
 const version=JSON.parse(fs.readFileSync(p.join(src,'.codex-plugin/plugin.json'),'utf8')).version;
 fs.rmSync(base,{recursive:true,force:true});fs.mkdirSync(base,{recursive:true});fs.cpSync(src,p.join(base,version),{recursive:true});
 fs.writeFileSync(stateFile,JSON.stringify({version,refreshes:state().refreshes+1}));
 console.log(JSON.stringify({pluginId:'edu@edu',version,installedPath:p.join(base,version)}));
}else process.exit(1);`;
    await writeFile(js, body);
    if (windows) await writeFile(join(tools, `${cli}.cmd`), `@echo off\r\n"${process.execPath}" "${js}" %*\r\n`);
    else await writeFile(join(tools, cli), `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  }
  run('npm', ['install', '--global', '--prefix', prefix, '--no-fund', '--no-audit', oldPackage]);
  assert.equal(run(process.execPath, [entry, '--version']), expectedOldVersion);
  const oldPluginVersion = JSON.parse(await readFile(join(packageRoot, 'plugins/codex/.codex-plugin/plugin.json'), 'utf8')).version;
  await put(nativeState, JSON.stringify({ version: oldPluginVersion, refreshes: 0 }));
  const oldSource = join(packageRoot, 'plugins', 'codex');
  if (windows) await writeFile(join(oldSource, '.mcp.json'), JSON.stringify({ mcpServers: { edu: { command: 'cmd', args: ['/c', 'edu', 'mcp'] } } }, null, 2) + '\n');
  await cp(oldSource, join(cacheBase, oldPluginVersion), { recursive: true });
  const oldTemplate = await readFile(join(packageRoot, 'templates', 'EDU.md'), 'utf8');
  const identity = oldTemplate.replaceAll('{{name}}', 'Private fixture') + '\nPRIVATE CUSTOM IDENTITY\n';
  await put(join(global, 'EDU.md'), identity);
  await put(join(global, 'config.json'), JSON.stringify({ brainDir: 'private-memory' }));
  const note = join(global, 'private-memory', '3-transitive', 'L-preserved.md');
  await put(note, '---\nid: L-preserved\ntier: transitive\nkind: lesson\nstatus: candidate\ntitle: Preserved\ntags: []\nlinks: []\ncreated: 2020-01-01T00:00:00.000Z\n---\nPRIVATE SYNTHETIC MEMORY\n');
  const skill = join(global, 'skills', 'custom', 'SKILL.md');
  await put(skill, '---\nname: custom\ndescription: Private fixture\n---\nCUSTOM SKILL\n');
  await put(join(project, '.edu', 'EDU.md'), identity);
  await put(join(project, '.edu', 'config.json'), JSON.stringify({ brainDir: 'work-memory' }));
  await put(join(global, 'projects.json'), JSON.stringify({ projects: [{ name: 'work-project', root: project, brain: join(project, '.edu', 'work-memory'), addedAt: '2026-01-01T00:00:00.000Z' }] }));
  // Global integration exists with a custom pointer. Project rules are NOT an installed integration.
  const globalInstructions = join(home, '.codex', 'AGENTS.md');
  await put(globalInstructions, `CUSTOM GLOBAL RULES\n<!-- edu:core:start -->\n@${join(global, 'EDU.md')}\n<!-- edu:core:end -->\n`);
  const projectInstructions = join(project, 'AGENTS.md');
  await put(projectInstructions, 'CUSTOM PROJECT RULES ONLY\n');
  await put(join(home, '.edu', 'plugin-setup.json'), JSON.stringify({ version: 1, packageRoot: dirname(dirname(entry)), native: ['codex'], fallback: [] }));
  const preserved = [note, skill, join(global, 'config.json'), join(project, '.edu', 'config.json'), projectInstructions];
  const before = await Promise.all(preserved.map(async path => [path, await readFile(path, 'utf8')]));
  // Only GitHub's release metadata is substituted. The actual OLD updater installs and verifies the new package,
  // runs its own published setup/migration order (0.10.2: setup first; RC: migration first).
  const fixture = join(temp, 'release-fixture.mjs');
  const nextVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.equal(nextVersion, '4.0.0', 'This release gate must test the 4.0.0 release');
  await writeFile(fixture, `const original=globalThis.fetch; globalThis.fetch=async(url,opts)=>String(url).startsWith('https://api.github.com/repos/EduardoMoraga/edu/releases') ? new Response(JSON.stringify({tag_name:${JSON.stringify(`v${nextVersion}`)},name:'Local candidate fixture',body:'Local smoke only; not a published release.',assets:[{name:${JSON.stringify(`edu-agent-${nextVersion}.tgz`)},browser_download_url:${JSON.stringify(nextPackage)}}]}),{status:200,headers:{'content-type':'application/json'}}) : original(url,opts);`);
  const updateOutput = run(process.execPath, ['--import', pathToFileURL(fixture).href, entry, 'update', `v${nextVersion}`]);
  assert.equal(run(process.execPath, [entry, '--version']), nextVersion);
  for (const [path, text] of before) assert.equal(await readFile(path, 'utf8'), text, `custom content changed: ${path}`);
  const instructions = await readFile(globalInstructions, 'utf8');
  assert.ok(instructions.includes(`@${join(global, 'EDU.md')}`), 'custom EDU_HOME pointer lost');
  assert.ok(!instructions.includes(`@${join(home, '.edu', 'EDU.md')}`), 'default pointer substituted');
  assert.ok((await readFile(join(global, 'EDU.md'), 'utf8')).includes('PRIVATE CUSTOM IDENTITY'));
  const checkpoint = JSON.parse(await readFile(join(global, 'state', 'upgrade.json'), 'utf8'));
  assert.equal(checkpoint.version, nextVersion);
  const nextPluginVersion = JSON.parse(await readFile(join(packageRoot, 'plugins/codex/.codex-plugin/plugin.json'), 'utf8')).version;
  assert.equal(nextPluginVersion, nextVersion, 'Candidate plugin metadata must match the release version');
  assert.deepEqual(JSON.parse(await readFile(nativeState, 'utf8')), { version: nextPluginVersion, refreshes: 1 });
  assert.equal(JSON.parse(await readFile(join(cacheBase, nextPluginVersion, '.codex-plugin', 'plugin.json'), 'utf8')).version, nextPluginVersion);
  if (windows) assert.equal(JSON.parse(await readFile(join(cacheBase, nextPluginVersion, '.mcp.json'), 'utf8')).mcpServers.edu.command, 'cmd');
  const beforeRetry = await readFile(join(global, 'EDU.md'), 'utf8');
  const backupsBefore = await readdir(join(global, 'backups'));
  run(process.execPath, [entry, 'setup', '--yes']);
  const migrations = JSON.parse(run(process.execPath, [entry, 'internal', 'migrate-workspaces', '--json']));
  assert.equal(JSON.parse(await readFile(nativeState, 'utf8')).refreshes, 1, 'repeat setup refreshed the native cache unnecessarily');
  assert.ok(migrations.every(row => row.status === 'migrated'));
  assert.equal(await readFile(join(global, 'EDU.md'), 'utf8'), beforeRetry);
  assert.deepEqual(await readdir(join(global, 'backups')), backupsBefore, 'repeat migration made unnecessary backups');
  const caps = JSON.parse(run(process.execPath, [entry, 'capabilities', '--json']));
  assert.equal(caps.version, nextVersion); assert.equal(caps.restartRequired, true);
  console.log(JSON.stringify({ status: 'passed', from: expectedOldVersion, to: nextVersion, oldPluginVersion, nextPluginVersion, platform: process.platform,
    oldAssetSha256: hash(await readFile(oldPackage)), candidateSha256: hash(await readFile(nextPackage)),
    preservedFiles: preserved.length, migrationRepeatable: true, customPointerPreserved: true,
    noUnrequestedProjectIntegration: true, nativeFixtureRefreshes: 1, restartRequired: caps.restartRequired,
    limits: ['Local release metadata fixture; no GitHub release published.', 'Codex host is a no-agent fixture; native plugin cache reload is not tested.', 'No model calls or efficiency measurement.'],
    updateOutput }, null, 2));
} finally { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
