// src/identity/glyphs.ts
var UNICODE_GLYPHS = {
  unicode: true,
  roles: { lead: "\u25C6", explorer: "\u{1F50D}", builder: "\u2699", reviewer: "\u2696" },
  customRole: "\u25C7",
  status: {
    queued: "\u25CB",
    running: "\u25CF",
    "awaiting-approval": "\u23F8",
    done: "\u2713",
    failed: "\u2717",
    cancelled: "\u2298"
  },
  brain: "\u{1F9E0}",
  sep: "\xB7",
  arrow: "\u203A",
  ok: "\u2713",
  fail: "\u2717",
  pending: "\u2026",
  thinking: "\u2234",
  selected: "\u25B8",
  cursor: "\u258F",
  ellipsis: "\u2026",
  approval: "\u23F8",
  tree: { branch: "\u251C ", last: "\u2514 ", pipe: "\u2502 ", space: "  " },
  rule: "\u2500"
};
var ASCII_GLYPHS = {
  unicode: false,
  roles: { lead: "*", explorer: "?", builder: "#", reviewer: "=" },
  customRole: "-",
  status: {
    queued: "o",
    running: ">",
    "awaiting-approval": "!",
    done: "+",
    failed: "x",
    cancelled: "/"
  },
  brain: "brain:",
  sep: "-",
  arrow: ">",
  ok: "+",
  fail: "x",
  pending: "...",
  thinking: "~",
  selected: ">",
  cursor: "_",
  ellipsis: "...",
  approval: "!",
  tree: { branch: "|-", last: "`-", pipe: "| ", space: "  " },
  rule: "-"
};
function detectUnicode(env = process.env) {
  if (env.EDU_ASCII === "1") return false;
  const locale = [env.LC_ALL, env.LC_CTYPE, env.LANG].find((v) => v !== void 0 && v !== "");
  if (locale === void 0) return true;
  return /utf-?8/i.test(locale);
}
function getGlyphs(env = process.env) {
  return detectUnicode(env) ? UNICODE_GLYPHS : ASCII_GLYPHS;
}
function roleIcon(role, glyphs) {
  return isBuiltinRole(role) ? glyphs.roles[role] : glyphs.customRole;
}
function statusGlyph(status, glyphs) {
  return glyphs.status[status];
}
function isBuiltinRole(role) {
  return role === "lead" || role === "explorer" || role === "builder" || role === "reviewer";
}

// src/identity/theme.ts
var PALETTE = {
  accent: { truecolor: "#F5A855", ansi256: 215, ansi16: "yellow" },
  success: { truecolor: "#8CC48A", ansi256: 114, ansi16: "green" },
  danger: { truecolor: "#E5717A", ansi256: 168, ansi16: "red" },
  muted: { truecolor: "#8A919E", ansi256: 246, ansi16: "gray" },
  border: { truecolor: "#4E5562", ansi256: 240, ansi16: "gray" }
};
var ANSI16_CODE = {
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90
};
function detectColorLevel({ env, isTTY }) {
  const force = env.FORCE_COLOR;
  if (force !== void 0) {
    const v = force.trim().toLowerCase();
    if (v === "0" || v === "false") return 0;
    if (v === "2") return 2;
    if (v === "3") return 3;
    return 1;
  }
  if (env.NO_COLOR !== void 0 && env.NO_COLOR !== "") return 0;
  if (!isTTY) return 0;
  const term = (env.TERM ?? "").toLowerCase();
  if (term === "dumb") return 0;
  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return 3;
  if (env.WT_SESSION) return 3;
  const program = env.TERM_PROGRAM ?? "";
  if (["iTerm.app", "WezTerm", "ghostty", "vscode"].includes(program)) return 3;
  if (term.includes("256")) return 2;
  return 1;
}
function createTheme(level) {
  return {
    level,
    styled: level > 0,
    color(token) {
      const entry = PALETTE[token];
      if (level === 3) return entry.truecolor;
      if (level === 2) return `ansi256(${entry.ansi256})`;
      if (level === 1) return entry.ansi16;
      return void 0;
    },
    paint(token, text, opts = {}) {
      if (level === 0) return text;
      const codes = [];
      if (opts.bold) codes.push("1");
      if (opts.dim) codes.push("2");
      if (token) codes.push(fgCode(PALETTE[token], level));
      if (codes.length === 0) return text;
      return codes.map((c) => `\x1B[${c}m`).join("") + text + "\x1B[0m";
    }
  };
}
function detectTheme(env = process.env, isTTY = Boolean(process.stdout.isTTY)) {
  return createTheme(detectColorLevel({ env, isTTY }));
}
function fgCode(entry, level) {
  if (level === 3) {
    const hex = entry.truecolor.slice(1);
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `38;2;${r};${g};${b}`;
  }
  if (level === 2) return `38;5;${entry.ansi256}`;
  return String(ANSI16_CODE[entry.ansi16]);
}

