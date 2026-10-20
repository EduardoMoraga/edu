# Edu 2.0 — candidata interna, no release estable

**Estado:** `2.0.0-rc.1` para validación. No hay tag, release `latest` ni publicación npm de esta candidata.

## Qué está implementado

- Captura de hasta tres observaciones inferidas al cerrar una sesión con el modelo que ya trabaja; sin segunda inferencia obligatoria.
- Consolidación estructurada local, acotada, repetible y con cursor justo; reflexión con modelo solo explícita.
- Recall con fragmentos utilizables y estados activos; presupuesto contextual, brief de solo lectura y caché Pi por sesión/workspace.
- Crédito asesor separado del externamente verificado; eventos deduplicados y protección de notas probadas/heredadas.
- Escritores y sesiones serializados, fallos/fin de runs clasificados sin fingir éxito y evidencia completa antes de crédito.
- Migración respaldada de cerebros globales/proyectos registrados, preservación de identidad/rutas/custom y refresh de cachés nativas prístinas admitidas. Ante layouts desconocidos: conflicto explícito.
- Capacidades consultables, evaluación de cuatro brazos y costes desconocidos como `null`.
- Perfil MCP `memory` opcional: 12 herramientas frente a 18, sin cambiar el default compatible.

## Evidencia que sí existe

- [Validación final Linux / Node 22](final-validation.json): 1021 tests pasan en 124 archivos; 1 test preexistente requiere un vault privado Albert no suministrado. Typecheck, generación, build e instalación fresca pasan.
- [Upgrade del artefacto publicado 0.10.2](upgrade-smoke.json): npm y updater anterior reales; fixtures de metadata release y host Codex, **no** reload nativo real.
- [Piloto con Codex y Claude](pilot-results.md): captura/recall por MCP real; **10/10 en todos los brazos**, empate. No establece mejora causal, ahorro o facturación.
- [Catálogo MCP medido](catalog-results.json): full 11921 bytes / estimación local 3461 tokens; memory 8296 bytes / 2406. Es el catálogo serializado, no la petición de un proveedor ni una factura. Reproducible con `node --experimental-strip-types audit/v2/measure-catalog.mjs` después del build.
- Informes `review-*.md`: probes cruzados y snapshots. Los recuentos de cada informe son históricos y no equivalen a aprobación global del diff final.

## Lo que sigue abierto

1. CI nativa Linux/macOS/Windows y reload real de plugins en clientes admitidos.
2. Decisión del propietario sobre RC y estrategia de PRs encadenadas; no abrir un PR enorme y llamarlo revisable. La rama de trabajo no se presenta como lista para merge.
3. URL exacta, acceso y visibilidad del repositorio laboral privado antes de enviarle nada.
4. Eficiencia con modelos reales: controles nativos limpios, repeticiones independientes, coste/uso comprobable y tareas representativas. Gemini/Kimi no fueron evaluados.
5. Auditoría completa de dependencias: 0 vulnerabilidades de producción; queda 1 low de esbuild de desarrollo (servidor Windows no usado por estos builds). No se fuerza un salto de build-tool mayor para ocultarlo.

Markdown y rollback sobre errores ordinarios no son una base transaccional crash-safe para varias notas. Un proceso del mismo UID puede competir con el gestor de plugins entre syscalls: las comprobaciones repetidas no son una firma ni una frontera contra el dueño del filesystem.

Contrato de alcance: [plan](../../docs/EDU-2.0-PLAN.md). Condiciones para publicar: [release gates](../../docs/evals/edu-2.0-release-gates.md). Guías: [upgrade](../../docs/guides/upgrade-2.0.md) y [aprendizaje](../../docs/guides/learning-2.0.md).
