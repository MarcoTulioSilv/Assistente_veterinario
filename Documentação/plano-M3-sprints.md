# Plano de Trabalho — Marco M3 (base da v1.4)

> Base da seção 6 do `PlanoTrabalho_KA_Construcao_QuironEquine.docx` v1.4 (as seções 6 a 10
> anteriores passaram a 7 a 11). Este arquivo guarda também o que não cabe no Plano: o cruzamento com
> o código, as decisões de 12/11/2026, as decisões técnicas, os riscos e o que ficou em aberto.

---

## 0. O que já existe (cruzamento com o código, 12/11/2026)

Levantado na `develop` (commit `f5fa804`), para não planejar o que já está pronto.

| Item | Situação no código | Consequência para o M3 |
|---|---|---|
| Eventos para o MS5 | Publicados hoje: `exam.result_due` e `vaccination.due` (MS3, job diário 07h), `alert.triggered` (MS2) e `payment.registered` (MS6). Declarados **sem payload nem publicador**: `schedule.reminder_due` e `geofence.triggered`. | O MS5 começa consumindo eventos prontos. O MS4 define os payloads dos outros 2. |
| Fila `domain-events-notification` | Acumula desde que o staging subiu (ADR-002, ponta solta nº 3). | Ao subir, o MS5 receberia lembretes vencidos. Precisa de regra de descarte (Sprint 10). |
| Fatia financeira do MS6 (v1.3) | `financial_records` + consumo de 6 eventos (abre e cancela pendência) + `GET /financial` (filtro por status e proprietário), `GET /financial/by-source`, `POST /financial/:id/register-payment`. | Falta: filtro por período (RF-REL-003), saídas avulsas (RF-REL-002), fluxo de caixa (RF-REL-001) e dashboard (RF-REL-005). |
| Compras de estoque no caixa | `stock_movements` não guarda valor. `stock.deducted` está declarado sem uso (ADR-002, ponta solta nº 2). | Por decisão de 12/11, sem entrada automática: rota própria no MS6 (Sprint 11). `stock.deducted` é removido. |
| "Agendar retorno" (RF-ATD-010) | Previsto como placeholder na Sprint 5, **mas não existe na PWA**. | Por decisão de 12/11, o retorno é definido no próprio atendimento (Sprint 9). |
| `requirePlus` / `requireRole` | Existem em `shared-middlewares`, **sem nenhum uso**. `PlanService.assertUserLimit()` e `isPlus()` também não são chamados fora dos testes. | Hoje só o limite de 30 cadastros diferencia os planos. `requirePlus` na Sprint 11, `requireRole` na Sprint 12. |
| Usuários e assistentes (RF-CAD-032) | `User.role` aceita `assistant` e o limite (1 no Básico, 3 no Plus) existe, mas **não há rota para criar usuário**. | Sprint 12, com a revisão pelo veterinário. |
| Configurações (RF-CFG) | RF-CFG-002 (valor do km) e RF-CFG-003 (dados do veterinário): prontos em `PATCH /tenants/me`. RF-CFG-004: limites **por produto** prontos; **globais** não. RF-CFG-001: substituído em 20/10/2026 (confirmado em 12/11). RF-CFG-005 (raio do geofence): não existe. | A tela de Configurações reúne o que existe e acrescenta limites globais, raio, dias sem visita e preferências de notificação. |
| Bloqueio de notificação por cliente (RF-CAD-015) | `Owner.notifyBlocked` existe no MS1; a PWA não tem o controle. | Sem efeito no M3: nenhuma notificação vai para o proprietário (decisão de 12/11). Ver "Em aberto". |
| Confirmação de e-mail do cadastro (auditoria M-02) | `User` não tem campo de e-mail confirmado; não há envio de e-mail. | Sprint 10, desligada até a conta de e-mail existir. A recuperação de senha real usa o mesmo caminho. |
| Dashboard | A tela inicial mostra contagens de cadastros e estoque; **não** mostra quantidade de atendimentos. | "Quantidade de atendimentos" substitui "procedimentos mais realizados" (Sprint 11). |
| Telas do M2 na PWA | Na `develop`, não há tela de exames, de vacinação nem de registro de pagamento. | Registrado em `pedidos-para-joao.md`. Entram na Sprint 9 do João, porque o fluxo de caixa depende do registro de pagamento. |
| Infra | `docker-compose.yml` já tem `db-scheduling` e `db-notification` no perfil `m3`. Não há `apps/ms-scheduling`, `apps/ms-notification`, workflows de CI nem serviços no staging para eles. | Fundação nas Sprints 9 e 10; staging na Sprint 14. |

