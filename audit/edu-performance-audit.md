# Edu añade coste; la mejora neta de rendimiento no está demostrada

## Veredicto

**Sí, es técnicamente plausible que Kimi gaste más con Edu que con su harness nativo.** El código añade instrucciones, herramientas, contexto y, si se usa orquestación/revisión, ejecuciones adicionales de modelos. **No encontramos una comparación controlada que demuestre que ese coste se compensa con mayor calidad o menor coste por tarea resuelta.** Esto tampoco demuestra que Edu empeore la calidad.

Alcance: Edu 0.10.2, base `ab405fac6d5ceb74fc9694896809477dc5a5049e`. Dos agentes independientes revisaron contexto/integraciones y evidencia/orquestación; el agente principal verificó el código, ejecutó pruebas y midió el MCP real en un cerebro temporal. Auditorías delegadas: contexto `thr_pza58atkir`, evidencia `thr_qqxm5v93gq`. No se ejecutaron llamadas pagadas a Kimi ni se modificó su configuración.

## Mediciones reproducibles, no facturación de Kimi

Ejecutar desde la raíz: `npm ci && npm run build && node audit/performance-probe.mjs`.

| Componente | Resultado observado | Qué significa |
|---|---:|---|
| Herramientas MCP registradas | 17 | La exposición efectiva depende del host y de su carga diferida de herramientas. |
| JSON compacto de nombres, descripciones y schemas | 8.755 bytes; ~2.553 tokens estimados | No incluye envoltura del proveedor. No son tokens medidos con el tokenizer de Kimi. |
| Brief automático, cerebro recién creado | ~449 tokens estimados | Se añade al prompt en Pi. |
| Brief con 32 lecciones sintéticas | ~1.279 tokens estimados | No representa un cerebro real de usuario. |
| Brief automático: presupuesto configurado | 1.500 tokens estimados | No limita el prompt completo, las herramientas ni el historial. |
| Brief MCP: presupuesto predeterminado | 800 tokens estimados | Puede repetir contenido que ya inyectó el hook. |
| Hook en esta máquina, procesos nuevos | ~135 ms vacío; ~167–184 ms con fixture | Tiempo local; no latencia del modelo, no benchmark comparativo del harness. |

El JSON de herramientas más el brief vacío suman aproximadamente **3.002 tokens estimados**, **solo si el host expone todos los schemas al modelo**. Con la fixture suman ~3.832. En el Pi instalado para esta auditoría, MCP usa `codemode` por defecto: los 17 schemas no se declaran completos automáticamente al modelo; se descubren bajo demanda (documentación local `docs/mcp.md:195–204`). Por tanto, **3.002 no es el sobrecoste predeterminado demostrado de Pi**. No deben sumarse automáticamente a instrucciones/identidad sin comprobar cómo las carga cada host; puede haber repetición. Tampoco equivalen a tokens facturados sin caché en cada petición.

Resultados completos: [performance-probe-results.json](performance-probe-results.json). La estimación usa la misma heurística que `src/context/tokens.ts`, no un tokenizer real.

## Hallazgos confirmados

### 1. El modo complemento tiene un coste de contexto no trivial

`src/mcp/server.ts:119–252` registra 17 herramientas. `src/adapters/common.ts:25–26` instala instrucciones que piden brief, recuerdos y cierre. `templates/EDU.md:15–23` pide además revisión cruzada antes de dar cambios por terminados. Las operaciones locales de memoria no llaman por sí mismas a un modelo, pero el modelo necesita generar llamadas, leer resultados y continuar.

Para tareas pequeñas o un cerebro sin conocimiento útil, no hay ahorro de trabajo previo demostrado que amortice ese protocolo. Para tareas repetidas, la memoria podría evitar búsquedas y errores; es una hipótesis que exige medir resultados.

### 2. En Pi el brief se reconstruye por interacción, no una vez por sesión

`plugins/pi/extensions/edu.ts:161–168` llama sincrónicamente a `edu hook session-start` dentro de `before_agent_start` y devuelve un prompt de sistema modificado. No hay guardia por sesión. No ocurre por cada herramienta interna: ocurre al inicio de cada ejecución del agente.

