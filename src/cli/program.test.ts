import { describe, expect, it } from 'vitest';
import { packageVersion } from './package.js';
import { captureContext, out, runCli } from './testkit.js';

const COMMANDS: string[][] = [
  ['init'],
  ['install'],
  ['uninstall'],
  ['doctor'],
  ['run'],
  ['ui'],
  ['demo'],
  ['brain'],
  ['brain', 'status'],
  ['brain', 'recall'],
  ['brain', 'remember'],
  ['brain', 'maintain'],
  ['brain', 'import'],
  ['brain', 'link'],
  ['context'],
  ['reflect'],
  ['proposals'],
  ['proposals', 'list'],
  ['proposals', 'accept'],
  ['proposals', 'reject'],
  ['mcp'],
  ['statusline'],
  ['hook'],
  ['hook', 'session-start'],
  ['hook', 'session-end'],
  ['hook', 'codex-notify'],
];

describe('createProgram', () => {
  it.each(COMMANDS)('parses `edu %s --help`', async (...path) => {
    const c = await captureContext();
    const exit = await runCli(c, [...path, '--help']);
    expect(exit?.code).toBe('commander.helpDisplayed');
    expect(out(c)).toContain(`edu ${path.join(' ')}`);
  });

  it('prints the package version', async () => {
    const c = await captureContext();
    const exit = await runCli(c, ['--version']);
    expect(exit?.code).toBe('commander.version');
    expect(out(c).trim()).toBe(packageVersion());
  });

  it('shows the banner and grouped commands in help', async () => {
    const c = await captureContext();
    await runCli(c, ['--help']);
    const text = out(c);
    expect(text).toContain('a second brain that learns');
    for (const heading of ['Get started:', 'Work:', 'Brain:', 'Integrations:']) expect(text).toContain(heading);
    expect(text.indexOf('init')).toBeLessThan(text.indexOf('Work:'));
  });

  it('prints help instead of the TUI when stdout is not a terminal', async () => {
    const c = await captureContext({ isTTY: false });
    const exit = await runCli(c, []);
    expect(exit).toBeUndefined();
    expect(out(c)).toContain('Usage: edu');
  });

  it('rejects unknown commands with a suggestion', async () => {
    const c = await captureContext();
    const exit = await runCli(c, ['doctr']);
    expect(exit?.code).toBe('commander.unknownCommand');
    expect(c.stderr.join('\n')).toContain('doctor');
  });

  it('rejects conflicting run modes before touching any engine', async () => {
    const c = await captureContext({ detected: ['claude'] });
    await runCli(c, ['run', 'ship it', '--solo', '--crew']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('--solo or --crew');
  });

  it('reports a missing CLI for run without crashing', async () => {
    const c = await captureContext({ detected: [] });
    await runCli(c, ['run', 'add', 'oauth']);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('edu demo');
  });

  it('translates user-facing messages with --lang es', async () => {
    const c = await captureContext({ detected: [] });
    await runCli(c, ['run', 'algo', '--lang', 'es']);
    expect(c.stderr.join('\n')).toContain('Instala uno o prueba: edu demo');
  });
});

describe('argument strictness', () => {
  it('still rejects excess arguments on subcommands', async () => {
    const c = await captureContext();
    const exit = await runCli(c, ['demo', 'extra']);
    expect(exit?.code).toBe('commander.excessArguments');
  });
});
