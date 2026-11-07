import { describe, it, expect, vi } from 'vitest';
import type { DomainEvent } from '@quironequine/shared-types';
import { drainOutboxOnce, type OutboxRelayDeps } from './outbox-relay.service';
import type { PendingOutboxRow } from '../repositories/outbox.repository';

const TENANT = '11111111-1111-1111-1111-111111111111';

function event(idempotencyKey: string): DomainEvent<unknown> {
  return {
    name: 'appointment.done',
    tenantId: TENANT,
    traceId: 'trace-teste',
    idempotencyKey,
    occurredAt: new Date().toISOString(),
    payload: {},
  };
}

function row(id: string, attempts = 0): PendingOutboxRow {
  return { id, tenantId: TENANT, event: event(`key-${id}`), attempts };
}

function fakeDeps(overrides: Partial<OutboxRelayDeps> = {}): OutboxRelayDeps {
  return {
    fetchPending: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue(undefined),
    markPublished: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as OutboxRelayDeps;
}

describe('drainOutboxOnce', () => {
  it('não faz nada quando não há pendente', async () => {
    const deps = fakeDeps();

    const result = await drainOutboxOnce(deps);

    expect(result).toEqual({ published: 0, failed: 0 });
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('publica e marca cada pendente, na ordem em que vieram', async () => {
    const deps = fakeDeps({ fetchPending: vi.fn().mockResolvedValue([row('a'), row('b')]) });

    const result = await drainOutboxOnce(deps);

    expect(result).toEqual({ published: 2, failed: 0 });
    expect(deps.publish).toHaveBeenCalledTimes(2);
    expect(deps.markPublished).toHaveBeenNthCalledWith(1, TENANT, 'a');
    expect(deps.markPublished).toHaveBeenNthCalledWith(2, TENANT, 'b');
  });

  it('publica ANTES de marcar — marcar primeiro perderia o evento se o publish falhasse', async () => {
    const ordem: string[] = [];
    const deps = fakeDeps({
      fetchPending: vi.fn().mockResolvedValue([row('a')]),
      publish: vi.fn().mockImplementation(async () => void ordem.push('publish')),
      markPublished: vi.fn().mockImplementation(async () => void ordem.push('mark')),
    });

    await drainOutboxOnce(deps);

    expect(ordem).toEqual(['publish', 'mark']);
  });

  it('não marca como publicado quando o publish falha — a linha segue pendente', async () => {
    const deps = fakeDeps({
      fetchPending: vi.fn().mockResolvedValue([row('a')]),
      publish: vi.fn().mockRejectedValue(new Error('Redis fora do ar')),
    });

    const result = await drainOutboxOnce(deps);

    expect(result).toEqual({ published: 0, failed: 1 });
    expect(deps.markPublished).not.toHaveBeenCalled();
    expect(deps.markFailed).toHaveBeenCalledWith(TENANT, 'a', 'Redis fora do ar');
  });

  it('uma falha não interrompe o lote: os itens seguintes continuam sendo publicados', async () => {
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error('falha transiente'))
      .mockResolvedValue(undefined);
    const deps = fakeDeps({
      fetchPending: vi.fn().mockResolvedValue([row('a'), row('b'), row('c')]),
      publish,
    });

    const result = await drainOutboxOnce(deps);

    expect(result).toEqual({ published: 2, failed: 1 });
    expect(publish).toHaveBeenCalledTimes(3);
    expect(deps.markPublished).toHaveBeenCalledWith(TENANT, 'b');
    expect(deps.markPublished).toHaveBeenCalledWith(TENANT, 'c');
  });

  it('repassa o limite pro fetch', async () => {
    const deps = fakeDeps();

    await drainOutboxOnce(deps, 10);

    expect(deps.fetchPending).toHaveBeenCalledWith(10);
  });

  it('erro que não é Error vira string na mensagem registrada', async () => {
    const deps = fakeDeps({
      fetchPending: vi.fn().mockResolvedValue([row('a')]),
      publish: vi.fn().mockRejectedValue('falha crua'),
    });

    await drainOutboxOnce(deps);

    expect(deps.markFailed).toHaveBeenCalledWith(TENANT, 'a', 'falha crua');
  });
});
