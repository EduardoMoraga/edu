/** `edu create <docs...> --name <Agent>` and `edu create --add <docs...>`. */
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { Command } from 'commander';
import type { CliId } from '../../core/contracts.js';
import type { CreateResult, ExtractionMode, ProgressEvent } from '../../workspace/create.js';
import type { LlmRunner } from '../../workspace/extract.js';
import { globalHome, type CliContext } from '../context.js';
import type { Lang } from '../i18n.js';
import { action, look, printJson, statusLine } from '../kit.js';
import { packageTemplatesDir } from '../package.js';
import { parseCli } from './setup.js';

interface CreateOpts { name?: string; dir?: string; lang?: string; cli?: string; llm?: boolean; yes?: boolean; add?: boolean; json?: boolean }

const M = {
  es: {
    read: 'Leído {name} ({chars} caracteres)',
    llm: 'Extrayendo conocimiento con {cli} (sin interfaz)…',
    det: 'Extrayendo por títulos (sin LLM)…',
    chunk: '  parte {part}/{parts} con {cli}…',
    noCli: 'No hay claude, codex, pi ni opencode instalado: extracción por títulos (sin LLM).',
    fallback: '{cli} no devolvió un JSON válido ({error}); uso la extracción por títulos.',
    created: 'Espacio de {name} listo en {root}',
    added: 'Agregado al cerebro {brain}',
    notes: 'Notas: {accepted} aceptadas · {proposed} propuestas para aprobar · {terms} términos de glosario · {playbooks} playbooks',
    sources: 'Fuentes copiadas a {dir}: {list}',
    mode: { llm: 'Extracción: {cli}', 'no-llm': 'Extracción: por títulos (--no-llm)', 'no-cli': 'Extracción: por títulos (no hay CLI)', fallback: 'Extracción: por títulos (falló {cli})' },
    registry: { registered: 'Registrado en {path}', already: 'Ya estaba registrado en {path}' },
    registryFail: 'No se registró: {reason}',
    next: 'Siguiente:',
    nextCd: 'cd "{root}" && claude      (o codex · pi · opencode)',
    nextObsidian: 'Obsidian → Open folder as vault → {root}',
  },
  en: {
    read: 'Read {name} ({chars} characters)',
    llm: 'Extracting knowledge with {cli} (headless)…',
    det: 'Extracting by headings (no LLM)…',
    chunk: '  part {part}/{parts} with {cli}…',
    noCli: 'No claude, codex, pi or opencode installed: extracting by headings (no LLM).',
    fallback: '{cli} did not return valid JSON ({error}); using the heading extraction.',
    created: "{name}'s workspace is ready at {root}",
    added: 'Added to the brain at {brain}',
    notes: 'Notes: {accepted} accepted · {proposed} proposed for approval · {terms} glossary terms · {playbooks} playbooks',
    sources: 'Sources copied to {dir}: {list}',
    mode: { llm: 'Extraction: {cli}', 'no-llm': 'Extraction: by headings (--no-llm)', 'no-cli': 'Extraction: by headings (no CLI found)', fallback: 'Extraction: by headings ({cli} failed)' },
    registry: { registered: 'Registered in {path}', already: 'Already registered in {path}' },
    registryFail: 'Not registered: {reason}',
    next: 'Next:',
    nextCd: 'cd "{root}" && claude      (or codex · pi · opencode)',
    nextObsidian: 'Obsidian → Open folder as vault → {root}',
  },
} as const;

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));

function modeLine(lang: Lang, mode: ExtractionMode): string {
  const m = M[lang].mode;
  if (mode.kind === 'llm') return fill(m.llm, { cli: mode.cli });
  return fill(m[mode.reason], { cli: mode.cli ?? '' });
}

export interface CreateCommandDeps {
  /** Test seam: replaces the headless CLI runner. */
  runner?: LlmRunner;
}

