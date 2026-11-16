import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { scanContext } from './context.js';

const homes: string[] = [];
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }); });

it('attributes instruction tokens and flags competing memory and orchestration', async () => {
  const home = await mkdtemp(join(tmpdir(), 'edu-doctor-')); homes.push(home);
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(join(home, '.codex/AGENTS.md'), 'user text\n<!-- gentle-ai:persona -->\nnoise noise noise\n<!-- /gentle-ai:persona -->\n<!-- edu:core -->edu<!-- /edu:core -->\n');
  await writeFile(join(home, '.codex/config.toml'), '[mcp_servers.engram]\ncommand = "engram"\n[plugins."edu@personal"]\nenabled = true\n');
  const report = await scanContext({ home, env: {}, hosts: ['codex'] });
  expect(report.hosts[0]?.tokens.total).toBeGreaterThan(0);
  expect(report.hosts[0]?.tokens.byOwner['gentle-ai']).toBeGreaterThan(0);
  expect(report.hosts[0]?.competingMemory).toBe(true);
  expect(report.hosts[0]?.competingOrchestration).toBe(true);
  expect(report.hosts[0]?.detachCommand).toContain('edu detach');
  expect(report.hosts[0]?.mcpServers.byOwner.engram).toBe(1);
});

it('reads Codex TOML tables in every spelling, and not look-alikes inside strings', async () => {
  const home = await mkdtemp(join(tmpdir(), 'edu-doctor-')); homes.push(home);
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(join(home, '.codex/config.toml'), [
    'doc = """', '[mcp_servers.fake]', '"""',
    "[ mcp_servers . 'orca' ]", 'command = "orca"',
    '[mcp_servers]', 'engram = { command = "engram" }',
    "[[plugins.'codegraph@x']]", 'enabled = true',
    '[plugins."herdr@x"]', 'enabled = false',
    '',
  ].join('\r\n'));
  const host = (await scanContext({ home, env: {}, hosts: ['codex'] })).hosts[0]!;
  expect(host.mcpServers.names).toEqual(['orca', 'engram']);
  expect(host.mcpServers.byOwner).toEqual({ orca: 1, engram: 1 });
  expect(host.plugins).toEqual(['codegraph@x']);
});

it('finds an engram instruction file named in config.toml and counts its tokens', async () => {
  const home = await mkdtemp(join(tmpdir(), 'edu-doctor-')); homes.push(home);
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(join(home, '.codex/engram-instructions.md'), 'x'.repeat(400));
  await writeFile(join(home, '.codex/config.toml'), "model_instructions_file = '~/.codex/engram-instructions.md'\n");
  const host = (await scanContext({ home, env: {}, hosts: ['codex'] })).hosts[0]!;
  expect(host.tokens.byOwner.engram).toBe(100);
  expect(host.memoryWriters).toContain('engram');
});
