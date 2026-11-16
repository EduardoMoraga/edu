import {
  createCommandHandler
} from "./chunk-SFBK63Q2.js";
import {
  createPlainFormatter
} from "./chunk-ECRVBJKY.js";
import {
  t
} from "./chunk-6EQ5USXO.js";
import "./chunk-QNEUTXM7.js";
import {
  getGlyphs
} from "./chunk-IK4YS5DS.js";
import "./chunk-PAAE3O2O.js";
import "./chunk-Z4DEDTJK.js";
import "./chunk-ORYLFQE5.js";
import "./chunk-SOBMA5SW.js";
import "./chunk-KDSAKUP2.js";
import "./chunk-NMJNTHQG.js";
import "./chunk-VXIEHENV.js";
import "./chunk-KVVJCXPU.js";
import "./chunk-YPR7PZSQ.js";
import "./chunk-X74ZO2KX.js";

// src/cli/run/watch.ts
async function watchInTui(setup) {
  const [{ renderTui }, { watchCrew }] = await Promise.all([import("./tui-AOYSBE4O.js"), import("./crew-C4AOJVNM.js")]);
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
  const { watchCrew } = await import("./crew-C4AOJVNM.js");
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
//# sourceMappingURL=watch-QKJD4LMF.js.map