/** `edu connect hermes`: let Hermes (Telegram, Slack…) use Edu's MCP tools, reversibly. */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Command } from 'commander';
import {
  applyHermesPlan, commandExistsOn, hermesConfigPath, hermesEntry, HERMES_SERVER, listHermesBackups, planHermesConnect, undoHermes,
} from '../../connect/hermes.js';
import { eduServiceMcpLaunch, spawnCli, whichSync } from '../../platform/index.js';
import { globalHome, type CliContext } from '../context.js';
import { action } from '../kit.js';

export type HermesRunner = (bin: string, args: string[], env: NodeJS.ProcessEnv) => Promise<{ ok: boolean; output: string }>;
/**
 * Runs Hermes without a shell on every platform: `spawnCli` resolves `hermes.exe`, and unwraps or
 * escapes a `hermes.cmd` shim (Node's execFile refuses .cmd/.bat files on Windows).
 */
const defaultRunner: HermesRunner = (bin, args, env) => new Promise((resolve) => {
  let output = '';
  const child = spawnCli(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const collect = (chunk: Buffer) => { if (output.length < 4 * 1024 * 1024) output += chunk.toString('utf8'); };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const timer = setTimeout(() => child.kill(), 120_000);
  child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, output: output || error.message }); });
  child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: output || (code === 0 ? '' : `hermes exited with ${code ?? 'a signal'}`) }); });
});

interface Options { project?: string; undo?: string | boolean; config?: string; removeDead?: boolean; restart?: boolean; test?: boolean; dryRun?: boolean; force?: boolean; list?: boolean }

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
// Hermes prints ANSI colors and one line per tool; keep its verdict lines, else a short tail.
const tail = (text: string, lines = 8) => {
  const all = text.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').map(line => line.trim()).filter(Boolean);
  const verdict = all.filter(line => /Transport:|Connected|Tools discovered|failed|not found|error/i.test(line));
  return (verdict.length ? verdict : all.slice(-lines)).map(line => `    ${line}`).join('\n');
};

