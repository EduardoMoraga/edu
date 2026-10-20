# Review cruzada (solo lectura): retrieval / context / reflect

Alcance: `src/brain/search.ts`, `resolve.ts`, `src/context/{pack,tokens}.ts`, `src/reflect/*` (estado del árbol compartido en el momento de la revisión; reflect aún en edición). Sin fixes, commits ni cambios en código. Repros ejecutados con Vitest desde fuera del repo (`/tmp/edu-review`, config propia, cerebros temporales); el fuente está en `audit/v2/review-retrieval-reflection.repro.test.ts.txt` (R1..R8).
Comando: `npx vitest run --config /tmp/edu-review/vitest.config.mjs --maxWorkers=1 --disableConsoleIntercept`.

## Hallazgos

### 1. ALTA — La cola de reflexión se bloquea con entradas atascadas (R1)
`queueSnapshot` aplica `.slice(0, maxEntries)` (50) **antes** de validar (`consolidate.ts`, orden por nombre). Las entradas malformadas, de runs sin `outcome.json` aún, o de sesiones no cerradas/viejas se saltan pero siguen ocupando las 50 primeras plazas. Repro: 50 entradas `a-000..049` con sesión inexistente + 1 entrada válida `z-valid` → `consolidatePending` devuelve `lessons:0, acknowledged:0, skipped:50`; la válida nunca se procesa mientras las atascadas existan. Contradice "colas que no pierden entrada": no se pierde, pero se retrasa indefinidamente (sin envejecimiento ni cuarentena). Lo mismo afecta a `reflect` (usa el mismo snapshot). Sugerencia: validar/filtrar antes de acotar, o paginar con cursor, y poner en cuarentena/contar entradas inválidas.

### 2. ALTA — Un lock obsoleto desactiva para siempre consolidación, reflect y accept/reject de skills (R2)
`locked()` nunca recupera un `.reflection.lock` huérfano (pid muerto, proceso matado). Repro: fichero `.reflection.lock` con pid inexistente → `consolidatePending` devuelve `busy:true` indefinidamente; `reflect` lanza "already running (or its lock requires recovery)"; `acceptProposal/rejectProposal` (ahora bajo el mismo lock) fallan igual. El mensaje promete "recovery" pero no existe camino. Además `finally { await handle.close(); await rm(path) }` sin `force`: si el lock fue borrado, el `rm` lanza y enmascara el resultado/error de la acción. El lock se mantiene durante toda la llamada al LLM, así que aceptar una skill se bloquea mientras reflect corre.

### 3. MEDIA — Reintento con cuerpo con salto de línea final → "Reflection identity collision" permanente (R3)
`writeOnce` compara `existing.body !== input.body`; el cerebro guarda el cuerpo recortado (`trim`), el modelo suele devolver `"...\n"`. Repro: salida `{lessons:[{title:'L',body:'Always do X\n',evidence:[]}]}` → 1ª ejecución OK; 2ª con la misma salida (o reanudación tras fallo parcial) lanza `Reflection identity collision: L-l-…`. En una reanudación eso aborta antes de `acknowledge`, dejando la cola sin confirmar y el journal en bucle de fallo. Lo mismo con `\r\n`. Sugerencia: comparar normalizado (trim/CRLF) o incluir el cuerpo normalizado en la identidad.

### 4. MEDIA — Informe de feedback/canónicos que no se aplicaron (evidencia falsa en el reporte) (R4)
- `report.feedback` lista los ids del feedback del modelo aunque ya no se llama `brain.feedback` (decisión correcta de seguridad). Repro: `feedback:[{id:'L-old-proven',helpful:true}]` → `report.feedback=['L-old-proven']`, `usage` de la nota sigue `undefined`. Un consumidor lo leerá como crédito aplicado. Renombrar (`feedbackIgnored`/`advisoryOnly`) o dejar vacío.
- `report.canonicalProposals` incluye ids que `writeOnce` devolvió sin crear porque existe un rechazo previo (repro R4b: informe dice 1 propuesta, `proposed` en el cerebro = 0).
- Lecciones/hipótesis/canónicas con `evidence: []` (el esquema lo permite) se enlazan a **todos** los episodios seleccionados (`links()`), fabricando procedencia que el modelo no citó (R4a: links = ambos episodios). Debería exigir evidencia o marcar "sin cita".
- El bucle de lecciones `proven` propone canónico para **toda** lección proven suministrada sin propuesta canónica enlazada (incluidas históricas/importadas); `maintain` deliberadamente no lo hace ("solo la promovida por ESTA corrida"). Comportamiento ampliado sin que el plan lo pida (sigue requiriendo aceptación humana, por eso MEDIA/BAJA).

