import type { Note } from '../../core/contracts.js';
/**
 * `warnings` lists source files imported with a caveat (e.g. invalid frontmatter kept as raw text);
 * `skipped` lists source files already present in the brain (re-import).
 */
export interface ImportReport { source: 'import:albert' | 'import:moragent'; imported: Note[]; skipped: string[]; errors: string[]; warnings: string[] }
