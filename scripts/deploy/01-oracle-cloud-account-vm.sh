#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# [LOCAL] Passo 1/7 — Criar a conta Oracle Cloud e provisionar a VM
#
# Rode este script no seu computador. Ele só IMPRIME o passo a passo
# (a criação de conta e a VM são feitas no console web da Oracle, não
# dá pra automatizar sem as credenciais) — a única parte que ele
# executa de verdade é gerar o par de chaves SSH.
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

cat <<'EOF'
──────────────────────────────────────────────────────────────────
1a. CRIAR A CONTA (se ainda não tiver)
──────────────────────────────────────────────────────────────────
  1. Acesse https://cloud.oracle.com/free
  2. Preencha os dados — pede telefone e cartão de crédito pra
     verificação de identidade. NÃO é cobrado a menos que você faça
     upgrade manual pra "Pay As You Go" depois.
  3. Escolha a Home Region com cuidado: NÃO dá pra trocar depois
     sem recriar tudo. Recomendado: "Brazil East (São Paulo)" —
     menor latência pros usuários finais e bate com o requisito de
     LGPD do contrato (dados de clientes brasileiros).
  4. Confirme o e-mail e finalize o cadastro.

EOF

read -rp "Já criou a conta e está logado no console (cloud.oracle.com)? [Enter pra continuar] "

cat <<'EOF'

──────────────────────────────────────────────────────────────────
1b. GERAR O PAR DE CHAVES SSH (isto o script faz por você)
──────────────────────────────────────────────────────────────────
EOF

KEY_PATH="$HOME/.ssh/vetequine-staging"
if [ -f "$KEY_PATH" ]; then
  echo "Já existe uma chave em $KEY_PATH — pulando geração (apague o"
  echo "arquivo antes se quiser gerar de novo)."
else
  mkdir -p "$HOME/.ssh"
  ssh-keygen -t ed25519 -C "vetequine-staging" -f "$KEY_PATH" -N ""
  echo
  echo "Chave gerada em: $KEY_PATH (privada) e $KEY_PATH.pub (pública)"
fi

echo
echo "Chave pública (vai colar no console da Oracle no próximo passo):"
echo "──────────────────────────────────────────────────────────────"
cat "$KEY_PATH.pub"
echo "──────────────────────────────────────────────────────────────"

cat <<'EOF'

──────────────────────────────────────────────────────────────────
1c. PROVISIONAR A VM (console web — Compute > Instances > Create)
──────────────────────────────────────────────────────────────────
  Nome da instância:  vetequine-staging

  Placement:
    Availability Domain: deixe o padrão (AD-1)

  Image and shape:
    Imagem:  Canonical Ubuntu  (versão LTS mais recente, ex.: 24.04)
             — mais documentação/suporte da comunidade que Oracle
             Linux pro que vamos fazer (Docker, systemd).
    Shape:   clique em "Change Shape" -> aba "Ampere" ->
             VM.Standard.A1.Flex
             OCPUs: 4    Memory (GB): 24
             (é o teto do Always Free — pode reduzir se quiser
             deixar margem pra rodar uma segunda VM pequena depois,
             mas pro nosso caso, uma VM só com tudo dentro, use o
             máximo.)

  Networking:
    Deixe criar uma VCN nova com as opções padrão (vai gerar
    automaticamente uma subnet pública e um Internet Gateway).
    Marque "Assign a public IPv4 address": SIM.

  Add SSH keys:
    Selecione "Paste public keys" e cole o conteúdo impresso acima
    (o arquivo .pub).

  Boot volume:
    Pode deixar o padrão (50GB, Always Free cobre até 200GB total
    entre volumes).

  Clique em "Create".

──────────────────────────────────────────────────────────────────
SE DER ERRO "Out of host capacity":
──────────────────────────────────────────────────────────────────
  É um problema conhecido e temporário da Oracle (alta demanda pela
  shape Ampere A1 grátis) — não é erro seu. Tente:
    1. Trocar o Availability Domain (se a região tiver mais de um).
    2. Tentar de novo em alguns minutos/horas — sem padrão fixo.
    3. Em último caso, considerar reduzir pra 2 ou 3 OCPU em vez de 4
       (às vezes libera mais fácil), depois redimensiona quando der.

──────────────────────────────────────────────────────────────────
DEPOIS QUE A VM ESTIVER "RUNNING":
──────────────────────────────────────────────────────────────────
  Anote o IP público (aparece na página de detalhes da instância) —
  vamos precisar dele em TODOS os próximos scripts.

  Teste o acesso SSH:
    ssh -i ~/.ssh/vetequine-staging ubuntu@<IP_DA_VM>

  (usuário "ubuntu" é o padrão da imagem Canonical Ubuntu na Oracle)

EOF
