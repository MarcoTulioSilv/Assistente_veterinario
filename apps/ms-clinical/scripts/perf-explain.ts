/**
 * Medição de performance do MS3 (Sprint 8, homologação M2).
 *
 * Cria volume sintético, chama os repositórios DE VERDADE (com RLS, como
 * o runtime), captura o SQL que o Prisma gera e roda EXPLAIN ANALYZE em
 * cada consulta. Serve pra decidir índice com plano na mão, não no chute —
 * e pra repetir a medição antes de cada homologação.
 *
 *   npx dotenv -e ../../.env -- tsx scripts/perf-explain.ts            # mede e apaga o volume
 *   npx dotenv -e ../../.env -- tsx scripts/perf-explain.ts --keep     # mantém o volume no banco
 *
 * Só para banco LOCAL: escreve e apaga dados de tenants sintéticos fixos.
 */
import { PrismaClient } from '../node_modules/.prisma/client-clinical';
import { prisma, withTenant } from '../src/prisma';
import { AppointmentRepository } from '../src/repositories/appointment.repository';
import { ExamRepository } from '../src/repositories/exam.repository';
import { ExamTypeRepository } from '../src/repositories/exam-type.repository';
import { VaccinationRepository } from '../src/repositories/vaccination.repository';
import { dayWindow } from '../src/services/vaccination-reminder.service';
import { saoPauloDay, addDays } from '../src/services/sao-paulo-day';
import type { RequestContext } from '@quironequine/shared-types';

// Tenant medido + 9 vizinhos: o filtro de tenant só faz diferença se houver
// outros tenants na mesma tabela.
const PERF_TENANT = 'f0000000-0000-0000-0000-000000000000';
const TENANTS = Array.from({ length: 10 }, (_, i) => `f000000${i}-0000-0000-0000-000000000000`);
const PER_TENANT = Number(process.env['PERF_ROWS'] ?? 5000);

const admin = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL_CLINICAL'] });

const ctx: RequestContext = {
  tenantId: PERF_TENANT,
  userId: '00000000-0000-0000-0000-000000000000',
  role: 'admin',
  plan: 'plus',
  traceId: 'perf-explain',
};

async function cleanup(): Promise<void> {
  const ids = TENANTS.map((t) => `'${t}'`).join(',');
  for (const table of [
    'appointment_items',
    'prescriptions',
    'medical_records',
    'appointments',
    'exam_request_items',
    'exam_request_animals',
    'exam_requests',
    'exam_types',
    'vaccination_animals',
    'vaccinations',
    'outbox_events',
  ]) {
    await admin.$executeRawUnsafe(`DELETE FROM ${table} WHERE tenant_id IN (${ids})`);
  }
}

/** Volume com generate_series — milhares de linhas em segundos. */
/**
 * Animal sintético do tenant `t`. Cada clínica tem seus próprios animais, e
 * o rebanho é ~1/5 do volume: ~5 atendimentos e ~15 vacinações por animal.
 * Sortear poucos animais compartilhados distorce as estatísticas (milhares
 * de vacinas por cavalo) e leva o planner a planos que dados reais não dão.
 */
function animalExpr(t: number, seriesExpr: string): string {
  return `('a000000${t}-0000-0000-0000-' || lpad(((${seriesExpr}) % ${Math.max(1, Math.floor(PER_TENANT / 5))})::text, 12, '0'))::uuid`;
}

