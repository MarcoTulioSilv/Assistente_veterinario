-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('basic', 'plus');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended', 'cancelled');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'assistant');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('pending', 'active');

-- CreateEnum
CREATE TYPE "AnimalSex" AS ENUM ('male', 'female');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "plan" "TenantPlan" NOT NULL DEFAULT 'basic',
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "max_owners" INTEGER NOT NULL DEFAULT 30,
    "transcriptions_used" INTEGER NOT NULL DEFAULT 0,
    "transcriptions_limit" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'admin',
    "full_name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "totp_secret" VARCHAR(100),
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "refresh_token_hash" VARCHAR(255),
    "last_login_at" TIMESTAMPTZ,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "veterinarians" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "crmv" VARCHAR(30) NOT NULL,
    "crmv_state" CHAR(2) NOT NULL,
    "cpf_cnpj" VARCHAR(20) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "veterinarians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owners" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "cpf" VARCHAR(14),
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "phone2" VARCHAR(20),
    "address" TEXT,
    "city" VARCHAR(100),
    "state" CHAR(2),
    "status" "RecordStatus" NOT NULL DEFAULT 'pending',
    "notify_blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "address" TEXT,
    "city" VARCHAR(100),
    "state" CHAR(2),
    "zip_code" VARCHAR(10),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "status" "RecordStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_owners" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID,
    "owner_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "species" VARCHAR(50) NOT NULL DEFAULT 'equine',
    "sex" "AnimalSex",
    "breed" VARCHAR(100),
    "coat" VARCHAR(200),
    "birth_date" DATE,
    "castrated" BOOLEAN NOT NULL DEFAULT false,
    "photo_url" TEXT,
    "sketch_url" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "from_property_id" UUID,
    "to_property_id" UUID NOT NULL,
    "transferred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "animal_transfers_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_plan_idx" ON "tenants"("plan");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "veterinarians_user_id_key" ON "veterinarians"("user_id");

-- CreateIndex
CREATE INDEX "veterinarians_tenant_id_idx" ON "veterinarians"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "veterinarians_tenant_id_crmv_key" ON "veterinarians"("tenant_id", "crmv");

-- CreateIndex
CREATE UNIQUE INDEX "veterinarians_tenant_id_cpf_cnpj_key" ON "veterinarians"("tenant_id", "cpf_cnpj");

-- CreateIndex
CREATE INDEX "owners_tenant_id_idx" ON "owners"("tenant_id");

-- CreateIndex
CREATE INDEX "owners_status_idx" ON "owners"("status");

-- CreateIndex
CREATE INDEX "owners_full_name_idx" ON "owners"("full_name");

-- CreateIndex
CREATE UNIQUE INDEX "owners_tenant_id_cpf_key" ON "owners"("tenant_id", "cpf");

-- CreateIndex
CREATE INDEX "properties_tenant_id_idx" ON "properties"("tenant_id");

-- CreateIndex
CREATE INDEX "properties_status_idx" ON "properties"("status");

-- CreateIndex
CREATE INDEX "properties_name_idx" ON "properties"("name");

-- CreateIndex
CREATE INDEX "property_owners_tenant_id_idx" ON "property_owners"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_owners_property_id_owner_id_key" ON "property_owners"("property_id", "owner_id");

-- CreateIndex
CREATE INDEX "animals_tenant_id_idx" ON "animals"("tenant_id");

-- CreateIndex
CREATE INDEX "animals_property_id_idx" ON "animals"("property_id");

-- CreateIndex
CREATE INDEX "animals_owner_id_idx" ON "animals"("owner_id");

-- CreateIndex
CREATE INDEX "animals_status_idx" ON "animals"("status");

-- CreateIndex
CREATE INDEX "animals_name_idx" ON "animals"("name");

-- CreateIndex
CREATE INDEX "animal_transfers_tenant_id_idx" ON "animal_transfers"("tenant_id");

-- CreateIndex
CREATE INDEX "animal_transfers_animal_id_idx" ON "animal_transfers"("animal_id");

-- CreateIndex
CREATE INDEX "animal_transfers_transferred_at_idx" ON "animal_transfers"("transferred_at");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_idx" ON "audit_log"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "audit_log_table_name_idx" ON "audit_log"("table_name");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "veterinarians" ADD CONSTRAINT "veterinarians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owners" ADD CONSTRAINT "owners_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_transfers" ADD CONSTRAINT "animal_transfers_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_transfers" ADD CONSTRAINT "animal_transfers_from_property_id_fkey" FOREIGN KEY ("from_property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_transfers" ADD CONSTRAINT "animal_transfers_to_property_id_fkey" FOREIGN KEY ("to_property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
