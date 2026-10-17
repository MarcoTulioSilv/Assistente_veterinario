import { describe, it, expect, vi } from 'vitest';
import type { DueVaccinationRow } from '../repositories/vaccination.repository';
import {
  VaccinationReminderService,
  vaccinationReminderKind,
  groupByVaccination,
} from './vaccination-reminder.service';
import { deriveEventIdempotencyKey } from './billing';

// 07h de São Paulo (UTC-3) de 08/10/2026 — o horário do job.
const NOW = new Date('2026-10-08T10:00:00.000Z');

function row(id: string, nextDoseAt: string, animalId: string, tenantId = '11111111-1111-1111-1111-111111111111'): DueVaccinationRow {
  return {
    id,
    tenantId,
    ownerId: '22222222-2222-2222-2222-222222222222',
    propertyId: '33333333-3333-3333-3333-333333333333',
    veterinarianId: '44444444-4444-4444-4444-444444444444',
    vaccineName: 'Influenza Equina',
    nextDoseAt: new Date(nextDoseAt),
    animalId,
  };
}

const V1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const V2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const V3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('vaccinationReminderKind', () => {
  it('hoje → due_today; daqui a 7 dias → week_before; o resto → nenhum', () => {
    expect(vaccinationReminderKind(new Date('2026-10-08T20:00:00.000Z'), NOW)).toBe('due_today');
    expect(vaccinationReminderKind(new Date('2026-10-15T15:00:00.000Z'), NOW)).toBe('week_before');
    expect(vaccinationReminderKind(new Date('2026-10-14T15:00:00.000Z'), NOW)).toBeNull();
    expect(vaccinationReminderKind(new Date('2026-10-16T15:00:00.000Z'), NOW)).toBeNull();
    expect(vaccinationReminderKind(new Date('2026-10-07T15:00:00.000Z'), NOW)).toBeNull();
  });

  it('virada de dia: 01h UTC do dia 09 ainda é hoje em São Paulo', () => {
    expect(vaccinationReminderKind(new Date('2026-10-09T01:00:00.000Z'), NOW)).toBe('due_today');
  });

  it('virada de mês na semana de antecedência', () => {
    expect(vaccinationReminderKind(new Date('2026-11-03T15:00:00.000Z'), new Date('2026-10-27T10:00:00.000Z'))).toBe(
      'week_before',
    );
  });
});

describe('groupByVaccination', () => {
  it('uma entrada por aplicação, com todos os animais que faltam', () => {
    const groups = groupByVaccination([
      row(V1, '2026-10-08T20:00:00.000Z', 'animal-1'),
      row(V2, '2026-10-15T15:00:00.000Z', 'animal-3'),
      row(V1, '2026-10-08T20:00:00.000Z', 'animal-2'),
    ]);
    expect(groups.map((g) => [g.row.id, g.animalIds])).toEqual([
      [V1, ['animal-1', 'animal-2']],
      [V2, ['animal-3']],
    ]);
  });
});

describe('VaccinationReminderService.run', () => {
  it('publica um aviso por aplicação, com o tipo certo e chave por (aplicação, tipo)', async () => {
    const repo = {
      listDueAcrossTenants: vi.fn().mockResolvedValue([
        row(V1, '2026-10-08T20:00:00.000Z', 'animal-1'),
        row(V1, '2026-10-08T20:00:00.000Z', 'animal-2'),
        row(V2, '2026-10-15T15:00:00.000Z', 'animal-3', '99999999-9999-9999-9999-999999999999'),
        row(V3, '2026-10-12T15:00:00.000Z', 'animal-4'),
      ]),
    };
    const publish = vi.fn().mockResolvedValue(undefined);

    const published = await new VaccinationReminderService(repo, publish, () => NOW).run();

    expect(published).toBe(2);
    const payloads = publish.mock.calls.map(([event]) => event.payload);
    expect(payloads.map((p) => [p.vaccinationId, p.kind, p.animalIds])).toEqual([
      [V1, 'due_today', ['animal-1', 'animal-2']],
      [V2, 'week_before', ['animal-3']],
    ]);
    expect(publish.mock.calls[0]?.[0].idempotencyKey).toBe(
      deriveEventIdempotencyKey('vaccination.due:due_today', V1),
    );
    expect(publish.mock.calls[1]?.[0].tenantId).toBe('99999999-9999-9999-9999-999999999999');
  });

  it('busca numa janela folgada em volta de hoje e de hoje + 7', async () => {
    const repo = { listDueAcrossTenants: vi.fn().mockResolvedValue([]) };

    await new VaccinationReminderService(repo, vi.fn(), () => NOW).run();

    expect(repo.listDueAcrossTenants).toHaveBeenCalledWith(
      new Date('2026-10-06T10:00:00.000Z'),
      new Date('2026-10-17T10:00:00.000Z'),
    );
  });

  it('uma falha não segura os outros avisos, mas falha o job', async () => {
    const repo = {
      listDueAcrossTenants: vi.fn().mockResolvedValue([
        row(V1, '2026-10-08T20:00:00.000Z', 'animal-1'),
        row(V2, '2026-10-08T21:00:00.000Z', 'animal-2'),
      ]),
    };
    const publish = vi.fn().mockRejectedValueOnce(new Error('redis fora')).mockResolvedValue(undefined);

    await expect(new VaccinationReminderService(repo, publish, () => NOW).run()).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
