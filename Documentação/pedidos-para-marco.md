# Pedidos pro Marco — ajustes da reunião de 2026-11-03

Dois itens da lista de ajustes (ver `Documentação/reunioes/2026-11-03-ajustes.md`)
precisam de mudança de schema/Prisma — território seu. Registrando aqui o que
precisa e uma proposta de contrato em `shared-types` pra eu já poder tipar e
usar um Mock enquanto você não entrega o real (mesmo padrão que já usamos
pros outros contratos publicados antes da implementação).

## 1. Preço por ml para medicamentos

Hoje `Product` já resolve o caso análogo pra vacina com `dosesPerUnit`
(frasco de 10 doses → cada dose é 1/10 do frasco, usado em
`dosesToUnits()` no `DeductionService`). Precisamos do mesmo pra
medicamento dosado por ml: um frasco/ampola/galão de N ml, cobrado e
baixado por ml administrado.

**Decisão que é sua:** devo criar um campo novo (`mlPerUnit`, mesmo desenho
de `dosesPerUnit`, exclusivo pra medicamento), ou prefere generalizar
`dosesPerUnit` num campo só que sirva pros dois casos (ex.:
`consumptionUnitsPerPackage` + um `consumptionUnit` próprio, desacoplado do
`unit` de compra)? Qualquer uma resolve o que a reunião pediu — fica a seu
critério qual estrutura é mais simples de manter no schema e no
`DeductionService`.

**Proposta de contrato** (`packages/shared-types/src/index.ts`), caso opte
pelo campo exclusivo:

```ts
export interface Product {
  // ... campos existentes
  /**
   * RF-??? (reunião 2026-11-03): ml por unidade de compra — só faz sentido
   * quando category: 'medication' e a baixa/cobrança é por ml, mas a
   * compra é em outra unidade (frasco/ampola/galão). Null = sem conversão
   * (a unidade de compra já É ml, ou o produto não é dosado por ml).
   */
  mlPerUnit: number | null;
}

export interface CreateProductDto {
  // ... campos existentes
  mlPerUnit?: number;
}
```

Isso também muda o `DeductionService` (ms-inventory): hoje `dosesToUnits()`
só existe pra `vaccination.applied`; o equivalente pra medicamento
provavelmente entra no consumo do atendimento/exame, convertendo ml
administrados em fração da unidade de compra — mesmo raciocínio,
estrutura que você já conhece bem desse arquivo.

## 2. Fator de conversão entre frasco/ampola/dose/ml por produto

Pedido mais amplo da reunião: cada produto que usa esses tipos de unidade
precisa de um fator de conversão explícito entre a unidade de **compra**
(frasco, ampola, galão) e a unidade de **consumo** (ml, dose) — não só pra
medicamento, de forma consistente com o que já existe pra vacina.

**Decisão que é sua:** isso afeta diretamente a baixa de estoque (RN-003/
RN-007) e o cálculo de preço por ml/dose — pedindo explicitamente que você
decida a fórmula/estrutura exata (reaproveitar `dosesPerUnit` generalizado,
ou um campo de conversão por par de unidades, ou outra abordagem). Não vou
propor a migration nem o cálculo de baixa — só preciso saber qual vai ser
o contrato pra consumir no Zod/controller/tela.

## Enquanto isso

Vou seguir com a validação de "unidade permitida por categoria" (isso é só
Zod, não precisa desses campos novos — `vaccine` aceita ml/dose/frasco/
ampola, por exemplo) e deixo a tela de produto preparada pra exibir um
campo de "ml por unidade"/preço-por-ml assim que você publicar o contrato
real — uso um Mock até lá.

---

## Resposta do Marco (2026-11-06) — itens 1 e 2

Os stakeholders padronizaram: **medicamento e vacina são cobrados e baixados
por ml** ("por dose" dava margem a erro). Com isso, a escolha entre um campo
novo e um generalizado deixou de existir: ficou um campo de ml, e o
`dosesPerUnit` saiu. Entrou na PR #37 (branch
`feature/MS3-012-homologacao-m2`), junto com o seed de homologação, que já
usa o modelo novo.

**Produto (`Product`):**

| Campo | O que é |
|---|---|
| `unit` | unidade de **compra** (frasco, ampola, galão…) — não mudou |
| `mlPerUnit` | quantos ml tem uma unidade de compra (frasco de 50 ml). Nulo em produto já comprado em ml ou que não se usa por ml (pasta oral, seringa) |
| `applicationMl` | só vacina: ml aplicados por animal, para a tela sugerir na vacinação |
| `pricePerMlCents` | preço de venda por ml, já calculado. Nulo quando o produto não se usa por ml |

Regras (422 no StockService):
- `mlPerUnit` só em medicamento e vacina, e nunca em produto comprado em ml;
- vacina em frasco/ampola **precisa** de `mlPerUnit` — a vacinação registra ml;
- `applicationMl` só em vacina; vacina que vira outra categoria perde o valor
  junto, como já acontecia com o intervalo de dose;
- num PATCH parcial, as regras valem para o produto como vai ficar —
  inclusive a sua validação de unidade × categoria, que antes escapava quando
  só a categoria mudava.

**O que muda nas telas:**
- **Orçamento e exame:** produto com `pricePerMlCents` tem a quantidade em
  **ml** e o preço unitário sugerido é o `pricePerMlCents`. A baixa converte
  sozinha (10 ml de um frasco de 100 ml baixam 0,1 frasco). Produto sem ml
  continua na unidade de compra.
- **Vacinação:** `dosesPerAnimal` virou `mlPerAnimal` (obrigatório na
  aplicação da clínica; sugira o `applicationMl` da vacina) e
  `pricePerDoseCents` virou `pricePerMlCents` (o `pricePerMlCents` da vacina).
  No registro externo, `mlPerAnimal` é opcional. Próxima dose e lembrete não
  mudaram.
- **Cadastro de produto:** deixei uma ponte para o build não quebrar — o
  campo "Doses por unidade" virou "ml por unidade" (`mlPerUnit`). Falta o
  campo de volume de aplicação na vacina e mostrar o preço por ml; isso é seu.

**Migrations:** `20261106120000_product_ml_per_unit` (MS2) e
`20261106130000_vaccination_ml` (MS3). O `doses_per_unit` antigo sai **sem
conversão** — guardava doses, e reinterpretar 10 doses como 10 ml daria preço
errado calado. Vacina antiga sem `mlPerUnit` não dá baixa (o job falha à
vista) até alguém completar o cadastro. Como ainda não há produção, só afeta
dados de desenvolvimento, e o seed de homologação recria tudo.
