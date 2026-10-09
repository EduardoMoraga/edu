/** Local evidence vocabulary. Kept separate while shared contracts are frozen. */
export type FailureType = 'context' | 'tool' | 'feedback' | 'verify' | 'recovery' | 'entropy' | 'model' | 'unknown';
export type OutcomeLabel = 'autonomous_verified_success' | 'assisted_verified_success' | 'unverified_success' | 'failed' | 'unsafe_invalid';
export type HarnessLevel = 'H0' | 'H1' | 'H2' | 'H3';

export interface Requirement {
  id: string;
  text: string;
}

export interface DeterministicCheck {
  id: string;
  requirementIds: string[];
  command: string;
  expect: { exitCode?: number; stdoutIncludes?: string };
  timeoutMs: number;
}

export interface EvidenceMetricRecord {
  [key: string]: unknown;
}
