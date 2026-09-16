#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# [NA VM] Passo 5/7 — Registrar a VM como runner do GitHub Actions
#
# Rode DENTRO da VM (via SSH), depois do script 04 (Docker instalado).
# O token de registro do GitHub é de uso único e expira em minutos —
# por isso a etapa de pegar o token é sempre manual, feita na hora.
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

cat <<'EOF'
──────────────────────────────────────────────────────────────────
5a. PEGAR OS COMANDOS DE REGISTRO (no navegador, agora)
──────────────────────────────────────────────────────────────────
  1. Abra o repositório no GitHub > Settings > Actions > Runners.
  2. Clique em "New self-hosted runner".
  3. Selecione: Operating System = Linux, Architecture = ARM64
     (a VM Ampere A1 é ARM, não x64 — importante escolher certo,
     senão baixa o binário errado).
  4. O GitHub vai mostrar um bloco de comandos parecido com:

       mkdir actions-runner && cd actions-runner
       curl -o actions-runner-linux-arm64-X.Y.Z.tar.gz -L https://...
       tar xzf ./actions-runner-linux-arm64-X.Y.Z.tar.gz
       ./config.sh --url https://github.com/OWNER/REPO --token ABC123...

     Copie e cole ESSE bloco inteiro aqui no terminal da VM agora
     (os 4 comandos, um por linha) — o token expira rápido, então
     faça isso antes de continuar este script.

  5. Quando o './config.sh' perguntar:
       "Enter the name of the runner"     -> vetequine-staging-vm
       "Enter any additional labels"      -> deixe em branco (Enter)
       "Enter name of work folder"        -> deixe o padrão (Enter)

EOF

read -rp "Já rodou os 4 comandos acima (mkdir/curl/tar/config.sh)? [Enter pra continuar] "

if [ ! -d "$HOME/actions-runner" ]; then
  echo "Não encontrei ~/actions-runner — parece que a etapa 5a não foi"
  echo "concluída. Rode este script de novo depois de terminar."
  exit 1
fi

cd "$HOME/actions-runner"

echo
echo "──────────────────────────────────────────────────────────────"
echo "5b. Instalando como serviço systemd (isto o script faz por você)"
echo "──────────────────────────────────────────────────────────────"
echo "Sem isso, o runner só ficaria ativo enquanto esta sessão SSH"
echo "estivesse aberta — como serviço, ele sobrevive a reboot e a"
echo "queda de conexão."

sudo ./svc.sh install
sudo ./svc.sh start

echo
sudo ./svc.sh status

cat <<'EOF'

──────────────────────────────────────────────────────────────────
Verificação final: volte na aba do GitHub (Settings > Actions >
Runners) e confirme que "vetequine-staging-vm" aparece com status
"Idle" (bolinha verde). A partir daí, qualquer workflow com
`runs-on: self-hosted` roda nesta VM.

O workflow que dispara o deploy em cada push pra `develop`
(.github/workflows/deploy-develop.yml) é criado numa etapa
posterior do plano, depois que docker-compose.prod.yml existir.
EOF
