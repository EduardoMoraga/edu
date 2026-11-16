# Actualizar a Edu 6.0

[English](upgrade-6.0.md)

Edu 6.0 conserva sus cerebros, notas, identidades, espacios registrados y la configuración de cada
CLI. Cambia valores por defecto que no eran seguros, así que algunas cosas que hacía en 5.x ahora
piden una opción o un ajuste más. Lea primero la tabla de
[cambios incompatibles](#cambios-incompatibles). La lista completa está en el
[CHANGELOG](../../CHANGELOG.md).

## Antes de actualizar

- **Decida las aprobaciones pendientes.** Una ejecución de 5.x que espera aprobación no se puede
  aprobar con 6.0 (no tiene `requestId`). Apruébela o rechácela antes, o cancélela después de
  actualizar con `edu crew cancel <id>` y vuelva a lanzarla.
- **Deje terminar los trabajos del equipo en curso.** La actualización reemplaza los archivos que
  carga un worker en ejecución.

## Actualizar

### Rápido: `edu update`

```bash
edu update --check
edu update
edu --version
```

Desde 5.x, el actualizador que corre es el de 5.x: instala 6.0 directamente desde la URL de la
versión, sin comprobar el checksum. Cada actualización posterior a 6.0 se verifica.

### Verificado

Para verificar también este salto, compruebe el paquete usted mismo y luego ejecute los dos pasos
que `edu update` ejecuta después de instalar, en el mismo orden:

```bash
curl -fsSLO https://github.com/EduardoMoraga/edu/releases/download/v6.0.0/edu-agent.tgz
curl -fsSLO https://github.com/EduardoMoraga/edu/releases/download/v6.0.0/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS   # macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
npm install -g ./edu-agent.tgz
edu internal migrate-workspaces                 # respalda y migra los contratos gestionados
edu setup --yes                                 # actualiza cada CLI
```

Windows (PowerShell):

```powershell
$base = 'https://github.com/EduardoMoraga/edu/releases/download/v6.0.0'
Invoke-WebRequest "$base/edu-agent.tgz" -OutFile edu-agent.tgz
Invoke-WebRequest "$base/SHA256SUMS" -OutFile SHA256SUMS
(Get-FileHash edu-agent.tgz -Algorithm SHA256).Hash.ToLower()   # debe coincidir con la línea de edu-agent.tgz
Get-Content SHA256SUMS
npm install -g .\edu-agent.tgz
edu internal migrate-workspaces
edu setup --yes
```

`edu internal migrate-workspaces` termina con código 1 si falta un espacio registrado; los demás se
migran igual.

**Después reinicie** Claude Code, Codex, Pi, OpenCode y Antigravity. Una CLI abierta conserva el
servidor MCP, los hooks y el plugin anteriores hasta que se reinicia.

## Cambios incompatibles

| Cambio | A quién afecta | Qué hacer |
|---|---|---|
| [Instalaciones y actualizaciones verificadas](#actualizaciones-verificadas) | Quien instale una versión anterior a 6.0 | Agregar `--allow-unverified` |
| [Bandas de certeza obligatorias](#bandas-de-certeza-obligatorias) | Agentes y scripts que llaman a `edu_remember` para notas transitivas | Pasar `band` |
| [Las aprobaciones nombran su compuerta](#las-aprobaciones-nombran-su-compuerta) | Clientes MCP y scripts que aprueban ejecuciones del equipo | Pasar `requestId`; quitar `autoApprove` |
| [Ajustes del equipo en la configuración global](#ajustes-del-equipo-en-la-configuración-global) | Llamadas MCP con `autonomy: "full"`; agentes que necesitan tokens como `GITHUB_TOKEN` | Fijar `crew.maxAutonomy` o `crew.env.passthrough` en la configuración global |
| [Las verificaciones no registradas necesitan a una persona](#las-verificaciones-no-registradas-necesitan-a-una-persona) | `edu run --yes` en scripts | Registrar las verificaciones o pasar `--allow-unregistered-checks` |
| [MCP nunca crea un cerebro](#mcp-nunca-crea-un-cerebro) | `edu_project_use` o raíces MCP que apuntan a una carpeta sin `.edu/` | Ejecutar antes `edu init` en esa carpeta |
| [La autonomía significa lo mismo en cada CLI](#la-autonomía-significa-lo-mismo-en-cada-cli) | Trabajos headless de Codex o Pi con el `ask` por defecto; trabajos de solo lectura en OpenCode o agy | `--autonomy auto` para escribir; claude, codex o pi para solo lectura |
| [Los trabajos del equipo tienen límite de tiempo](#los-trabajos-del-equipo-tienen-límite-de-tiempo) | Trabajos headless de más de una hora | `--timeout <minutos>` o `crew.timeoutMinutes` |
| [Scripts de pruebas](#scripts-de-pruebas-para-quienes-contribuyen) | Quien contribuye y la CI que ejecuta `npm test` | `npm run test:perf` o `npm run test:all` para los presupuestos de tiempo |

## Actualizaciones verificadas

`edu update`, `install.sh` e `install.ps1` descargan el paquete y `SHA256SUMS` solo desde
`https://github.com/EduardoMoraga/edu/releases/download/<tag>/`, comprueban el SHA-256 e instalan
el archivo local verificado. Si no coincide, no se instala nada.

| Quiere | Ejecute |
|---|---|
| La última versión | `edu update` |
| Una versión anterior a 6.0 (sin `SHA256SUMS`) | `edu update v5.0.1 --allow-unverified` |
| Una versión anterior a 6.0 con `install.sh` | `EDU_ASSET=<URL del paquete de la versión> EDU_ALLOW_UNVERIFIED=1`, o la opción `--allow-unverified` |
| Una versión anterior a 6.0 con `install.ps1` | `$env:EDU_ALLOW_UNVERIFIED = '1'` y `$env:EDU_ASSET` |

- Una versión 6.0 o posterior sin `SHA256SUMS` siempre se rechaza.
- `edu update --json` informa `verified` (`false` solo después de `--allow-unverified`).
- `EDU_ASSET=<ruta a un .tgz>` sigue instalando tal cual un paquete que usted construyó.

Volver a 5.x instala sin checksum, y la migración de espacios de 5.x se niega a bajar de versión
los contratos que migró 6.0, así que informa la actualización como incompleta. Sus notas no se
tocan.

## Bandas de certeza obligatorias

Cada nota transitiva (decisión, hipótesis, compromiso, lección) dice con cuánta fuerza se puede
afirmar: `verified`, `inferred` o `hypothesis`.

- **MCP:** `edu_remember` rechaza una nota transitiva sin `band`. Las skills de 6.0 le piden una
  al agente; actualice sus propios prompts o scripts que llamen a la herramienta.
- **CLI:** `edu brain remember` sin `--band` escribe `hypothesis` y lo avisa.
- **Notas antiguas** sin banda se muestran como `unbanded`. Edu nunca las reescribe; agregue
  `band:` al frontmatter para fijarla.

## Las aprobaciones nombran su compuerta

Cada compuerta de aprobación recibe un `requestId` nuevo. Una decisión cuenta solo si nombra la
compuerta abierta y se escribió después de que se abrió.

```bash
edu crew status <job-id>                                # approval.requestId muestra la compuerta abierta
edu crew approve <job-id>                               # decide la compuerta abierta ahora
edu crew approve <job-id> --request <request-id>        # se rechaza si ahora hay otra compuerta abierta
edu crew reject <job-id> --request <request-id>
```

- **MCP:** `edu_crew_approve` exige `requestId` (de `edu_orchestrate` o `edu_crew_status`). Queda
  registrada como decisión del LLM anfitrión (`by: host-llm`), que no cuenta como una persona ni
  autoriza verificaciones no registradas.
- `edu_orchestrate` ya no acepta `autoApprove`.
- Los workers del equipo (con `EDU_CREW_JOB`) nunca pueden aprobar, ni por MCP, ni por la CLI, ni
  con archivos de decisión. Los agentes que Edu inicia en un panel de herdr también son workers: sus
  herramientas de Edu solo leen.
- Los archivos de decisión anteriores a 6.0 se ignoran.
- `edu brain approve` necesita una terminal, o `--yes` en scripts, y se niega dentro de un worker.

## Ajustes del equipo en la configuración global

Estos ajustes se leen solo de la configuración global, `~/.edu/config.json` (o
`$EDU_HOME/config.json`). El `.edu/config.json` de un proyecto lo puede escribir un agente o venir
con un repositorio clonado, así que no puede subirlos.

```json
{
  "crew": {
    "maxAutonomy": "auto",
    "env": { "passthrough": ["GITHUB_TOKEN"] },
    "timeoutMinutes": 60
  }
}
```

Agregue la sección `crew` al archivo existente; conserve sus otras claves.

| Clave | Por defecto | Se lee de | Efecto |
|---|---|---|---|
| `crew.maxAutonomy` | `auto` | solo la global | Autonomía máxima que una llamada MCP puede pedir en `edu_crew_dispatch`. `full` se rechaza hasta que usted la suba. `edu crew dispatch` desde una terminal no tiene este límite. |
| `crew.env.passthrough` | `[]` | solo la global | Nombres de variables adicionales que reciben las CLIs de agentes. |
| `crew.timeoutMinutes` | `60` | la del espacio; si no, la global | Límite por defecto de los trabajos headless, de 1 a 1440. |

Una sección `crew` inválida vuelve a los valores por defecto.

### Qué reciben las CLIs de agentes

Las CLIs que inicia Edu ya no heredan todo su entorno. Reciben:

- lo que cualquier programa necesita: `PATH`, carpetas de usuario y perfil, idioma, `TERM`,
  variables de proxy y certificados CA, carpetas temporales, carpetas XDG y las variables de
  sistema de Windows;
- los ajustes propios de Edu que no son secretos (`EDU_HOME`, `EDU_LANG`, …);
- las variables de autenticación de esa CLI, por ejemplo `ANTHROPIC_*` para Claude Code y
  `OPENAI_*` y `CODEX_*` para Codex.

Cualquier otra, como `GITHUB_TOKEN`, `NPM_TOKEN` o `SSH_AUTH_SOCK`, debe estar en
`crew.env.passthrough`. En Windows los nombres no distinguen mayúsculas. Las verificaciones
registradas (`.edu/harness/checks.json`) siguen recibiendo todo el entorno: las escribió usted.

## Las verificaciones no registradas necesitan a una persona

Una verificación que propone el planificador y no está en `.edu/harness/checks.json` corre solo
cuando:

- una persona aprueba la especificación que la lista (la aprobación muestra los comandos exactos), o
- la ejecución lleva `--allow-unregistered-checks`.

`edu run --yes` y las aprobaciones del LLM anfitrión no las ejecutan. La ejecución informa
`Unregistered check(s) not run: …`. Para que una verificación corra siempre, regístrela:

```bash
edu checks add --id unit --req R1 --cmd "npm test"
```

## MCP nunca crea un cerebro

`edu_project_use` y las raíces MCP que envía un cliente aceptan solo:

- un espacio registrado (por nombre o por nombre del agente),
- una carpeta que ya tiene `.edu/`, o
- `global`.

Ninguno crea un cerebro. Ejecute antes `edu init` en la carpeta. Ahora se leen también las raíces
que llegan tarde y `roots/list_changed`.

## La autonomía significa lo mismo en cada CLI

| Nivel | Significado |
|---|---|
| `readonly` | Solo leer y buscar. |
| `ask` | Escribir requiere a una persona. Un trabajo headless no tiene a quién preguntar, así que no escribe. |
| `auto` | Editar el espacio y ejecutar comandos sin preguntar. |
| `full` | Sin controles de permisos. |

Opciones headless por CLI:

| CLI | `readonly` | `ask` | `auto` | `full` |
|---|---|---|---|---|
| claude | `--permission-mode plan` | `--permission-mode default` | `acceptEdits` más `--allowedTools Bash` | `bypassPermissions` |
| codex | `-s read-only` | `-s read-only` (5.x: `workspace-write`) | `-s workspace-write` | `-s danger-full-access` |
| pi | `--tools read,grep,find,ls` | igual que `readonly` (5.x: todas las herramientas) | herramientas por defecto de Pi | herramientas por defecto de Pi |
| opencode | se rechaza | su propia configuración | `--auto` | `--auto` (lo que su configuración niega sigue negado) |
| agy | se rechaza | su propia configuración | su propia configuración | `--dangerously-skip-permissions` |

- El valor por defecto de `edu crew dispatch` y `edu_crew_dispatch` es `ask`. Para que un trabajo
  headless escriba, pase `--autonomy auto` (MCP: `autonomy: "auto"`).
- El planificador (lead) y el revisor necesitan una CLI que haga cumplir la solo lectura (claude,
  codex o pi). Edu los mueve a una de ellas o se detiene con un mensaje.
- En modo panel (herdr) hay una persona, así que `ask` de Codex sí pregunta.
- Son los modos de permisos de cada CLI, no un sandbox del sistema operativo. `auto` de Claude
  puede ejecutar cualquier comando; `auto` de Codex corre en el sandbox de espacio de Codex.

## Los trabajos del equipo tienen límite de tiempo

Los trabajos headless se detienen a los 60 minutos. Un trabajo que vence termina `failed` con
`Timed out after N minute(s)`.

```bash
edu crew dispatch codex "migrate the test suite" --autonomy auto --timeout 180
edu crew cancel <job-id>     # detiene ahora todo el árbol de procesos; el trabajo queda cancelled
```

- Fije el valor por defecto con `crew.timeoutMinutes` (1 a 1440).
- No detiene trabajos en panel ni orquestaciones de `edu run`.
- `edu crew status` comprueba que cada worker siga vivo. Un worker que murió queda `failed` en vez
  de seguir `running`.

## Sync: copias de conflicto y programadores antiguos

**Copias de conflicto.** Si una nota cambió en dos máquinas, la versión de GitHub conserva la ruta
y la suya se publica al lado como `<nombre>.conflict-<host>-<sha>.md`, con su propio id y
`conflict_of`. Sus commits originales siguen respaldados en `sync-conflict/<host>-<sha>`.

```bash
edu sync --status    # lista cada copia de conflicto; termina con código 1 mientras quede alguna
```

Lleve lo que quiera a la nota original, borre la copia y vuelva a sincronizar. Los conflictos que
solo difieren en contadores se fusionan solos (el mayor de `uses`/`wins`/`losses` y la fecha más
reciente).

**Programadores antiguos.** Si sincronizaba con su propio LaunchAgent (macOS) o unidad de usuario
de systemd (Linux), Edu lo informa cuando ejecuta un script `*-vault-sync` o nombra su bóveda.
Reemplácelo con el programador de Edu:

```bash
edu sync --status                       # "Legacy sync agent: <archivo>"
edu sync --install --replace-legacy     # pregunta antes; agregue --yes en scripts
```

Edu quita el agente antiguo solo después de que su propio programador arrancó. En macOS lo
descarga con `launchctl` y borra el plist; en Linux desactiva el timer, detiene el servicio, borra
ambas unidades y recarga systemd. `--json` informa `removedLegacy`.

## Scripts de pruebas (para quienes contribuyen)

| Script | Ejecuta |
|---|---|
| `npm test` | Los proyectos `unit` y `contracts`. |
| `npm run test:perf` | Los presupuestos de tiempo (el proyecto `perf`). |
| `npm run test:all` | Los tres proyectos. |
| `npm run test:coverage` | `unit` y `contracts` con el umbral de cobertura. |
| `npm run test:deck` | Las pruebas del motor del Edu Deck con `claude plugin test`. |

Las pruebas de contrato de Pi se omiten si Pi no está instalado. Vea
[CONTRIBUTING](../../CONTRIBUTING.md).

## Otros cambios que puede notar

- Crear una nota nunca sobrescribe un archivo: una ruta ocupada recibe `-2`, `-3`. Los títulos no
  latinos y los muy largos reciben ids ASCII con un hash corto.
- Una nota con frontmatter roto queda en cuarentena en vez de romper la búsqueda. `edu brain lint`
  la lista como `unreadable` (`--strict` falla) y el brief la muestra en "Unreadable notes".
- `edu_recall` muestra solo resultados completos que caben en el presupuesto y dice cuántos dejó
  fuera.
- `edu uninstall` conserva lo que usted o una CLI cambiaron después de instalar, como el inicio de
  sesión de Claude Code o servidores MCP nuevos. Setup conserva un `statusLine`, un agente o un
  `mcpServers.edu` que usted definió y avisa "Kept your own …".
- `edu_crew_result` espera como máximo 600 segundos.
