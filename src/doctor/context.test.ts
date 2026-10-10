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
