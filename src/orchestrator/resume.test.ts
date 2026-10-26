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
});
