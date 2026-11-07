import { test, expect, type APIRequestContext } from '@playwright/test';
import { loginAs } from './helpers/auth';

const BFF_URL = process.env['PWA_E2E_BFF_URL'] ?? 'http://localhost:3000/api/v1';

/**
 * loginAs() (ver helpers/auth.ts) injeta um JWT com tenantId ALEATÓRIO —
 * funciona pro MS2 (sem FK pra tenant), mas o MS1 tem
 * `owners_tenant_id_fkey`/`properties_tenant_id_fkey` de verdade: criar
 * proprietário/propriedade/animal nesta suíte exige um tenant que realmente
 * existe. Registra um tenant de ponta a ponta via POST /tenants (rota
 * pública) antes do login, e reaproveita o tenantId/userId reais dele.
 */
async function registerTenant(request: APIRequestContext): Promise<{ tenantId: string; userId: string }> {
  const unique = Date.now().toString().slice(-9);
  const res = await request.post(`${BFF_URL}/tenants`, {
    data: {
      fullName: 'Veterinário E2E',
      crmv: `E2E-${unique}`,
      crmvState: 'GO',
      cpfCnpj: `${unique.slice(0, 3)}.${unique.slice(3, 6)}.${unique.slice(6, 9)}-00`,
      phone: '(64) 90000-0000',
      email: `e2e-${unique}@quironequine.com.br`,
      password: 'senha12345',
    },
  });
  if (!res.ok()) {
    throw new Error(`Falha ao registrar tenant de teste: ${res.status()} ${await res.text()}`);
  }
  const profile = (await res.json()) as { tenantId: string; veterinarian: { userId: string } };
  return { tenantId: profile.tenantId, userId: profile.veterinarian.userId };
}

