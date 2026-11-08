# Pedidos para o João: refresh token em cookie e cache do service worker (auditoria de 06/11/2026)

O pedido anterior (renovação automática, logout de verdade, 429 no login) está entregue e no staging. Ele continua no histórico do git, se precisar consultar.

Este pedido fecha os dois itens da auditoria que ficaram para a PWA:

1. **O refresh token sai do JavaScript.** Hoje ele fica no `sessionStorage`, legível por qualquer script da página. Um XSS (por exemplo, uma dependência comprometida) leva um token que vale 7 dias. Agora ele vive num cookie `HttpOnly`, que o JavaScript não lê.
2. **O cache do service worker vaza dados entre usuários (A-01).** As respostas de `/owners`, `/properties`, `/animals` e `/inventory` ficam no Cache Storage com só a URL como chave, e sobrevivem ao logout. Num tablet de clínica, o próximo usuário, de outra clínica, abre a lista sem sinal e vê os proprietários (nome, CPF, telefone) do anterior.

---

## ⚠️ Prazo: a `develop` já está com o servidor novo

Decisão do Marco: **o servidor já foi trocado na `develop` e não aceita mais o refresh token no corpo.** Enquanto a sua parte não entrar:

- na `develop` (e no seu ambiente local), a PWA **não consegue renovar a sessão**: cai no login a cada 15 minutos, como antes da #37;
- o **staging não recebe** essa mudança. A PR `develop → staging` só sai quando a sua parte estiver na `develop`, junto. Até lá, **não abra PR para o staging**, nem para outra correção. Se precisar de uma correção urgente no staging, fale com o Marco antes.

---

## O que mudou no servidor

**Cookie `qe_refresh`**, gravado pela API:

```
Set-Cookie: qe_refresh=<token>; Max-Age=604800; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict
```

- **`Path=/api/v1/auth`:** o navegador só manda o cookie para login, refresh e logout. O resto da API continua só com o `Authorization: Bearer`.
- **`SameSite=Strict`:** a PWA (`homolog.quironequi.com.br`) e a API (`api-homolog.quironequi.com.br`) são o **mesmo site**, então o cookie vai. Um site de fora não consegue disparar o refresh com o cookie do usuário (proteção contra CSRF).
- **Sem `Domain`:** vale só para o host da API.
- **`Secure`:** no dev local também funciona, porque o Chrome e o Firefox tratam `http://localhost` como seguro. Se algum navegador seu recusar, use o Chrome.

**`POST /api/v1/auth/login`:**
- corpo igual ao de hoje (`{ email, password, totpCode? }`);
- a resposta vem **sem `refreshToken`**: é o tipo novo `AuthSession` do `shared-types` (`accessToken`, `expiresIn`, `user`);
- grava o cookie.

**`POST /api/v1/auth/refresh`:**
- **sem corpo**. O servidor lê o cookie e ignora qualquer `refreshToken` no corpo;
- responde `AuthSession` e grava o cookie novo;
- as regras são as mesmas: 30 s de tolerância para chamadas simultâneas, e depois disso o reuso derruba a sessão;
- qualquer 401 **apaga o cookie**, inclusive quando o cookie nem veio. O caminho continua o mesmo: limpar a sessão e ir para o login.

**`POST /api/v1/auth/logout`:**
- **sem corpo**. Revoga a sessão do cookie, apaga o cookie e responde **sempre 204**.

O `IAuthService` continua devolvendo `AuthTokens`, porque é interno do servidor. Para a PWA, o tipo da resposta HTTP agora é o `AuthSession`.

---

## O que você precisa fazer na PWA

### 1. `credentials: 'include'` nas três chamadas de auth (`apps/pwa/src/lib/api.ts`)

Sem isso, o navegador **descarta o `Set-Cookie`** do login (a chamada é para outra origem) e **não manda o cookie** no refresh e no logout. É o erro mais provável: o login "funciona", mas o refresh volta 401.

