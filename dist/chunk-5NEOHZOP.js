import {
  brainPath,
  withBrainDir
} from "./chunk-RNBAJYPV.js";

// src/vault/registry.ts
import { randomUUID } from "crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
async function readProjects(eduHome) {
  let raw;
  try {
    raw = await readFile(join(eduHome, "projects.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { projects: [] };
    throw error;
  }
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || !("projects" in data) || !Array.isArray(data.projects) || !data.projects.every((entry) => entry && typeof entry === "object" && ["name", "root", "brain", "addedAt"].every((key) => typeof entry[key] === "string"))) {
    throw new Error(`Invalid project registry: ${join(eduHome, "projects.json")}`);
  }
  return data;
}
async function registerProject(eduHome, projectRoot) {
  const root = await realpath(resolve(projectRoot));
  const name = basename(root);
  const brain = brainPath(await withBrainDir({ scope: "project", root: join(root, ".edu") }));
  const registry = await readProjects(eduHome);
  const existing = registry.projects.find((entry2) => entry2.root === root);
  if (existing) return existing;
  if (registry.projects.some((entry2) => entry2.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Project name conflict in registry: ${name}`);
  }
  const entry = { name, root, brain, addedAt: (/* @__PURE__ */ new Date()).toISOString() };
  registry.projects.push(entry);
  const path = join(eduHome, "projects.json");
  await mkdir(dirname(path), { recursive: true });
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

export {
  readProjects,
  registerProject
};
//# sourceMappingURL=chunk-5NEOHZOP.js.map