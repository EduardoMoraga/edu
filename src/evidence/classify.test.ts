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
  it.each([
    { ...proof, ok: 'false' }, { ...proof, ok: 1 }, { ...proof, kind: 'invented' },
    { ...proof, requirementIds: 'r1' }, { ...proof, requirementIds: [1] }, [proof],
  ])('rejects invalid runtime verification %#', async verification => {
    expect(await classifyPackage(await packageDir({ requirements: [{ id: 'r1' }] }, [verification]))).toBe('failed');
  });
  it('fails conservatively for missing files and corrupt JSONL rather than dropping records', async () => {
    const root = await packageDir({ requirements: [{ id: 'r1' }] }, [proof]);
    await writeFile(join(root, 'verification.jsonl'), `${JSON.stringify(proof)}\n{broken`);
    expect(await classifyPackage(root)).toBe('failed');
    await rm(join(root, 'outcome.json'));
    expect(await classifyPackage(root)).toBe('failed');
  });
  it('does not call incomplete or malformed packages successful', async () => {
    const root = await packageDir({ requirements: [{ id: 'r1' }] }, [proof], undefined, {});
    expect(await classifyPackage(root)).toBe('failed');
    const malformed = await packageDir({ requirements: [{ id: 'r1' }] }, [{ ...proof, ok: 'false' }]);
    expect(await classifyPackage(malformed)).toBe('failed');
  });
  it('requires a later deterministic pass to clear a deterministic failure', async () => {
    const events = [{ ...proof, ok: false }, { ...proof, kind: 'review' }];
    expect(await classifyPackage(await packageDir({ requirements: [{ id: 'r1' }] }, events))).toBe('failed');
    expect(await classifyPackage(await packageDir({ requirements: [{ id: 'r1' }] }, [...events, proof]))).toBe('autonomous_verified_success');
  });
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
