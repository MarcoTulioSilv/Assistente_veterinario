# Manual de implantação — staging (homologação)

| | |
|---|---|
| **Ambiente** | Staging: homologação com os stakeholders (Marcos M1 e M2) |
| **Serviços** | PWA, BFF, MS1 Identity, MS2 Inventory, MS3 Clinical, MS6 Reporting, Postgres, Redis |
| **Arquivos** | [`infra/staging/`](../infra/staging/), [`deploy-staging.yml`](../.github/workflows/deploy-staging.yml), [`seed-staging.yml`](../.github/workflows/seed-staging.yml) |
| **Responsável** | Marco Túlio (Dev 1). O Dockerfile do PWA é do João (Dev 2) |

## 1. Como o ambiente funciona

```
Internet ──► Caddy (HTTPS automático, Let's Encrypt)
               ├── homolog.<dominio>      ──► PWA (Next.js)
               └── api-homolog.<dominio>  ──► BFF ──► MS1 / MS2 / MS3 / MS4 / MS5 / MS6
                                                       │
                                     Postgres (6 bancos) + Redis (broker)
```

- **Um servidor (VPS)** roda tudo em Docker Compose ([`docker-compose.yml`](../infra/staging/docker-compose.yml)).
- **Só o Caddy fica exposto** (portas 80 e 443). Os serviços, o Postgres e o Redis vivem numa rede interna. O Postgres escuta apenas no `localhost` do servidor, e o seed chega por túnel SSH.
- **Um servidor Postgres com 6 bancos** (`identity`, `inventory`, `clinical`, `scheduling`, `notification`, `reporting`): continua um banco por serviço (ADR-001 §5.1). Banco de serviço novo é criado pelo `deploy.sh` (o `00-create-databases.sql` só roda quando o volume do Postgres nasce).
- **Imagens** no GitHub Container Registry, publicadas pelo workflow de deploy. A tag é o commit.
- **Segredos do runtime** (senhas dos bancos, JWT) ficam **só no servidor**, em `/opt/quironequine/.env.staging`. O GitHub guarda apenas o acesso ao servidor e o necessário para o seed.

## 2. Pré-requisitos

### 2.1 Servidor
| Item | Recomendado |
|---|---|
| Sistema | Ubuntu 24.04 LTS |
| CPU / RAM | 4 vCPU / 8 GB (4 GB funciona, mas no limite) |
| Disco | 80 GB SSD |
| Região | Brasil, de preferência (LGPD; obrigatório pensar nisso para produção) |

A contratação é das contratantes: o contrato, na Cláusula 2ª, diz "fornecer o ambiente de homologação".

**Oracle Cloud (provedor escolhido em 29/10/2026):**
- **Região:** `sa-saopaulo-1` (São Paulo) ou `sa-vinhedo-1` (Vinhedo).
- **Forma da VM:**
  - **`VM.Standard.A1.Flex` (Ampere, ARM) com 1 OCPU e 6 GB**, a escolhida (29/10/2026). Fica dentro do plano gratuito (4 OCPU e 24 GB de A1 no total) e deixa espaço para uma VM de produção do mesmo tamanho também grátis. O ambiente usa algo como 1,5 a 2 GB de RAM (estimativa); o build das imagens não roda na VM, e sim num runner ARM nativo do GitHub. Exige a variável `STAGING_PLATFORM = linux/arm64` (passo 4.3).
  - **`VM.Standard.E4.Flex` / `E5.Flex` (AMD)**: não precisa de configuração extra. Com 2 OCPU (4 vCPU) e 8 GB, atende.
- **Imagem:** Canonical Ubuntu 24.04. O usuário inicial é `ubuntu`, e a chave SSH dele é a informada na criação da VM.
- **IP público:** um **IP reservado** não muda se a VM for recriada (o DNS aponta para ele). Confira na página de preços se ele entra na faixa gratuita; se não entrar, o efêmero serve, e basta atualizar o DNS se a VM for recriada.
- **Disco de boot:** cerca de 50 GB. A faixa gratuita cobre 200 GB de block storage no total. **Não ative backup automático de volume nem snapshots**, que são cobrados à parte; o `backup.sh` cobre os bancos.
- **Conta pay-as-you-go:** crie um **alerta de orçamento** (*Billing → Budgets*) com valor baixo, por exemplo R$ 1, para qualquer recurso fora da faixa gratuita aparecer cedo.
- **"Out of host capacity" ao criar a A1:** é comum faltar capacidade em São Paulo. Tente outro *availability domain* ou outro horário.

### 2.2 DNS
No **registro.br**, abra o domínio → **DNS** → **Editar zona** (se o domínio ainda usa os servidores DNS do próprio registro.br) e crie dois registros **A** apontando para o IP do servidor:

| Nome | Tipo | Valor |
|---|---|---|
| `homolog` | A | IP do servidor |
| `api-homolog` | A | IP do servidor |

Espere propagar antes do primeiro deploy. Para conferir: `nslookup api-homolog.<dominio>`. O Caddy só consegue emitir o certificado quando o domínio já aponta para o servidor.

### 2.3 Dependências de terceiros
- **Dockerfile do PWA** (João): o deploy publica as 6 imagens e para se faltar alguma. A PWA deve escutar na porta **3100** e receber a URL da API no build (`ARG NEXT_PUBLIC_BFF_URL`).
- **Chave do Google Maps**, com a API de rotas, para o km automático. É custo das contratantes. Enquanto não houver, o km é digitado à mão.

## 3. Preparar o servidor (uma vez)

Entre como root (ou com sudo) e rode:

```bash
# Docker oficial (inclui o docker compose)
curl -fsSL https://get.docker.com | sh

# Usuário de deploy, sem senha (só chave SSH), com acesso ao Docker
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -o deploy -g deploy /opt/quironequine

# Swap de 2 GB: rede de segurança contra falta de memória num pico (com 6 GB
# não deve ser preciso, mas custa só disco)
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Firewall: só SSH e web
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

**Na Oracle, o firewall tem duas camadas, e as duas precisam liberar 80 e 443:**
1. **Rede (no console):** *Networking → Virtual Cloud Networks → a VCN da VM → Security Lists → Default Security List* → **Add Ingress Rules**: origem `0.0.0.0/0`, TCP, portas de destino `80` e `443`. A 22 (SSH) já vem liberada.
2. **Dentro da VM:** a imagem Ubuntu da Oracle já vem com regras de **iptables** que bloqueiam tudo além do SSH, mesmo com a VCN liberada (o sintoma é o Caddy sem certificado). **Na Oracle, pule o `ufw` acima**: ele e as regras da Oracle se atrapalham. Use isto no lugar:
   ```bash
   # A imagem Minimal não traz o netfilter-persistent
   apt-get install -y iptables-persistent
   # Veja em que linha está o REJECT (6 na imagem padrão, 5 na Minimal)
   iptables -L INPUT --line-numbers -n
   # Troque N por essa linha: as regras precisam ficar ANTES do REJECT
   iptables -I INPUT N -m state --state NEW -p tcp --dport 80 -j ACCEPT
   iptables -I INPUT N -m state --state NEW -p tcp --dport 443 -j ACCEPT
   netfilter-persistent save
   ```

## 4. Chave de deploy e segredos (uma vez, na sua máquina)

### 4.1 Chave SSH do deploy
No PowerShell ou no Git Bash:

```bash
ssh-keygen -t ed25519 -C "deploy-staging-quironequine" -f ~/.ssh/quironequine_staging -N ""
```

- **Pública** (`quironequine_staging.pub`): coloque no servidor, em `/home/deploy/.ssh/authorized_keys` (crie a pasta com permissão 700 e o arquivo com 600, dono `deploy`).
- **Privada** (`quironequine_staging`): vai **só** para o secret do GitHub (passo 4.3). Não mande por chat nem por e-mail.

Teste o acesso: `ssh -i ~/.ssh/quironequine_staging deploy@<IP>`.

### 4.2 Arquivo de segredos do servidor
No Git Bash, a partir da raiz do repositório:

```bash
./infra/staging/generate-env.sh homolog.<dominio> api-homolog.<dominio> <seu-email>
```

O script gera `~/quironequine-staging.env`, **fora do repositório**, com senhas aleatórias. Envie para o servidor e apague a cópia local depois do passo 4.3:

```bash
scp -i ~/.ssh/quironequine_staging ~/quironequine-staging.env deploy@<IP>:/opt/quironequine/.env.staging
ssh -i ~/.ssh/quironequine_staging deploy@<IP> chmod 600 /opt/quironequine/.env.staging
```

### 4.3 GitHub
Em **Settings → Environments**, crie o ambiente **`staging`** e cadastre:

**Variables** (não são segredo):

| Nome | Valor |
|---|---|
| `STAGING_HOST` | IP do servidor |
| `STAGING_USER` | `deploy` |
| `STAGING_APP_DOMAIN` | `homolog.<dominio>` |
| `STAGING_API_DOMAIN` | `api-homolog.<dominio>` |
| `STAGING_PATH` | `/opt/quironequine` (opcional; esse é o padrão) |
| `STAGING_PLATFORM` | `linux/arm64` **só** se a VM for ARM (Ampere A1); senão, não crie |

**Secrets:**

| Nome | Valor |
|---|---|
| `STAGING_SSH_KEY` | conteúdo da chave **privada** (`~/.ssh/quironequine_staging`) |
| `STAGING_SSH_KNOWN_HOSTS` | saída de `ssh-keyscan <IP>`. Fixa a identidade do servidor; sem isso, qualquer máquina poderia se passar por ele |
| `STAGING_POSTGRES_PASSWORD` | o `POSTGRES_PASSWORD` do `.env.staging` (só o seed usa) |
| `STAGING_SEED_PASSWORD` | o `SEED_PASSWORD` do `.env.staging` |

**Para copiar a chave privada sem estragar:** no PowerShell, rode `Get-Content $HOME\.ssh\quironequine_staging -Raw | Set-Clipboard` e cole no campo do secret sem editar nada. O texto vai de `-----BEGIN OPENSSH PRIVATE KEY-----` até `-----END OPENSSH PRIVATE KEY-----`, com essas duas linhas incluídas. Se o deploy falhar com `error in libcrypto` ou com "não é uma chave privada válida", a chave colada está incompleta ou é o arquivo errado (o `.pub` ou a chave da Oracle).

Em **Settings → Variables**, cadastre também `STAGING_API_DOMAIN` (e `STAGING_PLATFORM`, se for ARM) no nível do **repositório**. O build das imagens usa essas variáveis e roda fora do ambiente `staging`.

**Google Maps (opcional).** Para o mapa de localização usar o Google em vez do Leaflet/OpenStreetMap, cadastre também no nível do **repositório** a variável `STAGING_GOOGLE_MAPS_BROWSER_KEY` com a chave de **navegador** da Maps JavaScript API. É variável, não segredo: a chave vai no código da PWA que o navegador baixa, e quem a protege são as restrições no Google Cloud. Antes de cadastrar, no Google Cloud Console (APIs e serviços → Credenciais → a chave):

- **Restrições de aplicativo → Sites (referenciadores HTTP):** só `https://homolog.<dominio>/*` (e `http://localhost:3100/*`, se a mesma chave for usada no dev).
- **Restrições de API:** só **Maps JavaScript API**.
- **Faturamento → Orçamentos e alertas:** um orçamento com alerta, para uma chave abusada não virar conta.

