# 01 — Captura y consolidación

**Veredicto:** hay persistencia, recuperación y mantenimiento incremental de metadatos;
el cierre no extrae conocimiento. La consolidación semántica requiere invocar `reflect`
o que el agente escriba notas. No queda demostrada una reducción de trabajo repetido ni ayuda humana.

## Alcance y método

- Código observado: HEAD `ab405fac6d5ceb74fc9694896809477dc5a5049e`; checkout compartido, no snapshot aislado.
- Harness auditor: Codex en Cloudroom; modelo exacto efectivo desconocido.
- Harness probado: módulos TypeScript reales, MCP con transporte en memoria, Node v25.9.0,
  Vitest v5.0.3, un worker. Motor de reflexión: fixture determinista con `cli: 'codex'`;
  esa etiqueta NO identifica un modelo ejecutado. No se lanzó ningún LLM.
- Primero se ejecutó `room-cli files wait`: correcto. `rg` no estaba disponible;
  se usaron `find`, `grep`, `nl`. No se instaló nada ni se leyó la auditoría anterior.
- No había herramientas `edu_*` conectadas: se ejercitaron `edu_brief`, apertura y cierre
  mediante el servidor MCP real sobre cerebro temporal, sin setup ni notas reales.
- Fixtures con `mkdtemp('/tmp/01-capture-brain-')`, borrados tras cada prueba;
  caché de Vitest en `/tmp/01-capture-vitest-*`. Solo se añadieron artefactos propios de auditoría.

## Flujo verificado

1. `edu_session_open` crea una sesión vacía; `edu_session_close` recibe del llamador
   el resumen, lo guarda y llama a mantenimiento: `src/mcp/server.ts:167`, `:174`, `:179`.
   `Brain.closeSession` solo cambia estado y cuerpo: `src/brain/brain.ts:199`.
2. En prueba MCP, un resumen explícito con «Decidimos usar maxWorkers=1» y una lección
   terminó en **1 episodio cerrado, 0 notas transitivas, 0 decisiones, 0 lecciones**.
   `state/maintain.json` registró cero cambios. No hay extracción del texto al cerrar.
3. `autoMaintain` ejecuta `brain.maintain`, como máximo cada diez minutos:
   `src/brain/auto-maintain.ts:10`, `:32`. Cambia estados, propone estándares e indexa;
   no sintetiza episodios: `src/brain/brain.ts:227`.
4. Con `reflect` explícito y JSON prefijado se creó una lección `candidate`, `inferred`,
   enlazada al episodio; `recall` y `brief` la recuperaron. No se creó decisión.
   Escritura: `src/reflect/reflect.ts:38`; recuperación: `src/brain/brain.ts:178`.
5. El contexto incluye títulos de decisiones y lecciones, no sus cuerpos;
   de episodios toma la primera línea, hasta 50 tokens: `src/context/pack.ts:96`, `:108`, `:118`.
   Que aparezca el título demuestra disponibilidad, no aplicación correcta del conocimiento.

## Qué ocurre sin que el usuario dicte remember

- **Captura automática condicionada a integración:** Claude SessionEnd guarda identificación,
  motivo y ruta del transcript; nunca lee su contenido (`src/cli/hooks.ts:51`).
  Probe con archivo real: su texto centinela no apareció en el cerebro.
- Codex notify guarda solo el primer input (200 caracteres) y última respuesta (400):
  `src/cli/hooks.ts:68`. Probe: segundo mensaje y lección al final quedaron fuera.
  Ambos hooks produjeron episodios, ninguna lección.
- La instalación Claude configura SessionEnd (`src/adapters/claude.ts:22`), pero el
  manifiesto del plugin solo configura SessionStart (`plugins/claude-code/hooks/hooks.json:3`).
  No debe asumirse captura de cierre idéntica en todas las vías de instalación.
- Pi refresca la UI al terminar el agente y limpia recursos al cerrar sesión;
  ese callback no captura conocimiento: `plugins/pi/extensions/edu.ts:378`.
- El orquestador guarda un resumen de ejecución y un marcador de cola, emite
  `brain.learn` con `kind: 'episode'`, y mantiene el cerebro:
  `src/orchestrator/run.ts:295`, `:317`, `:355`. Ese evento no equivale a una lección.
- **Aprendizaje estadístico automático:** registrar usos modifica contadores/recencia;
  feedback explícito modifica victorias/derrotas (`src/brain/learning.ts:10`).
  Con tres feedback positivos suministrados, mantenimiento promovió una fixture a
  `proven` y creó propuesta canónica. No midió utilidad ni aceptación humana.
- La skill pide al agente `edu_remember` cuando ocurre algo durable
  (`templates/skills/edu-brain/SKILL.md:23`): puede hacerlo sin orden literal del usuario,
  pero depende del seguimiento de instrucciones por el agente; no es extracción garantizada.

## ¿Reflect se ejecuta solo?

