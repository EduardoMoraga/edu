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

[English](../README.md) · [Guías](guides/) · [Changelog](../CHANGELOG.md) ·
[Actualizar a 6.0](guides/upgrade-6.0.es.md) · [Arquitectura](ARCHITECTURE.md)

---

## Edu 6.0

Seguro por defecto, confiable en macOS, Linux y Windows, y un panel que muestra a sus agentes.

- **Edu Deck para Claude Code:** un panel lateral con el árbol en vivo de los agentes de la sesión
  (detener uno, escribirle, cambiar su modelo) y el cerebro, los trabajos del equipo y las
  aprobaciones de Edu. [Guía](guides/claude-code-deck.md)
- **Seguro por defecto:** instalaciones y actualizaciones verificadas, aprobaciones atadas a la
  compuerta que usted revisó, un techo de autonomía para llamadas MCP, CLIs de agentes que reciben
  solo el entorno que necesitan y verificaciones propuestas por el planificador que esperan a una
  persona. Vea el [modelo de seguridad](#modelo-de-seguridad).
- **Memoria confiable:** crear una nota nunca sobrescribe otra, una nota rota queda en cuarentena
  en vez de romper la búsqueda, cada nota transitiva declara su banda de certeza y la búsqueda
  cubre todos los alfabetos.
- **Sync conserva ambos lados:** un conflicto real publica su versión junto a la de GitHub, y
  `edu sync --install --replace-legacy` retira un programador de sync hecho a mano.
- **Equipo confiable:** los trabajos tienen límite de tiempo (60 minutos por defecto),
  `edu crew cancel` detiene todo el árbol de procesos, un worker muerto ya no aparece en curso y
  un error de la CLI cuenta como fallo.

**¿Viene de 5.x?** Algunos valores por defecto cambiaron: lea
[Actualizar a Edu 6.0](guides/upgrade-6.0.es.md). Todos los cambios, y la historia anterior a 6.0,
están en el [CHANGELOG](../CHANGELOG.md).

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
sudo). Descarga de GitHub el paquete de la última versión y su `SHA256SUMS`, comprueba el checksum,
instala el archivo verificado, ejecuta `edu setup`, que conecta Edu con cada CLI de programación
que encuentre, y muestra los siguientes pasos en su idioma.

¿Prefiere npm directamente? Verifique antes el paquete:

```bash
curl -fsSLO https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz
curl -fsSLO https://github.com/EduardoMoraga/edu/releases/latest/download/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS   # macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
npm i -g ./edu-agent.tgz
edu setup
```

