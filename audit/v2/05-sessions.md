# 05 — Sesiones y hooks (Propiedad 5)

## Archivos tocados
- `src/mcp/server.ts`, `src/cli/hooks.ts`
- Tests: `src/mcp/server.test.ts`, `src/cli/integrations.test.ts`
- Este informe. Sin commits, versión, plugins/dist ni instalaciones.

## Defectos reproducidos (informe 03 §5)
- Antes: `edu_session_close` con id desconocido cerraba la sesión abierta más reciente (o la única de esa `source`); los tests existentes lo afirmaban y los he reescrito para exigir lo contrario.
- Antes: cada `session-end`/`codex-notify` creaba otra sesión; repetir el hook duplicaba episodios (probe 03 `:123`).

## Cambios
**MCP**
- `edu_session_close`: solo id exacto de nota `session`. Id desconocido o no-sesión → error con la lista de ids abiertos, sin cerrar nada. Si se da `source` y no coincide con la sesión → error, no cierra. Cierre repetido con el mismo resumen → ok ("Already closed"); resumen distinto → error y la nota cerrada no cambia.
- `edu_session_open`: reutiliza la sesión abierta con misma `source` (por defecto `mcp`) y título exacto; devuelve su id.
- `edu_read`: nuevos `offset` y `limit` (caracteres). La página incluye cabecera y pista `continue with edu_read id=… offset=N` y siempre cabe en `maxTokens` (el pie no se corta). Nota corta: salida idéntica a antes.
- `edu_capabilities { version?, maxTokens? }` (solo lectura). Usa `EduMcpOptions.capabilities?: (version?) => string | Promise<string>`; sin proveedor responde un texto mínimo (versión, "no es entrenamiento", feedback advisory).
- `edu_feedback` ignora campos extra (`verified`, `eventId`): sigue llamando `brain.feedback(id, helpful)` sin tercer argumento. Probado.

**Hooks (`src/cli/hooks.ts`)**
- Sesiones de host llevan tag exacto `host:<source>:<id>`; la búsqueda es solo por tag (nunca por título ni recencia).
- `session-start`: si recibe `session_id` **y** `source`, abre/reutiliza la sesión y añade al final del brief `Edu session id: <id>`. Sin ambos, o sin stdin, sigue read-only. `workspaceBrief` no cambió (read-only, usado por `edu brief`).
- `session-end`: concilia con la sesión del inicio (o la crea si no hubo inicio); cierra una vez; reintentos, con igual o distinto motivo, no duplican ni mutan. No toca sesiones explícitas de otros ni de otro host id. Resumen declara "path only; content was not read".
- `codex-notify`: un episodio por turno (clave `turn-id`, o digest sha256 del payload si falta); reintentos no duplican; turnos distintos sí se registran. Resumen declara "clipped question/answer only".

## Comandos y resultados
```
./node_modules/.bin/vitest run src/mcp/server.test.ts src/cli/integrations.test.ts --maxWorkers=1   # 32/32
./node_modules/.bin/vitest run src/mcp src/cli --maxWorkers=1                                       # 24 archivos, 171/171
npx tsc --noEmit   # sin errores en mcp/cli; 2 errores ajenos (src/reflect/consolidate.ts:106, src/reflect/reflect.ts:23, `meta.updated` posiblemente undefined)
```

## API exportada / compatibilidad
- Nueva: `EduMcpOptions.capabilities`; tool `edu_capabilities`; params `offset`/`limit` en `edu_read`. `hooks.ts` conserva sus exports (`safeHook`, `workspaceBrief`, `sessionStart`, `sessionEnd`, `codexNotify`, `SESSION_BRIEF_TOKENS`).
- **Cambio de comportamiento deliberado**: se elimina el fallback de cierre por id desconocido (por el encargo). Agentes que dependían de él ahora reciben error con los ids abiertos.
- La salida de `session-start` con session_id+source gana una línea final; el texto del brief no cambia.

