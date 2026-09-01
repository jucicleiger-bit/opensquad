# Fase 4a: publicação remota de WhatsApp Status

## Contexto

WhatsApp Status já publica de verdade hoje, mas só para conteúdo
aprovado/agendado **localmente**: `publishContentToWhatsAppStatus`
(`src/content-central-server.js:4842`) chama a API WAHA
(`localhost:3001` ou onde `OPENSQUAD_WAHA_ADMIN_URL` apontar), usando a
sessão WAHA daquele projeto (`project.whatsapp.sessionName`, guardada só
em `project.json`, nunca migrada). O scheduler que dispara isso
(`startWhatsAppPublishScheduler`, linha 4909) só olha arquivos locais —
nunca soube que o Supabase existe.

O painel na nuvem já deixa aprovar conteúdo WhatsApp Status
(`Approval.tsx`, canal `whatsapp_status` já migrado desde a Fase 1) — só
que isso não publica nada de verdade, porque nada consome esse estado.

**Achado que precisa entrar no escopo**: o Edge Function `publish-sweep`
(Fase 2) hoje busca **qualquer** item `approved`+`pending` sem filtrar
canal, e chama `publishToMeta` incondicionalmente
(`supabase/functions/publish-sweep/index.ts:44-51`,
`supabase/functions/_shared/meta-publish.js:107`). Um WhatsApp Status
aprovado pela nuvem já está sendo capturado a cada ciclo do cron e
marcado como erro (`Unsupported publish channel: whatsapp_status`) antes
que qualquer scheduler WhatsApp-consciente chegue nele. Isso precisa ser
corrigido primeiro, ou o resto desta fase nunca vê um item `pending` de
verdade.

## Escopo desta fase

1. **Excluir `whatsapp_status` do `publish-sweep`** — esse Edge Function
   continua só para Instagram/Facebook.
2. **Novo scheduler local** em `src/content-central-server.js`, mesmo
   padrão de `startWhatsAppPublishScheduler`/`startPublishScheduler`
   (guarda de `OPENSQUAD_ENABLE_REAL_PUBLISHING`, `running` boolean contra
   sobreposição, próprio intervalo), que busca itens `whatsapp_status`
   aprovados e na hora **no Supabase**, reclama atômico, publica via
   `publishContentToWhatsAppStatus` (sem mudar nada nela), grava resultado
   de volta no Supabase.
3. Sem mudança em `publishContentToWhatsAppStatus` nem no fluxo 100% local
   existente — ele continua igual, sem saber que isso existe.

Fora de escopo: geração de conteúdo (Fase 4b, arte); qualquer UI nova (a
nuvem já tem Aprovação/Calendário funcionando); sincronizar conteúdo novo
gerado localmente de volta pro Supabase automaticamente (continua manual,
via `migrate-to-supabase.js`, mesmo estado de hoje).

## Modelo de dados

Nenhuma tabela nova. Reaproveita `content_items`/`schedules`/`projects`
exatamente como estão. Convenção de status espelha `publish-sweep`
literalmente:

- Sucesso: `content_items.status = 'posted'`, `metadata` faz merge com
  `{ publishResult }` (nunca substitui o objeto inteiro — é o
  `project.json` inteiro migrado na Fase 1). `schedules.status = 'done'`.
- Erro: `content_items.status = 'error'`, `metadata` faz merge com
  `{ publishError: mensagem }`. `schedules.status = 'error'`.
- Reclamado mas ainda publicando: `schedules.status = 'running'`
  (atômico: `update({status:'running'}).eq('id',id).eq('status','pending')`,
  se não veio linha de volta, outro sweep já pegou).

## Fluxos

### Fix no `publish-sweep`

Em `runPublishPass`, a query de itens devidos ganha
`.neq('channel', 'whatsapp_status')` — único canal a excluir hoje (mesmo
`WHATSAPP_CHANNELS` local só tem esse valor). Nada mais muda nesse
arquivo.

### Novo scheduler local: `startCloudWhatsAppPublishScheduler(targetDir)`

