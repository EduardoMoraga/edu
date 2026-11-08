/**
 * Live-agent activation test ("activation evidence"): does an agent with Edu installed actually use the memory?
 *
 * `seedActivation` writes a small project brain with one active decision (with its source and evidence), the
 * option it replaced (a reverted decision) and a stale note (an open hypothesis older than 60 days that the
 * active decision contradicts). The agent is asked `ACTIVATION_PROMPT`; `gradeActivation` scores its answer
 * 0-5 with deterministic text checks. No model is called here: scripts/agent-matrix.sh drives real CLIs.
 */
import { join } from 'node:path';
import { openBrain } from '../brain/index.js';
import type { BrainLocation } from '../core/contracts.js';

export const ACTIVATION_TOPIC = 'la cola de trabajos en segundo plano';
export const ACTIVATION_PROMPT = `¿Cuál es la decisión vigente sobre ${ACTIVATION_TOPIC}, su evidencia, la opción descartada, qué hipótesis abierta está obsoleta y cuál es el siguiente paso seguro? Usa la memoria de Edu.`;

const DAY = 86_400_000;

export const ACTIVATION_NOTES = {
  rejected: {
    id: 'D-usar-redis-con-bullmq-para-la-cola-de-trabajos',
    title: 'Usar Redis con BullMQ para la cola de trabajos',
    body: 'Los trabajos en segundo plano (correos, facturas, webhooks) se encolan en Redis con BullMQ. Elegido por rapidez de implementación.',
    ageDays: 120,
  },
  active: {
    id: 'D-usar-postgres-con-pg-boss-para-la-cola-de-trabajos',
    title: 'Usar Postgres con pg-boss para la cola de trabajos',
    source: 'docs/adr/0007-cola-de-trabajos.md',
    body: [
      'La cola de trabajos en segundo plano usa Postgres con pg-boss y reemplaza a Redis con BullMQ.',
      'Evidencia: el incidente INC-42 (Redis desalojó 312 trabajos encolados por presión de memoria) y una prueba de carga en la que pg-boss sostuvo 1.200 trabajos por segundo.',
      'Fuente: docs/adr/0007-cola-de-trabajos.md.',
    ].join('\n\n'),
    ageDays: 20,
  },
  stale: {
    id: 'H-redis-aguanta-el-pico-de-black-friday-sin-perder-trabajos',
    title: 'Redis aguanta el pico de Black Friday sin perder trabajos',
    body: 'Creemos que la instancia actual de Redis soporta el pico de Black Friday sin perder trabajos de la cola. Pendiente de medir.',
    ageDays: 90,
  },
} as const;

export interface ActivationSeed { root: string; prompt: string; ids: { active: string; rejected: string; stale: string } }

/** Seeds `<dir>/.edu` with the activation scenario; dates are relative to `now` so the hypothesis is always stale. */
export async function seedActivation(dir: string, now = new Date()): Promise<ActivationSeed> {
  const root = join(dir, '.edu');
  const location: BrainLocation = { scope: 'project', root };
  const brain = openBrain([location]);
  await brain.init(location);
  const at = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const { rejected, active, stale } = ACTIVATION_NOTES;
  const old = await brain.write({ tier: 'transitive', kind: 'decision', title: rejected.title, body: rejected.body, created: at(rejected.ageDays), source: 'user', band: 'inferred' });
  const hypothesis = await brain.write({ tier: 'transitive', kind: 'hypothesis', title: stale.title, body: stale.body, created: at(stale.ageDays), source: 'user', band: 'hypothesis' });
  const current = await brain.write({ tier: 'transitive', kind: 'decision', title: active.title, body: active.body, created: at(active.ageDays), source: active.source, band: 'verified', supersedes: old.meta.id });
  return { root, prompt: ACTIVATION_PROMPT, ids: { active: current.meta.id, rejected: old.meta.id, stale: hypothesis.meta.id } };
}

export type ActivationCheckId = 'active-decision' | 'evidence' | 'rejected-option' | 'stale-note' | 'next-step';
export interface ActivationCheck { id: ActivationCheckId; passed: boolean; detail: string }
export interface ActivationGrade { score: number; max: 5; checks: ActivationCheck[] }

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const anyOf = (text: string, needles: readonly string[]) => needles.find(needle => text.includes(fold(needle)));

