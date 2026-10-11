import {
  createCommandHandler
} from "./chunk-LMHWAL5I.js";
import {
  createPlainFormatter
} from "./chunk-ECRVBJKY.js";
import {
  getGlyphs
} from "./chunk-IK4YS5DS.js";
import {
  t
} from "./chunk-DOOFC4UY.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-PYOUPNRP.js";
import "./chunk-H72YZL6C.js";
import "./chunk-SZK6YXAF.js";
import "./chunk-IGGRYW7S.js";
import "./chunk-FW7CG3X3.js";

// src/cli/run/watch.ts
async function watchInTui(setup) {
  const [{ renderTui }, { watchCrew }] = await Promise.all([import("./tui-ZPBRZEYF.js"), import("./crew-V2VJXMHC.js")]);
  const abort = new AbortController();
  const app = renderTui({
    events: watchCrew(setup.source, { jobId: setup.jobId, pollMs: setup.pollMs, signal: abort.signal }),
    name: setup.name,
    lang: setup.uiLang,
    crew: true,
    onCommand: createCommandHandler({ lang: setup.lang, brain: setup.brain, crew: { list: () => setup.source.list(), dispatch: setup.dispatch } })
  });
  try {
    await app.waitUntilExit();
  } finally {
    abort.abort();
  }
}
async function watchPlain(ctx, setup) {
  const jobs = (await setup.source.list()).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  if (!setup.jobId) {
    if (!jobs.length) return ctx.out(t(setup.lang, "watch.none"));
    for (const job of jobs) ctx.out(`${job.status.padEnd(9)} ${job.id.slice(0, 8)}  ${job.cli.padEnd(8)} ${job.task.replace(/\s+/g, " ")}`);
    return;
  }
  const { watchCrew } = await import("./crew-V2VJXMHC.js");
  const format = createPlainFormatter(getGlyphs(ctx.env));
  const events = [];
  for await (const event of watchCrew(setup.source, { jobId: setup.jobId, follow: false })) events.push(event);
  for (const event of events) {
    if (event.type === "error") {
      ctx.err(t(setup.lang, "error.prefix", { message: event.message }));
      ctx.setExitCode(1);
      continue;
    }
    const line = format(event);
    if (line) ctx.out(line);
  }
}
export {
  watchInTui,
  watchPlain
};
//# sourceMappingURL=watch-TS3O42H4.js.map