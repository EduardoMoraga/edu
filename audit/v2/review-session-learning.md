# Review independiente — session-learning y close.lessons

**Sin P1 nuevo reproducido. Dos P2 de integridad/validación pendientes.** No se reabre el core ya corregido ni se implementan cambios.

Snapshot nuevo: `/tmp/edu-review-session-learning-6zefcd52`, **2026-10-20 02:45:39 UTC**, HEAD `d5c71fa5f86764d4a56928c637e05e310bae9444`. Las líneas citadas corresponden a esta captura. Al cerrar la revisión, los hashes de producción y tests originales listados seguían iguales en el checkout.

## P2 — Un tag controlado por MCP sustituye la identidad de la lección

`src/mcp/session-learning.ts:74–79` considera una nota ya registrada sólo porque contiene el tag calculado; no comprueba cuerpo, origin ni vínculo a la sesión.

Repro MCP real: abrir sesión S; elegir `{title:'Intended observation',body:'Expected body'}`; calcular `session-lesson:` + primeros 16 hex de SHA256(JSON.stringify([S, lesson])). Crear por `edu_remember` una lección `Unrelated`, cuerpo `Unrelated body`, con ese tag (la herramienta permite tags arbitrarios). Cerrar S con la lección prevista.

Resultado: éxito `lessons recorded … L-unrelated`; sólo existe `Unrelated body`, sin origin de sesión ni vínculo a S. La observación solicitada nunca se guarda. No requiere colisión criptográfica, acceso al filesystem ni privilegios nuevos. **No es escalada a verified/canonical**: es una confirmación falsa de persistencia ante tags que el propio caller puede introducir.

Control opuesto: reintentar lecciones auténticas de la misma sesión conserva exactamente los cuerpos e IDs sin duplicar; ese caso sí pasa. Falta verificar la identidad completa del registro existente antes de aceptarlo como idempotente, y reportar una colisión cuando no coincide.

## P2 — Validación parcial del journal acepta corrupción estructural

`src/mcp/session-learning.ts:33–35` sólo comprueba hash string, done boolean e ids array. No valida sessionId, summary, lessons, elementos de ids ni integridad del hash. En una sesión abierta, `:67–69` reemplaza el archivo aceptado y continúa.

Probes opuestos sobre el mismo journal de una sesión aún abierta:

- Contenido `{broken` → error de corrupción, archivo intacto y sesión abierta: **PASS**.
- JSON válido `{"hash":"not-the-payload-hash","done":false,"ids":[123]}` → éxito, archivo reemplazado, sesión cerrada y lección creada: **defecto reproducido**.

Esto contradice la garantía de detectar journal corrupto sin cambios. No demostró pérdida de una nota válida ni autoridad adicional. Corregir con validación del esquema/identidad/hash antes de cualquier efecto; el test existente sólo cubre sintaxis JSON rota.

## Probes de aceptación y oposición

| Área | Resultado observado |
|---|---|
| Mismo título entre sesiones secuenciales | Ambas observaciones sobreviven; retries sin duplicados. |
| Mismo título entre sesiones concurrentes | Dos cierres exitosos, dos notas distintas, dos journals done con IDs distintos. El lock de creación del core impide sobrescritura; el segundo cierre usa sufijo. |
| Fallo parcial después de escribir la segunda nota, antes de confirmar éxito | Error pending, dos notas realmente persistidas; payload distinto rechazado; retry exacto completa la tercera; siguiente retry deja tres. |
| Autoridad MCP | `verified`, `tier:canonical` y `status:accepted` dentro de lessons se rechazan antes de cerrar. Extra verified/feedback al nivel superior no da autoridad: la nota válida sigue candidate/inferred, wins y verifiedWins cero, sin canónicos. |
| Límites/evidencia | Cuatro lecciones y evidencia `../../outside` inexistente se rechazan sin cerrar ni crear notas. Los tests originales también verifican longitudes, máximo diez refs y duplicados. |
| Rutas/permisos | Título `../../outside` produce nota bajo brain; journal en directorio 0700 y archivo 0600 en Linux. No se demostró escape por MCP. |
| Corrupción e idempotencia | Casos opuestos detallados arriba; repetición genuina pasa, journal parcialmente válido y tag ajeno revelan los dos P2. |

