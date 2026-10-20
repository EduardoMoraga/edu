# Unidad 9 — update, migraciones e introspección

Implementado en el checkout compartido; sin commits, publicación, instalaciones, cambio de versión ni regeneración.
Harness: Codex/Cloudroom; modelo efectivo exacto desconocido. Fixtures locales; ningún LLM ejecutado.

## Cambios y API

- `src/update/migrate.ts`: `migrateWorkspaces(eduHome, now?, options?: {version?: string})` conserva los dos argumentos previos y el array `WorkspaceMigration[]`.
- Incluye global y proyectos registrados; aísla errores por proyecto; config JSON rota, brainDir inválido, marcadores corruptos y checkpoint inválido fallan explícitamente.
- `src/update/index.ts` reexporta `MigrationOptions`.
- Solo modifica el bloque `edu:capabilities` de EDU.md, `state/capabilities.json`, `state/upgrade.json` y rutas derivadas del registro. No copia ni reescribe notas, skills, identidad custom o config.
- Inserta el bloque dentro del core legado si existe, conservando byte por byte el texto anterior fuera del bloque. Checkpoint con versión real, revisión y fecha; segunda ejecución idéntica no escribe. Rechaza downgrade de contrato.
- Antes de sustituir archivos guarda originales y manifest versionado en `<eduRoot>/backups/upgrade-*`; permisos privados en POSIX. Reemplazos atómicos por archivo, conservando permisos. No transacción multiarchivo: si hay fallo intermedio se reporta y quedan respaldos; reintento convergente.
- **No llama a autoMaintain**, ni rebuildIndex, ni consolidatePending. Evita recalificar memoria histórica y consolidar durante update, incluso si autoMaintain incorpora consolidación default. No necesita `consolidate:false` al no existir ese caller.
- `src/update/update.ts`: valida JSON/estados de migración, conserva informes parciales con exit no cero; missing/no-brain/skipped/failure ya no cuentan como éxito. Para destinos >=2 exige global migrado y migra antes de setup; una migración fallida detiene setup.
- `src/cli/commands/update.ts`: hook devuelve exit 1 ante parcialidad, instrucciones de reintento sin reinstalar y reinicio de CLIs/MCP; JSON incluye restartRequired. No promete que un npm fallido dejó todo intacto.
- `src/release/capabilities.ts`: **`getCapabilities(version?: string)` síncrona**, JSON `{version, features: string[], limitations: string[], commands: string[], restartRequired: true}`. Default usa `packageVersion()` existente; ningún default 2.0 hardcodeado.
- Features corresponden al código observado: contexto con pasajes accionables, consolidación local acotada de evidencia estructurada, feedback deduplicado con crédito advisory/verified separado, reflexión explícita y migración respaldada. No entrenamiento de pesos ni garantía de eficiencia.
- Comando comprobado/corregido: `edu brain recall`. No se anuncian comandos nuevos cuya registration todavía depende del principal.

## Pruebas y reproducción

Archivos: `src/update/migrate.test.ts`, `src/update/update.test.ts`, `src/cli/commands/update.test.ts`, `src/release/capabilities.test.ts`.
Fixture `src/update/fixtures/EDU-0.10.2.md`: contrato extraído del HEAD inicial mediante `git show HEAD:templates/EDU.md`; no proviene de memoria privada.

1. Antes del fix: `./node_modules/.bin/vitest run src/update/migrate.test.ts src/update/update.test.ts --maxWorkers=1` → **5 fallos / 18 pruebas**: global omitido, sin checkpoint, config rota aceptada, hook ausente aceptado y migración parcial aceptada.
2. Final: `./node_modules/.bin/vitest run src/update src/release src/cli/commands/update.test.ts --maxWorkers=1` → **36/36** en 4 archivos.
3. `./node_modules/.bin/tsc --noEmit` → exit 0 durante integración compartida.
4. `git diff --check -- src/update src/release src/cli/commands/update.ts src/cli/commands/update.test.ts` → exit 0.

Casos: contrato real 0.10.2 + identidad custom; target 2.0 suministrado al test; dos migraciones sin nueva escritura/backup; brainDir alternativo y metadatos preservados byte por byte; backup original y bloqueo previo si backup falla; versiones por package; downgrade rechazado; global/proyectos/missing/config rota; JSON inválido; binario nuevo simulado; Windows con espacios y argumentos separados; permisos privados POSIX.
Se sustituyeron expectativas antiguas de mantenimiento/reindexación por preservación explícita de notas y ausencia de mantenimiento; no se rebajaron gates de seguridad. El antiguo happy-path que incluía missing se separó en éxito completo y parcialidad que falla.

