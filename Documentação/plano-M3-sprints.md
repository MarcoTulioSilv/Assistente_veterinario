# Plano de Trabalho — Marco M3 (rascunho para a v1.4)

> **Rascunho para revisão.** Depois de aprovado, este conteúdo vira a nova seção 6 do
> `PlanoTrabalho_KA_Construcao_QuironEquine.docx` (as seções 6 a 10 atuais passam a 7 a 11)
> e ganha a linha 1.4 no Histórico de Revisões. No .docx o texto segue a convenção do
> documento (sem acentos, `--` como travessão).

---

## 0. Antes das sprints: o que já existe (cruzamento com o código, 12/11/2026)

Levantado na `develop` (commit `f5fa804`), para não planejar o que já está pronto.

| Item | Situação no código | Consequência para o M3 |
|---|---|---|
| Eventos para o MS5 | Publicados hoje: `exam.result_due` e `vaccination.due` (MS3, job diário 07h), `alert.triggered` (MS2) e `payment.registered` (MS6). Declarados **sem payload nem publicador**: `schedule.reminder_due` e `geofence.triggered`. | O MS5 começa consumindo 4 eventos prontos. O MS4 define os payloads dos outros 2. |
| Fila `domain-events-notification` | Acumula desde que o staging subiu (ADR-002, ponta solta nº 3). | Ao subir, o MS5 receberia lembretes vencidos. Precisa de uma regra de descarte (Sprint 10). |
| Fatia financeira do MS6 (v1.3) | `financial_records` + consumo de 6 eventos (abre e cancela pendência) + `GET /financial` (filtro por status e proprietário), `GET /financial/by-source`, `POST /financial/:id/register-payment`. | Falta: filtro por período (RF-REL-003), saídas avulsas (RF-REL-002), fluxo de caixa (RF-REL-001) e dashboard (RF-REL-005). |
| Saídas por compra de estoque | `stock_movements` não guarda valor. `stock.deducted` está declarado sem uso (ADR-002, ponta solta nº 2: "decidir quando o MS6 for desenhado"). | Um evento novo do MS2 para a compra, e o `stock.deducted` sai de vez. |
| "Agendar retorno" (RF-ATD-010) | Previsto como placeholder na Sprint 5, **mas não existe na PWA** (nenhum botão nem texto). | Entra completo na Sprint 9, já ligado ao MS4. |
| `requirePlus` / `requireRole` | Existem em `shared-middlewares`, **sem nenhum uso**. `PlanService.assertUserLimit()` e `isPlus()` também não são chamados fora dos testes. | Hoje nenhuma diferença Básico/Plus da §2.6 é aplicada além do limite de 30 cadastros. |
| Usuários e assistentes (RF-CAD-032) | `User.role` aceita `assistant`, o limite (1 no Básico, 3 no Plus) existe, mas **não há rota para criar usuário**. | Sem isso, "Usuários: até 3" do Plus não existe. Proposto para a Sprint 11. |
| Configurações (RF-CFG) | RF-CFG-002 (valor do km) e RF-CFG-003 (dados do veterinário): prontos em `PATCH /tenants/me`. RF-CFG-004: limites **por produto** prontos; **globais** não. RF-CFG-001 (tabela de procedimentos): **substituído** na reunião de 20/10/2026 (procedimento virou texto livre e o valor entrou na mão de obra). RF-CFG-005 (raio do geofence): não existe. | A tela de Configurações reúne o que já existe e acrescenta limites globais, raio e preferências de notificação. |
| Bloqueio de notificação por cliente (RF-CAD-015) | `Owner.notifyBlocked` existe no MS1; a PWA não tem o controle. | O MS5 respeita o campo; a PWA ganha o controle na Sprint 10. |
| Confirmação de e-mail do cadastro (auditoria M-02) | `User` não tem campo de e-mail confirmado; não há envio de e-mail. | Entra na Sprint 10 com o canal de e-mail do MS5. A recuperação de senha real (hoje é mock) usa o mesmo canal e entra junto. |
| Infra | `docker-compose.yml` já tem `db-scheduling` e `db-notification` no perfil `m3`. Não há `apps/ms-scheduling`, `apps/ms-notification`, workflows de CI nem serviços no staging para eles. | Fundação de infra nas Sprints 9 e 10. |

