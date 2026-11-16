/**
 * The 6.0 layer model as data, and the import graph of src/ it is checked against
 * (src/test-support/architecture.test.ts). docs/ARCHITECTURE.md renders its module map and
 * dependency table from MODULES, and a test keeps the doc equal to this data.
 *
 * A module is a top-level folder of src/ (`src/brain/**` is `brain`); `src/index.ts` is the package
 * entry. Test files and src/test-support/ are not part of the graph.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export const LAYERS = ['core', 'platform', 'domain', 'service', 'delivery'] as const;
export type Layer = typeof LAYERS[number];

export const LAYER_PURPOSE: Record<Layer, string> = {
  core: 'Contracts: the shared types and constants. Depends on nothing.',
  platform: 'Infrastructure helpers: processes, files, locks, the child environment, the package root.',
  domain: 'The model: notes and recall, context budgets, engines, evidence, skills, identity.',
  service: 'Use cases built on the domain: orchestration, crew, reflection, sync, workspaces, host setup.',
  delivery: 'How people and hosts reach Edu: the MCP server, the TUI and the CLI.',
};

export interface ModuleSpec {
  layer: Layer;
  /** One line for the module map in docs/ARCHITECTURE.md. */
  purpose: string;
  /** Modules this one may import. Only the same or a lower layer; the graph must stay acyclic. */
  mayImport: readonly string[];
}

/** Every module under src/, in layer order. */
export const MODULES: Readonly<Record<string, ModuleSpec>> = {
  core: { layer: 'core', purpose: 'Contracts: notes, events, config, engines, approvals, crew settings', mayImport: [] },
  platform: { layer: 'platform', purpose: 'Process launch and tree kill, child env, file locks, fs retries, package root, PATH lookup', mayImport: ['core'] },
  identity: { layer: 'domain', purpose: 'Voice, banner, palette, glyphs and display-width helpers', mayImport: ['core'] },
  skills: { layer: 'domain', purpose: 'Skill bundles: validation, limits and portable paths', mayImport: ['core'] },
  engine: { layer: 'domain', purpose: 'One adapter per agent CLI: argv, autonomy flags, JSONL to EduEvent', mayImport: ['core', 'platform'] },
  brain: { layer: 'domain', purpose: 'The Markdown second brain: notes, recall, learning, lint, views, project registry', mayImport: ['core', 'platform'] },
  context: { layer: 'domain', purpose: 'Token estimates, context packs and the session brief', mayImport: ['brain', 'core'] },
  evidence: { layer: 'domain', purpose: 'Episode packages, check registry, attribution and metrics', mayImport: ['brain', 'core', 'platform'] },
  adapters: { layer: 'service', purpose: 'Per-host install plans: managed blocks, JSON/TOML merges, manifests, host files', mayImport: ['core', 'platform', 'skills'] },
  detach: { layer: 'service', purpose: 'Removes other tools from host configs, with backups and undo', mayImport: ['adapters', 'platform'] },
  doctor: { layer: 'service', purpose: 'Health checks: CLI integration, native plugins, context weight', mayImport: ['adapters', 'core', 'detach', 'platform'] },
  release: { layer: 'service', purpose: 'Release capabilities of the running version', mayImport: ['platform'] },
  vault: { layer: 'service', purpose: 'Obsidian vault link and Git sync with conflict copies', mayImport: ['brain', 'core', 'platform'] },
  update: { layer: 'service', purpose: 'Verified self-update and workspace migrations', mayImport: ['brain', 'platform', 'release'] },
  reflect: { layer: 'service', purpose: 'Self-improvement: reflection, consolidation, dreams, skill proposals, auto-maintain', mayImport: ['adapters', 'brain', 'context', 'core', 'engine', 'platform', 'skills'] },
  workspace: { layer: 'service', purpose: 'Workspaces: init, config, create, scaffold, ingest and readers', mayImport: ['adapters', 'brain', 'core', 'engine', 'platform'] },
  setup: { layer: 'service', purpose: 'Native plugin setup, upgrade and uninstall for every host', mayImport: ['adapters', 'brain', 'core', 'detach', 'platform', 'reflect', 'update', 'vault', 'workspace'] },
  orchestrator: { layer: 'service', purpose: 'Plan, approve, build, verify, review and learn for one goal', mayImport: ['brain', 'context', 'core', 'engine', 'evidence', 'platform', 'reflect', 'workspace'] },
  crew: { layer: 'service', purpose: 'Crew jobs: headless and pane workers, status, approvals, cancel', mayImport: ['brain', 'context', 'core', 'engine', 'orchestrator', 'platform', 'workspace'] },
  chat: { layer: 'service', purpose: 'One chat turn with brain context', mayImport: ['brain', 'context', 'core', 'engine'] },
  eval: { layer: 'service', purpose: 'Evaluation suites across harness levels', mayImport: ['brain', 'context'] },
  bench: { layer: 'service', purpose: 'Retrieval and activation benchmarks', mayImport: ['brain', 'core'] },
  experiment: { layer: 'service', purpose: 'Isolated skill experiments in throwaway workspaces', mayImport: ['platform', 'skills'] },
  connect: { layer: 'service', purpose: 'Connects Edu to other agents (Hermes)', mayImport: ['platform'] },
  mcp: { layer: 'delivery', purpose: 'The MCP server and its tools', mayImport: ['brain', 'context', 'core', 'crew', 'platform', 'reflect', 'release', 'workspace'] },
  tui: { layer: 'delivery', purpose: 'Ink views: live run, watch and mission deck', mayImport: ['core', 'crew', 'identity'] },
  cli: {
    layer: 'delivery', purpose: 'The `edu` command and host hooks',
    mayImport: ['adapters', 'bench', 'brain', 'chat', 'connect', 'context', 'core', 'crew', 'detach', 'doctor', 'engine', 'eval', 'evidence', 'experiment', 'identity', 'mcp', 'orchestrator', 'platform', 'reflect', 'release', 'setup', 'tui', 'update', 'vault', 'workspace'],
  },
  index: { layer: 'delivery', purpose: 'Package entry (src/index.ts): contracts and createProgram', mayImport: ['cli', 'core'] },
};

