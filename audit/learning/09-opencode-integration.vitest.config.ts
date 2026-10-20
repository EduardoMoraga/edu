import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['audit/learning/09-opencode-integration.probe.test.ts'], environment: 'node', testTimeout: 15000, maxWorkers: 1, cache: false } });
