# Re-review final (solo lectura): retrieval / context / reflect

Revisor: Sonnet 5.5 (Claude). Los autores de estos módulos no se autovalidan; esta es una verificación independiente de mis 9 hallazgos previos. Sin ediciones de código de producción ni agentes. Snapshot del árbol compartido en el momento de la revisión (sha256 completos abajo, prefijo de 16 hex).

## Archivos y hashes
```
e6cfe982b3c7b4eb…  src/brain/search.ts
1842ff6ed366b876…  src/brain/resolve.ts
c6d4063dfcb04f81…  src/context/pack.ts
0e039acf4bb8fbda…  src/context/tokens.ts
33161811cf7ef91d…  src/reflect/consolidate.ts
65db70b7f3e784c9…  src/reflect/persistence.ts
739cc4a1dccef249…  src/reflect/reflect.ts
3b826931a86b0539…  src/reflect/proposals.ts
```
(sha256 completos: `sha256sum src/brain/search.ts src/brain/resolve.ts src/context/{pack,tokens}.ts src/reflect/{consolidate,persistence,reflect,proposals}.ts`.)

## Comandos
- Repros originales R1–R8 + nuevos F1–F3 (fuera del repo, `/tmp/edu-review`, fuente en `audit/v2/review-retrieval-reflection.repro.test.ts.txt` para R1–R8): `npx vitest run --config /tmp/edu-review/vitest.config.mjs --maxWorkers=1 --disableConsoleIntercept`.
- Suites del repo: `npx vitest run src/reflect src/context src/brain/search.operational.test.ts src/brain/search.ids.test.ts src/brain/resolve.test.ts --maxWorkers=1` → 11 archivos, 84 passed.

## Veredicto por hallazgo
| # | Hallazgo previo | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Cola bloqueada por 50 entradas atascadas | **FIX (parcial)** | R1 repetido: 1 sola ejecución sigue `lessons:0, acknowledged:0, skipped:50`. Ahora hay cursor (`.reflection-queue-cursor.json`) que avanza **1 entrada** por ejecución; F1: con 130 atascadas + 1 válida hacen falta **82 ejecuciones** de `consolidatePending` para llegar a la válida. Ya no es inanición permanente, pero la latencia es O(atascadas) ejecuciones y las inválidas nunca se ponen en cuarentena ni se cuentan como "inválidas" (solo `skipped`). Sugerencia: avanzar el cursor por la ventana completa inspeccionada (o saltar inválidas al ordenar) y mover/etiquetar las irrecuperables. |
| 2 | Lock obsoleto permanente | **PASS** | R2: lock con pid muerto → `busy:false`, se recupera. F2: lock con pid vivo no se roba (`busy:true`); contenido basura → no se roba (fail-closed; el lock se instala por `link` atómico, así que un crash no deja un fichero a medio escribir). Limitaciones aceptables y documentables: pid reutilizado por otro proceso vivo o lock de otro host nunca se recuperan automáticamente. |
| 3 | Colisión de identidad por `\n` final/CRLF | **PASS** | R3: segunda ejecución con el mismo cuerpo `"…\n"` ahora `ok:1 ok:1` (cuerpo canonicalizado). |
| 4a | `report.feedback` listaba ids no aplicados | **PASS** | F3: `feedback:[]`, `advisoryFeedback:["L-old-proven"]`; uso de la nota sigue `undefined`. |
| 4b | Canónicas reportadas sin crearse | **PASS** | Solo se reportan las `created` (`result.created`). |
| 4c | `evidence: []` enlazada a todos los episodios | **PASS** | F3: lección sin cita → `links: []`, tag `uncited`. |
| 4d | Propuestas canónicas para toda lección `proven` histórica | **PASS** | F3: con una lección proven histórica suministrada, 0 canónicas creadas. |
| 5 | Rendimiento de pasajes en `pack` | **PASS** | `pack` usa `includePassages:false`; R8 (400 lecciones de 57 KB): 37 s → **559 ms**. |
| 6 | Consulta cortada en `\|` | **PASS** | R5: `'alpha \| beta'` → `[L-a, L-b]`; `'\| beta'` → `[L-b]`. |
| 7 | Pasaje del pack sin sinónimos | **PASS** | R7: ahora muestra "…Nunca reintentar un pago sin clave de idempotencia." para la consulta `retry payment`. |
| 8 | Run summaries grandes sin contarse | **PASS** | `omitted.runLogFiles` presente en el informe (F3). No probé el contador con un fichero >256 KB real. |
| 9 | `superseded_by` en pack sin consulta | **No re-verificado** | Era un hueco de código no reproducido; fuera del alcance de los repros. |
| — | Presupuesto de contexto / `truncateToTokens` | **PASS** | R6 sin excesos (9 presupuestos; 5 textos × 5 límites). |

## Resumen
PASS en 8/9; **FIX pendiente: #1** (latencia lineal en el número de entradas atascadas y sin cuarentena). #9 sin re-verificar. No afirmo mejora de eficiencia de agentes; solo corrección de los defectos listados. Limitación: snapshot de un árbol compartido en movimiento; los hashes identifican lo revisado.

## Actualización: re-verificación de residuales (READONLY), tras fijar atomicidad core de Brain
Hashes (16 hex): consolidate.ts `a16b8582bdba48b1` (cambió), reflect.ts `739cc4a1dccef249`, pack.ts `c6d4063dfcb04f81`, search.ts `e6cfe982b3c7b4eb`. Repros: `/tmp/edu-review/g.test.ts` (G1–G3) y R1–R8/F1–F3 de nuevo.
- **#1 cola — PASS.** G1: 130 entradas atascadas, ventana `maxEntries:20` → la válida se procesa en **7 ejecuciones** (antes 82). F1 (ventana 50): 3 ejecuciones. El cursor avanza por toda la ventana. (R1 de una sola ejecución sigue mostrando `skipped:50`: es esperado, la primera ventana son atascadas.) Pendiente menor sin cambio: las inválidas siguen sin cuarentena, solo `skipped`.
- **#8 run logs >256 KB — PASS.** G2: fichero real `.jsonl` de ~420 KB → `omitted.runLogFiles: 1`; además existe test del propietario (`src/reflect/review-regressions.test.ts:112`).
- **#9 `superseded_by` en pack — PASS.** G3: lección y decisión con `superseded_by` no aparecen en `buildContext` con ni sin consulta; test del propietario en `src/context/review-regressions.test.ts`.
- Suites: `npx vitest run src/reflect src/context src/brain src/mcp --maxWorkers=1` → 32 archivos, 219 passed, 1 skipped.
- Resultado: 9/9 hallazgos originales sin defecto reproducible en este snapshot. **No declaro el conjunto estable**: la revisión es un snapshot de un árbol compartido en movimiento (cambió `consolidate.ts` entre mis dos pasadas) y sin evidencia de eficiencia en LLM; el cierre de estabilidad corresponde al lead tras la suite completa.
