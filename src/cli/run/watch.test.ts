import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RecallHit } from '../../core/contracts.js';
import { uiLang } from '../i18n.js';
import { captureContext, runCli } from '../testkit.js';
import { cliDispatch, createCommandHandler } from './commands.js';

const JOB = '33333333-cccc-4ccc-8ccc-cccccccccccc';

async function seedJob(eduHome: string) {
  const dir = join(eduHome, 'crew');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${JOB}.json`), JSON.stringify({ id: JOB, cli: 'codex', task: 'write tests', status: 'done', createdAt: '2026-10-09T12:00:00.000Z', summary: 'added 3 tests' }));
  await writeFile(join(dir, `${JOB}.jsonl`), `${JSON.stringify({ type: 'agent.text', agentId: 'e', text: 'tests are green', at: '2026-10-09T12:00:05.000Z' })}\n`);
}

describe('edu watch (non-TTY)', () => {
  it('lists crew jobs', async () => {
    const cap = await captureContext();
    await seedJob(cap.dirs.eduHome);
    await runCli(cap, ['watch']);
    expect(cap.stderr).toEqual([]);
    expect(cap.stdout.join('\n')).toMatch(/done\s+33333333\s+codex\s+write tests/);
  });

  it('prints one job as plain events', async () => {
    const cap = await captureContext();
    await seedJob(cap.dirs.eduHome);
    await runCli(cap, ['watch', '3333']);
    const text = cap.stdout.join('\n');
    expect(text).toContain('tests are green');
    expect(text).toContain('added 3 tests');
  });

  it('explains how to start when there are no jobs, and fails on an unknown id', async () => {
    const cap = await captureContext();
    await runCli(cap, ['--lang', 'es', 'watch']);
    expect(cap.stdout.join('\n')).toContain('Aún no hay trabajos del equipo');
    const miss = await captureContext();
    await runCli(miss, ['watch', 'nope']);
    expect(miss.stderr.join('\n')).toContain('no crew job matches nope');
    expect(miss.exitCode).toBe(1);
  });
});

describe('palette host commands', () => {
  const hit = (title: string) => ({ note: { meta: { title } }, score: 1, why: '' }) as unknown as RecallHit;
  const brain = {
    stats: async () => ({ total: 12, byStatus: { accepted: 2, candidate: 1 } }),
    recall: vi.fn(async (q: string) => (q === 'oauth' ? [hit('OAuth state'), hit('Callback route')] : [])),
  };

  it('answers /brain and /recall from the brain', async () => {
    const handle = createCommandHandler({ lang: 'en', brain });
    expect(await handle('brain', '')).toMatch(/^brain: 12 notes/);
    expect(await handle('recall', 'oauth')).toBe('2 note(s): OAuth state · Callback route');
    expect(await handle('recall', 'zzz')).toBe('no notes match "zzz"');
  });

  it('summarizes /status and runs /dispatch through the edu binary', async () => {
    const run = vi.fn(async () => 'job 4f2a started');
    const handle = createCommandHandler({
      lang: 'en',
      crew: {
        list: async () => [
          { id: 'a', cli: 'codex', task: 't', status: 'running' },
          { id: 'b', cli: 'pi', task: 't', status: 'done' },
          { id: 'c', cli: 'pi', task: 't', status: 'done' },
        ],
        dispatch: cliDispatch(run, '/repo'),
      },
    });
    expect(await handle('status', '')).toBe('3 job(s): 1 running · 2 done');
    expect(await handle('dispatch', 'codex write tests for auth')).toBe('dispatched: job 4f2a started');
    expect(run).toHaveBeenCalledWith(['--cwd', '/repo', 'crew', 'dispatch', 'codex', 'write tests for auth']);
    expect(await handle('dispatch', 'codex')).toBe('usage: /dispatch <cli> <task>');
  });

  it('defers to the view when a capability is not wired', async () => {
    expect(await createCommandHandler({ lang: 'en' })('brain', '')).toBeUndefined();
  });
});

describe('uiLang', () => {
  it('follows the locale unless a language was chosen explicitly', () => {
    expect(uiLang('en', { LANG: 'es_CL.UTF-8' })).toBe('es');
    expect(uiLang('en', { LANG: 'es_CL.UTF-8' }, true)).toBe('en');
    expect(uiLang('es', { LANG: 'en_US.UTF-8' })).toBe('es');
    expect(uiLang('en', { LANG: 'en_US.UTF-8' })).toBe('en');
  });
});
