import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EduEvent, EngineRunRequest } from '../core/contracts.js';
import { buildOpencodeArgv, opencodeEngine } from './opencode.js';

const dirs: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

const request = (cwd: string): EngineRunRequest => ({ cli: 'opencode', prompt: 'inspect this file', cwd, autonomy: 'ask' });

describe('OpenCode working directory', () => {
  it('passes no --dir, which OpenCode 2.x no longer accepts', () => {
    expect(buildOpencodeArgv(request('/workspace')).args).not.toContain('--dir');
  });

  // A stand-in `opencode` on PATH reports where it runs and what it received; Windows would need a .cmd shim.
  it.skipIf(process.platform === 'win32')('runs OpenCode in the request cwd', async () => {
    const base = await mkdtemp(join(tmpdir(), 'edu-opencode-'));
    dirs.push(base);
    const bin = join(base, 'bin');
    const workspace = join(base, 'workspace');
    await Promise.all([mkdir(bin), mkdir(workspace)]);
    const fake = join(bin, 'opencode');
    await writeFile(fake, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ type: 'text', part: { text: JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) } }) + '\\n');\n`);
    await chmod(fake, 0o755);
    vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH ?? ''}`);
    const events: EduEvent[] = [];
    for await (const event of opencodeEngine.run(request(workspace), 'opencode-cwd')) events.push(event);
    const text = events.find((event): event is Extract<EduEvent, { type: 'agent.text' }> => event.type === 'agent.text');
    const seen = JSON.parse(text!.text) as { cwd: string; args: string[] };
    expect(seen.cwd).toBe(await realpath(workspace));
    expect(seen.args).not.toContain('--dir');
    expect(seen.args.slice(-2)).toEqual(['--', 'inspect this file']);
    expect(events.find(event => event.type === 'agent.end')).toMatchObject({ ok: true });
  });
});
