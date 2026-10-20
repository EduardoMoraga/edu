# Revisión independiente — upgrade/setup, eval y capabilities

**Gate: NO rollout. Dos defectos P1 reproducidos en setup guard.** Eval/capabilities sin bloqueantes encontrados en el alcance revisado; eso no equivale a aprobación de publicación ni CI.

Revisión read-only de código compartido: sólo se añade este informe. Sin agentes, instalaciones, commits, modelos, npm install/pack, cambios de configuración real ni archivos de otros propietarios. Reviewer: OpenCode/GPT-6.1 Sol según entorno, no identidad API verificada. No es una segunda ejecución Codex/Claude: esos nombres se usan como fixtures, nunca se lanzaron sus CLIs.

## Bloqueantes reproducidos

### P1 — El guard rompe un EDU_HOME personalizado
- `src/setup/index.ts:280` crea instrucciones sin pasar `brainRoot`; `src/adapters/common.ts:26-27` siempre apunta el global a `home/.edu/EDU.md`. `applySetup` sí migra el root personalizado (`index.ts:297-299`), dejando contrato e instrucciones en raíces diferentes.
- Reproducción en **Claude y Codex**: identidad en `home/private-brain/EDU.md`, integración nativa anterior declarada en plugin-setup.json y bloque existente que apunta a esa identidad; `applySetup(...,{brainRoot:privateBrain})` termina con `failed:[]`, pero reemplaza el puntero por `@home/.edu/EDU.md`, que no existe en el fixture.
- Impacto: pierde identidad/contexto configurado; si el default contiene otro cerebro, puede mezclar ámbitos en vez de usar el privado elegido. La mezcla efectiva no se probó con datos reales.
- Recomendación: propagar la raíz global efectiva al generador del protocolo o conservar el puntero autorizado; prueba de regresión para ambos hosts. Coordinar con propietario de adapters/common; no se editó.

### P1 — Se añade integración a proyectos que nunca la tenían
- `src/setup/index.ts:275-285` recorre todo proyecto registrado y considera suficiente que exista CLAUDE.md/AGENTS.md. El comentario promete no añadir integraciones, pero sólo excluye archivos ausentes; no exige bloque Edu ni propiedad en manifest.
- Reproducción en **Claude y Codex**: proyecto registrado con EDU.md y archivo de instrucciones `CUSTOM PROJECT RULES ONLY`, sin bloque Edu ni manifest. El upgrade añade un bloque con `@.edu/EDU.md`, sesiones/recall/remember, y crea manifest de proyecto. Se conserva el texto custom, pero cambia su comportamiento sin instalación explícita de esa integración.
- Impacto: cambia el ámbito de integración y las instrucciones de memoria/registro del host. Registrar un cerebro no demuestra consentimiento para instalar Edu en cada host cuyo archivo de reglas exista. No se probó exfiltración ni actividad de un modelo.
- Recomendación: refrescar sólo targets con bloque válido existente o propiedad inequívoca en manifest; incorporar otros mediante instalación explícita. Añadir caso de archivo custom sin bloque. No corregido aquí por ownership.

## Seguridad, honestidad y compatibilidad verificadas
- Suite existente cubre contrato fixture 0.10.2, contenido custom, backup previo, repetición idempotente, config rota/proyectos ausentes que detienen setup, permisos POSIX de backup de migración, argumentos Windows y orden antiguo **new setup → new migrate** con runner simulado. El guard ya estaba presente al empezar esta revisión; no revisé un estado incompleto anterior.
- Update no llama a reflect/autoMaintain; los procesos nativos de setup están sustituidos por runners en pruebas. Lectura de código: migración local sin envío de notas/config a red. Update sí consulta GitHub/instala paquete; esto no es una prueba de cadena de suministro ni revisión de todos los scripts del artefacto.
- `eval` revalida tipos/costes, rechaza mezcla modelo/harness, exige mismo multiconjunto de tareas para comparar, incluye fallos y adquisición/reflexión. Billed USD desconocido produce null y no delta; caché/razonamiento se tratan como subconjuntos, no se suman dos veces.
- Probe independiente por CLI real `createProgram` + `eval aggregate`: 40 ensayos sintéticos declarados measured por fixture, cada uno con 20 tokens totales; un USD ausente en adaptive => total USD y deltas adaptive null. Ejecutado para etiquetas de modelo `codex-fixture` y `claude-fixture`; no son mediciones reales. El reporte reconoce que no verifica independencia del oráculo. La procedencia es declarada, no autenticada.
- Suite determinista se etiqueta como NO benchmark LLM, aggregate inconclusive y deltas nulos. No prueba eficiencia ni entrenamiento de pesos. Wilson presupone independencia; datos longitudinales correlacionados requieren diseño estadístico externo.
- CLI capabilities/whats-new real: versión instalada 0.10.2 (sin fingir 2.0), limitaciones y restartRequired; no inicializa cerebro. Features describen el código de este checkout, no el artefacto ya publicado. Registro main de eval/capabilities cubierto por pruebas.