**Pendência do M2 que pesa no M3 (para o Marco decidir, não é do stakeholder):** na `develop`, a PWA
não tem tela de exames, de vacinação nem de registro de pagamento. O `api.ts` já tem o cliente de
vacinação, mas nenhuma tela o usa. O fluxo de caixa da Sprint 11 depende do registro de pagamento.
Se essas telas ficarem para o M3, ocupam a capacidade do João na Sprint 9.

---

## 6. Detalhamento dos Sprints — Marco M3 (Dezembro/2026)

O Marco M3 é composto por 4 sprints de 2 semanas cada (8 semanas) e cobre três microsserviços:
Scheduling (MS4: agenda, lembretes e geofence), Notification (MS5: push, WhatsApp e e-mail) e o
restante do Reporting (MS6: fluxo de caixa, saídas avulsas e dashboard), mais as Configurações e as
diferenças entre os planos Básico e Plus (ERS §2.6). Reaproveita a fundação dos marcos anteriores:
RLS, broker/BullMQ com uma fila por consumidor (ADR-002), outbox, `SECURITY DEFINER` para varreduras
entre tenants (ADR-006) e o staging na Oracle. Os eventos que o MS5 vai consumir já são publicados
desde o M2 e esperam na fila dele.

**Datas propostas** (a confirmar, ver pergunta Q1):

| Sprint | Semanas | Período |
|---|---|---|
| 9 | 17 e 18 | 16/11 a 27/11/2026 |
| 10 | 19 e 20 | 30/11 a 11/12/2026 |
| 11 | 21 e 22 | 14/12 a 23/12/2026 (Natal no meio) |
| 12 | 23 e 24 | 04/01 a 15/01/2027 (recesso de 24/12 a 03/01) |

### Sprint 9 — Semanas 17 e 18: Agenda (MS4)

Objetivo: agenda mensal e semanal com lembrete por horário, eventos do dia no dashboard e retorno
agendado a partir do atendimento finalizado. Os lembretes já são publicados e esperam na fila do MS5,
como os do M2.

| Dev 1 — Marco Tulio (Back / DB) | Dev 2 — Joao Paiva (UI / Back) |
|---|---|
| Scaffolding de `apps/ms-scheduling` (porta 3004) no padrão dos outros serviços; CI (`ms-scheduling.yml`) e `rls-guard` desde o primeiro commit | Controllers MS4: ScheduleEvent (Zod) — criar, editar, cancelar, concluir, listar por intervalo e "hoje" |
| Schema MS4: `schedule_events` (data/hora, tipo de atividade, proprietário, propriedade, animais, observações, status, origem) + `event_reminders` (antecedências por evento) + `audit_log`, com RLS (RF-AGD-001/002/004) | Rota `/api/v1/schedule` no BFF |
| ScheduleService: CRUD, listagem por mês/semana, eventos do dia em ordem cronológica no fuso de São Paulo (RF-AGD-003, RN-011); validação de proprietário/propriedade no MS1 como no MS3 | Tela Agenda: visões mensal e semanal, formulário de evento com Proprietário antes de Propriedade (RN-001) e lembretes por horário |
| Retorno a partir do atendimento: evento com origem `appointment`, pré-preenchido com proprietário, propriedade e animais do atendimento finalizado (RF-ATD-010, RF-AGD-006) | Botão "Agendar retorno" ao finalizar o atendimento, com data e hora pré-preenchidas (RF-ATD-010, RF-AGD-006) |
| Job de lembretes (`upsertJobScheduler`, a cada 5 min): varredura entre tenants por função `SECURITY DEFINER` (ADR-006) e publicação de `schedule.reminder_due` com chave idempotente por (evento, antecedência) | Dashboard: atividades do dia por horário (RF-AGD-003, RN-011), no lugar do placeholder da Sprint 2 |
| Publicar em shared-types: `IScheduleService`, DTOs, `ScheduleReminderDuePayload` e `GeofenceTriggeredPayload`; e já os contratos do MS5 (`INotificationService`, inbox, preferências, assinatura de push), para a Sprint 10 do Dev 2 começar sem esperar | Testes E2E: criar evento, ver no dia, agendar retorno a partir de um atendimento |
| Testes unitários: ScheduleService e job de lembretes (≥ 70%) | Telas de exames, vacinação e registro de pagamento, **se** ficarem para o M3 (ver pendência do M2 acima) |

