# 03 — Autogestión y cierre del aprendizaje incremental

**Veredicto:** el ciclo cierra parcialmente. Hay recuperación de lecciones y mantenimiento automático por eventos; no hay cierre autónomo probado de episodio → reflexión → aprendizaje causal → menor ayuda humana. La cola no tiene consumidor automático en el código inspeccionado, y su consumo manual pierde precisión.

## Alcance y método

- Auditoría directa de `src`, adapters y plugins; no se usó la auditoría anterior como evidencia.
- Primer comando: `room-cli files wait` → proyecto preparado en `/code/edu`.
- Harness de esta ejecución: Codex en Cloudroom; identificador exacto del modelo efectivo **desconocido**.
- Harness probado: módulos reales de Edu y MCP en memoria; orquestador **H3**; motores guionados `Engine` con etiqueta `codex`, **ningún modelo/CLI LLM ejecutado**.
- Sin herramientas `edu_*` disponibles: brief y cierre mediante módulos/MCP sobre fixtures `/tmp/03-autonomy-*`, eliminados al terminar. Sin setup, dependencias, commits, scheduler ni modificaciones funcionales o de cerebros reales.
- Archivos propios: este informe, `03-autonomy.probe.test.ts` y `03-autonomy.vitest.config.mjs`.

## Cuándo corre cada parte

| Entrada | Comportamiento verificado en código | Evidencia |
|---|---|---|
| Claude SessionStart | Imprime brief; no abre sesión | `src/adapters/claude.ts:25`, `src/cli/hooks.ts:38`, `src/cli/hooks.ts:45` |
| Claude SessionEnd | Crea y cierra **otra** sesión; guarda motivo/ruta de transcript, no su contenido; mantiene | `src/cli/hooks.ts:51` |
| Codex notify | Cada `agent-turn-complete` crea episodio con pregunta/respuesta recortadas y mantiene | `src/adapters/codex.ts:13`, `src/cli/hooks.ts:68` |
| Pi before_agent_start | Ejecuta hook de brief e inyecta stdout; shutdown mostrado solo limpia UI/timer | `plugins/pi/extensions/edu.ts:161`, `plugins/pi/extensions/edu.ts:380` |
| MCP brief | Brief a demanda; presupuesto predeterminado 800 | `src/mcp/server.ts:119` |
| CLI brief | Brief a demanda de 1500; query añade recall | `src/cli/hooks.ts:35`, `src/cli/commands/integrations.ts:18` |
| MCP session_close | Cierra y llama auto-maintain, incluyendo fallback | `src/mcp/server.ts:174` |
| Run del orquestador | Abre sesión; cierra/enfila reflexión; al finalizar genera paquete y mantiene | `src/orchestrator/run.ts:109`, `src/orchestrator/run.ts:317`, `src/orchestrator/run.ts:355` |
| auto-maintain | Throttle de 10 minutos; cambia estados y reconstruye índices; no invoca motor | `src/brain/auto-maintain.ts:10`, `src/brain/auto-maintain.ts:32`, `src/brain/brain.ts:227` |
| maintain explícito / migración | Fuerzan mantenimiento, sin throttle | `src/cli/commands/brain.ts:170`, `src/update/migrate.ts:33` |
| reflect | CLI explícita, requiere CLI disponible; analiza sesiones cerradas desde `created`, ventana por defecto 7d | `src/cli/commands/learn.ts:53`, `src/reflect/reflect.ts:20` |

`rg` sobre producción encontró una llamada a `reflect`: la CLI. La cola se escribe al cerrar un run y solo se borra al final de `reflect`; no dispara trabajo por sí misma. No se ejecutaron loops para verificarlo.

## Pruebas reproducibles

Desde `/code/edu`, con dependencias existentes:

```sh
./node_modules/.bin/vitest run \
  --config audit/learning/03-autonomy.vitest.config.mjs \
  --maxWorkers=1 --no-cache --configLoader runner --reporter=verbose
rg -n 'reflect\(|reflect-queue|autoMaintain\(' src --glob '!*.test.ts'
```

Resultado final: **9/9 probes pasan**, 1 archivo, 2,16 s. Son aserciones del comportamiento observado, incluidos defectos; no nueve garantías de corrección.

