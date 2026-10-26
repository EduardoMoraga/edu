import { appendFile, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../brain/store.js';

export type CrewArtifactKind = 'output' | 'summary';
export interface ArtifactPage { jobId: string; kind: CrewArtifactKind; offset: number; nextOffset: number | null; totalBytes: number; text: string; truncated: boolean }

const ID = /^[a-f0-9-]{36}$/i;
const MAX_PAGE_BYTES = 4096;
const MAX_PREVIEW_CHARS = 1200;
const MAX_PENDING_LINE = 8192;

/** Keep incomplete stream lines in memory so credentials split across deltas are never persisted raw. */
export class WorkerOutputFilter {
  private pending = '';
  private inPrivateKey = false;
  private droppingLongLine = false;

  push(chunk: string): string {
    let result = '';
    for (const char of chunk) {
      if (char === '\n') {
        result += this.completeLine(this.pending + '\n');
        this.pending = '';
        this.droppingLongLine = false;
      } else if (!this.droppingLongLine) {
        this.pending += char;
        if (this.pending.length > MAX_PENDING_LINE) {
          result += '[long output line withheld for privacy]\n';
          this.pending = '';
          this.droppingLongLine = true;
        }
      }
    }
    return result;
  }

  flush(): string {
    const result = this.droppingLongLine ? '' : this.completeLine(this.pending);
    this.pending = '';
    this.droppingLongLine = false;
    return result;
  }

  private completeLine(line: string): string {
    if (!line) return '';
    if (this.inPrivateKey) {
      if (/-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) this.inPrivateKey = false;
      return '';
    }
    if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) {
      this.inPrivateKey = !/-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(line);
      return '[REDACTED PRIVATE KEY]\n';
    }
    return redactWorkerOutput(line);
  }
}

export function validateArtifactJobId(id: string): string {
  if (!ID.test(id)) throw new Error('Invalid crew artifact job id');
  return id.toLowerCase();
}

/** Credential patterns are removed before either the preview or durable artifact is written. */
export function redactWorkerOutput(value: string): string {
  let text = value
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, '$1[REDACTED]')
    .replace(/(?<![A-Za-z0-9])([A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret|secret_access_key)[A-Za-z0-9_]*(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)[^\s"',;}]*/gi, '$1[REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|xox[bp]-[A-Za-z0-9-]{12,}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[REDACTED TOKEN]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:)[^\s/@]+(@)/gi, '$1[REDACTED]$2');
  for (const [name, secret] of Object.entries(process.env)) {
    if (!/(?:KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL)$/i.test(name) || !secret || secret.length < 8) continue;
    text = text.replaceAll(secret, '[REDACTED ENV VALUE]');
  }
  return text;
}

export function boundedWorkerPreview(safeText: string, jobId: string): string {
  if (safeText.length <= MAX_PREVIEW_CHARS) return safeText;
  return `${safeText.slice(0, MAX_PREVIEW_CHARS)}\n[truncated; full sanitized summary: edu_crew_artifact jobId=${jobId} kind=summary]`;
}

export function createCrewArtifacts(brainRoot: string) {
  const directory = join(brainRoot, 'crew', 'artifacts');
  const pathFor = (id: string, kind: CrewArtifactKind) => {
    if (kind !== 'output' && kind !== 'summary') throw new Error('Invalid crew artifact kind');
    return join(directory, `${validateArtifactJobId(id)}.${kind}.txt`);
  };
  return {
    async replace(id: string, kind: CrewArtifactKind, raw: string): Promise<void> {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await atomicWrite(pathFor(id, kind), redactWorkerOutput(raw));
    },
    async append(id: string, kind: CrewArtifactKind, raw: string): Promise<void> {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await appendFile(pathFor(id, kind), redactWorkerOutput(raw), { encoding: 'utf8', mode: 0o600 });
    },
    async read(id: string, kind: CrewArtifactKind, offset = 0, maxBytes = 2048): Promise<ArtifactPage> {
      const jobId = validateArtifactJobId(id);
      if (kind !== 'output' && kind !== 'summary') throw new Error('Invalid crew artifact kind');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Artifact offset must be a non-negative integer');
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PAGE_BYTES) throw new Error(`Artifact maxBytes must be between 1 and ${MAX_PAGE_BYTES}`);
      const handle = await open(pathFor(jobId, kind), 'r');
      try {
        const totalBytes = (await handle.stat()).size;
        if (offset > totalBytes) throw new Error('Artifact offset exceeds file length');
        if (offset > 0 && offset < totalBytes) {
          const first = Buffer.alloc(1);
          await handle.read(first, 0, 1, offset);
          if ((first[0]! & 0xc0) === 0x80) throw new Error('Artifact offset is inside a UTF-8 character');
        }
        // A page begins and ends at UTF-8 character boundaries. Read a little extra
        // and stop before a partial character, so nextOffset is always reusable.
        const bytes = Buffer.alloc(Math.min(maxBytes + 4, totalBytes - offset));
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
        let end = Math.min(maxBytes, bytesRead);
        if (offset + end < totalBytes) {
          while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
          if (end === 0) throw new Error('Artifact page size is too small for a UTF-8 character');
        }
        const nextOffset = offset + end < totalBytes ? offset + end : null;
        return { jobId, kind, offset, nextOffset, totalBytes, text: bytes.subarray(0, end).toString('utf8'), truncated: nextOffset !== null };
      } finally { await handle.close(); }
    },
  };
}
