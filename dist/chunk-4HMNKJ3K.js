import {
  backupUpgradeFiles,
  compareVersions,
  migrateWorkspaces
} from "./chunk-FWZJC5KV.js";
import {
  initBrain
} from "./chunk-CABWE2F6.js";
import {
  UNION,
  applyInstall,
  getManifestPath,
  planInstall,
  readTarget,
  sha256,
  uninstall,
  validateBundleAction
} from "./chunk-QSTE2VXK.js";
import {
  instructionActions,
  pinConfiguredBases,
  skillActions
} from "./chunk-HITNXL4T.js";
import {
  removeManagedBlock,
  upsertManagedBlock
} from "./chunk-DGIFDAPF.js";
import {
  readProjects
} from "./chunk-I6JWASFE.js";
import {
  eduMcpLaunch,
  spawnCli
} from "./chunk-VHSIB24T.js";

// src/setup/native-provenance.ts
import { lstat, readFile, realpath } from "fs/promises";
import { dirname, join, resolve } from "path";
async function captureNativeProvenance(options) {
  const { host, home, packageRoot, runner } = options;
  const envName = host === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
  const envHome = process.env[envName];
  const cwd = process.cwd();
  const hostHome = resolve(envHome || join(home, `.${host}`));
  const marketplace = join(packageRoot, host === "codex" ? ".agents/plugins/marketplace.json" : ".claude-plugin/marketplace.json");
  const pluginRoot = join(packageRoot, "plugins", host === "codex" ? "codex" : "claude-code");
  const paths = [
    marketplace,
    join(packageRoot, "package.json"),
    join(home, ".edu/plugin-setup.json"),
    join(pluginRoot, host === "codex" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json"),
    join(pluginRoot, ".mcp.json")
  ];
  if (host === "codex") paths.push(join(hostHome, "config.toml"));
  else paths.push(...["settings.json", "settings.local.json", "plugins/known_marketplaces.json", "plugins/installed_plugins.json"].map((p) => join(hostHome, p)));
  for (let dir = cwd; ; dir = dirname(dir)) {
    paths.push(...(host === "codex" ? [".codex/config.toml"] : [".claude/settings.json", ".claude/settings.local.json"]).map((p) => join(dir, p)));
    if (dirname(dir) === dir) break;
  }
  const unique = [...new Set(paths)];
  const files = async () => Promise.all(unique.map(async (path) => {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || await realpath(path) !== resolve(path)) throw new Error(`unsupported provenance path: ${path}`);
      return sha256(await readFile(path));
    } catch (error) {
      if (error.code === "ENOENT") return "absent";
      throw error;
    }
  }));
  const registration = async () => {
    const list = await runner({ cli: host, command: host, args: ["plugin", "list", "--json"] });
    if (list.exitCode !== 0) throw new Error("plugin provenance list failed");
    const parsed = JSON.parse(list.stdout ?? "");
    const entries = host === "codex" ? parsed.installed : parsed;
    if (!Array.isArray(entries)) throw new Error("unsupported plugin provenance list");
    const plugin = entries.filter((e) => (host === "codex" ? e?.pluginId : e?.id) === "edu@edu");
    if (host === "codex") return JSON.stringify(plugin);
    const listed = await runner({ cli: host, command: host, args: ["plugin", "marketplace", "list", "--json"] });
    if (listed.exitCode !== 0) throw new Error("marketplace provenance list failed");
    const markets = JSON.parse(listed.stdout ?? "");
    if (!Array.isArray(markets)) throw new Error("unsupported marketplace provenance list");
    return JSON.stringify([plugin, markets.filter((m) => m?.name === "edu")]);
  };
  const baseline = await files();
  const recorded = await registration();
  if (recorded !== options.expectedRegistration) throw new Error("Manual conflict: registered provenance changed during preflight");
  const checkFiles = async () => {
    if (process.env[envName] !== envHome || process.cwd() !== cwd || JSON.stringify(await files()) !== JSON.stringify(baseline)) throw new Error(`${host} provenance metadata changed`);
  };
  await checkFiles();
  return async () => {
    try {
      await checkFiles();
      if (await registration() !== recorded) throw new Error("registered marketplace/plugin provenance changed");
      await checkFiles();
    } catch (error) {
      throw new Error(`Manual conflict: ${host} provenance metadata: ${error instanceof Error ? error.message : error}`);
    }
  };
}

// src/setup/claude-upgrade.ts
import { readFile as readFile3 } from "fs/promises";
import { join as join3, resolve as resolve3 } from "path";

// src/setup/native-files.ts
import { lstat as lstat2, readFile as readFile2, readdir, realpath as realpath2 } from "fs/promises";
import { join as join2, resolve as resolve2 } from "path";
function equal(a, b) {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([p, hash]) => b[p] === hash);
}
async function tree(root) {
  if (await realpath2(root) !== resolve2(root)) throw new Error("symlink in plugin path");
  const hashes = {};
  async function walk(dir, prefix) {
    const entries = await readdir(dir);
    if (!entries.length) throw new Error(`unrecognized empty plugin directory: ${dir}`);
    for (const name of entries.sort()) {
      const path = join2(dir, name);
      const relative = prefix + name;
      const stat = await lstat2(path);
      if (stat.isDirectory()) await walk(path, relative + "/");
      else if (stat.isFile()) hashes[relative] = sha256(await readFile2(path));
      else throw new Error(`non-regular plugin entry: ${path}`);
    }
  }
  await walk(root, "");
  return hashes;
}
function version(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value);
}

