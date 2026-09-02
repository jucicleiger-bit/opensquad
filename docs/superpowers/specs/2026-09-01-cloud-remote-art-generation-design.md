# Fase 4b: geração de conteúdo/arte remota

## Contexto

O painel na nuvem já cobre visão geral, empresa, ofertas/pilares,
referências, aprovação e calendário (Fase 3c) — mas gerar conteúdo novo
continua exclusivo do painel local (`content-central-app`), porque a
geração de imagem hoje é `OPENSQUAD_IMAGE_PROVIDER=codex-agent`: um
`codex exec` real, rodando na sessão Codex/ChatGPT autenticada do PC
(`src/content-central-server.js:generateAiImageWithCodexAgent`), sem custo
por imagem — não uma chamada de API paga que rodaria de qualquer lugar.

**Decisão confirmada com o operador**: continua no `codex-agent`. Isso
significa que gerar remotamente ainda depende do PC ligado com o servidor
rodando — o painel nuvem só *dispara* o pedido; quem executa continua
sendo o mesmo código local, inalterado.

A Fase 1 (`2026-08-30-cloud-split-schema-auth-design.md`) já previa
exatamente esse desenho — tabela `jobs` (`type: 'art_generation'`,
`payload jsonb`, `status`, `result_url`, `error_message`) + agente local
consumindo a fila — e ela **já existe** no schema
(`supabase/migrations/0001_init.sql`), com RLS pronta. Esta fase não cria
tabela nova; só passa a usar a que já está lá.

## Por que 2 saltos de job (preview → generate)

