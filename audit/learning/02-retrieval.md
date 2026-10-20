# 02 — Recuperación y aplicación de conocimiento

**Veredicto:** existe recuperación útil, pero la entrega automática de decisiones relevantes al prompt es insuficiente en estos fixtures. No queda demostrada una reducción de explicaciones repetidas ni de ayuda humana.

## Alcance y método

- Fecha: 2026-10-20. HEAD observado: `ab405fac6d5ceb74fc9694896809477dc5a5049e`; checkout compartido, sin asumir que equivale a todos los archivos actuales.
- Harness de auditoría: Codex en Cloudroom; identificador exacto del modelo efectivo **desconocido**.
- Harness experimental: Node v25.9.0, Vitest 5.0.3, un worker; Brain, servidor/cliente MCP y `respond` reales. Motor inyectado que captura solicitudes y devuelve texto fijo: **ningún LLM ejecutado**. La etiqueta `codex` del fixture no identifica un modelo ejecutado.
- Primero se ejecutó `room-cli files wait`: correcto. Sin herramientas `edu_*` expuestas al auditor; se usaron mediante MCP en memoria contra `/tmp/02-retrieval-brain-*`.
- `edu_brief` inicial y apertura/cierre de sesión se ejecutaron exclusivamente en ese fixture, eliminado al terminar. Sin memoria/configuración real, secretos, instalación, commits ni agentes adicionales.
- No se leyó la auditoría previa. Criterios independientes: objetivo esperado fijado por caso; hit = ID objetivo en top 5; suficiencia = valores operativos del cuerpo, no título, puntuación ni coincidencia verbal.
- Corpus base: 4 notas útiles (dos decisiones, una lección probada, un dominio canónico aceptado) y 15 notas de ruido. Después: ocho decisiones irrelevantes más recientes y una norma corta de control.
- La marca `proven` es un dato sintético, no una validación del aprendizaje. Fecha de ejecución congelada; ranking y transporte comprobados sin juicio de un modelo.

## Reproducción

Desde `/code/edu`, sin instalar nada:

```sh
node node_modules/vitest/vitest.mjs run \
  --config audit/learning/02-retrieval.vitest.mjs \
  --configLoader runner --maxWorkers=1 --no-cache
```

Resultado final: **1 archivo / 1 prueba pasó**, 687 ms en esta ejecución. Las aserciones verifican también las omisiones esperadas: verde significa reproducción del diagnóstico, no que el producto satisfaga la promesa.

- Probe: `audit/learning/02-retrieval.probe.test.ts`.
- Config aislada, caché en temporal único: `audit/learning/02-retrieval.vitest.mjs`.
- Resultados y prompt capturado: `audit/learning/02-retrieval.results.json`.
- Fixtures y criterios: `audit/learning/02-retrieval.probe.test.ts:32`; consultas: línea 40; lectura: línea 56; captura: línea 76.

## Mediciones

| Consulta | Objetivo externo | Rango top 5 | Visible en MCP |
|---|---|---:|---|
| `Cobros duplicados` | Política de reintentos | 1 | Sí |
| `politica reintentos` | Misma decisión, sin tildes | 1 | Sí |
| `impedir facturas repetidas` | Misma decisión, paráfrasis | Omitido | No |
| `¿Cómo impedir que la misma factura se pague dos veces?` | Misma decisión | Omitido | No |
| `regla-pagos` | Alias exacto de la decisión | 1 | Sí |
| `snapshot Q7` | Regla al final de nota larga | 1 | Sí |

Hit@5 = **4/6**; las dos reformulaciones: **0/2**. Cada una devuelve cinco notas irrelevantes en el corpus con ruido (precisión 0/5). Son seis consultas sintéticas, no una estimación de calidad general.

Sin ruido, la paráfrasis devuelve cero resultados. Tras cinco feedbacks positivos a la decisión sigue sin aparecer. El peso aprendido no crea candidatos sin coincidencias léxicas (`src/brain/search.ts:15`, `src/brain/search.ts:27`, `src/brain/search.ts:35`). Esto es ranking BM25 con feedback y normalización de tildes, no comprensión demostrada.

| Vía | Hechos operativos disponibles |
|---|---|
| Contexto automático, 800 tokens | 0/4 |
| Contexto automático, 8.000 tokens | 0/4 |
| Prompt real de `respond`, capturado antes del motor | 0/4 |
| `edu_read` explícito, límite por defecto | 3/4 |
| Nota larga con `maxTokens: 5000` | Recupera el cuarto hecho |
| Control: norma canónica corta aceptada | Cuerpo sí llega al prompt |

Hechos fijados: `72 horas`/Idempotency-Key para cobros; `47 minutos`/snapshot Q7 para recuperación; `drainSockets` para cierre; `checksum V9`/firma de Nora para entrega. La ausencia de cada valor central basta para declarar insuficiente su regla; no se evalúa una respuesta generada.

## Hallazgos verificables