**Entregável Sprint 9:** agenda mensal e semanal funcionando, atividades do dia no dashboard, retorno
agendado a partir do atendimento. Lembretes publicados no broker (entregues na Sprint 10).

### Sprint 10 — Semanas 19 e 20: Notificações (MS5)

Objetivo: entregar as notificações pendentes desde o M2 e as da agenda, por push (in-app), WhatsApp e
e-mail, respeitando as preferências do usuário e o bloqueio por cliente. Inclui a confirmação de e-mail
do cadastro e a recuperação de senha real, que dependiam do envio de e-mail.

| Dev 1 — Marco Tulio (Back / DB) | Dev 2 — Joao Paiva (UI / Back) |
|---|---|
| ADR-007: como o MS5 obtém destinatário e contato (telefone, e-mail, `notifyBlocked`, plano) sem join entre bancos, e como o MS1 pede envio de e-mail ao MS5 sem deixar segredo exposto na fila. Registra também que as Configurações ficam distribuídas pelos serviços donos de cada dado (o ADR-001 §3 punha tudo no Reporting) | Adapters dos canais atrás das interfaces do MS5: Web Push (VAPID), WhatsApp Business API (Cloud API da Meta) e e-mail (provedor a definir, Q6) |
| Scaffolding de `apps/ms-notification` (porta 3005), CI e `rls-guard`. Schema: `notifications` (caixa de entrada, chave idempotente UNIQUE), `push_subscriptions` (por aparelho), `notification_preferences` (tipo × canal, RF-NOT-003) e `delivery_attempts` | Controllers MS5 (Zod): caixa de entrada (listar, marcar como lida), preferências, assinar/cancelar push; rota `/api/v1/notifications` no BFF |
| Consumer de `domain-events-notification`: `alert.triggered`, `exam.result_due`, `vaccination.due`, `payment.registered`, `schedule.reminder_due`. Roteamento por preferência e por canal; retentativa com backoff; nada de dado pessoal no log | Service worker: receber push e abrir a tela certa ao tocar; pedido de permissão no momento certo (no iOS só funciona com a PWA instalada) |
| Regra para a fila acumulada: lembrete cuja data já passou vira só item da caixa de entrada, sem push nem WhatsApp. Testada com uma cópia da fila do staging antes do deploy | Tela de notificações (caixa de entrada com contador) e tela de preferências por tipo e canal (RF-NOT-003) |
| Respeitar `Owner.notifyBlocked` (RF-CAD-015) em toda mensagem ao proprietário | Controle "bloquear notificações" na tela do proprietário (RF-CAD-015) |
| MS1: e-mail confirmado (`email_verified_at`), token de uso único com hash e validade, reenvio com limite; recuperação de senha real no mesmo mecanismo (auditoria M-02) | Telas: confirmação de e-mail, reenvio, "esqueci a senha" e nova senha (substituem o mock); rate limit dessas rotas no BFF |
| Testes unitários: roteamento, preferências, descarte de lembrete vencido, confirmação de e-mail (≥ 70%) | Testes E2E: lembrete de agenda chega por push; preferência desligada não envia |

**Entregável Sprint 10:** notificações funcionando por push, WhatsApp e e-mail para os 5 tipos de
evento, com preferências e bloqueio por cliente. Cadastro com confirmação de e-mail e recuperação de
senha real.

### Sprint 11 — Semanas 21 e 22: Relatórios, Geofence e Configurações (MS6, MS4)