### 5. MEDIA — Rendimiento: `relevantPassage` calculado para todos los hits y descartado en `pack` (R8)
`rankNotes` añade `Passage:` al `why` de **cada** hit. `pack.ts` llama `rankNotes(query, candidates, now, candidates.length)` y usa solo `hit.note` (su propio `bodyPassage`). Medido: 1 passage de un cuerpo de 57 KB ≈ 110 ms; `rankNotes` de 50 notas de ese tamaño con límite 50 = 4,6 s vs 0,15 s con límite 1; `buildContext` con 400 lecciones de 57 KB = **37 s**; un cuerpo de 1 MB cuesta ≈ 1,4 s *por hit*. `relevantPassage` es O(tokens × ventana). Rompe el presupuesto de latencia de session-start/hook. Sugerencia: calcular el passage solo para los `limit` finales y con tope de longitud del cuerpo; pack no debe pedirlo.

### 6. MEDIA — `normalizeReference` aplicado a consultas de búsqueda corta la consulta en `|` (R5)
`rankNotes` normaliza la **consulta** con la lógica de wikilink (`split('|')[0]`, quita `[[`/`]]`). Repro: notas `alpha` y `beta`: `rankNotes('alpha | beta')` → solo `L-a`; `rankNotes('| beta')` → `[]`. Una consulta legítima con barra vertical pierde términos sin aviso (y alimenta `pack`/`recall`). Solo debería aplicarse cuando la consulta entera es un wikilink `[[...]]`.

### 7. BAJA/MEDIA — Pasaje mostrado por `pack` no usa el vocabulario/sinónimos de búsqueda (R7)
`bodyPassage` (pack) tokeniza sin sinónimos ni stopwords; `rankNotes` sí. Repro: lección ES "Nunca reintentar un pago sin clave de idempotencia" encontrada con la consulta `retry payment` (sinónimos), pero el contexto muestra el primer párrafo irrelevante ("Intro sobre estilo de commits…"). El hit es correcto pero el fragmento inyectado no contiene la regla → el modelo recibe una nota sin su parte útil. Reutilizar `relevantPassage` (con límite) en pack.

### 8. BAJA — Resúmenes de runs: archivos grandes se descartan sin contarse (código)
`readRunSummaries` ignora (`catch → continue`) cualquier `.jsonl` de >256 KB y `omitted.runSummaries` solo cuenta los recortados por presupuesto, no los ficheros descartados: el informe de omisiones subestima. Mismo patrón: `readInterventions` devuelve `undefined` para >200 líneas de intervención (la entrada queda en cola para siempre, ver hallazgo 1).

### 9. BAJA — Lecciones con `superseded_by`/retiradas y modo sin consulta (código, no reproducido)
`isOperationalNote` filtra `superseded_by` solo en búsqueda; `pack` sin consulta incluye lecciones/decisiones por `status` (`candidate/proven/active`) y no revisa `superseded_by` (p. ej. importadas con ese campo sin estado retirado). La lección retirada por mi unidad (crédito) sí tiene `status: retired`, por lo que queda fuera. Para datos importados es un hueco menor.

## Comprobado sin hallazgo
- Presupuesto de `buildContext`: con consulta y presupuestos 0,1,5,10,20,33,50,100,300 el `tokens` nunca supera el presupuesto (R6); `truncateToTokens` respeta el límite con emoji, combinantes, CJK y puntuación (R6, 5 textos × 5 límites).
- Validación total de la respuesta del modelo antes de escribir: evidencia ids limitados a lo suministrado; feedback a notas no episódicas suministradas; el modelo no puede verificar (no llama `brain.feedback`).
- Acknowledge por rename + comparación de contenido evita borrar una entrada reescrita por el productor; el journal de resultados permite reanudar sin repetir la llamada al LLM.

## Límites
Revisión de código + repros acotados; no ejecuté la suite completa ni `reflect` real con LLM. El snapshot `session-start-brief.txt` cambia 665 líneas (no auditado: lead dice que se está cerrando). No afirmo que estos cambios mejoren o empeoren eficiencia de agentes.