## Integración requerida al principal / límites

- **Frontera 0.10.2 protegida tras ampliar ownership:** `applySetup` ejecuta preflight de migración antes de escrituras nativas. Detalle y pruebas de la ampliación abajo. Falta el smoke real de npm/artefactos que hará el principal.
- El test de update utiliza Runner simulado que invoca la migración real con fixtures y rutas del binario nuevo. No es smoke de npm ni ejecución del artefacto publicado 0.10.2. La instalación real/cache de plugins necesita smoke del principal antes de release; la frontera setup ya tiene pruebas con runner simulado y módulos reales.
- Principal registra CLI capabilities/whats-new y cablea supplier MCP/stdio. Import directo: `getCapabilities` de `src/release/capabilities.ts`; registration y stdio fuera de propiedad 9.
- Reiniciar CLIs y servidores MCP tras upgrade; sesiones existentes pueden retener versión/instrucciones antiguas. `edu internal migrate-workspaces --json` permite reparar/reintentar sin reinstalar ni repetir setup.
- `src/update/release.ts` sigue apuntando a EduardoMoraga/edu. NO cambié a repo laboral ni exporté datos privados. Un override de canal/repository futuro necesita validación explícita de origen, permisos y distribución privada; no hay credenciales hardcodeadas.
- No se actualizan skills custom ni se eliminan índices antiguos: preservación deliberada. Regeneración de plugins, paquete RC, instalación limpia, Windows nativo y suite completa quedan como gates del principal.
- Backups locales contienen los archivos custom modificados; no se copian al repo, mirror o red. POSIX modes no equivalen a ACL de Windows. No se probó caída física de disco, escritores concurrentes sobre la misma instalación ni rollback automático de npm.
- Versión de release permanece pendiente; tests deterministas no prueban reducción de tiempo, coste ni intervención humana.

## Ampliación autorizada: frontera NEW setup llamada por updater 0.10.2

- Archivos adicionales: `src/setup/index.ts`, `src/setup/upgrade.test.ts`; helper `backupUpgradeFiles(root, paths)` en `src/update/migrate.ts` respalda sin escribir los targets.
- `applySetup` conserva firma. Antes de cualquier localización/install nativo, migra global/proyectos existentes. Si hay fallo esencial lanza error; el wrapper CLI existente retorna exit 1.
- **Registration real:** está en `src/cli/commands/plugins.ts`, no `commands/setup.ts`. Se comprobó ejecutando el programa real con fixture y cero CLIs detectadas; no fue necesario editar ninguno de esos archivos ni program.ts.
- Detectada una instalación anterior, se refrescan exclusivamente bloques de instrucciones y manifests del installer; no se reinstalan plugins, reescriben skills/config ni retiran assets antiguos. Los bloques de proyecto se registran en su manifest de proyecto, no en el global.
- Se respalda el contenido completo de targets/manifests antes del refresh. El installer mantiene su registro reversible. Contenido custom alrededor del bloque y skills ajenas quedan intactos; repetición no añade backups cuando no hay cambios.
- Setup fresco sigue inicializando normalmente; la ausencia del global no bloquea el preflight de una instalación nueva. No se exceptúan proyectos registrados ausentes/rotos.
- Una integración nueva solicitada durante un upgrade no se da silenciosamente por configurada: requiere `edu install --scope global --cli ...`. Fresh setup conserva la instalación nativa normal.
- El guard de drift del installer sigue activo: ediciones en archivos previamente registrados pueden detener el refresh con error explícito; no se sobrescriben ni se ignoran para obtener verde. No se afirma transacción entre proyectos o rollback npm.
- Antes del fix: `./node_modules/.bin/vitest run src/setup/upgrade.test.ts --maxWorkers=1` → 3 fallos/4: reinstalaba plugins, aceptaba proyecto roto y CLI no señalaba error de migración.
- Validación final: `./node_modules/.bin/vitest run src/setup src/update src/release src/cli/commands/update.test.ts --maxWorkers=1` → **60/60**, 6 archivos. `./node_modules/.bin/tsc --noEmit` → exit 0.
- El Runner del test modela explícitamente el orden **nuevo setup → nuevo migrate** del caller 0.10.2. Ejecuta módulos reales contra contrato 0.10.2 custom; verifica cero llamadas nativas mutantes, backup/checkpoint previo, segunda migración y setup sin nuevos backups, scopes global/proyecto y salida CLI 1.
- Pendiente del principal: npm.pack e instalación temporal reales, cache/reinicio de plugins y revisión de distribución. No se lanzaron modelos, no se cambiaron versiones ni generados, no hubo commits.

