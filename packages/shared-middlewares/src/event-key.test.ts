import { describe, it, expect } from 'vitest';
import { deriveEventIdempotencyKey } from './event-key';

const APPOINTMENT_ID = '33333333-3333-3333-3333-333333333333';

describe('deriveEventIdempotencyKey', () => {
  it('é determinística: a mesma origem gera sempre a mesma chave', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).toBe(
      deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID),
    );
  });

  it('origens diferentes geram chaves diferentes', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).not.toBe(
      deriveEventIdempotencyKey('appointment.done', '99999999-9999-9999-9999-999999999999'),
    );
  });

  it('eventos diferentes da mesma origem não colidem na UNIQUE do outbox', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).not.toBe(
      deriveEventIdempotencyKey('appointment.deleted', APPOINTMENT_ID),
    );
  });

  it('tem formato de UUID — a coluna é @db.Uuid de verdade', () => {
    expect(deriveEventIdempotencyKey('appointment.done', APPOINTMENT_ID)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('mantém o valor de antes da mudança para cá (eventos já publicados continuam batendo)', () => {
    // Calculado com a implementação que existia no MS6 (derivePaymentEventKey).
    expect(deriveEventIdempotencyKey('payment.registered', '11111111-1111-1111-1111-111111111111')).toBe(
      '7a1c5fb8-ce53-3140-9fe4-cdbf8b2ce5a6',
    );
  });
});
