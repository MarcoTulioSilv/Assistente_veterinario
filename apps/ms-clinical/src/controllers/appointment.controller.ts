import { Router } from 'express';
import { AppointmentRepository } from '../repositories/appointment.repository';
import { AppointmentService } from '../services/appointment.service';
import { validate } from '../schemas/validate';
import {
  createAppointmentSchema,
  updateAppointmentSchema,
  listAppointmentsSchema,
} from '../schemas/appointment.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 */
export const appointmentRouter = Router();

const service = new AppointmentService(new AppointmentRepository());

appointmentRouter.get('/', validate(listAppointmentsSchema, 'query'), async (req, res, next) => {
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

appointmentRouter.get('/:id', async (req, res, next) => {
  try {
    const appointment = await service.findById(req.ctx, req.params.id as string);
    if (!appointment) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Atendimento não encontrado' });
      return;
    }
    res.json(appointment);
  } catch (e) {
    next(e);
  }
});

appointmentRouter.post('/', validate(createAppointmentSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.ctx, req.body));
  } catch (e) {
    next(e);
  }
});

appointmentRouter.patch('/:id', validate(updateAppointmentSchema), async (req, res, next) => {
  try {
    res.json(await service.update(req.ctx, req.params.id as string, req.body));
  } catch (e) {
    next(e);
  }
});

/** RF-ATD-008 + RN-003: congela o orçamento, publica appointment.done (via outbox). */
appointmentRouter.post('/:id/finish', async (req, res, next) => {
  try {
    res.json(await service.finish(req.ctx, req.params.id as string));
  } catch (e) {
    next(e);
  }
});

appointmentRouter.delete('/:id', async (req, res, next) => {
  try {
    await service.softDelete(req.ctx, req.params.id as string);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
