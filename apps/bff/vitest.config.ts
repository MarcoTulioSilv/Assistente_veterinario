import { defineConfig } from 'vitest/config';

// BFF ainda nao tem testes (so index.ts, sobe o server no import -- precisa
// refatorar pra exportar createApp() antes de testar, como os outros servicos).
// passWithNoTests evita falha de CI por "nenhum arquivo de teste encontrado".
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
  },
});
