// Lint finds bugs, not style: promise handling (type-aware) plus a small set of core correctness rules.
// Formatting and naming are left to the code's own conventions.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'plugins/**', 'templates/**', 'node_modules/**', 'coverage/**', '**/fixtures/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.eslint.json', tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Promises: a dropped or misplaced promise loses errors and ordering.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // A promise returned (not awaited) inside try skips its catch and finally ordering.
      '@typescript-eslint/return-await': ['error', 'error-handling-correctness-only'],
      'no-async-promise-executor': 'error',
      // Type-aware correctness.
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      // Core correctness.
      'no-compare-neg-zero': 'error',
      'no-cond-assign': 'error',
      'no-constant-binary-expression': 'error',
      'no-constant-condition': 'error',
      'no-dupe-else-if': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty-character-class': 'error',
      'no-fallthrough': 'error',
      'no-invalid-regexp': 'error',
      'no-irregular-whitespace': ['error', { skipStrings: false, skipComments: false, skipRegExps: false, skipTemplates: false }],
      'no-loss-of-precision': 'error',
      'no-misleading-character-class': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-sparse-arrays': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-useless-backreference': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
);
