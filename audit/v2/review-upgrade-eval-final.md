# Re-review final acotada — PASSFIX de dos P1

**PASSFIX de ambos P1 del informe anterior, exclusivamente para el snapshot SHA-256 indicado. NO aprobación stable ni rollout.** Revisión read-only: sólo este informe; probes temporales, sin cambios funcionales, agentes, instalaciones, commits ni datos/config reales.

## P1 cerrados
- **EDU_HOME personalizado:** `prepareUpgrade` pasa `brainRoot` a `instructionActions`; el protocolo global usa esa raíz efectiva. Probe de comportamiento para Claude y Codex con integración administrada previa: después del refresh sigue apuntando a `private-brain/EDU.md`, nunca al default ausente; contiene el protocolo nuevo y repetir setup conserva bytes idénticos. **PASSFIX**.
- **Proyecto sin bloque Edu:** ahora se exige un bloque existente válido (`removeManagedBlock(before) !== before`), no sólo un archivo CLAUDE.md/AGENTS.md. Para ambos hosts, proyecto registrado con instrucciones exclusivamente custom: bytes intactos, sin crear manifest de integración, también al repetir. **PASSFIX**.
- No se rebajaron las expectativas de preservación. Los probes anteriores documentaban el defecto; estos afirman el comportamiento seguro. Usan fallback administrado explícito porque el snapshot añade un gate nativo separado.

## Gate nativo: no confundir rechazo seguro con actualización completada
- El snapshot ya contiene refinamientos de caché y bloque breve. `prepareUpgrade` rechaza caché nativa legacy no verificable con `Manual conflict ... native cache refresh ... No native update was run`. No ejecuta un update destructivo para obtener verde.
- Probe separado, Claude y Codex declarados nativos: el guard falla explícitamente y conserva instrucciones originales. **PASS del rechazo seguro**, NO PASS de refresco/carga nativa.
- Claude sólo admite evidencia estructurada de `readFromFolder` esperado y mismo packageRoot; Codex legacy no tiene camino automático equivalente en este snapshot. Esta revisión no demuestra compatibilidad completa del rollout nativo.
- La migración actual inserta un bloque breve con versión, consulta on-demand de capabilities y reinicio; no copia todo el catálogo al contexto. Skills se refrescan sólo con manifest/hash coincidente; los conflictos custom se señalan. Pruebas existentes pasan, pero no se auditó aquí exhaustivamente ese nuevo subsistema.

## Eval USD y capabilities actuales
- Revisados `contract.ts`, `aggregate.ts` y CLI: USD ausente/null sigue desconocido; sólo se calcula `dollarDelta` con ambos brazos completos. Cero declarado no se confunde con ausencia; caché/razonamiento son subconjuntos, sin sumarlos de nuevo. Fallos y adquisición/reflexión permanecen en denominadores/costes.
- Probe por `createProgram`/CLI real `eval aggregate`: cuatro brazos × diez registros, para etiquetas `codex-fixture` y `claude-fixture`. Con un USD ausente en adaptive, total facturado/deltas correspondientes son null; se cuentan 200 tokens por brazo y se conserva el límite sobre independencia no verificada del oráculo. Son datos fabricados de prueba, NO ensayos ni resultados de modelos.
- Pruebas main de `capabilities`/`whats-new`: versión del paquete real, restartRequired, límites, alias consistente, sin crear cerebro; `eval suite` inconclusive y sin deltas de ventaja LLM. **Sin nuevos bloqueantes encontrados en este alcance**. No prueba ahorro causal ni autentica procedencia del registrador.

## Ejecución independiente y recheck
2026-10-20, checkout compartido sin commit; base previamente identificada `ab405fac6d5ceb74fc9694896809477dc5a5049e`. Identidad declarada del reviewer: OpenCode/GPT-6.1 Sol según entorno; sin verificación API.

- `room-cli files wait` → listo.
- `node_modules/.bin/vitest run --config /tmp/edu-review-upgrade-eval/final.config.mjs --maxWorkers=1` → **1 archivo, 8 passed**, 02:22:51, 833 ms. Probe: `/tmp/edu-review-upgrade-eval/final.test.ts`; fixtures eliminados en finally. Cuatro PASSFIX + dos rechazos nativos + dos casos USD.
- `node_modules/.bin/vitest run src/setup src/update src/release src/eval src/cli/commands/update.test.ts src/cli/commands/eval.test.ts src/cli/capabilities.test.ts --maxWorkers=1` → **9 archivos, 102 passed**, 02:22:58, 3.90 s.
- `node_modules/.bin/tsc --noEmit` → **exit 0**.
- `sha256sum` de los once archivos siguientes, antes y después de pruebas/lectura → **idénticos**. Los PASS corresponden a estos contenidos; cambios posteriores requieren recheck.

| Archivo | SHA-256 |
|---|---|
| src/setup/index.ts | 23a56e6565eed20ac7f051b32dff8d671d4a16655657546cf81401f02cbd5507 |
| src/adapters/common.ts | 4406ed16f1b3f152c9558ed3731a29905a681fd54d52a7e41e0ad0614a7b441e |
| src/adapters/types.ts | a510fb1dad352bc2b730c6a12c32494380fb05a33ab42b21fed7eaaa708de316 |
| src/update/migrate.ts | b958b8f373374867be5dc2a07df63de4e6680f0a27a827cf44c9fd22286fef2a |
| src/update/update.ts | 4aa53c5970145036391f90c79d3fd7582cce22b117beaa5a873291e2f107f2f3 |
| src/eval/contract.ts | 802915c89c4e6578ae2122254f04ad7ab8af342e410de60c6998df753fded65e |
| src/eval/aggregate.ts | 200b27a360b670e9f379361b52d9d257a78d6e7ca851ce78d71db1f18ca77707 |
| src/cli/commands/eval.ts | aadc1afecfbef0f013b24b65ac404aa3704ef4bd79a06146da6984d964cd1642 |
| src/cli/commands/capabilities.ts | 4cff7b115e1f88584354f390bf68817cbcd3d40f108c04329afad5618812c55a |
| src/release/capabilities.ts | 9fee18abe956249d2c9bb580330719ee66f20d4ed56774f223ef7c8380814b1f |
| src/cli/program.ts | fb24bd38b05cb122688da363b5372b3abf775b2ac84465342a812dfe020638ba |

## Límites de la decisión
- El principal comunica smoke **artefacto publicado 0.10.2 → npm real candidate 2rc**, fallo de AGENTS previo y PASS posterior preservando cinco archivos/puntero/repetición. **No lo reejecuté ni inspeccioné sus artefactos/logs en este encargo**: queda como evidencia reportada por principal, no como mi comprobación independiente ni validación del hash actual de caché nativa.
- No CI, build, pack/install ni hosts nativos reales ejecutados aquí. Los tests locales no sustituyen estos gates ni prueban recarga efectiva tras reinicio. No aprobación de stable, publicación, credenciales/repo laboral o privacidad end-to-end.
