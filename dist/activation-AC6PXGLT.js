import {
  openBrain
} from "./chunk-BDQUVGCN.js";
import "./chunk-KDSAKUP2.js";
import "./chunk-NMJNTHQG.js";
import "./chunk-ZJAEVUE2.js";
import "./chunk-YINGR2DA.js";
import "./chunk-YPR7PZSQ.js";
import "./chunk-VP6QM6H5.js";

// src/bench/activation.ts
import { join } from "path";
var ACTIVATION_TOPIC = "la cola de trabajos en segundo plano";
var ACTIVATION_PROMPT = `\xBFCu\xE1l es la decisi\xF3n vigente sobre ${ACTIVATION_TOPIC}, su evidencia, la opci\xF3n descartada, qu\xE9 hip\xF3tesis abierta est\xE1 obsoleta y cu\xE1l es el siguiente paso seguro? Usa la memoria de Edu.`;
var DAY = 864e5;
var ACTIVATION_NOTES = {
  rejected: {
    id: "D-usar-redis-con-bullmq-para-la-cola-de-trabajos",
    title: "Usar Redis con BullMQ para la cola de trabajos",
    body: "Los trabajos en segundo plano (correos, facturas, webhooks) se encolan en Redis con BullMQ. Elegido por rapidez de implementaci\xF3n.",
    ageDays: 120
  },
  active: {
    id: "D-usar-postgres-con-pg-boss-para-la-cola-de-trabajos",
    title: "Usar Postgres con pg-boss para la cola de trabajos",
    source: "docs/adr/0007-cola-de-trabajos.md",
    body: [
      "La cola de trabajos en segundo plano usa Postgres con pg-boss y reemplaza a Redis con BullMQ.",
      "Evidencia: el incidente INC-42 (Redis desaloj\xF3 312 trabajos encolados por presi\xF3n de memoria) y una prueba de carga en la que pg-boss sostuvo 1.200 trabajos por segundo.",
      "Fuente: docs/adr/0007-cola-de-trabajos.md."
    ].join("\n\n"),
    ageDays: 20
  },
  stale: {
    id: "H-redis-aguanta-el-pico-de-black-friday-sin-perder-trabajos",
    title: "Redis aguanta el pico de Black Friday sin perder trabajos",
    body: "Creemos que la instancia actual de Redis soporta el pico de Black Friday sin perder trabajos de la cola. Pendiente de medir.",
    ageDays: 90
  }
};
async function seedActivation(dir, now = /* @__PURE__ */ new Date()) {
  const root = join(dir, ".edu");
  const location = { scope: "project", root };
  const brain = openBrain([location]);
  await brain.init(location);
  const at = (days) => new Date(now.getTime() - days * DAY).toISOString();
  const { rejected, active, stale } = ACTIVATION_NOTES;
  const old = await brain.write({ tier: "transitive", kind: "decision", title: rejected.title, body: rejected.body, created: at(rejected.ageDays), source: "user", band: "inferred" });
  const hypothesis = await brain.write({ tier: "transitive", kind: "hypothesis", title: stale.title, body: stale.body, created: at(stale.ageDays), source: "user", band: "hypothesis" });
  const current = await brain.write({ tier: "transitive", kind: "decision", title: active.title, body: active.body, created: at(active.ageDays), source: active.source, band: "verified", supersedes: old.meta.id });
  return { root, prompt: ACTIVATION_PROMPT, ids: { active: current.meta.id, rejected: old.meta.id, stale: hypothesis.meta.id } };
}
var fold = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
var anyOf = (text, needles) => needles.find((needle) => text.includes(fold(needle)));
var ACTIVE_ANCHORS = [ACTIVATION_NOTES.active.id, ACTIVATION_NOTES.active.title, "pg-boss", "pgboss"];
var EVIDENCE_ANCHORS = ["INC-42", "INC 42", "312", "adr/0007", "adr 0007", "0007-cola", "1.200", "1,200", "1200"];
var REJECTED_ANCHORS = [ACTIVATION_NOTES.rejected.id, "bullmq", "redis"];
var REJECTED_CUES = ["descart", "rechaz", "revert", "reemplaz", "sustitu", "abandon", "supersed", "reject", "replaced", "discard", "dropped", "ya no", "no longer", "anterior", "previous"];
var STALE_ANCHORS = [ACTIVATION_NOTES.stale.id, "black friday", "H-redis"];
var STALE_CUES = ["obsolet", "desactualiz", "stale", "outdated", "caduc", "vencid", "antigu", "vieja", "old", "contradic", "no aplica", "invalid", "superad", "dias", "days", "meses", "months"];
var NEXT_CUES = ["siguiente paso", "proximo paso", "next step", "recomiendo", "sugiero", "recommend", "suggest", "propongo", "deberiamos", "should"];
var sentences = (text) => fold(text).split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
var sentenceWith = (parts, anchors, cues) => parts.find((part) => anyOf(part, anchors) && anyOf(part, cues));
var isHeading = (line) => /^\s*#{1,6}\s/.test(line) || /^\s*\*\*[^*]+\*\*:?\s*$/.test(line);
var sectionWith = (text, anchors, cues) => {
  const lines = fold(text).split("\n");
  for (const [i, line] of lines.entries()) {
    if (!isHeading(line) || !anyOf(line, cues)) continue;
    const end = lines.findIndex((next, j) => j > i && isHeading(next));
    const body = lines.slice(i + 1, end === -1 ? void 0 : end).join(" ");
    const first = /\b[a-z]-[a-z0-9]+(?:-[a-z0-9]+)+/.exec(`${line} ${body}`)?.[0];
    if (first && !anyOf(first, anchors)) continue;
    if (anyOf(body, anchors)) return `${line.trim()} ${body.trim()}`;
  }
  return void 0;
};
function gradeActivation(answer) {
  const text = fold(answer.split(ACTIVATION_PROMPT).join(" "));
  const parts = sentences(answer.split(ACTIVATION_PROMPT).join(" "));
  const active = anyOf(text, ACTIVE_ANCHORS);
  const evidence = anyOf(text, EVIDENCE_ANCHORS);
  const body = answer.split(ACTIVATION_PROMPT).join(" ");
  const rejected = sentenceWith(parts, REJECTED_ANCHORS, REJECTED_CUES) ?? sectionWith(body, REJECTED_ANCHORS, REJECTED_CUES);
  const stale = sentenceWith(parts, STALE_ANCHORS, STALE_CUES) ?? sectionWith(body, STALE_ANCHORS, STALE_CUES);
  const next = anyOf(text, NEXT_CUES);
  const checks = [
    { id: "active-decision", passed: Boolean(active), detail: active ? `cites "${active}"` : "active decision not cited (id, title or pg-boss)" },
    { id: "evidence", passed: Boolean(evidence), detail: evidence ? `mentions "${evidence}"` : "no evidence cited (INC-42, 312 jobs, load test, ADR 0007)" },
    { id: "rejected-option", passed: Boolean(rejected), detail: rejected ? `"${rejected.slice(0, 120)}"` : "Redis/BullMQ not named as rejected" },
    { id: "stale-note", passed: Boolean(stale), detail: stale ? `"${stale.slice(0, 120)}"` : "stale hypothesis not flagged" },
    { id: "next-step", passed: Boolean(next), detail: next ? `proposes a step ("${next}")` : "no next step proposed" }
  ];
  return { score: checks.filter((check) => check.passed).length, max: 5, checks };
}
export {
  ACTIVATION_NOTES,
  ACTIVATION_PROMPT,
  ACTIVATION_TOPIC,
  gradeActivation,
  seedActivation
};
//# sourceMappingURL=activation-AC6PXGLT.js.map