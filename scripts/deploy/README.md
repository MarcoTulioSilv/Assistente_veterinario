# Deploy de staging (Oracle Cloud) — guia passo a passo

Scripts numerados na ordem em que devem ser executados. Cada um cobre
uma etapa manual do plano de deploy (ver o plano aprovado da sessão).
Alguns rodam **no seu computador** (marcado `[LOCAL]`), outros **dentro
da VM depois que ela existir** (marcado `[NA VM]`).

| # | Script | Onde roda | O que faz |
|---|---|---|---|
| 01 | `01-oracle-cloud-account-vm.sh` | LOCAL | Guia pra criar a conta Oracle Cloud e provisionar a VM Ampere A1 |
| 02 | `02-firewall-security-list.sh` | LOCAL (guia) + verificação | Libera as portas 22/80/443 na Oracle e no firewall interno da VM |
| 03 | `03-dns-setup.sh` | LOCAL | Aponta um subdomínio pro IP da VM |
| 04 | `04-docker-install.sh` | NA VM | Instala Docker + Docker Compose na VM |
| 05 | `05-github-actions-runner.sh` | NA VM | Registra a VM como runner do GitHub Actions (deploy automático) |
| 06 | `06-cloudflare-pages-setup.sh` | LOCAL | Guia pra publicar o PWA no Cloudflare Pages |
| 07 | `07-env-production-setup.sh` | NA VM | Gera o `.env.production` com segredos reais |

Nenhum desses scripts sobe os containers da aplicação — isso vem depois,
com `docker-compose.prod.yml` + `scripts/deploy-vm.sh` (próxima etapa
do plano, depois que a VM estiver pronta).

**Como rodar os scripts "NA VM"**: depois que a VM existir e você tiver
o IP dela (script 01) e acesso SSH liberado (script 02), copie a pasta
pra lá e execute de dentro:

```bash
scp -r scripts/deploy ubuntu@<IP_DA_VM>:~/deploy-scripts
ssh ubuntu@<IP_DA_VM>
cd ~/deploy-scripts
./04-docker-install.sh
```
