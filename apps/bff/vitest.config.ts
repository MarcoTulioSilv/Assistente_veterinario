import { defineConfig } from 'vitest/config';

// O index.ts sobe o server no import, entao os testes cobrem modulos
// separados (rate-limit.ts). passWithNoTests fica como rede de seguranca.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
  },
});
