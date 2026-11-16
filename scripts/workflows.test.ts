import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// Supply-chain and runaway-job guards for every GitHub workflow.
const DIR = join(import.meta.dirname, '..', '.github', 'workflows');
interface Job { 'timeout-minutes'?: number; permissions?: Record<string, string>; steps?: Array<{ uses?: string }> }
interface Workflow { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> }

async function workflows(): Promise<Array<[string, Workflow, string]>> {
  const files = (await readdir(DIR)).filter(file => /\.ya?ml$/.test(file));
  return Promise.all(files.map(async file => {
    const text = await readFile(join(DIR, file), 'utf8');
    return [file, parse(text) as Workflow, text] as [string, Workflow, string];
  }));
}

describe('GitHub workflows', () => {
  it('pin every action to a full commit SHA with a version comment', async () => {
    for (const [file, , text] of await workflows()) {
      for (const line of text.split('\n').filter(l => /^\s*-?\s*uses:/.test(l))) {
        expect(line, file).toMatch(/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/);
      }
    }
  });

  it('default to read-only contents and bound every job in time', async () => {
    for (const [file, workflow] of await workflows()) {
      expect(workflow.permissions, file).toEqual({ contents: 'read' });
      for (const [name, job] of Object.entries(workflow.jobs)) expect(job['timeout-minutes'], `${file} ${name}`).toBeGreaterThan(0);
    }
  });

  it('release only from version tags, never from pull requests', async () => {
    const release = (await workflows()).find(([file]) => file === 'release.yml')?.[1];
    expect(release?.on).toEqual({ push: { tags: ['v*'] } });
    expect(release?.jobs.release?.permissions).toEqual({ contents: 'write', 'id-token': 'write', attestations: 'write' });
  });
});
