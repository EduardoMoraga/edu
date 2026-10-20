# 09 — Integración OpenCode / Claude / Codex

## Veredicto y alcance
- Hay interoperabilidad determinista de **notas**, no evidencia de aprendizaje que reduzca repetición o ayuda humana.
- Inicio/cierre automáticos **no son equivalentes**. Recall/read y apertura/cierre explícitos comparten contrato MCP.
- Harness efectivo: OpenCode en Cloudroom; modelo declarado por el harness: `openai/gpt-6.1-sol` (GPT-6.1 Sol).
- No dispongo de herramientas `edu_*` en esta sesión; usé módulos reales con SDK MCP local, sin setup ni modelos adicionales.
- No consulté la auditoría previa, cerebros/config personales ni secretos. No ejecuté agentes ni CLIs de modelos.
- Únicas altas: este informe y probes/config `audit/learning/09-opencode-integration.*`; fixtures únicos `/tmp/09-opencode-integration-*`, eliminados por los tests.

## Conexión y diferencias verificadas
| Host | Memoria y protocolo | Inicio | Cierre |
|---|---|---|---|
| Claude, adaptador install | `.mcp.json` proyecto / `.claude.json` global; `CLAUDE.md`, skills | Hook imprime brief, 1500 tokens; no abre sesión | SessionEnd crea y cierra episodio nuevo con ID host y ruta transcript |
| Codex | MCP en TOML global incluso con scope proyecto; `AGENTS.md`, skills | Sin hook inicial en adaptador; depende de instrucciones | Notify por **turno**, no fin de sesión; guarda pregunta/respuesta truncadas |
| OpenCode | MCP JSON, `AGENTS.md`, skills; configuración legacy | Sin hook; depende de que el agente cumpla protocolo | Sin hook; depende de llamada MCP explícita |

Evidencia: `src/adapters/paths.ts:18-38`, `src/adapters/claude.ts:17-27`,
`src/adapters/codex.ts:8-13`, `src/adapters/opencode.ts:8-17`, `src/cli/hooks.ts:34-85`.
El plugin OpenCode no añade lifecycle: `plugins/opencode/plugins/edu.ts:3-10` tiene entrypoints vacíos.
Otro canal de distribución difiere: `plugins/claude-code/hooks/hooks.json:2-15` solo declara SessionStart,
mientras el adaptador Claude instala también SessionEnd. No supuse equivalencia entre marketplace/plugin e install.
El protocolo común exige brief/recall/read/remember/close (`src/adapters/common.ts:24-32`),
pero omite abrir sesión y conservar su ID. También lo omite `templates/skills/edu-brain/SKILL.md:20-30`.

## Fallos e incompatibilidades
1. **Cierre sin sesión abierta:** brief no abre sesión (`src/cli/hooks.ts:37-48`;
   `src/mcp/server.ts:119-120`). `edu_session_close` requiere ID (`:174-188`).
   Repro: inicio Claude, cero sesiones; cierre MCP con ID del host devuelve `isError: true`.
   Seguir únicamente el protocolo instalado no proporciona un ID de Edu para cerrar.
2. **Fallback entre hosts:** ID desconocido y sin source selecciona la sesión abierta más reciente,
   aunque sea de otro host (`src/mcp/server.ts:183-191`). Repro: cliente llamado OpenCode cierra episodio source Claude.
   `source` es opcional y no queda ligado a identidad del cliente; no es un aislamiento de sesiones.
3. **Reintentos duplican:** repetir dos veces el mismo SessionEnd o notify produce dos episodios.
   Hooks abren siempre un registro nuevo (`src/cli/hooks.ts:63-64,84-85`), sin deduplicar ID host/turno.
   Si el agente ya cerró por MCP, el hook Claude tampoco reconcilia ese episodio.
4. **Cierre no equivale a extraer una lección:** Claude solo guarda ruta de transcript, nunca lo lee
   (`src/cli/hooks.ts:57-64`); una lección centinela en transcript no aparece en memoria.
   Codex corta pregunta a 200 y respuesta a 400 caracteres (`:75-80`); centinela al final se pierde.
   Ambos generan cero lessons en los fixtures. Mantenimiento es determinista y sin LLM
   (`src/brain/auto-maintain.ts:1-4,31-44`), no prueba extracción semántica.
5. **OpenCode V2 / nombres:** adaptador emite `mcp.edu`, `enabled`, `agent` (`src/adapters/opencode.ts:17`),
   no la forma nativa V2 `mcp.servers.edu` / `disabled` / `agents`.
   Esto es deuda de formato, **no rotura demostrada**: la guía oficial de migración admite y normaliza V1.
   La documentación V2 nombra herramientas directas `<server>_<tool>` y agrupa por servidor en Code Mode;
   con servidor `edu` y herramienta `edu_brief`, el nombre directo esperado es `edu_edu_brief`,
   o `tools.edu.edu_brief` en Code Mode. El protocolo usa el nombre MCP desnudo.
   Riesgo de descubrimiento, no fallo de invocación probado con host real.

Fuentes oficiales consultadas (2026-10-20):
- https://opencode.ai/v2/docs/mcp-servers — secciones Config, Names, Permissions, Context.
- https://opencode.ai/v2/docs/migrate-v1 — Configuration y MCP servers; compatibilidad legacy explícita.