## Para el lead / agente 9
- `src/release/capabilities.ts` **no existe aún**; importarlo estáticamente rompería `tsc`. Propuesta: el lead pasa `capabilities: version => getCapabilities(version)` al crear el servidor (en `src/mcp/stdio.ts`, que no es mío) cuando agente 9 publique `getCapabilities(version?: string): string | Promise<string>`. Si prefiere otra firma, avisar.
- Las altas del tag usan `brain.write` con `tags`; no se tocó `brain.ts`. Si agente 4 añade API de sesiones con host id, se puede sustituir `ensureHostSession`.
- Consolidación de hook con la API de reflexión (agente 1): pendiente del lead; no integrado.
- Plantillas/plugins que documenten `edu_session_close` con fallback (agente 6) deben decir "usa el id exacto devuelto por open".

## Límites
- Sin lock entre procesos: dos hooks simultáneos con el mismo id pueden duplicar (la lectura+escritura no es atómica). Los reintentos secuenciales sí están cubiertos.
- `session-start` en una sesión de host ya cerrada (resume) devuelve el id cerrado; el trabajo posterior no se registra en otro episodio.
- Codex no tiene hook de inicio: sus turnos no se concilian con sesiones abiertas por MCP (sería adivinar propiedad).
- `offset`/`limit` son caracteres, no tokens. El reuso de `open` por source+título puede unir a dos agentes que usen el mismo título/source.
- Esto da robustez de registro; no demuestra mejora de calidad ni eficiencia de ningún LLM.

## Revisión lead: lock interproceso (reabierta)
- `src/cli/hooks.ts` exporta `withHostLock(root, source, key, body, waitMs?)`. Lock por `mkdir` atómico en `<brain>/state/locks/<sha256(source\0key)[:32]>.lock` (el host id y la source nunca llegan al sistema de archivos); fichero `owner` con el pid; liberado en `finally`.
- Stale solo si antigüedad > 30 s **y** el pid propietario ya no existe; se reclama con `rename` atómico antes de borrar. Un dueño vivo nunca se expulsa: tras 5 s el llamante falla con "timed out" (el hook lo informa en stderr y sale 0; no duplica).
- `session-start`, `session-end` y `codex-notify` hacen buscar-o-crear + cierre dentro del lock (`hostSession`).
- `MCP serverInfo.version` y el texto de `edu_capabilities` usan `packageVersion()` (lazy, dentro de `createEduMcpServer`); el test compara con el runtime. Sin hardcode `0.10.2`.
- Tests nuevos: 12 llamadas concurrentes (6 session-end + 6 codex-notify idénticas) → 2 sesiones cerradas, stderr vacío, sin locks residuales; exclusión mutua sin solapamiento; lock de pid muerto y viejo reclamado; lock de pid vivo y viejo no se borra (timeout 150 ms).
- Comandos: `vitest run src/mcp src/cli/integrations.test.ts --maxWorkers=1` → 7 archivos, 48/48; `tsc --noEmit` sin errores en mcp/hooks/tests.
- Límite: el probe concurrente corre en un solo proceso Node (mismo event loop); la exclusión entre procesos descansa en `mkdir` atómico, no se probó con procesos hijos. Fallos ajenos vistos en `src/cli`: `evidence.test.ts` (H3) y `update.test.ts` (registro de hook de migración); no son de esta unidad.
- Nota: la plantilla EDU.md (agente 6) ya menciona "Edu session id" que imprime el hook; el test de solo-lectura ahora busca la línea `^Edu session id: ` exacta.

## Revisión lead: capabilities sin spoof
- `edu_capabilities` ya no tiene `version` en el schema; `EduMcpOptions.capabilities` es `() => string | Promise<string>`. Main debe cablear `capabilities: () => JSON.stringify(getCapabilities())` en `src/mcp/stdio.ts` (no tocado). Sin proveedor, el texto usa `packageVersion()`.
- Test: `version`/`wantedVersion: '999.0.0'` se ignoran (respuesta idéntica, sin "999"); el proveedor inyectado se invoca sin argumentos. `vitest run src/mcp --maxWorkers=1` pasa.

