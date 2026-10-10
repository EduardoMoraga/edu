import { Command } from 'commander';

/**
 * Edu shared contracts.
 *
 * Every module (brain, context, engine, orchestrator, mcp, adapters, tui, cli)
 * depends on these types and on nothing else from its siblings unless the
 * dependency is listed in docs/ARCHITECTURE.md. Changing a type here is a
 * cross-team decision owned by the lead.
 */
/** The three memory layers plus the generated index. */
type Tier = 'canonical' | 'episodic' | 'transitive';
/** Folder names on disk, Obsidian-friendly and sortable. */
declare const TIER_DIRS: Record<Tier, string>;
declare const INDEX_DIR = "0-index";
/**
 * Transitive items carry what moves forward between sessions.
 * Filename prefix: D- decision, H- hypothesis, C- commitment, L- lesson.
 */
type TransitiveKind = 'decision' | 'hypothesis' | 'commitment' | 'lesson';
declare const TRANSITIVE_PREFIX: Record<TransitiveKind, string>;
/** Canonical notes are grouped by domain folder. */
type CanonicalKind = 'identity' | 'standard' | 'lexicon' | 'domain' | 'person' | 'preference';
/**
 * Claim band: how strongly a note may be asserted.
 * verified = backed by structured evidence; inferred = reasoned from evidence;
 * hypothesis = proposed, unproven. Edu never states a hypothesis as fact.
 */
