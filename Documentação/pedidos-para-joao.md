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

## Em aberto: PWA instalável — ícones e tipografia (bloqueia o push da Sprint 10)

Os ícones e a tipografia do QuironEqui chegaram em 13/11/2026; você sobe os arquivos. Hoje (conferido no staging em 13/11):

- o manifest (`src/app/manifest.ts`) declara `/icons/icon-192.png`, `/icons/icon-512.png` e `/icons/icon-512-maskable.png`, mas `apps/pwa/public/icons/` nunca entrou no repositório: **os três dão 404**;
- sem ícones de 192 e 512 válidos, o **Chrome do Android não considera a PWA instalável** (não aparece "Instalar app");
- o `sw.js` pré-carrega dois desses ícones (`SHELL_ASSETS`), e o `cache.addAll` falha no 404: **o service worker não chega a ser instalado**. Sem ele não há modo offline nem push (Sprint 10). É a lição do primeiro deploy anotada no `CLAUDE.md`.

O que fazer:
1. `apps/pwa/public/icons/`: `icon-192.png` (192×192), `icon-512.png` (512×512) e `icon-512-maskable.png` (512×512, com o desenho dentro da área segura central de ~80%, porque o Android recorta em círculo ou gota).
2. `apps/pwa/src/app/apple-icon.png` (180×180, sem transparência): o Next gera o `apple-touch-icon`, que é o ícone do iPhone na tela de início. Se quiser, também `src/app/icon.png` ou `favicon.ico` para a aba do navegador.
3. Tipografia: fontes auto-hospedadas com `next/font/local` (sem Google Fonts em tempo de execução; ajuda o modo offline e a CSP da auditoria B-05).
4. Subir a `VERSION` do `sw.js`, para os aparelhos trocarem o service worker.
5. Conferir no staging: `/icons/icon-192.png` responde 200; no Chrome do computador, DevTools → Application → Manifest sem erros e Service Workers "activated".

**Botão de instalar** (sugestão, para os stakeholders não dependerem de achar o menu). O navegador não deixa instalar sozinho, sem um toque do usuário, e uma notificação push não instala o app (o push só funciona com o service worker, e no iPhone só com o app já instalado). O que dá para fazer:
- **Android/Chrome**: guardar o evento `beforeinstallprompt` e mostrar um botão "Instalar o app" que chama `prompt()`. São um toque e a confirmação do sistema. Esconder o botão quando já estiver instalado (`display-mode: standalone`, evento `appinstalled`).
- **iPhone/Safari**: não há API de instalação. Mostrar um aviso com o passo a passo (Compartilhar → "Adicionar à Tela de Início") quando for iOS, no Safari e fora do modo standalone. Lembrar que, no iPhone, o push só funciona instalado assim (iOS 16.4+).

---

## Sprint 10 do M3: notificações (MS5), conta e rota interna do MS1

O lado do servidor está na branch `feature/MS5-001-notificacoes` (empilhada na da Sprint 9). As decisões estão na ADR-007: tudo vai para o veterinário; WhatsApp e e-mail ficam desligados até existirem as contas; **o MS5 entrega só tipo e dados, e o texto é seu** (PWA, service worker e adapter de e-mail). Falta a sua parte:

**1. Rota interna do diretório no MS1 — vem antes de tudo.** Sem ela no staging, os avisos de exame, vacina e estoque falham depois das tentativas. Por isso ela precisa estar na `develop` antes do deploy `develop → staging` que leva o MS5.
- Router `/internal` em `apps/ms-identity/src/app.ts`, **antes** do `authMiddleware` (é autenticação de serviço, não de usuário), com `requireServiceToken` (`shared-middlewares`). O BFF **não** deve encaminhar `/internal`.
- Service: `new RecipientService(new RecipientRepository())`.

| Rota | Service | Resposta |
|---|---|---|
| `GET /internal/tenants/:tenantId/recipients/users/:userId` | `byUser` | 200 `NotificationRecipient` ou 404 |
| `GET /internal/tenants/:tenantId/recipients/veterinarians/:veterinarianId` | `byVeterinarian` | 200 ou 404 |
| `GET /internal/tenants/:tenantId/recipients/admins` | `tenantAdmins` | 200, lista (pode ser vazia) |

Os parâmetros são UUID (Zod). O cliente do MS5 (`IdentityDirectoryClient`) já chama essas rotas.

**2. Rotas públicas da conta no MS1** (auditoria M-02). Service: `new AccountService(new AccountRepository(), new AuthRepository())`.

| Rota | Service | Resposta |
|---|---|---|
| `POST /auth/email/confirm` `{ token }` | `confirmEmail` | 204; 422 se o link é inválido ou venceu |
| `POST /auth/email/resend` `{ email }` | `requestEmailVerification` | **202 sempre** (não revela nada) |
| `POST /auth/password/forgot` `{ email }` | `requestPasswordReset` | **202 sempre** |
| `POST /auth/password/reset` `{ token, newPassword }` | `resetPassword` | 204; 422 (senha com menos de 8 caracteres, ou link inválido) |

