/** `edu doctor`: Node, CLIs (+ sign-in hint), integrations, brains, profiles, Obsidian link. */
import { join } from 'node:path';
import type { Command } from 'commander';
import { brainPath, openBrain } from '../../brain/index.js';
import type { BrainLocation, CliId } from '../../core/contracts.js';
import { globalHome, type CliContext } from '../context.js';
import { t } from '../i18n.js';
import { action, look, printJson, statusLine, type Level } from '../kit.js';
import { formatProfileLines, inspectCopies, isolationExitCode, type ProfileLine } from '../../doctor/profiles.js';
import { brainDir, linkPath, linkState } from '../../vault/link.js';
import { effectiveConfig, exists, openWorkspace } from '../workspace.js';
import { readProjects } from '../../brain/registry.js';
import { scanContext } from '../../doctor/context.js';
import { integrationPreflight } from '../../doctor/integrations.js';
import { readSyncState } from '../../vault/sync.js';
import { describeSync } from './sync.js';
import { dirname } from 'node:path';
import { packageRoot } from '../../platform/package.js';
import { binaryOnPath } from '../../platform/index.js';

export const AUTH_HINTS: Record<CliId, string> = {
  claude: 'run `claude` once and sign in, or set ANTHROPIC_API_KEY',
  codex: 'run `codex login`',
  pi: 'run `pi` and use /login, or set a provider API key',
  opencode: 'run `opencode auth login`',
  agy: 'run `agy` once and sign in',
};

export interface DoctorLine {
  level: Level;
  text: string;
  /** Section text. No status glyph, so a heading stays a heading on a narrow terminal. */
  plain?: true;
}

export function nodeLine(version: string, lang: 'en' | 'es'): DoctorLine {
  const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? 0);
  return major >= 22
    ? { level: 'ok', text: t(lang, 'doctor.node', { version }) }
    : { level: 'fail', text: t(lang, 'doctor.nodeOld', { version }) };
}

