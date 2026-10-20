# Unidad 8 — Integridad de evidencia

## Entrega
- Leídos completos `docs/EDU-2.0-PLAN.md` y `audit/learning/10-evaluation.md`.
- Archivos: `src/evidence/{classify.ts,classify.test.ts,metrics.ts,package.ts,package.test.ts,cli-metrics.test.ts}` y `src/cli/commands/evidence.ts`. Sin tocar contracts, versiones, lockfiles, plugins/dist, cerebros/config reales; sin instalaciones, commits, pushes ni motores LLM.
- `metrics` reclasifica con `classifyPackage`; no confía en la etiqueta persistida. Episodios corruptos/incompletos con inicio conocido permanecen en el denominador como fallidos.
- Validación runtime Zod de task, outcome, entropy, verification e intervention; JSONL inválido no se descarta para declarar éxito. Cierre obligatorio; el generador ya no fabrica `unverified_success` sin evento terminal. `review=true` no borra un fallo determinista: requiere un determinista posterior positivo. El informe Markdown conserva ese fallo también.
- Aprobación automática `by=policy` no significa asistencia humana; aprobación humana/intervención sí. Detectado al ejecutar la prueba H3 existente; corregido sin rebajar su expectativa AVSR=1.

## Comandos y resultados
- `room-cli files wait`: `Project files are ready in /code/edu.`
- Reproducción antes del arreglo: `node_modules/.bin/vitest run src/evidence/classify.test.ts --maxWorkers=1`: **2 failed, 1 passed**; falso éxito sin cierre y fallo determinista tapado por review.
- `node_modules/.bin/vitest run src/evidence --maxWorkers=1`: **6 archivos, 19 tests passed** (antes de ampliar cobertura).
- Primera integración `node_modules/.bin/vitest run src/evidence src/cli/commands/evidence.test.ts --maxWorkers=1`: **1 failed, 28 passed**; aprobación policy contada como asistencia. Corregido el clasificador, no la aserción.
- Mismo comando final: **7 archivos, 29 tests passed**, 2.56 s. Incluye ruta CLI completa H3/FakeEngine existente y Commander real con JSONL contradictorio, mal tipado, corrupto, incompleto y uso parcial. Fixtures temporales; nuevas pruebas eliminan sus fixtures.
- `node_modules/.bin/tsc --noEmit`: **exit 0**, dos ejecuciones.
- `git diff -- src/evidence src/cli/commands/evidence.ts`: revisado; nuevo test revisado al crearlo. No suite completa ni build/generación.

## API y compatibilidad
- Conservados `classifyPackage(directory): Promise<OutcomeLabel>`, unión de cinco etiquetas, `buildEpisodePackage`, `aggregateMetrics` y claves históricas JSON.
- Nueva `diagnosePackage(directory): Promise<PackageClassification>` devuelve `{label,reasons}`; incompleto/corrupto => `failed` con razón. Acepta cierres heredados `{ok:boolean}` o `{label:OutcomeLabel}`; campos opcionales presentes se validan. Paquetes históricos incompletos dejan de contar como éxito deliberadamente.
- Nuevas `ResourceMetrics` y `sumResources(rows)`. `EpisodeSummary.resources` opcional. Resultados agregados añaden `resources`, `deterministicVerificationShare`, `avoidableInterventionEpisodeRate`, `meanMaxEntropySeverity`.
- Recursos: suma de deltas `usage` disponibles (input/output/cache/coste USD), modelos observados únicos, elapsed de run.start/end o métrica persistida válida. Ausencia o parcialidad por campo => `null`; cero observado sigue siendo cero. No se estiman precios, modelos ni consumos ausentes.
- Alias antiguos documentados: verificationAutonomy es proporción de eventos deterministas incluso fallidos; mhir es proporción de episodios con intervención evitable; entropyDelta es media de máximos, NO delta. Cabecera humana usa nombres descriptivos; atribución comprueba campos, no causalidad.

## Límites y coordinación con principal
- No se reclama eficiencia LLM, aprendizaje causal ni suficiencia semántica del check. Evidencia local no está firmada; validación de estructura no evita falsificación coherente.
- Recursos sólo reflejan deltas registrados; no detectan llamadas completamente omitidas. Modelos son lista observada, no garantía de completitud. Total parcial se oculta como null, sin extrapolar.
- Directorios sin `run.start` no pueden asignarse a la ventana y siguen excluidos de métricas; `classifyPackage` sí los rechaza si falta evidencia requerida. Errores operativos distintos de JSON/schema/ENOENT se propagan.
- **Solicitud al principal/unidad 7:** `src/orchestrator/run.ts` aún tiene su propia decisión terminal (no importa classifyPackage). Revisar allí la regla determinista antes de publicación; no modificado por propiedad estricta. La CLI ya no hereda su etiqueta inconsistente.
- No se requieren cambios en contracts. Si se desea exponer los nuevos diagnósticos desde el barrel público, integración a cargo del principal; disponibles desde sus módulos propietarios.
