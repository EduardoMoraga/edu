/**
 * Multi-agent workflow tools: start a detached orchestration, decide its approval gates, and have a different CLI
 * review the work.
 */
import { z } from 'zod';
import { isTerminalCrewJobStatus } from '../../crew/index.js';
import { detectCallerCli } from '../caller.js';
import type { ToolContext } from './context.js';
import { cliIds, tokenLimit } from './schema.js';

export function registerOrchestrationTools(ctx: ToolContext): void {
  const { register, env } = ctx;

  register('edu_orchestrate', 'Start a detached orchestration (visible spec and crew job)', {
    goal: z.string().min(1), playbook: z.string().optional(), mode: z.enum(['solo', 'crew']).optional(), maxTokens: tokenLimit,
  }, async ({ goal, playbook, mode }) => {
    // No auto-approval from MCP: every gate waits for a decision naming its requestId.
    const job = await ctx.crew.orchestrate({ goal, playbook, mode });
    const deadline = Date.now() + 60_000;
    let current = job;
    while (!current.specPath && !isTerminalCrewJobStatus(current.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      current = await ctx.crew.status(job.id) as typeof job;
    }
    return JSON.stringify({ jobId: job.id, status: current.status, specPath: current.specPath, ...(current.approval ? { requestId: current.approval.requestId } : {}), outcome: current.outcome, verificationSummary: current.verificationSummary });
  });

  register('edu_crew_approve', 'Approve or reject the approval gate a crew job is waiting on (recorded as the host LLM\'s decision)', {
    jobId: z.string().min(1), requestId: z.string().min(1).describe('The requestId of the open gate (edu_orchestrate or edu_crew_status)'), approve: z.boolean(), maxTokens: tokenLimit,
  }, async ({ jobId, requestId, approve }) => JSON.stringify(await ctx.crew.approve(jobId, approve, { by: 'host-llm', requestId, env })));

  register('edu_crew_review', 'Read-only review by a different available CLI', {
    cli: cliIds.optional(), base: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ cli, base }) => JSON.stringify(await ctx.crew.review({ cli, base, callerCli: detectCallerCli(process.env, ctx.server.server.getClientVersion()?.name) })));
}
