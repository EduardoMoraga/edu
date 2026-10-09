import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OutcomeLabel, Requirement } from '../core/contracts.js';

interface Verification { requirementIds?: string[]; ok?: boolean; kind?: string }

/** Derives the outcome from immutable package evidence rather than model assertions. */
export async function classifyPackage(directory: string): Promise<OutcomeLabel> {
  const [task, verifications, entropy, outcome, interventions] = await Promise.all([
    readJson(join(directory, 'task.json')),
    readJsonl(join(directory, 'verification.jsonl')),
    readJson(join(directory, 'entropy.json')),
    readJson(join(directory, 'outcome.json')),
    readJsonl(join(directory, 'intervention.jsonl')),
  ]);
  const findings = Array.isArray(entropy.findings) ? entropy.findings as Array<{ category?: string }> : [];
  if (outcome.label === 'unsafe_invalid' || findings.some((finding) => ['weakened-tests', 'checks-bypassed', 'unsafe-invalid'].includes(finding.category ?? ''))) return 'unsafe_invalid';
  if (outcome.ok === false || outcome.label === 'failed') return 'failed';
  const requirements = Array.isArray(task.requirements) ? task.requirements as Requirement[] : [];
  const finalVerification = (verifications as Verification[]).filter((event) => event.kind !== 'reproduction');
  if (!requirements.length && finalVerification.at(-1)?.ok === false) return 'failed';
  const latestByRequirement = new Map<string, boolean>();
  for (const event of finalVerification) for (const requirementId of event.requirementIds ?? []) {
    if (event.ok !== undefined) latestByRequirement.set(requirementId, event.ok);
  }
  if (requirements.some((requirement) => latestByRequirement.get(requirement.id) === false)) return 'failed';
  const covered = new Set([...latestByRequirement].filter(([, ok]) => ok).map(([id]) => id));
  const verified = requirements.length > 0 && requirements.every((requirement) => covered.has(requirement.id));
  if (!verified) return 'unverified_success';
  if (interventions.length > 0) return 'assisted_verified_success';
  return 'autonomous_verified_success';
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  let content: string;
  try { content = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? [value as Record<string, unknown>] : [];
    } catch { return []; }
  });
}
