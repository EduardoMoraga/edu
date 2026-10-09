/**
 * Tiny dictionary for user-facing CLI messages. English is the default;
 * Spanish is selected with `--lang es` or EDU_LANG=es. Machine output
 * (`--json`), identifiers and file content are never translated. The live
 * view (TUI) additionally follows the POSIX locale (`LC_ALL`/`LANG` = es*).
 */
import { langFromEnv } from '../tui/strings.js';

export type Lang = 'en' | 'es';

/**
 * Language for the live view: an explicit Spanish choice wins, otherwise the
 * environment (`EDU_LANG`, then `LC_ALL` > `LC_MESSAGES` > `LANG`). Callers
 * that know `--lang en` was passed explicitly should pass `explicit = true`.
 */
export function uiLang(lang: Lang, env: Readonly<Record<string, string | undefined>>, explicit = false): Lang {
  if (lang === 'es' || explicit) return lang;
  return langFromEnv(env);
}

const en = {
  'init.done': 'Edu brain ready at {root}',
  'init.config.created': 'config.json written (default CLI: {cli})',
  'init.config.kept': 'config.json kept (already present)',
  'init.copied': 'Copied {agents} agent(s) and {skills} skill(s)',
  'init.next': 'Next steps:',
  'init.next.install': 'edu install --cli {cli}    connect your coding CLI',
  'init.next.demo': 'edu demo                 see the live view without any LLM',
  'init.next.run': 'edu run "<goal>"         run a goal in solo mode',
  'install.noCli': 'No supported CLI detected. Pass --cli claude,codex,pi,opencode,agy or --cli all.',
  'install.dryRun': 'Dry run: nothing was written.',
  'install.confirm': 'Apply these changes?',
  'install.needYes': 'Not a terminal: re-run with --yes to apply.',
  'install.aborted': 'Aborted. Nothing was written.',
  'install.done': 'Installed {count} action(s). Manifest: {manifest}',
  'uninstall.done': 'Edu integration removed ({scope}).',
  'doctor.title': 'Edu doctor',
  'doctor.node': 'Node {version}',
  'doctor.nodeOld': 'Node {version} — Edu needs Node >= 22',
  'doctor.cliMissing': '{cli}: not installed',
  'doctor.cliReady': '{cli}: installed · integrated ({scopes})',
  'doctor.cliNotIntegrated': '{cli}: installed · not integrated — run: edu install --cli {cli}',
  'doctor.cliDrift': '{cli}: integration drift — files changed since install',
  'doctor.auth': '  sign in: {hint}',
  'doctor.brain': '{scope} brain {root}: {total} notes',
  'doctor.brainMissing': '{scope} brain {root}: not initialized — run: edu init{flag}',
  'doctor.vaultNone': 'Obsidian: no vault linked — run: edu brain link <vault>',
  'doctor.vaultOk': 'Obsidian: {link} → brain',
  'doctor.vaultBroken': 'Obsidian: {link} does not point to this brain',
  'run.noCli': 'No supported coding CLI found on PATH. Install one, or try: edu demo',
  'run.done': 'Run {status}: {summary}',
  'run.ok': 'finished',
  'run.failed': 'failed',
  'run.approvalDenied': 'Approval needed for "{title}" — re-run with --yes to approve automatically.',
  'run.cancelling': 'Cancelling…',
  'home.clis': 'CLIs: {clis}',
  'home.noClis': 'CLIs: none detected — edu demo works without one',
  'home.brain': 'Brain: {total} notes · {lessons} lessons',
  'home.hint': 'Just type what you want Edu to do and press enter. ctrl+c quits.',
  'demo.plain': 'Edu demo (non-interactive output). Run in a terminal for the live view.',
  'brain.empty': 'No matching notes.',
  'brain.remembered': 'Remembered {id}',
  'brain.maintained': 'Maintenance: {changed} changed · {promoted} promoted · {retired} retired · {overdue} overdue',
  'brain.imported': 'Imported {imported} note(s) · skipped {skipped} · errors {errors}',
  'brain.linked': 'Linked {link} → {target}',
  'brain.linkExists': 'Already linked: {link}',
  'brain.linkConflict': 'Refusing to replace {link}: it exists and points elsewhere.',
  'context.title': 'Context pack: {tokens} / {budget} tokens',
  'context.deferred': '{count} note(s) deferred (reachable via edu_recall)',
  'reflect.noCli': 'Reflection needs a coding CLI. Install one, then run edu reflect again.',
  'reflect.done': 'Reflected on {episodes} episode(s): {lessons} lesson(s), {hypotheses} hypothesis(es), {skills} skill proposal(s), {canonical} canonical proposal(s).',
  'proposals.empty': 'No proposals waiting.',
  'proposals.accepted': 'Accepted {id} → {path}',
  'proposals.rejected': 'Rejected {id}',
  'error.prefix': 'edu: {message}',
  'tui.brainStats': 'brain: {total} notes · {lessons} lessons',
  'tui.recallNone': 'no notes match "{query}"',
  'tui.recallHits': '{count} note(s): {titles}',
  'tui.crewNone': 'no crew jobs yet — try /dispatch <cli> <task>',
  'tui.crewStatus': '{count} job(s): {summary}',
  'tui.dispatchUsage': 'usage: /dispatch <cli> <task>',
  'tui.dispatched': 'dispatched: {output}',
  'watch.none': 'No crew jobs yet. Dispatch one with: edu crew dispatch <cli> "<task>"',
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  'init.done': 'Cerebro de Edu listo en {root}',
  'init.config.created': 'config.json creado (CLI por defecto: {cli})',
  'init.config.kept': 'config.json conservado (ya existía)',
  'init.copied': 'Copiados {agents} agente(s) y {skills} skill(s)',
  'init.next': 'Siguientes pasos:',
  'init.next.install': 'edu install --cli {cli}    conecta tu CLI de código',
  'init.next.demo': 'edu demo                 mira la vista en vivo sin ningún LLM',
  'init.next.run': 'edu run "<objetivo>"     ejecuta un objetivo en modo solo',
  'install.noCli': 'No se detectó ningún CLI compatible. Usa --cli claude,codex,pi,opencode,agy o --cli all.',
  'install.dryRun': 'Simulación: no se escribió nada.',
  'install.confirm': '¿Aplicar estos cambios?',
  'install.needYes': 'No es una terminal: vuelve a ejecutar con --yes para aplicar.',
  'install.aborted': 'Cancelado. No se escribió nada.',
  'install.done': 'Instaladas {count} acción(es). Manifiesto: {manifest}',
  'uninstall.done': 'Integración de Edu eliminada ({scope}).',
  'doctor.title': 'Diagnóstico de Edu',
  'doctor.node': 'Node {version}',
  'doctor.nodeOld': 'Node {version} — Edu requiere Node >= 22',
  'doctor.cliMissing': '{cli}: no instalado',
  'doctor.cliReady': '{cli}: instalado · integrado ({scopes})',
  'doctor.cliNotIntegrated': '{cli}: instalado · sin integrar — ejecuta: edu install --cli {cli}',
  'doctor.cliDrift': '{cli}: la integración cambió — hay archivos modificados desde la instalación',
  'doctor.auth': '  inicia sesión: {hint}',
  'doctor.brain': 'cerebro {scope} {root}: {total} notas',
  'doctor.brainMissing': 'cerebro {scope} {root}: sin inicializar — ejecuta: edu init{flag}',
  'doctor.vaultNone': 'Obsidian: sin vault vinculado — ejecuta: edu brain link <vault>',
  'doctor.vaultOk': 'Obsidian: {link} → cerebro',
  'doctor.vaultBroken': 'Obsidian: {link} no apunta a este cerebro',
  'run.noCli': 'No hay ningún CLI de código compatible en el PATH. Instala uno o prueba: edu demo',
  'run.done': 'Ejecución {status}: {summary}',
  'run.ok': 'terminada',
  'run.failed': 'fallida',
  'run.approvalDenied': 'Se necesita aprobación para "{title}" — vuelve a ejecutar con --yes para aprobar automáticamente.',
  'run.cancelling': 'Cancelando…',
  'home.clis': 'CLIs: {clis}',
  'home.noClis': 'CLIs: ninguno detectado — edu demo funciona sin ellos',
  'home.brain': 'Cerebro: {total} notas · {lessons} lecciones',
  'home.hint': 'Solo escribe lo que quieres que Edu haga y presiona enter. ctrl+c para salir.',
  'demo.plain': 'Demo de Edu (salida no interactiva). Ejecútalo en una terminal para la vista en vivo.',
  'brain.empty': 'No hay notas que coincidan.',
  'brain.remembered': 'Guardado {id}',
  'brain.maintained': 'Mantenimiento: {changed} cambiadas · {promoted} promovidas · {retired} retiradas · {overdue} vencidas',
  'brain.imported': 'Importadas {imported} nota(s) · omitidas {skipped} · errores {errors}',
  'brain.linked': 'Vinculado {link} → {target}',
  'brain.linkExists': 'Ya estaba vinculado: {link}',
  'brain.linkConflict': 'No se reemplaza {link}: ya existe y apunta a otro lugar.',
  'context.title': 'Paquete de contexto: {tokens} / {budget} tokens',
  'context.deferred': '{count} nota(s) diferida(s) (disponibles con edu_recall)',
  'reflect.noCli': 'La reflexión necesita un CLI de código. Instala uno y vuelve a ejecutar edu reflect.',
  'reflect.done': 'Reflexión sobre {episodes} episodio(s): {lessons} lección(es), {hypotheses} hipótesis, {skills} propuesta(s) de skill, {canonical} propuesta(s) canónica(s).',
  'proposals.empty': 'No hay propuestas pendientes.',
  'proposals.accepted': 'Aceptada {id} → {path}',
  'proposals.rejected': 'Rechazada {id}',
  'error.prefix': 'edu: {message}',
  'tui.brainStats': 'cerebro: {total} notas · {lessons} lecciones',
  'tui.recallNone': 'ninguna nota coincide con "{query}"',
  'tui.recallHits': '{count} nota(s): {titles}',
  'tui.crewNone': 'aún no hay trabajos del equipo — prueba /dispatch <cli> <tarea>',
  'tui.crewStatus': '{count} trabajo(s): {summary}',
  'tui.dispatchUsage': 'uso: /dispatch <cli> <tarea>',
  'tui.dispatched': 'lanzado: {output}',
  'watch.none': 'Aún no hay trabajos del equipo. Lanza uno con: edu crew dispatch <cli> "<tarea>"',
};

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, es };

export function t(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = DICTS[lang][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
