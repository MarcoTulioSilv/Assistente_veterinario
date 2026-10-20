/**
 * Seed de homologação do M2 (Sprint 8) — dados clínicos realistas para a
 * sessão com os stakeholders: atendimentos com ficha e receita, exames em
 * todas as etapas (incluindo Mormo e AIE), vacinações individuais, múltiplas
 * e de outra pessoa, estoque consumido e pendências financeiras.
 *
 * Um seed só para os QUATRO bancos (MS1, MS2, MS3, MS6): os IDs precisam
 * bater entre os serviços (o atendimento aponta pro animal do MS1, a vacina
 * pro produto do MS2, a pendência do MS6 pro atendimento do MS3). Seeds
 * separados por serviço não conseguem garantir isso.
 *
 *   npm run seed:homologacao
 *
 * - Apaga e recria SÓ os dois tenants de homologação (IDs fixos abaixo) —
 *   pode rodar quantas vezes quiser; não toca em outros tenants.
 * - Datas relativas ao dia em que roda: o lembrete "vence hoje" e o
 *   indicador "próxima dose em breve" ficam sempre atuais na demo.
 * - Grava direto no estado final (estoque já baixado, pendências já
 *   abertas), sem depender de broker nem de serviço rodando. Por isso não
 *   gera eventos no outbox — senão o relay baixaria o estoque de novo.
 * - Valores calculados pelas MESMAS funções dos services: o seed não
 *   diverge das regras.
 *
 * Conecta com o usuário das migrations (DATABASE_URL_*, sem _APP), que
 * ignora RLS — é seed, não runtime.
 */
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient as IdentityClient } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaClient as InventoryClient } from '../apps/ms-inventory/node_modules/.prisma/client-inventory';
import { PrismaClient as ClinicalClient } from '../apps/ms-clinical/node_modules/.prisma/client-clinical';
import type { ExamType as ExamTypeRow } from '../apps/ms-clinical/node_modules/.prisma/client-clinical';
import { PrismaClient as ReportingClient } from '../apps/ms-reporting/node_modules/.prisma/client-reporting';
import { calculateTotalCents, calculateItemTotalCents } from '../apps/ms-clinical/src/services/billing';
import { calculateExamChargeCents, calculateExpectedResultAt } from '../apps/ms-clinical/src/services/exam.service';
import {
  calculateVaccinationTotalCents,
  calculateNextDoseAt,
  totalDoses,
} from '../apps/ms-clinical/src/services/vaccination.service';
import { saoPauloDay, addDays } from '../apps/ms-clinical/src/services/sao-paulo-day';
import { dosesToUnits } from '../apps/ms-inventory/src/services/deduction.service';
import { EXAM_TYPE_SUGGESTIONS } from '@quironequine/shared-types';
import type { ExamProtocolField, StockConsumptionSource } from '@quironequine/shared-types';

// ─── Tenants de homologação (fixos: o reset apaga só estes) ───────
const CLINICA = 'b0000000-0000-4000-8000-000000000001';
const VIZINHA = 'b0000000-0000-4000-8000-000000000002';
const TENANTS = [CLINICA, VIZINHA];

/** Senha dos usuários de homologação. Em staging, defina SEED_PASSWORD. */
const PASSWORD = process.env['SEED_PASSWORD'] ?? 'Homologacao@2026';