---

## Decisões de 12/11/2026 (respostas às perguntas do rascunho)

| # | Assunto | Decisão |
|---|---|---|
| 1 | Prazo | Mantidas as datas propostas. O cronograma da seção 3 do Plano não muda. |
| 2 | Tabela de procedimentos (RF-CFG-001, RF-ATD-007) | Substituída pela decisão de 20/10/2026: procedimento em texto livre, valor na mão de obra. |
| 3 | Dashboard (RF-REL-005) | "Procedimentos mais realizados" sai; entra "quantidade de atendimentos", que ainda não existe. |
| 4 | Geofence | Implementado na PWA (funciona com o app aberto). No lançamento, o app é encapsulado como nativo, o que libera o geofence em segundo plano. |
| 5 | Pendência para o geofence (RN-008) | Retorno agendado ainda não concluído, ou proprietário sem visita há mais de N dias (N configurável). |
| 6 | Contas de WhatsApp e e-mail | Canais implementados, mas desligados até as contas existirem. |
| 7 | Destinatário | Nenhuma notificação vai para o proprietário. Todas vão para o veterinário. |
| 8 | Data do retorno | Definida no próprio atendimento. |
| 9 | Compra de estoque no fluxo de caixa | Não entra automaticamente. Criar uma rota de entrada de compra de estoque; a regra será definida na próxima reunião. |
| 10 | Assistente | Todo dado inserido pelo assistente (atendimentos, lançamentos de estoque etc.) é revisado pelo veterinário. O veterinário pode desativar a revisão manualmente. |
| 11 | Saídas avulsas e fluxo de caixa | Só no Plus. O Básico tem a listagem. |
| — | Envio de e-mail pedido pelo MS1 | O MS1 publica um evento com token de vida curta; o MS5 envia. |
| — | Assistentes | Sprint 12. |
| — | Lacunas de produto | Sprint 13, antes da homologação (Sprint 14). |

---

## 6. Detalhamento dos Sprints — Marco M3 (Dezembro/2026)

O Marco M3 é composto por 6 sprints de 2 semanas cada (12 semanas) e cobre três microsserviços:
Scheduling (MS4: agenda, lembretes e geofence), Notification (MS5: push, WhatsApp e e-mail) e o
restante do Reporting (MS6: fluxo de caixa, saídas avulsas e dashboard). Inclui também as
Configurações, as diferenças entre os planos Básico e Plus (ERS §2.6), os assistentes com revisão pelo
veterinário e uma sprint para fechar as lacunas de produto antes da homologação. Reaproveita a fundação
dos marcos anteriores: RLS, broker/BullMQ com uma fila por consumidor (ADR-002), outbox,
`SECURITY DEFINER` para varreduras entre tenants (ADR-006) e o staging na Oracle. Os eventos que o MS5
vai consumir já são publicados desde o M2 e esperam na fila dele. Todas as notificações vão para o
veterinário; nenhuma vai para o proprietário. WhatsApp e e-mail ficam implementados e desligados até as
contas existirem.

| Sprint | Semanas | Período | Tema |
|---|---|---|---|
| 9 | 17 e 18 | 16/11 a 27/11/2026 | Agenda (MS4) |
| 10 | 19 e 20 | 30/11 a 11/12/2026 | Notificações (MS5) |
| 11 | 21 e 22 | 14/12 a 23/12/2026 | Relatórios, Geofence e Configurações |
| — | — | 24/12/2026 a 03/01/2027 | Recesso |
| 12 | 23 e 24 | 04/01 a 15/01/2027 | Assistentes e revisão |
| 13 | 25 e 26 | 18/01 a 29/01/2027 | Lacunas de produto |
| 14 | 27 e 28 | 01/02 a 12/02/2027 | Homologação M3 |

### Sprint 9 — Semanas 17 e 18: Agenda (MS4)

Objetivo: agenda mensal e semanal com lembrete por horário, atividades do dia no dashboard e retorno
definido no próprio atendimento, que vai para a agenda ao finalizar. Os lembretes já são publicados e
esperam na fila do MS5, como os do M2.

