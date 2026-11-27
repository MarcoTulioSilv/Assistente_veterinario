/**
 * FKs compostas por tenant (auditoria 06/11/2026, item 3).
 *
 * O Postgres confere FK sem RLS: antes desta migration, uma linha da
 * clínica A podia apontar para o atendimento ou o tipo de exame da clínica
 * B, desde que o UUID existisse. Com (tenant_id, x_id) → (tenant_id, id), o
 * próprio banco recusa — mesmo que um service esqueça de conferir.
 *
 * Roda com a conexão do runtime (quironequine_app), como em produção.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenant } from '../src/prisma';
import { admin, purgeTenants } from './admin-db';

const TENANT_A = 'c5000000-0000-0000-0000-000000000000';
const TENANT_B = 'c6000000-0000-0000-0000-000000000000';

let appointmentOfB: string;
let examTypeOfB: string;

beforeAll(async () => {
  await prisma.$connect();
  const appointment = await admin.appointment.create({
    data: {
      tenantId: TENANT_B,
      ownerId: randomUUID(),
      propertyId: randomUUID(),
      veterinarianId: randomUUID(),
      title: 'Atendimento da clínica B',
      type: 'clinico_geral',
      performedAt: new Date(),
    },
  });
  appointmentOfB = appointment.id;
  const examType = await admin.examType.create({ data: { tenantId: TENANT_B, name: 'AIE', protocolFields: [] } });
  examTypeOfB = examType.id;
});

afterAll(async () => {
  await purgeTenants(TENANT_A, TENANT_B); // conexão de migração: a app não tem DELETE (M-06)
  await admin.$disconnect();
  await prisma.$disconnect();
});

describe('FK composta: referência a outra clínica é recusada pelo banco', () => {
  it('item de atendimento da clínica A apontando para o atendimento da clínica B', async () => {
    await expect(
      withTenant(TENANT_A, (tx) =>
        tx.appointmentItem.create({
          data: {
            tenantId: TENANT_A,
            appointmentId: appointmentOfB,
            productId: randomUUID(),
            description: 'Invasor',
            quantity: 1,
            unitPriceCents: 100,
            totalCents: 100,
          },
        }),
      ),
    ).rejects.toThrow(/foreign key|Foreign key/);
  });

  it('pedido de exame da clínica A usando o tipo de exame da clínica B (o id vem do cliente)', async () => {
    await expect(
      withTenant(TENANT_A, (tx) =>
        tx.examRequest.create({
          data: {
            tenantId: TENANT_A,
            ownerId: randomUUID(),
            propertyId: randomUUID(),
            veterinarianId: randomUUID(),
            examTypeId: examTypeOfB,
            examTypeName: 'AIE',
          },
        }),
      ),
    ).rejects.toThrow(/foreign key|Foreign key/);
  });

  it('a mesma gravação dentro da própria clínica passa', async () => {
    const own = await admin.appointment.create({
      data: {
        tenantId: TENANT_A,
        ownerId: randomUUID(),
        propertyId: randomUUID(),
        veterinarianId: randomUUID(),
        title: 'Atendimento da clínica A',
        type: 'clinico_geral',
        performedAt: new Date(),
      },
    });

    await expect(
      withTenant(TENANT_A, (tx) =>
        tx.appointmentItem.create({
          data: {
            tenantId: TENANT_A,
            appointmentId: own.id,
            productId: randomUUID(),
            description: 'Vacina',
            quantity: 1,
            unitPriceCents: 100,
            totalCents: 100,
          },
        }),
      ),
    ).resolves.toMatchObject({ appointmentId: own.id });
  });
});
