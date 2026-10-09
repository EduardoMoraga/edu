/**
 * Edu palette and color-level detection.
 *
 * One accent (warm amber) carries identity and attention; green and red are
 * reserved for outcomes; everything else is the terminal's default foreground
 * or a muted gray. Every token has truecolor, 256 and 16-color variants, and
 * level 0 (NO_COLOR, pipes) emits no escapes at all.
 */

export type ColorLevel = 0 | 1 | 2 | 3;

export type ToneToken = 'accent' | 'success' | 'danger' | 'muted' | 'border';

type Ansi16 = 'yellow' | 'green' | 'red' | 'gray' | 'blue' | 'cyan' | 'magenta' | 'white';

export interface PaletteEntry {
  truecolor: string;
  ansi256: number;
  ansi16: Ansi16;
}

export const PALETTE: Readonly<Record<ToneToken, PaletteEntry>> = {
  accent: { truecolor: '#F5A855', ansi256: 215, ansi16: 'yellow' },
  success: { truecolor: '#8CC48A', ansi256: 114, ansi16: 'green' },
  danger: { truecolor: '#E5717A', ansi256: 168, ansi16: 'red' },
  muted: { truecolor: '#8A919E', ansi256: 246, ansi16: 'gray' },
  border: { truecolor: '#4E5562', ansi256: 240, ansi16: 'gray' },
};

const ANSI16_CODE: Record<Ansi16, number> = {
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
};

export interface ColorEnv {
  env: Readonly<Record<string, string | undefined>>;
  isTTY: boolean;
}

/**
 * Pure color-level detection. Precedence: FORCE_COLOR (Node convention) >
 * NO_COLOR (no-color.org, non-empty) > non-TTY/dumb > terminal capabilities.
 */
export function detectColorLevel({ env, isTTY }: ColorEnv): ColorLevel {
  const force = env.FORCE_COLOR;
  if (force !== undefined) {
    const v = force.trim().toLowerCase();
    if (v === '0' || v === 'false') return 0;
    if (v === '2') return 2;
    if (v === '3') return 3;
    return 1;
  }
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 0;
  if (!isTTY) return 0;
  const term = (env.TERM ?? '').toLowerCase();
  if (term === 'dumb') return 0;
  const colorterm = (env.COLORTERM ?? '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 3;
  if (env.WT_SESSION) return 3;
  const program = env.TERM_PROGRAM ?? '';
  if (['iTerm.app', 'WezTerm', 'ghostty', 'vscode'].includes(program)) return 3;
  if (term.includes('256')) return 2;
  return 1;
}

export interface PaintOptions {
  bold?: boolean;
  dim?: boolean;
}

export interface Theme {
  readonly level: ColorLevel;
  /** False at level 0: callers must not emit bold/dim either. */
  readonly styled: boolean;
  /** Ink-compatible color string, or undefined when color is off. */
  color(token: ToneToken): string | undefined;
  /** Raw ANSI painting for non-Ink output (statusline, banner). */
  paint(token: ToneToken | undefined, text: string, opts?: PaintOptions): string;
}

export function createTheme(level: ColorLevel): Theme {
  return {
    level,
    styled: level > 0,
    color(token) {
      const entry = PALETTE[token];
      if (level === 3) return entry.truecolor;
      if (level === 2) return `ansi256(${entry.ansi256})`;
      if (level === 1) return entry.ansi16;
      return undefined;
    },
    paint(token, text, opts = {}) {
      if (level === 0) return text;
      const codes: string[] = [];
      if (opts.bold) codes.push('1');
      if (opts.dim) codes.push('2');
      if (token) codes.push(fgCode(PALETTE[token], level));
      if (codes.length === 0) return text;
      return codes.map((c) => `\u001B[${c}m`).join('') + text + '\u001B[0m';
    },
  };
}

/** Theme for the current process (reads env and stdout TTY state). */
export function detectTheme(
  env: Readonly<Record<string, string | undefined>> = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): Theme {
  return createTheme(detectColorLevel({ env, isTTY }));
}

function fgCode(entry: PaletteEntry, level: Exclude<ColorLevel, 0>): string {
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
