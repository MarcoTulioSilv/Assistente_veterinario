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

## Sprint 9 do M3: controllers da agenda (MS4), BFF e telas

O lado do servidor está na branch `feature/MS4-001-agenda`: serviço `apps/ms-scheduling` (porta 3004), `ScheduleService` pronto e testado, contratos em `shared-types` (`IScheduleService`, `ScheduleEvent`, DTOs, `SCHEDULE_LIMITS`). O MS4 sobe no staging junto com essa PR. Falta a sua parte:

**1. Router `/schedule` no MS4.** Monte em `apps/ms-scheduling/src/app.ts`, depois do `authMiddleware` (o comentário marca o lugar). O `validate.ts` pode ser cópia do MS6. Construa o service com `new ScheduleService(new ScheduleEventRepository())`.

| Rota | Service | Resposta |
|---|---|---|
| `GET /schedule?from&to&status` | `list(ctx, { from, to, status })` | 200, lista (sem paginação) |
| `GET /schedule/day?day=AAAA-MM-DD` | `listDay(ctx, day)` (sem `day` = hoje em São Paulo) | 200, lista |
| `GET /schedule/returns/:appointmentId` | `findReturn(ctx, appointmentId)` | 200 ou 404 |
| `GET /schedule/:id` | `findById(ctx, id)` | 200 ou 404 |
| `POST /schedule` | `create(ctx, body)` | 201 |
| `POST /schedule/visits` | `scheduleVisit(ctx, body)` | 201; 409 se o atendimento já tem retorno ativo |
| `PATCH /schedule/:id` | `update(ctx, id, body)` | 200; 409 se concluído/cancelado |
| `POST /schedule/:id/complete` | `complete(ctx, id)` | 200; 409 se já saiu de `scheduled` |
| `POST /schedule/:id/cancel` | `cancel(ctx, id)` | 200; 409 idem |
| `DELETE /schedule/:id` | `remove(ctx, id)` | 204 |

Declare `/day`, `/returns/:appointmentId` e `/visits` antes de `/:id`.

**2. Schemas Zod** (o service valida de novo, mas a tela recebe os erros por campo mais cedo):
- `activityType`: `'appointment' | 'visit' | 'vaccination' | 'exam' | 'other'` (só no `POST /schedule`; a visita não manda).
- `startsAt`, `endsAt`, `from`, `to`: data ISO com fuso (`z.string().datetime({ offset: true })`); `endsAt` aceita `null`.
- `ownerId`, `propertyId`, `sourceAppointmentId`: UUID; `ownerId`/`propertyId` aceitam `null` (só faz sentido em `other`; o service recusa nos outros tipos).
- `animalIds`: array de UUID com `.max(50)`. `reminderMinutesBefore`: inteiros de 0 a `SCHEDULE_LIMITS.maxReminderMinutesBefore`, `.max(SCHEDULE_LIMITS.maxReminders)`. Nenhum lembrete pode cair no passado (início − antecedência ≥ agora): o service devolve 422 em `reminderMinutesBefore`. Na tela, esconda ou desabilite as antecedências que já passaram; evento no passado (registrar uma visita feita) vai sem lembrete. Todo array com `.max`, por causa do Zod 3 (GHSA-mrhx-c7xc-m3w5).
- `notes`: `.max(2000)`, aceita `null`. `status` (filtro): `'scheduled' | 'done' | 'cancelled'`.
- Intervalo da listagem: até `SCHEDULE_LIMITS.maxListDays` (62) dias.

**3. BFF.** Em `apps/bff/src/index.ts`: `['/api/v1/schedule', process.env['MS_SCHEDULING_URL'] ?? 'http://localhost:3004']`. O `MS_SCHEDULING_URL` do staging já está no compose.

**4. PWA.**
- Agenda mensal e semanal (`GET /schedule?from&to`) e formulário de evento, com Proprietário antes de Propriedade (RN-001) e lembretes por horário.
- Tela própria "Agendar visita" (`POST /schedule/visits`, sem `sourceAppointmentId`).
- Retorno opcional ao finalizar o atendimento: o mesmo formulário, pré-preenchido com proprietário, propriedade e animais, mandando `sourceAppointmentId`. Na tela do atendimento, `GET /schedule/returns/:appointmentId` diz se já há retorno (o 409 também).
- Dashboard: atividades do dia (`GET /schedule/day`), em ordem de horário, no lugar do placeholder.
- Erros: 422 vem com `details` por campo (`startsAt`, `ownerId`, `reminderMinutesBefore`…).

**5. Contratos do MS5** (Sprint 10) também estão em `shared-types`: `INotificationService`, `Notification`, `NotificationPreference`, `PushSubscriptionDto`. Dá para começar as telas contra mock; revisamos juntos no início da Sprint 10.

---

## Em aberto (sem pressa, não bloqueia nada)

1. **Cache de API separado por usuário (A-01, parte "desejável").** Hoje o cache é apagado no login, no logout e na falha de refresh, o que resolve o caso do aparelho compartilhado. Falta a segunda barreira: a chave do cache incluir o usuário (por exemplo, `quironequine-api-<userId>`, com a página avisando o service worker de quem está logado). Assim, mesmo que a limpeza falhe (aba fechada no meio, sem rede), um usuário nunca recebe a resposta de outro. Vale também para a corrida de uma requisição que termina logo depois do logout e grava no cache.

2. **Laudo com link temporário (M-03), quando existir a tela de exames.** Os links de arquivo (`resultFileUrl`, `photoUrl`, `sketchUrl`, `logoUrl`) chegam assinados e valem 15 minutos. No botão "ver laudo", busque o exame de novo (`GET /exams/:id`) e abra o link que vier, em vez do que está na tela. E não guarde links de arquivo em estado persistido ou no cache do service worker: eles vencem.

3. **CSP da PWA (auditoria B-05), quando for feita.** A política vai precisar liberar o Google Maps (`maps.googleapis.com`, `maps.gstatic.com`), o IBGE (`servicodados.ibge.gov.br`), os tiles do OpenStreetMap (fallback do Leaflet) e a API (`api-homolog...`). Combine com o Marco antes, porque o HSTS fica no Caddy, que é infra.
