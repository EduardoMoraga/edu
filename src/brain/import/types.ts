import type { Note } from '../../core/contracts.js';
export interface ImportReport { source: 'import:albert' | 'import:moragent'; imported: Note[]; skipped: string[]; errors: string[] }
