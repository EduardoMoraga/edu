# 04 — Crédito y aprendizaje (recordUse / feedback / wins-losses / influenced / band / learnedWeight)

Ejecutor: harness Claude Code (Cloudroom), modelo **Sonnet 5.5** (`claude-sonnet-5-5`). Rama `room/modelo-de-edu-...`, sin commits.
Alcance: solo código y probes deterministas con cerebros temporales (`/tmp/edu-04fb-*`). **No hay ninguna medición con LLM**: nada aquí demuestra mejora de agentes.

## Veredicto corto
- El mecanismo de **peso** (Laplace + vida media 45 d) funciona y es determinista. Lo probé.
- **Uso ≠ éxito**: en cuanto a wins/promoción, sí está separado (probado). Pero el uso **sí cuenta como "vitalidad"** (retrasa el retiro).
- **El crédito es manual/autoatestiguado**: nada en el flujo normal liga una lección a un resultado correcto. `influenced` está cableado a `false` y nadie lo lee.
- Por tanto "aprender de la experiencia" hoy = "alguien (agente/LLM) llama `feedback`". No hay prueba de que reduzca trabajo repetido.

## Cómo reproducir
```
cd /code/edu
npx vitest run --config audit/learning/04-feedback.config.ts --maxWorkers=1 --disableConsoleIntercept 2>&1 | rg '^P[0-9]'
```
Resultado: 6/6 tests pasan (los `console.log` P1..P6 son la evidencia). Ficheros: `audit/learning/04-feedback.probe.test.ts`, `04-feedback.config.ts`.
(La config raíz de vitest solo incluye `src/**`, por eso hay config propia.)

## Mapa del código (verificado)
| Pieza | Dónde |
|---|---|
| `UsageStats {uses,wins,losses,lastUsed}` | `src/core/contracts.ts:58-67` |
| `learnedWeight` = `max(0.25, (wins+1)/(wins+losses+2) · 0.5^(días/45))` | `src/brain/learning.ts:3-8` |
| `recordUsage` (solo `uses++`, `lastUsed`) | `src/brain/learning.ts:15-18` |
| `feedbackUsage` (`wins/losses++`, **también `lastUsed`**) | `src/brain/learning.ts:10-13` |
| Estado de lección: retirar / promover | `src/brain/learning.ts:20-30` |
| `recordUse` por lote, dedupe por minuto | `src/brain/brain.ts:80-84,185-193` |
| `recall` también cuenta uso | `src/brain/brain.ts:180-183` |
| `feedback(id, helpful)` sin contexto de run | `src/brain/brain.ts:194-198` |
| Ranking con peso: `bm25·(0.5+w)` | `src/brain/search.ts:32-34` |
| Pack: inyección y orden de lecciones | `src/context/pack.ts:100-108`, `recordUse` en `:125` |
| `influenced: false` fijo | `src/orchestrator/run.ts:104-107` |
| TUI descarta `context.trace` | `src/tui/state.ts:281-283` |
| Únicos callers de `feedback` | `src/mcp/server.ts:146-150` (herramienta `edu_feedback`), `src/reflect/reflect.ts:48` (salida libre del LLM) |
| `maintain` promueve y propone canónica | `src/brain/brain.ts:228-250` |

## Hallazgos (con prueba)

### 1. Uso no se confunde con éxito (OK, probado)
P1: 6 inyecciones de contexto con consulta relevante → `{"uses":6,"wins":0,"losses":0}`, peso 0.50, tras `maintain` sigue `candidate`.
Promoción exige `wins>=3 && weight>=0.7` (`learning.ts:28`), y `uses` no entra en esa fórmula.

### 2. Pero uso sí cuenta como vitalidad (limitación)
`lessonStatus` mide el retiro con `lastUsed` (`learning.ts:25-26`) y `recordUsage` lo actualiza (`learning.ts:17`). P2: lección nunca confirmada, inyectada el día 100 → a día 200 sigue `candidate`; sin ese uso se retira a los 180 d (a día 290 se retiró).
Efecto: una lección candidata siempre inyectada (ver 4) **nunca caduca** aunque nadie confirme que sirvió. Uso renueva vida, sin éxito.
`feedback` también renueva `lastUsed` (`learning.ts:12`): un `helpful:false` retrasa el retiro por antigüedad (compensado por el retiro por losses).

### 3. Notas negativas bajan de prioridad, poco (parcial)
P3: 2 losses → peso 0.25 (suelo). En `recall` queda abajo: `Good advice:0.547` vs `Bad advice:0.410` (misma redacción). Con 3 losses `maintain` la retira (`learning.ts:26`, requiere `losses>=3 && weight<0.35`).
Fallos:
- El suelo 0.25 hace que el multiplicador sea `0.5+w` ∈ [0.75, …]: una nota con losses solo pierde ≈25-45 % de score, y un BM25 alto la sigue poniendo primera.
- Retiro no es inmediato: hasta correr `maintain` sigue inyectándose (`maintain` no corre en cada contexto; verificar `auto-maintain.ts`, no lo audité).
- **Candidatas con losses se inyectan igual aunque la consulta no tenga relación**: P3 con consulta "unrelated database migration" → ambas (`Bad advice` y `Good advice`) aparecen. Causa: `pack.ts:103` (`status === 'candidate' || ...`). Solo las `proven` se filtran por relevancia.
- Orden en pack: `proven` primero, luego relevancia, luego peso (`pack.ts:104-107`); para `candidate` el peso solo desempata tarde.

