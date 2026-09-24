# ADR-002 — Message Broker: Redis + BullMQ, com fan-out no publisher

| | |
|---|---|
| **ID** | ADR-002 |
| **Título** | Escolha do Message Broker (RabbitMQ vs. Redis) e como obter fan-out sem exchange |
| **Data** | Setembro 2026 |
| **Status** | **ACEITO** |
| **Autores** | Marco Túlio S. Oliveira (revisão: João Paiva) |
| **Relacionado a** | ADR-001 §2, §4 (tabela de stack), §5.3 (tabela de eventos), §5.4 (idempotência), §6.2 (mitigações) · ADR-001 Adendo Jul/2026 (BullMQ entra como agendador) |
| **Escopo** | Interno da equipe de desenvolvimento |

---

## Contexto

O ADR-001 deixou a escolha do broker explicitamente em aberto — a tabela de stack registra *"Message Broker | RabbitMQ (ou Redis Pub/Sub) | Rabbit 3.x | Comunicação assíncrona; **Redis se quisermos cache + broker unificado**"* — e o próprio documento se encerra prometendo: *"Próximo ADR: ADR-002 — Decisão sobre Message Broker (RabbitMQ vs. Redis Pub/Sub)"*. Essa ADR nunca foi escrita.

Enquanto isso o código andou. O Adendo de Jul/2026 trocou `node-cron` por **BullMQ Job Scheduler** (o `node-cron` puxava um `uuid` vulnerável), e a Sprint 3 entregou o `DeductionService` consumindo `appointment.done` de uma fila BullMQ. Ou seja: hoje já existe um broker em produção, escolhido por inércia, com dois comentários no código reconhecendo a dívida (`publisher.ts` e `deduction-consumer.ts` citam "a futura ADR-002").

O MS3 (Clinical) é o primeiro **publisher real** do sistema — até agora só havia consumidor. É o momento de fechar a decisão antes de escrever código que dependa dela.

### O problema concreto que forçou a decisão agora

O ADR-001 §5.3 já lista **dois consumidores para o mesmo evento**:

| Evento | Publicado por | Consumido por | Efeito |
|---|---|---|---|
| `appointment.done` | Clinical | **Inventory** | Baixa automática de estoque (RN-003) |
| `appointment.done` | Clinical | **Reporting** | Cria registro financeiro pendente (RN-002) |

A implementação atual usa **uma fila BullMQ compartilhada** (`domain-events`) para todos os eventos. BullMQ não tem exchange: dois workers na mesma fila **competem** — o broker entrega cada job a *um* deles, por round-robin, não uma cópia para cada. Quando o MS6 (Reporting) subir e escutar essa fila, metade das baixas de estoque e metade dos registros financeiros simplesmente deixariam de acontecer. Sem erro, sem log — o job foi "processado com sucesso" pelo worker errado.

Isso não é risco hipotético: está na tabela de um documento aceito e vinculante.

## Decisão

**1. O broker é Redis + BullMQ.** Formalizado, não mais por inércia.

**2. O fan-out é responsabilidade do publisher: uma fila por serviço consumidor.** `publishDomainEvent()` lê `EVENT_SUBSCRIBERS` (em `shared-types`, espelhando a tabela do §5.3) e entrega **uma cópia do evento por assinante**, em filas separadas: `domain-events-inventory`, `domain-events-reporting`, `domain-events-notification`. Cada serviço tem worker só na sua fila e não compete com ninguém.

Detalhes que sustentam isso:

- `jobId` no BullMQ é **por fila**, então a mesma `idempotencyKey` em duas filas não colide: cada consumidor mantém o próprio dedup de redelivery (ADR-001 §5.4 continua valendo, sem mudança).
- Serviço que ainda não existe continua listado de propósito. `alert.triggered` vai para `domain-events-notification` e **fica acumulado lá** até o MS5 subir, em vez de se perder. É o comportamento correto para uma fila durável — ver "Consequências negativas".
- Evento sem assinante nenhum gera `log.warn` e não é publicado. Falha visível em vez de silenciosa.

