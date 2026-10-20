/** `edu update [tag] [--check] [--to <tag>]` and the hidden post-update hook `edu internal migrate-workspaces`. */
import { dirname } from 'node:path';
import type { Command } from 'commander';
import { UpdateError, whatsNew } from '../../update/release.js';
import { checkForUpdate, fileExists, installPrefix, performUpdate, type StepName, type UpdateDeps } from '../../update/update.js';
import { globalHome, type CliContext } from '../context.js';
import { action, look, printJson, statusLine } from '../kit.js';
import { packageTemplatesDir, packageVersion } from '../package.js';

interface UpdateOpts { check?: boolean; to?: string; json?: boolean }

const M = {
  en: {
    offline: 'Cannot check for updates: {reason}. Are you offline? Edu {current} stays as it is.',
    failedCheck: 'Cannot check for updates: {reason}. Edu {current} stays as it is.',
    upToDate: 'Edu {current} is up to date (latest release {tag}).',
    ahead: 'Edu {current} is ahead of the latest release {tag} (development build). Nothing to do.',
    same: 'Edu {current} is already the release {tag}.',
    available: 'Update available: {current} → {version}',
    older: '{tag} is older than the running Edu {current}. Run `edu update {tag}` to install it anyway.',
    runIt: 'Run: edu update',
    checkout: 'Note: this edu runs from {root} (not an npm global install); the release goes to npm\'s global prefix.',
    steps: { install: 'Installing {asset}…', verify: 'Checking the new version…', setup: 'Running the new `edu setup --yes`…', migrate: 'Migrating registered workspaces…' },
    installFailed: 'Install failed; verify the installed binary before retrying. npm may have changed files.',
    verifyFailed: 'npm finished, but the new version could not be verified.',
    installed: 'Edu {version} installed.',
    setupOk: 'Setup refreshed for your CLIs.',
    setupFailed: 'Setup did not finish; run `edu setup --yes` again.',
    migrateSkipped: 'Workspace migration skipped: {detail}',
    migrateFailed: 'Workspace migration had problems: {detail}',
    migrated: 'Workspaces: {migrated} migrated · {missing} missing (skipped) · {failed} failed',
    news: "What's new in {tag}:",
    more: 'Full notes: {url}',
    migrateNone: 'No registered workspaces.',
  },
  es: {
    offline: 'No se pudo buscar actualizaciones: {reason}. ¿Sin conexión? Edu {current} queda como está.',
    failedCheck: 'No se pudo buscar actualizaciones: {reason}. Edu {current} queda como está.',
    upToDate: 'Edu {current} está al día (última versión {tag}).',
    ahead: 'Edu {current} va por delante de la última versión publicada {tag} (versión de desarrollo). Nada que hacer.',
    same: 'Edu {current} ya es la versión {tag}.',
    available: 'Hay una actualización: {current} → {version}',
    older: '{tag} es anterior a Edu {current}. Ejecuta `edu update {tag}` para instalarla igual.',
    runIt: 'Ejecuta: edu update',
    checkout: 'Nota: este edu corre desde {root} (no es una instalación global de npm); la versión se instala en el prefijo global de npm.',
    steps: { install: 'Instalando {asset}…', verify: 'Verificando la nueva versión…', setup: 'Ejecutando el nuevo `edu setup --yes`…', migrate: 'Migrando los espacios registrados…' },
    installFailed: 'La instalación falló; verifica el binario antes de reintentar. npm puede haber cambiado archivos.',
    verifyFailed: 'npm terminó, pero no se pudo verificar la nueva versión.',
    installed: 'Edu {version} instalado.',
    setupOk: 'Setup actualizado para tus CLIs.',
    setupFailed: 'El setup no terminó; ejecuta `edu setup --yes` otra vez.',
    migrateSkipped: 'Migración de espacios omitida: {detail}',
    migrateFailed: 'La migración de espacios tuvo problemas: {detail}',
    migrated: 'Espacios: {migrated} migrados · {missing} no encontrados (omitidos) · {failed} con error',
    news: 'Novedades de {tag}:',
    more: 'Notas completas: {url}',
    migrateNone: 'No hay espacios registrados.',
  },
} as const;

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));

export function defaultUpdateDeps(ctx: CliContext): UpdateDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    run: async (...args) => (await import('../../update/process.js')).spawnRunner(...args),
    exists: fileExists,
    execPath: process.execPath,
    platform: process.platform,
    packageRoot: dirname(packageTemplatesDir()),
    currentVersion: packageVersion(),
    env: ctx.env,
  };
}

