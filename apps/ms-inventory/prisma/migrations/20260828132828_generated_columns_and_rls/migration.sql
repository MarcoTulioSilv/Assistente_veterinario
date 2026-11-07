-- ══════════════════════════════════════════════════════════════════
-- MS2 — Coluna GENERATED + Row-Level Security
-- RN-004: Valor de Venda = Custo × (1 + Acréscimo / 100)
-- O banco calcula automaticamente — nunca sai de sincronia com o código
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN sale_price_cents INTEGER
  GENERATED ALWAYS AS (
    ROUND(cost_price_cents * (1 + markup_percent / 100.0))::INTEGER
  ) STORED;

-- ─── RLS ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_products ON products
  USING (tenant_id = current_tenant_id());

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_stock_movements ON stock_movements
  USING (tenant_id = current_tenant_id());

ALTER TABLE alert_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_alert_configs ON alert_configs
  USING (tenant_id = current_tenant_id());
