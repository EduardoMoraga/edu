# Edu

```
███████╗██████╗ ██╗   ██╗
██╔════╝██╔══██╗██║   ██║
█████╗  ██║  ██║██║   ██║
██╔══╝  ██║  ██║██║   ██║
███████╗██████╔╝╚██████╔╝
╚══════╝╚═════╝  ╚═════╝

a second brain that learns · a crew you can see
```

**Edu le da a cualquier CLI de código una identidad, un segundo cerebro que aprende, un presupuesto de contexto, un orquestador y una vista en vivo de lo que hacen tus agentes.**

Funciona con Claude Code, Codex, Pi, OpenCode y Antigravity. Un solo CLI es suficiente; tener más es un complemento.

[English](../README.md) · [Arquitectura](ARCHITECTURE.md)

---

## Por qué Edu

Los agentes de código olvidan todo entre sesiones, saturan su propio contexto y trabajan como una caja negra.

- **Memoria que sobrevive a la sesión**: decisiones, lecciones y compromisos en Markdown plano que te pertenece.
- **Memoria que aprende**: lo que ayuda sube, lo que confunde decae; nada se vuelve "verdad" sin tu confirmación.
- **Contexto con presupuesto**: un resumen breve al inicio y el resto bajo demanda.
- **Un modelo o un equipo**: el modo solo usa un CLI para todos los roles; el modo crew combina proveedores.
- **Visible**: una vista de terminal con agentes, tokens, costo, aprobaciones y lo que el cerebro recordó.

## Inicio en 60 segundos

```bash
npm i -g github:EduardoMoraga/edu   # Node >= 22
edu init                            # crea ./.edu (cerebro, contrato, configuración, roles, skills)
edu install --cli claude            # conecta Claude Code (muestra el plan y pregunta antes)
edu demo                            # la vista en vivo con un equipo simulado, sin LLM
edu run "agrega un endpoint de health-check"
```

`edu doctor` indica qué está instalado, integrado y vinculado.

## El cerebro

Markdown plano con frontmatter YAML y `[[wikilinks]]`. Cualquier LLM puede leerlo, Obsidian puede graficarlo y git puede versionarlo. Sin base de datos.

```
.edu/
├── EDU.md              el contrato: identidad, bandas de afirmación, protocolo de sesión
├── config.json         modo, CLI por defecto, roles, aprobaciones, presupuesto de contexto
├── brain/
│   ├── 0-index/        índice generado + paneles de Obsidian
│   ├── 1-canonical/    verdad estable — propuesta → aceptada solo por ti
│   ├── 2-episodic/     una nota por sesión, inmutable al cerrarse
│   └── 3-transitive/   D- decisiones · H- hipótesis · C- compromisos · L- lecciones
├── skills/  agents/  proposals/  runs/
```

**Tres capas.** *Canónica* es lo que es cierto aquí (estándares, preferencias, léxico). *Episódica* es lo que ocurrió. *Transitiva* es lo que se arrastra hacia adelante:

| Prefijo | Tipo | Ciclo de vida |
|---|---|---|
| `D-` | decisión | active → reverted (mediante una nueva `D-` que la reemplaza) |
| `H-` | hipótesis | open → confirmed / refuted / no-evidence |
| `C-` | compromiso | pending → delivered / overdue |
| `L-` | lección | candidate → proven / retired |

**Bandas de afirmación.** Cada nota es `verified`, `inferred` o `hypothesis`. La búsqueda muestra la banda; Edu nunca presenta una hipótesis como un hecho.

Un cerebro global (`~/.edu`, o `EDU_HOME`) guarda preferencias personales; el cerebro del proyecto se superpone a él.

## Cómo aprende

```
recall → feedback → maintain → reflect → proposals
```

1. **Recall** ordena las notas por relevancia × peso aprendido y registra su uso.
2. **Feedback** marca una nota como útil o engañosa (aciertos / fallos).
3. **Maintain** (`edu brain maintain`) hace decaer notas sin uso, promueve lecciones con ≥ 3 aciertos y peso aprendido ≥ 0,7, retira las engañosas y marca compromisos vencidos.
4. **Reflect** (`edu reflect --since 7d`) lee episodios y ejecuciones recientes y propone lecciones, hipótesis y cambios de skills, validados contra un esquema, nunca adivinados.
5. **Proposals** esperan tu decisión: `edu proposals list | accept <id> | reject <id>`. Las lecciones probadas se convierten en *propuestas* canónicas; solo tú las aceptas.

## Presupuesto de contexto

Cada sesión comienza con un resumen breve (identidad, compromisos e hipótesis abiertos, lecciones probadas, últimos episodios y un puntero al índice). El resto se obtiene bajo demanda vía MCP (`edu_recall`, `edu_read`). Para ver exactamente qué se inyectaría:

```bash
edu context --query "auth" --budget 4000
```

Muestra el paquete y una tabla de tokens por sección; lo que no cupo aparece como diferido.

