import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBrain } from './brain.js';
import { lockFs, withBrainLocks, withFileLock } from './lock.js';
import { atomicFs, exclusiveWrite, readNote } from './store.js';
import { parseMarkdown } from './frontmatter.js';

const owned: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edu-brain-reliability-'));
  owned.push(root);
  return { root, brain: openBrain([{ scope: 'project', root }]) };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(owned.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

// The child loads source through a local TS loader, never dist/cli/MCP or discovery.
// cwd, home and EDU_HOME all point to this fixture; no parent process env is inherited.
const childSource = `
import { registerHooks, createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const [moduleUrl, root, mode] = process.argv.slice(1);
const require = createRequire(moduleUrl);
const ts = require('typescript');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return { format: 'module', source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    return next(url, context);
  }
});
const { openBrain } = await import(moduleUrl);
const brain = openBrain([{ scope: 'project', root }]);
if (mode === 'create') {
  try { await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Concurrent process note', body: String(process.pid) }); process.stdout.write('created'); }
  catch (error) { if (!String(error).includes('already exists')) throw error; process.stdout.write('exists'); }
} else {
  for (let i = 0; i < 5; i++) await brain.feedback('L-concurrent-process-note', true);
  process.stdout.write('updated');
}
`;

function child(root: string, mode: string): Promise<string> {
  const moduleUrl = new URL('./brain.ts', import.meta.url).href;
  const env: NodeJS.ProcessEnv = {
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    TEMP: root, TMP: root, HOME: root, USERPROFILE: root, EDU_HOME: root,
    APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
  };
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ['--input-type=module', '--eval', childSource, moduleUrl, root, mode], { cwd: root, env, windowsHide: true });
    let stdout = '', stderr = '';
    process.stdout.on('data', data => { stdout += data; });
    process.stderr.on('data', data => { stderr += data; });
    const timeout = setTimeout(() => { process.kill(); reject(new Error('Fixture child timed out')); }, 25_000);
    process.once('error', error => { clearTimeout(timeout); reject(error); });
    process.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve(stdout) : reject(new Error(`Fixture child exited ${code}: ${stderr}`)); });
  });
}