const ACTIVE_ANCHORS = [ACTIVATION_NOTES.active.id, ACTIVATION_NOTES.active.title, 'pg-boss', 'pgboss'];
const EVIDENCE_ANCHORS = ['INC-42', 'INC 42', '312', 'adr/0007', 'adr 0007', '0007-cola', '1.200', '1,200', '1200'];
const REJECTED_ANCHORS = [ACTIVATION_NOTES.rejected.id, 'bullmq', 'redis'];
const REJECTED_CUES = ['descart', 'rechaz', 'revert', 'reemplaz', 'sustitu', 'abandon', 'supersed', 'reject', 'replaced', 'discard', 'dropped', 'ya no', 'no longer', 'anterior', 'previous'];
const STALE_ANCHORS = [ACTIVATION_NOTES.stale.id, 'black friday', 'H-redis'];
const STALE_CUES = ['obsolet', 'desactualiz', 'stale', 'outdated', 'caduc', 'vencid', 'antigu', 'vieja', 'old', 'contradic', 'no aplica', 'invalid', 'superad', 'dias', 'days', 'meses', 'months'];
const NEXT_CUES = ['siguiente paso', 'proximo paso', 'next step', 'recomiendo', 'sugiero', 'recommend', 'suggest', 'propongo', 'deberiamos', 'should'];

/** Sentences (and list items) of the answer, accent-folded and lower-cased. */
const sentences = (text: string) => fold(text).split(/(?<=[.!?])\s+|\n+/).map(part => part.trim()).filter(Boolean);
const sentenceWith = (parts: string[], anchors: readonly string[], cues: readonly string[]) =>
  parts.find(part => anyOf(part, anchors) && anyOf(part, cues));
/** A Markdown heading carrying the cue, with the anchor in the section under it ("## Stale hypothesis" then its id). */
const sectionWith = (text: string, anchors: readonly string[], cues: readonly string[]) => {
  const lines = fold(text).split('\n');
  for (const [i, line] of lines.entries()) {
    if (!/^\s*#{1,6}\s/.test(line) || !anyOf(line, cues)) continue;
    const end = lines.findIndex((next, j) => j > i && /^\s*#{1,6}\s/.test(next));
    const body = lines.slice(i + 1, end === -1 ? undefined : end).join(' ');
    if (anyOf(body, anchors)) return `${line.trim()} ${body.trim()}`;
  }
  return undefined;
};

/** Scores an answer 0-5: one point per check. The prompt is removed first, so echoing the question earns nothing. */
export function gradeActivation(answer: string): ActivationGrade {
  const text = fold(answer.split(ACTIVATION_PROMPT).join(' '));
  const parts = sentences(answer.split(ACTIVATION_PROMPT).join(' '));
  const active = anyOf(text, ACTIVE_ANCHORS);
  const evidence = anyOf(text, EVIDENCE_ANCHORS);
  const body = answer.split(ACTIVATION_PROMPT).join(' ');
  const rejected = sentenceWith(parts, REJECTED_ANCHORS, REJECTED_CUES) ?? sectionWith(body, REJECTED_ANCHORS, REJECTED_CUES);
  const stale = sentenceWith(parts, STALE_ANCHORS, STALE_CUES) ?? sectionWith(body, STALE_ANCHORS, STALE_CUES);
  const next = anyOf(text, NEXT_CUES);
  const checks: ActivationCheck[] = [
    { id: 'active-decision', passed: Boolean(active), detail: active ? `cites "${active}"` : 'active decision not cited (id, title or pg-boss)' },
    { id: 'evidence', passed: Boolean(evidence), detail: evidence ? `mentions "${evidence}"` : 'no evidence cited (INC-42, 312 jobs, load test, ADR 0007)' },
    { id: 'rejected-option', passed: Boolean(rejected), detail: rejected ? `"${rejected.slice(0, 120)}"` : 'Redis/BullMQ not named as rejected' },
    { id: 'stale-note', passed: Boolean(stale), detail: stale ? `"${stale.slice(0, 120)}"` : 'stale hypothesis not flagged' },
    { id: 'next-step', passed: Boolean(next), detail: next ? `proposes a step ("${next}")` : 'no next step proposed' },
  ];
  return { score: checks.filter(check => check.passed).length, max: 5, checks };
}
