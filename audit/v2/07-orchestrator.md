# Unidad 7 — Orquestación

## Entrega
- Leídos completos `docs/EDU-2.0-PLAN.md`, `audit/learning/03-autonomy.md`, `audit/learning/04-feedback.md` y `audit/v2/08-evidence.md`.
- Archivos propios: `src/orchestrator/run.ts`, nuevo `src/orchestrator/v2.test.ts`, ajuste de seguridad en `src/orchestrator/orchestrator.test.ts`, este informe.
- Sin commits/pushes, instalaciones, cambios de package/version/lockfile, generación de plugins/dist, motores LLM ni cerebros/config reales. Sin herramientas `edu_*`; no se simuló una sesión sobre memoria real.

## Comportamiento
- Pack, registro y estado se suministran una sola vez por request, incluidos planner, workers y correcciones. El método completo (con nombre/descripción) permanece en planificación/reparación; workers conservan su método acotado previo. Los builders reciben también resúmenes de dependencias.
- `maxFixRounds` es presupuesto **global** de correcciones deterministas + review. Cero permite ejecutar trabajo planificado, pero ninguna corrección. Cada corrección vuelve por checks deterministas; antes de declarar éxito se exige un nuevo review `pass`. Máximo de reviews: presupuesto + 1; rechazos y cancelación siguen deteniendo el run.
- Se conserva el esquema de plan/review existente. El test antiguo que aceptaba un `fix` perpetuo ahora exige fallo, segunda revisión y un solo builder correctivo: no se debilitó la seguridad para pasar tests.
- Protocolo interno optativo del builder, sin nueva API pública:
  `EDU_APPLIED {"noteId":"L-id","requirementIds":["R-1"],"application":"Applied [[L-id]] by ..."}`
- Sólo se admite una nota identificada tanto por metadatos del pack como por su cita `[[id]]` realmente entregada. La aplicación debe volver a citarla y referenciar requisitos existentes. Una mera mención, nota diferida, ID sólo en metadatos, JSON inválido o requisito desconocido no obtiene crédito.
- `context.trace.influenced=true` registra esa declaración explícita del builder, no causalidad demostrada. Se emite como máximo una vez por nota; inicialmente se mantiene la traza de exposición `false`.
- `Brain.feedback(id, true, FeedbackContext)` sólo tras run exitoso/no inseguro, aplicación explícita y **todos los checks deterministas relevantes finales exitosos**, cubriendo los requisitos declarados para esa aplicación. No hay blanket wins ni feedback negativo inferido del fracaso global. `eventId = runId:outcome`, acotado e independiente del tamaño de noteId (el ledger es por nota); repetición de aplicaciones dentro del run produce una sola llamada. La idempotencia persistente la implementa API4.
- Evidencia de feedback: descripción de aplicación y IDs `deterministic-check:*` correlacionables con los eventos reales del run. Fallos de persistencia de feedback quedan en limitaciones del paquete sin fabricar voto ni cambiar el resultado del trabajo.
- Verificación terminal por check, no sólo por último evento del requisito: un check distinto/review no puede borrar otro fallo. Aprobación de política no se registra como intervención humana. Se usa **API8 `diagnosePackage` en runtime** sobre un paquete candidato completo, antes de feedback/emisión terminal; su etiqueta es autoritativa. Después se escribe el snapshot final. Sólo se emite un par outcome/run.end; una discrepancia de verificación fuerza fallo y cero crédito. Cada fixture contrasta además el paquete final con `classifyPackage`.
- Cierre sigue encolando atómicamente en `dirname(runsDir)/reflect-queue/<runId>.json` antes de `finish`. `autoMaintain` se llama **una sola vez**, después del paquete final. Verificado por lectura: el principal ya conectó ahí consolidación local acotada antes del throttle, con `consolidate:false` optativo. No se añadió segunda invocación.

## Comandos y resultados exactos
1. `room-cli files wait` → `Project files are ready in /code/edu.`
2. Antes del cambio: `./node_modules/.bin/vitest run src/orchestrator/v2.test.ts --maxWorkers=1 --reporter=verbose` → **6 failed, 8 passed**, 1 archivo, 5.03 s. Reproduce duplicación, presupuesto cero/global, falta de rereview, aceptación de fixes persistentes y ausencia de feedback trazable. Log: `/tmp/edu-v2-07-before.log`.
3. Durante integración: **2 failed, 44 passed**. Un probe asumía registro con checks sin suministrarlo; se añadió herramienta-registro observable. El antiguo test aceptaba revisión sin resolver; se reforzó para el nuevo contrato.
4. Siguiente ejecución: **1 failed, 50 passed**. El request esperado asumía `signal: undefined`; el batch entrega legítimamente `AbortSignal`. Ahora se exige señal válida/no abortada; no se modificó cancelación. Las pruebas previas de cancelación siguen pasando.
5. Final: `./node_modules/.bin/vitest run src/orchestrator/v2.test.ts src/orchestrator/v3.test.ts src/orchestrator/orchestrator.test.ts src/evidence/classify.test.ts --maxWorkers=1 --reporter=verbose` → **exit 0; 4 archivos, 62 passed; 14.10 s**. Log: `/tmp/edu-v2-07-final.log`.
6. `./node_modules/.bin/tsc --noEmit` → **exit 0**, sin diagnósticos; `/tmp/edu-v2-07-typecheck-final.log`.
7. `git diff --check -- src/orchestrator/run.ts src/orchestrator/orchestrator.test.ts` → **exit 0**, sin salida. Diff propio y nuevo test revisados.

