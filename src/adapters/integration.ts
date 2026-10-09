import type { CliId, CliIntegration, InstallAction, InstallScope } from '../core/contracts.js';
import type { IntegrationOptions, PlannedAction } from './types.js';
import { binaryOnPath } from './common.js';
import { applyStandaloneActions } from './operations.js';

export function createIntegration(
  cli: CliId,
  options: IntegrationOptions,
  planner: (scope: InstallScope, root: string, options: IntegrationOptions) => Promise<PlannedAction[]>,
): CliIntegration {
  return {
    cli,
    detect: () => (options.detectBinary ?? binaryOnPath)(cli === 'agy' ? 'agy' : cli),
    plan: (scope, root) => planner(scope, root, options),
    apply: async (actions: InstallAction[]) => applyStandaloneActions(actions as PlannedAction[], options.home),
  };
}
