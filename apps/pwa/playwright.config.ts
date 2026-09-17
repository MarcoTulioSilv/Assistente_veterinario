import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

// JWT_SECRET (pra e2e/helpers/auth.ts injetar sessão) vem do .env da raiz --
// mesmo padrão do apps/ms-identity/vitest.config.ts.
config({ path: '../../.env' });

/**
 * Primeira config de E2E do projeto (script test:e2e já existia, nunca
 * configurado). Não sobe o stack sozinho via webServer -- o PWA depende
 * de BFF + ms-identity + ms-inventory + Postgres/Redis rodando junto
 * (ver README "Início rápido" / npm run dev), orquestrar isso tudo daqui
 * seria redundante. Os testes assumem o stack já no ar em localhost:3100.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // suíte pequena e sequencial por enquanto -- evita corrida em dados compartilhados do tenant
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env['PWA_E2E_BASE_URL'] ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
