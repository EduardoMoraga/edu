# Work units preparados; PRs todavía pendientes

Estos commits son un mapa de módulos, **no PRs abiertos ni commits declarados verdes de forma aislada**. La validación completa registrada corresponde al snapshot final en conjunto. El diff supera 400 líneas; no se abrirá un único PR enorme. La separación final de contratos/tests y sus dependencias necesita la decisión del propietario sobre RC/PRs encadenadas, sin comprimir código ni eliminar tests.

- `fafac7b` — fix(platform): serialize shared filesystem operations across processes
- `4ae863c` — fix(brain): preserve memory integrity and separate verified credit
- `4dddf07` — perf(recall): filter operational state and return useful bounded passages
- `114b938` — perf(context): budget actionable context and keep briefs read-only
- `7288e35` — feat(learning): consolidate bounded structured evidence without inference
- `1e9518a` — fix(evidence): validate complete episodes and retain unknown costs
- `862bdaa` — fix(orchestrator): bound repair loops and verify relevant lesson applications
- `49ab322` — feat(mcp): capture retry-safe session lessons and offer a memory-only profile
- `d66f982` — feat(eval): expose matched trial contracts and truthful installed capabilities
- `cff8290` — fix(pi): bind cached briefs and MCP to the host workspace
- `b156488` — fix(upgrade): back up managed migrations and refresh only pristine native caches
- `72eee23` — build: assemble the internal Edu 2.0 release candidate

La distribución generada/versiones se conserva como unidad final de packaging; los datos y probes de auditoría se revisan aparte. No se ha enviado la rama, publicado un tag/release ni tocado `main`. Antes de cualquier push se requiere resolver la entrega propuesta, revisar visibilidad y hacer pull/rebase del remoto. El destino laboral sigue sin URL.
