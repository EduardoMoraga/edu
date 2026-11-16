import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Command } from 'commander';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProgram } from '../cli/program.js';

// The docs a user reads before installing must not send them to a missing file or a command that does not exist.
const ROOT = join(import.meta.dirname, '..', '..');
const READMES = ['README.md', 'docs/README.es.md'];
/** Docs whose code blocks may show only commands edu defines: the READMEs and the guides for the current release. */
// The Claude Code guide is claude-code.md. On case-insensitive filesystems (macOS, Windows) claude.md IS
// CLAUDE.md: Claude Code loads it as project instructions, and git (core.ignorecase) drops it through the
// CLAUDE.md rule in .gitignore.
const COMMAND_DOCS = [...READMES, 'docs/guides/claude-code.md', 'docs/guides/upgrade-6.0.md', 'docs/guides/upgrade-6.0.es.md'];

const posix = (path: string) => path.split(sep).join('/');

async function markdownUnder(dir: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return markdownUnder(path);
    return entry.name.endsWith('.md') ? [path] : [];
  }));
  return nested.flat();
}

/** Splits markdown into prose (links count) and fenced code blocks (commands count). */
function split(markdown: string): { prose: string; code: string[] } {
  const prose: string[] = []; const code: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) { fence = fence ? undefined : marker; continue; }
    (fence ? code : prose).push(line);
  }
  // Inline code spans are examples, not links.
  return { prose: prose.join('\n').replace(/`[^`\n]*`/g, ''), code };
}

/** Relative link targets (inline links and images) that do not resolve to a file or directory. */
async function brokenLinks(file: string): Promise<string[]> {
  const { prose } = split(await readFile(join(ROOT, file), 'utf8'));
  const broken: string[] = [];
  for (const [, raw] of prose.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const target = raw!.split('#')[0]!.split('?')[0]!;
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(raw!)) continue; // anchors, http(s), mailto, ...
    const path = resolve(ROOT, dirname(file), decodeURIComponent(target));
    if (!existsSync(path)) broken.push(`${file}: ${raw} (${posix(relative(ROOT, path))})`);
  }
  return broken;
}

/** Resolves `edu <command> [<subcommand>…]` against the CLI; false when a command word does not exist. */
function defined(program: Command, words: string[]): boolean {
  let cmd = program;
  for (const word of words) {
    if (cmd === program && word === 'help') return true; // commander's help command is not in .commands
    if (!/^[a-z][a-z-]*$/.test(word) || !cmd.commands.length) return true; // an option, argument or placeholder
    const next = cmd.commands.find(sub => sub.name() === word || sub.aliases().includes(word));
    if (!next) return cmd !== program && cmd.registeredArguments.length > 0; // a plain word can be an argument
    cmd = next;
  }
  return true;
}

/** `edu …` lines in a file's code blocks whose command or subcommand the CLI does not define. */
async function unknownCommands(file: string, program: Command): Promise<string[]> {
  const { code } = split(await readFile(join(ROOT, file), 'utf8'));
  return code.flatMap(line => {
    const words = /^\s*(?:\$\s+)?edu\s+(.*)$/.exec(line)?.[1]?.replace(/\s#.*$/, '').trim().split(/\s+/);
    return words && !defined(program, words) ? [`${file}: ${line.trim()}`] : [];
  });
}

let docs: string[] = [];
let program: Command;
beforeAll(async () => {
  docs = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', ...(await markdownUnder('docs'))];
  program = createProgram({}, { exitOverride: true });
});

describe('documentation', () => {
  it('finds the READMEs, the current guides and the docs tree', () => {
    expect(docs).toEqual(expect.arrayContaining([...COMMAND_DOCS, 'docs/ARCHITECTURE.md']));
  });

  it('has no doc named claude.md, which is CLAUDE.md on case-insensitive filesystems', () => {
    expect(docs.filter(file => file.split('/').pop()!.toLowerCase() === 'claude.md')).toEqual([]);
  });

  it('has no broken relative links in README.md and docs/**', async () => {
    const broken = (await Promise.all(docs.map(brokenLinks))).flat();
    expect(broken).toEqual([]);
  });

  it('shows only commands that edu defines in the READMEs and current guides', async () => {
    const unknown = (await Promise.all(COMMAND_DOCS.map(file => unknownCommands(file, program)))).flat();
    expect(unknown).toEqual([]);
  });
});
