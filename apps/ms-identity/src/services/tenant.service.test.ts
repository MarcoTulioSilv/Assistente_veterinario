import { describe, it, expect, vi } from 'vitest';
import { TenantService } from './tenant.service';
import type { TenantRepository } from '../repositories/tenant.repository';
import type { RequestContext, TenantProfile, RegisterTenantDto } from '@vetequine/shared-types';

const TENANT_ID = '66666666-6666-6666-6666-666666666666';
const USER_ID = '77777777-7777-7777-7777-777777777777';
const VET_ID = '88888888-8888-8888-8888-888888888888';

const registerInput: RegisterTenantDto = {
  fullName: 'Dra. Ana Souza',
  crmv: '12345',
  crmvState: 'GO',
  cpfCnpj: '123.456.789-00',
  phone: '(64) 99999-1234',
  email: 'ana@vetequine.com.br',
  password: 'senha-do-cadastro-123',
};

const profile: TenantProfile = {
  tenantId: TENANT_ID,
  tenantName: registerInput.fullName,
  plan: 'basic',
  status: 'active',
  veterinarian: {
    id: VET_ID,
    userId: USER_ID,
    fullName: registerInput.fullName,
    crmv: registerInput.crmv,
    crmvState: registerInput.crmvState,
    cpfCnpj: registerInput.cpfCnpj,
    phone: registerInput.phone,
    email: registerInput.email,
    logoUrl: null,
  },
};

const ctx = (role: 'admin' | 'assistant' = 'admin'): RequestContext => ({
  tenantId: TENANT_ID,
  userId: USER_ID,
  role,
  plan: 'basic',
  traceId: 'test-trace',
});

function fakeRepo(overrides: Partial<TenantRepository> = {}): TenantRepository {
  return {
    register: vi.fn().mockResolvedValue({ tenantId: TENANT_ID, userId: USER_ID, veterinarianId: VET_ID }),
    findProfile: vi.fn().mockResolvedValue(profile),
    updateVeterinarian: vi.fn().mockResolvedValue(profile),
    ...overrides,
  } as unknown as TenantRepository;
}

describe('TenantService.register', () => {
  it('nunca passa a senha crua pro repositório — só o hash', async () => {
    const register = vi.fn().mockResolvedValue({ tenantId: TENANT_ID, userId: USER_ID, veterinarianId: VET_ID });
    const service = new TenantService(fakeRepo({ register }));

    await service.register(registerInput);

    expect(register).toHaveBeenCalledTimes(1);
    const [, passwordHash] = register.mock.calls[0] as [unknown, string];
    expect(passwordHash).not.toBe(registerInput.password);
    expect(passwordHash.startsWith('$2')).toBe(true); // formato bcrypt
  });

  it('retorna o TenantProfile lido logo após o registro', async () => {
    const service = new TenantService(fakeRepo());
    await expect(service.register(registerInput)).resolves.toEqual(profile);
  });
});

describe('TenantService.getMyProfile', () => {
  it('rejeita quando o tenant não é encontrado', async () => {
    const service = new TenantService(fakeRepo({ findProfile: vi.fn().mockResolvedValue(null) }));
    await expect(service.getMyProfile(ctx())).rejects.toThrow(/não encontrado/);
  });

  it('retorna o perfil do próprio tenant', async () => {
    const service = new TenantService(fakeRepo());
    await expect(service.getMyProfile(ctx())).resolves.toEqual(profile);
  });
});

describe('TenantService.updateVeterinarianProfile', () => {
  it('rejeita usuário com role diferente de admin', async () => {
    const service = new TenantService(fakeRepo());
    await expect(
      service.updateVeterinarianProfile(ctx('assistant'), { phone: '(64) 98888-0000' }),
    ).rejects.toThrow(/veterinário responsável/);
  });

  it('delega a atualização pro repositório quando role é admin', async () => {
    const updateVeterinarian = vi.fn().mockResolvedValue(profile);
    const service = new TenantService(fakeRepo({ updateVeterinarian }));

    await service.updateVeterinarianProfile(ctx('admin'), { phone: '(64) 98888-0000' });

    expect(updateVeterinarian).toHaveBeenCalledWith(TENANT_ID, USER_ID, { phone: '(64) 98888-0000' });
  });
});
