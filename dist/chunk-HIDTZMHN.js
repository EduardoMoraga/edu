import {
  ledgerPath,
  openBrain
} from "./chunk-SOBMA5SW.js";

// src/bench/retrieval.ts
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// src/bench/fixtures/corpus.ts
var CORPUS_VERSION = 1;
var d = (key, lang, title, body, extra = {}) => ({ key, lang, tier: "transitive", kind: "decision", title, body, ...extra });
var l = (key, lang, title, body, extra = {}) => ({ key, lang, tier: "transitive", kind: "lesson", title, body, ...extra });
var h = (key, lang, title, body, extra = {}) => ({ key, lang, tier: "transitive", kind: "hypothesis", title, body, ...extra });
var c = (key, lang, title, body, due, extra = {}) => ({ key, lang, tier: "transitive", kind: "commitment", title, body, due, ...extra });
var k = (key, lang, kind, title, body, extra = {}) => ({ key, lang, tier: "canonical", kind, title, body, ...extra });
var s = (key, lang, title, body, extra = {}) => ({ key, lang, tier: "episodic", kind: "session", title, body, ...extra });
var topics = [
  d(
    "t01",
    "en",
    "Use Postgres advisory locks for the job scheduler",
    "Cron jobs take pg_try_advisory_lock before running, so two workers never execute the same job. Redis locks were dropped.",
    { legacyId: "D-014" }
  ),
  s(
    "t01-x1",
    "en",
    "Scheduler incident review",
    "The nightly invoice job ran twice because two workers picked it up. We looked at Redis locks, Postgres locks and a leader election. The job scheduler logs showed both workers starting within the same second. Locks with a TTL expired while the job was still running. Action items: add idempotency keys to the job, alert when a job runs longer than its lock, document the scheduler runbook."
  ),
  l(
    "t01-x2",
    "es",
    "Los locks de Redis expiran antes de que termine el job",
    "Un lock con TTL fijo no sirve para jobs largos: el job sigue corriendo cuando el lock ya expir\xF3 y otro worker lo toma. Si se usa Redis, renovar el lock peri\xF3dicamente; en el scheduler preferimos locks de la base de datos."
  ),
  d(
    "t02",
    "es",
    "Facturaci\xF3n mensual con cierre el d\xEDa 25",
    "Las facturas se emiten el d\xEDa 25 de cada mes y el cobro autom\xE1tico se ejecuta tres d\xEDas despu\xE9s."
  ),
  s(
    "t02-x1",
    "es",
    "Revisi\xF3n de facturas duplicadas de marzo",
    "En marzo se emitieron facturas duplicadas a doce clientes porque el cierre mensual corri\xF3 dos veces. Revisamos el proceso de facturaci\xF3n, los reintentos del job y el d\xEDa de cierre. Camila pidi\xF3 una nota de cr\xE9dito para cada factura duplicada y un correo de disculpa. Queda pendiente un control que impida emitir dos facturas para el mismo mes."
  ),
  l(
    "t02-x2",
    "en",
    "Invoice PDFs must embed the tax id",
    "Customers in Chile reject invoices without the RUT printed on the PDF. Every monthly invoice template must embed the tax id and the billing address."
  ),
  l(
    "t03",
    "en",
    "Retry webhooks with exponential backoff and jitter",
    "Outbound webhooks are retried up to 8 times with exponential backoff and random jitter; after that they go to a dead-letter queue."
  ),
  d(
    "t03-x1",
    "en",
    "Webhook signatures use HMAC-SHA256",
    "Every outbound webhook carries an HMAC-SHA256 signature header computed with the endpoint secret. Receivers must verify the signature before processing the webhook payload. Secrets rotate yearly and old signatures stay valid for 24 hours."
  ),
  s(
    "t03-x2",
    "en",
    "Webhook outage with a large customer",
    "A customer endpoint returned 500 for six hours. Our webhook workers retried immediately in a tight loop and saturated the queue. We paused the webhook deliveries, drained the queue and talked to the customer. The webhook dashboard needs per-endpoint error rates."
  ),
  l(
    "t04",
    "es",
    "Respaldar la base antes de cada migraci\xF3n",
    "Antes de correr una migraci\xF3n de esquema en producci\xF3n se toma un respaldo completo de la base y se verifica que se pueda leer."
  ),
  d(
    "t04-x1",
    "en",
    "Nightly backups go to S3 with 30-day retention",
    "The production database is backed up every night to an encrypted S3 bucket. Backups are kept for 30 days and the bucket has object lock. Backup jobs report their size and duration to the metrics dashboard."
  ),
  s(
    "t04-x2",
    "es",
    "Migraci\xF3n del esquema de usuarios",
    "Migramos la tabla de usuarios para separar el perfil de las credenciales. La migraci\xF3n tom\xF3 cuarenta minutos y bloque\xF3 escrituras. Discutimos si conviene usar migraciones en l\xEDnea, c\xF3mo revertir la migraci\xF3n y qu\xE9 \xEDndices crear despu\xE9s. La base qued\xF3 estable."
  ),
  k(
    "t05",
    "en",
    "preference",
    "Eduardo prefers answers in Spanish with code in English",
    "Reply to Eduardo in Spanish. Keep code, identifiers, commits and technical docs in English."
  ),
  k(
    "t05-x1",
    "en",
    "standard",
    "Code comments, commits and docs are written in English",
    "All code comments, commit messages, pull request descriptions and technical documentation are written in English, even when the team talks in Spanish. User-facing messages are translated through the i18n catalog."
  ),
  s(
    "t05-x2",
    "es",
    "Conversaci\xF3n sobre el idioma de la documentaci\xF3n",
    "Eduardo explic\xF3 que la documentaci\xF3n t\xE9cnica va en ingl\xE9s y que el README tiene una versi\xF3n en espa\xF1ol. Las respuestas del agente pueden ser en espa\xF1ol, pero el c\xF3digo y los mensajes de commit siempre en ingl\xE9s."
  ),
  k(
    "t06",
    "es",
    "person",
    "Camila Rojas \u2014 l\xEDder de finanzas",
    "Camila aprueba los cambios de precios y de facturaci\xF3n. Prefiere res\xFAmenes cortos por correo, con la cifra principal primero.",
    { aliases: ["Camila"] }
  ),
  c(
    "t06-x1",
    "es",
    "Enviar a finanzas el an\xE1lisis de precios del plan anual",
    "Preparar el an\xE1lisis de precios del plan anual con escenarios de descuento y enviarlo al equipo de finanzas para su aprobaci\xF3n. Incluir el impacto en facturaci\xF3n y en el flujo de caja de los pr\xF3ximos seis meses.",
    "2026-07-15"
  ),
  s(
    "t06-x2",
    "es",
    "Reuni\xF3n mensual con finanzas",
    "Revisamos la facturaci\xF3n del mes, los cobros pendientes y la propuesta de cambios de precios. Finanzas pidi\xF3 que los cambios de precios lleguen con dos semanas de anticipaci\xF3n y que cada propuesta incluya el efecto en los clientes actuales."
  ),
  k(
    "t07",
    "en",
    "standard",
    "Every pull request needs a passing test and a changelog entry",
    "A pull request is mergeable only when CI is green, it adds or updates a test for the change, and CHANGELOG.md has an entry."
  ),
  l(
    "t07-x1",
    "en",
    "Flaky tests hide real failures",
    "When a test fails randomly people start re-running CI until it passes, and real failures slip through. Quarantine a flaky test the day it is found, open an issue and fix it within the sprint. A pull request must not be merged on a re-run alone."
  ),
  s(
    "t07-x2",
    "en",
    "Release 4.1 checklist",
    "We walked through the release checklist: changelog, version bump, test suite on three operating systems, smoke install and the pull request template. Two pull requests were missing a changelog entry and were sent back."
  ),
  h(
    "t08",
    "en",
    "Cold starts cause the p95 latency spikes on Mondays",
    "The API p95 latency jumps every Monday morning. We suspect cold starts after the weekend scale-down. To confirm: compare instance start times with the spikes."
  ),
  d(
    "t08-x1",
    "en",
    "Keep two warm API instances at all times",
    "The autoscaler never goes below two API instances, even on weekends. The extra cost is small compared with the latency of starting instances on demand. Revisit when traffic patterns change."
  ),
  s(
    "t08-x2",
    "en",
    "Latency dashboard review",
    "We reviewed the latency dashboard: p50 is stable, p95 latency has spikes, p99 is noisy. The database looks fine. We discussed cache misses, garbage collection pauses and network latency between regions as other explanations for the latency spikes."
  ),
  h(
    "t09",
    "es",
    "Los usuarios abandonan el onboarding en la verificaci\xF3n de correo",
    "Creemos que la mayor ca\xEDda del onboarding ocurre en el paso de verificaci\xF3n de correo. Medir la conversi\xF3n de cada paso del embudo."
  ),
  l(
    "t09-x1",
    "en",
    "Shorter signup forms convert better",
    "Removing optional fields from the signup form raised completion from 41% to 58%. Ask for extra profile data after onboarding, not during signup."
  ),
  s(
    "t09-x2",
    "es",
    "Entrevistas con usuarios nuevos",
    "Entrevistamos a ocho usuarios nuevos sobre el onboarding. Varios dijeron que el correo de verificaci\xF3n lleg\xF3 tarde o a spam. Otros abandonaron porque el formulario ped\xEDa demasiados datos. El onboarding necesita un indicador de progreso."
  ),
  c(
    "t10",
    "en",
    "Ship the Windows installer fix by Friday",
    "Release the patched Windows installer that retries file renames when antivirus holds a handle.",
    "2026-07-10"
  ),
  l(
    "t10-x1",
    "en",
    "Windows antivirus locks files during install",
    "On Windows, antivirus and indexing services open freshly written files, so a rename right after a write can fail with EPERM. The installer must retry renames with a short backoff. Seen on managed laptops and on CI runners."
  ),
  s(
    "t10-x2",
    "es",
    "Soporte a cliente con instalador en Windows",
    "Un cliente no pudo instalar en Windows: el instalador fall\xF3 al renombrar archivos. Le pedimos los logs y reproducimos el error en una m\xE1quina con antivirus corporativo. El arreglo del instalador sale esta semana."
  ),
  c(
    "t11",
    "es",
    "Entregar el informe trimestral de m\xE9tricas a Camila",
    "Enviar a Camila el informe del trimestre con ingresos, churn y costo de adquisici\xF3n.",
    "2026-07-31"
  ),
  d(
    "t11-x1",
    "es",
    "Las m\xE9tricas se calculan desde el data warehouse",
    "Todas las m\xE9tricas de negocio (ingresos, churn, activaci\xF3n) se calculan desde el data warehouse y no desde la base de producci\xF3n. Los informes trimestrales usan las mismas definiciones que el dashboard."
  ),
  d(
    "t12",
    "en",
    "Deploy only from the main branch through CI",
    "Production deploys run only from main, through the CI pipeline, after all checks pass. No deploys from laptops."
  ),
  l(
    "t12-x1",
    "en",
    "Hotfix branches drift from main",
    "A hotfix branch that lives more than a day drifts from main and the next deploy reintroduces the bug. Merge hotfixes back to main immediately and deploy from main, never from the hotfix branch itself."
  ),
  s(
    "t12-x2",
    "es",
    "Despliegue fallido del viernes",
    "El despliegue del viernes fall\xF3 porque alguien despleg\xF3 desde su computador con variables de entorno locales. Revertimos el despliegue, revisamos el pipeline y acordamos bloquear los despliegues manuales."
  ),
  d(
    "t13",
    "es",
    "Usar pnpm en lugar de npm en el monorepo",
    "El monorepo usa pnpm por sus workspaces y su almacenamiento compartido; npm queda solo para paquetes publicados aparte."
  ),
  l(
    "t13-x1",
    "en",
    "Lockfile conflicts slow down merges",
    "Two branches that both add dependencies conflict in the lockfile every time. Regenerate the lockfile after rebasing instead of merging it by hand, and keep dependency upgrades in their own pull request. Applies to npm and pnpm alike."
  ),
  l(
    "t14",
    "en",
    "Never log full card numbers; mask all but the last four digits",
    "Logs, traces and error reports must mask card numbers to the last four digits. A full PAN in a log is a PCI incident."
  ),
  d(
    "t14-x1",
    "en",
    "Payments go through Stripe Checkout",
    "Card payments use Stripe Checkout so card numbers never touch our servers. We store only the payment intent id and the last four digits for support. Refunds also go through Stripe."
  ),
  s(
    "t14-x2",
    "es",
    "Auditor\xEDa PCI anual",
    "La auditor\xEDa PCI revis\xF3 los logs de la API de pagos y encontr\xF3 un n\xFAmero de tarjeta completo en un log de errores antiguo. Se borr\xF3 el log, se agreg\xF3 un filtro de enmascaramiento y se document\xF3 el incidente."
  ),
  l(
    "t15",
    "es",
    "Las conexiones a la base se agotan si los tests no cierran el pool",
    "Cada archivo de test debe cerrar el pool de conexiones en afterAll; si no, la suite agota las conexiones de la base y falla al azar."
  ),
  d(
    "t15-x1",
    "en",
    "Connection pool size is 20 per service",
    "Each service opens at most 20 database connections. The database allows 200, which leaves room for migrations and admin sessions. Raise the connection pool only after measuring wait times."
  ),
  s(
    "t15-x2",
    "en",
    "Database connection errors in CI",
    "CI started failing with too many connections. We traced it to a new test file that opened a client per test. The database connection limit on the CI container is lower than in production."
  ),
  d(
    "t16",
    "en",
    "Feature flags live in LaunchDarkly, not in environment variables",
    "Feature flags are managed in LaunchDarkly so they can change without a deploy. Environment variables are for configuration only."
  ),
  l(
    "t16-x1",
    "en",
    "Stale feature flags accumulate and confuse reviewers",
    "Every flag gets an owner and a removal date. Flags older than ninety days are reviewed monthly; a stale flag left on for everyone becomes dead code that reviewers still have to reason about. Environment variables used as flags are even harder to find."
  ),
  s(
    "t16-x2",
    "es",
    "Limpieza de banderas de funcionalidades",
    "Revisamos las banderas de funcionalidades activas y eliminamos catorce que estaban encendidas para todos. Algunas viv\xEDan en variables de entorno y otras en LaunchDarkly."
  ),
  d(
    "t17",
    "es",
    "Soporte atiende de 9 a 18 hora de Chile",
    "El horario de soporte es de lunes a viernes de 9 a 18 hora de Chile. Fuera de horario solo se atienden incidentes cr\xEDticos."
  ),
  c(
    "t17-x1",
    "en",
    "Hire a second support agent before the launch",
    "Open the position for a second support agent, ideally in another time zone, so support hours can cover the launch week. Budget approved by finance.",
    "2026-08-30"
  ),
  s(
    "t17-x2",
    "es",
    "Quejas por tiempos de respuesta de soporte",
    "Varios clientes de M\xE9xico se quejaron porque escribieron a soporte fuera del horario y recibieron respuesta al d\xEDa siguiente. Evaluamos extender el horario de soporte o contratar a otra persona."
  ),
  l(
    "t18",
    "en",
    "Quarterly restore drills prove that backups actually work",
    "Once a quarter restore the latest backup into a scratch database and run the smoke queries. A backup never restored is only a hope."
  ),
  s(
    "t18-x1",
    "es",
    "Simulacro de restauraci\xF3n fallido",
    "Intentamos restaurar el respaldo de la semana pasada y fall\xF3 porque faltaba la llave de cifrado en la b\xF3veda. Tardamos tres horas en encontrarla. Acordamos documentar d\xF3nde vive la llave y repetir la restauraci\xF3n el pr\xF3ximo mes."
  ),
  k(
    "t19",
    "es",
    "standard",
    "Las ramas se nombran tipo/descripcion-corta",
    "Toda rama sigue el formato tipo/descripcion-corta, por ejemplo feat/edu-bench o fix/windows-rename."
  ),
  l(
    "t19-x1",
    "en",
    "Conventional commits drive the changelog",
    "Commit messages follow Conventional Commits (feat, fix, docs, chore) so the changelog and the version bump are generated. Branch names reuse the same type prefix, which keeps the history easy to scan."
  ),
  d(
    "t20",
    "en",
    "Duplicate payments are refunded automatically within 24 hours",
    "When the reconciler finds two charges for the same order it refunds the newer one automatically within 24 hours and emails the customer."
  ),
  l(
    "t20-x1",
    "es",
    "Los pagos duplicados vienen del doble clic en el bot\xF3n de pagar",
    "Casi todos los pagos duplicados ocurren cuando el usuario hace doble clic en pagar con una conexi\xF3n lenta. El bot\xF3n debe deshabilitarse tras el primer clic y cada intento de pago debe llevar una llave de idempotencia."
  ),
  s(
    "t20-x2",
    "en",
    "Payment incident with double charges",
    "Forty customers were charged twice during a gateway slowdown. Support refunded them by hand over two days. We discussed automatic refunds, idempotency keys and better alerts on duplicate charges."
  ),
  h(
    "t21",
    "es",
    "El plan anual con 20% de descuento aumenta la retenci\xF3n",
    "Creemos que ofrecer el plan anual con 20% de descuento reduce el churn. Probar con un experimento A/B en la p\xE1gina de precios."
  ),
  d(
    "t21-x1",
    "en",
    "The monthly plan stays at 29 USD",
    "We keep the monthly plan at 29 USD for this year. Any discount goes to the annual plan, never to the monthly price, so existing customers are not repriced."
  ),
  l(
    "t22",
    "en",
    "Pin Node 22.19 in CI to match the Pi API contract",
    "The pinned Pi API needs Node 22.19 or newer; CI pins that exact version so contract tests behave like developer machines."
  ),
  d(
    "t22-x1",
    "en",
    "Support Node 22 and newer",
    "The package declares engines node >=22. We test on the oldest supported Node 22 release and on the current release, on Linux, macOS and Windows. Older Node versions are not supported."
  ),
  l(
    "t23",
    "es",
    "Las migraciones de datos largas se ejecutan por lotes de mil filas",
    "Un backfill grande se corre en lotes de mil filas con una pausa corta entre lotes para no bloquear la base."
  ),
  s(
    "t23-x1",
    "en",
    "Backfill took the database down",
    "A single UPDATE over eight million rows locked the table for twenty minutes and the API timed out. We killed the query, restored service and rewrote the backfill as a background job."
  ),
  k(
    "t24",
    "en",
    "preference",
    "Prefer small pull requests under 300 lines",
    "Eduardo reviews small pull requests faster. Keep each pull request under about 300 changed lines; split refactors from features."
  ),
  s(
    "t24-x1",
    "es",
    "Revisi\xF3n de c\xF3digo lenta",
    "Un pull request de dos mil l\xEDneas estuvo una semana esperando revisi\xF3n. Nadie quer\xEDa revisarlo completo. Se dividi\xF3 en cinco partes y se aprob\xF3 en dos d\xEDas."
  ),
  d(
    "t25",
    "es",
    "El dashboard en ingl\xE9s se genera y no se edita a mano",
    "El dashboard en ingl\xE9s del vault es un archivo generado; cualquier cambio manual se pierde en la siguiente sincronizaci\xF3n."
  ),
  l(
    "t25-x1",
    "en",
    "Generated files cause merge conflicts during sync",
    "Files that every machine regenerates (dashboards, indexes) conflict on every sync. Mark them as generated, regenerate after pulling and never merge them by hand."
  ),
  h(
    "t26",
    "en",
    "Agents forget decisions because the session brief is truncated",
    "When the brief exceeds its token budget, older active decisions are cut. Agents then contradict decisions that exist in the brain."
  ),
  l(
    "t26-x1",
    "en",
    "Keep the session brief under 1500 tokens",
    "The session brief is injected at every start, so its size is paid on every session. Keep it under 1500 tokens and point to recall for the rest. A brief that grows with the brain eventually crowds out the task."
  ),
  s(
    "t26-x2",
    "es",
    "Agente contradijo una decisi\xF3n vigente",
    "El agente propuso usar Redis para los locks aunque ya hab\xEDamos decidido usar la base de datos. La decisi\xF3n no apareci\xF3 en el brief porque hab\xEDa demasiadas notas. Revisar c\xF3mo se ordenan las decisiones en el brief."
  ),
  c(
    "t27",
    "es",
    "Migrar el DNS a Cloudflare antes de fin de mes",
    "Mover las zonas DNS del dominio principal a Cloudflare y bajar el TTL un d\xEDa antes del cambio.",
    "2026-07-31"
  ),
  d(
    "t27-x1",
    "en",
    "TLS certificates are renewed by cert-manager",
    "cert-manager renews every TLS certificate thirty days before expiry using DNS challenges. The DNS provider credentials live in the cluster secret store. Manual certificates are not allowed."
  ),
  d(
    "t28",
    "en",
    "Secrets are stored in 1Password and injected at runtime",
    "API keys and passwords live in 1Password vaults and are injected as environment variables at runtime. No secrets in the repository."
  ),
  l(
    "t28-x1",
    "es",
    "Un token filtrado en un commit obliga a rotarlo de inmediato",
    "Si un token o una contrase\xF1a llega a un commit, borrarlo del historial no basta: hay que rotar el secreto de inmediato y revisar los accesos. El esc\xE1ner de secretos corre en cada push."
  ),
  s(
    "t28-x2",
    "en",
    "Secret scanning rollout",
    "We enabled secret scanning on every repository. It flagged three old API keys in test fixtures. We rotated them and moved the test secrets to 1Password."
  ),
  l(
    "t29",
    "es",
    "Responder primero con la conclusi\xF3n y despu\xE9s el detalle",
    "Los mensajes de estado empiezan con la conclusi\xF3n en una l\xEDnea; el detalle y la evidencia van despu\xE9s."
  ),
  s(
    "t29-x1",
    "en",
    "Feedback on long status updates",
    "Eduardo said the weekly status updates were too long and the conclusion was buried at the end. We agreed on a template: outcome, risks, next step, then details."
  ),
  l(
    "t30",
    "en",
    "Payment gateway timeouts must be shorter than the client timeout",
    "Set the payment gateway timeout below the browser request timeout; otherwise the user retries while the first charge is still pending."
  ),
  s(
    "t30-x1",
    "es",
    "Pasarela de pagos lenta durante el Cyber",
    "Durante el Cyber la pasarela de pagos respondi\xF3 en m\xE1s de veinte segundos. Los clientes recargaban la p\xE1gina y algunos pagos quedaron pendientes. Subimos el timeout de la pasarela, lo que empeor\xF3 la experiencia."
  )
];
var moreCompetitors = [
  s(
    "t11-x2",
    "en",
    "Quarterly business review prep",
    "Collected revenue, churn and acquisition cost numbers for the quarterly review. The metrics report still uses two definitions of churn; finance wants a single definition before the next quarterly report goes out."
  ),
  s(
    "t13-x2",
    "es",
    "Problemas con dependencias en el monorepo",
    "Los workspaces del monorepo instalaban versiones distintas de la misma dependencia. Probamos npm workspaces, yarn y pnpm. El tiempo de instalaci\xF3n en CI baj\xF3 a la mitad con el almacenamiento compartido."
  ),
  s(
    "t19-x2",
    "es",
    "Discusi\xF3n sobre nombres de ramas y commits",
    "Revisamos c\xF3mo nombrar ramas y commits. Algunas ramas ten\xEDan nombres personales y era dif\xEDcil saber qu\xE9 conten\xEDan. El tipo de la rama debe coincidir con el tipo del commit principal."
  ),
  s(
    "t21-x2",
    "es",
    "An\xE1lisis de churn por tipo de plan",
    "El churn del plan mensual es tres veces el del plan anual. Discutimos descuentos, pruebas gratuitas y recordatorios de renovaci\xF3n para mejorar la retenci\xF3n de clientes del plan mensual."
  ),
  s(
    "t22-x2",
    "en",
    "CI broke after a Node upgrade",
    "The CI image moved to a new Node release overnight and the Pi contract tests failed. We pinned the Node version in the workflow and added a check that prints the Node version in every CI job."
  ),
  l(
    "t23-x2",
    "en",
    "Large migrations need a rollback plan",
    "Before a large data migration write down how to roll it back and how long the rollback takes. A migration without a rollback plan turns a slow query into an outage."
  ),
  l(
    "t24-x2",
    "en",
    "Split refactors from behavior changes in pull requests",
    "A pull request that mixes a refactor with a behavior change is hard to review and hard to revert. Open the refactor pull request first, merge it, then open the feature pull request on top."
  ),
  s(
    "t25-x2",
    "en",
    "Sync conflict on the English dashboard",
    "Two laptops edited the English dashboard at the same time and sync reported a conflict. The dashboard is regenerated by the vault on every run, so the manual edits were lost anyway."
  ),
  s(
    "t27-x2",
    "es",
    "Ca\xEDda del sitio por un registro DNS",
    "El sitio estuvo ca\xEDdo una hora porque un registro DNS apuntaba a un servidor antiguo. El TTL era de un d\xEDa y el cambio tard\xF3 en propagarse. Evaluamos cambiar de proveedor DNS."
  ),
  k(
    "t29-x2",
    "es",
    "preference",
    "Eduardo prefiere mensajes breves",
    "Eduardo prefiere mensajes breves y directos, sin rodeos, con una sola pregunta por mensaje cuando hace falta decidir algo."
  ),
  d(
    "t30-x2",
    "en",
    "Client requests time out after 30 seconds",
    "Browser and mobile clients abort any API request after 30 seconds and show a retry button. Server-side timeouts must stay below this client timeout so the server can still answer with a clear error."
  ),
  d(
    "t18-x2",
    "es",
    "Los respaldos se cifran con una llave guardada en la b\xF3veda",
    "Cada respaldo de la base se cifra con una llave guardada en la b\xF3veda de secretos. Sin esa llave no se puede restaurar ning\xFAn respaldo, por eso la llave tiene dos custodios."
  )
];
var background = [
  s("b01", "en", "Daily standup notes", "Short standup. Nobody blocked. Design review moved to Thursday."),
  s("b02", "es", "Planificaci\xF3n del sprint 34", "Elegimos seis historias para el sprint. Dos quedan para el pr\xF3ximo por falta de dise\xF1o."),
  s("b03", "en", "Pairing on the TUI layout", "Paired on the terminal UI columns. The agent list now wraps on narrow terminals."),
  s("b04", "es", "Revisi\xF3n del roadmap del segundo semestre", "Priorizamos sincronizaci\xF3n entre m\xE1quinas y mejoras de b\xFAsqueda para el segundo semestre."),
  s("b05", "en", "Customer call with Acme", "Acme wants SSO next quarter. They are happy with the reporting module."),
  s("b06", "es", "Retrospectiva del sprint 33", "Funcion\xF3 bien el pairing. Mejorar: estimaciones demasiado optimistas."),
  s("b07", "en", "Obsidian vault cleanup", "Moved old attachments to an archive folder and fixed broken wikilinks in the index."),
  s("b08", "es", "Charla interna sobre agentes", "Presentamos c\xF3mo los agentes usan la memoria de Edu y c\xF3mo se aprueban las notas can\xF3nicas."),
  l("b09", "en", "Write the failing test before the fix", "Reproduce a bug with a failing test first; the fix is done when that test passes."),
  l("b10", "es", "Las fechas se guardan siempre en UTC", "Guardar fechas en UTC y convertir a la zona del usuario solo al mostrar."),
  l("b11", "en", "Prefer composition over inheritance in adapters", "Adapters share helpers through small functions instead of a base class."),
  l("b12", "es", "Documentar cada decisi\xF3n con su contexto", "Una decisi\xF3n sin contexto se vuelve a discutir. Anotar el porqu\xE9 y las alternativas."),
  d("b13", "en", "Use vitest for unit tests", "The project uses vitest for unit and integration tests; no Jest."),
  d("b14", "es", "Commander para la interfaz de l\xEDnea de comandos", "La CLI se construye con commander; los subcomandos se registran en program.ts."),
  d("b15", "en", "The brain is plain Markdown with YAML frontmatter", "Notes stay human-readable Markdown so Obsidian can open the brain directly."),
  h("b16", "en", "A weekly digest email would raise retention", "Users who receive a weekly summary may come back more often. Not tested yet."),
  h("b17", "es", "El modo oscuro reduce tickets de accesibilidad", "Sospechamos que un tema oscuro bien contrastado reduce reclamos de legibilidad."),
  c("b18", "en", "Publish the 4.1 release notes", "Write and publish the release notes for 4.1 on the blog.", "2026-07-05"),
  c("b19", "es", "Actualizar la gu\xEDa de instalaci\xF3n en espa\xF1ol", "Revisar los pasos de instalaci\xF3n en README.es.md despu\xE9s del cambio de comandos.", "2026-07-20"),
  k("b20", "en", "person", "Diego Fuentes \u2014 backend lead", "Diego owns the API and the database. Ask him before changing schemas."),
  k("b21", "es", "preference", "Reuniones solo con agenda escrita", "Eduardo acepta reuniones solo si llegan con agenda escrita y objetivo claro."),
  k("b22", "en", "standard", "Public functions have a one-line doc comment", "Every exported function has a one-line comment that says what it does, not how."),
  s("b23", "en", "Accessibility review of the docs site", "Checked contrast and keyboard navigation. Two pages need alt text."),
  s("b24", "es", "Onboarding de una nueva desarrolladora", "Luc\xEDa configur\xF3 su entorno en una hora siguiendo CONTRIBUTING.md. Faltaba un paso sobre Pi."),
  s("b25", "en", "Benchmark of the search index", "Recall on a thousand notes takes a few milliseconds. No index needed yet."),
  s("b26", "es", "Llamada con proveedor de correo", "El proveedor confirm\xF3 que los correos transaccionales salen desde una IP dedicada."),
  l("b27", "en", "Keep CLI output stable for scripts", "Machine-readable output goes behind --json; human output may change between versions."),
  l("b28", "es", "No mezclar refactor con cambios de comportamiento", "Un refactor va en su propio commit para que la revisi\xF3n sea simple."),
  d("b29", "en", "MIT license for the public repository", "The public repository is MIT licensed; contributors keep their copyright."),
  s("b30", "en", "Kickoff for Edu 5.0 planning", "Collected ideas from second-brain projects. Decided to measure before changing anything.")
];
var CORPUS_NOTES = [...topics, ...moreCompetitors, ...background];
var CORPUS_QUERIES = [
  // keyword: the query reuses the target's own words.
  { id: "k01", class: "keyword", text: "postgres advisory locks job scheduler", expect: "t01" },
  { id: "k02", class: "keyword", text: "facturaci\xF3n mensual cierre d\xEDa 25", expect: "t02" },
  { id: "k03", class: "keyword", text: "retry webhooks exponential backoff jitter", expect: "t03" },
  { id: "k04", class: "keyword", text: "respaldar la base antes de cada migraci\xF3n", expect: "t04" },
  { id: "k05", class: "keyword", text: "Camila Rojas finanzas", expect: "t06" },
  { id: "k06", class: "keyword", text: "cold starts p95 latency spikes Mondays", expect: "t08" },
  { id: "k07", class: "keyword", text: "Windows installer fix Friday", expect: "t10" },
  { id: "k08", class: "keyword", text: "deploy only from main branch", expect: "t12" },
  { id: "k09", class: "keyword", text: "mask card numbers last four digits", expect: "t14" },
  { id: "k10", class: "keyword", text: "feature flags LaunchDarkly environment variables", expect: "t16" },
  { id: "k11", class: "keyword", text: "duplicate payments refunded automatically", expect: "t20" },
  { id: "k12", class: "keyword", text: "plan anual descuento retenci\xF3n", expect: "t21" },
  { id: "k13", class: "keyword", text: "migraciones de datos por lotes de mil filas", expect: "t23" },
  { id: "k14", class: "keyword", text: "secrets 1Password injected at runtime", expect: "t28" },
  { id: "k15", class: "keyword", text: "payment gateway timeout shorter than client timeout", expect: "t30" },
  // paraphrase: same language, different words.
  { id: "p01", class: "paraphrase", text: "how do we stop two workers from running the same cron task", expect: "t01" },
  { id: "p02", class: "paraphrase", text: "qu\xE9 hacer antes de alterar tablas en producci\xF3n", expect: "t04" },
  { id: "p03", class: "paraphrase", text: "which language should replies to the owner use", expect: "t05" },
  { id: "p04", class: "paraphrase", text: "qui\xE9n autoriza modificar las tarifas", expect: "t06" },
  { id: "p05", class: "paraphrase", text: "what is required before merging a change", expect: "t07" },
  { id: "p06", class: "paraphrase", text: "en qu\xE9 etapa del registro se pierden m\xE1s personas", expect: "t09" },
  { id: "p07", class: "paraphrase", text: "which package manager do we use in the monorepo", expect: "t13" },
  { id: "p08", class: "paraphrase", text: "por qu\xE9 la suite falla al azar por la base de datos", expect: "t15" },
  { id: "p09", class: "paraphrase", text: "how often do we test that we can recover data", expect: "t18" },
  { id: "p10", class: "paraphrase", text: "c\xF3mo deben llamarse las branches de git", expect: "t19" },
  { id: "p11", class: "paraphrase", text: "which runtime version does continuous integration use", expect: "t22" },
  { id: "p12", class: "paraphrase", text: "how big should a code change be for review", expect: "t24" },
  { id: "p13", class: "paraphrase", text: "se puede modificar manualmente el panel del vault", expect: "t25" },
  { id: "p14", class: "paraphrase", text: "why do agents ignore choices we already made", expect: "t26" },
  { id: "p15", class: "paraphrase", text: "c\xF3mo estructurar un reporte de avance", expect: "t29" },
  // cross-language: Spanish query for an English note and vice versa.
  { id: "x01", class: "cross-language", text: "bloqueos de base de datos para tareas programadas", expect: "t01" },
  { id: "x02", class: "cross-language", text: "when do we issue the monthly invoices", expect: "t02" },
  { id: "x03", class: "cross-language", text: "reintentos de webhooks con espera exponencial", expect: "t03" },
  { id: "x04", class: "cross-language", text: "take a backup before running a schema migration", expect: "t04" },
  { id: "x05", class: "cross-language", text: "idioma preferido para responder a Eduardo", expect: "t05" },
  { id: "x06", class: "cross-language", text: "who approves pricing changes", expect: "t06" },
  { id: "x07", class: "cross-language", text: "arranques en fr\xEDo y picos de latencia los lunes", expect: "t08" },
  { id: "x08", class: "cross-language", text: "users drop off at email verification during onboarding", expect: "t09" },
  { id: "x09", class: "cross-language", text: "desplegar solo desde la rama principal", expect: "t12" },
  { id: "x10", class: "cross-language", text: "support hours in Chile time", expect: "t17" },
  { id: "x11", class: "cross-language", text: "simulacros de restauraci\xF3n de respaldos cada trimestre", expect: "t18" },
  { id: "x12", class: "cross-language", text: "reembolso autom\xE1tico de pagos duplicados", expect: "t20" },
  { id: "x13", class: "cross-language", text: "long data migrations run in batches of a thousand rows", expect: "t23" },
  { id: "x14", class: "cross-language", text: "move DNS to Cloudflare before month end", expect: "t27" },
  { id: "x15", class: "cross-language", text: "nunca registrar n\xFAmeros de tarjeta completos en los logs", expect: "t14" },
  // id: exact id, legacy correlative or alias.
  { id: "i01", class: "id", text: "D-014", expect: "t01" },
  { id: "i02", class: "id", text: "@id", expect: "t01" },
  { id: "i03", class: "id", text: "@id", expect: "t02" },
  { id: "i04", class: "id", text: "@id", expect: "t03" },
  { id: "i05", class: "id", text: "@id", expect: "t05" },
  { id: "i06", class: "id", text: "Camila", expect: "t06" },
  { id: "i07", class: "id", text: "@id", expect: "t09" },
  { id: "i08", class: "id", text: "@id", expect: "t11" },
  { id: "i09", class: "id", text: "@id", expect: "t15" },
  { id: "i10", class: "id", text: "@id", expect: "t19" },
  { id: "i11", class: "id", text: "@id", expect: "t21" },
  { id: "i12", class: "id", text: "@id", expect: "t25" },
  { id: "i13", class: "id", text: "@id", expect: "t27" },
  { id: "i14", class: "id", text: "@id", expect: "t29" },
  { id: "i15", class: "id", text: "@id", expect: "t30" }
];
function fixtureCreated(index) {
  return new Date(Date.UTC(2026, 4, 1) + index * 7 * 36e5).toISOString();
}