O wizard local de geração (`content-central-app`'s "Agenda e geração") tem
uma etapa de prévia editável (`previewContentSchedulePlan`) antes de gerar
de verdade: mostra o plano dia-a-dia (que assunto, que oferta, que
formato) pra o operador ajustar antes de comprometer chamadas de IA.

Essa prévia lê estado que **nunca foi migrado pro Supabase** — banco de
assuntos rotativo (`project.contentStrategy.topicIdeas`), estado de
rotação de oferta (`selectedOfferRotator`), aprendizado de segmento — só
os dados de configuração (empresa/ofertas/pilares/brand xray) foram
migrados na Fase 1/3b. Então mesmo a prévia só pode rodar no PC, não só a
geração final.

**Confirmado com o operador**: mantém os 2 saltos (fiel ao wizard local),
em vez de cortar a prévia editável.

## Escopo desta fase

1. Nova página no painel nuvem (`content-central-app`'s "Agenda e
   geração" wizard, portado): configura dias/formatos/regras/grupo de
   oferta/carrossel, dispara um job de prévia, mostra o plano retornado
   pra edição, aprova, dispara um job de geração.
2. Novo scheduler local (mesmo padrão de
   `startCloudWhatsAppPublishScheduler`, Fase 4a): poll na tabela `jobs`
   filtrando `type = 'art_generation'` e `status = 'pending'`, claim
   atômico, processa conforme `payload.mode`.
3. Sincronização automática do resultado: depois de gerar, o agente chama
   `migrateContentForProject` (já existe, `src/migrate-to-supabase.js`,
   idempotente via upsert em `content_id`) — sem passo manual.

Fora de escopo: qualquer outro tipo de geração (ad creatives, carrossel
avulso, datas especiais, adaptação de segment template para prospecção) —
só o fluxo principal "Agenda e geração"/`generateContentBatch`. Análises
de marca via IA (Raio-X, Briefing) continuam locais, como documentado na
Fase 3c. Trocar o provedor de imagem para uma API paga remota-nativa
(rejeitado pelo operador nesta rodada).

## Modelo de dados

Reaproveita a tabela `jobs` existente sem alteração de schema:

```
jobs
  id            uuid pk
  type          text     -- 'art_generation' (este payload) | 'whatsapp_send' (não usado ainda)
  payload       jsonb    -- ver formatos abaixo, mutado pelo agente ao concluir
  status        text     -- pending | running | done | error
  result_url    text     -- não usado por este tipo de job (sem resultado single-URL —
                          -- o resultado real são as linhas em content_items)
  error_message text
  created_at    timestamptz
  updated_at    timestamptz
```

**Payload de um job `mode: 'preview'`** (criado pelo painel):
```json
{
  "mode": "preview",
  "projectSlug": "acme-pizza",
  "days": 7,
  "startDate": "2026-09-05",
  "formats": [{ "channel": "instagram_feed", "postsPerDay": "1", "everyDays": "1", "startTime": "09:00", "intervalMinutes": "0" }],
  "contentRules": "texto livre",
  "groupIds": ["grp-1"],
  "offersOnly": false,
  "carouselsPerWeek": "1",
  "maxCarouselSlides": "6"
}
```
(mesmos campos de `GenerateContentInput`/`previewContentSchedulePlan`,
`content-central-app/src/api/client.ts:548-618` — reutilizados 1:1, sem
inventar um formato novo.)

Ao concluir, o agente faz `update({ status: 'done', payload: { ...original, plan: <PlannedContentSchedule> } })`
— o plano fica dentro do próprio `payload` (jsonb aceita qualquer
estrutura; não precisa de coluna nova).

**Payload de um job `mode: 'generate'`** (criado pelo painel após o
operador aprovar/editar o plano da prévia):
```json
{
  "mode": "generate",
  "projectSlug": "acme-pizza",
  "days": 7,
  "startDate": "2026-09-05",
  "formats": [ /* mesmo shape */ ],
  "contentRules": "texto livre",
  "groupIds": ["grp-1"],
  "offersOnly": false,
  "carouselsPerWeek": "1",
  "maxCarouselSlides": "6",
  "approvedPlan": { /* PlannedContentSchedule editado pelo operador */ }
}
```
Ao concluir: `status='done'`, `payload.result = { itemCount, syncedCount, errors: [] }`
(resumo, não os itens — os itens de verdade já estão em `content_items`
via o sync).

## Fluxos

### Novo scheduler local: `startCloudArtGenerationScheduler(targetDir)`

Mesmo padrão de `startCloudWhatsAppPublishScheduler` (Fase 4a):
- Só ativa com `OPENSQUAD_ENABLE_REAL_PUBLISHING === 'true'` e
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` configurados
  (`createSupabaseAdminClient` — mesmo catch-e-retorna-`null`).
- Intervalo próprio (`OPENSQUAD_JOB_CHECK_INTERVAL_MS`, default 15000 —
  mais curto que o de publish, porque aqui tem um humano esperando a
  prévia aparecer na tela, não um cron de fundo).
- Guarda `running` contra sobreposição — uma geração real pode levar
  minutos (várias chamadas `codex-agent` em sequência).
- A cada tick, `runDueArtGenerationJobSweep(targetDir, client)`:
  1. Busca `jobs` com `type='art_generation'`, `status='pending'`,
     ordenado por `created_at` — processa **um por vez**, não em
     paralelo (mesma razão do local: `codex exec` é uma sessão só,
     concorrência real geraria confusão de contexto entre gerações).
  2. Reclama atômico: `update({status:'running'}).eq('id', job.id).eq('status','pending')`
     — mesmo padrão dos outros sweeps.
  3. Resolve `targetDir`'s `projectId` local a partir de
     `payload.projectSlug` (mesmo `getCentralPaths`/`loadProject` de
     sempre).
  4. `payload.mode === 'preview'`:
     - Chama `previewContentSchedulePlan(projectId, { days, startDate,
       formats, groupIds, offersOnly, topicIdeaGenerator }, targetDir)`
       — **inalterada**.
     - `update({ status: 'done', payload: { ...payload, plan } })`.
  5. `payload.mode === 'generate'`:
     - Chama `generateContentBatch(projectId, { days, startDate, channel,
       contentRules, groupIds, offersOnly, approvedPlan,
       topicIdeaGenerator }, targetDir)` **inalterada** — mesmo loop por
       canal que o handler HTTP `/generate` já faz quando `body.formats`
       não vem preenchido; ou `generateContentSchedulePlan` quando vem
       (mesma ramificação condicional do handler local, replicada aqui).
     - Ao contrário do handler HTTP local (que dispara
       `enqueueBatchImageGeneration` fire-and-forget e devolve o batch
       na hora, deixando o front local fazer polling à parte), o job
       chama **diretamente e com `await`** a mesma função que
       `enqueueBatchImageGeneration` chama por baixo:
       `await enrichBatchItemsWithRealImages(batch, project, projectId,
       imageOptions, paths)` (já exportada, inalterada) — o job só marca
       `done` depois que as imagens de verdade terminaram, porque o
       painel nuvem não tem um jeito de fazer polling num batch local do
       jeito que o front local faz.
     - Depois de `enrichBatchItemsWithRealImages` resolver: chama
       `migrateContentForProject(targetDir, project.slug, client)`
       (já existe, `src/migrate-to-supabase.js`, **inalterada**) — sobe
       mídia + upsert idempotente em `content_items`/`schedules`. Como já
       é upsert por `content_id`, rodar de novo depois de cada geração
       nunca duplica nem quando o operador também gera localmente entre
       uma rodada remota e outra.
     - `update({ status: 'done', payload: { ...payload, result: {
       itemCount, syncedCount: result.migrated, errors: result.errors }
       } })`.
  6. Erro em qualquer etapa: `update({ status: 'error', error_message:
     err.message })` no job — não mexe em `content_items` (nada foi
     comprometido lá se a geração falhou antes do sync).
- Chamada de inicialização (`content-central-server.js`, junto das outras
  4): `const cloudArtGenerationSchedulerTimer = startCloudArtGenerationScheduler(targetDir);`.

### Painel nuvem: página "Gerar conteúdo"

Nova rota `cloud-panel-app/src/pages/GenerateContent.tsx`
(`/projects/:projectId/gerar`), nav ao lado de Calendário (grupo
"Conteúdo", label "Gerar conteúdo" — evita confundir com o Calendário já
existente, que só mostra/reagenda o que já foi gerado).

1. Formulário: dias, data inicial, formatos por canal (canal, posts/dia,
   intervalo de dias, horário inicial, intervalo em minutos — mesmos
   campos de `GenerateFormatInput`), regras de conteúdo (texto livre),
   grupo de oferta (dropdown, lê `content_strategy.offerGroups` — já no
   Supabase), `offersOnly` (checkbox), carrossel por semana + máx. de
   slides.
2. Ao enviar: `insert` em `jobs` (`type:'art_generation',
   payload:{mode:'preview', ...}`), guarda o `id` retornado, entra em
   modo de espera (poll a cada 3s no `jobs.status` desse id).
3. `status='done'`: mostra `payload.plan` — lista dia-a-dia, cada slot
   com assunto/motivo editável (mesmos campos que
   `buildApprovedPlanOverrideMap` já sabe interpretar:
   `{id, label, reason}` por slot) — reaproveita a leitura, não a escrita:
   o painel só monta o objeto, quem aplica a edição continua sendo o
   agente local via `generateContentBatch`'s `approvedPlan`.
4. `status='error'`: mostra `error_message`, botão pra tentar de novo
   (novo job de prévia).
5. Ao aprovar: `insert` em `jobs` (`mode:'generate'`, mesmos campos do
   formulário + `approvedPlan` = o plano editado), volta a fazer poll.
6. `status='done'`: mostra o resumo (`payload.result`), link pra
   Aguardando aprovação.

## Testes

- `runDueArtGenerationJobSweep` testado com `node --test` e um cliente
  Supabase fake (mesmo padrão de `tests/cloud-whatsapp-publish.test.js`)
  — `previewContentSchedulePlan`, `generateContentBatch`,
  `enrichBatchItemsWithRealImages`, e `migrateContentForProject` todos
  injetáveis via `options` (mesmo padrão `whatsappPublisher` já
  estabelecido), sem chamada real a `codex exec`/Supabase em teste.
- Casos: job de prévia sucesso (plano gravado, status done); job de
  geração sucesso (batch gerado, imagens enriquecidas, sync chamado,
  resultado gravado); erro em qualquer etapa (status error, mensagem
  clara, nada parcialmente sincronizado); job já reclamado por outro
  sweep (pulado); dois jobs pendentes ao mesmo tempo (processa um por
  vez, na ordem de `created_at`).

## Fora de escopo / próximas fases

- Portar os outros geradores (ad creatives, carrossel avulso, datas
  especiais, adaptação de segment template) para o painel nuvem —
  decidir caso a caso depois que este fluxo principal estiver rodando de
  verdade.
- Trocar `codex-agent` por uma API paga para permitir geração com o PC
  desligado — rejeitado nesta rodada, revisar se o custo por imagem via
  API cair ou o uso justificar.
- Notificação (e-mail/push) quando um job de geração remoto terminar —
  hoje o operador precisa deixar a aba aberta fazendo polling.
