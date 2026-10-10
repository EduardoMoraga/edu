import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docxToMarkdown, readDocument, unzipEntry } from './readers.js';
import { sampleDocx, zip } from './testing.js';

async function file(name: string, content: string | Buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'edu-read-'));
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe('document readers', () => {
  it('reads stored and deflated ZIP entries', () => {
    for (const deflate of [true, false]) {
      expect(unzipEntry(zip({ 'a.txt': 'alpha', 'b/c.xml': 'gamma' }, deflate), 'b/c.xml')?.toString()).toBe('gamma');
    }
    expect(unzipEntry(zip({ 'a.txt': 'alpha' }), 'missing')).toBeUndefined();
  });

  it('converts a .docx to Markdown with headings, lists and table rows', () => {
    const md = docxToMarkdown(sampleDocx());
    expect(md).toBe([
      '# Operación Norte', '', 'Somos el equipo de trade marketing de Norte & Cía.', '', '## Clientes', '', 'Atendemos a Lider y Jumbo.', '',
      '- Visita semanal a sala\n- Reporte de quiebres', '', '## KPIs', '', '| KPI | Meta |\n| Quiebre | < 3% |',
    ].join('\n'));
  });

  it('reads .md and .txt without modifying them, and rejects other types', async () => {
    const path = await file('notes.md', '﻿# Title\r\n\r\nBody\r\n');
    const before = await stat(path);
    const doc = await readDocument(path);
    expect(doc).toMatchObject({ name: 'notes.md', format: 'md', text: '# Title\n\nBody' });
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(path, 'utf8')).toBe('﻿# Title\r\n\r\nBody\r\n');
    await expect(readDocument(await file('sheet.xlsx', 'x'))).rejects.toThrow(/Unsupported document type/);
    await expect(readDocument(await file('broken.docx', 'not a zip'))).rejects.toThrow(/Not a readable \.docx/);
  });

  it('reads PDFs with pdftotext, then the JS fallback, and explains when neither works', async () => {
    const pdf = await file('report.pdf', '%PDF-1.4');
    expect((await readDocument(pdf, { pdftotext: async () => 'From poppler\f' })).text).toBe('From poppler');
    expect((await readDocument(pdf, { pdftotext: async () => undefined, pdfFallback: async () => 'From unpdf' })).text).toBe('From unpdf');
    await expect(readDocument(pdf, { pdftotext: async () => undefined, pdfFallback: async () => undefined })).rejects.toThrow(/install poppler/);
    await expect(readDocument(pdf, { pdftotext: async () => '  \n' })).rejects.toThrow(/scanned PDF/);
  });
});
