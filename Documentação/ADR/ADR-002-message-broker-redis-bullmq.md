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

**1. ~~O padrão Outbox não está implementado.~~ Implementado no MS3** (revisão 1.1 desta ADR). O ADR-001 §6.2 lista *"Padrão Outbox para eventos críticos"* como mitigação do risco "distribuição de transações (sem ACID cross-service)". Publicar direto no Redis não é atômico com o commit: se o `finish()` de um atendimento commitasse no Postgres e o Redis estivesse indisponível no instante seguinte, a baixa de estoque se perderia em silêncio.

Como ficou, em `apps/ms-clinical`:

- `outbox_events` guarda o envelope do evento, gravado **na mesma transação** da mudança de negócio (`enqueueOutboxEvent(tx, ...)` recebe o `tx` de quem chama justamente para não abrir transação própria). Ou os dois acontecem, ou nenhum.
- Um relay drena a tabela e publica no broker. Ele é um `setTimeout` encadeado, **não** um job repetível do BullMQ — e isso é deliberado: o relay existe para sobreviver ao broker estar fora do ar, então o gatilho dele não pode morar dentro do que ele conserta. Redis fora com relay agendado no BullMQ significaria nunca drenar, nem depois do Redis voltar.
- **Entrega ao menos uma vez, por desenho**: publica primeiro, marca depois. Morrer entre as duas coisas republica no ciclo seguinte, e o `jobId` (a `idempotencyKey` do envelope) descarta o duplicado. A ordem inversa perderia o evento — exatamente o que o padrão existe para impedir.
- A leitura é cross-tenant (o relay é infraestrutura, não roda no contexto de um tenant), então usa uma função `SECURITY DEFINER` estreita, `clinical_list_pending_outbox`, seguindo o padrão já estabelecido pelas ADR-004 e ADR-006 — nunca um client Prisma de superusuário. A **marcação** não precisa de bypass: o relay já tem o `tenant_id` de cada linha e faz o `UPDATE` dentro de `withTenant()`, com a policy ativa.

O `ms-inventory` **não** ganhou outbox, de propósito: o único evento que ele publica (`alert.triggered`) nasce de uma varredura de leitura, não de uma escrita transacional — não há commit com o qual ser atômico.

**2. `EVENTS.STOCK_DEDUCTED` não consta da tabela do §5.3** e não tem publisher nem consumidor. Está em `shared-types` desde a Sprint 3, sem uso. Mapeado com lista de assinantes vazia. Ou ganha um consumidor documentado, ou deve ser removido — decidir quando o MS6 (Reporting) for desenhado.

**3. Fila de serviço inexistente cresce sem limite.** `removeOnComplete`/`removeOnFail` só podam jobs já processados; job em espera fica. `alert.triggered` vai acumular em `domain-events-notification` até o MS5 existir (Dez/2026). O volume é baixo (alerta diário por tenant), então é aceitável — mas se o MS5 atrasar muito ou o volume crescer, podar a fila ou suspender o publish.

**4. Evento novo fora da tabela do ADR-001 §5.3: `appointment.deleted`** (revisão 1.2). Nasceu da regra de exclusão de atendimento finalizado (decisão do Marco, 01/10/2026): o atendimento pode ser excluído, e a exclusão cancela a pendência financeira no MS6. Só o `reporting` assina — o estoque consumido não volta, porque o produto foi de fato usado no animal. Rascunho excluído não publica nada (nunca gerou cobrança). Pagamento já recebido nunca é cancelado: o registro fica `received` e o caso vai pra log como aviso, porque é o que alguém do financeiro vai querer achar (possível estorno).

O ponto delicado é a **ordem de chegada**. Um `appointment.done` que falha uma vez entra em retry com backoff, e nesse intervalo o `appointment.deleted` pode ser processado primeiro — o cancelamento não acharia nada, e o retry criaria uma pendência cobrando um atendimento já excluído. A solução foi uma UNIQUE em `(source_type, source_id)` no `financial_records`: uma origem tem no máximo um registro. Se a exclusão chega antes, ela grava a origem já como `cancelled`; quando a pendência tenta nascer, esbarra na UNIQUE e o registro cancelado prevalece. Testado nas duas ordens, contra o banco real.

Junto veio uma correção de dado: o `appointment.done` passou a carregar `performedAt`. A pendência usava o `occurredAt` do envelope, que é o momento da **finalização** no sistema — um atendimento feito dia 30 e fechado dia 2 cairia no mês errado do relatório. Também faria a mesma origem ter datas diferentes conforme a ordem dos eventos. Eventos antigos que ainda estejam na fila no deploy caem no comportamento anterior.

