/** `edu brain status|recall|read|remember|share|maintain|tidy|lint|import|link|proposals|approve`. */
import type { Command } from 'commander';
import type { CliContext } from '../context.js';
import { registerBrainInspect } from './brain/inspect.js';
import { registerBrainNotes } from './brain/notes.js';
import { registerBrainReview } from './brain/review.js';
import { registerBrainSources } from './brain/sources.js';
import { registerBrainUpkeep } from './brain/upkeep.js';

export { lintTable } from './brain/upkeep.js';

export function registerBrain(program: Command, ctx: CliContext): void {
  const brain = program.command('brain').description('inspect and grow the second brain');
  // Registration order is the order `edu brain --help` lists the subcommands in.
  registerBrainInspect(brain, ctx); // status, recall, read
  registerBrainNotes(brain, ctx); // remember, share
  registerBrainUpkeep(brain, ctx); // maintain, tidy, lint
  registerBrainSources(brain, ctx); // import, link
  registerBrainReview(brain, ctx); // proposals, approve
}
