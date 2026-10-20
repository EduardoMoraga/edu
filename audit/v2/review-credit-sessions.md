# Review independiente — crédito y sesiones

**Bloquea aprobación del snapshot: 3 hallazgos P1 reproducidos.** Sin implementación ni modificaciones de código/tests del checkout. Único archivo añadido al checkout: este informe solicitado. Probes y cerebros sintéticos en `/tmp`; sin agentes, modelos, credenciales ni cerebro real.

## Snapshot fijo

Comparación contra HEAD `ab405fac6d5ceb74fc9694896809477dc5a5049e`. Captura: **2026-10-20 01:56:38 UTC**, directorio `/tmp/edu-review-credit-4srrfinp`; versiones HEAD en `base/`, copia revisada en `src/`. Todas las líneas siguientes pertenecen a esa copia, no al checkout móvil.

SHA-256:

- `src/brain/brain.ts`: `e97931f32d3b7d5f1b9596debd5ed9500b649f5b9797e15c10930f8c5ae9dcb9`
- `src/brain/learning.ts`: `59466a0de6997db39e129f0a6f0dedb2daef4f6219eee89f2824e31c61633d53`
- `src/core/contracts.ts`: `0215e6567fe4b84f0269b4b5d3e1d6ff45da50ca6f8f4f7845579d39a45629c1`
- `src/mcp/server.ts`: `f45ee2a67505477ea21f36c2dbe4848d7e42132117fc4f345512d0ebb67b0a5e`
- `src/cli/hooks.ts`: `bd4ee280eac039e81ee04a871bb63b5a178346d7a3a3df216be244a3b17bcb47`

## P1 — El aislamiento de feedback puede sobrescribir una nota local distinta

Ubicación: `src/brain/brain.ts:99–101`, llamada en `:218` (también usada en `:107`).

`isolated()` calcula la ruta local por `notePath(meta)` y `persist()` la reemplaza sin comprobar la identidad de la nota existente. Dos notas válidas con IDs distintos y el mismo título pueden coexistir en global/proyecto, especialmente memoria importada/editada. El destino calculado no necesariamente es libre.

Reproducción: crear proyecto con `L-shared-title`, título `Shared title`, cuerpo `PROJECT UNIQUE CONTENT`; guardar en global una nota importada `L-imported-uuid`, mismo título, cuerpo `GLOBAL OTHER CONTENT`, ruta `brain/3-transitive/imported.md`. Ejecutar feedback sobre `L-imported-uuid` mediante `openBrain([project, global])`. Resultado comprobado: el archivo local cambia, pierde `PROJECT UNIQUE CONTENT` y `read('L-shared-title')` devuelve undefined. Es pérdida permanente de otra nota, no una mera sombra por ID.

Falta cobertura: el test existente de aislamiento usa títulos/rutas sin colisiones. Debe verificar preservación de una nota local con distinto ID que ocupa la ruta destino.

## P1 — Feedback concurrente pierde eventos y evidencia verificada

Ubicación: `src/brain/brain.ts:212–218`; ledger nuevo en `src/brain/learning.ts:41–55`.

La secuencia leer → deduplicar/calcular → reemplazar archivo carece de exclusión o comparación de versión. `atomicWrite` evita archivos parciales, pero no preserva actualizaciones concurrentes.

Reproducción: una lección nueva y dos llamadas concurrentes `feedback(id, true, {eventId: 'run-a'/'run-b', verified: true})`. Una barrera en las primeras dos escrituras temporales garantiza que ambas hayan leído el estado anterior; no cambia contenido, renombrados ni resultados del almacenamiento real. Ambas llamadas resuelven. Resultado persistido: `wins: 1`, `verifiedWins: 1`, `events: ['v:run-b']`, en lugar de dos confirmaciones y dos eventos. Se pierde evidencia y el registro que debería permitir deduplicar esos resultados. El fallo de read-modify-write existía para contadores; el nuevo ledger tampoco satisface su garantía bajo concurrencia.

Falta cobertura: los tests nuevos de deduplicación y 230 eventos hacen feedback secuencial. Necesitan escritores concurrentes y conservación de todos los eventos/contadores; la unidad de exclusión debe abarcar lectura, validación y persistencia.

## P1 — Cierres MCP concurrentes sobrescriben un resumen confirmado

Ubicación: `src/mcp/server.ts:197–209`, apoyado por `src/brain/brain.ts:111–135,221`.

La comprobación de episodio cerrado y la escritura no son una transición atómica. Dos cierres distintos pueden leer la sesión abierta y ambos pasar también la validación de Brain antes de escribir. La protección nueva sólo cubre reintentos secuenciales.

Reproducción por cliente/servidor MCP reales sobre `InMemoryTransport`: abrir una sesión; llamar simultáneamente `edu_session_close` con el mismo ID y resúmenes `SUMMARY ONE`/`SUMMARY TWO`. Misma barrera de escrituras temporales. Ambas respuestas son `Closed …` sin `isError`; sólo queda `SUMMARY TWO`. El primer cierre confirmado pierde su contenido, contrario a la inmutabilidad y al rechazo de un segundo resumen diferente. La carrera subyacente es previa al diff; sigue bloqueando la garantía de cierre incorporada aquí.

Falta cobertura: `server.test.ts` prueba reintentos/discordancia después de terminar el primer cierre; no dos cierres simultáneos del mismo ID. La exclusión debe cubrir comprobar y cerrar, no sólo abrir sesiones.

## Verificación y límites

Directorio de ejecución: `/tmp/edu-review-credit-4srrfinp` (copia de src/config/package, dependencias existentes enlazadas, templates copiados para tests).

- `node node_modules/vitest/vitest.mjs run src/review-credit.probe.test.ts --maxWorkers=1 --no-cache --reporter=verbose --silent=false` → **exit 0, 3/3 reproducciones pasan**. Verde confirma los defectos observados, no aceptación del producto. Probe conservado en ese snapshot temporal; no se añadieron tests al proyecto.
- `node node_modules/vitest/vitest.mjs run src/brain/credit.test.ts src/brain/learning.test.ts src/mcp/server.test.ts src/cli/integrations.test.ts --maxWorkers=1 --no-cache` → **exit 0, 54/54 pruebas existentes pasan**, 4 archivos, 3.45s.
- Las barreras fuerzan un interleaving válido del almacenamiento real; no simulan éxito ni fuerzan datos corruptos. No se ejecutaron procesos LLM ni escrituras a memoria real.
- No se demostró una vía nueva de self-reward verificado por MCP: el test existente que intenta inyectar `verified` pasa. Esto no certifica todos los callers de Brain, ni el orquestador, fuera de alcance.
- Hooks: revisado el snapshot y ejecutados sus tests existentes, incluidos lock vivo/stale y concurrencia idéntica. No se verificó exhaustivamente recuperación de locks entre procesos, PID reuse, crashes o todas las intercalaciones de reclamación. No se elevan hipótesis de locks a hallazgos reproducidos.
- Al comprobar hashes al final, brain/learning/contracts seguían iguales; MCP y hooks habían cambiado. El delta observado añadía lock a **apertura** MCP y atribución Pi en hooks. **No se certifica ninguna revisión posterior**; estos hallazgos y números de línea están fijados al snapshot indicado. El principal debe comprobar si correcciones posteriores los resuelven.
- Sin suite global, typecheck, benchmark ni evaluación de eficiencia LLM. El snapshot/probe en `/tmp` es temporal: para conservar la reproducción, copiarlo fuera de `/tmp` antes de limpiar el entorno.
