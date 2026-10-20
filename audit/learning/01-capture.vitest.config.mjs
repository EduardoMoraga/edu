import { mkdtempSync } from 'node:fs';
export default {
  cacheDir: mkdtempSync('/tmp/01-capture-vitest-'),
  test: { include: ['audit/learning/01-capture.probe.test.ts'], environment: 'node', testTimeout: 15000 },
};