// src/identity/banner.ts
var TAGLINE = "a second brain that learns \xB7 a crew you can see";
var TAGLINE_ASCII = "a second brain that learns - a crew you can see";
var WORDMARK_UNICODE = [
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557   \u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551",
  "\u2588\u2588\u2554\u2550\u2550\u255D  \u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D",
  "\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u255D "
];
var WORDMARK_ASCII = [
  " _____ ____  _   _ ",
  "| ____|  _ \\| | | |",
  "|  _| | | | | | | |",
  "| |___| |_| | |_| |",
  "|_____|____/ \\___/ "
];
function renderBanner(opts) {
  const theme = opts.theme ?? createTheme(0);
  const mark = (opts.unicode ? WORDMARK_UNICODE : WORDMARK_ASCII).map(
    (l) => theme.paint("accent", l.trimEnd(), { bold: true })
  );
  const tagline = opts.unicode ? TAGLINE : TAGLINE_ASCII;
  const sig = [];
  if (opts.name && opts.name.toLowerCase() !== "edu") sig.push(opts.name);
  if (opts.version) sig.push(`v${opts.version}`);
  const lines = [...mark, "", theme.paint("muted", tagline)];
  if (sig.length > 0) lines.push(theme.paint("muted", sig.join(opts.unicode ? " \xB7 " : " - ")));
  return lines.join("\n");
}

// src/identity/statusline.ts
function renderStatusline(stats, opts) {
  const { glyphs } = opts;
  const theme = opts.theme ?? createTheme(0);
  const name = (opts.name ?? "Edu").toUpperCase();
  const mark = theme.paint("accent", `${glyphs.roles.lead} ${name}`, { bold: true });
  const parts = [
    `brain ${count(stats.brainNotes)}`,
    `${count(stats.lessons)} ${stats.lessons === 1 ? "lesson" : "lessons"}`
  ];
  if (stats.ctxPercent !== void 0 && Number.isFinite(stats.ctxPercent)) {
    parts.push(`ctx ${Math.round(Math.min(100, Math.max(0, stats.ctxPercent)))}%`);
  }
  const sep = ` ${glyphs.sep} `;
  return [mark, ...parts].join(sep);
}
function count(n) {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// src/identity/format.ts
function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1e3) return String(Math.round(n));
  const k = n / 1e3;
  if (k < 999.95) return `${trimZero(k.toFixed(1))}k`;
  return `${trimZero((n / 1e6).toFixed(1))}M`;
}
function formatCost(usd) {
  if (usd === void 0 || !Number.isFinite(usd)) return "$\u2014";
  if (usd <= 0) return "$0.00";
  if (usd < 5e-3) return "<$0.01";
  if (usd >= 100) return `$${Math.round(usd)}`;
  return `$${usd.toFixed(2)}`;
}
function formatDuration(ms) {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1e3));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${pad2(m)}m`;
  if (m > 0) return `${m}m${pad2(s)}s`;
  return `${s}s`;
}
function formatPercent(ratio) {
  const v = Number.isFinite(ratio) ? ratio : 0;
  return `${Math.round(v * 100)}%`;
}
function displayWidth(text) {
  let width = 0;
  let prev = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 65039) {
      if (prev === 1) width += 1;
      prev = 2;
      continue;
    }
    const w = codePointWidth(cp);
    width += w;
    prev = w;
  }
  return width;
}
function padEndDisplay(text, width) {
  const gap = width - displayWidth(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}
function truncate(text, max, ellipsis = "\u2026") {
  if (max <= 0) return "";
  if (displayWidth(text) <= max) return text;
  const room = max - displayWidth(ellipsis);
  if (room <= 0) return ellipsis.slice(0, max);
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = displayWidth(ch);
    if (used + w > room) break;
    out += ch;
    used += w;
  }
  return out + ellipsis;
}
function codePointWidth(cp) {
  if (cp === 0 || cp < 32 || cp >= 127 && cp < 160) return 0;
  if (cp >= 768 && cp <= 879 || cp >= 8203 && cp <= 8207 || cp >= 65024 && cp <= 65038) {
    return 0;
  }
  if (cp >= 4352 && cp <= 4447 || cp >= 11904 && cp <= 42191 || cp >= 44032 && cp <= 55203 || cp >= 63744 && cp <= 64255 || cp >= 65280 && cp <= 65376 || cp >= 65504 && cp <= 65510 || cp >= 127744 && cp <= 128591 || cp >= 128640 && cp <= 128767 || cp >= 129280 && cp <= 129791 || cp >= 131072 && cp <= 262141) {
    return 2;
  }
  return 1;
}
function trimZero(s) {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}
function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

export {
  createTheme,
  detectTheme,
  UNICODE_GLYPHS,
  getGlyphs,
  roleIcon,
  statusGlyph,
  renderBanner,
  renderStatusline,
  formatTokens,
  formatCost,
  formatDuration,
  formatPercent,
  displayWidth,
  padEndDisplay,
  truncate
};
//# sourceMappingURL=chunk-KP6K4SHS.js.map