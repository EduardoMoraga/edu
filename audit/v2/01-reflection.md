# Unidad 1 — Reflexión (revisión corregida)

Propiedad respetada: solo `src/reflect/*` y este informe. Sin commits, instalaciones, versiones, callbacks ajenos ni cerebros/config reales. Leídos plan completo, auditoría 06 y `review-retrieval-reflection.md` con su fuente `.repro.test.ts.txt`. No modifiqué search/pack.

## Cambios y archivos

- `reflect.ts`: validación completa antes de escribir memoria; ventana por `updated ?? created`; salida validada persistida para reintentos. Presupuesto final, selección acotada, referencias solo a notas suministradas y ACK solo de paquetes íntegramente suministrados. No promueve lecciones proven históricas.
- `consolidate.ts` (nuevo): consolidación local sin motor; solo intervenciones estructuradas evitables, con acción/detalle/gap válidos y enlace a sesión cerrada existente. Cursor persistente `.reflection-queue-cursor.json`: ventana circular acotada que avanza incluso sobre entradas inválidas, sin borrarlas. El cursor avanza hasta la última entrada de toda la ventana inspeccionada (`ordered.at(-1)`), incluidas inválidas; al terminar vuelve al inicio. Reflect prioriza los episodios del turno de cola, manteniendo su presupuesto final.
- `persistence.ts` (nuevo): dedup por contenido/evidencia con cuerpo normalizado CRLF→LF y trim antes de hash, escritura y comparación. Sufijo hash de 96 bits en título/ID; tags añadidos no alteran identidad. Resultado distingue existente/creado/rechazado.
- Lock compartido `.reflection.lock`: registro completo instalado mediante hardlink exclusivo; PID/token/host. Recupera solo PID confirmado muerto (`ESRCH`), serializando recuperación y revalidando propietario. Nunca roba por antigüedad; PID vivo, EPERM, host distinto o registro ambiguo quedan bloqueados. Recupera también un guard de recuperación huérfano. Cleanup conserva resultado/error original y no borra un propietario distinto.
- `proposals.ts`: valida YAML, nombre coincidente, descripción y cuerpo antes de instalar. Aceptación repetida conserva aprobación; aceptación/rechazo comparten lock y escrituras atómicas.
- `index.ts`: exports nuevos. Tests: `reflect.test.ts`, `reliability.test.ts`, `budget.test.ts`, `review-regressions.test.ts` (los tres últimos nuevos).

## API para integrar

```ts
consolidatePending(brain: Brain, brainRoot: string,
  options?: ConsolidateOptions): Promise<ConsolidateReport>

interface ConsolidateOptions {
  maxEntries?: number;       // default 50, máximo 1000
  maxInterventions?: number; // por paquete: default 200, máximo 1000
  maxBytes?: number;         // por archivo: default 262144, máximo 1048576
  since?: string;            // default '7d'; d/h/m
  now?: Date;
}
interface ConsolidateReport {
  lessons: string[];      // IDs asegurados; pueden existir previamente
  acknowledged: string[];
  skipped: string[];      // entradas parseables no procesadas
  busy: boolean;
}
```

Exports presentes en `src/reflect/index.ts`: función y ambos tipos. Cola compatible: `{runId, sessionId, queuedAt?}` y paquete `runs/<runId>/{task.json,outcome.json,intervention.jsonl}`. No conecté callbacks. ACK mediante rename/comparación conserva entradas nuevas/reemplazadas; claims interrumpidos siguen siendo JSON recuperables.

`ReflectInput` añade `budgetTokens?: number` (8000) y `maxEpisodes?: number` (20), enteros positivos. Prioridad al turno de cola; resto por updated descendente e ID. Máximo 20 targets y 20 resúmenes seleccionados. Trunca campos de nota antes de serializar JSON; mide el prompt completo con `estimateTokens` y vuelve a comprobar `request.prompt` inmediatamente antes de `engine.run`. Si ningún episodio cabe, no llama al motor ni hace ACK.

Campos aditivos opcionales de `ReflectReport`:

```ts
promptTokens?: number;
advisoryFeedback?: string[];
omitted?: {
  episodes: number; targets: number; runSummaries: number;
  runLogFiles?: number; interventions: number;
};
deferred?: string[];  // episodios no suministrados
truncated?: string[]; // notas acortadas
```

