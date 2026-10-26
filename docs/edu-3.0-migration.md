# Edu 3.0 rc.1 conserva el cerebro y hace explícitos los límites

Este candidato agrega controles al motor existente. No requiere otra memoria ni instalar los seis paquetes evaluados. La instalación global no se actualizó. CI de tres sistemas aprobada, evidencia y límites: [verificación](edu-3.0-verification.md).

## Probar sin activar globalmente

Desde el checkout construido:

```text
node dist/cli.js --version
node dist/cli.js doctor --integrations --json
node dist/cli.js run --help
```

El resultado de versión debe ser `3.0.0-rc.1`. El doctor informa configuración registrada, no autenticación ni compatibilidad demostrada. Para MCP en Pi 1.4 revisa que exista una herramienta activa `codemode` o `tool_search`; la sola presencia del servidor no garantiza acceso desde el modelo.

## Configuración opt-in

El esquema de configuración conserva `version: 1`; las configuraciones anteriores siguen siendo válidas. Estos campos opcionales se agregan al `config.json` del workspace de prueba, no al cerebro canónico:

```json
{
  "routing": {
    "executor": { "cli": "codex" },
    "reviewer": { "cli": "claude" }
  },
  "execution": {
    "maxSpawns": 32,
    "maxConcurrency": 3,
    "timeoutMs": 1800000,
    "maxAdvisorCalls": 0
  }
}
```

`executor` afecta solo al builder. Planner/explorer conservan su configuración anterior. Una ruta explícita a una CLI ausente falla; no se inventa un reemplazo ni un modelo. Un `model` opcional pasa sin reinterpretarlo a la CLI seleccionada: comprueba sus nombres y autenticación por separado.

El presupuesto es del run: planificación, reparación, pasos y revisión comparten el máximo de invocaciones Edu. No es un límite de tokens, costo, turnos internos ni herramientas/subagentes nativos de una CLI. El timeout envía cancelación al motor; en Windows no demuestra limpieza universal de descendientes. El presupuesto de Crew individual fuera de `run` no cambia.

## Consulta y continuidad sin perder aprobaciones

Para consulta, configura `routing.advisor` y `maxAdvisorCalls: 1`. Edu exige soporte readonly en el motor y una aprobación humana específica de divulgación. No consulta con `--yes`/autoaprobación. El advisor puede inspeccionar archivos readonly: **no es una llamada sin herramientas**. Los logs locales de run conservan evidencia raw y pueden contener texto sensible. No apruebes la consulta en un workspace sensible.

`node dist/cli.js run --resume <runId>` recupera un objetivo terminal del mismo workspace, crea otro run/sesión y vuelve a planificar con nuevas aprobaciones. No copia el estado de aprobación ni repite pasos automáticamente. Rechaza runs `running` y `completed`: no es recuperación automática de un proceso caído. Los JSONL previos, las sesiones y el canónico no se reescriben.

## Artefactos y reversión

Crew conserva previews acotados. `edu_crew_artifact` recupera páginas locales por job ID y tipo `summary`/`output`. La redacción reconoce patrones de credenciales; no garantiza eliminar datos privados arbitrarios. No publiques artefactos ni logs.

Para revertir el candidato, vuelve a la versión anterior del código/paquete mediante el flujo de actualización existente. Conserva el workspace y sus respaldos. Los snapshots y artefactos nuevos son datos derivados locales; ninguna migración destructiva del cerebro forma parte de esta entrega. No hay actualización automática de paquetes externos, endpoints o certificados.
