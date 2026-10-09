/**
 * Plain, line-oriented rendering of EduEvents for non-TTY output (pipes, CI,
 * logs). One readable line per meaningful event; deltas and usage are folded.
 */
import type { EduEvent, RoleId } from '../../core/contracts.js';
import { roleIcon, type Glyphs } from '../../identity/index.js';

const oneLine = (text: string, max = 160) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export type PlainFormatter = (event: EduEvent) => string | undefined;

export function createPlainFormatter(glyphs: Glyphs): PlainFormatter {
  const roles = new Map<string, RoleId>();
  const who = (agentId: string | undefined) => {
    if (!agentId) return '';
    const role = roles.get(agentId) ?? agentId;
    return `${roleIcon(role, glyphs)} ${role} `;
  };
  return (event) => {
    switch (event.type) {
      case 'run.start':
        return `${glyphs.roles.lead} run ${event.runId} ${glyphs.sep} ${event.mode} ${glyphs.sep} ${oneLine(event.goal)}`;
      case 'agent.spawn':
        roles.set(event.agentId, event.role);
        return `${who(event.agentId)}${glyphs.sep} ${event.cli}${event.model ? `/${event.model}` : ''} ${glyphs.arrow} ${oneLine(event.task)}`;
      case 'agent.status':
        return event.status === 'running' ? undefined : `${who(event.agentId)}${glyphs.status[event.status]} ${event.status}`;
      case 'agent.text':
        return event.text.trim() ? `${who(event.agentId)}${oneLine(event.text)}` : undefined;
      case 'tool.call':
        return `${who(event.agentId)}${glyphs.arrow} ${event.tool} ${oneLine(event.input, 80)}`;
      case 'tool.result':
        return `${who(event.agentId)}  ${event.ok ? glyphs.ok : glyphs.fail} ${oneLine(event.output, 80)}`;
      case 'approval.request':
        return `${who(event.agentId)}${glyphs.approval} approval: ${oneLine(event.title)}`;
      case 'approval.resolve':
        return `${glyphs.approval} ${event.approved ? 'approved' : 'rejected'} (${event.by})`;
      case 'brain.recall':
        return event.noteIds.length ? `${glyphs.brain} recalled ${event.noteIds.join(', ')}` : undefined;
      case 'brain.learn':
        return `${glyphs.brain} learned ${event.kind}: ${oneLine(event.title)}`;
      case 'agent.end':
        return `${who(event.agentId)}${event.ok ? glyphs.ok : glyphs.fail} ${oneLine(event.summary)}`;
      case 'error':
        return `${glyphs.fail} ${who(event.agentId)}${oneLine(event.message)}`;
      case 'verify.result':
        return `${event.ok ? glyphs.ok : glyphs.fail} verify ${event.kind}${event.checkId ? ` ${event.checkId}` : ''}: ${oneLine(event.output)}`;
      case 'failure.attribution':
        return `${glyphs.fail} attribution ${event.failureType}: ${oneLine(event.observed)}`;
      case 'intervention':
        return `${glyphs.approval} intervention ${oneLine(event.action)}${event.avoidable ? ` (avoidable: ${event.harnessGap})` : ''}`;
      case 'outcome':
        return `${glyphs.brain} outcome ${event.label}`;
      case 'run.end':
        return `${event.ok ? glyphs.ok : glyphs.fail} run ${event.ok ? 'finished' : 'failed'}: ${oneLine(event.summary)}`;
      default:
        return undefined;
    }
  };
}
