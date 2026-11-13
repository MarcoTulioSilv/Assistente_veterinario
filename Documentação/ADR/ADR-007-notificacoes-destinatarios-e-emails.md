# ADR-007 — Notificações: quem avisar, e-mails da conta e entrega sem texto

| | |
|---|---|
| **ID** | ADR-007 |
| **Título** | Destinatários pelo diretório interno do MS1, e-mails da conta por evento e MS5 sem texto |
| **Data** | Novembro 2026 (Sprint 10 do M3) |
| **Status** | **PROPOSTO** (aceito quando o Dev 2 revisar o PR da Sprint 10) |
| **Autores** | Marco Túlio S. Oliveira |
| **Relacionado a** | ADR-001 §3 e §5.1 (database-per-service) · ADR-002 (broker, fan-out) · ADR-004 (funções `SECURITY DEFINER`) · auditoria de 06/11/2026, M-02 |
| **Escopo** | Interno da equipe de desenvolvimento |

---

## Contexto

O MS5 (Notification) entra no M3 e consome eventos que acumulam desde o M2: `alert.triggered` (MS2), `exam.result_due` e `vaccination.due` (MS3), `payment.registered` (MS6) e, desde a Sprint 9, `schedule.reminder_due` (MS4). Decisões de produto de 12/11/2026 restringem o desenho:

- toda notificação vai para o **veterinário**; nenhuma vai para o proprietário;
- WhatsApp e e-mail ficam **implementados e desligados** até existirem as contas;
- a confirmação de e-mail do cadastro e a recuperação de senha real (auditoria M-02) dependem de envio de e-mail, e quem envia é o MS5.

Três perguntas ficaram em aberto: como o MS5 sabe **quem** avisar sem join entre bancos; como o MS1 pede um e-mail sem expor segredo; e **quem escreve o texto** das notificações.

## Decisão

### 1. Destinatários pelo diretório interno do MS1

Os eventos não trazem o usuário a avisar em todos os casos: os do MS3 trazem o id do **veterinário** (não o do usuário), e o alerta de estoque é da **clínica**. O MS5 consulta o MS1 por uma rota **interna**:

- `GET /internal/tenants/:tenantId/recipients/users/:userId`
- `GET /internal/tenants/:tenantId/recipients/veterinarians/:veterinarianId`
- `GET /internal/tenants/:tenantId/recipients/admins`

O contrato é a `IRecipientDirectory` (`shared-types`); o MS1 implementa no `RecipientService`, e o controller é do Dev 2. A rota fica **fora do BFF** (que só encaminha `/api/v1/...`) e exige o cabeçalho `x-service-token` com o `INTERNAL_SERVICE_TOKEN` (`requireServiceToken`, comparação em tempo constante, falha fechada sem a variável). O tenant vem do envelope do evento; a leitura no MS1 passa por `withTenant`, com RLS, como qualquer outra. Só usuários ativos e não excluídos.

O lembrete da agenda já traz `recipientUserId` e não consulta o MS1 para a caixa de entrada nem para o push. O diretório só é chamado para mapear veterinário → usuário, listar os administradores e, nos canais WhatsApp e e-mail, buscar telefone e e-mail.

**Por que não replicar os usuários no MS5 por evento**: o MS1 não publicava eventos, e manter uma cópia exigiria eventos de criação, alteração e desativação de usuário, mais a reconciliação. A consulta síncrona é simples e o volume é baixo (alguns avisos por dia por clínica). Se o MS1 estiver fora, o job falha e o BullMQ tenta de novo.

### 2. E-mails da conta por evento, com token de vida curta

O MS1 emite o token de uso único (só o SHA-256 vai para `user_tokens`) e publica `auth.email_verification_requested` ou `auth.password_reset_requested` com `{ userId, email, token, expiresAt }`. O MS5 monta o link (`APP_URL` + tela da PWA + `?token=`) e chama o adapter de e-mail.

O token cru existe só **no evento e no link**:

- o publisher do MS1 usa `removeOnComplete`/`removeOnFail` e poucas tentativas, para o job sair do Redis;
- o MS5 não grava o token nem o escreve em log;
- a validade é de 24 h (confirmação) e 30 min (nova senha), e um link novo invalida o anterior.

Com o e-mail desligado (`EMAIL_VERIFICATION_ENABLED=false` no MS1, `EMAIL_ENABLED=false` no MS5), o cadastro segue sem confirmação e o pedido de nova senha não envia nada. A resposta é sempre igual, para não revelar quem tem cadastro. Os usuários que já existiam contam como confirmados: ligar a confirmação depois não tranca ninguém.

**Alternativa descartada**: o MS1 enviar o e-mail direto, com o mesmo adapter. Evitaria o token no Redis, mas espalharia o envio de e-mail por dois serviços e duplicaria configuração e credenciais do provedor.

### 3. O MS5 entrega tipo e dados, não texto

A caixa de entrada e o push levam `type` + `data` (`NotificationData`, união por tipo) + `target`. O texto é montado pela PWA e pelo service worker; o dos e-mails, pelo adapter de e-mail. Ambos são do Dev 2, que já é o dono do texto de tela. Consequência de privacidade: `data` guarda ids, horários e nomes de produto, vacina e tipo de exame, **nunca** nome de cliente ou de animal. A caixa de entrada não tem dado pessoal e por isso não passa pelo `audit_log`.

### 4. Regras de entrega

- Um item por (usuário, evento de origem): a UNIQUE torna o consumo idempotente, e só item **novo** é entregue (redelivery não repete push).
- **Aviso vencido** vai só para a caixa de entrada, sem push, WhatsApp nem e-mail. Conta como vencido o lembrete da agenda cujo evento já começou, o exame ou a re-vacinação cujo dia já passou em São Paulo, e o alerta de estoque com mais de 24 h. É o que protege o primeiro deploy, que consome a fila acumulada desde o M2.
- Uma entrega por canal numa fila própria (`notification-deliveries`): a falha de um canal repete só aquele canal.
- Canal ligado = adapter presente + chave ligada (push exige o par VAPID). Preferência do usuário por tipo e canal (RF-NOT-003): sem linha, está ligado.
- `payment.registered` é consumido e descartado (nada vai ao proprietário, e quem registra o pagamento é o próprio veterinário).

## Consequências

**Positivas.** Nenhum dado pessoal no MS5 nem na fila (exceto o e-mail e o token da conta, de vida curta). O MS1 continua a única fonte de usuários. O primeiro deploy não dispara push antigo.

**Negativas / risco residual.** O MS5 depende do MS1 no momento do aviso, e o deploy da rota interna (Dev 2) precisa vir antes do MS5 no staging: sem ela, os avisos de exame, vacina e estoque falham depois das tentativas. O token da conta passa pelo Redis, por pouco tempo. Um evento perdido entre a gravação da caixa de entrada e o enfileiramento da entrega fica só na caixa de entrada.

## Verificação

- `requireServiceToken`: `packages/shared-middlewares/src/service-token.test.ts`.
- Tokens da conta (uso único, vencido, sessões encerradas) e diretório isolado por tenant: `apps/ms-identity/tests/account-tokens.test.ts`.
- Idempotência, regra do vencido, canais e preferências: `apps/ms-notification/src/services/*.test.ts` e `tests/notification-repository.test.ts`.

## Histórico

| Versão | Data | Descrição |
|---|---|---|
| 1.0 | Nov/2026 | Criação, na Sprint 10 do M3. |
