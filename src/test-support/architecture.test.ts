import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI_IMPORTERS, LAYERS, MODULES, SRC, cycles, importGraph, moduleEdges, runtimeRelativeImports, sourceModules, strippedSourceFiles, violations } from './architecture.js';

const graph = importGraph();
const rank = (module: string) => LAYERS.indexOf(MODULES[module]!.layer);

describe('architecture: the layer table', () => {
  it('names every module under src/', () => {
    expect(Object.keys(MODULES).sort()).toEqual(sourceModules());
  });

  it('only lets a module import known modules in its own or a lower layer', () => {
    const wrong = Object.entries(MODULES).flatMap(([name, spec]) => spec.mayImport
      .filter(target => !MODULES[target] || target === name || rank(target) > rank(name))
      .map(target => `${name} (${spec.layer}) → ${target} (${MODULES[target]?.layer ?? 'unknown'})`));
    expect(wrong).toEqual([]);
  });

  it('lists only dependencies the code has, so the documented table stays exact', () => {
    const used = moduleEdges(graph.edges);
    const unused = Object.entries(MODULES).flatMap(([name, spec]) => spec.mayImport
      .filter(target => !used.get(name)?.has(target)).map(target => `${name} → ${target}`));
    expect(unused).toEqual([]);
  });

  it('keeps contracts free of dependencies and the platform on contracts only', () => {
    expect(MODULES.core!.mayImport).toEqual([]);
    expect(MODULES.platform!.mayImport).toEqual(['core']);
  });
});

describe('architecture: the import graph', () => {
  it('sees static, type-only, re-exported and dynamic imports', () => {
    const specifiers = graph.edges.filter(edge => edge.file === 'index.ts').map(edge => edge.specifier);
    expect(specifiers).toEqual(expect.arrayContaining(['./core/contracts.js', './cli/program.js', './cli/context.js']));
    expect(graph.edges.some(edge => edge.file.startsWith('cli/') && edge.to === 'bench')).toBe(true); // lazy `await import()`
  });

  it('has no import the layer table forbids', () => {
    expect(violations(graph.edges)).toEqual([]);
  });

  it('has no cycle between modules', () => {
    expect(cycles(moduleEdges(graph.edges))).toEqual([]);
  });

  it('lets only the CLI (and the package entry) import src/cli', () => {
    const outside = graph.edges.filter(edge => edge.to === 'cli' && !CLI_IMPORTERS.includes(edge.from));
    expect(outside.map(edge => `${edge.file} imports ${edge.specifier}`)).toEqual([]);
  });

  it('never imports test helpers from production code', () => {
    expect(graph.testSupportImports.map(edge => `${edge.file} imports ${edge.specifier}`)).toEqual([]);
  });

  it('keeps src files that scripts load through type stripping free of runtime src imports', () => {
    const files = strippedSourceFiles();
    expect(files.map(file => relative(SRC, file).split(sep).join('/'))).toEqual(expect.arrayContaining(['skills/bundle.ts', 'platform/child-env.ts']));
    expect(files.flatMap(file => runtimeRelativeImports(file).map(spec => `${relative(SRC, file)} imports ${spec}`))).toEqual([]);
  });
});

describe('architecture: the checks themselves', () => {
  it('finds a cycle and reports a forbidden edge', () => {
    expect(cycles(new Map([['a', new Set(['b'])], ['b', new Set(['c'])], ['c', new Set(['a'])], ['d', new Set(['a'])]]))).toEqual([['a', 'b', 'c']]);
    const edge = { from: 'brain', to: 'cli', file: 'brain/x.ts', specifier: '../cli/x.js' };
    expect(violations([edge])).toEqual(['brain → cli: brain/x.ts imports ../cli/x.js']);
  });

  it('tells type-only imports from runtime ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-arch-'));
    try {
      const file = join(dir, 'x.ts');
      await writeFile(file, "import type { A } from './a.js';\nexport type { B } from './b.js';\nimport { c } from './c.js';\nimport { type D } from './d.js';\nexport { e } from './e.js';\nconst f = await import('./f.js');\nimport g from 'yaml';\n");
      expect(runtimeRelativeImports(file)).toEqual(['./c.js', './d.js', './e.js', './f.js']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