| Dev 1 — Marco Tulio (Back / DB) | Dev 2 — Joao Paiva (UI / Back) |
|---|---|
| Scaffolding de `apps/ms-scheduling` (porta 3004) no padrão dos outros serviços; CI (`ms-scheduling.yml`) e `rls-guard` desde o primeiro commit | Telas do M2 que faltam: exames, vacinação e registro de pagamento (ver `pedidos-para-joao.md`) |
| Schema MS4: `schedule_events` (data/hora, tipo de atividade, proprietário, propriedade, animais, observações, status, origem), `event_reminders` e `audit_log`, com RLS (RF-AGD-001/002/004) | Controllers MS4 (Zod): criar, editar, cancelar, concluir, listar por intervalo e "hoje"; rota `/api/v1/schedule` no BFF |
| ScheduleService: CRUD, listagem por mês/semana, eventos do dia em ordem cronológica no fuso de São Paulo (RF-AGD-003, RN-011) | Tela Agenda: visões mensal e semanal, formulário com Proprietário antes de Propriedade (RN-001) e lembretes por horário |
| Retorno (RF-ATD-010, RF-AGD-006): campo `returnAt` no atendimento (MS3, editável no rascunho) e no `appointment.done`, junto com propriedade e animais; o MS4 assina o evento e cria o retorno na agenda, idempotente | Campo "Retorno" (data e hora) no formulário de atendimento; o retorno aparece na agenda depois de finalizar |
| Última visita por proprietário (para o geofence da Sprint 11): o MS4 registra a data a partir de `appointment.done` e `vaccination.applied`, com carga inicial única a partir do MS3 | Dashboard: atividades do dia por horário (RF-AGD-003, RN-011), no lugar do placeholder da Sprint 2 |
| Job de lembretes (`upsertJobScheduler`, a cada 5 min): varredura entre tenants por `SECURITY DEFINER` (ADR-006), publica `schedule.reminder_due` com chave idempotente por (evento, antecedência). Contratos do MS4 e do MS5 publicados em shared-types | Testes E2E: criar evento, ver no dia, retorno definido no atendimento aparece na agenda |
| Testes unitários: ScheduleService, retorno, última visita e job de lembretes (≥ 70%) | |

**Entregável Sprint 9:** agenda mensal e semanal, atividades do dia no dashboard, retorno definido no
atendimento e levado para a agenda. Telas de exames, vacinação e pagamento na PWA.

### Sprint 10 — Semanas 19 e 20: Notificações (MS5)

Objetivo: entregar ao veterinário as notificações pendentes desde o M2 e as da agenda, por push (in-app),
WhatsApp e e-mail, respeitando as preferências dele. WhatsApp e e-mail ficam desligados até as contas
existirem. Inclui a confirmação de e-mail do cadastro e a recuperação de senha real.

| Dev 1 — Marco Tulio (Back / DB) | Dev 2 — Joao Paiva (UI / Back) |
|---|---|
| ADR-007: o MS5 obtém o contato do veterinário por rota interna do MS1 com credencial de serviço (o evento não leva dado pessoal); e-mails pedidos pelo MS1 viajam em evento com token de vida curta, enviados pelo MS5 | Adapters dos canais atrás das interfaces do MS5: Web Push (VAPID), WhatsApp Business API (Cloud API da Meta) e e-mail; os dois últimos desligados por configuração |
| Scaffolding de `apps/ms-notification` (porta 3005), CI e `rls-guard`. Schema: `notifications` (caixa de entrada, chave idempotente UNIQUE), `push_subscriptions`, `notification_preferences` (tipo × canal, RF-NOT-003) e `delivery_attempts` | Controllers MS5 (Zod): caixa de entrada, preferências, assinar/cancelar push; rota `/api/v1/notifications` no BFF |
| Consumer de `domain-events-notification`: `alert.triggered`, `exam.result_due`, `vaccination.due`, `schedule.reminder_due`; destinatário sempre o veterinário; canal desligado é pulado; retentativa com backoff; nada de dado pessoal no log. `payment.registered` é descartado (quem registra o pagamento é o próprio veterinário) | Service worker: receber push e abrir a tela certa ao tocar; pedido de permissão no momento certo (no iOS, só com a PWA instalada) |
| Regra para a fila acumulada: lembrete cuja data já passou vira só item da caixa de entrada, sem push. Testada com uma cópia da fila do staging antes do deploy | Tela de notificações (caixa de entrada com contador) e tela de preferências por tipo e canal (RF-NOT-003) |
| MS1: e-mail confirmado (`email_verified_at`), token de uso único com hash e validade, reenvio com limite; recuperação de senha real no mesmo mecanismo (auditoria M-02). Enquanto o e-mail estiver desligado, o cadastro segue sem confirmação, como hoje | Telas: confirmação de e-mail, reenvio, "esqueci a senha" e nova senha (substituem o mock); rate limit dessas rotas no BFF |
| Testes unitários: roteamento, preferências, descarte de lembrete vencido, canal desligado, confirmação de e-mail (≥ 70%) | Testes E2E: lembrete de agenda chega por push; preferência desligada não envia |

