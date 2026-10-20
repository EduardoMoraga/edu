# 07 — Integración efectiva Pi y aprendizaje incremental

## Dictamen
La conexión a memoria funciona en condiciones alineadas y conserva decisiones entre servidores.
**No está demostrada la promesa de reducir trabajo repetido o ayuda humana.** Hay dos rutas reproducibles
para inyectar el cerebro equivocado: divergencia `ctx.cwd`/cwd del proceso y cambio de proyecto solo en MCP.
No se usó la auditoría previa como evidencia.

## Entorno y límites
- Harness efectivo: Pi de Cloudroom; paquete instalado `@earendil-works/pi-coding-agent` **1.2.0**.
- Modelo declarado por entorno: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-6.1-sol`, razonamiento `medium`.
  Es identificación declarada, no comprobación del backend remoto. Ningún modelo adicional fue invocado.
- En esta ejecución no hay herramientas `edu_*` expuestas al agente; sí hay skills Edu anunciadas.
  Eso no prueba que la extensión Edu esté cargada en esta sesión real; se comprobó su carga aparte por API.
- `room-cli files wait` fue el primer comando. Sin setup, instalaciones, commits, cambios funcionales,
  cerebros/configuraciones reales ni lectura de secretos. Solo informe/probe `07-*` y temporales únicos.
- No se ejecutó una sesión LLM de prueba: loader Pi real + despacho simulado de eventos + MCP en memoria.

## Evidencia reproducible
Desde `/code/edu`:

```sh
node audit/learning/07-pi-probe.mjs
```

Resultado final: **exit 0**, diez registros JSON y aserciones satisfactorias.
El probe usa módulos reales compilados con esbuild ya instalado; crea A, B y global bajo
`/tmp/07-pi-integration-*`, limita la búsqueda con `EDU_CEILING_DIRECTORIES` y los elimina en `finally`.
Un wrapper `EDU_BIN` ejecuta `workspaceBrief` real: no reproduce el parser completo de CLI ni su stdin.
La carga usa `loadExtensions` del Pi instalado, sin iniciar sesión ni proveedor.

| Prueba | Resultado observado | Evidencia del probe |
|---|---|---|
| Brief A con overlay global | Incluye A/global; excluye B | `07-pi-probe.mjs:27-35` |
| Loader real de ambas extensiones | Sin errores; cinco hooks registrados | `07-pi-probe.mjs:42-48` |
| Exposición de schemas | Default `codemode`; acepta `direct` y `deferred` | `07-pi-probe.mjs:49-57` |
| Contexto B, proceso A | **Inyecta A**, incluso tras `session_start(B)` | `07-pi-probe.mjs:58-65` |
| Cwd B y siguiente prompt | Inyecta B y recoge decisión recién escrita | `07-pi-probe.mjs:66-73` |
| Descubrimiento de skills | Suprime copia externa; conserva propia al recargar | `07-pi-probe.mjs:74-80` |
| MCP y cambio A→B | 17 herramientas; brief B, pero hook sigue en A | `07-pi-probe.mjs:81-94` |
| Nuevo servidor MCP B | Lee decisión guardada antes; cierre de sesión fixture funciona | `07-pi-probe.mjs:95-105` |
| Fallo del binario | Sin brief; una notificación para dos fallos | `07-pi-probe.mjs:106-111` |

Las rutas abreviadas del probe en esta tabla son relativas a `audit/learning/`.
Hubo un fallo inicial del propio probe: al bundlear en `/tmp`, `resolveTemplatesDir` no encontraba
la raíz `edu-agent`. Se corrigió **solo el fixture** con package.json temporal y enlace a templates;
las dos ejecuciones posteriores completaron todas las aserciones. No es un fallo del producto.

## Cableado y fallos
### 1. Proyecto: fallo de aislamiento contextual, no de búsqueda básica
`plugins/pi/extensions/edu.ts:161-167` ejecuta `spawnSync` sin `cwd` y sin pasar `ctx.cwd` ni stdin.
Aunque `session_start` actualiza una variable cwd (`:364-365`), esa variable no llega al hook.
`src/cli/hooks.ts:45-48` acepta cwd por stdin, pero la extensión lo desconecta (`stdio: ignore`).
Por tanto, en un host embebido cuyo contexto B difiera del proceso A, llega A; reproducido.
Con directorios alineados sí llega el proyecto correcto. El overlay global es deliberado
(`src/mcp/locations.ts:8-27`); no implica aislamiento absoluto respecto de memoria global.

### 2. MCP y hook mantienen selectores diferentes
MCP permite raíces del cliente y `EDU_PROJECT` (`src/mcp/stdio.ts:28-49`) y cambio explícito
`edu_project_use` (`src/mcp/server.ts:202-210`). El hook vuelve a resolver desde su propio cwd.
El probe cambia MCP a B y observa brief MCP B, mientras el siguiente hook inyecta A.
No se demostró contaminación espontánea en una sesión Pi normal sin cambio de proyecto;
se demostró que la integración no mantiene esa invariancia cuando las rutas divergen.
Además `EDU_BIN` rige el hook, pero el MCP registra literalmente `edu`
(`plugins/pi/extensions/edu.ts:153,163`): versiones/binarios distintos son posibles; contrato verificado.

### 3. Schemas diferidos/directos y compatibilidad
- El manifest carga extensiones/prompts/themes; las skills entran por descubrimiento dinámico,
  no por `pi.skills` (`package.json:48-58`; `plugins/pi/extensions/edu-skills.ts:29-38`).
- Deduplicación por nombre y ruta funciona con inventario de comandos simulado (`edu-skills.ts:15-25`).
  No compara versiones: una skill externa antigua puede ocultar la nueva; riesgo por inspección, no fallo medido.
- Edu no fija exposición ni overrides. Pi 1.2.0 aplica `codemode`, no `direct` ni `deferred` por defecto.
  API real: `dist/core/mcp-servers.js:125-135` bajo el paquete Pi indicado arriba.
- `direct` y `deferred` son configuraciones válidas en esa API; no se probaron búsqueda del modelo,
  activación tras `tool_search`, ni validación de schemas por proveedores remotos.
- MCP real entrega schemas para 17 herramientas y acepta llamadas. El schema de `edu_brief.maxTokens`
  contiene `type: integer` y `default: null` (`src/mcp/server.ts:102-114`); no se deduce de ello
  incompatibilidad universal. La interoperabilidad con schemas estrictos de cada proveedor queda abierta.
- Pi documenta nombres `mcp__edu__edu_brief`, mientras prompts/skills piden `edu_brief`
  (`plugins/pi/prompts/edu-brief.md:6-15`). No se midió si el modelo descubre/resuelve el nombre.
- El adapter también escribe MCP global, incluso con scope proyecto
  (`src/adapters/pi.ts:8-14`; `src/adapters/paths.ts:31-33`). Por contrato Pi, mcp.json prevalece
  sobre registro de extensión: revisar overrides es necesario; no se inspeccionaron configs reales.
- Carga probada solo en Linux/Pi 1.2.0. Windows, Pi anteriores y SDK sin MCP built-in: no validados.

### 4. Aprendizaje entre sesiones: disponibilidad no equivale a mejora
`src/context/pack.ts:100-108` ordena lecciones por estado/peso aprendido, pero el hook no usa el objetivo
actual como query. Cada prompt vuelve a lanzar proceso síncrono, con timeout de 15 s
(`plugins/pi/extensions/edu.ts:22,161-167`); no hay métrica de coste/beneficio de esa repetición aquí.
El brief registra exposición de notas (`src/context/brief.ts:5-6`; `src/context/pack.ts:125`),
no evidencia de que el agente haya aplicado la lección. Hay limitación de escrituras por minuto
(`src/brain/brain.ts:80-83`), no evaluación de resultado.
La extensión no captura aprendizaje ni cierre al terminar: `agent_end` refresca UI y
`session_shutdown` limpia recursos (`plugins/pi/extensions/edu.ts:378-384`).
Recordar, dar feedback y cerrar dependen de instrucciones/llamadas del agente
(`plugins/pi/skills/edu-brain/SKILL.md:21-35`). El probe demuestra persistencia, no cumplimiento LLM.

### 5. Degradación parcialmente silenciosa
Se notifica una sola vez si el subproceso falla; probado. Pero `safeHook` convierte errores en exit 0
con aviso por stderr (`src/cli/hooks.ts:18-25`), y la extensión descarta stderr y acepta salida vacía
(`plugins/pi/extensions/edu.ts:163-166`). Por inspección, un error interno así puede pasar sin aviso;
no se inyectó ese error concreto. En print sin UI tampoco hay garantía de notificación visible.

## Checklist
- [x] **Implementado:** paquete Pi cargable, registro MCP, brief por prompt y skills deduplicadas.
- [x] **Implementado:** persistencia y lectura de decisiones en servidor posterior, con fixtures aislados.
- [!] **Roto reproducido:** `ctx.cwd` ignorado por brief; cambio de proyecto MCP no sincroniza el hook.
- [!] **Inconsistente reproducido:** override `EDU_BIN` no afecta el comando MCP.
- [ ] **Ausente en extensión:** captura/cierre automático de aprendizaje en eventos finales.
- [ ] **No demostrado:** selección de skills/tools y aplicación de lecciones por un modelo real.
- [ ] **No demostrado:** menos intentos, errores, tiempo o intervención humana entre sesiones.

## Tres prioridades
1. **Unificar workspace:** hook, MCP y Deck deben compartir selector efectivo y binario; pruebas A/B/global,
   roots, cambio explícito y `ctx.cwd != process.cwd`, con comprobación de identidad antes de inyectar.
2. **Hacer observable el contrato:** brief/errores identificados por workspace; no ocultar stderr útil;
   política explícita de exposición y pruebas Pi reales de descubrimiento/namespaces/schemas por proveedor.
3. **Medir aprendizaje incremental:** tareas repetidas con memoria activada/desactivada, mismo modelo,
   verificar aplicación de la lección y contar reintentos, ayuda humana, tokens y tiempo. Persistencia,
   exposición o consenso entre agentes no cuentan como eficiencia demostrada.

Queda abierto validar lo anterior en sesiones LLM reales y otras versiones/hosts. No se escribieron
recuerdos ni cierres en cerebros reales; el cierre MCP ejercitado pertenece únicamente al fixture.
