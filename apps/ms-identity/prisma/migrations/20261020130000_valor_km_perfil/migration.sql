-- Valor por km rodado no perfil do veterinário (RN-011; reunião com os
-- stakeholders de 20/10/2026). Pré-preenche o orçamento do MS3, que guarda a
-- própria cópia — mudar o perfil não altera orçamento já feito.
-- Nulo = ainda não configurado.
ALTER TABLE "veterinarians" ADD COLUMN "displacement_rate_cents" INTEGER;

-- O Prisma não modela CHECK (e o diff ignora): dinheiro negativo não entra.
ALTER TABLE "veterinarians"
  ADD CONSTRAINT "veterinarians_displacement_rate_cents_non_negative"
  CHECK ("displacement_rate_cents" IS NULL OR "displacement_rate_cents" >= 0);