Para instalar desde el código fuente, vea [Git installs](../CONTRIBUTING.md#git-installs). En
sandboxes en la nube (Claude Code en la web, Codex cloud):
`curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | EDU_YES=1 EDU_JOIN=https://github.com/<usted>/<cerebro>.git sh`
con un secreto `GH_TOKEN` ([guía](guides/install-5.0.md)).

Abra su CLI y pregunte: **"what do you remember?"** (o "¿qué recuerdas?"). Edu responde desde
su cerebro.

`edu setup` instala de forma global con el sistema de plugins propio de cada CLI, crea el
cerebro global (`~/.edu`) y registra cada cambio para que `edu uninstall` pueda revertirlo.
`edu doctor` muestra qué está conectado.

**Manténgase al día:**

```bash
edu update --check   # solo informa
edu update           # instala la última versión, verificada con su SHA256SUMS
```

`edu update` descarga el paquete y `SHA256SUMS` solo desde las versiones de este repositorio en
GitHub, comprueba el hash, instala el archivo verificado con el npm del Node que ejecuta Edu,
respalda y migra los espacios registrados y refresca setup. `edu update <tag>` (o `--to <tag>`)
elige una versión; las anteriores a 6.0 no tienen checksums y exigen `--allow-unverified`. La
instalación npm no es transaccional: si falla, compruebe `edu --version` antes de reintentar.
Reinicie sus CLIs y servidores MCP después. `edu capabilities --json` describe el binario
instalado.

## El Edu Deck

Vea a sus agentes y el estado de Edu sin salir de su CLI.

| CLI | Qué muestra | Cómo abrirlo |
|---|---|---|
| **Claude Code** | Panel lateral: árbol en vivo de agentes con Stop, Write, Model y Effort; pestañas Edu, Reports, Files, Log, Usage y Help; Approve y Reject para las ejecuciones del equipo | Se abre al empezar en terminales anchas; `/edu-deck` |
| **Pi** | Encabezado, pie y un widget del equipo en la TUI; una vista completa superpuesta | `/edu-deck` |
| **OpenCode 2** | Una línea de estadísticas en el pie y un panel en la barra lateral | `/edu-deck` |

Cada panel lee `edu deck --json`; si falla, espera más entre intentos en vez de reintentar en
bucle. Guías: [Claude Code](guides/claude-code-deck.md) · [Pi](guides/pi.md) ·
[OpenCode](guides/opencode.md). En una terminal, `edu deck` imprime la misma instantánea y
`edu watch` sigue en vivo los trabajos del equipo.

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
  `--cli`. Cada nota extraída queda como nota canónica **propuesta** a la espera de su aprobación,
  incluso lo que el documento afirma tal cual (banda `verified`, fuente `archivo#título`); nada se
  acepta sin usted.
  Los procedimientos se vuelven playbooks y los términos, una nota de glosario. Si la respuesta no
  es válida, Edu reintenta una vez y luego divide por títulos. Revíselas con `edu brain proposals`
  (título, fuente, banda, por qué) y decida con `edu brain approve <id>` / `--all` / `--reject <id>`
  (una propuesta rechazada se borra y queda un registro en la memoria episódica).
  `edu brain approve` necesita una terminal, o `--yes` en scripts.
- `--no-llm` divide por títulos, sin conexión y determinista. `--lang es|en` nombra las carpetas
  (por defecto `EDU_LANG`, luego el idioma del sistema, luego español). `--dir` fija la carpeta
  padre (por defecto `~/Edu`); un destino no vacío exige `--yes`. Los originales nunca se modifican.
- Agregue más después, desde dentro del espacio: `edu create --add notas.pdf`.
- Los PDF usan `pdftotext` si está instalado; si no, un lector JS incluido. Los PDF escaneados necesitan OCR antes.
- Cualquier cerebro puede vivir en una carpeta visible: `"brainDir": "01-CONOCIMIENTO"` en `.edu/config.json`.

## Edu dentro del agente que ya usa

| CLI | Instalación (o simplemente `edu setup`) | Qué obtiene | Cómo usarlo |
|---|---|---|---|
| **Claude Code** | `/plugin marketplace add EduardoMoraga/edu` y luego `/plugin install edu@edu` | skills, roles, MCP, hooks de identidad, panel Edu Deck en vivo ([guía](guides/claude-code-deck.md)), `edu statusline` | `/edu-deck`, `/edu:brief`, `/edu:crew …` o en lenguaje natural |
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
"pídele a codex que…", "orquesta esto"). Detalle por CLI (en inglés):
[Claude Code](guides/claude-code.md) · [Codex](guides/codex.md) · [Pi](guides/pi.md) ·
[OpenCode](guides/opencode.md) · [Antigravity](guides/antigravity.md).

Converse con sus espacios desde Telegram: `edu connect hermes --project <espacio>` agrega Edu a
[Hermes](guides/hermes.md), y `--undo` lo revierte byte por byte.

## El equipo (crew)

Pida a Codex que escriba pruebas desde Claude y observe cómo trabaja:

```
/edu:crew codex: write tests for src/auth
```

Edu despacha el trabajo (`edu_crew_dispatch`), consulta su estado (`edu_crew_status`) y
devuelve un resumen (`edu_crew_result`); `edu_crew_cancel` lo detiene. Con herdr en ejecución, el
trabajo puede abrirse en un panel visible a su lado; si no, corre en segundo plano. En ambos casos
el agente corre como worker del equipo: sus herramientas de Edu pueden leer el cerebro, pero no
aprobar compuertas, despachar agentes ni escribir memoria. Lo mismo desde una terminal:

```bash
edu crew dispatch codex "write tests for src/auth" --autonomy auto   # le permite editar archivos
edu crew status                                  # todos los trabajos; un worker muerto queda failed
edu crew result <job-id> --wait 300
edu crew cancel <job-id>                         # detiene todo su árbol de procesos
```

| Autonomía | Un trabajo headless puede |
|---|---|
| `readonly` | leer y buscar |
| `ask` (por defecto) | leer; escribir requiere a una persona, así que los trabajos headless de Claude, Codex y Pi no escriben |
| `auto` | editar el espacio y ejecutar comandos |
| `full` | hacer todo lo que la CLI permita sin preguntar; requiere `crew.maxAutonomy: "full"` en la configuración global |

