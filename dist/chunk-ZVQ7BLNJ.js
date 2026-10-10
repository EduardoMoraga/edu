import {
  createPlainFormatter
} from "./chunk-ECRVBJKY.js";
import {
  createCrew,
  runWorker
} from "./chunk-DYC4DXNX.js";
import {
  action,
  look,
  parseIntOption,
  parsePositive,
  printJson,
  registerPluginSetup,
  statusLine
} from "./chunk-AJAVXPS7.js";
import {
  detectTheme,
  formatTokens,
  getGlyphs,
  renderBanner,
  renderStatusline
} from "./chunk-IK4YS5DS.js";
import {
  globalHome,
  processContext,
  resolveGlobals
} from "./chunk-23I7IHDX.js";
import {
  packageTemplatesDir,
  packageVersion
} from "./chunk-BXZ573JQ.js";
import {
  SIGNATURES,
  TOOL_IDS,
  assertDetachable,
  editContent,
  editInstructions,
  ownerOf
} from "./chunk-SPL7O2VD.js";
import {
  initBrain
} from "./chunk-PYSJJP4V.js";
import {
  fsCrewSource
} from "./chunk-CVB7YSGO.js";
import {
  t,
  uiLang
} from "./chunk-NTU4RUMO.js";
import {
  effectiveConfig,
  exists,
  identityName,
  lessonCount,
  openWorkspace
} from "./chunk-LZAMKNNP.js";
import {
  loadChecks,
  runCheck,
  saveChecks
} from "./chunk-KNYRQ5SA.js";
import {
  openBrain
} from "./chunk-G74JOKZO.js";
import {
  TIER_DIRS,
  atomicWrite,
  parseMarkdownLenient
} from "./chunk-PILVA3OM.js";

// src/cli/program.ts
import { Command } from "commander";

// src/cli/commands/brain.ts
import { join as join2, resolve as resolve2 } from "path";