async function seed(): Promise<void> {
  for (const [t, tenant] of TENANTS.entries()) {
    const n = PER_TENANT;
    // Atendimentos: ~1 ano de datas, 2 itens cada. Animal sorteado entre 200.
    await admin.$executeRawUnsafe(`
      INSERT INTO appointments (id, tenant_id, owner_id, property_id, animal_id, veterinarian_id, type, status,
        performed_at, labor_cents, displacement_km, displacement_rate_cents, total_cents, created_at, updated_at)
      SELECT gen_random_uuid(), '${tenant}', gen_random_uuid(), gen_random_uuid(),
        ${animalExpr(t, 'g')}, gen_random_uuid(),
        'clinico_geral'::"AppointmentType", (CASE WHEN g % 3 = 0 THEN 'draft' ELSE 'finished' END)::"AppointmentStatus",
        now() - (g % 365) * interval '1 day', 5000, 10, 200, 12000, now(), now()
      FROM generate_series(1, ${n}) g`);
    await admin.$executeRawUnsafe(`
      INSERT INTO appointment_items (id, tenant_id, appointment_id, kind, description, quantity, unit_price_cents, total_cents)
      SELECT gen_random_uuid(), a.tenant_id, a.id, 'procedure'::"AppointmentItemKind", 'Consulta', 1, 9000, 9000
      FROM appointments a, generate_series(1, 2) WHERE a.tenant_id = '${tenant}'`);

    const typeId = (
      await admin.$queryRawUnsafe<Array<{ id: string }>>(`
        INSERT INTO exam_types (id, tenant_id, name, default_price_cents, expected_turnaround_days, protocol_fields, created_at, updated_at)
        VALUES (gen_random_uuid(), '${tenant}', 'Mormo', 15000, 5, '[]', now(), now()) RETURNING id`)
    )[0]!.id;
    await admin.$executeRawUnsafe(`
      INSERT INTO exam_requests (id, tenant_id, owner_id, property_id, veterinarian_id, exam_type_id, exam_type_name,
        status, expected_result_at, unit_price_cents, total_cents, created_at, updated_at)
      SELECT gen_random_uuid(), '${tenant}', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '${typeId}', 'Mormo',
        (CASE WHEN g % 4 = 0 THEN 'in_analysis' ELSE 'result_available' END)::"ExamStatus",
        now() + ((g % 30) - 15) * interval '1 day', 15000, 30000, now() - (g % 365) * interval '1 day', now()
      FROM generate_series(1, ${n}) g`);
    await admin.$executeRawUnsafe(`
      INSERT INTO exam_request_animals (id, tenant_id, exam_request_id, animal_id)
      SELECT gen_random_uuid(), e.tenant_id, e.id,
        ${animalExpr(t, 'abs(hashtext(e.id::text)) + k')}
      FROM exam_requests e, generate_series(0, 1) k WHERE e.tenant_id = '${tenant}'
      ON CONFLICT DO NOTHING`);

    await admin.$executeRawUnsafe(`
      INSERT INTO vaccinations (id, tenant_id, origin, owner_id, property_id, veterinarian_id, product_id, vaccine_name,
        doses_per_animal, applied_at, dose_interval_days, next_dose_at, price_per_dose_cents, total_cents, created_at, updated_at)
      SELECT gen_random_uuid(), '${tenant}', 'clinic'::"VaccinationOrigin", gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        ('b0000000-0000-0000-0000-' || lpad((g % 5)::text, 12, '0'))::uuid, 'Vacina ' || (g % 5),
        1, now() - (g % 365) * interval '1 day', 180, now() - (g % 365) * interval '1 day' + interval '180 days',
        4500, 13500, now(), now()
      FROM generate_series(1, ${n}) g`);
    await admin.$executeRawUnsafe(`
      INSERT INTO vaccination_animals (id, tenant_id, vaccination_id, animal_id)
      SELECT gen_random_uuid(), v.tenant_id, v.id,
        ${animalExpr(t, 'abs(hashtext(v.id::text)) + k')}
      FROM vaccinations v, generate_series(0, 2) k WHERE v.tenant_id = '${tenant}'
      ON CONFLICT DO NOTHING`);
  }
  await admin.$executeRawUnsafe('ANALYZE');
}

interface Captured {
  label: string;
  query: string;
  params: unknown[];
}

const captured: Captured[] = [];
let currentLabel = '';
prisma.$on('query', (e) => {
  if (!currentLabel || /set_config|BEGIN|COMMIT|ROLLBACK/i.test(e.query)) return;
  captured.push({ label: currentLabel, query: e.query, params: JSON.parse(e.params) as unknown[] });
});

/**
 * Parâmetros viram literais: pelo $queryRawUnsafe eles chegariam como
 * `text`, e o Postgres não compara uuid com text. Literal tem tipo
 * inferido pelo contexto — o plano é o mesmo da consulta parametrizada.
 * Do maior índice pro menor, pra $1 não comer o começo de $10.
 */
