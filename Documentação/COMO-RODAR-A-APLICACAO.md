# Como rodar a aplicação localmente (ver a interface)

Este guia parte do princípio que o ambiente já foi configurado uma vez
(`Documentação/ONBOARDING.md` — clonar, `npm install`, `.env`, banco).
Ele cobre especificamente **subir a stack inteira e ver a PWA funcionando
no navegador**, ponta a ponta: PWA → BFF → ms-identity → PostgreSQL.

---

## 1. Serviços de banco/redis no ar

```powershell
docker compose ps
```

Deve mostrar `vq-db-identity`, `vq-db-inventory`, `vq-redis`, `vq-adminer`
com status `Up`. Se não estiver:

```powershell
npm run docker:up
```

## 2. Gerar o Prisma Client (só é preciso depois de `npm install`/clone novo)

O `dev` do `ms-identity`/`ms-inventory` **não** gera o client sozinho — se
você acabou de clonar ou rodou `npm install` do zero, faça isso antes,
senão o serviço cai assim que sobe:

```powershell
npx dotenv -e .env -- npx prisma generate --schema apps/ms-identity/prisma/schema.prisma
npx dotenv -e .env -- npx prisma generate --schema apps/ms-inventory/prisma/schema.prisma
```

## 3. Subir tudo

Um único comando na raiz sobe PWA + BFF + ms-identity + ms-inventory juntos,
em modo watch (usa `turbo run dev` por baixo — ver `CLAUDE.md`):

```powershell
npm run dev
```

Espere aparecer no terminal:

```
@vetequine/ms-identity:dev: MS1 Identity & Registry iniciado ... port: 3001
@vetequine/bff:dev: BFF Gateway iniciado ... port: 3000
@vetequine/pwa:dev: ✓ Ready in ...  - Local: http://localhost:3100
```

| Serviço | URL | O que é |
|---|---|---|
| PWA | http://localhost:3100 | a interface — é isso que você abre no navegador |
| BFF | http://localhost:3000 | gateway — a PWA fala com ele, não direto com os MS |
| ms-identity | http://localhost:3001 | cadastros, auth, tenant |
| ms-inventory | http://localhost:3002 | estoque |
| Adminer | http://localhost:8080 | ver o banco pela interface |

## 4. Abrir e logar

Acesse **http://localhost:3100/login**.

Credenciais do seed (`apps/ms-identity/prisma/seed.ts` — rodar
`npm run db:seed` se ainda não existir esse usuário):

```
E-mail: demo@vetequine.com.br
Senha:  vetequine123
```

Depois do login, o "Meu perfil" (`/profile`) mostra os dados do
veterinário puxados de verdade do banco via `GET /tenants/me` — CRMV e
CPF/CNPJ somente leitura, nome/telefone/e-mail/logo editáveis.

Ainda não existe uma tela de "cadastrar novo veterinário" na PWA — o
endpoint (`POST /tenants`) já existe no backend, mas a tela é trabalho
futuro do Dev 2.

## 5. Parar tudo

`Ctrl+C` no terminal onde `npm run dev` está rodando. Como é um processo
só orquestrando vários (`turbo`), um `Ctrl+C` derruba tudo junto.

---

## Troubleshooting específico de rodar localmente

### `Error: @prisma/client did not initialize yet`

Faltou o passo 2 acima. Rode o `prisma generate` dos dois schemas.

### `next-swc.win32-x64-msvc.node is not a valid Win32 application` / Turbopack falha

Binário nativo do Next.js corrompido — geralmente sintoma de instalação
interrompida no meio (disco cheio, `Ctrl+C` no meio de um `npm install`).
Conserta assim:

```powershell
Remove-Item -Recurse -Force node_modules\@next\swc-win32-x64-msvc
npm install --workspace=@vetequine/pwa
```

Se o mesmo tipo de erro aparecer em outro binário nativo (`turbo`, esbuild,
etc.), o conserto é o mesmo padrão: apagar só a pasta daquele pacote em
`node_modules` e rodar `npm install` de novo — não precisa apagar tudo.

### Porta já em uso (`EADDRINUSE`)

Alguma instância anterior do `npm run dev` ainda está rodando em segundo
plano (o `Ctrl+C` às vezes não mata processos filhos do `turbo` no
Windows). Descubra o PID pela porta e mate-o:

```powershell
Get-NetTCPConnection -LocalPort 3100 | Select-Object -ExpandProperty OwningProcess | Stop-Process -Force
# troque 3100 pela porta travada (3000 = bff, 3001 = ms-identity, 3002 = ms-inventory)
```

### Login dá "credenciais inválidas" mas você tem certeza da senha

Confirme que o `db:seed` já rodou nesse banco:

```powershell
npm run db:seed --workspace=@vetequine/ms-identity
```

Outros problemas de ambiente (Docker, `.env`, RLS) — ver a seção 8 do
`ONBOARDING.md`, que é mais completa para setup do zero.
