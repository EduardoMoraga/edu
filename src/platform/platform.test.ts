import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eduMcpLaunch, nodeScriptFromCmdShim, spawnCli } from './index.js';

describe('platform launching', () => {
  it('starts edu through cmd /c only on Windows', () => {
    expect(eduMcpLaunch('win32')).toEqual({ command: 'cmd', args: ['/c', 'edu', 'mcp'] });
    expect(eduMcpLaunch('darwin')).toEqual({ command: 'edu', args: ['mcp'] });
  });

  it('runs a CLI by bare name, including Windows .cmd shims, and passes arguments with spaces intact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-shim-'));
    if (process.platform === 'win32') {
      await writeFile(join(dir, 'fakecli.cmd'), '@echo off\r\necho %~1\r\n');
    } else {
      await writeFile(join(dir, 'fakecli'), '#!/bin/sh\necho "$1"\n');
      await chmod(join(dir, 'fakecli'), 0o755);
    }
    const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` };
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawnCli('fakecli', ['hello edu world'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      child.on('error', reject);
      child.on('close', () => resolve(out.trim()));
    });
    expect(output).toBe('hello edu world');
  });
});

describe('Windows shim resolution', () => {
  it('reads the Node script out of an npm .cmd shim', () => {
    const shim = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n';
    const script = nodeScriptFromCmdShim('C:\\npm\\claude.cmd', shim);
    expect(script?.replace(/\\/g, '/')).toMatch(/node_modules\/@anthropic-ai\/claude-code\/cli\.js$/);
  });

  it('starts a .cmd-wrapped Node CLI without cmd.exe so pipes in prompts stay literal', async () => {
    if (process.platform !== 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'edu-shim-node-'));
    await writeFile(join(dir, 'echo.js'), 'console.log(process.argv[2]);');
    await writeFile(join(dir, 'echocli.cmd'), '@ECHO off\r\n"%_prog%"  "%dp0%\\echo.js" %*\r\n');
    const env = { ...process.env, PATH: `${dir};${process.env.PATH ?? ''}` };
    const output = await new Promise<string>((resolveOut, reject) => {
      const child = spawnCli('echocli', ['explorer|builder|reviewer & more > x'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
      child.on('error', reject);
      child.on('close', () => resolveOut(out.trim()));
    });
    expect(output).toBe('explorer|builder|reviewer & more > x');
  });
});