**Entregável Sprint 10:** notificações por push para o veterinário nos 4 tipos de evento, com caixa de
entrada e preferências. WhatsApp, e-mail, confirmação de cadastro e recuperação de senha prontos e
testados, desligados até as contas existirem.

### Sprint 11 — Semanas 21 e 22: Relatórios, Geofence e Configurações (MS6, MS4)

Objetivo: fluxo de caixa com entradas e saídas, dashboard com gráficos, geofence e a tela de
Configurações. As diferenças de plano da §2.6 passam a ser aplicadas no servidor: fluxo de caixa,
saídas avulsas e gráficos só no Plus.

| Dev 1 — Marco Tulio (Back / DB) | Dev 2 — Joao Paiva (UI / Back) |
|---|---|
| MS6: `expenses` (saídas avulsas com data, descrição, categoria e valor, RF-REL-002), filtro por período nas pendências (RF-REL-003) e fluxo de caixa por período: entradas = pagamentos recebidos, saídas = avulsas + compras de estoque (RF-REL-001) | Controllers MS6 (Zod): saídas avulsas, compras de estoque, fluxo de caixa, dashboard, período nas pendências |
| MS6: rota de entrada de compra de estoque, lançada à mão (sem entrada automática); a regra fina vem da próxima reunião. `stock.deducted` removido (ADR-002, ponta solta nº 2). MS2: limites de alerta globais por tenant (RF-CFG-004) | Telas: fluxo de caixa, saídas avulsas, compras de estoque, pendências com filtro por proprietário e período, e dashboard com gráficos (RF-REL-001 a 005) |
| Dashboard (RF-REL-005): receita mensal, proprietários com maior volume e quantidade de atendimentos por mês (contagem servida pelo MS3) | Tela Configurações: dados do veterinário e valor do km (já existem), limites de alerta globais, raio do geofence, dias sem visita e preferências de notificação (RF-CFG-002 a 005) |
| MS4, geofence (RF-AGD-005, RF-NOT-004, RN-008): raio por tenant (padrão 500 m, RF-CFG-005) e dias sem visita (configurável); `GET /geofence/targets` (retornos não concluídos + proprietários sem visita há mais de N dias) e `POST /geofence/hits`, que publica `geofence.triggered` no máximo uma vez por propriedade por dia | Geofence na PWA: compara a posição com os alvos no próprio aparelho (a posição não vai para o servidor) e chama `hits` ao entrar no raio. Funciona com o app aberto; em segundo plano, só com o app nativo do lançamento |
| Planos (ERS §2.6): `requirePlus` em fluxo de caixa, saídas avulsas, compras de estoque, gráficos do dashboard e geofence. Corrige junto a corrida do limite do Básico (auditoria B-01) | Para o Básico: relatório em listagem e aviso de upgrade nos recursos Plus (a decisão é do servidor, a tela só reflete) |
| Testes unitários: fluxo de caixa, saídas, agregações do dashboard, alvos do geofence (RN-008), limites de plano (≥ 70%) | Testes E2E: pagamento recebido aparece no fluxo de caixa; usuário do Básico não acessa recurso Plus |

**Entregável Sprint 11:** fluxo de caixa, saídas avulsas e dashboard no Plus, listagem no Básico;
geofence com o app aberto; tela de Configurações completa; diferenças de plano aplicadas no servidor.

### Sprint 12 — Semanas 23 e 24: Assistentes e revisão pelo veterinário (MS1, MS2, MS3)