## Revisión lead: atribución Pi y open concurrente
- `sessionStart`: `source: "pi"` abre/reutiliza sesión con source `pi` y título `Pi session <id8>`. Cualquier otro valor (`startup`, `resume`, `clear`, `compact`…) es el disparador de Claude y conserva source `claude` / `Claude Code session <id8>`. Solo `pi` es reconocido como nombre de host; otros hosts requerirán ampliar el mapa.
- `edu_session_open` ahora hace buscar-o-abrir bajo `withHostLock` (source + `open:<título>`), con lo que opens concurrentes (incluso desde dos servidores MCP sobre el mismo cerebro) comparten una sesión.
- Tests: hook real con `source:pi` y `source:startup` → sesiones Pi y Claude separadas; cierre MCP con `source:'claude'` sobre la de Pi falla, con `source:'pi'` cierra, la de Claude sigue abierta; 5 opens concurrentes desde 2 servidores → 1 sesión.
- `vitest run src/mcp src/cli/integrations.test.ts --maxWorkers=1`: 7 archivos, 50/50; `tsc` sin errores en mcp/hooks. No ejecuté el test de carrera contra el código previo al lock, así que no confirmé que fallara sin él.
- `src/mcp/server.ts` ahora importa `withHostLock` de `src/cli/hooks.ts`; si el lead prefiere, mover el lock a un módulo neutro (fuera de mi propiedad).

## Revisión lead: lock neutral e inter-proceso real
- Nuevo `src/platform/file-lock.ts` (solo imports de Node, ejecutable con `--experimental-strip-types`) con `withHostLock`. `src/cli/hooks.ts` lo reexporta; `src/mcp/server.ts` importa el módulo neutral (ya no hay mcp→cli/hooks).
- `edu_session_close`: leer, comparar y cerrar ocurre dentro de `withHostLock` por id de sesión. Test: 5 cierres concurrentes del mismo resumen desde 2 servidores → los 5 ok, 1 "Closed" + 4 "Already closed"; luego un resumen distinto da error y el cuerpo sigue siendo el original.
- Test inter-proceso real (`src/platform/file-lock.test.ts`): 4 procesos `node --experimental-strip-types` (hijos propios, esperados con `exit`) ejecutan 8 rondas de leer-esperar-escribir sobre un contador compartido bajo el lock → contador exacto 32 y sin locks residuales. Control sin lock con el mismo patrón: el contador final queda por debajo de 32 (pérdida de actualizaciones), así que el test discrimina.
- `vitest run src/mcp src/platform src/cli/integrations.test.ts --maxWorkers=1`: 9 archivos, 58/58; `tsc` sin errores en esos módulos.

## Revisión Codex P1: dos resúmenes distintos concurrentes
- Test añadido (`src/mcp/server.test.ts`): dos `edu_session_close` simultáneos con `SUMMARY ONE`/`SUMMARY TWO` sobre el mismo id, probado con un solo servidor y con dos servidores sobre el mismo cerebro. Resultado: exactamente uno `Closed`, otro `isError` ("already closed with a different summary"), y el cuerpo persistido es el del cierre confirmado. 3 ejecuciones seguidas: 17/17.
- La corrección es el `withHostLock` por id ya incorporado en `edu_session_close` (módulo neutral `src/platform/file-lock.ts`). Si el crédito (agente 4) necesita lock, puede importar `withHostLock(root, namespace, key, body, waitMs?)` de ese módulo; no lo modifiqué para ellos. No ejecuté el test contra el código previo al lock.

