import { Router } from 'express';
import { ProductRepository } from '../repositories/product.repository';
import { MovementRepository } from '../repositories/movement.repository';
import { StockService } from '../services/stock.service';
import { validate } from '../schemas/validate';
import { createProductSchema, updateProductSchema, listProductsSchema } from '../schemas/product.schema';
import { createMovementSchema, listMovementsSchema } from '../schemas/movement.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 */
export const productRouter = Router();

const service = new StockService(new ProductRepository(), new MovementRepository());

productRouter.get('/', validate(listProductsSchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.list(req.ctx, req.query as never));
  } catch (e) {
    next(e);
  }
});

productRouter.get('/:id', async (req, res, next) => {
  try {
    const product = await service.findById(req.ctx, req.params.id as string);
    if (!product) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Produto não encontrado' });
      return;
    }
    res.json(product);
  } catch (e) {
    next(e);
  }
});

productRouter.post('/', validate(createProductSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.ctx, req.body));
  } catch (e) {
    next(e);
  }
});

productRouter.patch('/:id', validate(updateProductSchema), async (req, res, next) => {
  try {
    res.json(await service.update(req.ctx, req.params.id as string, req.body));
  } catch (e) {
    next(e);
  }
});

productRouter.delete('/:id', async (req, res, next) => {
  try {
    await service.softDelete(req.ctx, req.params.id as string);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

productRouter.get('/:id/movements', validate(listMovementsSchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.listMovements(req.ctx, req.params.id as string, req.query as never));
  } catch (e) {
    next(e);
  }
});

productRouter.post('/:id/movements', validate(createMovementSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.recordMovement(req.ctx, req.params.id as string, req.body));
  } catch (e) {
    next(e);
  }
});
