import type { EduEvent, Engine, EngineRunRequest } from '../core/contracts.js';

export class FakeEngine implements Engine {
  readonly cli = 'claude' as const;
  constructor(private readonly script: readonly EduEvent[], private readonly delayMs = 0) {}

  async available(): Promise<boolean> { return true; }

  async *run(_req: EngineRunRequest, _agentId: string): AsyncIterable<EduEvent> {
    for (const event of this.script) {
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      yield structuredClone(event);
    }
  }
}

export function demoScript(): EduEvent[] {
  const at = '2026-10-08T12:00:00.000Z';
  const events: EduEvent[] = [
    { type: 'run.start', runId: 'demo-001', goal: 'Prepare a small, reviewed feature', mode: 'crew', at },
    { type: 'agent.spawn', agentId: 'lead-1', role: 'lead', cli: 'claude', task: 'Plan the implementation', at },
    { type: 'agent.status', agentId: 'lead-1', status: 'running', at },
    { type: 'agent.text', agentId: 'lead-1', text: 'I will inspect the API boundary, then split implementation and review.', at },
    { type: 'brain.recall', agentId: 'lead-1', noteIds: ['D-keep-adapters-small'], at },
    { type: 'agent.spawn', agentId: 'explorer-1', parentId: 'lead-1', role: 'explorer', cli: 'codex', task: 'Map the relevant call path', at },
    { type: 'agent.text', agentId: 'explorer-1', text: 'The change is isolated behind one public interface.', at },
    { type: 'agent.end', agentId: 'explorer-1', ok: true, summary: 'Mapped the interface and its caller.', sessionId: 'fake-session-explorer', at },
    { type: 'agent.spawn', agentId: 'reviewer-1', parentId: 'lead-1', role: 'reviewer', cli: 'pi', task: 'Check the planned edge cases', at },
    { type: 'agent.thinking', agentId: 'reviewer-1', text: 'Check cancellation, error propagation, and empty input.', at },
    { type: 'agent.end', agentId: 'reviewer-1', ok: true, summary: 'No additional risks found.', sessionId: 'fake-session-reviewer', at },
    { type: 'agent.spawn', agentId: 'builder-1', parentId: 'lead-1', role: 'builder', cli: 'claude', model: 'demo-model', task: 'Implement the bounded change', at },
    { type: 'tool.call', agentId: 'builder-1', callId: 'tool-1', tool: 'read_file', input: '{"path":"src/example.ts"}', at },
    { type: 'tool.result', agentId: 'builder-1', callId: 'tool-1', ok: true, output: 'Read 42 lines.', at },
    { type: 'agent.text', agentId: 'builder-1', text: 'Implementation and focused tests are complete.', at },
    { type: 'usage', agentId: 'builder-1', usage: { inputTokens: 1840, outputTokens: 520, costUsd: 0.0124 }, at },
    { type: 'approval.request', agentId: 'builder-1', approvalId: 'approval-1', title: 'Apply the planned file change?', detail: 'This demo pauses before a mutating tool.', at },
    { type: 'approval.resolve', approvalId: 'approval-1', approved: true, by: 'user', at },
    { type: 'brain.learn', noteId: 'L-check-empty-input', kind: 'lesson', title: 'Validate empty input at the boundary', at },
    { type: 'agent.end', agentId: 'builder-1', ok: true, summary: 'Change implemented and tested.', sessionId: 'fake-session-builder', at },
    { type: 'run.end', runId: 'demo-001', ok: true, summary: 'Demo crew completed successfully.', at },
  ];
  const base = new Date(at).getTime();
  return events.map((event, index) => ({ ...event, at: new Date(base + index * 450).toISOString() } as EduEvent));
}
