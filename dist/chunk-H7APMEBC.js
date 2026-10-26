import {
  packageVersion
} from "./chunk-BXZ573JQ.js";

// src/release/capabilities.ts
function getCapabilities(version = packageVersion()) {
  return {
    version,
    features: [
      "Bounded sanitized Crew previews with paginated local MCP artifact retrieval",
      "Explicit builder/advisor/reviewer routing and run-local spawn, concurrency and time budgets",
      "Terminal-goal resume re-plans in the same workspace with fresh approvals",
      "Nonmutating optional-integration policy preflight without automatic package activation",
      "Worker MCP guards block durable memory writes and recursive Edu dispatch",
      "Persistent episodic, transitive and human-approved canonical memory",
      "Query-based recall and bounded context with actionable note passages",
      "Bounded local consolidation of queued structured intervention evidence without a model",
      "Event-deduplicated feedback with separate advisory and externally verified credit",
      "Bounded, repeatable model-assisted reflection (explicit)",
      "Backed-up global/project migration and checked pristine native plugin refresh",
      "Up to three inferred lessons in the host model session-close call",
      "Cached Pi briefs and host-owned workspace/session integrity",
      "Optional 12-tool memory-only MCP profile (full remains default)",
      "Evaluation separates verified outcomes, unknown costs and synthetic suites",
      "Invocation receipts preserve unknown or partial usage through cancellation and replay",
      "Shared-workspace reader concurrency requires actual enforced read-only adapter capabilities",
      "Declared skill bundles install helpers with integrity, ownership and in-process rollback",
      "Explicitly approved baseline/candidate experiments retain frozen-input and artifact evidence"
    ],
    limitations: [
      "3.0.0-rc.1 is a local candidate, not a production-ready release; dependency audit and full-suite status are in docs/edu-3.0-verification.md.",
      "Crew redaction is best effort and may withhold long lines; run logs retain raw local evidence.",
      "Run budgets cover Edu-owned invocations, not native CLI tools, descendants, provider cost or internal turns.",
      "Optional package registration does not prove installation, compatibility or authentication.",
      "Persistent memory is not model-weight training or proof of reduced human work.",
      "Update and migration do not invoke a paid model or infer new lessons.",
      "Canonical standards and behavioral skills require human approval.",
      "Context exposure and advisory feedback are not verified success; promotion requires verified evidence.",
      "Host integrations must be restarted after updating; existing sessions may retain old tools and instructions.",
      "Missing/broken workspaces or unknown/custom native caches leave upgrades incomplete, not silently overwritten.",
      "Unknown usage is not zero; reported usage is not independently verified provider billing.",
      "CLI permissions and experiment workspace copies are not an Edu OS or network sandbox.",
      "Experiments run only trusted approved commands; artifact matches do not prove general quality or causal benefit.",
      "Experiments do not automatically invoke models, adopt candidates or grant verified learning credit."
    ],
    commands: ["edu doctor --integrations --json", "edu run --resume <runId>", "edu --version", "edu capabilities --json", "edu brief", "edu brain recall", "edu reflect --since 7d", "edu eval suite --json", "edu experiment inspect <manifest>", "edu experiment run <manifest> --approve <sha256> --evidence <directory>", "edu update --check", "edu internal migrate-workspaces --json"],
    restartRequired: true
  };
}

export {
  getCapabilities
};
//# sourceMappingURL=chunk-H7APMEBC.js.map