export function registerDoctor(program: Command, ctx: CliContext): void {
  program
    .command('doctor')
    .description('check Node, coding CLIs, integrations, brains, profiles and the Obsidian link')
    .option('--json', 'machine-readable output')
    .option('--context', 'measure startup instructions and competing integrations')
    .option('--integrations', 'nonmutating optional integration policy and configuration preflight')
    .action(
      action<{ json?: boolean; context?: boolean; integrations?: boolean }>(ctx, async ({ g, opts }) => {
        const lang = g.lang;
        if (opts.integrations) {
          const report = await integrationPreflight(ctx.home, ctx.env);
          if (g.json || opts.json) { printJson(ctx, report); return; }
          ctx.out(report.diagnostic);
          ctx.out(report.piToolDiscovery);
          for (const item of report.integrations) ctx.out(`${item.id}: ${item.state}; license=${item.license}; registered=${item.registered}; compatibility=${item.runtimeCompatibility}. ${item.overlap}`);
          return;
        }
        if (opts.context) {
          const report = await scanContext({ home: ctx.home, env: ctx.env });
          if (g.json || opts.json) { printJson(ctx, report); return; }
          for (const host of report.hosts) {
            const owners = Object.entries(host.tokens.byOwner).filter(([, count]) => count > 0).map(([owner, count]) => `${owner} ${count}`).join(', ');
            const hookOwners = Object.entries(host.hooks.byOwner).map(([owner, count]) => `${owner} ${count}`).join(', ') || 'none';
            const mcpOwners = Object.entries(host.mcpServers.byOwner).map(([owner, count]) => `${owner} ${count}`).join(', ') || 'none';
            ctx.out(lang === 'es'
              ? `${host.host}: ~${host.tokens.total} tokens antes de escribir (${owners}). Hooks: ${host.hooks.total} (${hookOwners}); MCP: ${host.mcpServers.total} (${mcpOwners}); plugins: ${host.plugins.join(', ') || 'ninguno'}.`
              : `${host.host}: ~${host.tokens.total} tokens before you type (${owners}). Hooks: ${host.hooks.total} (${hookOwners}); MCP: ${host.mcpServers.total} (${mcpOwners}); plugins: ${host.plugins.join(', ') || 'none'}.`);
            if (host.competingMemory) ctx.out(lang === 'es' ? `  Memorias en competencia: ${host.memoryWriters.join(', ')}.` : `  Competing memory writers: ${host.memoryWriters.join(', ')}.`);
            if (host.competingOrchestration) ctx.out(lang === 'es' ? `  Orquestadores en competencia: ${host.orchestrationProtocols.join(', ')}.` : `  Competing orchestrators: ${host.orchestrationProtocols.join(', ')}.`);
            if (host.detachCommand) ctx.out(`  ${host.detachCommand}`);
            for (const warning of host.warnings) ctx.out(`  ${warning}`);
          }
          return;
        }
        const lines: DoctorLine[] = [nodeLine(process.version, lang)];
        // Hosts start `edu mcp` and the hooks by name: without `edu` on PATH every integration fails silently.
        lines.push(await binaryOnPath('edu', ctx.env)
          ? { level: 'ok', text: lang === 'es' ? '`edu` está en el PATH' : '`edu` is on PATH' }
          : { level: 'fail', text: lang === 'es' ? '`edu` no está en el PATH: los hosts no pueden iniciar `edu mcp` ni los hooks. Agregue el bin global de npm (npm prefix -g) al PATH.' : '`edu` is not on PATH: hosts cannot start `edu mcp` or its hooks. Add the npm global bin directory (npm prefix -g) to PATH.' });
        const profileAt = lines.length;
        const { diagnose, installProblems, quarantineProblem } = await import('../../doctor/diagnose.js');
        const diagnoseOptions = { root: g.cwd, home: process.platform === 'win32' ? ctx.env.USERPROFILE || ctx.home : ctx.home, env: ctx.env, packageRoot: packageRoot() };
        const clis = await diagnose(diagnoseOptions);
        const problems = await installProblems(diagnoseOptions);
        for (const problem of problems) lines.push(problem);
        for (const d of clis) {
          if (!d.installed) lines.push({ level: 'warn', text: t(lang, 'doctor.cliMissing', { cli: d.cli }) });
          else if (d.drift) lines.push({ level: 'fail', text: t(lang, 'doctor.cliDrift', { cli: d.cli }) });
          else if (d.integrated) lines.push({ level: 'ok', text: t(lang, 'doctor.cliReady', { cli: d.cli, scopes: [...d.scopes, ...d.native].join(', ') }) });
          else lines.push({ level: 'warn', text: t(lang, 'doctor.cliNotIntegrated', { cli: d.cli }) });
          for (const note of d.notes) lines.push({ level: 'warn', text: note });
          if (d.installed) lines.push({ level: 'ok', text: t(lang, 'doctor.auth', { hint: AUTH_HINTS[d.cli] }) });
        }

        const ws = await openWorkspace(ctx, g.cwd);
        const projects = await readProjects(globalHome(ctx));
        for (const project of projects.projects) {
          const ready = await exists(project.root) && await exists(project.brain);
          lines.push({ level: ready ? 'ok' : 'warn', text: t(lang, ready ? 'doctor.project' : 'doctor.projectMissing', { name: project.name, root: project.root }) });
        }
        const locations: BrainLocation[] = ws.locations.some((l) => l.scope === 'global')
          ? ws.locations
          : [...ws.locations, { scope: 'global', root: globalHome(ctx) }];
        const brains = [];
        for (const loc of locations) {
          const ready = await exists(join(loc.root, 'EDU.md'));
          const brain = ready ? openBrain([loc]) : undefined;
          const total = brain ? (await brain.stats()).total : 0;
          // Files that are not valid notes are quarantined: never loaded, never overwritten. stats() just listed them.
          const quarantined = brain ? await brain.problems() : [];
          brains.push({ ...loc, ready, total, quarantined: { count: quarantined.length, paths: quarantined.map(problem => problem.path) } });
          lines.push(
            ready
              ? { level: 'ok', text: t(lang, 'doctor.brain', { scope: loc.scope, root: loc.root, total }) }
              : { level: 'warn', text: t(lang, 'doctor.brainMissing', { scope: loc.scope, root: loc.root, flag: loc.scope === 'global' ? ' --global' : '' }) },
          );
          const unreadable = quarantineProblem(loc.scope, brainPath(loc), quarantined, lang);
          if (unreadable) lines.push(unreadable);
        }

        let vault: { link?: string; state: string } = { state: 'none' };
        const userHome = process.platform === 'win32' ? ctx.env.USERPROFILE || ctx.home : ctx.home;
        const vaultRoots: string[] = [];
        let obsidianRoot: string | undefined;
        if (await exists(join(ws.primary.root, 'config.json'))) {
          const config = await effectiveConfig(ws.primary.root, []);
          if (config.brain.obsidianVault) {
            obsidianRoot = config.brain.obsidianVault;
            const link = linkPath(config.brain.obsidianVault, ws.primary);
            vault = { link, state: await linkState(link, brainDir(ws.primary)) };
          }
        }
        const defaultVault = join(userHome, 'EduVault');
        if (vault.state === 'none' && await exists(join(defaultVault, 'Home.md'))) {
          const link = linkPath(defaultVault, ws.primary);
          vault = { link, state: await linkState(link, brainDir(ws.primary)) };
        }
        if (await exists(defaultVault)) vaultRoots.push(defaultVault);
        if (obsidianRoot) vaultRoots.push(obsidianRoot);
        if (vault.state === 'none') lines.push({ level: 'warn', text: t(lang, 'doctor.vaultNone') });
        else if (vault.state === 'ok') lines.push({ level: 'ok', text: t(lang, 'doctor.vaultOk', { link: vault.link! }) });
        else lines.push({ level: 'fail', text: t(lang, 'doctor.vaultBroken', { link: vault.link! }) });

        const sync = await readSyncState(globalHome(ctx));
        if (sync?.vault) vaultRoots.push(sync.vault);
        const session = globalHome(ctx);
        const fallbackHome = join(userHome, '.edu');
        const sameHome = process.platform === 'win32' ? session.toLowerCase() === fallbackHome.toLowerCase() : session === fallbackHome;
        const homes = [session];
        if (!sameHome && await exists(fallbackHome)) homes.push(fallbackHome);
        const extraProjects: { name: string; brain: string; home: string }[] = [];
        for (const home of homes) {
          if (home === session) continue;
          try {
            const registry = await readProjects(home);
            extraProjects.push(...registry.projects.map(project => ({ name: project.name, brain: project.brain, home })));
          } catch {
            // A second home with a broken registry still shows its profile. Doctor does not rewrite it.
          }
        }
        const profileReport = await inspectCopies({
          platform: process.platform,
          env: ctx.env,
          homes,
          vaults: vaultRoots,
          projects: [
            ...projects.projects.map(project => ({ name: project.name, brain: project.brain, home: session })),
            ...extraProjects,
          ],
        });
        if (isolationExitCode(profileReport) === 1) ctx.setExitCode(1);
        const profileLines: DoctorLine[] = formatProfileLines(profileReport, lang).map((line: ProfileLine) => (
          line.plain ? { level: line.level, text: line.text, plain: true } : { level: line.level, text: line.text }
        ));
        lines.splice(profileAt, 0, ...profileLines);
        if (sync) {
          const stale = Date.now() - Date.parse(sync.at) > 30 * 60_000;
          const level: Level = sync.state === 'conflict' || sync.state === 'error' ? 'fail' : stale || sync.state !== 'ok' ? 'warn' : 'ok';
          lines.push({ level, text: `${lang === 'es' ? 'Sync del cerebro' : 'Brain sync'}: ${describeSync(sync)}${sync.branch ? ` [${sync.branch}]` : ''}` });
        }

        if (g.json || opts.json) {
          printJson(ctx, { node: process.version, clis, problems, projects: projects.projects, brains, vault, sync: sync ?? null, profileReport, lines });
          return;
        }
        const style = look(ctx);
        ctx.out(t(lang, 'doctor.title'));
        for (const line of lines) {
          if (line.plain) ctx.out(line.text);
          else ctx.out(line.text.startsWith('  ') ? `  ${line.text.trim()}` : statusLine(style, line.level, line.text));
        }
      }),
    );
}
