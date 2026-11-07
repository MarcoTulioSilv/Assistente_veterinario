# Pedidos para o João: sessão na PWA (auditoria de 06/11/2026)

Uma auditoria de segurança do sistema (06/11/2026) achou dois problemas que os stakeholders vão sentir na homologação:

1. **O app derruba o usuário a cada 15 minutos.** O access token vence em 15 min, e a PWA nunca renova: o `request()` não chama `/auth/refresh`, e toda tela manda o 401 para o login. O veterinário perde a sessão no meio do atendimento.
2. **Sair do app não encerra a sessão.** O logout só limpa o `sessionStorage`. O refresh token continua valendo 7 dias no servidor.

Junto veio um terceiro, só de servidor: com o BFF atrás do Caddy, o limite de 100 requisições por minuto valia para **o sistema inteiro**, e não por usuário.

Decisão do Marco: corrigir os três na PR #37, antes de os stakeholders começarem a usar. A parte de servidor já está feita (abaixo). **Falta a parte da PWA, que é sua**, na mesma branch (`feature/MS3-012-homologacao-m2`).

---

## O que já mudou no servidor

**Sessão por aparelho.** Cada login abre uma sessão própria. Entrar no celular não derruba mais o notebook.

**Para a PWA, o refresh token continua opaco.** Guarde e devolva como hoje, sem interpretar. Por dentro, o formato mudou para `<sessionId>.<segredo>`, e quem estava logado precisa entrar de novo uma vez.

**`POST /api/v1/auth/refresh`** com corpo `{ refreshToken }`:
- devolve um `AuthTokens` novo, no mesmo formato do login;
- **o refresh token usado deixa de valer**: guarde sempre o par novo, os dois tokens;
- duas chamadas com o mesmo token em até **30 segundos** (duas abas, ou nova tentativa depois de timeout) recebem as duas um par válido;
- depois desses 30 segundos, reapresentar um token já usado é tratado como **token roubado**. A sessão daquele aparelho cai, e a resposta é 401 com "Sessão encerrada por segurança. Entre de novo.";
- outros 401 possíveis: "Sessão expirada" (passou dos 7 dias), "Sessão inválida" e "Refresh token inválido". Em **qualquer** 401 do refresh, o caminho é o mesmo: limpar a sessão e ir para o login.

**`POST /api/v1/auth/logout`** com corpo `{ refreshToken }`:
- revoga a sessão **deste** aparelho;
- responde **sempre 204**, mesmo com token inválido ou já revogado, então não precisa tratar erro.

**Limites de requisição (BFF)**, agora por cliente:
- 100 por minuto no geral;
- login: 10 tentativas **que falharam** a cada 15 minutos, por IP. Quem acerta a senha não gasta a cota;
- refresh: 30 por minuto, por IP;
- cadastro de clínica: 5 por hora, por IP.

Acima do limite, a resposta é **429** com `{ code: 'RATE_LIMITED', message }`. Na tela de login, mostre a `message` que vier ("Muitas tentativas de login. Aguarde alguns minutos.").

**Contrato:** `IAuthService.logout` passou a receber o `refreshToken` em vez do `userId`. O `mock-auth.ts` não implementa esse método, então nada quebra.

---

## O que você precisa fazer na PWA

### 1. Renovação automática no `request()` (`apps/pwa/src/lib/api.ts`)
- Quando uma chamada voltar **401**, renove **uma vez** e repita a chamada original.
- **Uma renovação por vez.** Se cinco chamadas voltarem 401 juntas, todas esperam a **mesma** `Promise` de refresh. Sem isso, cada uma renova sozinha e as outras ficam com um token que já não vale.
- Não tente renovar quando o 401 vier de `/auth/login`, `/auth/refresh` ou `/auth/logout`, para não entrar em laço.
- Se o refresh falhar (401) ou não houver refresh token guardado: `clearSession()` e mande para o login. Isso já existe nas telas; o efeito é o mesmo de hoje, só que agora acontece 7 dias depois, e não 15 minutos.
- Refresh com sucesso: `setSession()` com o par novo antes de repetir a chamada.
- Sem rede (o fetch rejeita), não limpe a sessão: o usuário pode estar numa fazenda sem sinal.

Esboço:

```ts
let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = sessionStorage.getItem('refreshToken');
    if (!refreshToken) return false;
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    setSession(await res.json());
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
```

Deixe a renovação **numa função só**, como no esboço. Na próxima branch, o refresh token vai para um cookie `HttpOnly` (ver o fim do documento) e só essa função muda.

### 2. Logout de verdade (`AppHeader.tsx` e `api.ts`)
- Acrescente `api.auth.logout(refreshToken)` e chame **antes** do `clearSession()`.
- Não espere o resultado para sair: sem rede, o usuário sai do mesmo jeito. Algo como `void api.auth.logout(token).catch(() => {})`.
- Acrescente também `api.auth.refresh` no cliente, se for usar pelo `api` em vez do fetch direto do esboço.

### 3. Login com limite
- Trate o **429** na tela de login, mostrando a mensagem do servidor.

### Como testar
- Coloque `JWT_ACCESS_EXPIRES_IN=1m` no seu `.env` e reinicie o ms-identity. Entre, espere 2 minutos e navegue: o app precisa continuar logado.
- Abra uma tela que dispara várias chamadas ao mesmo tempo (dashboard) com o token vencido. Na aba Network, deve sair **um** `/auth/refresh` só.
- Saia do app e chame `/auth/refresh` com o refresh token antigo (copie antes de sair). Precisa voltar 401.
- Se der, um E2E no Playwright com o token curto, cobrindo os dois primeiros casos.

---

## Para a próxima branch (não precisa agora)
- **Refresh token em cookie `HttpOnly`.** O BFF/MS1 passa a gravar o cookie, e a PWA deixa de guardar o refresh token no `sessionStorage`. Com a renovação isolada numa função, a sua parte vira trocar o corpo do fetch por `credentials: 'include'`.
- **Cache do service worker (auditoria A-01).** As respostas de `/owners`, `/properties`, `/animals` e `/inventory` ficam no Cache Storage com a URL como chave, e sobrevivem ao logout. Num aparelho compartilhado, o próximo usuário, sem rede, vê os dados do anterior. Precisa no mínimo apagar o cache de API no logout e no login.
- Os outros achados da auditoria (CSP, URLs assinadas para laudos, chaves estrangeiras por tenant etc.) entram no planejamento antes da produção.

## Ainda pendente
- **Dockerfile da PWA.** Continua sendo o que trava o primeiro deploy do staging. Os detalhes estão na descrição da #37.