1. **La decisión aparece, su explicación no.** `buildContext` añade únicamente títulos de decisiones y lecciones (`src/context/pack.ts:96`, `src/context/pack.ts:108`). En ambos presupuestos usa solo 228 tokens: aumentar el presupuesto diez veces no recupera el cuerpo. El dominio canónico conserva únicamente su primer párrafo (`src/context/pack.ts:113`), omitiendo incluso la regla breve del segundo.
2. **La pérdida llega al prompt.** `respond` concatena `pack.text` y lo pasa como `systemPrompt` (`src/chat/respond.ts:45`, `src/chat/respond.ts:54`, `src/chat/respond.ts:62`). Capturamos esa solicitud: título presente, ID de decisión ausente y cuatro hechos ausentes. No es solo una vista resumida de depuración. Los IDs existen en el evento de recall, pero ese evento no se incorpora al texto (`src/chat/respond.ts:49`).
3. **La antigüedad vence a la relevancia para decisiones.** Al añadir ocho decisiones de iconos más nuevas, la decisión de cobros desaparece aunque la consulta sea literal y sobren tokens (222/8.000). Tampoco figura en `deferred`: nunca entra en la selección de ocho (`src/context/pack.ts:96`; `deferred` se registra por falta de presupuesto en `src/context/pack.ts:57`).
4. **Ruido admitido sin relevancia.** Las 15 lecciones candidatas entran en el contexto aunque la consulta pida otras reglas: el filtro acepta todas las candidatas (`src/context/pack.ts:103`). En este corpus pequeño no agotan el presupuesto; no se afirma que hayan expulsado aquí un cuerpo que de otro modo se incluiría.
5. **Lectura por referencia funciona.** 6/6 referencias recuperan la regla corta: ID, legacy ID, alias, wikilink con etiqueta, nombre de archivo y título sin tildes. `resolveReference` implementa esa resolución (`src/brain/resolve.ts:21`). Pero `edu_recall('[[D-702]]')` devuelve cero y `edu_read('[[D-702]]')` funciona: recall compara el alias sin retirar corchetes (`src/brain/search.ts:12`).
6. **Buscar una cola no garantiza leerla.** `snapshot Q7` encuentra la nota larga, pero recall devuelve metadatos y motivo, sin cuerpo (`src/mcp/server.ts:126`). `edu_read` aplica 800 tokens por defecto (`src/mcp/server.ts:85`): aquí entrega solo 91 caracteres, encabezado, introducción y `…`. El algoritmo prefiere un corte anterior por párrafo antes que rellenar el presupuesto (`src/context/tokens.ts:20`). La regla final sigue en el almacenamiento y aparece al pedir 5.000 tokens; no es pérdida persistida. No hay offset/paginación en el esquema de lectura (`src/mcp/server.ts:129`).
7. **Existe una vía útil, pero requiere recuperar el cuerpo.** Una norma aceptada corta sí pasa por `Who and how` al prompt (`src/context/pack.ts:80`). Las lecturas explícitas resuelven los datos: un agente podría evitar preguntar al humano si identifica la nota y aumenta el límite cuando haga falta. No se probó que lo haga de forma autónoma.
8. **Uso no equivale a aplicación exitosa.** El pack registra uso de los IDs incluidos aunque solo inyecte títulos (`src/context/pack.ts:125`); recall registra uso de hits (`src/brain/brain.ts:178`). Esas señales no prueban que se leyó la explicación ni que evitó un error o una intervención humana.

## Checklist

- [x] **Implementado:** ranking léxico, normalización de tildes, alias exactos, resolución de referencias y cuerpos recuperables.
- [x] **Implementado:** transporte MCP real y construcción del prompt; norma corta de control entrega información útil.
- [ ] **Roto respecto al criterio auditado:** cuerpo suficiente de decisiones/lecciones en contexto automático, aun sobrando presupuesto.
- [ ] **Roto respecto al criterio auditado:** decisión antigua relevante desplazada por ocho recientes irrelevantes, sin detalle en `deferred`.
- [ ] **Roto respecto al criterio auditado:** paráfrasis sin términos comunes; lecturas largas pueden omitir la regla buscada.
- [ ] **Ausente en estas rutas:** expansión semántica de consulta y paginación/lectura focalizada por pasaje.
- [ ] **No demostrado:** aplicación autónoma de recuerdos, reducción de repeticiones, coste o ayuda humana entre sesiones.

## Tres prioridades

1. **Entregar reglas utilizables:** ordenar decisiones por relevancia y adjuntar ID, estado y pasaje operativo de decisiones/lecciones. Medir cobertura de hechos hasta el prompt. Tradeoff: más tokens por nota; usar un presupuesto explícito de pasajes.
2. **Cerrar búsqueda → lectura:** devolver pasaje coincidente y referencias consistentes; lectura paginada o focalizada para notas largas. Tradeoff: más complejidad de selección, pero evita recargar toda la nota con un límite enorme.
3. **Evaluar recuperación y utilidad por separado:** ampliar este conjunto con paráfrasis y ruido; comparar expansión léxica frente a recuperación semántica si procede. Después ejecutar tareas repetidas con/sin memoria y medir errores, preguntas humanas y coste. Tradeoff: evaluación LLM cuesta y varía; no sustituirla por feedback positivo ni por consenso.

## Límites y pendientes

Prueba determinista de disponibilidad, no de conducta del modelo. Corpus pequeño y diseñado para distinguir fallos; sin evaluación estadística, corpus real, conflictos entre cerebros ni todas las integraciones. El motor capturado no llama herramientas ni genera respuestas sustantivas. No se ejecutó la suite global ni se hizo typecheck del proyecto compartido. Las búsquedas iniciales de rutas inexistentes (`src/orchestration`, `src/chat/types.ts`) se corrigieron al localizar los módulos reales; los probes finales no fallaron.

Queda abierto demostrar que una sesión posterior aplica las reglas sin repetir explicaciones. No se deduce eficiencia de los tests verdes, del peso aprendido o del acuerdo entre agentes. Se cerró la sesión sintética; no se guardó ninguna nota durable real.
