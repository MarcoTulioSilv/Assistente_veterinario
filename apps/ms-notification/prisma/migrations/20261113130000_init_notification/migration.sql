-- ══════════════════════════════════════════════════════════════════
-- MS5 — Notification: caixa de entrada, push, preferências e entregas
-- (Sprint 10 do M3, ADR-007). Gerada com `prisma migrate diff`; o RLS, no
-- fim, é escrito à mão.
-- ══════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('schedule_reminder', 'exam_result_due', 'vaccination_due', 'stock_expiry', 'stock_low', 'geofence');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('push', 'whatsapp', 'email');

-- CreateEnum
CREATE TYPE "NotificationTargetKind" AS ENUM ('schedule_event', 'exam_request', 'vaccination', 'product', 'property');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "data" JSONB NOT NULL,
    "target_kind" "NotificationTargetKind",
    "target_id" UUID,
    "idempotency_key" UUID NOT NULL,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" VARCHAR(255) NOT NULL,
    "auth" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "detail" VARCHAR(500),
    "attempted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "table_name" VARCHAR(100) NOT NULL,
    "record_id" UUID NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_created_at_idx" ON "notifications"("tenant_id", "user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_user_id_idempotency_key_key" ON "notifications"("tenant_id", "user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "push_subscriptions_tenant_id_user_id_idx" ON "push_subscriptions"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_tenant_id_endpoint_key" ON "push_subscriptions"("tenant_id", "endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_tenant_id_user_id_type_channel_key" ON "notification_preferences"("tenant_id", "user_id", "type", "channel");

-- CreateIndex
CREATE INDEX "delivery_attempts_tenant_id_idx" ON "delivery_attempts"("tenant_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_notification_id_idx" ON "delivery_attempts"("notification_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_table_name_record_id_idx" ON "audit_log"("tenant_id", "table_name", "record_id");

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Row-Level Security (ADR-001 §5.2) ───────────────────────────
-- Todo repository entra por withTenant(); o consumidor de eventos usa o
-- tenant do envelope. USING vale também como WITH CHECK.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notifications ON notifications
  USING (tenant_id = current_tenant_id());

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_push_subscriptions ON push_subscriptions
  USING (tenant_id = current_tenant_id());

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notification_preferences ON notification_preferences
  USING (tenant_id = current_tenant_id());

ALTER TABLE delivery_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_delivery_attempts ON delivery_attempts
  USING (tenant_id = current_tenant_id());

-- audit_log: a role da aplicação só tem SELECT/INSERT (role script, seção 3d).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit_log ON audit_log
  USING (tenant_id = current_tenant_id());
