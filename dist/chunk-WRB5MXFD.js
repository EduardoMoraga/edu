// src/tui/strings.ts
var en = {
  lang: "en",
  header: { waiting: "waiting for a run", done: "done", failed: "failed", cancelling: "cancelling" },
  tree: { title: "AGENTS", empty: "no agents yet", active: "active", queued: "queued" },
  status: {
    queued: "queued",
    running: "running",
    "awaiting-approval": "awaiting approval",
    done: "done",
    failed: "failed",
    cancelled: "cancelled"
  },
  focus: {
    empty: "select an agent to follow its work",
    waiting: "waiting for output",
    newerBelow: "{n} newer lines below \xB7 end follows",
    following: "following",
    toolRunning: "running"
  },
  log: { approvalRequested: "approval requested", approvedBy: "approved by", rejectedBy: "rejected by", done: "done", failed: "failed" },
  approval: { title: "APPROVAL", approve: "approve", reject: "reject", details: "details", more: "more" },
  brain: { recalled: "recalled", nothing: "nothing learned yet", learned: "learned", notes: "notes", ctx: "ctx {pct} of {budget}" },
  composer: {
    idle: "message the lead \xB7 tab \xB7 / commands \xB7 ? help",
    active: "type what you want Edu to do, then press enter",
    hint: "enter send \xB7 alt+enter newline \xB7 / commands \xB7 esc clear"
  },
  help: {
    title: "KEYS",
    close: "any key closes this help",
    keys: [
      ["\u2191 \u2193", "select agent (scroll in the focus pane)"],
      ["pgup pgdn", "scroll the focus pane by a page"],
      ["home end", "focus pane: oldest line \xB7 follow newest output"],
      ["tab", "cycle panes: agents \u2192 focus \u2192 composer"],
      ["y n", "approve or reject the pending request"],
      ["d", "show or hide approval details"],
      ["enter", "send the composer message to the lead"],
      ["alt+enter", "new line in the composer"],
      ["\u2190 \u2192 home end", "move the cursor in the composer"],
      ["/", "open the command palette"],
      ["esc", "clear the composer, or leave it when empty"],
      ["?", "toggle this help"],
      ["q", "quit the view (the run keeps going)"],
      ["ctrl+c", "cancel the run; quits when idle"]
    ]
  },
  palette: {
    title: "COMMANDS",
    empty: "no matching command",
    hint: "\u2191 \u2193 choose \xB7 enter run \xB7 tab complete \xB7 esc close",
    describe: {
      help: "show the keyboard help",
      agents: "jump to the agent list",
      approve: "approve the pending request",
      reject: "reject the pending request",
      cancel: "cancel the current run",
      brain: "show brain stats",
      recall: "search the brain",
      lang: "switch the interface language",
      quit: "quit the view",
      dispatch: "start a crew job on another CLI",
      status: "list crew jobs"
    }
  },
  notice: {
    noLead: "this view has no lead to message; use / for commands",
    unknown: "unknown command: {name}",
    noApproval: "nothing is waiting for approval",
    unavailable: "{name} is not available in this view",
    lang: "language: English",
    brain: "brain this run: recalled {recalled} \xB7 learned {learned}",
    usage: "usage: {usage}"
  }
};
var es = {
  lang: "es",
  header: { waiting: "esperando una ejecuci\xF3n", done: "listo", failed: "fall\xF3", cancelling: "cancelando" },
  tree: { title: "AGENTES", empty: "a\xFAn no hay agentes", active: "activos", queued: "en cola" },
  status: {
    queued: "en cola",
    running: "trabajando",
    "awaiting-approval": "esperando aprobaci\xF3n",
    done: "listo",
    failed: "fall\xF3",
    cancelled: "cancelado"
  },
  focus: {
    empty: "elige un agente para seguir su trabajo",
    waiting: "esperando salida",
    newerBelow: "{n} l\xEDneas nuevas abajo \xB7 fin para seguir",
    following: "siguiendo",
    toolRunning: "en curso"
  },
  log: { approvalRequested: "aprobaci\xF3n solicitada", approvedBy: "aprobado por", rejectedBy: "rechazado por", done: "listo", failed: "fall\xF3" },
  approval: { title: "APROBACI\xD3N", approve: "aprobar", reject: "rechazar", details: "detalles", more: "m\xE1s" },
  brain: { recalled: "record\xF3", nothing: "a\xFAn sin aprendizajes", learned: "aprendi\xF3", notes: "notas", ctx: "ctx {pct} de {budget}" },
  composer: {
    idle: "escribe al l\xEDder \xB7 tab \xB7 / comandos \xB7 ? ayuda",
    active: "escribe lo que quieres que Edu haga y presiona enter",
    hint: "enter env\xEDa \xB7 alt+enter nueva l\xEDnea \xB7 / comandos \xB7 esc borra"
  },
  help: {
    title: "TECLAS",
    close: "cualquier tecla cierra esta ayuda",
    keys: [
      ["\u2191 \u2193", "elegir agente (desplaza en el panel de foco)"],
      ["pgup pgdn", "desplazar el panel de foco una p\xE1gina"],
      ["home end", "panel de foco: l\xEDnea m\xE1s antigua \xB7 seguir lo nuevo"],
      ["tab", "cambiar de panel: agentes \u2192 foco \u2192 mensaje"],
      ["y n", "aprobar o rechazar la solicitud pendiente"],
      ["d", "mostrar u ocultar los detalles de la aprobaci\xF3n"],
      ["enter", "enviar el mensaje al l\xEDder"],
      ["alt+enter", "nueva l\xEDnea en el mensaje"],
      ["\u2190 \u2192 home end", "mover el cursor en el mensaje"],
      ["/", "abrir la paleta de comandos"],
      ["esc", "borrar el mensaje, o salir si est\xE1 vac\xEDo"],
      ["?", "mostrar u ocultar esta ayuda"],
      ["q", "salir de la vista (la ejecuci\xF3n sigue)"],
      ["ctrl+c", "cancelar la ejecuci\xF3n; sale si no hay nada en curso"]
    ]
  },
  palette: {
    title: "COMANDOS",
    empty: "ning\xFAn comando coincide",
    hint: "\u2191 \u2193 elegir \xB7 enter ejecutar \xB7 tab completar \xB7 esc cerrar",
    describe: {
      help: "mostrar la ayuda de teclado",
      agents: "ir a la lista de agentes",
      approve: "aprobar la solicitud pendiente",
      reject: "rechazar la solicitud pendiente",
      cancel: "cancelar la ejecuci\xF3n actual",
      brain: "ver estad\xEDsticas del cerebro",
      recall: "buscar en el cerebro",
      lang: "cambiar el idioma de la interfaz",
      quit: "salir de la vista",
      dispatch: "lanzar un trabajo del equipo en otro CLI",
      status: "listar los trabajos del equipo"
    }
  },
  notice: {
    noLead: "esta vista no tiene l\xEDder al que escribir; usa / para comandos",
    unknown: "comando desconocido: {name}",
    noApproval: "no hay nada esperando aprobaci\xF3n",
    unavailable: "{name} no est\xE1 disponible en esta vista",
    lang: "idioma: espa\xF1ol",
    brain: "cerebro en esta ejecuci\xF3n: record\xF3 {recalled} \xB7 aprendi\xF3 {learned}",
    usage: "uso: {usage}"
  }
};
var STRINGS = { en, es };
function uiStrings(lang = "en") {
  return STRINGS[lang] ?? en;
}
function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, name) => name in vars ? String(vars[name]) : match);
}
function langFromEnv(env) {
  const raw = env.EDU_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return /^es(?:[_.\-@]|$)/i.test(raw.trim()) ? "es" : "en";
}
function glyphSafe(text, unicode) {
  if (unicode) return text;
  return text.replaceAll("\u2191 \u2193", "up/dn").replaceAll("\u2190 \u2192", "left/right").replaceAll("\xB7", "-").replaceAll("\u2192", ">").replaceAll("\u2191", "^").replaceAll("\u2193", "v");
}

export {
  uiStrings,
  fill,
  langFromEnv,
  glyphSafe
};
//# sourceMappingURL=chunk-WRB5MXFD.js.map