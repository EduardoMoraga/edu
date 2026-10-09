/**
 * Edu shared contracts.
 *
 * Every module (brain, context, engine, orchestrator, mcp, adapters, tui, cli)
 * depends on these types and on nothing else from its siblings unless the
 * dependency is listed in docs/ARCHITECTURE.md. Changing a type here is a
 * cross-team decision owned by the lead.
 */

// ─── Second brain ────────────────────────────────────────────────────────────

/** The three memory layers plus the generated index. */
export type Tier = 'canonical' | 'episodic' | 'transitive';

/** Folder names on disk, Obsidian-friendly and sortable. */
export const TIER_DIRS: Record<Tier, string> = {
  canonical: '1-canonical',
  episodic: '2-episodic',
  transitive: '3-transitive',
};
export const INDEX_DIR = '0-index';

/**
 * Transitive items carry what moves forward between sessions.
 * Filename prefix: D- decision, H- hypothesis, C- commitment, L- lesson.
 */
export type TransitiveKind = 'decision' | 'hypothesis' | 'commitment' | 'lesson';
export const TRANSITIVE_PREFIX: Record<TransitiveKind, string> = {
  decision: 'D-',
  hypothesis: 'H-',
  commitment: 'C-',
  lesson: 'L-',
};

/** Canonical notes are grouped by domain folder. */
export type CanonicalKind = 'identity' | 'standard' | 'lexicon' | 'domain' | 'person' | 'preference';

/**
 * Claim band: how strongly a note may be asserted.
 * verified = backed by structured evidence; inferred = reasoned from evidence;
 * hypothesis = proposed, unproven. Edu never states a hypothesis as fact.
 */
export type ClaimBand = 'verified' | 'inferred' | 'hypothesis';

export type TransitiveStatus =
  // decision
  | 'active' | 'reverted'
  // hypothesis
  | 'open' | 'confirmed' | 'refuted' | 'no-evidence'
  // commitment
  | 'pending' | 'delivered' | 'overdue'
  // lesson
  | 'candidate' | 'proven' | 'retired';

/** Canonical writes need explicit human confirmation: proposed → accepted. */
export type CanonicalStatus = 'proposed' | 'accepted' | 'superseded';

/** Learning signal kept on lessons and canonical notes to drive self-improvement. */
export interface UsageStats {
  /** Times the note was injected into context or recalled. */
  uses: number;
  /** Times feedback said it helped. */
  wins: number;
  /** Times feedback said it misled or was irrelevant. */
  losses: number;
  /** ISO timestamp of last recall. */
  lastUsed?: string;
}

export interface NoteMeta {
  id: string;            // stable slug, unique within the brain (e.g. "L-prefer-small-prs")
  tier: Tier;
  title: string;
  kind?: TransitiveKind | CanonicalKind | 'session';
  status?: TransitiveStatus | CanonicalStatus | 'open-session' | 'closed';
  band?: ClaimBand;
  tags: string[];
  links: string[];       // ids referenced as [[wikilinks]]
  created: string;       // ISO
  updated?: string;      // ISO
  source?: string;       // who/what wrote it: "user", "edu:reflect", "claude", "import:albert"…
  owner?: string;        // commitments
  due?: string;          // commitments, ISO date
  supersedes?: string;   // decision reverting another, canonical replacing another
  usage?: UsageStats;
}

export interface Note {
  meta: NoteMeta;
  body: string;          // markdown without frontmatter
  path: string;          // absolute path on disk
}

export interface RecallHit {
  note: Note;
  score: number;         // final rank score (relevance × learned weight)
  why: string;           // one line: matched terms / learned weight, for transparency
}

/** Where a brain lives. Project brains overlay the global brain. */
export interface BrainLocation {
  scope: 'global' | 'project';
  root: string;          // directory containing EDU.md and brain/
}

// ─── Context budget ──────────────────────────────────────────────────────────

export interface ContextRequest {
  query?: string;
  role?: string;
  /** Token budget for the whole pack. */
  budgetTokens: number;
}

