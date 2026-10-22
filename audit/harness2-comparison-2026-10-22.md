# Harness2 y Edu: comparación y propuesta para Edu 2.1

**Recomendación:** incorporar experimentación controlada y experiencia vinculada a artefactos sobre el cerebro existente de Edu. Primero cerrar los contratos de medición y permisos; después validar skills con sus helpers; finalmente probar una mejora del harness frente a controles. Este documento propone trabajo: no autoriza su implementación ni acredita ahorro.

Harness2 aporta un ciclo que no encontramos equivalente en Edu: proponer cambios al harness, ejecutar variantes de la misma tarea, componer cambios y conservar lo adoptado con su evidencia. Edu aporta gestión persistente de conocimiento, crédito condicionado a checks, aceptación humana e instalación orientada al uso cotidiano. Son capacidades complementarias, no una clasificación universal de mejor y peor.

## Alcance reproducible

- Fecha: 22 de octubre de 2026.
- Harness2: [1cfe254e8d25b15f37048c3730134686abe60335](https://github.com/google-research/harness2/tree/1cfe254e8d25b15f37048c3730134686abe60335).
- Edu: [a7b57e632cb9750375ca7983b07b43c286fa6d48](https://github.com/EduardoMoraga/edu/tree/a7b57e632cb9750375ca7983b07b43c286fa6d48), versión 2.0.0-rc.1. El paquete no cambió respecto al commit de la RC publicada. El main público seguía en 0.10.2; no se utilizó esa versión antigua como comparación.
- Cuatro auditores: Codex/gpt-6.1-sol (ejecución y seguridad), Claude/Sonnet (aprendizaje), Pi/gpt-6.1-sol (evaluación) y OpenCode/openai/gpt-6.1-sol (integración). Son cuatro entornos de agente, no cuatro familias independientes de modelos ni un benchmark entre ellos.
- Código, tests, documentación y paper contrastados. No se ejecutaron benchmarks con modelos ni se hicieron instalaciones, cambios de producción, commits o publicaciones.
- Herramientas de memoria Edu no expuestas en esta sesión; no se inventó una sesión ni se sustituyó el cerebro del usuario.

## Comparación

| Aspecto | Harness2 inspeccionado | Edu 2.0 RC inspeccionado |
|---|---|---|
| Objetivo operativo | Adaptar el harness durante una secuencia de tareas | Reutilizar conocimiento y coordinar trabajo con evidencia |
| Mejora durante la tarea | Variantes ejecutadas y composición contrastiva | Reproducción, correcciones acotadas y verificación; sin competición de variantes del harness |
| Memoria | Árboles de harness adoptados y experiencia por dominio | Notas tipadas, sesiones, búsqueda, estados, feedback y propuestas de skills/canónicas |
| Señal de aprendizaje | Trayectorias y entregables reales, interpretados por modelos; grading posterior separado | Feedback asesor separado de crédito condicionado a checks relevantes |
| Ciclo de vida | Biblioteca indexada por experimento/dominio; no encontramos promoción/retiro equivalentes en ese módulo | Eventos deduplicados, promoción con verificaciones y retiro/sustitución |
| Integraciones | Dos ejecutores: OpenCode y Codex; Claude CLI también puede actuar como editor/selector | Cinco adaptadores declarados: Claude Code, Codex, Pi, OpenCode y Antigravity; existencia no implica paridad de capacidades |
| Instalación | Entornos y configuración destinados al runner de investigación | Instalación gestionada, conservación de bloques custom, procedencia y respaldos de actualización |
| Evidencia de utilidad | Evidencia experimental publicada; no reproducida aquí | Piloto guardado con empate 10/10, sin uso/coste comparables |

Fuentes del mecanismo: [recursión de Harness2](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/recursion.py#L343), [biblioteca](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/library.py#L106), [orquestador de Edu](https://github.com/EduardoMoraga/edu/blob/a7b57e632cb9750375ca7983b07b43c286fa6d48/src/orchestrator/run.ts#L198), [aprendizaje de Edu](https://github.com/EduardoMoraga/edu/blob/a7b57e632cb9750375ca7983b07b43c286fa6d48/src/brain/learning.ts#L34), [adaptadores](https://github.com/EduardoMoraga/edu/blob/a7b57e632cb9750375ca7983b07b43c286fa6d48/src/engine/index.ts#L17).

## Qué vale la pena incorporar

1. **Experimentos del harness con evidencia antes/después.** Conservar propuesta, hashes, ejecución, entregable y decisión. Permite saber qué se intentó, no solo guardar una recomendación. Separar observaciones favorables, desfavorables e inconclusas. Un juicio de modelo sigue siendo una hipótesis; no debe conceder automáticamente victorias verificadas.
2. **Skills como paquetes completos y comprobables.** Incluir SKILL.md, scripts auxiliares, requisitos, hosts compatibles y pruebas. Harness2 comprueba metadatos, referencias a helpers, sintaxis y tamaño de texto siempre presente. Esas comprobaciones estructurales son útiles, aunque no demuestran seguridad ni corrección funcional. [Validador](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/tree.py#L345).
3. **Experiencia operacional recuperada bajo demanda.** Asociar la lección con la skill/helper y las condiciones en que funcionó, manteniendo el ranking y ciclo de vida de Edu. En Harness2 copiar la biblioteca al workspace no equivale a inyectarla entera al prompt: el editor consulta su índice. [Materialización](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/context.py#L160).
4. **Comprobación de configuración efectiva.** Contrastar configuración fuente, archivos gestionados y registro que selecciona el host. Detectar deriva antes de ejecutar; no sobrescribir configuración personal ni afirmar que un proceso abierto recargó su plugin. [Preflight de configuración](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/install.py#L236).

## Qué debe conservar Edu

- Su memoria persistente y tipada, con ranking y presupuesto contextual. No sustituirla por una colección de snapshots por barrido.
- Su separación entre observación inferida, feedback asesor y crédito verificado. Ni una cita de una lección ni un resultado correcto prueban beneficio causal.
- La aceptación explícita de skills/canónicas y la conservación de archivos personalizados. La adopción automática de un experimento no debe convertirse en permiso para modificar globalmente el entorno.
- Su compatibilidad entre hosts y plataformas, comprobada por capacidad concreta. No importar el runtime Python/Linux como requisito general del producto.

Referencias: [propuestas y aceptación](https://github.com/EduardoMoraga/edu/blob/a7b57e632cb9750375ca7983b07b43c286fa6d48/src/reflect/proposals.ts#L28), [instalación gestionada](https://github.com/EduardoMoraga/edu/blob/a7b57e632cb9750375ca7983b07b43c286fa6d48/src/adapters/installer.ts#L149).

## Tres pendientes concretos de Edu detectados

| Hallazgo verificado | Alcance y consecuencia |
|---|---|
| [AUTONOMY_FLAGS de Pi/OpenCode vacíos](https://github.com/EduardoMoraga/edu/blob/a7b57e632cb9750375ca7983b07b43c286fa6d48/src/engine/autonomy.ts#L18) | El scheduler puede agrupar roles declarados readonly, pero este adaptador no establece restricciones equivalentes. No se demostró una evasión de permisos del host; la etiqueta sola no acredita aislamiento. |
| [Tokens ausentes convertidos a cero](https://github.com/EduardoMoraga/edu/blob/a7b57e632cb9750375ca7983b07b43c286fa6d48/src/engine/parse.ts#L35) | makeUsage usa cero por defecto para input/output ausentes. El contrato de evaluación conserva USD desconocidos, pero hace falta preservar desconocidos desde la captura, no solo al agregar. |
| [Instalador compartido copia únicamente SKILL.md](https://github.com/EduardoMoraga/edu/blob/a7b57e632cb9750375ca7983b07b43c286fa6d48/src/adapters/common.ts#L39) | En este recorrido no se instalan helpers hermanos. Es una limitación concreta para memoria operacional basada en scripts, no un fallo demostrado de todas las instalaciones nativas. |

No se corrigieron durante esta auditoría. Las restricciones por texto o regex de comandos tampoco deben presentarse como un sandbox.

## Cómo interpretar la evidencia de Harness2

El [paper, sección 4](https://arxiv.org/html/2610.14224v1#S4), publica ablaciones de biblioteca y transferencia. Quitar la biblioteca reduce las puntuaciones reportadas; es evidencia más amplia que el piloto actual de Edu. No reprodujimos esos experimentos. El análisis retrospectivo que excluye la propia entrada puede usar experiencia posterior y no equivale a validación online. El paper reconoce coste adicional y sesgos compartidos del juicio de modelos; no garantiza ahorro universal.

Dos precauciones específicas del release:

- Su identidad presupuestaria de 4k ejecuciones y 3k etapas no es un techo monetario. La contabilidad nominal excluye selección/reflexión de esa identidad; el gasto mostrado por la CLI no cubre todas las ejecuciones. No confundirlo con el cómputo completo del paper. [Ledger](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/ledger.py#L15), [reporte](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/cli/report.py#L37).
- La documentación reconoce que una ejecución de validación descargó una rúbrica pública. Eso muestra una limitación del aislamiento del release; no demuestra contaminación del paper. Los resultados sin grading se excluyen del denominador, por lo que deben reportarse también faltantes y fallos. [Acceso web](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/docs/EXPERIMENTS.md#L93), [denominadores](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/report.py#L15).

Las funciones de lectura/escritura de árboles también siguieron enlaces simbólicos en fixtures temporales del auditor. Es una observación sobre esas funciones, no una demostración de explotación remota o escape de un sandbox instalado.

## Plan propuesto para Edu 2.1

| Entrega | Resultado | Criterio de aceptación |
|---|---|---|
| A. Medición y permisos | Telemetría normalizada y capacidad real por host | Ausente no es cero; contabilizar reintentos, recuperación, reflexión y selección; restricciones comprobadas o rechazo de la capacidad solicitada; reinicio sin duplicar registros. |
| B. Skills comprobables | Paquete con helpers, hashes, evidencia y aceptación humana | Helper funciona tras instalación/upgrade; dependencias ausentes y rutas fuera del paquete se rechazan antes de escribir; custom se conserva; rechazo no activa cambios. |
| C. Experimento optativo | Una propuesta acotada, sondeo aislado y contraste con baseline | Checks protegidos, input congelado, presupuesto explícito, fallback al baseline y ninguna modificación global automática; beneficio no inferido de la preferencia del modelo. |

Orden: A → B → C. No empezar por permitir edición libre de plugins, permisos o guardrails. La composición de varias propuestas puede esperar a que un experimento mínimo aporte señal útil.

Para evaluar C, comparar sesiones nuevas y emparejadas: nativo limpio, Edu actual, control con cómputo adicional sin cambio del harness, y Edu experimental. Mantener modelo/backend, herramientas, entradas y presupuestos comparables; congelar un evaluador que el agente no pueda consultar. Incluir fallos, timeouts, ayuda humana y adquisición de experiencia. Comprobar reutilización en tareas posteriores reservadas y ante cambios de política. La ablación memoria estática/adaptativa es un análisis adicional, no un sustituto del control por cómputo.

Primero presupuestar un piloto de factibilidad; no se ejecutó ni se autorizó aquí una campaña con modelos. Fijar antes los criterios de calidad y coste por tarea correcta. Un piloto pequeño informa la viabilidad; una afirmación general exige repeticiones y un diseño confirmatorio con incertidumbre estadística. USD desconocido impide afirmar ahorro monetario.

No hay evidencia para anunciar hoy Edu 3.0 ni mejoras de eficiencia. Una siguiente versión menor experimental es razonable si mantiene contratos compatibles; una versión mayor requiere justificar también sus cambios incompatibles.

## Qué se ejecutó realmente

- Dos auditores ejecutaron los cinco tests de flujo de Harness2: pasaron con fixtures y editor deterministas. El intérprete era Python 3.11.2, fuera del rango declarado por el proyecto (3.12/3.13); no cuenta como validación en entorno soportado ni como prueba de transferencia causal.
- Se repitió el grading de los cuatro archivos de respuestas guardados del piloto de Edu: 10/10 cada uno, sin respuestas extra. No se volvieron a ejecutar modelos ni se midieron tokens, facturación o velocidad.
- Se realizaron probes temporales de enlaces simbólicos y clasificación de comandos. No se ejecutó la expresión destructiva usada como dato de clasificación.
- Se contrastaron hallazgos entre agentes y con código. Se corrigió una conclusión inicial que confundía ausencia de resultados crudos en el repo con ausencia de evidencia publicada.

Informes de apoyo en el sandbox: [ejecución y seguridad](/tmp/edu-harness2-engine-security.md), [aprendizaje](/tmp/edu-harness2-learning.md), [evaluación](/tmp/edu-harness2-evaluation.md), [integración](/tmp/edu-harness2-integration.md). Este documento reúne sus conclusiones verificadas y limita las afirmaciones negativas al código inspeccionado.