type ClaimBand = 'verified' | 'inferred' | 'hypothesis';
type TransitiveStatus = 'active' | 'reverted' | 'open' | 'confirmed' | 'refuted' | 'no-evidence' | 'pending' | 'delivered' | 'overdue' | 'candidate' | 'proven' | 'retired';
/** Canonical writes need explicit human confirmation: proposed → accepted. */
type CanonicalStatus = 'proposed' | 'accepted' | 'superseded';
/** Learning signal kept on lessons and canonical notes to drive self-improvement. */
interface UsageStats {
    /** Times the note was injected into context or recalled. */
    uses: number;
    /** Times feedback said it helped. */
    wins: number;
    /** Times feedback said it misled or was irrelevant. */
    losses: number;
    /** ISO timestamp of last recall. */
    lastUsed?: string;
}
interface NoteMeta {
    id: string;
    tier: Tier;
    title: string;
    kind?: TransitiveKind | CanonicalKind | 'session';
    status?: TransitiveStatus | CanonicalStatus | 'open-session' | 'closed';
    band?: ClaimBand;
    tags: string[];
    links: string[];
    created: string;
    updated?: string;
    source?: string;
    owner?: string;
    due?: string;
    supersedes?: string;
    usage?: UsageStats;
}
interface Note {
    meta: NoteMeta;
    body: string;
    path: string;
}
interface RecallHit {
    note: Note;
    score: number;
    why: string;
}
/** Where a brain lives. Project brains overlay the global brain. */
interface BrainLocation {
    scope: 'global' | 'project';
    root: string;
}
interface ContextRequest {
    query?: string;
    role?: string;
    /** Token budget for the whole pack. */
    budgetTokens: number;
}
interface ContextSection {
    title: string;
    tokens: number;
    noteIds: string[];
    text: string;
}
interface ContextPack {
    text: string;
    tokens: number;
    budgetTokens: number;
    sections: ContextSection[];
    /** Notes that matched but did not fit; reachable later via edu_recall/edu_read. */
    deferred: string[];
}
type FailureType = 'context' | 'tool' | 'feedback' | 'verify' | 'recovery' | 'entropy' | 'model' | 'unknown';
type OutcomeLabel = 'autonomous_verified_success' | 'assisted_verified_success' | 'unverified_success' | 'failed' | 'unsafe_invalid';
type HarnessLevel = 'H0' | 'H1' | 'H2' | 'H3';
interface Requirement {
    id: string;
    text: string;
}
interface DeterministicCheck {
    id: string;
    requirementIds: string[];
    command: string;
    expect: {
        exitCode?: number;
        stdoutIncludes?: string;
    };
    timeoutMs: number;
}
type CliId = 'claude' | 'codex' | 'pi' | 'opencode' | 'agy';
type Autonomy = 'readonly' | 'ask' | 'auto' | 'full';
type CrewJobStatus = 'queued' | 'running' | 'awaiting-approval' | 'done' | 'failed' | 'cancelled';
type CrewJobMode = 'headless' | 'pane';
/** A durable unit of work dispatched to one external coding CLI. */
interface CrewJob {
    id: string;
    cli: CliId;
    task: string;
    mode: CrewJobMode;
    cwd: string;
    autonomy: Autonomy;
    kind?: 'task' | 'orchestration';
    goal?: string;
    playbook?: string;
    orchestrationMode?: OrchestrationMode;
    harnessLevel?: HarnessLevel;
    autoApprove?: boolean;
    outcome?: OutcomeLabel;
    specPath?: string;
    verificationSummary?: string;
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
interface EngineRunRequest {
    cli: CliId;
    prompt: string;
    cwd: string;
    systemPrompt?: string;
    model?: string;
    autonomy: Autonomy;
    resumeSessionId?: string;
    signal?: AbortSignal;
}
interface Usage {
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
type EduEvent = {
    type: 'run.start';
    runId: string;
    goal: string;
    mode: OrchestrationMode;
    at: string;
} | {
    type: 'run.end';
    runId: string;
    ok: boolean;
    summary: string;
    at: string;
} | {
    type: 'agent.spawn';
    agentId: string;
    parentId?: string;
    role: RoleId;
    cli: CliId;
    model?: string;
    task: string;
    at: string;
} | {
    type: 'agent.status';
    agentId: string;
    status: AgentStatus;
    at: string;
} | {
    type: 'agent.text';
    agentId: string;
    text: string;
    at: string;
} | {
    type: 'agent.thinking';
    agentId: string;
    text: string;
    at: string;
} | {
    type: 'tool.call';
    agentId: string;
    callId: string;
    tool: string;
    input: string;
    at: string;
} | {
    type: 'tool.result';
    agentId: string;
    callId: string;
    ok: boolean;
    output: string;
    at: string;
}
/** Usage is a DELTA for this turn/step; consumers sum per agent and per run. */
 | {
    type: 'usage';
    agentId: string;
    usage: Usage;
    at: string;
}
/** Context-window occupancy snapshot (not a delta), when the engine or Edu can measure it. */
 | {
    type: 'context.usage';
    agentId?: string;
    usedTokens: number;
    windowTokens: number;
    at: string;
} | {
    type: 'approval.request';
    agentId: string;
    approvalId: string;
    title: string;
    detail: string;
    at: string;
} | {
    type: 'approval.resolve';
    approvalId: string;
    approved: boolean;
    by: 'user' | 'policy';
    at: string;
} | {
    type: 'brain.recall';
    agentId?: string;
    noteIds: string[];
    at: string;
} | {
    type: 'brain.learn';
    noteId: string;
    kind: TransitiveKind | 'canonical-proposal' | 'episode';
    title: string;
    at: string;
} | {
    type: 'agent.end';
    agentId: string;
    ok: boolean;
    summary: string;
    sessionId?: string;
    at: string;
} | {
    type: 'error';
    agentId?: string;
    message: string;
    at: string;
} | {
    type: 'task.define';
    requirements: Requirement[];
    successCriteria?: string[];
    at: string;
} | {
    type: 'spec.ready';
    path: string;
    requirements: Requirement[];
    checks: DeterministicCheck[];
    steps: Array<{
        id: string;
        role: string;
        cli: CliId;
        task: string;
    }>;
    at: string;
} | {
    type: 'context.trace';
    noteId: string;
    contribution: string;
    influenced: boolean;
    at: string;
} | {
    type: 'verify.result';
    checkId?: string;
    method?: string;
    requirementIds: string[];
    ok: boolean;
    output: string;
    exitCode?: number | null;
    durationMs?: number;
    timedOut?: boolean;
    kind: 'reproduction' | 'deterministic' | 'targeted-test' | 'regression' | 'lint' | 'review';
    at: string;
} | {
    type: 'failure.attribution';
    observed: string;
    expected: string;
    failureType: FailureType;
    evidence: string[];
    alternatives: string[];
    next: string;
    at: string;
} | {
    type: 'intervention';
    by: 'user';
    action: string;
    detail?: string;
    avoidable: boolean;
    harnessGap: FailureType;
    at: string;
} | {
    type: 'entropy.finding';
    category: string;
    severity: 0 | 1 | 2 | 3;
    path: string;
    detail: string;
    at: string;
} | {
    type: 'outcome';
    label: OutcomeLabel;
    metrics: Record<string, unknown>;
    at: string;
};
type AgentStatus = 'queued' | 'running' | 'awaiting-approval' | 'done' | 'failed' | 'cancelled';
interface Engine {
    readonly cli: CliId;
    /** True when the CLI binary is installed and runnable. */
    available(): Promise<boolean>;
    /** Streams normalized events for one headless run. `agentId` is stamped on every event. */
    run(req: EngineRunRequest, agentId: string): AsyncIterable<EduEvent>;
}
/** Built-in roles. Users can add more under agents/. */
type RoleId = 'lead' | 'explorer' | 'builder' | 'reviewer' | (string & {});
/**
 * solo  = one CLI plays every role (each role is still its own session, so
 *         explorers/reviewers can run in parallel even with a single LLM).
 * crew  = roles mapped to different CLIs; reviewers prefer a different vendor
 *         than the builder they review.
 */
type OrchestrationMode = 'solo' | 'crew';
interface RoleSpec {
    id: RoleId;
    title: string;
    icon: string;
    mission: string;
    autonomy: Autonomy;
    cli?: CliId;
    model?: string;
}
type ApprovalPolicy = 'always-ask' | 'ask-on-write' | 'auto';
interface EduConfig {
    version: 1;
    mode: OrchestrationMode;
    defaultCli: CliId;
    playbook?: string;
    roles: RoleSpec[];
    approvals: ApprovalPolicy;
    context: {
        budgetTokens: number;
    };
    brain: {
        obsidianVault?: string;
    };
    lang: 'en' | 'es';
}
type InstallScope = 'project' | 'global';
/** One file operation the installer performs; recorded in the manifest for uninstall. */
interface InstallAction {
    cli: CliId;
    kind: 'managed-block' | 'file' | 'json-merge' | 'toml-merge' | 'symlink';
    path: string;
    description: string;
    /** Content hash after write, to detect user edits before uninstall. */
    sha256?: string;
    /** Previous content backup path for non-block writes. */
    backup?: string;
}
interface InstallManifest {
    version: 1;
    eduVersion: string;
    installedAt: string;
    scope: InstallScope;
    actions: InstallAction[];
}
interface CliIntegration {
    readonly cli: CliId;
    detect(): Promise<boolean>;
    /** Pure planning step: what would change. Used by --dry-run and tests. */
    plan(scope: InstallScope, root: string): Promise<InstallAction[]>;
    apply(actions: InstallAction[]): Promise<InstallAction[]>;
}

interface CliContext {
    /** Working directory before `--cwd` is applied. */
    cwd: string;
    env: NodeJS.ProcessEnv;
    /** Home directory used for global installs (`HOME`, then os.homedir()). */
    home: string;
    out(text: string): void;
    err(text: string): void;
    /** Reads all of stdin; resolves '' when stdin is a TTY or nothing arrives within `timeoutMs`. */
    readStdin(timeoutMs?: number): Promise<string>;
    /** Whether stdout is an interactive terminal (enables the TUI). */
    isTTY: boolean;
    /** Whether stdin is an interactive terminal (enables prompts). */
    stdinIsTTY: boolean;
    /** Asks a yes/no question on the terminal. */
    confirm(question: string): Promise<boolean>;
    /** Installed coding CLIs, in preference order. */
    detectClis(): Promise<CliId[]>;
    /** Optional engine factory for embedding and deterministic CLI tests. */
    engineFactory?: (cli: CliId) => Engine;
    /** Optional detected CLI list for an injected engine factory. */
    availableClis?: CliId[];
    /** Sets the process exit code without exiting. */
    setExitCode(code: number): void;
}

/**
 * The `edu` command tree. `createProgram()` is pure wiring: pass a partial
 * CliContext to drive it from tests (with `exitOverride()`), or nothing to
 * use the real process.
 */

interface ProgramOptions {
    /** Throw CommanderError instead of exiting the process (tests, embedding). */
    exitOverride?: boolean;
}
declare function createProgram(overrides?: Partial<CliContext>, options?: ProgramOptions): Command;

export { type AgentStatus, type ApprovalPolicy, type Autonomy, type BrainLocation, type CanonicalKind, type CanonicalStatus, type ClaimBand, type CliContext, type CliId, type CliIntegration, type ContextPack, type ContextRequest, type ContextSection, type CrewJob, type CrewJobMode, type CrewJobStatus, type DeterministicCheck, type EduConfig, type EduEvent, type Engine, type EngineRunRequest, type FailureType, type HarnessLevel, INDEX_DIR, type InstallAction, type InstallManifest, type InstallScope, type Note, type NoteMeta, type OrchestrationMode, type OutcomeLabel, type ProgramOptions, type RecallHit, type Requirement, type RoleId, type RoleSpec, TIER_DIRS, TRANSITIVE_PREFIX, type Tier, type TransitiveKind, type TransitiveStatus, type Usage, type UsageStats, createProgram };
