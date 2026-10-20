# Cómo aprende Edu 2.0 sin volver a cargar toda la conversación

Estado: implementación candidata, no garantía de ahorro general. Edu no entrena los pesos del modelo: conserva experiencia recuperable y adapta prioridades mediante señales separadas de uso y resultado.

## El recorrido corto dentro de tu modelo habitual

1. El host recibe un brief acotado y abre/reutiliza una sesión con ID real.
2. Durante el trabajo recupera solo lo pertinente con recall/read. Las notas incluyen IDs, estado y pasajes accionables; la lectura larga admite páginas.
3. Cuando termina, **el mismo modelo que hizo el trabajo** puede entregar hasta tres lecciones estructuradas junto con `edu_session_close`. No se lanza otro modelo para releer la conversación.
4. Edu valida límites y referencias, conserva un journal de reintento y guarda esas anotaciones como `candidate` / `inferred`, enlazadas a su sesión. Una sesión posterior puede recuperarlas.
5. La exposición no prueba utilidad. El feedback advisory no promociona una lección nueva; los eventos únicos de un runtime con verificaciones externas aportan crédito distinto. La aprobación humana de estándares y skills se conserva.

Cerrar con lecciones es opcional: no hay que inventar una moraleja cuando no existe aprendizaje durable. El resumen por sí solo no se interpreta como conocimiento. El cuerpo anotado debe expresar una regla accionable, su ámbito y sus límites, sin secretos.

Ejemplo del argumento MCP (usa el ID realmente devuelto, nunca este placeholder):

```json
{
  "id": "<id-real-de-esta-sesion>",
  "summary": "Se corrigió el cierre prematuro de la conexión y se ejecutó la prueba correspondiente.",
  "lessons": [{
    "title": "Esperar el drenaje antes de cerrar conexiones de este servicio",
    "body": "En este servicio, esperar drainSockets antes de cerrar evita perder respuestas pendientes. Revalidar si cambia la biblioteca de transporte.",
    "evidence": []
  }]
}
```

Una referencia en `evidence` debe ser el ID de una nota existente. No tener referencias independientes no convierte la observación en falsa, pero tampoco la hace verificada. El pie de la nota conserva esa distinción. Repetir el mismo cierre no duplica lecciones; cambiar el payload de una sesión cerrada se rechaza. Si una escritura parcial falla, reintenta exactamente la llamada original.

## Consolidación y mantenimiento

Al terminar un run normal, la consolidación local consume un número acotado de entradas de evidencia estructurada ya disponibles. Puede registrar una intervención evitable observada, **no inventar su solución**. La cola conserva entradas no procesadas y rota para no atascarse en las primeras inválidas. Los resultados locales quedan bajo `state/consolidation.json`.

`edu reflect` es diferente: analiza episodios con un motor explícito, valida la respuesta antes de escribir y limita su request completo. Puede usar inferencia de pago; no se activa silenciosamente por actualizar. Las propuestas no se aplican por el mero hecho de existir.

## Perfil ligero para quien solo necesita el cerebro

El servidor conserva el perfil completo por compatibilidad. Si no necesitas orquestación/crew,
configura el MCP de tu host con argumentos `mcp --profile memory`, o con el entorno
`EDU_MCP_PROFILE=memory`, y reinícialo. Declara 12 herramientas en vez de 18; omite los seis
schemas de crew/orquestación, sin borrar memoria ni ejecutar un modelo. `full` restaura el
contrato completo. `edu_capabilities` del servidor muestra su perfil efectivo.

Esto reduce el catálogo, no demuestra el mismo ahorro en factura: hosts como Pi pueden diferir
schemas mediante Code Mode incluso en el perfil completo. Es una opción explícita del host;
conserva ese ajuste al reconciliar manualmente una configuración personalizada.

## Qué cuesta y qué sigue sin demostrarse

Anotar lecciones consume tokens de salida y las herramientas tienen coste de contexto/continuación. Evitar una segunda ejecución de reflexión no significa coste cero. Agrupar anotaciones con el cierre y recuperar pasajes relevantes permite reducir trabajo redundante, pero su balance debe medirse.

La reutilización está probada a nivel de almacenamiento, MCP y construcción del contexto. Que un modelo escoja, aplique y corrija esas lecciones correctamente requiere un ensayo longitudinal real. Los tests con motores guionados o solvers deterministas no lo sustituyen. Consulta [las puertas de publicación](../evals/edu-2.0-release-gates.md).

## Ámbito y seguridad

En Pi, la integración estándar solicita un MCP fijado al workspace del host: no puede cambiar de cerebro solo con `edu_project_use` y conservar un brief distinto. Cambia el cwd del host y reinicia MCP. Las configuraciones manuales que sobrescriban ese registro deben revisarse por separado. Los demás clientes MCP pueden permitir selección explícita: verifica siempre el ámbito y conserva un ID por workspace.

El historial sigue disponible aunque un elemento deje de recomendarse. La concurrencia de writers se controla, pero los ficheros Markdown no son una base de datos con transacciones multiarchivo y snapshots aislados. Los respaldos y journals son datos locales potencialmente privados: no los incluyas en el repositorio público.
