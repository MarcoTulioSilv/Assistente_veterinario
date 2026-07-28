import { Router } from 'express';
import { OwnerRepository } from '../repositories/owner.repository';
import { OwnerService } from '../services/owner.service';
import { PlanService } from '../services/plan.service';
import { validate } from '../schemas/validate';
import {
  createOwnerSchema,
  updateOwnerSchema,
  listOwnersSchema,
} from '../schemas/owner.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 */
export const ownerRouter = Router();

// Injeção de dependências — trocar por MockOwnerService quando necessário
const service = new OwnerService(new OwnerRepository(), new PlanService());

ownerRouter.get('/', validate(listOwnersSchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.list(req.ctx, req.query as never));
  } catch (e) {
    next(e);
  }
});

ownerRouter.get('/:id', async (req, res, next) => {
  try {
    const owner = await service.findById(req.ctx, req.params.id as string);
    if (!owner) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Proprietário não encontrado' });
      return;
    }
    res.json(owner);
  } catch (e) {
    next(e);
  }
});

ownerRouter.post('/', validate(createOwnerSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.ctx, req.body));
  } catch (e) {
    next(e);
  }
});

ownerRouter.patch('/:id', validate(updateOwnerSchema), async (req, res, next) => {
  try {
    res.json(await service.update(req.ctx, req.params.id as string, req.body));
  } catch (e) {
    next(e);
  }
});

ownerRouter.delete('/:id', async (req, res, next) => {
  try {
    await service.softDelete(req.ctx, req.params.id as string);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
