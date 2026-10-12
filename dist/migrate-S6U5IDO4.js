import {
  autoMaintain,
  openBrain,
  readProjects,
  refreshProjects
} from "./chunk-XCK7PFLA.js";
import {
  withBrainDir
} from "./chunk-7UTDQFLV.js";

// src/update/migrate.ts
import { access } from "fs/promises";
import { join } from "path";
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function migrateWorkspaces(eduHome, now = /* @__PURE__ */ new Date()) {
  await refreshProjects(eduHome).catch(() => void 0);
  const { projects } = await readProjects(eduHome);
  const results = [];
  for (const project of projects) {
    const base = { name: project.name, root: project.root };
    if (!await exists(project.root)) {
      results.push({ ...base, status: "missing" });
      continue;
    }
    const eduRoot = join(project.root, ".edu");
    if (!await exists(join(eduRoot, "EDU.md"))) {
      results.push({ ...base, status: "no-brain" });
      continue;
    }
    try {
      const location = await withBrainDir({ scope: "project", root: eduRoot });
      const outcome = await autoMaintain(openBrain([location]), eduRoot, { force: true, now });
      if (!outcome.ran) results.push({ ...base, status: "failed", detail: outcome.reason });
      else results.push({ ...base, status: "migrated", detail: `${outcome.report.changed.length} changed \xB7 index rebuilt` });
    } catch (error) {
      results.push({ ...base, status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
export {
  migrateWorkspaces
};
//# sourceMappingURL=migrate-S6U5IDO4.js.map