import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Carrega o .env da raiz do monorepo antes dos testes.
// Testes de integracao precisam das duas URLs de banco.
config({ path: '../../.env' });

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Testes de integracao compartilham banco -- sem paralelismo
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/services/**', 'src/repositories/**'],
      thresholds: { branches: 70, functions: 70, lines: 70, statements: 70 },
    },
  },
});
