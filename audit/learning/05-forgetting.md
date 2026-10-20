# 05 — Olvido y memoria funcional al crecer

Agente: Claude Code, modelo efectivo `claude-sonnet-5-5` (dato del system prompt). Fecha: 2026-10-20. Sin LLM en las pruebas.
Alcance: ruido, contradicciones, supersedes, lecciones obsoletas, promoción/retirada, aislamiento global/proyecto, presupuesto.

## Veredicto (corto)
El olvido es **mecánico y determinista, pero solo reacciona a feedback explícito (`edu_feedback`) o a inactividad**. No hay control semántico: nada detecta ruido, duplicados ni contradicciones entre lecciones. La retirada por antigüedad **no funciona para lo que se inyecta**, porque inyectar refresca `lastUsed`. La mejora de calidad por LLM **no está demostrada** aquí (no se ejecutó ningún LLM).

## Método reproducible
- Probes: `audit/learning/05-probe.ts` y `05-probe-c.ts` (cerebros temporales en `/tmp`, borrados al final; sin tocar cerebros reales).
- Ejecución: `npx esbuild audit/learning/05-probe.ts --bundle --packages=external --platform=node --format=esm --outfile=audit/learning/05-probe.build.mjs && node audit/learning/05-probe.build.mjs` (idem `05-probe-c`). Borré los `.build.mjs`.
- Usa módulos reales: `openBrain`, `buildContext`, `maintain`. Reloj inyectado (`now`) para simular días.
- No se ejecutó Vitest (los probes no son tests del repo). No se cambió código funcional.

## Mecanismos verificados (código)
- Estados de lección: candidate→proven→retired — `src/brain/lifecycle.ts:21-24`.
- Promoción: `wins>=3 && weight>=0.7` — `src/brain/learning.ts:28`. Solo `feedback` suma wins/losses (`learning.ts:10-13`); `recordUsage` solo suma `uses` (`learning.ts:15-18`).
- Retirada: `losses>=3 && weight<0.35` o `unusedDays>=180` — `learning.ts:26`.
- `maintain` propone un canónico `standard` al promover una lección, y no repropone si ya hay propuesta/rechazo — `src/brain/brain.ts:244-248`.
- Contexto: lecciones solo `proven|candidate`; retiradas excluidas — `src/context/pack.ts:100`.
- Decisiones: nueva con `supersedes` revierte la anterior (`brain.ts:166-172`); contexto solo `active`, máx. 8 — `pack.ts:96`.
- Canónicos: aceptar uno con `supersedes` marca el viejo `superseded` — `brain.ts:209-212`.
- Aislamiento: `overlayNotes` mezcla ubicaciones por id, el proyecto gana — `src/brain/store.ts:153-156`.
- Brief y chat registran uso por defecto: `src/context/brief.ts:6`, `src/chat/respond.ts:45`, `src/cli/run/session.ts:53`.

## Resultados de los probes
### A. Ruido (60 lecciones candidatas irrelevantes + 2 proven relevantes "Deploy…", query `deploy`)
| presupuesto | tokens | lecciones inyectadas | "Deploy" inyectadas |
|---|---|---|---|
| 150 | 136 | 0 | 0 |
| 400 | 398 | 1 | 1 |
| 1500 | 1392 | **62** | 2 |
- Con presupuesto holgado se inyectan las 60 candidatas sin relación con la query. Causa: `pack.ts:103` exime a las `candidate` del filtro de relevancia. Ruido = coste de tokens sin límite propio.
- Con 400 tokens, solo cabe 1 de las 2 lecciones relevantes (la proven va primero por `pack.ts:104`, así que el orden protege lo útil; lo desplazado es la segunda).

### B. Contradicción (`Always use tabs` vs `Never use tabs, use spaces`, la segunda con `supersedes` a la primera)
- Resultado: **ambas `proven` e inyectadas a la vez**. La vieja sigue `proven`.
- `supersedes` en una lección se guarda en el frontmatter pero **ningún código lo interpreta** (`brain.ts:166` y `:209` solo tratan decision y canónico). Contradicción de lecciones = **ausente**.

### C. Retirada
- Lección con 3 `feedback(false)`: `retired` tras `maintain`, desaparece del contexto. **Funciona** (determinista).
- Lección candidata inyectada cada 60 días durante 360 días, sin feedback: sigue `candidate` (`uses:6, wins:0, losses:0`) y **sigue inyectada** el día 361. Control sin inyección explícita también sigue candidate (porque las candidatas se inyectan siempre, ver A).
- Causa: `recordUse` fija `lastUsed` (`learning.ts:17`) y `unusedDays` parte de `lastUsed` (`learning.ts:25`). Inyectar ≠ ser útil, pero cuenta como "uso reciente". Sin feedback explícito, una lección mala nunca se retira. **Roto** para el caso por defecto (nadie llama a `edu_feedback` siempre).
- Si no se inyecta nunca (cerebro sin sesiones) y pasan 180 días desde `created`, sí se retira. Esto se vio de rebote en la primera ejecución del probe (mi `maintain(new Date())` retiró lecciones de 290 días).