const identity = new IdentityClient({ datasourceUrl: requireEnv('DATABASE_URL_IDENTITY') });
const inventory = new InventoryClient({ datasourceUrl: requireEnv('DATABASE_URL_INVENTORY') });
const clinical = new ClinicalClient({ datasourceUrl: requireEnv('DATABASE_URL_CLINICAL') });
const reporting = new ReportingClient({ datasourceUrl: requireEnv('DATABASE_URL_REPORTING') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente — rode com: npx dotenv -e .env -- tsx scripts/seed-homologacao.ts`);
  return value;
}

// ─── Datas relativas ao dia da execução (fuso de São Paulo) ───────
const TODAY = saoPauloDay(new Date());

/** `days` dias a partir de hoje, à `hour` de São Paulo (UTC-3). */
function on(days: number, hour = 10): Date {
  return new Date(`${addDays(TODAY, days)}T${String(hour + 3).padStart(2, '0')}:00:00Z`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── 1. Reset ─────────────────────────────────────────────────────
async function reset(): Promise<void> {
  const ids = TENANTS.map((t) => `'${t}'`).join(',');
  const wipe = async (client: { $executeRawUnsafe(sql: string): Promise<number> }, tables: string[]): Promise<void> => {
    for (const table of tables) await client.$executeRawUnsafe(`DELETE FROM ${table} WHERE tenant_id IN (${ids})`);
  };

  await wipe(reporting, ['financial_records']);
  await wipe(clinical, [
    'outbox_events',
    'vaccination_animals',
    'vaccinations',
    'exam_request_items',
    'exam_request_animals',
    'exam_requests',
    'exam_types',
    'appointment_items',
    'prescriptions',
    'medical_records',
    'appointment_animals',
    'appointments',
  ]);
  await wipe(inventory, ['stock_movements', 'alert_configs', 'products']);
  await wipe(identity, [
    'audit_log',
    'animal_transfers',
    'animals',
    'property_owners',
    'owners',
    'properties',
    'veterinarians',
    'users',
  ]);
  await identity.$executeRawUnsafe(`DELETE FROM tenants WHERE id IN (${ids})`);
}

// ─── 2. MS1 — clínica, veterinários, proprietários, animais ───────
interface Vet {
  id: string;
  name: string;
}

interface Herd {
  vets: { helena: Vet; ricardo: Vet };
  owners: Record<'jose' | 'marina' | 'antonio' | 'harasSaoBento', string>;
  properties: Record<
    'boaVista' | 'santaLuzia' | 'recanto' | 'saoBento',
    { id: string; name: string; latitude: number; longitude: number; ownerKey: keyof Herd['owners'] }
  >;
  animals: Record<string, { id: string; propertyKey: keyof Herd['properties'] }>;
}

async function seedIdentity(): Promise<Herd> {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  await identity.tenant.create({
    data: { id: CLINICA, name: 'Clínica Equina Modelo', slug: 'homologacao', plan: 'plus', status: 'active', maxOwners: 30 },
  });

  const user = async (email: string, fullName: string, role: 'admin' | 'assistant', phone: string): Promise<User> =>
    identity.user.create({
      data: { tenantId: CLINICA, email, passwordHash, role, fullName, phone, status: 'active' },
    });

  const helenaUser = await user('homologacao@quironequine.com.br', 'Dra. Helena Prado', 'admin', '(64) 99901-1001');
  const ricardoUser = await user('ricardo.homologacao@quironequine.com.br', 'Dr. Ricardo Lima', 'admin', '(64) 99901-1002');
  await user('ana.homologacao@quironequine.com.br', 'Ana Souza', 'assistant', '(64) 99901-1003');

  const vet = async (
    u: { id: string; fullName: string; phone: string | null; email: string },
    crmv: string,
    cpfCnpj: string,
  ): Promise<Vet> => {
    const created = await identity.veterinarian.create({
      data: {
        tenantId: CLINICA,
        userId: u.id,
        fullName: u.fullName,
        crmv,
        crmvState: 'GO',
        cpfCnpj,
        phone: u.phone ?? '',
        email: u.email,
      },
    });
    return { id: created.id, name: u.fullName };
  };
  // CPFs fictícios (únicos por clínica).
  const helena = await vet(helenaUser, 'GO-08812', '900.000.000-01');
  const ricardo = await vet(ricardoUser, 'GO-09134', '900.000.000-02');

  const owner = async (fullName: string, cpf: string | null, city: string, phone: string): Promise<string> =>
    (
      await identity.owner.create({
        data: { tenantId: CLINICA, fullName, cpf, phone, city, state: 'GO', status: 'active' },
      })
    ).id;
  const owners = {
    jose: await owner('José Carlos Ribeiro', '111.222.333-44', 'Jataí', '(64) 98888-1111'),
    marina: await owner('Marina Alves Pereira', '222.333.444-55', 'Rio Verde', '(64) 98888-2222'),
    antonio: await owner('Antônio Ferreira Neto', '333.444.555-66', 'Mineiros', '(64) 98888-3333'),
    // Sem documento: o campo é CPF (14 caracteres) e não comporta CNPJ — lacuna
    // do cadastro de proprietário pessoa jurídica, registrada na Sprint 8.
    harasSaoBento: await owner('Haras São Bento Ltda.', null, 'Jataí', '(64) 3631-4444'),
  };

  const property = async (
    name: string,
    address: string,
    city: string,
    lat: number,
    lng: number,
    ownerKey: keyof Herd['owners'],
  ): Promise<Herd['properties']['boaVista']> => {
    const created = await identity.property.create({
      data: { tenantId: CLINICA, name, address, city, state: 'GO', latitude: lat, longitude: lng, status: 'active' },
    });
    await identity.propertyOwner.create({
      data: { tenantId: CLINICA, propertyId: created.id, ownerId: owners[ownerKey], isPrimary: true },
    });
    return { id: created.id, name, latitude: lat, longitude: lng, ownerKey };
  };
  const properties = {
    boaVista: await property('Fazenda Boa Vista', 'Rodovia GO-184, km 12', 'Jataí', -17.8815, -51.7141, 'jose'),
    santaLuzia: await property('Chácara Santa Luzia', 'Estrada da Serra, s/n', 'Rio Verde', -17.7923, -50.9192, 'marina'),
    recanto: await property('Sítio Recanto', 'Zona rural, saída para Portelândia', 'Mineiros', -17.5654, -52.5511, 'antonio'),
    saoBento: await property('Haras São Bento', 'Rodovia BR-364, km 190', 'Jataí', -17.9302, -51.6875, 'harasSaoBento'),
  };

  const horses: Array<[string, keyof Herd['properties'], 'male' | 'female', string, string, string, boolean?]> = [
    ['Relâmpago', 'boaVista', 'male', 'Mangalarga Marchador', 'Castanho', '2018-03-15'],
    ['Estrela', 'boaVista', 'female', 'Quarto de Milha', 'Alazã', '2020-07-22'],
    ['Trovão', 'boaVista', 'male', 'Mangalarga Marchador', 'Tordilho', '2016-11-02', true],
    ['Pérola', 'santaLuzia', 'female', 'Puro Sangue Árabe', 'Branca', '2019-05-10'],
    ['Faísca', 'santaLuzia', 'female', 'Campolina', 'Baia', '2021-09-30'],
    ['Bandido', 'recanto', 'male', 'Crioulo', 'Gateado', '2015-01-20', true],
    ['Princesa', 'recanto', 'female', 'Crioulo', 'Tostada', '2017-08-14'],
    ['Imperador', 'saoBento', 'male', 'Quarto de Milha', 'Alazão', '2014-04-05'],
    ['Duquesa', 'saoBento', 'female', 'Quarto de Milha', 'Lobuna', '2018-12-01'],
    ['Safira', 'saoBento', 'female', 'Quarto de Milha', 'Baia', '2019-10-11'],
    ['Cometa', 'saoBento', 'male', 'Quarto de Milha', 'Castanho', '2024-09-03'],
    ['Aurora', 'saoBento', 'female', 'Quarto de Milha', 'Alazã', '2024-10-17'],
  ];
  const animals: Herd['animals'] = {};
  for (const [name, propertyKey, sex, breed, coat, birth, castrated] of horses) {
    const created = await identity.animal.create({
      data: {
        tenantId: CLINICA,
        propertyId: properties[propertyKey].id,
        ownerId: owners[properties[propertyKey].ownerKey],
        name,
        species: 'equine',
        sex,
        breed,
        coat,
        birthDate: new Date(birth),
        castrated: castrated ?? false,
        status: 'active',
      },
    });
    animals[name] = { id: created.id, propertyKey };
  }

  return { vets: { helena, ricardo }, owners, properties, animals };
}

// ─── 3. MS2 — estoque ─────────────────────────────────────────────
interface StockItem {
  id: string;
  name: string;
  batch: string | null;
  salePriceCents: number;
  dosesPerUnit: number | null;
  doseIntervalDays: number | null;
}

async function seedInventory(): Promise<Record<string, StockItem>> {
  type ProductSeed = {
    key: string;
    name: string;
    manufacturer: string;
    batch?: string;
    unit: 'frasco' | 'unidade' | 'ampola' | 'caixa';
    quantity: number;
    dosesPerUnit?: number;
    costPriceCents: number;
    markupPercent: number;
    expiryInDays?: number;
    minStockQty: number;
    category: 'vaccine' | 'medication' | 'supply';
    doseIntervalDays?: number;
  };

  const seeds: ProductSeed[] = [
    // Vacinas: frasco multidose; intervalo é a base da re-vacinação (RF-VAC-005).
    { key: 'influenza', name: 'Vacina Influenza Equina', manufacturer: 'Zoetis', batch: 'ZI-2026-114', unit: 'frasco', quantity: 6, dosesPerUnit: 10, costPriceCents: 32000, markupPercent: 35, expiryInDays: 240, minStockQty: 2, category: 'vaccine', doseIntervalDays: 180 },
    { key: 'tetano', name: 'Vacina Tétano Equino', manufacturer: 'Labtest', batch: 'LT-2026-07', unit: 'frasco', quantity: 5, dosesPerUnit: 10, costPriceCents: 9000, markupPercent: 40, expiryInDays: 300, minStockQty: 2, category: 'vaccine', doseIntervalDays: 365 },
    { key: 'encefalo', name: 'Vacina Encefalomielite + Tétano', manufacturer: 'Ourofino', batch: 'OF-EN-2203', unit: 'frasco', quantity: 4, dosesPerUnit: 10, costPriceCents: 28000, markupPercent: 35, expiryInDays: 180, minStockQty: 2, category: 'vaccine', doseIntervalDays: 365 },
    { key: 'raiva', name: 'Vacina Antirrábica', manufacturer: 'Ceva', batch: 'CV-RB-0912', unit: 'frasco', quantity: 3, dosesPerUnit: 10, costPriceCents: 12000, markupPercent: 40, expiryInDays: 25, minStockQty: 1, category: 'vaccine', doseIntervalDays: 365 },
    { key: 'rino', name: 'Vacina Rinopneumonite', manufacturer: 'Zoetis', batch: 'ZR-2026-031', unit: 'frasco', quantity: 1, dosesPerUnit: 10, costPriceCents: 35000, markupPercent: 30, expiryInDays: 200, minStockQty: 2, category: 'vaccine', doseIntervalDays: 180 },
    // Medicamentos
    { key: 'flunixin', name: 'Flunixin Meglumine 5%', manufacturer: 'Ourofino', batch: 'OF-2026-88', unit: 'frasco', quantity: 8, costPriceCents: 8200, markupPercent: 40, expiryInDays: 400, minStockQty: 3, category: 'medication' },
    { key: 'fenil', name: 'Fenilbutazona 20%', manufacturer: 'Vetnil', batch: 'VN-FB-552', unit: 'frasco', quantity: 6, costPriceCents: 6500, markupPercent: 40, expiryInDays: 365, minStockQty: 2, category: 'medication' },
    { key: 'ivermectina', name: 'Ivermectina Pasta Oral', manufacturer: 'Vetnil', batch: 'VN-IV-118', unit: 'unidade', quantity: 20, costPriceCents: 2500, markupPercent: 50, expiryInDays: 500, minStockQty: 5, category: 'medication' },
    { key: 'penicilina', name: 'Penicilina Benzatina 6.000.000 UI', manufacturer: 'Ourofino', batch: 'OF-PB-771', unit: 'frasco', quantity: 4, costPriceCents: 4800, markupPercent: 40, expiryInDays: 300, minStockQty: 2, category: 'medication' },
    // Insumos
    { key: 'seringa', name: 'Seringa Descartável 10ml', manufacturer: 'BD', unit: 'unidade', quantity: 200, costPriceCents: 150, markupPercent: 50, minStockQty: 50, category: 'supply' },
    { key: 'agulha', name: 'Agulha 40x12', manufacturer: 'BD', unit: 'unidade', quantity: 300, costPriceCents: 40, markupPercent: 60, minStockQty: 100, category: 'supply' },
    { key: 'tuboSoro', name: 'Tubo de Coleta sem Anticoagulante', manufacturer: 'Vacuplast', unit: 'unidade', quantity: 120, costPriceCents: 120, markupPercent: 50, minStockQty: 40, category: 'supply' },
    { key: 'tuboEdta', name: 'Tubo de Coleta EDTA', manufacturer: 'Vacuplast', unit: 'unidade', quantity: 80, costPriceCents: 130, markupPercent: 50, minStockQty: 40, category: 'supply' },
  ];

  const products: Record<string, StockItem> = {};
  for (const p of seeds) {
    const created = await inventory.product.create({
      data: {
        tenantId: CLINICA,
        name: p.name,
        manufacturer: p.manufacturer,
        batch: p.batch ?? null,
        unit: p.unit,
        quantityInStock: p.quantity,
        dosesPerUnit: p.dosesPerUnit ?? null,
        costPriceCents: p.costPriceCents,
        markupPercent: p.markupPercent,
        expiryDate: p.expiryInDays === undefined ? null : new Date(`${addDays(TODAY, p.expiryInDays)}T00:00:00Z`),
        alertDaysBefore: 30,
        minStockQty: p.minStockQty,
        category: p.category,
        doseIntervalDays: p.doseIntervalDays ?? null,
      },
    });
    await inventory.stockMovement.create({
      data: {
        tenantId: CLINICA,
        productId: created.id,
        type: 'in',
        quantity: p.quantity,
        reason: 'purchase',
        idempotencyKey: randomUUID(),
        notes: 'Estoque inicial (seed de homologação)',
        createdAt: on(-120),
      },
    });
    // O preço de venda é coluna GERADA (RN-008) — lê o que o banco calculou
    // em vez de repetir a fórmula aqui.
    const saved = await inventory.product.findUniqueOrThrow({ where: { id: created.id } });
    products[p.key] = {
      id: created.id,
      name: p.name,
      batch: p.batch ?? null,
      salePriceCents: saved.salePriceCents ?? 0,
      dosesPerUnit: p.dosesPerUnit ?? null,
      doseIntervalDays: p.doseIntervalDays ?? null,
    };
  }
  return products;
}

/** Baixa no estoque como o DeductionService faria ao receber o evento (RN-003). */
async function consume(
  product: StockItem,
  quantity: number,
  source: StockConsumptionSource,
  sourceId: string,
  at: Date,
): Promise<void> {
  await inventory.stockMovement.create({
    data: {
      tenantId: CLINICA,
      productId: product.id,
      type: 'out',
      quantity,
      reason: source,
      referenceId: sourceId,
      referenceType: source,
      idempotencyKey: randomUUID(),
      createdAt: at,
    },
  });
  await inventory.product.update({ where: { id: product.id }, data: { quantityInStock: { decrement: quantity } } });
}

// ─── 4. MS6 — pendência financeira ────────────────────────────────
/** Como o FinancialService faria; `paidDaysAfter` registra o pagamento. */
async function charge(
  sourceType: 'appointment' | 'exam' | 'vaccination',
  sourceId: string,
  ownerId: string,
  amountCents: number,
  occurredAt: Date,
  paidDaysAfter?: number,
): Promise<void> {
  if (amountCents <= 0) return;
  await reporting.financialRecord.create({
    data: {
      tenantId: CLINICA,
      ownerId,
      sourceType,
      sourceId,
      amountCents,
      occurredAt,
      status: paidDaysAfter === undefined ? 'pending' : 'received',
      paidAt: paidDaysAfter === undefined ? null : new Date(occurredAt.getTime() + paidDaysAfter * DAY_MS),
      idempotencyKey: randomUUID(),
    },
  });
}

// ─── 5. MS3 — atendimentos (orçamentos de visita) ────────────────
const TYPE_LABELS = {
  clinico_geral: 'Clínico geral',
  reproducao: 'Reprodução',
  odontologico: 'Odontológico',
  locomotor: 'Locomotor',
  cirurgia: 'Cirurgia',
} as const;

async function seedAppointments(h: Herd, p: Record<string, StockItem>): Promise<number> {
  type Route = 'oral' | 'intravenosa' | 'intramuscular' | 'subcutanea' | 'topica';
  type Clinical = {
    record?: { anamnesis: string; diagnosis?: string; treatment?: string; prognosis?: string; generalExam?: object };
    prescriptions?: Array<{ product?: StockItem; medicationName: string; dose: string; route: Route; schedule: string }>;
  };
  type AppointmentSeed = {
    /** Animais da visita — todos da mesma propriedade. Ficha por animal em `clinical`. */
    animals: string[];
    vet: Vet;
    type: keyof typeof TYPE_LABELS;
    daysAgo: number;
    finished: boolean;
    km: number;
    /** Procedimento em texto; o valor do serviço vai na mão de obra (reunião de 20/10/2026). */
    procedure: string;
    laborCents: number;
    products: Array<[StockItem, number]>;
    clinical?: Record<string, Clinical>;
    paidDaysAfter?: number;
    location?: string;
  };

  const seeds: AppointmentSeed[] = [
    {
      animals: ['Relâmpago'], vet: h.vets.helena, type: 'locomotor', daysAgo: 62, finished: true, km: 24,
      procedure: 'Consulta clínica e exame de claudicação', laborCents: 26000,
      products: [[p['fenil']!, 1], [p['seringa']!, 2]],
      clinical: {
        'Relâmpago': {
          record: {
            anamnesis: 'Claudicação no membro anterior esquerdo há 5 dias, após treino em piso duro.',
            diagnosis: 'Tendinite do tendão flexor digital superficial (grau 2).',
            treatment: 'Anti-inflamatório por 5 dias, ducha fria 2x ao dia, repouso em baia por 30 dias.',
            prognosis: 'Favorável com repouso adequado.',
            generalExam: { temperatura: 38.1, frequenciaCardiaca: 40, frequenciaRespiratoria: 14, mucosas: 'normocoradas' },
          },
          prescriptions: [{ product: p['fenil'], medicationName: 'Fenilbutazona 20%', dose: '4,4 mg/kg', route: 'intravenosa', schedule: '1x ao dia por 5 dias' }],
        },
      },
      paidDaysAfter: 10,
    },
    {
      animals: ['Estrela'], vet: h.vets.ricardo, type: 'reproducao', daysAgo: 45, finished: true, km: 24,
      procedure: 'Ultrassonografia reprodutiva (controle folicular)', laborCents: 31000, products: [],
      clinical: {
        'Estrela': {
          record: {
            anamnesis: 'Égua em estação de monta, controle folicular.',
            diagnosis: 'Folículo dominante de 38 mm no ovário direito; útero sem alterações.',
            treatment: 'Indicada cobertura nas próximas 24 a 48 horas.',
          },
        },
      },
      paidDaysAfter: 3,
    },
    {
      animals: ['Pérola'], vet: h.vets.helena, type: 'clinico_geral', daysAgo: 30, finished: true, km: 38,
      procedure: 'Atendimento de cólica', laborCents: 26000,
      products: [[p['flunixin']!, 1], [p['seringa']!, 1], [p['agulha']!, 2]],
      clinical: {
        'Pérola': {
          record: {
            anamnesis: 'Desconforto abdominal leve desde a madrugada, olhando para o flanco.',
            diagnosis: 'Cólica espasmódica, sem sinais de obstrução.',
            treatment: 'Analgesia e jejum de 12 horas, com reintrodução gradual de volumoso.',
            prognosis: 'Bom.',
            generalExam: { temperatura: 37.9, frequenciaCardiaca: 52, motilidade: 'aumentada' },
          },
          prescriptions: [{ product: p['flunixin'], medicationName: 'Flunixin Meglumine 5%', dose: '1,1 mg/kg', route: 'intravenosa', schedule: 'Dose única' }],
        },
      },
    },
    // Visita com VÁRIOS animais (pedido da reunião de 20/10/2026): uma ficha por animal.
    {
      animals: ['Bandido', 'Princesa'], vet: h.vets.ricardo, type: 'odontologico', daysAgo: 21, finished: true, km: 52,
      procedure: 'Desgaste dentário (grosamento) em 2 animais', laborCents: 70000, products: [],
      clinical: {
        'Bandido': {
          record: {
            anamnesis: 'Dificuldade de mastigação e perda de peso.',
            diagnosis: 'Pontas dentárias excessivas nos pré-molares superiores.',
            treatment: 'Grosamento realizado; revisão em 12 meses.',
          },
        },
        'Princesa': {
          record: { anamnesis: 'Avaliação odontológica de rotina.', diagnosis: 'Pontas leves.', treatment: 'Grosamento de manutenção.' },
        },
      },
      paidDaysAfter: 7,
    },
    {
      animals: ['Imperador'], vet: h.vets.helena, type: 'cirurgia', daysAgo: 14, finished: true, km: 10,
      procedure: 'Debridamento e sutura de ferida lacerante no peitoral', laborCents: 105000,
      products: [[p['penicilina']!, 1], [p['seringa']!, 3], [p['agulha']!, 3]],
      clinical: {
        'Imperador': {
          record: {
            anamnesis: 'Ferida no peitoral após contato com cerca de arame.',
            diagnosis: 'Laceração de 12 cm com exposição muscular, sem lesão de estruturas nobres.',
            treatment: 'Debridamento e sutura em dois planos; curativo diário e antibioticoterapia.',
            prognosis: 'Favorável.',
          },
          prescriptions: [
            { product: p['penicilina'], medicationName: 'Penicilina Benzatina', dose: '20.000 UI/kg', route: 'intramuscular', schedule: 'A cada 48h, 3 aplicações' },
            { medicationName: 'Pomada cicatrizante', dose: 'Camada fina', route: 'topica', schedule: '2x ao dia até cicatrizar' },
          ],
        },
      },
    },
    // Vermifugação do plantel do Haras São Bento: 3 animais, uma visita.
    {
      animals: ['Duquesa', 'Safira', 'Cometa'], vet: h.vets.ricardo, type: 'clinico_geral', daysAgo: 6, finished: true, km: 10,
      procedure: 'Avaliação clínica e vermifugação do plantel', laborCents: 24000,
      products: [[p['ivermectina']!, 3]],
      clinical: {
        'Duquesa': { prescriptions: [{ product: p['ivermectina'], medicationName: 'Ivermectina pasta oral', dose: '200 mcg/kg', route: 'oral', schedule: 'Dose única' }] },
        'Safira': { prescriptions: [{ product: p['ivermectina'], medicationName: 'Ivermectina pasta oral', dose: '200 mcg/kg', route: 'oral', schedule: 'Dose única' }] },
        'Cometa': {
          record: { anamnesis: 'Potro com pelagem opaca.', diagnosis: 'Verminose provável.', treatment: 'Vermifugação; repetir em 30 dias.' },
          prescriptions: [{ product: p['ivermectina'], medicationName: 'Ivermectina pasta oral', dose: '200 mcg/kg', route: 'oral', schedule: 'Dose única; repetir em 30 dias' }],
        },
      },
      paidDaysAfter: 2,
    },
    // Em aberto (rascunhos): aparecem no filtro "em aberto" da tela inicial.
    {
      animals: ['Faísca'], vet: h.vets.helena, type: 'locomotor', daysAgo: 1, finished: false, km: 38,
      procedure: 'Consulta clínica', laborCents: 18000, products: [],
      clinical: { 'Faísca': { record: { anamnesis: 'Rigidez ao sair da baia pela manhã.' } } },
      location: 'Piquete 2',
    },
    {
      animals: ['Duquesa', 'Imperador'], vet: h.vets.ricardo, type: 'reproducao', daysAgo: 0, finished: false, km: 10,
      procedure: 'Ultrassonografia reprodutiva e avaliação do garanhão', laborCents: 31000, products: [],
    },
  ];

  for (const s of seeds) {
    const property = h.properties[h.animals[s.animals[0]!]!.propertyKey];
    const ownerId = h.owners[property.ownerKey];
    const performedAt = on(-s.daysAgo, 9);
    const items = s.products.map(([product, quantity]) => ({
      productId: product.id,
      description: product.name,
      quantity,
      unitPriceCents: product.salePriceCents,
      totalCents: calculateItemTotalCents(quantity, product.salePriceCents),
    }));
    const displacementRateCents = 250;
    const totalCents = calculateTotalCents({ items, laborCents: s.laborCents, displacementKm: s.km, displacementRateCents });
    // O nome que a tela pré-preenche: Data Especialidade Propriedade.
    const [year, month, day] = saoPauloDay(performedAt).split('-');
    const title = `${day}/${month}/${year} ${TYPE_LABELS[s.type]} ${property.name}`;

    const created = await clinical.appointment.create({
      data: {
        tenantId: CLINICA,
        ownerId,
        propertyId: property.id,
        veterinarianId: s.vet.id,
        title,
        type: s.type,
        status: s.finished ? 'finished' : 'draft',
        animalLocation: s.location ?? null,
        // Ponto no mapa pré-marcado na propriedade, como a tela faz.
        locationLatitude: property.latitude,
        locationLongitude: property.longitude,
        performedAt,
        procedureDescription: s.procedure,
        laborCents: s.laborCents,
        displacementKm: s.km,
        displacementRateCents,
        totalCents,
        finishedAt: s.finished ? performedAt : null,
        items: { create: items.map((i) => ({ ...i, tenantId: CLINICA })) },
        animals: {
          create: s.animals.map((name) => {
            const c = s.clinical?.[name];
            return {
              tenantId: CLINICA,
              animalId: h.animals[name]!.id,
              ...(c?.record
                ? {
                    medicalRecord: {
                      create: {
                        tenantId: CLINICA,
                        anamnesis: c.record.anamnesis,
                        diagnosis: c.record.diagnosis ?? null,
                        treatment: c.record.treatment ?? null,
                        prognosis: c.record.prognosis ?? null,
                        generalExam: c.record.generalExam ?? undefined,
                      },
                    },
                  }
                : {}),
              ...(c?.prescriptions
                ? {
                    prescriptions: {
                      create: c.prescriptions.map((r) => ({
                        tenantId: CLINICA,
                        productId: r.product?.id ?? null,
                        medicationName: r.medicationName,
                        dose: r.dose,
                        route: r.route,
                        schedule: r.schedule,
                      })),
                    },
                  }
                : {}),
            };
          }),
        },
      },
    });

    if (s.finished) {
      for (const [product, quantity] of s.products) await consume(product, quantity, 'appointment', created.id, performedAt);
      await charge('appointment', created.id, ownerId, totalCents, performedAt, s.paidDaysAfter);
    }
  }
  return seeds.length;
}

// ─── 6. MS3 — exames ──────────────────────────────────────────────
async function seedExams(h: Herd, p: Record<string, StockItem>): Promise<number> {
  const suggestion = (name: string): ExamProtocolField[] =>
    EXAM_TYPE_SUGGESTIONS.find((s) => s.name.startsWith(name))?.protocolFields ?? [];

  const examType = async (
    name: string,
    defaultPriceCents: number,
    days: number,
    protocolFields: ExamProtocolField[],
  ): Promise<ExamTypeRow> =>
    clinical.examType.create({
      data: { tenantId: CLINICA, name, defaultPriceCents, expectedTurnaroundDays: days, protocolFields: protocolFields as object[] },
    });
  const mormo = await examType('Mormo', 15000, 7, suggestion('Mormo'));
  const aie = await examType('AIE (Anemia Infecciosa Equina)', 12000, 5, suggestion('AIE'));
  const hemograma = await examType('Hemograma completo', 8000, 2, [
    { key: 'jejum', label: 'Animal em jejum?', type: 'select', required: false, options: ['Sim', 'Não'] },
    { key: 'laboratorio', label: 'Laboratório', type: 'text', required: false },
  ]);

  type ExamSeed = {
    type: ExamTypeRow;
    animals: string[];
    lot?: { description: string; size: number };
    vet: Vet;
    status: 'draft' | 'requested' | 'collected' | 'in_analysis' | 'result_available';
    createdDaysAgo: number;
    /** Coletado pelo vet: dias atrás, insumos e custos de coleta. */
    collection?: { daysAgo: number; material: string; tubes: Array<[StockItem, number]>; laborCents: number; km: number };
    /** Sem coleta do vet: quando a cobrança fechou (envio ao laboratório). */
    sentDaysAgo?: number;
    paidDirectlyByClient?: boolean;
    protocolData: Record<string, unknown>;
    paidDaysAfter?: number;
  };

  const lab = { laboratorio: 'LANAGRO-GO', numero_requisicao: '' };
  const seeds: ExamSeed[] = [
    // Caso 1 — vet coletou e cobra o exame (GTA para evento).
    { type: mormo, animals: ['Imperador', 'Duquesa'], vet: h.vets.helena, status: 'result_available', createdDaysAgo: 20,
      collection: { daysAgo: 19, material: 'Sangue (soro)', tubes: [[p['tuboSoro']!, 2]], laborCents: 6000, km: 10 },
      protocolData: { ...lab, finalidade: 'Evento ou competição', numero_requisicao: 'REQ-2026-0412' }, paidDaysAfter: 5 },
    // Caso 2 — vet coletou, cliente paga o laboratório direto (lote de potros).
    { type: aie, animals: [], lot: { description: 'Potros desmamados 2025', size: 8 }, vet: h.vets.ricardo, status: 'in_analysis', createdDaysAgo: 5,
      collection: { daysAgo: 4, material: 'Sangue (soro)', tubes: [[p['tuboSoro']!, 8]], laborCents: 12000, km: 10 },
      paidDirectlyByClient: true, protocolData: { ...lab, finalidade: 'Compra e venda', numero_requisicao: 'REQ-2026-0518' } },
    // Caso 3 — outra pessoa coletou e o cliente pagou o laboratório: nada a cobrar.
    { type: aie, animals: ['Pérola'], vet: h.vets.helena, status: 'in_analysis', createdDaysAgo: 4, sentDaysAgo: 3,
      paidDirectlyByClient: true, protocolData: { ...lab, finalidade: 'Trânsito (GTA)', numero_requisicao: 'REQ-2026-0533' } },
    // Caso 4 — outra pessoa coletou, vet cobra o exame.
    { type: mormo, animals: ['Bandido'], vet: h.vets.ricardo, status: 'result_available', createdDaysAgo: 30, sentDaysAgo: 29,
      protocolData: { ...lab, finalidade: 'Trânsito (GTA)', numero_requisicao: 'REQ-2026-0371' }, paidDaysAfter: 12 },
    // Coletado hoje pela manhã; resultado previsto para amanhã (lembrete D-1).
    { type: hemograma, animals: ['Relâmpago'], vet: h.vets.helena, status: 'collected', createdDaysAgo: 1,
      collection: { daysAgo: 1, material: 'Sangue total', tubes: [[p['tuboEdta']!, 1]], laborCents: 4000, km: 24 },
      protocolData: { jejum: 'Sim', laboratorio: 'Lab Vet Jataí' } },
    // Emitido, aguardando coleta.
    { type: mormo, animals: ['Safira'], vet: h.vets.ricardo, status: 'requested', createdDaysAgo: 2,
      protocolData: { ...lab, finalidade: 'Compra e venda' } },
    // Rascunho incompleto (o rascunho aceita campo em branco).
    { type: aie, animals: ['Trovão'], vet: h.vets.helena, status: 'draft', createdDaysAgo: 0, protocolData: {} },
  ];

  for (const s of seeds) {
    const first = s.animals[0] ? h.animals[s.animals[0]]! : h.animals['Imperador']!;
    const property = h.properties[first.propertyKey];
    const ownerId = h.owners[property.ownerKey];
    const unitPriceCents = s.type.defaultPriceCents;
    const subjects = s.animals.length + (s.lot?.size ?? 0);
    const createdAt = on(-s.createdDaysAgo, 8);
    const collectedAt = s.collection ? on(-s.collection.daysAgo, 8) : null;

    const tubes = (s.collection?.tubes ?? []).map(([product, quantity]) => ({
      productId: product.id,
      description: product.name,
      quantity,
      unitPriceCents: product.salePriceCents,
      totalCents: calculateItemTotalCents(quantity, product.salePriceCents),
    }));
    const chargeClosed = s.status !== 'draft' && s.status !== 'requested';
    const chargedAt = chargeClosed ? (collectedAt ?? on(-(s.sentDaysAgo ?? 0), 9)) : null;
    const totalCents = chargeClosed
      ? calculateExamChargeCents({
          paidDirectlyByClient: s.paidDirectlyByClient ?? false,
          unitPriceCents,
          subjects,
          collection: s.collection
            ? { laborCents: s.collection.laborCents, displacementKm: s.collection.km, displacementRateCents: 250, items: tubes }
            : null,
        })
      : 0;
    const expectedResultAt = chargedAt ? calculateExpectedResultAt(chargedAt, s.type.expectedTurnaroundDays) : null;
    const resultUploadedAt = s.status === 'result_available' ? new Date(chargedAt!.getTime() + 6 * DAY_MS) : null;

    const created = await clinical.examRequest.create({
      data: {
        tenantId: CLINICA,
        ownerId,
        propertyId: property.id,
        veterinarianId: s.vet.id,
        examTypeId: s.type.id,
        examTypeName: s.type.name,
        protocolFields: s.type.protocolFields as object[],
        protocolData: s.protocolData as object,
        material: s.collection?.material ?? null,
        collectedAt,
        lotDescription: s.lot?.description ?? null,
        lotSize: s.lot?.size ?? null,
        status: s.status,
        expectedResultAt,
        // Laudo de exemplo: na homologação, anexar um PDF real pela tela.
        resultFileUrl: resultUploadedAt ? `https://exemplo.invalid/laudos/${randomUUID()}.pdf` : null,
        resultUploadedAt,
        paidDirectlyByClient: s.paidDirectlyByClient ?? false,
        unitPriceCents,
        laborCents: s.collection?.laborCents ?? 0,
        displacementKm: s.collection?.km ?? 0,
        displacementRateCents: s.collection ? 250 : 0,
        totalCents,
        chargedAt,
        createdAt,
        animals: { create: s.animals.map((name) => ({ tenantId: CLINICA, animalId: h.animals[name]!.id })) },
        items: { create: tubes.map((t) => ({ ...t, tenantId: CLINICA })) },
      },
    });

    if (s.collection) for (const [product, qty] of s.collection.tubes) await consume(product, qty, 'exam', created.id, collectedAt!);
    if (chargedAt) await charge('exam', created.id, ownerId, totalCents, chargedAt, s.paidDaysAfter);
  }
  return seeds.length;
}

