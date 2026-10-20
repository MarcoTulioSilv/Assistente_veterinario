import { Router } from 'express';
import { RouteService } from '../services/route.service';
import { GoogleRouteAdapter } from '../adapters/google-route-adapter';
import { validate } from '../schemas/validate';
import { getRouteSchema, type GetRouteInput } from '../schemas/geo.schema';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Só trata protocolo: parse, validação, status code. Zero lógica de negócio.
 */
export const geoRouter = Router();

// Injeção de dependências — GoogleRouteAdapter é o RouteAdapter real
// (ver adapters/google-route-adapter.ts; MockRouteAdapter em
// route-adapter.ts segue existindo pros testes). Sem GOOGLE_MAPS_API_KEY,
// o próprio adapter devolve null (rota indisponível) sem chamar a API —
// não precisa de um branch condicional pro Mock aqui.
const service = new RouteService(new GoogleRouteAdapter(process.env['GOOGLE_MAPS_API_KEY'] ?? ''));

/**
 * Km automático do orçamento (reunião 20/10/2026). O cálculo fica no
 * servidor de propósito — a chave do Google nunca vai para o navegador.
 * 503 quando a rota está indisponível agora (API fora, sem rota de carro,
 * chave ausente): a tela volta a pedir o km à mão, não é um erro do cliente.
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
