import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
  },
});
