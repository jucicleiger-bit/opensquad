# Divisão nuvem/local — Fase 1: Schema + Auth (Supabase)

## Contexto

Hoje todo o sistema (dashboard, `content-central-app`, dados de projeto,
geração de arte, agendamento de WhatsApp) roda num único processo Node
local (`src/content-central-server.js` + `src/content-central.js`), com
dados em arquivos JSON locais (`getCentralPaths`/`readJson`/`writeJson`) e
geração de conteúdo feita via Claude Code (IDE) e automação de navegador
local (arte) + WAHA local (WhatsApp).

Objetivo: acessar o painel (projetos, conteúdo, aprovação, agendamento) de
qualquer lugar, sem depender do PC ligado para *ver* dados — só para
*gerar* coisa nova.

Este documento cobre **só a primeira fatia**: banco de dados + auth na
nuvem (Supabase). As demais fatias (backend na nuvem, frontend na nuvem,
agente local) são specs separadas e dependem desta.

## Escopo desta fase

- Usuário único (dono do sistema), sem multi-tenant, sem papéis/permissões.
- Schema Postgres no Supabase para projetos, conteúdo, agendamentos e fila
  de tarefas.
- Auth Supabase com proteção reforçada (MFA, RLS, sem exposição de chaves).
- Script de migração único: lê os JSON locais existentes e popula as
  tabelas novas.

Fora de escopo aqui: deploy do backend/frontend na nuvem, o agente local
que consome a fila, mudanças no código de geração de arte ou no WAHA.

## Modelo de dados

```
projects
  id            uuid pk
  owner_id      uuid  -- auth.uid() do único usuário
  name          text
  slug          text unique
  brand_profile jsonb   -- perfil de marca / brand xray existente
  created_at    timestamptz
  updated_at    timestamptz

content_items
  id            uuid pk
  project_id    uuid fk -> projects.id
  channel       text     -- instagram_feed, whatsapp_status, etc (mesmo enum de hoje)
  status        text     -- draft | approved | scheduled | posted | error
  copy          text
  media_url     text     -- aponta pro Supabase Storage (arte final)
  metadata      jsonb    -- payload livre (equivalente ao que já existe em content-central.js)
  created_at    timestamptz
  updated_at    timestamptz

schedules
  id              uuid pk
  content_item_id uuid fk -> content_items.id
  run_at          timestamptz
  status          text   -- pending | done | error
  created_at      timestamptz

jobs
  id            uuid pk
  type          text     -- 'art_generation' | 'whatsapp_send'
  payload       jsonb    -- prompt/params necessários pro agente local executar
  status        text     -- pending | running | done | error
  result_url    text     -- preenchido pelo agente após concluir (ex: URL da arte)
  error_message text
  created_at    timestamptz
  updated_at    timestamptz
```

Índices: `content_items(project_id, status)`, `schedules(run_at, status)`,
`jobs(status, created_at)`.

## Auth e proteção

- Supabase Auth, e-mail/senha, **1 usuário** (o dono).
- **MFA (TOTP) obrigatório** — recurso nativo do Supabase Auth, sem lib
  extra.
- **Row Level Security (RLS) ativado em todas as tabelas**, política única:
  `owner_id = auth.uid()` (em `projects`; as demais tabelas herdam via
  join/policy referenciando `project_id -> projects.owner_id`).
- Chave `service_role` do Supabase **nunca** vai pro frontend nem é
  commitada — só usada pelo backend/agente local, via variável de
  ambiente.
- Frontend usa só a chave pública (`anon key`) + sessão de usuário
  autenticado; RLS é quem garante que só o dono lê/escreve.
- Rate limiting de login: usa o rate limit nativo do Supabase Auth
  (já incluso, sem configuração extra necessária no plano free).
- Tudo em HTTPS (Supabase já força TLS).

## Fila agente↔nuvem

Tabela `jobs` + **Supabase Realtime** (nativo, sem lib nova): o agente
local assina mudanças (`INSERT`/`UPDATE`) na tabela `jobs` filtrando
`status = 'pending'`, em vez de fazer polling manual.

## Migração dos dados locais

Script único (`scripts/migrate-to-supabase.js` ou similar), rodado uma vez:

1. Lê os JSON locais existentes via `getCentralPaths`/`readJson` (código
   já existente em `src/content-central.js`).
2. Para cada projeto local, insere linha em `projects`.
3. Para cada peça de conteúdo, insere em `content_items` (+`schedules` se
   já tinha agendamento).
4. Não apaga os arquivos locais — só deixa de ser a fonte de verdade a
   partir da migração.

Idempotência: script pode ser reexecutado com segurança — usa `slug`/id
existente como chave de upsert, não duplica.

## Storage (arte)

Bucket privado no Supabase Storage, acesso só via URL assinada (não
público). Antes do upload: comprimir/redimensionar para o tamanho real
usado na publicação (evita gastar o free tier com arquivos RAW/grandes).
Política de retenção: conteúdo com `status = 'posted'` há mais de 30 dias
pode ter a mídia removida do Storage (registro no banco fica, só o
arquivo some) — a definir o gatilho exato (manual ou cron) numa fase
posterior; por ora deixar a política documentada e não automatizada.

## Testes

- `assert`-based smoke test do script de migração: roda contra um fixture
  pequeno de JSON local, confere que as linhas certas aparecem nas tabelas
  (ou mock do client Supabase).
- Não testar RLS/Auth via teste automatizado nesta fase — validação manual
  (tentar acessar dado de fora da sessão autenticada e confirmar que nega).

## Fora de escopo / próximas fases

- Fase 2: backend na nuvem (troca leitura/escrita de arquivo local por
  Supabase nas rotas de `content-central-server.js`).
- Fase 3: frontend (`content-central-app`/`dashboard`) publicado apontando
  pro backend novo.
- Fase 4: agente local que consome `jobs`, aciona geração de arte
  (código existente, inalterado) e envio WhatsApp via WAHA (existente,
  inalterado), e faz upload do resultado.
