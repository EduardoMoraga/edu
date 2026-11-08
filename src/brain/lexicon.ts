/**
 * Lexical bilingual (ES/EN) analysis for recall: light stemming, a curated concept bridge and a
 * character-trigram fuzzy matcher. No dictionary download, no model, no runtime dependency.
 *
 * - `stem` is a Snowball-lite suffix stripper shared by both languages. It only has to be consistent
 *   (the same function runs on notes and queries), not linguistically exact.
 * - The concept bridge maps ES and EN words (and common synonyms) of one idea to one concept key,
 *   so a Spanish query reaches an English note. It is a small curated vocabulary, not translation.
 * - `fuzzyCandidates` is a fallback for typos and odd inflections of terms the corpus never saw.
 */

/** Accent-free lowercase alphanumeric words; the tokenizer recall has always used. */
export function tokenize(text: string): string[] {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('en').match(/[a-z0-9]+/g) ?? [];
}

// Kept identical to the pre-5.0 list: stopwords change document lengths, hence every BM25 score.
export const stopwords: ReadonlySet<string> = new Set(('a an the how what which do does we i to of for in on is are be and or ' +
  'como que cual cuales el la los las un una unos unas de del al para en por y o se su sus').split(' '));

const vowels = /[aeiou]/;

/**
 * Light bilingual stemmer. Order: plural, longest known suffix (keeping a stem of at least three or
 * four letters), undoubled consonant after -ing/-ed, final unstressed vowel. Numbers are untouched.
 */