### Por que não RabbitMQ

A comparação honesta tem um dado que muda a pergunta: **RabbitMQ não substituiria o Redis.** O `AlertService` (RN-009, cron diário 06h UTC) roda no BullMQ Job Scheduler, e RabbitMQ não tem agendamento nativo. A escolha real, portanto, não é *"Redis ou RabbitMQ"* — é *"Redis"* contra *"Redis **e** RabbitMQ"*.

**A favor do RabbitMQ:** fan-out nativo via topic exchange (uma publicação, N consumidores independentes, ligados por routing key — exatamente o desenho do §5.3); `ack`/`nack`/`reject` com requeue; dead letter exchange nativa; TTL por mensagem; publisher confirms; durabilidade por projeto. É o encaixe melhor para o estado final de 7 serviços consumindo subconjuntos diferentes de eventos.

**Contra, neste projeto:** mais um componente de infraestrutura para rodar, monitorar, atualizar e proteger, com **2 devs e sem DevOps dedicado** (o ADR-001 §6.2 já classifica "overhead operacional com 2 devs" como risco médio); stack Erlang e conceitos novos (exchange, binding, vhost, policy) para um time que já opera BullMQ; e não elimina o Redis, então dobraria a superfície de broker. Somado a isso, o custo de migração agora: reescrever publisher, consumer, `alert-scheduler`, testes de integração, `docker-compose`, serviços do CI, scripts de deploy da Oracle e `.env` — código testado e verde.

**Contra o Redis/BullMQ:** sem fan-out nativo (resolvido acima, no publisher); sem exchange/routing key — a convenção de roteamento é nossa, escrita à mão; durabilidade mais fraca (com AOF/RDB dá para perder os últimos segundos num crash); sem DLQ nativa nem a semântica de ack/nack do AMQP.

O desempate: o ganho do RabbitMQ é **fan-out e semântica de entrega**; o fan-out sai por ~40 linhas no publisher com a ferramenta que já está em produção, e a semântica de entrega que perdemos é mitigável por idempotência — que o §5.4 já exige de qualquer jeito, e que o `DeductionService` já implementa (chave derivada por item, testada contra Postgres real).

### Desvio em relação ao ADR-001 que precisa ficar registrado

O ADR-001 ofereceu *"RabbitMQ ou Redis **Pub/Sub**"*. O que usamos é Redis com **BullMQ (filas persistentes)** — tecnicamente uma terceira opção, não listada. A diferença importa e é favorável:

| | Redis Pub/Sub (previsto no ADR-001) | Redis + BullMQ (o que usamos) |
|---|---|---|
| Entrega | Broadcast nativo — fan-out de graça | Fila por consumidor (fan-out no publisher) |
| Persistência | **Nenhuma** — assinante offline perde a mensagem | Job persistido até ser processado |
| Retry | Não existe | `attempts` + backoff exponencial |
| Agendamento | Não existe | Job Scheduler (usado pelo RN-009) |

Pub/Sub daria o fan-out de graça, mas ao custo de perder toda mensagem publicada enquanto o consumidor estivesse fora do ar — inaceitável para baixa de estoque (RN-003 é "automática e imediata", e a perda seria silenciosa). Trocamos fan-out nativo por durabilidade e reconstruímos o fan-out por cima. É uma troca deliberada, não um acidente.

**Sobre a cláusula de vinculação contratual:** o ADR-001 §2 marca como ACEITA e VINCULANTE a decisão arquitetural — microsserviços por domínio, BFF Gateway, PWA e comunicação assíncrona via message broker. Tudo isso permanece intacto. A escolha de *qual* broker foi explicitamente delegada a esta ADR pelo próprio documento, e a tabela de stack já antecipava Redis ("se quisermos cache + broker unificado"), que é exatamente o caso — o Redis já serve broker e agendamento. Portanto **não há necessidade de Termo Aditivo**.

