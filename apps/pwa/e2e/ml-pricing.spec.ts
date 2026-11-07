import { test, expect, type APIRequestContext } from '@playwright/test';

const BFF_URL = process.env['PWA_E2E_BFF_URL'] ?? 'http://localhost:3000/api/v1';

async function registerTenant(request: APIRequestContext): Promise<{ email: string; password: string }> {
  const unique = Date.now().toString().slice(-9);
  const email = `e2e-ml-${unique}@quironequine.com.br`;
  const password = 'senha12345';
  const res = await request.post(`${BFF_URL}/tenants`, {
    data: {
      fullName: 'Veterinário ML',
      crmv: `ML-${unique}`,
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
 * Medicamento e vacina por ml (reunião 2026-11-03 / PR #37): o cadastro de
 * produto mostra o preço por ml calculado, e o item do orçamento usa a
 * quantidade em ml com esse preço quando o produto tem `pricePerMlCents`.
 */
test('preço por ml: cadastro de vacina, R$/ml no detalhe, e item do orçamento usa o preço por ml', async ({
  page,
  request,
}) => {
  const { email, password } = await registerTenant(request);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('/dashboard');

  await page.goto('/owners/new');
  await page.getByLabel('Nome completo').fill('Dono ML');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await page.waitForURL(/\/owners\/[0-9a-f-]{36}$/);

  await page.goto('/properties/new');
  await page.getByLabel('Nome da propriedade').fill('Haras ML');
  await page.getByLabel('Endereço').fill('Estrada ML, km 1');
  await page.getByLabel('Cidade').fill('Goiânia');
  await page.getByLabel('Estado').selectOption('GO');
  await page.getByLabel('Dono ML').check();
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await page.waitForURL(/\/properties\/[0-9a-f-]{36}$/);

  await page.goto('/animals/new');
  await page.getByLabel('Nome').fill('Cometa');
  await page.getByLabel('Proprietário').selectOption({ label: 'Dono ML' });
  await page.getByLabel('Propriedade', { exact: true }).selectOption({ label: 'Haras ML' });
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await page.waitForURL(/\/animals\/[0-9a-f-]{36}$/);

  // ─── Vacina: 10 ml por frasco, custo 50,00 -> venda 100,00 -> 10,00/ml ──
  await page.goto('/inventory/new');
  await page.getByLabel('Nome').fill('Influenza Equina');
  await page.getByLabel('Categoria').selectOption('vaccine');
  await page.getByLabel('Unidade', { exact: true }).selectOption('frasco');
  await page.getByLabel('Estoque inicial').fill('5');
  await page.getByLabel('Valor de custo (R$)').fill('50,00');
  await page.getByLabel('Acréscimo (%)').fill('100');
  await page.getByLabel('Estoque mínimo').fill('1');
  await page.getByLabel('ml por unidade').fill('10');
  await expect(page.getByLabel('ml aplicados por animal')).toBeVisible();
  await page.getByLabel('ml aplicados por animal').fill('2');
  await page.getByRole('button', { name: 'Cadastrar' }).click();

  await page.waitForURL(/\/inventory\/[0-9a-f-]{36}$/);
  await expect(page.getByText('R$ 10,00/ml')).toBeVisible();

  // ─── Item do orçamento: selecionar a vacina já sugere o preço por ml ──
  await page.goto('/appointments/new');
  await page.getByLabel('Propriedade', { exact: true }).selectOption({ label: 'Haras ML' });
  await page.getByLabel('Cometa').check();
  await page.getByLabel('Tipo de atendimento').selectOption('clinico_geral');
  await page.getByLabel('Data e hora').fill('2026-11-10T09:00');

  await page.getByLabel('Produto').selectOption({ label: 'Influenza Equina' });
  await expect(page.getByLabel('Quantidade (ml)')).toBeVisible();
  // Mesmo formato que o preço sugerido já tinha pra salePriceCents (não
  // preenche com zeros decimais quando o valor é redondo).
  await expect(page.getByLabel('Valor por ml (R$)')).toHaveValue('10');
  await page.getByLabel('Quantidade (ml)').fill('4');
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await expect(page.getByText('4× Influenza Equina')).toBeVisible();
  // 4 ml x R$10,00/ml = R$40,00
  await expect(page.getByText('R$ 40,00').first()).toBeVisible();
});
