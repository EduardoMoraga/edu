import {
  createCommandHandler
} from "./chunk-OIF2V5ZQ.js";
import {
  createPlainFormatter
} from "./chunk-ECRVBJKY.js";
import {
  getGlyphs
} from "./chunk-IK4YS5DS.js";
import {
  t
} from "./chunk-TRNZ5EV4.js";
import "./chunk-D23CA5MT.js";
import "./chunk-IIELWA3V.js";
import "./chunk-3FSLIEUM.js";
import "./chunk-E5BOGIGG.js";

// src/cli/run/watch.ts
async function watchInTui(setup) {
  const [{ renderTui }, { watchCrew }] = await Promise.all([import("./tui-UGWIO3ZZ.js"), import("./crew-V2VJXMHC.js")]);
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
//# sourceMappingURL=watch-U3EVQBYM.js.map