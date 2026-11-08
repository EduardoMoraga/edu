import { describe, expect, it } from 'vitest';
import type { Note, NoteMeta } from '../core/contracts.js';
import { rankNotes, relevantPassage } from './search.js';

const now = new Date('2026-10-20T00:00:00Z');
const note = (id: string, title: string, body: string, meta: Partial<NoteMeta> = {}): Note => ({
  path: `/bilingual/${id}.md`, body,
  meta: { id, title, tier: 'transitive', kind: 'decision', status: 'active', tags: [], links: [], created: now.toISOString(), ...meta },
});

// A small deterministic ES/EN corpus: one dominant concept per note, plus neutral noise.
const corpus = [
  note('E-deploy', 'Deployment checklist', 'Before deploying to production run the smoke tests and tag the release.'),
  note('E-secrets', 'Secrets handling', 'Never store passwords or API keys in the repository; use the vault.'),
  note('E-branches', 'Branch naming', 'Feature branches start with feat/ and are merged after code review.'),
  note('E-invoices', 'Invoice reminders', 'Send overdue invoices to the customer every Friday.'),
  note('E-tokens', 'Token budget', 'Keep the agent context under eight thousand tokens to control cost.'),
  note('S-reuniones', 'Reuniones con clientes', 'Las reuniones semanales con el cliente se agendan los lunes y se envía un acta.'),
  note('S-respaldo', 'Respaldo de la base de datos', 'Hacer respaldo diario de la base de datos y probar la restauración cada mes.'),
  note('S-precios', 'Precios de suscripción', 'Los precios del plan anual tienen un descuento del veinte por ciento.'),
  note('S-lecciones', 'Lecciones aprendidas', 'Documentar cada lección aprendida después de un incidente en producción.'),
  note('S-permisos', 'Permisos de usuarios', 'Los usuarios nuevos reciben permisos de solo lectura hasta su aprobación.'),
  note('E-coffee', 'Coffee machine', 'The office coffee machine is cleaned on Tuesdays.'),
  note('S-vacaciones', 'Vacaciones', 'Las vacaciones se piden con dos semanas de anticipación.'),
];

const evaluation: { kind: string; query: string; expected: string }[] = [
  { kind: 'es→en', query: 'cómo desplegar a producción', expected: 'E-deploy' },
  { kind: 'es→en', query: 'contraseñas en el repositorio', expected: 'E-secrets' },
  { kind: 'es→en', query: 'ramas y revisión de código', expected: 'E-branches' },
  { kind: 'es→en', query: 'facturas vencidas del cliente', expected: 'E-invoices' },
  { kind: 'es→en', query: 'presupuesto de tokens del agente', expected: 'E-tokens' },
  { kind: 'en→es', query: 'weekly client meetings', expected: 'S-reuniones' },
  { kind: 'en→es', query: 'database backup', expected: 'S-respaldo' },
  { kind: 'en→es', query: 'subscription pricing', expected: 'S-precios' },
  { kind: 'en→es', query: 'lessons learned after incidents', expected: 'S-lecciones' },
  { kind: 'en→es', query: 'user permissions', expected: 'S-permisos' },
  { kind: 'morphology', query: 'deployed releases', expected: 'E-deploy' },
  { kind: 'morphology', query: 'invoicing customers', expected: 'E-invoices' },
  { kind: 'morphology', query: 'respaldos diarios', expected: 'S-respaldo' },
  { kind: 'morphology', query: 'reunión semanal', expected: 'S-reuniones' },
  { kind: 'typo', query: 'deploymnet', expected: 'E-deploy' },
  { kind: 'typo', query: 'pasword', expected: 'E-secrets' },
  { kind: 'typo', query: 'reunoines', expected: 'S-reuniones' },
  { kind: 'typo', query: 'permisions', expected: 'S-permisos' },
];

