import { describe, it, expect } from 'vitest';
import { calculateTotalCents, calculateItemTotalCents, deriveEventIdempotencyKey } from './billing';

const APPOINTMENT_ID = '33333333-3333-3333-3333-333333333333';

describe('calculateTotalCents (RF-ATD-006)', () => {
  it('soma itens, mão de obra e deslocamento (km × valor/km)', () => {
    const total = calculateTotalCents({
      items: [{ totalCents: 5000 }, { totalCents: 2500 }],
      laborCents: 10000,
      displacementKm: 30,
      displacementRateCents: 250,
    });

    expect(total).toBe(5000 + 2500 + 10000 + 7500);
  });

  it('arredonda o deslocamento uma vez, no fim — não por km', () => {
    // 12,5 km × R$ 1,33 = 1662,5 centavos. Arredondar por km daria 12×133 + 0,5×133.
    expect(
      calculateTotalCents({ items: [], laborCents: 0, displacementKm: 12.5, displacementRateCents: 133 }),
    ).toBe(1663);
  });

  it('atendimento sem nada custa zero', () => {
    expect(
      calculateTotalCents({ items: [], laborCents: 0, displacementKm: 0, displacementRateCents: 0 }),
    ).toBe(0);
  });
});

describe('calculateItemTotalCents', () => {
  it('multiplica quantidade por preço unitário', () => {
    expect(calculateItemTotalCents(3, 1500)).toBe(4500);
  });

  it('quantidade fracionada (meia ampola) arredonda para centavo inteiro', () => {
    expect(calculateItemTotalCents(0.5, 999)).toBe(500);
  });
});

describe('deriveEventIdempotencyKey', () => {
  it('é determinística: o mesmo atendimento gera sempre a mesma chave', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).toBe(
      deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID),
    );
  });

  it('atendimentos diferentes geram chaves diferentes', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).not.toBe(
      deriveEventIdempotencyKey('appointment.done', '99999999-9999-9999-9999-999999999999'),
    );
  });

  it('eventos diferentes do mesmo atendimento não colidem na UNIQUE do outbox', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).not.toBe(
      deriveEventIdempotencyKey('appointment.cancelled', APPOINTMENT_ID),
    );
  });

  it('tem formato de UUID — a coluna é @db.Uuid de verdade', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