// src/setup/claude-baseline.ts
var claudeBaseline = {
  ".mcp.json": "e25e3d6db2d0276940a19d5f39101761cc8ff5681c3fbb515ed4a880ef25ea97",
  "hooks/hooks.json": "a04ed69e0a7f9b364e05f581cd86387feb3cc344461556ba9866f9bd5d3648b4",
  ".claude-plugin/plugin.json": "27b86693a8d32d5393ab95dddfe49adb5468c34d3983ad70c4c67a47b78afde9",
  "agents/builder.md": "5c65cfd0499b2b1d2a604733364bb8f37e171d5462ce723a5c6461ad600e1f6b",
  "output-styles/edu.md": "6c688bc944fe17647cb8cce5a7fbadc581067e6ff6487c520abc6d6b5b34aee9",
  "agents/explorer.md": "e3355d6cfed509f8055b5126bd6aa3c926f38f024c17180e55f2d54c71bf6b03",
  "agents/lead.md": "7fbdadfd4f3e26c19b7ddbc7c825a7076f313bb5ac5d09a09120aa375a24121f",
  "agents/reviewer.md": "9ddba101bd35fce1f5d617e01b00fe017dda7bb7632221bbf6d301ca3a4306fa",
  "skills/brain/SKILL.md": "a2dca4f04089654a8848eac2870cb34387866e3d377bc637d43fb9d188cf57c6",
  "skills/brief/SKILL.md": "c4325eb643c1afe806514276e77665cabdd95a3b300f8c1baed67cd2c47c391b",
  "skills/crew/SKILL.md": "05e18a5aeb6e649f4b1340d17b0fb68e70927ac9f837db855432feb5b2242a1e",
  "skills/recall/SKILL.md": "8276fb56aaa1b03b61eb62e5d22be61fa662a525d22eb9501336a38f46433771",
  "skills/reflect/SKILL.md": "02b19ca17452fcb94554141e87f06709634a84f61313026f09c1ce702756ebf8",
  "skills/remember/SKILL.md": "b25189f2a7baffd8d99ae5fe2f4e88c907900dcfa09aade531635769f8abfef8",
  "skills/review/SKILL.md": "dd47ea41875b09b0158b8892f8b983274e1d779b39e000f501a9e39027db3bee",
  "skills/run/SKILL.md": "1d424c0024495d0a0503fb238784efcdcc0b55a70f3f657e56fac5c0d113820d",
  "skills/status/SKILL.md": "60568208f892c9f90bb22ee48b8bf80ab9fbfec4bc41b24265fdea7d1a858708",
  "skills/vault/SKILL.md": "9f0bd012e39975355d893b43963d8865b9f53f460bd401de5525bea668d71f9a",
  "types/index.d.ts": "8eb1512bb87669b7f8a0208ca58ea8e91b5cd8d859ae2335f2b5a9bd96eeef6f",
  "hooks/deck.tsx": "f252830a511539bb27dae6c8a856b393a9f549494d2f0b605c32d90df2de00d2"
};
function claudeBaselineFor(platform) {
  return platform === "win32" ? { ...claudeBaseline, ".mcp.json": "5e44db1bdf44d58b9f423dcc5199bff628836f9ffcfc2b3baa86b10749656175" } : claudeBaseline;
}
var claudeRcBaseline = {
  ".claude-plugin/plugin.json": "9d70fd2bf3625aa9af383c7a910d4a01077df5cf41745c21a7862a1dfaebfe15",
  ".mcp.json": "e25e3d6db2d0276940a19d5f39101761cc8ff5681c3fbb515ed4a880ef25ea97",
  "agents/builder.md": "5c65cfd0499b2b1d2a604733364bb8f37e171d5462ce723a5c6461ad600e1f6b",
  "agents/explorer.md": "e3355d6cfed509f8055b5126bd6aa3c926f38f024c17180e55f2d54c71bf6b03",
  "agents/lead.md": "7fbdadfd4f3e26c19b7ddbc7c825a7076f313bb5ac5d09a09120aa375a24121f",
  "agents/reviewer.md": "9ddba101bd35fce1f5d617e01b00fe017dda7bb7632221bbf6d301ca3a4306fa",
  "hooks/deck.tsx": "f252830a511539bb27dae6c8a856b393a9f549494d2f0b605c32d90df2de00d2",
  "hooks/hooks.json": "a04ed69e0a7f9b364e05f581cd86387feb3cc344461556ba9866f9bd5d3648b4",
  "output-styles/edu.md": "b6f8344e1215f70ecd76f6ee3e5222cfb388b906dcd58f94aafba9bb9af2a441",
  "skills/brain/SKILL.md": "41d5df56fd4d17b2f1b6552f9efb2ff0fc2c4e47e0cd1e69b2fc3838bbeec5d2",
  "skills/brief/SKILL.md": "be48240d0857f0d4a31615843198de3743b9d84f1c384483f19cc1ce4451f27f",
  "skills/crew/SKILL.md": "084dd78c6c01dddcf5ff8b0fa021a1ef37f1218412aa0fcf7336516c6cc1f0d8",
  "skills/recall/SKILL.md": "55c17301721afd8d8f569ecb4f7ea6cc165e8a5020cca719f19f9af8d9025589",
  "skills/reflect/SKILL.md": "2f67145784f066df2aa5cdf958d69d3d7fd1fc2591409718d5ff2886e27a1e35",
  "skills/remember/SKILL.md": "b25189f2a7baffd8d99ae5fe2f4e88c907900dcfa09aade531635769f8abfef8",
  "skills/review/SKILL.md": "876dfb18a1e4db240e0d32f22acd7d6374d3dab051ab483a23efee8eb1127da5",
  "skills/run/SKILL.md": "1d424c0024495d0a0503fb238784efcdcc0b55a70f3f657e56fac5c0d113820d",
  "skills/status/SKILL.md": "0cfb463026726394076c77e76c0429d3cb6263d8305814b3958e71fde4dcde7f",
  "skills/vault/SKILL.md": "9f0bd012e39975355d893b43963d8865b9f53f460bd401de5525bea668d71f9a",
  "types/index.d.ts": "8eb1512bb87669b7f8a0208ca58ea8e91b5cd8d859ae2335f2b5a9bd96eeef6f"
};
function claudeBaselineForVersion(release, platform) {
  if (release === "0.10.2") return claudeBaselineFor(platform);
  if (release !== "2.0.0-rc.1") return void 0;
  return platform === "win32" ? { ...claudeRcBaseline, ".mcp.json": "5e44db1bdf44d58b9f423dcc5199bff628836f9ffcfc2b3baa86b10749656175" } : claudeRcBaseline;
}

