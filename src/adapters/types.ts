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
}

export interface IntegrationOptions {
  home: string;
  templatesDir: string;
  detectBinary?: (binary: string) => Promise<boolean>;
}

export const CLI_IDS: CliId[] = ['claude', 'codex', 'pi', 'opencode', 'agy'];
