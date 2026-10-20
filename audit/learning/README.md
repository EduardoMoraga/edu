# Edu tiene memoria reutilizable; el ciclo de automejora todavía no está cerrado

**Los 10 agentes terminaron en cuatro harness. Confirmamos mecanismos útiles de memoria y defectos reproducibles que impiden dar por cumplida la promesa de aprendizaje incremental autónomo.** No es solo falta de un benchmark: hay conexiones ausentes y fallos de ejecución. Tampoco se ha probado que Edu empeore los resultados de un modelo.

## Qué podemos afirmar

| Afirmación | Resultado |
|---|---|
| Edu conserva conocimiento y permite recuperarlo después | **Sí**, demostrado con módulos/MCP reales, disco y servidores/objetos nuevos. |
| Los hosts pueden reutilizar las mismas notas locales | **Sí**, si resuelven el mismo cerebro; pruebas SDK, no sesiones completas de todos los hosts. |
| Feedback modifica pesos y estados, y mantenimiento propone estándares | **Sí**, mecánica implementada; `proven` no equivale a utilidad demostrada. |
| Cerrar una sesión extrae automáticamente lo aprendido | **No en las rutas auditadas**: guarda episodios/resúmenes, sin extracción por sí sola. |
| El flujo habitual activa y completa la reflexión sin iniciativa adicional | **No**: no encontramos consumidor automático; repetir reflexión puede fallar. |
| Una nota promocionada exige haber mejorado un resultado | **No**: admite votos repetidos y sin uso verificado. |
| Edu mejora calidad o coste por tarea con los modelos disponibles | **No demostrado**: estos trabajos son auditorías/pruebas deterministas, no un A/B de tareas LLM. |

**La propuesta original sigue teniendo sentido. La implementación actual no justifica presentarla como conseguida.** El ahorro futuro exige que la experiencia se convierta en conocimiento correcto, recuperable y aplicado; conservar archivos no cierra ese circuito.

## Despliegue y cobertura real

- **3 Codex**, modelo de lanzamiento `gpt-6-astra`.
- **3 Claude Code**, alias de lanzamiento `sonnet`; los auditores declaran Sonnet 5.5.
- **2 Pi**, ruta `openai-codex/gpt-6.1-sol`.
- **2 OpenCode**, ruta `openai/gpt-6.1-sol`.
- Diez agentes completados, sin errores de ejecución del harness: [manifest](dispatch.json), [estados finales](completion.json), [cobertura](coverage.json).
- Cuatro harness **no son cuatro familias de modelos independientes**: aquí se usaron familias OpenAI y Claude. Las etiquetas no son verificación del backend remoto.
- **Gemini no ejecutado:** no había ruta expuesta/configurada en los catálogos accesibles. Además, Edu no tiene adaptador propio de Gemini CLI; Antigravity (`agy`) no es equivalente.
- **Kimi no ejecutado:** el usuario indicó no tener membresía.

Que un auditor haya trabajado dentro de un harness no demuestra que su plugin Edu esté integrado correctamente. Las pruebas contractuales de integración se identifican como tales; no se han vendido como sesiones de usuario ni como réplicas de un experimento de eficiencia.

## Los cortes concretos del ciclo

### 1. Experiencia → aprendizaje: no se activa automáticamente y el reintento falla

El cierre guarda texto; `autoMaintain` cambia estados e índices, pero no sintetiza experiencias. `reflect` sí puede extraer lecciones mediante un motor, pero requiere invocación explícita del agente/usuario o automatización externa. La cola escrita por el orquestador no tiene consumidor automático encontrado.

Dos reflexiones sobre la misma intervención chocan con `Note id already exists`: la deduplicación compara tags distintos a los persistidos. También hay escritura parcial antes de validar y borrado de entradas de cola no procesadas.

Evidencia: `src/reflect/reflect.ts:21–48,75–95`; informes [01](01-capture.md), [03](03-autonomy.md), [06](06-reflection.md). **No automatizar reflexión antes de reparar reintentos e idempotencia.**

### 2. Conocimiento → contexto útil: hay recuperación, pero no siempre llega la regla

En el corpus pequeño del agente 02, buscar literalmente/por alias funcionó; dos paráfrasis no recuperaron el objetivo. El contexto automático mostró títulos, pero no los cuatro valores operativos necesarios, incluso con presupuesto sobrante. `edu_read` sí recuperó las reglas cortas; para la nota larga hubo que ampliar el límite. El diseño de recuperación a demanda es legítimo: no demuestra por sí solo un fallo del agente LLM, pero exige probar que este realiza correctamente búsqueda y lectura.

Las candidatas irrelevantes pasan el filtro de consulta; ocho decisiones recientes pueden desplazar una antigua pertinente. Una lectura larga puede entregar solo cabecera/introducción y elipsis. Hace falta transmitir pasajes accionables sin volver a cargarlo todo.

Evidencia: `src/context/pack.ts:96–125`, `src/brain/search.ts:15–36`, `src/context/tokens.ts:19–24`; informes [02](02-retrieval.md), [05](05-forgetting.md).

### 3. Resultado → aprendizaje fiable: el crédito está sin conectar

El uso no suma wins: eso está bien separado. Pero `feedback(true)` tres veces puede marcar `proven` una lección nunca aplicada. No hay vínculo exigido entre nota, episodio y resultado externo; `influenced` se emite como `false` y el orquestador no convierte verificación en feedback atribuible.