- `feedback` queda **vacío**: no hubo crédito aplicado. `advisoryFeedback` lista IDs únicos de opiniones; Brain.feedback nunca se llama, ni se genera `verified`. La salida cruda queda auditada en el journal, sin sumar votos.
- `canonicalProposals` y `skillProposals` cuentan **solo nuevas escrituras**; excluyen existentes, aceptadas y rechazadas.
- `evidence: []` conserva compatibilidad: links vacíos y tag `uncited`, sin fabricar citas. La procedencia de procesamiento (episodios/targets suministrados) vive aparte en `*.json.provenance.json`; no demuestra apoyo a un claim.
- `episodesRead` cuenta solo los suministrados. `omitted.runLogFiles` cuenta archivos fuera del límite, ilegibles o >256 KiB; `runSummaries` cuenta resúmenes conocidos omitidos, sin inventar cuántos había en archivos no leídos.

## Comandos y resultados exactos

- `room-cli files wait` → exit 0.
- Repro inicial: `./node_modules/.bin/vitest run --config audit/learning/06-vitest.config.ts --maxWorkers=1` → exit 1, 6 pasan / 1 falla: `Note id already exists: L-always-read-auth-ts-first`.
- Repro budget antes del fix: `./node_modules/.bin/vitest run src/reflect/budget.test.ts --maxWorkers=1` → exit 1: request **230913 tokens estimados > 2000** con 35 episodios y 35 targets.
- Repro revisión antes de corregir: `./node_modules/.bin/vitest run src/reflect/review-regressions.test.ts --maxWorkers=1` → exit 1, **8/8 fallan**: starvation local/reflect, lock muerto, cleanup, CRLF, citas/feedback/proven, propuesta rechazada, logs omitidos.
- Final: `./node_modules/.bin/vitest run src/reflect --maxWorkers=1` → **exit 0, 35/35, 4 archivos**.
- Final: `./node_modules/.bin/tsc --noEmit` → **exit 0**, incluidos contratos actuales de FeedbackContext. Los dos TS18048 anteriores por updated opcional están corregidos.
- `git diff --check -- src/reflect` → exit 0; diff y archivos nuevos revisados.

Fixtures temporales, motores falsos, sin pruebas por grep. Se mantienen comprobaciones de presupuesto final, IDs omitidos, cola vieja/nueva/reemplazada, reanudación tras escritura parcial, seguridad de skills, límites y exclusión mutua. Nuevas pruebas incluyen recuperación concurrente y del guard, y rechazo humano de skills/canónicas. El test de orden ahora exige turno de cola (no recencia absoluta) para verificar equidad; el de feedback exige cero aplicado y advisory separado.

## Límites y pendientes

Principal integra callbacks y presentación de campos nuevos; ninguna edición ajena solicitada. El presupuesto es una estimación del proyecto, no tokenizer del proveedor ni garantía monetaria. Brain todavía carga notas y el cursor enumera nombres: se acotan archivos inspeccionados/contexto enviado, no toda la memoria/CPU del índice. Entradas inválidas o demasiado grandes permanecen para corrección, pero no bloquean a las posteriores.

No migración destructiva de notas antiguas ni limpieza automática de journals. Registros de lock antiguos malformados, PID reutilizado/vivo, host distinto o más de 8 guards huérfanos encadenados fallan cerrados; requieren inspección. Los archivos deben admitir hardlinks. Un fallo tras aprobar/instalar una skill puede dejar incompleto su episodio de auditoría, pero no borra aprobación al reintentar. Validar formato no demuestra seguridad semántica de la skill: la aprobación sigue siendo humana.

Sin llamadas pagadas automáticas ni afirmaciones de eficiencia LLM. `edu_brief`/`edu_session_close` no disponibles; no escribí memoria real. Suite global/build/release quedan para integración.

## Re-review final: avance de ventana y log real

Leído `audit/v2/review-retrieval-reflection-final.md`. Reproducción antes de corregir: `./node_modules/.bin/vitest run src/reflect/review-regressions.test.ts --maxWorkers=1` → exit 1, 10 pasan / 1 falla: tras 7 llamadas con maxEntries=20 la entrada válida 131 todavía no se confirmaba. Corregido el avance de una sola posición por avance de la ventana completa inspeccionada.

La regresión ahora confirma la entrada válida **en la llamada 7** (`ceil(131/20)`), reabriendo Brain en cada llamada y verificando conservación byte a byte de las otras 130 entradas (malformed o recuperables). No se añadió cuarentena ni borrado de inválidas; `skipped` conserva su contrato para entradas parseables no procesadas.

Hallazgo 8 comprobado con un archivo JSONL **válido y físicamente mayor de 256 KiB** (tamaño comprobado con stat), junto a otro log pequeño: `omitted.runLogFiles === 1`, marcador grande ausente del request, resumen pequeño presente y archivo grande conservado. Se mantienen límites de lectura y presupuesto de 8000 tokens estimados.

Final tras ambos cambios: `./node_modules/.bin/vitest run src/reflect --maxWorkers=1` → exit 0, **35/35**; `./node_modules/.bin/tsc --noEmit` → exit 0; `git diff --check -- src/reflect` → exit 0.
