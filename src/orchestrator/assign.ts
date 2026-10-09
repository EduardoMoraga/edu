import type { CliId, EduConfig, RoleId } from '../core/contracts.js';

export function assignCli(role: RoleId, config: EduConfig, available: CliId[]): CliId {
  if (config.mode === 'solo') return config.defaultCli;
  const spec = config.roles.find(candidate => candidate.id === role);
  const configured = spec?.cli;
  if (role === 'reviewer') {
    const builderCli = assignCli('builder', config, available);
    if (configured && available.includes(configured) && configured !== builderCli) return configured;
    const diverse = available.find(cli => cli !== builderCli);
    if (diverse) return diverse;
  }
  return configured && available.includes(configured) ? configured : available[0] ?? config.defaultCli;
}
