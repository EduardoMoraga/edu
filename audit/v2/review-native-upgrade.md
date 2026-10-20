# Revisión read-only — native upgrade

**Baseline, preservación custom y postvalidación: PASS acotado al snapshot. Un P2 de integridad reproducido; no aprobación de stable ni garantía de ausencia de red del host real.** No cambios funcionales, agentes, commits, instalaciones, hosts/modelos reales ni lectura de credenciales. Sólo este informe y probes/fixtures temporales.

## Hallazgo P2 — El marketplace no se revalida al ejecutar el plan diferido

- `src/setup/codex-upgrade.ts`: el preflight valida `.agents/plugins/marketplace.json`, pero el callback sólo vuelve a hashear `base` y `sourceRoot`. El marketplace está fuera de ambos árboles.
- `src/setup/claude-upgrade.ts`: mismo problema con `.claude-plugin/marketplace.json`; tampoco se vuelve a consultar la procedencia del marketplace registrado antes del update.
- Reproducción independiente para ambos: plan con marketplace local válido y caché pristine 0.10.2; después se cambia únicamente `plugins[0].source` a una referencia remota de prueba. Ejecutar el callback **sí alcanza el comando nativo de mutación**. El runner de prueba lo intercepta y devuelve error; no ejecuta host ni red. El rechazo posterior no evita que el host ya haya sido invocado con metadatos distintos de los aprobados.
- Riesgo condicionado a escritura concurrente/cambio entre preflight y ejecución; no se demostró exfiltración, carga de otro plugin ni acceso a credenciales. No es un fallo nominal del baseline Windows ni motivo para afirmar que toda instalación pristine falla.
- Recomendación al propietario: incluir los manifests externos de resolución en el snapshot y revalidarlos antes del comando (igual que source/cache); volver a comprobar la procedencia que usa el host cuando sea mutable. Prueba con cambio de marketplace tras planificar debe abortar **sin invocar mutación**, no sólo fallar postvalidación. Sin editar por ownership.

## PASS verificados

- La ruta solicitada `/tmp/edu-v2-baseline/published0.10.2` no existe. Se inspeccionó **el tarball publicado disponible** `/tmp/edu-v2-baseline/published-0.10.2.tgz`, sin ejecutar su código ni extraerlo sobre el checkout.
- SHA-256 tarball: `0cc31fa000265bd2a4cdba32fa76b558fd741b9d47442954d8f8a9b44fa12fbc`. Hashes calculados directamente desde miembros tar: **17 archivos Codex y 20 Claude**, idénticos a `codexBaseline`/`claudeBaseline`. Fixtures JSON de ambos también coinciden por ruta/hash exactos: no se validó un baseline inventado contra sí mismo.
- Windows: los únicos hashes alternativos son `.mcp.json`; coinciden con JSON exacto de `{command:'cmd',args:['/c','edu','mcp']}` y shape propio de cada host. Confirmado además en implementación publicada: `dist/chunk-VHSIB24T.js` (`eduMcpLaunch`) y `dist/chunk-TW4LMQVK.js` (`localizePluginsForPlatform`). No se ejecutó Windows nativo.
- `tree` rechaza symlinks en raíz/ancestros, entradas no regulares y directorios vacíos desconocidos; igualdad exige conjunto exacto de rutas y hashes. Las pruebas ejercitan caché editada, extra, ausente y symlink, sin llamar a update/add.
- Codex exige host reportado **0.163.0**, procedencia local concreta, identidad edu@edu, versión y layout reconocidos. Mutación acotada a `plugin add edu@edu --json`; backup antes de comando; resultado exige identidad/versión/path y árbol completo igual al candidato. Repetición pristine no reinstala.
- Claude exige user scope, marketplace local concreto, plugin habilitado y layout reconocido; comando específico `plugin update edu@edu --scope user`, no update global. Reconsulta versión/path y compara hashes; admite retener únicamente el antiguo baseline pristine junto al candidato. Noop nativo con versión vieja no cuenta como éxito. Modo readFromFolder es una salida sin mutación, no una prueba de caché refrescada.
- Localización Windows actual: sólo candidatos Claude/Codex seleccionados, en paquete instalado no symlink, bytes Unix/Windows exactos y backup previo; variante custom se rechaza. Pruebas confirman que no reescribe MCP de otro host del paquete.
- OpenCode: refresca exclusivamente assets file-owned con manifest/hash intactos. No añade nuevos targets ni retira archivos; conserva comando custom y falla ante edición, ausencia o asset retirado. Backup e idempotencia cubiertos.
- Preservación de **otros plugins** está probada con sentinels y runners simulados. La lista de comandos no contiene actualización de otros plugins, borrado global ni envío explícito de credenciales. Esto NO verifica efectos secundarios internos de los hosts reales ni su acceso a red/credenciales; el P2 limita la garantía de origen bajo concurrencia.