| Probe (archivo `audit/learning/03-autonomy.probe.test.ts`) | Resultado |
|---|---|
| `:38` Persistencia y brief | Tres feedback positivos → `proven`; reabrir Brain conserva lección y brief muestra título; propuesta canónica queda `proposed`; segunda manutención queda throttled |
| `:50` Cola y ventana | auto-maintain conserva entrada; reflect de 1d elimina incluso una entrada antigua cuyo `sessionId` no fue analizado |
| `:58` Cola sin episodios | reflect devuelve cero y deja entrada pendiente |
| `:63` Reintento de intervención | Segunda reflexión aborta con `Note id already exists`; queda una sola lección |
| `:69` Feedback repetido | Tres reflexiones sobre **un** episodio suman tres wins; mantenimiento promueve a `proven` |
| `:78` Fallo de reflexión | Respuesta inválida del motor rechazada, pero la lección de intervención ya fue escrita |
| `:83` Sesiones concurrentes | `id=A-typo`, sin source, cierra B (más reciente) con resumen de A; A queda abierta |
| `:98` Recuperación H3 | Checks `[false,false,true]`; dos atribuciones; corrección guionada; un pendiente de reflexión y cero lecciones al terminar |
| `:123` Hooks | Start no abre sesión; End deja abierta sesión explícita; dos notificaciones idénticas crean dos episodios adicionales |

Fallo durante investigación: el primer probe esperaba duplicados de intervención y obtuvo colisión de ID (6/7 pasaban). Se corrigió **la hipótesis del probe**, no producción; se separó el caso de feedback sin intervenciones. Repetición final con playbook temporal explícito: 9/9.

## Hallazgos y causalidad

**1. Cola sin activación automática y confirmación de consumo incorrecta.**
`src/reflect/reflect.ts:75` elimina todos los `.json`, sin leer runId/sessionId ni limitarse a episodios procesados. `:21` selecciona por creación de sesión; una sesión larga cerrada hoy puede quedar fuera de 7d. `:22` retorna antes de consumir si no encuentra sesiones. Probe `:50` demuestra borrado de una entrada no analizada; una llegada concurrente también está expuesta por diseño, aunque no probé esa carrera.

**2. Reflexión no idempotente: reintentar puede bloquear o inflar evidencia.**
La clave existente usa todos los tags (`src/reflect/reflect.ts:86`); la nueva usa solo `harness-gap:*` (`:93`). `brain.write` añade `lesson` (`src/brain/brain.ts:158`), por lo que la comparación falla. El ID deriva del título (`src/brain/store.ts:25`) y el duplicado se rechaza (`src/brain/brain.ts:170`). La intervención se escribe antes de validar salida del motor (`src/reflect/reflect.ts:27`, `:38`): un fallo deja efectos parciales y su reintento encuentra la colisión.
Sin intervención, feedback se reaplica sin identidad de episodio ni deduplicación (`src/reflect/reflect.ts:48`, `src/brain/learning.ts:10`). Tres votos del mismo episodio pueden cumplir la regla de promoción (`src/brain/learning.ts:28`). `proven` es un estado heurístico, no validación causal independiente.

**3. La lección reaparece, pero no se demuestra que evite trabajo.**
El brief incluye candidatas/probadas según presupuesto y orden; inyecta **títulos**, no cuerpos (`src/context/pack.ts:100`, `:108`). Actualiza usos (`:125`); uso no equivale a éxito. El probe acredita persistencia, promoción y reinyección de una lección marcada útil. No acredita utilidad real de ese consejo, cumplimiento por un modelo ni reducción de intervenciones. El orquestador registra contexto con `influenced:false` (`src/orchestrator/run.ts:105`); no encontré llamada suya a `brain.feedback`.

**4. Reatribución observable limitada a evidencia de checks.**
H3 reproduce, verifica y vuelve a emitir `failure.attribution` ante otro fallo (`src/orchestrator/run.ts:366`, `:377`). El probe ejecuta checks reales y demuestra dos atribuciones antes de la corrección exitosa. Cada atribución contiene observado/esperado, pero `alternatives: []` y una instrucción genérica (`:395`). La vuelta al diagnóstico es texto del prompt (`:252`), no una transición que exija invalidar la hipótesis previa. No se ha demostrado reatribución causal LLM. La reflexión carga task/outcome/intervenciones, no `attribution.jsonl` (`src/reflect/reflect.ts:125`), así que tampoco conecta esas atribuciones detalladas automáticamente al aprendizaje.