// src/bench/retrieval.ts
var round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
function rankMetrics(ranks) {
  const n = ranks.length;
  if (!n) return { n: 0, recallAt1: 0, recallAt5: 0, recallAt10: 0, mrr: 0 };
  const within = (k2) => ranks.filter((rank) => rank !== null && rank <= k2).length / n;
  const mrr = ranks.reduce((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / n;
  return { n, recallAt1: round(within(1)), recallAt5: round(within(5)), recallAt10: round(within(10)), mrr: round(mrr) };
}
function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1));
  return sorted[index];
}
async function seedCorpus(root, notes = CORPUS_NOTES) {
  const location = { scope: "project", root };
  const brain = openBrain([location]);
  await brain.init(location);
  const ids = /* @__PURE__ */ new Map();
  for (const [index, fixture] of notes.entries()) {
    const created = fixtureCreated(index);
    const provenance = {
      ...fixture.legacyId ? { legacy_id: fixture.legacyId } : {},
      ...fixture.aliases ? { aliases: fixture.aliases } : {}
    };
    const base = { title: fixture.title, body: fixture.body, tier: fixture.tier, kind: fixture.kind, created, source: "bench:fixture", provenance, ...fixture.tags ? { tags: fixture.tags } : {} };
    if (fixture.tier === "canonical") {
      const proposed = await brain.proposeCanonical(base);
      ids.set(fixture.key, fixture.status === "proposed" ? proposed.meta.id : (await brain.acceptCanonical(proposed.meta.id)).meta.id);
    } else if (fixture.kind === "session") {
      ids.set(fixture.key, (await brain.write({ ...base, status: fixture.status ?? "closed" })).meta.id);
    } else {
      ids.set(fixture.key, (await brain.write({ ...base, ...fixture.due ? { due: fixture.due } : {}, ...fixture.status ? { status: fixture.status } : {} })).meta.id);
    }
  }
  return ids;
}
var TIERS = /* @__PURE__ */ new Set(["canonical", "episodic", "transitive"]);
var KINDS = /* @__PURE__ */ new Set(["decision", "hypothesis", "commitment", "lesson", "identity", "standard", "lexicon", "domain", "person", "preference", "session"]);
var isText = (value) => typeof value === "string" && value.trim() !== "";
var MAX_ALT = 3;
function parseCorpus(raw) {
  const fail = (message) => {
    throw new Error(`Invalid corpus: ${message}`);
  };
  if (!raw || typeof raw !== "object") fail("expected a JSON object with notes and queries");
  const { notes, queries, version } = raw;
  if (!Array.isArray(notes) || !notes.length) fail('"notes" must be a non-empty array');
  if (!Array.isArray(queries) || !queries.length) fail('"queries" must be a non-empty array');
  if (version !== void 0 && typeof version !== "number") fail('"version" must be a number');
  const keys = /* @__PURE__ */ new Set();
  const parsedNotes = notes.map((entry, index) => {
    const n = entry ?? {};
    const where = `notes[${index}]`;
    if (!isText(n.key)) fail(`${where}.key must be a non-empty string`);
    if (keys.has(n.key)) fail(`${where}.key "${String(n.key)}" is duplicated`);
    keys.add(n.key);
    if (!isText(n.title)) fail(`${where}.title must be a non-empty string`);
    if (typeof n.body !== "string") fail(`${where}.body must be a string`);
    if (!TIERS.has(n.tier)) fail(`${where}.tier must be one of ${[...TIERS].join(", ")}`);
    if (!KINDS.has(n.kind)) fail(`${where}.kind must be one of ${[...KINDS].join(", ")}`);
    if (n.tags !== void 0 && (!Array.isArray(n.tags) || !n.tags.every(isText))) fail(`${where}.tags must be an array of strings`);
    if (n.aliases !== void 0 && (!Array.isArray(n.aliases) || !n.aliases.every(isText))) fail(`${where}.aliases must be an array of strings`);
    for (const field of ["status", "due", "legacyId"]) if (n[field] !== void 0 && !isText(n[field])) fail(`${where}.${field} must be a string`);
    if (n.lang !== void 0 && n.lang !== "es" && n.lang !== "en") fail(`${where}.lang must be es or en`);
    return {
      key: n.key,
      title: n.title,
      body: n.body,
      tier: n.tier,
      kind: n.kind,
      ...n.lang ? { lang: n.lang } : {},
      ...n.status ? { status: n.status } : {},
      ...n.tags ? { tags: n.tags } : {},
      ...n.due ? { due: n.due } : {},
      ...n.legacyId ? { legacyId: n.legacyId } : {},
      ...n.aliases ? { aliases: n.aliases } : {}
    };
  });
  const parsedQueries = queries.map((entry, index) => {
    const q = entry ?? {};
    const where = `queries[${index}]`;
    if (!isText(q.q)) fail(`${where}.q must be a non-empty string`);
    if (!isText(q.target)) fail(`${where}.target must be a non-empty string`);
    if (!keys.has(q.target)) fail(`${where}.target "${String(q.target)}" is not a note key`);
    if (!isText(q.class)) fail(`${where}.class must be a non-empty string`);
    if (q.id !== void 0 && !isText(q.id)) fail(`${where}.id must be a string`);
    if (q.alt !== void 0 && (!Array.isArray(q.alt) || q.alt.length > MAX_ALT || !q.alt.every(isText))) fail(`${where}.alt must be an array of at most ${MAX_ALT} non-empty strings`);
    return {
      id: q.id ?? `q${index + 1}`,
      class: q.class,
      text: q.q,
      expect: q.target,
      ...Array.isArray(q.alt) && q.alt.length ? { alt: q.alt } : {}
    };
  });
  return { version: version ?? 0, notes: parsedNotes, queries: parsedQueries };
}
async function loadCorpus(path) {
  let raw;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read corpus ${path}: ${error.message}`);
  }
  return parseCorpus(raw);
}
async function runRetrievalBench(options = {}) {
  const notes = options.notes ?? CORPUS_NOTES;
  const queries = options.queries ?? CORPUS_QUERIES;
  const base = await mkdtemp(join(options.tmpRoot ?? tmpdir(), "edu-bench-retrieval-"));
  try {
    const template = join(base, "template", ".edu");
    const ids = await seedCorpus(template, notes);
    const keys = new Map([...ids].map(([key, id]) => [id, key]));
    const results = [];
    const brain = openBrain([{ scope: "project", root: template }]);
    for (const query of queries) {
      const expected = ids.get(query.expect);
      if (!expected) throw new Error(`Bench query ${query.id} expects unknown fixture ${query.expect}`);
      const text = query.text === "@id" ? expected : query.text;
      await rm(ledgerPath(template), { force: true });
      const started = performance.now();
      const alt = options.useAlt !== false && query.alt?.length ? query.alt : void 0;
      const hits = await brain.recall(alt ? [text, ...alt] : text, { limit: 10 });
      const latencyMs = performance.now() - started;
      const position = hits.findIndex((hit) => hit.note.meta.id === expected);
      const top3 = hits.slice(0, 3).map((hit) => keys.get(hit.note.meta.id) ?? hit.note.meta.id);
      results.push({ id: query.id, class: query.class, query: query.text, ...alt ? { alt } : {}, expected: query.expect, rank: position >= 0 ? position + 1 : null, top3, latencyMs: round(latencyMs, 2) });
    }
    const classes = [...new Set(results.map((r) => r.class))];
    const byClass = Object.fromEntries(classes.map((cls) => [cls, rankMetrics(results.filter((r) => r.class === cls).map((r) => r.rank))]));
    const latencies = results.map((r) => r.latencyMs);
    return {
      corpus: { source: options.source ?? "builtin", version: options.version ?? CORPUS_VERSION, notes: notes.length, queries: queries.length, byLang: { es: notes.filter((n) => n.lang === "es").length, en: notes.filter((n) => n.lang === "en").length } },
      overall: rankMetrics(results.map((r) => r.rank)),
      byClass,
      latencyMs: { p50: round(percentile(latencies, 50), 2), p95: round(percentile(latencies, 95), 2) },
      queries: results
    };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

export {
  rankMetrics,
  percentile,
  seedCorpus,
  parseCorpus,
  loadCorpus,
  runRetrievalBench
};
//# sourceMappingURL=chunk-HIDTZMHN.js.map