- **`api.auth.login`:** `credentials: 'include'`; o tipo da resposta passa a ser `AuthSession`.
- **`refreshSession()`:** `fetch(\`${BASE_URL}/auth/refresh\`, { method: 'POST', credentials: 'include' })`, sem corpo e sem ler nada do `sessionStorage`. Se o `api.auth.refresh` não for usado em lugar nenhum, pode remover.
- **`api.auth.logout()`:** sem parâmetro, com `credentials: 'include'`.

O BFF já responde com `Access-Control-Allow-Credentials: true` para a origem da PWA. Não use `credentials: 'include'` nas outras rotas: lá o cookie nem viaja (por causa do `Path`), e não há motivo para mudar.

### 2. Tirar o refresh token do `sessionStorage`
- `setSession()` recebe `Pick<AuthSession, 'accessToken'>` e grava só o access token.
- `clearSession()` continua removendo a chave `refreshToken`, para limpar o que ficou de versões antigas.
- O `AppHeader` chama `api.auth.logout()` sem ler o `sessionStorage`. O resto fica igual: não espera a resposta, e depois vêm o `clearSession()` e o redirecionamento.

**Recomendado (a auditoria pede):** o access token só **em memória**, numa variável do módulo `api.ts`, sem `sessionStorage`. Aí, ao abrir ou recarregar a página, a PWA não tem access token e precisa chamar `refreshSession()` antes de decidir se manda para o login. Isso é bom: o cookie dura 7 dias, então o veterinário continua logado mesmo depois de fechar o navegador. Hoje o `sessionStorage` morre com a aba.
- `hasSession()` passa a ser assíncrono (ou um estado "carregando" no guard das telas): "tem access token em memória **ou** o refresh deu certo".
- Sem rede ao abrir, o refresh rejeita. **Não mande para o login** nesse caso: mostre a tela offline ou os dados em cache (respeitando o item 3).

Se preferir fazer em duas partes, o item 2 com o access token ainda no `sessionStorage` já resolve o mais grave (o refresh token fora do JS). A parte "só em memória" pode vir numa PR seguinte, avisando o Marco.

### 3. Cache do service worker (A-01, `apps/pwa/public/sw.js`)

**Mínimo, que precisa entrar junto:**
- **Apagar o cache de API no logout e no login.** Na página, `await caches.delete('quironequine-api-v1')` (ou o nome que estiver em `API_CACHE`) antes de gravar a sessão nova e antes do `router.replace('/login')`. Também dá para mandar um `postMessage` ao SW e ele apaga, mas o `caches.delete` direto da página já funciona.
- **Apagar também quando o refresh falhar com 401** (a sessão acabou): é o mesmo caminho do `clearSession()`, então ponha a limpeza dentro dele (assíncrona, sem esperar).
- **Não guardar** resposta diferente de 200, nem requisição **sem** `Authorization`.
- **Subir `VERSION`** no `sw.js` (`v1` → `v2`), para o `activate` apagar o cache antigo que já está nos aparelhos dos stakeholders.

**Desejável:** escopo por usuário na chave do cache, para que, mesmo que a limpeza falhe (aba fechada no meio, sem rede), um usuário nunca receba a resposta de outro.
- Por exemplo, um cache por usuário: `quironequine-api-${userId}`. A página avisa o SW de quem está logado com um `postMessage`, e o SW só consulta o cache do usuário atual.
- Ou um cabeçalho `X-Cache-Scope: <tenantId>:<userId>`, mandado pela página e usado na chave (`url + '#' + scope`).

Fica a pergunta para você e para o Marco: a lista offline precisa mesmo de CPF e telefone? Se não precisar, dá para ter uma versão resumida só para o cache.

