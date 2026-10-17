import type { Appointment } from '@quironequine/shared-types';

export const TYPE_LABELS: Record<Appointment['type'], string> = {
  clinico_geral: 'Clínico geral',
  reproducao: 'Reprodução',
  odontologico: 'Odontológico',
  locomotor: 'Locomotor',
  cirurgia: 'Cirurgia',
};

export const STATUS_LABELS: Record<Appointment['status'], string> = {
  draft: 'Rascunho',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
};