### 4. Éxitos antiguos inmunizan (límite de diseño)
P4: 10 wins y luego 3 losses → `{"wins":10,"losses":3}`, peso 0.73, **sigue `proven`**, no retirada. Contadores acumulados, sin ventana ni decaimiento de wins/losses (solo el factor recencia sobre el total). Una lección que dejó de ser cierta tarda muchos losses en caer. Además `proven` es pegajoso (`learning.ts:27`).

### 5. Feedback autoatestiguado (riesgo de crédito falso)
P5: `feedback(id,true)` ×3 sobre la misma nota → `maintain` la promueve a `proven` y **propone nota canónica** (`proposed`; exige aceptación humana, bien). No hay idempotencia por (nota, run, actor), ni tope, ni verificación de que la nota se usó: P6 `uses=0, wins=1` (feedback sobre una nota nunca inyectada).
Quien llame `edu_feedback` (el propio agente que escribió la lección) puede inflarla. Mitigación real: el humano acepta lo canónico. Pero el nivel `proven` ya alimenta el pack antes de eso.

### 6. Asociar lección ↔ resultado correcto: ausente
- `feedback(id, helpful)` no recibe `runId`, `resultado`, `verify` ni evidencia (`brain.ts:51`).
- `context.trace.influenced` siempre `false` (`run.ts:106`); `rg influenced src` fuera de tests/replay solo da contratos y este emisor; no existe código que lo ponga en `true`. TUI lo ignora (`state.ts:281`). El test de replay con `influenced: true` (`replay.test.ts:55`) es un fixture, no comportamiento real.
- El orquestador no llama `feedback`/`recordUse` tras `verify` ok/fallo. Lo único que llega al peso es: (a) `reflect`, donde un LLM propone `feedback:[{id,helpful}]` (`reflect.ts:12,48`) sin validar que `id` figure en el `context.trace` de ese episodio; (b) llamada manual MCP.
- `reflect` requiere LLM y episodios cerrados; no lo ejecuté. **Mejora LLM: no demostrada.**

### 7. `band` y `status` no se alimentan de la evidencia
P5: tras promover a `proven`, `band` queda `undefined` (se muestra como `inferred`, `pack.ts:108`). `feedback` nunca toca `band`; `verified` solo existiría por escritura manual. No hay camino que suba una banda por resultados verificados. Lo canónico sí exige humano (`brain.ts:153,206`).

### 8. Dedupe por minuto
`usedThisMinute` (`brain.ts:80-84`) evita doble conteo en el mismo minuto: bueno para spam, pero dos runs distintos en el mismo minuto cuentan 1 uso. Menor.

## Checklist
| Capacidad | Estado | Evidencia |
|---|---|---|
| Contador de uso en pack/recall | **Implementado** | P1, `brain.ts:180-193` |
| Uso no suma wins ni promueve | **Implementado** | P1 |
| Peso Laplace + recencia en ranking | **Implementado** | `search.ts:32`, P3 |
| Nota con losses baja en `recall` | **Implementado (débil)** | P3 0.547 vs 0.410 |
| Retiro por 3 losses | **Implementado**, solo vía `maintain` | P3 |
| Candidata mala no se inyecta si irrelevante | **Roto** | `pack.ts:103`, P3 |
| Uso renueva vida sin éxito | **Roto/riesgo** | P2 |
| Wins/losses con ventana temporal | **Ausente** | P4 |
| Feedback idempotente / limitado | **Ausente** | P5 |
| Feedback exige que la nota se usó | **Ausente** | P6 |
| `influenced` real | **Roto** (siempre false) | `run.ts:106` |
| Crédito automático por `verify`/resultado | **Ausente** | sin llamadas en orquestador |
| Lección ↔ resultado/run en `feedback` | **Ausente** | `brain.ts:51` |
| `band` evoluciona con evidencia | **Ausente** | P5 |
| Medición de reducción de trabajo/ayuda humana | **Ausente** | sin métrica en código leído |

## Límites de esta auditoría
- Todo es determinista sobre módulos reales (`openBrain`, `buildContext`, `maintain`). No corrí orquestador, `reflect` ni MCP end-to-end, ni agentes.
- No audité `auto-maintain.ts` (cuándo corre `maintain` automáticamente) ni `dist/`.
- Los números de score dependen del corpus de 2 notas; solo demuestran dirección, no magnitud en un cerebro real.
- No afirmo que el sistema mejore resultados: no hay ninguna medición A/B aquí.

## Tres prioridades
1. **Cablear crédito a resultados**: que el orquestador, tras `verify` (ok/fallo), llame a un `feedback` con `{runId, outcome}` solo sobre notas del `context.trace` de ese run, y poner `influenced` por señal real (cita/uso en la salida), no `false` fijo. Sin esto no hay aprendizaje medible.
2. **Blindar el feedback**: idempotencia por (nota, run, actor), rechazar feedback sobre notas no inyectadas en ese run, y no dejar que el autor de una lección la promueva a `proven`.
3. **Corregir señales perversas**: no renovar vida con `uses` sin wins; filtrar candidatas irrelevantes en `pack.ts:103`; ventana/decay para wins-losses para que lecciones obsoletas caigan. Después, medir (A/B con/sin lecciones, intervenciones humanas por tarea) antes de afirmar mejora.
