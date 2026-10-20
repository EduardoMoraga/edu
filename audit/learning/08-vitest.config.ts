import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export default defineConfig({ cacheDir: mkdtempSync(join(tmpdir(), '08-longitudinal-vite-')), test: { include: ['audit/learning/08-longitudinal.test.ts'], environment: 'node', testTimeout: 20000 } });
