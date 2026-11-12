# Pedidos para o João

## Entregue: auditoria de 06/11/2026 (lado da PWA)

Tudo o que bloqueava o staging está entregue e no ar desde 09/11/2026:

- refresh token só no cookie `HttpOnly`, com `credentials: 'include'` no login, no refresh e no logout (#54);
- cache do service worker limpo no login, no logout e quando a sessão cai, com `VERSION` `v2` (A-01, #54);
- chave do Google Maps no build da PWA (#54, junto com a #53) e 404 do CEP com `AppError` (#54);
- `propertyId` continua no `updateAnimalSchema`, para o serviço responder 422 (decidido na #52).

O texto completo dos pedidos, com o contrato do cookie e o motivo de cada item, está no histórico do git deste arquivo (até o commit da #54).

---

## Em aberto: telas do M2 que faltam na PWA (bloqueia o M3)

Na `develop` (12/11/2026), a PWA não tem tela de exames, de vacinação nem de registro de pagamento. O servidor, os contratos em `shared-types` e as rotas do BFF já existem. O `api.ts` já tem o cliente de vacinação, mas nenhuma tela o usa. O fluxo de caixa da Sprint 11 do M3 depende do registro de pagamento: sem ele, não há entrada no caixa.

1. **Exames (RF-EXM-001 a 006).** Tipos de exame em `/exam-types` (CRUD; sugestões prontas em `EXAM_TYPE_SUGGESTIONS`). Pedido em `/exams`: criar e editar em rascunho, `POST /:id/issue` (emitir), `POST /:id/collection` (coleta, opcional), `POST /:id/send-to-analysis`, `POST /:id/result` (laudo em PDF) e `DELETE /:id`. Indicador de status com a coleta opcional (`draft → requested → [collected] → in_analysis → result_available`). No botão "ver laudo", vale o item 2 da lista abaixo (link temporário).
2. **Vacinação (RF-VAC-001 a 005).** `/vaccinations`: listar (filtro `animalId`), detalhar, criar (aplicação da clínica ou externa, um ou vários animais), excluir. Próximas doses em `GET /vaccinations/boosters/:animalId`, para o histórico e o indicador de re-vacinação na tela do animal.
3. **Pendências e registro de pagamento (RN-002, RF-ATD-008, RF-CAD-015).** `GET /financial` (filtros `status` e `ownerId`; o filtro por período vem na Sprint 11) para a aba do proprietário, e `POST /financial/:id/register-payment` para marcar como recebido. A tela de atendimento já usa `GET /financial/by-source/...`.

Prazo: até o fim da Sprint 9 do M3 (27/11/2026), para não atrasar a Sprint 11. O detalhamento está em `Documentação/plano-M3-sprints.md`.

---

## Em aberto (sem pressa, não bloqueia nada)

1. **Cache de API separado por usuário (A-01, parte "desejável").** Hoje o cache é apagado no login, no logout e na falha de refresh, o que resolve o caso do aparelho compartilhado. Falta a segunda barreira: a chave do cache incluir o usuário (por exemplo, `quironequine-api-<userId>`, com a página avisando o service worker de quem está logado). Assim, mesmo que a limpeza falhe (aba fechada no meio, sem rede), um usuário nunca recebe a resposta de outro. Vale também para a corrida de uma requisição que termina logo depois do logout e grava no cache.

2. **Laudo com link temporário (M-03), quando existir a tela de exames.** Os links de arquivo (`resultFileUrl`, `photoUrl`, `sketchUrl`, `logoUrl`) chegam assinados e valem 15 minutos. No botão "ver laudo", busque o exame de novo (`GET /exams/:id`) e abra o link que vier, em vez do que está na tela. E não guarde links de arquivo em estado persistido ou no cache do service worker: eles vencem.

3. **CSP da PWA (auditoria B-05), quando for feita.** A política vai precisar liberar o Google Maps (`maps.googleapis.com`, `maps.gstatic.com`), o IBGE (`servicodados.ibge.gov.br`), os tiles do OpenStreetMap (fallback do Leaflet) e a API (`api-homolog...`). Combine com o Marco antes, porque o HSTS fica no Caddy, que é infra.
