# Pedidos para o João

## Entregue: auditoria de 06/11/2026 (lado da PWA)

Tudo o que bloqueava o staging está entregue e no ar desde 09/11/2026:

- refresh token só no cookie `HttpOnly`, com `credentials: 'include'` no login, no refresh e no logout (#54);
- cache do service worker limpo no login, no logout e quando a sessão cai, com `VERSION` `v2` (A-01, #54);
- chave do Google Maps no build da PWA (#54, junto com a #53) e 404 do CEP com `AppError` (#54);
- `propertyId` continua no `updateAnimalSchema`, para o serviço responder 422 (decidido na #52).

O texto completo dos pedidos, com o contrato do cookie e o motivo de cada item, está no histórico do git deste arquivo (até o commit da #54).

---

## Em aberto (sem pressa, não bloqueia nada)

1. **Cache de API separado por usuário (A-01, parte "desejável").** Hoje o cache é apagado no login, no logout e na falha de refresh, o que resolve o caso do aparelho compartilhado. Falta a segunda barreira: a chave do cache incluir o usuário (por exemplo, `quironequine-api-<userId>`, com a página avisando o service worker de quem está logado). Assim, mesmo que a limpeza falhe (aba fechada no meio, sem rede), um usuário nunca recebe a resposta de outro. Vale também para a corrida de uma requisição que termina logo depois do logout e grava no cache.

2. **Laudo com link temporário (M-03), quando existir a tela de exames.** Os links de arquivo (`resultFileUrl`, `photoUrl`, `sketchUrl`, `logoUrl`) chegam assinados e valem 15 minutos. No botão "ver laudo", busque o exame de novo (`GET /exams/:id`) e abra o link que vier, em vez do que está na tela. E não guarde links de arquivo em estado persistido ou no cache do service worker: eles vencem.

3. **CSP da PWA (auditoria B-05), quando for feita.** A política vai precisar liberar o Google Maps (`maps.googleapis.com`, `maps.gstatic.com`), o IBGE (`servicodados.ibge.gov.br`), os tiles do OpenStreetMap (fallback do Leaflet) e a API (`api-homolog...`). Combine com o Marco antes, porque o HSTS fica no Caddy, que é infra.
