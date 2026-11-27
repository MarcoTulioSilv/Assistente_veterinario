-- ════════════════════════════════════════════════════════════════
-- FKs compostas por tenant no MS3 (auditoria 06/11/2026, item 3)
--
-- O Postgres confere chave estrangeira SEM passar pelo RLS: com FK só em
-- (exam_type_id) → exam_types(id), basta o UUID existir em QUALQUER clínica
-- para a FK aceitar. Com (tenant_id, exam_type_id) → exam_types(tenant_id, id),
-- o próprio banco garante que a linha referenciada é da mesma clínica. Mesmo
-- padrão do MS1 (20261107130000_fk_composta_tenant). O service continua
-- conferindo o id sob RLS, para o cliente receber 404 e não um 500 da FK.
--
-- O ON DELETE de antes continua (CASCADE nas tabelas filhas, RESTRICT no
-- tipo de exame): a cascata apaga a linha inteira, não zera tenant_id.
-- ════════════════════════════════════════════════════════════════

-- Pré-checagem: aborta com mensagem clara se já houver ligação entre clínicas.
DO $$
DECLARE n INT;
BEGIN
  SELECT
    (SELECT count(*) FROM appointment_animals x JOIN appointments p ON p.id = x.appointment_id WHERE p.tenant_id <> x.tenant_id)
  + (SELECT count(*) FROM appointment_items x JOIN appointments p ON p.id = x.appointment_id WHERE p.tenant_id <> x.tenant_id)
  + (SELECT count(*) FROM medical_records x JOIN appointment_animals p ON p.appointment_id = x.appointment_id AND p.animal_id = x.animal_id WHERE p.tenant_id <> x.tenant_id)
  + (SELECT count(*) FROM prescriptions x JOIN appointment_animals p ON p.appointment_id = x.appointment_id AND p.animal_id = x.animal_id WHERE p.tenant_id <> x.tenant_id)
  + (SELECT count(*) FROM exam_requests x JOIN exam_types p ON p.id = x.exam_type_id WHERE p.tenant_id <> x.tenant_id)
  + (SELECT count(*) FROM exam_request_animals x JOIN exam_requests p ON p.id = x.exam_request_id WHERE p.tenant_id <> x.tenant_id)
  + (SELECT count(*) FROM exam_request_items x JOIN exam_requests p ON p.id = x.exam_request_id WHERE p.tenant_id <> x.tenant_id)
  + (SELECT count(*) FROM vaccination_animals x JOIN vaccinations p ON p.id = x.vaccination_id WHERE p.tenant_id <> x.tenant_id)
  INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Auditoria item 3: % ligação(ões) entre clínicas diferentes no MS3; corrija os dados antes de aplicar esta migração', n;
  END IF;
END
$$;

-- DropForeignKey
ALTER TABLE "appointment_animals" DROP CONSTRAINT "appointment_animals_appointment_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment_items" DROP CONSTRAINT "appointment_items_appointment_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_request_animals" DROP CONSTRAINT "exam_request_animals_exam_request_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_request_items" DROP CONSTRAINT "exam_request_items_exam_request_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_requests" DROP CONSTRAINT "exam_requests_exam_type_id_fkey";

-- DropForeignKey
ALTER TABLE "medical_records" DROP CONSTRAINT "medical_records_appointment_id_animal_id_fkey";

-- DropForeignKey
ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_appointment_id_animal_id_fkey";

-- DropForeignKey
ALTER TABLE "vaccination_animals" DROP CONSTRAINT "vaccination_animals_vaccination_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "appointment_animals_tenant_id_appointment_id_animal_id_key" ON "appointment_animals"("tenant_id", "appointment_id", "animal_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_id_key" ON "appointments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_requests_tenant_id_id_key" ON "exam_requests"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_types_tenant_id_id_key" ON "exam_types"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "medical_records_tenant_id_appointment_id_animal_id_key" ON "medical_records"("tenant_id", "appointment_id", "animal_id");

-- CreateIndex
CREATE UNIQUE INDEX "vaccinations_tenant_id_id_key" ON "vaccinations"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "appointment_animals" ADD CONSTRAINT "appointment_animals_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_tenant_id_appointment_id_animal_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id", "animal_id") REFERENCES "appointment_animals"("tenant_id", "appointment_id", "animal_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_requests" ADD CONSTRAINT "exam_requests_tenant_id_exam_type_id_fkey" FOREIGN KEY ("tenant_id", "exam_type_id") REFERENCES "exam_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_request_animals" ADD CONSTRAINT "exam_request_animals_tenant_id_exam_request_id_fkey" FOREIGN KEY ("tenant_id", "exam_request_id") REFERENCES "exam_requests"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_request_items" ADD CONSTRAINT "exam_request_items_tenant_id_exam_request_id_fkey" FOREIGN KEY ("tenant_id", "exam_request_id") REFERENCES "exam_requests"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_animals" ADD CONSTRAINT "vaccination_animals_tenant_id_vaccination_id_fkey" FOREIGN KEY ("tenant_id", "vaccination_id") REFERENCES "vaccinations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_tenant_id_appointment_id_animal_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id", "animal_id") REFERENCES "appointment_animals"("tenant_id", "appointment_id", "animal_id") ON DELETE CASCADE ON UPDATE CASCADE;

