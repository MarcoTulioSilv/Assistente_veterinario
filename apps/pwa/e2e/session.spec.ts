import { test, expect, type APIRequestContext } from '@playwright/test';

const BFF_URL = process.env['PWA_E2E_BFF_URL'] ?? 'http://localhost:3000/api/v1';

/**
 * Mesmo registro de tenant de ponta a ponta usado em appointments.spec.ts --
 * aqui precisa ser um login de verdade (não o JWT injetado de loginAs()),
 * porque o que está sob teste é a renovação real contra o AuthService
 * (auditoria de 06/11/2026, pedidos-para-joao.md).
 */
async function registerTenant(
  request: APIRequestContext,
): Promise<{ email: string; password: string }> {
  const unique = Date.now().toString().slice(-9);
  const email = `e2e-session-${unique}@quironequine.com.br`;
  const password = 'senha12345';
  const res = await request.post(`${BFF_URL}/tenants`, {
    data: {
      fullName: 'Veterinário E2E Sessão',
      crmv: `E2E-${unique}`,
      crmvState: 'GO',
      cpfCnpj: `${unique.slice(0, 3)}.${unique.slice(3, 6)}.${unique.slice(6, 9)}-00`,
      phone: '(64) 90000-0000',
      email,
      password,
    },
  });
  if (!res.ok()) {
    throw new Error(`Falha ao registrar tenant de teste: ${res.status()} ${await res.text()}`);
  }
  return { email, password };
}

/**
 * Cobre a renovação automática de sessão e o logout real (pedidos-para-joao.md,
 * auditoria de 06/11/2026) contra o stack real. Depende do ms-identity no ar
 * com JWT_ACCESS_EXPIRES_IN=1m (ver README dessa suíte / comando usado para
 * rodar manualmente).
 */
test.describe('Sessão', () => {
  test('renova sozinho com o access token vencido (uma chamada só) e o logout revoga o refresh token', async ({
    page,
    request,
  }) => {
    const { email, password } = await registerTenant(request);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('/dashboard');

    const refreshTokenBefore = await page.evaluate(() => sessionStorage.getItem('refreshToken'));
    const accessTokenBefore = await page.evaluate(() => sessionStorage.getItem('accessToken'));
    expect(refreshTokenBefore).toBeTruthy();

    // Espera o access token de 1 min vencer antes de navegar de novo --
    // o dashboard dispara 8 chamadas simultâneas no mount (owners/properties/
    // animals/products/tenants), todas 401 ao mesmo tempo.
    await page.waitForTimeout(65_000);

    let refreshCalls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/auth/refresh')) refreshCalls += 1;
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL('/dashboard'); // não caiu pro /login
    // Só renderiza "Olá, <nome>" quando tenants.getMe() (uma das 8 chamadas
    // simultâneas do mount) terminou com sucesso -- ou seja, depois do retry.
    await expect(page.getByRole('heading', { name: /^Olá,/ })).toBeVisible({ timeout: 10_000 });

    expect(refreshCalls).toBe(1);

    const accessTokenAfter = await page.evaluate(() => sessionStorage.getItem('accessToken'));
    const refreshTokenAfter = await page.evaluate(() => sessionStorage.getItem('refreshToken'));
    expect(accessTokenAfter).not.toBe(accessTokenBefore);
    expect(refreshTokenAfter).not.toBe(refreshTokenBefore);

    // ─── Logout de verdade: revoga a sessão no servidor ────────────────
    await page.getByRole('button', { name: 'Sair' }).click();
    await page.waitForURL('/login');

    const refreshRes = await request.post(`${BFF_URL}/auth/refresh`, {
      data: { refreshToken: refreshTokenAfter },
    });
    expect(refreshRes.status()).toBe(401);
  });
});