Objetivo: fluxo de caixa com entradas e saídas, dashboard com gráficos, geofence no Plano Plus e a tela
de Configurações. As diferenças entre os planos Básico e Plus (ERS §2.6) passam a ser aplicadas no
servidor.

| Dev 1 — Marco Tulio (Back / DB) | Dev 2 — Joao Paiva (UI / Back) |
|---|---|
| MS6: `expenses` (saídas avulsas com data, descrição, categoria e valor, RF-REL-002), filtro por período nas pendências (RF-REL-003) e fluxo de caixa por período: entradas = pagamentos recebidos, saídas = avulsas + compras de estoque (RF-REL-001) | Controllers MS6 (Zod): saídas avulsas, fluxo de caixa, dashboard, período nas pendências |
| MS2: valor pago na entrada de estoque e evento `stock.purchased` (ADR-002, revisão 1.5), consumido pelo MS6 como saída; `stock.deducted` removido (ponta solta nº 2). Limites de alerta globais por tenant (RF-CFG-004) | Telas: fluxo de caixa, saídas avulsas, pendências com filtro por proprietário e período, e dashboard com gráficos (RF-REL-001 a 005) |
| Dashboard (RF-REL-005): receita mensal, maiores proprietários por volume e "mais realizados" conforme a resposta da Q3 (se for por especialidade/exame/vacina, o MS3 passa a mandar o rótulo no payload) | Tela Configurações reunindo: dados do veterinário e valor do km (já existem), limites de alerta globais, raio do geofence e preferências de notificação (RF-CFG-002 a 005) |
| MS4, geofence (Plus): raio por tenant (padrão 500 m, RF-CFG-005), `GET /geofence/targets` (propriedades com pendência segundo a RN-008) e `POST /geofence/hits`, que publica `geofence.triggered` no máximo uma vez por propriedade por dia; o MS5 entrega (RF-AGD-005, RF-NOT-004) | Geofence na PWA: compara a posição com os alvos **no próprio aparelho** (a posição não vai para o servidor) e chama `hits` ao entrar no raio. Só funciona com o app aberto (Q4) |
| Planos (ERS §2.6): `requirePlus` em fluxo de caixa, saídas avulsas, dashboard e geofence; `requireRole('admin')` em financeiro, configurações e usuários. Corrige junto a corrida do limite do Básico (auditoria B-01) | Para o Básico: relatório só em listagem e aviso de upgrade nos recursos Plus (a decisão é do servidor, a tela só reflete) |
| MS1, assistentes (RF-CAD-032, Plus): convidar, listar e desativar usuário, com `assertUserLimit` (1 no Básico, 3 no Plus) e o convite pelo e-mail do MS5 | Telas de usuários: convite, aceite com definição de senha, lista e desativação |
| Testes unitários: fluxo de caixa, saídas, agregações do dashboard, geofence (RN-008), limites de plano (≥ 70%) | Testes E2E: pagamento recebido aparece no fluxo de caixa; usuário do Básico não acessa recurso Plus |

**Entregável Sprint 11:** fluxo de caixa e dashboard no Plus, listagem no Básico; geofence no Plus;
tela de Configurações completa; assistentes no Plus; diferenças entre os planos aplicadas no servidor.

### Sprint 12 — Semanas 23 e 24: Homologação M3

Objetivo: deploy em staging, correções pós-testes, apresentação formal e liberação das parcelas 5, 6 e 7.