`src/cli/hooks.ts:34–42` fija el presupuesto en 1.500. El propio brief vuelve a pedir `edu_brief`, por el protocolo de identidad: hay riesgo de lectura duplicada del arranque automático y manual.

Esto no significa que todo se acumule permanentemente en el sistema ni que todo se facture sin caché. La fixture del agente principal produjo cuatro briefs byte-idénticos. El agente de contexto reprodujo otro caso en que dos briefs consecutivos reordenan lecciones: `brief()` activa `trackUsage`, que registra uso y afecta al ranking (`src/context/brief.ts:5–6`, `src/context/pack.ts:104–125`). La estabilidad no es universal. Una invalidación de caché específica de Kimi **no está demostrada**.

### 3. En `edu run` hay contexto duplicado dentro de una misma solicitud

- El planificador recibe `pack.text` en `planningPrompt` (`src/orchestrator/run.ts:124–125`).
- Los pasos reciben `supportContext()` dentro de su prompt (`:311–314`).
- `runText` vuelve a añadir el contexto a todos ellos (`:438`).
- `supportContext()` ya contiene el paquete del cerebro (`:405–412`).

Por tanto, el paquete se repite en solicitudes del planificador y trabajadores. El presupuesto predeterminado de 8.000 (`src/orchestrator/config.ts:25`) limita **una copia del paquete**, no la solicitud completa: dos copias pueden aportar hasta aproximadamente 16.000 tokens estimados, antes de instrucciones, tarea, registro, herramientas e historial. No aplica automáticamente al uso del complemento sin `edu run`.

### 4. `solo` no significa una sola ejecución de modelo

Incluso una tarea con un único paso requiere planificador, trabajador y revisor (`src/orchestrator/run.ts:125,314,260`). Puede haber una reparación del plan y correcciones adicionales. Eso son al menos tres ejecuciones de agentes para ese ejemplo, no necesariamente solo tres peticiones HTTP: cada agente puede tener sus propios turnos y herramientas.

La revisión y las verificaciones pueden aportar garantías, pero su coste debe compararse contra el trabajo que evitan. No atribuir todo este multiplicador a quien únicamente instaló el complemento: depende de qué funciones invoque.

### 5. Las métricas existentes no resuelven la pregunta económica

`src/evidence/metrics.ts` calcula éxito verificado, intervenciones, autonomía de verificación, recuperación, atribución y entropía. Su interfaz `EpisodeSummary` no incorpora gasto, tokens, modelo o latencia para una comparación coste/calidad.

Los motores sí pueden registrar eventos de uso y caché cuando el host los proporciona (`src/engine/parse.ts:47–52`); eso no equivale a tener un benchmark A/B ni una agregación de coste por tarea correcta. El test de rendimiento de arranque (`src/context/session-start.perf.test.ts`) mide cálculo local de briefs sobre datos sintéticos, no calidad de respuestas ni coste de Kimi.

### 6. La lectura de memoria puede gastar una llamada sin entregar el contenido

Reproducido por el agente de contexto y de nuevo por el principal con el MCP real: una nota de un único párrafo largo devuelve únicamente cabecera y `…`, **28 tokens estimados de los 800 disponibles, sin ninguna frase del cuerpo**. `truncateToTokens()` prioriza cualquier corte por salto de línea que quepa, aunque sea solo la cabecera (`src/context/tokens.ts:19–24`). No hay offset/paginación en `edu_read`. Repetir la misma lectura no recupera el contenido; subir el límite puede encarecerla. Es un defecto concreto que limita el retorno útil de la memoria.

### 7. Algunos límites del protocolo no cubren todas las rutas

El agente de evidencia confirmó que `maxFixRounds: 0` no impide una corrección solicitada por el revisor: la corrección posterior al review es una ruta independiente y no termina en una segunda revisión (`src/orchestrator/run.ts:232,266–298`). Los checks deterministas sí se vuelven a ejecutar si existen. No tratar ese parámetro como límite global de correcciones o gasto.

Además, el protocolo pide `edu_session_close`, pero el brief no abre una sesión (`src/cli/hooks.ts:37–42`); si el modelo no abrió una antes, el cierre puede fallar. No se ha cuantificado cuánto gasto añaden estos casos en sesiones reales.

