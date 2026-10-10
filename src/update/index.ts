export { RELEASES_API, UpdateError, compareVersions, fetchRelease, normalizeVersion, pickAsset, releaseTag, whatsNew } from './release.js';
export type { Release, UpdateErrorCode } from './release.js';
export { checkForUpdate, fileExists, installPrefix, performUpdate, resolveNpm } from './update.js';
export type { Relation, RunResult, Runner, StepName, StepResult, UpdateCheck, UpdateDeps, UpdateOutcome } from './update.js';
export { migrateWorkspaces } from './migrate.js';
export type { MigrationStatus, WorkspaceMigration } from './migrate.js';