## Comandos/resultados (locales, NO CI)
- `room-cli files wait` → listo.
- `node_modules/.bin/vitest run src/setup src/update src/release src/eval src/cli/commands/update.test.ts src/cli/commands/eval.test.ts src/cli/capabilities.test.ts --maxWorkers=1` → **9 archivos, 87 passed**; inicial 02:04:33 UTC y recheck final 02:07:18 UTC, 3.50 s.
- `node_modules/.bin/vitest run --config /tmp/edu-review-upgrade-eval/vitest.config.mjs --maxWorkers=1` → **1 archivo, 6 passed**, 02:07:03 UTC. Cuatro tests afirman el comportamiento defectuoso (reproducción, NO salud); dos validan coste desconocido por CLI. Probe: `/tmp/edu-review-upgrade-eval/probe.test.ts`; fixtures eliminados en finally, sin cerebros reales.
- `node_modules/.bin/tsc --noEmit` → **exit 0**.
- `/tmp/opencode` era root-owned/no escribible (EACCES); probes ubicados en `/tmp/edu-review-upgrade-eval`.

## Snapshot y recheck
HEAD base: `ab405fac6d5ceb74fc9694896809477dc5a5049e`, **checkout con cambios sin commit**, no una release. SHA-256 capturados tras la primera lectura y repetidos antes del cierre: iguales para estos 11 archivos (2026-10-20, hasta 02:07 UTC). Los hallazgos corresponden al contenido hash, no sólo al HEAD.

| Archivo | SHA-256 |
|---|---|
| src/setup/index.ts | a21f8dcaa717f5f9aa22a5d28f655e13bf644eb1ba3dd66727b962968fb8744c |
| src/setup/upgrade.test.ts | c7dbbe92207293a68d5069c24e815f8703c73f8b93c58f4aa53686a01cb14283 |
| src/update/migrate.ts | e35d1496582c14a6d1e01bf49ed133e5bce0ac37d3fa42d7de603df94297279f |
| src/update/update.ts | 4aa53c5970145036391f90c79d3fd7582cce22b117beaa5a873291e2f107f2f3 |
| src/eval/contract.ts | 802915c89c4e6578ae2122254f04ad7ab8af342e410de60c6998df753fded65e |
| src/eval/aggregate.ts | 200b27a360b670e9f379361b52d9d257a78d6e7ca851ce78d71db1f18ca77707 |
| src/eval/suite.ts | 1c44136a5ab3d8d16dcabbca01308e490d59e837c5f54ed494d12ef9b3923f1b |
| src/cli/program.ts | fb24bd38b05cb122688da363b5372b3abf775b2ac84465342a812dfe020638ba |
| src/cli/commands/capabilities.ts | 4cff7b115e1f88584354f390bf68817cbcd3d40f108c04329afad5618812c55a |
| src/release/capabilities.ts | 9fee18abe956249d2c9bb580330719ee66f20d4ed56774f223ef7c8380814b1f |
| src/cli/commands/eval.ts | aadc1afecfbef0f013b24b65ac404aa3704ef4bd79a06146da6984d964cd1642 |

## Puertas abiertas
- Corregir ambos P1 y repetir probes con expectativas de preservación (ahora documentan defectos).
- Smoke real desde artefacto publicado 0.10.2 hacia paquete nuevo temporal; validación de caches/plugins nativos Claude/Codex tras reinicio. Los runners no prueban esto.
- Build/generación/pack/install, Windows nativo, suite completa y CI auténtica no ejecutados aquí. Identidad/permisos del repositorio laboral, canal RC y autorización de publicación siguen pendientes del principal/usuario.
