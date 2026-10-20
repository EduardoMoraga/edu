import {
  brainPath,
  withBrainDir
} from "./chunk-YPR7PZSQ.js";

// src/vault/registry.ts
import { randomUUID } from "crypto";
import { access, mkdir, readFile, realpath, rename, rm, writeFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
async function liveBrain(root) {
  const eduRoot = join(root, ".edu");
  try {
    await access(eduRoot);
  } catch {
    return void 0;
  }
  try {
    return brainPath(await withBrainDir({ scope: "project", root: eduRoot }));
  } catch {
    return void 0;
  }
}
async function withLiveBrains(registry) {
  return { projects: await Promise.all(registry.projects.map(async (entry) => ({ ...entry, brain: await liveBrain(entry.root) ?? entry.brain }))) };
}
async function readStored(eduHome) {
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
async function readProjects(eduHome) {
  return withLiveBrains(await readStored(eduHome));
}
async function registerProject(eduHome, projectRoot) {
  const root = await realpath(resolve(projectRoot));
  const name = basename(root);
  const brain = brainPath(await withBrainDir({ scope: "project", root: join(root, ".edu") }));
  const registry = await readStored(eduHome);
  const existing = registry.projects.find((entry2) => entry2.root === root);
  if (existing) {
    if (existing.brain === brain) return existing;
    existing.brain = brain;
    await writeRegistry(eduHome, registry);
    return existing;
  }
  if (registry.projects.some((entry2) => entry2.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Project name conflict in registry: ${name}`);
  }
  const entry = { name, root, brain, addedAt: (/* @__PURE__ */ new Date()).toISOString() };
  registry.projects.push(entry);
  await writeRegistry(eduHome, registry);
  return entry;
}
async function writeRegistry(eduHome, registry) {
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
}

export {
  readProjects,
  registerProject
};
//# sourceMappingURL=chunk-I6JWASFE.js.map