Tests: motores `Engine` fake/grabadores; checks Node reales sobre marcadores temporales, con limpieza `finally`. Incluyen request H2 completo exacto, exposición única por request, límites compartidos, recheck/rereview, rechazo de aprobación, notas excluidas, checks fallidos/sin checks, persistencia fallida, dedupe por run, eventIds diferentes entre runs y veto terminal de API8 ante evidencia de review contradictoria, sin doble evento final. Sin grep del código de producción.

## API, compatibilidad y pendientes
- Exportados sin cambios: `orchestrate(goal, deps): Promise<RunResult>`, `ApprovalRequest`, `OrchestrateDeps`, `StepResult`, `RunResult`. Usa el `FeedbackContext` existente; no modifica contracts/core/evidence ni crea export de API1.
- Motores viejos no necesitan emitir `EDU_APPLIED`: continúan ejecutándose, pero no reciben crédito verificado automático. Primer step correctivo de review conserva ID `review-fix`; intentos posteriores y agentes/aprobaciones reciben sufijos únicos.
- H0 sigue siendo baseline **orquestado**, no sesión nativa limpia. No añade memoria ni protocolo de aplicación a H0/H1. No se inventan flags/tokens/costes/modelos ausentes ni se sustituyen faltantes por cero.
- Limitación deliberada: aplicación es declaración estructurada del motor, y el check demuestra sólo su condición externa; no prueba que la nota causó el éxito ni la suficiencia semántica del check. No se afirma eficiencia ni aprendizaje causal LLM. Sólo builder aporta esta señal; planner/reviewer no generan votos.
- Coste local explícito: API8 sólo clasifica paquetes en disco; se materializa un candidato completo y se sobrescribe una vez con el snapshot final. Son dos escrituras acotadas de paquete, no dos consolidaciones ni llamadas LLM. No se añadió una API alternativa ni se tocó evidence.
- Pendiente del principal: validación global/build/release y cualquier prueba LLM controlada. Consolidación ya integrada por el principal; no se requieren otros archivos ajenos para esta unidad.

## Fix acotado posterior — eventId largo
- Defecto reproducido con Brain real: nota con ID de 205 caracteres, citada y aplicada, check Node exitoso; antes del fix `verifiedWins` persistido era `undefined` en lugar de 1. `./node_modules/.bin/vitest run src/orchestrator/feedback-id.test.ts --maxWorkers=1 --reporter=verbose` → **exit 1, 1 failed**; `/tmp/edu-feedback-id-before.log`.
- Cambio funcional exclusivo en `run.ts`: clave `runId:outcome`, sin noteId redundante; el ledger persistente independiente por nota mantiene la deduplicación. Sin cambios de contratos/core/Brain/API8/aprobaciones.
- Nuevo `src/orchestrator/feedback-id.test.ts`: Brain real reabierto desde disco, ID >200, cita/aplicación y check Node real; dos notas reciben un verifiedWin cada una con la misma clave acotada; repetir esa clave no incrementa ninguna; una tercera nota sólo suministrada no recibe crédito. Paquete final sin errores `Feedback for ...`. Engine fake, cero LLM, fixtures eliminados. `v2.test.ts` actualiza sólo la expectativa exacta del eventId.
- Final: `./node_modules/.bin/vitest run src/orchestrator --maxWorkers=1 --reporter=verbose` → **exit 0; 5 archivos, 54 passed; 10.79 s**; `/tmp/edu-feedback-id-after.log`. `./node_modules/.bin/tsc --noEmit` → **exit 0**; `/tmp/edu-feedback-id-types.log`. `git diff --check -- src/orchestrator/run.ts src/orchestrator/v2.test.ts` → **exit 0**. Ejecución propia con Node **v25.9.0**; no atribuyo a este fix la suite/smoke Node22 informada previamente por el principal. Sin commits, instalaciones ni ampliación de alcance.