## Comandos/resultados locales

- `room-cli files wait` → listo.
- Python `tarfile` + `hashlib` sobre el tarball publicado → hash anterior, recuentos 17/20; salida independiente en `/tmp/edu-review-native-baseline.json`. Lectura posterior localizó las dos funciones Windows en chunks publicados, sin ejecución.
- `node_modules/.bin/vitest run --config /tmp/edu-review-upgrade-eval/native-review.config.mjs --maxWorkers=1` → **1 archivo, 4 passed**, 02:47:09, 327 ms. Dos comprueban baseline/Windows; dos confirman el P2 (no son pruebas de salud). Probe: `/tmp/edu-review-upgrade-eval/native-review.test.ts`; temporales eliminados en finally.
- `node_modules/.bin/vitest run src/setup/native-files.test.ts src/setup/codex-upgrade.test.ts src/setup/claude-upgrade.test.ts src/setup/opencode-upgrade.test.ts --maxWorkers=1` → **3 archivos, 37 passed**, 02:47:09, 2.04 s. `native-files.test.ts` no existe; se ejecutaron los otros tres, no se atribuye cobertura a un archivo inexistente.
- `node_modules/.bin/vitest run src/setup --maxWorkers=1` → **5 archivos, 74 passed**, 02:47:28, 3.58 s. Incluye happy paths Linux/Windows simulados, custom fail-closed, fallo/throw/noop, path/hash incorrectos, backup bloqueado y repetición.
- `node_modules/.bin/tsc --noEmit` → **exit 0**. No CI/build/pack ni smoke npm real ejecutado por este reviewer.

## Snapshot y recheck

2026-10-20, checkout compartido sin commit del reviewer. `sha256sum` antes y después de pruebas: mismos seis contenidos. No extrapolar este dictamen a posteriores cambios del propietario ni al candidate empaquetado del principal sin comparar hashes/repetir smoke.

| Archivo | SHA-256 |
|---|---|
| src/setup/native-files.ts | 35a84b8826712972485f08a71be14ca8addee737bfda08d77f1853b4d531012b |
| src/setup/codex-upgrade.ts | 79899c4f66e4edcc735a4a24ec6f35255009a48105e2b1c129c1aa8c0e821d44 |
| src/setup/claude-upgrade.ts | fb3f7c182c1d3359e967bdb0c166560517825ae63417d1cca1405daf2fa2a258 |
| src/setup/codex-baseline.ts | f8a61124b5ebfeeee40132f69fa460e09d2f6a41d1bcb557f14ea0c8de27905d |
| src/setup/claude-baseline.ts | 5def9882c141a3965779851dafdf7a4399328f89d0d4a564622fb03c03ebf1fb |
| src/setup/index.ts | 22c1e218d6ee9399e97e52b4ee1b5f975264109099d5afd5aa01add7cd6fdf7e |

Pendiente: resolver/revisar P2; smoke npm real del principal con fixture Codex 0.163.0 contra el snapshot empaquetado; Windows nativo y comprobación efectiva de carga tras reinicio. No se inventan flags de incompletitud: caché custom/host no soportado son conflictos explícitos deliberados; un refresh válido con hashes correctos sí pasa en los tests.
