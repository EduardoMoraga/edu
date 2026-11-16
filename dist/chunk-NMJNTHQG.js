// src/platform/package.ts
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
var cached;
function findPackageRoot(from) {
  let dir = from;
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.name === "edu-agent") return { root: dir, version: pkg.version ?? "0.0.0" };
      } catch {
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Could not locate the edu-agent package root");
    dir = parent;
  }
}
function locate() {
  cached ??= findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  return cached;
}
var packageRoot = () => locate().root;
var packageVersion = () => locate().version;
var packageTemplatesDir = () => join(locate().root, "templates");

export {
  packageRoot,
  packageVersion,
  packageTemplatesDir
};
//# sourceMappingURL=chunk-NMJNTHQG.js.map