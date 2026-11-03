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
