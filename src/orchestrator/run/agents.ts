import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CliId, EduEvent, EngineRunRequest, HarnessLevel, RoleId } from '../../core/contracts.js';
import { measuredEngine } from '../../engine/measurement.js';
import { assignCli, roleRoute } from '../assign.js';
import { at, emit, emitEvidence, type RunState } from './state.js';

const ApplicationSchema = z.object({ noteId: z.string().min(1), requirementIds: z.array(z.string().min(1)).min(1), application: z.string().min(1) }).strict();

export interface AgentCall {
  cli: CliId;
  agentId: string;
  role: RoleId;
  prompt: string;
  autonomy: EngineRunRequest['autonomy'];
  /** The support context appended to the prompt. */
  context: string;
  /** The playbook method; the lead never receives it. */
  method?: string;
  /** Default: the run's signal. */
  signal?: AbortSignal;
}

export interface AgentReply { text: string; summary: string; sessionId?: string }

/** Runs one agent turn to completion, forwarding its events; an engine error or failed end throws. */
export async function runAgent(run: RunState, call: AgentCall): Promise<AgentReply> {
  const { cli, agentId, role: roleId, prompt, autonomy, context, method = '', signal = run.deps.signal } = call;
  const role = run.config.roles.find(candidate => candidate.id === roleId);
  const model = roleRoute(roleId, run.config)?.model ?? role?.model;
  await emit(run, { type: 'agent.spawn', agentId, role: roleId, cli, task: prompt.slice(0, 160), at: at(run) });
  await emit(run, { type: 'agent.status', agentId, status: 'running', at: at(run) });
  const purpose = (agentId.includes('fix') || agentId.endsWith('-repair')) || prompt.includes('Invalid plan') || prompt.startsWith('Your previous') ? 'recovery' : roleId === 'lead' ? 'planning' : roleId === 'reviewer' ? 'review' : 'task';
  // Planning, review and advice must be read-only in fact, not only by request.
  const requireReadonly = autonomy === 'readonly' && (roleId === 'lead' || roleId === 'reviewer' || roleId === 'advisor');
  const request: EngineRunRequest = { invocation: { id: randomUUID(), purpose }, cli, prompt: `${prompt}\n\nContext pack:\n${context}`, cwd: run.deps.cwd, autonomy, ...(requireReadonly ? { requireReadonly } : {}), systemPrompt: [role?.mission, roleId === 'lead' ? '' : method, roleId === 'builder' && context.includes('Brain context pack:') ? 'If you actually apply a supplied note, cite it explicitly on a separate line: EDU_APPLIED {"noteId":"L-id","requirementIds":["R-1"],"application":"Applied [[L-id]] by ..."}. Report only concrete application, never mere exposure or presumed benefit.' : ''].filter(Boolean).join('\n\n'), ...(model ? { model } : {}), signal };
  let text = ''; let summary = ''; let sessionId: string | undefined;
  try {
    for await (const event of measuredEngine(run.deps.engines(cli)).run(request, agentId)) {
      const stamped = { ...event, at: event.at || at(run) } as EduEvent;
      if (stamped.type === 'agent.text') text += stamped.text;
      if (stamped.type === 'agent.end') { summary = stamped.summary; sessionId = stamped.sessionId; }
      await emit(run, stamped);
      if (signal?.aborted) throw new Error('Run cancelled.');
      if (stamped.type === 'error') throw new Error(`Engine reported an error: ${stamped.message}`);
      if (stamped.type === 'agent.end' && !stamped.ok) throw new Error(`Engine run failed: ${stamped.summary}`);
    }
    if (signal?.aborted) throw new Error('Run cancelled.');
    return { text, summary, ...(sessionId ? { sessionId } : {}) };
  } catch (error) {
    await emit(run, { type: 'agent.status', agentId, status: signal?.aborted ? 'cancelled' : 'failed', at: at(run) });
    throw error;
  }
}

/**
 * The lead plans before any approval and the reviewer reads untrusted diffs: both must run on a CLI that
 * enforces read-only. The assigned CLI is kept when it can; otherwise another installed one that can
 * (a reviewer still prefers a vendor other than the builder's), or the run stops with a clear reason.
 */
export function readonlyCli(run: RunState, role: 'lead' | 'reviewer'): CliId {
  const { deps, config } = run;
  const assigned = assignCli(role, config, deps.available);
  const enforced = (cli: CliId) => deps.engines(cli).capabilities?.readonly === 'enforced';
  if (enforced(assigned)) return assigned;
  const builderCli = role === 'reviewer' ? assignCli('builder', config, deps.available) : undefined;
  const candidates = deps.available.filter(enforced).sort((a, b) => Number(a === builderCli) - Number(b === builderCli));
  const fallback = candidates[0];
  if (!fallback) throw new Error(`The ${role} must run read-only, but ${assigned} cannot enforce it and no installed CLI can. Install claude, codex or pi, or route the ${role} to one of them.`);
  run.limitations.push(`${role}: ${assigned} cannot enforce read-only, so the ${role} ran on ${fallback}.`);
  return fallback;
}

export function builderPrompt(task: string, goal: string, priorEvidence: string, level: HarnessLevel): string {
  const workflow = level === 'H3'
    ? 'Use the H3 workflow: reproduce → attribute → fix → verify → report. Edu runs deterministic checks; if verification disproves the diagnosis, use the back-edge to attribution before the bounded correction.'
    : '';
  return [task, `Goal:\n${goal}`, priorEvidence ? `Prior reproduction evidence:\n${priorEvidence}` : '', workflow].filter(Boolean).join('\n\n');
}

/** Records the supplied notes a builder says it applied (`EDU_APPLIED {...}` lines) against this run's requirements. */
export async function recordApplications(run: RunState, text: string): Promise<void> {
  for (const line of text.split('\n')) {
    if (!line.startsWith('EDU_APPLIED ')) continue;
    let value: unknown;
    try { value = JSON.parse(line.slice('EDU_APPLIED '.length)); }
    catch { continue; }
    const parsed = ApplicationSchema.safeParse(value);
    if (!parsed.success) continue;
    const entry = parsed.data;
    if (!run.suppliedNotes.has(entry.noteId) || !entry.application.includes(`[[${entry.noteId}]]`) ||
        !entry.requirementIds.every(id => run.requirements.some(requirement => requirement.id === id))) continue;
    const previous = run.applications.get(entry.noteId);
    run.applications.set(entry.noteId, { requirementIds: [...new Set([...(previous?.requirementIds ?? []), ...entry.requirementIds])], application: previous ? `${previous.application}\n${entry.application}` : entry.application });
    if (!previous) await emitEvidence(run, { type: 'context.trace', noteId: entry.noteId, contribution: entry.application, influenced: true, at: at(run) });
  }
}
