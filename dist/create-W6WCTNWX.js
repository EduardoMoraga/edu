import {
  layoutFolders,
  workspaceLayout
} from "./chunk-MRXNEYBJ.js";
import {
  initBrain
} from "./chunk-2OSE2OFU.js";
import {
  upsertManagedBlock
} from "./chunk-DGIFDAPF.js";
import {
  whichSync
} from "./chunk-5U2RISJO.js";
import {
  identityName
} from "./chunk-24HJWHHE.js";
import {
  resolveBrainLocations
} from "./chunk-3S2XBVXW.js";
import "./chunk-EQRHO5D6.js";
import {
  openBrain,
  readProjects,
  registerProject
} from "./chunk-BTL6QUSW.js";
import {
  atomicWrite,
  brainPath,
  readWorkspaceSettings,
  slugify
} from "./chunk-MWM3NETH.js";

// src/workspace/create.ts
import { readdir, realpath, stat } from "fs/promises";
import { join as join4, relative, resolve } from "path";

// src/workspace/extract.ts
import { z } from "zod";
var NOTE_KINDS = ["standard", "decision", "glossary", "process", "fact", "person", "client"];
var ExtractionSchema = z.object({
  identity: z.object({ name: z.string(), role: z.string(), tone: z.string(), summary: z.string() }),
  notes: z.array(z.object({
    title: z.string().trim().min(1),
    kind: z.enum(NOTE_KINDS),
    body: z.string().trim().min(1),
    band: z.enum(["verified", "inferred"]),
    source: z.string()
  })),
  playbooks: z.array(z.object({ name: z.string().trim().min(1), title: z.string().trim().min(1), steps: z.array(z.string().trim().min(1)).min(1) })),
  glossary: z.array(z.object({ term: z.string().trim().min(1), meaning: z.string().trim().min(1) }))
});
var ExtractionError = class extends Error {
};
function headings(lines) {
  const found = [];
  let fence = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) found.push({ level: match[1].length, text: match[2].replace(/[*_`]/g, "").trim(), line: index });
  });
  return found;
}
var stem = (name) => name.replace(/\.[^.]+$/, "");
var firstParagraph = (text) => text.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith("#") && !p.startsWith("|")) ?? "";
var clip = (text, max) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}\u2026` : text;
function guessKind(title) {
  if (/glosario|glossary|t[eé]rminos|terminolog|definiciones|definitions/i.test(title)) return "glossary";
  if (/proceso|procedimiento|process|procedure|paso a paso|step|checklist|flujo|workflow/i.test(title)) return "process";
  if (/cliente|client|customer|cuenta|account/i.test(title)) return "client";
  if (/equipo|team|personas|people|contacto|contacts|roles/i.test(title)) return "person";
  if (/regla|norma|pol[ií]tica|policy|rule|standard|est[aá]ndar|criterio/i.test(title)) return "standard";
  if (/decisi[oó]n|decision/i.test(title)) return "decision";
  return "fact";
}
function splitDocument(doc) {
  const lines = doc.text.split("\n");
  const all = headings(lines);
  let title = stem(doc.name);
  let sections = all;
  let introStart = 0;
  if (all[0] && all[0].level === 1 && all.filter((h) => h.level === 1).length === 1 && all.length > 1) {
    title = all[0].text;
    sections = all.slice(1);
    introStart = all[0].line + 1;
  }
  const splitLevel = sections.length ? Math.min(...sections.map((h) => h.level)) : 0;
  const cuts = sections.filter((h) => h.level === splitLevel);
  const notes = [];
  const intro = lines.slice(introStart, cuts[0]?.line ?? lines.length).join("\n").trim();
  if (intro) notes.push({ title, kind: "overview", body: intro, band: "verified", source: doc.name });
  cuts.forEach((cut, index) => {
    const body = lines.slice(cut.line + 1, cuts[index + 1]?.line ?? lines.length).join("\n").trim();
    if (body) notes.push({ title: cut.text, kind: guessKind(cut.text), body, band: "verified", source: `${doc.name}#${cut.text}` });
  });
  return { title, notes };
}
function extractDeterministic(docs, agentName) {
  const split = docs.map(splitDocument);
  const overview = split.flatMap((s) => s.notes).find((n) => n.kind === "overview");
  const summary = clip(firstParagraph(overview?.body ?? docs[0]?.text ?? "").replace(/\s+/g, " "), 400);
  const merged = mergeExtractions(split.map((s) => ({ identity: { name: agentName, role: "", tone: "", summary: "" }, notes: s.notes, playbooks: [], glossary: [] })));
  return { ...merged, identity: { name: agentName, role: "", tone: "", summary } };
}
var key = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function mergeExtractions(parts) {
  const identity = { name: "", role: "", tone: "", summary: "" };
  const notes = /* @__PURE__ */ new Map();
  const playbooks = /* @__PURE__ */ new Map();
  const glossary = /* @__PURE__ */ new Map();
  for (const part of parts) {
    for (const field of ["name", "role", "tone", "summary"]) if (!identity[field] && part.identity[field]?.trim()) identity[field] = part.identity[field].trim();
    for (const note of part.notes) {
      const id = key(note.title);
      const prior = notes.get(id);
      if (!prior) {
        notes.set(id, { ...note });
        continue;
      }
      if (!prior.body.includes(note.body)) prior.body = `${prior.body}

${note.body}`;
      if (note.band === "inferred") prior.band = "inferred";
      if (note.source && !prior.source.split("; ").includes(note.source)) prior.source = `${prior.source}; ${note.source}`;
    }
    for (const playbook of part.playbooks) if (!playbooks.has(key(playbook.name))) playbooks.set(key(playbook.name), playbook);
    for (const entry of part.glossary) if (!glossary.has(key(entry.term))) glossary.set(key(entry.term), entry);
  }
  return { identity, notes: [...notes.values()], playbooks: [...playbooks.values()], glossary: [...glossary.values()] };
}
var DEFAULT_CHUNK_CHARS = 24e3;
function chunkDocuments(docs, max = DEFAULT_CHUNK_CHARS) {
  const pieces = [];
  for (const doc of docs) {
    const header = `=== FILE: ${doc.name} ===
`;
    const budget = Math.max(500, max - header.length - 50);
    const units = doc.text.split(/\n(?=#{1,6}\s)/).flatMap((section) => section.length <= budget ? [section] : section.split(/\n\s*\n/).flatMap((paragraph) => paragraph.length <= budget ? [paragraph] : Array.from({ length: Math.ceil(paragraph.length / budget) }, (_, i) => paragraph.slice(i * budget, (i + 1) * budget))));
    let current2 = "";
    for (const unit of units) {
      if (current2 && current2.length + unit.length + 2 > budget) {
        pieces.push(header + current2);
        current2 = "";
      }
      current2 = current2 ? `${current2}

${unit}` : unit;
    }
    if (current2.trim()) pieces.push(header + current2);
  }
  const chunks = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > max) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}

${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks;
}
function extractionPrompt(chunk, opts) {
  const language = opts.lang === "es" ? "Spanish" : "English";
  return [
    `You are building the knowledge base of a workspace agent named "${opts.agentName}". Read the documents below (part ${opts.part} of ${opts.parts}) and extract what an agent must know to work in this operation.`,
    "",
    "Return ONLY one JSON object, no prose and no code fences, matching exactly:",
    '{"identity":{"name":string,"role":string,"tone":string,"summary":string},',
    ' "notes":[{"title":string,"kind":"standard"|"decision"|"glossary"|"process"|"fact"|"person"|"client","body":string,"band":"verified"|"inferred","source":string}],',
    ' "playbooks":[{"name":string,"title":string,"steps":[string]}],',
    ' "glossary":[{"term":string,"meaning":string}]}',
    "",
    "Rules:",
    `- identity.name is "${opts.agentName}". role: the agent's role in this operation in one line. tone: how it should speak. summary: the operation in 2-3 sentences.`,
    "- One note per durable topic (clients, channels, KPIs, rules, people, decisions, facts). Titles are short and unique. Body is self-contained Markdown, faithful to the source.",
    '- band "verified" only when the document states it; "inferred" for your interpretation or synthesis.',
    '- source is "<file name>#<section heading>" from the FILE markers and headings.',
    "- playbooks: repeatable procedures with ordered steps; name is a short kebab-case id.",
    "- glossary: acronyms and internal terms with their meaning.",
    `- Write titles, bodies and steps in ${language}. Do not invent facts. Empty arrays are fine.`,
    "",
    chunk
  ].join("\n");
}
function parseExtraction(answer) {
  const text = answer.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ExtractionError("the answer contains no JSON object");
  let raw;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new ExtractionError(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = ExtractionSchema.safeParse(raw);
  if (!parsed.success) throw new ExtractionError(`schema mismatch: ${parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
  return parsed.data;
}
async function extractWithLlm(docs, run, opts) {
  const chunks = chunkDocuments(docs, opts.chunkChars);
  const parts = [];
  for (const [index, chunk] of chunks.entries()) {
    opts.onChunk?.(index + 1, chunks.length);
    const prompt = extractionPrompt(chunk, { agentName: opts.agentName, lang: opts.lang, part: index + 1, parts: chunks.length });
    let result;
    try {
      result = parseExtraction(await run(prompt));
    } catch (first) {
      const reason = first instanceof Error ? first.message : String(first);
      try {
        result = parseExtraction(await run(`${prompt}

Your previous answer was rejected (${reason}). Answer again with ONLY the JSON object.`));
      } catch (second) {
        throw new ExtractionError(`chunk ${index + 1}/${chunks.length}: ${second instanceof Error ? second.message : String(second)}`);
      }
    }
    parts.push(result);
  }
  const merged = mergeExtractions(parts);
  return { ...merged, identity: { ...merged.identity, name: opts.agentName } };
}

// src/workspace/ingest.ts
import { access } from "fs/promises";
import { join } from "path";
var CANONICAL_KIND = {
  overview: "identity",
  standard: "standard",
  decision: "standard",
  process: "standard",
  glossary: "lexicon",
  fact: "domain",
  person: "person",
  client: "domain"
};
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
function freeTitle(title, taken, label) {
  const candidates = [title, `${title} (${label})`];
  for (let n = 2; n < 100; n++) candidates.push(`${title} (${label} ${n})`);
  const free = candidates.find((candidate) => !taken.has(`K-${slugify(candidate)}`)) ?? `${title} ${Date.now()}`;
  taken.add(`K-${slugify(free)}`);
  return free;
}
var sourceLabel = (source) => source.split("#")[0].split("; ")[0].replace(/\.[^.]+$/, "") || "doc";
async function ingestExtraction(brain, eduRoot, extraction, opts) {
  const report = { accepted: 0, proposed: 0, glossaryTerms: 0, playbooks: [], skipped: 0 };
  const taken = new Set((await brain.list({ tier: "canonical" })).map((note) => note.meta.id));
  const write = async (note) => {
    const title = freeTitle(note.title, taken, sourceLabel(note.source || opts.origin));
    const created = await brain.proposeCanonical({
      tier: "canonical",
      kind: CANONICAL_KIND[note.kind],
      title,
      body: note.body,
      band: note.band,
      source: note.source || opts.origin,
      tags: ["workspace", note.kind]
    });
    if (note.band === "verified") {
      await brain.acceptCanonical(created.meta.id);
      report.accepted++;
    } else report.proposed++;
  };
  for (const note of extraction.notes) {
    if (!note.title.trim() || !note.body.trim()) {
      report.skipped++;
      continue;
    }
    await write(note);
  }
  if (extraction.glossary.length) {
    const body = [...extraction.glossary].sort((a, b) => a.term.localeCompare(b.term)).map((entry) => `- **${entry.term}**: ${entry.meaning}`).join("\n");
    await write({ title: opts.lang === "es" ? "Glosario" : "Glossary", kind: "glossary", body, band: "verified", source: opts.origin });
    report.glossaryTerms = extraction.glossary.length;
  }
  for (const playbook of extraction.playbooks) {
    const base = slugify(playbook.name);
    let name = base;
    for (let n = 2; await exists(join(eduRoot, "playbooks", `${name}.md`)); n++) name = `${base}-${n}`;
    const steps = playbook.steps.map((step, index) => `${index + 1}. ${step.replace(/^\s*\d+[.)]\s*/, "")}`).join("\n");
    const description = playbook.title.replace(/\s+/g, " ").trim();
    await atomicWrite(join(eduRoot, "playbooks", `${name}.md`), [
      "---",
      `name: ${name}`,
      `description: ${JSON.stringify(description)}`,
      "requireSpecApproval: true",
      "---",
      "",
      `# ${playbook.title}`,
      "",
      `${opts.lang === "es" ? "Fuente" : "Source"}: ${opts.origin}`,
      "",
      steps,
      ""
    ].join("\n"));
    report.playbooks.push(name);
  }
  await brain.rebuildIndex();
  return report;
}

// src/workspace/readers.ts
import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { basename, extname } from "path";
import { inflateRawSync } from "zlib";
var SUPPORTED_EXTENSIONS = { ".md": "md", ".markdown": "md", ".txt": "txt", ".docx": "docx", ".pdf": "pdf" };
function documentFormat(path) {
  const format = SUPPORTED_EXTENSIONS[extname(path).toLowerCase()];
  if (!format) throw new Error(`Unsupported document type: ${basename(path)} (use .md, .txt, .docx or .pdf)`);
  return format;
}
async function readDocument(path, deps = {}) {
  const format = documentFormat(path);
  const name = basename(path);
  if (format === "md" || format === "txt") return { path, name, format, text: normalize(await readFile(path, "utf8")) };
  const data = await readFile(path);
  if (format === "docx") return { path, name, format, text: normalize(docxToMarkdown(data)) };
  const text = await (deps.pdftotext ?? runPdftotext)(path) ?? await (deps.pdfFallback ?? unpdfText)(new Uint8Array(data));
  if (text === void 0) throw new Error(`Cannot read ${name}: install poppler (pdftotext) or reinstall Edu so its PDF reader (unpdf) is present`);
  if (!text.trim()) throw new Error(`No text found in ${name}: it may be a scanned PDF; export it as text or .docx first`);
  return { path, name, format, text: normalize(text) };
}
var normalize = (text) => text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\f/g, "\n\n").trim();
async function runPdftotext(path) {
  if (!whichSync("pdftotext")) return void 0;
  return new Promise((done, fail) => {
    const child = spawn("pdftotext", ["-enc", "UTF-8", "-layout", path, "-"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", () => done(void 0));
    child.once("close", (code) => code === 0 ? done(Buffer.concat(out).toString("utf8")) : fail(new Error(`pdftotext failed on ${basename(path)}: ${Buffer.concat(err).toString("utf8").trim() || `exit ${code}`}`)));
  });
}
async function unpdfText(data) {
  let mod;
  try {
    mod = await import("unpdf");
  } catch {
    return void 0;
  }
  return (await mod.extractText(data, { mergePages: true })).text;
}
function unzipEntry(zip, wanted) {
  const minEocd = 22;
  let eocd = -1;
  for (let i = zip.length - minEocd; i >= Math.max(0, zip.length - minEocd - 65535); i--) {
    if (zip.readUInt32LE(i) === 101010256) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP archive");
  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(offset) !== 33639248) throw new Error("corrupt ZIP central directory");
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === wanted) {
      if (zip.readUInt32LE(local) !== 67324752) throw new Error("corrupt ZIP entry");
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const body = zip.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(body);
      if (method === 8) return inflateRawSync(body);
      throw new Error(`unsupported ZIP compression method ${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return void 0;
}
var decodeXml = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec))).replace(/&amp;/g, "&");
var styleOf = (paragraph) => /<w:pStyle\s+w:val="([^"]+)"/.exec(paragraph)?.[1] ?? "";
var isTitle = (paragraph) => /^(title|t[ií]?tulo)$/i.test(styleOf(paragraph));
function headingLevel(paragraph) {
  const style = styleOf(paragraph);
  if (isTitle(paragraph)) return 0;
  const styled = /^(?:heading|t[ií]?tulo|berschrift|titre)\s*([1-6])$/i.exec(style.replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ""));
  if (styled) return Number(styled[1]);
  const outline = /<w:outlineLvl\s+w:val="(\d)"/.exec(paragraph)?.[1];
  return outline !== void 0 && Number(outline) < 6 ? Number(outline) + 1 : void 0;
}
function paragraphText(paragraph) {
  let text = "";
  for (const match of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g)) {
    if (match[1] !== void 0) text += decodeXml(match[1]);
    else text += match[0].startsWith("<w:tab") ? "	" : "\n";
  }
  return text.trim();
}
function docxToMarkdown(data) {
  let xml;
  try {
    const entry = unzipEntry(data, "word/document.xml");
    if (!entry) throw new Error("word/document.xml is missing");
    xml = entry.toString("utf8");
  } catch (error) {
    throw new Error(`Not a readable .docx: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const blocks = [];
  const shift = [...body.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].some((p) => isTitle(p[0]) && paragraphText(p[0])) ? 1 : 0;
  for (const match of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const block = match[0];
    if (block.startsWith("<w:tbl>")) {
      for (const row of block.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)) {
        const cells = [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) => [...cell[0].matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((p) => paragraphText(p[0])).filter(Boolean).join(" "));
        if (cells.some(Boolean)) blocks.push(`| ${cells.join(" | ")} |`);
      }
      continue;
    }
    const text = paragraphText(block);
    if (!text) continue;
    const level = headingLevel(block);
    if (level !== void 0) blocks.push(`${"#".repeat(Math.min(6, level === 0 ? 1 : level + shift))} ${text.replace(/\s+/g, " ")}`);
    else if (/<w:numPr>/.test(block)) blocks.push(`- ${text}`);
    else blocks.push(text);
  }
  return blocks.reduce((out, block, index) => {
    if (index === 0) return block;
    const previous = blocks[index - 1];
    const tight = block.startsWith("- ") && previous.startsWith("- ") || block.startsWith("| ") && previous.startsWith("| ");
    return `${out}${tight ? "\n" : "\n\n"}${block}`;
  }, "");
}

// src/workspace/runner.ts
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join as join2 } from "path";
var EXTRACTION_CLIS = ["claude", "codex", "pi", "opencode"];
var EXTRACTION_TIMEOUT_MS = 10 * 60 * 1e3;
function pickExtractionCli(detected, requested) {
  if (requested) {
    if (!EXTRACTION_CLIS.includes(requested)) throw new Error(`--cli ${requested} cannot extract knowledge; use ${EXTRACTION_CLIS.join(", ")}`);
    return requested;
  }
  return EXTRACTION_CLIS.find((cli) => detected.includes(cli));
}
function cliRunner(cli, engineFactory, timeoutMs = EXTRACTION_TIMEOUT_MS) {
  return async (prompt) => {
    const engine = engineFactory ? engineFactory(cli) : (await import("./engine-GM3MJPFZ.js")).createEngine(cli);
    const cwd = await mkdtemp(join2(tmpdir(), "edu-create-"));
    const signal = AbortSignal.timeout(timeoutMs);
    let text = "";
    let final = "";
    try {
      for await (const event of engine.run({ cli, prompt, cwd, autonomy: "readonly", signal }, "edu-create")) {
        if (event.type === "agent.text") text += event.text;
        else if (event.type === "agent.end" || event.type === "run.end") {
          if (!event.ok) throw new Error(`${cli} ended with an error${event.summary ? `: ${event.summary.slice(0, 300)}` : ""}`);
          final = event.summary || final;
        } else if (event.type === "error") throw new Error(`${cli}: ${event.message}`);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
    const answer = final.trim() || text.trim();
    if (!answer) throw new Error(`${cli} returned no answer`);
    return answer;
  };
}

// src/workspace/scaffold.ts
import { access as access2, copyFile, mkdir, readFile as readFile2, writeFile } from "fs/promises";
import { basename as basename2, extname as extname2, join as join3 } from "path";
async function exists2(path) {
  try {
    await access2(path);
    return true;
  } catch {
    return false;
  }
}
async function writeIfMissing(path, content) {
  if (await exists2(path)) return false;
  await writeFile(path, content);
  return true;
}
async function createFolders(root, layout) {
  for (const folder of layoutFolders(layout)) await mkdir(join3(root, folder), { recursive: true });
  await mkdir(join3(root, layout.knowledge, layout.sources), { recursive: true });
}
async function copySources(paths, target) {
  await mkdir(target, { recursive: true });
  const copied = [];
  for (const path of paths) {
    const ext = extname2(path);
    const stem2 = basename2(path, ext);
    let name = basename2(path);
    for (let n = 2; await exists2(join3(target, name)); n++) name = `${stem2}-${n}${ext}`;
    await copyFile(path, join3(target, name));
    copied.push(name);
  }
  return copied;
}
async function writeObsidianConfig(root, layout) {
  const dir = join3(root, ".obsidian");
  await mkdir(dir, { recursive: true });
  const home = `${layout.start}/README.md`;
  await writeIfMissing(join3(dir, "app.json"), `${JSON.stringify({ userIgnoreFilters: [".edu/"], alwaysUpdateLinks: true, showUnsupportedFiles: true }, null, 2)}
`);
  await writeIfMissing(join3(dir, "appearance.json"), `${JSON.stringify({ baseFontSize: 16 }, null, 2)}
`);
  await writeIfMissing(join3(dir, "workspace.json"), `${JSON.stringify({
    main: { id: "edu-main", type: "split", direction: "vertical", children: [{ id: "edu-tabs", type: "tabs", children: [{ id: "edu-home", type: "leaf", state: { type: "markdown", state: { file: home, mode: "preview" } } }] }] },
    active: "edu-home",
    lastOpenFiles: [home]
  }, null, 2)}
`);
}
function readmeText(input) {
  const { name, layout } = input;
  const k = layout.knowledge;
  if (input.lang === "es") {
    return `# ${name}

Este es el espacio de trabajo de **${name}**, tu agente con Edu. ${input.summary ? `

> ${input.summary}
` : ""}
${name} ya ley\xF3 tus documentos y los convirti\xF3 en conocimiento ordenado. Todo vive en esta carpeta: \xE1brela con tu CLI y ${name} conoce tu operaci\xF3n.

## Qu\xE9 hay aqu\xED

| Carpeta | Para qu\xE9 |
|---|---|
| \`${layout.start}/\` | Esta gu\xEDa. |
| \`${k}/\` | El conocimiento (cerebro) de ${name}: \`1-canonical\` (lo establecido), \`2-episodic\` (lo que pas\xF3), \`3-transitive\` (decisiones, compromisos, lecciones), \`0-index\` (\xEDndice) y \`${layout.sources}/\` (copias de tus documentos originales). |
| \`${layout.deliverables}/\` | Entregables terminados. |
| \`${layout.lab}/\` | Pruebas y borradores. |
| \`${layout.projects}/\` | Proyectos en curso. |
| \`${layout.archive}/\` | Lo que ya no est\xE1 activo. |
| \`.edu/\` | Configuraci\xF3n interna de Edu (oculta). |

## Abrirlo en Obsidian

Obsidian \u2192 *Open folder as vault* \u2192 elige esta carpeta. Se abre en esta p\xE1gina. El \xEDndice est\xE1 en \`${k}/0-index/INDEX.md\`.

## Hablar con ${name}

\`\`\`sh
cd "${input.root}"
claude      # o: codex \xB7 pi \xB7 opencode
\`\`\`

Primeras preguntas:

- "\xBFQui\xE9n eres y qu\xE9 sabes de mi operaci\xF3n?"
- "Resume los clientes y los indicadores clave."
- "\xBFQu\xE9 notas quedaron propuestas y necesitan mi aprobaci\xF3n?"
- "\xBFQu\xE9 procesos conoces y cu\xE1les son sus pasos?"

## Agregar m\xE1s documentos

\`\`\`sh
cd "${input.root}"
edu create --add otro-documento.docx notas.md
\`\`\`

Acepta .md, .txt, .docx y .pdf. Los originales nunca se modifican; se copia una versi\xF3n en \`${k}/${layout.sources}/\`.
Lo que el documento dice expl\xEDcitamente queda **aceptado**; lo interpretado queda **propuesto** hasta que lo apruebes:

\`\`\`sh
edu brain proposals                # qu\xE9 espera tu aprobaci\xF3n, de d\xF3nde viene y por qu\xE9
edu brain approve <id>             # o: --all \xB7 rechazar: --reject <id>
\`\`\`
${input.sources.length ? `
Fuentes iniciales: ${input.sources.map((s) => `\`${s}\``).join(", ")}.
` : ""}`;
  }
  return `# ${name}

This is the workspace of **${name}**, your agent powered by Edu. ${input.summary ? `

> ${input.summary}
` : ""}
${name} has read your documents and turned them into organized knowledge. Everything lives in this folder: open it with your CLI and ${name} knows your operation.

## What is here

| Folder | Purpose |
|---|---|
| \`${layout.start}/\` | This guide. |
| \`${k}/\` | ${name}'s knowledge (brain): \`1-canonical\` (established truth), \`2-episodic\` (what happened), \`3-transitive\` (decisions, commitments, lessons), \`0-index\` (index) and \`${layout.sources}/\` (copies of your original documents). |
| \`${layout.deliverables}/\` | Finished deliverables. |
| \`${layout.lab}/\` | Experiments and drafts. |
| \`${layout.projects}/\` | Ongoing projects. |
| \`${layout.archive}/\` | No longer active. |
| \`.edu/\` | Edu's internal configuration (hidden). |

## Open it in Obsidian

Obsidian \u2192 *Open folder as vault* \u2192 pick this folder. It opens on this page. The index is \`${k}/0-index/INDEX.md\`.

## Talk to ${name}

\`\`\`sh
cd "${input.root}"
claude      # or: codex \xB7 pi \xB7 opencode
\`\`\`

First questions:

- "Who are you and what do you know about my operation?"
- "Summarize the clients and the key metrics."
- "Which notes are proposed and need my approval?"
- "Which processes do you know, and what are their steps?"

## Add more documents

\`\`\`sh
cd "${input.root}"
edu create --add another-document.docx notes.md
\`\`\`

Accepts .md, .txt, .docx and .pdf. Originals are never modified; a copy goes to \`${k}/${layout.sources}/\`.
What a document states explicitly is **accepted**; interpretations stay **proposed** until you approve them:

\`\`\`sh
edu brain proposals                # what waits for your approval, where it came from and why
edu brain approve <id>             # or: --all \xB7 reject: --reject <id>
\`\`\`
${input.sources.length ? `
Initial sources: ${input.sources.map((s) => `\`${s}\``).join(", ")}.
` : ""}`;
}
function agentInstructions(name, lang, layout) {
  return lang === "es" ? `@.edu/EDU.md
Eres **${name}**, el agente de este espacio de trabajo, con Edu. Pres\xE9ntate como ${name}.
Tu conocimiento est\xE1 en \`${layout.knowledge}/\` (canonical \xB7 episodic \xB7 transitive) y en las herramientas MCP de Edu:
empieza con \`edu_brief\`, busca con \`edu_recall\` y \`edu_read\`, registra decisiones y lecciones con \`edu_remember\`.
Entregables en \`${layout.deliverables}/\`, pruebas en \`${layout.lab}/\`, proyectos en \`${layout.projects}/\`. No modifiques \`${layout.knowledge}/${layout.sources}/\`.` : `@.edu/EDU.md
You are **${name}**, this workspace's agent, powered by Edu. Introduce yourself as ${name}.
Your knowledge lives in \`${layout.knowledge}/\` (canonical \xB7 episodic \xB7 transitive) and behind Edu's MCP tools:
start with \`edu_brief\`, search with \`edu_recall\` and \`edu_read\`, record decisions and lessons with \`edu_remember\`.
Deliverables go to \`${layout.deliverables}/\`, experiments to \`${layout.lab}/\`, projects to \`${layout.projects}/\`. Do not modify \`${layout.knowledge}/${layout.sources}/\`.`;
}
async function writeAgentInstructions(root, body) {
  for (const file of ["AGENTS.md", "CLAUDE.md"]) {
    const path = join3(root, file);
    const current = await readFile2(path, "utf8").catch(() => "");
    const next = upsertManagedBlock(current, body);
    if (next !== current) await writeFile(path, next);
  }
}

// src/workspace/create.ts
async function readDocuments(paths, deps) {
  if (!paths.length) throw new Error("Pass at least one document (.md, .txt, .docx or .pdf)");
  for (const path of paths) {
    documentFormat(path);
    if (!(await stat(path).catch(() => void 0))?.isFile()) throw new Error(`Document not found: ${path}`);
  }
  const docs = [];
  for (const path of paths) {
    const doc = await readDocument(path, deps.readers);
    deps.progress?.({ type: "read", name: doc.name, chars: doc.text.length });
    docs.push(doc);
  }
  return docs;
}
async function extractKnowledge(docs, req, deps) {
  const deterministic = () => extractDeterministic(docs, req.agentName);
  if (req.noLlm) {
    deps.progress?.({ type: "extract", mode: "deterministic" });
    return { extraction: deterministic(), mode: { kind: "deterministic", reason: "no-llm" } };
  }
  const cli = pickExtractionCli(deps.detected, req.cli);
  if (!cli) {
    deps.progress?.({ type: "no-cli" });
    return { extraction: deterministic(), mode: { kind: "deterministic", reason: "no-cli" } };
  }
  deps.progress?.({ type: "extract", mode: "llm", cli });
  const run = deps.runner ?? cliRunner(cli, deps.engineFactory);
  try {
    const extraction = await extractWithLlm(docs, run, {
      agentName: req.agentName,
      lang: req.lang,
      chunkChars: deps.chunkChars,
      onChunk: (part, parts) => deps.progress?.({ type: "chunk", part, parts, cli })
    });
    return { extraction, mode: { kind: "llm", cli } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.progress?.({ type: "fallback", cli, error: message });
    return { extraction: deterministic(), mode: { kind: "deterministic", reason: "fallback", cli, error: message } };
  }
}
async function createWorkspace(opts, deps) {
  const name = opts.agentName.trim();
  if (!name) throw new Error("--name is required: the agent's name, e.g. --name Albert");
  const root = resolve(opts.parent, slugify(name));
  const entries = await readdir(root).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (entries.length && !opts.yes) throw new Error(`${root} is not empty; pass --yes to add to it, or choose another --dir or --name`);
  const docs = await readDocuments(opts.docs.map((path) => resolve(path)), deps);
  const { extraction, mode } = await extractKnowledge(docs, { ...opts, agentName: name }, deps);
  const layout = workspaceLayout(opts.lang);
  await createFolders(root, layout);
  const eduRoot = join4(root, ".edu");
  const location = { scope: "project", root: eduRoot, brainDir: join4(root, layout.knowledge) };
  const init = await initBrain({ location, templatesDir: opts.templatesDir, name, cli: mode.kind === "llm" ? mode.cli : opts.cli, lang: opts.lang, detected: deps.detected });
  const { loadConfig, saveConfig } = await import("./config-WY3ZCTO3.js");
  const configPath = join4(eduRoot, "config.json");
  const config = await loadConfig(configPath);
  const identity = { name, ...extraction.identity.role ? { role: extraction.identity.role } : {}, ...extraction.identity.tone ? { tone: extraction.identity.tone } : {}, ...extraction.identity.summary ? { summary: extraction.identity.summary } : {} };
  await saveConfig(configPath, {
    ...config,
    lang: opts.lang,
    brainDir: layout.knowledge,
    sourcesDir: `${layout.knowledge}/${layout.sources}`,
    identity: init.configCreated || !config.identity ? identity : config.identity
  });
  const sources = await copySources(docs.map((doc) => doc.path), join4(root, layout.knowledge, layout.sources));
  const brain = openBrain([location]);
  const report = await ingestExtraction(brain, eduRoot, extraction, { lang: opts.lang, origin: sources.join(", ") });
  await writeObsidianConfig(root, layout);
  await writeIfMissing(join4(root, layout.start, "README.md"), readmeText({ name, lang: opts.lang, layout, root, summary: identity.summary, sources }));
  await writeAgentInstructions(root, agentInstructions(name, opts.lang, layout));
  let registry;
  try {
    const real = await realpath(root);
    const known = (await readProjects(opts.eduHome)).projects.some((entry) => entry.root === real);
    await registerProject(opts.eduHome, root);
    registry = known ? "already" : "registered";
  } catch (error) {
    registry = error instanceof Error ? error.message : String(error);
  }
  return { root, layout, mode, report, sources, identity: { ...extraction.identity, name }, registry };
}
async function addDocuments(opts, deps) {
  const locations = await resolveBrainLocations(opts.cwd, opts.env);
  const project = locations[0];
  if (project?.scope !== "project") throw new Error("No Edu workspace here: run `edu create <docs> --name <Agent>` first, or cd into a workspace");
  const workspace = resolve(project.root, "..");
  const settings = await readWorkspaceSettings(project.root);
  const { effectiveConfig } = await import("./workspace-Z6I5S4NQ.js");
  const config = await effectiveConfig(project.root, deps.detected);
  const lang = config.lang;
  const sourcesDir = resolve(workspace, settings.sourcesDir ?? relative(workspace, join4(brainPath(project), "sources")));
  const docs = await readDocuments(opts.docs.map((path) => resolve(opts.cwd, path)), deps);
  const agentName = settings.identity?.name ?? await identityName(project.root);
  const { extraction, mode } = await extractKnowledge(docs, { agentName, lang, cli: opts.cli, noLlm: opts.noLlm }, deps);
  const sources = await copySources(docs.map((doc) => doc.path), sourcesDir);
  const brain = openBrain([project]);
  const report = await ingestExtraction(brain, project.root, extraction, { lang, origin: sources.join(", ") });
  return { root: workspace, brain: brainPath(project), mode, report, sources, sourcesDir };
}
export {
  addDocuments,
  createWorkspace,
  extractKnowledge,
  readDocuments
};
//# sourceMappingURL=create-W6WCTNWX.js.map