/** The only modules that may import src/cli: the CLI itself and the package entry that re-exports createProgram. */
export const CLI_IMPORTERS: readonly string[] = ['cli', 'index'];

export const SRC = resolve(import.meta.dirname, '..');
const TEST_SUPPORT = 'test-support';

export interface ImportEdge { from: string; to: string; file: string; specifier: string }

const isTest = (name: string) => /\.test\.tsx?$/.test(name);
const isSource = (name: string) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts');
const posix = (path: string) => path.split(sep).join('/');

/** Module of a path under src/, or undefined outside src/. */
export function moduleOf(path: string, src = SRC): string | undefined {
  const rel = relative(src, path);
  if (!rel || rel.startsWith('..')) return undefined;
  const [first, ...rest] = rel.split(sep);
  return rest.length ? first : first!.replace(/\.tsx?$/, '');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return isSource(entry.name) && !isTest(entry.name) ? [path] : [];
  });
}

/**
 * Every relative import between modules in non-test files: static imports and re-exports (type-only
 * ones included), side-effect imports and dynamic `import()`.
 */
export function importGraph(src = SRC): { files: string[]; edges: ImportEdge[]; testSupportImports: ImportEdge[] } {
  const files = sourceFiles(src).filter(file => moduleOf(file, src) !== TEST_SUPPORT);
  const edges: ImportEdge[] = [];
  const testSupportImports: ImportEdge[] = [];
  for (const file of files) {
    const from = moduleOf(file, src)!;
    for (const { fileName: specifier } of ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles) {
      if (!specifier.startsWith('.')) continue;
      const to = moduleOf(resolve(dirname(file), specifier), src);
      if (!to || to === from) continue;
      const edge = { from, to, file: posix(relative(src, file)), specifier };
      (to === TEST_SUPPORT ? testSupportImports : edges).push(edge);
    }
  }
  return { files, edges, testSupportImports };
}

