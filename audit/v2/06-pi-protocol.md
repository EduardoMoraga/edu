# Unidad 6 — Pi / protocolo

## Estado
Implementación acotada a propiedad 6. Sin commits, pushes, instalaciones, versiones,
lockfiles, dist, plugins generados ni cerebros/config reales. Fixtures únicos en `/tmp`,
eliminados al terminar. No se lanzaron modelos ni agentes anidados.

## Coordinación necesaria (principal / unidad 5)
`templates/pi/edu.ts` envía ahora JSON stdin `{cwd, session_id, source: "pi"}`:
`session_id` viene de `ctx.sessionManager.getSessionId()`, API instalada comprobada.
Al inspeccionar `src/cli/hooks.ts`, `sessionStart` todavía usa literalmente `claude`
y título Claude para cualquier source. **Solicito a unidad 5 aceptar/atribuir source pi**,
conservando el contrato Claude existente y devolviendo `Edu session id: ...` para Pi.
No edité su archivo. Si llega ID, el protocolo exige conservarlo y no abrir otro;
si falta, pide `edu_session_open(title, source)` y conservar exactamente su ID.

## Archivos
- `templates/pi/edu.ts`: cwd efectivo en subprocess y MCP; EDU_BIN común; execFile
  asíncrono; caché por sesión/workspace con coalescencia, incluida ausencia/errores;
  `/edu-refresh` invalida solo ese workspace, reconstruye en el siguiente prompt.
  Stderr (incluso exit 0 de safeHook) y errores se elevan al canal de errores Pi.
- `src/adapters/common.ts`: bloque instalado exige reutilizar brief/ID inyectados,
  apertura cuando falta, cierre exacto, recall, capabilities y feedback advisory.
- `templates/EDU.md`: protocolo mínimo al principio, antes de identidad extendida,
  para priorizar apertura/ID/recall/capabilities bajo recorte. Procedencia y límites.
- Skills `edu-brain`, `edu-brief`, `edu-recall`, `edu-reflect`, `edu-status` y comandos
  `brief.md`, `recall.md`: no duplicar brief; procedencia; opinión no prueba lecciones;
  nombres lógicos vs namespace real Pi y descubrimiento de herramientas diferidas.
- Nuevos tests `src/adapters/pi-protocol.test.ts`, `src/adapters/common.protocol.test.ts`.

## Reproducción y resultados exactos
1. `room-cli files wait`: exit 0, archivos listos.
2. `node_modules/.bin/vitest run src/adapters/pi-protocol.test.ts --maxWorkers=1`
   **antes del arreglo**: exit 1, 6/6 fallaron. MCP seguía usando `edu`, sin cwd;
   dos prompts ejecutaban dos subprocesses desde `/code/edu`, no desde ctx.cwd;
   fallos/errores stderr resolvían undefined en lugar de rechazarse.
3. Mismo comando tras primera implementación: exit 1, 3 pasan/3 fallan por error
   del harness (commands están en extension.commands, no runtime.commands). Corregido
   el harness contra loader real; no se debilitaron aserciones.
4. `node_modules/.bin/vitest run src/adapters/pi-protocol.test.ts src/adapters/common.protocol.test.ts src/adapters/installer.test.ts --maxWorkers=1`:
   exit 0, **3 archivos / 30 tests pasan**.
5. `node_modules/.bin/tsc --noEmit`: primera ejecución exit 0. Última ejecución
   durante trabajo concurrente: exit 2, `src/orchestrator/run.ts(355,128): TS2345:
   string | undefined is not assignable to string`. Archivo de otra unidad, no tocado.
6. `node_modules/.bin/vitest run src/identity/templates.test.ts --maxWorkers=1`:
   reproducción del nuevo exceso del core, exit 1, 2 fallos de 10 (603 > 600/400).
   Se redujo el core y movió explicación a extended **sin cambiar tests ni límites**.