/** "2026-10-19T10:00" -> "19/10/2026" (mesmo formato do default de título). */
function toBrDate(datetimeLocal: string): string {
  const [date] = datetimeLocal.split('T');
  const [year, month, day] = date!.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Cobre o fluxo de Orçamento/Atendimento (RF-ATD-001 a 008, contrato pós
 * reunião de 20/10 e 2026-11-03: vários animais, filtro por propriedade,
 * procedimento como descrição solta, nome padrão com propriedade) contra o
 * stack real (BFF -> ms-clinical/ms-inventory -> Postgres, com MS1 pro
 * cadastro auxiliar de proprietário/propriedade/animal/produto). Cada teste
 * registra um tenant novo e monta a cadeia do zero via UI.
 */
test.describe('Atendimentos', () => {
  test('cria orçamento com 2 animais, edita, finaliza e o pop-up de exclusão bloqueia', async ({ page, request }) => {
    const { tenantId, userId } = await registerTenant(request);
    await loginAs(page, { tenantId, userId });

    // ─── Proprietário (mínimo: fica pendente, não impede o resto) ──
    await page.goto('/owners/new');
    await page.getByLabel('Nome completo').fill('Maria Equestre');
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await page.waitForURL(/\/owners\/[0-9a-f-]{36}$/);

    // ─── Propriedade (vinculada ao proprietário) ───────────────────
    await page.goto('/properties/new');
    await page.getByLabel('Nome da propriedade').fill('Haras Alvorada');
    await page.getByLabel('Endereço').fill('Estrada Rural, km 5');
    await page.getByLabel('Cidade').fill('Pirenópolis');
    await page.getByLabel('Estado').selectOption('GO');
    await page.getByLabel('Maria Equestre').check();
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await page.waitForURL(/\/properties\/[0-9a-f-]{36}$/);

    // ─── Dois animais na mesma propriedade (RF-ATD: vários animais) ──
    for (const name of ['Trovão', 'Relâmpago']) {
      await page.goto('/animals/new');
      await page.getByLabel('Nome').fill(name);
      await page.getByLabel('Proprietário').selectOption({ label: 'Maria Equestre' });
      await page.getByLabel('Propriedade', { exact: true }).selectOption({ label: 'Haras Alvorada' });
      await page.getByRole('button', { name: 'Cadastrar' }).click();
      await page.waitForURL(/\/animals\/[0-9a-f-]{36}$/);
    }

    // ─── Produto do estoque (itens do orçamento só aceitam produto) ──
    await page.goto('/inventory/new');
    await page.getByLabel('Nome').fill('Soro Fisiológico 500ml');
    await page.getByLabel('Categoria').selectOption('supply');
    await page.getByLabel('Unidade', { exact: true }).selectOption('unidade');
    await page.getByLabel('Estoque inicial').fill('10');
    await page.getByLabel('Valor de custo (R$)').fill('10,00');
    await page.getByLabel('Estoque mínimo').fill('2');
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await page.waitForURL(/\/inventory\/[0-9a-f-]{36}$/);

    // ─── Criar o orçamento com os 2 animais ──────────────────────────
    const performedAt = '2026-10-19T10:00';
    await page.goto('/appointments/new');
    await page.getByLabel('Propriedade', { exact: true }).selectOption({ label: 'Haras Alvorada' });
    await page.getByLabel('Trovão').check();
    await page.getByLabel('Relâmpago').check();
    await page.getByLabel('Tipo de atendimento').selectOption('clinico_geral');
    await page.getByLabel('Data e hora').fill(performedAt);

    // Nome padrão: "DD/MM/AAAA - Especialidade - Propriedade" (editável).
    await expect(page.getByLabel('Nome do orçamento')).toHaveValue(
      `${toBrDate(performedAt)} - Clínico geral - Haras Alvorada`,
    );

    // Item do orçamento (só produto do estoque agora).
    await page.getByLabel('Produto').selectOption({ label: 'Soro Fisiológico 500ml' });
    await page.getByLabel('Quantidade').fill('2');
    await page.getByRole('button', { name: 'Adicionar item' }).click();
    await expect(page.getByText('2× Soro Fisiológico 500ml')).toBeVisible();

    // Procedimento virou campo de descrição solto (não é mais item).
    await page.getByLabel('Procedimento realizado').fill('Consulta de rotina');
    await page.getByLabel('Mão de obra (R$)').fill('50,00');
    await expect(page.getByText('Total previsto')).toBeVisible();
    await page.getByRole('button', { name: 'Criar orçamento' }).click();

    await page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: `${toBrDate(performedAt)} - Clínico geral - Haras Alvorada` })).toBeVisible();
    await expect(page.getByText('Rascunho')).toBeVisible();
    await expect(page.getByText('Trovão')).toBeVisible();
    await expect(page.getByText('Relâmpago')).toBeVisible();
    await expect(page.getByText('Consulta de rotina')).toBeVisible();

    // ─── Aparece na lista, aba "Em aberto" (filtro de status) ───────
    await page.goto('/appointments');
    await expect(page.getByText('2 animais')).toBeVisible();
    await page.getByRole('button', { name: 'Finalizados' }).click();
    await expect(page.getByText('2 animais')).not.toBeVisible();
    await page.getByRole('button', { name: 'Em aberto' }).click();
    await expect(page.getByText('2 animais')).toBeVisible();

    // ─── Editar (só é oferecido em rascunho; animais continuam trocáveis) ──
    await page.getByText('2 animais').click();
    await page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
    await page.getByRole('link', { name: 'Editar' }).click();
    await page.waitForURL(/\/appointments\/[0-9a-f-]{36}\/edit$/);

    await expect(page.getByLabel('Trovão')).toBeChecked();
    await expect(page.getByLabel('Relâmpago')).toBeChecked();
    await page.getByLabel('Mão de obra (R$)').fill('80,00');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();

    await page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
    // 2× soro (20,00) + mão de obra 80,00 = 100,00.
    await expect(page.getByText('R$ 100,00').first()).toBeVisible();

    // ─── Finalizar (irreversível — congela orçamento, abre pendência) ──
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Não é possível desfazer');
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Finalizar atendimento' }).click();
    await expect(page.getByText('Finalizado', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Editar' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Finalizar atendimento' })).not.toBeVisible();

    // ─── Exclusão de orçamento finalizado -- pop-up bloqueante ──────
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('FINALIZADO');
      expect(dialog.message()).toContain('CANCELADA');
      expect(dialog.message()).toContain('estoque consumido NÃO volta');
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Remover atendimento' }).click();
    await page.waitForURL('/appointments');
  });
});
