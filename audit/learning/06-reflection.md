# 06 — Reflexión: episodio → propuesta → uso futuro

Harness/modelo efectivo de esta auditoría: Claude Code, Sonnet 5.5 (`claude-sonnet-5-5`). El modelo que usaría `edu reflect` en producción: el CLI por defecto de la config (`learn.ts:62-69`); **no ejecutado aquí** (motor falso).
Herramientas `rg/fd/eza/bat/brew` ausentes; usé `grep/find`. No toqué código funcional, ni cerebros reales, ni hice commits.

## Veredicto corto
- Hay **dos caminos**. (a) Determinista y específico: intervenciones evitables del usuario → lección con el texto observado. (b) LLM: lecciones/hipótesis/skills/canónicas con un prompt genérico; la especificidad depende solo del modelo y nada la comprueba.
- **Mejora real demostrada con LLM: ninguna.** Lo que probé es plomería determinista con un motor simulado.
- El lazo está **abierto en dos puntos**: nada dispara `reflect` automáticamente, y nada instala una skill aceptada salvo `edu install`.

## Flujo verificado (evidencia)
1. Episodio: `closeEpisode` cierra la sesión y escribe `reflect-queue/<run>.json` (`src/orchestrator/run.ts:322`).
2. **Disparo**: solo manual, `edu reflect` (`src/cli/commands/learn.ts:52-80`) o la skill `edu-reflect` (sugiere el comando, `plugins/agy/skills/edu-reflect/SKILL.md:28`). `grep reflect` en `hooks.ts`, `auto-maintain.ts`, `mcp/` → sin resultados. La cola `reflect-queue` **no la lee nadie como señal**; `reflect` la borra sin mirarla (`reflect.ts:75-82`).
3. Entrada del LLM: cuerpos de episodios cerrados, `run.end.summary` y tasa M-HIR por gap (`reflect.ts:28-34`). Instrucción de especificidad: solo "Only derive claims supported by the input" (`:30`). Sin plantilla genérica forzada, pero sin ejemplos ni exigencia de cita.
4. Salida validada con Zod estricto (`:9-15`); prosa → error duro y no escribe nada (P6).
5. Escritura: lecciones/hipótesis a `transitive` con `band` inferred/hypothesis (`:163`), skills a `proposals/*.md` con `status: proposed` (`:55`), canónicas vía `proposeCanonical` (`:61`).
6. Validación humana: `edu proposals accept|reject` (skills, `learn.ts:99-125`, `reflect/proposals.ts:27-49`) y `edu brain proposals|approve` (canónicas, `brain/proposals.ts:100`). Gate legítimo y bien ubicado.
7. Uso futuro: lecciones `candidate`/`proven` entran al pack de contexto (`context/pack.ts:100-109`); canónicas aceptadas solo si hay `query` (`:111`). Skills aceptadas viven en `.edu/skills/` y llegan al host solo con `edu install` (`adapters/common.ts:40-52`). **Playbooks: reflect nunca los modifica**; `loadPlaybook` solo lee (`orchestrator/playbook.ts:26`). La "lección → método" no existe.

## Pruebas (reproducibles)
Archivos: `audit/learning/06-probe.test.ts`, `06-vitest.config.ts`. Motor falso, brain en `/tmp` (`mkdtemp`), sin red.
```
npx vitest run --config audit/learning/06-vitest.config.ts --maxWorkers=1 --disableConsoleIntercept | grep -E "^P[0-9]"
```
Resultado: 6 pasan, 1 falla **a propósito** (P2 muestra un crash real).

| Prueba | Resultado observado |
|---|---|
| P1 | Intervención "you forgot to use the file src/auth.ts" → lección `Harness gap: context — composer-message: you forgot to use the file src/auth.ts`, `candidate`, tag `harness-gap:context`, `inferred`. Específica del error observado. M-HIR llega al prompt; `autonomy: readonly`. |
| P2 | Dos reflexiones con la misma lección del LLM → la 2ª lanza `Note id already exists: L-always-read-auth-ts-first`. **Crash por duplicado**, sin dedup (`brain.ts:170`). `evidence` con id inexistente se acepta sin validar (`reflect.ts:163`). |
| P3 | Feedback `helpful:true` del LLM x3 sobre una lección con `uses:0` → `proven` (wins=3) y `maintain` genera propuesta canónica. Una "prueba" sin ningún uso real. |
| P4 | `feedback.id` inexistente → lanza `Note not found: nope` **después** de haber escrito 1 lección; la cola no se consume. Estado parcial; el reintento chocará con P2. |
| P5 | Skill `Bad Name!` → `bad-name`; `accept` escribe `"no frontmatter at all"` como `SKILL.md` sin validar formato. La lección candidata aparece en el pack. Aceptar abre/cierra un episodio "Accepted skill proposal…". |
| P6 | Respuesta en prosa → `Reflection response must be strict JSON`, nada escrito. |
| P7 | Misma intervención evitable, 2ª ejecución → crash `Note id already exists: L-harness-gap-context-…`. |

