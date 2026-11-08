import {
  INDEX_DIR,
  atomicWrite
} from "./chunk-2P2KBRRT.js";

// src/brain/learning.ts
function learnedWeight(usage, now = /* @__PURE__ */ new Date(), halfLifeDays = 45) {
  const stats = usage ?? { uses: 0, wins: 0, losses: 0 };
  const laplace = (stats.wins + 1) / (stats.wins + stats.losses + 2);
  const days = stats.lastUsed ? Math.max(0, (now.getTime() - Date.parse(stats.lastUsed)) / 864e5) : 0;
  return Math.max(0.25, laplace * Math.pow(0.5, days / halfLifeDays));
}
var MAX_EVENT_ID_LENGTH = 200;
var PROMOTION_VERIFIED_WINS = 3;
var INACTIVITY_DAYS = 180;
function assertFeedbackContext(context) {
  const value = context;
  if (!value || typeof value !== "object") throw new Error("Feedback context must be an object");
  if (typeof value.eventId !== "string" || !value.eventId.trim() || value.eventId.length > MAX_EVENT_ID_LENGTH) throw new Error(`Feedback context eventId must be a non-empty string of at most ${MAX_EVENT_ID_LENGTH} characters`);
  if (typeof value.verified !== "boolean") throw new Error("Feedback context verified must be a boolean");
  if (value.evidence !== void 0 && !(Array.isArray(value.evidence) && value.evidence.every((item) => typeof item === "string"))) throw new Error("Feedback context evidence must be an array of strings");
}
function sanitizeUsage(usage) {
  const raw = usage && typeof usage === "object" ? usage : {};
  const count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  const out = { ...raw, uses: count(raw.uses), wins: count(raw.wins), losses: count(raw.losses) };
  if ("verifiedWins" in raw) out.verifiedWins = count(raw.verifiedWins);
  if ("verifiedLosses" in raw) out.verifiedLosses = count(raw.verifiedLosses);
  if ("events" in raw) out.events = Array.isArray(raw.events) ? raw.events.filter((key) => typeof key === "string") : [];
  return out;
}
function feedbackUsage(usage, helpful, now = /* @__PURE__ */ new Date(), context) {
  if (context !== void 0) assertFeedbackContext(context);
  const current = sanitizeUsage(usage);
  if (context === void 0) return { ...current, wins: current.wins + Number(helpful), losses: current.losses + Number(!helpful) };
  const events = current.events ?? [];
  const advisory = `a:${context.eventId}`, verified = `v:${context.eventId}`;
  if (events.includes(verified) || !context.verified && events.includes(advisory)) return usage;
  const counted = events.includes(advisory);
  const next = { ...current };
  if (!counted) {
    next.wins += Number(helpful);
    next.losses += Number(!helpful);
  }
  if (context.verified) {
    if (helpful) {
      next.verifiedWins = (current.verifiedWins ?? 0) + 1;
      next.lastVerified = now.toISOString();
    } else next.verifiedLosses = (current.verifiedLosses ?? 0) + 1;
  }
  next.events = [...events.filter((key) => key !== advisory || !context.verified), context.verified ? verified : advisory];
  return next;
}
function recordUsage(usage, now = /* @__PURE__ */ new Date()) {
  const current = usage ?? { uses: 0, wins: 0, losses: 0 };
  return { ...current, uses: current.uses + 1, lastUsed: now.toISOString() };
}
function isVerifiedLesson(usage) {
  const wins = usage?.verifiedWins ?? 0, losses = usage?.verifiedLosses ?? 0;
  return wins >= PROMOTION_VERIFIED_WINS && (wins + 1) / (wins + losses + 2) >= 0.7;
}
function lessonStatus(meta, now = /* @__PURE__ */ new Date()) {
  if (meta.kind !== "lesson") return meta.status;
  if (meta.status === "retired") return "retired";
  const usage = sanitizeUsage(meta.usage);
  const weight = learnedWeight(usage, now);
  if (usage.losses >= 3 && weight < 0.35) return "retired";
  const confirmed = meta.status === "proven" || (usage.verifiedWins ?? 0) > 0;
  const since = Date.parse(usage.lastVerified ?? meta.created);
  if (!confirmed && Number.isFinite(since) && (now.getTime() - since) / 864e5 >= INACTIVITY_DAYS) return "retired";
  if (meta.status === "proven") return "proven";
  if (isVerifiedLesson(usage)) return "proven";
  return meta.status ?? "candidate";
}
function overdueStatus(meta, now = /* @__PURE__ */ new Date()) {
  if (meta.kind === "commitment" && meta.status === "pending" && meta.due && Date.parse(`${meta.due.slice(0, 10)}T23:59:59.999Z`) < now.getTime()) return "overdue";
  return meta.status;
}
function applyLearning(note, now = /* @__PURE__ */ new Date()) {
  let status = lessonStatus(note.meta, now);
  status = overdueStatus({ ...note.meta, status }, now);
  return { ...note, meta: { ...note.meta, status, updated: now.toISOString() } };
}