## Unidad extra: `lessons` en `edu_session_close`
- Archivos: nuevo `src/mcp/session-learning.ts` y `src/mcp/session-learning.test.ts`; `src/mcp/server.ts` (parámetro `lessons`).
- API: `edu_session_close { id, summary, source?, lessons?: [{ title ≤200, body ≤2000, evidence?: string[] ≤10 }] ≤3, maxTokens? }`. Exporta `closeWithLessons(brain, root, session, summary, lessons)`, `lessonsInput`, `lessonInput`. El cierre de 2 argumentos es idéntico a antes.
- Las lecciones las aporta el modelo anfitrión en la misma llamada; Edu no infiere nada del resumen ni llama a otro modelo. Se guardan como `transitive/lesson`, `status: candidate`, `band: inferred`, `source: mcp`, `origin: session:<id>`, enlazadas a la sesión, con el pie "Noted by the host model … not verified". Sin canónico, sin verified, sin wins/usage. Objetos con campos extra (p. ej. `verified`) se rechazan (schema estricto).
- `evidence` solo acepta ids de notas existentes (lectura exacta); si alguno no existe, error antes de cualquier efecto.
- Orden bajo el lock de cierre: validar todo (forma, evidencia, títulos distintos, colisión de ids con notas ajenas) → escribir journal privado (`<brain>/state/session-learning/<hash sesión>.json`, dir 0700, fichero 0600, escritura atómica) con hash de sesión+resumen+lecciones → cerrar → crear notas (idempotentes por tag `session-lesson:<hash contenido+sesión>`) → marcar journal completo → auto-maintain.
- Retry idéntico: "Already closed … lessons already recorded: ids", sin escrituras. Payload distinto (otro resumen o lecciones) sobre sesión cerrada con journal: error, no añade ni muta. Sesión cerrada antes sin journal + lessons: rechazo que remite a `edu_remember`. Id desconocido / `source` distinto: error como antes.
- Fallo parcial (probado inyectando fallo de `write` con un Proxy del brain): sesión queda cerrada, el error dice cuántas lecciones quedan pendientes, cuáles se registraron y que se repita la misma llamada; el retry exacto completa sin duplicar.
- Salida acotada (solo ids). Sin dependencias nuevas, procesos ni modelos.
- Comandos: `vitest run src/mcp --maxWorkers=1` → 8 archivos, 38/38; `tsc --noEmit` sin errores en mcp/platform; `git diff --check -- src/mcp` limpio. Test cubre 3 lecciones + un servidor nuevo que las muestra en `edu_brief` y `edu_recall`, legacy 2 args, retry, mismatch, evidencia inválida/límites/campo `verified`/colisión, legacy cerrado, fallo parcial.
- Límites: una lección candidata aparece en el brief, pero que sea útil o correcta no está demostrado; es la anotación del modelo anfitrión sin verificar. Si el journal se pierde tras cerrar, el retry se rechaza (no hay forma de reanudar). Cambiar el título tras un fallo parcial cuenta como payload distinto y se rechaza.
- Plantillas (agente 6) deben documentar `lessons`; no las toqué.

## Revisión P1: ids de lecciones, journal, schema de evidence
- Colisión de título (repetía el bug de reflect): ya no se rechaza ni se sobrescribe. La nota se localiza por tag estable `session-lesson:<hash(sesión, lección normalizada)>` (misma fórmula que antes, así que notas y journals ya escritos se reconocen). Si el id `L-<título>` está libre se usa el título tal cual; si lo ocupa otra nota o lección, el título se escribe con sufijo estable `· <hash6>` (solo ante el error "Note id already exists"; cualquier otro fallo de escritura se propaga). Dos lecciones con el mismo título y cuerpo distinto en una llamada se guardan ambas; la misma lección repetida exacta en una llamada se rechaza.
- `readJournal`: solo `ENOENT` equivale a "sin journal". JSON inválido, forma incorrecta u otro error de lectura → error explícito ("corrupt"/"Cannot read"), sin cambios y sin reescribir el fichero. Un retry sobre un journal `done` ya no lo reescribe (mtime idéntico, probado).
- Schema: `evidence` describe "IDs of EXISTING brain notes … Not file names, paths, quotes or prose"; `title` y `body` también tienen descripción. Verificado en `listTools`.
- Tests nuevos: dos sesiones + nota previa con el mismo título → las 4 notas guardadas, retry sin duplicados y la nota previa intacta; journal corrupto; journal `done` no reescrito; descripción del schema. Los tests anteriores de colisión se actualizaron al nuevo comportamiento (ya no es error).
- `vitest run src/mcp --maxWorkers=1`: 8 archivos, 41/41; `tsc` sin errores en mcp; `git diff --check -- src/mcp` limpio. Nada se marca verified.
- Límite: la comprobación "título libre" y la escritura no son atómicas fuera del lock de cierre; dos escritores externos con el mismo título entre ambas se resuelven con el reintento por sufijo, no con un lock global.