7. `node_modules/.bin/vitest run src/identity/templates.test.ts src/adapters/pi-protocol.test.ts src/adapters/common.protocol.test.ts src/adapters/installer.test.ts --maxWorkers=1`:
   exit 0, **4 archivos / 42 tests pasan**. Incluye compilación semántica TypeScript
   del template contra declaraciones Pi instaladas (0 diagnósticos), y brief real
   con identidad fixture que conserva apertura/ID/cierre/recall/capabilities pese
   a la asignación de identidad de 160 tokens.
8. `git diff --check -- templates src/adapters/common.ts src/adapters/pi-protocol.test.ts src/adapters/common.protocol.test.ts`:
   exit 0, sin errores de whitespace.

Tests ejecutan loader Pi real y handlers registrados con contextos contractuales,
subprocess binario fixture real y stdin JSON; verifican A/B vs cwd del proceso,
EDU_BIN MCP/hook, caché por workspace/sesión, concurrencia, refresco explícito,
no-brain y errores con/sin stderr. Sin sesión LLM. Los tests de protocolo examinan
artefactos materializados por APIs públicas del adapter y preservación/idempotencia
de instrucciones de usuario; no hacen grep del código de implementación.

## API y compatibilidad
- Ninguna API exportada nueva ni firma pública cambiada. Se mantiene export default
  de extensión, `instructionActions`, `skillActions` y hooks/comandos existentes.
- Nuevo comando Pi `/edu-refresh`, sin conflicto con prompt `/edu-brief`.
- Pi instalado: `@earendil-works/pi-coding-agent` 1.2.0; carga real, registerMcpServer,
  registerCommand, eventos y getSessionId comprobados. Namespace `mcp__edu__edu_*`;
  exposición predeterminada codemode no modificada. mcp.json puede sobrescribir la
  inscripción: revisar `/mcp`; el template no modifica configs del usuario.
- Docs leídos completos: extensions, mcp, skills, prompt-templates, packages, tui,
  settings, configuration, security; ejemplos commands y custom-footer; auditoría
  `audit/learning/07-pi-integration.md` y plan completos antes de cambiar.
- Los tests del loader requieren Pi instalado; `PI_PROTOCOL_ROOT` selecciona la raíz
  de la instalación local o del futuro runner CI. Sin esa variable resuelven el paquete vía Node, sin rutas
  Cloudroom hardcoded. Pi TUI se resuelve con TypeScript desde la instalación Pi,
  admitiendo dependencias anidadas o hoisted, sin asumir `../pi-tui`.

## Límites / pendientes
- El principal debe generar plugins, sin `build:plugins` en esta unidad.
- Unidad 5: atribución pi del hook señalada arriba; integración final requiere probar
  apertura/cierre del ID contra su implementación final, no se atribuye como ya validada.
- Snapshot se reanexa al system prompt de cada run (Pi reconstruye el prompt base),
  pero no vuelve a construir el brief. Caché vive en el runtime de la extensión:
  reload/reinicio la reinicia. No se abre/cierra memoria automáticamente al shutdown.
- El template solicita ahora bloqueo MCP al cwd del host con
  `EDU_LOCK_WORKSPACE=1`, neutralizando `EDU_PROJECT`. El principal implementa su
  enforcement en server/stdio; esta unidad prueba el registro real de la config,
  no atribuye al loader prueba de rechazo de `edu_project_use`. Servidores viejos
  o overrides mcp.json requieren verificar scope; no hay promesa de sincronización.
- Linux probado; Windows no ejecutable desde este host. El fixture Windows usa
  `.cmd` que llama al Node instalado con script `.cjs` y rutas entre comillas;
  las aserciones MCP exigen `cmd /c EDU_BIN mcp`, sin skip Windows. En Unix se
  conserva script ejecutable. `common.protocol.test.ts` no depende de instalación Pi.
- Typecheck principal no incluye templates Pi; el nuevo test compila el template
  específicamente contra tipos de Pi 1.2.0 instalado y carga sus handlers reales.
