import type { CliId, InstallAction, InstallScope } from '../core/contracts.js';

export interface PlannedAction extends InstallAction {
  clis?: CliId[];
  content?: string;
  jsonPatch?: Record<string, unknown>;
  tomlBody?: string;
}

export interface InstallPlan {
  scope: InstallScope;
  root: string;
  home: string;
  templatesDir: string;
  actions: PlannedAction[];
  notes: string[];
  /**
   * Actions an earlier Edu version recorded that this version no longer installs. applyInstall undoes
   * each one found in the manifest (matching kind, path and, when given, jsonPatch) and stops tracking it.
   * It never fails on them: a target the user or host already changed or removed is left as it is.
   */
  retire?: RetiredAction[];
}

export interface RetiredAction { kind: PlannedAction['kind']; path: string; jsonPatch?: Record<string, unknown> }

export interface IntegrationOptions {
  home: string;
  templatesDir: string;
  detectBinary?: (binary: string) => Promise<boolean>;
}

export const CLI_IDS: CliId[] = ['claude', 'codex', 'pi', 'opencode', 'agy'];
