import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkerOutputFilter, createCrewArtifacts, redactWorkerOutput } from './artifacts.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const id = '12345678-1234-1234-1234-123456789abc';

describe('crew artifacts', () => {
  it('keeps stable byte offsets across UTF-8 pages and rejects invalid paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-artifacts-')); roots.push(root);
    const artifacts = createCrewArtifacts(root);
    await artifacts.replace(id, 'summary', 'hello 🦉 world');
    const first = await artifacts.read(id, 'summary', 0, 8);
    expect(first.text).toBe('hello ');
    expect(first.truncated).toBe(true);
    const second = await artifacts.read(id, 'summary', first.nextOffset!, 5);
    expect(second.text).toBe('🦉 ');
    expect((await artifacts.read(id, 'summary', second.nextOffset!, 100)).text).toBe('world');
    await expect(artifacts.read(id, 'summary', 7, 8)).rejects.toThrow('UTF-8');
    await expect(artifacts.read('../escape', 'summary')).rejects.toThrow('Invalid crew artifact job id');
    await expect(artifacts.read(id, 'summary', -1)).rejects.toThrow('offset');
    await expect(artifacts.read(id, 'summary', 999)).rejects.toThrow('offset');
    await expect(artifacts.read(id, 'summary', 0, 4097)).rejects.toThrow('maxBytes');
  });

  it('redacts credentials before persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-artifacts-')); roots.push(root);
    const artifacts = createCrewArtifacts(root);
    const raw = 'api_key=supersecretvalue Bearer abcdefghijklmnop';
    await artifacts.append(id, 'output', raw);
    const page = await artifacts.read(id, 'output');
    expect(page.text).not.toContain('supersecretvalue');
    expect(page.text).not.toContain('abcdefghijklmnop');
    expect(redactWorkerOutput(raw)).toContain('[REDACTED]');
  });
  it.each([
    '"api_key": "abc"', 'client_secret=abc', 'AWS_SECRET_ACCESS_KEY=abc', 'db_password=abc',
    'token=abc', 'https://user:pass@example.com', '{\\"password\\":\\"hunter2\\"}',
  ])('redacts %s', raw => {
    expect(redactWorkerOutput(raw)).not.toContain('abc');
    if (raw.includes('pass@')) expect(redactWorkerOutput(raw)).not.toContain('pass@');
    if (raw.includes('hunter2')) expect(redactWorkerOutput(raw)).not.toContain('hunter2');
  });
  it('holds split PEM content and withholds oversized lines', () => {
    const filter = new WorkerOutputFilter();
    expect(filter.push('-----BEGIN PRIVATE')).toBe('');
    expect(filter.push(' KEY-----\nsecret-line\n')).toBe('[REDACTED PRIVATE KEY]\n');
    expect(filter.push('-----END PRIVATE KEY-----\nnext\n')).toBe('next\n');
    expect(filter.push('x'.repeat(9000))).toContain('long output line withheld');
    expect(filter.flush()).toBe('');
  });
});
