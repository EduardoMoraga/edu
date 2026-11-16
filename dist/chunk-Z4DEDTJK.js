import {
  readWorkspaceSettings
} from "./chunk-YPR7PZSQ.js";

// src/workspace/settings.ts
import { access, readFile } from "fs/promises";
import { join } from "path";
async function effectiveConfig(root, detected) {
  const { defaultConfig, loadConfig } = await import("./config-IKP7WT5U.js");
  const path = join(root, "config.json");
  const present = await access(path).then(() => true, () => false);
  return present ? loadConfig(path) : defaultConfig(detected[0] ?? "claude");
}
async function identityName(root) {
  const configured = (await readWorkspaceSettings(root)).identity?.name;
  if (configured) return configured;
  try {
    const text = await readFile(join(root, "EDU.md"), "utf8");
    const heading = /^#\s+(.+?)(?:\s+[—-]\s+.*)?$/m.exec(text)?.[1]?.trim();
    return heading && heading !== "{{name}}" ? heading : "Edu";
  } catch {
    return "Edu";
  }
}

export {
  effectiveConfig,
  identityName
};
//# sourceMappingURL=chunk-Z4DEDTJK.js.map