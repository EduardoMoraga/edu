import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['audit/learning/04-feedback.probe.test.ts'], environment: 'node', testTimeout: 30000 } });
