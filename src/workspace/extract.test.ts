import { describe, expect, it } from 'vitest';
import { ExtractionError, chunkDocuments, extractDeterministic, extractWithLlm, mergeExtractions, parseExtraction, splitDocument, type Extraction } from './extract.js';

const ops = [
  '# Operación Norte',
  '',
  'Somos el equipo de trade marketing de Norte.',
  '',
  '## Clientes',
  'Lider y Jumbo.',
  '',
  '### Detalle',
  'Visitas semanales.',
  '',
  '## Glosario',
  '- **OSA**: on-shelf availability',
  '',
  '```',
  '# not a heading',
  '```',
  '## Vacía',
  '',
].join('\n');

const valid = (over: Partial<Extraction> = {}): Extraction => ({
  identity: { name: 'X', role: 'Analista de trade', tone: 'directo', summary: 'Opera trade marketing.' },
  notes: [{ title: 'Clientes', kind: 'client', body: 'Lider y Jumbo.', band: 'verified', source: 'ops.md#Clientes' }],
  playbooks: [{ name: 'visita-sala', title: 'Visita a sala', steps: ['Revisar quiebres', 'Reportar'] }],
  glossary: [{ term: 'OSA', meaning: 'on-shelf availability' }],
  ...over,
});

describe('deterministic extraction', () => {
  it('splits by the top section level under a single title, keeping the intro as an overview', () => {
    const { title, notes } = splitDocument({ name: 'ops.md', text: ops });
    expect(title).toBe('Operación Norte');
    expect(notes.map(n => [n.title, n.kind, n.source])).toEqual([
      ['Operación Norte', 'overview', 'ops.md'],
      ['Clientes', 'client', 'ops.md#Clientes'],
      ['Glosario', 'glossary', 'ops.md#Glosario'],
    ]);
    expect(notes[1]!.body).toContain('### Detalle');
    expect(notes[2]!.body).toContain('# not a heading');
    expect(notes.every(n => n.band === 'verified')).toBe(true);
  });

  it('keeps a document without headings as one overview note and names the identity', () => {
    const result = extractDeterministic([{ name: 'plain.txt', text: 'First paragraph about the operation.\n\nMore.' }], 'Albert');
    expect(result.notes).toEqual([{ title: 'plain', kind: 'overview', body: 'First paragraph about the operation.\n\nMore.', band: 'verified', source: 'plain.txt' }]);
    expect(result.identity).toEqual({ name: 'Albert', role: '', tone: '', summary: 'First paragraph about the operation.' });
  });
});

describe('llm extraction', () => {
  it('parses fenced JSON with surrounding prose and reports schema errors', () => {
    expect(parseExtraction(`Here:\n\`\`\`json\n${JSON.stringify(valid())}\n\`\`\``).notes).toHaveLength(1);
    expect(() => parseExtraction('no json')).toThrow(ExtractionError);
    expect(() => parseExtraction(JSON.stringify({ ...valid(), notes: [{ title: 'x', kind: 'gossip', body: 'b', band: 'verified', source: '' }] }))).toThrow(/notes\.0\.kind/);
  });

  it('chunks large inputs at headings and merges chunk results without duplicate titles', async () => {
    const big = Array.from({ length: 6 }, (_, i) => `## Section ${i}\n${'x'.repeat(900)}`).join('\n');
    const chunks = chunkDocuments([{ name: 'big.md', text: big }], 2000);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every(chunk => chunk.length <= 2000 && chunk.startsWith('=== FILE: big.md ==='))).toBe(true);
    const prompts: string[] = [];
    const result = await extractWithLlm([{ name: 'big.md', text: big }], async prompt => {
      prompts.push(prompt);
      return JSON.stringify(valid({ notes: [{ title: 'Clientes', kind: 'client', body: `part ${prompts.length}`, band: prompts.length === 2 ? 'inferred' : 'verified', source: `big.md#${prompts.length}` }] }));
    }, { agentName: 'Albert', lang: 'es', chunkChars: 2000 });
    expect(prompts).toHaveLength(chunks.length);
    expect(prompts[0]).toContain('agent named "Albert"');
    expect(prompts[0]).toContain('Write titles, bodies and steps in Spanish');
    expect(result.identity.name).toBe('Albert');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.band).toBe('inferred');
    expect(result.notes[0]!.body).toContain('part 1');
    expect(result.notes[0]!.body).toContain(`part ${chunks.length}`);
    expect(result.playbooks).toHaveLength(1);
    expect(result.glossary).toHaveLength(1);
  });

  it('retries once with the validation error, then gives up with ExtractionError', async () => {
    const answers = ['not json', JSON.stringify(valid())];
    const seen: string[] = [];
    const ok = await extractWithLlm([{ name: 'a.md', text: 'hello' }], async prompt => { seen.push(prompt); return answers.shift()!; }, { agentName: 'A', lang: 'en' });
    expect(ok.notes).toHaveLength(1);
    expect(seen[1]).toContain('Your previous answer was rejected (the answer contains no JSON object)');
    let calls = 0;
    await expect(extractWithLlm([{ name: 'a.md', text: 'hello' }], async () => { calls++; return '{}'; }, { agentName: 'A', lang: 'en' })).rejects.toThrow(ExtractionError);
    expect(calls).toBe(2);
  });

  it('merges glossary terms and playbooks case-insensitively', () => {
    const a = valid();
    const b = valid({ glossary: [{ term: 'osa', meaning: 'dup' }, { term: 'SKU', meaning: 'unidad' }], playbooks: [{ name: 'Visita-Sala', title: 'dup', steps: ['x'] }] });
    const merged = mergeExtractions([a, b]);
    expect(merged.glossary.map(g => g.term)).toEqual(['OSA', 'SKU']);
    expect(merged.playbooks).toHaveLength(1);
  });
});
