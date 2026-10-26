import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Real installed Pi loader; dispatch its registered handlers without a provider or LLM.
const require = createRequire(import.meta.url);
const piRoot = process.env.PI_PROTOCOL_ROOT ?? dirname(dirname(require.resolve('@earendil-works/pi-coding-agent')));
const windows = process.platform === 'win32';
const template = resolve('templates/pi/edu.ts');
let temp: string;
let a: string;
let b: string;
let bin: string;
let runtime: any;
let extension: any;
const context = (cwd: string, id = 'session-1') => ({ cwd, mode: 'print', hasUI: false, sessionManager: { getSessionId: () => id }, ui: { notify: vi.fn() } });
const start = (ctx: any) => extension.handlers.get('session_start')[0]({}, ctx);
const prompt = (ctx: any) => extension.handlers.get('before_agent_start')[0]({ systemPrompt: 'BASE', messageType: 'user', prompt: 'task' }, ctx);
const calls = async () => (await readFile(join(temp, 'calls'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
async function wrapper(mode = 'ok') {
  const script = windows ? join(temp, 'edu-fixture.cjs') : bin;
  await writeFile(script, `#!${process.execPath}\nconst fs=require('node:fs');\nfs.appendFileSync(${JSON.stringify(join(temp, 'calls'))}, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),input:JSON.parse(fs.readFileSync(0,'utf8'))})+'\\n');\n${mode === 'error' ? "console.error('fixture broken');process.exit(9);" : mode === 'stderr' ? "console.error('edu hook: fixture swallowed error (ignored)');" : mode === 'empty' ? '' : "console.log('MEMORY:'+process.cwd());"}\n`, { mode: 0o755 });
  if (windows) await writeFile(bin, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
}
async function deckFixture(descendant = false) {
  const script = windows ? join(temp, 'edu-fixture.cjs') : bin;
  const marker = join(temp, 'descendant-survived');
  const descendantCode = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'survived'), 2600)`;
  await writeFile(script, `#!${process.execPath}\nconst fs=require('node:fs');const cp=require('node:child_process');\nfs.appendFileSync(${JSON.stringify(join(temp, 'calls'))}, JSON.stringify({args:process.argv.slice(2)})+'\\n');\n${descendant ? `cp.spawn(process.execPath, ['-e', ${JSON.stringify(descendantCode)}], {stdio:'ignore'});` : ''}\nsetTimeout(()=>{},10000);\n`, { mode: 0o755 });
  if (windows) await writeFile(bin, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  return marker;
}
async function waitForCall() {
  for (let i = 0; i < 30; i++) {
    if ((await readFile(join(temp, 'calls'), 'utf8')).trim()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Edu fixture did not start');
}
beforeEach(async () => {
  // macOS /var/folders may alias /private/var/folders; child cwd is physical.
  temp = await realpath(await mkdtemp(join(tmpdir(), 'edu-pi-protocol-')));
  a = join(temp, 'a'); b = join(temp, 'b'); bin = join(temp, windows ? 'edu-fixture.cmd' : 'edu-fixture.cjs');
  extension = undefined;
  await Promise.all([mkdir(a), mkdir(b), writeFile(join(temp, 'calls'), '')]);
  await wrapper();
  vi.stubEnv('EDU_BIN', bin);
  const loader = await import(/* @vite-ignore */ pathToFileURL(join(piRoot, 'dist/core/extensions/loader.js')).href);
  runtime = loader.createExtensionRuntime();
  const loaded = await loader.loadExtensions([template], a, undefined, runtime);
  expect(loaded.errors).toEqual([]);
  extension = loaded.extensions[0];
});
afterEach(async () => {
  if (extension) await extension.handlers.get('session_shutdown')[0]({});
  vi.unstubAllEnvs();
  await rm(temp, { recursive: true, force: true });
});

describe('Pi template runtime protocol', () => {
  it('typechecks against the installed Pi API, not an invented interface', () => {
    // Resolve types from Pi's own module location, supporting nested and hoisted npm layouts.
    const tui = ts.resolveModuleName('@earendil-works/pi-tui', join(piRoot, 'dist/index.d.ts'), {
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    }, ts.sys).resolvedModule;
    expect(tui, 'Pi installation must resolve its own pi-tui dependency').toBeDefined();
    const program = ts.createProgram([template], {
      noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      baseUrl: process.cwd(), paths: {
        '@earendil-works/pi-coding-agent': [join(piRoot, 'dist/index.d.ts')],
        '@earendil-works/pi-tui': [tui!.resolvedFileName],
      }, typeRoots: [resolve('node_modules/@types')], types: ['node'],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: f => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' })).toBe('');
  }, 60_000);
  it('uses the same EDU_BIN in MCP and hook and follows ctx.cwd, not host cwd', async () => {
    expect(await realpath(b)).not.toBe(await realpath(process.cwd()));
    await start(context(b));
    expect(runtime.mcpServers.get('edu').config).toMatchObject({
      ...(windows ? { command: 'cmd', args: ['/c', bin, 'mcp'] } : { command: bin, args: ['mcp'] }), cwd: b,
      env: { EDU_PROJECT: '', EDU_LOCK_WORKSPACE: '1' },
    });
    expect((await prompt(context(b))).systemPrompt).toContain(`MEMORY:${b}`);
    expect(await calls()).toEqual([{ cwd: b, args: ['hook', 'session-start'], input: { cwd: b, session_id: 'session-1', source: 'pi' } }]);
  });
  it('emits optional bounded session lessons without claiming proof or dispatching reflection', async () => {
    const result = await prompt(context(a));
    for (const required of ['lessons?: [{title, body, evidence?: [ids]}]', 'max 3', 'candidate/inferred', 'omit if none', 'no secrets', 'not proof', 'current model', 'no second reflection LLM', 'substantial changes', 'no automatic crew for trivial tasks']) {
      expect(result.systemPrompt).toContain(required);
    }
    expect(await calls()).toHaveLength(1);
    expect((await calls())[0].args).toEqual(['hook', 'session-start']);
  });
  it('keeps the MCP lock across host workspace changes, overriding inherited project selection', async () => {
    vi.stubEnv('EDU_PROJECT', a);
    await start(context(a));
    expect(runtime.mcpServers.get('edu').config).toMatchObject({ cwd: a, env: { EDU_PROJECT: '', EDU_LOCK_WORKSPACE: '1' } });
    await prompt(context(b));
    expect(runtime.mcpServers.get('edu').config).toMatchObject({ cwd: b, env: { EDU_PROJECT: '', EDU_LOCK_WORKSPACE: '1' } });
    expect((await prompt(context(b))).systemPrompt).toContain(`MEMORY:${b}`);
    expect(await calls()).toHaveLength(1);
  });
  it('constructs once per session/workspace, retains the cached prompt and refreshes explicitly', async () => {
    await start(context(a));
    const first = await prompt(context(a));
    expect(await prompt(context(a))).toEqual(first);
    expect(await calls()).toHaveLength(1);
    await prompt(context(b));
    expect((await prompt(context(a))).systemPrompt).toContain(`MEMORY:${a}`);
    expect(await calls()).toHaveLength(2);
    await extension.commands.get('edu-refresh').handler('', context(a));
    expect((await prompt(context(a))).systemPrompt).toContain(`MEMORY:${a}`);
    expect(await calls()).toHaveLength(3);
    await start(context(a, 'session-2'));
    await prompt(context(a, 'session-2'));
    expect(await calls()).toHaveLength(4);
  });
  it('coalesces concurrent prompt starts and does not cache another workspace as this one', async () => {
    const [first, second] = await Promise.all([prompt(context(a)), prompt(context(a))]);
    expect(first).toEqual(second);
    expect(await calls()).toHaveLength(1);
    expect((await prompt(context(b))).systemPrompt).toContain(`MEMORY:${b}`);
  });
  it.each(['error', 'stderr'])('surfaces %s failures even without UI and retries only on explicit refresh', async mode => {
    await wrapper(mode);
    await expect(prompt(context(a))).rejects.toThrow(/fixture/);
    await expect(prompt(context(a))).rejects.toThrow(/fixture/);
    expect(await calls()).toHaveLength(1);
    await wrapper();
    await extension.commands.get('edu-refresh').handler('', context(a));
    expect((await prompt(context(a))).systemPrompt).toContain(`MEMORY:${a}`);
    expect(await calls()).toHaveLength(2);
  });
  it('caches an empty no-brain result without injecting invented memory', async () => {
    await wrapper('empty');
    expect(await prompt(context(a))).toBeUndefined();
    expect(await prompt(context(a))).toBeUndefined();
    expect(await calls()).toHaveLength(1);
  });
  it('coalesces deck refresh triggers while one poll is pending', async () => {
    await deckFixture();
    const ctx = { ...context(a), mode: 'tui', ui: { setHeader: vi.fn(), setFooter: vi.fn(), setWidget: vi.fn() } };
    await start(ctx);
    await waitForCall();
    await Promise.all([
      extension.handlers.get('turn_end')[0]({}, ctx),
      extension.handlers.get('agent_end')[0]({}, ctx),
      extension.handlers.get('turn_end')[0]({}, ctx),
    ]);
    expect(await calls()).toHaveLength(1);
  });
  it.skipIf(!windows)('kills only its Windows shell tree when deck times out', async () => {
    const marker = await deckFixture(true);
    const notify = vi.fn();
    await extension.commands.get('edu-deck').handler('', { ...context(a), ui: { notify } });
    expect(notify).toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 1600));
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 10_000);
});