export interface ContextSection {
  title: string;
  tokens: number;
  noteIds: string[];
  text: string;
}

export interface ContextPack {
  text: string;
  tokens: number;
  budgetTokens: number;
  sections: ContextSection[];
  /** Notes that matched but did not fit; reachable later via edu_recall/edu_read. */
  deferred: string[];
}

// ─── Evidence ────────────────────────────────────────────────────────────────

export type FailureType = 'context' | 'tool' | 'feedback' | 'verify' | 'recovery' | 'entropy' | 'model' | 'unknown';
export type OutcomeLabel = 'autonomous_verified_success' | 'assisted_verified_success' | 'unverified_success' | 'failed' | 'unsafe_invalid';
export type HarnessLevel = 'H0' | 'H1' | 'H2' | 'H3';

export interface Requirement { id: string; text: string }
export interface DeterministicCheck {
  id: string;
  requirementIds: string[];
  command: string;
  expect: { exitCode?: number; stdoutIncludes?: string };
  timeoutMs: number;
}

// ─── Engines (the CLIs Edu drives) ───────────────────────────────────────────

export type CliId = 'claude' | 'codex' | 'pi' | 'opencode' | 'agy';

export type Autonomy = 'readonly' | 'ask' | 'auto' | 'full';

export type CrewJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type CrewJobMode = 'headless' | 'pane';

/** A durable unit of work dispatched to one external coding CLI. */
export interface CrewJob {
  id: string;
  cli: CliId;
  task: string;
  mode: CrewJobMode;
  cwd: string;
  autonomy: Autonomy;
  status: CrewJobStatus;
  pid?: number;
  paneId?: string;
  agentName?: string;
  createdAt: string;
  endedAt?: string;
  summary: string;
  usage: Usage;
  note?: string;
  /** Prompt not yet delivered because the agent is waiting on a human answer (trust, login…) in its pane. */
  pendingPrompt?: string;
  /** Set once the pane agent was seen working, so a later idle means the turn finished. */
  observedWorking?: boolean;
  /** herdr `state_change_seq` right after the prompt was delivered; a later idle with a higher seq means done. */
  promptSeq?: number;
  /** Hash of the pane text right after the prompt; changed text plus idle means the agent answered. */
  promptPaneHash?: string;
  promptedAt?: string;
}

export interface EngineRunRequest {
  cli: CliId;
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  model?: string;
  autonomy: Autonomy;
  resumeSessionId?: string;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** USD, when the engine reports it; undefined when unknown (never guessed). */
  costUsd?: number;
}

/**
 * Normalized event stream. Every engine adapter maps its native JSONL into
 * these events; the orchestrator adds agent.* events; the TUI renders them;
 * runs are persisted as JSONL of EduEvent for replay.
 */