## ¿En qué ganamos hoy?

| Dimensión | Conclusión respaldada |
|---|---|
| Memoria persistente y continuidad | Funcionalidad implementada; su ahorro neto no está medido. |
| Verificación y trazabilidad | Hay checks deterministas, paquetes de evidencia y clasificación del resultado. No garantizan mejor resultado frente al nativo en toda tarea. |
| Tokens/coste | Hay sobrecarga identificada y duplicación evitable. Sin ahorro neto demostrado. |
| Velocidad de resolución | Sin mejora comparativa demostrada; se añaden procesos y fases. |
| Calidad de Kimi | Indeterminada: faltan ejecuciones controladas con el mismo modelo y proveedor. |

**No vendería Edu como más barato ni más rápido por defecto.** Lo presentaría como memoria y controles adicionales cuyo retorno depende del trabajo.

## Prioridades antes de prometer una mejora

1. Eliminar la segunda copia del contexto en `edu run` y probar que cada paquete aparece una sola vez.
2. Inyectar el brief una vez por sesión o actualizarlo explícitamente; no pedir `edu_brief` cuando ya se suministró uno válido. Corregir la lectura truncada y hacer coherente la apertura/cierre de sesiones.
3. Ofrecer un modo ligero explícito: herramientas de memoria necesarias, sin orquestación ni revisión automática para tareas triviales. Es propuesta de producto, no cambio aplicado.
4. Medir y presupuestar el prompt final, no solo el paquete del cerebro; desglosar input, output, razonamiento, cache reads/writes, tiempo y coste real.
5. Validar con A/B antes de afirmar ahorro o mejora de calidad.

## Experimento mínimo para responder sobre Kimi

- Mismo harness anfitrión, versión de Kimi, proveedor, nivel de razonamiento, límite de salida, permisos y estado inicial del repositorio.
- Tres brazos: **nativo sin Edu**, **mismo host + complemento Edu**, **Edu con orquestación**, sin mezclar el segundo con el tercero.
- 20 tareas representativas por brazo, al menos 3 repeticiones pareadas, orden aleatorio y sesiones aisladas. Incluir tareas pequeñas, cambios con pruebas y tareas que sí puedan reutilizar memoria.
- Separar cerebro nuevo de memoria ya útil; fijar la misma instantánea por repetición para evitar contaminación entre brazos.
- Comparar caché fría y caliente por separado; conservar usage y factura del proveedor. No asumir que los precios o el footer del host reflejan toda la factura.
- Evaluación ciega con criterios y checks externos fijados antes del ensayo. Incluir fallos, reintentos, tiempo humano y coste de construir/mantener la memoria.
- Métricas primarias: **coste total / tareas correctamente resueltas**, porcentaje correcto, tiempo total y correcciones humanas. No tomar longitud de respuesta o un veredicto del propio revisor como calidad objetiva.
- Fijar de antemano el umbral aceptable: ganar calidad a mayor precio no es lo mismo que ganar eficiencia.

`edu run --harness H0` no debe usarse como sustituto de nativo sin Edu: sigue pasando por el orquestador.

## Verificación y límites

- `npm test -- --maxWorkers=2`: **733 aprobados, 1 omitido**, 97 archivos.
- `npm run typecheck`: aprobado.
- `npm run build`: aprobado; sin cambios en `dist`.
- Prueba MCP y hooks ejecutada sobre cerebro temporal y eliminada después.
- Node v25.9.0: npm avisa que Vitest declara soporte para otras ramas (22.12+, 24 o 26+); los comandos anteriores terminaron correctamente.
- Sin acceso a configuración, trazas, factura o tareas del colega: no podemos asignar su diferencia concreta a una causa ni dar un porcentaje de sobrecoste real.
- Herramientas de memoria `edu_*` no disponibles en esta sesión; no se creó un cerebro real solo para registrar la auditoría.

**Abierto:** A/B real con Kimi y confirmación de harness/versión/configuración del colega. Esta auditoría aporta diagnóstico estático y mediciones locales, no prueba causal de mejora o empeoramiento del modelo.