### D. Promoción
- 10 usos (`recordUse`) sin feedback: sigue `candidate`. 3 `feedback(true)`: pasa a `proven`, `maintain` crea 1 propuesta canónica `proposed:Run lint before push`. Segundo `maintain`: no repropone (total 1).
- La propuesta **no se inyecta** hasta ser `accepted` (necesita humano). Diseño correcto, pero el bucle depende de un humano que acepte y de que alguien dé feedback.

### E. Presupuesto vs conocimiento útil (40 standards aceptados + 1 decisión + 1 lección proven)
| presupuesto | standards | decisión | lección |
|---|---|---|---|
| 300 | 0 | no | no |
| 600 | 3 | sí | sí |
| 1200 | 17 | sí | sí |
| 2500 | 40 | sí | sí |
- A 300 tokens el identity core se come el presupuesto y se pierde todo lo aprendido. A ≥600 la decisión y la lección entran porque son líneas cortas que caben tras agotar los standards (el `add` no corta, solo rechaza la línea que no cabe — `pack.ts:56-59`).
- Los standards (`pack.ts:81-86`) van antes que decisiones y lecciones y **no tienen tope propio ni orden por relevancia** (orden por kind/id). Con muchos standards, quedan fuera por azar de id, no por utilidad. Crecimiento sin control semántico.

### F. Decisiones y supersedes
- D2 con `supersedes` D1: D1 pasa a `reverted`, el contexto solo muestra D2. **Funciona**. `recall('MySQL')` aún devuelve la revertida (`reverted:Use MySQL`), marcada pero rankeada; no se filtra. Aceptable, pero un agente que no lea el estado podría citarla.

### G. Aislamiento
- Proyecto A ve `[Global lesson, ProjA only lesson]`; proyecto B ve `[Global lesson]`. **Sin fuga entre proyectos**.
- `feedback` de B sobre una nota global se escribe **en el archivo global** (`losses:1`), no en B. Un proyecto puede hundir una lección global para todos los demás: una sola mala experiencia local la acerca a la retirada global (`losses>=3`). No hay feedback por proyecto.

## Checklist
| Capacidad | Estado |
|---|---|
| Retirada por 3 pérdidas | Implementado (C) |
| Retirada por 180 días sin uso | **Roto** para notas inyectadas (C) |
| Promoción por wins | Implementado, solo vía feedback explícito (D) |
| Propuesta canónica sin duplicar | Implementado (D) |
| Supersedes de decisiones | Implementado (F) |
| Supersedes de canónicos | Implementado en código (`brain.ts:209`), sin probar aquí |
| Supersedes de lecciones | **Ausente** (B) |
| Detección de contradicciones/duplicados semánticos | **Ausente** (B; ids por título solo evitan títulos idénticos) |
| Filtro de ruido en candidatas | **Roto** (A) |
| Tope/relevancia en standards inyectados | **Ausente** (E) |
| Aislamiento entre proyectos | Implementado (G) |
| Feedback por ámbito (proyecto vs global) | **Ausente** (G) |
| Recall excluye revertidas/retiradas | Parcial: no filtra (F) |
| Mejora medida de LLM por olvido | **No demostrada** |

## Limitaciones
- Probes con notas sintéticas; relevancia = BM25 léxico, sin embeddings ni LLM.
- No probé `edu_*` MCP ni CLI (sin setup); sí los módulos que usan.
- No medí tokens reales de un modelo: `estimateTokens` del repo.
- Hipótesis no probada: que en uso real los agentes llamen a `edu_feedback` con frecuencia. Sin ello C y D degeneran.
- No probé tasas de `maintain` con miles de notas (rendimiento).

## Tres prioridades
1. **Separar "inyectada" de "usada con éxito"**: que `recordUse` no refresque `lastUsed` para la regla de 180 días (campo aparte `lastInjected`), y que una candidata inyectada N veces sin wins ni feedback se retire. Toca `learning.ts:25` y `brain.ts:185`.
2. **Filtrar candidatas por relevancia con query y poner tope** (p. ej. máx. 3 candidatas sin query), y dar tope/ranking por relevancia a los standards (`pack.ts:81,103`).
3. **Implementar `supersedes` para lecciones**: en `maintain`/`write`, marcar la antigua `retired` cuando la nueva la reemplaza; avisar al humano de contradicciones por solapamiento de términos con polaridad opuesta (heurística determinista, no consenso LLM). Además, feedback por ámbito en notas globales.