## Corrección P1 solicitada tras review independiente (NO rollout)

Leído `audit/v2/review-upgrade-eval.md`; ambos P1 se reprodujeron con expectativas de seguridad, no se aceptaron sólo por el informe.

- Antes del fix: `./node_modules/.bin/vitest run src/setup/upgrade.test.ts --maxWorkers=1` → **6 fallos/12**. Claude y Codex perdían el puntero `EDU_HOME` custom; archivos globales y de proyectos con sólo reglas custom recibían un bloque no autorizado.
- Cambio autorizado y acotado en `src/adapters/common.ts`: `instructionActions(..., options: IntegrationOptions & {brainRoot?: string})`; parámetro opcional propagado al protocolo global. Default anterior y puntero relativo de proyecto permanecen compatibles. Se preservó el resto del trabajo del propietario 6.
- `src/setup/index.ts`: pasa la raíz efectiva desde el guard (también el fallback explícito nativo de Codex). El guard sólo refresca **un bloque Edu válido ya existente**, tanto global como de proyecto. Archivo presente, registro del cerebro o plugin nativo previo NO autorizan añadir un bloque. No se recrean bloques eliminados, aunque exista manifest histórico: requiere instalación explícita.
- Se reutiliza la validación de `removeManagedBlock`: bloque incompleto/duplicado falla antes de backups o modificaciones de hosts. No se modificó código de parser ni se relajó validación del installer.
- Tests nuevos en `src/setup/upgrade.test.ts`: ambos hosts, raíz custom distinta del default, contenido custom preservado, default EDU.md no creado, repetición, ausencia de manifest nuevo y mtime idéntico en reglas sin bloque; checkpoint/listado de proyecto inalterados tras el preflight inicial; bloques malformados no generan backup ni manifest de host.
- Resultado enfocado: `./node_modules/.bin/vitest run src/setup src/update src/adapters/blocks.test.ts src/adapters/installer.test.ts src/adapters/merge.test.ts src/cli/commands/update.test.ts --maxWorkers=1` → **96/96, 8 archivos**, exit 0.
- `./node_modules/.bin/tsc --noEmit` y `git diff --check -- src/setup/index.ts src/setup/upgrade.test.ts src/adapters/common.ts` → exit 0.
- La ejecución ampliada `./node_modules/.bin/vitest run src/setup src/adapters src/update src/cli/commands/update.test.ts --maxWorkers=1` NO estuvo verde: 100 pruebas pasaron y `src/adapters/pi-protocol.test.ts` falló en carga por `Cannot find module '@earendil-works/pi-coding-agent'`. No se instalaron dependencias ni se cambió ese test; queda para el entorno del principal.
- Sin cambios al plan, features, release, versión, generados o cerebros reales. Esto corrige los P1 reproducidos; no autoriza rollout ni sustituye el smoke real pendiente.

## Gate adicional: assets, protocolo legacy y presupuesto de contexto

Esta sección sustituye las afirmaciones anteriores de «sólo instrucciones» y «texto legacy intacto». **Gate nativo pendiente; NO rollout.**

