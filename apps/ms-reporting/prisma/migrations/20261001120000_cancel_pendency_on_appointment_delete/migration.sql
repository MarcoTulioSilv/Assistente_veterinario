-- ══════════════════════════════════════════════════════════════════
-- MS6 — Cancelamento de pendência na exclusão do atendimento
--
-- Regra (decisão do Marco, 2026-10-01): atendimento FINALIZADO pode ser
-- excluído, e a exclusão cancela a pendência financeira. Pagamento já
-- recebido nunca é cancelado.
--
-- A UNIQUE em (source_type, source_id) substitui o índice comum que
-- existia: uma origem tem no máximo um registro. É ela que torna a
-- exclusão independente da ordem de chegada dos eventos — se
-- `appointment.deleted` for processado antes do `appointment.done`
-- (retry do broker), a origem já fica gravada como cancelada e a
-- pendência não consegue nascer órfã depois.
--
-- Escrita à mão: `prisma migrate dev` não roda em modo não interativo
-- quando o diff adiciona UNIQUE (pede confirmação). Conferida contra o
-- schema.prisma com `prisma migrate diff` depois de aplicada.
-- ══════════════════════════════════════════════════════════════════

ALTER TYPE "PaymentStatus" ADD VALUE 'cancelled';

ALTER TABLE "financial_records" ADD COLUMN "cancelled_at" TIMESTAMPTZ;

DROP INDEX "financial_records_source_type_source_id_idx";

CREATE UNIQUE INDEX "financial_records_source_type_source_id_key"
  ON "financial_records"("source_type", "source_id");
