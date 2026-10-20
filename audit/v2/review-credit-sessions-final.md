# Re-review final — crédito y sesiones

**PASS / FIX confirmado: los tres P1 anteriores quedan cerrados para los escenarios reproducidos y el snapshot identificado.** No es una aprobación global de seguridad/concurrencia.

Snapshot: `/tmp/edu-review-credit-final-663aiagy`, capturado **2026-10-20 02:06:30 UTC**, HEAD base `ab405fac6d5ceb74fc9694896809477dc5a5049e`. Se copió src/templates/config/package y se enlazaron únicamente dependencias existentes. Al terminar, los hashes de los archivos de producción/tests listados seguían coincidiendo con el checkout.

## Resultado por P1

| Hallazgo anterior | Estado | Comprobación independiente |
|---|---|---|
| Colisión de ruta al copiar feedback global al proyecto | **PASS / FIX** | Mismo fixture: IDs `L-shared-title` y `L-imported-uuid`, título compartido. Feedback crea `shadow-l-imported-uuid.md`; bytes de la nota local y global idénticos a los anteriores; ambos IDs siguen recuperables; la sombra tiene una confirmación verificada. |
| Feedback concurrente pierde eventos verificados | **PASS / FIX** | Dos instancias Brain compiten mientras la primera escritura temporal está suspendida. Persisten exactamente `wins:2`, `verifiedWins:2`, `events:[v:run-a,v:run-b]`. Repetir ambos eventos concurrentemente no cambia usage. |
| Dos cierres MCP distintos devuelven éxito y pierden resumen | **PASS / FIX** | Cliente/servidor MCP reales, misma sesión, dos resúmenes concurrentes. Primera escritura suspendida para permitir competencia. Una respuesta `Closed`, otra `isError:true` con `different summary`; persiste `SUMMARY ONE`. Repetir el resumen ganador es no-op y conserva el cuerpo. |

No se limitó la revisión a leer informes. Los mismos tres probes, sin cambiar aserciones, se ejecutaron también contra el snapshot anterior `/tmp/edu-review-credit-4srrfinp`: **3/3 fallan**, reproduciendo pérdida de un evento, reemplazo de bytes locales y dos cierres exitosos. El control negativo confirma que las pruebas distinguen el estado anterior del corregido.

La antigua barrera esperaba dos escritores dentro de persistencia y bloquearía deliberadamente una implementación serializada correcta. Se sustituyó por una pausa de la primera escritura, lanzamiento del competidor y liberación posterior; no se alteran datos ni resultados del almacenamiento. Una espera de 40 ms permite avanzar al competidor, sin aserciones frágiles de latencia. Las aserciones comprueban estado persistido y respuestas MCP reales.

## Comandos exactos

Desde el snapshot nuevo:

```sh
node node_modules/vitest/vitest.mjs run src/review-credit-final.probe.test.ts --maxWorkers=1 --no-cache --reporter=verbose --silent=false
```

**Exit 0: 3/3 PASS**, duración 746 ms. Probe conservado en `src/review-credit-final.probe.test.ts` del snapshot temporal.

Mismo comando desde `/tmp/edu-review-credit-4srrfinp`, con copia idéntica del probe: **exit 1, 3/3 fallan**, duración 601 ms. El snapshot anterior conserva su código; sólo recibió el probe temporal.

Desde el snapshot nuevo:

```sh
node node_modules/vitest/vitest.mjs run src/brain/credit.test.ts src/brain/learning.test.ts src/mcp/server.test.ts src/cli/integrations.test.ts src/platform/file-lock.test.ts --maxWorkers=1 --no-cache
```

**Exit 0: 64/64 PASS, 5 archivos**, duración 5.77 s. Incluye las pruebas de 24 eventos concurrentes, feedback combinado con recordUse/recall, dos vistas de proyecto con global compartido, colisiones y cierres discordantes concurrentes.

## Hashes SHA-256 del snapshot probado

- `src/brain/brain.ts`: `0f05a850d44f652b5bd91e33ae042090a6f1d70e1995fa32fb9b9aabc76195fa`
- `src/brain/learning.ts`: `59466a0de6997db39e129f0a6f0dedb2daef4f6219eee89f2824e31c61633d53`
- `src/core/contracts.ts`: `0215e6567fe4b84f0269b4b5d3e1d6ff45da50ca6f8f4f7845579d39a45629c1`
- `src/mcp/server.ts`: `fd96b3e09d96985b8c12e2ab7d15e98a7b421d4f0d832bcd9e48fa07e5b48614`
- `src/cli/hooks.ts`: `54924439fae22be1075d6698b836984a9d82001220bd16b22e209dc998baa1c8`
- `src/brain/note-lock.ts`: `27d01006aa8c965e1b3eddf6fd4d92fc2bb08d702796745a6ff79e1dd7193c1c`
- `src/platform/file-lock.ts`: `7b142dab8f3c879026b753f4aa1829a1f8da7083b7ac5fc5dc7b4fbda7ea42d4`
- `src/brain/credit.test.ts`: `0ff92e44cb9125aa7fff338d77c22c83a11cdb90ea5be3229652705b0967c333`
- `src/mcp/server.test.ts`: `a72105ab55a81a685a64e2aff2894ff1f40fbabd3d8a565cf449bc63e102a882`
- `src/review-credit-final.probe.test.ts`: `759fc4edd91eaa5393d7cd932cb1632a25345fe8d9607ddb3c08eaa8c498138f`

## Límites

- Cierre de los tres hallazgos concretos, no prueba exhaustiva de todas las carreras. Concurrencia probada con instancias/operaciones dentro de un proceso y locks de filesystem reales; no se lanzó una batería multiproceso ni se inyectaron crashes, reclamaciones simultáneas de locks stale, reutilización de PID, errores de disco o filesystem de red.
- Las pruebas adicionales existentes amplían cobertura de global/proyecto/exposición; no equivalen a comprobar todos los interleavings entre mantenimiento y cualquier escritor externo.
- No se ejecutó suite global, build, publicación, modelos externos ni benchmark LLM. No se modificaron cerebros/config reales, producción ni tests del checkout. Único archivo creado en el checkout para esta tarea: este informe.
- Copias/probes en `/tmp` son temporales. Conservarlos antes de limpiar el entorno si se necesita repetir exactamente esta evidencia. Los hashes delimitan la versión revisada; cambios posteriores requieren revalidación.