- Reproducción: `./node_modules/.bin/vitest run src/setup/upgrade.test.ts src/update/migrate.test.ts --maxWorkers=1` → **3 fallos / 24**: skill registrada seguía vieja; cache desconocida producía éxito; protocolo legacy custom recibía supuesto refresh.
- `src/setup/index.ts`: ahora incluye skills existentes cuyo path/cli/kind están registrados y cuyo SHA coincide con el manifest. Usa el installer existente, con backup previo de targets y manifest. No añade skills no registradas ni hosts. Target eliminado o editado → conflicto manual, no overwrite. El preflight de conflictos detiene el lote; no aplica parcialmente las skills intactas si otra tiene conflicto. No se relaja el guard del installer.
- Las pruebas previas de preservación se declaran ahora como instalaciones **fallback**, que es el caso sin caché nativa. Tests separados exigen error para native Claude/Codex sin evidencia de caché y prueban carga local Claude/Pi. No se hace pasar un stub de list como prueba de actualización nativa.
- `src/update/migrate.ts`: revisión 2. Sustituye únicamente el párrafo **Protocol.** exacto distribuido en 0.10.2 por sesión explícita/reutilización del ID/feedback advisory/capabilities. Si ese párrafo está personalizado o repetido, conserva bytes y devuelve failed/manual conflict. Identidad, resto del documento y backups originales permanecen. Test compara todo lo exterior al párrafo y capabilities; segunda migración no escribe.
- Otros párrafos legacy no se reinterpretan ni reemplazan: no se afirma haber actualizado íntegramente toda la prosa histórica. Config y memoria permanecen intactas.
- Core capabilities limitado por test a **420 caracteres de contenido** (aproximación conservadora a ~100 tokens, no tokenizer exacto): versión, fuente local `state/capabilities.json`, CLI/MCP bajo demanda, restart, advisory e ID de sesión. No incluye listas completas de features/limitations/commands. JSON completo permanece en state. No modifiqué getCapabilities, ni amplié su payload MCP; presupuesto MCP 800 queda en el gate del principal.
- API pública conservada: `applySetup`, `migrateWorkspaces`, `backupUpgradeFiles`. Errores esenciales lanzados por setup atraviesan el wrapper CLI existente y no devuelven éxito.

### Contratos nativos verificados y límite deliberado

Fuentes primarias consultadas, sin ejecutar clientes reales ni autenticación:

