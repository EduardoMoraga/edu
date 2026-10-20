# Unidad 2 — Contexto accionable y presupuestado

Implementación y revisión cerradas en checkout compartido, 2026-10-20 02:03 UTC. Solo cambios propios en `src/context/*` y este informe. Leídos completos plan, auditoría de recuperación y review cruzada; `room-cli files wait` → exit 0. Sin instalaciones, commits, pushes, versiones, generados ni cerebros/configuración reales. Fixtures temporales eliminados. Sin herramientas edu_* expuestas para brief/cierre real.

## Archivos y comportamiento

- `src/context/pack.ts`: decisiones/lecciones con `[[ID]]`, estado y pasaje útil (hasta 120 tokens estimados). Query ordena conjuntamente por relevancia; excluye candidatas irrelevantes y no recorta previamente a últimas ocho. Sin query: máximo 8 decisiones, 8 proven, 3 candidatas. Elegibles excluidas quedan en `deferred`, sin duplicados ni IDs incluidos.
- Integración con unidad 3: ambas llamadas a `rankNotes` pasan `{ includePassages: false }`. Usa `relevantPassage` compartido para que ranking y cuerpo empleen los mismos sinónimos. Comprueba presupuesto global/de sección, metadatos y al menos 12 tokens disponibles antes de evaluar un cuerpo; adapta la ventana al espacio disponible. Episodios tampoco evalúan cuerpos sin margen. `isOperationalNote` filtra todas las notas operativas, también sin query (`superseded_by`, retiradas, etc.); índice sigue contando historia disponible para lectura explícita.
- Identidad ordinaria: hasta 25%, mínimo objetivo 32/máximo 160, limitada siempre por presupuesto total. Essentials hasta 25%, personas primero. Protocolo explícito `edu:core` es atómico: completo si cabe; si no cabe, solo identidad anterior al marcador, sin instrucciones parciales. No aplica corte de 40 líneas a un core marcado. Con query, reglas relevantes preceden compromisos; canónicas no duplican essentials ya incluidos.
- `src/context/tokens.ts`: límites de línea solo si aprovechan ≥90% del presupuesto; resto por grafemas Unicode, sin romper emoji compuesto/combinantes. Estimación global incluye encabezados y separadores.
- `src/context/brief.ts`: read-only por defecto; opt-in `trackUsage: true` conservado. `buildContext` mantiene su default anterior y acepta `trackUsage: false`.
- Tests propios: `pack.test.ts`, `tokens.test.ts`, `session-start.perf.test.ts`, **nuevo `review-regressions.test.ts`**. Snapshot intencional `__snapshots__/session-start-brief.txt`: cuerpos/IDs, límites, orden, pasajes compartidos y ausencia de mutaciones por brief. Incluye ranking actual del checkout compartido.

## API y compatibilidad

Sin nuevas firmas públicas ni dependencias: `buildContext`, `brief`, `estimateTokens`, `truncateToTokens`, `ContextOptions`; exports directos `agentIntro`, `buildBriefContext` conservados. Cambian deliberadamente texto/orden y default de tracking de brief. Imports directos de `src/brain/search.ts`: `rankNotes`, `relevantPassage`, `isOperationalNote`; **requiere la implementación coordinada de `SearchOptions.includePassages` de unidad 3**, ya presente y probada. No se editó search/brain/templates.

## Comandos y resultados exactos

- Reproducción inicial: `node node_modules/vitest/vitest.mjs run src/context/pack.test.ts src/context/tokens.test.ts --maxWorkers=1 --no-cache` → exit 1, **6 fallos / 9 pasan** (cuerpo omitido, ruido, essentials, brief mutante, truncación, Unicode).
- Reproducción de review antes del nuevo arreglo: `node node_modules/vitest/vitest.mjs run src/context/review-regressions.test.ts --maxWorkers=1 --no-cache` → exit 1, **5/5 fallan**. Corpus 400 × 57.000 caracteres: **20.851 ms** de packing frente al límite de 5.000 ms; además fallan pasaje bilingüe, superseded, evaluación de cuerpo excluido y protocolo truncado. No confirmo el valor externo de 37 s: esta ejecución midió 20,85 s.
- Actualización deliberada: `node node_modules/vitest/vitest.mjs run src/context --maxWorkers=1 --no-cache --update` → exit 0, **26/26**, 1 snapshot actualizado.
- Verificación final sin actualizar: `node node_modules/vitest/vitest.mjs run src/context --maxWorkers=1 --no-cache --reporter=verbose` → exit 0, **26/26**, 4 archivos, **2,94 s**. Tests completos del corpus: **454 ms transitive / 361 ms canonical**; ambas aserciones de packing <5.000 ms pasan, con regla visible, presupuesto ≤300 y todos los IDs incluidos/deferred. El fixture aísla disco mediante `brain.list` inyectado; ranking y pasajes son reales. Fixture grande con disco: test existente **337 ms**, conserva umbral de 3 s y una lectura por nota.
- `node node_modules/typescript/bin/tsc --noEmit` → **exit 0**. Los errores previos de reflexión ya no aparecen en el checkout compartido; no los corregí yo.
- `git diff --check -- src/context` → exit 0. Diff revisado; no se relajaron aserciones de seguridad ni rendimiento.

## Límites y pendientes al principal

Sin bloqueos propios ni solicitud de editar archivos ajenos. Principal: mantener juntos contexto y API de búsqueda de unidad 3; ejecutar gates globales tras concluir cambios concurrentes. No ejecutada suite global/build/publicación.

Ranking y pasajes léxicos acotados no garantizan comprensión ni todas las condiciones de una nota; leer por ID permite obtener el cuerpo completo. El ranking aún inspecciona los cuerpos para determinar relevancia, aunque ya no extrae pasajes de todos los hits. Protocolo que exceda el presupuesto se omite entero; documentos antiguos sin marcadores conservan fallback acotado. Sin query, muchos compromisos/hipótesis pueden dejar reglas deferred. Presupuesto estimado, no tokenizer de proveedor. Las mediciones son locales/deterministas y combinan la integración de contexto con las mejoras de búsqueda de unidad 3; no demuestran eficiencia, ahorro ni mejores resultados de un LLM.

## Evidencia adicional review #9 — 02:08 UTC

Solo test e informe; sin cambio semántico. `src/context/review-regressions.test.ts` añade dos casos con cerebro real temporal (sin mock): decisión `active` y lección `proven` con `superseded_by` persistido mediante `brain.update`. Comprueba antes que ambos campos coexisten. Con y sin query `payment`, la nota antigua queda fuera del texto, `noteIds` y `deferred`; la regla vigente sí aparece. Tras cada pack, `brain.read(id)` devuelve íntegramente la misma nota histórica (estado, metadatos y cuerpo), sin mutaciones. Complementa el test previo sin query que usaba `list` inyectado.

Comando: `node node_modules/vitest/vitest.mjs run src/context/review-regressions.test.ts --maxWorkers=1 --no-cache` → exit 0, **9/9**, 1,22 s. Primera ejecución de los nuevos fixtures falló porque `brain.write` no persiste ese campo como argumento directo; se corrigió el fixture usando la API `update`, manteniendo todas las aserciones. `git diff --check -- src/context/review-regressions.test.ts audit/v2/02-context.md` → exit 0. No cambios en producción ni snapshots.
