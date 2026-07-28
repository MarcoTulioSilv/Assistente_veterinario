import { PlanService } from './plan.service';
import type { RequestContext } from '@vetequine/shared-types';

const ctx = (plan: 'basic' | 'plus'): RequestContext => ({
  tenantId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
  role: 'admin',
  plan,
  traceId: 'test-trace',
});

describe('PlanService', () => {
  const service = new PlanService();

  it('permite criar proprietário abaixo do limite no plano Basic', async () => {
    await expect(service.assertOwnerLimit(ctx('basic'), 29)).resolves.toBeUndefined();
  });

  it('bloqueia criação ao atingir 30 proprietários no plano Basic', async () => {
    await expect(service.assertOwnerLimit(ctx('basic'), 30)).rejects.toThrow(
      /Plano Básico permite até 30/,
    );
  });

  it('não impõe limite de proprietários no plano Plus', async () => {
    await expect(service.assertOwnerLimit(ctx('plus'), 10_000)).resolves.toBeUndefined();
  });

  it('identifica corretamente o plano Plus', () => {
    expect(service.isPlus(ctx('plus'))).toBe(true);
    expect(service.isPlus(ctx('basic'))).toBe(false);
  });
});
