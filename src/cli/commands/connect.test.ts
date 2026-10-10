import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { deadServers, hermesEntry, planHermesConnect } from '../../connect/hermes.js';
import { appendToSequence, removeNestedEntry, setNestedEntry } from '../../connect/yaml.js';
import { registerConnect, type HermesRunner } from './connect.js';
import { captureContext, out } from '../testkit.js';
import { createProgram } from '../program.js';
import { CommanderError } from 'commander';

// Shaped like a real ~/.hermes/config.yaml: comments, reflowed long strings, two sequence styles.
const HERMES = `model:
  default: claude
personalities:
  creative: You are a creative assistant. Think outside the box and offer innovative
    solutions.
approvals:
  mcp_reload_confirm: true
platform_toolsets:
  cli:
  - hermes-cli
  - mcp-codegraph
  telegram:
  - hermes-telegram
# ── Fallback Model ──
# fallback_model:
#   provider: openrouter

mcp_servers:
  codegraph:
    command: codegraph
    args:
      - serve
      - --mcp
    timeout: 120
    enabled: true
  engram:
    command: /opt/homebrew/bin/engram-missing
    args:
      - mcp
`;
const exists = (command: string) => command !== '/opt/homebrew/bin/engram-missing';
const entry = hermesEntry({ command: '/usr/local/bin/node', args: ['/opt/edu/dist/cli.js', 'mcp'] }, 'albert');
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

describe('YAML splicing keeps every other byte', () => {
  it('adds, replaces and removes a nested entry without touching the rest', () => {
    const added = setNestedEntry(HERMES, 'mcp_servers', 'edu', { command: 'node', args: ['cli.js', 'mcp'] });
    expect(added).toBe(`${HERMES}  edu:\n    command: node\n    args:\n      - cli.js\n      - mcp\n`);
    expect(setNestedEntry(added, 'mcp_servers', 'edu', { command: 'node', args: ['cli.js', 'mcp'] })).toBe(added);
    const replaced = setNestedEntry(added, 'mcp_servers', 'codegraph', { command: 'cg' });
    expect(replaced).toContain('mcp_servers:\n  codegraph:\n    command: cg\n  engram:');
    expect(replaced.startsWith(HERMES.slice(0, HERMES.indexOf('mcp_servers:')))).toBe(true);
    expect(removeNestedEntry(HERMES, 'mcp_servers', 'engram')).toBe(HERMES.replace('  engram:\n    command: /opt/homebrew/bin/engram-missing\n    args:\n      - mcp\n', ''));
    expect(setNestedEntry('a: 1', 'mcp_servers', 'edu', { command: 'x' })).toBe('a: 1\nmcp_servers:\n  edu:\n    command: x\n');
    expect(setNestedEntry('mcp_servers:\nb: 2\n', 'mcp_servers', 'edu', { command: 'x' })).toBe('mcp_servers:\n  edu:\n    command: x\nb: 2\n');
    expect(appendToSequence(HERMES, 'platform_toolsets', 'telegram', 'edu')).toContain('  telegram:\n  - hermes-telegram\n  - edu\n# ── Fallback');
  });
});

describe('planHermesConnect', () => {
  it('adds mcp_servers.edu idempotently and reports dead servers until asked to remove them', () => {
    const plan = planHermesConnect(HERMES, { entry, commandExists: exists });
    expect(plan.changes).toEqual(['add mcp_servers.edu']);
    expect(plan.dead).toEqual([{ name: 'engram', command: '/opt/homebrew/bin/engram-missing' }]);
    expect((parse(plan.after) as { mcp_servers: Record<string, unknown> }).mcp_servers.edu).toEqual({
      command: '/usr/local/bin/node', args: ['/opt/edu/dist/cli.js', 'mcp', '--project', 'albert'], timeout: 120, connect_timeout: 60, enabled: true,
    });
    expect(plan.after.startsWith(HERMES)).toBe(true); // a pure append: comments and folded strings intact
    expect(planHermesConnect(plan.after, { entry, commandExists: exists }).changes).toEqual([]);

    const cleaned = planHermesConnect(HERMES, { entry, commandExists: exists, removeDead: true });
    expect(cleaned.changes).toEqual(['add mcp_servers.edu', 'remove dead mcp_servers.engram (/opt/homebrew/bin/engram-missing not found)']);
    expect(Object.keys((parse(cleaned.after) as { mcp_servers: object }).mcp_servers)).toEqual(['codegraph', 'edu']);
  });

  it('leaves Telegram alone when it inherits all MCP servers, and allows edu when its list is an allowlist', () => {
    expect(planHermesConnect(HERMES, { entry, commandExists: exists }).after).toContain('  telegram:\n  - hermes-telegram\n#');
    const allowlist = HERMES.replace('  - hermes-telegram\n', '  - hermes-telegram\n  - codegraph\n');
    const plan = planHermesConnect(allowlist, { entry, commandExists: exists });
    expect(plan.changes).toContain('allow edu in platform_toolsets.telegram');
    expect((parse(plan.after) as { platform_toolsets: { telegram: string[] } }).platform_toolsets.telegram).toEqual(['hermes-telegram', 'codegraph', 'edu']);
    const blocked = planHermesConnect(HERMES.replace('  - hermes-telegram\n', '  - hermes-telegram\n  - no_mcp\n'), { entry, commandExists: exists });
    expect(blocked.warnings[0]).toContain('no_mcp');
  });

  it('finds dead servers by absolute path or PATH lookup, never flagging edu itself', () => {
    expect(deadServers('mcp_servers:\n  edu:\n    command: /nope\n  a:\n    command: ghost\n  b:\n    url: https://x\n', () => false)).toEqual([{ name: 'a', command: 'ghost' }]);
  });
});

