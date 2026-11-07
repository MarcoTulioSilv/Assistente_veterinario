-- ══════════════════════════════════════════════════════════════════
-- MS3 — Row-Level Security
--
-- ADR-001 §5.2 / RNF-SEG-004: o isolamento entre tenants é do banco,
-- não do código. Todo repository entra por withTenant(), que faz
-- set_config('app.current_tenant', ...) dentro da transação; a policy
-- abaixo filtra as linhas a partir daí.
--
-- Vale só pra roles comuns: superusuário IGNORA RLS. Por isso o runtime
-- conecta como quironequine_app (infra/postgres-init/01-create-app-role.sql),
-- nunca como quironequine.
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_appointments ON appointments
  USING (tenant_id = current_tenant_id());

ALTER TABLE medical_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_medical_records ON medical_records
  USING (tenant_id = current_tenant_id());

ALTER TABLE appointment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_appointment_items ON appointment_items
  USING (tenant_id = current_tenant_id());

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_prescriptions ON prescriptions
  USING (tenant_id = current_tenant_id());
