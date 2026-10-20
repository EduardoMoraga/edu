# Actualizar a Edu 2.0 sin perder tu cerebro

**Estado: candidata en desarrollo; esta guía no anuncia una versión ya publicada.** El comando de actualización es `edu update`, no `updated`. Una actualización de código no entrena el modelo ni reemplaza automáticamente las instrucciones de conversaciones que siguen abiertas.

## Cuando esté publicada la versión aprobada

```sh
edu update --check
edu update
edu --version
edu capabilities --json
```

`edu update` busca la última versión estable publicada. Una candidata solo se instala eligiendo su tag publicado explícitamente, por ejemplo `edu update v2.0.0-rc.1` **después de que ese tag y su paquete existan**. No uses `npm install` desde una rama en desarrollo para actualizar a tus colegas.

Después, cierra y vuelve a abrir Codex, Claude Code, Pi u OpenCode y reinicia su servidor MCP. Un proceso ya abierto puede conservar herramientas, schemas, prompts y código de extensiones de la versión anterior. No hay forma honesta de garantizar que un modelo sepa las novedades sin cargar esas instrucciones o consultar la versión instalada.

## Preguntarle al modelo qué cambió

Abre una sesión nueva y pídele:

> Consulta `edu_capabilities` (o ejecuta `edu capabilities --json`). Dime qué versión de Edu está realmente instalada, qué capacidades y límites declara y cómo usar la memoria sin volver a cargarla entera. No infieras mejoras de eficiencia que no estén medidas.

En Pi las herramientas pueden estar diferidas o dentro de Code Mode; `edu_capabilities` es el nombre lógico MCP, no necesariamente el nombre completo que expone el host. Si no descubre la herramienta, el comando de shell es la alternativa. `edu whats-new --json` devuelve el mismo contrato local. No hace falta cargar todo el cerebro para describir el software.

## Qué se conserva y qué se actualiza

- Se conservan notas, identidades custom, configuración, `brainDir`, decisiones y skills propias; no se inventan verificaciones para datos históricos.
- Se respaldan los archivos gestionados que vayan a cambiar, en el propio cerebro, antes de sustituirlos. Los respaldos pueden contener texto privado: no los publiques ni los copies al repositorio personal.
- La migración abarca cerebro global y proyectos registrados. Una ruta ausente, configuración inválida o fallo de respaldo no se oculta como éxito completo.
- El setup nuevo protege también el recorrido del actualizador antiguo 0.10.2, que llama primero a `setup` y después a migración. Actualizadores nuevos migran antes del refresh.
- La actualización no activa un LLM de pago en background. La consolidación local posterior al uso normal solo registra evidencia estructurada disponible. `edu reflect` es una operación explícita que puede usar un modelo, con entrada acotada.
- Los estándares canónicos y skills de comportamiento siguen necesitando aceptación humana.

## Si la actualización queda incompleta

Primero comprueba el binario con `edu --version`; una instalación npm fallida puede haber cambiado archivos. No asumas rollback automático.

```sh
edu internal migrate-workspaces --json
edu setup --yes
edu doctor
```

Resuelve primero las rutas/configuración indicadas y conserva los respaldos. No borres `.edu` ni la memoria para hacer desaparecer el error. Los informes pueden mostrar rutas privadas: no los pegues en issues públicos sin revisarlos.

## Dos repositorios no significan dos cerebros publicados

El código público y el espejo laboral privado pueden compartir una versión revisada, pero la memoria y configuración del trabajo deben permanecer locales o en su destino privado autorizado. Esta migración no sincroniza cerebros entre máquinas, no sube archivos a GitHub y no cambia la visibilidad de ningún repositorio. Publicar el espejo requiere verificar su URL y que siga siendo privado.

## Cómo comprobar la promesa

`edu eval suite --json` prueba mecanismos con un solver determinista: **no es un benchmark de modelos**. `edu eval aggregate <archivo> --json` resume ensayos compatibles y conserva los costes desconocidos como desconocidos. Para afirmar ahorro hay que comparar tareas equivalentes, evaluar corrección externamente e incluir adquisición, reflexión, fallos, reintentos y ayuda humana. Consulte [el formato y los límites](../evals/edu-2.0.md).