## Pontas soltas conhecidas

Registradas aqui de propósito, para não virarem descoberta arqueológica depois:

**1. O padrão Outbox não está implementado.** O ADR-001 §6.2 lista *"Padrão Outbox para eventos críticos"* como mitigação do risco "distribuição de transações (sem ACID cross-service)". Hoje `publishDomainEvent()` escreve direto no Redis: se o `finish()` de um atendimento commitar no Postgres e o Redis estiver indisponível no instante seguinte, a baixa de estoque se perde — o commit não é atômico com a publicação. Até agora isso não tinha consequência prática (o único publisher real, `alert.triggered`, não tem consumidor). Com o MS3 publicando `appointment.done`, passa a ter.

Decisão: **fica para a fatia seguinte**, junto com o `AppointmentService.finish()` — que é o primeiro publish genuinamente crítico e o lugar natural para a tabela `outbox_events` e o relay. Não implementar agora é escolha consciente, não esquecimento; misturar as duas mudanças tornaria este PR difícil de revisar.

**2. `EVENTS.STOCK_DEDUCTED` não consta da tabela do §5.3** e não tem publisher nem consumidor. Está em `shared-types` desde a Sprint 3, sem uso. Mapeado com lista de assinantes vazia. Ou ganha um consumidor documentado, ou deve ser removido — decidir quando o MS6 (Reporting) for desenhado.

**3. Fila de serviço inexistente cresce sem limite.** `removeOnComplete`/`removeOnFail` só podam jobs já processados; job em espera fica. `alert.triggered` vai acumular em `domain-events-notification` até o MS5 existir (Dez/2026). O volume é baixo (alerta diário por tenant), então é aceitável — mas se o MS5 atrasar muito ou o volume crescer, podar a fila ou suspender o publish.

## Consequências

**Positivas.** O fan-out do §5.3 passa a funcionar de verdade antes de existir consumidor duplicado — o bug nasceria silencioso e só apareceria em produção com o MS6 no ar. Nenhuma infraestrutura nova: nada muda no `docker-compose`, no CI, nos scripts de deploy ou no custo mensal. A tabela `EVENT_SUBSCRIBERS` em `shared-types` dá uma fonte única para o roteamento, rastreável linha a linha contra a tabela do ADR-001 §5.3.

**Negativas / risco residual.** O roteamento é código nosso, não configuração do broker: um evento novo exige lembrar de registrar o assinante (mitigado por `Record<EventName, ...>` — o TypeScript obriga a entrada, e por `log.warn` quando a lista está vazia). Continuamos sem DLQ nativa e sem publisher confirms. E a durabilidade segue sendo a do Redis, não a de um broker AMQP — a mitigação é a idempotência exigida pelo §5.4.

**Gatilhos de reavaliação.** Rever esta decisão se: (a) o grafo de eventos crescer a ponto de a tabela de assinantes ficar difícil de manter — sinal de que roteamento declarativo do broker passou a valer o custo; (b) aparecer requisito de entrega que o BullMQ não cobre (prioridade por mensagem, TTL, roteamento por padrão); ou (c) o projeto passar a ter alguém dedicado a operar infraestrutura, o que muda o peso do argumento principal contra o RabbitMQ.

## Verificação

- `tests/deduction-consumer.test.ts` (Postgres + Redis reais) continua verde: publica `appointment.done` de verdade pelo `publishDomainEvent`, o worker do inventory consome da fila própria e a baixa é aplicada.
- `apps/ms-inventory` com cobertura mantida acima do piso de 70% (RNF-MAN-003).
- Conferido que não sobrou referência a `DOMAIN_EVENTS_QUEUE_NAME` (a fila única antiga) em nenhum serviço.

## Histórico

| Versão | Data | Descrição |
|---|---|---|
| 1.0 | Set/2026 | Criação. Formaliza Redis/BullMQ e introduz fan-out por fila de consumidor. |
