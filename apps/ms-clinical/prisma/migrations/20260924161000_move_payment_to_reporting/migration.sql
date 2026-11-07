-- ══════════════════════════════════════════════════════════════════
-- MS3 — Situação de pagamento sai do atendimento
--
-- A migration inicial deste serviço criou payment_status/paid_at em
-- `appointments`. Isso diverge do ADR-001 §5.3, que atribui o RN-002
-- ("cria registro financeiro pendente") ao Reporting (MS6), a partir do
-- evento `appointment.done` — não ao Clinical.
--
-- A correção vem por migration, e não reescrevendo a migration inicial,
-- porque reescrever histórico já aplicado quebra silenciosamente o banco
-- local de quem já rodou a versão anterior.
--
-- A posse passa para financial_records, no MS6 (antecipado do M3 pra cá
-- justamente para o contrato nascer no lugar certo).
-- ══════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS "appointments_payment_status_idx";

ALTER TABLE "appointments"
  DROP COLUMN IF EXISTS "payment_status",
  DROP COLUMN IF EXISTS "paid_at";

DROP TYPE IF EXISTS "PaymentStatus";