export function stem(word: string): string {
  if (word.length <= 3 || /\d/.test(word)) return word;
  // Suffixes that already include a plural or person ending (probamos, deployments, aciones) match
  // first; otherwise strip the plural and try again.
  let w = stripSuffix(word);
  if (w === word) {
    // Plurals: queries→query, branches→branch, decisiones→decision, tests→test (status, class, analysis stay).
    if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
    else if (/(?:ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2);
    else if (/(?:ion|or|ar|al|el|il|ad|ud)es$/.test(w)) w = w.slice(0, -2);
    else if (w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
    w = stripSuffix(w);
  }
  // Final unstressed vowel: cliente→client, incidente→incident, release→releas (short words stay).
  if (w.length >= 5 && /[aeo]$/.test(w)) w = w.slice(0, -1);
  return w;
}

function stripSuffix(w: string): string {
  for (const [suffix, min, replacement] of suffixes) {
    if (w.length - suffix.length < min || !w.endsWith(suffix)) continue;
    const base = w.slice(0, -suffix.length);
    if (!vowels.test(base)) continue; // string, spring: no vowel left, not a suffix
    let result = base + replacement;
    if (undouble.has(suffix) && /([bdgmnprt])\1$/.test(result)) result = result.slice(0, -1);
    return result;
  }
  return w;
}

// [suffix, minimum stem length, replacement], longest first so the most specific suffix wins.
const suffixes: [string, number, string][] = ([
  ['amientos', 3], ['imientos', 3], ['amiento', 3], ['imiento', 3], ['aciones', 4], ['iciones', 4], ['uciones', 4],
  ['izations', 3], ['ization', 3], ['ational', 3], ['ations', 4], ['itions', 4], ['utions', 4],
  ['acion', 4], ['icion', 4], ['ucion', 4], ['ation', 4], ['ition', 4], ['ution', 4],
  ['amente', 3], ['imente', 3], ['mente', 4], ['idades', 3], ['idad', 3], ['ities', 3], ['ity', 3],
  ['ments', 4], ['ment', 4], ['nesses', 3], ['ness', 3], ['fully', 3], ['ful', 4],
  ['abilidad', 3], ['ability', 3], ['able', 4], ['ible', 4], ['ables', 4], ['ibles', 4],
  ['ismos', 3], ['ismo', 3], ['istas', 3], ['ista', 3], ['ism', 4], ['ist', 4],
  ['adoras', 3], ['adores', 3], ['adora', 3], ['ador', 3],
  ['iendo', 3], ['ando', 3], ['ados', 3], ['adas', 3], ['idos', 3], ['idas', 3], ['ado', 3], ['ada', 3], ['ido', 3], ['ida', 3],
  ['aron', 3], ['ieron', 3], ['abamos', 3], ['amos', 3], ['emos', 3], ['imos', 3], ['aban', 3], ['aba', 3],
  ['ara', 4], ['iera', 3], ['aria', 4], ['eria', 4],
  ['ings', 3], ['ing', 3], ['ied', 3], ['ed', 3], ['ly', 4], ['er', 4], ['ar', 3], ['ir', 3],
] as [string, number][])
  .map(([suffix, min]): [string, number, string] => [suffix, min, suffix === 'ied' ? 'y' : ''])
  .sort((a, b) => b[0].length - a[0].length);
const undouble = new Set(['ing', 'ings', 'ed']);

// ES↔EN concept bridge. Each line: concept key, then ES/EN words and common synonyms. Every word is
// stemmed when the table is built, so plurals and conjugations of a listed word map to the concept too.
const conceptTable = `
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
database: database databases db
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
language: language languages idioma idiomas lenguaje
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
approval: approval approve approved aprobacion aprobar aprobado
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
name: name names nombre nombres
identity: identity identidad
profile: profile profiles perfil perfiles
avatar: avatar foto photo
preference: preference preferences preferencia preferencias
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
`;

/** Concept key prefix: index terms are [a-z0-9]+, so a prefixed key can never collide with a stem. */
export const CONCEPT_PREFIX = '~';

const conceptsByStem = new Map<string, string[]>();
const conceptWordList = new Set<string>();
let conceptGroupCount = 0;
for (const line of conceptTable.split('\n')) {
  const match = /^([a-z0-9_]+):(.*)$/.exec(line.trim());
  if (!match) continue;
  conceptGroupCount++;
  const key = CONCEPT_PREFIX + match[1]!;
  for (const word of match[2]!.trim().split(/\s+/)) {
    // Underscored entries document a phrase the single-token index cannot match; they are skipped.
    if (word.includes('_')) continue;
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

/** Number of curated ES↔EN concept groups. */
export const CONCEPT_GROUPS = conceptGroupCount;

/** Surface words of the concept table: a fuzzy target even when no note uses them yet. */
export const conceptWords: ReadonlySet<string> = conceptWordList;

/** Concept keys for a stem (empty when the word is outside the curated vocabulary). */
export function conceptsOf(stemmed: string): readonly string[] {
  return conceptsByStem.get(stemmed) ?? [];
}

export interface TermAnalysis {
  /** The stem, or undefined for a stopword. */
  stem?: string;
  concepts: readonly string[];
}

const none: TermAnalysis = { concepts: [] };
const analysisMemo = new Map<string, TermAnalysis>();

/** Stem and concepts of one tokenized word, memoized (a brain reuses a small vocabulary). */
export function analyzeToken(token: string): TermAnalysis {
  const cached = analysisMemo.get(token);
  if (cached) return cached;
  let analysis = none;
  if (!stopwords.has(token)) {
    const s = stem(token);
    analysis = { stem: s, concepts: conceptsOf(s) };
  }
  if (analysisMemo.size >= 200_000) analysisMemo.clear();
  analysisMemo.set(token, analysis);
  return analysis;
}

const trigrams = (word: string): Set<string> => {
  const padded = ` ${word} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) grams.add(padded.slice(i, i + 3));
  return grams;
};

/** Dice coefficient over padded character trigrams, in [0, 1]. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ga = trigrams(a);
  const gb = trigrams(b);
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared++;
  return (2 * shared) / (ga.size + gb.size);
}

/** Optimal string alignment distance (Levenshtein plus adjacent transposition), capped at `max + 1`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prev2[j - 2]! + 1);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return Math.min(prev[b.length]!, max + 1);
}

export interface FuzzyMatch { term: string; similarity: number }

/**
 * Vocabulary stems close to an unknown query stem: a trigram prefilter, then either one or two
 * edits (by length) or a high trigram overlap. Short words and numbers never match fuzzily.
 */
export function fuzzyCandidates(queryStem: string, vocabulary: Iterable<string>, max = 3): FuzzyMatch[] {
  if (queryStem.length < 4 || /\d/.test(queryStem)) return [];
  const allowed = queryStem.length >= 7 ? 2 : 1;
  const found: FuzzyMatch[] = [];
  for (const term of vocabulary) {
    if (term.length < 4 || Math.abs(term.length - queryStem.length) > 2 || term[0] !== queryStem[0] || /\d/.test(term)) continue;
    const similarity = trigramSimilarity(queryStem, term);
    if (similarity < 0.25) continue;
    if (similarity >= 0.7 || editDistance(queryStem, term, allowed) <= allowed) found.push({ term, similarity });
  }
  return found.sort((a, b) => b.similarity - a.similarity || a.term.localeCompare(b.term)).slice(0, max);
}
