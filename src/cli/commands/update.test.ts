import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import type { RunResult, UpdateDeps } from '../../update/update.js';
import { captureContext, out, runCli, type Captured } from '../testkit.js';
import { registerUpdate } from './update.js';

const release = (tag: string) => ({
  tag_name: tag, name: tag, body: '## Novedades\n- **Espacios** desde documentos\n- `edu update`', html_url: `https://github.com/EduardoMoraga/edu/releases/tag/${tag}`,
  assets: [{ name: 'edu-agent.tgz', browser_download_url: `https://github.com/EduardoMoraga/edu/releases/download/${tag}/edu-agent.tgz` }],
});

function deps(over: Partial<UpdateDeps> & { script?: (args: string[]) => Partial<RunResult> | undefined } = {}): UpdateDeps & { calls: string[][] } {
  const calls: string[][] = [];
  const { script, ...rest } = over;
  return {
    calls,
    fetch: (async () => new Response(JSON.stringify(release('v0.8.0')), { status: 200 })) as typeof fetch,
    run: async (_cmd, args) => {
      calls.push(args);
      const scripted = script?.(args);
      if (scripted) return { code: 0, stdout: '', stderr: '', ...scripted };
      if (args[0] === 'root') return { code: 0, stdout: '/p/lib/node_modules\n', stderr: '' };
      if (args[1] === '--version') return { code: 0, stdout: '0.8.0\n', stderr: '' };
      if (args[1] === 'internal') return { code: 0, stdout: '[{"name":"albert","root":"/w","status":"migrated"}]', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    exists: async () => true,
    execPath: '/p/bin/node',
    platform: 'darwin',
    packageRoot: '/p/lib/node_modules/edu-agent',
    currentVersion: '0.7.0',
    env: {},
    ...rest,
  };
}

async function run(c: Captured, argv: string[], d: UpdateDeps): Promise<void> {
  const program = new Command('edu').exitOverride().option('--lang <lang>').option('--cwd <dir>');
  registerUpdate(program, c.ctx, d);
  await program.parseAsync(argv, { from: 'user' });
}

describe('edu update', () => {
  it('--check reports an available update and what is new, without installing', async () => {
    const c = await captureContext();
    const d = deps();
    await run(c, ['update', '--check'], d);
    expect(out(c)).toContain('Update available: 0.7.0 → 0.8.0');
    expect(out(c)).toContain('• Espacios desde documentos');
    expect(out(c)).toContain('Run: edu update');
    expect(d.calls).toEqual([]);
  });

  it('says when it is up to date or ahead', async () => {
    const c = await captureContext();
    await run(c, ['update'], deps({ currentVersion: '0.8.0' }));
    expect(out(c)).toContain('Edu 0.8.0 is up to date (latest release v0.8.0)');
    const e = await captureContext();
    await run(e, ['update', '--lang', 'es'], deps({ currentVersion: '0.9.0' }));
    expect(out(e)).toContain('va por delante');
  });

  it('says clearly when offline and keeps the current version', async () => {
    const c = await captureContext();
    await run(c, ['update'], deps({ fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch }));
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('Are you offline? Edu 0.7.0 stays as it is.');
  });

  it('installs, runs the new setup and migration, and prints what is new', async () => {
    const c = await captureContext();
    const d = deps();
    await run(c, ['update'], d);
    expect(c.exitCode).toBeUndefined();
    expect(d.calls.map(a => a[0] === 'install' || a[0] === 'root' ? a[0] : a[1])).toEqual(['install', 'root', '--version', 'setup', 'internal']);
    expect(out(c)).toContain('Edu 0.8.0 installed.');
    expect(out(c)).toContain('Workspaces: 1 migrated · 0 missing (skipped) · 0 failed');
    expect(out(c)).toContain("What's new in v0.8.0:");
  });

  it('reports a failed install and stops', async () => {
    const c = await captureContext();
    const d = deps({ script: (args) => (args[0] === 'install' ? { code: 1, stderr: 'npm ERR! 404' } : undefined) });
    await run(c, ['update', '--to', 'v0.8.0'], d);
    expect(c.exitCode).toBe(1);
    expect(c.stderr.join('\n')).toContain('Install failed; Edu 0.7.0 is still installed and untouched.');
    expect(c.stderr.join('\n')).toContain('npm ERR! 404');
    expect(d.calls).toHaveLength(1);
  });

  it('is registered on the real program with a hidden migration hook', async () => {
    const c = await captureContext();
    await runCli(c, ['internal', 'migrate-workspaces', '--json']);
    expect(JSON.parse(out(c))).toEqual([]);
    const h = await captureContext();
    await runCli(h, ['--help']);
    expect(out(h)).toMatch(/update \[options\] \[tag\]/);
    expect(out(h)).not.toContain('internal');
  });
});
