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
               └── api-homolog.<dominio>  ──► BFF ──► MS1 / MS2 / MS3 / MS6
                                                       │
                                     Postgres (4 bancos) + Redis (broker)
```

- **Um servidor (VPS)** roda tudo em Docker Compose ([`docker-compose.yml`](../infra/staging/docker-compose.yml)).
- **Só o Caddy fica exposto** (portas 80 e 443). Os serviços, o Postgres e o Redis vivem numa rede interna. O Postgres escuta apenas no `localhost` do servidor, e o seed chega por túnel SSH.
- **Um servidor Postgres com 4 bancos** (`identity`, `inventory`, `clinical`, `reporting`): continua um banco por serviço (ADR-001 §5.1).
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
  - **`VM.Standard.A1.Flex` (Ampere, ARM)**, a do plano gratuito: dá para usar 4 OCPU e 24 GB. Exige a variável `STAGING_PLATFORM = linux/arm64` no GitHub (passo 4.3). O build das imagens fica mais lento, porque é emulado.
  - **`VM.Standard.E4.Flex` / `E5.Flex` (AMD)**: não precisa de configuração extra. Com 2 OCPU (4 vCPU) e 8 GB, atende.
- **Imagem:** Canonical Ubuntu 24.04. O usuário inicial é `ubuntu`, e a chave SSH dele é a informada na criação da VM.
- **IP público:** reserve um **IP público reservado** e associe à VM, para o IP não mudar se ela for recriada (o DNS aponta para ele).

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

# Firewall: só SSH e web
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

**Na Oracle, o firewall tem duas camadas, e as duas precisam liberar 80 e 443:**
1. **Rede (no console):** *Networking → Virtual Cloud Networks → a VCN da VM → Security Lists → Default Security List* → **Add Ingress Rules**: origem `0.0.0.0/0`, TCP, portas de destino `80` e `443`. A 22 (SSH) já vem liberada.
2. **Dentro da VM:** a imagem Ubuntu da Oracle já vem com regras de **iptables** que bloqueiam tudo além do SSH, mesmo com a VCN liberada (o sintoma é o Caddy sem certificado). **Na Oracle, pule o `ufw` acima**: ele e as regras da Oracle se atrapalham. Use isto no lugar:
   ```bash
   iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
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

Em **Settings → Variables**, cadastre também `STAGING_API_DOMAIN` (e `STAGING_PLATFORM`, se for ARM) no nível do **repositório**. O build das imagens usa essas variáveis e roda fora do ambiente `staging`.

## 5. Primeiro deploy

1. Promova a `develop` para a `staging` (PR `develop → staging`, ou push direto na primeira vez).
2. O workflow **Deploy staging** roda sozinho:
   1. publica as 6 imagens;
   2. envia os arquivos de `infra/staging/` para o servidor;
   3. roda o `deploy.sh`, que sobe os bancos, aplica as migrations com o usuário das migrations, cria a role da aplicação com a senha do `.env.staging` e sobe os serviços esperando os health checks;
   4. testa `https://api-homolog.<dominio>/health` e a PWA.
3. Carregue os dados de homologação: **Actions → Seed staging → Run workflow**, digitando `homologacao` no campo de confirmação.
4. Entre em `https://homolog.<dominio>` com `homologacao@quironequine.com.br` e a senha do `SEED_PASSWORD`. Para demonstrar o isolamento entre clínicas, entre também com `isolamento@quironequine.com.br`.

## 6. Rotina

- **Deploy:** todo merge na `staging` implanta sozinho. Também dá para rodar à mão em **Actions → Deploy staging → Run workflow**.
- **Voltar uma versão:** no servidor, `cd /opt/quironequine && ./deploy.sh <commit-anterior>`. As imagens ficam no registry com a tag do commit. Atenção: **migration não é desfeita**. Uma versão anterior que não conheça a coluna nova continua funcionando só se a mudança foi aditiva.
- **Logs:** `docker compose --env-file .env.staging logs -f ms-clinical` (ou `bff`, `caddy`...).
- **Situação:** `docker compose --env-file .env.staging ps` (todos devem estar `healthy` ou `running`).
- **Recriar os dados de homologação:** rode o workflow **Seed staging** de novo. Ele apaga e recria **só** os tenants de homologação.

## 7. Backup e restauração

**Agendar** (uma vez, no servidor, como `deploy`): `crontab -e` e acrescente

```
0 3 * * * /opt/quironequine/backup.sh >> /opt/quironequine/backups/backup.log 2>&1
```

O backup gera um `pg_dump` de cada banco e um `.tar.gz` dos uploads em `backups/AAAAMMDD-HHMM/`, e guarda 14 dias. Staging tem só dados de homologação, recriáveis pelo seed. A cópia fora do servidor fica para produção.

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