/**
 * Relative imports in `file` that load code at run time: everything except `import type` / `export type`
 * clauses. Node's type stripping (`node --experimental-strip-types`) keeps the rest, and cannot resolve
 * a `.js` specifier to its `.ts` source.
 */
export function runtimeRelativeImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true : node.isTypeOnly;
      if (node.moduleSpecifier.text.startsWith('.') && !typeOnly) found.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument) && argument.text.startsWith('.')) found.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** src/ files that scripts/*.ts load directly through Node's type stripping (`../src/….ts`). */
export function strippedSourceFiles(scripts = join(SRC, '..', 'scripts')): string[] {
  const loaded = readdirSync(scripts).filter(name => name.endsWith('.ts') && !isTest(name)).flatMap(name => {
    const file = join(scripts, name);
    return runtimeRelativeImports(file).filter(spec => spec.startsWith('../src/')).map(spec => resolve(scripts, spec));
  });
  return [...new Set(loaded)].sort();
}

/** Top-level folders (and root files) of src/ that hold production code. */
export function sourceModules(src = SRC): string[] {
  return [...new Set(sourceFiles(src).map(file => moduleOf(file, src)!))].filter(name => name !== TEST_SUPPORT).sort();
}

/** Module-level adjacency of the graph. */
export function moduleEdges(edges: readonly ImportEdge[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    if (!graph.has(from)) graph.set(from, new Set());
    graph.get(from)!.add(to);
  }
  return graph;
}

/** Strongly connected components with more than one module (Tarjan), each sorted. */
export function cycles(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let index = 0;
  const indexes = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  const visit = (node: string) => {
    indexes.set(node, index); low.set(node, index); index++;
    stack.push(node); onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!indexes.has(next)) { visit(next); low.set(node, Math.min(low.get(node)!, low.get(next)!)); }
      else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, indexes.get(next)!));
    }
    if (low.get(node) !== indexes.get(node)) return;
    const component: string[] = [];
    let member: string;
    do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== node);
    if (component.length > 1) found.push(component.sort());
  };
  for (const node of [...graph.keys()].sort()) if (!indexes.has(node)) visit(node);
  return found;
}

/** Edges the table forbids, as `module → module: file imports specifier`. */
export function violations(edges: readonly ImportEdge[], modules: Readonly<Record<string, ModuleSpec>> = MODULES): string[] {
  return edges
    .filter(edge => !modules[edge.from]?.mayImport.includes(edge.to))
    .map(edge => `${edge.from} → ${edge.to}: ${edge.file} imports ${edge.specifier}`);
}

/** The module map of docs/ARCHITECTURE.md, rendered from MODULES. */
export function renderModuleMap(modules: Readonly<Record<string, ModuleSpec>> = MODULES): string {
  const rows = Object.entries(modules).map(([name, spec]) => `| \`${name === 'index' ? 'src/index.ts' : `src/${name}/`}\` | ${spec.layer} | ${spec.purpose} |`);
  return ['| Module | Layer | Purpose |', '|---|---|---|', ...rows].join('\n');
}

/** The allowed-dependency table of docs/ARCHITECTURE.md, rendered from MODULES. */
export function renderDependencyTable(modules: Readonly<Record<string, ModuleSpec>> = MODULES): string {
  const rows = Object.entries(modules).map(([name, spec]) => `| ${name} | ${spec.layer} | ${spec.mayImport.length ? spec.mayImport.join(', ') : '—'} |`);
  return ['| Module | Layer | May import |', '|---|---|---|', ...rows].join('\n');
}
