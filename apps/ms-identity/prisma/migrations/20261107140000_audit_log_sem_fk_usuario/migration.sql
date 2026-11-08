-- Trilha de auditoria (auditoria 06/11/2026, M-06): o audit_log não pode
-- perder a autoria quando um usuário for apagado (a FK era ON DELETE SET NULL).
-- user_id fica sem FK, como no audit_log do MS3 e do MS6.

-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_fkey";

