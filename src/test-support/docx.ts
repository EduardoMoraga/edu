/** Test support for workspace readers: a minimal ZIP writer to build .docx fixtures in memory. */
import { deflateRawSync } from 'node:zlib';

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zip(entries: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content, 'utf8');
    const body = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const para = (text: string, style?: string, list = false) =>
  `<w:p>${style || list ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** A .docx with headings, a paragraph, a list and a table. */
export function sampleDocx(): Buffer {
  const body = [
    para('Operación Norte', 'Title'),
    para('Somos el equipo de trade marketing de Norte &amp; Cía.'),
    para('Clientes', 'Heading1'),
    para('Atendemos a Lider y Jumbo.'),
    para('Visita semanal a sala', undefined, true),
    para('Reporte de quiebres', undefined, true),
    para('KPIs', 'Ttulo1'),
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>KPI</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Meta</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Quiebre</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>&lt; 3%</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
  ].join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  });
}