export function registerUpdate(program: Command, ctx: CliContext, overrides: Partial<UpdateDeps> = {}): void {
  program
    .command('update')
    .description('update Edu to the latest GitHub release (setup and workspace migration included)')
    .argument('[tag]', 'a specific release, e.g. v0.8.0 (default: latest)')
    .option('--check', 'only report whether an update is available')
    .option('--to <tag>', 'same as [tag] (`--version` is taken by `edu --version`)')
    .option('--json', 'machine-readable output')
    .action(
      action<UpdateOpts>(ctx, async ({ g, opts }, tagArg) => {
        const deps = { ...defaultUpdateDeps(ctx), ...overrides };
        const m = M[g.lang];
        const tag = tagArg || opts.to;
        const json = g.json || opts.json;
        let check;
        try {
          check = await checkForUpdate(deps, tag);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (json) printJson(ctx, { ok: false, current: deps.currentVersion, error: reason, code: error instanceof UpdateError ? error.code : 'error' });
          else ctx.err(fill(error instanceof UpdateError && error.code === 'offline' ? m.offline : m.failedCheck, { reason, current: deps.currentVersion }));
          return ctx.setExitCode(1);
        }
        const { release, relation, current } = check;
        const vars = { current, tag: release.tag, version: release.version, asset: release.assetName, url: release.url, root: deps.packageRoot };
        const news = whatsNew(release.body);
        const install = relation === 'newer' || (Boolean(tag) && relation === 'older');
        if (opts.check || !install) {
          if (json) return printJson(ctx, { current, latest: release.version, tag: release.tag, relation, updateAvailable: relation === 'newer', url: release.url, asset: release.assetUrl, whatsNew: news });
          if (relation === 'same') return ctx.out(fill(tag ? m.same : m.upToDate, vars));
          if (relation === 'older' && !tag) return ctx.out(fill(m.ahead, vars));
          if (relation === 'older') return ctx.out(fill(m.older, vars));
          ctx.out(fill(m.available, vars));
          if (news.length) { ctx.out(fill(m.news, vars)); for (const line of news) ctx.out(`  ${line}`); }
          ctx.out(tag ? `Run: edu update ${release.tag}` : m.runIt);
          return;
        }

        const lk = look(ctx);
        if (!json && !installPrefix(deps.packageRoot, deps.platform)) ctx.out(fill(m.checkout, vars));
        const outcome = await performUpdate(deps, release, (step: StepName) => { if (!json) ctx.out(fill(m.steps[step], vars)); });
        if (!outcome.ok) ctx.setExitCode(1);
        if (json) return printJson(ctx, { current, version: release.version, tag: release.tag, ...outcome, restartRequired: outcome.installed, whatsNew: news });
        const byStep = new Map(outcome.steps.map(s => [s.step, s]));
        const install_ = byStep.get('install');
        if (install_?.status === 'failed') {
          ctx.err(statusLine(lk, 'fail', fill(m.installFailed, vars)));
          if (install_.detail) ctx.err(install_.detail.split('\n').map(l => `  ${l}`).join('\n'));
          return;
        }
        const verify = byStep.get('verify');
        if (verify?.status === 'failed') {
          ctx.err(statusLine(lk, 'fail', m.verifyFailed));
          if (verify.detail) ctx.err(`  ${verify.detail}`);
          return;
        }
        ctx.out(statusLine(lk, 'ok', fill(m.installed, vars)));
        const setup = byStep.get('setup');
        if (setup?.status === 'ok') ctx.out(statusLine(lk, 'ok', m.setupOk));
        else if (setup) { ctx.err(statusLine(lk, 'warn', m.setupFailed)); if (setup.detail) ctx.err(setup.detail.split('\n').map(l => `  ${l}`).join('\n')); }
        const migrate = byStep.get('migrate');
        if (migrate?.status === 'skipped') ctx.out(statusLine(lk, 'warn', fill(m.migrateSkipped, { detail: migrate.detail ?? '' })));
        else if (outcome.migrations) {
          const count = (s: string) => outcome.migrations!.filter(w => w.status === s).length;
          ctx.out(statusLine(lk, migrate?.status === 'ok' ? 'ok' : 'warn', fill(m.migrated, { migrated: count('migrated'), missing: count('missing'), failed: count('failed') })));
          if (migrate?.status === 'failed' && migrate.detail) ctx.err(`  ${migrate.detail}`);
        } else if (migrate?.status === 'failed') ctx.err(statusLine(lk, 'warn', fill(m.migrateFailed, { detail: migrate.detail ?? '' })));
        if (migrate?.status !== 'ok') ctx.err(g.lang === 'es' ? 'Actualización incompleta. Reintenta: edu internal migrate-workspaces --json' : 'Upgrade incomplete. Retry: edu internal migrate-workspaces --json');
        if (news.length) { ctx.out(''); ctx.out(fill(m.news, vars)); for (const line of news) ctx.out(`  ${line}`); }
        ctx.out(fill(m.more, vars));
        ctx.out(g.lang === 'es' ? 'Reinicia tus CLIs y servidores MCP para cargar la versión e instrucciones nuevas.' : 'Restart your CLIs and MCP servers to load the new version and instructions.');
      }),
    );

  const internal = program.command('internal', { hidden: true }).description('internal hooks used by edu update');
  internal
    .command('migrate-workspaces')
    .description('back up and migrate managed contracts in global and registered project brains; preserves memory')
    .option('--json', 'machine-readable output')
    .action(
      action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
        const { migrateWorkspaces } = await import('../../update/migrate.js');
        const results = await migrateWorkspaces(globalHome(ctx));
        if (results.some(r => r.status !== 'migrated')) ctx.setExitCode(1);
        if (g.json || opts.json) return printJson(ctx, results);
        if (!results.length) return ctx.out(M[g.lang].migrateNone);
        const lk = look(ctx);
        for (const r of results) {
          const level = r.status === 'migrated' ? 'ok' : r.status === 'failed' ? 'fail' : 'warn';
          ctx.out(statusLine(lk, level, `${r.name}  ${r.status}${r.detail ? ` · ${r.detail}` : ''}  ${r.root}`));
        }
      }),
    );
}