export type EduEvent =
  | { type: 'run.start'; runId: string; goal: string; mode: OrchestrationMode; at: string }
  | { type: 'run.end'; runId: string; ok: boolean; summary: string; at: string }
  | { type: 'agent.spawn'; agentId: string; parentId?: string; role: RoleId; cli: CliId; model?: string; task: string; at: string }
  | { type: 'agent.status'; agentId: string; status: AgentStatus; at: string }
  | { type: 'agent.text'; agentId: string; text: string; at: string }
  | { type: 'agent.thinking'; agentId: string; text: string; at: string }
  | { type: 'tool.call'; agentId: string; callId: string; tool: string; input: string; at: string }
  | { type: 'tool.result'; agentId: string; callId: string; ok: boolean; output: string; at: string }
  /** Usage is a DELTA for this turn/step; consumers sum per agent and per run. */
  | { type: 'usage'; agentId: string; usage: Usage; at: string }
  /** Context-window occupancy snapshot (not a delta), when the engine or Edu can measure it. */
  | { type: 'context.usage'; agentId?: string; usedTokens: number; windowTokens: number; at: string }
  | { type: 'approval.request'; agentId: string; approvalId: string; title: string; detail: string; at: string }
  | { type: 'approval.resolve'; approvalId: string; approved: boolean; by: 'user' | 'policy'; at: string }
  | { type: 'brain.recall'; agentId?: string; noteIds: string[]; at: string }
  | { type: 'brain.learn'; noteId: string; kind: TransitiveKind | 'canonical-proposal' | 'episode'; title: string; at: string }
  | { type: 'agent.end'; agentId: string; ok: boolean; summary: string; sessionId?: string; at: string }
  | { type: 'error'; agentId?: string; message: string; at: string }
  | { type: 'task.define'; requirements: Requirement[]; successCriteria?: string[]; at: string }
  | { type: 'context.trace'; noteId: string; contribution: string; influenced: boolean; at: string }
  | { type: 'verify.result'; checkId?: string; method?: string; requirementIds: string[]; ok: boolean; output: string; exitCode?: number | null; durationMs?: number; timedOut?: boolean; kind: 'reproduction' | 'deterministic' | 'targeted-test' | 'regression' | 'lint' | 'review'; at: string }
  | { type: 'failure.attribution'; observed: string; expected: string; failureType: FailureType; evidence: string[]; alternatives: string[]; next: string; at: string }
  | { type: 'intervention'; by: 'user'; action: string; detail?: string; avoidable: boolean; harnessGap: FailureType; at: string }
  | { type: 'entropy.finding'; category: string; severity: 0 | 1 | 2 | 3; path: string; detail: string; at: string }
  | { type: 'outcome'; label: OutcomeLabel; metrics: Record<string, unknown>; at: string };

export type AgentStatus = 'queued' | 'running' | 'awaiting-approval' | 'done' | 'failed' | 'cancelled';

export interface Engine {
  readonly cli: CliId;
  /** True when the CLI binary is installed and runnable. */
  available(): Promise<boolean>;
  /** Streams normalized events for one headless run. `agentId` is stamped on every event. */
  run(req: EngineRunRequest, agentId: string): AsyncIterable<EduEvent>;
}

// ─── Orchestration ───────────────────────────────────────────────────────────

/** Built-in roles. Users can add more under agents/. */
export type RoleId = 'lead' | 'explorer' | 'builder' | 'reviewer' | (string & {});

/**
 * solo  = one CLI plays every role (each role is still its own session, so
 *         explorers/reviewers can run in parallel even with a single LLM).
 * crew  = roles mapped to different CLIs; reviewers prefer a different vendor
 *         than the builder they review.
 */
export type OrchestrationMode = 'solo' | 'crew';

export interface RoleSpec {
  id: RoleId;
  title: string;
  icon: string;          // single glyph used by the TUI
  mission: string;
  autonomy: Autonomy;
  cli?: CliId;           // crew mode mapping
  model?: string;
}

export type ApprovalPolicy = 'always-ask' | 'ask-on-write' | 'auto';

export interface EduConfig {
  version: 1;
  mode: OrchestrationMode;
  defaultCli: CliId;
  roles: RoleSpec[];
  approvals: ApprovalPolicy;
  context: { budgetTokens: number };
  brain: { obsidianVault?: string };
  lang: 'en' | 'es';
}

// ─── CLI integration (installer) ─────────────────────────────────────────────

export type InstallScope = 'project' | 'global';

/** One file operation the installer performs; recorded in the manifest for uninstall. */
export interface InstallAction {
  cli: CliId;
  kind: 'managed-block' | 'file' | 'json-merge' | 'toml-merge' | 'symlink';
  path: string;
  description: string;
  /** Content hash after write, to detect user edits before uninstall. */
  sha256?: string;
  /** Previous content backup path for non-block writes. */
  backup?: string;
}

export interface InstallManifest {
  version: 1;
  eduVersion: string;
  installedAt: string;
  scope: InstallScope;
  actions: InstallAction[];
}

export interface CliIntegration {
  readonly cli: CliId;
  detect(): Promise<boolean>;
  /** Pure planning step: what would change. Used by --dry-run and tests. */
  plan(scope: InstallScope, root: string): Promise<InstallAction[]>;
  apply(actions: InstallAction[]): Promise<InstallAction[]>;
}
