# Unidad 3 — retrieval operacional

Implementación terminada en el checkout compartido, sin commits, instalaciones, modelos, cambios de contratos, brain.ts, pack, versiones ni artefactos generados. Leídos completos `docs/EDU-2.0-PLAN.md` y `audit/learning/02-retrieval.md`.

## Archivos y comportamiento

- `src/brain/search.ts`: excluye por defecto retired/reverted/superseded, canonical proposed y notas con superseded_by. Conserva notas legacy sin estado. ID, legacy ID y alias exactos recuperan también historia; no se amplía esa excepción a títulos/prefijos ambiguos.
- `src/brain/resolve.ts`: extrae la normalización existente de wikilinks para compartirla con recall, sin cambiar la resolución de read.
- `src/brain/search.operational.test.ts`: 16 pruebas conductuales nuevas, fixtures Note exclusivamente en memoria. Cubren estados, referencias, historia opt-in, ruido, preguntas naturales, ES/EN, pasajes, límites y ausencia de coincidencias inventadas.
- Este informe.

El ranking sigue siendo BM25 con peso aprendido. Normaliza ocho grupos léxicos explícitos: pagos, facturas, duplicados, reintentos, restauración, respaldos, conexiones y despliegue; elimina stopwords ES/EN. Normalizar ambos lados evita multiplicar el peso por cada sinónimo. No usa embeddings, traducción general ni un modelo. Los términos técnicos no incluidos siguen siendo literales; la equivalencia léxica puede introducir falsos positivos y no interpreta negación ni causalidad.

Los hits conservan Note/RecallHit; `why` añade un pasaje literal serializado con JSON, de hasta 480 caracteres originales, después del motivo existente. Esto permite transportarlo por el MCP actual, que imprime why, sin editar contratos/servidor. La ventana prioriza cobertura de términos, puede cortar instrucciones o condiciones y no sustituye leer la nota completa. No modifica el cuerpo ni el estado. Solo calcula pasajes de los resultados seleccionados.

## API exportada y compatibilidad

- `rankNotes(query, notes, now?, limit?, options?: SearchOptions): RecallHit[]`; conserva los cuatro argumentos previos y el tipo de retorno.
- `SearchOptions { includeHistory?: boolean }`: true permite búsqueda léxica general también sobre historia/propuestas; false/omitido aplica exclusión operacional.
- `isOperationalNote(note: Note): boolean`.
- `relevantPassage(body: string, query: string, maxChars = 480): string`: ventana literal acotada, introducción como fallback si no encuentra coincidencias; no resumen.
- `normalizeReference(reference: string): string`: misma normalización de read (corchetes/etiqueta/espacios).
- `tokenize` y `resolveReference` conservan firmas y comportamiento previo.

Cambios intencionales: resultados generales excluyen historia, puntuaciones pueden cambiar por normalización léxica/stopwords y why incorpora texto adicional. Alias exactos que sean stopwords siguen funcionando. No hay promesa de coincidencia semántica general ni de eficiencia LLM.

## Comandos y resultados exactos

1. `room-cli files wait` → exit 0, `Project files are ready in /code/edu.`
2. Antes de implementar: `node node_modules/vitest/vitest.mjs run src/brain/search.operational.test.ts --maxWorkers=1 --no-cache` → exit 1; **9 failed, 2 passed (11)**. Reprodujo filtrado ausente, ruido en pregunta natural, ausencia de equivalencia bilingüe y pasaje omitido. Las aserciones permanecieron; se añadieron cinco casos después.
3. Primera corrección: `node node_modules/vitest/vitest.mjs run src/brain/search.operational.test.ts src/brain/search.ids.test.ts src/brain/resolve.test.ts --maxWorkers=1 --no-cache` → exit 0; **3 archivos, 19 pruebas pasaron**. Tras ampliar cobertura, mismo comando → exit 0; **3 archivos, 24 pruebas pasaron**.
4. Verificación final: `node node_modules/vitest/vitest.mjs run src/brain/search.operational.test.ts src/brain/search.ids.test.ts src/brain/resolve.test.ts src/brain/learning.test.ts src/brain/brain.test.ts --maxWorkers=1 --no-cache` → exit 0; **5 archivos, 40 pruebas pasaron**, duración 1.62s.
5. `node node_modules/typescript/bin/tsc --noEmit` → exit 2 en el estado compartido observado: `src/context/pack.ts(129,30)` y `(131,16)` TS2345 (`string | undefined` no asignable a `string`); `src/reflect/consolidate.ts(106,94)` TS18048 (`session.meta.updated` posiblemente undefined). Ningún diagnóstico en los archivos de esta unidad. No se tocaron archivos ajenos.
6. `git diff --check -- src/brain/search.ts src/brain/resolve.ts src/brain/search.operational.test.ts` → exit 0; diff de implementación revisado.

