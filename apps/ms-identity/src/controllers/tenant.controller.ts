import { Router } from 'express';
import { TenantRepository } from '../repositories/tenant.repository';
import { TenantService } from '../services/tenant.service';
import { validate } from '../schemas/validate';
import { registerTenantSchema, updateVeterinarianSchema } from '../schemas/tenant.schema';
import type { RegisterTenantInput, UpdateVeterinarianInput } from '../schemas/tenant.schema';

/**
 * Camada HTTP — RF-CAD-030 / UC-CAD-04. Dois routers porque o recurso mistura
 * rota pública (registro de um tenant novo) com protegida (perfil do próprio
 * tenant) — mesmo padrão de app.ts que separa /health+/auth de /owners.
 *
 * NOTA PARA O JOÃO: isto é uma fatia funcional mínima (backend), não a versão
 * final do Controller — a tela de cadastro no PWA e qualquer validação extra
 * de UX ficam por sua conta. logoUrl ainda não tem upload real (S3/R2).
 */
const service = new TenantService(new TenantRepository());

export const tenantRegisterRouter = Router();

tenantRegisterRouter.post('/', validate(registerTenantSchema), async (req, res, next) => {
  try {
    const data = req.body as RegisterTenantInput;
    res.status(201).json(await service.register(data));
  } catch (e) {
    next(e);
  }
});

export const tenantRouter = Router();

tenantRouter.get('/me', async (req, res, next) => {
  try {
    res.json(await service.getMyProfile(req.ctx));
  } catch (e) {
    next(e);
  }
});

tenantRouter.patch('/me', validate(updateVeterinarianSchema), async (req, res, next) => {
  try {
    const data = req.body as UpdateVeterinarianInput;
    res.json(await service.updateVeterinarianProfile(req.ctx, data));
  } catch (e) {
    next(e);
  }
});
