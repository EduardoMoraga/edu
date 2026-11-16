// src/crew/status.ts
var CREW_JOB_STATUSES = ["queued", "running", "awaiting-approval", "done", "failed", "cancelled"];
var TERMINAL_CREW_JOB_STATUSES = ["done", "failed", "cancelled"];
function isCrewJobStatus(value) {
  return typeof value === "string" && CREW_JOB_STATUSES.includes(value);
}
function isTerminalCrewJobStatus(value) {
  return typeof value === "string" && TERMINAL_CREW_JOB_STATUSES.includes(value);
}

export {
  CREW_JOB_STATUSES,
  TERMINAL_CREW_JOB_STATUSES,
  isCrewJobStatus,
  isTerminalCrewJobStatus
};
//# sourceMappingURL=chunk-GCKZZJ4W.js.map