Objetivo: cadastrar assistentes no Plano Plus (até 3 usuários, RF-CAD-032), com todo dado inserido pelo
assistente passando pela revisão do veterinário. A revisão pode ser desativada pelo veterinário.

| Dev 1 — Marco Tulio (Back / DB) | Dev 2 — Joao Paiva (UI / Back) |
|---|---|
| ADR-008: modelo da revisão — situação "aguardando revisão" nos registros criados por assistente e o que acontece antes da aprovação (baixa de estoque, pendência financeira, eventos) | Controllers (Zod): usuários (convidar, listar, desativar) e revisão (fila, aprovar, devolver) |
| MS1: convidar, listar e desativar usuário, com `assertUserLimit` (1 no Básico, 3 no Plus); convite por link de uso único, enviado por e-mail quando o canal estiver ligado ou copiado pelo veterinário enquanto não estiver | Telas de usuários: convite, aceite com definição de senha, lista e desativação |
| Revisão nos registros do assistente: cadastros (MS1), lançamentos de estoque (MS2), atendimentos, exames e vacinações (MS3); quem criou fica gravado; aprovação e devolução no `audit_log` | Fila de revisão do veterinário, com contador no dashboard, e indicação "aguardando revisão" nas listas |
| Configuração do tenant para desativar a revisão (só o veterinário altera) | Configuração "revisar dados do assistente" (liga/desliga) na tela de Configurações |
| `requireRole('admin')` em financeiro, configurações, usuários e aprovação de revisão | Menu e telas conforme o papel (a decisão é do servidor) |
| Testes unitários: limite de usuários, revisão em cada serviço, revisão desativada, papéis (≥ 70%) | Testes E2E: assistente lança atendimento, veterinário aprova; assistente não acessa o financeiro |

**Entregável Sprint 12:** assistentes no Plus, com revisão pelo veterinário em cadastros, estoque e
atendimentos, desativável por ele.

### Sprint 13 — Semanas 25 e 26: Lacunas de produto

Objetivo: fechar as lacunas de produto conhecidas e as que aparecerem nas Sprints 9 a 12, para a
homologação começar sem pendência conhecida.

| Dev 1 — Marco Tulio (Back / DB) | Dev 2 — Joao Paiva (UI / Back) |
|---|---|
| Troca de senha: senha atual + nova, encerrando as sessões dos outros aparelhos | Tela de cadastro de clínica (a API existe desde o M1) |
| Proprietário com CNPJ (hoje o campo `cpf` só comporta CPF) | Tela de troca de senha |
| FKs compostas por tenant em MS2 e MS3 (auditoria, item 3) | Campo CPF/CNPJ no cadastro de proprietário |
| Seeds de dev do MS1 e do MS2 no mesmo tenant | Coordenada vazia virando 0 no `geo.schema.ts` |
| Lacunas de servidor levantadas nas Sprints 9 a 12 | Cache de API separado por usuário (pedido nº 1 em aberto) |
| Testes unitários do que mudar (≥ 70%) | Lacunas de tela levantadas nas Sprints 9 a 12 |

**Entregável Sprint 13:** cadastro de clínica, troca de senha e proprietário com CNPJ funcionando; lista
de lacunas zerada antes da homologação.

### Sprint 14 — Semanas 27 e 28: Homologação M3

Objetivo: deploy em staging, correções pós-testes, apresentação formal e liberação das parcelas 5, 6 e 7.

| Dev 1 — Marco Tulio (Back / DB) | Dev 2 — Joao Paiva (UI / Back) |
|---|---|
| Correções de bugs críticos reportados nas Sprints 9 a 13 | Ajustes de UX pós-feedback dos stakeholders das Sprints 9 a 13 |
| Staging: bancos `scheduling` e `notification`, `ms-scheduling` e `ms-notification` no compose, segredos novos (VAPID, WhatsApp, e-mail) no `generate-env.sh`, backup dos bancos novos; conferir memória e CPU da VM (1 OCPU, 6 GB) com 2 serviços a mais | Deploy da PWA em staging com as telas do M3 (mesmo ambiente dos marcos anteriores) |
| Ajuste de performance: índices das consultas por intervalo de data (agenda e fluxo de caixa), medidos como no MS3 (`apps/ms-clinical/scripts/perf-explain.ts`) | Smoke tests em staging: agenda, lembrete, push, fluxo de caixa, geofence, assistente com revisão |
| Seed de homologação estendido: agenda, saídas, pagamentos, notificações, um tenant Básico e um Plus com assistente | Guia de uso do M3 para os stakeholders |
| Revisão de segurança: RLS e `rls-guard` nos serviços novos, segredos no CI, `audit-ci`, nenhum dado pessoal em log ou na fila | Apresentação formal M3: demo ao vivo para Rossano e Lais |
| Documentação: manual de implantação (MS4, MS5) e READMEs | Coleta de feedback e abertura de issues para o M4 |
| Preparação e condução do demo para stakeholders | Atualização do board GitHub Projects para o M4 |

