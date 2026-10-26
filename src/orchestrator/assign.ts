import type { CliId, EduConfig, RoleId } from '../core/contracts.js';

export function roleRoute(role: RoleId, config: EduConfig) {
  const key = role === 'builder' ? 'executor' : role === 'reviewer' ? 'reviewer' : role === 'advisor' ? 'advisor' : undefined;
  return key ? config.routing?.[key] : undefined;
}

export function assignCli(role: RoleId, config: EduConfig, available: CliId[]): CliId {
  const route = roleRoute(role, config);
  if (route) {
    if (!available.includes(route.cli)) throw new Error(`Configured ${role} CLI '${route.cli}' is unavailable; no fallback was disclosed.`);
    return route.cli;
  }
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
