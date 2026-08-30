# Divisão nuvem/local — Fase 2: publicação automática (Supabase Edge Functions)

## Contexto

A Fase 1 (schema + auth Supabase) já está em produção: 4 tabelas
(`projects`, `content_items`, `schedules`, `jobs`), RLS de dono único,
bucket privado de mídia, e um script de migração idempotente já rodou
contra os dados reais (9 projetos, 251 itens de conteúdo).

Hoje, quem publica de verdade no Instagram, envia alertas por e-mail e
roda o scheduler contínuo é `src/content-central-server.js`
(`publishContentToInstagram`, `startPublishScheduler`/
`runDuePublishSweep`, `sendDueAlertEmails`) rodando no PC do usuário —
só publica se o PC estiver ligado.

Objetivo desta fase: publicação automática 24h no Instagram, sem
depender do PC ligado, e sem precisar hospedar um servidor Node próprio.

## Escopo desta fase

- Publicação automática de `content_items` aprovados no Instagram
  (feed/story/reels — os mesmos canais já suportados hoje), no horário
  de `schedules.run_at`.
- Publicação manual sob demanda (equivalente a um botão "publicar
  agora" no painel), reaproveitando a mesma função.
- Alertas por e-mail (token do Instagram vencendo, aprovação pendente
  há muito tempo) via Resend, com cooldown de 24h — mesma lógica de
  `sendDueAlertEmails` hoje, portada.
- Armazenamento seguro do token de acesso do Instagram via **Supabase
  Vault** (nunca em coluna normal, nunca acessível pelo painel/anon key).
- CRUD (listar, aprovar, reagendar conteúdo) passa a falar **direto**
  com o Supabase a partir do painel (Fase 3), sem servidor
  intermediário — a política RLS "dono tem acesso total" da Fase 1 já
  cobre isso, nenhuma mudança de RLS necessária em `content_items`/
  `schedules`.

Fora de escopo: WhatsApp Status (continua local, WAHA — decisão já
tomada na Fase 1), geração de arte (continua local), o painel em si
(Fase 3), o agente local que consome a fila `jobs` (Fase 4).

## Arquitetura

Nenhum servidor Node próprio. Duas Supabase Edge Functions (Deno) somam
todo o trabalho que hoje roda continuamente no PC local:

```
pg_cron (a cada 5 min)  ──┐
                          ├──> Edge Function: publish-sweep
Painel ("publicar agora") ┘         │
                                     ├─> publica no Instagram (Graph API)
                                     ├─> atualiza content_items/schedules
                                     └─> manda e-mails de alerta (Resend)

Painel ("salvar token") ──> Edge Function: save-instagram-token
                                     └─> grava no Supabase Vault
```

O painel (Fase 3) fala direto com o Supabase via RLS para tudo que é
CRUD simples (listar, aprovar, reagendar) — só chama as duas Edge
Functions para as duas ações que precisam de segredo/lógica de servidor.

## Armazenamento do token do Instagram (Supabase Vault)

Hoje o token fica em texto puro num arquivo local
(`readProjectToken`/`saveProjectToken`, `paths.tokenSecretPath`). Isso
não existe mais na nuvem — o token vai para o **Supabase Vault**
(extensão nativa de segredo criptografado em Postgres).

- `projects` ganha as colunas:
  - `instagram_account jsonb not null default '{}'::jsonb` — dados não
    secretos (`handle`, `instagramUserId`, `pageId`), equivalente ao
    `project.instagram` local de hoje.
  - `instagram_token_secret_id uuid` — referência (`vault.secrets.id`),
    nula até o token ser configurado. Nunca contém o valor do token.
  - `instagram_token_expires_at timestamptz` — só a data de
    vencimento, para o alerta de "token vencendo" não precisar
    descriptografar o Vault a cada checagem.

- O painel **nunca** escreve direto no Vault nem lê o token. Quando o
  usuário cola/atualiza o token na tela, o painel chama a Edge Function
  `save-instagram-token` (autenticada), que:
  1. Cria/atualiza o segredo via `vault.create_secret`/
     `vault.update_secret`.
  2. Atualiza `projects.instagram_token_secret_id` e
     `instagram_token_expires_at`.
  3. Nunca retorna o valor do token de volta ao painel (só confirma
     sucesso + `expiresAt`/status calculado, igual ao
     `project.token.masked` de hoje).

- Só a Edge Function `publish-sweep`, rodando com a chave de serviço
  (nunca exposta ao painel), consegue ler o valor descriptografado via
  `vault.decrypted_secrets` na hora de publicar.

## Fluxo de publicação (`publish-sweep`)

Disparada por `pg_cron` a cada 5 minutos, ou chamada diretamente pelo
painel com um `content_item_id` específico (publicar agora, ignorando o
horário agendado).

1. Busca candidatos: `content_items` com `status = 'approved'`, join em
   `schedules` com `status = 'pending'` e `run_at <= now()` (ou o item
   específico passado, se chamada manual).
2. Para cada item:
   a. Descriptografa o token do Vault via `instagram_token_secret_id`.
   b. Gera uma URL assinada temporária (`createSignedUrl`, expira em
      minutos) para a imagem em `content_items.media_url` — o bucket é
      privado e a Graph API do Instagram precisa buscar a imagem por
      URL pública temporária.
   c. Chama a Graph API (cria o container de mídia, depois publica) —
      mesma sequência de dois passos que `publishContentToInstagram`
      já faz hoje, portada para Deno/`fetch`.
   d. Sucesso: `content_items.status = 'posted'`,
      `schedules.status = 'done'`.
      Falha: `content_items.status = 'error'`,
      `schedules.status = 'error'`, guarda a mensagem de erro na chave
      `publishError` já existente em `content_items.metadata` (jsonb
      curinga da Fase 1) — sem coluna nova.
3. Depois do lote de publicação, roda a checagem de alertas devidos
   (ver próxima seção).

Erro em um item nunca aborta os demais — mesmo padrão de isolamento
por item já usado na migração da Fase 1.

## Alertas por e-mail

Mesma lógica de `sendDueAlertEmails` hoje, portada para dentro da
mesma Edge Function (roda depois do lote de publicação, no mesmo
disparo do cron):

- Condições de alerta: token do Instagram vencendo (baseado em
  `instagram_token_expires_at`), conteúdo aguardando aprovação há mais
  tempo que o limite configurado — mesmas regras de hoje
  (`listSystemAlerts`).
- Cooldown de 24h por alerta, para não repetir o mesmo e-mail a cada
  disparo do cron. Estado guardado numa tabela nova:

```sql
create table alert_notifications (
  key text primary key,
  last_sent_at timestamptz not null
);
alter table alert_notifications enable row level security;
-- Sem nenhuma política: só a chave de serviço (que ignora RLS) acessa.
-- Não existe superfície de painel para essa tabela.
```

- Envio via **Resend** (já usado em outro skill deste projeto,
  `skills/resend/SKILL.md` — reaproveitar a mesma API key/padrão, sem
  introduzir um provedor de e-mail novo).

## Testes

- Testes unitários (Deno, `deno test`) para a lógica pura da Edge
  Function que não depende de rede: seleção de candidatos due,
  montagem do payload da Graph API, cálculo de cooldown de alerta —
  isolando essas funções da chamada HTTP real (injeção de um cliente
  fetch fake, mesmo padrão de dependency injection já usado na
  migração da Fase 1).
- Não testar a chamada real à Graph API do Instagram nem ao Resend em
  teste automatizado — validação manual (publicar um post de teste,
  conferir e-mail chegando) antes de considerar a fase pronta, mesma
  convenção da Fase 1 para o que só pode ser validado contra o serviço
  real.

## Fora de escopo / próximas fases

- Fase 3: painel na nuvem (React) falando direto com o Supabase para
  CRUD, e chamando as duas Edge Functions desta fase para as ações que
  precisam de segredo/servidor.
- Fase 4: agente local consumindo a fila `jobs` (geração de arte,
  WhatsApp) — inalterado por esta fase.
- Rotação/refresh automático do token do Instagram antes de vencer
  (hoje é manual, cola de novo quando avisa) — não entra nesta fase.