describe('brain persistence reliability', () => {
  it('uses process-wide exclusion for creation and read-modify-write feedback', async () => {
    const { root, brain } = await fixture();
    const outcomes = await Promise.allSettled([child(root, 'create'), child(root, 'create')]);
    expect(outcomes.map(outcome => outcome.status === 'fulfilled' ? outcome.value : String(outcome.reason)).sort()).toEqual(['created', 'exists']);
    const before = await brain.read('L-concurrent-process-note');
    const feedback = await Promise.allSettled([child(root, 'feedback'), child(root, 'feedback')]);
    expect(feedback.map(outcome => outcome.status === 'fulfilled' ? outcome.value : String(outcome.reason))).toEqual(['updated', 'updated']);
    const after = await brain.read('L-concurrent-process-note');
    expect(after?.body).toBe(before?.body);
    expect(after?.meta.usage?.wins).toBe(10);
  }, 60_000);

  it('never overwrites an invalid destination and diagnoses it without exposing its content', async () => {
    const { root, brain } = await fixture();
    const path = join(root, 'brain', '3-transitive', 'D-keep-original.md');
    await mkdir(join(root, 'brain', '3-transitive'), { recursive: true });
    const original = '---\nid: D-keep-original\ntier: transitive\ntitle: broken: yaml\n---\nprivate body';
    await writeFile(path, original);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(brain.write({ title: 'Keep original', body: 'replacement', tier: 'transitive', kind: 'decision' })).rejects.toThrow(/already exists/);
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(path));
    expect(warn.mock.calls.flat().join(' ')).not.toContain('private body');
  });

  it('normalizes the read model and preserves original metadata through usage writes', async () => {
    const { root, brain } = await fixture();
    const path = join(root, 'brain', '3-transitive', 'L-optional.md');
    await mkdir(join(root, 'brain', '3-transitive'), { recursive: true });
    const original = '---\nid: L-optional\ntier: transitive\nkind: lesson\ntitle: Optional fields\ntags: null\nlinks: [okay, 42]\nusage: {wins: broken, losses: -1}\n---\nsearchable';
    await writeFile(path, original);
    const note = await readNote(path);
    expect(note?.meta).toMatchObject({ tags: [], links: ['okay'], usage: { uses: 0, wins: 0, losses: 0 } });
    expect(Number.isFinite(Date.parse(note!.meta.created))).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(original);
    await expect(brain.recall('searchable')).resolves.toHaveLength(1);
    const after = parseMarkdown(await readFile(path, 'utf8'));
    expect(after.meta.tags).toBeNull();
    expect(after.meta.links).toEqual(['okay', 42]);
    expect(after.body).toBe('searchable');
    expect(after.meta).not.toHaveProperty('created');
  });

  it('keeps scalar tags and nested YAML wikilinks through recall, recordUse and feedback', async () => {
    const { root, brain } = await fixture();
    const path = join(root, 'brain', '3-transitive', 'L-nested.md');
    await mkdir(join(root, 'brain', '3-transitive'), { recursive: true });
    const original = '---\nid: L-nested\ntier: transitive\nkind: lesson\ntitle: Nested fields\ntags: foo\nlinks: [[L-x], [L-y, [L-z]]]\ncustom: {keep: yes}\n---\nsearchable nested';
    await writeFile(path, original);
    expect((await readNote(path))?.meta).toMatchObject({ tags: ['foo'], links: ['L-x', 'L-y', 'L-z'] });
    await brain.recall('searchable nested');
    await brain.recordUse(['L-nested'], new Date('2030-01-01'));
    await brain.feedback('L-nested', true);
    const after = parseMarkdown(await readFile(path, 'utf8'));
    const before = parseMarkdown(original);
    const { usage, updated, ...rest } = after.meta;
    expect(rest).toEqual(before.meta);
    expect(usage).toMatchObject({ uses: 2, wins: 1 });
    expect(after.body).toBe(before.body);
  });

  it.each(['orphan', 'live'] as const)('recalls without writing usage when a %s writer owns the lock', async mode => {
    const { root, brain } = await fixture();
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Available recall', body: 'needle' });
    const original = await readFile(note.path, 'utf8');
    const lock = join(root, 'brain', '.edu-write.lock');
    const read = async () => {
      await expect(brain.recall('needle')).resolves.toHaveLength(1);
      await expect(brain.recordUse([note.meta.id])).resolves.toBeUndefined();
      expect(await readFile(note.path, 'utf8')).toBe(original);
      expect(await readFile(lock, 'utf8')).toContain('pid');
    };
    if (mode === 'orphan') { await writeFile(lock, '{"pid":0}'); await read(); }
    else await withFileLock(lock, read);
  });

  it.each(['open', 'mkdir'] as const)('retrieves results when lock %s is unavailable on a read-only brain', async operation => {
    const { brain } = await fixture();
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Readable brain', body: 'needle' });
    const original = await readFile(note.path, 'utf8');
    const failure = Object.assign(new Error('read-only fixture'), { code: 'EACCES' });
    const spy = operation === 'open' ? vi.spyOn(lockFs, 'open').mockRejectedValue(failure) : vi.spyOn(lockFs, 'mkdir').mockRejectedValue(failure);
    await expect(brain.recall('needle')).resolves.toHaveLength(1);
    await expect(brain.recordUse([note.meta.id])).resolves.toBeUndefined();
    expect(await readFile(note.path, 'utf8')).toBe(original);
    spy.mockRestore();
  });

  it('does not hide a usage write failure after acquiring the lock', async () => {
    const { brain } = await fixture();
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Usage failure', body: 'needle' });
    vi.spyOn(atomicFs, 'writeFile').mockRejectedValue(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    await expect(brain.recall('needle')).rejects.toThrow('disk full');
  });

  it('keeps recall available and releases an uninitialized lock if its metadata write fails', async () => {
    const { root, brain } = await fixture();
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Lock metadata failure', body: 'needle' });
    const original = await readFile(note.path, 'utf8');
    const open = lockFs.open;
    vi.spyOn(lockFs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(Object.assign(new Error('cannot initialize'), { code: 'EACCES' }));
      return handle;
    });
    await expect(brain.recall('needle')).resolves.toHaveLength(1);
    expect(await readFile(note.path, 'utf8')).toBe(original);
    await expect(readFile(join(root, 'brain', '.edu-write.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('releases earlier overlay locks when optional usage cannot acquire a later one', async () => {
    const first = await fixture(), second = await fixture();
    const locations = [first, second].map(item => ({ scope: 'project' as const, root: item.root })).sort((a, b) => a.root.localeCompare(b.root));
    await mkdir(join(locations[1]!.root, 'brain'), { recursive: true });
    const orphan = join(locations[1]!.root, 'brain', '.edu-write.lock');
    await writeFile(orphan, '{"pid":0}');
    await expect(openBrain(locations).recordUse(['nonexistent'])).resolves.toBeUndefined();
    await expect(readFile(join(locations[0]!.root, 'brain', '.edu-write.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(orphan, 'utf8')).toBe('{"pid":0}');
  });

  it('publishes only a complete note and never replaces a competing destination', async () => {
    const { root } = await fixture();
    const path = join(root, 'published.md');
    const link = atomicFs.link;
    const spy = vi.spyOn(atomicFs, 'link').mockImplementation(async (temp, target) => {
      await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(temp, 'utf8')).toBe('complete content');
      return link(temp, target);
    });
    await exclusiveWrite(path, 'complete content');
    spy.mockRestore();
    await expect(exclusiveWrite(path, 'replacement')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path, 'utf8')).toBe('complete content');
    const other = join(root, 'concurrent.md');
    const results = await Promise.allSettled([exclusiveWrite(other, 'first'), exclusiveWrite(other, 'second')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(['first', 'second']).toContain(await readFile(other, 'utf8'));
    expect((await readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('cleans a failed partial temporary write without exposing or reserving the destination', async () => {
    const { root } = await fixture();
    const path = join(root, 'failed.md');
    const spy = vi.spyOn(atomicFs, 'writeFile').mockImplementationOnce(async temp => {
      await writeFile(temp, 'partial');
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    });
    await expect(exclusiveWrite(path, 'complete')).rejects.toThrow('disk full');
    expect(await readdir(root)).toEqual([]);
    spy.mockRestore();
    await exclusiveWrite(path, 'complete');
    expect(await readFile(path, 'utf8')).toBe('complete');
  });

  it('fails closed when the filesystem cannot publish hard links', async () => {
    const { root } = await fixture();
    vi.spyOn(atomicFs, 'link').mockRejectedValue(Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }));
    await expect(exclusiveWrite(join(root, 'note.md'), 'content')).rejects.toMatchObject({ code: 'ENOTSUP' });
    expect(await readdir(root)).toEqual([]);
  });

  it.each(['EPERM', 'EBUSY', 'EACCES'])('retries transient %s acquiring/releasing a lock and publishing a note', async code => {
    const { root } = await fixture();
    const failure = Object.assign(new Error('transient'), { code });
    vi.spyOn(lockFs, 'sleep').mockResolvedValue();
    vi.spyOn(atomicFs, 'sleep').mockResolvedValue();
    const open = vi.spyOn(lockFs, 'open').mockRejectedValueOnce(failure);
    const unlink = vi.spyOn(lockFs, 'unlink').mockRejectedValueOnce(failure);
    const link = vi.spyOn(atomicFs, 'link').mockRejectedValueOnce(failure);
    await expect(withFileLock(join(root, 'writer.lock'), async () => {
      await exclusiveWrite(join(root, 'note.md'), 'complete');
      return 'durable';
    })).resolves.toBe('durable');
    expect(open).toHaveBeenCalledTimes(2);
    expect(unlink).toHaveBeenCalledTimes(2);
    expect(link).toHaveBeenCalledTimes(2);
  });

  it('diagnoses exhausted lock cleanup without masking a durable result or the action error', async () => {
    const { root } = await fixture();
    const failure = Object.assign(new Error('locked'), { code: 'EPERM' });
    vi.spyOn(lockFs, 'sleep').mockResolvedValue();
    vi.spyOn(lockFs, 'unlink').mockRejectedValue(failure);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(withFileLock(join(root, 'success.lock'), async () => 'durable')).resolves.toBe('durable');
    await expect(withFileLock(join(root, 'failure.lock'), async () => { throw new Error('original action error'); })).rejects.toThrow('original action error');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.flat().join(' ')).toContain('EPERM');
    expect(await readFile(join(root, 'success.lock'), 'utf8')).toContain('pid');
  });

  it('serializes recall with closing and accepting instead of persisting stale states', async () => {
    const { root, brain } = await fixture();
    const other = openBrain([{ scope: 'project', root }]);
    const session = await brain.openSession('Needle session', 'test');
    const canonical = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Needle standard', body: 'needle' });
    await Promise.all([brain.recall('needle'), other.closeSession(session.meta.id, 'Closed'), other.acceptCanonical(canonical.meta.id)]);
    await other.recall('needle');
    expect((await brain.read(session.meta.id))?.meta.status).toBe('closed');
    expect((await brain.read(canonical.meta.id))?.meta.status).toBe('accepted');
  });

  it('does not lose a delivered commitment to concurrent maintenance', async () => {
    const { root, brain } = await fixture();
    const commitment = await brain.write({ tier: 'transitive', kind: 'commitment', title: 'Deliver work', body: 'done', due: '2020-01-01' });
    await Promise.all([brain.maintain(), openBrain([{ scope: 'project', root }]).update(commitment.meta.id, { status: 'delivered' })]);
    expect((await brain.read(commitment.meta.id))?.meta.status).toBe('delivered');
  });

  it('deduplicates automated feedback durably while counting ordinary feedback', async () => {
    const { root, brain } = await fixture();
    const lesson = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Replay feedback', body: 'same evidence' });
    await brain.feedback(lesson.meta.id, true, 'event-one');
    await openBrain([{ scope: 'project', root }]).feedback(lesson.meta.id, true, 'event-one');
    await brain.feedback(lesson.meta.id, true);
    expect((await brain.read(lesson.meta.id))?.meta.usage?.wins).toBe(2);
  });

  it('fails closed on orphan locks and releases locks after an exception', async () => {
    const { root } = await fixture();
    const path = join(root, 'orphan.lock');
    await writeFile(path, '{"pid":0}');
    await expect(withFileLock(path, async () => 'unsafe', 5)).rejects.toThrow(/owner has exited/);
    expect(await readFile(path, 'utf8')).toBe('{"pid":0}');
    await rm(path);
    await expect(withFileLock(path, async () => { throw new Error('intentional'); })).rejects.toThrow('intentional');
    await expect(withFileLock(path, async () => 'released')).resolves.toBe('released');
  });

  it('deduplicates overlays and orders locks independently of the supplied location order', async () => {
    const first = await fixture(), second = await fixture();
    const a = { root: first.root, scope: 'project' as const }, b = { root: second.root, scope: 'global' as const };
    await expect(Promise.all([
      withBrainLocks([a, b, a], async () => 'first'),
      withBrainLocks([b, a], async () => 'second'),
    ])).resolves.toEqual(['first', 'second']);
  });
});
