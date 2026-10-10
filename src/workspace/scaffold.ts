/**
 * The files of a new workspace besides the brain: numbered folders, the 00 README (Home), a minimal
 * Obsidian config that hides `.edu` and opens the README, and root AGENTS.md / CLAUDE.md so any CLI
 * opened there meets the agent by name.
 */
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { upsertManagedBlock } from '../adapters/blocks.js';
import type { Lang } from '../cli/i18n.js';
import { layoutFolders, type WorkspaceLayout } from './layout.js';

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function writeIfMissing(path: string, content: string): Promise<boolean> {
  if (await exists(path)) return false;
  await writeFile(path, content);
  return true;
}

export async function createFolders(root: string, layout: WorkspaceLayout): Promise<void> {
  for (const folder of layoutFolders(layout)) await mkdir(join(root, folder), { recursive: true });
  await mkdir(join(root, layout.knowledge, layout.sources), { recursive: true });
}

/** Copies originals into the sources folder (read-only use of the source; never overwrites). */
export async function copySources(paths: string[], target: string): Promise<string[]> {
  await mkdir(target, { recursive: true });
  const copied: string[] = [];
  for (const path of paths) {
    const ext = extname(path);
    const stem = basename(path, ext);
    let name = basename(path);
    for (let n = 2; await exists(join(target, name)); n++) name = `${stem}-${n}${ext}`;
    await copyFile(path, join(target, name));
    copied.push(name);
  }
  return copied;
}

export async function writeObsidianConfig(root: string, layout: WorkspaceLayout): Promise<void> {
  const dir = join(root, '.obsidian');
  await mkdir(dir, { recursive: true });
  const home = `${layout.start}/README.md`;
  await writeIfMissing(join(dir, 'app.json'), `${JSON.stringify({ userIgnoreFilters: ['.edu/'], alwaysUpdateLinks: true, showUnsupportedFiles: true }, null, 2)}\n`);
  await writeIfMissing(join(dir, 'appearance.json'), `${JSON.stringify({ baseFontSize: 16 }, null, 2)}\n`);
  await writeIfMissing(join(dir, 'workspace.json'), `${JSON.stringify({
    main: { id: 'edu-main', type: 'split', direction: 'vertical', children: [{ id: 'edu-tabs', type: 'tabs', children: [{ id: 'edu-home', type: 'leaf', state: { type: 'markdown', state: { file: home, mode: 'preview' } } }] }] },
    active: 'edu-home', lastOpenFiles: [home],
  }, null, 2)}\n`);
}

export interface ReadmeInput { name: string; lang: Lang; layout: WorkspaceLayout; root: string; summary?: string; sources: string[] }