- No se probaron elección de herramientas por LLM ni eficiencia LLM. Sí se probó
  el brief real con la asignación de identidad actual y config identity.name fixture;
  perfiles custom arbitrariamente extensos pueden desplazar el protocolo (unidad 2).
- Typecheck global concurrente pendiente de corregir por unidad 7 (run.ts:355).
- Por petición explícita no se usaron edu_brief/remember/session_close sobre cerebro
  real. Apertura/ID ejercitados aquí son contrato stdin del fixture, no memoria real.

## Preparación del gate de portabilidad CI (sin ejecutar GitHub CI)
Según aclaración del principal, Pi público 1.2.0 se instaló en
`/tmp/edu-v2-pi-api` y sus 7 tests pasaron **localmente en Linux**.
No se ejecutó GitHub CI; Windows y macOS siguen pendientes. Mi confirmación previa
en chat de «CI Linux» fue incorrecta.

Cambios solo en tests propios y este informe; ningún build/plugin generado.
Comando tras quitar hardcodes y añadir wrapper Windows:
`PI_PROTOCOL_ROOT=/usr/local/lib/cloudroom/pi/node_modules/@earendil-works/pi-coding-agent node_modules/.bin/vitest run src/adapters/pi-protocol.test.ts src/adapters/common.protocol.test.ts src/identity/templates.test.ts --maxWorkers=1`
Resultado: exit 0, **3 archivos / 21 tests pasan**, incluyendo resolución real de tipos
Pi TUI desde Pi. La ruta del comando identifica únicamente la instalación disponible
para esta ejecución; no queda fijada en el código de test. Ejecución Windows queda
pendiente del runner CI; no se atribuye como validada desde Linux.

## Integración de seguridad: workspace Pi bloqueado
Solo template, protocolo propio, test loader e informe; sin tocar server/stdio,
common.ts ni plugins generados. Registro MCP inicial y cada cambio de ctx.cwd llevan
`env: { EDU_PROJECT: "", EDU_LOCK_WORKSPACE: "1" }`. El protocolo pide verificar scope,
cambiar host cwd/reiniciar para cambiar proyecto, no usar project_use para divergir
del brief cacheado. Generic MCP puede conservar switching; sin prometer sincronización.

Reproducción antes del cambio:
`PI_PROTOCOL_ROOT=/tmp/edu-v2-pi-api/node_modules/@earendil-works/pi-coding-agent node_modules/.bin/vitest run src/adapters/pi-protocol.test.ts --maxWorkers=1`
exit 1, **2 fallos / 6 pasan**: config MCP carecía del entorno de bloqueo.

Verificación final local Linux:
`PI_PROTOCOL_ROOT=/tmp/edu-v2-pi-api/node_modules/@earendil-works/pi-coding-agent node_modules/.bin/vitest run src/adapters/pi-protocol.test.ts src/adapters/common.protocol.test.ts src/identity/templates.test.ts --maxWorkers=1`
exit 0, **3 archivos / 22 tests pasan**. Incluye tipos del Pi público instalado,
registro de env con loader real, persistencia del bloqueo al cambiar A→B e
EDU_PROJECT heredado A frente a ctx.cwd B. El mock de proceso verifica brief B;
el rechazo efectivo del switch requiere la integración server del principal.
`git diff --check -- templates/pi/edu.ts templates/EDU.md templates/skills/edu-brain/SKILL.md src/adapters/pi-protocol.test.ts`: exit 0.

