import { configDefaults, defineConfig } from 'vitest/config';

/** Contract tests against an installed third-party host API (Pi). They skip when it is absent. */
const CONTRACTS = ['src/adapters/pi-protocol.test.ts'];

/**
 * Files with wall-clock budgets. Their behaviour runs in `unit`; the budgets themselves
 * (`expectWithinBudget` in src/test-support/perf.ts) only assert in `perf`, which CI runs on Linux.
 */
const PERF = [
  'src/brain/brain.maintain.test.ts',
  'src/brain/credit.test.ts',
  'src/brain/search.performance.test.ts',
  'src/context/review-regressions.test.ts',
  'src/context/session-start.perf.test.ts',
  'src/experiment/process.test.ts',
  'src/experiment/run.test.ts',
  'src/vault/git.test.ts',
];

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/fixtures/**', 'src/test-support/**'],
      reporter: ['text-summary', 'json-summary'],
      // Ratchet: just under the measured baseline. Raise these when coverage grows; never lower them.
      thresholds: { lines: 91, statements: 86, functions: 88, branches: 76 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts', 'scripts/**/*.test.ts', 'templates/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...CONTRACTS],
        },
      },
      { extends: true, test: { name: 'contracts', include: CONTRACTS } },
      { extends: true, test: { name: 'perf', include: PERF, env: { EDU_PERF: '1' }, retry: 2 } },
    ],
  },
});