E uma correção que estava em produção sem ninguém notar: o consumidor do MS2 exigia `consumedItems` com pelo menos um item (`.min(1)`), mas o MS3 publica a lista vazia quando o atendimento é só de procedimento — uma consulta simples. Todo atendimento desses falhava 5 vezes no broker antes de desistir. Lista vazia agora é válida e significa "nada a baixar".

**5. Testes usam prefixo de fila próprio** (`quironequine-test`, via `vitest.config.ts` de cada serviço). Sem isso, rodar os testes com o `npm run dev` ligado colocava o worker do teste e o do serviço de dev na mesma fila, competindo — o de dev pegava o job e o teste esperava até estourar o tempo. É a mesma propriedade de fila compartilhada desta ADR, só que mordendo o ambiente de desenvolvimento.

**6. Eventos de exame, fora da tabela do ADR-001 §5.3** (revisão 1.3, Sprint 6). O ADR-001 não prevê evento de exame; o caminho natural seria copiar o atendimento, com um único evento levando baixa e cobrança juntas. A decisão dos stakeholders (01/10/2026) separou as duas coisas: a **coleta é opcional** (outra pessoa pode colher a amostra) e a **cobrança é opcional** (o cliente pode pagar o laboratório direto). O que entra na conta depende de quem coletou, então a cobrança só fecha na primeira saída do status `requested`: registrando a coleta, ou pulando direto pra análise ou resultado. Por isso viraram eventos separados:

| Evento | Publicado quando | Consumido por | Efeito |
|---|---|---|---|
| `exam.collected` | O veterinário registrou a coleta **e** usou insumos | **Inventory** | Baixa dos insumos (motivo `exam` no movimento) |
| `exam.charged` | A cobrança fechou com valor > 0 | **Reporting** | Pendência financeira com `sourceType: 'exam'` |
| `exam.deleted` | Pedido com pendência foi excluído | **Reporting** | Cancela a pendência (mesma lógica de ordem do item 4) |
| `exam.result_due` | Job diário, 07h de São Paulo: data prevista amanhã ou hoje | **Notification** (MS5) | Lembrete pro veterinário buscar o resultado |

Os três primeiros saem pelo outbox, na mesma transação da mudança de status, com chave derivada do pedido. O total congelado é calculado sobre o pedido **já travado** pelo UPDATE condicional: uma edição de preço concorrente não escapa. Uma exceção ao RF-EXM-006 ficou registrada: quando o cliente paga o laboratório direto e o veterinário coletou, os **insumos entram na conta** (mão de obra + km + insumos). Sem o procedimento na conta, os insumos deixam de estar embutidos nele.

O `exam.result_due` é publicado direto, sem outbox, como o `alert.triggered`: é uma varredura de leitura, sem commit com o qual ser atômico. A varredura cruza tenants pela função `SECURITY DEFINER` `clinical_list_exams_result_due` (padrão da ADR-006). A chave vem de (pedido, tipo de lembrete), então o job rodar duas vezes no mesmo dia não duplica o aviso. Até o MS5 existir, esses eventos acumulam na fila dele, como na ponta solta nº 3. O volume é baixo: no máximo dois por pedido.

**7. Eventos de vacinação** (revisão 1.4, Sprint 7). Também ficam fora da tabela do ADR-001 §5.3. Aqui não existe a separação do exame, porque registrar a vacinação **é** aplicá-la (decisão do Marco, 08/10/2026): consumo e cobrança acontecem juntos. Por isso a vacinação volta ao padrão do atendimento, com um evento e dois destinos:

| Evento | Publicado quando | Consumido por | Efeito |
|---|---|---|---|
| `vaccination.applied` | Vacinação registrada | **Inventory** + **Reporting** | Baixa das doses (motivo `vaccination`) e pendência, se o total for > 0 |
| `vaccination.deleted` | Vacinação com custo excluída | **Reporting** | Cancela a pendência (mesma lógica de ordem do item 4) |
| `vaccination.due` | Job diário, 07h de São Paulo: próxima dose daqui a 7 dias ou hoje | **Notification** (MS5) | Lembrete de re-vacinação para o veterinário |

O `vaccination.applied` leva **doses**, não unidades. Quem converte é o MS2, que conhece o `dosesPerUnit` do produto: 3 doses de um frasco de 10 baixam 0,3 frasco. O MS3 não guarda esse dado e não deveria.

O lembrete segue o padrão do `exam.result_due`: varredura sem outbox, função `SECURITY DEFINER` `clinical_list_vaccinations_due` e chave por (aplicação, tipo de lembrete). A diferença é o filtro de **re-vacinação**. A função devolve uma linha por animal e tira o animal que recebeu a mesma vacina depois daquela aplicação. Sem esse filtro, um cavalo vacinado de novo na semana passada receberia o aviso da dose antiga. Os dois lembretes diários do MS3 agora rodam no mesmo agendador (`clinical-reminders`).