## Cierre con observaciones opcionales (coordinación unidad 5)
Actualizados template Pi, core/extended EDU.md, skills edu-brain/brief y comandos
brief; skills y comandos crew/review restringen autodelegación a trabajo independiente
/revisión sustancial (o petición explícita), no cada tarea trivial ni resumen final.
El modelo actual puede enviar `lessons?: [{title, body, evidence?: [ids]}]`, max 3,
solo si el schema instalado lo admite: observaciones accionables de lo que funcionó
o errores corregidos, candidate/inferred, no verified ni proof. Sin cuota obligatoria,
secretos, ids inventados, duplicar notas ya guardadas ni segunda reflexión LLM.
El core mantiene ID/recall/capabilities antes de la explicación opcional; el test de
brief real conserva esos elementos bajo la asignación actual de 160 tokens.

Reproducción del contrato faltante antes de editar templates:
`PI_PROTOCOL_ROOT=/tmp/edu-v2-pi-api/node_modules/@earendil-works/pi-coding-agent node_modules/.bin/vitest run src/adapters/pi-protocol.test.ts src/adapters/common.protocol.test.ts --maxWorkers=1`
exit 1, 2 fallos / 11 pasan (instrucciones de lessons ausentes en prompt y skills emitidos).

Verificación final local Linux:
`PI_PROTOCOL_ROOT=/tmp/edu-v2-pi-api/node_modules/@earendil-works/pi-coding-agent node_modules/.bin/vitest run src/adapters/pi-protocol.test.ts src/adapters/common.protocol.test.ts src/identity/templates.test.ts --maxWorkers=1`
exit 0, **3 archivos / 23 tests pasan**. Loader y tipos Pi reales; contrato en prompt
emitido y skills materializados, único subprocess hook sin dispatch de reflexión,
core <400 y contrato total <2000 sin subir límites. No se ejecutó un LLM ni se probó
la nueva persistencia server de unidad 5; no se afirma que instrucciones garanticen
cumplimiento del modelo. API runtime Pi sin cambios; campo lessons es integración
opcional server pendiente de validar por principal. Windows/macOS/CI siguen pendientes.
`git diff --check -- templates/pi/edu.ts templates/EDU.md templates/skills templates/commands src/adapters/pi-protocol.test.ts src/adapters/common.protocol.test.ts`: exit 0.
Sin tocar common.ts, server/stdio, dist ni plugins generados.

### Replacement exacto recomendado para main en common.ts (NO aplicado)
Reemplazar solo este fragmento del literal de protocolo, preservando la firma con
brainRoot y todo el trabajo de unidad 9:

Old (texto de fuente, backticks escapados):
```text
5. Close with \`edu_session_close\` using that exact id and a summary; report what remains open. Never invent an id or claim closure after failure.
```
New:
```text
5. Close with \`edu_session_close\` using that exact id and a summary; report what remains open. If the installed schema supports it, optional \`lessons: [{title, body, evidence?: [ids]}]\` (max 3) records actionable observations by the current model as candidate/inferred, not proof. Omit if none; no secrets, invented evidence, duplicate notes or second reflection LLM. Never invent an id or claim closure after failure. Crew is for independent work or review of substantial changes (or an explicit request), not every trivial task.
```
El fragmento es único en la versión leída; main debe comprobar que aún coincide
antes de aplicarlo. No autoriza a sustituir la función entera ni revertir brainRoot.

## Alias de tmpdir macOS (solo fixture)
`pi-protocol.test.ts` canonicaliza con `realpath` la raíz de `mkdtemp` antes de
crear A/B, evitando comparar `/var/folders` con el cwd físico `/private/var/folders`.
Se mantiene comprobación explícita de que ctx.cwd B difiere del process.cwd físico,
y que el subprocess recibe B. Producción y wrapper Windows sin cambios.
`PI_PROTOCOL_ROOT=/tmp/edu-v2-pi-api/node_modules/@earendil-works/pi-coding-agent node_modules/.bin/vitest run src/adapters/pi-protocol.test.ts --maxWorkers=1`:
exit 0, **9 tests pasan localmente en Linux**.
`git diff --check -- src/adapters/pi-protocol.test.ts`: exit 0.
Sin instalaciones; ejecución macOS/Windows y GitHub CI siguen pendientes.
