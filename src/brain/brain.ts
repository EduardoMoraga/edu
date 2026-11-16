/**
 * `openBrain`: one brain over its locations (project first, then global). The methods come in cohesive groups built
 * on a shared core (brain-core.ts): writes and the note lifecycle (brain-write.ts), recall and lookup
 * (brain-recall.ts), learning and maintenance (brain-maintain.ts) and canonical review (brain-canonical.ts).
 */
import type { BrainLocation } from '../core/contracts.js';
import { canonicalMethods } from './brain-canonical.js';
import { createBrainCore } from './brain-core.js';
import { maintainMethods } from './brain-maintain.js';
import { recallMethods } from './brain-recall.js';
import type { Brain } from './brain-types.js';
import { writeMethods } from './brain-write.js';
import type { ViewOptions } from './views.js';

export type { Brain, BrainStats, MaintenanceReport, NewNote, NoteProvenance, RecallOptions, RememberResult, UpdateOptions } from './brain-types.js';
export { REJECT_SOURCE } from './brain-core.js';

export function openBrain(locations: BrainLocation[], viewOptions: ViewOptions = {}): Brain {
  if (!locations.length) throw new Error('openBrain requires at least one location');
  const core = createBrainCore(locations, viewOptions);
  // Methods that call other methods (remember → write, closeSession → update, maintain → proposeCanonical, …) go
  // through the assembled brain, so a wrapped or replaced method is honoured as it was with `this`.
  const self = (): Brain => brain;
  const maintain = maintainMethods(core, self);
  const writes = writeMethods(core, self, maintain.retireSuperseded);
  const brain: Brain = {
    ...writes.methods,
    ...recallMethods(core),
    ...maintain.methods,
    ...canonicalMethods(core, self, writes.applyUpdate),
  };
  return brain;
}
