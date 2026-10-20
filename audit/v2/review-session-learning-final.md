# Re-review final — session-learning y perfil MCP

**P1: ninguno nuevo reproducido. P2 originales: ambos FIX/PASS. P2 nuevo: compatibilidad de reintentos con sufijo anterior, pendiente. Perfil MCP: PASS en los casos probados.**

Snapshot `/tmp/edu-review-session-final-s3mk06kn`, **2026-10-20 02:52:46 UTC**, HEAD `d5c71fa5f86764d4a56928c637e05e310bae9444`. Los archivos originales listados seguían coincidiendo con el checkout al terminar. No se modificó producción ni se amplió la revisión del core.

## Estado de los P2 anteriores

- **Tag ajeno — FIX/PASS:** el mismo `edu_remember` con tag calculado deja intacta la nota ajena. El cierre crea la observación correcta con origin/vínculo de sesión y cuerpo esperado; retry no duplica. Los checks adicionales en `isRecordOf` impiden el reemplazo que se había demostrado.
- **Journal estructuralmente corrupto — FIX/PASS:** `{"hash":"not-the-payload-hash","done":false,"ids":[123]}` ahora devuelve error de corrupción, conserva el archivo y deja la sesión abierta sin notas. JSON sintácticamente roto también sigue rechazándose.
- **Control negativo real:** se copiaron los mismos probes de aceptación al snapshot anterior `/tmp/edu-review-session-learning-6zefcd52`; ambos fallan allí. No se concluye el cierre sólo por inspección del código o informes del propietario.

## P2 nuevo — El cambio de sufijo duplica lecciones ya registradas

Ubicación de esta captura: `src/mcp/session-learning.ts:51,94–95`.

`isRecordOf` sólo acepta el título original o el nuevo título con sufijo de 16 caracteres. Las notas auténticas que el escritor anterior guardó con sufijo de 6 caracteres no pasan ese check, aunque tag, cuerpo, origin y vínculo de sesión sean correctos.

Repro con el **escritor anterior real**, importado del snapshot previo, sobre fixture nuevo:

1. Crear una lección ajena `Shared title` que ocupa el nombre base.
2. Cerrar una sesión con una observación `Shared title`. El escritor anterior guarda `Shared title · c3db61`; journal completo; dos notas totales.
3. Repetir el mismo cierre con el escritor nuevo. Crea `Shared title · b7ceb08992c3db61`; quedan tres notas totales, dos observaciones idénticas con el mismo origin de sesión. Devuelve `lessons recorded` aunque `closedNow:false`.
4. Un retry posterior del formato nuevo queda estable en tres: el fallo se limita a reconocer registros anteriores, no a todos los reintentos.

Resultado: regresión de idempotencia para memoria creada antes del fix que necesitó sufijo; no pérdida de cuerpo ni promoción verificada. Los tests de títulos repetidos crean y repiten todo con el escritor nuevo, por eso no detectan esta transición. Recomendación: reconocer el formato anterior bajo las mismas comprobaciones de procedencia/contenido, sin confiar sólo en el tag. No implementado en esta revisión.

## Perfil MCP: comprobación acotada

- Perfil omitido y `full` explícito: **18 herramientas, mismos nombres**. `memory`: **12**, exactamente seis de crew/orchestrate ausentes.
- Se llamó directamente a cada nombre omitido por el cliente MCP, pasando además `profile:'full'`/`toolProfile:'full'`: **seis respuestas unknown/not-found**, ninguna ejecución del backend. No es sólo filtrado de `listTools`.
- El helper `register` omite esas herramientas antes de `server.registerTool`; los registros actuales pasan por ese helper. Un backend crew simulado que lanza error si se alcanza registró **cero llamadas**, impidiendo que un fallo del probe pudiera lanzar una CLI real.
- Perfiles runtime `typo`, cadena vacía, `MEMORY`, `memory `, false, 0, array y objeto son rechazados antes de inicialización; las variantes string inválidas también fallan en `createStdioServer`. Perfil ausente conserva full por compatibilidad.
- `EDU_MCP_PROFILE=memory`: capabilities de stdio declara `toolProfile:'memory'` y se registran 12. Argumentos del caller intentando cambiarlo a full no afectan el resultado. Opción explícita del host `toolProfile:'full'` prevalece sobre ese env: declara full y registra 18.
- `host-workspace.test.ts` vuelve a pasar: no se permite sustituir el workspace fijado por el host mediante roots/override/project_use.