**5. Sesiones: aislamiento insuficiente y episodios huérfanos.**
El fallback MCP sin source elige la sesión abierta más reciente (`src/mcp/server.ts:183`); con source exige coincidencia única. Un ID exacto tampoco valida propietario. Los hooks crean sesiones nuevas (`src/cli/hooks.ts:63`, `:84`), sin conciliar la abierta explícitamente ni deduplicar host/turn ID. El probe reproduce ambos comportamientos sin concurrencia temporal; basta coexistencia de dos sesiones.

**6. Mantenimiento best-effort puede ocultar trabajo pendiente.**
Captura excepciones y devuelve razón (`src/brain/auto-maintain.ts:43`); los cierres MCP/hooks/orquestador ignoran ese resultado. El throttle consulta/escribe sello sin lock (`:35`): exclusión entre procesos no demostrada. No probé carreras ni pérdidas de escrituras; quedan como riesgo, no defecto reproducido.

## Trabajo humano o externo todavía necesario

- Invocar `reflect` mediante CLI/agente/automatización externa: no hay consumidor autónomo conectado en el flujo inspeccionado.
- Proporcionar/obtener feedback útil: recordar/incluir una nota solo aumenta usos; el resultado del run no se convierte automáticamente en wins/losses atribuibles.
- Revisar y aceptar propuestas canónicas/skills: intención explícita de control humano (`src/brain/brain.ts:153`, `src/cli/commands/learn.ts:84`). Una skill con solo diff exige documento completo revisado (`src/reflect/proposals.ts:31`). Es una frontera deliberada, no un bug.
- Resolver sesiones explícitas que el hook no cierra y fallos/reintentos de reflexión. Las aprobaciones del run dependen de política/playbook (`src/orchestrator/run.ts:237`); no son universalmente obligatorias.

## Checklist

- [x] **Implementado:** brief recupera títulos de lecciones persistidas; promoción/retiro por feedback y antigüedad.
- [x] **Implementado:** cierre de run, paquete de evidencia, encolado y mantenimiento con throttle.
- [x] **Implementado:** checks H3 y reemisión de atribución observada con corrección acotada.
- [!] **Roto:** reintento de intervención colisiona; reflexión fallida deja escritura parcial.
- [!] **Roto:** consumo global de cola y feedback repetible sin evidencia independiente.
- [!] **Roto:** fallback de sesión puede cerrar la de otro agente; hooks no concilian sesiones.
- [ ] **Ausente en el flujo inspeccionado:** consumidor automático de reflexión con ack por episodio/reintento.
- [ ] **No demostrado:** aprendizaje causal de fallos y reducción incremental de esfuerzo/ayuda humana en ejecuciones LLM.

## Tres prioridades

1. **P0 — Hacer reflexión/cola idempotentes antes de automatizarlas:** clave por episodio+intervención, feedback deduplicado, validación previa y ack solo de entradas procesadas. Después conectar consumidor acotado; añade estado operativo, evita amplificar errores automáticamente.
2. **P1 — Aislar sesiones por host/thread/turn/propietario:** rechazar ID desconocido sin selección inequívoca; reconciliar hooks y cierres explícitos. Menos comodidad del fallback, a cambio de no atribuir trabajo al agente equivocado.
3. **P1 — Medir transferencia verificable:** enlazar diagnóstico refutado, corrección, lección y resultado posterior; evaluar tareas repetidas con modelo real/control y M-HIR/tiempo/coste. Exigir evidencia antes de `proven`; mayor coste de evaluación, sin confundir reinyección o votos repetidos con eficiencia.

Limitaciones: auditoría acotada, fuentes actuales en checkout compartido; sin ensayo longitudinal LLM ni validación de entrega de hooks por hosts reales. No se ejecutaron tests globales ni schedulers. Quedan abiertos consumidor, idempotencia, propiedad de sesiones y demostración empírica de menor ayuda humana; no se guardaron notas durables reales.
