import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resumeGoal } from './resume.js';

describe('goal resume', () => {
  it('re-plans a terminal goal with fresh approvals and rejects cross-workspace/traversal/live replay', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu3-resume-'));
    const runId = randomUUID();
    const checkpoint = { runId, cwd: dir, goal: 'Build safely', status: 'budget_exhausted', summary: 'maxSpawns exhausted', sessionId: 'preserved-old-session' };
    const path = join(dir, `${runId}.status.json`);
    try {
      await writeFile(path, JSON.stringify(checkpoint));
      expect(await resumeGoal(dir, runId, dir)).toContain('previous approvals do not transfer');
      await expect(resumeGoal(dir, '../secret', dir)).rejects.toThrow('Invalid run ID');
      await expect(resumeGoal(dir, runId, join(dir, 'other'))).rejects.toThrow('another workspace');
      for (const status of ['running', 'completed']) {
        await writeFile(path, JSON.stringify({ ...checkpoint, status }));
        await expect(resumeGoal(dir, runId, dir)).rejects.toThrow('Cannot resume');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('resumes a run left running by a process that is gone, but never a live one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu3-resume-crash-'));
    const runId = randomUUID();
    const path = join(dir, `${runId}.status.json`);
    const updatedAt = '2026-11-01T10:00:00.000Z';
    const running = { runId, cwd: dir, goal: 'Build safely', status: 'running', summary: 'Run started', updatedAt, budget: { timeoutMs: 600_000 } };
    const write = (extra: object) => writeFile(path, JSON.stringify({ ...running, ...extra }));
    const probes = (alive: boolean, minutesLater = 1) => ({ host: 'here', isAlive: () => alive, now: () => Date.parse(updatedAt) + minutesLater * 60_000 });
    try {
      await write({ owner: { pid: 4321, host: 'here' } });
      expect(await resumeGoal(dir, runId, dir, probes(false))).toContain('status interrupted');
      await expect(resumeGoal(dir, runId, dir, probes(true))).rejects.toThrow('Cannot resume a running run');
      // Owner on another machine, or a snapshot from before owners were recorded: only past its own timeout.
      for (const owner of [{ owner: { pid: 4321, host: 'elsewhere' } }, {}]) {
        await write(owner);
        await expect(resumeGoal(dir, runId, dir, probes(false, 5))).rejects.toThrow('Cannot resume a running run');
        expect(await resumeGoal(dir, runId, dir, probes(false, 12))).toContain('status interrupted');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
