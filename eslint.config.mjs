// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * ESLint 9+ Flat Config
 *
 * Substitui o .eslintrc.json (ESLint 8, EOL).
 * O sistema antigo arrastava @humanwhocodes/config-array e @eslint/eslintrc,
 * que dependiam de minimatch -> brace-expansion (vulnerável).
 */
export default tseslint.config(
  // ─── Ignorados globalmente ──────────────────────────────────
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/prisma/migrations/**',
    ],
  },

  // ─── Base ───────────────────────────────────────────────────
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // ─── Regras do projeto (Plano de Trabalho §8) ───────────────
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: {
      // Proibido `any` implícito
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Proibido console.log em produção — usar o logger Pino
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // ─── Testes: relaxa algumas regras ──────────────────────────
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },

  // ─── Seeds e scripts: permite console ───────────────────────
  {
    files: ['**/prisma/seed.ts', '**/scripts/**'],
    rules: { 'no-console': 'off' },
  },

  // Desativa regras que conflitam com Prettier — sempre por último
  prettier,
);
