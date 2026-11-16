/**
 * MCP tool annotations. Hosts (Codex, Claude…) use them to decide what can run without asking:
 * reads never prompt, brain writes are local and non-destructive, crew tools start other agents.
 * A crew worker (EDU_CREW_JOB) may call only the tools marked read-only here.
 */
export type ToolAnnotations = { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean };

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const BRAIN_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const STARTS_AGENTS = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;
const SWITCHES_WORKSPACE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  edu_brief: READ, edu_recall: READ, edu_read: READ, edu_capabilities: READ, edu_commitments: READ, edu_crew_status: READ, edu_crew_result: READ, edu_crew_artifact: READ,
  edu_projects: READ,
  // Switching writes nothing, but it replaces the brain this session writes to and the folder crew tools may
  // work in (a non-additive change of the session's environment), so hosts should ask first.
  edu_project_use: SWITCHES_WORKSPACE,
  edu_remember: BRAIN_WRITE, edu_feedback: BRAIN_WRITE, edu_propose_canonical: BRAIN_WRITE,
  edu_session_open: BRAIN_WRITE, edu_session_close: BRAIN_WRITE,
  edu_crew_dispatch: STARTS_AGENTS, edu_crew_review: STARTS_AGENTS,
  edu_orchestrate: STARTS_AGENTS, edu_crew_approve: STARTS_AGENTS,
};
