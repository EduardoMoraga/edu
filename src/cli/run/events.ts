/**
 * Recorded runs may interleave non-core records (e.g. evidence events) with
 * EduEvents. The live view and plain output only render core EduEvents.
 */
import type { EduEvent } from '../../core/contracts.js';

// A Record keyed by every EduEvent type: the compiler flags any type added to the contract.
const CORE: Record<EduEvent['type'], true> = {
  'run.start': true,
  'run.end': true,
  'agent.spawn': true,
  'agent.status': true,
  'agent.text': true,
  'agent.thinking': true,
  'tool.call': true,
  'tool.result': true,
  usage: true,
  'context.usage': true,
  'approval.request': true,
  'approval.resolve': true,
  'brain.recall': true,
  'brain.learn': true,
  'agent.end': true,
  error: true,
};

export function isCoreEvent(event: { type: string }): event is EduEvent {
  return Object.hasOwn(CORE, event.type);
}

export async function* coreEvents(source: AsyncIterable<{ type: string }>): AsyncGenerator<EduEvent> {
  for await (const event of source) if (isCoreEvent(event)) yield event;
}
