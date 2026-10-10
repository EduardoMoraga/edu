import {
  CLI_IDS,
  getManifestPath,
  hasTopLevelTomlKey,
  readTarget,
  sha256
} from "./chunk-66HGH7YW.js";
import {
  binaryOnPath
} from "./chunk-ROTDA577.js";

// src/adapters/doctor.ts
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";
async function readManifest(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || !Array.isArray(value.actions)) throw new Error("Invalid manifest");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
async function diagnose(options) {
  const root = resolve(options.root);
  const home = resolve(options.home ?? homedir());
  const manifests = await Promise.all(["project", "global"].map(async (scope) => ({
    scope,
    manifest: await readManifest(getManifestPath(scope, root, home))
  })));
  const codexConfig = await readTarget(join(home, ".codex/config.toml"));
  const userOwnsCodexNotify = codexConfig !== void 0 && hasTopLevelTomlKey(codexConfig.toString("utf8"), "notify");
  const detect = options.detectBinary ?? binaryOnPath;
  return Promise.all(CLI_IDS.map(async (cli) => {
    const notes = cli === "agy" ? ["agy MCP: manual step"] : [];
    if (cli === "codex" && userOwnsCodexNotify) notes.push("A user-owned top-level Codex notify command is preserved; Edu did not add its notify hook.");
    const scopes = [];
    let drift = false;
    for (const { scope, manifest } of manifests) {
      const actions = manifest?.actions.filter((action) => (action.clis ?? [action.cli]).includes(cli)) ?? [];
      if (!actions.length) continue;
      scopes.push(scope);
      for (const action of actions) {
        const content = await readTarget(action.path);
        if (!content || !action.sha256 || sha256(content) !== action.sha256) drift = true;
      }
    }
    if (drift) notes.push("Edu-managed files differ from the manifest");
    return { cli, installed: await detect(cli), integrated: scopes.length > 0, drift, scopes, notes };
  }));
}

export {
  diagnose
};
//# sourceMappingURL=chunk-OOSJ34G5.js.map