## Comandos y resultados

En `/tmp/edu-review-session-final-s3mk06kn`:

```sh
node node_modules/vitest/vitest.mjs run src/mcp/session-learning.final-review.test.ts src/mcp/profile.review.test.ts src/mcp/session-learning.test.ts src/mcp/profile.test.ts src/mcp/host-workspace.test.ts --maxWorkers=1 --no-cache --reporter=verbose --silent=false
```

**Exit 0, 23/23**, 5 archivos, 2.36 s. Incluye probes independientes de ambos fixes, concurrencia de títulos, fallo parcial, autoridad y perfil, más tests originales.

```sh
node node_modules/vitest/vitest.mjs run src/mcp/session-learning.compat-review.test.ts --maxWorkers=1 --no-cache --reporter=verbose --silent=false
```

**Exit 0, 1/1**, 327 ms: verde significa **reproducción del P2 nuevo** (comprueba la duplicación observada), no aceptación.

En el snapshot anterior, copiando el probe de aceptación sin cambiar aserciones:

```sh
node node_modules/vitest/vitest.mjs run src/mcp/session-learning.final-review.test.ts --testNamePattern='corruption|caller-controlled' --maxWorkers=1 --no-cache --reporter=verbose --silent=false
```

**Exit 1, 2 fallos / 4 omitidos**, 599 ms: confirma ambos defectos anteriores como control negativo.

## Hashes SHA-256

- `src/mcp/session-learning.ts`: `094d45895b23a5d3eced072bad9cef43157d8b0a3316922adcae322dcba68117`
- `src/mcp/session-learning.test.ts`: `b96eee221faf1c3fba0d8c28ed197e6896163b1a84fade4d2e79f488e15024db`
- `src/mcp/server.ts`: `9c9cbc9c780fa43cea7eb2c33cc6e282cc93c029ec08a5592051036490cae7c1`
- `src/mcp/stdio.ts`: `bf0300dd880734db7a234e2d7f12a403d4fbe89ec6ccf05dca0db2834fae1bcd`
- `src/mcp/profile.test.ts`: `cff343e8a59670e6c6a970924d0fa8eacb85edfff49680c71dc2e54ac2432f5e`
- `src/mcp/host-workspace.test.ts`: `7936caaa1b40175172cef6d04d2e8cd8ffee01dd549943216804d69fe9fef716`
- `src/mcp/session-learning.final-review.test.ts`: `590343958b6f9744fa1b8557dd37889878bd876f59b2f6b2b99c4469b7019d8b`
- `src/mcp/profile.review.test.ts`: `cf6d5e8b9ce06486ed85d1961fc24d5bb96e0929691617a3be8abecb120e93ee`
- `src/mcp/session-learning.compat-review.test.ts`: `cb97c71ecee539b3edcfa16637e2f66fa9d7c72ca44cb231164b623ab59a57fa`

Escritor anterior usado por el probe de compatibilidad: `/tmp/edu-review-session-learning-6zefcd52/src/mcp/session-learning.ts`, SHA-256 `f2e79984841a6755ded0c10f4ab6ff20f0ca14da992155476af62491138afed0`.

## Límites

Sólo nueva captura, fixtures temporales y dependencias existentes; sin agentes, modelos externos, credenciales, commits ni cambios de producción. Único archivo añadido al checkout: este informe. Probes conservados únicamente en los snapshots de `/tmp`.

No hay aprobación global: sin suite completa/typecheck, crashes/multiproceso exhaustivos ni nuevas garantías sobre el core. El perfil reduce herramientas registradas; no convierte la memoria en read-only ni constituye una frontera frente a quien controla las opciones del host. Las pruebas no demuestran aprendizaje autónomo, eficiencia ni aplicación correcta por un LLM. El P2 de compatibilidad permanece abierto en los hashes citados; cambios posteriores requieren revalidación.
