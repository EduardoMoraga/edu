# 08 — Auditoría longitudinal determinista

## Veredicto
Hay aprendizaje mecánico incremental: feedback cambia estados, una decisión nueva revierte la anterior y mantenimiento propone una regla canónica. No está demostrada la reducción de trabajo humano ni la eficiencia de un LLM. Encontré pérdida de contexto útil y recuperación que mezcla recomendaciones vigentes y fallidas.

Harness de esta ejecución: Cloudroom / pi. Entorno declarado: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-6.1-sol`; identidad del backend no verificada independientemente. Los probes no llaman modelos.

## Método y reproducción
Primera operación: `room-cli files wait` → proyecto disponible. Sin instalaciones, commits, otros agentes ni cerebros/configuración reales. Herramientas `edu_*` no disponibles: uso de módulos reales sobre `mkdtemp('/tmp/08-longitudinal-*')`, sin setup. Identidad, brief, escritura, recall, lectura, feedback y cierre de tres sesiones quedan restringidos al fixture.

Desde `/code/edu`:

```sh
./node_modules/.bin/vitest run \
  --config audit/learning/08-vitest.config.ts --maxWorkers=1
```

Resultado final: **1 archivo / 1 test pasado**, duración 983 ms en esta ejecución. El test incluye múltiples aserciones. Produce `audit/learning/08-results.json` con textos completos, ranking/estados, métricas y salidas de procesos. Puede variar la duración y la ruta temporal, no se exige igualdad binaria del JSON.

Artefactos propios: `08-longitudinal.test.ts`, `08-fixture.mjs`, `08-vitest.config.ts`, `08-results.json`, este informe. No se modificó el prompt preexistente. Revisión final de archivos propios y `git diff --check -- audit/learning/08-*` sin errores; no se ejecutó la suite completa.

## Tres episodios y resultados externos
El oráculo es un **proceso Node separado**, sin imports de Edu: normaliza SKU y comprueba que Bob no reciba el resultado privado de Alice (`audit/learning/08-fixture.mjs:1-11`). Son resultados ejecutables sintéticos, no resultados de producción.

1. **1 enero:** lookup con espacios falla; aplicar trim pasa tres variantes de entrada. Se guarda lección útil con tres feedback positivos y una decisión inicial de caché global. Se agregan dos lecciones deliberadamente ajenas para medir ruido (`08-longitudinal.test.ts:52-67`).
2. **2 enero:** caché global falla aislamiento para tres SKU distintos. Los tres resultados alimentan feedback negativo de la lección fallida; no se inventan votos favorables (`08-longitudinal.test.ts:69-77`).
3. **3 enero:** nueva decisión con `supersedes` exige clave por usuario; pasan tres comprobaciones de aislamiento. La anterior queda `reverted`, la nueva `active`. Se cierra la tercera sesión (`08-longitudinal.test.ts:79-86`).

Hay 10 comprobaciones de origen: 4 fallos esperados y 6 éxitos. Además, seis snapshots reproducen dos comprobaciones cada uno: **22 procesos externos en total**.

El replay transforma dos hechos explícitos del brief en opciones del fixture mediante regex declaradas; es un **adaptador mecánico**, no un agente ni un LLM simulado (`08-longitudinal.test.ts:20-43`). Su éxito solo demuestra suficiencia para ese adaptador y ese fixture.

## Medición longitudinal
Dos hechos útiles predefinidos: recortar espacios de SKU y aislar caché por usuario. Se cuentan presencia/ausencia, no comprensión. El título útil contiene deliberadamente la instrucción: favorece la recuperación. `NOISE_` identifica solo distractores conocidos; encabezados, identidad e historial no se etiquetan automáticamente como ruido.

Tokens: **estimación de Edu**, no tokenizer del modelo (`src/context/tokens.ts:4-10`). Tokens útiles = líneas que contienen alguno de los dos hechos; pueden incluir texto adicional. Conteos por líneas redondeados, no una partición aditiva exacta.

| Estado | Hechos brief / 2 | Tokens brief | Tokens líneas útiles | Ruido conocido | Hechos recall / 2 | Regla obsoleta en recall | Replay SKU/aislamiento |
|---|---:|---:|---:|---:|---:|---|---|
| Vacío | 0 | 35 | 0 | 0 | 0 | no | falla/falla |
| Episodio 1 | 1 | 155 | 18 | 36 | 1 | sí | pasa/falla |
| Episodio 2 | 1 | 180 | 18 | 36 | 1 | sí | pasa/falla |
| Episodio 3 | 2 | 204 | 28 | 36 | 2 | sí | pasa/pasa |
| Mantenimiento inmediato | 2 | 188 | 27 | 36 | 2 | sí | pasa/pasa |
| Tras 210 días sin uso | 1 | 129 | 10 | 0 | 2 | sí | falla/pasa |

También se prueba contexto con query `checkout cache sku` y presupuesto 120: todos los snapshots respetan el límite estimado. Después del mantenimiento inmediato usa 109 tokens, conserva ambos hechos, incluye 36 tokens de distractores y difiere tres notas. A los 210 días usa 111 y pierde trim. El contexto con query y el brief sin query comparten ensamblador; en este fixture el presupuesto amplio produce los mismos hechos/conteos.

Recall se mide con límite 20 sobre los cuerpos completos, **sin presupuesto de contexto**: 137 tokens estimados antes del mantenimiento, 154 después y a largo plazo. No compararlo como coste total de una llamada LLM; faltan envoltorios, instrucciones y respuestas. El aumento incluye duplicación de la lección en una propuesta canónica.

## Hallazgos y evidencia de implementación
- **Mantenimiento inmediato funciona:** tres éxitos promueven la lección a `proven`; tres pérdidas retiran la fallida. Umbrales en `src/brain/learning.ts:20-29`; aserciones en `08-longitudinal.test.ts:88-92`.
- **Cambio de decisión preserva historia:** write exige anterior activa y marca `reverted` (`src/brain/brain.ts:165-172`). El brief solo muestra decisiones activas (`src/context/pack.ts:96-98`); ya no recomienda la global tras el episodio 3.
- **Recuperación contaminada:** `recall` no filtra `reverted` ni `retired` (`src/brain/brain.ts:178-183`). Ranking considera coincidencias y peso, sin tratamiento de vigencia (`src/brain/search.ts:15-36`). Tras mantenimiento devuelve tanto la decisión revertida como la lección fallida retirada; los estados están disponibles para que el consumidor los interprete. No demuestro que un modelo los obedecería.
- **Ruido ajeno a la consulta:** toda candidata puede entrar aunque no sea relevante (`src/context/pack.ts:100-108`). Las dos notas ajenas consumen 36 tokens tanto en brief como en el pack con query. La sección incluso se llama “Proven lessons” cuando contiene candidatas.
- **Pérdida a largo plazo:** 180 días sin uso retiran incluso una lección `proven` con tres resultados positivos (`src/brain/learning.ts:25-28`). En el salto de 210 días desaparece trim del brief: pérdida de **1/2 hechos**, aunque continúa vigente en el oráculo. No hay borrado de su contenido: `read` y `recall` aún lo recuperan (`08-longitudinal.test.ts:95-111`).
- **La propuesta no salva el contexto automático:** mantenimiento copia la lección a una propuesta, sin aceptarla (`src/brain/brain.ts:244-247`). El pack solo inyecta canónicas aceptadas (`src/context/pack.ts:81,111`). Esto respeta autorización humana, pero deja la continuidad dependiente de aprobación o recall explícito.
- **Compresión pierde detalles:** decisiones/lecciones solo aportan título; episodios solo primera línea (`src/context/pack.ts:97,108,118-120`). Las instrucciones de segunda línea de las sesiones no rescatan trim después de retirarse la lección. La utilidad de títulos es una dependencia, no comprensión semántica demostrada.
- **No confundir uso con éxito:** recall actualiza `uses/lastUsed`, feedback acepta un booleano (`src/brain/brain.ts:178-197`). Este probe aporta evidencia externa antes del feedback, pero la API no la exige ni enlaza cada resultado: `src/brain/learning.ts:10-17`.
- **Persistencia comprobada:** cerrar sesiones y mantener no altera el archivo cerrado comprobado; reabrir el cerebro reproduce el brief final (`08-longitudinal.test.ts:87-92,113-116`).

## Checklist
- [x] **Implementado:** tres episodios reales, sesiones cerradas, feedback, lectura/recall, cambio de decisión y mantenimiento sobre cerebro temporal.
- [x] **Implementado:** promoción, retirada, propuesta sin autoaceptación, presupuesto y persistencia tras reapertura.
- [!] **Roto respecto de la promesa de continuidad:** lección aún útil desaparece del contexto automático por inactividad; recuperación general mezcla reglas retiradas/revertidas.
- [!] **Roto respecto de contexto enfocado:** candidatas ajenas sobreviven al filtro de query y gastan presupuesto.
- [ ] **Ausente en esta ruta:** exigencia de resultados externos vinculados al feedback y protección de hechos útiles durante mantenimiento.
- [ ] **No demostrado:** menos reintentos, tokens reales, intervención humana o tiempo de trabajo de un LLM.

## Tres prioridades
1. Recuperación operacional consciente de estado/supersesión, con historial accesible aparte; impedir recomendaciones contradictorias por defecto sin borrar evidencia.
2. Vincular feedback a resultados externos reproducibles y evaluar sesiones longitudinales con/sin memoria usando el mismo modelo/harness. Medir reintentos, ayuda humana y coste real; no inferir mejora de consenso ni de `proven`.
3. Mantener continuidad de reglas útiles tras envejecimiento: revalidación explícita y resumen accionable bajo presupuesto, evitando retirar silenciosamente lo único que transmite el hecho; filtrar candidatas irrelevantes.

## Límites y cierre
Fixture pequeño, inglés, query exacta, reloj controlado y reglas elegidas por el auditor. Aislamiento de caché deliberadamente mínimo; no prueba seguridad de una aplicación real. Los resultados externos alimentan feedback mediante código del probe, no mediante integración automática de Edu. No se invocaron MCP, plugins de sesión, auto-mantenimiento del harness ni modelos; mantenimiento fue explícito. `trackUsage:false` evita que medir el brief cambie usos, pero recall sí registra uso: el salto temporal parte de su último acceso del 3 de enero. No se evaluó aprobación canónica humana.

Tres sesiones temporales cerradas. Sin notas durables reales. Queda abierta la validación longitudinal con un modelo y una tarea externa real; **no se promete eficiencia** a partir de esta prueba.
