// src/adapters/paths.ts
import { join } from "path";
function pathsFor(cli, scope, root, home) {
  const project = scope === "project";
  const sharedSkills = join(project ? root : home, ".agents/skills");
  switch (cli) {
    case "claude": {
      const base = join(project ? root : home, ".claude");
      return {
        instructions: [join(project ? root : base, "CLAUDE.md")],
        skills: join(base, "skills"),
        agents: join(base, "agents"),
        mcp: join(project ? root : home, project ? ".mcp.json" : ".claude.json"),
        settings: join(base, "settings.json"),
        outputStyle: join(base, "output-styles/edu.md")
      };
    }
    case "codex":
      return {
        instructions: [join(project ? root : join(home, ".codex"), "AGENTS.md")],
        skills: sharedSkills,
        mcp: join(home, ".codex/config.toml")
      };
    case "pi":
      return {
        instructions: [join(project ? root : join(home, ".pi/agent"), "AGENTS.md")],
        skills: sharedSkills,
        mcp: join(home, ".pi/agent/mcp.json")
      };
    case "opencode":
      return {
        instructions: [join(project ? root : join(home, ".config/opencode"), "AGENTS.md")],
        skills: sharedSkills,
        mcp: join(project ? root : join(home, ".config/opencode"), "opencode.json")
      };
    case "agy":
      return {
        instructions: project ? [join(root, "GEMINI.md"), join(root, "AGENTS.md")] : [join(home, ".gemini/GEMINI.md"), join(home, ".gemini/AGENTS.md")],
        skills: sharedSkills
      };
  }
}

// src/adapters/common.ts
import { access, readdir, readFile, stat } from "fs/promises";
import { constants } from "fs";
import { delimiter, join as join2 } from "path";
async function binaryOnPath(binary) {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const target = join2(dir, `${binary}${extension}`);
      try {
        if (!(await stat(target)).isFile()) continue;
        await access(target, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
      }
    }
  }
  return false;
}
function protocol(scope, home) {
  const pointer = scope === "project" ? "@.edu/EDU.md" : `@${join2(home, ".edu/EDU.md")}`;
  return `${pointer}
1. Start with \`edu_brief\` for identity and open commitments.
2. Recall on demand with \`edu_recall\`, then \`edu_read\`.
3. Record decisions and lessons with \`edu_remember\`.
4. Treat hypotheses as unproven until evidence confirms them.
5. Close with \`edu_session_close\` and report what remains open.`;
}
function instructionActions(cli, scope, root, options) {
  return pathsFor(cli, scope, root, options.home).instructions.map((path) => ({
    cli,
    kind: "managed-block",
    path,
    description: "Install Edu protocol block",
    content: protocol(scope, options.home)
  }));
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function skillActions(cli, scope, root, options) {
  const destination = pathsFor(cli, scope, root, options.home).skills;
  const brain = join2(scope === "project" ? root : options.home, ".edu/skills");
  const sources = [join2(options.templatesDir, "skills"), brain];
  const skills = /* @__PURE__ */ new Map();
  for (const source of sources) {
    if (!await exists(source)) continue;
    for (const name of await readdir(source)) {
      if (!/^[a-zA-Z0-9][\w-]*$/.test(name)) continue;
      const file = join2(source, name, "SKILL.md");
      if (await exists(file)) skills.set(name, await readFile(file, "utf8"));
    }
  }
  return [...skills].map(([name, content]) => ({
    cli,
    kind: "file",
    path: join2(destination, name, "SKILL.md"),
    description: `Install ${name} skill`,
    content
  }));
}
async function agentTemplates(templatesDir) {
  const dir = join2(templatesDir, "agents");
  const result = [];
  for (const filename of (await readdir(dir)).filter((name) => name.endsWith(".md")).sort()) {
    const text = await readFile(join2(dir, filename), "utf8");
    const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!parts) throw new Error(`Malformed agent template: ${filename}`);
    const fields = Object.fromEntries(parts[1].split("\n").map((line) => {
      const index = line.indexOf(":");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }));
    const name = fields.id;
    if (!name || !/^[\w-]+$/.test(name)) throw new Error(`Invalid agent template: ${filename}`);
    result.push({ name, description: fields.mission ?? fields.title ?? name, tools: fields.autonomy === "readonly" ? "Read, Grep, Glob" : "Read, Write, Edit, Bash, Grep, Glob", prompt: parts[2].trim() });
  }
  return result;
}

export {
  pathsFor,
  binaryOnPath,
  instructionActions,
  skillActions,
  agentTemplates
};
//# sourceMappingURL=chunk-ROTDA577.js.map