La inyección renueva `lastUsed`, manteniendo vivas candidatas no confirmadas. En sentido contrario, una regla útil sin uso durante 210 días desapareció del brief en el fixture longitudinal. Son escenarios diferentes, no resultados incompatibles.

Evidencia: `src/brain/learning.ts:10–29`, `src/brain/brain.ts:178–198`, `src/orchestrator/run.ts:104–107`; informes [04](04-feedback.md), [05](05-forgetting.md), [08](08-longitudinal.md).

### 4. Autogestión entre hosts: contratos desalineados

En Pi, si `ctx.cwd` difiere del cwd del proceso, el hook puede inyectar el cerebro incorrecto; cambiar de proyecto en MCP tampoco sincroniza ese selector. No se demostró contaminación espontánea en sesiones normales con directorios alineados.

El protocolo exige cerrar sesión sin exigir primero abrirla y guardar su ID. El fallback puede cerrar una sesión de otro host; hooks repetidos duplican episodios. Las skills aceptadas no se distribuyen automáticamente a todos los hosts.

Evidencia: `plugins/pi/extensions/edu.ts:153,161–167`, `src/mcp/server.ts:174–210`, `src/cli/hooks.ts:51–85`; informes [07](07-pi-integration.md), [09](09-opencode-integration.md).

### 5. Medición: podemos confundir estado interno con éxito real

Un paquete inconsistente produjo AVSR=100% en `edu metrics` mientras su propio clasificador devolvía fallo. No se probó que el flujo normal genere esa inconsistencia: sí que la lectura no la rechaza. Paquetes incompletos y tipos inválidos también pueden clasificarse como éxito. El nombre `proven` es una heurística, no prueba de aprendizaje.

Evidencia: `src/cli/commands/evidence.ts:91–109`, `src/evidence/classify.ts:9–52`; informe [10](10-evaluation.md). Antes de medir el beneficio, la medición debe distinguir fallo, incompleto y éxito externo.

## Evidencia positiva: el cerebro no es inerte

El agente 08 recorrió tres episodios con un oráculo Node externo: trim de SKU, detección de caché mal aislada y decisión corregida por usuario. Al guardar explícitamente lecciones/feedback y superseder la decisión, el brief pasó de **0/2 a 2/2 hechos útiles**. El replay mecánico pasó ambas comprobaciones; después de 210 días perdió una regla. Se ejecutaron **22 comprobaciones externas**.

Eso demuestra persistencia y adaptación mecánica en ese escenario. **No demuestra que Edu descubra solo esas lecciones, que un LLM las aplique ni que ahorre tokens o ayuda humana.** El fixture aportó las escrituras/feedback y usó regex explícitas para consumir los hechos. Fuente: [08](08-longitudinal.md).

## Orden de trabajo recomendado — no aplicado

1. **Consolidación repetible y trazable:** validar antes de escribir, deduplicar por experiencia, confirmar solo cola procesada; después conectar disparo automático acotado. Mantener aprobación humana de estándares/skills.
2. **Recuperación accionable y enfocada:** IDs, estado y pasajes útiles; relevancia de candidatas/decisiones, lectura paginada y tratamiento explícito de lecciones reemplazadas. No resolverlo inyectando más memoria indiscriminadamente.
3. **Crédito honesto:** separar expuesta/usada/útil, feedback idempotente con episodio y evidencia; no promover por votos repetidos sin aplicación.
4. **Lifecycle y workspace únicos:** identificar sesión/propietario y sincronizar el cerebro de hook, MCP y host.
5. **Evaluación válida:** integridad del clasificador y ensayo longitudinal con mismo modelo/harness: nativo limpio, Edu frío, memoria estática y aprendizaje activado. Contar adquisición, reflexión, reintentos, errores, coste y ayuda humana.

No proponemos cambiar todas las capas a la vez ni gastar más en inferencia para ocultar fallos de cableado. Primero reparar y comprobar cada eslabón.

## Verificación del coordinador

- Suite existente: **733 tests aprobados, 1 omitido**, 97 archivos; typecheck aprobado.
- Reejecución conjunta de ocho archivos de diagnóstico: **45 aprobados, 1 fallido de 46**. El fallo se conserva deliberadamente para reproducir el crash de reflexión repetida; **no está corregido**. Muchos tests verdes afirman comportamientos defectuosos: verde significa reproducción, no cumplimiento de la promesa.
- Probe Pi reejecutado: exit 0, 10 registros con aserciones; probe de candidata inyectada sin wins a 360 días reejecutado: sigue activa.
- Reproducción: `node_modules/.bin/vitest run --config audit/learning/main-verification.config.mjs --maxWorkers=2`; resultados en [main-verification-results.json](main-verification-results.json). Pi: `node audit/learning/07-pi-probe.mjs`.
- Sin cambios de código funcional, dependencias, configuración ni cerebros reales. Los artefactos de esta auditoría son documentación/probes/resultados; no se han desplegado reparaciones.
- Herramientas de memoria `edu_*` no disponibles en la sesión coordinadora; no se creó memoria real ni se ejecutó setup solo para registrar la auditoría.

**Abierto:** reparar estos cortes y ejecutar un ensayo LLM longitudinal controlado. [Criterios fijados antes de la síntesis](acceptance.md). Con los accesos disponibles se puede probar en OpenAI/Claude; no extrapolar a Gemini, Kimi ni otros usuarios. La auditoría ya identifica qué funciona y qué está roto, pero no autoriza una garantía general de eficiencia.
