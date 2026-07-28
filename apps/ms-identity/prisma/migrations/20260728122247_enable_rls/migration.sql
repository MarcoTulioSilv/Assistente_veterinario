-- Row-Level Security -- multitenancy (ADR-001 5.2 / RNF-SEG-004)
--
-- Superusuarios IGNORAM RLS. O runtime deve conectar como
-- vetequine_app, nunca como vetequine.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_users ON "users";
CREATE POLICY tenant_isolation_users ON "users"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "veterinarians" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_veterinarians ON "veterinarians";
CREATE POLICY tenant_isolation_veterinarians ON "veterinarians"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "owners" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_owners ON "owners";
CREATE POLICY tenant_isolation_owners ON "owners"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_properties ON "properties";
CREATE POLICY tenant_isolation_properties ON "properties"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "property_owners" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_property_owners ON "property_owners";
CREATE POLICY tenant_isolation_property_owners ON "property_owners"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "animals" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_animals ON "animals";
CREATE POLICY tenant_isolation_animals ON "animals"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "animal_transfers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_animal_transfers ON "animal_transfers";
CREATE POLICY tenant_isolation_animal_transfers ON "animal_transfers"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit_log ON "audit_log";
CREATE POLICY tenant_isolation_audit_log ON "audit_log"
  USING (tenant_id = current_tenant_id());

-- NOTA: "tenants" NAO tem RLS de proposito.
-- E a raiz da hierarquia, consultada no login antes de existir
-- contexto de tenant. Acesso controlado pelo AuthService.