// ─── 7. MS3 — vacinações ──────────────────────────────────────────
async function seedVaccinations(h: Herd, p: Record<string, StockItem>): Promise<number> {
  type VaccinationSeed = {
    animals: string[];
    vet: Vet;
    /** Escolhe a data de aplicação a partir da próxima dose desejada na demo. */
    nextDoseInDays?: number;
    appliedDaysAgo?: number;
    product?: StockItem;
    /** Registro externo: vacina aplicada por outra pessoa. */
    external?: { appliedBy: string; vaccineName?: string; doseIntervalDays?: number };
    dosesPerAnimal?: number;
    km?: number;
    laborCents?: number;
    paidDaysAfter?: number;
  };

  const seeds: VaccinationSeed[] = [
    // Múltipla, da clínica — próxima dose em 7 dias (dispara o aviso "uma semana antes" hoje).
    { animals: ['Imperador', 'Duquesa', 'Safira'], vet: h.vets.helena, product: p['influenza'], nextDoseInDays: 7, km: 10, laborCents: 9000, paidDaysAfter: 4 },
    // Vence hoje (aviso "no dia").
    { animals: ['Relâmpago', 'Estrela'], vet: h.vets.helena, product: p['influenza'], nextDoseInDays: 0, km: 24, laborCents: 6000 },
    // Atrasada há 12 dias.
    { animals: ['Bandido', 'Princesa'], vet: h.vets.ricardo, product: p['rino'], nextDoseInDays: -12, km: 52, laborCents: 6000, paidDaysAfter: 9 },
    // Em breve (3 dias).
    { animals: ['Pérola'], vet: h.vets.helena, product: p['encefalo'], nextDoseInDays: 3, km: 38, laborCents: 4000 },
    // Agendada para daqui a meses.
    { animals: ['Pérola', 'Faísca'], vet: h.vets.helena, product: p['tetano'], nextDoseInDays: 200, km: 38, laborCents: 5000, paidDaysAfter: 2 },
    // Dose dupla nos potros (primovacinação).
    { animals: ['Cometa', 'Aurora'], vet: h.vets.ricardo, product: p['tetano'], appliedDaysAgo: 3, dosesPerAnimal: 2, km: 10, laborCents: 6000 },
    // Raiva recente (vacina com validade perto de vencer no estoque).
    { animals: ['Trovão', 'Relâmpago', 'Estrela'], vet: h.vets.helena, product: p['raiva'], appliedDaysAgo: 8, km: 24, laborCents: 9000, paidDaysAfter: 1 },
    // Externa, do catálogo: outro vet aplicou antes de o animal chegar à clínica.
    { animals: ['Faísca'], vet: h.vets.helena, product: p['influenza'], nextDoseInDays: 5,
      external: { appliedBy: 'Dr. Paulo Mendes (CRMV-GO 5521)' } },
    // Externa, digitada (vacina que a clínica não tem no estoque).
    { animals: ['Imperador'], vet: h.vets.ricardo, nextDoseInDays: 45,
      external: { appliedBy: 'Proprietário (registro da carteira)', vaccineName: 'Garrotilho (Adenite Equina)', doseIntervalDays: 365 } },
  ];

  for (const s of seeds) {
    const first = h.animals[s.animals[0]!]!;
    const property = h.properties[first.propertyKey];
    const ownerId = h.owners[property.ownerKey];
    const doseIntervalDays = s.external?.doseIntervalDays ?? s.product?.doseIntervalDays ?? null;
    const appliedAt =
      s.nextDoseInDays !== undefined && doseIntervalDays !== null
        ? on(s.nextDoseInDays - doseIntervalDays, 10)
        : on(-(s.appliedDaysAgo ?? 0), 10);
    const dosesPerAnimal = s.dosesPerAnimal ?? 1;
    const doses = totalDoses(dosesPerAnimal, s.animals.length);
    const isClinic = !s.external;
    const pricePerDoseCents =
      isClinic && s.product ? Math.round(s.product.salePriceCents / (s.product.dosesPerUnit ?? 1)) : 0;
    const totalCents = isClinic
      ? calculateVaccinationTotalCents({
          pricePerDoseCents,
          doses,
          laborCents: s.laborCents ?? 0,
          displacementKm: s.km ?? 0,
          displacementRateCents: 250,
        })
      : 0;

    const created = await clinical.vaccination.create({
      data: {
        tenantId: CLINICA,
        origin: isClinic ? 'clinic' : 'external',
        ownerId,
        propertyId: property.id,
        veterinarianId: s.vet.id,
        productId: s.product?.id ?? null,
        vaccineName: s.external?.vaccineName ?? s.product!.name,
        vaccineBatch: s.product?.batch ?? null,
        appliedBy: s.external?.appliedBy ?? null,
        dosesPerAnimal,
        appliedAt,
        doseIntervalDays,
        nextDoseAt: calculateNextDoseAt(appliedAt, doseIntervalDays),
        pricePerDoseCents,
        laborCents: isClinic ? (s.laborCents ?? 0) : 0,
        displacementKm: isClinic ? (s.km ?? 0) : 0,
        displacementRateCents: isClinic ? 250 : 0,
        totalCents,
        animals: { create: s.animals.map((name) => ({ tenantId: CLINICA, animalId: h.animals[name]!.id })) },
      },
    });

    if (isClinic && s.product) {
      await consume(s.product, dosesToUnits(doses, s.product.dosesPerUnit), 'vaccination', created.id, appliedAt);
      await charge('vaccination', created.id, ownerId, totalCents, appliedAt, s.paidDaysAfter);
    }
  }
  return seeds.length;
}

