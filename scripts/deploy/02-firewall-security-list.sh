#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# [LOCAL] Passo 2/7 — Liberar as portas 22/80/443
#
# A Oracle tem DOIS firewalls empilhados que precisam concordar:
#   1. Security List da VCN (nível de rede, console web)
#   2. iptables/netfilter DENTRO da própria imagem Ubuntu (a Oracle
#      vem com regras restritivas por padrão — pegadinha comum, quem
#      esquece isso libera na Security List e continua sem acesso)
#
# Este script imprime o guia das duas partes e, no final, TESTA de
# verdade se as portas estão abertas (isso sim é automatizado).
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

cat <<'EOF'
──────────────────────────────────────────────────────────────────
2a. SECURITY LIST (console web da Oracle)
──────────────────────────────────────────────────────────────────
  1. Console > Networking > Virtual Cloud Networks > (a VCN criada
     junto com a VM) > Security Lists > Default Security List.
  2. Em "Ingress Rules", adicione (se ainda não existirem):

     Regra 1 (SSH — provavelmente já existe por padrão):
       Source CIDR: 0.0.0.0/0
       IP Protocol: TCP
       Destination Port Range: 22

     Regra 2 (HTTP — pro Let's Encrypt validar o domínio):
       Source CIDR: 0.0.0.0/0
       IP Protocol: TCP
       Destination Port Range: 80

     Regra 3 (HTTPS — tráfego real da API):
       Source CIDR: 0.0.0.0/0
       IP Protocol: TCP
       Destination Port Range: 443

  3. NÃO adicione regra pra 5432, 5433 ou 6379 (Postgres/Redis) —
     esses ficam acessíveis só de dentro da rede Docker da própria
     VM, nunca expostos à internet.

EOF

read -rp "Configurou a Security List? [Enter pra continuar] "

cat <<'EOF'

──────────────────────────────────────────────────────────────────
2b. FIREWALL INTERNO DA VM (rode isto via SSH, dentro da VM)
──────────────────────────────────────────────────────────────────
  Conecte primeiro:
    ssh -i ~/.ssh/vetequine-staging ubuntu@<IP_DA_VM>

  Depois, dentro da VM, rode:

    sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
    sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
    sudo netfilter-persistent save

  (a porta 22 já vem liberada por padrão na imagem, senão você não
  teria conseguido conectar por SSH pra rodar isto)

EOF

read -rp "IP público da VM (pra eu testar as portas agora): " VM_IP

if [ -z "$VM_IP" ]; then
  echo "Sem IP informado, pulando o teste automático. Rode este"
  echo "script de novo quando tiver o IP em mãos pra verificar."
  exit 0
fi

echo
echo "Testando conectividade em $VM_IP (portas 22, 80, 443)..."
for port in 22 80 443; do
  if timeout 5 bash -c "echo > /dev/tcp/$VM_IP/$port" 2>/dev/null; then
    echo "  porta $port: ABERTA"
  else
    echo "  porta $port: FECHADA ou sem resposta (normal pra 80/443"
    echo "               se ainda não subimos o Caddy nessa porta —"
    echo "               o teste real de HTTP vem só depois do deploy)"
  fi
done
