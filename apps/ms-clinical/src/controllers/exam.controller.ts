import { Router } from 'express';
import { ExamRepository } from '../repositories/exam.repository';
import { ExamTypeRepository } from '../repositories/exam-type.repository';
import { ExamService } from '../services/exam.service';
import { validate } from '../schemas/validate';
import {
  createExamRequestSchema,
  updateExamRequestSchema,
  listExamRequestsSchema,
  registerExamCollectionSchema,
  attachResultSchema,
} from '../schemas/exam.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 */
export const examRouter = Router();

const service = new ExamService(new ExamRepository(), new ExamTypeRepository());

examRouter.get('/', validate(listExamRequestsSchema, 'query'), async (req, res, next) => {
  try {
    const { animalId, ...params } = req.query as never as { animalId?: string; page: number; limit: number };
    const result = animalId
      ? await service.listByAnimal(req.ctx, animalId, params)
      : await service.list(req.ctx, params);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

examRouter.get('/:id', async (req, res, next) => {
  try {
    const exam = await service.findById(req.ctx, req.params.id as string);
    if (!exam) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Pedido de exame não encontrado' });
      return;
    }
    res.json(exam);
  } catch (e) {
    next(e);
  }
});

examRouter.post('/', validate(createExamRequestSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.ctx, req.body));
  } catch (e) {
    next(e);
  }
});

examRouter.patch('/:id', validate(updateExamRequestSchema), async (req, res, next) => {
  try {
    res.json(await service.update(req.ctx, req.params.id as string, req.body));
  } catch (e) {
    next(e);
  }
});

/** draft -> requested (RF-EXM-001). */
examRouter.post('/:id/issue', async (req, res, next) => {
  try {
    res.json(await service.issue(req.ctx, req.params.id as string));
  } catch (e) {
    next(e);
  }
});

/** requested -> collected (RF-EXM-006: fecha a cobrança se o vet coletou). */
examRouter.post(
  '/:id/collection',
  validate(registerExamCollectionSchema),
  async (req, res, next) => {
    try {
      res.json(await service.registerCollection(req.ctx, req.params.id as string, req.body));
    } catch (e) {
      next(e);
    }
  },
);

/** requested | collected -> in_analysis. */
examRouter.post('/:id/send-to-analysis', async (req, res, next) => {
  try {
    res.json(await service.sendToAnalysis(req.ctx, req.params.id as string));
  } catch (e) {
    next(e);
  }
});

/** RF-EXM-005: anexa o laudo (PDF — ver uploads no ms-identity) e vai pra result_available. */
examRouter.post('/:id/result', validate(attachResultSchema), async (req, res, next) => {
  try {
    const { resultFileUrl } = req.body as { resultFileUrl: string };
    res.json(await service.attachResult(req.ctx, req.params.id as string, resultFileUrl));
  } catch (e) {
    next(e);
  }
});

examRouter.delete('/:id', async (req, res, next) => {
  try {
    await service.softDelete(req.ctx, req.params.id as string);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