// ─── 8. Segundo tenant: demonstra o isolamento (RLS) ──────────────
async function seedNeighbor(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  await identity.tenant.create({
    data: { id: VIZINHA, name: 'Haras Vizinho (isolamento)', slug: 'homologacao-isolamento', plan: 'basic', status: 'active', maxOwners: 30 },
  });
  const user = await identity.user.create({
    data: { tenantId: VIZINHA, email: 'isolamento@quironequine.com.br', passwordHash, role: 'admin', fullName: 'Dr. Vizinho', status: 'active' },
  });
  const vet = await identity.veterinarian.create({
    data: { tenantId: VIZINHA, userId: user.id, fullName: 'Dr. Vizinho', crmv: 'GO-01234', crmvState: 'GO', cpfCnpj: '000.000.000-00', phone: '', email: user.email },
  });
  const owner = await identity.owner.create({ data: { tenantId: VIZINHA, fullName: 'Proprietário do Vizinho', city: 'Jataí', state: 'GO', status: 'active' } });
  const property = await identity.property.create({ data: { tenantId: VIZINHA, name: 'Haras Vizinho', city: 'Jataí', state: 'GO', status: 'active' } });
  await identity.propertyOwner.create({ data: { tenantId: VIZINHA, propertyId: property.id, ownerId: owner.id, isPrimary: true } });
  const animal = await identity.animal.create({
    data: { tenantId: VIZINHA, propertyId: property.id, ownerId: owner.id, name: 'Segredo', species: 'equine', sex: 'male', status: 'active' },
  });
  await clinical.appointment.create({
    data: {
      tenantId: VIZINHA, ownerId: owner.id, propertyId: property.id, veterinarianId: vet.id, title: 'Atendimento do vizinho',
      type: 'clinico_geral', status: 'draft', performedAt: on(-2), totalCents: 0,
      animals: {
        create: {
          tenantId: VIZINHA,
          animalId: animal.id,
          medicalRecord: { create: { tenantId: VIZINHA, anamnesis: 'Este atendimento NÃO pode aparecer para a Clínica Equina Modelo.' } },
        },
      },
    },
  });
}