- [Claude CLI](https://code.claude.com/docs/en/plugins/cli-reference): comando dirigido `claude plugin update edu@edu --scope user`; `plugin list --json` distingue `installPath` cache de `readFromFolder`, además de scope y errores. Se acepta carga directa sólo si el único Edu es user, apunta exactamente a plugins/claude-code del paquete actual y coincide packageRoot registrado. Requiere reinicio/recarga; no demuestra caché recargada.
- [Codex plugins](https://developers.openai.com/plugins/build/plugins) y [CLI fuente oficial](https://github.com/openai/codex/blob/main/codex-rs/cli/src/plugin_cmd.rs): existe `codex plugin marketplace upgrade edu`, no `codex plugin update`. La operación tiene alcance marketplace; no se invoca sin conocer qué otros plugins/cache/config alcanzaría y sin baseline preservable.
- [Pi CLI](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/cli.md) y [packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md): `pi update <source>` apunta a un paquete; sin argumento actualiza Pi, `--extensions` todos los paquetes. Recursos locales se cargan sin copia. Se acepta sólo listado con ruta exacta del paquete actual y mismo packageRoot anterior. No se ejecuta actualización amplia ni se añade fuente.
- **No implementado aún:** actualización automática de cachés Claude/Codex o fuentes remotas Pi. El manifest 0.10.2 no contiene hashes de caché: ni nombre/versión ni list prueban ausencia de custom. En este caso setup falla explícitamente antes de escribir hosts; no invoca update ni promete instalar mejoras nativas. La migración local previa puede haberse completado con backup; no es rollback global.
- Para cerrar ese gate hacen falta baseline del artefacto nativo antiguo, snapshot privado de los targets afectados, diff que preserve custom y prueba de recarga con host real. No añadí un esquema de hashes ficticios ni forcé comandos destructivos para obtener verde. El smoke del principal con hoststub list no prueba caché/reload.
- No se ejecutaron comandos nativos mutantes; los fixtures prueban rechazo y las dos cargas directas permitidas. Sin LLM ni inferencia pagada. Restart sigue obligatorio. No se garantiza eficiencia, ahorro ni rollback npm.

Validación final:

- `./node_modules/.bin/vitest run src/setup src/update src/adapters/blocks.test.ts src/adapters/installer.test.ts src/adapters/merge.test.ts src/cli/commands/update.test.ts --maxWorkers=1` → **103/103, 8 archivos**, exit 0.
- `./node_modules/.bin/tsc --noEmit` → exit 0.
- `git diff --check -- src/setup/index.ts src/setup/upgrade.test.ts src/update/migrate.ts src/update/migrate.test.ts` → exit 0.
- Archivos de esta ampliación: esos cuatro y este informe. No cambios en package/version/program/plan/features/release, generados o cerebros reales. Harness Codex/Cloudroom; modelo efectivo desconocido.

## Refresh nativo Codex con baseline pública fijada

Corrección de mi conclusión anterior: Codex 0.163.0 **sí permite reinstalar/refrescar** mediante `plugin add edu@edu --json`, sin remove. La ruta ahora está implementada; ya no se bloquea siempre Codex 0.10.2 pristine.

- Verifiqué [plugin_cmd.rs fijado](https://raw.githubusercontent.com/openai/codex/rust-v0.163.0/codex-rs/cli/src/plugin_cmd.rs), [store.rs fijado](https://raw.githubusercontent.com/openai/codex/rust-v0.163.0/codex-rs/core-plugins/src/store.rs) y [installed.rs fijado](https://raw.githubusercontent.com/openai/codex/rust-v0.163.0/codex-rs/core-plugin-common/src/installed.rs). `run_plugin_add` llama al store; éste usa `replace_plugin_root_atomically`. La caché es `<CODEX_HOME>/plugins/cache/<marketplace>/<plugin>/<pluginVersion>`, no una carpeta genérica asumida. `pluginVersion` sale del manifest del plugin, no de la versión npm.
- `sha256sum /tmp/edu-v2-baseline/published-0.10.2.tgz` → **0cc31fa000265bd2a4cdba32fa76b558fd741b9d47442954d8f8a9b44fa12fbc**. Extraje únicamente los 17 archivos públicos `package/plugins/codex/*`, usando tarfile de Python sin dependencias nuevas. Baseline SHA en `src/setup/codex-baseline.ts`; bytes públicos reproducibles para tests en `src/setup/fixtures/codex-0.10.2.json`. No memoria/config privada ni extracción indiscriminada del tar.
- `src/setup/codex-upgrade.ts`: API interna `planCodexRefresh({home, packageRoot, previousPackageRoot?, brainRoot, runner}) → Promise<() => Promise<void>>`. Preflight devuelve mutación diferida; `src/setup/index.ts` reúne los preflights nativos antes de ejecutar las mutaciones. No cambia API CLI pública.
- Exige host **codex-cli 0.163.0**, un único `edu@edu` instalado y enabled, origen plugin local exactamente `<packageRoot>/plugins/codex`, marketplace local exactamente packageRoot y manifest previo con ese mismo packageRoot. Valida también el marketplace candidato y su plugin manifest. Otros hosts/versiones/orígenes, plugin deshabilitado o metadata incompleta → manual conflict.
- Recorre toda la raíz de caché Edu: acepta únicamente el conjunto completo/hash exacto de la versión pública 0.10.2. Extra, ausente, modificado, directorio vacío inesperado, symlink o versión adicional → conflicto. Rechaza downgrade. Si ya coincide exactamente con el candidato instalado, no reinstala ni crea backup.
- Antes de mutar revalida source/cache, respalda todos los archivos originales con `backupUpgradeFiles` (manifest versionado y permisos privados), vuelve a verificar y ejecuta **sólo** `codex plugin add edu@edu --json`. No remove, marketplace upgrade/add, escritura directa de cache ni operación sobre otros plugins. No lee config.toml ni credenciales.
- Después exige pluginId/version/installedPath exactos y todos los hashes del árbol candidato; error, excepción, JSON incorrecto o discrepancia → fallo explícito con ruta de backup. No se afirma rollback de host/npm ni transacción con las otras etapas. El store puede haber modificado la caché antes de un fallo posterior.
- Compatibilidad acotada: sólo baseline pública sin localización/custom. Una instalación Windows cuyo `.mcp.json` fue localizado no coincide y permanece manual; no se asumió equivalencia. Si cambia la ruta npm de packageRoot tampoco se cambia silenciosamente el origen registrado.
- Claude con cache sigue manual: no se extrapola la semántica de Codex a `claude plugin update`. Claude/Pi con carga directa verificada mantienen la ruta anterior. Gate global de hosts/reload sigue pendiente, sin afirmar recarga real ni eficiencia.

Pruebas de comportamiento (`src/setup/codex-upgrade.test.ts`): pristine 0.10.2 → candidato RC, backup presente antes del runner mutante, otros plugins preservados, segundo run sin reinstall; custom/extra/missing/symlink/origen/host desconocidos; backup bloqueado; runner exit1/excepción, hash posterior incorrecto y installedPath incorrecto.

- Antes: `./node_modules/.bin/vitest run src/setup/codex-upgrade.test.ts --maxWorkers=1` → **4 fallos / 10** por bloqueo indiscriminado del guard.
- Después: `./node_modules/.bin/vitest run src/setup src/update src/adapters/blocks.test.ts src/adapters/installer.test.ts src/adapters/merge.test.ts src/cli/commands/update.test.ts --maxWorkers=1` → **115/115, 9 archivos**, exit 0.
- `./node_modules/.bin/tsc --noEmit` → exit 0; `git diff --check -- src/setup/index.ts src/setup/codex-upgrade.ts src/setup/codex-upgrade.test.ts src/setup/codex-baseline.ts` → exit 0.
- Tests usan runners simulados y filesystem real temporal; **ningún CLI nativo real ni modelo ejecutado**. El smoke del host real y restart siguen pendientes del principal. Sin commits, cambios de package/versión/generados ni dependencias nuevas.

## Cierre de implementación: Claude y assets OpenCode

Esta sección sustituye el gate «Claude cache siempre manual» anterior. Implementación lista para smoke; **no prueba recarga real ni autoriza rollout**.

- Fuente verificada: [Update plugins now](https://code.claude.com/docs/en/discover-plugins#update-plugins-now) distingue refrescar el listado del marketplace de actualizar el plugin instalado; terceros/local tienen auto-update apagado por defecto. [CLI oficial](https://code.claude.com/docs/en/plugins/cli-reference) documenta `plugin update`, scope, `plugin list --json` y el schema de `plugin marketplace list --json`.
- `src/setup/claude-upgrade.ts`: `planClaudeRefresh({home, packageRoot, previousPackageRoot?, brainRoot, runner}) → Promise<() => Promise<void>>`, mismo contrato diferido que Codex. Requiere único `edu@edu`, scope user, enabled, sin errores, installPath exacto `<CLAUDE_CONFIG_DIR|home/.claude>/plugins/cache/edu/edu/<version>`, marketplace `directory` con path/installLocation iguales al packageRoot previamente registrado. Valida source relativo exacto, versión y ausencia de dependencias declaradas antes de actualizar.
- `src/setup/claude-baseline.ts` + fixture `src/setup/fixtures/claude-0.10.2.json`: SHA y bytes de los **20 archivos públicos** plugins/claude-code del mismo tarball SHA `0cc31fa000265bd2a4cdba32fa76b558fd741b9d47442954d8f8a9b44fa12fbc`, comprobado antes de extraer. No datos privados.
- Cache pristine → revalidación, backup privado, **únicamente `claude plugin update edu@edu --scope user`**, nuevo list y comprobación versión/installPath/hashes completos. Un exit0 «already latest» con bytes viejos falla. Permite que Claude conserve la carpeta 0.10.2 sólo si sigue idéntica a baseline; extras/custom/symlinks/ausentes y layouts desconocidos siguen manual. Segunda ejecución vigente no reinstala.
- `src/setup/native-files.ts` extrae las mismas comprobaciones de archivos/hash/versión para ambos hosts; `src/setup/codex-upgrade.ts` las reutiliza sin ampliar compatibilidad de Codex 0.163.0. No se escriben cachés directamente ni se ejecutan remove, marketplace update o cambios en otros plugins. No se leen credenciales/config privadas. Fallo después del comando conserva backup y se reporta sin prometer rollback.
- Claude compatible por **schema documentado**, no se afirma validar todas sus versiones. No se soportan marketplaces git/url/file/comando, scopes project/local/managed, dependencias, cachés con metadata/archivos extra, rutas localizadas custom ni cambios de packageRoot. Se mantiene load-in-place documentado y verificado por listado. Pi remoto/agy siguen manual; Pi local en ruta exacta conserva carga al reiniciar.
- `src/setup/index.ts`: upgrade OpenCode global genera candidatos con `appendOpenCodeAssets`, pero sólo entrega al installer archivos ya registrados y con SHA intacto de commands/agents/plugins/themes/TUI. No pasa `retire`, no añade targets ni integración. Custom, target ausente o asset registrado sin candidato actual → error/manual conflict, sin aplicar el lote. Assets OpenCode 1 retirados requieren reconciliación explícita; no se eliminan para aparentar éxito.
- Pruebas nuevas `src/setup/claude-upgrade.test.ts` (13): pristine, backup previo, conservación de otro plugin y versión vieja intacta, idempotencia, custom/extra/missing/symlink/origen/scope, backup fallido, exit1/excepción/no-op/posthash/path erróneos. `src/setup/opencode-upgrade.test.ts` (4): refresh real de los tres tipos, backups originales, repetición sin escritura, no creación de archivos candidatos nuevos, custom/missing/retired fallan sin tocar los restantes.
- Reproducción: `./node_modules/.bin/vitest run src/setup/claude-upgrade.test.ts --maxWorkers=1` → **6 fallos/13** con fixture pública corregida, guard antiguo; `./node_modules/.bin/vitest run src/setup/opencode-upgrade.test.ts --maxWorkers=1` → **4 fallos/4**, assets obsoletos y conflictos aceptados.
- Final: `./node_modules/.bin/vitest run src/setup src/update src/adapters/blocks.test.ts src/adapters/installer.test.ts src/adapters/merge.test.ts src/cli/commands/update.test.ts --maxWorkers=1` → **132/132, 11 archivos**, exit 0. `./node_modules/.bin/tsc --noEmit` y `git diff --check -- src/setup` → exit 0.
- Para smoke del principal: el fixture Codex debe devolver `codex-cli 0.163.0`, metadata local exacta, cache real con los 17 archivos públicos y resultado pluginId/version/installedPath; el de Claude necesita ambos list JSON y cache con los 20 archivos. API pública de setup intacta. Estas pruebas usan runners simulados, no clientes nativos/modelos ni autenticación real. Restart de hosts/MCP permanece necesario; sin promesa de eficiencia.

## Corrección Windows: baseline localizada y candidato antes del preflight

Sustituye la limitación anterior sobre `.mcp.json` localizado: ahora se admite **la variante exacta 0.10.2**, exclusivamente con platform win32.

- Verificado directamente en el tarball público: `dist/chunk-VHSIB24T.js` define `eduMcpLaunch(win32) = {command:'cmd',args:['/c','edu','mcp']}`; `dist/chunk-TW4LMQVK.js` escribe JSON con indentación 2 y newline, Claude `{edu:launch}`, Codex `{mcpServers:{edu:launch}}`. No se infirió por documentación genérica.
- `claudeBaselineFor(platform)` y `codexBaselineFor(platform)` conservan todos los SHA originales y cambian sólo `.mcp.json` para win32: Claude **5e44db1bdf44d58b9f423dcc5199bff628836f9ffcfc2b3baa86b10749656175**, Codex **0d497fb4a61b6b170670437f50975ceffb82111b349711966eb24a818d89be81**. No aceptan otros wrappers/campos/bytes. Unix sigue usando la baseline pública original.
- APIs internas `planClaudeRefresh`/`planCodexRefresh` incorporan `platform?: NodeJS.Platform`; default process.platform. `applySetup` propaga `options.platform`. Antes de calcular hashes/preflight nativo, el guard localiza los candidatos seleccionados usando `eduMcpLaunch(win32)`.
- `localizeUpgradeSources` sólo permite el paquete propio con ruta terminada `node_modules/edu-agent`, sin symlinks, y MCP fuente con bytes canónicos Unix o Windows. Custom → error, sin sobrescribir. Respalda el MCP candidato antes de localizar; la caché antigua sigue recibiendo su backup separado antes del comando nativo. `localizePluginsForPlatform` añade filtro opcional `clis`, manteniendo sus defaults para setup fresco; no toca otros hosts durante upgrade.
- Reproducción: `./node_modules/.bin/vitest run src/setup/codex-upgrade.test.ts src/setup/claude-upgrade.test.ts --maxWorkers=1` → **2 fallos/31**, las dos cachés pristine win32 eran rechazadas. Tests especifican bytes históricos independientemente del helper actual.
- Final: `./node_modules/.bin/vitest run src/setup src/update src/platform/platform.test.ts src/adapters/blocks.test.ts src/adapters/installer.test.ts src/adapters/merge.test.ts src/cli/commands/update.test.ts --maxWorkers=1` → **146/146, 12 archivos**, exit 0. `./node_modules/.bin/tsc --noEmit` y `git diff --check -- src/setup` → exit 0.
- Casos Linux/Windows comprueban launch efectivo del candidato **antes** de la copia nativa simulada y de la caché posterior, backup de fuente, idempotencia, MCP de otro host intacto y rechazo de `/k`/source custom. No hubo CLI nativo real ni modelo: Windows físico, auth y recarga quedan para CI/smoke del principal; no se promete rollback ni eficiencia. Archivos: index, ambos baseline/upgrade/test y este informe; sin cambios en platform funcional, package, versión o generados.

## P2 de review-native-upgrade: procedencia mutable

- Leído `audit/v2/review-native-upgrade.md` y reproducido independientemente: `./node_modules/.bin/vitest run src/setup/claude-upgrade.test.ts src/setup/codex-upgrade.test.ts --maxWorkers=1` → **8 fallos/41**. Marketplace cambiado o config nueva después del preflight/durante backup aún alcanzaban la mutación.
- Nuevo `src/setup/native-provenance.ts`: snapshot SHA de marketplace externo, package.json, manifest de setup, manifest/MCP candidato y configuraciones de resolución. Codex: config.toml global y `.codex/config.toml` de cwd/ancestros. Claude: settings global/local, known_marketplaces/installed_plugins y settings de cwd/ancestros. Incluye estado ausente, entorno de home del host y cwd; rechaza symlinks/no regulares. Son hashes opacos: no se parsea, vuelca, respalda ni retorna contenido de config; no se leen archivos de auth/keys.
- Ambos planners capturan antes de validar el marketplace, exigen que la nueva consulta coincida con el registro ya validado y revalidan antes y después del backup. La última comprobación vuelve a consultar plugin/marketplace efectivos y hashea de nuevo tras esa consulta, antes de invocar add/update. Source/cache mantienen sus comprobaciones. Cambio detectado → conflicto explícito, **cero comandos nativos mutantes**; las consultas list siguen siendo necesarias.
- Tests nuevos de ambos hosts: cambio marketplace y aparición de configuración en las dos ventanas; cambio de procedencia reportada sin alterar source/cache. El backup del test es real; spy añade la mutación justo después. No se modificaron baseline, profiles MCP, generados ni package.
- Suite amplia: `./node_modules/.bin/vitest run src/setup src/update src/platform/platform.test.ts src/adapters/blocks.test.ts src/adapters/installer.test.ts src/adapters/merge.test.ts src/cli/commands/update.test.ts --maxWorkers=1` → **156/156, 12 archivos**. Último ajuste añade manifest/MCP al hash final: `./node_modules/.bin/vitest run src/setup/codex-upgrade.test.ts src/setup/claude-upgrade.test.ts --maxWorkers=1` → **43/43**. `./node_modules/.bin/tsc --noEmit` y `git diff --check -- src/setup` → exit 0.
- Límite explícito: detección por snapshots, NO atomicidad con procesos/vendor. Un escritor malicioso simultáneo del mismo UID puede cambiar archivos después del último check y antes de que el CLI los abra; eliminar esa carrera requiere aislamiento/transacción del host y queda fuera de alcance. Configuración administrada fuera de las rutas enumeradas se contrasta sólo mediante list efectivo. No se garantiza ausencia de red/side effects internos del host real. Gate Windows nativo/firmas, pack y recarga siguen pendientes del principal.

## Portabilidad de fixtures macOS

- Normalizadas ocho raíces temporales mediante `await realpath(await mkdtemp(...))` en `src/setup/{claude-upgrade,codex-upgrade,opencode-upgrade,upgrade}.test.ts` y `src/update/{migrate,update}.test.ts`. Evita tratar el alias macOS `/var/folders` → `/private/var/folders` como una caché symlink accidental. No cambios de producción; checks de `tree()` y tests de symlink custom permanecen intactos.
- Validación local: `./node_modules/.bin/vitest run src/setup src/update src/cli/commands/update.test.ts --maxWorkers=1` → **120/120, 8 archivos**, exit 0; diff check de esos seis archivos → exit 0. Es cobertura portable de fixtures, NO ejecución macOS/CI ni validación del root real del usuario. Los resultados de Node22/full/smoke comunicados por el principal no se atribuyen a esta ejecución.
