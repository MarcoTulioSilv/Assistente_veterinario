import { Router } from 'express';
import { AnimalRepository } from '../repositories/animal.repository';
import { AnimalService } from '../services/animal.service';
import { validate } from '../schemas/validate';
import {
  createAnimalSchema,
  updateAnimalSchema,
  listAnimalsSchema,
  transferAnimalSchema,
} from '../schemas/animal.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 */
export const animalRouter = Router();

// Injeção de dependências
const service = new AnimalService(new AnimalRepository());

animalRouter.get('/', validate(listAnimalsSchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.list(req.ctx, req.query as never));
  } catch (e) {
    next(e);
  }
});

animalRouter.get('/:id', async (req, res, next) => {
  try {
    const animal = await service.findById(req.ctx, req.params.id as string);
    if (!animal) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Animal não encontrado' });
      return;
    }
    res.json(animal);
  } catch (e) {
    next(e);
  }
});

animalRouter.post('/', validate(createAnimalSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.ctx, req.body));
  } catch (e) {
    next(e);
  }
});

animalRouter.patch('/:id', validate(updateAnimalSchema), async (req, res, next) => {
  try {
    res.json(await service.update(req.ctx, req.params.id as string, req.body));
  } catch (e) {
    next(e);
  }
});

animalRouter.delete('/:id', async (req, res, next) => {
  try {
    await service.softDelete(req.ctx, req.params.id as string);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

/** RN-010: preserva histórico integralmente */
animalRouter.post('/:id/transfer', validate(transferAnimalSchema), async (req, res, next) => {
  try {
    const { toPropertyId, notes } = req.body;
    res.json(await service.transfer(req.ctx, req.params.id as string, toPropertyId, notes));
  } catch (e) {
    next(e);
  }
});
