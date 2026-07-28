import { defineConfig } from 'vitest/config';

/**
 * Vitest substitui o Jest.
 * Motivo: jest -> @jest/reporters -> glob -> minimatch -> brace-expansion (CVE).
 * O Vitest roda TypeScript nativamente — sem ts-jest, sem babel-jest.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/services/**', 'src/repositories/**'],
      // RNF-MAN-003: cobertura minima de 70% nos modulos criticos
      thresholds: { branches: 70, functions: 70, lines: 70, statements: 70 },
    },
  },
});