describe('edu connect hermes', () => {
  async function setup(runner?: HermesRunner, hermesOnPath = true) {
    const c = await captureContext();
    const bin = join(c.dirs.home, 'bin');
    await mkdir(bin, { recursive: true });
    if (hermesOnPath) { await writeFile(join(bin, 'hermes'), '#!/bin/sh\n'); await chmod(join(bin, 'hermes'), 0o755); }
    c.ctx.env.PATH = bin;
    const hermesHome = join(c.dirs.home, '.hermes');
    await mkdir(hermesHome, { recursive: true });
    const config = join(hermesHome, 'config.yaml');
    await writeFile(config, HERMES);
    await chmod(config, 0o640);
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    const run = async (argv: string[]) => {
      const program = createProgram(c.ctx, { exitOverride: true });
      program.commands.splice(program.commands.findIndex(cmd => cmd.name() === 'connect'), 1);
      registerConnect(program, c.ctx, { runner: runner ?? (async (_bin, args, env) => { calls.push({ args, env }); return { ok: true, output: '  ✓ Connected (210ms)\n  ✓ Tools discovered: 17' }; }) });
      try { await program.parseAsync(argv, { from: 'user' }); } catch (error) { if (!(error instanceof CommanderError)) throw error; }
    };
    return { c, config, calls, run };
  }

  it('adds Edu, tests it with hermes, and --undo restores the file byte for byte', async () => {
    const s = await setup();
    await s.run(['connect', 'hermes', '--project', 'global', '--remove-dead']);
    const after = await readFile(s.config, 'utf8');
    expect(out(s.c)).toContain('+ add mcp_servers.edu');
    expect(out(s.c)).toContain('+ remove dead mcp_servers.engram');
    expect(out(s.c)).toContain('✓ hermes mcp test edu');
    expect(out(s.c)).toContain('/reload-mcp');
    expect(s.c.exitCode).toBeUndefined();
    const edu = (parse(after) as { mcp_servers: Record<string, { command: string; args: string[] }> }).mcp_servers.edu!;
    expect(edu.args.slice(-3)).toEqual(['mcp', '--project', 'global']);
    expect(edu.command.startsWith('/')).toBe(true);
    expect(s.calls).toEqual([{ args: ['mcp', 'test', 'edu'], env: expect.objectContaining({ HERMES_HOME: join(s.c.dirs.home, '.hermes') }) }]);
    expect((await stat(s.config)).mode & 0o777).toBe(0o640);

    s.c.stdout.length = 0;
    await s.run(['connect', 'hermes', '--project', 'global', '--no-test']);
    expect(out(s.c)).toContain('Already connected');
    expect(await readFile(s.config, 'utf8')).toBe(after);

    await s.run(['connect', 'hermes', '--undo']);
    expect(sha(await readFile(s.config))).toBe(sha(HERMES));
    expect((await stat(s.config)).mode & 0o777).toBe(0o640);
    await s.run(['connect', 'hermes', '--undo']);
    expect(s.c.stderr.join('\n')).toContain('No Hermes connect backup to restore');
  });

  it('refuses to undo over later edits unless forced, and supports --dry-run and --restart', async () => {
    const s = await setup();
    await s.run(['connect', 'hermes', '--dry-run']);
    expect(await readFile(s.config, 'utf8')).toBe(HERMES);
    await s.run(['connect', 'hermes', '--no-test', '--restart']);
    expect(s.calls.map(call => call.args)).toEqual([['gateway', 'restart']]);
    await writeFile(s.config, `${await readFile(s.config, 'utf8')}# edited later\n`);
    await s.run(['connect', 'hermes', '--undo']);
    expect(s.c.stderr.join('\n')).toContain('changed after edu connect');
    await s.run(['connect', 'hermes', '--undo', '--force']);
    expect(await readFile(s.config, 'utf8')).toBe(HERMES);
  });

  it('fails clearly on a failed hermes test, a missing config or an unknown project', async () => {
    const s = await setup(async () => ({ ok: true, output: '  ✗ Connection failed (5ms): boom' }));
    await s.run(['connect', 'hermes']);
    expect(out(s.c)).toContain('✗ hermes mcp test edu');
    expect(s.c.exitCode).toBe(1);

    const missing = await setup(undefined, false);
    await missing.run(['connect', 'hermes', '--config', join(missing.c.dirs.home, 'nope.yaml')]);
    expect(missing.c.stderr.join('\n')).toContain('Hermes config not found');
    await missing.run(['connect', 'hermes', '--project', 'nobody']);
    expect(missing.c.stderr.join('\n')).toContain('Unknown workspace "nobody"');
    expect(await readFile(missing.config, 'utf8')).toBe(HERMES);
  });
});