**No se encontró disparador automático en el código inspeccionado.**
La única llamada productiva a `reflect(...)` encontrada en `src/` es el comando CLI
(`src/cli/commands/learn.ts:53`, `:70`); necesita motor disponible.
El cierre MCP y los hooks solo llaman a mantenimiento. La cola del orquestador se escribe
pero no dispara un consumidor: `src/orchestrator/run.ts:322`.
`reflect` selecciona sesiones cerradas recientes y después vacía la cola (`src/reflect/reflect.ts:21`, `:71`).
La skill también depende de la iniciativa del agente/usuario y pide aprobación de sus
propuestas (`templates/skills/edu-reflect/SKILL.md:10`, `:26`). Esto no constituye un scheduler.

## Fallos reproducidos de consolidación

- **Repetición no idempotente:** el mismo JSON de lección en dos reflexiones lanza
  `Note id already exists: L-same-lesson` en la segunda. No fusiona evidencia ni omite
  la nota existente. IDs por título: `src/brain/store.ts:25`; rechazo: `src/brain/brain.ts:170`;
  escritura incondicional: `src/reflect/reflect.ts:40`.
- **Dedupe de intervenciones roto:** la clave existente incluye tags `harness-gap:context,lesson`,
  mientras la clave buscada solo incluye `harness-gap:context`
  (`src/reflect/reflect.ts:84`; tag automático en `src/brain/brain.ts:158`).
  El reintento intenta crear el mismo ID y falla antes de consultar al motor.
- **Mutación parcial:** las lecciones de intervención se escriben antes de validar JSON
  (`src/reflect/reflect.ts:27`, `:38`). Con respuesta inválida quedó una candidata persistida;
  al reintentar apareció el fallo anterior. Además carece de links al episodio/run (`:95`).
- **Evidencia no validada:** un ID `NONEXISTENT` fue aceptado como soporte de una lección.
  El schema exige strings, no existencia ni respaldo semántico (`src/reflect/reflect.ts:9`, `:162`).
  La respuesta LLM tampoco recibe el catálogo completo de lecciones existentes en el prompt (`:28`).
- **Cola y ventana desacopladas:** una sesión creada en 2020 y cerrada ahora quedó fuera
  porque se filtra por `created`, no cierre (`src/reflect/reflect.ts:21`). Con otra sesión reciente,
  una reflexión exitosa borró también el marcador de la sesión excluida: limpieza de TODOS
  los JSON sin comprobar cuáles procesó (`src/reflect/reflect.ts:75`).
- La reflexión no tiene salida `decisions` en su schema (`src/reflect/reflect.ts:10`):
  convertir una decisión narrada en D- requiere otra ruta explícita de escritura.

## Reproducción y resultados

Desde `/code/edu`, sin instalar dependencias:

```sh
./node_modules/.bin/vitest run --config audit/learning/01-capture.vitest.config.mjs --maxWorkers=1 --reporter=verbose --disableConsoleIntercept
```

- Probe: `audit/learning/01-capture.probe.test.ts`; config propia redirige caché a temporal.
- Resultado final: **6/6 pruebas pasan**, 699 ms reportados. Las aserciones caracterizan también
  comportamientos defectuosos; verde NO significa que los fallos estén corregidos.
- Primera ejecución: 3/5 pasaron, 2 fallaron. La hipótesis de duplicación era incorrecta:
  los IDs deterministas abortan la segunda escritura. Se corrigió el probe conforme a esa evidencia.
- Solo pruebas deterministas. Sin comparación entre tareas repetidas, medición causal de
  intervenciones/tokens/tiempo, evaluación semántica independiente ni mejora LLM demostrada.
- No se ejecutó el orquestador completo ni hosts externos: esas conexiones se verificaron por lectura.
  No se inspeccionaron configuraciones reales ni se garantiza el estado efectivo de una instalación.

## Checklist

- [x] **Implementado:** cierre persistente, hooks parciales, cola, reflexión explícita,
  notas candidatas recuperables, mantenimiento basado en feedback y propuestas canónicas.
- [x] **Roto:** reintentos de reflexión/intervenciones, atomicidad ante JSON inválido,
  correspondencia entre cola consumida y episodios procesados.
- [ ] **Ausente en rutas auditadas:** extracción al cierre, ejecución automática de reflect,
  consolidación idempotente y validación de referencias de evidencia.
- [ ] **No demostrado:** menos repetición o intervención humana gracias al aprendizaje.

## Tres prioridades

1. Hacer reflexión idempotente y transaccional: validar antes de escribir, unificar claves,
   fusionar soporte, confirmar solo elementos procesados. Evita bloquear sucesivas reflexiones.
2. Conectar captura útil con consolidación automática acotada: contenido relevante, fecha de cierre,
   cola realmente consumida y candidatos trazables. Coste: ejecución y control del ruido; mantener
   aprobación humana para estándares, sin confundir archivo de texto con aprendizaje.
3. Validar el ciclo con tareas repetidas y control sin memoria: medir intervenciones, éxito y coste,
   comprobar respaldo de cada lección. Hasta entonces, conservar «reduce ayuda humana» como hipótesis.
