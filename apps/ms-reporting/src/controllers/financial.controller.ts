import { Router } from 'express';
import { FinancialRepository } from '../repositories/financial.repository';
import { FinancialService } from '../services/financial.service';
import { publishDomainEvent } from '../events/publisher';
import { validate } from '../schemas/validate';
import { listFinancialRecordsSchema, findBySourceParamsSchema } from '../schemas/financial.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 * Sem POST /: pendência nasce só de evento do broker (recordPending),
 * nunca de digitação direta (ver IFinancialService).
 */
export const financialRouter = Router();

const service = new FinancialService(new FinancialRepository(), publishDomainEvent);

financialRouter.get('/', validate(listFinancialRecordsSchema, 'query'), async (req, res, next) => {
  try {
    const { ownerId, ...params } = req.query as never as { ownerId?: string } & Record<string, unknown>;
    const result = ownerId
      ? await service.listByOwner(req.ctx, ownerId, params as never)
      : await service.list(req.ctx, params as never);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/** RF-ATD-008: pendência de uma origem específica (atendimento/exame/vacinação). */
financialRouter.get(
  '/by-source/:sourceType/:sourceId',
  validate(findBySourceParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const { sourceType, sourceId } = req.params as never as { sourceType: 'appointment' | 'exam' | 'vaccination'; sourceId: string };
      const record = await service.findBySource(req.ctx, sourceType, sourceId);
      if (!record) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Nenhuma pendência para esta origem' });
        return;
      }
      res.json(record);
    } catch (e) {
      next(e);
    }
  },
);

/** RN-002: única transição pending -> received. */
financialRouter.post('/:id/register-payment', async (req, res, next) => {
  try {
    res.json(await service.registerPayment(req.ctx, req.params.id as string));
  } catch (e) {
    next(e);
  }
});
