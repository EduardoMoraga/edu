# 04 — Crédito y ciclo de vida (Propiedad 4)

Sin commits ni cambios de versión/paquete. Sin medición con LLM: nada aquí demuestra eficiencia de agentes.

## Archivos
- `src/core/contracts.ts`: `UsageStats` (+`verifiedWins`, `verifiedLosses`, `lastVerified`, `events`, todos opcionales) y nuevo `FeedbackContext {eventId, verified, evidence?}`.
- `src/brain/learning.ts`, `src/brain/brain.ts`. `frontmatter.ts` sin cambios: el anidado `usage.*` serializa bien (test de ida y vuelta).
- Tests: nuevo `src/brain/credit.test.ts` (16 casos); ajustados `learning.test.ts`, `brain.test.ts`, `brain.maintain.test.ts`.

## API
- `Brain.feedback(id, helpful, context?: FeedbackContext)`; `isVerifiedLesson(usage)` exportada de `learning.ts`. `feedbackUsage(usage, helpful, now?, context?)`.
- Sin contexto: advisory (suma `wins/losses` como antes), no promueve, **ya no renueva `lastUsed`**.
- Con contexto: idempotente por `eventId` (clave `a:`/`v:` en `usage.events`, **completa, sin truncar**: truncar permitiría recontar un evento antiguo). Advisory→verified del mismo evento mejora sin doble conteo. `eventId` vacío lanza error.
- `verified:true` solo cuenta para quien lo pase; el MCP llama con 2 argumentos, así que sigue siendo advisory. **Lead/orquestador: no pasar `verified` desde MCP.**

## Cambios semánticos intencionados
1. Promoción a `proven`: antes `wins>=3 && peso>=0.7`; ahora ≥3 `verifiedWins` distintos y Laplace verificado ≥0.7. Los 3 votos legacy/advisory ya no promueven (se cambió el fixture de 3 tests viejos a `verifiedWins:3`; no se degradó ninguna aserción).
2. Exposición ≠ confirmación: recordUse/recall siguen subiendo `uses/lastUsed` (peso/ranking) pero no alargan la vida. Una candidata sin confirmar se retira a 180 d desde `lastVerified ?? created` (antes desde `lastUsed`).
3. `proven` histórico o con `verifiedWins>0` no se retira por inactividad (sí por `losses>=3 && peso<0.35`, como antes).
4. Datos legacy intactos; un `proven` histórico se conserva. Riesgo: una candidata legacy antigua (>180 d desde creación) y solo "usada" se retirará en el próximo `maintain` (estado `retired`, el archivo se conserva).
5. Supersedes de lecciones: `write` con `supersedes` hacia una lección, y `maintain` para datos existentes, pasan la antigua a `retired` con `superseded_by`. Idempotente; ignora autoreferencia, ciclos mutuos y destinos no-lección. Nunca edita canónicos aceptados.
6. Aislamiento: `feedback` (y el retiro por supersedes) sobre una lección de una ubicación de menor prioridad (global) escribe una copia en la ubicación primaria (proyecto); el global no se toca. Canónicos y episódicos nunca se copian.

## Comandos
- `npx vitest run src/brain --maxWorkers=1` → 15 archivos, 106 passed, 1 skipped (preexistente).
- `npx vitest run src/brain src/context src/mcp src/reflect --maxWorkers=1`: fallan 3 tests ajenos (`src/mcp/server.test.ts` paginación de `edu_read`; 2 en `src/reflect/reflect.test.ts`). No usan estas semánticas; no son de mi unidad, pero no los aislé contra un árbol limpio (checkout compartido en movimiento).

## Límites y pendientes
- La copia de aislamiento congela el cuerpo de la lección global (ediciones globales posteriores no se ven en ese proyecto); `recordUse`/`maintain` generales siguen escribiendo en el sitio. Solo feedback y supersedes están aislados.
- `usage.events` crece con cada evento distinto (una cadena por evento, `eventId` ≤200 caracteres); sin poda para no romper idempotencia.
- `FeedbackContext` se valida en runtime: `verified` debe ser boolean exacto (`"false"`/`1` se rechazan), `eventId` string no vacío ≤200, `evidence` array de strings, `null` rechazado. `usage` con tipos corruptos (a mano/legacy) se sanea: nunca cuenta como prueba.
- `bases.ts` (fuera de mi propiedad) no muestra los campos nuevos; sin cambios necesarios.
- El estado `proven` sigue siendo pegajoso y wins/losses sin ventana temporal (hallazgo 4 del informe 04-feedback) — no abordado.
- `pack.ts` (candidatas irrelevantes se inyectan) es de otra propiedad; sin tocar.
- Integración pendiente (lead/orquestador): que el orquestador pase `FeedbackContext{verified:true}` solo con verificación determinista completada.

