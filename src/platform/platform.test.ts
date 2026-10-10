import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eduMcpLaunch, spawnCli } from './index.js';

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
