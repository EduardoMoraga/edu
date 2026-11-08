import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { ACTIVATION_NOTES, ACTIVATION_PROMPT, gradeActivation, seedActivation } from './activation.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

const FULL_ANSWER = `La decisión vigente es ${ACTIVATION_NOTES.active.id}: usar Postgres con pg-boss para la cola de trabajos.
Evidencia: el incidente INC-42, donde Redis perdió 312 trabajos, y la prueba de carga (docs/adr/0007-cola-de-trabajos.md).
La opción descartada es Redis con BullMQ, que quedó revertida.
La hipótesis "${ACTIVATION_NOTES.stale.title}" está obsoleta: tiene 90 días y contradice la decisión.
Siguiente paso seguro: marcar la hipótesis como refutada y migrar los consumidores restantes.`;

describe('activation scenario', () => {
  it('seeds an active decision with a source, the reverted option and a stale open hypothesis', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-bench-activation-')); dirs.push(dir);
    const now = new Date('2026-11-08T12:00:00Z');
    const seed = await seedActivation(dir, now);
    expect(seed.prompt).toBe(ACTIVATION_PROMPT);
    expect(seed.ids).toEqual({ active: ACTIVATION_NOTES.active.id, rejected: ACTIVATION_NOTES.rejected.id, stale: ACTIVATION_NOTES.stale.id });
    const brain = openBrain([{ scope: 'project', root: seed.root }]);
    const active = await brain.read(seed.ids.active);
    const rejected = await brain.read(seed.ids.rejected);
    const stale = await brain.read(seed.ids.stale);
    expect(active?.meta).toMatchObject({ status: 'active', supersedes: seed.ids.rejected, source: ACTIVATION_NOTES.active.source });
    expect(rejected?.meta.status).toBe('reverted');
    expect(stale?.meta.status).toBe('open');
    expect((now.getTime() - Date.parse(stale!.meta.created)) / 86_400_000).toBeGreaterThan(60);
    // The agent can find the scenario through ordinary recall.
    expect((await brain.recall('cola de trabajos')).map(hit => hit.note.meta.id)).toContain(seed.ids.active);
  });
});

describe('activation grader', () => {
  it('gives 5/5 to an answer that covers every point', () => {
    const grade = gradeActivation(FULL_ANSWER);
    expect(grade.checks.filter(check => !check.passed)).toEqual([]);
    expect(grade.score).toBe(5);
  });

  it('accepts a heading that flags the stale hypothesis with its id on the next line, not a different note', () => {
    const flagged = gradeActivation('## Hipótesis abierta que quedó obsoleta\n\n`H-redis-aguanta-el-pico-de-black-friday-sin-perder-trabajos`\n\nSigue open.');
    expect(flagged.checks.find(c => c.id === 'stale-note')?.passed).toBe(true);
    const bold = gradeActivation('**Hipótesis abierta obsoleta**\n`H-redis-aguanta-el-pico-de-black-friday-sin-perder-trabajos` (abierta desde 2026-08-10).');
    expect(bold.checks.find(c => c.id === 'stale-note')?.passed).toBe(true);
    const wrong = gradeActivation('## Nota obsoleta\n\n`D-usar-redis-con-bullmq-para-la-cola-de-trabajos`\n\n## Otro\n\nH-redis-aguanta-el-pico sigue abierta.');
    expect(wrong.checks.find(c => c.id === 'stale-note')?.passed).toBe(false);
  });

  it('gives 0 to an empty answer and to an echo of the prompt', () => {
    expect(gradeActivation('').score).toBe(0);
    expect(gradeActivation(ACTIVATION_PROMPT).score).toBe(0);
  });

  it('scores each point independently', () => {
    const partial = gradeActivation('Usamos pg-boss sobre Postgres. Redis se sigue usando para caché.');
    expect(partial.score).toBe(1);
    expect(partial.checks.find(check => check.id === 'active-decision')?.passed).toBe(true);
    // Redis is named but not as rejected; the stale note is not flagged.
    expect(partial.checks.find(check => check.id === 'rejected-option')?.passed).toBe(false);
    expect(partial.checks.find(check => check.id === 'stale-note')?.passed).toBe(false);
    const english = gradeActivation('Current decision: pg-boss on Postgres (incident INC-42). BullMQ on Redis was rejected. '
      + 'The Black Friday hypothesis is stale. Next step: close that hypothesis.');
    expect(english.score).toBe(5);
  });
});
