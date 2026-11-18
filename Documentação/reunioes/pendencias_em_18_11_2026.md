# Pendências para a próxima reunião — levantadas em 18/11/2026

Tudo o que precisa de resposta dos stakeholders para o M3 andar sem retrabalho. Cada item traz o contexto, a pergunta e uma **proposta**, que é o que fica valendo se não houver resposta. As decisões de 12/11/2026 estão em `Documentação/plano-M3-sprints.md`.

## Decisões de produto

### 1. Compra de estoque no fluxo de caixa
Em 12/11 ficou decidido que a compra de estoque **não entra sozinha** no caixa e que haveria uma rota própria para lançá-la, com a regra definida nesta reunião (RF-REL-001).

- O que se lança: o valor total da compra, o valor por produto ou o valor da nota fiscal?
- A compra fica ligada à entrada de estoque (produto e quantidade) ou é só um valor?
- Em que data entra no caixa: a da compra ou a do pagamento (compra a prazo)?

**Proposta:** lançamento manual, com data, valor, descrição e produto opcional; entra no caixa na data informada.

### 2. Categorias das saídas avulsas
O ERS cita "abastecimento de combustível" como exemplo (RF-REL-002). As categorias aparecem nos filtros e no fluxo de caixa.

**Proposta:** combustível, manutenção do veículo, material e equipamento, impostos e taxas, outros.

### 3. Receita do dashboard: data do pagamento ou do atendimento?
O gráfico de receita mensal (RF-REL-005) pode contar pelo dia em que o dinheiro entrou (regime de caixa) ou pelo dia em que o serviço foi feito (regime de competência). Um atendimento de outubro pago em novembro cai em meses diferentes.

**Proposta:** data do pagamento, igual ao fluxo de caixa.

### 4. Dias sem visita do geofence
O aviso de proximidade (Plano Plus) aponta propriedades sem visita há mais de X dias, com X definido pelo veterinário. Falta o valor inicial, que vale até ele ajustar.

**Proposta:** 90 dias.

### 5. Bloquear notificação por cliente (RF-CAD-015)
Decidimos em 12/11 que nenhuma notificação vai para o proprietário. Com isso, "bloquear notificação por cliente" fica sem efeito.

- Registramos o requisito como atendido (não há notificação ao cliente)?
- Ou ele passa a significar outra coisa, por exemplo silenciar os avisos sobre aquele cliente para o veterinário?

**Proposta:** registrar como atendido.

### 6. O que o assistente pode ver (Sprint 12)
Ficou decidido que tudo o que o assistente lança passa pela revisão do veterinário. Falta dizer o que ele pode **ver**.

**Proposta:** o assistente não vê o financeiro, as configurações nem os usuários.

### 7. Km do orçamento: só ida ou ida e volta?
O cálculo automático da distância dá só a ida até a propriedade. O valor do deslocamento deve considerar ida e volta?

**Proposta:** manter só a ida (o km continua editável no orçamento).

### 8. Limites de alerta de estoque da clínica
Com os limites globais (RF-CFG-004), cada produto pode usar o padrão da clínica ou um valor próprio.

**Proposta:** padrão inicial de 30 dias para o aviso de validade e nenhum estoque mínimo global (cada produto define o seu).

## Contas e custos

### 9. WhatsApp Business e e-mail
Os dois canais estão implementados, mas desligados até existirem as contas (decisão de 12/11). Sem a conta de e-mail ficam desligadas também a **confirmação de e-mail do cadastro** e a **recuperação de senha** (hoje a tela de "esqueci a senha" não envia nada).

- Quem cria as contas (WhatsApp Business na Meta e o provedor de e-mail) e em nome de quem saem as mensagens?
- Quem paga? A Meta cobra por conversa iniciada pela empresa, e a verificação da empresa leva alguns dias.

**Proposta:** contas em nome do contratante; começar pelo e-mail, que destrava o cadastro e a recuperação de senha.

## Cronograma e contrato

### 10. Prazos
- A Cláusula 5ª do contrato é inconsistente: 28/02/2027 no caput contra 31/12/2026 no §1º.
- M1 e M2 atrasaram.
- O detalhamento do M3 (Plano v1.4) vai até 12/02/2027, e o cronograma continua dizendo Dez/2026.
- M4 (Jan/2027) e M5 (Fev/2027) ficam sobrepostos ao M3.

**Proposta:** formalizar um cronograma novo (ou um aditivo) com as datas reais de M3, M4 e M5.

### 11. Aceite do M2
O M2 está no staging desde 07/11. Pela Cláusula 7ª, faltam o guia de uso, a demo formal e a aprovação em até 5 dias úteis, que libera as parcelas 3 e 4.

**Proposta:** marcar a demo e entregar o guia na mesma reunião.

## Informes (sem decisão)

- **Instalação do app**: no Android, um toque no botão "Instalar o app" (assim que os ícones entrarem). No iPhone, a instalação é manual, pelo Safari (Compartilhar → "Adicionar à Tela de Início"), e o push só funciona com o app instalado assim.
- **Geofence**: funciona com o app aberto; em segundo plano, só com o app nativo do lançamento (decisão de 12/11).
- **Ícones e tipografia**: recebidos em 13/11; entram na próxima entrega da PWA.
