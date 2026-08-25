import { Router } from 'express';
import { PropertyRepository } from '../repositories/property.repository';
import { PropertyService } from '../services/property.service';
import { GeoService } from '../services/geo.service';
import { NominatimMapsAdapter } from '../adapters/nominatim-maps-adapter';
import { validate } from '../schemas/validate';
import { createPropertySchema, updatePropertySchema, listPropertiesSchema } from '../schemas/property.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 */
export const propertyRouter = Router();

// Injeção de dependências — NominatimMapsAdapter é o MapsAdapter real
// (ver adapters/nominatim-maps-adapter.ts; MockMapsAdapter em maps-adapter.ts
// segue existindo pros testes).
const service = new PropertyService(new PropertyRepository(), new GeoService(new NominatimMapsAdapter()));

propertyRouter.get('/', validate(listPropertiesSchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.list(req.ctx, req.query as never));
  } catch (e) {
    next(e);
  }
});

propertyRouter.get('/:id', async (req, res, next) => {
  try {
    const property = await service.findById(req.ctx, req.params.id as string);
    if (!property) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Propriedade não encontrada' });
      return;
    }
    res.json(property);
  } catch (e) {
    next(e);
  }
});

propertyRouter.post('/', validate(createPropertySchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.ctx, req.body));
  } catch (e) {
    next(e);
  }
});

propertyRouter.patch('/:id', validate(updatePropertySchema), async (req, res, next) => {
  try {
    res.json(await service.update(req.ctx, req.params.id as string, req.body));
  } catch (e) {
    next(e);
  }
});

propertyRouter.delete('/:id', async (req, res, next) => {
  try {
    await service.softDelete(req.ctx, req.params.id as string);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
