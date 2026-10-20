import { packageVersion } from '../cli/package.js';

/** Capabilities of this binary, not a forecast of a requested future release. */
export function getCapabilities(version = packageVersion()) {
  return {
    version,
    features: [
      'Persistent episodic, transitive and human-approved canonical memory',
      'Query-based recall and bounded context with actionable note passages',
      'Bounded local consolidation of queued structured intervention evidence without a model',
      'Event-deduplicated feedback with separate advisory and externally verified credit',
      'Bounded, repeatable model-assisted reflection (explicit)',
      'Backed-up global/project migration and checked pristine native plugin refresh',
      'Up to three inferred lessons in the host model session-close call',
      'Cached Pi briefs and host-owned workspace/session integrity',
      'Optional 12-tool memory-only MCP profile (full remains default)',
      'Evaluation separates verified outcomes, unknown costs and synthetic suites',
    ],
    limitations: [
      'Persistent memory is not model-weight training or proof of reduced human work.',
      'Update and migration do not invoke a paid model or infer new lessons.',
      'Canonical standards and behavioral skills require human approval.',
      'Context exposure and advisory feedback are not verified success; promotion requires verified evidence.',
      'Host integrations must be restarted after updating; existing sessions may retain old tools and instructions.',
      'Missing/broken workspaces or unknown/custom native caches leave upgrades incomplete, not silently overwritten.',
    ],
    commands: ['edu --version', 'edu capabilities --json', 'edu brief', 'edu brain recall', 'edu reflect --since 7d', 'edu eval suite --json', 'edu update --check', 'edu internal migrate-workspaces --json'],
    restartRequired: true,
  };
}
