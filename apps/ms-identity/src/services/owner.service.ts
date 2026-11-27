import type {
  IOwnerService,
  RequestContext,
  UUID,
  Paginated,
  Owner,
} from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { OwnerRepository } from '../repositories/owner.repository';
import type { PlanService } from './plan.service';
import type { CreateOwnerInput, UpdateOwnerInput, ListOwnersInput } from '../schemas/owner.schema';
import { parseCpfCnpj } from '../lib/document';

/**
 * Transição do documento: o campo novo é `cpfCnpj`; o `cpf` antigo continua
 * aceito até a PWA migrar (pedidos-para-joao.md). Se vierem os dois, vale o
 * novo.
 */
type WithDocument<T> = Omit<T, 'cpf'> & { cpf?: string; cpfCnpj?: string };
export type CreateOwnerRequest = WithDocument<CreateOwnerInput>;
export type UpdateOwnerRequest = WithDocument<UpdateOwnerInput>;

/**
 * Lógica de negócio — Dev 1 é o dono.
 * Implementa a interface IOwnerService publicada em shared-types.
 * Dev 2 pode usar MockOwnerService com a mesma interface enquanto isto não existe.
 */
export class OwnerService implements IOwnerService {
  constructor(
    private readonly repo: OwnerRepository,
    private readonly plans: PlanService,
  ) {}

  async list(ctx: RequestContext, params: ListOwnersInput): Promise<Paginated<Owner>> {
    return this.repo.list(ctx, params);
  }

  async findById(ctx: RequestContext, id: UUID): Promise<Owner | null> {
    return this.repo.findById(ctx, id);
  }

  async create(ctx: RequestContext, data: CreateOwnerRequest): Promise<Owner> {
    // Plano Básico: limite de 30 proprietários (ERS §2.6). A contagem acontece
    // sob a trava, na transação da gravação (auditoria B-01).
    return this.repo.create(ctx, withCanonicalDocument(data), (current) => this.plans.assertOwnerLimit(ctx, current));
  }

  async update(ctx: RequestContext, id: UUID, data: UpdateOwnerRequest): Promise<Owner> {
    const document = withCanonicalDocument(data); // 422 antes de procurar o registro
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Proprietário não encontrado');
    return this.repo.update(ctx, id, document);
  }

  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Proprietário não encontrado');
    await this.repo.softDelete(ctx, id);
  }
}

/**
 * Troca `cpf`/`cpfCnpj` pelo documento validado, no formato canônico — é o
 * que faz o UNIQUE da clínica pegar o mesmo documento escrito de outro jeito.
 */
function withCanonicalDocument<T extends { cpf?: string; cpfCnpj?: string }>(
  data: T,
): Omit<T, 'cpf' | 'cpfCnpj'> & { cpfCnpj?: string } {
  const { cpf, cpfCnpj, ...rest } = data;
  const informed = cpfCnpj ?? cpf;
  if (informed === undefined) return rest;

  const parsed = parseCpfCnpj(informed);
  if (!parsed) {
    throw AppError.validation('CPF ou CNPJ inválido', [
      { field: 'cpfCnpj', message: 'Informe um CPF ou CNPJ válido (o CNPJ pode ter letras)' },
    ]);
  }
  return { ...rest, cpfCnpj: parsed.formatted };
}
