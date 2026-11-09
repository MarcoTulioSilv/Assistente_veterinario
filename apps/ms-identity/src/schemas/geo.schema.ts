import { z } from 'zod';

/**
 * RouteService (shared-types IRouteService) já valida as coordenadas e
 * lança 422 por conta própria — aqui só garante que os 4 parâmetros vieram
 * como número (RouteService não sabe de query string, só de GeoPoint).
 */
export const getRouteSchema = z.object({
  originLat: z.coerce.number(),
  originLng: z.coerce.number(),
  destinationLat: z.coerce.number(),
  destinationLng: z.coerce.number(),
});

export type GetRouteInput = z.infer<typeof getRouteSchema>;

/** CEP com máscara (00000-000) -- mesmo formato que o PropertyForm já envia. */
export const geocodeZipSchema = z.object({
  zipCode: z.string().regex(/^\d{5}-\d{3}$/, 'CEP deve estar no formato 00000-000'),
});

export type GeocodeZipInput = z.infer<typeof geocodeZipSchema>;
