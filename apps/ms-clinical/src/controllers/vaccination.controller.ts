import { Router } from 'express';
import { VaccinationRepository } from '../repositories/vaccination.repository';
import { VaccinationService } from '../services/vaccination.service';
import { validate } from '../schemas/validate';
import { createVaccinationSchema, listVaccinationsSchema } from '../schemas/vaccination.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 *
 * Sem PATCH /:id: registrar é aplicar (decisão do Marco) — não há rascunho
 * nem edição. Pra corrigir, exclui e registra de novo (ver
 * IVaccinationService em shared-types).
 */
export const vaccinationRouter = Router();

const service = new VaccinationService(new VaccinationRepository());

vaccinationRouter.get('/', validate(listVaccinationsSchema, 'query'), async (req, res, next) => {
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

/** RF-VAC-004: próxima dose de cada vacina do animal — indicador na tela do animal. */
vaccinationRouter.get('/boosters/:animalId', async (req, res, next) => {
  try {
    res.json(await service.listBoostersByAnimal(req.ctx, req.params.animalId as string));
  } catch (e) {
    next(e);
  }
});

vaccinationRouter.get('/:id', async (req, res, next) => {
  try {
    const vaccination = await service.findById(req.ctx, req.params.id as string);
    if (!vaccination) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Vacinação não encontrada' });
      return;
    }
    res.json(vaccination);
  } catch (e) {
    next(e);
  }
});

/** RF-VAC-001/002/003: registra a aplicação (da clínica ou externa) — registrar é aplicar. */
vaccinationRouter.post('/', validate(createVaccinationSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.ctx, req.body));
  } catch (e) {
    next(e);
  }
});

vaccinationRouter.delete('/:id', async (req, res, next) => {
  try {
    await service.softDelete(req.ctx, req.params.id as string);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
