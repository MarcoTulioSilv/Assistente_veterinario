# Pedidos para o João

## Entregue: auditoria de 06/11/2026 (lado da PWA)

Tudo o que bloqueava o staging está entregue e no ar desde 09/11/2026:

- refresh token só no cookie `HttpOnly`, com `credentials: 'include'` no login, no refresh e no logout (#54);
- cache do service worker limpo no login, no logout e quando a sessão cai, com `VERSION` `v2` (A-01, #54);
- chave do Google Maps no build da PWA (#54, junto com a #53) e 404 do CEP com `AppError` (#54);
- `propertyId` continua no `updateAnimalSchema`, para o serviço responder 422 (decidido na #52).

O texto completo dos pedidos, com o contrato do cookie e o motivo de cada item, está no histórico do git deste arquivo (até o commit da #54).

---

## Em aberto: telas do M2 que faltam na PWA (bloqueia o M3)

Na `develop` (12/11/2026), a PWA não tem tela de exames, de vacinação nem de registro de pagamento. O servidor, os contratos em `shared-types` e as rotas do BFF já existem. O `api.ts` já tem o cliente de vacinação, mas nenhuma tela o usa. O fluxo de caixa da Sprint 11 do M3 depende do registro de pagamento: sem ele, não há entrada no caixa.

1. **Exames (RF-EXM-001 a 006).** Tipos de exame em `/exam-types` (CRUD; sugestões prontas em `EXAM_TYPE_SUGGESTIONS`). Pedido em `/exams`: criar e editar em rascunho, `POST /:id/issue` (emitir), `POST /:id/collection` (coleta, opcional), `POST /:id/send-to-analysis`, `POST /:id/result` (laudo em PDF) e `DELETE /:id`. Indicador de status com a coleta opcional (`draft → requested → [collected] → in_analysis → result_available`). No botão "ver laudo", vale o item 2 da lista abaixo (link temporário).
2. **Vacinação (RF-VAC-001 a 005).** `/vaccinations`: listar (filtro `animalId`), detalhar, criar (aplicação da clínica ou externa, um ou vários animais), excluir. Próximas doses em `GET /vaccinations/boosters/:animalId`, para o histórico e o indicador de re-vacinação na tela do animal.
3. **Pendências e registro de pagamento (RN-002, RF-ATD-008, RF-CAD-015).** `GET /financial` (filtros `status` e `ownerId`; o filtro por período vem na Sprint 11) para a aba do proprietário, e `POST /financial/:id/register-payment` para marcar como recebido. A tela de atendimento já usa `GET /financial/by-source/...`.

Prazo: até o fim da Sprint 9 do M3 (27/11/2026), para não atrasar a Sprint 11. O detalhamento está em `Documentação/plano-M3-sprints.md`.

---

## Sprint 11 do M3 (adiantada): relatórios, limites de estoque e plano Básico

O lado do servidor está na branch `feature/MS6-002-relatorios-sprint11`, que sai da `develop` e não depende dos PRs 58 e 59. O geofence fica para depois do merge do MS4. Os services já recusam no Plano Básico (403) o que é só do Plus. Mesmo assim, use `requirePlus` nas rotas marcadas: falha cedo e documenta a regra.

**1. MS6 — saídas, fluxo de caixa e dashboard** (`apps/ms-reporting`):

| Rota | Service | Observação |
|---|---|---|
| `GET /financial?...&from&to` | `list` / `listByOwner` | RF-REL-003: período pela data do serviço; os dois juntos ou nenhum |
| `GET /expenses?page&limit&fromDay&toDay&category` | `ExpenseService.list` | Plus. Dias `AAAA-MM-DD`, os dois incluídos |
| `POST /expenses` | `create` | Plus. Saída avulsa (RF-REL-002) |
| `POST /expenses/stock-purchases` | `registerStockPurchase` | Plus. Compra de estoque lançada à mão |
| `PATCH /expenses/:id` | `update` | Plus |
| `DELETE /expenses/:id` | `remove` | Plus. 204 |
| `GET /reports/cash-flow?from&to` | `CashFlowService.summary` | Plus. RF-REL-001 |
| `GET /reports/dashboard?from&to` | `DashboardService.summary` | Plus. RF-REL-005 |

- Services: `new ExpenseService(new ExpenseRepository())`, `new CashFlowService(new ReportRepository())`, `new DashboardService(new ReportRepository())`. No BFF: `/api/v1/expenses` e `/api/v1/reports` → `MS_REPORTING_URL`.
- Zod:
  - `from`/`to`: `z.string().datetime({ offset: true })`; período de até 24 meses (`parseReportPeriod`).
  - Saída avulsa: `occurredOn` com `/^\d{4}-\d{2}-\d{2}$/`, `category` em `fuel | vehicle_maintenance | supplies_equipment | taxes_fees | other`, `description` com `.trim().min(1).max(255)` e `amountCents` inteiro positivo, até `1_000_000_000`.
  - Compra de estoque: `occurredOn`, `amountCents`, `productId` UUID opcional e `description` opcional (`.max(255)`).
  - `PATCH`: tudo opcional. A categoria não troca entre avulsa e compra de estoque (o service devolve 422).

**2. MS3 — atendimentos por mês** (dashboard): `GET /appointments/stats/monthly?from&to` → `AppointmentService.countFinishedByMonth`. Devolve `[{ month: 'AAAA-MM', count }]`, com zero nos meses vazios. Declare antes de `/:id`.

**3. MS2 — limites de alerta da clínica** (RF-CFG-004):
- `GET /inventory-settings` e `PUT /inventory-settings` → `new InventorySettingsService(new InventorySettingsRepository())`. Zod: `defaultAlertDaysBefore` inteiro de 0 a 3650 ou `null`; `defaultMinStockQty` número ≥ 0 ou `null`; ambos opcionais. No BFF: `/api/v1/inventory-settings` → `MS_INVENTORY_URL`.
- **Produto**: `alertDaysBefore` e `minStockQty` passam a aceitar `null` = "usar o padrão da clínica" (`createProductSchema`/`updateProductSchema` com `.nullable()`). A resposta traz `effectiveAlertDaysBefore` e `effectiveMinStockQty`, o que vale de fato.
- **Atenção no formulário do produto**: hoje a edição faz `String(product.minStockQty)`. Com `null`, apareceria "null" no campo. Campo vazio = `null` (padrão da clínica), e a tela pode mostrar "padrão da clínica: 30 dias" a partir do valor efetivo.

**4. Telas**: fluxo de caixa (totais, saldo por mês, saídas por categoria); saídas (lista com filtro, cadastro, edição e exclusão); compra de estoque; dashboard com receita mensal, quantidade de atendimentos por mês (MS3) e maiores proprietários (nomes do MS1); limites de alerta em Configurações; período na lista de pendências. No Plano Básico, a lista de pendências e recebidos continua, e no lugar do resto entra o aviso de upgrade.

---

## Em aberto (sem pressa, não bloqueia nada)

1. **Cache de API separado por usuário (A-01, parte "desejável").** Hoje o cache é apagado no login, no logout e na falha de refresh, o que resolve o caso do aparelho compartilhado. Falta a segunda barreira: a chave do cache incluir o usuário (por exemplo, `quironequine-api-<userId>`, com a página avisando o service worker de quem está logado). Assim, mesmo que a limpeza falhe (aba fechada no meio, sem rede), um usuário nunca recebe a resposta de outro. Vale também para a corrida de uma requisição que termina logo depois do logout e grava no cache.

2. **Laudo com link temporário (M-03), quando existir a tela de exames.** Os links de arquivo (`resultFileUrl`, `photoUrl`, `sketchUrl`, `logoUrl`) chegam assinados e valem 15 minutos. No botão "ver laudo", busque o exame de novo (`GET /exams/:id`) e abra o link que vier, em vez do que está na tela. E não guarde links de arquivo em estado persistido ou no cache do service worker: eles vencem.

3. **CSP da PWA (auditoria B-05), quando for feita.** A política vai precisar liberar o Google Maps (`maps.googleapis.com`, `maps.gstatic.com`), o IBGE (`servicodados.ibge.gov.br`), os tiles do OpenStreetMap (fallback do Leaflet) e a API (`api-homolog...`). Combine com o Marco antes, porque o HSTS fica no Caddy, que é infra.
