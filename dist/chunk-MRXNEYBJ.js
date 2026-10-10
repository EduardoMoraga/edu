// src/workspace/layout.ts
var LAYOUTS = {
  es: { start: "00-INICIO", knowledge: "01-CONOCIMIENTO", deliverables: "02-ENTREGABLES", lab: "03-LAB", projects: "04-PROYECTOS", archive: "05-ARCHIVO", sources: "fuentes" },
  en: { start: "00-START", knowledge: "01-KNOWLEDGE", deliverables: "02-DELIVERABLES", lab: "03-LAB", projects: "04-PROJECTS", archive: "05-ARCHIVE", sources: "sources" }
};
function workspaceLayout(lang) {
  return LAYOUTS[lang];
}
function layoutFolders(layout) {
  return [layout.start, layout.knowledge, layout.deliverables, layout.lab, layout.projects, layout.archive];
}
function workspaceLang(flag, env) {
  const pick = (value) => {
    const v = value?.trim().toLowerCase();
    if (!v) return void 0;
    if (v.startsWith("es")) return "es";
    if (v.startsWith("en")) return "en";
    return void 0;
  };
  if (flag !== void 0) {
    const lang = pick(flag);
    if (!lang) throw new Error(`--lang must be es or en, got "${flag}"`);
    return lang;
  }
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  return pick(env.EDU_LANG) ?? (locale && !/^(C|POSIX)(\.|$)/.test(locale) ? pick(locale) : void 0) ?? "es";
}

export {
  workspaceLayout,
  layoutFolders,
  workspaceLang
};
//# sourceMappingURL=chunk-MRXNEYBJ.js.map