// src/cli/link.ts
import { lstat, mkdir, readlink, realpath, symlink } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
function linkName(location) {
  return location.scope === "global" ? "global" : basename(dirname(location.root)) || "project";
}
function brainDir(location) {
  return join(location.root, "brain");
}
function linkPath(vault, location) {
  return join(resolve(vault), "Edu", linkName(location));
}
async function samePath(a, b) {
  try {
    return await realpath(a) === await realpath(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}
async function linkState(link, target) {
  let info;
  try {
    info = await lstat(link);
  } catch {
    return "missing";
  }
  if (!info.isSymbolicLink()) return "conflict";
  const pointsTo = resolve(dirname(link), await readlink(link));
  return await samePath(pointsTo, target) ? "ok" : "conflict";
}
async function createVaultLink(link, target, platform = process.platform) {
  const state = await linkState(link, target);
  if (state === "ok") return "exists";
  if (state === "conflict") throw Object.assign(new Error(`link conflict: ${link}`), { code: "ELINKCONFLICT" });
  await mkdir(dirname(link), { recursive: true });
  await mkdir(target, { recursive: true });
  await symlink(resolve(target), link, platform === "win32" ? "junction" : "dir");
  return "created";
}

// src/cli/commands/brain.ts
var KINDS = ["decision", "hypothesis", "commitment", "lesson"];
var BANDS = ["verified", "inferred", "hypothesis"];
function oneOf(value, allowed, flag) {
  if (!allowed.includes(value)) throw new Error(`${flag} must be one of ${allowed.join(", ")}, got "${value}"`);
  return value;
}
async function writableWorkspace(ctx, cwd, lang) {
  const ws = await openWorkspace(ctx, cwd);
  if (!await exists(join2(ws.primary.root, "EDU.md"))) {
    throw new Error(lang === "es" ? "No hay cerebro inicializado \u2014 ejecuta: edu init" : "No brain found \u2014 run: edu init");
  }
  return ws;
}
function registerBrain(program, ctx) {
  const brain = program.command("brain").description("inspect and grow the second brain");
  brain.command("status").description("notes per tier, kind and status").option("--json", "machine-readable output").action(
    action(ctx, async ({ g, opts }) => {
      const ws = await openWorkspace(ctx, g.cwd);
      const stats = await ws.brain.stats();
      if (g.json || opts.json) return printJson(ctx, { locations: ws.locations, ...stats });
      const { glyphs } = look(ctx);
      ctx.out(`${glyphs.brain} ${stats.total} notes ${glyphs.sep} ${lessonCount(stats.byStatus)} lessons`);
      for (const loc of ws.locations) ctx.out(`  ${loc.scope.padEnd(8)} ${loc.root}`);
      ctx.out(`  canonical ${stats.byTier.canonical} ${glyphs.sep} episodic ${stats.byTier.episodic} ${glyphs.sep} transitive ${stats.byTier.transitive}`);
      const kinds = Object.entries(stats.byKind).sort(([a], [b]) => a.localeCompare(b));
      if (kinds.length) ctx.out(`  ${kinds.map(([k, n]) => `${k} ${n}`).join(` ${glyphs.sep} `)}`);
    })
  );
  brain.command("recall").description("search the brain (relevance \xD7 learned weight)").argument("<query...>", "what to look for").option("--limit <n>", "maximum hits", "8").option("--json", "machine-readable output").action(
    action(ctx, async ({ g, opts }, query) => {
      const ws = await openWorkspace(ctx, g.cwd);
      const hits = await ws.brain.recall(query ?? "", { limit: parseIntOption(opts.limit ?? "8", "--limit") });
      if (g.json || opts.json) {
        return printJson(ctx, hits.map((h) => ({ id: h.note.meta.id, title: h.note.meta.title, tier: h.note.meta.tier, band: h.note.meta.band, score: h.score, why: h.why })));
      }
      if (!hits.length) return ctx.out(t(g.lang, "brain.empty"));
      for (const hit of hits) {
        const band = hit.note.meta.band ? ` [${hit.note.meta.band}]` : "";
        ctx.out(`${hit.score.toFixed(2).padStart(6)}  ${hit.note.meta.id}${band}  ${hit.note.meta.title}`);
        ctx.out(`        ${hit.why}`);
      }
    })
  );
  brain.command("remember").description("write a decision, hypothesis, commitment or lesson").argument("<title...>", "one-line title").option("--kind <kind>", KINDS.join(" | "), "lesson").option("--body <text>", "markdown body").option("--band <band>", BANDS.join(" | ")).option("--due <date>", "due date for commitments (YYYY-MM-DD)").option("--json", "machine-readable output").action(
    action(ctx, async ({ g, opts }, title) => {
      const kind = oneOf(opts.kind ?? "lesson", KINDS, "--kind");
      const band = opts.band ? oneOf(opts.band, BANDS, "--band") : void 0;
      const ws = await writableWorkspace(ctx, g.cwd, g.lang);
      const note = await ws.brain.write({
        tier: "transitive",
        kind,
        title: (title ?? "").trim(),
        body: opts.body ?? "",
        source: "user",
        ...band ? { band } : {},
        ...opts.due ? { due: opts.due } : {}
      });
      if (g.json || opts.json) return printJson(ctx, { id: note.meta.id, path: note.path });
      ctx.out(t(g.lang, "brain.remembered", { id: note.meta.id }));
    })
  );
  brain.command("maintain").description("decay, promote/retire lessons, flag overdue commitments, rebuild the index").option("--json", "machine-readable output").action(
    action(ctx, async ({ g, opts }) => {
      const ws = await writableWorkspace(ctx, g.cwd, g.lang);
      const report = await ws.brain.maintain();
      if (g.json || opts.json) return printJson(ctx, report);
      ctx.out(t(g.lang, "brain.maintained", { changed: report.changed.length, promoted: report.promoted.length, retired: report.retired.length, overdue: report.overdue.length }));
    })
  );
  brain.command("import").description("import an Albert vault or MORAGENT memory (read-only on the source)").argument("<source>", "albert | moragent").argument("<path>", "source directory").option("--json", "machine-readable output").action(
    action(ctx, async ({ g, opts }, source, path) => {
      const kind = oneOf(source ?? "", ["albert", "moragent"], "source");
      const ws = await writableWorkspace(ctx, g.cwd, g.lang);
      const { importAlbert, importMoragent } = await import("./brain-BECOVE5I.js");
      const report = await (kind === "albert" ? importAlbert : importMoragent)(path ?? "", ws.brain);
      if (g.json || opts.json) return printJson(ctx, { imported: report.imported.map((n) => n.meta.id), skipped: report.skipped, errors: report.errors });
      ctx.out(t(g.lang, "brain.imported", { imported: report.imported.length, skipped: report.skipped.length, errors: report.errors.length }));
      for (const error of report.errors) ctx.err(`  ${error}`);
    })
  );
  brain.command("link").description("link the brain into an Obsidian vault as <vault>/Edu/<project>").argument("<vault>", "Obsidian vault directory").action(
    action(ctx, async ({ g }, vault) => {
      const ws = await writableWorkspace(ctx, g.cwd, g.lang);
      const vaultPath = resolve2(g.cwd, vault ?? "");
      const link = linkPath(vaultPath, ws.primary);
      const target = brainDir(ws.primary);
      let outcome;
      try {
        outcome = await createVaultLink(link, target);
      } catch (error) {
        if (error.code === "ELINKCONFLICT") throw new Error(t(g.lang, "brain.linkConflict", { link }));
        throw error;
      }
      const configPath = join2(ws.primary.root, "config.json");
      if (await exists(configPath)) {
        const { loadConfig, saveConfig } = await import("./config-6JDFE6ZL.js");
        const config = await loadConfig(configPath);
        await saveConfig(configPath, { ...config, brain: { ...config.brain, obsidianVault: vaultPath } });
      }
      ctx.out(t(g.lang, outcome === "created" ? "brain.linked" : "brain.linkExists", { link, target }));
    })
  );
}

// src/cli/commands/crew.ts
var CLI_IDS = ["claude", "codex", "pi", "opencode", "agy"];
function parseCli(value) {
  if (!CLI_IDS.includes(value)) throw new Error(`Unknown CLI "${value}" (expected ${CLI_IDS.join(", ")})`);
  return value;
}
function registerCrew(program, ctx) {
  const crew = async (cwd) => {
    const ws = await openWorkspace(ctx, cwd);
    return createCrew({ brainRoot: ws.primary.root, locations: ws.locations, workspaceRoot: cwd });
  };
  const root = program.command("crew").description("dispatch and inspect crew jobs");
  root.command("dispatch <cli> <task>").description("dispatch a crew job").option("--pane", "dispatch into a visible Herdr pane when available").option("--autonomy <level>", "readonly, ask, auto, or full", "ask").action(action(ctx, async ({ g, opts }, cliArg, task) => {
    const cli = parseCli(cliArg);
    const autonomy = opts.autonomy;
    if (!["readonly", "ask", "auto", "full"].includes(autonomy ?? "")) throw new Error("Autonomy must be readonly, ask, auto, or full");
    const job = await (await crew(g.cwd)).dispatch({ cli, task, mode: opts.pane ? "pane" : "headless", cwd: g.cwd, autonomy });
    ctx.out(JSON.stringify(job));
  }));
  root.command("status [id]").description("show crew jobs or one job").action(action(ctx, async ({ g }, id) => {
    ctx.out(JSON.stringify(await (await crew(g.cwd)).status(id)));
  }));
  root.command("result <id>").description("wait for a crew result").option("--wait <seconds>", "maximum wait time in seconds", "60").action(action(ctx, async ({ g, opts }, id) => {
    const wait = Number(opts.wait);
    if (!Number.isFinite(wait) || wait < 0) throw new Error("--wait must be a non-negative number of seconds");
    ctx.out(JSON.stringify(await (await crew(g.cwd)).result(id, wait)));
  }));
  for (const [name, approved] of [["approve", true], ["reject", false]]) {
    root.command(`${name} <id>`).description(`${name} the pending orchestration approval`).action(action(ctx, async ({ g }, id) => {
      ctx.out(JSON.stringify(await (await crew(g.cwd)).approve(id, approved)));
    }));
  }
  root.command("worker <id>").description("run a queued crew job (internal detached entry point)").action(async (id) => {
    try {
      await runWorker(id, { brainRoot: ctx.env.EDU_HOME || globalHome(ctx) });
    } catch (error) {
      ctx.err(`Crew worker failed: ${error instanceof Error ? error.message : String(error)}`);
      ctx.setExitCode(1);
    }
  });
}

// src/cli/commands/deck.ts
import { readFile, readdir, stat } from "fs/promises";
import { basename as basename2, dirname as dirname2, join as join3, resolve as resolve3 } from "path";
async function files(dir, recursive = false) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const groups = await Promise.all(entries.map(async (entry) => {
      const path = join3(dir, entry.name);
      if (entry.isDirectory() && recursive) return files(path, true);
      if (!entry.isFile()) return [];
      try {
        const info = await stat(path);
        return [{ path, name: entry.name, at: info.mtimeMs }];
      } catch {
        return [];
      }
    }));
    return groups.flat();
  } catch {
    return [];
  }
}
function noteText(source) {
  try {
    const { meta, body } = parseMarkdownLenient(source);
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    return {
      title: heading || (typeof meta.title === "string" ? meta.title : ""),
      status: typeof meta.status === "string" ? meta.status : "",
      kind: typeof meta.kind === "string" ? meta.kind : ""
    };
  } catch {
    return { title: /^#\s+(.+)$/m.exec(source)?.[1]?.trim() ?? "", status: "", kind: "" };
  }
}
async function latestSpec(root) {
  const candidates = (await files(join3(root, "specs"))).filter((file) => file.name.endsWith(".md"));
  const newest = candidates.sort((a, b) => b.at - a.at)[0];
  if (!newest) return null;
  try {
    const source = await readFile(newest.path, "utf8");
    return {
      name: newest.name.slice(0, -3),
      requirements: (source.match(/^- \*\*R-/gm) ?? []).length,
      checks: (source.match(/^### C-/gm) ?? []).length
    };
  } catch {
    return null;
  }
}
var object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
var string = (value, fallback = "") => typeof value === "string" ? value : fallback;
async function crewJobs(root) {
  const newest = (await files(join3(root, "crew"))).filter((file) => file.name.endsWith(".json")).sort((a, b) => b.at - a.at).slice(0, 8);
  const parsed = await Promise.all(newest.map(async (file) => {
    try {
      const job = JSON.parse(await readFile(file.path, "utf8"));
      if (!object(job)) return null;
      const usage = object(job.usage) ? job.usage : {};
      const started = Date.parse(string(job.createdAt));
      const ended = Date.parse(string(job.endedAt));
      return {
        id: string(job.id, file.name).slice(0, 8),
        cli: string(job.cli, "?"),
        task: string(job.goal, string(job.task)).replace(/\s+/g, " ").trim(),
        status: string(job.status, "queued"),
        mode: job.kind === "orchestration" ? "run" : string(job.mode, "headless"),
        startedAt: Number.isFinite(started) ? started : file.at,
        endedAt: Number.isFinite(ended) ? ended : null,
        tokens: finite(usage.inputTokens) + finite(usage.outputTokens)
      };
    } catch {
      return null;
    }
  }));
  return parsed.filter((job) => job !== null);
}
async function deckSnapshot(root) {
  let projectRoot = resolve3(root);
  while (true) {
    try {
      if ((await stat(join3(projectRoot, ".edu"))).isDirectory()) break;
    } catch {
    }
    const parent = dirname2(projectRoot);
    if (parent === projectRoot) {
      projectRoot = resolve3(root);
      break;
    }
    projectRoot = parent;
  }
  const eduRoot = join3(projectRoot, ".edu");
  const empty = {
    version: 1,
    project: { name: basename2(projectRoot), root: projectRoot },
    identity: "Edu",
    brain: { present: false, canonical: 0, proposed: 0, episodic: 0, transitive: 0, lessons: 0 },
    spec: null,
    jobs: [],
    approvals: 0,
    recent: [],
    updatedAt: Date.now()
  };
  try {
    const brainDir2 = join3(eduRoot, "brain");
    if (!(await stat(brainDir2)).isDirectory()) return empty;
    const tiers = Object.entries(TIER_DIRS);
    const noteFiles = (await Promise.all(tiers.map(
      async ([tier, dir]) => (await files(join3(brainDir2, dir), true)).filter((file) => file.name.endsWith(".md") && !file.name.endsWith(".base.md")).map((file) => ({ ...file, tier }))
    ))).flat();
    const notes = await Promise.all(noteFiles.map(async (file) => {
      try {
        return { ...file, ...noteText(await readFile(file.path, "utf8")) };
      } catch {
        return { ...file, title: "", status: "", kind: "" };
      }
    }));
    const byStatus = {};
    for (const note of notes) {
      if (note.tier === "canonical") {
        if (note.status === "accepted") empty.brain.canonical++;
        if (note.status === "proposed") empty.brain.proposed++;
      } else if (note.tier === "episodic") empty.brain.episodic++;
      else {
        empty.brain.transitive++;
        if (note.kind === "lesson" || note.name.startsWith("L-")) byStatus[note.status] = (byStatus[note.status] ?? 0) + 1;
      }
    }
    empty.brain.present = true;
    empty.brain.lessons = lessonCount(byStatus);
    empty.recent = notes.filter((note) => note.title).sort((a, b) => b.at - a.at).slice(0, 5).map((note) => ({ title: note.title, tier: note.tier, at: note.at }));
    const [identity, spec, jobs] = await Promise.all([identityName(eduRoot), latestSpec(eduRoot), crewJobs(eduRoot)]);
    empty.identity = identity;
    empty.spec = spec;
    empty.jobs = jobs;
    empty.approvals = jobs.filter((job) => job.status === "awaiting-approval").length;
  } catch {
  }
  return empty;
}
function registerDeck(program, ctx) {
  program.command("deck").description("show the Edu brain, latest spec and crew jobs").option("--json", "print the versioned snapshot for host renderers").action(async (_opts, cmd) => {
    const g = resolveGlobals(ctx, cmd.optsWithGlobals());
    const deck = await deckSnapshot(g.cwd);
    if (g.json) {
      ctx.out(JSON.stringify(deck));
      return;
    }
    const glyphs = getGlyphs(ctx.env);
    ctx.out(`${glyphs.brain} EDU ${glyphs.sep} ${deck.identity} ${glyphs.sep} ${deck.project.name}`);
    const brain = deck.brain;
    ctx.out(`Brain  ${brain.present ? `${brain.canonical} canonical \xB7 ${brain.proposed} proposed \xB7 ${brain.episodic} episodic \xB7 ${brain.transitive} transitive \xB7 ${brain.lessons} lessons` : "not found"}`);
    ctx.out(`Spec   ${deck.spec ? `${deck.spec.name} \xB7 ${deck.spec.requirements} requirements \xB7 ${deck.spec.checks} ${deck.spec.checks === 1 ? "check" : "checks"}` : "none"}`);
    ctx.out(`Crew   ${deck.jobs.length} ${deck.jobs.length === 1 ? "job" : "jobs"} \xB7 ${deck.approvals} ${deck.approvals === 1 ? "approval" : "approvals"}`);
    for (const job of deck.jobs) ctx.out(`  ${job.status} ${job.cli} ${job.id} ${glyphs.sep} ${job.task}`);
  });
}

// src/cli/commands/doctor.ts
import { join as join7 } from "path";

// src/vault/registry.ts
import { randomUUID } from "crypto";
import { mkdir as mkdir2, readFile as readFile2, realpath as realpath2, rename, rm, writeFile } from "fs/promises";
import { basename as basename3, dirname as dirname3, join as join4, resolve as resolve4 } from "path";
async function readProjects(eduHome) {
  let raw;
  try {
    raw = await readFile2(join4(eduHome, "projects.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { projects: [] };
    throw error;
  }
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || !("projects" in data) || !Array.isArray(data.projects) || !data.projects.every((entry) => entry && typeof entry === "object" && ["name", "root", "brain", "addedAt"].every((key) => typeof entry[key] === "string"))) {
    throw new Error(`Invalid project registry: ${join4(eduHome, "projects.json")}`);
  }
  return data;
}
async function registerProject(eduHome, projectRoot) {
  const root = await realpath2(resolve4(projectRoot));
  const name = basename3(root);
  const brain = join4(root, ".edu", "brain");
  const registry = await readProjects(eduHome);
  const existing = registry.projects.find((entry2) => entry2.root === root);
  if (existing) return existing;
  if (registry.projects.some((entry2) => entry2.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Project name conflict in registry: ${name}`);
  }
  const entry = { name, root, brain, addedAt: (/* @__PURE__ */ new Date()).toISOString() };
  registry.projects.push(entry);
  const path = join4(eduHome, "projects.json");
  await mkdir2(dirname3(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(registry, null, 2)}
`);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return entry;
}

// src/doctor/context.ts
import { lstat as lstat2, readFile as readFile3, readdir as readdir2, realpath as realpath3 } from "fs/promises";
import { join as join6, relative, resolve as resolve5, sep } from "path";
import { parse } from "jsonc-parser";

// src/doctor/hosts.ts
import { join as join5, win32 } from "path";
var HOST_IDS = ["claude", "codex", "pi", "opencode", "gemini"];
var FILES = {
  claude: [[".claude/CLAUDE.md", "instructions"], [".claude/settings.json", "json"], [".claude.json", "json"]],
  codex: [[".codex/AGENTS.md", "instructions"], [".codex/config.toml", "toml"], [".codex/hooks.json", "hooks"]],
  pi: [[".pi/agent/AGENTS.md", "instructions"], [".pi/agent/settings.json", "json"], [".pi/agent/mcp.json", "json"]],
  opencode: [
    [".config/opencode/AGENTS.md", "instructions"],
    [".config/opencode/opencode.json", "json"],
    [".config/opencode/opencode.jsonc", "jsonc"],
    // TUI plugins (logos, sidebars): OpenCode 2 lists them under `plugins` in cli.json (JSONC-tolerant,
    // so comments survive edits); OpenCode 1 under `plugin` in tui.json / tui.jsonc.
    [".config/opencode/cli.json", "jsonc"],
    [".config/opencode/tui.json", "json"],
    [".config/opencode/tui.jsonc", "jsonc"]
  ],
  gemini: [[".gemini/GEMINI.md", "instructions"], [".gemini/settings.json", "json"]]
};
var SKILL_DIRS = {
  claude: [".claude/skills", ".claude/agents"],
  codex: [".codex/skills", ".agents/skills"],
  pi: [".pi/agent/skills", ".pi/agent/extensions"],
  opencode: [".config/opencode/skills", ".config/opencode/plugins"],
  gemini: [".gemini/skills"]
};
function hostFiles(home, env = {}, hosts = HOST_IDS) {
  const root = env.USERPROFILE || home;
  return hosts.flatMap((host) => FILES[host].map(([relative3, kind]) => {
    const pathJoin = /^[A-Za-z]:\\|^\\\\/.test(root) ? win32.join : join5;
    const path = host === "opencode" && env.APPDATA && relative3.startsWith(".config/opencode/") ? (/^[A-Za-z]:\\|^\\\\/.test(env.APPDATA) ? win32.join : join5)(env.APPDATA, relative3.slice(".config/".length)) : pathJoin(root, relative3);
    return { host, path, relative: relative3, kind };
  }));
}
function parseHosts(value) {
  if (!value) return [...HOST_IDS];
  const hosts = value.split(",").map((host) => host.trim());
  const invalid = hosts.filter((host) => !HOST_IDS.includes(host));
  if (invalid.length) throw new Error(`Unknown host: ${invalid.join(", ")}`);
  return [...new Set(hosts)];
}

// src/doctor/context.ts
var add = (counts, owner, amount = 1) => {
  counts[owner] = (counts[owner] ?? 0) + amount;
};
async function safeText(path, home) {
  const lexical = relative(resolve5(home), resolve5(path));
  if (lexical === ".." || lexical.startsWith(`..${sep}`)) return void 0;
  try {
    const info = await lstat2(path);
    if (!info.isFile() && !info.isSymbolicLink()) return void 0;
    const target = await realpath3(path);
    const rel = relative(await realpath3(home), target);
    if (rel === ".." || rel.startsWith(`..${sep}`)) return void 0;
    return await readFile3(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
async function skillDescriptions(home, host, env) {
  const root = env.USERPROFILE || home;
  const descriptions = [];
  for (const dir of SKILL_DIRS[host] ?? []) {
    const base = join6(host === "opencode" && env.APPDATA ? env.APPDATA : root, host === "opencode" && env.APPDATA ? dir.slice(".config/".length) : dir);
    let entries;
    try {
      entries = await readdir2(base, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const text = await safeText(join6(base, entry.name, "SKILL.md"), root);
      if (!text) continue;
      const description = /^description:\s*(.+)$/m.exec(text)?.[1];
      if (description) descriptions.push({ owner: ownerOf(entry.name, "plugins") ?? "user", chars: description.length });
    }
  }
  return descriptions;
}
function scanHooks(value, counts) {
  if (Array.isArray(value)) {
    for (const child of value) scanHooks(child, counts);
    return;
  }
  if (!value || typeof value !== "object") return;
  const object3 = value;
  const command = typeof object3.command === "string" ? object3.command : Array.isArray(object3.command) ? object3.command.join(" ") : void 0;
  if (command) {
    add(counts, ownerOf(command, "commands") ?? "user");
    return;
  }
  for (const child of Object.values(object3)) scanHooks(child, counts);
}
function scanObject(value, report, owners) {
  scanHooks(value.hooks, report.hooks.byOwner);
  for (const key of ["mcpServers", "mcp_servers", "mcp"]) {
    const servers = value[key];
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) continue;
    for (const name of Object.keys(servers)) {
      report.mcpServers.names.push(name);
      const owner = ownerOf(name, "mcp");
      add(report.mcpServers.byOwner, owner ?? "user");
      if (owner) owners.add(owner);
    }
  }
  for (const key of ["enabledPlugins", "plugins"]) {
    const plugins = value[key];
    const names = Array.isArray(plugins) ? plugins.filter((item) => typeof item === "string") : plugins && typeof plugins === "object" ? Object.entries(plugins).filter(([, enabled]) => enabled !== false).map(([name]) => name) : [];
    for (const name of names) {
      report.plugins.push(name);
      const owner = ownerOf(name, "plugins");
      if (owner) owners.add(owner);
    }
  }
  if (Array.isArray(value.packages)) {
    for (const item of value.packages) if (typeof item === "string") {
      const owner = ownerOf(item, "packages");
      if (owner) owners.add(owner);
    }
  }
  if (value.outputStyle === SIGNATURES["gentle-ai"].extras?.claudeOutputStyle || value.default_agent === SIGNATURES["gentle-ai"].extras?.opencodeDefaultAgent) owners.add("gentle-ai");
  const status = value.statusLine;
  if (status && typeof status === "object") {
    const command = status.command;
    if (typeof command === "string") {
      const owner = ownerOf(command, "commands");
      if (owner) owners.add(owner);
    }
  }
}
function scanToml(text, report, owners) {
  const pluginStates = /* @__PURE__ */ new Map();
  let activePlugin;
  for (const line of text.split("\n")) {
    const heading = /^\s*\[([^\]]+)\]/.exec(line)?.[1];
    if (heading) {
      const mcp = /^mcp_servers\.(?:"([^"]+)"|([^.]+))/.exec(heading);
      const plugin = /^plugins\.(?:"([^"]+)"|([^.]+))/.exec(heading);
      activePlugin = plugin?.[1] ?? plugin?.[2];
      if (mcp) {
        const name = mcp[1] ?? mcp[2];
        if (!report.mcpServers.names.includes(name)) {
          report.mcpServers.names.push(name);
          const owner = ownerOf(name, "mcp");
          add(report.mcpServers.byOwner, owner ?? "user");
          if (owner) owners.add(owner);
        }
      }
      if (activePlugin && !pluginStates.has(activePlugin)) pluginStates.set(activePlugin, true);
    }
    if (activePlugin && /^\s*enabled\s*=\s*false\b/.test(line)) pluginStates.set(activePlugin, false);
    if (SIGNATURES.engram.extras?.codexInstructionKeys?.some((key) => new RegExp(`^\\s*${key}\\s*=`).test(line) && /engram/i.test(line))) owners.add("engram");
  }
  for (const [name, enabled] of pluginStates) if (enabled) {
    report.plugins.push(name);
    const owner = ownerOf(name, "plugins");
    if (owner) owners.add(owner);
  }
}
async function scanContext(input) {
  const hosts = [];
  for (const host of input.hosts ?? ["claude", "codex", "pi", "opencode", "gemini"]) {
    const report = { host, tokens: { total: 0, byOwner: {} }, hooks: { total: 0, byOwner: {} }, mcpServers: { total: 0, byOwner: {}, names: [] }, plugins: [], memoryWriters: [], orchestrationProtocols: [], competingMemory: false, competingOrchestration: false, detachCommand: null, warnings: [] };
    const owners = /* @__PURE__ */ new Set();
    let found = false;
    let codexToml = "";
    for (const file of hostFiles(input.home, input.env, [host])) {
      const text = await safeText(file.path, input.env.USERPROFILE || input.home);
      if (text === void 0) continue;
      found = true;
      if (file.kind === "instructions") {
        const chars = text.length;
        let assigned = 0;
        for (const owner of TOOL_IDS) {
          const removed = chars - editInstructions(text, [owner]).text.length;
          if (removed) {
            add(report.tokens.byOwner, owner, Math.round(removed / 4));
            assigned += removed;
            owners.add(owner);
          }
        }
        add(report.tokens.byOwner, "user", Math.round(Math.max(0, chars - assigned) / 4));
        report.tokens.total += Math.round(chars / 4);
      } else if (file.kind === "toml") {
        codexToml = text;
        scanToml(text, report, owners);
      } else {
        try {
          scanObject(file.kind === "jsonc" ? parse(text) : JSON.parse(text), report, owners);
        } catch {
          report.warnings.push(`Could not parse ${file.relative}`);
        }
      }
    }
    if (!found) continue;
    if (host === "codex") {
      const home = input.env.USERPROFILE || input.home;
      const seen = /* @__PURE__ */ new Set();
      for (const key of SIGNATURES.engram.extras?.codexInstructionKeys ?? []) {
        const value = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m").exec(codexToml)?.[1];
        if (!value || !value.toLowerCase().includes("engram")) continue;
        const path = value.startsWith("~/") ? join6(home, value.slice(2)) : resolve5(home, value);
        if (seen.has(path)) continue;
        seen.add(path);
        const text = await safeText(path, home);
        if (text) {
          const count = Math.round(text.length / 4);
          add(report.tokens.byOwner, "engram", count);
          report.tokens.total += count;
          owners.add("engram");
        }
      }
    }
    for (const description of await skillDescriptions(input.home, host, input.env)) {
      const count = Math.round(description.chars / 4);
      add(report.tokens.byOwner, description.owner, count);
      report.tokens.total += count;
    }
    report.hooks.total = Object.values(report.hooks.byOwner).reduce((a, b) => a + b, 0);
    report.mcpServers.total = report.mcpServers.names.length;
    for (const owner of Object.keys(report.hooks.byOwner)) if (owner !== "user") owners.add(owner);
    report.memoryWriters = TOOL_IDS.filter((id) => owners.has(id) && SIGNATURES[id].memoryWriter);
    report.orchestrationProtocols = TOOL_IDS.filter((id) => owners.has(id) && SIGNATURES[id].orchestrator);
    report.competingMemory = report.memoryWriters.length > 1;
    report.competingOrchestration = report.orchestrationProtocols.length > 1;
    const removable = TOOL_IDS.filter((id) => id !== "edu" && owners.has(id));
    report.detachCommand = removable.length ? `edu detach ${removable.join(" ")} --host ${host}` : null;
    hosts.push(report);
  }
  return { hosts };
}

// src/cli/commands/doctor.ts
var AUTH_HINTS = {
  claude: "run `claude` once and sign in, or set ANTHROPIC_API_KEY",
  codex: "run `codex login`",
  pi: "run `pi` and use /login, or set a provider API key",
  opencode: "run `opencode auth login`",
  agy: "run `agy` once and sign in"
};
function nodeLine(version, lang) {
  const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? 0);
  return major >= 22 ? { level: "ok", text: t(lang, "doctor.node", { version }) } : { level: "fail", text: t(lang, "doctor.nodeOld", { version }) };
}
function registerDoctor(program, ctx) {
  program.command("doctor").description("check Node, coding CLIs, integrations, brains and the Obsidian link").option("--json", "machine-readable output").option("--context", "measure startup instructions and competing integrations").action(
    action(ctx, async ({ g, opts }) => {
      const lang = g.lang;
      if (opts.context) {
        const report = await scanContext({ home: ctx.home, env: ctx.env });
        if (g.json || opts.json) {
          printJson(ctx, report);
          return;
        }
        for (const host of report.hosts) {
          const owners = Object.entries(host.tokens.byOwner).filter(([, count]) => count > 0).map(([owner, count]) => `${owner} ${count}`).join(", ");
          const hookOwners = Object.entries(host.hooks.byOwner).map(([owner, count]) => `${owner} ${count}`).join(", ") || "none";
          const mcpOwners = Object.entries(host.mcpServers.byOwner).map(([owner, count]) => `${owner} ${count}`).join(", ") || "none";
          ctx.out(lang === "es" ? `${host.host}: ~${host.tokens.total} tokens antes de escribir (${owners}). Hooks: ${host.hooks.total} (${hookOwners}); MCP: ${host.mcpServers.total} (${mcpOwners}); plugins: ${host.plugins.join(", ") || "ninguno"}.` : `${host.host}: ~${host.tokens.total} tokens before you type (${owners}). Hooks: ${host.hooks.total} (${hookOwners}); MCP: ${host.mcpServers.total} (${mcpOwners}); plugins: ${host.plugins.join(", ") || "none"}.`);
          if (host.competingMemory) ctx.out(lang === "es" ? `  Memorias en competencia: ${host.memoryWriters.join(", ")}.` : `  Competing memory writers: ${host.memoryWriters.join(", ")}.`);
          if (host.competingOrchestration) ctx.out(lang === "es" ? `  Orquestadores en competencia: ${host.orchestrationProtocols.join(", ")}.` : `  Competing orchestrators: ${host.orchestrationProtocols.join(", ")}.`);
          if (host.detachCommand) ctx.out(`  ${host.detachCommand}`);
          for (const warning of host.warnings) ctx.out(`  ${warning}`);
        }
        return;
      }
      const lines = [nodeLine(process.version, lang)];
      const { diagnose } = await import("./adapters-NXBNH2DE.js");
      const clis = await diagnose({ root: g.cwd, home: ctx.home });
      for (const d of clis) {
        if (!d.installed) lines.push({ level: "warn", text: t(lang, "doctor.cliMissing", { cli: d.cli }) });
        else if (d.drift) lines.push({ level: "fail", text: t(lang, "doctor.cliDrift", { cli: d.cli }) });
        else if (d.integrated) lines.push({ level: "ok", text: t(lang, "doctor.cliReady", { cli: d.cli, scopes: d.scopes.join(", ") }) });
        else lines.push({ level: "warn", text: t(lang, "doctor.cliNotIntegrated", { cli: d.cli }) });
        for (const note of d.notes) lines.push({ level: "warn", text: note });
        if (d.installed) lines.push({ level: "ok", text: t(lang, "doctor.auth", { hint: AUTH_HINTS[d.cli] }) });
      }
      const ws = await openWorkspace(ctx, g.cwd);
      const projects = await readProjects(globalHome(ctx));
      for (const project of projects.projects) {
        const ready = await exists(project.root) && await exists(project.brain);
        lines.push({ level: ready ? "ok" : "warn", text: t(lang, ready ? "doctor.project" : "doctor.projectMissing", { name: project.name, root: project.root }) });
      }
      const locations = ws.locations.some((l) => l.scope === "global") ? ws.locations : [...ws.locations, { scope: "global", root: globalHome(ctx) }];
      const brains = [];
      for (const loc of locations) {
        const ready = await exists(join7(loc.root, "EDU.md"));
        const total = ready ? (await openBrain([loc]).stats()).total : 0;
        brains.push({ ...loc, ready, total });
        lines.push(
          ready ? { level: "ok", text: t(lang, "doctor.brain", { scope: loc.scope, root: loc.root, total }) } : { level: "warn", text: t(lang, "doctor.brainMissing", { scope: loc.scope, root: loc.root, flag: loc.scope === "global" ? " --global" : "" }) }
        );
      }
      let vault = { state: "none" };
      if (await exists(join7(ws.primary.root, "config.json"))) {
        const config = await effectiveConfig(ws.primary.root, []);
        if (config.brain.obsidianVault) {
          const link = linkPath(config.brain.obsidianVault, ws.primary);
          vault = { link, state: await linkState(link, brainDir(ws.primary)) };
        }
      }
      if (vault.state === "none") {
        const defaultVault = join7(process.platform === "win32" ? ctx.env.USERPROFILE || ctx.home : ctx.home, "EduVault");
        if (await exists(join7(defaultVault, "Home.md"))) {
          const link = linkPath(defaultVault, ws.primary);
          vault = { link, state: await linkState(link, brainDir(ws.primary)) };
        }
      }
      if (vault.state === "none") lines.push({ level: "warn", text: t(lang, "doctor.vaultNone") });
      else if (vault.state === "ok") lines.push({ level: "ok", text: t(lang, "doctor.vaultOk", { link: vault.link }) });
      else lines.push({ level: "fail", text: t(lang, "doctor.vaultBroken", { link: vault.link }) });
      if (g.json || opts.json) {
        printJson(ctx, { node: process.version, clis, projects: projects.projects, brains, vault, lines });
        return;
      }
      const style = look(ctx);
      ctx.out(t(lang, "doctor.title"));
      for (const line of lines) {
        ctx.out(line.text.startsWith("  ") ? `  ${line.text.trim()}` : statusLine(style, line.level, line.text));
      }
    })
  );
}

// src/detach/engine.ts
import { createHash, randomUUID as randomUUID2 } from "crypto";
import { lstat as lstat3, mkdir as mkdir3, readFile as readFile4, readdir as readdir3, rename as rename2, stat as stat2, writeFile as writeFile2 } from "fs/promises";
import { dirname as dirname4, join as join8, relative as relative2, resolve as resolve6, sep as sep2 } from "path";
var hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
var backupRoot = (home) => join8(home, ".edu", "backups");
async function existingFile(path) {
  try {
    const info = await lstat3(path);
    if (info.isSymbolicLink()) throw new Error(`Refusing symlinked host configuration: ${path}`);
    if (!info.isFile()) return void 0;
    return await readFile4(path);
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
async function referencedTokens(home, config, changes) {
  let tokens = 0;
  for (const key of ["model_instructions_file", "experimental_compact_prompt_file"]) {
    if (!changes.includes(`config: ${key}`)) continue;
    const value = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m").exec(config)?.[1];
    if (!value) continue;
    const path = value.startsWith("~/") ? join8(home, value.slice(2)) : resolve6(home, value);
    try {
      inside(home, path);
      const bytes = await existingFile(path);
      if (bytes) tokens += Math.round(bytes.toString("utf8").length / 4);
    } catch {
    }
  }
  return tokens;
}
function inside(home, path) {
  const rel = relative2(resolve6(home), resolve6(path));
  if (!rel || rel === ".." || rel.startsWith(`..${sep2}`) || rel.startsWith(sep2)) throw new Error(`Host file is outside the supplied home: ${path}`);
  return rel;
}
async function createDetachPlan(input) {
  const tools = assertDetachable(input.tools);
  if (!tools.length) throw new Error("Name at least one tool to detach.");
  const home = resolve6(input.env.USERPROFILE || input.home);
  const files2 = [];
  for (const file of hostFiles(home, input.env, input.hosts)) {
    const rel = inside(home, file.path);
    const before = await existingFile(file.path);
    if (!before) continue;
    const result = editContent(file.kind, file.host, before.toString("utf8"), tools);
    const after = Buffer.from(result.text);
    if (after.equals(before)) continue;
    const tokensSaved = file.kind === "instructions" ? Math.max(0, Math.round((before.toString("utf8").length - result.text.length) / 4)) : file.kind === "toml" ? await referencedTokens(home, before.toString("utf8"), result.changes) : 0;
    files2.push({ host: file.host, path: file.path, relative: rel, before, after, sha256Before: hash(before), sha256After: hash(after), changes: result.changes, tokensSaved });
  }
  return { home, hosts: input.hosts, tools, files: files2, tokensSaved: files2.reduce((n, file) => n + file.tokensSaved, 0) };
}
async function atomicWrite2(path, bytes) {
  const temp = join8(dirname4(path), `.edu-detach-${randomUUID2()}.tmp`);
  const mode = (await stat2(path)).mode;
  try {
    await writeFile2(temp, bytes, { mode });
    await rename2(temp, path);
  } catch (error) {
    await import("fs/promises").then((fs) => fs.rm(temp, { force: true }));
    throw error;
  }
}
async function applyDetach(plan) {
  if (!plan.files.length) throw new Error("No matching integrations found; nothing to detach.");
  for (const file of plan.files) if (hash(await existingFile(file.path) ?? Buffer.alloc(0)) !== file.sha256Before) throw new Error(`Host configuration changed since planning: ${file.path}`);
  const id = `detach-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${randomUUID2().slice(0, 8)}`;
  const root = join8(backupRoot(plan.home), id);
  const manifest = {
    id,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    tools: plan.tools,
    hosts: plan.hosts,
    files: plan.files.map((file) => ({ host: file.host, path: file.relative, sha256Before: file.sha256Before, sha256After: file.sha256After, changes: file.changes }))
  };
  for (const file of plan.files) {
    const backup = join8(root, file.relative);
    await mkdir3(dirname4(backup), { recursive: true });
    await writeFile2(backup, file.before);
  }
  await writeFile2(join8(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}
`);
  const applied = [];
  try {
    for (const file of plan.files) {
      await atomicWrite2(file.path, file.after);
      applied.push(file);
    }
  } catch (error) {
    for (const file of applied.reverse()) await atomicWrite2(file.path, file.before);
    throw error;
  }
  return manifest;
}
async function listDetachBackups(home) {
  try {
    const ids = (await readdir3(backupRoot(home))).filter((id) => /^detach-[\w-]+$/.test(id)).sort().reverse();
    const active = [];
    for (const id of ids) {
      try {
        const manifest = JSON.parse(await readFile4(join8(backupRoot(home), id, "manifest.json"), "utf8"));
        if (!manifest.undoneAt) active.push(id);
      } catch {
      }
    }
    return active;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function undoDetach(input) {
  const id = input.id ?? (await listDetachBackups(input.home))[0];
  if (!id || !/^detach-[\w-]+$/.test(id)) throw new Error("No matching detach backup found.");
  const root = join8(backupRoot(input.home), id);
  const manifest = JSON.parse(await readFile4(join8(root, "manifest.json"), "utf8"));
  if (manifest.id !== id || manifest.undoneAt) throw new Error("Detach backup is invalid or already restored.");
  const restore = [];
  for (const file of manifest.files) {
    const path = join8(input.home, file.path);
    inside(input.home, path);
    const before = await readFile4(join8(root, file.path));
    if (hash(before) !== file.sha256Before) throw new Error(`Backup checksum mismatch: ${file.path}`);
    const current = await existingFile(path);
    if (!current || !input.force && hash(current) !== file.sha256After) throw new Error(`Refusing drifted file: ${file.path}; use --force to overwrite`);
    restore.push({ path, before });
  }
  for (const file of restore) await atomicWrite2(file.path, file.before);
  manifest.undoneAt = (/* @__PURE__ */ new Date()).toISOString();
  await writeFile2(join8(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}
`);
  return { id, restored: manifest.files.map((file) => file.path) };
}

// src/cli/commands/detach.ts
function registerDetach(program, ctx) {
  program.command("detach").description("reversibly remove competing CLI instructions, hooks, MCP servers and plugins").argument("[tools...]", "tool IDs to detach (never edu)").option("--host <hosts>", "comma-separated coding CLI hosts").option("--dry-run", "show planned edits without writing").option("--yes", "apply without prompting").option("--keep-binaries", "do not suggest binary uninstall commands").option("--undo [id]", "restore the latest or named detach backup").option("--list", "list active detach backups").option("--force", "overwrite drifted files during undo").action(action(ctx, async ({ g, opts }, rawTools) => {
    const es = g.lang === "es";
    if (opts.list) {
      const ids = await listDetachBackups(ctx.home);
      ctx.out(ids.length ? ids.join("\n") : es ? "No hay respaldos activos." : "No active detach backups.");
      return;
    }
    if (opts.undo !== void 0) {
      const result = await undoDetach({ home: ctx.home, id: typeof opts.undo === "string" ? opts.undo : void 0, force: opts.force });
      ctx.out(es ? `Restaurado ${result.id}: ${result.restored.join(", ")}` : `Restored ${result.id}: ${result.restored.join(", ")}`);
      return;
    }
    const tools = rawTools?.split(" ").filter(Boolean) ?? [];
    const plan = await createDetachPlan({ home: ctx.home, env: ctx.env, hosts: parseHosts(opts.host), tools });
    const dryRun = opts.dryRun || (!ctx.isTTY || !ctx.stdinIsTTY) && !opts.yes;
    ctx.out(es ? `Plan: ${plan.files.length} archivo(s), ~${plan.tokensSaved} tokens menos.` : `Plan: ${plan.files.length} file(s), ~${plan.tokensSaved} fewer tokens.`);
    for (const host of plan.hosts) {
      const files2 = plan.files.filter((file) => file.host === host);
      if (!files2.length) continue;
      const tokens = files2.reduce((sum, file) => sum + file.tokensSaved, 0);
      ctx.out(es ? `  ${host}: ${files2.length} archivo(s), ~${tokens} tokens; ${files2.flatMap((file) => file.changes).join(", ")}` : `  ${host}: ${files2.length} file(s), ~${tokens} tokens; ${files2.flatMap((file) => file.changes).join(", ")}`);
    }
    if (dryRun || !plan.files.length) {
      ctx.out(es ? "Simulaci\xF3n: no se escribi\xF3 nada." : "Dry run: nothing was written.");
      return;
    }
    if (!opts.yes && !await ctx.confirm(es ? "\xBFAplicar estos cambios con respaldo?" : "Apply these backed-up changes?")) {
      ctx.out(es ? "Cancelado: no se escribi\xF3 nada." : "Cancelled: nothing was written.");
      return;
    }
    const applied = await applyDetach(plan);
    ctx.out(es ? `Aplicado. Respaldo: ${applied.id}. Revertir: edu detach --undo ${applied.id}` : `Applied. Backup: ${applied.id}. Undo: edu detach --undo ${applied.id}`);
    if (!opts.keepBinaries) {
      const suggestions = [
        plan.tools.includes("gentle-ai") && "brew uninstall gentle-ai",
        plan.tools.includes("engram") && "brew uninstall engram",
        plan.tools.includes("moragent") && "npm uninstall -g moragent"
      ].filter(Boolean);
      if (suggestions.length) ctx.out(es ? `Los binarios siguen instalados. Si ya no se necesitan: ${suggestions.join(" \xB7 ")}` : `Binaries remain installed. If no longer needed: ${suggestions.join(" \xB7 ")}`);
    }
  }));
}

// src/cli/commands/evidence.ts
import { readdir as readdir4, readFile as readFile5 } from "fs/promises";
import { join as join9 } from "path";

// src/evidence/metrics.ts
function aggregateMetrics(episodes, options = {}) {
  const selected = episodes.filter((episode) => {
    const time = Date.parse(episode.startedAt);
    return (!options.since || time >= Date.parse(options.since)) && (!options.until || time <= Date.parse(options.until));
  });
  const groups = /* @__PURE__ */ new Map();
  for (const episode of selected) {
    const key = JSON.stringify({ cli: episode.cli, role: episode.role, level: episode.level, window: timeWindow(episode.startedAt, options.window) });
    groups.set(key, [...groups.get(key) ?? [], episode]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const autonomous = rows.filter((episode) => episode.outcome === "autonomous_verified_success").length;
    const verificationRows = rows.flatMap((episode) => episode.verifications);
    const toolCount = rows.reduce((sum, episode) => sum + episode.toolCalls, 0);
    const attributionRows = rows.flatMap((episode) => episode.attributions);
    const completeAttributions = attributionRows.filter((event) => Boolean(event.observed && event.expected && event.failureType && event.next && event.evidence?.length && event.alternatives?.length)).length;
    const byHarnessGap = {};
    for (const episode of rows) for (const intervention of episode.interventions) {
      if (intervention.avoidable && intervention.harnessGap) byHarnessGap[intervention.harnessGap] = (byHarnessGap[intervention.harnessGap] ?? 0) + 1;
    }
    const group = JSON.parse(key);
    return {
      group,
      count: rows.length,
      avsr: autonomous / rows.length,
      mhir: rows.filter((episode) => episode.interventions.some((event) => event.avoidable)).length / rows.length,
      verificationAutonomy: verificationRows.length ? verificationRows.filter((event) => event.kind === "deterministic").length / verificationRows.length : 0,
      toolRecoveryRate: toolCount ? rows.reduce((sum, episode) => sum + episode.recoveredTools, 0) / toolCount : 0,
      attributionCompleteness: attributionRows.length ? completeAttributions / attributionRows.length : 0,
      entropyDelta: rows.reduce((sum, episode) => sum + episode.entropySeverity, 0) / rows.length,
      byHarnessGap
    };
  });
}
function timeWindow(value, unit) {
  if (!unit) return void 0;
  const date = new Date(value);
  if (unit === "day") return date.toISOString().slice(0, 10);
  if (unit === "month") return date.toISOString().slice(0, 7);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

// src/cli/commands/evidence.ts
function registerEvidence(program, ctx) {
  program.command("metrics").description("summarize evidence from recent episode packages").option("--since <window>", "time window, e.g. 30d or an ISO timestamp", "30d").option("--by <dimension>", "group by cli, role, or level", "cli").option("--json", "machine-readable output").action(action(ctx, async ({ g, opts }) => {
    const by = oneOf2(opts.by ?? "cli", ["cli", "role", "level"], "--by");
    const since = parseSince(opts.since ?? "30d");
    const ws = await openWorkspace(ctx, g.cwd);
    const episodes = await readEpisodes(join9(ws.primary.root, "runs"));
    const projected = episodes.map((episode) => ({ ...episode, cli: by === "cli" ? episode.cli : void 0, role: by === "role" ? episode.role : void 0, level: by === "level" ? episode.level : void 0 }));
    const rows = aggregateMetrics(projected, { since }).map((group) => ({
      group: group.group[by],
      avsr: group.avsr,
      mhir: group.mhir,
      verificationAutonomy: group.verificationAutonomy,
      toolRecoveryRate: group.toolRecoveryRate,
      attributionCompleteness: group.attributionCompleteness,
      entropyDelta: group.entropyDelta,
      n: group.count
    }));
    if (opts.json || g.json) return printJson(ctx, rows);
    ctx.out(`${by.padEnd(8)} AVSR   M-HIR  verify-auto  tool-recovery  attribution  entropy  n`);
    for (const row of rows) ctx.out(`${String(row.group ?? "unknown").padEnd(8)} ${pct(row.avsr)} ${pct(row.mhir)} ${pct(row.verificationAutonomy)} ${pct(row.toolRecoveryRate)} ${pct(row.attributionCompleteness)} ${row.entropyDelta.toFixed(2).padStart(7)} ${row.n}`);
    if (!rows.length) ctx.out("No episode packages in this window.");
  }));
  const checks = program.command("checks").description("manage deterministic checks under .edu/harness/checks.json");
  checks.command("list").description("list registered deterministic checks").option("--json", "machine-readable output").action(action(ctx, async ({ g, opts }) => {
    const items = await loadChecks(g.cwd);
    if (opts.json || g.json) return printJson(ctx, items);
    if (!items.length) return ctx.out("No deterministic checks registered.");
    for (const item of items) ctx.out(`${item.id}  [${item.requirementIds.join(", ")}]  ${item.command}`);
  }));
  checks.command("add").description("register a deterministic shell check").requiredOption("--id <id>", "unique check id").requiredOption("--req <ids>", "comma-separated requirement ids").requiredOption("--cmd <command>", "shell command to run").option("--expect-stdout <text>", "required stdout substring").option("--expect-exit <code>", "expected exit code", "0").option("--timeout <ms>", "timeout in milliseconds", "30000").option("--json", "machine-readable output").action(action(ctx, async ({ g, opts }) => {
    const id = opts.id?.trim() ?? "";
    const requirementIds = (opts.req ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const command = opts.cmd?.trim() ?? "";
    if (!id || !requirementIds.length || !command) throw new Error("--id, --req, and --cmd must not be empty");
    const exitCode = integer(opts.expectExit ?? "0", "--expect-exit", 0);
    const timeoutMs = integer(opts.timeout ?? "30000", "--timeout", 1);
    const current = await loadChecks(g.cwd);
    if (current.some((item2) => item2.id === id)) throw new Error(`A check with id "${id}" already exists`);
    const item = { id, requirementIds, command, expect: { exitCode, ...opts.expectStdout !== void 0 ? { stdoutIncludes: opts.expectStdout } : {} }, timeoutMs };
    await saveChecks(g.cwd, [...current, item]);
    if (opts.json || g.json) return printJson(ctx, item);
    ctx.out(`Added check ${id}.`);
  }));
  checks.command("run").description("run every registered deterministic check").option("--json", "machine-readable output").action(action(ctx, async ({ g, opts }) => {
    const items = await loadChecks(g.cwd);
    const results = await Promise.all(items.map((item) => runCheck(item, g.cwd)));
    if (opts.json || g.json) printJson(ctx, results);
    else {
      for (const result of results) ctx.out(`${result.ok ? "\u2713" : "\u2717"} ${result.checkId}: ${result.output.replace(/\s+/g, " ").trim()}`);
      if (!results.length) ctx.out("No deterministic checks registered.");
    }
    if (results.some((result) => !result.ok)) ctx.setExitCode(1);
  }));
}
async function readEpisodes(root) {
  let entries;
  try {
    entries = await readdir4(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const summaries = [];
  for (const item of entries.filter((value) => value.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const entry = item.name;
    const dir = join9(root, entry);
    const [task, outcome, interventions, verifications, attributions, tools, entropy] = await Promise.all([
      json(join9(dir, "task.json")),
      json(join9(dir, "outcome.json")),
      jsonl(join9(dir, "intervention.jsonl")),
      jsonl(join9(dir, "verification.jsonl")),
      jsonl(join9(dir, "attribution.jsonl")),
      jsonl(join9(dir, "tool.jsonl")),
      json(join9(dir, "entropy.json"))
    ]);
    const metrics = object2(outcome.metrics);
    const start = (await jsonl(join9(dir, "action.jsonl"))).find((event) => event.type === "run.start");
    if (!start) continue;
    const label = outcome.label;
    if (!["autonomous_verified_success", "assisted_verified_success", "unverified_success", "failed", "unsafe_invalid"].includes(label)) continue;
    const level = metrics.harnessLevel;
    const toolCalls = tools.filter((event) => event.type === "tool.call");
    const recoveredTools = countRecoveredTools(tools);
    const findings = Array.isArray(entropy.findings) ? entropy.findings : [];
    summaries.push({
      runId: typeof task.runId === "string" ? task.runId : entry,
      ...typeof metrics.cli === "string" ? { cli: metrics.cli } : {},
      ...typeof metrics.role === "string" ? { role: metrics.role } : {},
      ...level ? { level } : {},
      startedAt: String(start.at ?? ""),
      outcome: label,
      interventions: interventions.filter((event) => event.type === "intervention"),
      verifications,
      toolCalls: toolCalls.length,
      recoveredTools,
      attributions,
      entropySeverity: findings.reduce((max, finding) => Math.max(max, Number(object2(finding).severity) || 0), 0)
    });
  }
  return summaries;
}
function countRecoveredTools(events) {
  const calls = /* @__PURE__ */ new Map();
  const failed = /* @__PURE__ */ new Set();
  let recovered = 0;
  for (const event of events) {
    if (event.type === "tool.call") {
      const key = JSON.stringify([event.agentId, event.tool, event.input]);
      calls.set(String(event.callId), key);
    } else if (event.type === "tool.result") {
      const key = calls.get(String(event.callId));
      if (!key) continue;
      if (event.ok === false) failed.add(key);
      else if (event.ok === true && failed.has(key)) {
        recovered++;
        failed.delete(key);
      }
    }
  }
  return recovered;
}
async function json(path) {
  try {
    return object2(JSON.parse(await readFile5(path, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}
async function jsonl(path) {
  try {
    return (await readFile5(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => object2(JSON.parse(line)));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
function object2(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function oneOf2(value, choices, flag) {
  if (!choices.includes(value)) throw new Error(`${flag} must be one of ${choices.join(", ")}`);
  return value;
}
function integer(value, flag, minimum) {
  if (!/^\d+$/.test(value) || Number(value) < minimum || !Number.isSafeInteger(Number(value))) throw new Error(`${flag} must be an integer >= ${minimum}`);
  return Number(value);
}
function parseSince(value) {
  const relative3 = /^(\d+)([dhw])$/.exec(value);
  if (relative3) {
    const units = { d: 864e5, h: 36e5, w: 6048e5 };
    const time2 = Date.now() - Number(relative3[1]) * units[relative3[2]];
    return new Date(time2).toISOString();
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error("--since must be a duration such as 30d or a valid date");
  return new Date(time).toISOString();
}
function pct(value) {
  return `${(value * 100).toFixed(0)}%`.padStart(6);
}

// src/cli/hooks.ts
import { join as join10 } from "path";

// src/cli/statusline.ts
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
function parseJsonObject(text) {
  if (!text.trim()) return void 0;
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
function ctxPercentFromClaude(input) {
  if (!input) return void 0;
  const direct = num(input.ctxPercent);
  if (direct !== void 0) return direct;
  const win = input.context_window;
  if (!isObject(win)) return void 0;
  const used = num(win.used_percentage);
  if (used !== void 0) return used;
  const size = num(win.context_window_size);
  if (!size || size <= 0) return void 0;
  const current = win.current_usage;
  if (isObject(current)) {
    const tokens = (num(current.input_tokens) ?? 0) + (num(current.cache_creation_input_tokens) ?? 0) + (num(current.cache_read_input_tokens) ?? 0);
    return tokens / size * 100;
  }
  const total = num(win.total_input_tokens);
  return total === void 0 ? void 0 : total / size * 100;
}
function claudeCwd(input) {
  if (!input) return void 0;
  const ws = input.workspace;
  if (isObject(ws) && typeof ws.current_dir === "string") return ws.current_dir;
  return typeof input.cwd === "string" ? input.cwd : void 0;
}
async function statuslineText(ctx, cwd, stdinText) {
  const input = parseJsonObject(stdinText);
  const { brain, primary } = await openWorkspace(ctx, claudeCwd(input) ?? cwd);
  const [stats, name] = await Promise.all([brain.stats(), identityName(primary.root)]);
  return renderStatusline(
    { brainNotes: stats.total, lessons: lessonCount(stats.byStatus), ctxPercent: ctxPercentFromClaude(input) },
    { glyphs: getGlyphs(ctx.env), name }
  );
}

// src/cli/hooks.ts
var str = (v) => typeof v === "string" && v.trim() ? v : void 0;
var clip = (text, max) => text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
var short = (id) => id.slice(0, 8);
async function safeHook(ctx, name, body) {
  try {
    await body();
  } catch (error) {
    ctx.err(`edu hook ${name}: ${error instanceof Error ? error.message : String(error)} (ignored)`);
  }
  ctx.setExitCode(0);
}
async function initializedWorkspace(ctx, cwd) {
  const ws = await openWorkspace(ctx, cwd);
  return await exists(join10(ws.primary.root, "EDU.md")) ? ws : void 0;
}
async function sessionStart(ctx, cwd) {
  const input = parseJsonObject(await ctx.readStdin(500));
  const ws = await initializedWorkspace(ctx, str(input?.cwd) ?? cwd);
  if (!ws) return;
  const { brief } = await import("./context-MR5QAK4B.js");
  const text = await brief(ws.brain, 1500, { eduMdPath: join10(ws.primary.root, "EDU.md") });
  if (text.trim()) ctx.out(text);
}
async function sessionEnd(ctx, cwd) {
  const input = parseJsonObject(await ctx.readStdin(1e3));
  const sessionId = str(input?.session_id);
  if (!input || !sessionId) throw new Error("expected Claude SessionEnd JSON with session_id on stdin");
  const ws = await initializedWorkspace(ctx, str(input.cwd) ?? cwd);
  if (!ws) return;
  const transcript = str(input.transcript_path);
  const reason = str(input.reason);
  const summary = [
    `Claude Code session ${sessionId} ended${reason ? ` (${reason})` : ""}.`,
    transcript ? `Transcript: ${transcript}` : "Transcript: not reported."
  ].join("\n");
  const note = await ws.brain.openSession(`Claude Code session ${short(sessionId)}`, "claude");
  await ws.brain.closeSession(note.meta.id, summary);
}
async function codexNotify(ctx, cwd, payload) {
  const input = parseJsonObject(payload ?? "");
  if (!input) throw new Error("expected Codex notify JSON as the last argument");
  if (input.type !== "agent-turn-complete") return;
  const ws = await initializedWorkspace(ctx, str(input.cwd) ?? cwd);
  if (!ws) return;
  const thread = str(input["thread-id"]) ?? str(input["turn-id"]) ?? "unknown";
  const messages = Array.isArray(input["input-messages"]) ? input["input-messages"].filter((m) => typeof m === "string") : [];
  const last = str(input["last-assistant-message"]);
  const summary = [
    `Codex turn completed (thread ${thread}).`,
    messages[0] ? `Asked: ${clip(messages[0], 200)}` : void 0,
    last ? `Answered: ${clip(last, 400)}` : void 0
  ].filter(Boolean).join("\n");
  const note = await ws.brain.openSession(`Codex turn ${short(thread)}`, "codex");
  await ws.brain.closeSession(note.meta.id, summary);
}

// src/cli/commands/integrations.ts
function registerIntegrations(program, ctx) {
  program.command("mcp").description("serve the brain over MCP (stdio) for any MCP-capable CLI").action(
    action(ctx, async ({ g }) => {
      const { runStdioServer } = await import("./stdio-XIYUGTZ6.js");
      await runStdioServer({ cwd: g.cwd, env: { ...ctx.env, HOME: ctx.env.HOME ?? ctx.home } });
    })
  );
  program.command("statusline").description("one status line for Claude Code (reads its statusline JSON from stdin)").action(async (_opts, cmd) => {
    const g = resolveGlobals(ctx, cmd.optsWithGlobals());
    try {
      ctx.out(await statuslineText(ctx, g.cwd, await ctx.readStdin(100)));
    } catch {
      ctx.out("EDU");
    }
  });
  const hook = program.command("hook").description("lifecycle hooks called by coding CLIs (never fail the host)");
  hook.command("session-start").description("print the session brief (Claude SessionStart additional context)").action(async (_opts, cmd) => {
    const g = resolveGlobals(ctx, cmd.optsWithGlobals());
    await safeHook(ctx, "session-start", () => sessionStart(ctx, g.cwd));
  });
  hook.command("session-end").description("record the finished session as a closed episode (Claude SessionEnd JSON on stdin)").action(async (_opts, cmd) => {
    const g = resolveGlobals(ctx, cmd.optsWithGlobals());
    await safeHook(ctx, "session-end", () => sessionEnd(ctx, g.cwd));
  });
  hook.command("codex-notify").description("record a completed Codex turn (notify JSON as the last argument)").argument("[payload...]", "notify JSON").action(async (payload, _opts, cmd) => {
    const g = resolveGlobals(ctx, cmd.optsWithGlobals());
    await safeHook(ctx, "codex-notify", () => codexNotify(ctx, g.cwd, payload?.at(-1)));
  });
}

// src/cli/commands/learn.ts
import { join as join11 } from "path";
function tokenTable(pack, glyphs) {
  const width = Math.max(7, ...pack.sections.map((s) => s.title.length));
  const rule = glyphs.rule.repeat(width + 20);
  const rows = pack.sections.map((s) => `${s.title.padEnd(width)}  ${String(s.tokens).padStart(6)}  ${String(s.noteIds.length).padStart(5)}`);
  return [
    `${"section".padEnd(width)}  ${"tokens".padStart(6)}  ${"notes".padStart(5)}`,
    rule,
    ...rows,
    rule,
    `${"total".padEnd(width)}  ${String(pack.tokens).padStart(6)}  of ${formatTokens(pack.budgetTokens)}`
  ];
}
function registerLearn(program, ctx) {
  program.command("context").description("show the context pack Edu would inject, with a token table").option("--query <q>", "focus the pack on a topic").option("--budget <n>", "token budget (default: config)").option("--json", "machine-readable output").action(
    action(ctx, async ({ g, opts }) => {
      const ws = await openWorkspace(ctx, g.cwd);
      const config = await effectiveConfig(ws.primary.root, []);
      const budgetTokens = opts.budget ? parseIntOption(opts.budget, "--budget") : config.context.budgetTokens;
      const { buildContext } = await import("./context-MR5QAK4B.js");
      const pack = await buildContext(ws.brain, { budgetTokens, ...opts.query ? { query: opts.query } : {} }, { eduMdPath: join11(ws.primary.root, "EDU.md"), trackUsage: false });
      if (g.json || opts.json) return printJson(ctx, pack);
      const { glyphs } = look(ctx);
      ctx.out(t(g.lang, "context.title", { tokens: pack.tokens, budget: pack.budgetTokens }));
      ctx.out("");
      ctx.out(pack.text);
      ctx.out("");
      for (const line of tokenTable(pack, glyphs)) ctx.out(line);
      if (pack.deferred.length) ctx.out(t(g.lang, "context.deferred", { count: pack.deferred.length }));
    })
  );
  program.command("reflect").description("learn from recent episodes: lessons, hypotheses, skill proposals").option("--since <window>", "how far back to look (e.g. 7d, 24h)", "7d").option("--json", "machine-readable output").action(
    action(ctx, async ({ g, opts }) => {
      const ws = await openWorkspace(ctx, g.cwd);
      const episodes = await ws.brain.list({ tier: "episodic", kind: "session", status: "closed" });
      if (!episodes.length) {
        if (g.json || opts.json) return printJson(ctx, { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: 0, message: "Nothing to reflect yet." });
        return ctx.out("Nothing to reflect yet.");
      }
      const available = await ctx.detectClis();
      if (!available.length) throw new Error(t(g.lang, "reflect.noCli"));
      const config = await effectiveConfig(ws.primary.root, available);
      const cli = available.includes(config.defaultCli) ? config.defaultCli : available[0];
      const [{ reflect }, { createEngine }] = await Promise.all([import("./reflect-AIQCSUYV.js"), import("./engine-TYTKXRE6.js")]);
      const report = await reflect({ brain: ws.brain, engine: createEngine(cli), since: opts.since ?? "7d", brainRoot: ws.primary.root });
      if (g.json || opts.json) return printJson(ctx, report);
      if (report.message) return ctx.out(report.message);
      ctx.out(t(g.lang, "reflect.done", {
        episodes: report.episodesRead,
        lessons: report.lessons.length,
        hypotheses: report.hypotheses.length,
        skills: report.skillProposals.length,
        canonical: report.canonicalProposals.length
      }));
      for (const p of report.skillProposals) ctx.out(`  ${p.id}  ${p.path}`);
    })
  );
  const proposals = program.command("proposals").description("review self-improvement proposals (never applied without you)");
  proposals.command("list").description("proposals waiting for a decision").option("--json", "machine-readable output").action(
    action(ctx, async ({ g, opts }) => {
      const ws = await openWorkspace(ctx, g.cwd);
      const { listProposals } = await import("./reflect-AIQCSUYV.js");
      const items = (await listProposals(ws.brain, ws.primary.root)).filter((p) => p.status === "proposed");
      if (g.json || opts.json) return printJson(ctx, items);
      if (!items.length) return ctx.out(t(g.lang, "proposals.empty"));
      for (const p of items) ctx.out(`${p.id}  ${p.name}  ${p.rationale}`);
    })
  );
  proposals.command("accept").description("apply a proposal").argument("<id>", "proposal id").action(
    action(ctx, async ({ g }, id) => {
      const ws = await openWorkspace(ctx, g.cwd);
      const { acceptProposal } = await import("./reflect-AIQCSUYV.js");
      const accepted = await acceptProposal(ws.brain, id ?? "", ws.primary.root);
      ctx.out(t(g.lang, "proposals.accepted", { id: accepted.id, path: accepted.path }));
    })
  );
  proposals.command("reject").description("discard a proposal").argument("<id>", "proposal id").action(
    action(ctx, async ({ g }, id) => {
      const ws = await openWorkspace(ctx, g.cwd);
      const { rejectProposal } = await import("./reflect-AIQCSUYV.js");
      await rejectProposal(ws.brain, id ?? "", ws.primary.root);
      ctx.out(t(g.lang, "proposals.rejected", { id: id ?? "" }));
    })
  );
}

// src/cli/commands/watch.ts
function registerWatch(program, ctx) {
  program.command("watch").description("watch crew jobs live: one agent per job, wrapped output, / commands").argument("[jobId]", "only this job (full id or unique prefix)").option("--poll <ms>", "how often to check for new jobs and events", "500").action(
    action(ctx, async ({ g, opts, cmd }, jobId) => {
      const pollMs = parseIntOption(opts.poll ?? "500", "--poll");
      const ws = await openWorkspace(ctx, g.cwd);
      const crew = createCrew({ brainRoot: ws.primary.root, locations: ws.locations, workspaceRoot: g.cwd });
      const disk = fsCrewSource(ws.primary.root, (jobId2) => crew.status(jobId2));
      const source = {
        ...disk,
        // The TUI's job metadata contract predates the persisted approval state.
        // The worker emits agent.status=awaiting-approval in the event stream.
        list: async () => (await crew.status()).map((job) => ({
          id: job.id,
          cli: job.cli,
          task: job.task,
          status: job.status === "awaiting-approval" ? "running" : job.status,
          createdAt: job.createdAt,
          endedAt: job.endedAt,
          summary: job.summary,
          mode: job.mode
        }))
      };
      const id = jobId?.trim() || void 0;
      const { watchInTui, watchPlain } = await import("./watch-WJFF4RKH.js");
      if (!ctx.isTTY) return watchPlain(ctx, { source, jobId: id, lang: g.lang });
      const { cliDispatch, selfRunner } = await import("./commands-JK6IPE3N.js");
      const explicitLang = cmd.optsWithGlobals().lang !== void 0;
      await watchInTui({
        source,
        jobId: id,
        lang: g.lang,
        uiLang: uiLang(g.lang, ctx.env, explicitLang),
        name: await identityName(ws.primary.root),
        pollMs,
        brain: ws.brain,
        dispatch: cliDispatch(selfRunner(), g.cwd)
      });
    })
  );
}

// src/cli/commands/live.ts
import { resolve as resolve7 } from "path";

// src/cli/commands/setup.ts
import { join as join12 } from "path";
var CLI_CHOICES = ["claude", "codex", "pi", "opencode", "agy"];
function parseCli2(value) {
  const id = value.trim().toLowerCase();
  if (!CLI_CHOICES.includes(id)) throw new Error(`Unknown CLI "${value}" (expected ${CLI_CHOICES.join(", ")})`);
  return id;
}
function parseCliList(value) {
  if (value.trim().toLowerCase() === "all") return "all";
  const list = value.split(",").map((v) => v.trim()).filter(Boolean).map(parseCli2);
  if (!list.length) throw new Error("--cli needs at least one CLI");
  return [...new Set(list)];
}
function parseScope(value) {
  if (value === void 0 || value === "project") return "project";
  if (value === "global") return "global";
  throw new Error(`--scope must be project or global, got "${value}"`);
}
function registerSetup(program, ctx) {
  program.command("init").description("create a brain: ./.edu (or ~/.edu with --global), config, roles and skills").option("--global", "initialize the global brain (EDU_HOME or ~/.edu)").option("--name <name>", "identity name", "Edu").option("--cli <cli>", "default CLI (claude, codex, pi, opencode, agy)").action(
    action(ctx, async ({ g, opts }) => {
      const root = opts.global ? globalHome(ctx) : join12(g.cwd, ".edu");
      const detected = await ctx.detectClis();
      const report = await initBrain({
        location: { scope: opts.global ? "global" : "project", root },
        templatesDir: packageTemplatesDir(),
        name: opts.name,
        cli: opts.cli ? parseCli2(opts.cli) : void 0,
        lang: g.lang,
        detected
      });
      if (!opts.global) await registerProject(globalHome(ctx), g.cwd);
      ctx.out(t(g.lang, "init.done", { root: report.root }));
      ctx.out(t(g.lang, report.configCreated ? "init.config.created" : "init.config.kept", { cli: report.defaultCli }));
      ctx.out(t(g.lang, "init.copied", { agents: report.agents.length, skills: report.skills.length }));
      ctx.out("");
      ctx.out(t(g.lang, "init.next"));
      for (const key of ["init.next.install", "init.next.demo", "init.next.run"]) {
        ctx.out(`  ${t(g.lang, key, { cli: report.defaultCli })}`);
      }
    })
  );
  program.command("install").description("connect Edu to your coding CLIs (reversible; recorded in a manifest)").option("--cli <list>", 'comma-separated CLIs, or "all" (default: detected CLIs)').option("--scope <scope>", "project or global", "project").option("--dry-run", "print the plan without writing anything").option("-y, --yes", "apply without asking").option("--json", "machine-readable plan output").action(
    action(ctx, async ({ g, opts }) => {
      const scope = parseScope(opts.scope);
      let clis;
      if (opts.cli) clis = parseCliList(opts.cli);
      else {
        clis = await ctx.detectClis();
        if (!clis.length) throw new Error(t(g.lang, "install.noCli"));
      }
      const { planInstall, describePlan, applyInstall, getManifestPath } = await import("./adapters-NXBNH2DE.js");
      const plan = await planInstall({ clis, scope, root: g.cwd, home: ctx.home, templatesDir: packageTemplatesDir() });
      const json2 = g.json || opts.json;
      if (json2 && opts.dryRun) {
        printJson(ctx, {
          scope: plan.scope,
          root: plan.root,
          actions: plan.actions.map(({ cli, clis: shared, kind, path, description }) => ({ cli, clis: shared ?? [cli], kind, path, description })),
          notes: plan.notes
        });
        return;
      }
      ctx.out(describePlan(plan));
      if (opts.dryRun) {
        ctx.out(t(g.lang, "install.dryRun"));
        return;
      }
      if (!opts.yes) {
        if (!ctx.isTTY || !ctx.stdinIsTTY) throw new Error(t(g.lang, "install.needYes"));
        if (!await ctx.confirm(t(g.lang, "install.confirm"))) {
          ctx.out(t(g.lang, "install.aborted"));
          return;
        }
      }
      const manifest = await applyInstall(plan);
      const manifestPath = getManifestPath(scope, plan.root, plan.home);
      if (json2) printJson(ctx, { manifest: manifestPath, actions: manifest.actions.length });
      else ctx.out(t(g.lang, "install.done", { count: manifest.actions.length, manifest: manifestPath }));
    })
  );
  program.command("uninstall").description("reverse an Edu installation from its manifest").option("--scope <scope>", "project or global", "project").option("--force", "restore even if Edu-managed files were edited since install").action(
    action(ctx, async ({ g, opts }) => {
      const scope = parseScope(opts.scope);
      const { uninstall, getManifestPath } = await import("./adapters-NXBNH2DE.js");
      if (scope === "global") {
        const { setupManifestPath, uninstallSetup } = await import("./setup-LGBBHLVZ.js");
        if (await exists(await setupManifestPath(ctx.home))) {
          await uninstallSetup({ home: ctx.home, force: Boolean(opts.force) });
          ctx.out(t(g.lang, "uninstall.done", { scope }));
          return;
        }
      }
      await uninstall({ manifestPath: getManifestPath(scope, g.cwd, ctx.home), force: Boolean(opts.force) });
      ctx.out(t(g.lang, "uninstall.done", { scope }));
    })
  );
}

// src/cli/commands/live.ts
function printPlain(ctx, events) {
  const format = createPlainFormatter(getGlyphs(ctx.env));
  for (const event of events) {
    const line = format(event);
    if (line) ctx.out(line);
  }
}
async function openHome(ctx, g) {
  const { shouldRunFirstSetup, runPluginSetup } = await import("./plugins-Q5HFCYEZ.js");
  if (await shouldRunFirstSetup(ctx)) {
    await runPluginSetup(ctx, g);
    return;
  }
  const style = look(ctx);
  const ws = await openWorkspace(ctx, g.cwd);
  const [stats, name, clis] = await Promise.all([ws.brain.stats(), identityName(ws.primary.root), ctx.detectClis()]);
  ctx.out(renderBanner({ unicode: style.glyphs.unicode, theme: style.theme, name, version: packageVersion() }));
  ctx.out("");
  ctx.out(t(g.lang, "home.brain", { total: stats.total, lessons: lessonCount(stats.byStatus) }));
  ctx.out(clis.length ? t(g.lang, "home.clis", { clis: clis.join(", ") }) : t(g.lang, "home.noClis"));
  ctx.out(t(g.lang, "home.hint"));
  const { runHome } = await import("./live-TY2JNK47.js");
  await runHome(ctx, { cwd: g.cwd, lang: g.lang, name });
}
function modeFrom(opts) {
  if (opts.solo && opts.crew) throw new Error("choose one of --solo or --crew");
  return opts.solo ? "solo" : opts.crew ? "crew" : void 0;
}
function harnessFrom(value) {
  if (value === void 0) return void 0;
  const harness = value;
  if (!["H0", "H1", "H2", "H3"].includes(harness)) throw new Error("--harness must be H0, H1, H2, or H3");
  return harness;
}
function registerLive(program, ctx) {
  program.command("run").description("run a goal: plan, approve, execute, review, learn").argument("<goal...>", "what you want done").option("--solo", "one CLI plays every role").option("--crew", "roles mapped to different CLIs").option("--cli <cli>", "CLI to use as the default engine").option("--harness <level>", "evidence support level: H0 | H1 | H2 | H3").option("--playbook <name>", "method to use for this run").option("--detach", "run as a watchable crew job").option("-y, --yes", "approve every step automatically").action(
    action(ctx, async ({ g, opts }, goal) => {
      const mode = modeFrom(opts);
      const harnessLevel = harnessFrom(opts.harness);
      const cli = opts.cli ? parseCli2(opts.cli) : void 0;
      const text = (goal ?? "").trim();
      if (!text) throw new Error("a goal is required");
      if (opts.detach) {
        const { createCrew: createCrew2 } = await import("./crew-J2AXH2ON.js");
        const ws = await openWorkspace(ctx, g.cwd);
        const job = await createCrew2({ brainRoot: ws.primary.root, locations: ws.locations, workspaceRoot: g.cwd, engineFactory: ctx.engineFactory, detectClis: ctx.detectClis }).orchestrate({
          goal: text,
          cwd: g.cwd,
          mode,
          cli,
          harnessLevel,
          playbook: opts.playbook,
          autoApprove: Boolean(opts.yes)
        });
        ctx.out(JSON.stringify(job));
        return;
      }
      if (ctx.isTTY) {
        const ws = await openWorkspace(ctx, g.cwd);
        const { runInTui } = await import("./live-TY2JNK47.js");
        const result = await runInTui(ctx, { goal: text, cwd: g.cwd, lang: g.lang, mode, harnessLevel, cli, playbook: opts.playbook, autoApprove: Boolean(opts.yes), name: await identityName(ws.primary.root) });
        if (result) ctx.out(t(g.lang, "run.done", { status: t(g.lang, result.ok ? "run.ok" : "run.failed"), summary: result.summary }));
        if (!result?.ok) ctx.setExitCode(1);
        return;
      }
      await runPlain(ctx, g, text, mode, cli, harnessLevel, opts.playbook, Boolean(opts.yes));
    })
  );
  program.command("ui").description("open the live view, or replay a recorded run").option("--replay <file>", "runs/<id>.jsonl to replay").option("--speed <n>", "replay speed multiplier", "1").action(
    action(ctx, async ({ g, opts }) => {
      if (!opts.replay) {
        if (ctx.isTTY) await openHome(ctx, g);
        else ctx.out(program.helpInformation());
        return;
      }
      const speed = parsePositive(opts.speed ?? "1", "--speed");
      const { loadRun, timedEvents } = await import("./replay-MTGKHMKG.js");
      const run = await loadRun(opts.replay);
      for (const issue of run.issues) ctx.err(`${opts.replay}:${issue.line}: ${issue.message} (skipped)`);
      if (!ctx.isTTY) return printPlain(ctx, run.events);
      const { playInTui } = await import("./live-TY2JNK47.js");
      await playInTui(timedEvents(run.events, { speed, maxDelayMs: 2e3 }), "Edu", uiLang(g.lang, ctx.env));
    })
  );
  program.command("demo").description("watch a scripted crew in the live view (no LLM needed)").option("--speed <n>", "playback speed multiplier", "1").option("--save <file>", "save the demo event stream as JSONL for replay").action(
    action(ctx, async ({ g, opts }) => {
      const speed = parsePositive(opts.speed ?? "1", "--speed");
      const { demoEvents } = await import("./demo-WF3HATVH.js");
      const events = demoEvents();
      if (opts.save) await atomicWrite(resolve7(g.cwd, opts.save), `${events.map((event) => JSON.stringify(event)).join("\n")}
`);
      if (!ctx.isTTY) {
        ctx.out(t(g.lang, "demo.plain"));
        return printPlain(ctx, events);
      }
      const [{ timedEvents }, { playInTui }] = await Promise.all([import("./replay-MTGKHMKG.js"), import("./live-TY2JNK47.js")]);
      await playInTui(timedEvents(events, { speed }), "Edu", uiLang(g.lang, ctx.env));
    })
  );
}
async function runPlain(ctx, g, goal, mode, cli, harnessLevel, playbook, yes) {
  const available = ctx.availableClis ?? await ctx.detectClis();
  if (!available.length) throw new Error(t(g.lang, "run.noCli"));
  if (!yes && !ctx.stdinIsTTY) throw new Error("Plain runs require --yes when stdin is not a TTY");
  const { executeRun } = await import("./session-KSGNSRZM.js");
  const format = createPlainFormatter(getGlyphs(ctx.env));
  const abort = new AbortController();
  const onSigint = () => {
    ctx.err(t(g.lang, "run.cancelling"));
    abort.abort();
  };
  process.once("SIGINT", onSigint);
  try {
    const result = await executeRun(ctx, {
      goal,
      cwd: g.cwd,
      lang: g.lang,
      mode,
      cli,
      harnessLevel,
      playbook,
      autoApprove: yes,
      engines: ctx.engineFactory,
      available,
      signal: abort.signal,
      onEvent: (event) => {
        const line = format(event);
        if (line) ctx.out(line);
      },
      approve: async (request) => yes || ctx.confirm(request.title)
    });
    if (!result.ok) ctx.setExitCode(1);
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

// src/cli/commands/vault.ts
import { join as join14, resolve as resolve9 } from "path";

// src/vault/vault.ts
import { randomBytes } from "crypto";
import { access, copyFile, mkdir as mkdir4, readFile as readFile6, readdir as readdir5, realpath as realpath4, writeFile as writeFile3 } from "fs/promises";
import { basename as basename4, dirname as dirname5, join as join13, posix, resolve as resolve8, win32 as win322 } from "path";
var START = "<!-- edu:projects -->";
var END = "<!-- /edu:projects -->";
var IGNORED = ["runs/", "crew/", "proposals/", "backups/"];
function pathParts(path, platform) {
  const api = platform === "win32" ? win322 : posix;
  return api.resolve(path).split(/[\\/]+/).filter(Boolean).map((part) => platform === "win32" ? part.toLowerCase() : part);
}
function unsafeVaultPathReason(path, home, platform) {
  const api = platform === "win32" ? win322 : posix;
  const vault = api.resolve(path);
  const userHome = api.resolve(home);
  const compare = (value) => platform === "win32" ? value.toLowerCase() : value;
  if (compare(vault) === compare(api.parse(vault).root)) return "a drive or filesystem root";
  const relative3 = api.relative(vault, userHome);
  if (relative3 === "" || relative3 !== ".." && !relative3.startsWith(`..${api.sep}`) && !api.isAbsolute(relative3)) {
    return "the home folder or one of its ancestors";
  }
  const segments = pathParts(vault, platform).map((part) => part.toLowerCase());
  if (segments.includes(".edu")) return "an application, system, or project-brain folder";
  const insideHome = relative3 === ".." || relative3.split(api.sep).every((part) => part === "..");
  if (insideHome) {
    const fromHome = api.relative(userHome, vault).split(/[\\/]+/).filter(Boolean).map((part) => part.toLowerCase());
    if (fromHome[0] && (/* @__PURE__ */ new Set(["appdata", "library", ".config", ".local", ".cache"])).has(fromHome[0])) {
      return "an application, system, or project-brain folder";
    }
  }
  const top = platform === "win32" && segments[0]?.endsWith(":") ? segments[1] : segments[0];
  const system = platform === "win32" ? /* @__PURE__ */ new Set(["windows", "program files", "program files (x86)", "programdata"]) : /* @__PURE__ */ new Set(["etc", "usr", "bin", "sbin", "system", "library", "opt", "private", "var"]);
  if (top && system.has(top) && !(platform !== "win32" && isTempPath(vault))) return "an application, system, or project-brain folder";
  return void 0;
}
function isTempPath(path) {
  return /^\/(private\/)?(var\/folders|tmp)\//.test(path);
}
async function exists2(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function physicalCandidate(path) {
  let ancestor = path;
  const suffix = [];
  while (true) {
    try {
      return resolve8(await realpath4(ancestor), ...suffix.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname5(ancestor);
      if (parent === ancestor) throw error;
      suffix.push(basename4(ancestor));
      ancestor = parent;
    }
  }
}
function segment(name) {
  if (!name || name === "." || name === ".." || name === "_global" || /[\\/\0-\x1f]/.test(name)) {
    throw new Error(`Invalid project link name: ${name}`);
  }
  return name;
}
function projectList(projects) {
  return projects.map((project) => `- [[Edu/${segment(project.name)}/0-index/INDEX]]`).join("\n");
}
function homePage(name, projects) {
  return `# ${name}

Edu links your project brains here; it does not copy them.
Open a project below to browse its memory.
Only Edu writes to the linked brains.
Keep personal drafts in Notes/.
Use edu remember or an Edu MCP tool to save memory.
Run edu vault again after initializing another project.

${START}
${projectList(projects)}
${END}
`;
}
function refreshProjects(text, projects) {
  const start = text.indexOf(START);
  const end = text.indexOf(END, start + START.length);
  if (start < 0 || end < 0) throw new Error("Home.md has no Edu project markers; refusing to overwrite user text");
  return `${text.slice(0, start + START.length)}
${projectList(projects)}
${text.slice(end)}`;
}
async function validatePath(path, home, platform) {
  const reason = unsafeVaultPathReason(path, home, platform);
  if (reason) throw new Error(`Unsafe vault path (${reason}): Obsidian walks the whole tree and can hit EPERM or become very slow`);
  const physical = await physicalCandidate(path);
  const physicalHome = await physicalCandidate(home).catch(() => home);
  const physicalReason = unsafeVaultPathReason(physical, physicalHome, platform);
  if (physicalReason) throw new Error(`Unsafe vault path (${physicalReason}): ${physical}`);
  if (await exists2(path)) {
    if (await exists2(join13(path, ".edu"))) throw new Error("Unsafe vault path: this folder contains a project brain (.edu/)");
  }
}
async function createVault(options) {
  const platform = options.platform ?? process.platform;
  const path = resolve8(options.path);
  await validatePath(path, options.home, platform);
  const projects = (await readProjects(options.eduHome)).projects;
  const current = await readdir5(path).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const homeFile = join13(path, "Home.md");
  if (current.length && !(await exists2(homeFile) && (await readFile6(homeFile, "utf8")).includes(START))) {
    throw new Error(`Folder is not empty and is not an Edu vault: ${path}`);
  }
  await mkdir4(join13(path, ".obsidian"), { recursive: true });
  await mkdir4(join13(path, "Edu"), { recursive: true });
  await mkdir4(join13(path, "Notes"), { recursive: true });
  const appFile = join13(path, ".obsidian", "app.json");
  if (!await exists2(appFile)) await writeFile3(appFile, `${JSON.stringify({ userIgnoreFilters: IGNORED }, null, 2)}
`);
  const notesReadme = join13(path, "Notes", "README.md");
  if (!await exists2(notesReadme)) await writeFile3(notesReadme, "# Notes\n\nKeep your own notes and drafts here. Edu does not write memory into this folder.\n");
  const name = options.name?.trim() || "Edu";
  const original = await readFile6(homeFile, "utf8").catch((error) => {
    if (error.code === "ENOENT") return void 0;
    throw error;
  });
  const nextHome = original === void 0 ? homePage(name, projects) : refreshProjects(original, projects);
  if (nextHome !== original) await writeFile3(homeFile, nextHome);
  const linked = [];
  const conflicts = [];
  const missingProjects = [];
  const entries = [
    ...projects.map((project) => ({ name: segment(project.name), target: project.brain, project: true })),
    { name: "_global", target: join13(options.eduHome, "brain"), project: false }
  ];
  for (const entry of entries) {
    if (entry.project && !await exists2(entry.target)) {
      missingProjects.push(entry.name);
      continue;
    }
    const link = join13(path, "Edu", entry.name);
    try {
      await createVaultLink(link, entry.target, platform);
      linked.push(entry.name);
      await openBrain([{ scope: entry.project ? "project" : "global", root: dirname5(entry.target) }]).rebuildIndex().catch(() => void 0);
    } catch (error) {
      if (error.code !== "ELINKCONFLICT") throw error;
      conflicts.push(link);
    }
  }
  const registration = options.register === false ? "skipped (--no-register)" : await registerObsidianVault(path, { home: options.home, platform, env: options.env ?? process.env, now: options.now });
  return { path, name, linked, conflicts, missingProjects, registration };
}
async function registerObsidianVault(vault, options) {
  const config = options.platform === "win32" ? join13(options.env.APPDATA || join13(options.home, "AppData", "Roaming"), "obsidian") : options.platform === "darwin" ? join13(options.home, "Library", "Application Support", "obsidian") : join13(options.home, ".config", "obsidian");
  const configFile = join13(config, "obsidian.json");
  if (!await exists2(configFile)) return "skipped (Obsidian not installed)";
  const parsed = JSON.parse(await readFile6(configFile, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid Obsidian obsidian.json");
  const data = parsed;
  if (data.vaults !== void 0 && (!data.vaults || typeof data.vaults !== "object" || Array.isArray(data.vaults))) throw new Error("Invalid Obsidian vault list");
  data.vaults ??= {};
  if (Object.values(data.vaults).some((entry) => resolve8(entry.path ?? "") === resolve8(vault))) return "already registered";
  const now = options.now ?? /* @__PURE__ */ new Date();
  const stamp = now.toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
  await copyFile(configFile, `${configFile}.${stamp}.${randomBytes(3).toString("hex")}.bak`);
  data.vaults[randomBytes(8).toString("hex")] = { path: resolve8(vault), ts: now.getTime(), open: false };
  await writeFile3(configFile, `${JSON.stringify(data, null, 2)}
`);
  return "registered";
}
async function countNotes(dir) {
  let count = 0;
  for (const entry of await readdir5(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && entry.name === "0-index") continue;
    if (entry.isDirectory()) count += await countNotes(join13(dir, entry.name));
    else if (entry.isFile() && entry.name.endsWith(".md")) count++;
  }
  return count;
}
async function checkVault(options) {
  const path = resolve8(options.path);
  const platform = options.platform ?? process.platform;
  const physical = await physicalCandidate(path).catch(() => path);
  const unsafe = unsafeVaultPathReason(path, options.home, platform) ?? unsafeVaultPathReason(physical, await physicalCandidate(options.home).catch(() => options.home), platform) ?? (await exists2(join13(path, ".edu")) ? "contains a project brain" : void 0);
  const projects = (await readProjects(options.eduHome)).projects;
  const entries = [
    ...projects.map((project) => ({ name: segment(project.name), target: project.brain, project: true })),
    { name: "_global", target: join13(options.eduHome, "brain"), project: false }
  ];
  const links = [];
  const missingProjects = [];
  for (const entry of entries) {
    const present = await exists2(entry.target);
    if (!present && entry.project) missingProjects.push(entry.name);
    const state = await linkState(join13(path, "Edu", entry.name), entry.target);
    links.push({
      name: entry.name,
      state: state === "conflict" ? "conflict" : state === "missing" || !present ? "broken" : "ok",
      notes: present ? await countNotes(entry.target) : 0
    });
  }
  const warnings = [];
  for (const entry of await readdir5(path, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || ["Edu", "Notes", ".obsidian"].includes(entry.name)) continue;
    const notes = await countNotes(join13(path, entry.name));
    if (notes >= 20) warnings.push(`${entry.name}/ contains ${notes} notes outside Edu/ and Notes/; another tool may be writing generated notes`);
  }
  return { path, unsafe, links, missingProjects, warnings };
}

// src/cli/commands/vault.ts
function registerVault(program, ctx) {
  program.command("vault").description("create or check a safe Obsidian window onto registered project brains").argument("[path]", "vault directory (default ~/EduVault)").option("--name <name>", "vault title", "Edu").option("--no-register", "do not add the vault to Obsidian").option("--check", "report unsafe paths, broken links and note counts without writing").option("--json", "machine-readable output").action(action(ctx, async ({ g, opts }, path) => {
    const home = process.platform === "win32" ? ctx.env.USERPROFILE || ctx.home : ctx.home;
    const vaultPath = path ? resolve9(g.cwd, path) : join14(home, "EduVault");
    const common = { path: vaultPath, home, eduHome: globalHome(ctx) };
    if (opts.check) {
      const report2 = await checkVault(common);
      if (g.json || opts.json) return printJson(ctx, report2);
      ctx.out(`Vault: ${report2.path}`);
      if (report2.unsafe) ctx.err(`Unsafe vault path: ${report2.unsafe}`);
      for (const link of report2.links) ctx.out(`  ${link.name}: ${link.state} (${link.notes} notes)`);
      for (const name of report2.missingProjects) ctx.err(`Missing registered project: ${name}`);
      for (const warning of report2.warnings) ctx.err(`Warning: ${warning}`);
      if (report2.unsafe || report2.links.some((link) => link.state !== "ok")) ctx.setExitCode(1);
      return;
    }
    const report = await createVault({ ...common, name: opts.name, register: opts.register, env: ctx.env });
    if (g.json || opts.json) return printJson(ctx, report);
    ctx.out(`Edu vault: ${report.path}`);
    ctx.out(`Linked: ${report.linked.join(", ") || "none"}`);
    for (const conflict of report.conflicts) ctx.err(`Link conflict (not replaced): ${conflict}`);
    for (const name of report.missingProjects) ctx.err(`Missing registered project (not removed): ${name}`);
    ctx.out(`Obsidian registration: ${report.registration}`);
    ctx.out(`Next: open Obsidian and choose the ${report.name} vault.`);
  }));
}

// src/cli/program.ts
var GROUPS = [
  ["Get started:", ["init", "vault", "install", "uninstall", "doctor", "detach"]],
  ["Work:", ["run", "ui", "demo", "deck"]],
  ["Brain:", ["brain", "context", "reflect", "proposals", "metrics", "checks"]],
  ["Integrations:", ["mcp", "statusline", "hook"]]
];
function createProgram(overrides = {}, options = {}) {
  const ctx = { ...processContext(), ...overrides };
  const program = new Command("edu");
  if (options.exitOverride) program.exitOverride();
  program.description("an installable, LLM-agnostic agentic harness: a second brain that learns, a crew you can see").version(packageVersion(), "-v, --version", "print the version").helpOption("-h, --help", "show help").option("--cwd <dir>", "run as if started in <dir>").option("--lang <lang>", "message language: en | es").configureOutput({ writeOut: (s) => ctx.out(s.replace(/\n$/, "")), writeErr: (s) => ctx.err(s.replace(/\n$/, "")) }).showSuggestionAfterError(true);
  program.addHelpText("before", () => {
    const glyphs = getGlyphs(ctx.env);
    return `${renderBanner({ unicode: glyphs.unicode, theme: detectTheme(ctx.env, ctx.isTTY), version: packageVersion() })}
`;
  });
  program.action(async (_opts, cmd) => {
    if (cmd.args.length) {
      cmd.unknownCommand();
    }
    const g = resolveGlobals(ctx, cmd.optsWithGlobals());
    if (!ctx.isTTY) {
      program.outputHelp();
      return;
    }
    try {
      await openHome(ctx, g);
    } catch (error) {
      ctx.err(t(g.lang, "error.prefix", { message: error instanceof Error ? error.message : String(error) }));
      ctx.setExitCode(1);
    }
  });
  registerSetup(program, ctx);
  registerVault(program, ctx);
  registerLive(program, ctx);
  registerBrain(program, ctx);
  registerLearn(program, ctx);
  registerDoctor(program, ctx);
  registerDetach(program, ctx);
  registerEvidence(program, ctx);
  registerIntegrations(program, ctx);
  registerPluginSetup(program, ctx);
  registerCrew(program, ctx);
  registerDeck(program, ctx);
  registerWatch(program, ctx);
  for (const [heading, names] of GROUPS) {
    for (const name of names) program.commands.find((c) => c.name() === name)?.helpGroup(heading);
  }
  program.allowExcessArguments(true);
  return program;
}

export {
  createProgram
};
//# sourceMappingURL=chunk-ZVQ7BLNJ.js.map