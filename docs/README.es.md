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

El instalador verifica Node.js 22+ (si falta: `brew install node` en macOS con Homebrew,
`winget install OpenJS.NodeJS.LTS` en Windows; si no, ofrece fnm o indica nodejs.org; nunca usa
sudo), instala Edu, ejecuta `edu setup`, que conecta Edu con cada CLI de programación que encuentre,
y muestra los siguientes pasos en su idioma. ¿Prefiere npm directamente?
`npm i -g https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz` y luego `edu setup`
(o `npm i -g github:EduardoMoraga/edu`).

Abra su CLI y pregunte: **"what do you remember?"** (o "¿qué recuerdas?"). Edu responde desde
su cerebro.

`edu setup` instala de forma global con el sistema de plugins propio de cada CLI, crea el
cerebro global (`~/.edu`) y registra cada cambio para que `edu uninstall` pueda revertirlo.
`edu doctor` muestra qué está conectado.

**Manténgase al día:** `edu update` instala la última versión publicada en GitHub con el npm del Node
que ejecuta Edu, corre el nuevo `edu setup --yes`, reindexa y mantiene cada espacio registrado y
muestra las novedades. `edu update --check` solo informa; `edu update v0.8.0` (o `--to v0.8.0`)
elige una versión. Si la instalación falla, la versión actual queda tal como estaba.

## Entréguele su conocimiento a Edu: `edu create`

Pásele a Edu una base de conocimiento (Word, PDF, Markdown o texto) y arma un espacio de trabajo
autocontenido, listo para Obsidian, cuyo agente conoce su operación y responde con el nombre que eligió:

```bash
edu create manual.docx clientes.md --name Albert         # → ~/Edu/albert/
cd ~/Edu/albert && claude                                 # o codex · pi · opencode
```

```
albert/
  00-INICIO/README.md     inicio: qué es, Obsidian, primeras preguntas
  01-CONOCIMIENTO/        el cerebro, visible + fuentes/ (copias de los originales)
  02-ENTREGABLES/ 03-LAB/ 04-PROYECTOS/ 05-ARCHIVO/
  .edu/                   configuración (brainDir, identidad), EDU.md, playbooks
  .obsidian/              la carpeta misma es la bóveda; abre en el README
  AGENTS.md, CLAUDE.md    "Eres Albert, el agente de este espacio de trabajo…"
```

- La extracción corre sin interfaz con el primer CLI instalado (claude, codex, pi, opencode) o
  `--cli`. Lo que el documento afirma queda como notas canónicas **aceptadas** (banda `verified`,
  fuente `archivo#título`); las interpretaciones quedan **propuestas** para que usted las apruebe.
  Los procedimientos se vuelven playbooks y los términos, una nota de glosario. Si la respuesta no
  es válida, Edu reintenta una vez y luego divide por títulos. Revíselas con `edu brain proposals`
  (título, fuente, banda, por qué) y decida con `edu brain approve <id>` / `--all` / `--reject <id>`
  (una propuesta rechazada se borra y queda un registro en la memoria episódica).
- `--no-llm` divide por títulos, sin conexión y determinista. `--lang es|en` nombra las carpetas
  (por defecto `EDU_LANG`, luego el idioma del sistema, luego español). `--dir` fija la carpeta
  padre (por defecto `~/Edu`); un destino no vacío exige `--yes`. Los originales nunca se modifican.
- Agregue más después, desde dentro del espacio: `edu create --add notas.pdf`.
- Los PDF usan `pdftotext` si está instalado; si no, un lector JS incluido. Los PDF escaneados necesitan OCR antes.
- Cualquier cerebro puede vivir en una carpeta visible: `"brainDir": "01-CONOCIMIENTO"` en `.edu/config.json`.

## Edu dentro del agente que ya usa