// src/brain/lexicon.ts
function tokenize(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("en").match(/[a-z0-9]+/g) ?? [];
}
var stopwords = new Set("a an the how what which do does we i to of for in on is are be and or como que cual cuales el la los las un una unos unas de del al para en por y o se su sus".split(" "));
var queryStopwords = new Set([
  // English
  "about after again all also am any as at because been before being both but by can could did doing does done down during",
  "each else even ever few from further had has have having he her here hers him his if into it its just me might more most",
  "must my our ours out over own same she should so some such than that their theirs them then there these they this those",
  "through too under until up us very was were when where whether while who whom whose why will with within would you your",
  "often should shall may get gets got make makes made use used using uses need needs want wants way ways thing things",
  // Spanish
  "algo alguna algunas alguno algunos ante antes aqui asi aun cada cuando cuanto cuantos desde donde durante e ella ellas ello",
  "ellos entre era eran es esa esas ese eso esos esta estaba estado estan estar estas este esto estos fue fueron ha haber",
  "habia han hasta hay hace hacen hacer le les lo mas me mi mis mucho muchos muy nos nosotros otra otras otro otros pero poco",
  "porque puede pueden pues quien quienes si sido sin sobre solo son soy tambien tan tanto te tiene tienen todo todos tu tus",
  "usa usamos usar uso ya yo deben debe deberia debemos hay vez veces manera forma cosa cosas"
].join(" ").split(" "));
var vowels = /[aeiou]/;
function stem(word) {
  if (word.length <= 3 || /\d/.test(word)) return word;
  let w = stripSuffix(word);
  if (w === word) {
    if (w.endsWith("ies") && w.length > 4) w = `${w.slice(0, -3)}y`;
    else if (/(?:ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2);
    else if (/(?:ion|or|ar|al|el|il|ad|ud)es$/.test(w)) w = w.slice(0, -2);
    else if (w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
    w = stripSuffix(w);
  }
  if (w.length >= 5 && /[aeo]$/.test(w)) w = w.slice(0, -1);
  return w;
}
function stripSuffix(w) {
  for (const [suffix, min, replacement] of suffixes) {
    if (w.length - suffix.length < min || !w.endsWith(suffix)) continue;
    const base = w.slice(0, -suffix.length);
    if (!vowels.test(base)) continue;
    let result = base + replacement;
    if (undouble.has(suffix) && /([bdgmnprt])\1$/.test(result)) result = result.slice(0, -1);
    return result;
  }
  return w;
}
var suffixes = [
  ["amientos", 3],
  ["imientos", 3],
  ["amiento", 3],
  ["imiento", 3],
  ["aciones", 4],
  ["iciones", 4],
  ["uciones", 4],
  ["izations", 3],
  ["ization", 3],
  ["ational", 3],
  ["ations", 4],
  ["itions", 4],
  ["utions", 4],
  ["acion", 4],
  ["icion", 4],
  ["ucion", 4],
  ["ation", 4],
  ["ition", 4],
  ["ution", 4],
  ["amente", 3],
  ["imente", 3],
  ["mente", 4],
  ["idades", 3],
  ["idad", 3],
  ["ities", 3],
  ["ity", 3],
  ["ments", 4],
  ["ment", 4],
  ["nesses", 3],
  ["ness", 3],
  ["fully", 3],
  ["ful", 4],
  ["abilidad", 3],
  ["ability", 3],
  ["able", 4],
  ["ible", 4],
  ["ables", 4],
  ["ibles", 4],
  ["ismos", 3],
  ["ismo", 3],
  ["istas", 3],
  ["ista", 3],
  ["ism", 4],
  ["ist", 4],
  ["adoras", 3],
  ["adores", 3],
  ["adora", 3],
  ["ador", 3],
  ["iendo", 3],
  ["ando", 3],
  ["ados", 3],
  ["adas", 3],
  ["idos", 3],
  ["idas", 3],
  ["ado", 3],
  ["ada", 3],
  ["ido", 3],
  ["ida", 3],
  ["aron", 3],
  ["ieron", 3],
  ["abamos", 3],
  ["amos", 3],
  ["emos", 3],
  ["imos", 3],
  ["aban", 3],
  ["aba", 3],
  ["ara", 4],
  ["iera", 3],
  ["aria", 4],
  ["eria", 4],
  ["ings", 3],
  ["ing", 3],
  ["ied", 3],
  ["ed", 3],
  ["ly", 4],
  ["er", 4],
  ["ar", 3],
  ["ir", 3]
].map(([suffix, min]) => [suffix, min, suffix === "ied" ? "y" : ""]).sort((a, b) => b[0].length - a[0].length);
var undouble = /* @__PURE__ */ new Set(["ing", "ings", "ed"]);
var conceptTable = `
memory: memory memories memoria memorias recuerdo recuerdos remember recordar recall
decision: decision decide decided decidir decidimos decisiones resolution resolucion
lesson: lesson lessons leccion lecciones learned aprendido aprendida aprendizaje learning takeaway
rule: rule rules regla reglas policy policies politica politicas norma normas guideline
note: note notes nota notas apunte apuntes
knowledge: knowledge conocimiento wiki
idea: idea ideas ocurrencia
insight: insight hallazgo finding findings descubrimiento
question: question questions pregunta preguntas duda dudas query consulta
answer: answer answers respuesta respuestas reply responder
test: test tests testing tested prueba pruebas probar probamos testear
deploy: deploy deployment deployed despliegue desplegar desplegamos
release: release releases released lanzamiento lanzar
publish: publish published publicar publicacion publicado
version: version versions versiones versionado versioning
install: install installation installer instalar instalacion instalador
uninstall: uninstall desinstalar desinstalacion
update: update updates upgrade actualizar actualizacion
sync: sync synchronize synchronization sincronizar sincronizacion
cloud: cloud nube
server: server servers servidor servidores host
agent: agent agents agente agentes assistant asistente
token: token tokens
context: context contexto
cost: cost costs costo costos coste costes gasto gastos expense expenses spend
budget: budget presupuesto presupuestos
client: client clients cliente clientes customer customers
project: project projects proyecto proyectos
meeting: meeting meetings reunion reuniones junta juntas
deadline: deadline deadlines plazo plazos vencimiento overdue vencido vencida vencidas
commit: commit commits committed commitear
branch: branch branches rama ramas
merge: merge merged fusionar fusion
bug: bug bugs error errors errores fallo fallos defect defecto
fix: fix fixes fixed arreglar arreglo corregir correccion patch parche hotfix
review: review reviews revision revisar reviewer revisor
prompt: prompt prompts
instruction: instruction instructions instruccion instrucciones
model: model models modelo modelos llm
benchmark: benchmark benchmarks evaluacion evaluation eval evals
measure: measure measurement medir medicion metric metrics metrica metricas
data: data datos dataset
database: database databases db bd
dashboard: dashboard dashboards tablero tableros panel
report: report reports reporte reportes informe informes
sales: sales sale venta ventas vender sell selling seller vendedor
marketing: marketing mercadeo campaign campaigns campana campanas
trade: trade trades trading comercio intercambio
price: price prices pricing precio precios tarifa tarifas
discount: discount discounts descuento descuentos
contract: contract contracts contrato contratos agreement acuerdo
invoice: invoice invoices invoicing factura facturas facturar facturacion billing bill
payment: payment payments pay pago pagos pagar pague cobro cobros cobrar charge charges cargo cargos
refund: refund refunds reembolso reembolsos devolucion
subscription: subscription subscriptions suscripcion suscripciones
user: user users usuario usuarios
permission: permission permissions permiso permisos authorization autorizacion
access: access acceso accesos
secret: secret secrets secreto secretos credential credentials credencial credenciales
password: password passwords contrasena contrasenas clave claves passphrase
key: key keys llave clave claves
backup: backup backups respaldo respaldos
restore: restore restoration restaurar restauracion recover recovery recuperar recuperacion
conflict: conflict conflicts conflicto conflictos
language: language languages idioma idiomas lenguaje english ingles spanish espanol
english: english ingles
spanish: spanish espanol castellano
translation: translation translate traducir traduccion
duplicate: duplicate duplicates duplicated duplicado duplicados duplicada duplicadas repetido repetidos repetida repetidas
retry: retry retries reattempt reintento reintentos reintentar
connection: connection connections conexion conexiones connect conectar
repository: repository repositories repo repos repositorio repositorios
code: code coding codigo codigos source fuente
file: file files archivo archivos fichero ficheros
folder: folder folders directory directories carpeta carpetas directorio directorios
document: document documents documento documentos documentar documentation documentacion doc docs
config: config configuration configure configurar configuracion setting settings ajuste ajustes
setup: setup preparar bootstrap
environment: environment environments entorno entornos ambiente ambientes env
production: production prod produccion
staging: staging preproduccion preprod
development: development develop developer developers desarrollo desarrollar desarrollador desarrolladores dev
feature: feature features funcionalidad funcionalidades caracteristica caracteristicas
requirement: requirement requirements requisito requisitos
task: task tasks tarea tareas todo
issue: issue issues incidencia incidencias ticket tickets
incident: incident incidents incidente incidentes outage caida
priority: priority priorities prioridad prioridades urgent urgente
plan: plan plans planning planificar planificacion roadmap
goal: goal goals objetivo objetivos meta metas target
strategy: strategy estrategia estrategias
risk: risk risks riesgo riesgos
security: security seguridad secure seguro
vulnerability: vulnerability vulnerabilities vulnerabilidad vulnerabilidades exploit
encryption: encryption encrypt cifrado cifrar encriptar encriptacion
authentication: authentication authenticate login autenticacion autenticar signin
session: session sessions sesion sesiones
log: log logs logging registro registros bitacora
monitor: monitor monitoring monitoreo monitorear observability observabilidad
alert: alert alerts alerta alertas alarm alarma notification notificacion notificaciones
performance: performance rendimiento desempeno speed velocidad
latency: latency latencia delay demora retraso
cache: cache caching cachear
queue: queue queues cola colas
job: job jobs trabajo trabajos
schedule: schedule scheduled schedules calendario agenda agendar programar cron
week: week weeks weekly semana semanas semanal semanales
day: day days daily dia dias diario diaria diarios
month: month months monthly mes meses mensual
year: year years yearly annual ano anos anual
today: today hoy
tomorrow: tomorrow manana
yesterday: yesterday ayer
time: time hora horas tiempo hour hours
minute: minute minutes minuto minutos
date: date dates fecha fechas
api: api apis endpoint endpoints
request: request requests peticion peticiones solicitud solicitudes
response: response responses
webhook: webhook webhooks
integration: integration integrations integracion integraciones integrate integrar
migration: migration migrations migracion migraciones migrate migrar
schema: schema schemas esquema esquemas
query_db: sql
table: table tables tabla tablas
column: column columns columna columnas
row: row rows fila filas
index: index indexes indice indices
search: search searching buscar busqueda busquedas find encontrar lookup
filter: filter filters filtro filtros filtrar
sort: sort sorting ordenar orden
list: list lists lista listas listado
script: script scripts
command: command commands comando comandos cli
terminal: terminal shell consola console
library: library libraries libreria librerias biblioteca
dependency: dependency dependencies dependencia dependencias package packages paquete paquetes
build: build builds compile compilar compilacion construir
pipeline: pipeline pipelines ci workflow workflows flujo
container: container containers contenedor contenedores docker
image: image images imagen imagenes
network: network networks networking
domain: domain domains dominio dominios dns
email: email emails correo correos mail
message: message messages mensaje mensajes chat
call: call calls llamada llamadas videollamada
team: team teams equipo equipos
person: person people persona personas
manager: manager managers gerente gerentes jefe responsable owner
role: role roles rol
company: company companies empresa empresas business negocio negocios organization organizacion
partner: partner partners socio socios aliado aliados
vendor: vendor vendors supplier suppliers proveedor proveedores provider
product: product products producto productos
service: service services servicio servicios
offer: offer offers oferta ofertas proposal propuesta propuestas
quote: quote quotes cotizacion cotizaciones presupuestar estimate estimacion
lead: lead leads prospecto prospectos
deal: deal deals negociacion negociar
revenue: revenue ingreso ingresos income
profit: profit profits ganancia ganancias margen margin utilidad
loss: loss losses perdida perdidas
growth: growth crecimiento grow crecer
market: market markets mercado mercados
competitor: competitor competitors competencia competidor competidores
brand: brand brands marca marcas branding
content: content contenido contenidos
post: post posts publicacion articulo articulos article articles blog
social: social sociales instagram linkedin twitter
audience: audience audiencia publico
conversion: conversion conversions conversiones convertir
funnel: funnel embudo
analytics: analytics analitica analisis analysis analyze analizar
chart: chart charts grafico graficos graph
kpi: kpi kpis indicador indicadores
stock: stock stocks shares
portfolio: portfolio portafolio cartera
investment: investment investments inversion inversiones invest invertir
crypto: crypto bitcoin cripto criptomoneda criptomonedas
currency: currency currencies moneda monedas dollar dolar dolares euro
account: account accounts cuenta cuentas
bank: bank banks banco bancos banking
tax: tax taxes impuesto impuestos iva
legal: legal law ley leyes juridico lawyer abogado
compliance: compliance cumplimiento regulation regulacion normativa
privacy: privacy privacidad gdpr
license: license licenses licencia licencias
terms: terms terminos condiciones conditions
signature: signature firma firmar
approval: approval approve approved aprobacion aprobar aprobado aprueba aprueban apruebo authorize authorized autorizar autoriza autorizado
reject: reject rejected rechazar rechazo rechazado
feedback: feedback retroalimentacion comentario comentarios opinion
comment: comment comments
improvement: improvement improvements mejora mejoras mejorar improve
change: change changes cambio cambios cambiar modify modificar
delete: delete deleted borrar eliminar eliminado remove
create: create created crear creado
add: add added agregar anadir
edit: edit editar edicion
save: save guardar guardado store almacenar
read: read leer lectura reading
write: write escribir escritura writing
copy: copy copies copia copias copiar
move: move mover
share: share shared compartir compartido
upload: upload subir carga cargar
download: download descargar descarga
import: import importar importacion
export: export exportar exportacion
format: format formato formatos
template: template templates plantilla plantillas
example: example examples ejemplo ejemplos sample muestra
step: step steps paso pasos
process: process processes proceso procesos procedure procedimiento procedimientos
checklist: checklist checklists lista_de_verificacion
guide: guide guides guia guias tutorial manual
onboarding: onboarding incorporacion induccion
training: training entrenamiento capacitacion curso cursos course
skill: skill skills habilidad habilidades
hook: hook hooks gancho
plugin: plugin plugins extension extensiones addon
tool: tool tools herramienta herramientas
automation: automation automate automatizar automatizacion
workflow_step: trigger disparador
interface: interface interfaz ui
design: design disenar diseno
style: style estilo estilos css
color: color colour colores
screen: screen screens pantalla pantallas
page: page pages pagina paginas
button: button buttons boton botones
form: form forms formulario formularios
mobile: mobile movil celular phone telefono android ios
web: web website sitio
browser: browser navegador
frontend: frontend
backend: backend
architecture: architecture arquitectura
pattern: pattern patterns patron patrones
refactor: refactor refactoring refactorizar
cleanup: cleanup limpieza limpiar tidy
quality: quality calidad
reliable: reliable reliability confiable confiabilidad fiable robust robusto
stable: stable stability estable estabilidad
fail: fail failed failure failures falla fallar fracaso
success: success successful exito exitoso
warning: warning warnings advertencia advertencias aviso
limit: limit limits limite limites quota cuota
threshold: threshold umbral
size: size tamano
speed_up: optimize optimization optimizar optimizacion
scale: scale scaling escalar escalabilidad
cluster: cluster clusters
machine: machine machines maquina maquinas computer computadora ordenador laptop
device: device devices dispositivo dispositivos
hardware: hardware equipo_fisico
storage: storage almacenamiento disk disco
memory_ram: ram
cpu: cpu processor procesador
gpu: gpu
linux: linux ubuntu
windows: windows
mac: mac macos apple
git: git github gitlab
pull_request: pr prs
issue_tracker: jira linear trello
editor: editor ide vscode
ai: ai ia artificial
embedding: embedding embeddings vector vectors vectorial
retrieval: retrieval rag
semantic: semantic semantico semantica
lexical: lexical lexico
summary: summary summaries resumen resumenes summarize resumir
brief: brief briefing
dream: dream dreaming sueno sonar
consolidation: consolidation consolidar consolidacion
link: link links enlace enlaces vinculo vinculos
tag: tag tags etiqueta etiquetas label labels
category: category categories categoria categorias
history: history historial historia historico
archive: archive archivo_historico archivar archived
status: status estado estados
active: active activo activa
pending: pending pendiente pendientes
done: completed complete completado terminado finished
draft: draft drafts borrador borradores
proposal_change: rfc
idempotency: idempotency idempotencia idempotent idempotente
transaction: transaction transactions transaccion transacciones
order: order orders pedido pedidos
shipping: shipping envio envios delivery entrega entregas
inventory: inventory inventario
warehouse: warehouse almacen bodega
supplier_order: purchase compra compras comprar buy
cart: cart carrito
checkout: checkout
receipt: receipt recibo recibos comprobante
balance: balance saldo
debt: debt deuda deudas
loan: loan prestamo prestamos credito
salary: salary sueldo salario salarios payroll nomina
hire: hire hiring contratar contratacion recruit reclutamiento
interview: interview interviews entrevista entrevistas
candidate: candidate candidates candidato candidatos
employee: employee employees empleado empleados staff
vacation: vacation vacations vacaciones holiday holidays feriado feriados
office: office oficina oficinas
remote: remote remoto teletrabajo
travel: travel viaje viajes viajar trip
event: event events evento eventos conference conferencia
presentation: presentation presentacion slides diapositivas deck
demo: demo demos demostracion
pitch: pitch
agenda: minutes acta actas
workshop: workshop taller talleres
mentor: mentor mentoring mentoria coach coaching
health: health salud
habit: habit habits habito habitos rutina routine
focus: focus foco concentracion enfoque
productivity: productivity productividad
burnout: burnout agotamiento cansancio fatigue
book: book books libro libros
reading_list: bookmark bookmarks marcador
video: video videos youtube
podcast: podcast podcasts
course_platform: udemy coursera
research: research investigacion investigar study estudio
experiment: experiment experiments experimento experimentos
hypothesis: hypothesis hipotesis
result: result results resultado resultados outcome
evidence: evidence evidencia evidencias proof prueba_de
source_ref: reference references referencia referencias citation cita
assumption: assumption assumptions supuesto supuestos
constraint: constraint constraints restriccion restricciones
tradeoff: tradeoff tradeoffs compromiso
option: option options opcion opciones alternative alternativa alternativas
choice: choice eleccion elegir choose select seleccionar
recommendation: recommendation recommend recomendacion recomendar
estimate_time: eta
progress: progress progreso avance avances
milestone: milestone milestones hito hitos
sprint: sprint sprints iteracion iteration
retrospective: retrospective retro retrospectiva
standup: standup
backlog: backlog
scope: scope alcance
delivery_date: launch
stakeholder: stakeholder stakeholders interesado interesados
sponsor: sponsor patrocinador
consultant: consultant consultants consultor consultores consulting consultoria advisory asesoria
proposal_doc: sow
hours_billing: timesheet
rate: rate rates
country: country countries pais paises
city: city ciudad ciudades
address: address direccion domicilio
phone_number: whatsapp sms
name: name names nombre nombres naming named nombrar nombra nombran nombrado llamarse
identity: identity identidad
profile: profile profiles perfil perfiles
avatar: avatar foto photo
preference: preference preferences preferencia preferencias prefer prefers preferred prefiere prefieren preferido preferida preferir
default: default predeterminado
privacy_mode: incognito
offline: offline desconectado
online: online conectado
open_source: opensource oss
pricing_free: free gratis gratuito
premium: premium pro paid pagado
trial: trial prueba_gratuita
churn: churn cancelacion cancelar cancel baja
retention: retention retencion
loyalty: loyalty lealtad fidelizacion
support: support soporte ayuda help helpdesk
complaint: complaint complaints queja quejas reclamo reclamos
satisfaction: satisfaction satisfaccion nps
survey: survey surveys encuesta encuestas
interview_user: usability usabilidad
accessibility: accessibility accesibilidad a11y
localization: localization localizacion i18n internationalization internacionalizacion
timezone: timezone zona_horaria utc
encoding: encoding codificacion utf8 unicode
accent: accent accents acento acentos tilde
word: word words palabra palabras term terms termino terminos
synonym: synonym synonyms sinonimo sinonimos
typo: typo typos errata erratas misspelling
grammar: grammar gramatica
writing_style: tone tono voz voice
# General vocabulary (calendar, quantities, common verbs and adjectives) that notes in any domain use.
monday: monday mondays lunes
tuesday: tuesday tuesdays martes
wednesday: wednesday wednesdays miercoles
thursday: thursday thursdays jueves
friday: friday fridays viernes
saturday: saturday saturdays sabado sabados
sunday: sunday sundays domingo domingos
weekend: weekend weekends finde
morning: morning mornings madrugada
night: night nights nightly noche noches nocturno nocturna
quarter: quarter quarters quarterly trimestre trimestres trimestral
semester: semester semesters semestre semestres semestral
january: january enero
february: february febrero
march_month: marzo
april: april abril
june: june junio
july: july julio
august: august agosto
september: september septiembre setiembre
october: october octubre
november: november noviembre
december: december diciembre
hundred: hundred hundreds cien cientos
thousand: thousand thousands mil miles
million: million millions millon millones
first: first primero primera primer initial inicial
last: last latest ultimo ultima ultimos ultimas
next: next upcoming proximo proxima siguiente siguientes
previous: previous prior anterior anteriores
new: new nuevo nueva nuevos nuevas
old: old older legacy antiguo antigua antiguos viejo vieja
start: start started starting startup boot iniciar inicio arranque arranques arrancar comenzar empezar begin
stop: stop stopped detener parar pause pausa pausar halt
run: run running runs execute execution ejecutar ejecucion correr
send: send sent enviar envio mandar
receive: receive received recibir recibido
open_action: open opened abrir abierto abierta
close: close closed closing cerrar cerrado cerrada cierre
cold: cold frio fria
hot: hot caliente
warm: warm tibio tibia
spike: spike spikes pico picos peak peaks
increase: increase increased aumentar aumento incremento incrementar raise
decrease: decrease decreased reduce reduced reducir reduccion disminuir lower bajar
high: high higher alto alta altos altas
low: low bajo baja bajos bajas
big: big bigger large larger huge grande grandes enorme
small: small smaller little tiny pequeno pequena pequenos pequenas chico chica
long: long longer largo larga largos largas lengthy
short: short shorter corto corta cortos cortas
fast: fast faster quick quickly rapido rapida rapidamente
slow: slow slower slowly lento lenta lentos lentitud
full: full entire whole completo completa completos completas entero entera
empty: empty vacio vacia
main: main primary principal principales
secondary: secondary secundario secundaria
number: number numbers numero numeros
card: card cards tarjeta tarjetas
digit: digit digits digito digitos
lock: lock locks locking locked bloqueo bloqueos lockear
batch: batch batches lote lotes
drill: drill drills simulacro simulacros rehearsal ensayo ensayos
mask: mask masked masking enmascarar enmascaramiento enmascarado hide ocultar
never: never nunca jamas
always: always siempre
after: after despues luego afterwards
different: different distinct distinto distinta diferente diferentes
automatic: automatic automatically automatico automatica automaticamente
random: random randomly azar aleatorio aleatoria aleatoriamente flaky intermittent intermitente
expire: expire expires expired expiry expiration expirar expira expiracion caducar caducidad
renew: renew renewal renewed renovar renovacion
rotate: rotate rotation rotated rotar rotacion
leak: leak leaks leaked fuga fugas filtrado filtracion
verify: verify verified verification verificar verificacion validate validation validar validacion
confirm: confirm confirmed confirmation confirmar confirmacion
forget: forget forgets forgot forgotten olvidar olvida olvidan olvido ignore ignored ignorar ignoran
contradict: contradict contradicts contradiction contradecir contradice contradiccion
truncate: truncate truncated truncar truncado recortar recortado cut cortar
lose: lose loses lost losing perder pierde pierden pierdo perdido abandon abandoned abandonar abandonan abandono
stage: stage stages etapa etapas phase phases fase fases
signup: signup register registration registro registrar registrarse inscripcion enroll enrollment
structure: structure structured estructura estructurar organize organizar layout
frequency: frequency frequent frequently frecuencia frecuente frecuentemente
cause: cause causes caused reason reasons causa causas razon razones motivo motivos
problem: problem problems problema problemas
solution: solution solutions solve solved solucion soluciones resolver
emit: emit emitted emitir emision emite
worker: worker workers trabajador trabajadores
`;
var CONCEPT_PREFIX = "~";
var conceptsByStem = /* @__PURE__ */ new Map();
var conceptWordList = /* @__PURE__ */ new Set();
var conceptGroupCount = 0;
for (const line of conceptTable.split("\n")) {
  const match = /^([a-z0-9_]+):(.*)$/.exec(line.trim());
  if (!match) continue;
  conceptGroupCount++;
  const key = CONCEPT_PREFIX + match[1];
  for (const word of match[2].trim().split(/\s+/)) {
    if (word.includes("_")) continue;
    for (const token of tokenize(word)) {
      if (stopwords.has(token)) continue;
      const s = stem(token);
      conceptWordList.add(token);
      const list = conceptsByStem.get(s);
      if (!list) conceptsByStem.set(s, [key]);
      else if (!list.includes(key)) list.push(key);
    }
  }
}
var conceptWords = conceptWordList;
function conceptsOf(stemmed) {
  return conceptsByStem.get(stemmed) ?? [];
}
var none = { concepts: [] };
var analysisMemo = /* @__PURE__ */ new Map();
function analyzeToken(token) {
  const cached = analysisMemo.get(token);
  if (cached) return cached;
  let analysis = none;
  if (!stopwords.has(token)) {
    const s = stem(token);
    analysis = { stem: s, concepts: conceptsOf(s) };
  }
  if (analysisMemo.size >= 2e5) analysisMemo.clear();
  analysisMemo.set(token, analysis);
  return analysis;
}
var trigrams = (word) => {
  const padded = ` ${word} `;
  const grams = /* @__PURE__ */ new Set();
  for (let i = 0; i + 3 <= padded.length; i++) grams.add(padded.slice(i, i + 3));
  return grams;
};
function trigramSimilarity(a, b) {
  if (a === b) return 1;
  const ga = trigrams(a);
  const gb = trigrams(b);
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared++;
  return 2 * shared / (ga.size + gb.size);
}
function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prev2[j - 2] + 1);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return Math.min(prev[b.length], max + 1);
}
function fuzzyCandidates(queryStem, vocabulary, max = 3) {
  if (queryStem.length < 4 || /\d/.test(queryStem)) return [];
  const allowed = queryStem.length >= 7 ? 2 : 1;
  const found = [];
  for (const term of vocabulary) {
    if (term.length < 4 || Math.abs(term.length - queryStem.length) > 2 || term[0] !== queryStem[0] || /\d/.test(term)) continue;
    const similarity = trigramSimilarity(queryStem, term);
    if (similarity < 0.25) continue;
    if (similarity >= 0.7 || editDistance(queryStem, term, allowed) <= allowed) found.push({ term, similarity });
  }
  return found.sort((a, b) => b.similarity - a.similarity || a.term.localeCompare(b.term)).slice(0, max);
}

