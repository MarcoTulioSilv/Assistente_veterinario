import { createServiceLogger } from '@quironequine/shared-middlewares';
import {
  fetchPendingOutbox,
  markOutboxPublished,
  markOutboxFailed,
} from '../repositories/outbox.repository';
import { drainOutboxOnce } from '../services/outbox-relay.service';
import { publishDomainEvent } from './publisher';

const log = createServiceLogger('outbox-relay');

const DEFAULT_INTERVAL_MS = 5000;

/**
 * Plumbing do relay — sem lógica própria, tudo que decide o que fazer
 * está em services/outbox-relay.service.ts (testável sem broker e sem
 * banco).
 *
 * É um `setInterval`, e não um job repetível do BullMQ, por um motivo
 * que importa: o relay existe justamente para sobreviver ao broker estar
 * fora do ar. Se o gatilho dele morasse no próprio BullMQ, Redis fora =
 * relay não dispara = os eventos acumulados nunca seriam drenados,
 * inclusive depois do Redis voltar. O agendamento tem que ser
 * independente daquilo que ele conserta.
 *
 * Um ciclo nunca se sobrepõe ao anterior: o timer só é rearmado quando o
 * ciclo termina.
 */
export function startOutboxRelay(intervalMs = DEFAULT_INTERVAL_MS): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    try {
      await drainOutboxOnce({
        fetchPending: fetchPendingOutbox,
        publish: publishDomainEvent,
        markPublished: markOutboxPublished,
        markFailed: markOutboxFailed,
      });
    } catch (err) {
      // Falha do ciclo inteiro (ex.: banco fora do ar). Não derruba o
      // relay — tenta de novo no próximo intervalo.
      log.error({ err }, 'Ciclo do outbox falhou por inteiro');
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