| CLI | Instalación (o simplemente `edu setup`) | Qué obtiene | Cómo usarlo |
|---|---|---|---|
| **Claude Code** | `/plugin marketplace add EduardoMoraga/edu` y luego `/plugin install edu@edu` | skills, comandos, roles, MCP, hook de identidad, statusline | `/edu:brief`, `/edu:crew …` o en lenguaje natural |
| **Codex** | `codex plugin marketplace add EduardoMoraga/edu` y luego `codex plugin add edu@edu` | skills, MCP, hook de identidad | en lenguaje natural o nombrando la skill: `edu-crew` |
| **Pi** | `pi install git:github.com/EduardoMoraga/edu` | extensión (MCP + identidad + Edu Deck en vivo), tema `edu`, prompts, skills | `/edu-deck`, `/edu-brief`, `/edu-crew …` |
| **OpenCode** | `edu setup` | comandos, agentes, plugin, MCP, Edu Deck en vivo (logo + sidebar), tema `edu` | `/edu-deck`, `/edu-brief`, `/edu-crew …` |
| **Antigravity** | `agy plugin install "$(npm root -g)/edu-agent/plugins/agy"` | skills, agentes, reglas (identidad), MCP | en lenguaje natural o nombrando la skill: `edu-review` |
| **DeepSeek** | como proveedor de modelos en OpenCode o Pi | todo lo que obtiene la CLI anfitriona | igual que la CLI anfitriona |

La instalación manual del plugin queda incompleta: ejecute `edu setup` después para inicializar
el cerebro global e instalar las instrucciones de identidad de Codex. Los comandos del marketplace
no realizan estos pasos.

Ocho flujos, iguales en todas partes: **brief · recall · remember · reflect · crew · run ·
review · status**. Las skills reconocen frases en español ("ponme al día", "recuerda esto",
"pídele a codex que…", "orquesta esto"). Detalle por CLI: [Claude Code](guides/claude.md) · [Codex](guides/codex.md) ·
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

## Edu como su orquestador

Entregue un objetivo a Edu y dirigirá al equipo con **su** método, no con uno genérico.

1. **Playbook.** El lead planifica con `.edu/playbooks/default.md`: especificación primero,
   requisitos observables con verificaciones deterministas, delegación por rol, bandas de
   certeza y aprendizaje al cierre. Edítelo para codificar su forma de trabajar. También se
   incluyen `quick` (tareas pequeñas, sin aprobación) y `research` (solo lectura, sin
   builder); elija uno con `--playbook <nombre>`.
2. **Especificación → aprobación.** Edu escribe `.edu/specs/<fecha>-<slug>.md` con los
   requisitos (`R1`…) y las verificaciones que ejecutará. Nada se construye hasta que usted la
   aprueba.
3. **Resultado verificado.** Los builders trabajan, Edu ejecuta las verificaciones por sí
   mismo y un revisor de otro proveedor revisa el resultado. "Terminado" significa que las
   verificaciones pasaron, no que el modelo lo afirmó.

```bash
edu run "add a --json flag to the status command"   # desde una terminal
```

```
/edu:run add a --json flag to the status command      # Claude Code (Pi/OpenCode: /edu-run)
```

En Codex, pida "run this with edu" o "orquesta esto", o nombre la skill `edu-run`.
`edu watch` muestra en vivo la tarjeta de la especificación, cada agente y cada verificación.

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
En una terminal, `edu brief [objetivo]` imprime el mismo brief y `edu brain read <ref>` una nota.

**Leer una nota.** `edu_read` y `edu brain read` aceptan cómo llama usted a la nota, en este
orden: id exacto → id heredado o alias (`D-010`) → prefijo de id único → nombre de archivo →
título exacto (sin distinguir mayúsculas ni tildes). Si coinciden varias, devuelve las candidatas.

**Importar una bóveda Albert.** `edu brain import albert <ruta>` lee `_ALBERT` sin modificarla.
Los correlativos se conservan (`D-010_x.md` → `D-010-<título>`, con `legacy_id` y `aliases`);
`produjo`, `cerro`, `revierte` y `revertida_por` pasan a `links`, `supersedes` y `superseded_by`;
los compromisos mapean `dueno` → `owner`, `para` → `stakeholder`, `plazo` → `due`; toda clave sin
campo Edu queda tal cual bajo `albert:` y en una sección "Origen Albert". Una nota con YAML
inválido se importa con su texto completo, marcada `import_warning: invalid-frontmatter`, y se
lista como advertencia. Reimportar omite lo ya importado.