function inlineParams(c: Captured): string {
  let sql = c.query;
  for (let i = c.params.length; i >= 1; i--) {
    const value = c.params[i - 1];
    const literal = typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`;
    sql = sql.replaceAll(`$${i}`, literal);
  }
  return sql;
}

async function capture(label: string, run: () => Promise<unknown>): Promise<void> {
  currentLabel = label;
  await run();
  currentLabel = '';
}

const ANIMAL = 'a0000000-0000-0000-0000-000000000007';

async function main(): Promise<void> {
  const keep = process.argv.includes('--keep');
  console.log(`Limpando e criando volume: ${TENANTS.length} tenants × ${PER_TENANT} por tabela...`);
  await cleanup();
  await seed();

  const appointments = new AppointmentRepository();
  const exams = new ExamRepository();
  const examTypes = new ExamTypeRepository();
  const vaccinations = new VaccinationRepository();
  const page = { page: 1, limit: 20 };
  const deep = { page: 200, limit: 20 };

  await capture('atendimentos: lista p1', () => appointments.list(ctx, page));
  await capture('atendimentos: lista p200', () => appointments.list(ctx, deep));
  await capture('atendimentos: por animal', () => appointments.listByAnimal(ctx, ANIMAL, page));
  await capture('exames: lista p1', () => exams.list(ctx, page));
  await capture('exames: por animal', () => exams.listByAnimal(ctx, ANIMAL, page));
  await capture('tipos de exame: lista', () => examTypes.list(ctx, { page: 1, limit: 50 }));
  await capture('vacinas: lista p1', () => vaccinations.list(ctx, page));
  await capture('vacinas: por animal', () => vaccinations.listByAnimal(ctx, ANIMAL, page));
  await capture('vacinas: próxima dose do animal', () => vaccinations.listAllByAnimal(ctx, ANIMAL));

  console.log('\n=== EXPLAIN ANALYZE (como quironequine_app, com RLS) ===');
  for (const c of captured) {
    const plan = await withTenant(PERF_TENANT, (tx) =>
      tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`EXPLAIN (ANALYZE, BUFFERS) ${inlineParams(c)}`),
    );
    const lines = plan.map((p) => p['QUERY PLAN']);
    const time = lines.find((l) => l.startsWith('Execution Time'));
    const seqScans = lines.filter((l) => /Seq Scan on (appointments|exam_requests|vaccinations|appointment_items|exam_request_animals|vaccination_animals)\b/.test(l));
    const sorts = lines.filter((l) => /Sort Method/.test(l));
    const table = /FROM "public"\."(\w+)"/.exec(c.query)?.[1] ?? '?';
    console.log(`\n[${c.label}] ${table} — ${time}`);
    for (const l of [...seqScans, ...sorts]) console.log(`   ${l.trim()}`);
    if (process.env['PERF_VERBOSE']) console.log(lines.map((l) => `     ${l}`).join('\n'));
  }

  console.log('\n=== Lembretes (funções SECURITY DEFINER, cross-tenant) ===');
  {
    // Mesma janela que o ExamReminderService pede.
    const start = Date.now();
    const rows = await exams.listResultDueAcrossTenants(
      new Date(Date.now() - 2 * 86_400_000),
      new Date(Date.now() + 3 * 86_400_000),
    );
    console.log(`[lembrete de exame] ${rows.length} linhas em ${Date.now() - start} ms`);
  }
  {
    // Mesmas duas janelas que o VaccinationReminderService pede.
    const today = saoPauloDay(new Date());
    const start = Date.now();
    let total = 0;
    for (const day of [today, addDays(today, 7)]) {
      total += (await vaccinations.listDueAcrossTenants(...dayWindow(day))).length;
    }
    console.log(`[lembrete de vacina] ${total} linhas em ${Date.now() - start} ms`);
  }

  if (!keep) {
    await cleanup();
    console.log('\nVolume sintético apagado.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
    await prisma.$disconnect();
  });
