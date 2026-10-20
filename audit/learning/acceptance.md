# Criterios previos: demostrar aprendizaje, no contar opiniones

Estos criterios fijan cómo interpretar la auditoría de 10 agentes. No son un benchmark LLM ya ejecutado ni un cambio de producto. Se distinguen mecanismos locales verificados, integración de harness, aprendizaje de extremo a extremo y eficiencia económica.

## Puertas de evidencia

| Puerta | Evidencia mínima | No basta con |
|---|---|---|
| G1 Persistencia | Un proceso registra una experiencia y otro recupera su contenido correcto desde el cerebro del proyecto previsto. | Reutilizar el historial de una conversación o leer una variable en memoria. |
| G2 Transferencia útil | Una tarea relacionada recupera la decisión/lección pertinente, con contenido accionable, entre distractores y con presupuesto acotado. | Que aparezca solo un título o una coincidencia por id. |
| G3 Crédito | Se distingue exposición, aplicación e impacto; feedback se vincula a un resultado observado y no solo a la opinión del agente. | Incrementar `uses`, marcar `helpful` sin evidencia o aceptar el veredicto del propio agente. |
| G4 Corrección | Una lección contradicha u obsoleta deja de orientar tareas futuras; reemplazos y conflictos no reintroducen el error. | Mantenerla accesible pero llamarla retirada, o aumentar su peso cada vez que aparece. |
| G5 Autogestión | Tras el flujo normal se ejecuta el ciclo previsto de consolidación/mantenimiento, o se documenta explícitamente qué activación humana requiere. | Escribir una cola sin consumirla; tener un comando de reflexión que nadie llama. |
| G6 Beneficio longitudinal | Tareas relacionadas posteriores mejoran frente a nativo sin Edu y frente a memoria estática, con evaluación externa y sesiones nuevas. | Tests unitarios, un motor falso, 10 revisiones favorables o comparar dos modelos distintos. |

La aprobación humana para cambiar verdades canónicas o skills es una barrera de seguridad legítima. No se cuenta automáticamente como defecto; sí debe distinguirse de autogestión sin intervención.

## Cómo interpretar el resultado

- **Mecanismos funcionan:** demostración local de operaciones concretas. No implica que el LLM aprenda mejor.
- **Integración verificada:** el harness puede acceder al cerebro correcto. Que el agente auditor arranque en ese harness no prueba toda la integración Edu de extremo a extremo.
- **Aprendizaje funcional demostrado en un escenario:** experiencia pasada cambia favorablemente una respuesta futura en sesión nueva, con criterios externos. No permite generalizar a cualquier proyecto/modelo.
- **Eficiencia demostrada:** menor coste total por tarea correcta para la trayectoria completa, incluyendo adquisición, reflexión, lecturas, escrituras, reintentos e intervenciones humanas. También comparar tiempo y porcentaje de éxito.
- **No evaluado/bloqueado:** conservar esa categoría; no convertir falta de acceso en fallo de Edu ni éxito de otro modelo en éxito de Gemini/Kimi.

## Diseño del ensayo LLM posterior (no ejecutado por estos 10 auditores)

Brazos: nativo sin Edu; Edu con cerebro frío; Edu con memoria estática; Edu con aprendizaje activado. Mismo modelo/proveedor/harness, permisos, tareas, snapshots de repositorio y condiciones de caché en cada comparación. Separar memoria de proyecto de instrucciones globales preinstaladas; una sesión que ya carga Edu no es un control nativo limpio.

Cada trayectoria contiene adquisición, tarea relacionada, distractor, corrección de un hecho y nueva tarea de transferencia. Abrir sesiones nuevas sin historial ni artefactos filtrados entre brazos. El dato aprendido debe ser accesible al brazo frío mediante una ruta legítima (documentación, fuente o pregunta al usuario); no fabricar ventaja ocultando el dato exclusivamente en el cerebro caliente. Registrar esa adquisición y su coste.

Fijar respuestas/checks externos, versiones, semillas/orden y criterio de éxito antes de ejecutar. Contar fallos, caché, razonamiento, tiempos, coste reportado y datos ausentes. Repetir pares; un piloto sirve para detectar problemas, no para prometer ahorro general. Gemini y Kimi quedan fuera hasta tener ruta de ejecución autorizada y autenticada.
