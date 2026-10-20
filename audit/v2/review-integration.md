# Revisión independiente READONLY — integración principal

## Veredicto y alcance
**Sin hallazgos bloqueantes reproducidos en esta integración acotada. No es aprobación de publicación/stable.** Revisé consolidación local, selección de workspace host, supplier de capabilities y frontera terminal API8. Leído completo el plan vigente. No modifiqué producción, tests del repositorio, paquetes, versiones, lockfiles, plugins/dist ni cerebros/config reales. Único archivo nuevo en el repo: este informe. Sin agentes/CLIs LLM anidados, instalaciones, commits ni pushes.

La unidad 7 contiene cambios míos previos: **no los autoapruebo**. Sobre ella sólo contrasté aquí el veto/clasificación API8 y la integración del cierre con consolidación; los 48 tests ejecutados incluyen también regresiones existentes, sin convertirlas en revisión independiente de toda la unidad.

## Evidencia observada
| Frontera | Lectura y comportamiento ejecutado |
|---|---|
| Consolidación antes del throttle | `src/brain/auto-maintain.ts:20–27,59–62`: `consolidatePending` local con límites 20 entradas/50 intervenciones, antes de consultar throttle. Tests reales: segunda cola se consume aunque `ran=false, reason=throttled`; no se inventan lecciones de prosa arbitraria. |
| Cierre real del orquestador | `src/orchestrator/run.ts:371–397`: candidato completo → `diagnosePackage` API8 → emisión terminal/snapshot final → una llamada `autoMaintain`. `consolidation.test.ts` usa Brain real, reabre memoria, observa una candidata sin verifiedWins, cola vacía y **exactamente dos requests Engine fake** (planner/reviewer), no tercero. |
| Incompleto/reintento | Probe independiente: entrada sin paquete permanece pendiente, cero lecciones; después se materializa paquete completo y el siguiente mantenimiento, aún throttled, reconoce una entrada/una candidata. Repetir no duplica la nota. |
| Pin host frente a overrides | `src/mcp/stdio.ts:32–53`: `EDU_LOCK_WORKSPACE=1` ignora tanto selector explícito como `EDU_PROJECT` y no consulta roots. `server.ts:240` bloquea `edu_project_use`. Probe independiente con SDK MCP/InMemoryTransport real: cwd=A, selector/env/roots=B; `edu_remember` escribe sólo en A; B permanece sin lecciones, roots/list no se invoca y cambio manual devuelve error. |
| Pi y fuente de cwd | `templates/pi/edu.ts:153–185`: mismo EDU_BIN para hook/MCP; configuración MCP fijada a ctx.cwd con `EDU_PROJECT=''`, lock=1; hook recibe cwd y session_id reales del contexto. Tests cargan la plantilla con **loader Pi instalado**, cambian A→B, comprueban configuración registrada, caché por sesión/workspace y errores/refresh. No ejecutan proveedor/modelo. |
| Capabilities instaladas | `stdio.ts:38,49` suministra `() => JSON.stringify(getCapabilities())`, sin argumento del llamante. `server.ts:221` consume ese supplier. SDK MCP real devuelve `packageVersion()` aunque se envíe `version=999.0.0`; no afirma entrenamiento ni eficiencia. CLI capabilities/whats-new coinciden y no crean cerebro. |
| Autoridad del feedback | `server.ts:169` llama sólo `brain.feedback(id, helpful)`. Probe independiente envía tres veces campos extra `verified/eventId/evidence`; nunca obtiene verifiedWins ni promoción, aunque haya votos advisory. |
| Terminal API8, no autoaprobación de unidad 7 | Test existente de integración introduce evidencia negativa adicional del reviewer pese a JSON `pass`: API8 veta el éxito, no se llama feedback y sólo se emiten un outcome/un run.end. `classify.test.ts` comprueba evidencia corrupta/incompleta y que un review no borra fallo determinista. Cada fixture v2 contrasta también el paquete final con `classifyPackage`. |

Precisión sobre actualización: existe y pasa el opt-out `autoMaintain(...,{consolidate:false})`, pero el `src/update/migrate.ts` **actual no llama mantenimiento**; actualiza contrato/checkpoints con backups sin recorrer memoria. No describo ese camino como si utilizara hoy el opt-out.

## Pruebas y comandos exactos
1. `room-cli files wait` → `Project files are ready in /code/edu.`
2. Suite focalizada:
   ```sh
   PI_PROTOCOL_ROOT=/usr/local/lib/cloudroom/pi/node_modules/@earendil-works/pi-coding-agent ./node_modules/.bin/vitest run src/brain/auto-consolidate.test.ts src/orchestrator/consolidation.test.ts src/mcp/host-workspace.test.ts src/adapters/pi-protocol.test.ts src/release/capabilities.test.ts src/cli/capabilities.test.ts src/orchestrator/v2.test.ts src/evidence/classify.test.ts --maxWorkers=1 --reporter=verbose
   ```
   **Exit 0; 8 archivos, 48 tests passed; 11.33 s.** Log: `/tmp/edu-review-integration-tests.log`.
3. Dos probes nuevos, escritos fuera del repo y contra módulos reales:
   ```sh
   ./node_modules/.bin/vitest run --config /tmp/edu-review-integration-MUkP96/vitest.config.mjs --maxWorkers=1 --reporter=verbose
   ```
   **Exit 0; 1 archivo, 2 tests passed; 651 ms.** Código: `/tmp/edu-review-integration-MUkP96/review.test.ts`; log `/tmp/edu-review-integration-independent.log`. Todos los cerebros/datos creados por probes se eliminaron en `finally`; se conservan sólo scripts y logs temporales de evidencia.
4. `./node_modules/.bin/tsc --noEmit` → **exit 0**, sin diagnósticos. Log: `/tmp/edu-review-integration-types.log`.

## Límites y gates todavía abiertos
- Pi: loader/config y handlers reales, hook Node fixture. No se verificó aquí reconexión end-to-end de un proceso MCP ya vivo al cambiar cwd ni comportamiento de un proveedor nativo. El pin es política del proceso/configuración, no sandbox del sistema operativo.
- Consolidación: evidencia estructurada produce **candidatas**, no remedios semánticos verificados ni crédito causal. No demuestra reducción de coste, tokens o trabajo humano. No se ensayaron aquí fallos de disco, muerte de proceso o concurrencia multiproceso.
- API8 clasifica en disco: el orquestador materializa candidato y snapshot final (dos escrituras acotadas), pero sólo una consolidación. No se midió eficiencia de ese coste local.
- No corrí suite global, build, generación, instalación/empaquetado ni piloto LLM en esta revisión READONLY. Typecheck y tests focalizados no sustituyen esos gates.
- **Stable sigue bloqueado** por identidad/permisos/visibilidad de targets y aprobación de entrega/publicación, además del piloto nativo controlado y gates globales del plan. No publicar ni tratar RC interno como autorización estable.