## Solo o crew

| | Solo (por defecto) | Crew |
|---|---|---|
| Motores | un CLI cumple todos los roles | cada rol asignado a un CLI distinto |
| Sesiones | cada rol es su propia sesión | igual |
| Revisión | el revisor es una sesión nueva | el revisor prefiere un proveedor distinto al del constructor |

```bash
edu run "migra el cargador de configuración" --solo --cli codex
edu run "migra el cargador de configuración" --crew
```

Roles: lead (planifica), explorer (lee), builder (escribe), reviewer (veredicto pass/fix, una ronda de corrección). Los pasos que pueden escribir piden aprobación (`ask-on-write`); `--yes` aprueba automáticamente. En una terminal obtienes la vista en vivo; en pipes y CI, líneas de log simples. `Ctrl+C` cancela de forma limpia.

## CLIs compatibles

`edu install [--cli claude,codex,pi,opencode,agy | all] [--scope project|global] [--dry-run] [--yes]`

| CLI | Instrucciones | Skills | Agentes | MCP | Extras |
|---|---|---|---|---|---|
| Claude Code | bloque gestionado en `CLAUDE.md` | `.claude/skills/` | `.claude/agents/` | `.mcp.json` / `~/.claude.json` | estilo de salida, `edu statusline`, hooks SessionStart/SessionEnd |
| Codex | bloque gestionado en `AGENTS.md` | `.agents/skills/` | — | `~/.codex/config.toml` | — |
| Pi | bloque gestionado en `AGENTS.md` | `.agents/skills/` | — | `~/.pi/agent/mcp.json` | — |
| OpenCode | bloque gestionado en `AGENTS.md` | `.agents/skills/` | `opencode.json` | `opencode.json` | — |
| Antigravity | bloque gestionado en `GEMINI.md` + `AGENTS.md` | `.agents/skills/` | — | paso manual | — |

Los bloques gestionados solo modifican el texto entre `<!-- edu:core:start -->` y `<!-- edu:core:end -->`; las fusiones JSON/TOML solo tocan claves de Edu. Cada escritura queda registrada en `.edu/manifest.json`.

## Obsidian

```bash
edu brain link ~/Obsidian/MiVault
```

Crea `<vault>/Edu/<proyecto>` apuntando a la carpeta del cerebro (enlace simbólico; junction en Windows). Nunca reemplaza algo que ya exista. La vista de grafo, los backlinks y los paneles `.base` generados funcionan de inmediato.

## Comandos

| Comando | Qué hace |
|---|---|
| `edu` | inicio de la vista en vivo (en una terminal); escribe un objetivo para iniciar una ejecución solo |
| `edu init [--global] [--name Edu] [--cli X]` | crea un cerebro |
| `edu install` / `edu uninstall [--force]` | conecta / desconecta CLIs de código |
| `edu doctor [--json]` | Node, CLIs, integraciones, cerebros, vínculo con Obsidian |
| `edu run "<objetivo>" [--solo\|--crew] [--cli X] [--yes]` | orquesta un objetivo |
| `edu ui [--replay runs/<id>.jsonl] [--speed n]` / `edu demo` | vista en vivo, repeticiones, demo |
| `edu brain status \| recall <q> \| remember <título> \| maintain \| import albert\|moragent <ruta> \| link <vault>` | trabajar con el cerebro |
| `edu context [--query q] [--budget n]` | muestra el paquete de contexto |
| `edu reflect [--since 7d]` · `edu proposals list\|accept\|reject` | ciclo de automejora |
| `edu mcp` · `edu statusline` · `edu hook …` | integraciones usadas por tus CLIs |

Opciones globales: `--cwd <dir>`, `--lang en|es` y `--json` donde corresponde. Usa `--lang es` (o `EDU_LANG=es`) para ver los mensajes en español.

## Desinstalar

```bash
edu uninstall                 # alcance de proyecto; --scope global para instalaciones globales
npm rm -g edu-agent
```

La desinstalación restaura cada archivo desde el manifiesto y se niega a sobrescribir archivos que editaste después de instalar (`--force` para forzarlo). Tu cerebro `.edu/` nunca se elimina: son tus datos.

## Preguntas frecuentes

**¿Necesito varias suscripciones de LLM?** No. Todo funciona con un solo CLI.

**¿Edu envía mi código a algún lugar?** Edu no hace llamadas de red por sí mismo. Ejecuta los CLIs que ya usas, con su propia configuración.

**¿Puedo editar el cerebro a mano?** Sí, es Markdown. Las notas canónicas que aceptaste están protegidas de ediciones automáticas.

**¿Qué necesita `edu demo`?** Solo Node. Reproduce un equipo simulado.

**¿Dónde se guardan las ejecuciones?** En `.edu/runs/<runId>.jsonl`; puedes repetir cualquiera con `edu ui --replay`.

## Licencia

MIT © Eduardo Moraga
