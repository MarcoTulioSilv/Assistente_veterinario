import type { ReportPeriod } from '@quironequine/shared-types';
import { AppError } from './errors';

/** Maior período de um relatório: 24 meses, com folga para meses de 31 dias. */
export const MAX_REPORT_DAYS = 731;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Período [from, to) de relatório (RF-REL-001/003/005) já validado: datas
 * ISO válidas, início antes do fim e no máximo 24 meses — o teto protege
 * as agregações de varrer anos de dados por engano. Usado pelo MS3 e pelo MS6.
 */
export function parseReportPeriod(period: ReportPeriod): { from: Date; to: Date } {
  const from = new Date(period.from);
  const to = new Date(period.to);
  const details: Array<{ field: string; message: string }> = [];
  if (Number.isNaN(from.getTime())) details.push({ field: 'from', message: 'Data inválida' });
  if (Number.isNaN(to.getTime())) details.push({ field: 'to', message: 'Data inválida' });
  if (details.length === 0) {
    if (to <= from) details.push({ field: 'to', message: 'O fim deve ser depois do início' });
    else if (to.getTime() - from.getTime() > MAX_REPORT_DAYS * DAY_MS) {
      details.push({ field: 'to', message: 'Período de no máximo 24 meses' });
    }
  }
  if (details.length > 0) throw AppError.validation('Período inválido', details);
  return { from, to };
}
