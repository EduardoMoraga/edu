# 10 — Evaluación adversarial de aprendizaje y éxito

## Dictamen y alcance
- **La telemetría actual no demuestra reducción causal de trabajo repetido ni ayuda humana.**
- Reproduje 8 comportamientos problemáticos en módulos reales, sin motores LLM.
- Criterios previos: `audit/learning/acceptance.md:5-24`; son puertas, no resultados.
- Harness efectivo de este auditor: OpenCode; modelo declarado por el entorno: OpenAI `gpt-6.1-sol` (GPT-6.1 Sol). No verifiqué identidad por API.
- Probes: Node/Vitest 5.0.3, un worker; sin llamadas a proveedores, plugins o agentes adicionales.
- Los cuatro harness mencionados por coordinación no fueron validados aquí. Gemini/Kimi: **no evaluados**; no extrapolar familias ni proveedores.
- No consulté cerebros/config reales, secretos ni la auditoría anterior. No instalé, cambié código funcional ni hice commits.

## Hallazgos reproducidos

### 1. AVSR puede contradecir la propia evidencia — prioridad crítica
- `edu metrics` toma `outcome.label` sin reclasificar: `src/cli/commands/evidence.ts:91-109`.
- Fixture con etiqueta `autonomous_verified_success` y único check R1 fallido:
  - ruta real `registerEvidence`/Commander: `avsr=1`, `verificationAutonomy=1`, `n=1`;
  - `classifyPackage` sobre ese mismo directorio: `failed`.
- No exige manipulación de código: basta un paquete inconsistente. No probé que el flujo normal genere esa inconsistencia.
- Los paquetes son archivos escritos mediante `atomicWrite`, no evidencia firmada ni validada al leer: `src/evidence/package.ts:32-45`.

### 2. Clasificador permisivo: incompleto y mal tipado pueden parecer éxito
- Paquete con R1/check positivo pero **sin outcome terminal**, entropy ni intervenciones: `autonomous_verified_success`.
- Directorio vacío: `unverified_success` (no distingue ejecución incompleta/desconocida).
- `ok: "false"` en JSONL se trata como verdadero: `autonomous_verified_success`.
- Causa: archivos ausentes se sustituyen por objetos/listas vacíos; cast sin schema y filtrado por truthiness: `src/evidence/classify.ts:9-31,34-52`.
- Son fallos de frontera de evidencia; los tipos TypeScript no validan archivos externos en runtime.

### 3. Último veredicto borra una prueba fallida
- Secuencia R1: deterministic=false, luego review=true → `autonomous_verified_success`.
- Se guarda el último booleano por requisito sin exigir conservar la condición determinista: `src/evidence/classify.ts:20-28`.
- El cierre del orquestador usa también último evento no-reproducción: `src/orchestrator/run.ts:343-352`.
- El probe prueba el clasificador, **no** que el orquestador produzca esa secuencia concreta.

### 4. “Verificado” solo significa satisfacer el check elegido
- `printf ready` con salida esperada `ready` verifica R1, cuyo texto exige que exista un artefacto; no se crea ninguno.
- `runCheck` ejecuta un shell real y comprueba timeout, aborto, exit y substring: `src/evidence/registry.ts:67-109`.
- Eso funciona como está implementado; no demuestra adecuación semántica del oráculo al requisito.
- Plan/requisitos vienen del planificador: `src/orchestrator/run.ts:124-136`; aprobar el spec no garantiza cobertura independiente.
- Sí existen barreras contra omitir checks registrados H3: `src/orchestrator/run.ts:137-143`.

### 5. Nombres de métricas permiten lecturas excesivas
- Un episodio fallido con todos sus checks fallidos produce `verificationAutonomy=1`, `mhir=0`.
- Autonomía de verificación cuenta **tipo deterministic**, no éxito, cobertura ni ayuda externa: `src/evidence/metrics.ts:45,59`.
- `mhir` cuenta episodios con algún `avoidable`; no cantidad, minutos ni carga humana total: `src/evidence/metrics.ts:50-58`.
- `entropyDelta=3` con un único episodio de severidad 3: es media de severidades, **no delta** contra baseline: `src/evidence/metrics.ts:62`.
- Recuperación divide recuperaciones por todas las llamadas, no por fallos recuperables: `src/evidence/metrics.ts:46,60`; matching requiere igual agente/tool/input: `src/cli/commands/evidence.ts:117-132`.
- Completitud de atribución solo comprueba campos no vacíos: `src/evidence/metrics.ts:47-48,61`; no corrección causal.
- Son descripciones aritméticas; interpretarlas como beneficio sin controles es el falso positivo.

