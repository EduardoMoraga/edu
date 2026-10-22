/**
 * Deterministic event fixtures for TUI tests and visual checks. Mirrors the
 * ARCHITECTURE.md §12 mock: a lead with an explorer, a running builder that
 * asks for approval, and a queued reviewer.
 */
import type { EduEvent } from '../core/contracts.js';

const T0 = Date.parse('2026-10-08T12:00:00.000Z');
export const fixtureAt = (sec: number): string => new Date(T0 + sec * 1000).toISOString();

export function oauthRun(): EduEvent[] {
  const at = fixtureAt;
  const known = { inputTokens: true, outputTokens: true, costUsd: true };
  return [
    { type: 'run.start', runId: 'run-oauth', goal: 'add oauth', mode: 'solo', at: at(0) },
    { type: 'agent.spawn', agentId: 'lead', role: 'lead', cli: 'claude', task: 'Plan the OAuth change', at: at(0) },
    { type: 'agent.status', agentId: 'lead', status: 'running', at: at(0) },
    { type: 'brain.recall', agentId: 'lead', noteIds: ['D-auth-provider', 'L-small-prs', 'C-ship-login', 'L-test-callbacks'], at: at(2) },
    { type: 'usage', agentId: 'lead', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, known }, at: at(41) },
    { type: 'agent.end', agentId: 'lead', ok: true, summary: 'Plan: explore, build, review', at: at(41) },
    { type: 'agent.spawn', agentId: 'exp', parentId: 'lead', role: 'explorer', cli: 'claude', task: 'Map the auth flow', at: at(41) },
    { type: 'agent.status', agentId: 'exp', status: 'running', at: at(41) },
    { type: 'tool.call', agentId: 'exp', callId: 'e1', tool: 'Grep', input: 'passport', at: at(50) },
    { type: 'tool.result', agentId: 'exp', callId: 'e1', ok: true, output: '3 matches', at: at(52) },
    { type: 'usage', agentId: 'exp', usage: { known, inputTokens: 9_000, outputTokens: 1_100, costUsd: 0.08 }, at: at(100) },
    { type: 'agent.end', agentId: 'exp', ok: true, summary: 'Flow mapped', at: at(103) },
    { type: 'agent.spawn', agentId: 'bld', parentId: 'lead', role: 'builder', cli: 'claude', task: 'Add the callback route', at: at(103) },
    { type: 'agent.spawn', agentId: 'rev', parentId: 'lead', role: 'reviewer', cli: 'claude', task: 'Review the change', at: at(103) },
    { type: 'usage', agentId: 'rev', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, known }, at: at(103) },
    { type: 'agent.status', agentId: 'bld', status: 'running', at: at(103) },
    { type: 'agent.thinking', agentId: 'bld', text: 'The callback needs state validation first.', at: at(110) },
    { type: 'tool.call', agentId: 'bld', callId: 'b1', tool: 'Edit', input: 'src/auth.ts', at: at(120) },
    { type: 'tool.result', agentId: 'bld', callId: 'b1', ok: true, output: '12 lines', at: at(125) },
    { type: 'agent.text', agentId: 'bld', text: 'I added the callback route and state check.', at: at(200) },
    { type: 'usage', agentId: 'bld', usage: { known, inputTokens: 25_000, outputTokens: 3_000, costUsd: 0.34 }, at: at(230) },
    { type: 'brain.learn', noteId: 'L-validate-oauth-state', kind: 'lesson', title: 'Validate OAuth state before exchange', at: at(235) },
    {
      type: 'approval.request',
      agentId: 'bld',
      approvalId: 'ap-1',
      title: 'builder wants to write 3 files',
      detail: 'src/auth.ts\nsrc/routes/callback.ts\ntest/auth.test.ts',
      at: at(237),
    },
    { type: 'agent.status', agentId: 'bld', status: 'awaiting-approval', at: at(237) },
  ];
}

/** The home chat as live.ts streams it: "Hola" answered from memory, no crew. */
export function chatEvents(): EduEvent[] {
  const at = fixtureAt;
  const answer = '¡Hola! Tienes un compromiso abierto: entregar el informe semanal de Cheil el viernes [[C-entregar-informe-semanal-cheil]]. Decidimos usar Bun para los scripts [[D-usar-bun]] (verified).';
  return [
    { type: 'chat.user', text: 'Hola', at: at(0) },
    { type: 'brain.recall', agentId: 'edu', noteIds: ['C-entregar-informe-semanal-cheil', 'D-usar-bun'], at: at(0) },
    { type: 'agent.spawn', agentId: 'edu', role: 'lead', cli: 'claude', task: 'Hola', at: at(0) },
    { type: 'agent.status', agentId: 'edu', status: 'running', at: at(0) },
    { type: 'context.usage', agentId: 'edu', usedTokens: 2_400, windowTokens: 200_000, at: at(1) },
    { type: 'agent.text', agentId: 'edu', text: answer, at: at(4) },
    { type: 'agent.end', agentId: 'edu', ok: true, summary: answer, sessionId: 's-1', at: at(4) },
  ];
}