A chave entra na imagem no build: depois de cadastrar ou trocar, só vale no próximo deploy. Sem a variável, ou se o Google falhar no navegador, a PWA usa o Leaflet sozinha.

## 5. Primeiro deploy

1. Promova a `develop` para a `staging` (PR `develop → staging`, ou push direto na primeira vez).
2. O workflow **Deploy staging** roda sozinho:
   1. publica as 8 imagens;
   2. envia os arquivos de `infra/staging/` para o servidor;
   3. roda o `deploy.sh`, que gera os segredos de serviço novo que faltarem no `.env.staging` (token interno MS1 ← MS5 e o par VAPID do push), sobe os bancos, cria os que faltarem, aplica as migrations com o usuário das migrations, cria a role da aplicação com a senha do `.env.staging` e sobe os serviços esperando os health checks;
   4. testa `https://api-homolog.<dominio>/health` e a PWA.
3. Carregue os dados de homologação: **Actions → Seed staging → Run workflow**, digitando `homologacao` no campo de confirmação.
4. Entre em `https://homolog.<dominio>` com `homologacao@quironequine.com.br` e a senha do `SEED_PASSWORD`. Para demonstrar o isolamento entre clínicas, entre também com `isolamento@quironequine.com.br`.

## 6. Rotina

- **Deploy:** todo merge na `staging` implanta sozinho. Também dá para rodar à mão em **Actions → Deploy staging → Run workflow**.
- **Voltar uma versão:** no servidor, `cd /opt/quironequine && ./deploy.sh <commit-anterior>`. As imagens ficam no registry com a tag do commit. No disco do servidor ficam só as imagens da versão no ar e de uma anterior: o `deploy.sh` apaga as outras depois de subir os serviços (sem isso, cada deploy deixava mais 8 imagens). Voltar para a anterior é imediato; para uma mais velha, o `deploy.sh` baixa de novo do registry. Atenção: **migration não é desfeita**. Uma versão anterior que não conheça a coluna nova continua funcionando só se a mudança foi aditiva.
- **Logs:** `docker compose --env-file .env.staging logs -f ms-clinical` (ou `bff`, `caddy`...).
- **Situação:** `docker compose --env-file .env.staging ps` (todos devem estar `healthy` ou `running`).
- **Recriar os dados de homologação:** rode o workflow **Seed staging** de novo. Ele apaga e recria **só** os tenants de homologação.

### 6.1 Conferir logs e disco

No servidor, como `deploy`:

```bash
cd /opt/quironequine
dc() { docker compose --env-file .env.staging "$@"; }

dc ps                                        # todos "running (healthy)"?
dc logs --since 1h --tail 100 ms-identity    # um serviço; troque o nome
dc logs -f bff                               # acompanhar ao vivo (Ctrl+C sai)
dc logs --since 24h --no-log-prefix 2>&1 | grep -E '"level":(50|60)' | tail -n 30   # erros (Pino: 50 = error, 60 = fatal)
```

Os logs não trazem dado pessoal: erro do Prisma sai só com tipo e código (`safe-error.ts`). Cada contêiner guarda no máximo 5 arquivos de 10 MB:

```bash
docker inspect --format '{{.Name}} {{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}' $(dc ps -q)
sudo sh -c 'du -sh /var/lib/docker/containers/*/*-json.log' | sort -h | tail -n 5
df -h /                                      # disco livre
docker system df                             # imagens, contêineres, volumes
docker image ls --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep quironequine   # só a versão atual e uma anterior
```

## 7. Backup e restauração

**Agendar** (uma vez, no servidor, como `deploy`): `crontab -e` e acrescente

```
0 3 * * * /opt/quironequine/backup.sh >> /opt/quironequine/backups/backup.log 2>&1
```

O backup gera um `pg_dump` de cada banco e um `.tar.gz` dos uploads em `backups/AAAAMMDD-HHMM/`, e guarda 14 dias. Staging tem só dados de homologação, recriáveis pelo seed. A cópia fora do servidor fica para produção.

**Conferir se está rodando** (no servidor, como `deploy`):

```bash
cd /opt/quironequine
crontab -l | grep backup.sh                  # o agendamento existe?
tail -n 10 backups/backup.log                # uma linha "backup ok" por noite
ls -1d backups/2* | tail -n 5                # pastas dos últimos dias

ULTIMO=$(ls -1d backups/2* | tail -n 1); echo "$ULTIMO"; ls -lh "$ULTIMO"   # 6 .dump + uploads.tar.gz, nenhum com 0 byte
tar -tzf "$ULTIMO/uploads.tar.gz" | grep -vc '/$'                            # arquivos no backup...
docker run --rm -v quironequine-staging_uploads:/u:ro alpine sh -c 'find /u -type f | wc -l'   # ...e no volume (devem bater)
for db in identity inventory clinical scheduling notification reporting; do
  printf '%s: ' "$db"
  docker compose --env-file .env.staging exec -T postgres pg_restore --list < "$ULTIMO/$db.dump" | grep -c 'TABLE DATA'
done                                         # tabelas com dados em cada dump (nenhum 0)
```

Se o `crontab -l` não mostrar nada, o agendamento não foi feito: acrescente a linha acima e rode `./backup.sh` uma vez à mão para conferir.

**Restaurar um banco** (ex.: `clinical`):
```bash
cd /opt/quironequine
docker compose --env-file .env.staging stop ms-clinical
docker compose --env-file .env.staging exec -T postgres \
  pg_restore -U quironequine -d clinical --clean --if-exists < backups/<pasta>/clinical.dump
./deploy.sh "$(grep ^IMAGE_TAG= .env.staging | cut -d= -f2)"   # reaplica a role e sobe de novo
```

## 8. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Caddy sem certificado (`ERR_SSL`) | DNS ainda não aponta para o servidor, ou a porta 80 está fechada | Conferir `nslookup` e o firewall; `docker compose logs caddy` |
| Deploy para em "Migrations" | Migration falhou | A mensagem do Prisma aparece no log do workflow. Corrigir e implantar de novo; nada sobe pela metade, porque os serviços só sobem depois |
| Serviço `unhealthy` | Variável faltando ou banco inacessível | `docker compose logs <serviço>`. O compose avisa no `up` qual variável obrigatória faltou |
| Upload de foto falha | Volume de uploads sem permissão | A imagem do MS1 cria o diretório com o dono certo; se o volume foi criado antes dessa versão, `docker volume rm quironequine-staging_uploads` (perde os arquivos) |
| Login recusado com usuário do seed | Seed não rodou, ou rodou com outra senha | Rodar o workflow **Seed staging** |

## 9. Segurança

- **O runtime conecta como `quironequine_app`**, sujeito ao RLS. O usuário das migrations só roda migrations e o seed. Ver a revisão de segurança em [`MS3-revisao-performance-seguranca.md`](MS3-revisao-performance-seguranca.md).
- **A senha da role** vem do `.env.staging`, nunca a de desenvolvimento: o `deploy.sh` a troca a cada execução.
- **Nada de segredo no repositório.** O `.env.staging` está no `.gitignore` (`.env.*`), e o CI roda o gitleaks em todo PR.
- **A chave do servidor está fixada** no `known_hosts` do workflow.
