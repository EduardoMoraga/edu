/** edu_capabilities: the running version and features as bounded JSON; it takes no caller version. */
import { boundedCapabilities } from '../capabilities.js';
import type { ToolContext } from './context.js';
import { optionalInt } from './schema.js';

export function registerCapabilityTools(ctx: ToolContext): void {
  const { version, profile } = ctx;
  ctx.register('edu_capabilities', 'Running Edu version and features as bounded JSON (takes no caller version)', {
    maxTokens: optionalInt(1, undefined, 'Hard budget (default 800); tiny ones may yield {} or 0 (budget too small, not no capabilities)'),
  }, async ({ maxTokens }) => boundedCapabilities(ctx.opts.capabilities ? await ctx.opts.capabilities() : [
    `Edu ${version} (MCP, ${profile} profile). Persistent notes, recall, sessions and feedback are available${profile === 'full' ? ', plus crew dispatch' : '; crew/orchestration tools are omitted'}.`,
    'Memory is stored notes, not model training; Edu does not guarantee better answers or lower cost.',
    'Feedback from edu_feedback is advisory and is never treated as externally verified.',
  ].join('\n'), version, profile, maxTokens ?? 800));
}