### Como testar
- **Cookie:** entre e confira, em DevTools → Application → Cookies, no host da **API** (`localhost:3000` no dev), que o `qe_refresh` aparece como HttpOnly. No `sessionStorage` não pode ter `refreshToken`.
- **Renovação:** `JWT_ACCESS_EXPIRES_IN=1m` no `.env`, reinicie o ms-identity, entre, espere 2 minutos e navegue: o app precisa continuar logado. Na aba Network, o `/auth/refresh` sai **sem corpo** e com o cookie no cabeçalho.
- **Logout:** depois de sair, o cookie some, e um refresh manual (`fetch(.../auth/refresh, { method: 'POST', credentials: 'include' })` no console) volta 401.
- **Cache (o teste da auditoria):** entre como o usuário A, liste proprietários e saia. Entre como B, de **outro tenant** (o seed de homologação tem dois), fique offline (DevTools → Network → Offline) e abra a lista de proprietários. **Não pode aparecer nada de A.** Se der, faça esse teste num E2E com Playwright.
- **Atualização do SW:** com a PWA antiga instalada, abra a versão nova. Em Application → Cache Storage, o `quironequine-api-v1` tem que sumir.

---

## Edição de animal não muda a propriedade (RN-010)

Decisão do Marco: **a única forma de mudar um animal de propriedade é a transferência**, que grava o histórico em `animal_transfers`. A edição não pode mudar a propriedade.

**O que já está certo na PWA (conferido):** a tela `apps/pwa/src/app/animals/[id]/page.tsx` e o `api.animals.update` já deixam o `propertyId` de fora, e a troca passa só pelo `api.animals.transfer`. **Mantenha assim.** Se um dia a tela de edição ganhar o campo de propriedade, ele precisa ser só leitura, com um botão que leve à transferência.

**O que mudou no servidor:** `PATCH /api/v1/animals/:id` com um `propertyId` **diferente** do atual agora responde **422** (`VALIDATION_ERROR`, campo `propertyId`, "Para mudar o animal de propriedade, use a transferência."). Mandar o mesmo valor que já está gravado continua aceito.

**O que falta, no seu lado do MS1:** tire o `propertyId` do `updateAnimalSchema` (`apps/ms-identity/src/schemas/animal.schema.ts`). Hoje ele é `createAnimalSchema.partial()` e por isso aceita o campo. Algo como `createAnimalSchema.omit({ propertyId: true }).partial()`. Assim, o contrato já diz que a edição não muda a propriedade, e a regra do serviço fica como segunda barreira. Não tem pressa e pode entrar na mesma PR do cookie.

---

## Fotos e laudos com link temporário (auditoria M-03)

Antes, qualquer pessoa com o link de uma foto ou de um **laudo** abria o arquivo, sem login e para sempre (e link vaza fácil: WhatsApp, histórico do navegador). Agora a API devolve os links de arquivo **assinados**, válidos por **15 minutos**: `.../api/v1/uploads/<tenant>/general/<arquivo>.png?exp=...&sig=...`. Sem assinatura, ou com o prazo vencido, o arquivo responde 404.

**O que muda para a PWA:**
- **Na maior parte, nada.** `photoUrl`, `sketchUrl`, `logoUrl`, `resultFileUrl` e a `url` do `POST /uploads` já chegam assinados; é só usar no `<img src>` ou no link, como hoje.
- **Salvar o formulário com o link assinado está certo:** o servidor tira a assinatura antes de gravar. Não precisa limpar nada.
- **Link de laudo numa tela aberta há mais de 15 minutos não abre.** No botão "ver laudo", busque o exame de novo (`GET /exams/:id`) e abra o `resultFileUrl` que vier, em vez de usar o que está na tela.
- **Não guarde links de arquivo** (estado persistido, `localStorage`, cache de API no service worker): eles vencem. A imagem que o navegador já baixou continua na tela.
- **Link de arquivo de outra clínica é recusado** com 422 ("O arquivo não pertence a esta clínica"). Só acontece se alguém colar um link na mão.
- O `logoUrl` aceita link externo como antes; esse não é assinado.

---

## Depois que a sua parte entrar
O Marco abre a PR `develop → staging` com o servidor e a PWA juntos, e avisa os stakeholders de que **todo mundo vai precisar entrar de novo uma vez**: o refresh token antigo, que estava no `sessionStorage`, deixa de valer.
