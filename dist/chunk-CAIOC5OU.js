import {
  packageTemplatesDir
} from "./chunk-BXZ573JQ.js";
import {
  applySetup,
  needsFirstRunSetup,
  planSetup
} from "./chunk-UOFOJCQU.js";
import {
  t
} from "./chunk-NQTHVZEM.js";
import {
  detectTheme,
  getGlyphs
} from "./chunk-KP6K4SHS.js";

// src/cli/commands/plugins.ts
import { dirname } from "path";

// src/cli/context.ts
import { homedir } from "os";
import { resolve } from "path";
function resolveGlobals(ctx, opts) {
  const locale = ctx.env.LC_ALL || ctx.env.LANG || "";
  const raw = opts.lang ?? ctx.env.EDU_LANG ?? (locale.toLowerCase().startsWith("es") ? "es" : "en");
  const lang = raw === "es" ? "es" : "en";
  return { cwd: resolve(ctx.cwd, opts.cwd ?? "."), lang, json: Boolean(opts.json) };
}
function globalHome(ctx) {
  return resolve(ctx.env.EDU_HOME || resolve(ctx.home, ".edu"));
}
function readStream(stream, timeoutMs = 1e3) {
  if (stream.isTTY) return Promise.resolve("");
  return new Promise((done) => {
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("end", finish);
      stream.removeListener("error", finish);
      stream.pause?.();
      done(Buffer.concat(chunks).toString("utf8"));
    };
    const onData = (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    stream.on("data", onData);
    stream.once("end", finish);
    stream.once("error", finish);
    stream.resume?.();
  });
}
function processContext() {
  return {
    cwd: process.cwd(),
    env: process.env,
    home: process.env.HOME || homedir(),
    out: (text) => void process.stdout.write(text.endsWith("\n") ? text : `${text}
`),
    err: (text) => void process.stderr.write(text.endsWith("\n") ? text : `${text}
`),
    readStdin: (timeoutMs) => readStream(process.stdin, timeoutMs),
    isTTY: Boolean(process.stdout.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    async confirm(question) {
      const { createInterface } = await import("readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question(`${question} [y/N] `);
        return /^y(es)?$/i.test(answer.trim());
      } finally {
        rl.close();
      }
    },
    async detectClis() {
      const { detectEngines } = await import("./engine-EA7LU35N.js");
      return detectEngines();
    },
    setExitCode: (code) => {
      process.exitCode = code;
    }
  };
}

// src/cli/kit.ts
function action(ctx, body) {
  return async (...args) => {
    const cmd = args.at(-1);
    const g = resolveGlobals(ctx, cmd.optsWithGlobals());
    const positionals = args.slice(0, -2).map((a) => Array.isArray(a) ? a.join(" ") : a);
    try {
      await body({ ctx, g, opts: cmd.opts(), cmd }, ...positionals);
    } catch (error) {
      ctx.err(t(g.lang, "error.prefix", { message: error instanceof Error ? error.message : String(error) }));
      ctx.setExitCode(1);
    }
  };
}
function printJson(ctx, value) {
  ctx.out(JSON.stringify(value, null, 2));
}
function look(ctx) {
  return { glyphs: getGlyphs(ctx.env), theme: detectTheme(ctx.env, ctx.isTTY) };
}
function statusLine({ glyphs, theme }, level, text) {
  const mark = level === "ok" ? glyphs.ok : level === "warn" ? "!" : glyphs.fail;
  const tone = level === "ok" ? "success" : level === "warn" ? "accent" : "danger";
  return `${theme.paint(tone, mark, { bold: true })} ${text}`;
}
function parseIntOption(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${value}"`);
  return n;
}
function parsePositive(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${value}"`);
  return n;
}

// src/cli/commands/plugins.ts
var CLIS = ["claude", "codex", "pi", "opencode", "agy"];
function parseClis(value) {
  if (value.trim().toLowerCase() === "all") return [...CLIS];
  const parts = value.split(",").map((part) => part.trim().toLowerCase());
  if (!parts.length || parts.some((part) => !part)) throw new Error("--cli needs at least one CLI");
  const invalid = parts.find((part) => !CLIS.includes(part));
  if (invalid) throw new Error(`Unknown CLI "${invalid}" (expected ${CLIS.join(", ")})`);
  return [...new Set(parts)];
}
function promptFor(cli, lang) {
  const command = cli === "claude" ? "/edu:brief" : cli === "pi" || cli === "opencode" ? "/edu-brief" : "edu-brief skill";
  return lang === "es" ? `Dentro de ${cli}, prueba: ${command}` : `Inside ${cli}, try: ${command}`;
}
async function runPluginSetup(ctx, g, options = {}) {
  const clis = options.clis ?? await ctx.detectClis();
  const packageRoot = dirname(packageTemplatesDir());
  const plan = await planSetup({ clis, packageRoot, home: ctx.home });
  if (g.json && options.dryRun) {
    ctx.out(JSON.stringify({ clis, commands: plan.commands, fallback: plan.fallback, alreadyInstalled: plan.alreadyInstalled }));
    return;
  }
  if (!g.json && (plan.commands.length || plan.fallback.length)) {
    ctx.out(g.lang === "es" ? "Plan de instalaci\xF3n de Edu:" : "Edu setup plan:");
    for (const cli of clis) {
      const state = plan.alreadyInstalled.includes(cli) ? "\u2713" : plan.fallback.includes(cli) ? "!" : plan.commands.some((command) => command.cli === cli) ? "\u2713" : "\u2717";
      ctx.out(`${state} ${cli}`);
    }
    for (const command of plan.commands) ctx.out(`  $ ${command.command} ${command.args.join(" ")}`);
    for (const cli of plan.fallback) ctx.out(`  ${cli}: ${g.lang === "es" ? "se usar\xE1n archivos administrados" : "managed files will be used"}`);
  }
  if (options.dryRun) {
    ctx.out(g.lang === "es" ? "Simulaci\xF3n: no se escribi\xF3 nada." : "Dry run: nothing was written.");
    return;
  }
  if (!g.json && (plan.commands.length || plan.fallback.length)) ctx.out("");
  if ((plan.commands.length || plan.fallback.length) && !options.yes) {
    if (!ctx.isTTY || !ctx.stdinIsTTY) throw new Error(g.lang === "es" ? "Use --yes para instalar sin confirmaci\xF3n interactiva." : "Use --yes to apply setup non-interactively.");
    const question = g.lang === "es" ? "\xBFAplicar esta configuraci\xF3n?" : "Apply this setup?";
    if (!await ctx.confirm(question)) {
      ctx.out(g.lang === "es" ? "Cancelado. No se realizaron cambios." : "Cancelled. Nothing was changed.");
      return;
    }
  }
  const report = await applySetup(plan, { templatesDir: packageTemplatesDir(), detected: clis, lang: g.lang, brainRoot: globalHome(ctx) });
  if (!g.json) {
    for (const cli of clis) {
      const marker = report.installed.includes(cli) || report.alreadyInstalled.includes(cli) ? "\u2713" : report.fallback.includes(cli) ? "!" : "\u2717";
      ctx.out(`${marker} ${cli}${report.fallback.includes(cli) ? g.lang === "es" ? " (integraci\xF3n administrada)" : " (managed-file integration)" : ""}`);
      const failure = report.failed.find((f) => f.cli === cli);
      if (failure) ctx.out(`  ${g.lang === "es" ? "instalador nativo fall\xF3" : "native installer failed"}: ${failure.message.split("\n").slice(-2).join(" ").slice(0, 240)}`);
      ctx.out(`  ${promptFor(cli, g.lang)}`);
    }
    if (!clis.length) ctx.out(g.lang === "es" ? "No se detectaron CLI; instale uno y ejecute edu setup." : "No CLIs detected; install one and run edu setup.");
  }
  if (g.json) ctx.out(JSON.stringify(report));
}
function registerPluginSetup(program, ctx) {
  program.command("setup").description("install Edu plugins into your coding CLIs").option("--cli <list>", "comma-separated CLIs").option("--dry-run", "show the plan without writing").option("-y, --yes", "apply without asking").action(action(ctx, async ({ g, opts }) => {
    const clis = opts.cli ? parseClis(opts.cli) : void 0;
    await runPluginSetup(ctx, g, { clis, yes: Boolean(opts.yes), dryRun: Boolean(opts.dryRun) });
  }));
}
async function shouldRunFirstSetup(ctx) {
  return needsFirstRunSetup(globalHome(ctx));
}

export {
  resolveGlobals,
  globalHome,
  processContext,
  action,
  printJson,
  look,
  statusLine,
  parseIntOption,
  parsePositive,
  runPluginSetup,
  registerPluginSetup,
  shouldRunFirstSetup
};
//# sourceMappingURL=chunk-CAIOC5OU.js.map