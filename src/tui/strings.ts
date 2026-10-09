/**
 * User-facing TUI strings in English and Spanish. Only labels, placeholders,
 * help and notices are translated: agent output, identifiers, tool names and
 * file paths are shown verbatim.
 */
import type { AgentStatus } from '../core/contracts.js';

export type UiLang = 'en' | 'es';

export interface UiStrings {
  lang: UiLang;
  header: { waiting: string; done: string; failed: string; cancelling: string };
  tree: { title: string; empty: string; active: string; queued: string };
  status: Record<AgentStatus, string>;
  focus: { empty: string; waiting: string; newerBelow: string; following: string; toolRunning: string };
  log: { approvalRequested: string; approvedBy: string; rejectedBy: string; done: string; failed: string };
  approval: { title: string; approve: string; reject: string; details: string; more: string };
  brain: { recalled: string; nothing: string; learned: string; notes: string; ctx: string };
  composer: { idle: string; active: string; hint: string };
  help: { title: string; close: string; keys: Array<[string, string]> };
  palette: { title: string; empty: string; hint: string; describe: Record<string, string> };
  notice: {
    noLead: string;
    unknown: string;
    noApproval: string;
    unavailable: string;
    lang: string;
    brain: string;
    usage: string;
  };
}

const en: UiStrings = {
  lang: 'en',
  header: { waiting: 'waiting for a run', done: 'done', failed: 'failed', cancelling: 'cancelling' },
  tree: { title: 'AGENTS', empty: 'no agents yet', active: 'active', queued: 'queued' },
  status: {
    queued: 'queued',
    running: 'running',
    'awaiting-approval': 'awaiting approval',
    done: 'done',
    failed: 'failed',
    cancelled: 'cancelled',
  },
  focus: {
    empty: 'select an agent to follow its work',
    waiting: 'waiting for output',
    newerBelow: '{n} newer lines below · end follows',
    following: 'following',
    toolRunning: 'running',
  },
  log: { approvalRequested: 'approval requested', approvedBy: 'approved by', rejectedBy: 'rejected by', done: 'done', failed: 'failed' },
  approval: { title: 'APPROVAL', approve: 'approve', reject: 'reject', details: 'details', more: 'more' },
  brain: { recalled: 'recalled', nothing: 'nothing learned yet', learned: 'learned', notes: 'notes', ctx: 'ctx {pct} of {budget}' },
  composer: {
    idle: 'message the lead · tab · / commands · ? help',
    active: 'type what you want Edu to do, then press enter',
    hint: 'enter send · alt+enter newline · / commands · esc clear',
  },
  help: {
    title: 'KEYS',
    close: 'any key closes this help',
    keys: [
      ['↑ ↓', 'select agent (scroll in the focus pane)'],
      ['pgup pgdn', 'scroll the focus pane by a page'],
      ['home end', 'focus pane: oldest line · follow newest output'],
      ['tab', 'cycle panes: agents → focus → composer'],
      ['y n', 'approve or reject the pending request'],
      ['d', 'show or hide approval details'],
      ['enter', 'send the composer message to the lead'],
      ['alt+enter', 'new line in the composer'],
      ['← → home end', 'move the cursor in the composer'],
      ['/', 'open the command palette'],
      ['esc', 'clear the composer, or leave it when empty'],
      ['?', 'toggle this help'],
      ['q', 'quit the view (the run keeps going)'],
      ['ctrl+c', 'cancel the run; quits when idle'],
    ],
  },
  palette: {
    title: 'COMMANDS',
    empty: 'no matching command',
    hint: '↑ ↓ choose · enter run · tab complete · esc close',
    describe: {
      help: 'show the keyboard help',
      agents: 'jump to the agent list',
      approve: 'approve the pending request',
      reject: 'reject the pending request',
      cancel: 'cancel the current run',
      brain: 'show brain stats',
      recall: 'search the brain',
      lang: 'switch the interface language',
      quit: 'quit the view',
      dispatch: 'start a crew job on another CLI',
      status: 'list crew jobs',
    },
  },
  notice: {
    noLead: 'this view has no lead to message; use / for commands',
    unknown: 'unknown command: {name}',
    noApproval: 'nothing is waiting for approval',
    unavailable: '{name} is not available in this view',
    lang: 'language: English',
    brain: 'brain this run: recalled {recalled} · learned {learned}',
    usage: 'usage: {usage}',
  },
};

