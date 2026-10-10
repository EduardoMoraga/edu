/**
 * Document readers for `edu create`: .md, .txt, .docx and .pdf to Markdown-ish text. Sources are only
 * read, never modified.
 *
 * .docx: a .docx is a ZIP with `word/document.xml`. Edu reads the ZIP central directory and inflates
 * that one entry with node:zlib (no dependency), keeping headings (`#`), list items and table rows,
 * which is what the heading splitter and the LLM need. mammoth would add eight transitive packages
 * for HTML conversion Edu does not use.
 * .pdf: `pdftotext` (poppler) when it is on PATH, else the `unpdf` package (pure JS, no deps).
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { whichSync } from '../platform/index.js';

export type DocumentFormat = 'md' | 'txt' | 'docx' | 'pdf';
export interface SourceDocument { path: string; name: string; format: DocumentFormat; text: string }

export const SUPPORTED_EXTENSIONS: Record<string, DocumentFormat> = { '.md': 'md', '.markdown': 'md', '.txt': 'txt', '.docx': 'docx', '.pdf': 'pdf' };

export interface ReaderDeps {
  /** Runs `pdftotext`; returns undefined when it is not installed. Injectable for tests. */
  pdftotext?: (path: string) => Promise<string | undefined>;
  /** JS fallback for PDFs; returns undefined when unavailable. */
  pdfFallback?: (data: Uint8Array) => Promise<string | undefined>;
}

export function documentFormat(path: string): DocumentFormat {
  const format = SUPPORTED_EXTENSIONS[extname(path).toLowerCase()];
  if (!format) throw new Error(`Unsupported document type: ${basename(path)} (use .md, .txt, .docx or .pdf)`);
  return format;
}

export async function readDocument(path: string, deps: ReaderDeps = {}): Promise<SourceDocument> {
  const format = documentFormat(path);
  const name = basename(path);
  if (format === 'md' || format === 'txt') return { path, name, format, text: normalize(await readFile(path, 'utf8')) };
  const data = await readFile(path);
  if (format === 'docx') return { path, name, format, text: normalize(docxToMarkdown(data)) };
  const text = await (deps.pdftotext ?? runPdftotext)(path)
    ?? await (deps.pdfFallback ?? unpdfText)(new Uint8Array(data));
  if (text === undefined) throw new Error(`Cannot read ${name}: install poppler (pdftotext) or reinstall Edu so its PDF reader (unpdf) is present`);
  if (!text.trim()) throw new Error(`No text found in ${name}: it may be a scanned PDF; export it as text or .docx first`);
  return { path, name, format, text: normalize(text) };
}

const normalize = (text: string) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\f/g, '\n\n').trim();

async function runPdftotext(path: string): Promise<string | undefined> {
  if (!whichSync('pdftotext')) return undefined;
  return new Promise((done, fail) => {
    const child = spawn('pdftotext', ['-enc', 'UTF-8', '-layout', path, '-'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.once('error', () => done(undefined));
    child.once('close', code => code === 0 ? done(Buffer.concat(out).toString('utf8'))
      : fail(new Error(`pdftotext failed on ${basename(path)}: ${Buffer.concat(err).toString('utf8').trim() || `exit ${code}`}`)));
  });
}

async function unpdfText(data: Uint8Array): Promise<string | undefined> {
  let mod: { extractText(data: Uint8Array, opts: { mergePages: true }): Promise<{ text: string }> };
  try { mod = await import('unpdf') as unknown as typeof mod; }
  catch { return undefined; }
  return (await mod.extractText(data, { mergePages: true })).text;
}

// ─── .docx ────────────────────────────────────────────────────────────────────

/** Reads one entry from a ZIP archive through its central directory (stored or deflated). */
export function unzipEntry(zip: Buffer, wanted: string): Buffer | undefined {
  const minEocd = 22;
  let eocd = -1;
  for (let i = zip.length - minEocd; i >= Math.max(0, zip.length - minEocd - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive');
  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === wanted) {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('corrupt ZIP entry');
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const body = zip.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(body);
      if (method === 8) return inflateRawSync(body);
      throw new Error(`unsupported ZIP compression method ${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

const decodeXml = (text: string) => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
  .replace(/&amp;/g, '&');

const styleOf = (paragraph: string) => /<w:pStyle\s+w:val="([^"]+)"/.exec(paragraph)?.[1] ?? '';
const isTitle = (paragraph: string) => /^(title|t[ií]?tulo)$/i.test(styleOf(paragraph));

/** Heading level from a paragraph's style (Heading1, Título 1 / Ttulo1) or outline level; 0 for Title. */
function headingLevel(paragraph: string): number | undefined {
  const style = styleOf(paragraph);
  if (isTitle(paragraph)) return 0;
  const styled = /^(?:heading|t[ií]?tulo|berschrift|titre)\s*([1-6])$/i.exec(style.replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ''));
  if (styled) return Number(styled[1]);
  const outline = /<w:outlineLvl\s+w:val="(\d)"/.exec(paragraph)?.[1];
  return outline !== undefined && Number(outline) < 6 ? Number(outline) + 1 : undefined;
}

function paragraphText(paragraph: string): string {
  let text = '';
  for (const match of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g)) {
    if (match[1] !== undefined) text += decodeXml(match[1]);
    else text += match[0].startsWith('<w:tab') ? '\t' : '\n';
  }
  return text.trim();
}

/** Converts `word/document.xml` to Markdown: headings, list items, table rows and paragraphs. */
export function docxToMarkdown(data: Buffer): string {
  let xml: string;
  try {
    const entry = unzipEntry(data, 'word/document.xml');
    if (!entry) throw new Error('word/document.xml is missing');
    xml = entry.toString('utf8');
  } catch (error) {
    throw new Error(`Not a readable .docx: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const blocks: string[] = [];
  // A document Title becomes `#` and pushes Heading 1 down to `##`, so sections split under it.
  const shift = [...body.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].some(p => isTitle(p[0]) && paragraphText(p[0])) ? 1 : 0;
  for (const match of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const block = match[0];
    if (block.startsWith('<w:tbl>')) {
      for (const row of block.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)) {
        const cells = [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(cell =>
          [...cell[0].matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map(p => paragraphText(p[0])).filter(Boolean).join(' '));
        if (cells.some(Boolean)) blocks.push(`| ${cells.join(' | ')} |`);
      }
      continue;
    }
    const text = paragraphText(block);
    if (!text) continue;
    const level = headingLevel(block);
    if (level !== undefined) blocks.push(`${'#'.repeat(Math.min(6, level === 0 ? 1 : level + shift))} ${text.replace(/\s+/g, ' ')}`);
    else if (/<w:numPr>/.test(block)) blocks.push(`- ${text}`);
    else blocks.push(text);
  }
  // Paragraphs are separated by blank lines; consecutive list items and table rows stay together.
  return blocks.reduce((out, block, index) => {
    if (index === 0) return block;
    const previous = blocks[index - 1]!;
    const tight = (block.startsWith('- ') && previous.startsWith('- ')) || (block.startsWith('| ') && previous.startsWith('| '));
    return `${out}${tight ? '\n' : '\n\n'}${block}`;
  }, '');
}