Los trabajos del equipo se detienen a los 60 minutos: pase `--timeout <minutos>` (MCP:
`timeoutMinutes` en `edu_crew_dispatch`) o configure `crew.timeoutMinutes`. Un trabajo en panel que
pasa su límite queda `failed` y su panel se cierra. `edu crew status` imprime una tabla (`--json`
para scripts). El trabajo de solo lectura va solo a CLIs que la hacen cumplir: claude,
codex y pi. En OpenCode, `auto` y `full` pasan `--auto`, que aprueba todo permiso que la
configuración de OpenCode no niegue. Las opciones exactas por CLI están en la
[guía de actualización](guides/upgrade-6.0.es.md#la-autonomía-significa-lo-mismo-en-cada-cli).

```
/edu:review main
```

Un revisor de solo lectura de **otro proveedor** revisa su diff (`edu_crew_review`) y
devuelve hallazgos ordenados por severidad. Si no hay otro proveedor instalado, Edu solicita
que seleccione explícitamente un revisor disponible.

**Centro de control.** `edu watch` en una segunda terminal muestra cada trabajo del equipo en
vivo: agentes, estado, tokens y costo, incluidos los que esperan su aprobación.

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
edu run "add a --json flag" --playbook default --yes  # aprueba la especificación y los pasos automáticamente
edu run "add a --json flag" --detach                  # sigue como trabajo del equipo observable
edu crew approve <job-id>                             # aprueba la compuerta abierta de una ejecución separada
edu crew reject <job-id>                              # detiene una ejecución separada
```

```
/edu:run add a --json flag to the status command      # Claude Code (Pi/OpenCode: /edu-run)
```

En Codex, pida "run this with edu" o "orquesta esto", o nombre la skill `edu-run`.
`edu watch` muestra en vivo la tarjeta de la especificación, cada agente y cada verificación.
Sin una terminal interactiva, `edu run` exige `--yes`; si no, la terminal le pide aprobar la
especificación impresa antes de ejecutar.

Las verificaciones que propone el planificador y no están registradas corren solo si usted aprueba
la especificación que las lista. `--yes` aprueba por usted, así que esas verificaciones se omiten y
se informan; regístrelas con `edu checks add` y `edu checks accept`, o pase
`--allow-unregistered-checks`. El `.edu/harness/checks.json` que trae un repositorio cuenta como
registrado solo después de que usted lo revisa y ejecuta `edu checks accept` en su máquina; si
cambia, hay que aceptarlo de nuevo.

Una ejecución separada (`--detach`, `edu_orchestrate`) siempre se detiene en la compuerta de la
especificación, y la configuración del proyecto no puede aflojar el `approvals` global ni subir
`crew.maxAutonomy`. Su tiempo de trabajo y la espera de cada compuerta los limita
`crew.timeoutMinutes`.

Los clientes MCP pueden usar `edu_orchestrate` y `edu_crew_approve` para el mismo flujo.
`edu_crew_approve` debe nombrar el `requestId` de la compuerta, y Edu lo registra como decisión del
LLM anfitrión, no suya.

## Modelo de seguridad

Lo que Edu hace cumplir y cómo cambiarlo:

| Área | Por defecto | Se cambia con |
|---|---|---|
| Instalaciones y actualizaciones | Solo paquetes que coinciden con el `SHA256SUMS` de la versión, descargados de las versiones de este repositorio en GitHub | `--allow-unverified`, solo para versiones anteriores a 6.0 |
| Aprobaciones del equipo | Cada compuerta tiene un `requestId` y la decisión debe nombrarlo. Compuertas y decisiones viven en su carpeta global, fuera del espacio. Los workers del equipo, headless o en un panel de herdr, nunca aprueban, lanzan ni cancelan. Cada decisión registra `cli`, `deck` o `host-llm` | `edu crew approve <id> --request <requestId>` |
| Notas canónicas | Solo una persona las acepta: `edu brain approve` necesita una terminal | `--yes` en scripts |
| Autonomía del equipo | Hasta `auto` desde MCP y desde la CLI; `full` se rechaza | `crew.maxAutonomy` en la configuración global |
| Entorno de las CLIs de agentes | PATH, carpeta de usuario, idioma, terminal, proxy, temporales y las variables de autenticación de esa CLI | `crew.env.passthrough` en la configuración global |
| Verificaciones que inventa el planificador, y el checks.json de un repositorio | Corren solo después de que una persona aprueba la especificación que las lista | `edu checks accept` (fijado por espacio hasta que checks.json cambie) o `--allow-unregistered-checks` |
| Espacios desde MCP | Solo espacios registrados y carpetas con `.edu/`; MCP nunca crea un cerebro | `edu init` en la carpeta |
| Roles de solo lectura | El planificador, el revisor y cada paso de solo lectura corren solo en CLIs que hacen cumplir la solo lectura | — |
| Su configuración | Setup conserva los valores que usted definió; uninstall conserva lo editado después de instalar | — |

La configuración global es `~/.edu/config.json` (o `$EDU_HOME/config.json`). El
`.edu/config.json` de un proyecto lo puede escribir un agente, así que no puede subir estos
ajustes.

Edu no agrega un sandbox de sistema operativo ni de red: la autonomía se traduce a los modos de
permisos de cada CLI. `auto` de Claude puede ejecutar cualquier comando; `auto` de Codex corre
dentro del sandbox de espacio de Codex.

## El cerebro

Markdown plano con frontmatter YAML y `[[wikilinks]]`: legible por cualquier LLM, navegable
en Obsidian (`edu brain link <vault>`) y versionable con git. Sin base de datos.

| Capa | Qué contiene |
|---|---|
| `canonical` | verdad estable: estándares, preferencias, léxico. Cambia solo cuando usted acepta una propuesta |
| `episodic` | una nota por sesión, inmutable una vez cerrada |
| `transitive` | lo que se arrastra entre sesiones: `D-` decisiones · `H-` hipótesis · `C-` compromisos · `L-` lecciones |

Cada nota tiene una **banda de certeza** —`verified`, `inferred` o `hypothesis`— y Edu nunca
presenta una hipótesis como un hecho. `edu_remember` la exige para las notas transitivas,
`edu brain remember` usa `hypothesis` por defecto y lo avisa, y las notas antiguas sin banda se
muestran como `unbanded`. Cada sesión empieza con un brief breve; el resto se consulta bajo
demanda (`edu_recall`, `edu_read`), de modo que el contexto se mantiene ligero. En una terminal,
`edu brief [objetivo]` imprime el mismo brief y `edu brain read <ref>` una nota.

**No se pierde nada.** Crear una nota nunca sobrescribe un archivo: un nombre ocupado recibe
`-2`, `-3`. Un archivo cuyo frontmatter Edu no puede leer queda en cuarentena: la búsqueda lo
omite, `edu brain lint` lo lista como `unreadable` y el brief lo nombra, para que usted lo repare.

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

**Aprende.** Las notas útiles suben y las que confunden decaen (`edu_feedback`); el feedback
consultivo nunca retira una lección probada. `edu reflect` propone lecciones y cambios de skills a
partir del trabajo reciente; nada se vuelve verdad hasta que usted ejecuta
`edu proposals accept <id>`.

**Se limpia.** `edu brain lint` revisa la salud del cerebro sin escribir. `edu brain tidy`
escribe un plan revisable con lo que el mantenimiento nunca limpia (sesiones vacías, hipótesis
viejas, enlaces rotos de importaciones) y `edu brain tidy --apply` lo aplica con respaldo.
`edu dream` convierte las sesiones recientes de todos los agentes en un plan que usted revisa;
nada cambia hasta `--apply`.

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

## Un cerebro en cada máquina: `edu sync`

Guarde el cerebro en un repositorio Git (por ejemplo `~/Edu`, con `~/.edu/brain` enlazado a su
`01-CONOCIMIENTO`) y ejecute el mismo sync en todas partes:

```bash
edu sync                              # commit, rebase sobre GitHub, push (nunca forzado)
edu sync --install                    # personal cada 5 min, cheil cada 15: systemd, LaunchAgent o Programador de tareas
edu sync --install --replace-legacy   # además retira un agente de sync hecho a mano (pregunta antes)
edu sync --status                     # último resultado, programador, copias de conflicto; también en edu doctor
edu sync --cloud                      # sandboxes en la nube: contadores y bases de Obsidian quedan locales
```

Los archivos que Edu regenera (`0-index/`, `Panel.md`, `*.base`) nunca detienen el sync: gana la
copia de GitHub y Edu los reescribe. Los conflictos que solo difieren en contadores de uso se
fusionan solos (el mayor contador y la fecha más reciente). Un conflicto real conserva ambos
lados: la versión de GitHub mantiene la ruta y la suya se publica al lado como
`<nombre>.conflict-<host>-<sha>.md`; sus commits también quedan respaldados en
`sync-conflict/<host>-<sha>`. Recibe una notificación de escritorio; lleve lo que necesite a la
nota original, borre la copia y sincronice. `edu sync --status` termina con código 1 mientras
quede una copia de conflicto.

Cada perfil tiene su programador: `EduSync-personal` y `EduSync-cheil` en Windows,
`edu-sync-<id>` en systemd y `dev.edu.sync.<id>` en launchd. El sync personal no empuja si
`origin` es `cheil-vault` o si una ruta resuelve bajo `C:\Cheil`. El sync cheil no empuja
`edu-vault`.

Edu también informa un agente de sync antiguo para la misma bóveda (un LaunchAgent o una unidad
de usuario de systemd que ejecuta un script `*-vault-sync` o nombra la bóveda), la tarea anterior
`EduSync` y una tarea `CheilVaultSync`. `--replace-legacy` los quita, después de preguntar, una
vez que el programador de Edu arrancó. Sin esa bandera se quedan.

`edu join <repo>` conecta otra máquina o un sandbox en la nube al cerebro compartido, y
`edu brain share <id>` mueve una nota al cerebro global. Las escrituras compartidas están
protegidas por hash (`edu_read` muestra el hash y `expected_hash` rechaza una actualización
desfasada), cada nota registra máquina, agente y sesión, y los secretos se ocultan antes de
escribir.

## Evidencia y métricas

Un cambio cuenta cuando está verificado, no cuando parece correcto. Edu registra trazas de
contexto, herramientas, verificación, atribución e intervención por episodio, siguiendo
[AI Harness Engineering](https://arxiv.org/abs/2605.13357).

```bash
edu checks run          # verificaciones deterministas que ejecuta Edu
edu metrics --by cli    # AVSR, tasa de intervención humana, autonomía de verificación
edu bench               # memoria: calidad de recuperación y costo de contexto, en cerebros temporales
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
Los plugins TUI de OpenCode también cuentan: `edu detach gentle-ai` quita su plugin de logo de la
lista `plugins` del `cli.json` de OpenCode 2 (y de la lista `plugin` de OpenCode 1 en
`tui.json`/`tui.jsonc`) y conserva sus comentarios y demás entradas.

## Quitar Edu

```bash
edu uninstall --scope global   # revierte todo lo que registró edu setup
npm rm -g edu-agent
```

`edu uninstall` quita solo la parte de Edu de cada configuración y conserva lo que usted o una CLI
editaron después de instalar, como el inicio de sesión de Claude Code o servidores MCP nuevos. Un
archivo que nadie tocó desde la instalación vuelve byte por byte. También detiene y borra el
programador de `edu sync` y cada dream nocturno (`edu dream --install`; `edu dream --uninstall`
quita solo el del proyecto actual). En Windows `edu dream --install` no instala nada, así que una
tarea del Programador de tareas creada por usted queda a su cargo.

Alternativas nativas: `claude plugin uninstall edu@edu` · `codex plugin remove edu@edu` ·
`pi remove git:github.com/EduardoMoraga/edu` · `agy plugin uninstall edu`. Si usted cambió la parte
de un archivo que gestiona Edu, la desinstalación se detiene y nombra el archivo (`--force` quita
igual la parte de Edu). Su cerebro (`~/.edu`, `.edu/`) nunca se borra: son sus datos.

## Windows

- Funciona en PowerShell, cmd y Git Bash con Node ≥ 22; la CI corre en Windows, macOS y Linux.
- En PowerShell la ruta de Antigravity es `"$(npm root -g)\edu-agent\plugins\agy"`.
- `edu brain link` crea una junction en lugar de un symlink; no requiere permisos de administrador.
- El modo panel del equipo requiere herdr; sin él, los trabajos corren en segundo plano y
  `edu watch` los muestra.
- Cancelar un trabajo del equipo o cerrar la terminal termina todo el árbol de procesos del
  agente (`taskkill /t /f`).

## Preguntas frecuentes

**¿Necesito varias suscripciones de LLM?** No. Todo funciona con una sola CLI; el equipo es un
extra.

**¿Edu envía mi código a algún lugar?** Edu no tiene servidor propio ni envía telemetría. Usa la
red solo para lo que usted pide: los instaladores y `edu update` descargan versiones desde GitHub,
y `edu sync` y `edu join` suben y bajan su repositorio del cerebro con Git. Las CLIs que ejecuta
Edu (Claude Code, Codex, …) hablan con sus proveedores de modelos con su propia configuración.

**¿Puedo editar el cerebro a mano?** Sí, es Markdown. Las notas canónicas aceptadas están
protegidas contra ediciones automáticas.

## Licencia

MIT © Eduardo Moraga