export function registerCreate(program: Command, ctx: CliContext, deps: CreateCommandDeps = {}): void {
  program
    .command('create')
    .description('turn documents (.md .txt .docx .pdf) into a self-contained, Obsidian-ready workspace with a named agent')
    .argument('[docs...]', 'documents to learn from (never modified)')
    .option('--name <agent>', "the agent's name, e.g. Albert (also the folder name)")
    .option('--dir <parent>', 'folder that will hold the workspace (default ~/Edu)')
    .option('--lang <lang>', 'folder and README language: es | en (default EDU_LANG, then locale, then es)')
    .option('--cli <cli>', 'CLI that extracts the knowledge: claude, codex, pi or opencode (default: first installed)')
    .option('--no-llm', 'deterministic extraction by headings, no LLM')
    .option('--add', 'add the documents to the workspace you are in')
    .option('-y, --yes', 'use the target folder even if it is not empty')
    .option('--json', 'machine-readable result')
    .action(action<CreateOpts>(ctx, async ({ g, opts, cmd }) => {
      const { addDocuments, createWorkspace } = await import('../../workspace/create.js');
      const { workspaceLang } = await import('../../workspace/layout.js');
      const docs = cmd.args.map(path => resolve(g.cwd, path));
      // `--lang` is also a global option; commander gives it to this command when it follows `create`.
      const lang = workspaceLang(opts.lang ?? (cmd.optsWithGlobals() as { lang?: string }).lang, ctx.env);
      const m = M[lang];
      const lk = look(ctx);
      const json = Boolean(opts.json || g.json);
      const say = (text: string) => { if (!json) ctx.out(text); };
      const progress = (event: ProgressEvent) => {
        if (event.type === 'read') say(statusLine(lk, 'ok', fill(m.read, { name: event.name, chars: event.chars })));
        else if (event.type === 'extract') say(event.mode === 'llm' ? fill(m.llm, { cli: event.cli ?? '' }) : m.det);
        else if (event.type === 'chunk' && event.parts > 1) say(fill(m.chunk, event));
        else if (event.type === 'no-cli') say(statusLine(lk, 'warn', m.noCli));
        else if (event.type === 'fallback') ctx.err(statusLine(lk, 'warn', fill(m.fallback, { cli: event.cli, error: event.error.slice(0, 200) })));
      };
      const cli: CliId | undefined = opts.cli ? parseCli(opts.cli) : undefined;
      const detected = opts.llm === false ? [] : await ctx.detectClis();
      const extractDeps = { detected, runner: deps.runner, engineFactory: ctx.engineFactory, progress };
      const noLlm = opts.llm === false;

      if (opts.add) {
        const result = await addDocuments({ docs, cwd: g.cwd, cli, noLlm, env: { ...ctx.env, HOME: ctx.env.HOME ?? ctx.home } }, extractDeps);
        if (json) return printJson(ctx, result);
        say(statusLine(lk, 'ok', fill(m.added, { brain: result.brain })));
        say(`  ${modeLine(lang, result.mode)}`);
        say(`  ${notesLine(lang, result.report)}`);
        say(`  ${fill(m.sources, { dir: relative(result.root, result.sourcesDir), list: result.sources.join(', ') })}`);
        return;
      }

      const result: CreateResult = await createWorkspace({
        docs, agentName: opts.name ?? '', parent: resolve(g.cwd, opts.dir ?? resolve(ctx.env.HOME || ctx.home || homedir(), 'Edu')),
        lang, cli, noLlm, yes: Boolean(opts.yes), eduHome: globalHome(ctx), templatesDir: packageTemplatesDir(),
      }, extractDeps);
      if (json) return printJson(ctx, result);
      say(statusLine(lk, 'ok', fill(m.created, { name: result.identity.name, root: result.root })));
      say(`  ${modeLine(lang, result.mode)}`);
      say(`  ${notesLine(lang, result.report)}`);
      say(`  ${fill(m.sources, { dir: `${result.layout.knowledge}/${result.layout.sources}`, list: result.sources.join(', ') })}`);
      say(`  ${result.registry === 'registered' || result.registry === 'already' ? fill(m.registry[result.registry], { path: join(globalHome(ctx), 'projects.json') }) : fill(m.registryFail, { reason: result.registry })}`);
      say('');
      say(m.next);
      say(`  ${fill(m.nextCd, { root: result.root })}`);
      say(`  ${fill(m.nextObsidian, { root: result.root })}`);
    }));
}

function notesLine(lang: Lang, report: { accepted: number; proposed: number; glossaryTerms: number; playbooks: string[] }): string {
  return fill(M[lang].notes, { accepted: report.accepted, proposed: report.proposed, terms: report.glossaryTerms, playbooks: report.playbooks.length });
}
