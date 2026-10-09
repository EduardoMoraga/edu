import type { Brain } from '../brain/index.js';
import { buildBriefContext, type ContextOptions } from './pack.js';

/** Session-start digest with identity, current work, lessons, episodes, and a recall pointer. */
export async function brief(brain: Brain, budgetTokens = 1500, opts: ContextOptions = {}): Promise<string> {
  return (await buildBriefContext(brain, budgetTokens, { ...opts, trackUsage: opts.trackUsage ?? true })).text;
}
