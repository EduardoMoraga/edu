import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { BUNDLE_LIMITS, readSkillBundle, validateSkillBundle } from './bundle.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const doc = (bundle: unknown) => `---\n${stringify({ name: 'fixture', description: 'Fixture', bundle })}---\nUse the helper.\n`;
it('keeps legacy document-only skills and validates explicitly declared UTF-8 resources', async () => {
  expect((await validateSkillBundle({ name: 'fixture', content: 'Legacy document' })).files.map(file => file.path)).toEqual(['SKILL.md']);
  const result = await validateSkillBundle({ name: 'fixture', content: doc({ files: [{ path: 'resources/example.json' }], references: ['resources/example.json'], hosts: ['codex'], requires: ['node'] }), files: { 'resources/example.json': '{}' } }, { host: 'codex', hasCommand: async name => name === 'node' });
  expect(result.files).toHaveLength(2);
  expect(result.files[1]?.sha256).toMatch(/^[a-f0-9]{64}$/);
});
it.each(['/tmp/private', 'C:/private', '../private', 'scripts/../private', 'scripts\\private', 'CON.txt', 'scripts/file.', 'scripts//file', 'scripts/%2e%2e'])('rejects nonportable declared path %s', async path => {
  await expect(validateSkillBundle({ name: 'fixture', content: doc({ files: [{ path }] }), files: { [path]: 'data' } })).rejects.toThrow(/path/i);
});
it('rejects undeclared/missing references, case collisions, prefix collisions and false hashes', async () => {
  await expect(validateSkillBundle({ name: 'fixture', content: doc({ references: ['scripts/missing.mjs'] }) })).rejects.toThrow(/reference/i);
  await expect(validateSkillBundle({ name: 'fixture', content: 'Doc', files: { private: 'secret' } })).rejects.toThrow(/undeclared/i);
  await expect(validateSkillBundle({ name: 'fixture', content: doc({ files: [{ path: 'A.txt' }, { path: 'a.txt' }] }), files: { 'A.txt': 'a', 'a.txt': 'b' } })).rejects.toThrow(/duplicate/i);
  await expect(validateSkillBundle({ name: 'fixture', content: doc({ files: [{ path: 'scripts' }, { path: 'scripts/a' }] }), files: { scripts: 'a', 'scripts/a': 'b' } })).rejects.toThrow(/parent/i);
  await expect(validateSkillBundle({ name: 'fixture', content: doc({ files: [{ path: 'helper', sha256: '0'.repeat(64) }] }), files: { helper: 'data' } })).rejects.toThrow(/hash/i);
});
it('rejects unavailable requirements and unsupported hosts without executing helpers', async () => {
  await expect(validateSkillBundle({ name: 'fixture', content: doc({ requires: ['missing'] }) }, { hasCommand: async () => false })).rejects.toThrow(/requirement/i);
  await expect(validateSkillBundle({ name: 'fixture', content: doc({ hosts: ['pi'] }) }, { host: 'codex' })).rejects.toThrow(/host/i);
});
it('enforces file count/byte/UTF-8 limits and refuses symlinked ancestors', async () => {
  await expect(validateSkillBundle({ name: 'fixture', content: doc({ files: Array.from({ length: BUNDLE_LIMITS.files }, (_, i) => ({ path: `file${i}` })) }) })).rejects.toThrow();
  await expect(validateSkillBundle({ name: 'fixture', content: doc({ files: [{ path: 'large' }] }), files: { large: 'x'.repeat(BUNDLE_LIMITS.fileBytes + 1) } })).rejects.toThrow(/oversized/i);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'edu-bundle-validation-'))); roots.push(root);
  await writeFile(join(root, 'SKILL.md'), doc({ files: [{ path: 'data' }] })); await writeFile(join(root, 'data'), Buffer.from([0xff]));
  await expect(readSkillBundle(root, 'fixture')).rejects.toThrow();
  await mkdir(join(root, 'outside')); await symlink(join(root, 'outside'), join(root, 'linked'), 'junction');
  await writeFile(join(root, 'SKILL.md'), doc({ files: [{ path: 'linked/data' }] }));
  await expect(readSkillBundle(root, 'fixture')).rejects.toThrow(/symlink/i);
});
