/**
 * `edu create`: documents in, a self-contained workspace out.
 *
 *   <parent>/<slug>/
 *     00-INICIO/README.md        Home (what this is, Obsidian, how to talk to the agent)
 *     01-CONOCIMIENTO/           the brain (brainDir) + fuentes/ with copies of the originals
 *     02-ENTREGABLES/ 03-LAB/ 04-PROYECTOS/ 05-ARCHIVO/
 *     .edu/                      config (brainDir, identity), EDU.md, playbooks, state
 *     .obsidian/                 minimal vault config
 *     AGENTS.md, CLAUDE.md       Edu managed block naming the agent
 *
 * `addDocuments` ingests more documents into an existing workspace brain.
 */
import { readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { openBrain } from '../brain/brain.js';
import { brainPath, readWorkspaceSettings } from '../brain/location.js';
import { slugify } from '../brain/store.js';
import type { CliId, Engine } from '../core/contracts.js';
import type { Lang } from '../cli/i18n.js';
import { initBrain } from '../cli/setup.js';
import { identityName } from '../cli/workspace.js';
import { resolveBrainLocations } from '../mcp/locations.js';
import { readProjects, registerProject } from '../vault/registry.js';
import { extractDeterministic, extractWithLlm, type KnowledgeExtraction, type LlmRunner } from './extract.js';
import { ingestExtraction, type IngestReport } from './ingest.js';
import { workspaceLayout, type WorkspaceLayout } from './layout.js';
import { documentFormat, readDocument, type ReaderDeps, type SourceDocument } from './readers.js';
import { cliRunner, pickExtractionCli } from './runner.js';
import { agentInstructions, copySources, createFolders, readmeText, writeAgentInstructions, writeIfMissing, writeObsidianConfig } from './scaffold.js';

export type ExtractionMode =
  | { kind: 'llm'; cli: CliId }
  | { kind: 'deterministic'; reason: 'no-llm' | 'no-cli' | 'fallback'; cli?: CliId; error?: string };

export type ProgressEvent =
  | { type: 'read'; name: string; chars: number }
  | { type: 'extract'; mode: 'llm' | 'deterministic'; cli?: CliId }
  | { type: 'chunk'; part: number; parts: number; cli: CliId }
  | { type: 'fallback'; cli: CliId; error: string }
  | { type: 'no-cli' };

export interface ExtractDeps {
  detected: CliId[];
  /** Overrides the headless CLI (tests); never call real LLMs from tests. */
  runner?: LlmRunner;
  engineFactory?: (cli: CliId) => Engine;
  readers?: ReaderDeps;
  chunkChars?: number;
  progress?: (event: ProgressEvent) => void;
}

export interface ExtractRequest { agentName: string; lang: Lang; cli?: CliId; noLlm: boolean }

/** Reads every document first so a bad path or format fails before anything is written. */
export async function readDocuments(paths: string[], deps: ExtractDeps): Promise<SourceDocument[]> {
  if (!paths.length) throw new Error('Pass at least one document (.md, .txt, .docx or .pdf)');
  for (const path of paths) {
    documentFormat(path);
    if (!(await stat(path).catch(() => undefined))?.isFile()) throw new Error(`Document not found: ${path}`);
  }
  const docs: SourceDocument[] = [];
  for (const path of paths) {
    const doc = await readDocument(path, deps.readers);
    deps.progress?.({ type: 'read', name: doc.name, chars: doc.text.length });
    docs.push(doc);
  }
  return docs;
}

export async function extractKnowledge(docs: SourceDocument[], req: ExtractRequest, deps: ExtractDeps): Promise<{ extraction: KnowledgeExtraction; mode: ExtractionMode }> {
  const deterministic = () => extractDeterministic(docs, req.agentName);
  if (req.noLlm) {
    deps.progress?.({ type: 'extract', mode: 'deterministic' });
    return { extraction: deterministic(), mode: { kind: 'deterministic', reason: 'no-llm' } };
  }
  const cli = pickExtractionCli(deps.detected, req.cli);
  if (!cli) {
    deps.progress?.({ type: 'no-cli' });
    return { extraction: deterministic(), mode: { kind: 'deterministic', reason: 'no-cli' } };
  }
  deps.progress?.({ type: 'extract', mode: 'llm', cli });
  const run = deps.runner ?? cliRunner(cli, deps.engineFactory);
  try {
    const extraction = await extractWithLlm(docs, run, {
      agentName: req.agentName, lang: req.lang, chunkChars: deps.chunkChars,
      onChunk: (part, parts) => deps.progress?.({ type: 'chunk', part, parts, cli }),
    });
    return { extraction, mode: { kind: 'llm', cli } };
  } catch (error) {
    // Invalid answers (ExtractionError) and CLI failures alike fall back to the deterministic split.
    const message = error instanceof Error ? error.message : String(error);
    deps.progress?.({ type: 'fallback', cli, error: message });
    return { extraction: deterministic(), mode: { kind: 'deterministic', reason: 'fallback', cli, error: message } };
  }
}

export interface CreateOptions extends ExtractRequest {
  docs: string[];
  /** Folder that will hold `<slug>/` (default ~/Edu). */
  parent: string;
  yes: boolean;
  eduHome: string;
  templatesDir: string;
}

export interface CreateResult {
  root: string;
  layout: WorkspaceLayout;
  mode: ExtractionMode;
  report: IngestReport;
  sources: string[];
  identity: KnowledgeExtraction['identity'];
  /** 'registered', 'already' or the reason it was skipped. */
  registry: string;
}

export async function createWorkspace(opts: CreateOptions, deps: ExtractDeps): Promise<CreateResult> {
  const name = opts.agentName.trim();
  if (!name) throw new Error('--name is required: the agent\'s name, e.g. --name Albert');
  const root = resolve(opts.parent, slugify(name));
  const entries = await readdir(root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  if (entries.length && !opts.yes) throw new Error(`${root} is not empty; pass --yes to add to it, or choose another --dir or --name`);

  const docs = await readDocuments(opts.docs.map(path => resolve(path)), deps);
  const { extraction, mode } = await extractKnowledge(docs, { ...opts, agentName: name }, deps);

  const layout = workspaceLayout(opts.lang);
  await createFolders(root, layout);
  const eduRoot = join(root, '.edu');
  const location = { scope: 'project' as const, root: eduRoot, brainDir: join(root, layout.knowledge) };
  const init = await initBrain({ location, templatesDir: opts.templatesDir, name, cli: mode.kind === 'llm' ? mode.cli : opts.cli, lang: opts.lang, detected: deps.detected });
  const { loadConfig, saveConfig } = await import('../orchestrator/config.js');
  const configPath = join(eduRoot, 'config.json');
  const config = await loadConfig(configPath);
  const identity = { name, ...(extraction.identity.role ? { role: extraction.identity.role } : {}), ...(extraction.identity.tone ? { tone: extraction.identity.tone } : {}), ...(extraction.identity.summary ? { summary: extraction.identity.summary } : {}) };
  await saveConfig(configPath, {
    ...config, lang: opts.lang, brainDir: layout.knowledge, sourcesDir: `${layout.knowledge}/${layout.sources}`,
    identity: init.configCreated || !config.identity ? identity : config.identity,
  });

  const sources = await copySources(docs.map(doc => doc.path), join(root, layout.knowledge, layout.sources));
  const brain = openBrain([location]);
  const report = await ingestExtraction(brain, eduRoot, extraction, { lang: opts.lang, origin: sources.join(', ') });
  await writeObsidianConfig(root, layout);
  await writeIfMissing(join(root, layout.start, 'README.md'), readmeText({ name, lang: opts.lang, layout, root, summary: identity.summary, sources }));
  await writeAgentInstructions(root, agentInstructions(name, opts.lang, layout));

  let registry: string;
  try {
    const real = await realpath(root);
    const known = (await readProjects(opts.eduHome)).projects.some(entry => entry.root === real);
    await registerProject(opts.eduHome, root);
    registry = known ? 'already' : 'registered';
  } catch (error) {
    registry = error instanceof Error ? error.message : String(error);
  }
  return { root, layout, mode, report, sources, identity: { ...extraction.identity, name }, registry };
}

export interface AddOptions { docs: string[]; cwd: string; cli?: CliId; noLlm: boolean; env: NodeJS.ProcessEnv }
export interface AddResult { root: string; brain: string; mode: ExtractionMode; report: IngestReport; sources: string[]; sourcesDir: string }

/** `edu create --add`: more documents into the nearest workspace brain. */
export async function addDocuments(opts: AddOptions, deps: ExtractDeps): Promise<AddResult> {
  const locations = await resolveBrainLocations(opts.cwd, opts.env);
  const project = locations[0];
  if (project?.scope !== 'project') throw new Error('No Edu workspace here: run `edu create <docs> --name <Agent>` first, or cd into a workspace');
  const workspace = resolve(project.root, '..');
  const settings = await readWorkspaceSettings(project.root);
  const { effectiveConfig } = await import('../cli/workspace.js');
  const config = await effectiveConfig(project.root, deps.detected);
  const lang: Lang = config.lang;
  const sourcesDir = resolve(workspace, settings.sourcesDir ?? relative(workspace, join(brainPath(project), 'sources')));
  const docs = await readDocuments(opts.docs.map(path => resolve(opts.cwd, path)), deps);
  const agentName = settings.identity?.name ?? await identityName(project.root);
  const { extraction, mode } = await extractKnowledge(docs, { agentName, lang, cli: opts.cli, noLlm: opts.noLlm }, deps);
  const sources = await copySources(docs.map(doc => doc.path), sourcesDir);
  const brain = openBrain([project]);
  const report = await ingestExtraction(brain, project.root, extraction, { lang, origin: sources.join(', ') });
  return { root: workspace, brain: brainPath(project), mode, report, sources, sourcesDir };
}
