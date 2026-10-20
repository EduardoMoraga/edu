# Piloto con modelos reales: captura y recuperación funcionan; no hay superioridad medida

**Resultado: empate, 10/10 en cada brazo y familia. No demuestra ahorro ni mejora de calidad.** Sí ejercita la nueva captura con modelos reales, MCP real y estudiantes en sesiones nuevas, sin pasarles la conversación docente.

## Método y resultado

Plan fijado antes: [pilot-plan.md](pilot-plan.md). Dos docentes (Codex y Claude Code, modelos según [manifest de lanzamiento](pilot-dispatch.json)) observaron tres fallos sintéticos, los corrigieron con una ronda y cerraron sus sesiones mediante `edu_session_close` con tres lecciones `candidate` / `inferred`. El oráculo docente mostró 0/3 antes y 3/3 después; el archivo inicial incorrecto lo preparó el coordinador, **no fue una predicción inicial del modelo**. Ese feedback de entrenamiento NO era una evaluación ciega ni prueba de que Edu mejorara la capacidad del modelo.

Luego cuatro estudiantes nuevos resolvieron diez casos reservados cada uno. La política fuente estaba disponible para todos, sin ocultarla al control. Los brazos con memoria recibieron una copia del cerebro aprendido y llamaron a `edu_recall`; los controles consultaron solo la fuente. El coordinador aplicó el oráculo externo después de las entregas, sin corregir respuestas.

| Familia / etiqueta de lanzamiento | Solo fuente | Fuente + memoria Edu |
|---|---:|---:|
| Codex / `gpt-6-astra` | 10/10 | 10/10 |
| Claude Code / `sonnet` | 10/10 | 10/10 |

No hubo filas extra. Son **4 trayectorias**, no 40 réplicas independientes. Las etiquetas no verifican el backend remoto. Tokens, precio facturado y comparación de velocidad: **desconocidos (`null`)**.

## Qué se observó realmente

- Ambos modelos pudieron escribir lecciones en la llamada de cierre existente, sin lanzar otro modelo para reflejar la conversación.
- Los seis archivos de lecciones persistieron; las anotaciones permanecieron como candidatas inferidas, no verificadas. Respuestas MCP y copias de las notas están en [pilot-data](pilot-data/).
- Los estudiantes con memoria ejecutaron un recall real mediante el bridge. También consultaron la política como autoridad: no se atribuye su acierto exclusivamente a Edu.
- El estudiante Claude recuperó solo **2 de las 3** lecciones; completó normalización y reglas faltantes desde la fuente. La recuperación léxica no garantiza cobertura semántica.
- Ambos docentes se equivocaron inicialmente en el formato de evidencia: usaron prosa/archivos donde se exigían IDs existentes. Codex también usó `sessionId` en vez de `id`. Se rechazaron sin registrar ni cerrar; luego corrigieron el payload. El bridge no les expone automáticamente los schemas como un host MCP nativo, así que esto no prueba el mismo error en un plugin real. Se mejoraron las descripciones de schema.
- Una revisión posterior reforzó las colisiones de títulos/journals del cierre; el piloto corresponde al [fingerprint de build registrado](pilot-build.json), no certifica cada revisión posterior.

## Límites que impiden usarlo como garantía

No es un control nativo limpio: permanecen instrucciones externas de Cloudroom. Los modelos usaron un bridge de desarrollo a MCP, no descubrimiento/caché de plugins nativos. El aislamiento de carpetas era contractual, no adversarial. Las tareas son pequeñas, sintéticas y de una política única; ambos brazos podían resolverlas desde la fuente. No se midió tiempo humano ni facturación. Nada aquí demuestra mejor coste por tarea o aprendizaje causal general.

**No se deben convertir estos resultados en un `observed` de eficiencia ni rellenar costes con cero.** La conclusión correcta es funcionalidad de captura/recuperación observada y ausencia de superioridad demostrada en este piloto.

## Reproducción del grading

```sh
node scripts/pilot-oracle.mjs audit/v2/pilot-data/questions.json audit/v2/pilot-data/codex-source-only/answers.json
node scripts/pilot-oracle.mjs audit/v2/pilot-data/questions.json audit/v2/pilot-data/codex-edu-memory/answers.json
node scripts/pilot-oracle.mjs audit/v2/pilot-data/questions.json audit/v2/pilot-data/claude-source-only/answers.json
node scripts/pilot-oracle.mjs audit/v2/pilot-data/questions.json audit/v2/pilot-data/claude-edu-memory/answers.json
```

Datos y resultados completos: [pilot-results.json](pilot-results.json). Los archivos son sintéticos; no se incluyeron recuerdos personales/laborales ni credenciales. Reejecutar el oráculo reproduce el grading de estos outputs, no vuelve a ejecutar los modelos.
