-- ══════════════════════════════════════════════════════════════════
-- MS4 — Lembretes da agenda (RF-AGD-004)
--
-- O job de lembretes roda a cada 5 min e precisa ver os eventos de TODOS
-- os tenants. Mesmo padrão do ADR-004/006 e dos lembretes do MS3
-- (clinical_list_exams_result_due): função SECURITY DEFINER estreita, que
-- devolve só o necessário para montar o evento — nunca um cliente Prisma
-- que contorne o RLS. Sem `notes` (observação livre pode ter dado pessoal).
--
-- Recebe uma JANELA [from_ts, to_ts) do instante do lembrete
-- (starts_at − minutos). Desdobra os lembretes de cada evento com unnest.
-- ══════════════════════════════════════════════════════════════════

-- A varredura é entre tenants: o índice (tenant_id, starts_at) não ajuda.
-- Parcial, só com o que pode gerar lembrete.
CREATE INDEX "schedule_events_reminder_scan"
  ON "schedule_events" ("starts_at")
  WHERE status = 'scheduled' AND deleted_at IS NULL AND cardinality(reminder_minutes_before) > 0;

CREATE OR REPLACE FUNCTION scheduling_list_reminders_due(from_ts TIMESTAMPTZ, to_ts TIMESTAMPTZ)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  activity_type TEXT,
  starts_at TIMESTAMPTZ,
  minutes_before INTEGER,
  owner_id UUID,
  property_id UUID,
  created_by UUID
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.tenant_id, e.activity_type::text, e.starts_at, r.minutes_before,
         e.owner_id, e.property_id, e.created_by
  FROM schedule_events e
  CROSS JOIN LATERAL unnest(e.reminder_minutes_before) AS r(minutes_before)
  WHERE e.status = 'scheduled'
    AND e.deleted_at IS NULL
    AND cardinality(e.reminder_minutes_before) > 0
    -- Recorte pelo índice: o lembrete mais antecipado é de 7 dias.
    AND e.starts_at >= from_ts
    AND e.starts_at < to_ts + INTERVAL '7 days'
    AND e.starts_at - make_interval(mins => r.minutes_before) >= from_ts
    AND e.starts_at - make_interval(mins => r.minutes_before) < to_ts;
$$;

REVOKE ALL ON FUNCTION scheduling_list_reminders_due(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
-- GRANT EXECUTE para quironequine_app fica em infra/postgres-init/01-create-app-role.sql,
-- que roda depois das migrations (mesmo padrão do ADR-004/006).