## Pendientes para principal

- Solicito al propietario de Brain integrar `includeHistory?: boolean` en opciones de `Brain.recall` y pasar ese objeto como quinto argumento de `rankNotes`. Actualmente la opción está disponible directamente en search; la búsqueda por ID/alias de historia ya funciona a través de la llamada existente. Si se quiere exposición MCP/CLI de historia general, corresponde a sus propietarios.
- Revisar los diagnósticos globales de typecheck anteriores con sus propietarios; pueden variar mientras avanza el checkout compartido.
- Integración de pasajes en pack pertenece a unidad 2; puede consumir `relevantPassage`. No se modifica pack aquí.
- No se ejecutó suite global ni benchmark/modelo. Estas pruebas no demuestran aplicación autónoma, menor coste ni menos explicaciones humanas. La auditoría anterior contiene aserciones que reproducían defectos y no debe reinterpretarse como suite de aceptación actual.
- No había herramientas `edu_brief`/`edu_session_close` expuestas; no se abrió sesión ni se escribió memoria real. Cierre de esta unidad documentado aquí.

## Corrección tras review Claude — 2026-10-20

Leído `audit/v2/review-retrieval-reflection.md`. Corregidos R5/R8 dentro de `src/brain/search.ts`; nuevo `src/brain/search.performance.test.ts`. En esta corrección no se tocó resolve, pack, Brain ni contratos. Los 37 s de buildContext son medición de la revisión, no una medición repetida aquí.

- Consultas ordinarias `alpha|beta`, `alpha | beta`, `| beta`, texto con un wikilink más términos y wikilinks incompletos ya no se recortan. Sólo una consulta completa `[[referencia|etiqueta]]` pasa por normalización de referencia. Read conserva su normalización anterior.
- `relevantPassage` recorre palabras una sola vez y conserva offsets originales. Una ventana deslizante añade/retira cada coincidencia como máximo una vez; desaparece la tokenización anidada por ventana. Complejidad lineal en caracteres del cuerpo + consulta, memoria proporcional a coincidencias. No se trunca la exploración: todavía encuentra reglas al final de notas largas.
- API real para **main2**: `rankNotes(query, notes, now, limit, { includePassages: false })`. La nueva propiedad opcional de `SearchOptions` sólo evita extracción/formato de pasajes, preservando notas, ranking y scores. Valor omitido sigue incluyendo pasajes; no hay otros flags nuevos. Main2 integra esta llamada en pack y puede usar `relevantPassage` con su vocabulario bilingüe para la selección final.

Reproducción antes del cambio:

- `node node_modules/vitest/vitest.mjs run src/brain/search.performance.test.ts --testNamePattern='pipe-separated|omit passages' --maxWorkers=1 --no-cache` → exit 1, **2 fallos**, 1 omitido: consulta cortada y opción de omisión inexistente.
- `node node_modules/vitest/vitest.mjs run src/brain/search.performance.test.ts --testNamePattern='bounded default' --maxWorkers=1 --no-cache --reporter=verbose --silent=false` → exit 0, **1 pasa**, 3 omitidos: 10 notas × 59.439 caracteres, ranking con pasajes **715,23 ms**.

Verificación final:

- `node node_modules/vitest/vitest.mjs run src/brain/search.performance.test.ts src/brain/search.operational.test.ts src/brain/search.ids.test.ts src/brain/resolve.test.ts src/brain/learning.test.ts --maxWorkers=1 --no-cache --reporter=verbose --silent=false` → exit 0, **32 pruebas / 5 archivos pasan**. Corpus 400 × 59.439 caracteres: ranking sin pasajes **489,24 ms**; tres extracciones (cuerpo completo, cola y ventana de 12.000 caracteres con término ausente) **11,42 ms**. Diez notas con pasajes por defecto: **55,82 ms**. Son observaciones del fixture, no garantías de tiempo ni eficiencia LLM.
- Guard de regresión amplio: ranking grande + pasajes < **20 segundos**, timeout del caso 30 segundos; sin umbral frágil de 100 ms. También comprueba resultados, ausencia/presencia de pasajes, contenido final y equivalencia de scores/notas.
- La primera ejecución posterior al cambio detectó que el fixture compartía el token `L` en ambos títulos y por eso coincidía legítimamente con `L-a`. Se corrigieron los títulos del fixture a `Memo`; se mantuvo la aserción exacta de resultados, sin debilitarla.
- `node node_modules/typescript/bin/tsc --noEmit` → exit 0 en el estado compartido observado.
- `git diff --check -- src/brain/search.ts src/brain/search.performance.test.ts` → exit 0; cambios revisados.

Pendiente exclusivamente de integración: main2 debe pedir `includePassages: false` al ordenar todos los candidatos de pack. No se midió buildContext ni se modificó su implementación aquí.
