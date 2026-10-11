/**
 * Deterministic synthetic brain for performance tests and manual profiling (not shipped: tsup only bundles
 * the CLI and library entries). Mirrors a large Albert import: 21 canonical, 227 episodic and 519 transitive
 * notes (243 lessons, 150 decisions, 73 hypotheses, 53 commitments) with ~1.5 KB bodies.
 * Dependency-free apart from `yaml`, so `node --experimental-strip-types` can run it directly.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';

export interface SyntheticBrainCounts { canonical: number; episodic: number; lesson: number; decision: number; hypothesis: number; commitment: number }
export const ALBERT_COUNTS: SyntheticBrainCounts = { canonical: 21, episodic: 227, lesson: 243, decision: 150, hypothesis: 73, commitment: 53 };

const WORDS = ['retail', 'pricing', 'dashboard', 'etl', 'merchandising', 'sellout', 'stock', 'forecast', 'promotion', 'region', 'client', 'report', 'pipeline', 'schema', 'latency', 'quality', 'review', 'deploy', 'budget', 'sprint'];
const pad = (n: number) => String(n).padStart(4, '0');

function body(seed: number, bytes = 1500): string {
  const parts: string[] = [];
  let i = seed;
  let size = 0;
  while (size < bytes) {
    const sentence = `The ${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]} needs a ${WORDS[(i * 13 + 5) % WORDS.length]} check before the weekly ${WORDS[(i * 3 + 1) % WORDS.length]}.`;
    parts.push(sentence);
    size += sentence.length + 1;
    i += 1;
    if (parts.length % 6 === 0) { parts.push('\n\n'); }
  }
  return parts.join(' ').replace(/ \n\n /g, '\n\n').trim();
}

function write(path: string, meta: Record<string, unknown>, text: string): void {
  writeFileSync(path, `---\n${stringify(meta, { lineWidth: 0 }).trimEnd()}\n---\n\n${text}\n`, 'utf8');
}

/** Writes `<root>/EDU.md` and `<root>/brain/{1-canonical,2-episodic,3-transitive}`; returns the note count. */
export function writeSyntheticBrain(root: string, counts: SyntheticBrainCounts = ALBERT_COUNTS): number {
  const brain = join(root, 'brain');
  for (const dir of ['0-index', '1-canonical', '2-episodic', '3-transitive']) mkdirSync(join(brain, dir), { recursive: true });
  writeFileSync(join(root, 'EDU.md'), '# Albert — the contract\n\nAlbert keeps the BI work honest.\n\n- Canonical notes are human-confirmed.\n', 'utf8');
  const base = Date.UTC(2026, 0, 1);
  const at = (i: number) => new Date(base + i * 3_600_000).toISOString();
  let total = 0;

  const canonicalKinds = ['person', 'preference', 'standard', 'identity', 'domain', 'lexicon'];
  for (let i = 0; i < counts.canonical; i++) {
    const kind = canonicalKinds[i % canonicalKinds.length]!;
    mkdirSync(join(brain, '1-canonical', kind), { recursive: true });
    write(join(brain, '1-canonical', kind, `canonical-${pad(i)}.md`), {
      id: `K-canonical-${pad(i)}`, tier: 'canonical', title: `Canonical ${kind} ${pad(i)}`, kind, status: 'accepted', band: 'verified',
      tags: [kind], links: [], created: at(i), updated: at(i), source: 'import:albert',
    }, body(i));
    total++;
  }
  for (let i = 0; i < counts.episodic; i++) {
    const created = at(100 + i);
    write(join(brain, '2-episodic', `${created.slice(0, 10)}_${created.slice(11, 16).replace(':', '')}_session-${pad(i)}-${pad(i)}abcd.md`), {
      id: `${created.slice(0, 10)}-session-${pad(i)}-${pad(i)}abcd`, tier: 'episodic', title: `Session ${pad(i)}`, kind: 'session', status: 'closed',
      tags: ['session'], links: [], created, updated: created, source: 'import:albert',
    }, body(i + 1000));
    total++;
  }
  const transitive: Array<[keyof SyntheticBrainCounts, string, (i: number) => Record<string, unknown>]> = [
    ['lesson', 'L-', i => ({ status: i % 3 === 0 ? 'proven' : 'candidate', band: i % 3 === 0 ? 'verified' : 'inferred', ...(i % 5 === 0 ? { usage: { uses: i % 7, wins: i % 4, losses: i % 2, lastUsed: at(400 + i) } } : {}) })],
    ['decision', 'D-', () => ({ status: 'active' })],
    ['hypothesis', 'H-', () => ({ status: 'open', band: 'hypothesis' })],
    ['commitment', 'C-', i => ({ status: i % 5 === 0 ? 'overdue' : 'pending', owner: 'edu', due: `2026-${String((i % 12) + 1).padStart(2, '0')}-15` })],
  ];
  for (const [kind, prefix, extra] of transitive) {
    for (let i = 0; i < counts[kind]; i++) {
      const slug = `${kind}-${WORDS[i % WORDS.length]}-${pad(i)}`;
      const created = at(2000 + total);
      write(join(brain, '3-transitive', `${prefix}${slug}.md`), {
        id: `${prefix}${slug}`, tier: 'transitive', title: `${kind[0]!.toUpperCase()}${kind.slice(1)} about ${WORDS[i % WORDS.length]} ${pad(i)}`, kind,
        ...extra(i), tags: [kind, WORDS[i % WORDS.length]], links: [], created, updated: created, source: 'import:albert',
      }, body(i + 5000 + total));
      total++;
    }
  }
  return total;
}

const entry = process.argv[1];
if (entry && import.meta.url.endsWith(entry.replace(/\\/g, '/')) && process.argv[2]) {
  console.log(`${writeSyntheticBrain(process.argv[2])} notes written to ${process.argv[2]}`);
}