## Fallos confirmados
1. **Dedup de lecciones por intervención roto**: la clave guardada usa `tags.join(',')` = `harness-gap:context,lesson` (la nota guarda además el tag `lesson`) pero se compara contra `title\nharness-gap:context` (`reflect.ts:86,93`). Nunca coincide → la 2ª ejecución revienta (P7). Los tests existentes no lo cubren (`reflect.test.ts`). Consecuencia práctica: reflect no es idempotente; cualquier ventana `--since 7d` solapada falla en cuanto haya una intervención evitable repetida.
2. **Mismo defecto con lecciones del LLM** (P2): el mismo título → crash completo y a mitad de escritura.
3. **Promoción sin uso real** (P3): `feedback` del LLM cuenta como win (`brain.ts:194`, `learning.ts:10`); `lessonStatus` promueve con 3 wins (`learning.ts:28`). Sin gate de evidencia independiente. Mitigado solo porque lo canónico exige aprobación humana.
4. **No atomicidad** (P4): escribe notas, luego falla; sin transacción ni reanudación.
5. **Heurística de "evitable" pobre**: regex de 7 frases en inglés (`run.ts:482-484`). Correcciones en español o sin esas palabras no generan lección determinista. El `harnessGap` es `context` para todo mensaje evitable y `feedback` para rechazos; no diagnostica la causa.
6. **Skills aceptadas sin validación** de estructura (P5) y sin ruta automática a los hosts.
7. **Episodios**: el cuerpo es el `text` del cierre (`run.ts:318`); su calidad condiciona todo lo demás. No lo medí con corridas reales.

## Qué no pude demostrar
- Que el LLM produzca lecciones específicas y útiles con episodios reales: sin ejecutar un motor real, es **hipótesis no probada**.
- Que una lección o skill reduzca trabajo repetido o ayuda humana: no hay experimento antes/después. Ni existe métrica de "lección aplicada → mejora" (el `uses` mide inclusión en contexto, `pack.ts:123`, no efecto).
- Que "el consenso" valga: un lote de propuestas aceptadas no prueba eficiencia.

## Checklist
| Capacidad | Estado |
|---|---|
| Lección específica desde intervención observada | **Implementado** (P1), frágil por regex |
| Idempotencia/dedup de reflect | **Roto** (P2, P7) |
| Disparo automático / por cola | **Ausente** (la cola se escribe y se borra) |
| Lecciones del LLM ancladas a evidencia verificable | **Parcial**: campo `evidence` sin validar |
| Gate humano para skills y canónicas | **Implementado** (correcto) |
| Validación de contenido de skill al aceptar | **Ausente** |
| Skill aceptada → host sin intervención | **Ausente** (requiere `edu install`) |
| Playbooks actualizados desde lecciones | **Ausente** |
| Promoción de lección por efecto medido | **Ausente / manipulable** (P3) |
| Atomicidad/reintento tras fallo | **Roto** (P4) |
| Medir reducción de trabajo repetido | **Ausente** |

## Límites humanos legítimos (no automatizar)
Aceptar skills y estándares canónicos: cambian el comportamiento futuro de todos los agentes. El diseño actual lo protege bien. Lo que sí debe ser automático es el disparo y la deduplicación.

## Tres prioridades
1. **Arreglar idempotencia**: construir la clave de dedup con los mismos tags guardados (o por id), ignorar duplicados en lugar de lanzar, y validar `feedback.id`/`evidence` antes de escribir (`reflect.ts:86-93,40-48`). Añadir test con dos ejecuciones seguidas.
2. **Cerrar el lazo del disparo**: usar `reflect-queue` como señal real (p. ej. aviso en `edu brief` cuando haya N episodios pendientes, o disparo al cerrar sesión) y consumirla solo tras éxito, por entrada procesada.
3. **Evidencia independiente para promover**: no contar `feedback` del LLM como win; exigir uso real en un episodio posterior y registrar si una lección incluida en contexto evitó una intervención (métrica antes/después de M-HIR por gap). Validar frontmatter de skill antes de aceptar. Sin esto, "aprendizaje que reduce trabajo" sigue sin demostrarse.
