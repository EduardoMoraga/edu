import {
  initBrain
} from "./chunk-XI7L3C5X.js";
import {
  applyInstall,
  getManifestPath,
  planInstall,
  uninstall
} from "./chunk-ZV65G7PD.js";
import {
  instructionActions
} from "./chunk-ROTDA577.js";

// src/setup/index.ts
import { spawn } from "child_process";
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
var LIST_COMMANDS = {
  claude: { cli: "claude", command: "claude", args: ["plugin", "list"] },
  codex: { cli: "codex", command: "codex", args: ["plugin", "list", "--json"] },
  pi: { cli: "pi", command: "pi", args: ["list"] },
  opencode: { cli: "opencode", command: "opencode", args: ["mcp", "list"] },
  agy: { cli: "agy", command: "agy", args: ["plugin", "list"] }
};
var defaultRunner = ({ command, args }) => new Promise((resolveResult) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.once("error", (error) => resolveResult({ exitCode: 127, stderr: error.message }));
  child.once("close", (code) => resolveResult({ exitCode: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
});
function nativeCommands(cli, packageRoot) {
  switch (cli) {
    case "claude":
      return [
        { cli, command: "claude", args: ["plugin", "marketplace", "add", packageRoot] },
        { cli, command: "claude", args: ["plugin", "install", "edu@edu"] }
      ];
    case "codex":
      return [
        { cli, command: "codex", args: ["plugin", "marketplace", "add", packageRoot] },
        { cli, command: "codex", args: ["plugin", "add", "edu@edu"] }
      ];
    case "pi":
      return [{ cli, command: "pi", args: ["install", packageRoot] }];
    case "agy":
      return [{ cli, command: "agy", args: ["plugin", "install", join(packageRoot, "plugins/agy")] }];
    case "opencode":
      return [];
  }
}
function isCodexInstalledJson(stdout) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    return false;
  }
  if (!value || typeof value !== "object" || !Array.isArray(value.installed)) return false;
  return value.installed.some((entry) => {
    if (typeof entry === "string") return entry.toLowerCase() === "edu@edu";
    if (!entry || typeof entry !== "object") return false;
    const record = entry;
    const id = [record.id, record.pluginId, record.plugin_id, record.selector].find((item) => typeof item === "string");
    if (typeof id === "string" && id.toLowerCase() === "edu@edu") return true;
    const name = [record.name, record.plugin].find((item) => typeof item === "string");
    const marketplace = [record.marketplace, record.marketplaceName, record.marketplace_name].find((item) => typeof item === "string");
    return typeof name === "string" && name.toLowerCase() === "edu" && typeof marketplace === "string" && marketplace.toLowerCase() === "edu";
  });
}
function isInstalled(result, cli) {
  if (result.exitCode !== 0) return false;
  if (cli === "codex") return isCodexInstalledJson(result.stdout ?? "");
  const knownIds = /* @__PURE__ */ new Set(["edu", "edu@edu", "edu-agent"]);
  return (result.stdout ?? "").split(/\r?\n/).some((line) => {
    const first = line.trim().replace(/^[*•✓✔\s]+/, "").split(/\s+/)[0]?.toLowerCase();
    const leaf = first?.split(/[/:]/).at(-1)?.replace(/\.git$/, "");
    return leaf !== void 0 && knownIds.has(leaf);
  });
}
async function collectFiles(root, relative = "") {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, path));
    else if (entry.isFile()) files.push({ path, content: await readFile(join(root, path), "utf8") });
  }
  return files;
}
async function appendOpenCodeAssets(plan, packageRoot) {
  const sourceRoot = join(packageRoot, "plugins/opencode");
  const destinationRoot = join(plan.home, ".config/opencode");
  for (const category of ["commands", "agents", "plugins"]) {
    const source = join(sourceRoot, category);
    let files;
    try {
      files = await collectFiles(source);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`Generated OpenCode ${category} are missing from ${sourceRoot}`);
      throw error;
    }
    if (!files.length) throw new Error(`Generated OpenCode ${category} are empty in ${sourceRoot}`);
    for (const file of files) {
      const action = {
        cli: "opencode",
        kind: "file",
        path: join(destinationRoot, category, file.path),
        description: `Install OpenCode ${category} file ${file.path}`,
        content: file.content
      };
      plan.actions.push(action);
    }
  }
}
async function planSetup(options) {
  const runner = options.runner ?? defaultRunner;
  const commands = [];
  const fallback = [];
  const alreadyInstalled = [];
  for (const cli of [...new Set(options.clis)]) {
    if (cli === "opencode") {
      fallback.push(cli);
      continue;
    }
    const listed = await runner(LIST_COMMANDS[cli]);
    if (isInstalled(listed, cli)) {
      alreadyInstalled.push(cli);
      continue;
    }
    commands.push(...nativeCommands(cli, resolve(options.packageRoot)));
  }
  return { ...options, packageRoot: resolve(options.packageRoot), home: resolve(options.home), commands, fallback, alreadyInstalled };
}
async function writeManifest(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}
`);
  await rename(temp, path);
}
async function applySetup(plan, options = {}) {
  const runner = options.runner ?? plan.runner ?? defaultRunner;
  const report = { installed: [], fallback: [], alreadyInstalled: [...plan.alreadyInstalled], failed: [] };
  const pending = new Set(plan.fallback);
  const successful = /* @__PURE__ */ new Set();
  const failed = /* @__PURE__ */ new Map();
  if (plan.commands.some((c) => c.cli === "codex")) {
    const { mkdir: mkdir2 } = await import("fs/promises");
    await mkdir2(process.env.CODEX_HOME || join(plan.home, ".codex"), { recursive: true }).catch(() => void 0);
  }
  for (const command of plan.commands) {
    if (failed.has(command.cli)) continue;
    const result = await runner(command);
    if (result.exitCode !== 0) failed.set(command.cli, (result.stderr || result.stdout || `exit ${result.exitCode}`).trim());
    else successful.add(command.cli);
  }
  for (const [cli, message] of failed) {
    pending.add(cli);
    report.failed.push({ cli, message });
  }
  for (const cli of successful) if (!pending.has(cli)) report.installed.push(cli);
  let adapterPlan;
  if (pending.size) {
    adapterPlan = await planInstall({ clis: [...pending], scope: "global", root: plan.packageRoot, home: plan.home, templatesDir: options.templatesDir ?? join(plan.packageRoot, "templates") });
    if (pending.has("opencode")) await appendOpenCodeAssets(adapterPlan, plan.packageRoot);
    report.fallback.push(...pending);
  }
  const codexInstalled = successful.has("codex") || plan.alreadyInstalled.includes("codex");
  if (codexInstalled && !pending.has("codex")) {
    const templatesDir = options.templatesDir ?? join(plan.packageRoot, "templates");
    const identityActions = instructionActions("codex", "global", plan.packageRoot, { home: plan.home, templatesDir });
    if (adapterPlan) {
      adapterPlan.actions.push(...identityActions);
    } else {
      adapterPlan = {
        scope: "global",
        root: plan.packageRoot,
        home: plan.home,
        templatesDir,
        notes: [],
        actions: identityActions
      };
    }
  }
  let adapterManifestPath;
  if (adapterPlan) {
    await applyInstall(adapterPlan);
    adapterManifestPath = getManifestPath("global", plan.packageRoot, plan.home);
  }
  const brainRoot = resolve(options.brainRoot ?? process.env.EDU_HOME ?? join(plan.home, ".edu"));
  await initBrain({ location: { scope: "global", root: brainRoot }, templatesDir: options.templatesDir ?? join(plan.packageRoot, "templates"), detected: options.detected ?? plan.clis, lang: options.lang });
  const manifestPath = join(plan.home, ".edu/plugin-setup.json");
  let previous;
  try {
    previous = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifest = {
    version: 1,
    packageRoot: plan.packageRoot,
    native: [.../* @__PURE__ */ new Set([...previous?.native ?? [], ...report.installed])],
    fallback: [.../* @__PURE__ */ new Set([...previous?.fallback ?? [], ...report.fallback])],
    ...adapterManifestPath || previous?.adapterManifestPath ? { adapterManifestPath: adapterManifestPath ?? previous?.adapterManifestPath } : {}
  };
  await writeManifest(join(plan.home, ".edu/plugin-setup.json"), manifest);
  return report;
}
async function setupManifestPath(home) {
  return join(resolve(home), ".edu/plugin-setup.json");
}
async function uninstallSetup(options) {
  const path = await setupManifestPath(options.home);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const runner = options.runner ?? defaultRunner;
  const commands = {
    claude: () => [
      { cli: "claude", command: "claude", args: ["plugin", "uninstall", "edu@edu"] },
      { cli: "claude", command: "claude", args: ["plugin", "marketplace", "remove", "edu"] }
    ],
    codex: () => [
      { cli: "codex", command: "codex", args: ["plugin", "remove", "edu@edu"] },
      { cli: "codex", command: "codex", args: ["plugin", "marketplace", "remove", "edu"] }
    ],
    pi: (root) => [{ cli: "pi", command: "pi", args: ["remove", root] }],
    opencode: () => [],
    agy: () => [{ cli: "agy", command: "agy", args: ["plugin", "uninstall", "edu"] }]
  };
  const failures = [];
  for (const cli of manifest.native) {
    for (const command of commands[cli](manifest.packageRoot)) {
      try {
        const result = await runner(command);
        if (result.exitCode !== 0) failures.push(`${command.command} ${command.args.join(" ")} failed: ${result.stderr || result.stdout || result.exitCode}`);
      } catch (error) {
        failures.push(`${command.command} ${command.args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (manifest.adapterManifestPath) {
    try {
      await uninstall({ manifestPath: manifest.adapterManifestPath, force: options.force });
    } catch (error) {
      failures.push(`Managed adapter cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new AggregateError(failures, failures.join("\n"));
    }
  }
  await unlink(path);
  if (failures.length) throw new AggregateError(failures, failures.join("\n"));
}
async function needsFirstRunSetup(home) {
  try {
    await access(join(home, "config.json"));
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

export {
  planSetup,
  applySetup,
  setupManifestPath,
  uninstallSetup,
  needsFirstRunSetup
};
//# sourceMappingURL=chunk-KSXISGXM.js.map