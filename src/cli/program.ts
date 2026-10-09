/**
 * The `edu` command tree. `createProgram()` is pure wiring: pass a partial
 * CliContext to drive it from tests (with `exitOverride()`), or nothing to
 * use the real process.
 */
import { Command } from 'commander';
import { detectTheme, getGlyphs, renderBanner } from '../identity/index.js';
import { registerBrain } from './commands/brain.js';
import { registerDoctor } from './commands/doctor.js';
import { registerEvidence } from './commands/evidence.js';
import { registerIntegrations } from './commands/integrations.js';
import { registerLearn } from './commands/learn.js';
import { openHome, registerLive } from './commands/live.js';
import { registerSetup } from './commands/setup.js';
import { processContext, resolveGlobals, type CliContext } from './context.js';
import { t } from './i18n.js';
import { packageVersion } from './package.js';

const GROUPS: Array<[string, string[]]> = [
  ['Get started:', ['init', 'install', 'uninstall', 'doctor']],
  ['Work:', ['run', 'ui', 'demo']],
  ['Brain:', ['brain', 'context', 'reflect', 'proposals', 'metrics', 'checks']],
  ['Integrations:', ['mcp', 'statusline', 'hook']],
];

export interface ProgramOptions {
  /** Throw CommanderError instead of exiting the process (tests, embedding). */
  exitOverride?: boolean;
}

export function createProgram(overrides: Partial<CliContext> = {}, options: ProgramOptions = {}): Command {
  const ctx: CliContext = { ...processContext(), ...overrides };
  const program = new Command('edu');
  // Must be set before subcommands are created so they inherit it.
  if (options.exitOverride) program.exitOverride();
  program
    .description('an installable, LLM-agnostic agentic harness: a second brain that learns, a crew you can see')
    .version(packageVersion(), '-v, --version', 'print the version')
    .helpOption('-h, --help', 'show help')
    .option('--cwd <dir>', 'run as if started in <dir>')
    .option('--lang <lang>', 'message language: en | es')
    .configureOutput({ writeOut: (s) => ctx.out(s.replace(/\n$/, '')), writeErr: (s) => ctx.err(s.replace(/\n$/, '')) })
    .showSuggestionAfterError(true);

  program.addHelpText('before', () => {
    const glyphs = getGlyphs(ctx.env);
    return `${renderBanner({ unicode: glyphs.unicode, theme: detectTheme(ctx.env, ctx.isTTY), version: packageVersion() })}\n`;
  });

  program.action(async (_opts: unknown, cmd: Command) => {
    if (cmd.args.length) {
      (cmd as unknown as { unknownCommand(): never }).unknownCommand();
    }
    const g = resolveGlobals(ctx, cmd.optsWithGlobals());
    if (!ctx.isTTY) {
      program.outputHelp();
      return;
    }
    try {
      await openHome(ctx, g);
    } catch (error) {
      ctx.err(t(g.lang, 'error.prefix', { message: error instanceof Error ? error.message : String(error) }));
      ctx.setExitCode(1);
    }
  });

  registerSetup(program, ctx);
  registerLive(program, ctx);
  registerBrain(program, ctx);
  registerLearn(program, ctx);
  registerDoctor(program, ctx);
  registerEvidence(program, ctx);
  registerIntegrations(program, ctx);

  for (const [heading, names] of GROUPS) {
    for (const name of names) program.commands.find((c) => c.name() === name)?.helpGroup(heading);
  }
  // The root has an action (home/help), so commander would report a typo as
  // "too many arguments"; the action routes it to the unknown-command error.
  // Set last: subcommands inherit this setting when created.
  program.allowExcessArguments(true);
  return program;
}