// src/brain/resolve.ts
import { basename } from "path";
var fold = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
var stemOf = (path) => basename(path.replace(/\\/g, "/"), ".md").toLowerCase();
function pick(via, matches) {
  if (!matches.length) return void 0;
  return matches.length === 1 ? { via, note: matches[0] } : { via, candidates: matches };
}
function normalizeReference(reference) {
  return reference.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
}
function resolveReference(notes, reference) {
  const ref = normalizeReference(reference);
  if (!ref) return void 0;
  const lower = ref.toLowerCase();
  const exact = notes.filter((note) => note.meta.id === ref);
  if (exact.length) return pick("id", exact);
  const alias = pick("alias", notes.filter((note) => note.meta.legacy_id?.toLowerCase() === lower || (note.meta.aliases ?? []).some((name) => name.toLowerCase() === lower)));
  if (alias) return alias;
  const prefixed = notes.filter((note) => note.meta.id.toLowerCase().startsWith(lower));
  const whole = prefixed.filter((note) => /^[-_.]?$|^[-_.]/.test(note.meta.id.slice(lower.length)));
  const prefix = pick("prefix", whole.length ? whole : prefixed);
  if (prefix) return prefix;
  const stemQuery = lower.replace(/\.md$/, "");
  const stem2 = pick("stem", notes.filter((note) => stemOf(note.path) === stemQuery || (note.meta.origin ? stemOf(note.meta.origin) === stemQuery : false)));
  if (stem2) return stem2;
  const title = fold(ref);
  return pick("title", notes.filter((note) => fold(note.meta.title) === title));
}

