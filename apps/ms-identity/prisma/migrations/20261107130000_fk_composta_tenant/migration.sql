-- ════════════════════════════════════════════════════════════════
-- FKs compostas por tenant (auditoria 06/11/2026, M-01)
--
-- O Postgres confere chave estrangeira SEM passar pelo RLS: com FK só em
-- (property_id) → properties(id), basta o UUID existir em QUALQUER tenant
-- para a FK aceitar. Com (tenant_id, property_id) → properties(tenant_id, id),
-- o próprio banco garante que a linha referenciada é do mesmo tenant.
--
-- ON DELETE NO ACTION (e não SET NULL) em animals/animal_transfers: com a
-- chave composta, SET NULL zeraria também o tenant_id. Não há DELETE físico
-- nessas tabelas (soft delete, LGPD).
-- ════════════════════════════════════════════════════════════════

-- Pré-checagem: aborta com mensagem clara se já houver ligação entre tenants.
DO $$
DECLARE n INT;
BEGIN
  SELECT
    (SELECT count(*) FROM animals a JOIN properties p ON p.id = a.property_id WHERE p.tenant_id <> a.tenant_id)
  + (SELECT count(*) FROM animals a JOIN owners o ON o.id = a.owner_id WHERE o.tenant_id <> a.tenant_id)
  + (SELECT count(*) FROM property_owners x JOIN properties p ON p.id = x.property_id WHERE p.tenant_id <> x.tenant_id)
  + (SELECT count(*) FROM property_owners x JOIN owners o ON o.id = x.owner_id WHERE o.tenant_id <> x.tenant_id)
  + (SELECT count(*) FROM animal_transfers t JOIN animals a ON a.id = t.animal_id WHERE a.tenant_id <> t.tenant_id)
  + (SELECT count(*) FROM animal_transfers t JOIN properties p ON p.id = t.from_property_id WHERE p.tenant_id <> t.tenant_id)
  + (SELECT count(*) FROM animal_transfers t JOIN properties p ON p.id = t.to_property_id WHERE p.tenant_id <> t.tenant_id)
  INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'M-01: % ligação(ões) entre tenants diferentes; corrija os dados antes de aplicar esta migração', n;
  END IF;
END
$$;

-- DropForeignKey
ALTER TABLE "animal_transfers" DROP CONSTRAINT "animal_transfers_animal_id_fkey";

-- DropForeignKey
ALTER TABLE "animal_transfers" DROP CONSTRAINT "animal_transfers_from_property_id_fkey";

-- DropForeignKey
ALTER TABLE "animal_transfers" DROP CONSTRAINT "animal_transfers_to_property_id_fkey";

-- DropForeignKey
ALTER TABLE "animals" DROP CONSTRAINT "animals_owner_id_fkey";

-- DropForeignKey
ALTER TABLE "animals" DROP CONSTRAINT "animals_property_id_fkey";

-- DropForeignKey
ALTER TABLE "property_owners" DROP CONSTRAINT "property_owners_owner_id_fkey";

-- DropForeignKey
ALTER TABLE "property_owners" DROP CONSTRAINT "property_owners_property_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "animals_tenant_id_id_key" ON "animals"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "owners_tenant_id_id_key" ON "owners"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "properties_tenant_id_id_key" ON "properties"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_tenant_id_owner_id_fkey" FOREIGN KEY ("tenant_id", "owner_id") REFERENCES "owners"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_tenant_id_owner_id_fkey" FOREIGN KEY ("tenant_id", "owner_id") REFERENCES "owners"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_transfers" ADD CONSTRAINT "animal_transfers_tenant_id_animal_id_fkey" FOREIGN KEY ("tenant_id", "animal_id") REFERENCES "animals"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_transfers" ADD CONSTRAINT "animal_transfers_tenant_id_from_property_id_fkey" FOREIGN KEY ("tenant_id", "from_property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_transfers" ADD CONSTRAINT "animal_transfers_tenant_id_to_property_id_fkey" FOREIGN KEY ("tenant_id", "to_property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

