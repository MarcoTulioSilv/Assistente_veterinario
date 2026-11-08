import { describe, expect, it } from 'vitest';
import { safeErrorMessage, serializeError } from './safe-error';

/** Imita o que o Prisma lança: a mensagem traz os argumentos da chamada. */
function prismaError(name: string, extra: Record<string, unknown> = {}): Error {
  const err = new Error(
    'Invalid `tx.owner.create()` invocation:\n{ data: { fullName: "Maria Titular", cpf: "123.456.789-09", phone: "31999990000" } }',
  );
  err.name = name;
  Object.assign(err, { clientVersion: '6.2.0', ...extra });
  return err;
}

const PII = ['Maria', '123.456.789-09', '31999990000'];

describe('serializeError (M-05)', () => {
  it('erro do Prisma: guarda tipo, código e meta seguro, sem mensagem nem a 1ª linha da stack', () => {
    const err = prismaError('PrismaClientKnownRequestError', {
      code: 'P2002',
      meta: { target: ['tenant_id', 'cpf'], modelName: 'Owner', cause: 'cpf "123.456.789-09" duplicado' },
    });
    const out = serializeError(err) as Record<string, unknown>;

    expect(out).toMatchObject({
      type: 'PrismaClientKnownRequestError',
      code: 'P2002',
      meta: { target: ['tenant_id', 'cpf'], modelName: 'Owner' },
    });
    expect(String(out['stack'])).toMatch(/^\s*at /);
    const dump = JSON.stringify(out);
    for (const value of PII) expect(dump).not.toContain(value);
  });

  it('erro do Prisma dentro da cause também é limpo', () => {
    const wrapped = new Error('Falha ao baixar item', { cause: prismaError('PrismaClientValidationError') });
    const out = serializeError(wrapped) as Record<string, unknown>;
    expect(out['causeType']).toBe('PrismaClientValidationError');
    for (const value of PII) expect(JSON.stringify(out)).not.toContain(value);
  });

  it('outros erros seguem o serializador padrão do Pino (com mensagem)', () => {
    const out = serializeError(new Error('ECONNREFUSED redis:6379')) as Record<string, unknown>;
    expect(out['message']).toBe('ECONNREFUSED redis:6379');
    expect(out['type']).toBe('Error');
  });

  it('valores que não são objeto passam como vieram', () => {
    expect(serializeError('texto')).toBe('texto');
    expect(serializeError(undefined)).toBeUndefined();
  });
});

describe('safeErrorMessage (M-05)', () => {
  it('erro do Prisma vira tipo e código, sem a mensagem', () => {
    const msg = safeErrorMessage(prismaError('PrismaClientKnownRequestError', { code: 'P2003' }));
    expect(msg).toBe('PrismaClientKnownRequestError P2003 (mensagem omitida)');
  });

  it('outros erros mantêm a mensagem', () => {
    expect(safeErrorMessage(new Error('Connection is closed.'))).toBe('Connection is closed.');
    expect(safeErrorMessage('falhou')).toBe('falhou');
  });
});