// src/brain/search.ts
var BRIDGE_WEIGHT = 0.6;
var K1 = 1.2;
var B = 0.75;
var TITLE_WEIGHT = 2;
var COVERAGE_EXPONENT = 0.5;
var TITLE_COVERAGE_BOOST = 0.5;
var FUZZY_WEIGHT = 0.5;
var WEAK_SCORE = 1;
var KIND_CUES = [
  ["decision", ["decision", "decisions", "decide", "decided", "decidir", "decidimos", "decidio", "decidieron", "decisiones", "acordamos", "acordado", "agreed", "chose", "chosen", "elegimos"]],
  ["lesson", ["lesson", "lessons", "learn", "learned", "learnt", "leccion", "lecciones", "aprendimos", "aprendido", "aprendizaje", "aprendizajes", "takeaway", "takeaways"]],
  ["commitment", ["commitment", "commitments", "committed", "promise", "promised", "pendiente", "pendientes", "compromiso", "compromisos", "prometimos", "owe", "due"]],
  ["hypothesis", ["hypothesis", "hypotheses", "suspect", "suspicion", "hipotesis", "sospecha", "sospechamos", "theory", "teoria"]]
];
var KIND_BOOST = 0.15;
var EPISODE_WEIGHT = 0.85;
function askedKinds(text) {
  const tokens = new Set(tokenize(text));
  return new Set(KIND_CUES.filter(([, words]) => words.some((word) => tokens.has(word))).map(([kind]) => kind));
}
function isOperationalNote(note) {
  return !note.meta.superseded_by && !["retired", "reverted", "superseded"].includes(note.meta.status ?? "") && !(note.meta.tier === "canonical" && note.meta.status === "proposed");
}
var searchReference = (query) => /^\[\[[^\[\]\r\n]*\]\]$/.test(query.trim()) ? normalizeReference(query) : query.trim();
function queryUnits(text, keepFunctionWords = false) {
  const units = /* @__PURE__ */ new Map();
  const tokens = tokenize(text);
  const content = keepFunctionWords ? tokens : tokens.filter((token) => !queryStopwords.has(token));
  for (const token of content.length ? content : tokens) {
    const { stem: s, concepts } = analyzeToken(token);
    if (!s) continue;
    const key = concepts.length ? [...concepts].sort().join(" ") : s;
    let unit = units.get(key);
    if (!unit) {
      unit = { label: s, features: concepts.map((term) => ({ term, weight: BRIDGE_WEIGHT })), words: [] };
      units.set(key, unit);
    }
    if (!unit.features.some((feature) => feature.term === s)) unit.features.unshift({ term: s, weight: 1 });
    if (!unit.words.includes(token)) unit.words.push(token);
  }
  return [...units.values()];
}
function addField(vector, text, times, title = false) {
  for (const token of tokenize(text)) {
    const { stem: s, concepts } = analyzeToken(token);
    if (!s) continue;
    if (title) {
      vector.title.add(s);
      for (const concept of concepts) vector.title.add(concept);
    }
    vector.length += times;
    vector.words.add(token);
    vector.tf.set(s, (vector.tf.get(s) ?? 0) + times);
    for (const concept of concepts) vector.tf.set(concept, (vector.tf.get(concept) ?? 0) + times);
  }
}
var vectorCache = /* @__PURE__ */ new Map();
var VECTOR_CACHE_LIMIT = 1e4;
function docVector(note) {
  const title = note.meta.title ?? "";
  const tags = Array.isArray(note.meta.tags) ? note.meta.tags.join(" ") : "";
  const body = note.body ?? "";
  const cached = vectorCache.get(note.path);
  if (cached && cached.title === title && cached.tags === tags && cached.body === body) return cached.vector;
  const vector = { tf: /* @__PURE__ */ new Map(), length: 0, words: /* @__PURE__ */ new Set(), title: /* @__PURE__ */ new Set() };
  addField(vector, title, TITLE_WEIGHT, true);
  addField(vector, tags, 1);
  addField(vector, body, 1);
  if (vectorCache.size >= VECTOR_CACHE_LIMIT) vectorCache.delete(vectorCache.keys().next().value);
  vectorCache.set(note.path, { title, tags, body, vector });
  return vector;
}
function relevantPassage(body, query, maxChars = 480) {
  return passageFor(body, queryUnits(searchReference(query)), maxChars);
}
function passageFor(body, units, maxChars) {
  const size = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 480;
  if (!size || !body) return "";
  if (body.length <= size) return body.trim();
  const unitsByTerm = /* @__PURE__ */ new Map();
  units.forEach((unit, index) => {
    for (const { term } of unit.features) unitsByTerm.set(term, [...unitsByTerm.get(term) ?? [], index]);
  });
  if (!units.length) return body.slice(0, size).trim();
  const matchedUnits = (word) => {
    const found = /* @__PURE__ */ new Set();
    for (const token of tokenize(word)) {
      const { stem: s, concepts } = analyzeToken(token);
      if (!s) continue;
      for (const index of unitsByTerm.get(s) ?? []) found.add(index);
      for (const concept of concepts) for (const index of unitsByTerm.get(concept) ?? []) found.add(index);
    }
    return [...found];
  };
  const hits = [];
  for (const token of body.matchAll(/[\p{L}\p{N}]+/gu)) {
    const matched = matchedUnits(token[0]);
    if (matched.length) hits.push({ start: token.index, end: token.index + token[0].length, units: matched });
  }
  let bestStart = 0;
  let bestScore = 0;
  let left = 0;
  let right = 0;
  const counts = /* @__PURE__ */ new Map();
  for (const hit of hits) {
    const start = Math.max(0, hit.start - Math.min(80, Math.floor(size / 4)));
    while (right < hits.length && hits[right].end <= start + size) {
      for (const unit of hits[right++].units) counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
    while (left < right && hits[left].start < start) {
      for (const unit of hits[left++].units) {
        const remaining = counts.get(unit) - 1;
        if (remaining) counts.set(unit, remaining);
        else counts.delete(unit);
      }
    }
    if (counts.size > bestScore) {
      bestScore = counts.size;
      bestStart = start;
    }
    if (bestScore === units.length) break;
  }
  const paragraph = body.indexOf("\n\n", bestStart);
  if (paragraph >= bestStart && paragraph < bestStart + 80 && paragraph + 2 < body.length) {
    const prefix = body.slice(bestStart, paragraph);
    if (!prefix.split(/[^\p{L}\p{N}]+/u).some((word) => word && matchedUnits(word).length)) bestStart = paragraph + 2;
  }
  return body.slice(bestStart, bestStart + size).trim();
}
function bm25Scores(units, docs) {
  const df = /* @__PURE__ */ new Map();
  for (const unit of units) for (const { term } of unit.features) {
    if (!df.has(term)) df.set(term, docs.reduce((count, doc) => count + (doc.vector.tf.has(term) ? 1 : 0), 0));
  }
  const idfOf = (term) => {
    const termDf = df.get(term);
    return Math.log(1 + (docs.length - termDf + 0.5) / (termDf + 0.5));
  };
  const unitIdf = units.map((unit) => Math.max(0, ...unit.features.filter(({ term }) => df.get(term)).map(({ term }) => idfOf(term))));
  const totalIdf = unitIdf.reduce((sum, value) => sum + value, 0);
  const avgdl = docs.reduce((sum, doc) => sum + doc.vector.length, 0) / Math.max(docs.length, 1);
  return docs.map((doc) => {
    let bm25 = 0;
    let covered = 0;
    let inTitle = 0;
    const matched = [];
    units.forEach((unit, index) => {
      let best = 0;
      let bestTerm = "";
      for (const { term, weight } of unit.features) {
        const tf = doc.vector.tf.get(term);
        if (!tf) continue;
        const score = weight * idfOf(term) * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.vector.length / Math.max(avgdl, 1)));
        if (score > best) {
          best = score;
          bestTerm = term;
        }
      }
      if (!best) return;
      bm25 += best;
      covered += unitIdf[index];
      if (unit.features.some(({ term }) => doc.vector.title.has(term))) inTitle += unitIdf[index];
      matched.push(bestTerm.startsWith(CONCEPT_PREFIX) ? `${unit.label}\u2192${bestTerm.slice(CONCEPT_PREFIX.length)}` : bestTerm === unit.features[0].term ? bestTerm : `${unit.label}\u2248${bestTerm}`);
    });
    return { doc, bm25, coverage: totalIdf ? covered / totalIdf : 0, titleCoverage: totalIdf ? inTitle / totalIdf : 0, matched };
  });
}
function addFuzzyFeatures(units, docs) {
  const unknown = units.filter((unit) => !docs.some((doc) => unit.features.some(({ term }) => doc.vector.tf.has(term))));
  if (!unknown.length) return false;
  const vocabulary = new Set(conceptWords);
  for (const doc of docs) for (const word of doc.vector.words) vocabulary.add(word);
  let added = false;
  for (const unit of unknown) {
    for (const word of unit.words) {
      for (const { term: match } of fuzzyCandidates(word, vocabulary)) {
        const { stem: s, concepts } = analyzeToken(match);
        for (const [term, weight] of [[s ?? stem(match), FUZZY_WEIGHT], ...concepts.map((c) => [c, FUZZY_WEIGHT * BRIDGE_WEIGHT])]) {
          if (unit.features.some((feature) => feature.term === term)) continue;
          unit.features.push({ term, weight });
          added = true;
        }
      }
    }
  }
  return added;
}
var NAMED_SCORE = 1e6;
function rankNotes(query, notes, now = /* @__PURE__ */ new Date(), limit = 10, options = {}) {
  const reference = searchReference(query);
  if (!reference) return [];
  const units = queryUnits(reference, options.similarity);
  const key = reference.toLocaleLowerCase("en");
  const named = (note) => [note.meta.id, note.meta.legacy_id, ...Array.isArray(note.meta.aliases) ? note.meta.aliases : []].some((name) => typeof name === "string" && name.toLocaleLowerCase("en") === key);
  const docs = [];
  for (const note of notes) {
    const isNamed = named(note);
    if (options.includeHistory || isOperationalNote(note) || isNamed) docs.push({ note, vector: docVector(note), named: isNamed });
  }
  let scored = bm25Scores(units, docs);
  const hitsOf = (rows) => rows.filter((row) => row.matched.length || row.doc.named);
  const lexical = hitsOf(scored);
  const top = Math.max(0, ...lexical.map((row) => row.bm25));
  if ((lexical.length < limit || top < WEAK_SCORE) && addFuzzyFeatures(units, docs)) scored = bm25Scores(units, docs);
  const kinds = askedKinds(reference);
  const ranked = hitsOf(scored).map(({ doc: { note, named: isNamed }, bm25, coverage, titleCoverage, matched }) => {
    const w = learnedWeight(note.meta.usage, now);
    if (isNamed) return { note, score: NAMED_SCORE, why: `Named by id or alias "${query.trim()}"; learned weight ${w.toFixed(2)}.` };
    const shape = options.similarity ? 1 : Math.pow(coverage, COVERAGE_EXPONENT) * (1 + TITLE_COVERAGE_BOOST * titleCoverage) * (kinds.has(note.meta.kind ?? "") ? 1 + KIND_BOOST : 1) * (note.meta.tier === "episodic" ? EPISODE_WEIGHT : 1);
    return { note, score: bm25 * shape * (0.5 + w), why: `Matched ${matched.join(", ")}; learned weight ${w.toFixed(2)}.` };
  });
  return ranked.sort((a, b) => b.score - a.score || a.note.meta.id.localeCompare(b.note.meta.id)).slice(0, Math.max(0, options.depth ?? limit)).map((hit) => {
    if (options.includePassages === false) return hit;
    const passage = passageFor(hit.note.body, units, 480);
    return { ...hit, why: `${hit.why}${passage ? ` Passage: ${JSON.stringify(passage)}` : ""}` };
  });
}
var RRF_K = 60;
var MAX_QUERY_VARIANTS = 4;
function queryVariants(queries) {
  const seen = /* @__PURE__ */ new Set();
  const variants = [];
  for (const raw of queries) {
    const query = typeof raw === "string" ? raw.trim() : "";
    const key = query.toLocaleLowerCase("en");
    if (!query || seen.has(key)) continue;
    seen.add(key);
    variants.push(query);
    if (variants.length === MAX_QUERY_VARIANTS) break;
  }
  return variants;
}
function fuseRankings(rankings) {
  const fused = /* @__PURE__ */ new Map();
  rankings.forEach((ranking, variant) => ranking.forEach((hit, index) => {
    const rank = index + 1;
    const named = hit.score >= NAMED_SCORE;
    const entry = fused.get(hit.note);
    if (!entry) {
      fused.set(hit.note, { hit, rrf: 1 / (RRF_K + rank), best: hit.score, variant, named, rank });
      return;
    }
    entry.rrf += 1 / (RRF_K + rank);
    entry.best = Math.max(entry.best, hit.score);
    entry.named ||= named;
    if (rank < entry.rank || rank === entry.rank && hit.score > entry.hit.score) Object.assign(entry, { hit, variant, rank });
  }));
  return [...fused.values()].sort((a, b) => Number(b.named) - Number(a.named) || b.rrf - a.rrf || b.best - a.best || a.hit.note.meta.id.localeCompare(b.hit.note.meta.id)).map(({ hit, rrf, best, variant, named }) => ({ hit, rrf, best, variant, named }));
}
function rankQueries(queries, notes, now = /* @__PURE__ */ new Date(), limit = 10, options = {}) {
  const variants = queryVariants(queries);
  if (variants.length <= 1) return rankNotes(variants[0] ?? "", notes, now, limit, options);
  const rankings = variants.map((query) => rankNotes(query, notes, now, limit, { ...options, includePassages: false, depth: notes.length }));
  return fuseRankings(rankings).slice(0, Math.max(0, limit)).map(({ hit, rrf, named, variant }) => {
    const score = named ? NAMED_SCORE : rrf;
    if (options.includePassages === false) return { ...hit, score };
    const passage = relevantPassage(hit.note.body, variants[variant]);
    return { ...hit, score, why: `${hit.why}${passage ? ` Passage: ${JSON.stringify(passage)}` : ""}` };
  });
}