**Marco M3 — Critérios de Aceite (Cláusula 7ª)**

1. Agenda, Notificações (push), Relatórios (fluxo de caixa, pendências e dashboard), Configurações, Geofence e Assistentes funcionais em staging.
2. WhatsApp, e-mail e confirmação de cadastro implementados e testados, ligados quando as contas existirem.
3. Diferenças entre os planos Básico e Plus (ERS §2.6) aplicadas no servidor: fluxo de caixa, saídas avulsas, gráficos e assistentes só no Plus.
4. CI/CD verde em MS4, MS5 e MS6 (lint, testes, build, npm audit), com o teste de RLS cobrindo as tabelas novas.
5. Cobertura de testes ≥ 70% nos serviços críticos (RNF-MAN-003).
6. Stakeholders aprovam em até 5 dias úteis após a apresentação (Cláusula 7ª §1º).
7. Após o aceite: parcelas 5, 6 e 7/10 (R$ 3.000,00) liberadas (Cláusula 4ª).

> O valor das parcelas segue o padrão das linhas do M1 e do M2 no Plano (R$ 1.000,00 cada). Não foi
> conferido no contrato assinado.

---

## Decisões técnicas da equipe

- **ADR-007 (Sprint 10):** contato do veterinário por rota interna do MS1 com credencial de serviço; o
  payload do evento não leva dado pessoal. E-mails pedidos pelo MS1 (confirmação, recuperação de senha,
  convite) vão em evento com token de vida curta e `removeOnComplete`; o MS5 envia.
- **ADR-008 (Sprint 12):** modelo da revisão dos dados do assistente.
- **ADR-002, revisão 1.5:** payloads de `schedule.reminder_due` e `geofence.triggered`; o MS4 passa a
  assinar `appointment.done` e `vaccination.applied`; `appointment.done` ganha `propertyId`,
  `animalIds` e `returnAt`; `payment.registered` deixa de ter destino no MS5; `stock.deducted` sai.
- **ADR-001:** §3 — as Configurações ficam com o serviço dono de cada dado (MS1, MS2, MS4, MS5), não no
  Reporting; §5.3 — `payment.registered` não notifica mais o proprietário.

## Em aberto

- **Próxima reunião:** regra da compra de estoque no fluxo de caixa (decisão 9).
- **Valor padrão de "dias sem visita"** para o geofence (decisão 5). Proposta: 90 dias.
- **RF-CAD-015 (bloquear notificação por cliente):** sem notificação ao proprietário, o requisito fica
  sem efeito no M3. Registrar na ata como "atendido por não haver notificação ao cliente" ou reinterpretar
  (por exemplo, silenciar os avisos sobre aquele cliente).
- **O que o assistente pode ver:** a decisão 10 trata da revisão; a proposta é que o assistente não veja
  financeiro, configurações nem usuários.

## Riscos

- **Prazo:** a homologação termina em 12/02/2027, e o cronograma da seção 3 diz Dez/2026 (mantido por
  decisão). O M4 (Jan/2027) e o M5 (Fev/2027) ficam sobrepostos ao M3.
- **Sprint 9 cheia para o Dev 2**, com as telas do M2 e a agenda.
- **Sprint 11 com o Natal no meio.**
- **Push no iOS** só com a PWA instalada na tela inicial (iOS 16.4 ou mais). Precisa constar no guia de uso.
- **VM do staging** (1 OCPU, 6 GB) passa a rodar 6 serviços Node. Medir antes do deploy da Sprint 14.

## Fora do escopo do M3

- Itens restantes da auditoria (B-02 a B-08, I-01, I-02), salvo o B-01 (Sprint 11). Ficam para antes
  da produção (M5).
- Encapsulamento como app nativo (lançamento, M5).
- IA por voz (MS7, M4).