async function main(): Promise<void> {
  console.log(`Seed de homologação — dia de referência ${TODAY} (São Paulo)`);
  await reset();
  const herd = await seedIdentity();
  const products = await seedInventory();
  const appointments = await seedAppointments(herd, products);
  const exams = await seedExams(herd, products);
  const vaccinations = await seedVaccinations(herd, products);
  await seedNeighbor();

  const [pending, received] = await Promise.all([
    reporting.financialRecord.count({ where: { tenantId: CLINICA, status: 'pending' } }),
    reporting.financialRecord.count({ where: { tenantId: CLINICA, status: 'received' } }),
  ]);

  console.log('\nPronto.');
  console.log('  Clínica Equina Modelo');
  console.log(`    login:  homologacao@quironequine.com.br (Dra. Helena, admin)`);
  console.log(`            ricardo.homologacao@quironequine.com.br (Dr. Ricardo, admin)`);
  console.log(`            ana.homologacao@quironequine.com.br (Ana, assistente)`);
  console.log(`    senha:  ${process.env['SEED_PASSWORD'] ? '(SEED_PASSWORD)' : PASSWORD}`);
  console.log(`    dados:  4 proprietários, 4 propriedades, ${Object.keys(herd.animals).length} animais, ${Object.keys(products).length} produtos`);
  console.log(`            ${appointments} atendimentos, ${exams} exames, ${vaccinations} vacinações`);
  console.log(`            ${pending} pendências em aberto, ${received} recebidas`);
  console.log('  Haras Vizinho (isolamento): isolamento@quironequine.com.br — não pode ver nada da clínica acima.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([identity.$disconnect(), inventory.$disconnect(), clinical.$disconnect(), reporting.$disconnect()]);
  });
