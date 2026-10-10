/**
 * The self-contained workspace layout `edu create` builds. Folder names follow the language; the
 * brain is the visible `01-…` folder (`brainDir` in `.edu/config.json`), and the workspace folder
 * itself is the Obsidian vault.
 */
import type { Lang } from '../cli/i18n.js';

export interface WorkspaceLayout {
  start: string;
  knowledge: string;
  deliverables: string;
  lab: string;
  projects: string;
  archive: string;
  /** Inside `knowledge`: untouched copies of the original documents. */
  sources: string;
}

const LAYOUTS: Record<Lang, WorkspaceLayout> = {
  es: { start: '00-INICIO', knowledge: '01-CONOCIMIENTO', deliverables: '02-ENTREGABLES', lab: '03-LAB', projects: '04-PROYECTOS', archive: '05-ARCHIVO', sources: 'fuentes' },
  en: { start: '00-START', knowledge: '01-KNOWLEDGE', deliverables: '02-DELIVERABLES', lab: '03-LAB', projects: '04-PROJECTS', archive: '05-ARCHIVE', sources: 'sources' },
};

export function workspaceLayout(lang: Lang): WorkspaceLayout {
  return LAYOUTS[lang];
}

/** The numbered top-level folders, in order. */
export function layoutFolders(layout: WorkspaceLayout): string[] {
  return [layout.start, layout.knowledge, layout.deliverables, layout.lab, layout.projects, layout.archive];
}

/** `--lang`, then EDU_LANG, then the system locale, then Spanish. */
export function workspaceLang(flag: string | undefined, env: NodeJS.ProcessEnv): Lang {
  const pick = (value: string | undefined): Lang | undefined => {
    const v = value?.trim().toLowerCase();
    if (!v) return undefined;
    if (v.startsWith('es')) return 'es';
    if (v.startsWith('en')) return 'en';
    return undefined;
  };
  if (flag !== undefined) {
    const lang = pick(flag);
    if (!lang) throw new Error(`--lang must be es or en, got "${flag}"`);
    return lang;
  }
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  return pick(env.EDU_LANG) ?? (locale && !/^(C|POSIX)(\.|$)/.test(locale) ? pick(locale) : undefined) ?? 'es';
}
