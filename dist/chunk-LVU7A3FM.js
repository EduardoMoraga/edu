// src/platform/child-env.ts
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
var BASE = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "TZ",
  "LANG",
  "LANGUAGE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  // Corporate proxies re-sign TLS; without the CA bundle every request fails.
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  // Windows: profile folders and the system variables Node, cmd.exe and the crypto stack need.
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS"
];
var BASE_PREFIXES = ["LC_"];
var EDU = ["EDU_HOME", "EDU_LANG", "EDU_CEILING_DIRECTORIES", "EDU_PROJECT", "EDU_LOCK_WORKSPACE", "EDU_MCP_PROFILE", "EDU_ASCII", "EDU_BIN"];
var PROVIDERS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "ZAI_API_KEY"
];
var CLI_AUTH = {
  claude: { names: ["CLAUDE_CONFIG_DIR"], prefixes: ["ANTHROPIC_", "CLAUDE_CODE_"] },
  codex: { names: ["AZURE_OPENAI_API_KEY"], prefixes: ["OPENAI_", "CODEX_"] },
  pi: { names: PROVIDERS, prefixes: ["PI_", "ANTHROPIC_", "OPENAI_", "AZURE_OPENAI_"] },
  opencode: { names: PROVIDERS, prefixes: ["OPENCODE_", "ANTHROPIC_", "OPENAI_", "AZURE_OPENAI_"] },
  agy: { names: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_GENAI_USE_VERTEXAI"], prefixes: ["ANTIGRAVITY_", "GEMINI_"] }
};
var CLAUDE_CLOUD = {
  CLAUDE_CODE_USE_BEDROCK: { names: [], prefixes: ["AWS_"] },
  CLAUDE_CODE_USE_VERTEX: { names: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "CLOUD_ML_REGION"], prefixes: ["VERTEX_REGION_"] }
};
var CLI_IDS = new Set(Object.keys(CLI_AUTH));
var cliOf = (command) => {
  const name = command.replace(/\\/g, "/").split("/").pop().replace(/\.(?:cmd|exe|bat|ps1)$/i, "").toLowerCase();
  return CLI_IDS.has(name) ? name : void 0;
};
function childEnv(cli, extra = {}, options = {}) {
  const source = options.source ?? process.env;
  const windows = (options.platform ?? process.platform) === "win32";
  const id = cliOf(cli);
  const auth = id ? CLI_AUTH[id] : { names: [], prefixes: [] };
  const names = /* @__PURE__ */ new Set([...BASE, ...EDU, ...auth.names, ...options.passthrough ?? configuredPassthrough(source)]);
  const prefixes = [...BASE_PREFIXES, ...auth.prefixes];
  if (id === "claude") for (const [flag, cloud] of Object.entries(CLAUDE_CLOUD)) {
    if (truthy(source[flag])) {
      cloud.names.forEach((name) => names.add(name));
      prefixes.push(...cloud.prefixes);
    }
  }
  const key = (name) => windows ? name.toUpperCase() : name;
  const allowed = new Set([...names].map(key));
  const allowedPrefixes = prefixes.map(key);
  const env = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === void 0) continue;
    const k = key(name);
    if (allowed.has(k) || allowedPrefixes.some((prefix) => k.startsWith(prefix))) env[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (windows) {
      for (const existing of Object.keys(env)) if (existing.toUpperCase() === name.toUpperCase()) delete env[existing];
    }
    if (value === void 0) delete env[name];
    else env[name] = value;
  }
  return env;
}
var truthy = (value) => Boolean(value && !/^(?:0|false|no|off)$/i.test(value.trim()));
var WORKER_POLICY_ENV = "EDU_CREW_POLICY";
var validNames = (list) => Array.isArray(list) ? list.filter((name) => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_()]*$/.test(name)) : [];
function configuredPassthrough(source = process.env) {
  const handed = source[WORKER_POLICY_ENV];
  if (handed !== void 0) {
    try {
      return validNames(JSON.parse(handed)?.passthrough);
    } catch {
      return [];
    }
  }
  const eduHome = resolve(source.EDU_HOME || join(source.HOME || source.USERPROFILE || homedir(), ".edu"));
  try {
    const config = JSON.parse(readFileSync(join(eduHome, "config.json"), "utf8"));
    return validNames(config?.crew?.env?.passthrough);
  } catch {
    return [];
  }
}
var MCP_FORWARDED_ENV = ["EDU_CREW_JOB", "EDU_HOME", "EDU_PROJECT", "EDU_LOCK_WORKSPACE", "EDU_MCP_PROFILE", "EDU_CEILING_DIRECTORIES"];
function codexMcpEntry(launch) {
  return { ...launch, env_vars: [...MCP_FORWARDED_ENV] };
}

export {
  childEnv,
  codexMcpEntry
};
//# sourceMappingURL=chunk-LVU7A3FM.js.map