// src/setup/claude-upgrade.ts
async function planClaudeRefresh(options) {
  const { home, packageRoot, previousPackageRoot, brainRoot, runner } = options;
  const command = (args) => runner({ cli: "claude", command: "claude", args });
  const sourceRoot = join3(packageRoot, "plugins/claude-code");
  const base = join3(resolve3(process.env.CLAUDE_CONFIG_DIR || join3(home, ".claude")), "plugins/cache/edu/edu");
  const listedPlugin = async () => {
    const result = await command(["plugin", "list", "--json"]);
    const entries = JSON.parse(result.stdout ?? "");
    const matches = Array.isArray(entries) ? entries.filter((e) => e?.id === "edu@edu") : [];
    const entry = matches[0];
    if (result.exitCode !== 0 || matches.length !== 1 || entry.scope !== "user" || entry.enabled !== true || entry.errors?.length) throw new Error("unknown or ambiguous user-scope installation");
    return entry;
  };
  let checkProvenance;
  let before;
  let candidate;
  let nextVersion;
  const matchesCache = (cache, active) => {
    const releases = new Set(Object.keys(cache).map((path) => path.split("/")[0]));
    if (!releases.has(active)) return false;
    const expected = {};
    for (const release of releases) {
      if (release !== active && compareVersions(release, active) >= 0) return false;
      const hashes = release === nextVersion && release === active ? candidate : claudeBaselineForVersion(release, options.platform ?? process.platform);
      if (!hashes) return false;
      for (const [path, hash] of Object.entries(hashes)) expected[`${release}/${path}`] = hash;
    }
    return equal(cache, expected);
  };
  try {
    const entry = await listedPlugin();
    if (previousPackageRoot !== packageRoot) throw new Error("registered source path changed");
    if (entry.readFromFolder === sourceRoot) return async () => {
    };
    if (!version(entry.version) || entry.readFromFolder || entry.installPath !== join3(base, entry.version)) throw new Error("unsupported native cache path/layout");
    const result = await command(["plugin", "marketplace", "list", "--json"]);
    const markets = JSON.parse(result.stdout ?? "");
    const matches = Array.isArray(markets) ? markets.filter((m) => m?.name === "edu") : [];
    if (result.exitCode !== 0 || matches.length !== 1 || matches[0].source !== "directory" || matches[0].path !== packageRoot || matches[0].installLocation !== packageRoot) throw new Error("marketplace local provenance is unknown");
    checkProvenance = await captureNativeProvenance({ host: "claude", home, packageRoot, runner, expectedRegistration: JSON.stringify([[entry], matches]) });
    const marketplace = JSON.parse(await readFile3(join3(packageRoot, ".claude-plugin/marketplace.json"), "utf8"));
    const plugins = marketplace.plugins?.filter((p) => p.name === "edu");
    if (marketplace.name !== "edu" || plugins?.length !== 1 || plugins[0].source !== "./plugins/claude-code" || plugins[0].headersHelper || plugins[0].dependencies) throw new Error("unsupported marketplace plugin source/dependencies");
    candidate = await tree(sourceRoot);
    const manifest = JSON.parse(await readFile3(join3(sourceRoot, ".claude-plugin/plugin.json"), "utf8"));
    if (manifest.name !== "edu" || !version(manifest.version) || manifest.dependencies || plugins[0].version !== void 0 && plugins[0].version !== manifest.version) throw new Error("invalid candidate manifest/version/dependencies");
    nextVersion = manifest.version;
    if (compareVersions(nextVersion, entry.version) < 0) throw new Error("candidate plugin downgrade refused");
    before = await tree(base);
    if (!matchesCache(before, entry.version)) throw new Error("cache differs from complete exact published version trees (unknown version, custom, missing or extra files)");
    if (entry.version === nextVersion) return async () => {
    };
  } catch (error) {
    throw new Error(`Manual conflict: Claude native cache: ${error instanceof Error ? error.message : error}`);
  }
  return async () => {
    await checkProvenance();
    if (!equal(await tree(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error("Manual conflict: Claude native cache/source changed during preflight");
    const backup = await backupUpgradeFiles(brainRoot, Object.keys(before).map((p) => join3(base, p)));
    if (!equal(await tree(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error("Manual conflict: Claude native cache/source changed during backup");
    await checkProvenance();
    try {
      const result = await command(["plugin", "update", "edu@edu", "--scope", "user"]);
      if (result.exitCode !== 0) throw new Error(`host exit ${result.exitCode}: ${result.stderr ?? ""}`);
      const installed = await listedPlugin();
      if (installed.version !== nextVersion || installed.installPath !== join3(base, nextVersion) || installed.readFromFolder) throw new Error("unexpected installed version/path");
      const after = await tree(base);
      if (!matchesCache(after, nextVersion)) throw new Error("installed cache does not match candidate hashes");
    } catch (error) {
      throw new Error(`Claude native refresh failed: ${error instanceof Error ? error.message : error}. Backup: ${backup}. No automatic host rollback; restart only after repair.`);
    }
  };
}

// src/setup/codex-upgrade.ts
import { readFile as readFile4 } from "fs/promises";
import { join as join4, resolve as resolve4 } from "path";

// src/setup/codex-baseline.ts
var codexBaseline = {
  ".mcp.json": "764d32325c19d9b5d45b8689a3e6236aacc725147adab059a4b2fca5b021e316",
  "hooks/hooks.json": "a42aa520685140835130d1b8c9f0b92cef8584b8f23f9bf616a120270e5493f0",
  ".codex-plugin/plugin.json": "00b06408d2281c41725816672189e344b7fef8e03342f0b02c80e8f74fe5be6e",
  "agents/builder.md": "d2a65ee9215ab0eb04a1967620687015e516d4b4f1d6c2b484e1bf2cba6f60cb",
  "agents/explorer.md": "635a2cbc2ebd0c1edc01eee63293de38ca5bc976646d4163731315a4b714c885",
  "agents/lead.md": "b3bd29bf25ede5e7310435b65de5da1de540c4d31ef08a6c23fe9455fb69ec65",
  "agents/reviewer.md": "b7027764705cad8dfe1498e50a8cb8986e8acd9d582b5678b911bb8590650171",
  "skills/edu-brain/SKILL.md": "a2dca4f04089654a8848eac2870cb34387866e3d377bc637d43fb9d188cf57c6",
  "skills/edu-brief/SKILL.md": "c4325eb643c1afe806514276e77665cabdd95a3b300f8c1baed67cd2c47c391b",
  "skills/edu-crew/SKILL.md": "05e18a5aeb6e649f4b1340d17b0fb68e70927ac9f837db855432feb5b2242a1e",
  "skills/edu-recall/SKILL.md": "8276fb56aaa1b03b61eb62e5d22be61fa662a525d22eb9501336a38f46433771",
  "skills/edu-reflect/SKILL.md": "02b19ca17452fcb94554141e87f06709634a84f61313026f09c1ce702756ebf8",
  "skills/edu-remember/SKILL.md": "b25189f2a7baffd8d99ae5fe2f4e88c907900dcfa09aade531635769f8abfef8",
  "skills/edu-review/SKILL.md": "dd47ea41875b09b0158b8892f8b983274e1d779b39e000f501a9e39027db3bee",
  "skills/edu-run/SKILL.md": "1d424c0024495d0a0503fb238784efcdcc0b55a70f3f657e56fac5c0d113820d",
  "skills/edu-status/SKILL.md": "60568208f892c9f90bb22ee48b8bf80ab9fbfec4bc41b24265fdea7d1a858708",
  "skills/edu-vault/SKILL.md": "9f0bd012e39975355d893b43963d8865b9f53f460bd401de5525bea668d71f9a"
};
function codexBaselineFor(platform) {
  return platform === "win32" ? { ...codexBaseline, ".mcp.json": "0d497fb4a61b6b170670437f50975ceffb82111b349711966eb24a818d89be81" } : codexBaseline;
}
var codexRcBaseline = {
  ".codex-plugin/plugin.json": "5dbf136514a2a086bb6a02e99abdbac4aff3dbcbcd92fb31386db08237451f91",
  ".mcp.json": "764d32325c19d9b5d45b8689a3e6236aacc725147adab059a4b2fca5b021e316",
  "agents/builder.md": "d2a65ee9215ab0eb04a1967620687015e516d4b4f1d6c2b484e1bf2cba6f60cb",
  "agents/explorer.md": "635a2cbc2ebd0c1edc01eee63293de38ca5bc976646d4163731315a4b714c885",
  "agents/lead.md": "b3bd29bf25ede5e7310435b65de5da1de540c4d31ef08a6c23fe9455fb69ec65",
  "agents/reviewer.md": "b7027764705cad8dfe1498e50a8cb8986e8acd9d582b5678b911bb8590650171",
  "hooks/hooks.json": "a42aa520685140835130d1b8c9f0b92cef8584b8f23f9bf616a120270e5493f0",
  "skills/edu-brain/SKILL.md": "41d5df56fd4d17b2f1b6552f9efb2ff0fc2c4e47e0cd1e69b2fc3838bbeec5d2",
  "skills/edu-brief/SKILL.md": "be48240d0857f0d4a31615843198de3743b9d84f1c384483f19cc1ce4451f27f",
  "skills/edu-crew/SKILL.md": "084dd78c6c01dddcf5ff8b0fa021a1ef37f1218412aa0fcf7336516c6cc1f0d8",
  "skills/edu-recall/SKILL.md": "55c17301721afd8d8f569ecb4f7ea6cc165e8a5020cca719f19f9af8d9025589",
  "skills/edu-reflect/SKILL.md": "2f67145784f066df2aa5cdf958d69d3d7fd1fc2591409718d5ff2886e27a1e35",
  "skills/edu-remember/SKILL.md": "b25189f2a7baffd8d99ae5fe2f4e88c907900dcfa09aade531635769f8abfef8",
  "skills/edu-review/SKILL.md": "876dfb18a1e4db240e0d32f22acd7d6374d3dab051ab483a23efee8eb1127da5",
  "skills/edu-run/SKILL.md": "1d424c0024495d0a0503fb238784efcdcc0b55a70f3f657e56fac5c0d113820d",
  "skills/edu-status/SKILL.md": "0cfb463026726394076c77e76c0429d3cb6263d8305814b3958e71fde4dcde7f",
  "skills/edu-vault/SKILL.md": "9f0bd012e39975355d893b43963d8865b9f53f460bd401de5525bea668d71f9a"
};
function codexBaselineForVersion(release, platform) {
  if (release === "0.10.2") return codexBaselineFor(platform);
  if (release !== "2.0.0-rc.1") return void 0;
  return platform === "win32" ? { ...codexRcBaseline, ".mcp.json": "0d497fb4a61b6b170670437f50975ceffb82111b349711966eb24a818d89be81" } : codexRcBaseline;
}

// src/setup/codex-upgrade.ts
async function planCodexRefresh(options) {
  const { home, packageRoot, previousPackageRoot, brainRoot, runner } = options;
  const command = (args) => runner({ cli: "codex", command: "codex", args });
  const sourceRoot = join4(packageRoot, "plugins/codex");
  const base = join4(resolve4(process.env.CODEX_HOME || join4(home, ".codex")), "plugins/cache/edu/edu");
  let checkProvenance;
  let before;
  let candidate;
  let installedVersion;
  let nextVersion;
  try {
    const result = await command(["plugin", "list", "--json"]);
    const listed = JSON.parse(result.stdout ?? "");
    const matches = Array.isArray(listed.installed) ? listed.installed.filter((e) => e.pluginId === "edu@edu") : [];
    const entry = matches[0];
    if (result.exitCode !== 0 || matches.length !== 1 || !entry.installed || !entry.enabled || entry.name !== "edu" || entry.marketplaceName !== "edu" || entry.source?.source !== "local" || entry.source.path !== sourceRoot || entry.marketplaceSource?.sourceType !== "local" || entry.marketplaceSource.source !== packageRoot || previousPackageRoot !== packageRoot || !version(entry.version)) {
      throw new Error("installed plugin identity or local provenance is unknown");
    }
    const host = await command(["--version"]);
    if (host.exitCode !== 0 || host.stdout?.trim() !== "codex-cli 0.163.0") throw new Error("only Codex 0.163.0 cache semantics are verified");
    checkProvenance = await captureNativeProvenance({ host: "codex", home, packageRoot, runner, expectedRegistration: JSON.stringify([entry]) });
    const marketplace = JSON.parse(await readFile4(join4(packageRoot, ".agents/plugins/marketplace.json"), "utf8"));
    const plugins = marketplace.plugins?.filter((p) => p.name === "edu");
    if (marketplace.name !== "edu" || plugins?.length !== 1 || plugins[0].source?.source !== "local" || plugins[0].source.path !== "./plugins/codex") throw new Error("candidate marketplace does not resolve exactly to Edu");
    candidate = await tree(sourceRoot);
    const manifest = JSON.parse(await readFile4(join4(sourceRoot, ".codex-plugin/plugin.json"), "utf8"));
    if (manifest.name !== "edu" || !version(manifest.version)) throw new Error("invalid candidate plugin manifest");
    nextVersion = manifest.version;
    installedVersion = entry.version;
    if (compareVersions(nextVersion, installedVersion) < 0) throw new Error("candidate plugin downgrade refused");
    before = await tree(base);
    const expectedCurrent = Object.fromEntries(Object.entries(candidate).map(([p, hash]) => [`${nextVersion}/${p}`, hash]));
    if (installedVersion === nextVersion && equal(before, expectedCurrent)) return async () => {
    };
    const baseline = codexBaselineForVersion(installedVersion, options.platform ?? process.platform);
    const expectedOld = baseline && Object.fromEntries(Object.entries(baseline).map(([p, hash]) => [`${installedVersion}/${p}`, hash]));
    if (!expectedOld || !equal(before, expectedOld)) throw new Error("cache differs from an exact published baseline (unknown version, custom, missing or extra files)");
  } catch (error) {
    throw new Error(`Manual conflict: Codex native cache: ${error instanceof Error ? error.message : error}`);
  }
  return async () => {
    await checkProvenance();
    if (!equal(await tree(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error("Manual conflict: Codex native cache/source changed during preflight");
    const backup = await backupUpgradeFiles(brainRoot, Object.keys(before).map((p) => join4(base, p)));
    if (!equal(await tree(base), before) || !equal(await tree(sourceRoot), candidate)) throw new Error("Manual conflict: Codex native cache/source changed during backup");
    await checkProvenance();
    try {
      const result = await command(["plugin", "add", "edu@edu", "--json"]);
      if (result.exitCode !== 0) throw new Error(`host exit ${result.exitCode}: ${result.stderr ?? ""}`);
      const installed = JSON.parse(result.stdout ?? "");
      const expectedPath = join4(base, nextVersion);
      if (installed.pluginId !== "edu@edu" || installed.version !== nextVersion || installed.installedPath !== expectedPath) throw new Error("unexpected install identity/version/path");
      const expected = Object.fromEntries(Object.entries(candidate).map(([p, hash]) => [`${nextVersion}/${p}`, hash]));
      if (!equal(await tree(base), expected)) throw new Error("installed cache does not match candidate hashes");
    } catch (error) {
      throw new Error(`Codex native refresh failed: ${error instanceof Error ? error.message : error}. Backup: ${backup}. No automatic host rollback; restart only after repair.`);
    }
  };
}

// src/setup/index.ts
import { access, mkdir, readFile as readFile5, readdir as readdir2, realpath as realpath3, rename, unlink, writeFile } from "fs/promises";
import { dirname as dirname2, join as join5, resolve as resolve5, sep } from "path";
import { parse as parse2 } from "jsonc-parser";

// src/detach/edit.ts
import { applyEdits, findNodeAtLocation, modify, parse, parseTree } from "jsonc-parser";

// src/detach/signatures.ts
var TOOL_IDS = ["gentle-ai", "engram", "moragent", "orca", "axi", "codegraph", "herdr", "hermes", "edu"];
var SIGNATURES = {
  "gentle-ai": { marker: "gentle-ai", commands: ["gentle-ai", "gentle-shell"], mcp: [], plugins: ["gentle-ai", "gentle-logo"], packages: ["gentle-pi"], extras: { claudeOutputStyle: "Gentleman", opencodeDefaultAgent: "gentle-orchestrator" }, memoryWriter: false, orchestrator: true, keepSections: { persona: ["Rules", "Expertise"] } },
  engram: { marker: "engram", commands: ["engram"], mcp: ["engram"], plugins: ["engram"], packages: ["gentle-engram"], extras: { codexInstructionKeys: ["model_instructions_file", "experimental_compact_prompt_file"] }, memoryWriter: true, orchestrator: false },
  moragent: { marker: "moragent", commands: ["mora ", "moragent"], mcp: ["moragent"], plugins: ["moragent"], packages: ["moragent"], memoryWriter: true, orchestrator: true },
  orca: { marker: "orca", commands: ["orca"], mcp: ["orca"], plugins: ["orca"], packages: ["orca"], memoryWriter: false, orchestrator: false },
  axi: { marker: "axi", commands: ["-axi"], mcp: [], plugins: ["axi"], packages: ["axi"], memoryWriter: false, orchestrator: false },
  codegraph: { marker: "codegraph", commands: ["codegraph"], mcp: ["codegraph"], plugins: ["codegraph"], packages: ["codegraph"], memoryWriter: false, orchestrator: false },
  herdr: { marker: "herdr", commands: ["herdr"], mcp: ["herdr"], plugins: ["herdr"], packages: ["herdr"], memoryWriter: false, orchestrator: false },
  hermes: { marker: "hermes", commands: ["hermes"], mcp: ["hermes"], plugins: ["hermes"], packages: ["hermes"], memoryWriter: false, orchestrator: false },
  edu: { marker: "edu", commands: ["edu "], mcp: ["edu"], plugins: ["edu"], packages: ["edu"], memoryWriter: true, orchestrator: true }
};
function ownerOf(value, field) {
  const lower = value.toLowerCase();
  return TOOL_IDS.find((id) => SIGNATURES[id][field].some((part) => field === "mcp" ? lower === part : lower.includes(part) || field === "commands" && lower === part.trim()));
}
function assertDetachable(ids) {
  if (ids.includes("edu")) throw new Error("Edu cannot detach itself.");
  const unknown = ids.filter((id) => !TOOL_IDS.includes(id));
  if (unknown.length) throw new Error(`Unknown tool: ${unknown.join(", ")}`);
  return [...new Set(ids)];
}

// src/detach/edit.ts
var selected = (value, field, tools) => {
  const owner = ownerOf(value, field);
  return owner !== void 0 && tools.includes(owner);
};
var pluginName = (value) => /[\\/]/.test(value) ? value.split(/[\\/]/).filter(Boolean).at(-1) ?? value : value;
function editInstructions(input, tools) {
  const marker = /<!--\s*(\/)?([\w-]+):([\w-]+)\s*-->/g;
  const stack = [];
  const spans = [];
  for (const match of input.matchAll(marker)) {
    const [token, close, owner, name] = match;
    const at = match.index;
    if (!close) {
      stack.push({ owner, name, start: at });
      continue;
    }
    const index = stack.findLastIndex((item) => item.owner === owner && item.name === name);
    if (index < 0) continue;
    const last = stack[index];
    stack.length = index;
    const tool = tools.find((id) => SIGNATURES[id].marker === owner);
    if (tool && !stack.some((item) => tools.some((id) => SIGNATURES[id].marker === item.owner))) {
      const body = input.slice(last.start + input.slice(last.start).indexOf("-->") + 3, at);
      spans.push({ start: last.start, end: at + token.length, keep: keptSections(body, SIGNATURES[tool].keepSections?.[name] ?? []) });
    }
  }
  let text = input;
  for (const { start, end, keep } of spans.sort((a, b) => b.start - a.start)) text = text.slice(0, start) + keep + text.slice(end);
  if (spans.length) text = text.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  return { text, changes: spans.map((span) => span.keep ? "instruction block (your sections kept)" : "instruction block") };
}
function keptSections(body, titles) {
  if (!titles.length) return "";
  const parts = body.split(/(?=^## )/m);
  const kept = parts.filter((part) => {
    const title = /^## (.+)$/m.exec(part)?.[1]?.trim();
    return title !== void 0 && titles.includes(title);
  });
  return kept.length ? `${kept.map((part) => part.trimEnd()).join("\n\n")}
` : "";
}
function commandOf(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const record = value;
  if (typeof record.command === "string") return record.command;
  if (Array.isArray(record.command)) return record.command.filter((part) => typeof part === "string").join(" ");
  return void 0;
}
function pruneHooks(value, tools, changes) {
  if (Array.isArray(value)) {
    return value.map((item) => pruneHooks(item, tools, changes)).filter((item) => item !== void 0);
  }
  if (!value || typeof value !== "object") return value;
  const object = value;
  const command = commandOf(object);
  if (command && selected(command, "commands", tools)) {
    changes.push(`hook: ${ownerOf(command, "commands")}`);
    return void 0;
  }
  const result = { ...object };
  for (const [key, child] of Object.entries(object)) {
    if (key === "hooks" || key === "handlers" || Array.isArray(child)) {
      const next = pruneHooks(child, tools, changes);
      if (Array.isArray(next) && next.length === 0 && (key === "hooks" || key === "handlers")) return void 0;
      result[key] = next;
    }
  }
  return result;
}
function editObject(input, host, tools, changes) {
  const result = structuredClone(input);
  for (const key of ["mcpServers", "mcp_servers", "mcp"]) {
    const servers = result[key];
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) continue;
    for (const id of Object.keys(servers)) if (selected(id, "mcp", tools)) {
      delete servers[id];
      changes.push(`MCP: ${id}`);
    }
  }
  for (const key of ["enabledPlugins", "plugins", "plugin"]) {
    const plugins = result[key];
    if (plugins && typeof plugins === "object" && !Array.isArray(plugins)) {
      for (const id of Object.keys(plugins)) if (selected(id, "plugins", tools)) {
        delete plugins[id];
        changes.push(`plugin: ${id}`);
      }
    } else if (Array.isArray(plugins)) {
      result[key] = plugins.filter((item) => {
        const remove = typeof item === "string" && selected(pluginName(item), "plugins", tools);
        if (remove) changes.push(`plugin: ${pluginName(item)}`);
        return !remove;
      });
    }
  }
  if (host === "pi" && Array.isArray(result.packages)) {
    result.packages = result.packages.filter((item) => {
      const remove = typeof item === "string" && selected(item, "packages", tools);
      if (remove) changes.push(`package: ${item}`);
      return !remove;
    });
  }
  if (host === "claude") {
    if (tools.some((tool) => SIGNATURES[tool].extras?.claudeOutputStyle === result.outputStyle)) {
      delete result.outputStyle;
      changes.push("outputStyle");
    }
    const status = commandOf(result.statusLine);
    if (status && selected(status, "commands", tools)) {
      delete result.statusLine;
      changes.push("statusLine");
    }
  }
  if (host === "opencode" && tools.some((tool) => SIGNATURES[tool].extras?.opencodeDefaultAgent === result.default_agent)) {
    delete result.default_agent;
    changes.push("default_agent");
  }
  if (result.hooks) {
    const hooks = pruneHooks(result.hooks, tools, changes);
    result.hooks = hooks ?? {};
  }
  return result;
}
function jsonEdit(input, host, tools, jsonc) {
  const errors = [];
  const value = jsonc ? parse(input, errors, { allowTrailingComma: true }) : JSON.parse(input);
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid host configuration; refusing partial edit");
  const changes = [];
  const result = editObject(value, host, tools, changes);
  if (!changes.length) return { text: input, changes };
  if (!jsonc) return { text: `${JSON.stringify(result, null, 2)}
`, changes };
  let text = input;
  const before = value;
  for (const key of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(result)])) {
    const oldValue = before[key];
    const newValue = result[key];
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      const removed = removedIndexes(oldValue, newValue);
      if (removed) {
        for (const index of removed.reverse()) text = removeArrayItem(text, [key, index]);
        continue;
      }
    }
    if (oldValue && newValue && typeof oldValue === "object" && typeof newValue === "object" && !Array.isArray(oldValue) && !Array.isArray(newValue)) {
      const oldMap = oldValue;
      const newMap = newValue;
      for (const child of /* @__PURE__ */ new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
        if (JSON.stringify(oldMap[child]) === JSON.stringify(newMap[child])) continue;
        text = applyEdits(text, modify(text, [key, child], newMap[child], { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } }));
      }
    } else {
      text = applyEdits(text, modify(text, [key], newValue, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } }));
    }
  }
  return { text, changes };
}
function removeArrayItem(text, path) {
  const root = parseTree(text, [], { allowTrailingComma: true });
  const node = root && findNodeAtLocation(root, path);
  if (!node) return text;
  let start = node.offset;
  let end = node.offset + node.length;
  const comma = /^[ \t]*,/.exec(text.slice(end));
  if (comma) end += comma[0].length;
  else {
    const previous = /,\s*$/.exec(text.slice(0, start));
    if (previous) start = previous.index;
  }
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const lineEnd = newline < 0 ? text.length : newline;
  if (!text.slice(lineStart, start).trim() && !text.slice(end, lineEnd).trim()) {
    start = lineStart;
    end = newline < 0 ? text.length : newline + 1;
  }
  return text.slice(0, start) + text.slice(end);
}
function removedIndexes(before, after) {
  const removed = [];
  let next = 0;
  before.forEach((item, index) => {
    if (next < after.length && JSON.stringify(after[next]) === JSON.stringify(item)) next++;
    else removed.push(index);
  });
  return next === after.length ? removed : void 0;
}
function bracketDepth(text) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (const c of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && c === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#") break;
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
  }
  return depth;
}
function tomlEdit(input, tools) {
  const lines = input.match(/.*(?:\n|$)/g)?.filter(Boolean) ?? [];
  const changes = [];
  const output = [];
  let section = "";
  let dropSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^\s*\[{1,2}(.+?)\]{1,2}\s*(?:#.*)?(?:\n)?$/.exec(line);
    if (heading) {
      section = heading[1].trim();
      const plugin = /^plugins\.(?:"([^"]+)"|'([^']+)'|([^.]+))/.exec(section);
      const mcp = /^mcp_servers\.(?:"([^"]+)"|'([^']+)'|([^.]+))/.exec(section);
      const market = /^marketplaces\.(?:"([^"]+)"|'([^']+)'|([^.]+))/.exec(section);
      const id = plugin?.[1] || plugin?.[2] || plugin?.[3] || mcp?.[1] || mcp?.[2] || mcp?.[3] || market?.[1] || market?.[2] || market?.[3];
      dropSection = Boolean(id && selected(id, plugin || market ? "plugins" : "mcp", tools));
      if (dropSection) changes.push(`${plugin ? "plugin" : market ? "marketplace" : "MCP"}: ${id}`);
    }
    if (dropSection) continue;
    if (!section) {
      const key = /^\s*([\w-]+)\s*=\s*(.*?)(?:\n)?$/.exec(line);
      if (key) {
        const [statement] = key;
        let end = i;
        let depth = bracketDepth(statement);
        while (depth > 0 && end + 1 < lines.length) depth += bracketDepth(lines[++end]);
        const raw = lines.slice(i, end + 1).join("");
        const remove = tools.some((tool) => SIGNATURES[tool].extras?.codexInstructionKeys?.includes(key[1]) && raw.toLowerCase().includes(tool)) || key[1] === "notify" && tools.some((tool) => SIGNATURES[tool].commands.some((part) => raw.toLowerCase().includes(part)));
        if (remove) {
          changes.push(`config: ${key[1]}`);
          i = end;
          continue;
        }
      }
    }
    output.push(line);
  }
  return { text: output.join(""), changes };
}
function editContent(kind, host, input, tools) {
  if (kind === "instructions") return editInstructions(input, tools);
  if (kind === "toml") return tomlEdit(input, tools);
  return jsonEdit(input, host, tools, kind === "jsonc");
}

