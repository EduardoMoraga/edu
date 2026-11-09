import { describe, expect, it } from 'vitest';
import { analyzeToken, CONCEPT_GROUPS, conceptsOf, editDistance, fuzzyCandidates, queryStopwords, stem, tokenize, trigramSimilarity } from './lexicon.js';

const concepts = (word: string) => analyzeToken(tokenize(word)[0]!).concepts;

describe('light ES/EN stemmer', () => {
  it.each([
    ['tests testing tested test', 'test'],
    ['deploy deployed deploying deployment deployments', 'deploy'],
    ['commit commits committed committing', 'commit'],
    ['branch branches', 'branch'],
    ['query queries', 'query'],
    ['decision decisiones decisión', 'decision'],
    ['cliente clientes client clients', 'client'],
    ['incidente incidentes incident incidents', 'incident'],
    ['instalar instalador instaladores instalación', 'instal'],
    ['configuración configurar configuration', 'configur'],
    ['reintentar reintentos reintento', 'reintent'],
    ['probar probamos', 'prob'],
    ['facturar facturas facturación', 'factur'],
    ['weekly week weeks', 'week'],
  ])('%s → %s', (words, expected) => {
    for (const word of tokenize(words)) expect(stem(word)).toBe(expected);
  });

  it('leaves short words, numbers and suffix look-alikes alone', () => {
    expect(stem('data')).toBe('data');
    expect(stem('date')).toBe('date');
    expect(stem('q7')).toBe('q7');
    expect(stem('2026')).toBe('2026');
    expect(stem('string')).toBe('string');
    expect(stem('status')).toBe('status');
    expect(stem('class')).toBe('class');
  });
});

describe('concept bridge', () => {
  it('curates about three hundred ES↔EN concept groups', () => {
    expect(CONCEPT_GROUPS).toBeGreaterThanOrEqual(300);
  });

  it.each([
    ['contraseña', 'password'], ['reunión', 'meetings'], ['factura', 'invoicing'], ['despliegue', 'deployment'],
    ['respaldo', 'backups'], ['rama', 'branch'], ['presupuesto', 'budget'], ['permisos', 'permission'],
    ['usuario', 'users'], ['inglés', 'english'], ['español', 'spanish'], ['memoria', 'memories'],
    ['lección', 'lessons'], ['precio', 'pricing'], ['contrato', 'agreement'], ['conflicto', 'conflicts'],
    // General vocabulary: calendar, quantities, common verbs and adjectives.
    ['lunes', 'mondays'], ['trimestral', 'quarter'], ['miles', 'thousand'], ['tarjetas', 'card'], ['bloqueos', 'locks'],
    ['lotes', 'batches'], ['nunca', 'never'], ['arranque', 'startup'], ['prefiere', 'preferred'], ['aprueba', 'approves'],
  ])('bridges %s and %s', (es, en) => {
    const shared = concepts(es).filter(concept => concepts(en).includes(concept));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('keeps negations out of the query-only function words', () => {
    for (const word of ['should', 'when', 'desde', 'cada']) expect(queryStopwords.has(word)).toBe(true);
    for (const word of ['not', 'no', 'never', 'nunca']) expect(queryStopwords.has(word)).toBe(false);
  });

  it('ignores stopwords and unknown vocabulary', () => {
    expect(analyzeToken('the')).toEqual({ concepts: [] });
    expect(analyzeToken('para')).toEqual({ concepts: [] });
    expect(conceptsOf(stem('astronaut'))).toEqual([]);
    expect(concepts('galaxy')).toEqual([]);
  });
});

describe('fuzzy fallback', () => {
  it('measures trigram overlap and bounded edit distance', () => {
    expect(trigramSimilarity('deploy', 'deploy')).toBe(1);
    expect(trigramSimilarity('deploy', 'galaxy')).toBe(0);
    expect(editDistance('reunoin', 'reunion')).toBe(1); // adjacent transposition
    expect(editDistance('pasword', 'password')).toBe(1);
    expect(editDistance('alpha', 'omega', 2)).toBe(3);
  });

  it('suggests close words for typos and nothing for unrelated or short words', () => {
    const vocabulary = ['deployment', 'password', 'repository', 'reuniones', 'coffee'];
    expect(fuzzyCandidates('deploymnet', vocabulary)[0]?.term).toBe('deployment');
    expect(fuzzyCandidates('pasword', vocabulary)[0]?.term).toBe('password');
    expect(fuzzyCandidates('repostory', vocabulary)[0]?.term).toBe('repository');
    expect(fuzzyCandidates('reunoines', vocabulary)[0]?.term).toBe('reuniones');
    expect(fuzzyCandidates('astronaut', vocabulary)).toEqual([]);
    expect(fuzzyCandidates('cof', vocabulary)).toEqual([]);
    expect(fuzzyCandidates('q700', ['q701'])).toEqual([]);
  });
});