### 6. Etiqueta “proven” sin uso ni resultado observado
- Tres `feedbackUsage(..., true)` idénticos, mismo instante, `uses=0` → `lessonStatus=proven`.
- No hay identificador de episodio, deduplicación ni evidencia requerida: `src/brain/learning.ts:10-12,20-29`.
- La API persistente acepta ese booleano sin vincular resultado: `src/brain/brain.ts:194-197`.
- Reflexión aplica directamente feedback del modelo: `src/reflect/reflect.ts:29-38,48`.
- El peso sí cambia ranking: `src/brain/search.ts:32-36`; es adaptación local, no crédito causal probado.
- Recall actualiza recencia/uso antes de demostrar aplicación: `src/brain/brain.ts:178-183`.
- Riesgo de exposición autorreforzada y votos duplicados; no probé daño real en tareas LLM.

## Reproducción y límites
- Artefacto propio: `audit/learning/10-probes.test.ts` (8 casos, expectativas describen fallos actuales).
- Ejecutado desde `/code/edu`:
  ```sh
  node_modules/.bin/vitest run --config /tmp/10-evaluation-run-fk0gvj4i/vitest.config.mjs --maxWorkers=1
  ```
- Resultado: **1 archivo, 8 tests pasados**, 359 ms. “Pasados” confirma reproducción, no salud del producto.
- Log: `/tmp/10-evaluation-run-fk0gvj4i/result.txt`.
- Config temporal reproducible: `export default { cacheDir: '/tmp/10-evaluation-run-fk0gvj4i/cache', test: { include: ['/code/edu/audit/learning/10-probes.test.ts'], environment: 'node', testTimeout: 15000 } };`.
- Todos los fixtures quedan bajo `/tmp/10-evaluation-*`; no se escribió memoria durable real.
- No ejecuté suite completa, typecheck, benchmark de modelos, integración plugin ni ciclos longitudinales.
- No hay fallo de ejecución del probe; sí límites de medición reproducidos y riesgos de flujo aún no demostrados.

## Checklist frente a las puertas
- [x] **Implementado:** ejecución de checks, paquetes, agregación y pesos adaptativos (rutas citadas).
- [x] **Roto:** consistencia métricas/clasificador; validación runtime de evidencia; distinción incompleto/éxito.
- [x] **Insuficiente para G3:** feedback positivo y `proven` sin aplicación/impacto ni crédito por episodio.
- [ ] **G1/G2 no evaluadas aquí:** no probé persistencia multiproceso ni transferencia útil entre distractores.
- [ ] **G4/G5 no evaluadas aquí:** no probé corrección completa ni consumo automático del ciclo normal.
- [ ] **G6 ausente de lo examinado:** no hay comparación longitudinal externa en las métricas revisadas.
- `docs/ARCHITECTURE.md:271-273` anuncia `edu eval <suite>`; búsqueda en `src` de registro `eval` no encontró implementación. No confundir documentación con ejecución disponible.
- `src/orchestrator/run.ts:103-110` conserva orquestación y sesión incluso en H0; H0 **no es** control nativo sin Edu.

## Ensayo honesto propuesto (NO ejecutado)
1. Congelar requisitos, oráculos ocultos externos, versiones, modelo/proveedor, harness, permisos, caché y snapshots.
2. Cuatro brazos por el mismo modelo: nativo limpio; Edu frío; Edu memoria estática; Edu caliente con aprendizaje.
3. Nativo: sin hooks/instrucciones globales/briefs de Edu. Frío: brain aislado sin experiencias, acceso legítimo al dato.
4. Estática: snapshot del mismo contenido adquirido por caliente, recuperación equivalente pero sin feedback/mantenimiento; congelar pesos, recencia y escrituras.
5. Caliente: adquisición → transferencia relacionada → distractor → corrección → transferencia nueva; sesiones sin historial.
6. Comparar también snapshots de contenido igual para aislar adaptación de ranking, no solo más información almacenada.
7. Registrar adquisición/reflexión, lecturas/escrituras, tokens/cache/razonamiento disponibles, reintentos, tiempo y minutos humanos.
8. Evaluador externo y ciego decide corrección, cobertura, repetición de errores y ayuda; desconocidos no cuentan como éxitos.
9. Medidas primarias: coste total/minutos humanos por tarea externamente correcta, éxito total y recurrencia de error.
10. Incluir fallos y adquisición en denominadores; aleatorizar orden, repetir pares por familias y publicar incertidumbre/datos ausentes.
11. Evidencia de aprendizaje: caliente mejora transferencia y corrección frente a estática, no solo frente a frío; una caída global de M-HIR no identifica causalidad.
12. Sin ruta autenticada autorizada, Gemini/Kimi quedan excluidos. Diez opiniones coincidentes no son diez réplicas experimentales.

## Tres prioridades
1. **P0 — Integridad del éxito:** un único clasificador con schemas runtime, estado incompleto explícito, checks obligatorios por requisito y métricas recalculadas desde evidencia coherente.
2. **P1 — Crédito verificable:** feedback ligado a episodio/check externo/aplicación, deduplicación; separar expuesto, usado y útil; renombrar métricas engañosas y registrar carga humana/modelo/coste.
3. **P2 — Ensayo longitudinal:** ejecutar los cuatro brazos anteriores con sesiones nuevas y contenido controlado; publicar fallos e incertidumbre antes de afirmar ahorro o automejora.
