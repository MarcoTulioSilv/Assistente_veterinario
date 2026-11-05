import { Router } from 'express';
import { RouteService } from '../services/route.service';
import { OsrmRouteAdapter } from '../adapters/osrm-route-adapter';
import { validate } from '../schemas/validate';
import { getRouteSchema, type GetRouteInput } from '../schemas/geo.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 */
export const geoRouter = Router();

// Injeção de dependências — OsrmRouteAdapter é o RouteAdapter real (OSRM,
// servidor público, sem API key -- Google Maps está bloqueado neste
// projeto, reunião 2026-11-03; ver adapters/route-adapter.ts).
// MockRouteAdapter segue existindo pros testes.
const service = new RouteService(new OsrmRouteAdapter());

/**
 * Km automático do orçamento (reunião 20/10 e 2026-11-03). 503 quando a
 * rota está indisponível agora (API fora, sem rota de carro): a tela volta
 * a pedir o km à mão, não é um erro do cliente.
 */
geoRouter.get('/route', validate(getRouteSchema, 'query'), async (req, res, next) => {
  try {
    const { originLat, originLng, destinationLat, destinationLng } = req.query as never as GetRouteInput;
    const result = await service.distance(
      { latitude: originLat, longitude: originLng },
      { latitude: destinationLat, longitude: destinationLng },
    );
    if (!result) {
      res.status(503).json({ code: 'EXTERNAL_SERVICE_ERROR', message: 'Rota indisponível agora' });
      return;
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
});
