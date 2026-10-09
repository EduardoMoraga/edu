/** `edu doctor`: Node, CLIs (+ sign-in hint), integrations, brains, Obsidian link. */
import { join } from 'node:path';
import type { Command } from 'commander';
import { openBrain } from '../../brain/index.js';
import type { BrainLocation, CliId } from '../../core/contracts.js';
import { globalHome, type CliContext } from '../context.js';
import { t } from '../i18n.js';
import { action, look, printJson, statusLine, type Level } from '../kit.js';
import { brainDir, linkPath, linkState } from '../link.js';
import { effectiveConfig, exists, openWorkspace } from '../workspace.js';

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
    .description('check Node, coding CLIs, integrations, brains and the Obsidian link')
    .option('--json', 'machine-readable output')
    .action(
      action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
        const lang = g.lang;
        const lines: DoctorLine[] = [nodeLine(process.version, lang)];
        const { diagnose } = await import('../../adapters/index.js');
        const clis = await diagnose({ root: g.cwd, home: ctx.home });
        for (const d of clis) {
          if (!d.installed) lines.push({ level: 'warn', text: t(lang, 'doctor.cliMissing', { cli: d.cli }) });
          else if (d.drift) lines.push({ level: 'fail', text: t(lang, 'doctor.cliDrift', { cli: d.cli }) });
          else if (d.integrated) lines.push({ level: 'ok', text: t(lang, 'doctor.cliReady', { cli: d.cli, scopes: d.scopes.join(', ') }) });
          else lines.push({ level: 'warn', text: t(lang, 'doctor.cliNotIntegrated', { cli: d.cli }) });
          if (d.installed) lines.push({ level: 'ok', text: t(lang, 'doctor.auth', { hint: AUTH_HINTS[d.cli] }) });
        }

        const ws = await openWorkspace(ctx, g.cwd);
        const locations: BrainLocation[] = ws.locations.some((l) => l.scope === 'global')
          ? ws.locations
          : [...ws.locations, { scope: 'global', root: globalHome(ctx) }];
        const brains = [];
        for (const loc of locations) {
          const ready = await exists(join(loc.root, 'EDU.md'));
          const total = ready ? (await openBrain([loc]).stats()).total : 0;
          brains.push({ ...loc, ready, total });
          lines.push(
            ready
              ? { level: 'ok', text: t(lang, 'doctor.brain', { scope: loc.scope, root: loc.root, total }) }
              : { level: 'warn', text: t(lang, 'doctor.brainMissing', { scope: loc.scope, root: loc.root, flag: loc.scope === 'global' ? ' --global' : '' }) },
          );
        }

        let vault: { link?: string; state: string } = { state: 'none' };
        if (await exists(join(ws.primary.root, 'config.json'))) {
          const config = await effectiveConfig(ws.primary.root, []);
          if (config.brain.obsidianVault) {
            const link = linkPath(config.brain.obsidianVault, ws.primary);
            vault = { link, state: await linkState(link, brainDir(ws.primary)) };
          }
        }
        if (vault.state === 'none') lines.push({ level: 'warn', text: t(lang, 'doctor.vaultNone') });
        else if (vault.state === 'ok') lines.push({ level: 'ok', text: t(lang, 'doctor.vaultOk', { link: vault.link! }) });
        else lines.push({ level: 'fail', text: t(lang, 'doctor.vaultBroken', { link: vault.link! }) });

        if (g.json || opts.json) {
          printJson(ctx, { node: process.version, clis, brains, vault, lines });
          return;
        }
        const style = look(ctx);
        ctx.out(t(lang, 'doctor.title'));
        for (const line of lines) {
          ctx.out(line.text.startsWith('  ') ? `  ${line.text.trim()}` : statusLine(style, line.level, line.text));
        }
      }),
    );
}
