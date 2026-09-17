import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

/**
 * Cobre o fluxo de Estoque (RF-EST-001 a 007) contra o stack real
 * (BFF -> ms-inventory -> Postgres). Cada teste usa um tenant novo
 * (ver helpers/auth.ts) -- não depende de dados pré-existentes nem
 * limpa nada depois, RLS isola tudo.
 */
test.describe('Estoque', () => {
  test('cria produto, lança movimentação (estoque atualiza na tela) e remove', async ({ page }) => {
    await loginAs(page);

    // ─── Criar ────────────────────────────────────────────────────
    await page.goto('/inventory/new');
    await page.getByLabel('Nome').fill('Soro Fisiológico 500ml');
    await page.getByLabel('Categoria').selectOption('supply');
    await page.getByLabel('Unidade', { exact: true }).selectOption('unidade');
    await page.getByLabel('Estoque inicial').fill('5');
    await page.getByLabel('Valor de custo (R$)').fill('10,00');
    await page.getByLabel('Estoque mínimo').fill('3');
    await page.getByRole('button', { name: 'Cadastrar' }).click();

    await page.waitForURL(/\/inventory\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Soro Fisiológico 500ml' })).toBeVisible();
    await expect(page.getByText('5 unidade em estoque')).toBeVisible();

    // ─── Aparece na lista ───────────────────────────────────────────
    await page.goto('/inventory');
    await expect(page.getByText('Soro Fisiológico 500ml')).toBeVisible();

    // ─── Lançar movimentação e conferir que a tela recarrega o estoque ──
    // Regressão: antes o header da página ficava com o número antigo até
    // recarregar a página inteira -- MovementLedger não avisava o pai.
    await page.getByText('Soro Fisiológico 500ml').click();
    await page.waitForURL(/\/inventory\/[0-9a-f-]{36}$/);

    await page.getByLabel('Tipo').selectOption('in');
    await page.getByLabel('Quantidade (unidade)').fill('2');
    await page.getByLabel('Motivo').selectOption('purchase');
    await page.getByRole('button', { name: 'Registrar movimentação' }).click();

    await expect(page.getByText('7 unidade em estoque')).toBeVisible();
    await expect(page.getByRole('list').getByText('Compra', { exact: true })).toBeVisible();

    // ─── Remover ────────────────────────────────────────────────────
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Remover produto' }).click();

    await page.waitForURL('/inventory');
    await expect(page.getByText('Soro Fisiológico 500ml')).not.toBeVisible();
  });

  test('badge de baixo estoque aparece e some conforme o estoque muda', async ({ page }) => {
    await loginAs(page);

    await page.goto('/inventory/new');
    await page.getByLabel('Nome').fill('Vacina Tétano Equino');
    await page.getByLabel('Categoria').selectOption('vaccine');
    await page.getByLabel('Unidade', { exact: true }).selectOption('ampola');
    await page.getByLabel('Estoque inicial').fill('2');
    await page.getByLabel('Valor de custo (R$)').fill('50,00');
    await page.getByLabel('Estoque mínimo').fill('5');
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await page.waitForURL(/\/inventory\/[0-9a-f-]{36}$/);

    await expect(page.getByText('Baixo estoque', { exact: true })).toBeVisible();

    await page.getByLabel('Tipo').selectOption('in');
    await page.getByLabel('Quantidade (ampola)').fill('10');
    await page.getByLabel('Motivo').selectOption('purchase');
    await page.getByRole('button', { name: 'Registrar movimentação' }).click();

    await expect(page.getByText('12 ampola em estoque')).toBeVisible();
    await expect(page.getByText('Baixo estoque', { exact: true })).not.toBeVisible();
  });
});