- Zod: `token` de 16 a 200 caracteres; `email` com `.max(255)`; `newPassword` com `.min(8).max(128)`.
- Limite de requisições no BFF para as quatro, apertado como o do login.
- Login: com `EMAIL_VERIFICATION_ENABLED=true`, quem não confirmou recebe **403** com a mensagem `EMAIL_NOT_VERIFIED_MESSAGE` depois da senha certa. A tela mostra a mensagem e oferece "reenviar" (a rota pública, pelo e-mail digitado). Hoje a chave está desligada.

**3. Controllers do MS5** (`apps/ms-notification/src/app.ts`, depois do `authMiddleware`). Service: `new NotificationService(new NotificationRepository(), new PreferenceRepository(), new PushSubscriptionRepository())`.

| Rota | Service | Resposta |
|---|---|---|
| `GET /notifications?page&limit&unreadOnly` | `listInbox` | 200, paginado |
| `GET /notifications/unread-count` | `unreadCount` | 200 `{ count }` |
| `POST /notifications/:id/read` | `markRead` | 204; 404 se não é do usuário |
| `POST /notifications/read-all` | `markAllRead` | 204 |
| `GET /notifications/preferences` | `getPreferences` | 200, todas as combinações tipo × canal |
| `PUT /notifications/preferences` | `updatePreferences` | 200 (array com `.max(18)`) |
| `GET /notifications/push/public-key` | `getPushPublicKey` | 200 `{ publicKey }` (vazio = push desligado) |
| `POST /notifications/push/subscriptions` | `subscribePush` | 204 (`endpoint` URL HTTPS `.max(1000)`; `keys.*` `.max(255)`) |
| `DELETE /notifications/push/subscriptions` `{ endpoint }` | `unsubscribePush` | 204 |

Declare `unread-count`, `read-all`, `preferences` e `push/...` antes de `/:id`. No BFF: `/api/v1/notifications` → `MS_NOTIFICATION_URL` (o staging já tem a variável).

**4. Adapters dos canais** (interfaces em `apps/ms-notification/src/channels/channels.ts`), ligados em `src/index.ts` no `buildChannels({ push, whatsapp, email })`. Sem adapter, o canal fica desligado.
- **Web Push**: lib `web-push`, com `setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)` e `sendNotification(target, JSON.stringify(message))`. `statusCode` 404 ou 410 → devolve `'gone'` (o MS5 revoga a assinatura). Cuidado com o lockfile ao instalar (padrão de `overrides`, memória do bug do npm).
- **WhatsApp** (Cloud API da Meta) e **e-mail**: podem esperar as contas. O adapter de e-mail traz os textos, inclusive os da conta (`sendAccountEmail(kind, to, link, expiresAt)`).

**5. Service worker e telas.**
- `push`: o payload é um `PushMessage` (`notificationId`, `type`, `data`, `target`). O texto sai do `type` e dos `data` (ex.: `schedule_reminder` → "Visita às 14h"). O toque abre a tela do `target`.
- **Ao sair do sistema, cancele a assinatura** (`PushSubscription.unsubscribe()` + `DELETE /notifications/push/subscriptions`). Sem isso, um aparelho compartilhado continua recebendo os avisos de quem saiu.
- Telas: caixa de entrada com contador; preferências por tipo e canal (WhatsApp e e-mail como "em breve" enquanto estiverem desligados); `/confirmar-email?token=` e `/redefinir-senha?token=` (são os caminhos que o MS5 põe no link, em `ACCOUNT_LINK_PATHS`); "esqueci a senha" chamando a rota real no lugar do `mockRequestPasswordReset`.

---

## Em aberto (sem pressa, não bloqueia nada)

1. **Cache de API separado por usuário (A-01, parte "desejável").** Hoje o cache é apagado no login, no logout e na falha de refresh, o que resolve o caso do aparelho compartilhado. Falta a segunda barreira: a chave do cache incluir o usuário (por exemplo, `quironequine-api-<userId>`, com a página avisando o service worker de quem está logado). Assim, mesmo que a limpeza falhe (aba fechada no meio, sem rede), um usuário nunca recebe a resposta de outro. Vale também para a corrida de uma requisição que termina logo depois do logout e grava no cache.

2. **Laudo com link temporário (M-03), quando existir a tela de exames.** Os links de arquivo (`resultFileUrl`, `photoUrl`, `sketchUrl`, `logoUrl`) chegam assinados e valem 15 minutos. No botão "ver laudo", busque o exame de novo (`GET /exams/:id`) e abra o link que vier, em vez do que está na tela. E não guarde links de arquivo em estado persistido ou no cache do service worker: eles vencem.

3. **CSP da PWA (auditoria B-05), quando for feita.** A política vai precisar liberar o Google Maps (`maps.googleapis.com`, `maps.gstatic.com`), o IBGE (`servicodados.ibge.gov.br`), os tiles do OpenStreetMap (fallback do Leaflet) e a API (`api-homolog...`). Combine com o Marco antes, porque o HSTS fica no Caddy, que é infra.