export function registerConnect(program: Command, ctx: CliContext, deps: { runner?: HermesRunner } = {}): void {
  const runner = deps.runner ?? defaultRunner;
  const connect = program.command('connect').description('connect Edu to an agent gateway (hermes)');
  connect.command('hermes')
    .description('add Edu as an MCP server in Hermes so Telegram and other Hermes chats can use it')
    .option('--project <name|path>', 'pin a workspace (registry name, agent name, path, or "global")')
    .option('--config <path>', 'Hermes config.yaml (default: $HERMES_HOME/config.yaml or ~/.hermes/config.yaml)')
    .option('--remove-dead', 'also remove MCP servers whose command no longer exists')
    .option('--no-test', 'skip `hermes mcp test edu`')
    .option('--restart', 'run `hermes gateway restart` afterwards (kills running Hermes agents)')
    .option('--dry-run', 'show the planned edits without writing')
    .option('--undo [id]', 'restore the Hermes config saved by the latest (or named) connect')
    .option('--list', 'list active connect backups')
    .option('--force', 'with --undo: restore even if the config changed since')
    .action(action<Options>(ctx, async ({ g, opts }) => {
      const es = g.lang === 'es';
      const eduHome = globalHome(ctx);
      const path = hermesConfigPath(ctx.env, ctx.home, opts.config);
      const env = { ...ctx.env, HERMES_HOME: dirname(path) };
      const hermes = whichSync('hermes', ctx.env);
      const reloadHint = es
        ? 'Para que el gateway cargue el cambio: escribe /reload-mcp en Telegram, o reinicia con `hermes gateway restart` (o `edu connect hermes --restart`).'
        : 'To load the change in the gateway: send /reload-mcp in Telegram, or restart with `hermes gateway restart` (or `edu connect hermes --restart`).';

      if (opts.list) {
        const backups = await listHermesBackups(eduHome);
        ctx.out(backups.length ? backups.map(b => `${b.id}  ${b.path}  ${b.changes.join('; ')}`).join('\n') : es ? 'No hay respaldos activos.' : 'No active connect backups.');
        return;
      }
      if (opts.undo !== undefined) {
        const restored = await undoHermes(eduHome, { id: typeof opts.undo === 'string' ? opts.undo : undefined, path, force: opts.force });
        ctx.out(es ? `Restaurado ${restored.path} desde ${restored.id} (idéntico byte a byte).` : `Restored ${restored.path} from ${restored.id} (byte-for-byte).`);
        ctx.out(reloadHint);
        return;
      }
      if (!existsSync(path)) throw new Error(es ? `No encontré la configuración de Hermes en ${path}. Instala Hermes o usa --config.` : `Hermes config not found at ${path}. Install Hermes or pass --config.`);
      if (opts.project) {
        const { selectWorkspace } = await import('../../mcp/projects.js');
        await selectWorkspace(opts.project, { ...ctx.env, HOME: ctx.env.HOME ?? ctx.home }, g.cwd); // fail early on a typo
      }

      const entry = hermesEntry(eduServiceMcpLaunch({ env: ctx.env }), opts.project);
      const before = await readFile(path, 'utf8');
      const plan = planHermesConnect(before, { entry, removeDead: opts.removeDead, commandExists: commandExistsOn(ctx.env, ctx.home) });
      ctx.out(`Hermes: ${path}`);
      ctx.out(`  mcp_servers.${HERMES_SERVER}: ${entry.command} ${entry.args.join(' ')}`);
      for (const change of plan.changes) ctx.out(`  + ${change}`);
      for (const dead of plan.dead) ctx.out(es ? `  ! ${dead.name}: ${dead.command} no existe (quítalo con --remove-dead)` : `  ! ${dead.name}: ${dead.command} does not exist (remove it with --remove-dead)`);
      for (const warning of plan.warnings) ctx.out(`  ! ${warning}`);
      if (!plan.changes.length) ctx.out(es ? 'Ya estaba conectado: no se escribió nada.' : 'Already connected: nothing was written.');
      else if (opts.dryRun) { ctx.out(es ? 'Simulación: no se escribió nada.' : 'Dry run: nothing was written.'); return; }
      else {
        const manifest = await applyHermesPlan(eduHome, path, plan);
        ctx.out(es ? `Aplicado. Respaldo: ${manifest.id}. Revertir: edu connect hermes --undo` : `Applied. Backup: ${manifest.id}. Undo: edu connect hermes --undo`);
      }

      if (opts.test !== false) {
        if (!hermes) ctx.out(es ? '  hermes no está en el PATH: omití `hermes mcp test edu`.' : '  hermes is not on PATH: skipped `hermes mcp test edu`.');
        else {
          const hashBefore = sha256(await readFile(path));
          const result = await runner(hermes, ['mcp', 'test', HERMES_SERVER], env);
          const passed = result.ok && /Connected \(\d+ms\)/.test(result.output) && !/Connection failed|not found in config/i.test(result.output);
          ctx.out(`${passed ? '✓' : '✗'} hermes mcp test ${HERMES_SERVER}\n${tail(result.output)}`);
          if (sha256(await readFile(path)) !== hashBefore) ctx.out(es ? '  ! Hermes reescribió su configuración durante la prueba.' : '  ! Hermes rewrote its config during the test.');
          if (!passed) ctx.setExitCode(1);
        }
      }

      if (opts.restart) {
        if (!hermes) throw new Error(es ? 'hermes no está en el PATH; no pude reiniciar el gateway.' : 'hermes is not on PATH; cannot restart the gateway.');
        const result = await runner(hermes, ['gateway', 'restart'], env);
        ctx.out(`${result.ok ? '✓' : '✗'} hermes gateway restart\n${tail(result.output, 6)}`);
        if (!result.ok) ctx.setExitCode(1);
      } else if (plan.changes.length) ctx.out(reloadHint);
    }));
}
