/**
 * Role icons, status glyphs and UI chrome characters, with a strict 7-bit
 * ASCII fallback for EDU_ASCII=1 and non-UTF-8 locales.
 */
import type { AgentStatus, RoleId } from '../core/contracts.js';

export type BuiltinRole = 'lead' | 'explorer' | 'builder' | 'reviewer';

export interface Glyphs {
  readonly unicode: boolean;
  readonly roles: Readonly<Record<BuiltinRole, string>>;
  /** Icon for user-defined roles. */
  readonly customRole: string;
  readonly status: Readonly<Record<AgentStatus, string>>;
  readonly brain: string;
  readonly sep: string;
  readonly arrow: string;
  readonly ok: string;
  readonly fail: string;
  readonly pending: string;
  readonly thinking: string;
  readonly selected: string;
  readonly cursor: string;
  readonly ellipsis: string;
  readonly approval: string;
  /** Tree connectors, each exactly two cells wide. */
  readonly tree: Readonly<{ branch: string; last: string; pipe: string; space: string }>;
  /** Horizontal rule character. */
  readonly rule: string;
}

export const UNICODE_GLYPHS: Glyphs = {
  unicode: true,
  roles: { lead: '◆', explorer: '🔍', builder: '⚙', reviewer: '⚖' },
  customRole: '◇',
  status: {
    queued: '○',
    running: '●',
    'awaiting-approval': '⏸',
    done: '✓',
    failed: '✗',
    cancelled: '⊘',
  },
  brain: '🧠',
  sep: '·',
  arrow: '›',
  ok: '✓',
  fail: '✗',
  pending: '…',
  thinking: '∴',
  selected: '▸',
  cursor: '▏',
  ellipsis: '…',
  approval: '⏸',
  tree: { branch: '├ ', last: '└ ', pipe: '│ ', space: '  ' },
  rule: '─',
};

export const ASCII_GLYPHS: Glyphs = {
  unicode: false,
  roles: { lead: '*', explorer: '?', builder: '#', reviewer: '=' },
  customRole: '-',
  status: {
    queued: 'o',
    running: '>',
    'awaiting-approval': '!',
    done: '+',
    failed: 'x',
    cancelled: '/',
  },
  brain: 'brain:',
  sep: '-',
  arrow: '>',
  ok: '+',
  fail: 'x',
  pending: '...',
  thinking: '~',
  selected: '>',
  cursor: '_',
  ellipsis: '...',
  approval: '!',
  tree: { branch: '|-', last: '`-', pipe: '| ', space: '  ' },
  rule: '-',
};

/**
 * Unicode is assumed unless EDU_ASCII=1 or the effective locale
 * (LC_ALL > LC_CTYPE > LANG, first non-empty) is set and not UTF-8.
 */
export function detectUnicode(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.EDU_ASCII === '1') return false;
  const locale = [env.LC_ALL, env.LC_CTYPE, env.LANG].find((v) => v !== undefined && v !== '');
  if (locale === undefined) return true;
  return /utf-?8/i.test(locale);
}

export function getGlyphs(env: Readonly<Record<string, string | undefined>> = process.env): Glyphs {
  return detectUnicode(env) ? UNICODE_GLYPHS : ASCII_GLYPHS;
}

export function roleIcon(role: RoleId, glyphs: Glyphs): string {
  return isBuiltinRole(role) ? glyphs.roles[role] : glyphs.customRole;
}

export function statusGlyph(status: AgentStatus, glyphs: Glyphs): string {
  return glyphs.status[status];
}

function isBuiltinRole(role: string): role is BuiltinRole {
  return role === 'lead' || role === 'explorer' || role === 'builder' || role === 'reviewer';
}
