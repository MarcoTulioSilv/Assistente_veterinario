import { PrismaClient } from '../node_modules/.prisma/client-inventory';

const prisma = new PrismaClient();

// Cada microsserviço tem seu próprio banco (ADR-001 §5.1) — não há tabela
// Tenant aqui, só a coluna tenant_id. Em uso real esse valor vem do JWT
// emitido pelo ms-identity; pra seed local usamos um UUID fixo.
const DEMO_TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function main(): Promise<void> {
  const vacina = await prisma.product.create({
    data: {
      tenantId: DEMO_TENANT_ID,
      name: 'Vacina Tétano Equino',
      manufacturer: 'Labtest',
      batch: 'L-2026-01',
      unit: 'frasco',
      quantityInStock: 20,
      dosesPerUnit: 10,
      costPriceCents: 4500,
      markupPercent: 30,
      expiryDate: new Date('2027-03-01'),
      alertDaysBefore: 60,
      minStockQty: 5,
      category: 'vaccine',
    },
  });

  const medicamento = await prisma.product.create({
    data: {
      tenantId: DEMO_TENANT_ID,
      name: 'Flunixin Meglumine 5%',
      manufacturer: 'Ourofino',
      batch: 'OF-2025-88',
      unit: 'frasco',
      quantityInStock: 3,
      costPriceCents: 8200,
      markupPercent: 40,
      expiryDate: new Date('2026-11-15'),
      alertDaysBefore: 30,
      // minStockQty > quantityInStock de propósito: demonstra isLowStock=true
      minStockQty: 5,
      category: 'medication',
    },
  });

  const insumo = await prisma.product.create({
    data: {
      tenantId: DEMO_TENANT_ID,
      name: 'Seringa Descartável 10ml',
      manufacturer: 'BD',
      unit: 'unidade',
      quantityInStock: 200,
      costPriceCents: 150,
      markupPercent: 50,
      minStockQty: 50,
      category: 'supply',
    },
  });

  await prisma.stockMovement.create({
    data: {
      tenantId: DEMO_TENANT_ID,
      productId: vacina.id,
      type: 'in',
      quantity: 20,
      reason: 'purchase',
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      notes: 'Estoque inicial (seed)',
    },
  });

  console.warn('Seed concluído:');
  console.warn(`  Tenant (demo): ${DEMO_TENANT_ID}`);
  console.warn(`  Produtos: ${vacina.name}, ${medicamento.name} (estoque baixo), ${insumo.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
