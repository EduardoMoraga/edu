import {
  getCapabilities
} from "./chunk-IZSEVT43.js";
import {
  packageVersion
} from "./chunk-BXZ573JQ.js";
import {
  readProjects
} from "./chunk-I6JWASFE.js";
import {
  resolveBrainDir
} from "./chunk-YPR7PZSQ.js";

// src/update/migrate.ts
import { lstat, mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { randomUUID } from "crypto";

// src/update/release.ts
var RELEASES_API = "https://api.github.com/repos/EduardoMoraga/edu/releases";
var RELEASE_TIMEOUT_MS = 1e4;
var UpdateError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "UpdateError";
  }
  code;
};
var normalizeVersion = (tag) => tag.trim().replace(/^v/i, "");
var releaseTag = (version) => `v${normalizeVersion(version)}`;
function compareVersions(a, b) {
  const parse = (v) => {
    const [core = "", pre] = normalizeVersion(v).split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length, 3); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === void 0) return 1;
  if (y.pre === void 0) return -1;
  return x.pre.localeCompare(y.pre, "en", { numeric: true });
}
function pickAsset(assets, version) {
  const list = (assets ?? []).filter((a) => Boolean(a.name && a.browser_download_url));
  const hit = list.find((a) => a.name === `edu-agent-${version}.tgz`) ?? list.find((a) => a.name === "edu-agent.tgz");
  return hit ? { name: hit.name, url: hit.browser_download_url } : void 0;
}
async function fetchRelease(opts) {
  const url = opts.tag ? `${RELEASES_API}/tags/${encodeURIComponent(releaseTag(opts.tag))}` : `${RELEASES_API}/latest`;
  const headers = { accept: "application/vnd.github+json", "user-agent": opts.userAgent ?? "edu-agent" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let response;
  try {
    response = await opts.fetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? RELEASE_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new UpdateError("offline", timedOut ? `GitHub did not answer in ${Math.round((opts.timeoutMs ?? RELEASE_TIMEOUT_MS) / 1e3)} s` : `cannot reach GitHub (${error instanceof Error ? error.message : String(error)})`);
  }
  if (response.status === 404) throw new UpdateError("not-found", opts.tag ? `release ${releaseTag(opts.tag)} not found` : "no published release found");
  if (!response.ok) {
    const limited = response.status === 403 || response.status === 429;
    throw new UpdateError("http", limited ? `GitHub API rate limit reached (HTTP ${response.status}); try again later or set GITHUB_TOKEN` : `GitHub API answered HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data.tag_name) throw new UpdateError("http", "GitHub answered without a release tag");
  const version = normalizeVersion(data.tag_name);
  const asset = pickAsset(data.assets, version);
  if (!asset) throw new UpdateError("no-asset", `release ${data.tag_name} has no edu-agent .tgz asset`);
  return { tag: data.tag_name, version, name: data.name ?? data.tag_name, body: data.body ?? "", url: data.html_url ?? `https://github.com/EduardoMoraga/edu/releases/tag/${data.tag_name}`, assetUrl: asset.url, assetName: asset.name };
}
function whatsNew(body, maxLines = 6, width = 160) {
  const lines = body.replace(/\r/g, "").split("\n").map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^\s*[-*+]\s+/, "\u2022 ").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim()).filter(Boolean).map((line) => line.length > width ? `${line.slice(0, width - 1)}\u2026` : line);
  return lines.length > maxLines ? [...lines.slice(0, maxLines), "\u2026"] : lines;
}

// src/update/migrate.ts
var revision = 2;
var start = "<!-- edu:capabilities:start -->";
var end = "<!-- edu:capabilities:end -->";
async function optional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
async function plainPath(path, root) {
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing migration through symlink: ${current}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current === resolve(root) || dirname(current) === current) break;
  }
}
var legacyProtocol = "**Protocol.** Start with `edu_brief` (shell: `edu brief`). Pull on demand: `edu_recall`, then `edu_read`;\ncite ids like `[[D-\u2026]]`. `edu_remember` decisions, hypotheses, commitments and lessons\nas they happen; `edu_feedback` when a note helped or misled. End with\n`edu_session_close` and an honest summary.";
var currentProtocol = "**Protocol.** Reuse an injected Edu brief; otherwise call `edu_brief` once. Retain an injected session id; otherwise call `edu_session_open(title, source)` and keep its exact returned id per workspace. Recall with `edu_recall`, then `edu_read`; cite ids, scope, claim bands and evidence. Use `edu_remember` for durable decisions and lessons. Memory is stored notes, not model training; `edu_feedback` is advisory, never proof. Close with `edu_session_close(id, summary)` using that exact id, and report failures honestly. Check `edu_capabilities`; unavailable means unknown.";
function contract(text, version) {
  if (text.includes("**Protocol.**")) {
    const matches = text.match(/\*\*Protocol\.\*\*[^]*?(?=\n\n|\n<!--|$)/g) ?? [];
    if (matches.length !== 1 || ![legacyProtocol, currentProtocol].includes(matches[0])) throw new Error("Manual conflict: custom legacy EDU.md protocol; preserve and reconcile manually");
    text = text.replace(legacyProtocol, currentProtocol);
  }
  const block = `${start}
Installed Edu: ${version}.
Capabilities on demand: state/capabilities.json, \`edu capabilities --json\`, or MCP \`edu_capabilities\` (unavailable = unknown).
Restart hosts/MCP after update. Feedback is advisory, not proof. Reuse the injected session id; otherwise open once and close with the exact returned id per workspace.
${end}`;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 !== b < 0 || a >= 0 && (b < a || text.indexOf(start, a + start.length) >= 0 || text.indexOf(end, b + end.length) >= 0)) throw new Error("Malformed Edu capabilities block");
  if (a >= 0) return text.slice(0, a) + block + text.slice(b + end.length);
  const coreEnd = text.indexOf("<!-- /edu:core -->");
  if (coreEnd >= 0) return text.slice(0, coreEnd) + block + "\n" + text.slice(coreEnd);
  return text + (text.endsWith("\n") ? "\n" : "\n\n") + block + "\n";
}
async function replaceFiles(root, files, version, now, backupOnly = false) {
  for (const file of files) await plainPath(file.path, root);
  const backupRoot = join(root, "backups");
  await plainPath(backupRoot, root);
  await mkdir(backupRoot, { recursive: true, mode: 448 });
  const backup = join(backupRoot, `upgrade-${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  await mkdir(backup, { mode: 448 });
  const manifest = [];
  for (const [i, file] of files.entries()) {
    const before = await optional(file.path);
    if (before === void 0) manifest.push({ path: file.path, absent: true });
    else {
      const name = `${i}.bak`;
      await writeFile(join(backup, name), before, { mode: 384, flag: "wx" });
      manifest.push({ path: file.path, file: name });
    }
  }
  await writeFile(join(backup, "manifest.json"), JSON.stringify({ version, revision, at: now.toISOString(), files: manifest }, null, 2), { mode: 384, flag: "wx" });
  if (backupOnly) return backup;
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true, mode: 448 });
    const mode = await lstat(file.path).then((stat) => stat.mode & 511, (error) => {
      if (error.code === "ENOENT") return 384;
      throw error;
    });
    const temp = `${file.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, file.content, { mode, flag: "wx" });
      await rename(temp, file.path);
    } finally {
      await rm(temp, { force: true });
    }
  }
  return backup;
}
async function backupUpgradeFiles(root, paths) {
  return replaceFiles(root, paths.map((path) => ({ path, content: "" })), packageVersion(), /* @__PURE__ */ new Date(), true);
}
async function migrateWorkspaces(eduHome, now = /* @__PURE__ */ new Date(), options = {}) {
  const version = options.version ?? packageVersion();
  const results = [];
  let projects = [];
  try {
    projects = (await readProjects(eduHome)).projects;
  } catch (error) {
    results.push({ name: "registry", root: eduHome, status: "failed", detail: String(error) });
  }
  const targets = [{ name: "global", root: eduHome, eduRoot: eduHome }, ...projects.map((p) => ({ name: p.name, root: p.root, eduRoot: join(p.root, ".edu") }))];
  const seen = /* @__PURE__ */ new Set();
  for (const target of targets) {
    const { eduRoot, ...base } = target;
    if (seen.has(resolve(eduRoot))) continue;
    seen.add(resolve(eduRoot));
    try {
      try {
        await lstat(target.root);
      } catch (error) {
        if (error.code === "ENOENT") {
          results.push({ ...base, status: "missing" });
          continue;
        }
        throw error;
      }
      await plainPath(eduRoot, eduRoot);
      const text = await optional(join(eduRoot, "EDU.md"));
      if (text === void 0) {
        results.push({ ...base, status: "no-brain" });
        continue;
      }
      const rawConfig = await optional(join(eduRoot, "config.json"));
      const config = rawConfig === void 0 ? {} : JSON.parse(rawConfig);
      if (!config || typeof config !== "object" || Array.isArray(config) || config.brainDir !== void 0 && typeof config.brainDir !== "string") throw new Error("Invalid workspace config");
      resolveBrainDir(eduRoot, config.brainDir);
      const statePath = join(eduRoot, "state", "upgrade.json");
      const prior = await optional(statePath);
      const state = prior === void 0 ? void 0 : JSON.parse(prior);
      if (state !== void 0 && (!state || typeof state.version !== "string" || typeof state.revision !== "number")) throw new Error("Invalid upgrade checkpoint");
      if (state && compareVersions(state.version, version) > 0) throw new Error(`Refusing to downgrade migrated contract ${state.version} to ${version}`);
      const nextContract = contract(text, version);
      const capabilityPath = join(eduRoot, "state", "capabilities.json");
      const capabilities = `${JSON.stringify(getCapabilities(version), null, 2)}
`;
      if (state?.version === version && state?.revision === revision && text === nextContract && await optional(capabilityPath) === capabilities) {
        results.push({ ...base, status: "migrated", detail: "already current; no writes" });
        continue;
      }
      const backup = await replaceFiles(eduRoot, [
        { path: join(eduRoot, "EDU.md"), content: nextContract },
        { path: capabilityPath, content: capabilities },
        { path: statePath, content: `${JSON.stringify({ version, revision, previousVersion: state?.version ?? "legacy/unversioned", completedAt: now.toISOString() }, null, 2)}
` }
      ], version, now);
      results.push({ ...base, status: "migrated", detail: `managed contract updated; backup ${backup}; restart hosts` });
    } catch (error) {
      results.push({ ...base, status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  try {
    const path = join(eduHome, "projects.json");
    const before = await optional(path);
    if (before !== void 0) {
      const live = await readProjects(eduHome);
      const stored = JSON.parse(before);
      if (live.projects.some((p, i) => p.brain !== stored.projects[i]?.brain)) {
        const projects2 = stored.projects.map((p, i) => ({ ...p, brain: live.projects[i].brain }));
        await replaceFiles(eduHome, [{ path, content: `${JSON.stringify({ ...stored, projects: projects2 }, null, 2)}
` }], version, now);
      }
    }
  } catch (error) {
    results.push({ name: "registry", root: eduHome, status: "failed", detail: String(error) });
  }
  return results;
}

export {
  UpdateError,
  compareVersions,
  fetchRelease,
  whatsNew,
  backupUpgradeFiles,
  migrateWorkspaces
};
//# sourceMappingURL=chunk-SZQORNZN.js.map