## Corrección tras review (P1 aislamiento y concurrencia)
- `src/brain/note-lock.ts` (nuevo, solo `node:fs`; sin depender de CLI ni de `src/platform/file-lock.ts`, que es un lock por host/sesión de otra propiedad): `withUsageLock(root, body)`, exclusión entre procesos e instancias por `mkdir` atómico en `<root>/state/locks/brain-usage.lock`; solo se considera obsoleto si es viejo (30 s) Y su proceso ya no existe. Espera máx. 15 s y falla con error.
- `feedback` relee, deduplica y persiste dentro de la exclusión. `recordUse`/`recall` releen cada nota bajo el mismo lock (antes podían pisar eventos recién escritos); `maintain` y el retiro por supersedes conservan el `usage` más reciente de disco.
- Destino de la copia aislada: nunca reemplaza un archivo con otro `id`. Si la ruta por título está ocupada por otra nota (o ilegible), usa `shadow-<id>.md` y, si también colisiona, `shadow-<id>-<hash>.md`; si nada es seguro lanza error. Bytes de la nota local intactos (test).
- Regresiones en `credit.test.ts`: 24 feedback concurrentes entre 2 instancias (todos los eventos y conteos), feedback vs `recordUse` concurrentes, y colisión de título con id importado preservando local y global byte a byte. Reproducidas rojas antes del fix.
- Comandos: `npx vitest run src/brain --maxWorkers=1` → 17 archivos, 118 passed, 1 skipped; `npx tsc --noEmit -p .` → sin errores.
- Límites: lock global por raíz primaria (coarse, correcto; contención baja). `recordUse` sobre una nota global sigue escribiendo en el archivo global (solo contadores de exposición). **Riesgo conocido: `usage.events` crece sin evicción** (una cadena por evento distinto, por nota); se mantiene para no romper idempotencia. Pendiente futuro: compactar con ventana + marca de agua/hash por lotes si una nota supera ~miles de eventos.

## Segunda corrección: lock por raíz real del archivo
- `brain.ts`: `rootOf(path)` = raíz de la ubicación cuyo directorio de cerebro contiene el archivo. `markUsed` y `persistFresh` toman el lock de la raíz de cada archivo escrito (+ la primaria si puede nacer una copia); `feedback` bloquea {raíz del archivo ganador, raíz primaria}, relee el ganador bajo el lock y reintenta (máx. 4) si cambió a una raíz no sujeta. `withRoots` deduplica, ordena y toma cada raíz una sola vez (sin reentrada ni inversión de orden entre procesos → sin deadlock).
- Tests (`credit.test.ts`): 2 vistas de proyecto + instancia global haciendo feedback/recordUse/recall concurrentes sobre una lección global (ledger global completo, 12 eventos únicos); y feedback concurrente desde global, A y B con ledgers intactos en cada ámbito. Verificado rojo con la implementación previa (lock siempre en la raíz primaria) y verde con la actual.
- `npx vitest run src/brain --maxWorkers=1` ×3 → 17 archivos, 120 passed, 1 skipped; `npx tsc --noEmit -p .` limpio.
- Sin cambios de semántica de otros scopes. Pendiente para el lead: remitir esta corrección al revisor Codex (no tengo canal para hacerlo).

