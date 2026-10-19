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

/**
 * Cobre o fluxo de Atendimento (RF-ATD-001 a 008) contra o stack real
 * (BFF -> ms-clinical -> Postgres, com MS1/MS2 pro cadastro auxiliar de
 * proprietário/propriedade/animal). Cada teste registra um tenant novo e
 * monta a cadeia proprietário -> propriedade -> animal do zero via UI,
 * igual um usuário faria, antes de criar o atendimento.
 */
test.describe('Atendimentos', () => {
  test('cria rascunho, edita, finaliza e o pop-up de exclusão bloqueia', async ({ page, request }) => {
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

    // ─── Animal (ownerId + propertyId -> status active) ────────────
    await page.goto('/animals/new');
    await page.getByLabel('Nome').fill('Trovão');
    await page.getByLabel('Proprietário').selectOption({ label: 'Maria Equestre' });
    await page.getByLabel('Propriedade').selectOption({ label: 'Haras Alvorada' });
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await page.waitForURL(/\/animals\/[0-9a-f-]{36}$/);

    // ─── Criar o atendimento (rascunho) ─────────────────────────────
    await page.goto('/appointments/new');
    await page.getByLabel('Animal', { exact: true }).selectOption({ label: 'Trovão' });
    await page.getByLabel('Tipo de atendimento').selectOption('clinico_geral');
    await page.getByLabel('Data e hora').fill('2026-10-19T10:00');
    await page.getByRole('button', { name: 'Procedimento' }).click();
    await page.getByLabel('Descrição').fill('Consulta de rotina');
    await page.getByLabel('Quantidade').fill('1');
    await page.getByLabel('Valor unitário (R$)').fill('150,00');
    await page.getByRole('button', { name: 'Adicionar item' }).click();
    await expect(page.getByText('1× Consulta de rotina')).toBeVisible();
    await page.getByLabel('Mão de obra (R$)').fill('50,00');
    await expect(page.getByText('Total previsto')).toBeVisible();
    await page.getByRole('button', { name: 'Criar atendimento' }).click();

    await page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Clínico geral' })).toBeVisible();
    await expect(page.getByText('Rascunho')).toBeVisible();
    await expect(page.getByText('1× Consulta de rotina')).toBeVisible();
    await expect(page.getByText('R$ 200,00')).toBeVisible(); // 150 + 50 mão de obra

    // ─── Aparece na lista ────────────────────────────────────────────
    await page.goto('/appointments');
    await expect(page.getByText('Clínico geral')).toBeVisible();

    // ─── Editar (só é oferecido em rascunho) ────────────────────────
    await page.getByText('Clínico geral').click();
    await page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
    await page.getByRole('link', { name: 'Editar' }).click();
    await page.waitForURL(/\/appointments\/[0-9a-f-]{36}\/edit$/);

    // Animal trancado na edição (RF-ATD-006: vínculo não muda mais).
    await expect(page.getByLabel('Animal', { exact: true })).toBeDisabled();
    await page.getByLabel('Mão de obra (R$)').fill('80,00');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();

    await page.waitForURL(/\/appointments\/[0-9a-f-]{36}$/);
    await expect(page.getByText('R$ 230,00')).toBeVisible(); // 150 + 80 mão de obra

    // ─── Finalizar (irreversível — congela orçamento, abre pendência) ──
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Não é possível desfazer');
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Finalizar atendimento' }).click();
    await expect(page.getByText('Finalizado', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Editar' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Finalizar atendimento' })).not.toBeVisible();

    // ─── Exclusão de atendimento finalizado -- pop-up bloqueante ────
    // RN-002/IAppointmentService.softDelete: avisa que a pendência será
    // cancelada e que o estoque consumido não volta, e só exclui se
    // confirmado. Aqui confirmamos pra validar que a exclusão de fato
    // acontece depois do aviso (o teste de MS6 fora do ar já é unitário).
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('FINALIZADO');
      expect(dialog.message()).toContain('CANCELADA');
      expect(dialog.message()).toContain('estoque consumido NÃO volta');
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Remover atendimento' }).click();
    await page.waitForURL('/appointments');
    await expect(page.getByText('Clínico geral')).not.toBeVisible();
  });
});
