import { mkdtempSync } from 'node:fs';
export default {
  cacheDir: mkdtempSync('/tmp/02-retrieval-vite-'),
  test: { include: ['audit/learning/02-retrieval.probe.test.ts'], environment: 'node', testTimeout: 30000, cache: false },
};
