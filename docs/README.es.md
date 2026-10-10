# Edu

```
███████╗██████╗ ██╗   ██╗
██╔════╝██╔══██╗██║   ██║
█████╗  ██║  ██║██║   ██║
██╔══╝  ██║  ██║██║   ██║
███████╗██████╔╝╚██████╔╝
╚══════╝╚═════╝  ╚═════╝

un segundo cerebro que aprende · un equipo que se ve
```

**Edu vive dentro del agente de programación que ya usa.** Da a Claude Code, Codex, Pi,
OpenCode y Antigravity una identidad, un segundo cerebro que aprende y un equipo: desde
cualquiera de ellos se puede delegar trabajo a los demás y verlo en curso.

[English](../README.md) · [Guías](guides/) · [Arquitectura](ARCHITECTURE.md)

---

## Inicio rápido

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
```

**macOS / Linux**:

```bash
curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
```

El instalador verifica Node.js 22+, instala Edu y ejecuta `edu setup`, que conecta Edu con cada CLI
de programación que encuentre. ¿Prefiere npm directamente?
`npm i -g https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz` y luego `edu setup`
(o `npm i -g github:EduardoMoraga/edu`).

Abra su CLI y pregunte: **"what do you remember?"** (o "¿qué recuerdas?"). Edu responde desde
su cerebro.

`edu setup` instala de forma global con el sistema de plugins propio de cada CLI, crea el
cerebro global (`~/.edu`) y registra cada cambio para que `edu uninstall` pueda revertirlo.
`edu doctor` muestra qué está conectado.

## Edu dentro del agente que ya usa

| CLI | Instalación (o simplemente `edu setup`) | Qué obtiene | Cómo usarlo |
|---|---|---|---|
| **Claude Code** | `/plugin marketplace add EduardoMoraga/edu` y luego `/plugin install edu@edu` | skills, comandos, roles, MCP, hook de identidad, statusline | `/edu:brief`, `/edu:crew …` o en lenguaje natural |
| **Codex** | `codex plugin marketplace add EduardoMoraga/edu` y luego `codex plugin add edu@edu` | skills, MCP, hook de identidad | en lenguaje natural o nombrando la skill: `edu-crew` |
| **Pi** | `pi install git:github.com/EduardoMoraga/edu` | extensión (MCP + identidad), prompts, skills | `/edu-brief`, `/edu-crew …` |
| **OpenCode** | `edu setup` | comandos, agentes, plugin, MCP | `/edu-brief`, `/edu-crew …` |
| **Antigravity** | `agy plugin install "$(npm root -g)/edu-agent/plugins/agy"` | skills, agentes, reglas (identidad), MCP | en lenguaje natural o nombrando la skill: `edu-review` |
| **DeepSeek** | como proveedor de modelos en OpenCode o Pi | todo lo que obtiene la CLI anfitriona | igual que la CLI anfitriona |

La instalación manual del plugin queda incompleta: ejecute `edu setup` después para inicializar
el cerebro global e instalar las instrucciones de identidad de Codex. Los comandos del marketplace
no realizan estos pasos.

Siete flujos, iguales en todas partes: **brief · recall · remember · reflect · crew · review ·
status**. Las skills reconocen frases en español ("ponme al día", "recuerda esto", "pídele a
codex que…"). Detalle por CLI: [Claude Code](guides/claude.md) · [Codex](guides/codex.md) ·
[Pi](guides/pi.md) · [OpenCode](guides/opencode.md) · [Antigravity](guides/antigravity.md).

## El equipo (crew)

Pida a Codex que escriba pruebas desde Claude y observe cómo trabaja:

```
/edu:crew codex: write tests for src/auth
```

Edu despacha el trabajo (`edu_crew_dispatch`), consulta su estado (`edu_crew_status`) y
devuelve un resumen (`edu_crew_result`). Con herdr en ejecución, el trabajo puede abrirse en
un panel visible a su lado; si no, corre en segundo plano.

```
/edu:review main
```

Un revisor de solo lectura de **otro proveedor** revisa su diff (`edu_crew_review`) y
devuelve hallazgos ordenados por severidad. Si no hay otro proveedor instalado, Edu solicita
que seleccione explícitamente un revisor disponible.

**Centro de control.** `edu watch` en una segunda terminal muestra cada trabajo del equipo en
vivo: agentes, estado, tokens y costo.

## El cerebro

Markdown plano con frontmatter YAML y `[[wikilinks]]`: legible por cualquier LLM, navegable
en Obsidian (`edu brain link <vault>`) y versionable con git. Sin base de datos.

| Capa | Qué contiene |
|---|---|
| `canonical` | verdad estable: estándares, preferencias, léxico. Cambia solo cuando usted acepta una propuesta |
| `episodic` | una nota por sesión, inmutable una vez cerrada |
| `transitive` | lo que se arrastra entre sesiones: `D-` decisiones · `H-` hipótesis · `C-` compromisos · `L-` lecciones |

Cada nota tiene una **banda de certeza** —`verified`, `inferred` o `hypothesis`— y Edu nunca
presenta una hipótesis como un hecho. Cada sesión empieza con un brief breve; el resto se
consulta bajo demanda (`edu_recall`, `edu_read`), de modo que el contexto se mantiene ligero.

**Aprende.** Las notas útiles suben y las que confunden decaen (`edu_feedback`).
`edu reflect` propone lecciones y cambios de skills a partir del trabajo reciente; nada se
vuelve verdad hasta que usted ejecuta `edu proposals accept <id>`.

## Evidencia y métricas

Un cambio cuenta cuando está verificado, no cuando parece correcto. Edu registra trazas de
contexto, herramientas, verificación, atribución e intervención por episodio, siguiendo
[AI Harness Engineering](https://arxiv.org/abs/2605.13357).

```bash
edu checks run          # verificaciones deterministas que ejecuta Edu
edu metrics --by cli    # AVSR, tasa de intervención humana, autonomía de verificación
```

## Uso independiente

Edu también funciona por sí solo: `edu run "<objetivo>" [--solo|--crew]` orquesta los roles
lead, explorer, builder y reviewer; `edu demo` muestra la vista en vivo sin ningún LLM.

## Desinstalar

```bash
edu uninstall --scope global   # revierte todo lo que registró edu setup
npm rm -g edu-agent
```

Alternativas nativas: `claude plugin uninstall edu@edu` · `codex plugin remove edu@edu` ·
`pi remove git:github.com/EduardoMoraga/edu` · `agy plugin uninstall edu`. Edu no sobrescribe
archivos que usted editó después de instalar (`--force` para forzarlo). Su cerebro (`~/.edu`,
`.edu/`) nunca se borra: son sus datos.

## Windows

- Funciona en PowerShell, cmd y Git Bash con Node ≥ 22; la CI corre en Windows, macOS y Linux.
- En PowerShell la ruta de Antigravity es `"$(npm root -g)\edu-agent\plugins\agy"`.
- `edu brain link` crea una junction en lugar de un symlink; no requiere permisos de administrador.
- El modo panel del equipo requiere herdr; sin él, los trabajos corren en segundo plano y
  `edu watch` los muestra.

## Preguntas frecuentes

**¿Necesito varias suscripciones de LLM?** No. Todo funciona con una sola CLI; el equipo es un
extra.

**¿Edu envía mi código a algún lugar?** Edu no hace llamadas de red. Ejecuta las CLIs que usted
ya usa, con su propia configuración.

**¿Puedo editar el cerebro a mano?** Sí, es Markdown. Las notas canónicas aceptadas están
protegidas contra ediciones automáticas.

## Licencia

MIT © Eduardo Moraga
