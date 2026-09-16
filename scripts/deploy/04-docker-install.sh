#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# [NA VM] Passo 4/7 — Instalar Docker + Docker Compose
#
# Rode DENTRO da VM (via SSH), não no seu computador. A imagem
# Ubuntu da Oracle não vem com Docker pré-instalado.
#
#   scp -r scripts/deploy ubuntu@<IP_DA_VM>:~/deploy-scripts
#   ssh -i ~/.ssh/vetequine-staging ubuntu@<IP_DA_VM>
#   cd ~/deploy-scripts && ./04-docker-install.sh
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "Não rode como root — rode como o usuário 'ubuntu' normal."
  echo "O script usa 'sudo' internamente onde precisa."
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  echo "Docker já está instalado ($(docker --version)) — pulando instalação."
else
  echo "Instalando Docker Engine + plugin Compose..."
  curl -fsSL https://get.docker.com | sudo sh
fi

echo "Adicionando o usuário '$(whoami)' ao grupo docker (evita precisar de sudo em todo comando)..."
sudo usermod -aG docker "$(whoami)"

echo "Habilitando o serviço Docker no boot..."
sudo systemctl enable docker
sudo systemctl start docker

echo
echo "──────────────────────────────────────────────────────────────"
echo "Verificação:"
docker --version
docker compose version

cat <<'EOF'

──────────────────────────────────────────────────────────────────
IMPORTANTE: a permissão de grupo (docker) só vale pra novas sessões
SSH. Feche esta conexão e reconecte antes de rodar o próximo script:

  exit
  ssh -i ~/.ssh/vetequine-staging ubuntu@<IP_DA_VM>

Depois de reconectar, confirme que funciona sem sudo:
  docker run --rm hello-world
EOF
