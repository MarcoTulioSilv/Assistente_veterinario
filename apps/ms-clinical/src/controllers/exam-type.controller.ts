import { Router } from 'express';
import { ExamTypeRepository } from '../repositories/exam-type.repository';
import { ExamTypeService } from '../services/exam-type.service';
import { validate } from '../schemas/validate';
import { createExamTypeSchema, updateExamTypeSchema, listExamTypesSchema } from '../schemas/exam.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 */
export const examTypeRouter = Router();

const service = new ExamTypeService(new ExamTypeRepository());

examTypeRouter.get('/', validate(listExamTypesSchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.list(req.ctx, req.query as never));
  } catch (e) {
    next(e);
  }
});

examTypeRouter.get('/:id', async (req, res, next) => {
  try {
    const type = await service.findById(req.ctx, req.params.id as string);
    if (!type) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Tipo de exame não encontrado' });
      return;
    }
    res.json(type);
  } catch (e) {
    next(e);
  }
});

examTypeRouter.post('/', validate(createExamTypeSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.ctx, req.body));
  } catch (e) {
    next(e);
  }
});

examTypeRouter.patch('/:id', validate(updateExamTypeSchema), async (req, res, next) => {
  try {
    res.json(await service.update(req.ctx, req.params.id as string, req.body));
  } catch (e) {
    next(e);
  }
});

examTypeRouter.delete('/:id', async (req, res, next) => {
  try {
    await service.softDelete(req.ctx, req.params.id as string);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