**Aprende.** Las notas útiles suben y las que confunden decaen (`edu_feedback`).
`edu reflect` propone lecciones y cambios de skills a partir del trabajo reciente; nada se
vuelve verdad hasta que usted ejecuta `edu proposals accept <id>`.

## Obsidian: una ventana, no una segunda memoria

Ejecute `edu init` en cada proyecto y después `edu vault`. Edu crea `~/EduVault`, enlaza
los cerebros registrados y, si Obsidian está instalado, registra la bóveda para abrirla.
`edu vault --check` informa enlaces rotos y cantidad de notas; `edu vault --no-register`
omite el registro en Obsidian.

```text
<proyecto>/.edu/brain/ ──enlace──> ~/EduVault/Edu/<proyecto>/
~/.edu/brain/         ──enlace──> ~/EduVault/Edu/_global/
                                ~/EduVault/Notes/  (notas propias)
```

**Un solo escritor:** solo Edu escribe la memoria del cerebro. Guarde borradores en
`Notes/`; no copie notas del cerebro ni permita que otra herramienta genere una segunda
carpeta de memoria. No use su carpeta personal como bóveda: Obsidian recorre todo el
árbol, puede ralentizarse y fallar al encontrar archivos protegidos. Use una carpeta
dedicada como `~/EduVault`.

**Vistas.** Cada mantenimiento escribe Bases de Obsidian en `0-index/` del cerebro, con
nombres en el idioma del espacio (`lang` en `.edu/config.json`): Conocimiento (Todo / Por
aprobar), Decisiones, Lecciones, Hipótesis, Compromisos (Pendientes / Atrasados / Todos)
y Sesiones. Un cerebro ubicado directamente bajo la raíz de la bóveda (por ejemplo
`~/Edu/01-CONOCIMIENTO`) es el orquestador: sus Bases abarcan todos los espacios de la
bóveda y agregan una columna Proyecto. Además recibe `00-INICIO/Panel.md` (en inglés,
`00-START/Dashboard.md`), que incrusta esas vistas y enlaza cada espacio registrado. Edu
solo reescribe esa nota mientras su encabezado diga `generated_by: edu`; borre esa línea
para hacerla suya.

## Evidencia y métricas

Un cambio cuenta cuando está verificado, no cuando parece correcto. Edu registra trazas de
contexto, herramientas, verificación, atribución e intervención por episodio, siguiendo
[AI Harness Engineering](https://arxiv.org/abs/2605.13357).

```bash
edu checks run          # verificaciones deterministas que ejecuta Edu
edu metrics --by cli    # AVSR, tasa de intervención humana, autonomía de verificación
```

## Uso independiente

Edu también funciona por sí solo: `edu run "<objetivo>" [--solo|--crew] [--playbook <nombre>]`
orquesta los roles lead, explorer, builder y reviewer (vea
[Edu como su orquestador](#edu-como-su-orquestador)); `edu demo` muestra la vista en vivo sin ningún LLM.

## Desinstalar

Para revisar el contexto que cargan las CLI antes de quitar integraciones:

```bash
edu doctor --context                  # estimación de tokens, hooks, MCP y plugins por host
edu detach gentle-ai engram --dry-run # muestra las eliminaciones selectivas
edu detach gentle-ai engram --yes     # respalda y aplica los cambios
edu detach --list                     # muestra los respaldos activos
edu detach --undo                     # restaura el último respaldo byte por byte
```

`edu detach` no quita Edu ni desinstala binarios. Los respaldos quedan en
`~/.edu/backups/detach-*/`; la restauración rechaza archivos modificados salvo
que se indique `--force`. Use `--host claude,codex,pi,opencode,gemini` para limitar los hosts.

## Quitar Edu

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
