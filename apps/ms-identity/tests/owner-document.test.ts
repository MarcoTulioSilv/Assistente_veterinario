/**
 * Proprietário com CPF ou CNPJ, ponta a ponta no banco (role da aplicação).
 *
 * O ponto que só o banco prova: o mesmo documento escrito de dois jeitos
 * (com e sem máscara, letras minúsculas) cai no mesmo UNIQUE, porque o
 * service grava sempre o canônico — e a repetição vira 409, não 500.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { OwnerRepository } from '../src/repositories/owner.repository';
import { OwnerService } from '../src/services/owner.service';
import type { PlanService } from '../src/services/plan.service';
import { prisma as appPrisma } from '../src/prisma';
import type { RequestContext } from '@quironequine/shared-types';

const TENANT_ID = 'c9000000-0000-0000-0000-000000000000';

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_IDENTITY'] });
const plans = { assertOwnerLimit: async () => undefined } as unknown as PlanService;
const service = new OwnerService(new OwnerRepository(), plans);

const ctx: RequestContext = {
  tenantId: TENANT_ID,
  userId: 'c9000000-0000-0000-0000-000000000001',
  role: 'admin',
  plan: 'plus',
  traceId: 'test-trace',
};

describe('Proprietário: CPF ou CNPJ', () => {
  beforeAll(async () => {
    await admin.tenant.create({
      data: { id: TENANT_ID, name: 'Clinica Documento Test', slug: 'owner-document-test', plan: 'plus', status: 'active' },
    });
  });

  afterEach(async () => {
    await admin.owner.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    await admin.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
    await admin.tenant.deleteMany({ where: { id: TENANT_ID } });
    await admin.$disconnect();
    await appPrisma.$disconnect();
  });

  it('grava o CNPJ alfanumérico canônico e devolve cpfCnpj e o cpf da transição', async () => {
    const created = await service.create(ctx, { fullName: 'Haras', cpfCnpj: '12abc34501de35', phone: '(64) 90000-0000' });

    expect(created).toMatchObject({ cpfCnpj: '12.ABC.345/01DE-35', cpf: '12.ABC.345/01DE-35', status: 'active' });
  });

  it('o mesmo documento escrito de outro jeito é recusado com 409', async () => {
    await service.create(ctx, { fullName: 'Haras', cpfCnpj: '12.ABC.345/01DE-35' });

    await expect(service.create(ctx, { fullName: 'Haras de novo', cpfCnpj: '12abc34501DE35' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('a entrada pelo campo cpf antigo continua funcionando', async () => {
    const created = await service.create(ctx, { fullName: 'Maria', cpf: '529.982.247-25' });

    expect(created.cpfCnpj).toBe('529.982.247-25');
  });

  it('update para um documento que já é de outro proprietário é 409', async () => {
    await service.create(ctx, { fullName: 'Um', cpfCnpj: '529.982.247-25' });
    const other = await service.create(ctx, { fullName: 'Dois', cpfCnpj: '11.222.333/0001-81' });

    await expect(service.update(ctx, other.id, { cpfCnpj: '52998224725' })).rejects.toMatchObject({ statusCode: 409 });
  });
});