Vacina aplicada por **outra pessoa** (o veterinário assumiu o animal no meio do caminho) entra como registro de controle, com `origin: 'external'`: **não publica evento nenhum**, porque não há baixa nem cobrança. Ainda assim gera próxima dose e lembrete, e é esse o motivo de registrá-la. A vacina pode vir do catálogo ou ser digitada. Por isso "mesma vacina" é o mesmo produto ou, quando um dos registros é texto livre, o mesmo nome, regra que mora na função `clinical_same_vaccine`. Dois CHECKs no banco garantem as invariantes: aplicação da clínica sempre tem produto, e registro externo sempre custa zero.

## Consequências

**Positivas.** O fan-out do §5.3 passa a funcionar de verdade antes de existir consumidor duplicado — o bug nasceria silencioso e só apareceria em produção com o MS6 no ar. Nenhuma infraestrutura nova: nada muda no `docker-compose`, no CI, nos scripts de deploy ou no custo mensal. A tabela `EVENT_SUBSCRIBERS` em `shared-types` dá uma fonte única para o roteamento, rastreável linha a linha contra a tabela do ADR-001 §5.3.

**Negativas / risco residual.** O roteamento é código nosso, não configuração do broker: um evento novo exige lembrar de registrar o assinante (mitigado por `Record<EventName, ...>` — o TypeScript obriga a entrada, e por `log.warn` quando a lista está vazia). Continuamos sem DLQ nativa e sem publisher confirms. E a durabilidade segue sendo a do Redis, não a de um broker AMQP — a mitigação é a idempotência exigida pelo §5.4.

**Gatilhos de reavaliação.** Rever esta decisão se: (a) o grafo de eventos crescer a ponto de a tabela de assinantes ficar difícil de manter — sinal de que roteamento declarativo do broker passou a valer o custo; (b) aparecer requisito de entrega que o BullMQ não cobre (prioridade por mensagem, TTL, roteamento por padrão); ou (c) o projeto passar a ter alguém dedicado a operar infraestrutura, o que muda o peso do argumento principal contra o RabbitMQ.

## Verificação

- `tests/deduction-consumer.test.ts` (Postgres + Redis reais) continua verde: publica `appointment.done` de verdade pelo `publishDomainEvent`, o worker do inventory consome da fila própria e a baixa é aplicada.
- `apps/ms-inventory` com cobertura mantida acima do piso de 70% (RNF-MAN-003).
- Conferido que não sobrou referência a `DOMAIN_EVENTS_QUEUE_NAME` (a fila única antiga) em nenhum serviço.
- Outbox: `apps/ms-clinical/tests/outbox.test.ts`, contra Postgres e Redis reais, cobre o que só integração prova — que o rollback da transação leva o evento junto (a razão de o padrão existir), que a função `SECURITY DEFINER` enxerga pendentes de tenants diferentes enquanto o caminho normal continua isolado por RLS, e que o ciclo do relay publica e marca. Mais o unitário do relay com dependências falsas, incluindo a ordem publicar-antes-de-marcar e falha parcial não interrompendo o lote.

## Histórico

| Versão | Data | Descrição |
|---|---|---|
| 1.0 | Set/2026 | Criação. Formaliza Redis/BullMQ e introduz fan-out por fila de consumidor. |
| 1.1 | Set/2026 | Padrão Outbox implementado no MS3 (era a ponta solta nº 1), fechando a mitigação prevista no ADR-001 §6.2. |
| 1.2 | Out/2026 | Evento `appointment.deleted` (exclusão de atendimento finalizado cancela a pendência, independente da ordem de chegada); `performedAt` no `appointment.done`; MS2 aceita atendimento sem item de estoque; prefixo de fila próprio nos testes. |
| 1.3 | Out/2026 | Eventos de exame (`exam.collected`, `exam.charged`, `exam.deleted`, `exam.result_due`): coleta e cobrança opcionais, cobrança fechada na saída de `requested`; MS2 baixa insumo de exame com motivo `exam`; MS6 abre e cancela pendência de exame. |
| 1.4 | Out/2026 | Eventos de vacinação (`vaccination.applied` para MS2 + MS6, `vaccination.deleted`, `vaccination.due`): baixa em doses convertidas pelo MS2, lembrete de re-vacinação 7 dias antes e no dia, que ignora o animal já re-vacinado; registro externo (aplicada por outra pessoa) sem evento. |
