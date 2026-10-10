import {
  t
} from "./chunk-NQTHVZEM.js";
import {
  lessonCount
} from "./chunk-IIELWA3V.js";

// src/cli/run/commands.ts
import { execFile } from "child_process";
var RECALL_LIMIT = 5;
function createCommandHandler(deps) {
  const { lang } = deps;
  return async (name, args) => {
    switch (name) {
      case "brain": {
        if (!deps.brain) return void 0;
        const stats = await deps.brain.stats();
        return t(lang, "tui.brainStats", { total: stats.total, lessons: lessonCount(stats.byStatus) });
      }
      case "recall": {
        if (!deps.brain) return void 0;
        const hits = await deps.brain.recall(args, { limit: RECALL_LIMIT });
        if (!hits.length) return t(lang, "tui.recallNone", { query: args });
        return t(lang, "tui.recallHits", { count: hits.length, titles: hits.map((h) => h.note.meta.title).join(" \xB7 ") });
      }
      case "status": {
        if (!deps.crew) return void 0;
        const jobs = await deps.crew.list();
        if (!jobs.length) return t(lang, "tui.crewNone");
        const counts = /* @__PURE__ */ new Map();
        for (const job of jobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
        const summary = [...counts].map(([status, n]) => `${n} ${status}`).join(" \xB7 ");
        return t(lang, "tui.crewStatus", { count: jobs.length, summary });
      }
      case "dispatch": {
        if (!deps.crew?.dispatch) return void 0;
        const match = /^(\S+)\s+([\s\S]+)$/.exec(args.trim());
        if (!match) return t(lang, "tui.dispatchUsage");
        const output = await deps.crew.dispatch(match[1], match[2].trim());
        return t(lang, "tui.dispatched", { output });
      }
      default:
        return void 0;
    }
  };
}
function selfRunner(entry = process.argv[1]) {
  return (args) => new Promise((resolve, reject) => {
    if (!entry) return reject(new Error("cannot locate the edu entry point"));
    execFile(process.execPath, [entry, ...args], { timeout: 3e4 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim().split("\n").at(-1) ?? error.message));
      else resolve(stdout.trim().split("\n").at(-1) ?? "");
    });
  });
}
function cliDispatch(run, cwd) {
  return (cli, task) => run(["--cwd", cwd, "crew", "dispatch", cli, task]);
}

export {
  createCommandHandler,
  selfRunner,
  cliDispatch
};
//# sourceMappingURL=chunk-ORTDWI3P.js.map