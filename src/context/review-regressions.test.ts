import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openBrain } from '../brain/index.js';
import type { Note, NoteMeta } from '../core/contracts.js';
import { buildContext } from './pack.js';
import { estimateTokens } from './tokens.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const note = (id: string, body: string, meta: Partial<NoteMeta> = {}): Note => ({
  path: `/fixture/${id}.md`, body,
  meta: { id, title: id, tier: 'transitive', kind: 'lesson', status: 'proven', tags: [], links: [], created: '2026-10-20', ...meta },
});
async function fixture(notes: Note[]) {
  const root = await mkdtemp(join(tmpdir(), 'edu-context-review-'));
  roots.push(root);
  const brain = openBrain([{ scope: 'project', root }]);
  // Isolate packing from disk/index costs; run the real ranking and passage selection.
  vi.spyOn(brain, 'list').mockResolvedValue(notes);
  const eduMdPath = join(root, 'EDU.md');
  await writeFile(eduMdPath, '# Identity\nKeep promises.');
  return { brain, opts: { eduMdPath, trackUsage: false, now: new Date('2026-10-20') } };
}

it('injects the operational body field found by bilingual retrieval, not an irrelevant introduction', async () => {
  const rule = 'Nunca reintentar un pago sin clave de idempotencia; conservarla durante 72 horas.';
  const target = note('L-policy', 'Intro sobre estilo de commits. '.repeat(80) + '\n\n' + rule);
  const { brain, opts } = await fixture([target, note('L-noise', 'Use purple buttons.')]);
  const pack = await buildContext(brain, { query: 'retry payment', budgetTokens: 300 }, opts);
  expect(pack.text).toContain(target.meta.id);
  expect(pack.text).toContain(rule);
  expect(pack.text).not.toContain('Intro sobre estilo');
  expect(pack.text).not.toContain('L-noise');
});

it('excludes superseded imports from unqueried operational context and deferred', async () => {
  const old = [
    note('L-old', 'Obsolete protocol', { superseded_by: 'L-new' }),
    note('D-old', 'Obsolete decision', { kind: 'decision', status: 'active', superseded_by: 'D-new' }),
    note('K-old', 'Obsolete identity', { tier: 'canonical', kind: 'person', status: 'accepted', superseded_by: 'K-new' }),
  ];
  const { brain, opts } = await fixture([...old, note('L-new', 'Current protocol')]);
  const pack = await buildContext(brain, { budgetTokens: 400 }, opts);
  expect(pack.text).toContain('Current protocol');
  for (const value of old) {
    expect(pack.text).not.toContain(value.meta.id);
    expect(pack.deferred).not.toContain(value.meta.id);
  }
});

it('does not evaluate bodies of unqueried notes whose metadata cannot fit', async () => {
  const blocked = note('L-blocked', '');
  Object.defineProperty(blocked, 'body', { get() { throw new Error('Excluded body was evaluated'); } });
  const { brain, opts } = await fixture([blocked]);
  const pack = await buildContext(brain, { budgetTokens: 10 }, opts);
  expect(pack.deferred).toEqual(['L-blocked']);
  expect(pack.tokens).toBeLessThanOrEqual(10);
});

it.each(['transitive', 'canonical'] as const)('packs 400 long %s bodies within the hook budget while retaining all deferred IDs', async tier => {
  const body = 'Retry payment with an idempotency key. '.repeat(1500).slice(0, 57000);
  expect(body.length).toBe(57000);
  const notes = Array.from({ length: 400 }, (_, i) => note(`L-rule-${String(i).padStart(3, '0')}`, body, tier === 'canonical' ? { tier, kind: 'domain', status: 'accepted' } : {}));
  const { brain, opts } = await fixture(notes);
  const start = performance.now();
  const pack = await buildContext(brain, { query: 'retry payment', budgetTokens: 300 }, opts);
  const elapsed = performance.now() - start;
  expect(pack.text).toContain('Retry payment with an idempotency key.');
  expect(pack.tokens).toBe(estimateTokens(pack.text));
  expect(pack.tokens).toBeLessThanOrEqual(300);
  const included = pack.sections.flatMap(section => section.noteIds);
  expect(included.length).toBeGreaterThan(0);
  expect(pack.deferred.length).toBeGreaterThan(390);
  expect(new Set([...included, ...pack.deferred])).toEqual(new Set(notes.map(value => value.meta.id)));
  expect(elapsed).toBeLessThan(5000);
}, 90_000);


it('keeps an explicitly marked protocol whole when it fits, and never injects a partial protocol', async () => {
  const { brain, opts } = await fixture([]);
  const protocol = '<!-- edu:core -->\n' + 'Use the injected session ID. '.repeat(25) + '\nNever bypass approvals.\n<!-- /edu:core -->';
  await writeFile(opts.eduMdPath, '# Albert\n' + protocol + '\n<!-- edu:extended -->\nExtended content.');
  const full = await buildContext(brain, { budgetTokens: 1500 }, opts);
  expect(full.text).toContain(protocol);
  expect(full.text).not.toContain('Extended content.');
  const small = await buildContext(brain, { budgetTokens: 50 }, opts);
  expect(small.text).toContain('Albert');
  expect(small.text).not.toContain('Use the injected session ID.');
  expect(small.tokens).toBeLessThanOrEqual(50);
});


it('keeps a marked protocol beyond 40 lines without an extended marker', async () => {
  const { brain, opts } = await fixture([]);
  const protocol = '<!-- edu:core -->\n' + 'Keep the supplied session ID.\n'.repeat(45) + 'Never bypass approvals.\n<!-- /edu:core -->';
  await writeFile(opts.eduMdPath, '# Albert\n' + protocol);
  const pack = await buildContext(brain, { budgetTokens: 1500 }, opts);
  expect(pack.text).toContain(protocol);
  expect(pack.tokens).toBeLessThanOrEqual(1500);
});

it.each([
  { kind: 'decision', status: 'active' },
  { kind: 'lesson', status: 'proven' },
] as const)('keeps superseded $status history readable but out of packs with and without a query', async ({ kind, status }) => {
  const root = await mkdtemp(join(tmpdir(), 'edu-context-history-'));
  roots.push(root);
  const location = { scope: 'project' as const, root };
  const brain = openBrain([location]);
  await brain.init(location);
  const current = await brain.write({ tier: 'transitive', kind, status, title: 'Current payment protocol', body: 'Payment: require checksum V9.' });
  const old = await brain.write({ tier: 'transitive', kind, status, title: 'Historical payment protocol', body: 'Payment: obsolete checksum V1.' });
  await brain.update(old.meta.id, { superseded_by: current.meta.id });
  const before = await brain.read(old.meta.id);
  expect(before?.meta.status).toBe(status);
  expect(before?.meta.superseded_by).toBe(current.meta.id);

  for (const query of [undefined, 'payment']) {
    const pack = await buildContext(brain, { query, budgetTokens: 1000 }, { eduMdPath: join(root, 'EDU.md'), trackUsage: false });
    expect(pack.text).toContain(current.meta.id);
    expect(pack.text).toContain('checksum V9');
    expect(pack.text).not.toContain(old.meta.id);
    expect(pack.text).not.toContain(old.meta.title);
    expect(pack.text).not.toContain('checksum V1');
    expect(pack.sections.flatMap(section => section.noteIds)).not.toContain(old.meta.id);
    expect(pack.deferred).not.toContain(old.meta.id);
    expect(await brain.read(old.meta.id)).toEqual(before);
  }
});
