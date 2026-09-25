-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('clinico_geral', 'reproducao', 'odontologico', 'locomotor', 'cirurgia');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('draft', 'finished', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'received');

-- CreateEnum
CREATE TYPE "AdministrationRoute" AS ENUM ('oral', 'intravenosa', 'intramuscular', 'subcutanea', 'topica', 'intrauterina', 'outra');

-- CreateEnum
CREATE TYPE "AppointmentItemKind" AS ENUM ('product', 'procedure');

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "veterinarian_id" UUID NOT NULL,
    "type" "AppointmentType" NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'draft',
    "animal_location" TEXT,
    "performed_at" TIMESTAMPTZ NOT NULL,
    "labor_cents" INTEGER NOT NULL DEFAULT 0,
    "displacement_km" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "displacement_rate_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "anamnesis" TEXT,
    "diagnosis" TEXT,
    "treatment" TEXT,
    "prognosis" TEXT,
    "referral" TEXT,
    "general_exam" JSONB,
    "special_exams" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "kind" "AppointmentItemKind" NOT NULL,
    "product_id" UUID,
    "description" VARCHAR(255) NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "product_id" UUID,
    "medication_name" VARCHAR(255) NOT NULL,
    "dose" VARCHAR(100) NOT NULL,
    "route" "AdministrationRoute" NOT NULL,
    "schedule" VARCHAR(255) NOT NULL,
    "application_site" VARCHAR(255),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_tenant_id_idx" ON "appointments"("tenant_id");

-- CreateIndex
CREATE INDEX "appointments_animal_id_idx" ON "appointments"("animal_id");

-- CreateIndex
CREATE INDEX "appointments_owner_id_idx" ON "appointments"("owner_id");

-- CreateIndex
CREATE INDEX "appointments_performed_at_idx" ON "appointments"("performed_at");

-- CreateIndex
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

-- CreateIndex
CREATE INDEX "appointments_payment_status_idx" ON "appointments"("payment_status");

-- CreateIndex
CREATE UNIQUE INDEX "medical_records_appointment_id_key" ON "medical_records"("appointment_id");

-- CreateIndex
CREATE INDEX "medical_records_tenant_id_idx" ON "medical_records"("tenant_id");

-- CreateIndex
CREATE INDEX "appointment_items_tenant_id_idx" ON "appointment_items"("tenant_id");

-- CreateIndex
CREATE INDEX "appointment_items_appointment_id_idx" ON "appointment_items"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_items_product_id_idx" ON "appointment_items"("product_id");

-- CreateIndex
CREATE INDEX "prescriptions_tenant_id_idx" ON "prescriptions"("tenant_id");

-- CreateIndex
CREATE INDEX "prescriptions_appointment_id_idx" ON "prescriptions"("appointment_id");

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
