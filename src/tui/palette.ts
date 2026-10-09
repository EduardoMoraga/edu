/**
 * Command palette model: the `/` commands, prefix/substring filtering and
 * parsing of a typed command line. Pure; App decides what each command does.
 */

export type CommandName =
  | 'help'
  | 'agents'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'brain'
  | 'recall'
  | 'lang'
  | 'quit'
  | 'dispatch'
  | 'status';

export interface PaletteCommand {
  name: CommandName;
  /** Argument hint shown after the name; commands with args complete instead of running. */
  args?: string;
  /** Only offered in watch (crew) mode. */
  crew?: boolean;
}

export const COMMANDS: readonly PaletteCommand[] = [
  { name: 'help' },
  { name: 'agents' },
  { name: 'approve' },
  { name: 'reject' },
  { name: 'cancel' },
  { name: 'brain' },
  { name: 'recall', args: '<query>' },
  { name: 'lang', args: 'es|en' },
  { name: 'dispatch', args: '<cli> <task>', crew: true },
  { name: 'status', crew: true },
  { name: 'quit' },
];

/** Commands available in this view. */
export function availableCommands(crew: boolean): PaletteCommand[] {
  return COMMANDS.filter((c) => crew || !c.crew);
}

/** Prefix matches first, then substring matches, keeping declaration order. */
export function filterCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  const prefix = commands.filter((c) => c.name.startsWith(q));
  const inner = commands.filter((c) => !c.name.startsWith(q) && c.name.includes(q));
  return [...prefix, ...inner];
}

/** The palette is open while the draft is a single-line `/word` with no arguments yet. */
export function paletteQuery(draft: string): string | undefined {
  const match = /^\/(\S*)$/.exec(draft);
  return match ? match[1] : undefined;
}

export interface ParsedCommand {
  name: string;
  args: string;
}

/** `/recall oauth flow` → { name: 'recall', args: 'oauth flow' }; undefined for plain text. */
export function parseCommand(text: string): ParsedCommand | undefined {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return undefined;
  return { name: match[1]!.toLowerCase(), args: (match[2] ?? '').trim() };
}

export function findCommand(commands: readonly PaletteCommand[], name: string): PaletteCommand | undefined {
  return commands.find((c) => c.name === name);
}
