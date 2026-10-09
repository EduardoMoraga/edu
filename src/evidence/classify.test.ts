import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyPackage } from './classify.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function packageDir(task: unknown, verification: unknown[], entropy: unknown = { findings: [] }, outcome: unknown = { ok: true }) {
  const root = await mkdtemp(join(tmpdir(), 'edu-evidence-classify-'));
  roots.push(root);
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(join(root, 'task.json'), JSON.stringify(task)),
    writeFile(join(root, 'verification.jsonl'), verification.map((v) => JSON.stringify(v)).join('\n')),
    writeFile(join(root, 'entropy.json'), JSON.stringify(entropy)),
    writeFile(join(root, 'outcome.json'), JSON.stringify(outcome)),
    writeFile(join(root, 'intervention.jsonl'), ''),
  ]);
  return root;
}
const proof = { type: 'verify.result', requirementIds: ['r1'], ok: true, kind: 'deterministic' };

describe('package outcome classification', () => {
  it('classifies all five outcome labels deterministically', async () => {
    const autonomous = await packageDir({ requirements: [{ id: 'r1' }] }, [{ ...proof, kind: 'reproduction', ok: false }, { ...proof, kind: 'deterministic', ok: false }, proof]);
    const assisted = await packageDir({ requirements: [{ id: 'r1' }] }, [proof]);
    await writeFile(join(assisted, 'intervention.jsonl'), JSON.stringify({ avoidable: false }));
    const unverified = await packageDir({ requirements: [{ id: 'r1' }] }, []);
    const failed = await packageDir({ requirements: [{ id: 'r1' }] }, [{ ...proof, ok: false }], undefined, { ok: false });
    const unsafe = await packageDir({ requirements: [{ id: 'r1' }] }, [proof], { findings: [{ category: 'weakened-tests', severity: 3 }] });
    const bypassed = await packageDir({ requirements: [{ id: 'r1' }] }, [proof], { findings: [{ category: 'checks-bypassed', severity: 3 }] });
    expect(await classifyPackage(autonomous)).toBe('autonomous_verified_success');
    expect(await classifyPackage(assisted)).toBe('assisted_verified_success');
    expect(await classifyPackage(unverified)).toBe('unverified_success');
    expect(await classifyPackage(failed)).toBe('failed');
    expect(await classifyPackage(unsafe)).toBe('unsafe_invalid');
    expect(await classifyPackage(bypassed)).toBe('unsafe_invalid');
  });
});
