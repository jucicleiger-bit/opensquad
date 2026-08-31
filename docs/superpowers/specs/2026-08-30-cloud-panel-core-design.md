# Divisão nuvem/local — Fase 3a: painel núcleo (dashboard + aprovação + calendário)

## Contexto

Fase 1 (schema + auth + migração) e Fase 2 (publicação automática) já estão
em produção no Supabase real do usuário. Não existe, ainda, nenhuma tela —
os dados só são visíveis via query direta ou pelo app local antigo
(`content-central-app`), que continua rodando 100% contra arquivos locais e
não foi tocado por nenhuma fase anterior.

O app local tem ~20 telas. A maioria depende de geração de IA (empresa,
referências, ofertas, pilares, gerar conteúdo, anúncios, carrossel, teste,
aprendizado) ou é o módulo comercial/CRM (catálogo, agência, portfólio,
prospecção, propostas) — nenhuma dessas foi migrada pro Supabase ainda.

Esta fase (3a) é a primeira fatia de um painel novo na nuvem: só as 3 telas
cujo dado já existe 100% no Supabase hoje (`projects`, `content_items`,
`schedules` da Fase 1) — dashboard, aprovação de conteúdo, calendário. As
demais telas viram fatias futuras (3b: empresa/marca/aprendizado, 3c:
comercial/CRM), cada uma exigindo primeiro expandir o schema pra trazer
aquele domínio de dado pro Supabase.

## Escopo desta fase

- App React novo, separado do `content-central-app` local (não é uma
  adaptação — é construído do zero, só pro que a nuvem já sabe servir).
- Login (Supabase Auth: e-mail + senha + desafio MFA/TOTP quando
  configurado).
- **Dashboard**: lista os projetos (`projects`), clique abre o projeto.
- **Aprovação**: lista `content_items` de um projeto com `status = 'draft'`
  ou `'approved'` (ainda não publicado), agrupados por dia. Ações: aprovar
  (`status → 'approved'`), rejeitar/cancelar (`status → 'cancelled'`),
  editar e salvar legenda (`copy`), visualizar a imagem (URL assinada do
  Storage).
- **Calendário**: visão por data dos itens agendados
  (`content_items` + `schedules`), com status visual (rascunho / aprovado /
  publicado / erro), reagendar (`schedules.run_at`).

Fora de escopo desta fase — nenhum botão que aciona geração de IA
(Regenerar, Animar pra Reels, Testar post, Gerar conteúdo novo): esses
dependem do agente local (Fase 4, ainda não construído) consumindo a fila
`jobs`. Essas ações simplesmente não aparecem nesta versão — não como
botão desabilitado, apenas ausentes, até a Fase 4 existir para servi-las.

## Arquitetura

Sem servidor Node novo, mesma linha da Fase 2: o app fala **direto** com o
Supabase usando `@supabase/supabase-js` no navegador, autenticado pela
sessão do usuário — a política RLS "dono tem acesso total" da Fase 1 já
cobre leitura/escrita de `projects`/`content_items`/`schedules`, nenhuma
mudança de RLS necessária.

```
Navegador (React + Vite)
  └─ @supabase/supabase-js (anon key + sessão do usuário)
       ├─ Auth: login, MFA
       ├─ Postgres (via RLS): projects, content_items, schedules
       └─ Storage: URL assinada pra exibir a imagem
```

Hospedagem: Vercel, na conta do usuário
(`juciclei.ger@gmail.com`, já confirmada antes). Variáveis de ambiente do
Vercel (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) — a chave anônima é
segura de expor no navegador *porque* RLS está ligado; sem RLS ela não
seria.

**Nota da Fase 2, vale aqui também**: este projeto Supabase usa o sistema
de chaves novo. A chave anônima usada pelo navegador (Auth/PostgREST/
Storage) é a legacy `anon` JWT normal — só a invocação HTTP de Edge
Function exigiu a chave nova (`sb_secret_...`), e esta fase não chama
nenhuma Edge Function.

## Modelo de dados

Nenhuma tabela nova. Reaproveita exatamente o schema da Fase 1:

- `projects(id, name, slug, brand_profile, ...)` — dashboard.
- `content_items(id, project_id, channel, status, copy, media_url,
  content_id, metadata, ...)` — aprovação e calendário.
- `schedules(id, content_item_id, run_at, status)` — calendário.

## Fluxos

**Aprovar**: `update content_items set status = 'approved' where id = ?`
— o `publish-sweep` da Fase 2 pega automaticamente no próximo ciclo do
cron (até 5 min) se a `schedules.run_at` já tiver passado.

**Rejeitar**: `update content_items set status = 'cancelled' where id = ?`
— soft delete, preserva o registro (consistente com o status `cancelled`
que a Fase 1 já usa pro que veio de `content/cancelled/` local).

**Editar legenda**: `update content_items set copy = ? where id = ?`.

**Ver imagem**: `supabase.storage.from('content-media').createSignedUrl(
media_url, 300)` — chamado direto do navegador, autenticado; a política de
Storage da Fase 2 ("authenticated full access") já permite.

**Reagendar**: `update schedules set run_at = ? where id = ?`. Só permitido
enquanto `schedules.status = 'pending'` — um item já `'running'` (sendo
publicado agora) ou `'done'`/`'error'` não é reagendável pela tela; a UI
esconde a ação nesses casos em vez de deixar tentar e falhar.

## Testes

- Componentes/lógica pura (formatação de data, agrupamento por dia,
  validação de legenda) testados com Vitest + Testing Library — mesma
  stack já usada em `content-central-app` (`vitest`, `@testing-library/
  react` já são devDependencies desse projeto irmão, reaproveitados aqui).
- Chamadas reais ao Supabase (login, approve, reject, reagendar) não têm
  teste automatizado nesta fase — verificação manual contra o projeto
  real, mesma convenção das fases anteriores.

## Fora de escopo / próximas fases

- Fase 3b: telas de empresa/marca/referências/ofertas/pilares/aprendizado
  — precisa expandir o schema primeiro (essas tabelas não existem ainda).
- Fase 3c: módulo comercial/CRM (catálogo, agência, portfólio,
  prospecção, propostas) — mesma coisa, schema novo primeiro.
- Fase 4: agente local consumindo a fila `jobs` — é o que vai permitir os
  botões de geração aparecerem numa fase 3 futura.
- Botão "publicar agora" manual (chamar `publish-sweep` sob demanda): essa
  função hoje só aceita a chave de serviço como autenticação (decisão da
  Fase 2, pra não expor publish disparável por qualquer usuário
  autenticado) — precisaria de um novo caminho de auth nela (JWT de
  usuário + checagem de dono, igual `save-instagram-token` já tem) antes
  de um botão do painel poder chamá-la. Não entra nesta fase; o cron a
  cada 5 min já cobre o caso de uso principal.
