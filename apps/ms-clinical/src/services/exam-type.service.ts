import type { IExamTypeService, RequestContext, UUID, Paginated, ExamType } from '@quironequine/shared-types';
import { AppError } from '@quironequine/shared-middlewares';
import type { ExamTypeRepository } from '../repositories/exam-type.repository';
import type { CreateExamTypeInput, UpdateExamTypeInput, ListExamTypesInput } from '../schemas/exam.schema';

/**
 * Catálogo de tipos de exame da clínica — Dev 1 é o dono.
 * Implementa a interface IExamTypeService publicada em shared-types.
 *
 * O catálogo começa vazio: nada é semeado (decisão do Marco — uma clínica
 * pode prestar um serviço só). As sugestões ficam em EXAM_TYPE_SUGGESTIONS,
 * no PWA. A forma dos campos do protocolo já chega validada pelo schema Zod.
 */
export class ExamTypeService implements IExamTypeService {
  constructor(private readonly repo: ExamTypeRepository) {}

  async list(ctx: RequestContext, params: ListExamTypesInput): Promise<Paginated<ExamType>> {
    return this.repo.list(ctx, params);
  }

  async findById(ctx: RequestContext, id: UUID): Promise<ExamType | null> {
    return this.repo.findById(ctx, id);
  }

  async create(ctx: RequestContext, data: CreateExamTypeInput): Promise<ExamType> {
    return this.repo.create(ctx, data);
  }

  /** Não mexe nos pedidos já criados: cada um guarda a própria cópia dos campos. */
  async update(ctx: RequestContext, id: UUID, data: UpdateExamTypeInput): Promise<ExamType> {
    await this.requireExisting(ctx, id);
    return this.repo.update(ctx, id, data);
  }

  /**
   * Soft delete: some do catálogo, mas os pedidos que já apontam pra ele
   * continuam inteiros (snapshot + FK pra linha que nunca é apagada).
   */
  async softDelete(ctx: RequestContext, id: UUID): Promise<void> {
    await this.requireExisting(ctx, id);
    await this.repo.softDelete(ctx, id);
  }

  private async requireExisting(ctx: RequestContext, id: UUID): Promise<ExamType> {
    const existing = await this.repo.findById(ctx, id);
    if (!existing) throw AppError.notFound('Tipo de exame não encontrado');
    return existing;
  }
}