| Dev 1 — Marco Tulio (Back / DB) | Dev 2 — Joao Paiva (UI / Back) |
|---|---|
| Correções de bugs críticos reportados nas Sprints 9 a 11 | Ajustes de UX pós-feedback dos stakeholders das Sprints 9 a 11 |
| Staging: bancos `scheduling` e `notification` na mesma instância Postgres, `ms-scheduling` e `ms-notification` no compose, segredos novos (VAPID, WhatsApp, e-mail) no `generate-env.sh`, backup incluindo os bancos novos; conferir memória e CPU da VM (1 OCPU, 6 GB) com 2 serviços a mais | Deploy da PWA em staging com as telas do M3 (mesmo ambiente dos marcos anteriores) |
| Ajuste de performance: índices das consultas por intervalo de data (agenda e fluxo de caixa), medidos como no MS3 (`apps/ms-clinical/scripts/perf-explain.ts`) | Smoke tests em staging: agenda, lembrete, push, WhatsApp, fluxo de caixa, geofence |
| Seed de homologação estendido: agenda, saídas avulsas, pagamentos, notificações, um tenant Básico e um Plus | Guia de uso do M3 para os stakeholders |
| Revisão de segurança: RLS e `rls-guard` nos serviços novos, segredos no CI, `audit-ci`, nenhum dado pessoal em log ou na fila | Apresentação formal M3: demo ao vivo para Rossano e Lais |
| Documentação: manual de implantação (MS4, MS5) e READMEs | Coleta de feedback e abertura de issues para o M4 |
| Preparação e condução do demo para stakeholders | Atualização do board GitHub Projects para o M4 |

**Marco M3 — Critérios de Aceite (Cláusula 7ª)**

1. Agenda, Notificações (push, WhatsApp e e-mail), Relatórios (fluxo de caixa, pendências e dashboard), Configurações e Geofence funcionais em staging.
2. Diferenças entre os planos Básico e Plus (ERS §2.6) aplicadas no servidor: relatórios completos, geofence e assistentes só no Plus.
3. CI/CD verde em MS4, MS5 e MS6 (lint, testes, build, npm audit), com o teste de RLS cobrindo as tabelas novas.
4. Cobertura de testes ≥ 70% nos serviços críticos (RNF-MAN-003).
5. Stakeholders aprovam em até 5 dias úteis após a apresentação (Cláusula 7ª §1º).
6. Após o aceite: parcelas 5, 6 e 7/10 (R$ 3.000,00) liberadas (Cláusula 4ª).

> O valor das parcelas segue o padrão das linhas do M1 e do M2 no Plano (R$ 1.000,00 cada). Não
> conferi no contrato assinado, que ficou fora desta sessão.

---

## Perguntas para os stakeholders

| # | Pergunta | Por que importa | Proposta se não houver resposta |
|---|---|---|---|
| Q1 | O M3 pode fechar em meados de jan/2027? Com 8 semanas a partir de 16/11 e o recesso de fim de ano, a homologação cai em janeiro. | O cronograma diz dez/2026. Isso empurra o M4 (jan/2027) e o M5 (fev/2027), e se soma ao atraso de M1 e M2 que já pede um aditivo ou cronograma formal. | Sprints como na tabela; formalizar junto com o aditivo já pendente. |
| Q2 | A tabela de procedimentos (RF-CFG-001) e a sugestão de procedimentos (RF-ATD-007) estão substituídas pela decisão de 20/10/2026 (procedimento em texto livre, valor na mão de obra)? | Sem confirmação por escrito, a homologação pode cobrar um requisito do ERS que foi trocado em reunião. | Registrar na ata do M3 como substituídos. |
| Q3 | "Procedimentos mais realizados" no dashboard (RF-REL-005): sem tabela de procedimentos, pode ser contado por especialidade do atendimento, tipo de exame e vacina? | Texto livre não dá para agrupar. | Contar por especialidade, tipo de exame e vacina. |
| Q4 | O geofence funciona só com o app aberto. Isso atende? | Navegador não acompanha localização em segundo plano (no iOS, de jeito nenhum). Geofence em segundo plano exige app nativo, fora do escopo atual. | Geofence com o app aberto, avisando na tela de Configurações. |
| Q5 | O que conta como "pendência" para o geofence (RN-008): só retorno agendado na agenda, ou também atendimento com pendência financeira ou exame aguardando resultado? | Define a consulta dos alvos. | Retorno agendado ainda não concluído + exame com resultado previsto. |
| Q6 | Quem cria e paga as contas de WhatsApp Business (Meta) e do provedor de e-mail? Em nome de quem saem as mensagens? | A Meta exige verificação da empresa e aprovação prévia de cada modelo de mensagem, o que leva dias. Precisa começar na Sprint 9 para estar pronto na Sprint 10. Cada conversa iniciada pela empresa tem custo. | Contas em nome do contratante; enquanto não saem, o canal WhatsApp fica desligado e o resto funciona. |
| Q7 | Quais notificações vão para o **proprietário** (WhatsApp) e quais só para o veterinário? O proprietário precisa autorizar antes (opt-in)? | O ERS lista os eventos, mas não o destinatário. A política da Meta e a LGPD exigem consentimento para mensagem ao cliente. | Para o proprietário: lembrete de agenda, retorno e pagamento recebido, só com opt-in registrado. O resto, só para o veterinário. |
| Q8 | O retorno agendado (RF-AGD-006) vem pré-preenchido com qual data? Existe um prazo padrão de retorno? | O ERS diz "data e hora pré-preenchidas", sem dizer quais. | Mesmo horário do atendimento, 7 dias depois, editável. |
| Q9 | A compra de estoque entra como saída no fluxo de caixa automaticamente, com o valor pago informado na entrada? | Hoje a entrada de estoque não tem valor. | Sim, com campo opcional de valor pago; sem valor, não gera saída. |
| Q10 | O que o assistente (RF-CAD-032) pode fazer? Vê o financeiro? Mexe em configurações? O que significa "dados do assistente revisados pelo veterinário"? | Define o `requireRole` de cada rota. | Assistente faz cadastros, atendimentos, agenda e estoque; não vê financeiro, configurações nem usuários. O veterinário aprova o convite. |
| Q11 | Saídas avulsas e fluxo de caixa são só do Plus? A §2.6 diz Básico = "listagem" e Plus = "fluxo de caixa, gráficos". | Define o `requirePlus`. | Básico vê as listas de pendências e recebidos; saídas avulsas, fluxo de caixa e gráficos só no Plus. |