export function readmeText(input: ReadmeInput): string {
  const { name, layout } = input;
  const k = layout.knowledge;
  if (input.lang === 'es') {
    return `# ${name}

Este es el espacio de trabajo de **${name}**, tu agente con Edu. ${input.summary ? `\n\n> ${input.summary}\n` : ''}
${name} ya leyó tus documentos y los convirtió en conocimiento ordenado. Todo vive en esta carpeta: ábrela con tu CLI y ${name} conoce tu operación.

## Qué hay aquí

| Carpeta | Para qué |
|---|---|
| \`${layout.start}/\` | Esta guía. |
| \`${k}/\` | El conocimiento (cerebro) de ${name}: \`1-canonical\` (lo establecido), \`2-episodic\` (lo que pasó), \`3-transitive\` (decisiones, compromisos, lecciones), \`0-index\` (índice) y \`${layout.sources}/\` (copias de tus documentos originales). |
| \`${layout.deliverables}/\` | Entregables terminados. |
| \`${layout.lab}/\` | Pruebas y borradores. |
| \`${layout.projects}/\` | Proyectos en curso. |
| \`${layout.archive}/\` | Lo que ya no está activo. |
| \`.edu/\` | Configuración interna de Edu (oculta). |

## Abrirlo en Obsidian

Obsidian → *Open folder as vault* → elige esta carpeta. Se abre en esta página. El índice está en \`${k}/0-index/INDEX.md\`.

## Hablar con ${name}

\`\`\`sh
cd "${input.root}"
claude      # o: codex · pi · opencode
\`\`\`

Primeras preguntas:

- "¿Quién eres y qué sabes de mi operación?"
- "Resume los clientes y los indicadores clave."
- "¿Qué notas quedaron propuestas y necesitan mi aprobación?"
- "¿Qué procesos conoces y cuáles son sus pasos?"

## Agregar más documentos

\`\`\`sh
cd "${input.root}"
edu create --add otro-documento.docx notas.md
\`\`\`

Acepta .md, .txt, .docx y .pdf. Los originales nunca se modifican; se copia una versión en \`${k}/${layout.sources}/\`.
Lo que el documento dice explícitamente queda **aceptado**; lo interpretado queda **propuesto** hasta que lo apruebes:

\`\`\`sh
edu brain proposals                # qué espera tu aprobación, de dónde viene y por qué
edu brain approve <id>             # o: --all · rechazar: --reject <id>
\`\`\`
${input.sources.length ? `\nFuentes iniciales: ${input.sources.map(s => `\`${s}\``).join(', ')}.\n` : ''}`;
  }
  return `# ${name}

This is the workspace of **${name}**, your agent powered by Edu. ${input.summary ? `\n\n> ${input.summary}\n` : ''}
${name} has read your documents and turned them into organized knowledge. Everything lives in this folder: open it with your CLI and ${name} knows your operation.

## What is here

| Folder | Purpose |
|---|---|
| \`${layout.start}/\` | This guide. |
| \`${k}/\` | ${name}'s knowledge (brain): \`1-canonical\` (established truth), \`2-episodic\` (what happened), \`3-transitive\` (decisions, commitments, lessons), \`0-index\` (index) and \`${layout.sources}/\` (copies of your original documents). |
| \`${layout.deliverables}/\` | Finished deliverables. |
| \`${layout.lab}/\` | Experiments and drafts. |
| \`${layout.projects}/\` | Ongoing projects. |
| \`${layout.archive}/\` | No longer active. |
| \`.edu/\` | Edu's internal configuration (hidden). |

## Open it in Obsidian

Obsidian → *Open folder as vault* → pick this folder. It opens on this page. The index is \`${k}/0-index/INDEX.md\`.

## Talk to ${name}

\`\`\`sh
cd "${input.root}"
claude      # or: codex · pi · opencode
\`\`\`

First questions:

- "Who are you and what do you know about my operation?"
- "Summarize the clients and the key metrics."
- "Which notes are proposed and need my approval?"
- "Which processes do you know, and what are their steps?"

## Add more documents

\`\`\`sh
cd "${input.root}"
edu create --add another-document.docx notes.md
\`\`\`

Accepts .md, .txt, .docx and .pdf. Originals are never modified; a copy goes to \`${k}/${layout.sources}/\`.
What a document states explicitly is **accepted**; interpretations stay **proposed** until you approve them:

\`\`\`sh
edu brain proposals                # what waits for your approval, where it came from and why
edu brain approve <id>             # or: --all · reject: --reject <id>
\`\`\`
${input.sources.length ? `\nInitial sources: ${input.sources.map(s => `\`${s}\``).join(', ')}.\n` : ''}`;
}

/** Root instructions every CLI reads (Claude: CLAUDE.md; Codex, Pi, OpenCode: AGENTS.md), as an Edu managed block. */
export function agentInstructions(name: string, lang: Lang, layout: WorkspaceLayout): string {
  return lang === 'es'
    ? `@.edu/EDU.md
Eres **${name}**, el agente de este espacio de trabajo, con Edu. Preséntate como ${name}.
Tu conocimiento está en \`${layout.knowledge}/\` (canonical · episodic · transitive) y en las herramientas MCP de Edu:
empieza con \`edu_brief\`, busca con \`edu_recall\` y \`edu_read\`, registra decisiones y lecciones con \`edu_remember\`.
Entregables en \`${layout.deliverables}/\`, pruebas en \`${layout.lab}/\`, proyectos en \`${layout.projects}/\`. No modifiques \`${layout.knowledge}/${layout.sources}/\`.`
    : `@.edu/EDU.md
You are **${name}**, this workspace's agent, powered by Edu. Introduce yourself as ${name}.
Your knowledge lives in \`${layout.knowledge}/\` (canonical · episodic · transitive) and behind Edu's MCP tools:
start with \`edu_brief\`, search with \`edu_recall\` and \`edu_read\`, record decisions and lessons with \`edu_remember\`.
Deliverables go to \`${layout.deliverables}/\`, experiments to \`${layout.lab}/\`, projects to \`${layout.projects}/\`. Do not modify \`${layout.knowledge}/${layout.sources}/\`.`;
}

export async function writeAgentInstructions(root: string, body: string): Promise<void> {
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const path = join(root, file);
    const current = await readFile(path, 'utf8').catch(() => '');
    const next = upsertManagedBlock(current, body);
    if (next !== current) await writeFile(path, next);
  }
}

export { writeIfMissing };
