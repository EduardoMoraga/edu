import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { openBrain } from '../brain/index.js';
import { acceptProposal, listProposals, rejectProposal } from './proposals.js';
const fault = vi.hoisted(() => ({ path: '', remaining: 0 }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: async (path: Parameters<typeof actual.writeFile>[0], ...args: [Parameters<typeof actual.writeFile>[1], Parameters<typeof actual.writeFile>[2]?]) => {
    if (String(path) === fault.path && fault.remaining > 0) { fault.remaining--; throw new Error('injected status write'); }
    return actual.writeFile(path, ...args);
  } };
});
const roots: string[] = [];
afterEach(async () => { fault.path = ''; fault.remaining = 0; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(evidence: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'edu-proposal-bundle-')); roots.push(root);
  const brain = openBrain([{ scope: 'project', root }]); await brain.init({ scope: 'project', root });
  await mkdir(join(root, 'proposals'), { recursive: true });
  const content = '---\nname: fixture\ndescription: Fixture\nbundle:\n  files:\n    - path: helper.mjs\n---\nUse [helper](helper.mjs).\n';
  const proposal = { id: 'skill-fixture', kind: 'skill', name: 'fixture', rationale: 'Test bundle', content, files: { 'helper.mjs': 'console.log("accepted-bundle")' }, evidence, checks: [{ id: 'declared-check', ok: true, evidence }], created: new Date().toISOString(), status: 'proposed' };
  await writeFile(join(root, 'proposals/skill-fixture.md'), `---\n${stringify(proposal)}---\n`);
  return { root, brain, proposal };
}
it('keeps explicit rejection inactive, including helper files', async () => {
  const f = await fixture(); await rejectProposal(f.brain, f.proposal.id, f.root);
  expect((await listProposals(f.brain, f.root))[0]?.status).toBe('rejected');
  await expect(readFile(join(f.root, 'skills/fixture/helper.mjs'))).rejects.toThrow();
});
it('accepts complete bundles with supported evidence and hashes without granting verified wins', async () => {
  const f = await fixture();
  const note = await f.brain.write({ tier: 'transitive', kind: 'lesson', title: 'Fixture evidence', body: 'Observed in a fixture.', band: 'inferred' });
  f.proposal.evidence = [note.meta.id]; f.proposal.checks[0]!.evidence = [note.meta.id];
  await writeFile(join(f.root, 'proposals/skill-fixture.md'), `---\n${stringify(f.proposal)}---\n`);
  const accepted = await acceptProposal(f.brain, f.proposal.id, f.root);
  expect(accepted.status).toBe('accepted'); expect(accepted.evidence).toEqual([note.meta.id]);
  expect(accepted.hashes?.['helper.mjs']).toMatch(/^[a-f0-9]{64}$/);
  expect(execFileSync(process.execPath, [join(f.root, 'skills/fixture/helper.mjs')], { encoding: 'utf8' }).trim()).toBe('accepted-bundle');
  expect((await listProposals(f.brain, f.root))[0]?.checks).toEqual(f.proposal.checks);
  expect((await f.brain.read(note.meta.id))?.meta.usage?.verifiedWins ?? 0).toBe(0);
  const files = await readdir(join(f.root, 'skills/fixture'));
  await acceptProposal(f.brain, f.proposal.id, f.root);
  expect(await readdir(join(f.root, 'skills/fixture'))).toEqual(files);
});
it('refuses nonexistent evidence and preserves a custom skill before acceptance', async () => {
  const f = await fixture(['L-does-not-exist']);
  await expect(acceptProposal(f.brain, f.proposal.id, f.root)).rejects.toThrow();
  await expect(readFile(join(f.root, 'skills/fixture/SKILL.md'))).rejects.toThrow();
  const g = await fixture(); await mkdir(join(g.root, 'skills/fixture'), { recursive: true }); await writeFile(join(g.root, 'skills/fixture/SKILL.md'), 'CUSTOM');
  await expect(acceptProposal(g.brain, g.proposal.id, g.root)).rejects.toThrow(/unowned|collision/i);
  expect(await readFile(join(g.root, 'skills/fixture/SKILL.md'), 'utf8')).toBe('CUSTOM');
  expect((await listProposals(g.brain, g.root))[0]?.status).toBe('proposed');
});

it('rolls acceptance back when the human decision cannot be persisted', async () => {
  const f = await fixture();
  fault.path = join(f.root, 'proposals/skill-fixture.md'); fault.remaining = 1;
  await expect(acceptProposal(f.brain, f.proposal.id, f.root)).rejects.toThrow('injected status write');
  expect((await listProposals(f.brain, f.root))[0]?.status).toBe('proposed');
  await expect(readFile(join(f.root, 'skills/fixture/SKILL.md'))).rejects.toThrow();
  await expect(readFile(join(f.root, 'skills/fixture/helper.mjs'))).rejects.toThrow();
  await expect(readFile(join(f.root, 'skills/.edu-bundles.json'))).rejects.toThrow();
});