## Decisões técnicas que ficam com a equipe (não vão para os stakeholders)

- **ADR-007 (Sprint 10)**: como o MS5 resolve destinatário e contato. Proposta: rota interna do MS1 com
  credencial de serviço, devolvendo só contato, `notifyBlocked` e plano. O payload do evento não leva
  dado pessoal.
- **Envio de e-mail pedido pelo MS1** (confirmação, convite, recuperação de senha): evento para o MS5
  com token de vida curta e `removeOnComplete`, ou o MS1 enviando direto pelo mesmo adapter. Decidir no
  ADR-007.
- **ADR-002 revisão 1.5**: payloads de `schedule.reminder_due` e `geofence.triggered`, evento novo
  `stock.purchased` e remoção de `stock.deducted`.
- **ADR-001 §3**: as Configurações ficam com o serviço dono de cada dado (MS1, MS2, MS4, MS5), não no
  Reporting. Registrar a mudança.

## Riscos

- **Capacidade do Dev 2 na Sprint 9**, se as telas de exames, vacinação e pagamento do M2 entrarem no M3.
- **Sprint 11 cheia e com Natal no meio.** Se apertar, o candidato a ir para a Sprint 12 é o cadastro
  de assistentes (RF-CAD-032), que é do MS1 e não depende do resto.
- **WhatsApp depende de terceiros** (verificação na Meta, aprovação dos modelos de mensagem). Mitigação:
  começar a verificação na Sprint 9 e ter os outros canais independentes dele.
- **Push no iOS** só com a PWA instalada na tela inicial (iOS 16.4 ou mais). Precisa constar no guia de uso.
- **VM do staging** (1 OCPU, 6 GB) passa a rodar 6 serviços Node. Medir antes do deploy da Sprint 12.

## Fora do escopo do M3 (já registrados em outro lugar)

- Itens restantes da auditoria (B-02 a B-08, I-01, I-02), salvo o B-01, que entra na Sprint 11 por ser
  do mesmo assunto (limite de plano). Ficam para antes da produção (M5).
- Tela de cadastro de clínica e troca de senha (lacunas de produto do M1/M2).
- IA por voz (MS7, M4).