const es: UiStrings = {
  lang: 'es',
  header: { waiting: 'esperando una ejecución', done: 'listo', failed: 'falló', cancelling: 'cancelando' },
  tree: { title: 'AGENTES', empty: 'aún no hay agentes', active: 'activos', queued: 'en cola' },
  status: {
    queued: 'en cola',
    running: 'trabajando',
    'awaiting-approval': 'esperando aprobación',
    done: 'listo',
    failed: 'falló',
    cancelled: 'cancelado',
  },
  focus: {
    empty: 'elige un agente para seguir su trabajo',
    waiting: 'esperando salida',
    newerBelow: '{n} líneas nuevas abajo · fin para seguir',
    following: 'siguiendo',
    toolRunning: 'en curso',
  },
  log: { approvalRequested: 'aprobación solicitada', approvedBy: 'aprobado por', rejectedBy: 'rechazado por', done: 'listo', failed: 'falló' },
  approval: { title: 'APROBACIÓN', approve: 'aprobar', reject: 'rechazar', details: 'detalles', more: 'más' },
  brain: { recalled: 'recordó', nothing: 'aún sin aprendizajes', learned: 'aprendió', notes: 'notas', ctx: 'ctx {pct} de {budget}' },
  composer: {
    idle: 'escribe al líder · tab · / comandos · ? ayuda',
    active: 'escribe lo que quieres que Edu haga y presiona enter',
    hint: 'enter envía · alt+enter nueva línea · / comandos · esc borra',
  },
  help: {
    title: 'TECLAS',
    close: 'cualquier tecla cierra esta ayuda',
    keys: [
      ['↑ ↓', 'elegir agente (desplaza en el panel de foco)'],
      ['pgup pgdn', 'desplazar el panel de foco una página'],
      ['home end', 'panel de foco: línea más antigua · seguir lo nuevo'],
      ['tab', 'cambiar de panel: agentes → foco → mensaje'],
      ['y n', 'aprobar o rechazar la solicitud pendiente'],
      ['d', 'mostrar u ocultar los detalles de la aprobación'],
      ['enter', 'enviar el mensaje al líder'],
      ['alt+enter', 'nueva línea en el mensaje'],
      ['← → home end', 'mover el cursor en el mensaje'],
      ['/', 'abrir la paleta de comandos'],
      ['esc', 'borrar el mensaje, o salir si está vacío'],
      ['?', 'mostrar u ocultar esta ayuda'],
      ['q', 'salir de la vista (la ejecución sigue)'],
      ['ctrl+c', 'cancelar la ejecución; sale si no hay nada en curso'],
    ],
  },
  palette: {
    title: 'COMANDOS',
    empty: 'ningún comando coincide',
    hint: '↑ ↓ elegir · enter ejecutar · tab completar · esc cerrar',
    describe: {
      help: 'mostrar la ayuda de teclado',
      agents: 'ir a la lista de agentes',
      approve: 'aprobar la solicitud pendiente',
      reject: 'rechazar la solicitud pendiente',
      cancel: 'cancelar la ejecución actual',
      brain: 'ver estadísticas del cerebro',
      recall: 'buscar en el cerebro',
      lang: 'cambiar el idioma de la interfaz',
      quit: 'salir de la vista',
      dispatch: 'lanzar un trabajo del equipo en otro CLI',
      status: 'listar los trabajos del equipo',
    },
  },
  notice: {
    noLead: 'esta vista no tiene líder al que escribir; usa / para comandos',
    unknown: 'comando desconocido: {name}',
    noApproval: 'no hay nada esperando aprobación',
    unavailable: '{name} no está disponible en esta vista',
    lang: 'idioma: español',
    brain: 'cerebro en esta ejecución: recordó {recalled} · aprendió {learned}',
    usage: 'uso: {usage}',
  },
};

const STRINGS: Record<UiLang, UiStrings> = { en, es };

export function uiStrings(lang: UiLang = 'en'): UiStrings {
  return STRINGS[lang] ?? en;
}

/** Fills `{name}` placeholders. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/**
 * UI language from the environment: `EDU_LANG`, then the POSIX locale chain
 * (`LC_ALL` > `LC_MESSAGES` > `LANG`). Any value starting with `es` selects
 * Spanish (`es`, `es_CL.UTF-8`, `es-AR`); everything else is English.
 */
export function langFromEnv(env: Readonly<Record<string, string | undefined>>): UiLang {
  const raw = env.EDU_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  return /^es(?:[_.\-@]|$)/i.test(raw.trim()) ? 'es' : 'en';
}

/** Swaps Unicode punctuation used in strings for ASCII when the terminal lacks Unicode. */
export function glyphSafe(text: string, unicode: boolean): string {
  if (unicode) return text;
  return text
    .replaceAll('↑ ↓', 'up/dn')
    .replaceAll('← →', 'left/right')
    .replaceAll('·', '-')
    .replaceAll('→', '>')
    .replaceAll('↑', '^')
    .replaceAll('↓', 'v');
}
