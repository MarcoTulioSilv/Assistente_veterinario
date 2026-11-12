import { describe, it, expect, vi } from 'vitest';
import type { DomainEvent } from '@quironequine/shared-types';
import type { EmailSender } from '../channels/channels';
import { AccountEmailService } from './account-email.service';

const payload = {
  userId: '22222222-2222-2222-2222-222222222222',
  email: 'vet@clinica.com.br',
  token: 'tok_en-cru+com/caracteres',
  expiresAt: '2026-12-02T13:00:00.000Z',
};

function event(name: string): DomainEvent<unknown> {
  return {
    name: name as DomainEvent['name'],
    tenantId: '11111111-1111-1111-1111-111111111111',
    traceId: 't',
    idempotencyKey: '55555555-5555-5555-5555-555555555555',
    occurredAt: '2026-12-01T13:00:00.000Z',
    payload,
  };
}

describe('AccountEmailService', () => {
  it('confirmação: link para a tela da PWA com o token codificado', async () => {
    const sendAccountEmail = vi.fn().mockResolvedValue(undefined);
    const service = new AccountEmailService({ sendAccountEmail, sendNotification: vi.fn() } as EmailSender, 'https://app.exemplo/');

    await service.handle('auth.email_verification_requested', event('auth.email_verification_requested'));

    expect(sendAccountEmail).toHaveBeenCalledWith(
      'verify_email',
      'vet@clinica.com.br',
      `https://app.exemplo/confirmar-email?token=${encodeURIComponent(payload.token)}`,
      new Date(payload.expiresAt),
    );
  });

  it('nova senha usa a tela de redefinição', async () => {
    const sendAccountEmail = vi.fn().mockResolvedValue(undefined);
    const service = new AccountEmailService({ sendAccountEmail, sendNotification: vi.fn() } as EmailSender, 'https://app.exemplo');
    await service.handle('auth.password_reset_requested', event('auth.password_reset_requested'));
    expect(sendAccountEmail.mock.calls[0]?.[2]).toMatch(/^https:\/\/app\.exemplo\/redefinir-senha\?token=/);
  });

  it('e-mail desligado: descarta sem erro', async () => {
    await expect(
      new AccountEmailService(null).handle('auth.password_reset_requested', event('auth.password_reset_requested')),
    ).resolves.toBeUndefined();
  });

  it('falha do envio propaga (o job tenta de novo)', async () => {
    const service = new AccountEmailService(
      { sendAccountEmail: vi.fn().mockRejectedValue(new Error('smtp')), sendNotification: vi.fn() } as EmailSender,
    );
    await expect(service.handle('auth.email_verification_requested', event('auth.email_verification_requested'))).rejects.toThrow('smtp');
  });

  it('evento que não é de conta é ignorado', async () => {
    const sendAccountEmail = vi.fn();
    await new AccountEmailService({ sendAccountEmail, sendNotification: vi.fn() } as EmailSender).handle('x', event('x'));
    expect(sendAccountEmail).not.toHaveBeenCalled();
  });
});