// src/brain/catalog.ts
import { appendFile, mkdir, readFile, writeFile } from "fs/promises";
import { basename as basename2, join } from "path";
var CATALOG_FILE = "catalog.md";
var LOG_FILE = "log.md";
var SUMMARY_MAX = 120;
var TIER_ORDER = ["canonical", "transitive", "episodic"];
function isLiveNote(note) {
  return !note.meta.superseded_by && !["retired", "reverted", "superseded"].includes(note.meta.status ?? "");
}
var oneLine = (text) => text.replace(/\s+/g, " ").trim();
var truncate = (text, max) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}\u2026`;
var unlink = (text) => text.replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target, label) => label ?? target);
function noteSummary(body, max = SUMMARY_MAX) {
  const text = body.replace(/```[\s\S]*?```/g, "");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line) || /^\|?[\s:-]+\|[\s|:-]*$/.test(line)) continue;
    const plain = oneLine(unlink(line.replace(/^(?:>\s*)+/, "").replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")));
    if (plain) return truncate(plain, max);
  }
  return "";
}
function wikiTarget(reference) {
  const target = reference.split("|")[0].split("#")[0].trim().replace(/\\/g, "/");
  if (!target) return void 0;
  const name = target.split("/").pop();
  if (/\.[A-Za-z0-9]{1,5}$/.test(name) && !/\.md$/i.test(name)) return void 0;
  return name.replace(/\.md$/i, "");
}
var GENERATED_TARGETS = /* @__PURE__ */ new Set(["index", "catalog", "log"]);
function findGaps(notes, isReferrer = () => true) {
  const known = /* @__PURE__ */ new Set();
  for (const note of notes) {
    const names = [note.meta.id, note.meta.legacy_id, note.meta.title, basename2(note.path, ".md"), ...Array.isArray(note.meta.aliases) ? note.meta.aliases : []];
    for (const name of names) if (typeof name === "string" && name) known.add(name.toLowerCase());
  }
  const gaps = /* @__PURE__ */ new Map();
  for (const note of notes) {
    if (!isLiveNote(note) || !isReferrer(note)) continue;
    const body = note.body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    const references = [...Array.isArray(note.meta.links) ? note.meta.links : [], ...[...body.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)].filter((m) => !m[1]).map((m) => m[2])];
    for (const reference of references) {
      if (typeof reference !== "string") continue;
      const target = wikiTarget(reference);
      if (!target || known.has(target.toLowerCase()) || GENERATED_TARGETS.has(target.toLowerCase())) continue;
      const referrers = gaps.get(target) ?? [];
      if (!referrers.includes(note.meta.id)) referrers.push(note.meta.id);
      gaps.set(target, referrers);
    }
  }
  return gaps;
}
var linkTo = (note) => {
  const stem2 = basename2(note.path, ".md");
  return stem2 === note.meta.id ? `[[${note.meta.id}]]` : `[[${stem2}|${note.meta.id}]]`;
};
function buildCatalog(notes, isReferrer) {
  const live = notes.filter(isLiveNote);
  const groups = /* @__PURE__ */ new Map();
  for (const note of live) {
    const key = `${note.meta.tier}/${note.meta.kind ?? "other"}`;
    groups.set(key, [...groups.get(key) ?? [], note]);
  }
  const order = (key) => TIER_ORDER.indexOf(key.split("/")[0]);
  const lines = ["# Brain catalog", "", `${live.length} live notes. One line each: \`[[id]] title \u2014 summary\`. Read a note with edu_read.`, ""];
  for (const [key, group] of [...groups].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))) {
    lines.push(`## ${key}`, "");
    const sorted = key.startsWith("episodic/") ? group.sort((a, b) => b.meta.created.localeCompare(a.meta.created) || a.meta.id.localeCompare(b.meta.id)) : group.sort((a, b) => a.meta.title.localeCompare(b.meta.title) || a.meta.id.localeCompare(b.meta.id));
    for (const note of sorted) {
      const summary = noteSummary(note.body);
      lines.push(`- ${linkTo(note)} ${oneLine(note.meta.title)}${summary ? ` \u2014 ${summary}` : ""}`);
    }
    lines.push("");
  }
  const gaps = [...findGaps(notes, isReferrer)].sort(([a], [b]) => a.localeCompare(b));
  lines.push("## Gaps", "");
  if (!gaps.length) lines.push("No missing notes.");
  for (const [target, referrers] of gaps) lines.push(`- [[${target}]] \u2014 referenced by ${referrers.sort().map((id) => `[[${id}]]`).join(", ")}`);
  lines.push("");
  return `${lines.join("\n")}
`;
}
async function writeCatalog(brainDir, notes, isReferrer) {
  const path = join(brainDir, INDEX_DIR, CATALOG_FILE);
  const content = buildCatalog(notes, isReferrer);
  if (await readFile(path, "utf8").catch(() => void 0) === content) return false;
  await atomicWrite(path, content);
  return true;
}
var field = (value) => oneLine(value).replace(/\|/g, "/");
function formatLogLine(entry) {
  const stamp = (entry.at ?? /* @__PURE__ */ new Date()).toISOString();
  return `## [${stamp.slice(0, 10)} ${stamp.slice(11, 16)}] ${field(entry.op)} | ${field(entry.id)} | ${field(entry.title)}`;
}
function parseLog(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^## \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] (.+?) \| (.+?) \| (.*)$/.exec(line);
    if (match) out.push({ at: match[1], op: match[2], id: match[3], title: match[4] });
  }
  return out;
}
async function appendLog(brainDir, entry) {
  try {
    const dir = join(brainDir, INDEX_DIR);
    const path = join(dir, LOG_FILE);
    await mkdir(dir, { recursive: true });
    await writeFile(path, "# Brain log\n\nAppend-only. One line per operation: `## [YYYY-MM-DD HH:MM] op | id | title` (UTC).\n\n", { flag: "wx" }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    await appendFile(path, `${formatLogLine(entry)}
`);
  } catch {
  }
}

export {
  learnedWeight,
  assertFeedbackContext,
  feedbackUsage,
  recordUsage,
  lessonStatus,
  overdueStatus,
  applyLearning,
  tokenize,
  resolveReference,
  isOperationalNote,
  relevantPassage,
  rankNotes,
  rankQueries,
  CATALOG_FILE,
  LOG_FILE,
  isLiveNote,
  noteSummary,
  findGaps,
  buildCatalog,
  writeCatalog,
  parseLog,
  appendLog
};
//# sourceMappingURL=chunk-GC5WYT3E.js.map