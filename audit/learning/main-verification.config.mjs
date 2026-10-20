// Independent rerun by the coordinating agent. One diagnostic test intentionally fails.
export default {
  cacheDir: '/tmp/edu-learning-main-vitest-cache',
  test: {
    include: [
      'audit/learning/01-capture.probe.test.ts',
      'audit/learning/02-retrieval.probe.test.ts',
      'audit/learning/03-autonomy.probe.test.ts',
      'audit/learning/04-feedback.probe.test.ts',
      'audit/learning/06-probe.test.ts',
      'audit/learning/08-longitudinal.test.ts',
      'audit/learning/09-opencode-integration.probe.test.ts',
      'audit/learning/10-probes.test.ts',
    ],
    environment: 'node',
    testTimeout: 30000,
  },
};
