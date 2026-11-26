import { describe, it, expect } from 'vitest';
import { calculateTotalCents, calculateItemTotalCents } from './billing';

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