## Revisión Codex 2×P2 (tag spoof, journal inconsistente)
- **Tag spoof:** el tag ya no basta. Una nota cuenta como registro de la lección solo si es `transitive/lesson`, `source: mcp`, `origin: session:<id>`, estado `candidate|proven|retired`, lleva el tag, su título es el original o el sufijado, enlaza a la sesión y a cada evidence, y su cuerpo empieza por el texto de la lección y cita la sesión. Si solo coincide el tag (p. ej. creada con `edu_remember`), se ignora y se escribe la lección real; la nota ajena queda intacta. Sufijo de colisión de título: hash completo de 16 hex (`· <hash16>`); si ese id también estuviera ocupado, la escritura falla con error explícito (nunca sobrescribe).
- **Journal:** además de forma, se exige `sessionId` igual al de la sesión, `summary` string, `lessons` válidas por el mismo schema, `ids` solo strings, `ids.length == lessons.length` si `done`, y `hash` recomputado = hash del payload. Cualquier incoherencia → error "corrupt or inconsistent", fichero, sesión y notas sin cambios.
- **Tests (MCP real):** tag falso creado con `edu_remember` (también uno que ocupa el mismo título → lección real guardada con sufijo, retry sin duplicar, spoof intacto); 7 journals JSON bien formados pero inconsistentes (hash falso, ids numéricos, sessionId ajeno, done sin ids, summary cambiado, lessons con `verified`) rechazados sin mutar; el journal correcto reanuda.
- `src/mcp/server.test.ts`: ajusté mi aserción de capabilities a `Edu <versión> (MCP` porque main añadió ", full profile" al texto; no toqué el perfil de server.
- `vitest run src/mcp --maxWorkers=1`: 9 archivos, 45/45; `tsc` y `git diff --check` limpios en mcp.

## Revisión final: compat sufijo 6 → 16
- `isRecordOf` acepta como título el original, el sufijado de 16 hex (actual) o el sufijado de 6 hex (builds anteriores), siempre bajo el resto de validaciones estrictas (tipo, source, origin de sesión, estado, tag, links, cuerpo). Cualquier otro sufijo o tag no se acepta. Las notas nuevas usan 16. Sin migración en runtime.
- Test: nota con el formato del escritor anterior (`Shared title · <6 hex>`) + journal `done` del mismo formato; el retry con el escritor nuevo no crea nada (2 notas en total, devuelve el id antiguo) y el mtime del journal no cambia. Un sufijo arbitrario (`· abcdef`) no se reconoce y se escribe la nota real (4 notas).
- Honesto: el fixture del test **imita** la salida del escritor anterior (no importa su código); no repetí el probe contra el archivo real del snapshot de `/tmp`.
- `vitest run src/mcp --maxWorkers=1`: 9 archivos, 46/46; `tsc` y `git diff --check` limpios en mcp.

## Contrato de schema publicado (defaults null)
- Defecto observado con `listTools` real: los campos envueltos con `.catch(null)` publicaban `default: null` con tipo `string`/`integer` (p. ej. `edu_recall.query`, `maxTokens`). `required` ya salía correcto (`edu_recall: ['query']`), así que no añadí override de `required`.
- Fix limitado al helper `register` de `src/mcp/server.ts`: `.catch(null).meta({ default: undefined })`. El parse en runtime no cambia (valores inválidos siguen llegando como `null` y se validan con el schema estricto dentro de la respuesta acotada).
- Test (`src/mcp/server.test.ts`, "published tool schemas"): por `listTools` MCP real, ninguna herramienta contiene `"default":`; `required` de recall/read/session_open/session_close/feedback es el declarado, `edu_brief` sin requeridos, `maxTokens` entero y opcional; args malformados (`query: 5, maxTokens: 20`) siguen dando `isError` acotado a 20 tokens.
- Solo alineación del schema observado; no afirmo incompatibilidad real con ningún host concreto. `vitest run src/mcp --maxWorkers=1`: 9 archivos, 47/47; `tsc` y `git diff --check` limpios en mcp.