## Ejecuciones

Desde `/tmp/edu-review-session-learning-6zefcd52`:

```sh
node node_modules/vitest/vitest.mjs run src/mcp/session-learning.review.test.ts src/mcp/session-learning.test.ts src/mcp/server.test.ts --maxWorkers=1 --no-cache --reporter=verbose --silent=false
```

Ejecución válida: **exit 0, 31/31**, 3 archivos, 2.28 s: 26 pruebas originales y cinco probes independientes. Después se añadió exclusivamente al archivo temporal el sexto probe (tag ajeno), ejecutando:

```sh
node node_modules/vitest/vitest.mjs run src/mcp/session-learning.review.test.ts --maxWorkers=1 --no-cache --reporter=verbose --silent=false
```

**Exit 0, 6/6**, 719 ms. Total de casos distintos ejecutados satisfactoriamente: **32**. En los dos probes de defectos, verde significa que se reprodujo el comportamiento incorrecto descrito, no aceptación de ese comportamiento.

Intento inicial: 30 pasan y un timeout de 15 s porque el harness esperaba dos escritores dentro de una sección ya serializada por el core. Se descartó esa sospecha de P1 y se corrigió sólo el probe: pausa de 40 ms al primer escritor para permitir competencia, sin exigir que el segundo atraviese el lock. No se cambió producción ni se debilitó una garantía; el probe final exige conservar las dos observaciones.

## Hashes SHA-256

- `src/mcp/session-learning.ts`: `f2e79984841a6755ded0c10f4ab6ff20f0ca14da992155476af62491138afed0`
- `src/mcp/session-learning.test.ts`: `927909d197539e607379de2e41339215c9beafa438ef6a2de24ab7924ad2abd2`
- `src/mcp/server.ts`: `e856d65df6088f3e3c07441cb174458c14a6b3177bc36ea846057519152b16f5`
- `src/mcp/server.test.ts`: `a72105ab55a81a685a64e2aff2894ff1f40fbabd3d8a565cf449bc63e102a882`
- `src/brain/brain.ts`: `7c6f69451b0c3e9d26b1dddc9cff1616272a3580961d4460023c9d88108626cd`
- `src/brain/note-lock.ts`: `27d01006aa8c965e1b3eddf6fd4d92fc2bb08d702796745a6ff79e1dd7193c1c`
- `src/platform/file-lock.ts`: `7b142dab8f3c879026b753f4aa1829a1f8da7083b7ac5fc5dc7b4fbda7ea42d4`
- `src/mcp/session-learning.review.test.ts`: `f360f742a88e22820939533718ea15cc25c4eca61e4eccf58b6fabd9e6b38923`

## Límites

- Sólo fixtures nuevos bajo `/tmp`, cliente/servidor MCP reales en memoria, dependencias existentes y un worker. Sin agentes, modelos externos, instalaciones, commits ni modificaciones de producción/tests del checkout. Único archivo añadido al checkout: este informe.
- La aprobación es acotada a los escenarios ensayados. Sin suite global/typecheck, procesos concurrentes separados, crashes reales, fsync/power-loss, ataques de symlink por un usuario con acceso local, Windows o filesystem remoto. No se inyectó fallo en la escritura final del journal; el probe parcial falla después de persistir una nota.
- `closeWithLessons` presupone input validado y lock del caller; la autoridad/límites se comprobaron en la ruta MCP pública. Las observaciones libres del modelo siguen siendo texto no verificado, no una prueba de hechos.
- No se inspeccionaron ni ejecutaron las sesiones teacher del piloto. No se usa la afirmación de tres candidatos por teacher como evidencia de corrección o eficiencia; aquí se comprueba esa ruta de escritura con fixtures independientes, sin feedback.
- No se declaran cerrados los dos P2. Probes/captura en `/tmp` son temporales; conservar antes de limpiar el entorno para repetir exactamente las pruebas. Cambios posteriores a estos hashes quedan fuera de esta revisión.
