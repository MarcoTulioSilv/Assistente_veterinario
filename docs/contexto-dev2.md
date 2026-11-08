# Contexto Dev 2 — VetEquine

Última atualização: 08/11/2026

## Papéis
- Dev 1 (Marco): Prisma schema, migrations, RLS, Services, Repositories
- Dev 2 (João/eu): UI/Frontend PWA, Controllers + Zod, BFF, adapters externos, testes E2E

## Regras inegociáveis
- Dinheiro sempre em centavos (INTEGER)
- Soft delete obrigatório em dados pessoais (LGPD)
- TypeScript strict, sem any implícito
- PR obrigatório com review do outro dev antes de merge
- Cobertura de testes >= 70%
- Nunca commitar .env nem chave hardcoded

## Fluxo padrão
git checkout develop && git pull origin develop
git checkout -b feature/XXX-descricao
# typecheck + lint + testes antes de commitar
# abrir PR para develop, aguardar CI, aguardar OK do João

## Decisões tomadas
- Geocoding: NominatimMapsAdapter (OpenStreetMap, sem custo)
- Distância/rota: OsrmRouteAdapter (PR #42)
- Google Maps: chave existe no .env mas não usada por adapter ainda
- Chave de navegador (Maps JavaScript API): NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY
  restrita por referenciador (homolog.quironequi.com.br e localhost:3100)
- Testes de integração não rodam local (Docker) — rodam no CI

## Pendências com Marco
- preço por ml (mlPerUnit) — aguarda schema
- fator de conversão frasco/ampola/dose/ml — aguarda decisão dele

## Branches especiais
- demo/pwa-githubpages: nunca mergeada em develop, recebe merge
  de develop periodicamente, descartável quando staging real existir