describe('bilingual and paraphrase-tolerant recall', () => {
  it('reaches high recall on a small ES/EN evaluation', () => {
    const rows = evaluation.map(row => {
      const ids = rankNotes(row.query, corpus, now, 3, { includePassages: false }).map(hit => hit.note.meta.id);
      return { ...row, at1: ids[0] === row.expected, at3: ids.includes(row.expected) };
    });
    const at1 = rows.filter(row => row.at1).length / rows.length;
    const at3 = rows.filter(row => row.at3).length / rows.length;
    console.log(JSON.stringify({ queries: rows.length, recallAt1: at1, recallAt3: at3, misses: rows.filter(row => !row.at1).map(row => `${row.kind}: ${row.query}`) }));
    expect(at1).toBeGreaterThanOrEqual(0.9);
    expect(at3).toBe(1);
  });

  it('answers a Spanish query with an English note and an English query with a Spanish note', () => {
    expect(rankNotes('contraseñas', corpus, now, 1)[0]?.note.meta.id).toBe('E-secrets');
    expect(rankNotes('database backups', corpus, now, 1)[0]?.note.meta.id).toBe('S-respaldo');
  });

  it('matches plurals and conjugations in both languages', () => {
    const en = note('E-commit', 'Commit policy', 'We committed the fix and tagged it.');
    const es = note('S-prueba', 'Pruebas', 'Probamos el instalador antes de publicar.');
    expect(rankNotes('commits', [en, es], now, 1)[0]?.note).toEqual(en);
    expect(rankNotes('committing', [en, es], now, 1)[0]?.note).toEqual(en);
    expect(rankNotes('instaladores', [en, es], now, 1)[0]?.note).toEqual(es);
  });

  it('recovers from a typo only when the exact lexical search is weak', () => {
    expect(rankNotes('repostory', corpus, now, 1)[0]?.note.meta.id).toBe('E-secrets');
    // A known word does not pull in fuzzy neighbours.
    expect(rankNotes('coffee', corpus, now).map(hit => hit.note.meta.id)).toEqual(['E-coffee']);
  });

  it('ranks an exact-language keyword match above a bridge-only match', () => {
    const exact = note('S-exact', 'Despliegue', 'Despliegue del servidor a producción los martes.');
    const bridge = note('E-bridge', 'Deployment', 'Server deployment to production on Tuesdays.');
    expect(rankNotes('despliegue', [bridge, exact], now).map(hit => hit.note.meta.id)).toEqual(['S-exact', 'E-bridge']);
    expect(rankNotes('deployment', [exact, bridge], now).map(hit => hit.note.meta.id)).toEqual(['E-bridge', 'S-exact']);
  });

  it('ignores query function words when the query has content words', () => {
    const answer = note('E-answer', 'Webhook retries', 'Webhooks are retried with backoff.');
    const filler = note('E-filler', 'Planning', 'When should we meet? Which day should we use for planning, and when?');
    expect(rankNotes('when should we retry webhooks', [filler, answer], now).map(hit => hit.note.meta.id)).toEqual(['E-answer']);
    // A query made only of function words still searches them.
    expect(rankNotes('when should', [filler, answer], now).map(hit => hit.note.meta.id)).toEqual(['E-filler']);
  });

  it('rewards covering the whole query over repeating part of it', () => {
    const notes = [
      note('E-repeat', 'Webhook retry storm', 'Webhook workers retried in a tight loop. Every webhook retry hit the same endpoint, and the retry queue filled with webhook jobs.'),
      note('E-covers', 'Outbound webhooks', 'Failed deliveries are retried with exponential backoff.'),
      note('E-n1', 'Backoff for the API client', 'The API client waits with backoff after a 429.'),
    ];
    const ratio = (options: { similarity?: boolean }) => {
      const hits = rankNotes('webhook retry backoff', notes, now, 10, { includePassages: false, ...options });
      expect(hits.map(hit => hit.note.meta.id).slice(0, 2)).toEqual(['E-covers', 'E-repeat']);
      return hits[1]!.score / hits[0]!.score;
    };
    // The note that misses "backoff" falls further behind than under plain BM25.
    expect(ratio({})).toBeLessThan(ratio({ similarity: true }) - 0.05);
  });

  it('boosts the note kind a question asks for', () => {
    const lesson = note('L-cache', 'Cache invalidation', 'Cache entries expire after one hour.', { kind: 'lesson', status: 'candidate' });
    const decision = note('D-cache', 'Cache invalidation', 'Cache entries expire after one hour.');
    expect(rankNotes('what did we decide about cache invalidation', [lesson, decision], now)[0]?.note.meta.id).toBe('D-cache');
    expect(rankNotes('qué aprendimos sobre la caché', [decision, lesson], now)[0]?.note.meta.id).toBe('L-cache');
    // Without a cue the tie falls back to the id order.
    expect(rankNotes('cache invalidation', [lesson, decision], now)[0]?.note.meta.id).toBe('D-cache');
  });

  it('prefers a distilled note over a session log that matches as well, not over a better-matching one', () => {
    const decision = note('D-dns', 'Move DNS to Cloudflare', 'DNS zones move to Cloudflare.');
    const session = note('A-dns', 'Move DNS to Cloudflare', 'DNS zones move to Cloudflare.', { tier: 'episodic', kind: 'session', status: 'closed' });
    expect(rankNotes('dns cloudflare', [session, decision], now).map(hit => hit.note.meta.id)).toEqual(['D-dns', 'A-dns']);
    const call = note('S-acme', 'Customer call with Acme', 'Acme wants SSO next quarter.', { tier: 'episodic', kind: 'session', status: 'closed' });
    const other = note('D-sso', 'SSO through the identity provider', 'SSO uses the identity provider.');
    expect(rankNotes('acme call', [other, call], now)[0]?.note.meta.id).toBe('S-acme');
  });

  it('keeps plain BM25 similarity for whole-note comparison', () => {
    const a = note('D-a', 'Store sessions in Redis', 'Session storage uses Redis with a one hour expiry.');
    const b = note('D-b', 'Store sessions in Postgres', 'Session storage uses Postgres with a one hour expiry.');
    const query = `${b.meta.title} ${b.body}`;
    const [self, other] = rankNotes(query, [a, b], now, 10, { similarity: true, includePassages: false });
    expect(self?.note.meta.id).toBe('D-b');
    expect(other!.why).toMatch(/\buse\b/);
    expect(rankNotes(query, [a, b], now, 10, { includePassages: false })[1]!.why).not.toMatch(/\buse\b/);
  });

  it('chooses a stem-aware passage window', () => {
    const body = 'Contexto general sin relación. '.repeat(60) + 'Desplegamos los servicios con la etiqueta estable.' + ' Relleno.'.repeat(80);
    expect(relevantPassage(body, 'deploying services', 120)).toContain('Desplegamos los servicios');
  });
});
