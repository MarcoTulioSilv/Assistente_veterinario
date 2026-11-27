-- ════════════════════════════════════════════════════════════════
-- Proprietário com CPF ou CNPJ
--
-- owners.cpf (VARCHAR(14)) só cabia CPF: um haras, pessoa jurídica, ficava
-- sem documento. A coluna vira cpf_cnpj (VARCHAR(18), o tamanho do CNPJ com
-- máscara, inclusive o alfanumérico). RENAME em vez do DROP/ADD que o
-- `prisma migrate diff` geraria: os CPFs gravados continuam onde estão, já
-- no formato canônico (o Zod exigia 000.000.000-00).
-- ════════════════════════════════════════════════════════════════

ALTER TABLE "owners" RENAME COLUMN "cpf" TO "cpf_cnpj";
ALTER TABLE "owners" ALTER COLUMN "cpf_cnpj" TYPE VARCHAR(18);
ALTER INDEX "owners_tenant_id_cpf_key" RENAME TO "owners_tenant_id_cpf_cnpj_key";