## Tercera corrección: atomicidad en el core (updateNote / write)
- `updateNote` lee, valida y persiste dentro de `withRoots([raíz del archivo, primaria])`, relee dentro del lock y reintenta (máx. 4) si la nota cambió a una raíz no sujeta. Así `closeSession` desde hook y MCP (instancias distintas) confirma una sola vez; la otra recibe `immutable`.
- `write`: comprobación de id existente + creación son una sola sección crítica en la raíz primaria; identidades iguales en paralelo no se sobrescriben (una gana, otra `already exists`).
- Sin reentrada verificada: `applyUpdate` y `persist` no toman locks; `maintain`→`persistFresh` y `proposeCanonical`→`write` se ejecutan secuencialmente fuera de otro lock; los efectos posteriores (revertir decisión, `retireSuperseded`) son transacciones separadas, tras liberar el lock.
- Tests (`credit.test.ts`, 5 rondas cada uno): closeSession concurrente con 2 instancias → exactamente 1 éxito y 1 `immutable`; creación paralela de la misma identidad → 1 éxito y 1 `already exists`, ganador intacto; efectos posteriores sin deadlock. Los tests fallan (6 rojos incluyendo los de feedback) si `withRoots` no excluye, y pasan con el lock.
- **No cubierto (reportado):** el par «crear decisión que supersede» + «revertir la anterior» no es una transacción única: dos decisiones concurrentes que supersedan la misma pueden crearse ambas (la validación de «activa» ocurre antes del lock de creación) y la anterior queda apuntando a la última en revertir. Tampoco es atómico el par «aceptar canónica nueva» + «marcar la anterior superseded». Requiere transacción multi-nota; no ampliada.
- Verificación: `npx vitest run src/brain --maxWorkers=1` ×3 → 17 archivos, 123 passed, 1 skipped; `npx tsc --noEmit -p .` limpio.

## Cuarta corrección: raíces con alias
- `withRoots` canonicaliza con `realpath` (tras `mkdir -p`) antes de deduplicar y ordenar (en Windows la clave de dedupe va en minúsculas). Un alias/junction a la misma raíz ya no toma `brain-usage.lock` dos veces (auto-timeout), y procesos que usan cualquier grafía compiten por el mismo directorio.
- Test (`credit.test.ts`, «aliased roots»): symlink tipo `junction` (sin privilegios en Windows) + dos ubicaciones con la misma raíz física y `brainDir` distinto; rojo (timeout 15 s) sin `realpath`, verde con él. `npx vitest run src/brain --maxWorkers=1` → 17 archivos, 124 passed, 1 skipped; `tsc` limpio. No se cambiaron otras reglas.

## Quinta corrección: supersedes compuestos (último fix de core)
- `write` de una decisión con `supersedes`: validar que la anterior está activa → crear la nueva → revertir la anterior (`applyUpdate`, sin reentrar) bajo los locks de {raíz primaria, raíz de la anterior}, tomados una vez. Un competidor ve la anterior ya revertida y se rechaza sin efectos (una sola decisión activa, sin huérfana). Si revertir falla, se borra la nueva (mejor esfuerzo).
- `acceptCanonical`: valida, acepta y marca `superseded` la anterior bajo los locks de todas las raíces implicadas. Si la anterior ya fue superseded por otra propuesta, se rechaza ANTES de cualquier efecto («already superseded»); la propuesta competidora queda `proposed`. Si falla el segundo paso, se restaura la propuesta (mejor esfuerzo).
- Tests (`credit.test.ts`, 2 instancias, 5 rondas): dos decisiones nuevas sobre la misma activa (1 éxito, 1 activa, 2 decisiones totales, anterior apunta al ganador); fallo de E/S al revertir (no queda huérfana, anterior activa); dos aceptaciones canónicas sobre el mismo estándar (1 aceptada, anterior superseded, la otra intacta). Rojos sin exclusión, verdes con ella.
- Verificación: `npx vitest run src/brain --maxWorkers=1` ×3 → 17 archivos, 127 passed, 1 skipped; con `src/mcp src/reflect src/context src/orchestrator` → 36 archivos, 275 passed; `tsc` limpio.
- **Límites honestos:** no es una transacción multi-archivo. Un crash entre la escritura de la nueva nota y la reversión de la anterior puede dejar ambas activas (o la nueva sin revertir a la anterior); un lector concurrente (sin lock) puede ver el estado intermedio; el rollback ante fallo de E/S es mejor esfuerzo y puede fallar a su vez. Los lectores no tienen snapshot aislado. Sin cambios de políticas de scope ni de canónico global.
