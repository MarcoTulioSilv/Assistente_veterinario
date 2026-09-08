import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Carrega o .env da raiz do monorepo antes dos testes.
// Testes de integracao precisam das duas URLs de banco.
config({ path: '../../.env' });

/**
 * Vitest substitui o Jest.
 * Motivo: jest -> @jest/reporters -> glob -> minimatch -> brace-expansion (CVE).
 * O Vitest roda TypeScript nativamente — sem ts-jest, sem babel-jest.
 */
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
      // alert-scheduler.ts conecta no Redis ao ser importado e ainda não
      // tem lógica própria (RN-009 fica pra fatia do AlertService) — testar
      // isso agora exigiria mockar o BullMQ inteiro por um scaffold vazio.
      exclude: ['src/services/alert-scheduler.ts'],
      // RNF-MAN-003: cobertura minima de 70% nos modulos criticos
      thresholds: { branches: 70, functions: 70, lines: 70, statements: 70 },
    },
  },
});
