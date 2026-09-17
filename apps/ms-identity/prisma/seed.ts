import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash('quironequine123', 12);

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'clinica-demo' },
    update: {},
    create: {
      name: 'Clínica Equina Demo',
      slug: 'clinica-demo',
      plan: 'plus',
      status: 'active',
      maxOwners: 30,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'demo@quironequine.com.br' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'demo@quironequine.com.br',
      passwordHash,
      role: 'admin',
      fullName: 'Veterinário Demo',
      phone: '(64) 99999-0000',
      status: 'active',
    },
  });

  await prisma.veterinarian.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: user.id,
      fullName: 'Veterinário Demo',
      crmv: 'GO-07576',
      crmvState: 'GO',
      cpfCnpj: '000.000.000-00',
      phone: '(64) 99999-0000',
      email: 'demo@quironequine.com.br',
    },
  });

  const property = await prisma.property.create({
    data: {
      tenantId: tenant.id,
      name: 'Fazenda Boa Vista',
      address: 'Rodovia GO-184, km 12',
      city: 'Jataí',
      state: 'GO',
      latitude: -17.8815,
      longitude: -51.7141,
      status: 'active',
    },
  });

  const owner = await prisma.owner.create({
    data: {
      tenantId: tenant.id,
      fullName: 'José Carlos Ribeiro',
      cpf: '111.222.333-44',
      email: 'jose@exemplo.com.br',
      phone: '(64) 98888-1111',
      city: 'Jataí',
      state: 'GO',
      status: 'active',
    },
  });

  await prisma.propertyOwner.create({
    data: {
      tenantId: tenant.id,
      propertyId: property.id,
      ownerId: owner.id,
      isPrimary: true,
    },
  });

  await prisma.animal.createMany({
    data: [
      {
        tenantId: tenant.id,
        propertyId: property.id,
        ownerId: owner.id,
        name: 'Relâmpago',
        species: 'equine',
        sex: 'male',
        breed: 'Mangalarga Marchador',
        coat: 'Castanho',
        birthDate: new Date('2018-03-15'),
        castrated: false,
        status: 'active',
      },
      {
        tenantId: tenant.id,
        propertyId: property.id,
        ownerId: owner.id,
        name: 'Estrela',
        species: 'equine',
        sex: 'female',
        breed: 'Quarto de Milha',
        coat: 'Alazã',
        birthDate: new Date('2020-07-22'),
        castrated: false,
        status: 'active',
      },
    ],
  });

  console.warn('Seed concluído:');
  console.warn(`  Tenant:  ${tenant.name} (${tenant.slug})`);
  console.warn(`  Login:   demo@quironequine.com.br / quironequine123`);
  console.warn(`  Dados:   1 propriedade, 1 proprietário, 2 animais`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
