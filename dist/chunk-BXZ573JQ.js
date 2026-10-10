// src/cli/package.ts
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
var cached;
function locate() {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.name === "edu-agent") {
          cached = { root: dir, version: pkg.version ?? "0.0.0" };
          return cached;
        }
      } catch {
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Could not locate the edu-agent package root");
    dir = parent;
  }
}
function packageVersion() {
  return locate().version;
}
function packageTemplatesDir() {
  return join(locate().root, "templates");
}

export {
  packageVersion,
  packageTemplatesDir
};
//# sourceMappingURL=chunk-BXZ573JQ.js.map