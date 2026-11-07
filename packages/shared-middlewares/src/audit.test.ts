import { describe, expect, it } from 'vitest';
import { changedFields, writeAudit, type AuditTx } from './audit';

function fakeTx() {
  const calls: unknown[][] = [];
  const tx: AuditTx = {
    $executeRawUnsafe: (query: string, ...values: unknown[]) => {
      calls.push([query, ...values]);
      return Promise.resolve(1);
    },
  };
  return { tx, calls };
}

const actor = { tenantId: 't-1', userId: 'u-1' };

describe('writeAudit', () => {
  it('grava só os nomes dos campos, sem repetição e em ordem, e nunca os valores', async () => {
    const { tx, calls } = fakeTx();
    await writeAudit(tx, actor, {
      action: 'update',
      table: 'owners',
      recordId: 'r-1',
      fields: ['phone', 'fullName', 'phone'],
    });

    const [query, tenantId, userId, action, table, recordId, details] = calls[0]!;
    expect(query).toContain('INSERT INTO audit_log');
    expect(query).toContain('$6::jsonb'); // parametrizado, sem interpolar nada
    expect([tenantId, userId, action, table, recordId]).toEqual([
      't-1',
      'u-1',
      'update',
      'owners',
      'r-1',
    ]);
    expect(JSON.parse(details as string)).toEqual({ fields: ['fullName', 'phone'] });
  });

  it('escrita do sistema: userId nulo e a origem registrada', async () => {
    const { tx, calls } = fakeTx();
    await writeAudit(
      tx,
      { tenantId: 't-1', userId: null },
      {
        action: 'create',
        table: 'financial_records',
        recordId: 'r-2',
        source: 'event:appointment.finished',
      },
    );
    expect(calls[0]![2]).toBeNull();
    expect(JSON.parse(calls[0]![6] as string)).toEqual({ source: 'event:appointment.finished' });
  });

  it('sem campos nem origem, new_values fica nulo', async () => {
    const { tx, calls } = fakeTx();
    await writeAudit(tx, actor, { action: 'read', table: 'appointments', recordId: 'r-3' });
    expect(calls[0]![6]).toBeNull();
  });
});

describe('changedFields', () => {
  it('ignora as chaves undefined', () => {
    expect(changedFields({ a: 1, b: undefined, c: null, d: '' })).toEqual(['a', 'c', 'd']);
  });
});