## Reaprovechamiento entre hosts
- **Sí, condicionado a las mismas locations:** tres productores MCP × tres consumidores SDK,
  con nombres de cliente Claude/Codex/OpenCode: remember → recall → read recupera la misma lección persistida.
  Los tres también abren/cierran por ID real. No hay conversión de formato de nota por host.
  Implementación común: `src/mcp/server.ts:122-143,167-191`.
- **No es sincronización entre máquinas ni sandboxes:** las locations parten de cwd y HOME/EDU_HOME
  (`src/mcp/locations.ts:8-26`). Un host con roots distintos puede leer otro cerebro.
  MCP puede rebind al primer root file:// e inicializarlo, hooks usan cwd y no crean cerebro
  (`src/mcp/stdio.ts:39-67`, `src/cli/hooks.ts:28-31`). Diferencia relevante de contexto.
- **Proveniencia incompleta:** remember escribe `source: 'mcp'`, no host/modelo (`src/mcp/server.ts:142`).
  Probe confirma las tres lecciones con esa misma source; no permite atribuir mejora a un host.
- **Skills aprendidas no se propagan en vivo:** el instalador lee `.edu/skills` y copia contenido
  (`src/adapters/common.ts:39-54`). Probe cambia skill entre dos planes: el primero conserva versión vieja,
  el segundo contiene nueva. Claude recibe copia propia; Codex/OpenCode comparten destino `.agents/skills`.
- **Gemini CLI ausente:** no hay ID/adaptador/engine `gemini` en `src/adapters/types.ts:33`,
  `src/adapters/index.ts:4-8`, `src/engine/index.ts:17-25`.
  Existe `agy` (Antigravity): escribe GEMINI.md/AGENTS.md pero no registra MCP ni hooks
  (`src/adapters/paths.ts:39-41`, `src/adapters/agy.ts:6-7`).
  Detectar nombre cliente Gemini como agy (`src/mcp/server.ts:261`) no constituye adaptador Gemini.
  No probé acceso a Gemini ni confundí usar un modelo Gemini dentro de OpenCode con integrar Gemini CLI.

## Reproducción local
Desde `/code/edu`, dependencias existentes; sin build ni instalaciones:
```sh
./node_modules/.bin/vitest run --config audit/learning/09-opencode-integration.vitest.config.ts --maxWorkers=1
```
Resultado final: **1 archivo, 8 tests pasados**, Vitest 5.0.3, 933 ms; cache deshabilitada.
Los tests de defectos pasan porque afirman explícitamente el comportamiento defectuoso observado.
Probes: `audit/learning/09-opencode-integration.probe.test.ts`:
- `:34`: abrir/cerrar por ID real con los tres nombres de cliente.
- `:47`: 9 cruces productor/consumidor, recall/read y brief sin error; source común MCP.
- `:65`: inicio sin sesión y cierre imposible con ID desconocido cuando no hay abiertas.
- `:73`: transcript no leído, cero lessons, duplicación Claude.
- `:83`: truncamiento, cero lessons, duplicación Codex.
- `:92`: fallback de cierre entre hosts.
- `:100`: contratos de planes, hooks asimétricos y OpenCode legacy; agy sin registro MCP.
- `:111`: copia de skills solo se actualiza al generar nuevo plan.

## Checklist
- [x] Implementado: servidor MCP común y recuperación cruzada local de notas persistidas.
- [x] Implementado: brief inicial Claude; notificación por turno Codex; protocolo textual común.
- [x] Implementado: apertura/cierre MCP explícitos si se conserva ID correcto.
- [ ] Roto/incompleto: protocolo de cierre sin apertura/ID; fallback ambiguo entre hosts.
- [ ] Roto/incompleto: idempotencia de hooks y equivalencia de lifecycle entre canales/hosts.
- [ ] Ausente en estos hooks: extracción automática de lessons y propagación viva de skills.
- [ ] Ausente: adaptador propio Gemini CLI.
- [ ] No demostrado: menor repetición, menos intervenciones humanas o mejora LLM longitudinal.

## Tres prioridades
1. Unificar contrato de lifecycle: abrir/guardar ID Edu por host/sesión, cerrar ese ID, deduplicar eventos;
   no seleccionar sesiones ajenas por fallback implícito. Alinear install y plugins.
2. Añadir pruebas contractuales con hosts reales para roots, namespaces/Code Mode y configuración V2;
   declarar Gemini no soportado hasta disponer de adaptador comprobado. No arreglar legacy a ciegas.
3. Medir transferencia conductual: tarea repetida con/sin recuerdo, errores recurrentes e intervenciones humanas;
   registrar host/modelo y evidencia de uso/feedback. Recuperar una nota o consenso no demuestra eficiencia.

## Límites
Solo servidor/cliente SDK en memoria, disco temporal y planes de instalación; nombres de cliente simulados,
no ejecución real de Claude/Codex/OpenCode, negociación stdio ni permisos del host.
Brief solo se verificó sin error en cruces; no se afirma que toda lesson aparezca en su selección presupuestada.
No suite completa, prueba LLM, benchmark humano ni cambios funcionales. No cierre de sesión en cerebro real.
