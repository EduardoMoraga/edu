# Piloto docente Codex

Sólo fixtures sintéticos; política fuente: `/tmp/edu-v2-model-pilot/codex-teacher/policy.md`. No se leyó la implementación del oráculo, otras carpetas del piloto ni se lanzaron agentes/CLIs de modelos. Sin modificaciones de código, setup, commits, pushes ni secrets.

- Oráculo inicial real: **0/3**, extras 0, exit 1; respuesta inicial incorrecta en los tres casos.
- Una corrección de `seed-answer.json`: **3/3**, extras 0, exit 0. Se corrigieron normalización/clave, TTL, reintentos y retención conforme a la política. Resultado conservado en `oracle-corrected.json` dentro de la carpeta docente.
- Sesión real: `2026-10-20-synthetic-service-learning-d06164b9`.
- Apertura y cierre final: stdout reales en `open-result.json` y `close-result.json`; JSON parseado y ausencia de `isError` comprobada.
- `close.lessons` devolvió **3 lecciones candidate/inferred, no verified**:
  - `L-normalize-each-cache-key-component-using-its-own-rule`
  - `L-evaluate-trial-ttl-independently-from-retry-eligibility`
  - `L-keep-retention-constant-when-invalid-inputs-disable-caching-and-retries`

Observaciones derivadas: normalizar tenant y SKU con reglas distintas; TTL cero de trial no impide reintentos por sí mismo; una solicitud inválida conserva retención de 72 horas. Los cuerpos de las candidatas documentan política y observaciones concretas de los seeds.

Hubo dos errores de integración al cerrar, conservados como stdout real en `close-error-result.json` y `close-evidence-error-result.json`: el contrato exige `id`, no `sessionId`; `evidence[]` exige IDs de notas existentes, no descripciones de fixtures. Se corrigió el campo y se citó el ID real de la sesión, conservando la evidencia descriptiva en los cuerpos. El rechazo por evidencia indicó expresamente que no cerró ni registró nada. La llamada final confirmó cierre y registro de las tres candidatas; no se usó `edu_remember`.

Limitaciones: tres seeds vistos y una trayectoria docente no prueban transferencia a casos reservados ni mejora general. El oráculo expuso las respuestas esperadas al fallar; la corrección posterior no es evaluación ciega. La confirmación de persistencia procede de la respuesta MCP, sin lectura independiente de notas. No se probó descubrimiento/cache nativo de plugins. Aislamiento por instrucciones, no adversarial. Quedan pendientes la evaluación estudiantil y la validación independiente de las candidatas.

`tokens=null`; `cost=null`. Sin estimaciones de uso, coste o velocidad.
