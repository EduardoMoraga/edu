import type { InstallScope } from '../core/contracts.js';
import type { IntegrationOptions, PlannedAction } from './types.js';
import { instructionActions, skillActions } from './common.js';
import { createIntegration } from './integration.js';

async function plan(scope: InstallScope, root: string, options: IntegrationOptions): Promise<PlannedAction[]> {
  return [...instructionActions('agy', scope, root, options), ...await skillActions('agy', scope, root, options)];
}

export function createAgyIntegration(options: IntegrationOptions) { return createIntegration('agy', options, plan); }