// src/setup/index.ts
var LIST_COMMANDS = {
  claude: { cli: "claude", command: "claude", args: ["plugin", "list"] },
  codex: { cli: "codex", command: "codex", args: ["plugin", "list", "--json"] },
  pi: { cli: "pi", command: "pi", args: ["list"] },
  opencode: { cli: "opencode", command: "opencode", args: ["mcp", "list"] },
  agy: { cli: "agy", command: "agy", args: ["plugin", "list"] }
};
var defaultRunner = ({ command, args }) => new Promise((resolveResult) => {
  const child = spawnCli(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(chunk));
  child.stderr?.on("data", (chunk) => stderr.push(chunk));
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
      return [{ cli, command: "agy", args: ["plugin", "install", join5(packageRoot, "plugins/agy")] }];
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
  const entries = await readdir2(join5(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join5(relative, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, path));
    else if (entry.isFile()) files.push({ path, content: await readFile5(join5(root, path), "utf8") });
  }
  return files;
}
async function appendOpenCodeAssets(plan, packageRoot) {
  const sourceRoot = join5(packageRoot, "plugins/opencode");
  const destinationRoot = join5(plan.home, ".config/opencode");
  for (const category of ["commands", "agents", "plugins"]) {
    const source = join5(sourceRoot, category);
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
        path: join5(destinationRoot, category, file.path),
        description: `Install OpenCode ${category} file ${file.path}`,
        content: file.content
      };
      plan.actions.push(action);
    }
  }
  await appendOpenCodeTui(plan, sourceRoot, destinationRoot);
  retireOpenCode1Tui(plan, destinationRoot);
}
var OPENCODE1_TUI_PLUGIN = "tui-plugins/edu.tsx";
function retireOpenCode1Tui(plan, destinationRoot) {
  const stale = join5(destinationRoot, OPENCODE1_TUI_PLUGIN);
  const jsonPatch = { plugin: { [UNION]: [stale] } };
  plan.retire = [
    ...plan.retire ?? [],
    { kind: "file", path: stale },
    { kind: "json-merge", path: join5(destinationRoot, "tui.json"), jsonPatch },
    { kind: "json-merge", path: join5(destinationRoot, "tui.jsonc"), jsonPatch }
  ];
}
async function removeOpenCode1TuiFromCliJson(home) {
  const destinationRoot = join5(home, ".config/opencode");
  const path = join5(destinationRoot, "cli.json");
  let text;
  try {
    text = await readFile5(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const errors = [];
  const value = parse2(text, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== "object" || !Array.isArray(value.plugins)) return;
  const stale = join5(destinationRoot, OPENCODE1_TUI_PLUGIN);
  const indexes = value.plugins.flatMap((item, index) => item === stale ? [index] : []);
  if (!indexes.length) return;
  let next = text;
  for (const index of indexes.reverse()) next = removeArrayItem(next, ["plugins", index]);
  await writeFile(path, next);
}
var OPENCODE_TUI_PLUGIN = "plugins/edu-deck/tui.tsx";
async function appendOpenCodeTui(plan, sourceRoot, destinationRoot) {
  let tui;
  try {
    tui = await readFile5(join5(sourceRoot, "tui/edu.tsx"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  plan.actions.push({ cli: "opencode", kind: "file", path: join5(destinationRoot, OPENCODE_TUI_PLUGIN), description: "Install the Edu Deck OpenCode TUI plugin", content: tui });
  try {
    const theme = await readFile5(join5(sourceRoot, "themes/edu.json"), "utf8");
    plan.actions.push({ cli: "opencode", kind: "file", path: join5(destinationRoot, "themes/edu.json"), description: "Install the edu OpenCode theme", content: theme });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
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
    commands.push(...nativeCommands(cli, resolve5(options.packageRoot)));
  }
  return { ...options, packageRoot: resolve5(options.packageRoot), home: resolve5(options.home), commands, fallback, alreadyInstalled };
}
async function writeManifest(path, manifest) {
  await mkdir(dirname2(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}
`);
  await rename(temp, path);
}
async function localizePluginsForPlatform(packageRoot, platform = process.platform, opts = {}) {
  if (platform !== "win32") return [];
  if ((opts.installedOnly ?? true) && !/[\\/]node_modules[\\/]/.test(packageRoot)) return [];
  const launch = eduMcpLaunch(platform);
  const targets = [
    ["claude", "plugins/claude-code/.mcp.json", (edu) => ({ edu })],
    ["codex", "plugins/codex/.mcp.json", (edu) => ({ mcpServers: { edu } })],
    ["agy", "plugins/agy/mcp_config.json", (edu) => ({ mcpServers: { edu } })]
  ];
  const written = [];
  for (const [cli, relative, shape] of targets) {
    if (opts.clis && !opts.clis.includes(cli)) continue;
    const path = join5(packageRoot, relative);
    try {
      await access(path);
    } catch {
      continue;
    }
    await writeFile(path, `${JSON.stringify(shape(launch), null, 2)}
`);
    written.push(path);
  }
  return written;
}
async function localizeUpgradeSources(plan, options, brainRoot, native) {
  if ((options.platform ?? process.platform) !== "win32") return;
  const clis = native.filter((cli) => cli === "claude" || cli === "codex");
  if (!clis.length) return;
  if (!/[\\/]node_modules[\\/]edu-agent$/.test(plan.packageRoot) || await realpath3(plan.packageRoot) !== resolve5(plan.packageRoot)) throw new Error("Manual conflict: Windows native upgrade requires an owned installed edu-agent package");
  const changed = [];
  for (const cli of clis) {
    const path = join5(plan.packageRoot, "plugins", cli === "claude" ? "claude-code" : "codex", ".mcp.json");
    if (await realpath3(path) !== resolve5(path)) throw new Error(`Manual conflict: symlinked candidate MCP ${path}`);
    const before = await readTarget(path);
    const shape = (launch) => cli === "claude" ? { edu: launch } : { mcpServers: { edu: launch } };
    const unix = `${JSON.stringify(shape(eduMcpLaunch("linux")), null, 2)}
`;
    const windows = `${JSON.stringify(shape(eduMcpLaunch("win32")), null, 2)}
`;
    if (before?.toString("utf8") !== unix && before?.toString("utf8") !== windows) throw new Error(`Manual conflict: custom candidate MCP ${path}`);
    if (before.toString("utf8") !== windows) changed.push(path);
  }
  if (!changed.length) return;
  await backupUpgradeFiles(brainRoot, changed);
  await localizePluginsForPlatform(plan.packageRoot, "win32", { clis });
}
async function optionalSetupFile(path) {
  try {
    return await readFile5(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
async function prepareUpgrade(plan, options, brainRoot) {
  const existingBrain = await optionalSetupFile(join5(brainRoot, "EDU.md")) !== void 0;
  const registry = await optionalSetupFile(join5(brainRoot, "projects.json"));
  if (existingBrain || registry !== void 0) {
    const results = await migrateWorkspaces(brainRoot);
    const failures = results.filter((r) => r.status !== "migrated" && !(r.name === "global" && !existingBrain && ["missing", "no-brain"].includes(r.status)));
    if (failures.length) throw new Error(`Setup upgrade migration incomplete: ${failures.map((r) => `${r.name}: ${r.detail ?? r.status}`).join("; ")}`);
  }
  const manifestPath = await setupManifestPath(plan.home);
  const previousText = await optionalSetupFile(manifestPath);
  const adapterManifest = getManifestPath("global", plan.packageRoot, plan.home);
  const adapterText = await optionalSetupFile(adapterManifest);
  if (!existingBrain || !previousText && !adapterText && !plan.alreadyInstalled.length) return void 0;
  const previous = previousText ? JSON.parse(previousText) : void 0;
  if (previous && (previous.version !== 1 || !Array.isArray(previous.native) || !Array.isArray(previous.fallback))) throw new Error("Invalid setup manifest");
  const templatesDir = options.templatesDir ?? join5(plan.packageRoot, "templates");
  const storedAdapter = adapterText ? JSON.parse(adapterText) : void 0;
  if (storedAdapter && !Array.isArray(storedAdapter.actions)) throw new Error("Invalid adapter manifest");
  const configured = /* @__PURE__ */ new Set([
    ...plan.alreadyInstalled,
    ...previous?.native ?? [],
    ...previous?.fallback ?? [],
    ...(storedAdapter?.actions ?? []).flatMap((a) => a.clis ?? [a.cli])
  ]);
  const unconfigured = plan.clis.filter((cli) => !configured.has(cli));
  if (unconfigured.length) throw new Error(`Setup upgrade preserves existing integrations; configure new CLIs explicitly with edu install --scope global --cli ${unconfigured.join(",")}`);
  const scopes = [
    { scope: "global", root: plan.packageRoot },
    ...(await readProjects(brainRoot)).projects.map((p) => ({ scope: "project", root: p.root }))
  ];
  const upgrades = [];
  const notes = [];
  for (const scope of scopes) {
    const changed = [];
    const bases = await pinConfiguredBases(scope.root, plan.home);
    const actions = plan.clis.flatMap((cli) => instructionActions(cli, scope.scope, scope.root, { home: plan.home, templatesDir, brainRoot }));
    for (const action of new Map(actions.map((a) => [a.path, a])).values()) {
      const before = await optionalSetupFile(action.path);
      if (before === void 0 || removeManagedBlock(before) === before) continue;
      if (upsertManagedBlock(before ?? "", action.content ?? "") !== before) changed.push(action);
    }
    const scopedManifestPath = getManifestPath(scope.scope, scope.root, plan.home);
    const scopedText = await optionalSetupFile(scopedManifestPath);
    const owned = scopedText ? JSON.parse(scopedText).actions : [];
    if (!Array.isArray(owned)) throw new Error(`Invalid adapter manifest: ${scopedManifestPath}`);
    const bundleActions = [];
    for (const cli of plan.clis) {
      for (const action of await skillActions(cli, scope.scope, scope.root, { home: plan.home, templatesDir, selectedHosts: plan.clis, notes, bases })) {
        const prior = owned.find((a) => a.kind === "file" && a.path === action.path && (a.clis ?? [a.cli]).includes(cli));
        const document = action.bundle ? owned.find((a) => a.kind === "file" && a.path === join5(action.bundle.root, "SKILL.md") && (a.clis ?? [a.cli]).includes(cli)) : void 0;
        if (!prior && !document) continue;
        await validateBundleAction(action, bases);
        if (!prior) {
          const beforeDocument = await readTarget(document.path);
          if (!beforeDocument || !document.sha256 || sha256(beforeDocument) !== document.sha256) throw new Error(`Manual conflict: custom or missing managed skill ${document.path}`);
          if (await readTarget(action.path)) throw new Error(`Manual conflict: unowned bundle helper ${action.path}`);
          if (!changed.some((a) => a.path === action.path)) changed.push(action);
          bundleActions.push(action);
          continue;
        }
        bundleActions.push(action);
        const before = await readTarget(action.path);
        if (!before || !prior.sha256 || sha256(before) !== prior.sha256) throw new Error(`Manual conflict: custom or missing managed skill ${action.path}`);
        if (before.toString("utf8") !== action.content && !changed.some((a) => a.path === action.path)) changed.push(action);
      }
    }
    if (scope.scope === "global" && plan.clis.includes("opencode")) {
      const destination = join5(plan.home, ".config/opencode");
      const assets = owned.filter((a) => a.kind === "file" && (a.clis ?? [a.cli]).includes("opencode") && ["commands", "agents", "plugins", "themes", "tui-plugins"].some((category) => a.path.startsWith(join5(destination, category) + sep)));
      if (assets.length) {
        const candidates = { ...scope, home: plan.home, templatesDir, notes: [], actions: [] };
        await appendOpenCodeAssets(candidates, plan.packageRoot);
        for (const prior of assets) {
          const action = candidates.actions.find((a) => a.kind === "file" && a.path === prior.path);
          if (!action) throw new Error(`Manual conflict: retired or unsupported managed OpenCode asset ${prior.path}`);
          const before = await readTarget(prior.path);
          if (!before || !prior.sha256 || sha256(before) !== prior.sha256) throw new Error(`Manual conflict: custom or missing managed OpenCode asset ${prior.path}`);
          if (before.toString("utf8") !== action.content && !changed.some((a) => a.path === action.path)) changed.push(action);
        }
      }
    }
    const bundleRoots = new Set(bundleActions.flatMap((a) => a.bundle ? [a.bundle.root] : []));
    for (const action of owned) if (action.bundle && bundleRoots.has(action.bundle.root)) await validateBundleAction(action, bases);
    const retiringBundle = owned.some((a) => a.bundle && bundleRoots.has(a.bundle.root) && !bundleActions.some((next) => next.path === a.path));
    if (changed.length || retiringBundle) upgrades.push({ ...scope, bases, home: plan.home, templatesDir, notes: [], actions: [...new Map([...changed, ...bundleActions].map((a) => [a.path, a])).values()] });
  }
  const runner = options.runner ?? plan.runner ?? defaultRunner;
  const native = [.../* @__PURE__ */ new Set([...plan.alreadyInstalled, ...previous?.native ?? []])].filter((cli) => plan.clis.includes(cli));
  await localizeUpgradeSources(plan, options, brainRoot, native);
  const nativeRefreshes = [];
  for (const cli of native) {
    if (cli === "codex") {
      nativeRefreshes.push(await planCodexRefresh({ home: plan.home, packageRoot: plan.packageRoot, previousPackageRoot: previous?.packageRoot, brainRoot, runner, platform: options.platform }));
      continue;
    }
    if (cli === "claude") {
      nativeRefreshes.push(await planClaudeRefresh({ home: plan.home, packageRoot: plan.packageRoot, previousPackageRoot: previous?.packageRoot, brainRoot, runner, platform: options.platform }));
      continue;
    }
    if (cli === "pi") {
      const listed = await runner(LIST_COMMANDS.pi);
      const local = listed.stdout?.split(/\r?\n/).some((line) => line.trim() === plan.packageRoot);
      if (listed.exitCode === 0 && local && previous?.packageRoot === plan.packageRoot) continue;
    }
    throw new Error(`Manual conflict: ${cli} native cache refresh cannot be verified from legacy setup metadata. Preserve custom files and back up the installed plugin before a targeted host update; restart required. No native update was run.`);
  }
  for (const refresh of nativeRefreshes) await refresh();
  if (upgrades.length) {
    await backupUpgradeFiles(brainRoot, upgrades.flatMap((p) => [...p.actions.map((a) => a.path), getManifestPath(p.scope, p.root, p.home)]));
    for (const upgrade of upgrades) await applyInstall(upgrade);
  }
  return { installed: [], fallback: previous?.fallback ?? [], alreadyInstalled: [.../* @__PURE__ */ new Set([...plan.alreadyInstalled, ...previous?.native ?? []])], failed: [], ...notes.length ? { notes } : {} };
}
async function applySetup(plan, options = {}) {
  const brainRoot = resolve5(options.brainRoot ?? process.env.EDU_HOME ?? join5(plan.home, ".edu"));
  const upgraded = await prepareUpgrade(plan, options, brainRoot);
  if (upgraded) return upgraded;
  const runner = options.runner ?? plan.runner ?? defaultRunner;
  const report = { installed: [], fallback: [], alreadyInstalled: [...plan.alreadyInstalled], failed: [] };
  const pending = new Set(plan.fallback);
  const successful = /* @__PURE__ */ new Set();
  const failed = /* @__PURE__ */ new Map();
  await localizePluginsForPlatform(plan.packageRoot, options.platform);
  if (plan.commands.some((c) => c.cli === "codex")) {
    const { mkdir: mkdir2 } = await import("fs/promises");
    await mkdir2(process.env.CODEX_HOME || join5(plan.home, ".codex"), { recursive: true }).catch(() => void 0);
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
    adapterPlan = await planInstall({ clis: [...pending], selectedHosts: plan.clis, scope: "global", root: plan.packageRoot, home: plan.home, templatesDir: options.templatesDir ?? join5(plan.packageRoot, "templates") });
    if (pending.has("opencode")) await appendOpenCodeAssets(adapterPlan, plan.packageRoot);
    report.fallback.push(...pending);
  }
  const codexInstalled = successful.has("codex") || plan.alreadyInstalled.includes("codex");
  if (codexInstalled && !pending.has("codex")) {
    const templatesDir = options.templatesDir ?? join5(plan.packageRoot, "templates");
    const identityActions = instructionActions("codex", "global", plan.packageRoot, { home: plan.home, templatesDir, brainRoot });
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
    if (adapterPlan.notes.length) report.notes = adapterPlan.notes;
    await applyInstall(adapterPlan);
    adapterManifestPath = getManifestPath("global", plan.packageRoot, plan.home);
  }
  if (pending.has("opencode")) await removeOpenCode1TuiFromCliJson(plan.home);
  await initBrain({ location: { scope: "global", root: brainRoot }, templatesDir: options.templatesDir ?? join5(plan.packageRoot, "templates"), detected: options.detected ?? plan.clis, lang: options.lang });
  const manifestPath = join5(plan.home, ".edu/plugin-setup.json");
  let previous;
  try {
    previous = JSON.parse(await readFile5(manifestPath, "utf8"));
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
  await writeManifest(join5(plan.home, ".edu/plugin-setup.json"), manifest);
  return report;
}
async function setupManifestPath(home) {
  return join5(resolve5(home), ".edu/plugin-setup.json");
}
async function uninstallSetup(options) {
  const path = await setupManifestPath(options.home);
  let manifest;
  try {
    manifest = JSON.parse(await readFile5(path, "utf8"));
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
    await access(join5(home, "config.json"));
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

export {
  TOOL_IDS,
  SIGNATURES,
  ownerOf,
  assertDetachable,
  editInstructions,
  editContent,
  OPENCODE_TUI_PLUGIN,
  planSetup,
  localizePluginsForPlatform,
  applySetup,
  setupManifestPath,
  uninstallSetup,
  needsFirstRunSetup
};
//# sourceMappingURL=chunk-4HMNKJ3K.js.map