- Só ativa se `OPENSQUAD_ENABLE_REAL_PUBLISHING === 'true'` **e**
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` estiverem configurados
  (createSupabaseAdminClient lança erro se faltar — checa antes,
  retorna `null` sem crashar o servidor pra quem não configurou nuvem).
- Mesmo intervalo padrão de `OPENSQUAD_PUBLISH_CHECK_INTERVAL_MS`
  (180000ms), mesma guarda `running` contra sobreposição.
- A cada tick, `runDueCloudWhatsAppPublishSweep(targetDir, client)`:
  1. Busca `content_items` (`id, project_id, channel, copy, media_url,
     metadata, schedules!inner(id, run_at, status)`) com
     `channel = 'whatsapp_status'`, `status = 'approved'`,
     `schedules.status = 'pending'`, `schedules.run_at <= agora` — mesmo
     shape de query do `publish-sweep`, só trocando o filtro de canal.
  2. Pra cada item: reclama atômico (mesma lógica exata do
     `publish-sweep`: `update({status:'running'}).eq('id',schedule.id)
     .eq('status','pending').select('id')`; se `!claimed?.length`,
     pula — outro sweep levou).
  3. Busca `projects` (`id, slug`) por `item.project_id`.
  4. Lê `project.json` local pelo slug (mesmo `getCentralPaths` +
     `readJsonIfExists` de sempre) pra pegar
     `project.whatsapp?.sessionName`. Sem sessão configurada → erro
     (mesma mensagem que `publishContentToWhatsAppStatus` já lançaria
     internamente se `project.whatsapp` estivesse vazio — mas aqui
     falha mais cedo, antes de gerar signed URL à toa).
  5. Signed URL de `item.media_url` no bucket `content-media`, 300s TTL
     (mesmo padrão do `publish-sweep` e de toda tela do painel nuvem).
  6. Chama `publishContentToWhatsAppStatus({ content: { caption: { text:
     item.copy || '' }, publish: { mediaUrl: signedUrl } }, project: {
     projectId: slug, whatsapp: { sessionName } } }, targetDir)` — **sem
     alterar essa função**, só montando o formato que ela já espera.
  7. Sucesso: grava `content_items.status='posted'`,
     `metadata: {...item.metadata, publishResult}`,
     `schedules.status='done'`.
  8. Erro: grava `content_items.status='error'`,
     `metadata: {...item.metadata, publishError: err.message}`,
     `schedules.status='error'`. Erro ao gravar isso vira entrada em
     `result.errors`, não trava o sweep inteiro (mesma disciplina do
     `publish-sweep`).
- Chamada de inicialização (`content-central-server.js`, junto de
  `startWhatsAppPublishScheduler`): nova linha
  `const cloudWhatsAppPublishSchedulerTimer =
  startCloudWhatsAppPublishScheduler(targetDir);`.

## Testes

- `runDueCloudWhatsAppPublishSweep` testado com `node --test` e um cliente
  Supabase fake (mesmo padrão de mock usado em
  `tests/migrate-to-supabase.test.js`) + um `publishContentToWhatsAppStatus`
  injetável (parâmetro de opções, como `runDuePublishSweep` local já faz
  com `metaPublisher`) — sem chamada real a WAHA/Supabase em teste.
- Casos: sucesso completo (status/metadata corretos); erro de publicação
  (status/metadata de erro corretos, sweep não trava); item já reclamado
  por outro sweep (pulado, sem chamar o publicador); sessão WAHA não
  configurada localmente (erro claro, sem gerar signed URL à toa).
- Fix do `publish-sweep`: teste Deno/Node existente (se houver) ganha um
  caso confirmando que um item `whatsapp_status` devido não aparece mais
  no resultado da query.

## Fora de escopo / próximas fases

- Fase 4b: geração de arte remota (a peça mais complexa, decidida como
  segunda etapa desde o início da Fase 4).
- Sincronização automática de conteúdo novo local → Supabase.
- Qualquer UI nova no painel — Aprovação/Calendário já bastam pra esse
  fluxo.
