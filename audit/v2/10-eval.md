# 10 — Evaluación Edu 2.0 (unidad10)

Sin inferencias pagadas, CLIs ni agentes anidados. Solo cerebros temporales.

## Cambios (todos nuevos)
- `src/eval/contract.ts` — esquema estricto de ensayo + `parseTrials`; `EvalContractError`.
- `src/eval/aggregate.ts` — `aggregateTrials` (4 brazos, Wilson 95%, costes totales, estados).
- `src/eval/suite.ts` — `runMemorySuite` (transferencia → distractor → corrección).
- `src/eval/index.ts` — exports.
- `src/cli/commands/eval.ts` — `registerEvaluation(program, ctx)`: `edu eval aggregate <file> [--min-trials N] [--json]`, `edu eval suite [--json]`.
- Tests: `src/eval/eval.test.ts`, `src/cli/commands/eval.test.ts`. Docs: `docs/evals/edu-2.0.md`.

## Verificación
```
npx vitest run src/eval src/cli/commands/eval.test.ts --maxWorkers=1   # 2 archivos, 24 tests OK
npx tsc --noEmit -p .                                                    # sin errores en archivos de eval
```
Cubren: rechazo de tipos erróneos, costes ausentes/negativos/NaN, campos extra, `trialId` duplicado, modelos o harness distintos; `no-trials` → `inconclusive`; muestra insuficiente sin deltas; brazos desemparejados o con distinto multiconjunto (taskId, repetitionId) — incluye mismo conjunto con frecuencias easy/hard desbalanceadas —; repetitionId; revalidación en `aggregateTrials`; suma de 4 categorías disjuntas; datos de la suite nunca son evidencia; fallos y costes de adquisición/reflexión cuentan; y que feedback advisory (`verified:false`) no promueve (`verifiedWins` 0, no `proven`).

## Resultado de la suite (determinista, solver por reglas)
| Brazo | transfer | distractor | corrección |
|---|---|---|---|
| native-clean | 0/1 | 0/3 | 0/2 |
| edu-cold | 0/1 | 0/3 | 0/2 |
| memory-static | 1/1 | 0/3 | 0/2 |
| memory-adaptive | 1/1 | 2/3 | 1/2 |

Lectura: la memoria transfiere; el distractor engaña a la memoria estática; el feedback verificado de un solo uso fallido hace que el adaptativo se recupere; la corrección es aportada por oráculo/humano (1 intervención + tokens de reflexión). Los brazos nativo/frío son un baseline "abstenerse" (sin recall), no un modelo real.

## API
`parseTrials(unknown): Trial[]`, `aggregateTrials(trials, {minTrialsPerArm}): EvalReport {status, reasons, limits, model, harness, arms, comparisons}`, `runMemorySuite(): SuiteResult`.

## Límites
- No es benchmark de LLM; la suite es fixture escrito por mí; el resultado depende del ranking actual (`relevancia × peso aprendido`) y puede cambiar si Retrieval/Credit cambian: el test fija esos números a propósito para avisar.
- Wilson asume ensayos independientes; sin corrección por comparaciones múltiples; sin pareado por tarea (solo igualdad de conjuntos).
- Mínimo por defecto 10 por brazo es una convención, no un cálculo de potencia.
- No hay recolector de ensayos reales: el contrato espera que otro proceso los registre.

## Integración pendiente (lead)
- Registrar `registerEvaluation(program, ctx)` en `src/cli/program.ts` (no tocado). El test usa un `Command` propio, no `createProgram`.
- Decidir dónde se guardan ensayos reales (p. ej. `.edu/runs/*`) y quién escribe `provenance: 'measured'` con oráculo externo.
- Si Brain.feedback cambia de firma, la suite usa `feedback(id, helpful, {eventId, verified:true, evidence})`; ajustar ahí.

## Revisión del lead (aplicada)
- Emparejado por multiconjunto (taskId, repetitionId opcional); razón `unmatched-task-multiset`.
- `aggregateTrials` revalida con `parseTrials`: sin comparaciones con costes ausentes.
- Costes: 4 categorías disjuntas documentadas; el doble conteo del registrador no es detectable.
- `oracle` es declaración de procedencia, no verificación de independencia; texto de límites corregido.

## Coste facturado y desglose (última mejora)
- `costs.billedCostUsd` (null/ausente = desconocido, 0 = cero observado); `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens` opcionales, validados como subconjuntos de input/output y nunca sumados al total.
- `ArmSummary`: `totalBilledCostUsd`/`meanBilledCostUsd` null si algún ensayo es desconocido; `declared` null si falta alguno. `Comparison.dollarDelta` solo con ambos brazos completos.
- Fixtures antiguos sin estas claves siguen válidos (→ desconocido). Límite explícito: tokens `observed` no promete ahorro financiero.
- Verificado: 24 tests OK, tsc sin errores en eval.
