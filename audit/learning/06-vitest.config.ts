import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['audit/learning/06-probe.test.ts'], environment: 'node', testTimeout: 30000 } });
