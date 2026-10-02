# Relatório mensal do cliente — design

Data: 2026-10-02
Branch: `relatorio-mensal` (isolado; nada vai para o master sem pedido explícito)

## Problema

O catálogo promete "relatório mensal" no plano Atacado e "acompanhamento
mensal de resultados" no Tráfego Pago, e o sistema não produz nenhum dos
dois. Nenhuma métrica do Instagram é coletada: nenhum token tem
`instagram_manage_insights` e não existe leitura de seguidores, curtidas ou
visualizações em lugar nenhum do código.

Para um serviço por assinatura de valor baixo, o cliente precisa ver o que
recebeu e o que isso gerou. As ferramentas de encarte em que o lojista faz
sozinho (EncarteFácil, Ofertemais) não publicam nem medem — o relatório é
parte do que separa a King delas.

## Decisões tomadas com o operador (2026-10-02)

- **Escopo:** montar o relatório. O envio ao cliente fica fora; o operador
  decide depois como enviar.
- **Blocos:** entregas do mês, seguidores e crescimento, alcance e
  visualizações, curtidas e comentários.
- **Formato:** páginas de celular (verticais), salvas em PDF pelo navegador.
- **Galeria:** destaques por tipo — stories mostram os 6 mais vistos; posts
  de feed e encartes aparecem todos.
- **Funcionamento:** os números são coletados pelo servidor do painel e
  guardados em arquivo; o relatório é montado na hora em que é aberto. Um
  aviso no painel diz quando o relatório do mês anterior está pronto.

Referência visual aprovada:
`.superpowers/brainstorm/563-1790959931/content/relatorio-completo.html`
(fora do git; fica nesta máquina).

## Comportamento desejado

### O relatório

Um relatório é sempre de um projeto e de um mês (`YYYY-MM`). Páginas, nesta
ordem:

1. **Capa.** "Relatório mensal", o mês por extenso, logo, nome e @ do
   cliente, o total de publicações do mês em destaque e um selo por canal
   ("43 stories", "4 posts no feed").
2. **Quem viu a sua marca.** Visualizações do perfil no mês, contas
   alcançadas e seguidores (total no fim do mês e quanto cresceu).
3. **Stories.** "43 no mês · os 6 mais vistos", grade 3×2 com o número de
   visualizações sobre cada arte e "e mais 37 stories".
4. **Posts no feed.** "4 no mês · 96 curtidas · 11 comentários", todos os
   posts em grade 2×2 (4 por página, quantas páginas forem necessárias),
   ordenados por curtidas, com as curtidas sobre cada arte.
5. **Encartes.** "2 no mês", todos os encartes em grade 3×2 (6 por página).

A assinatura "Preparado por {agência} · {telefone}" fica no rodapé da última
página.

Regras de contagem:

- **Publicação** é um item com `publish.publishedAt` preenchido. Ele pertence
  ao mês em que foi publicado, no horário local do servidor — não ao mês de
  `scheduledDate`, que pode estar errado ou ser de outro mês quando a peça é
  publicada à mão.
- O total da capa conta cada item publicado, em todos os canais. Os selos
  mostram só os canais com pelo menos uma publicação: "stories", "posts no
  feed", "Reels", "Status do WhatsApp", "no Facebook" (feed e story do
  Facebook somados).
- Na galeria, a mesma arte publicada em vários canais aparece uma vez: os
  itens são agrupados por `creativeGroupKey` (item sem chave é um grupo
  sozinho).
- **Encarte** é o grupo cujo item tem `contentTopic.source === 'flyer'`.
  Encartes do mesmo `batchId` formam um grupo só.
- Dos demais grupos, vai para **Stories** o de formato vertical e para
  **Posts no feed** o de formato feed, segundo
  `creativeShapeGroupForChannel` (que já existe). Reels e Status do
  WhatsApp são verticais, então entram na página Stories. Grupo sem formato
  conhecido entra só na contagem da capa.
- As visualizações de um grupo são o maior valor entre os itens dele que
  têm métrica. As curtidas e os comentários de um grupo de feed vêm do item
  de `instagram_feed`.
- A arte mostrada para um grupo é a do item com mais visualizações; sem
  métrica, a do primeiro item por data e hora de publicação. Nos encartes,
  o item vertical tem preferência, porque a grade deles é vertical.
- As miniaturas são cortadas em 9:16 nas páginas Stories e Encartes e em
  4:5 na página Posts no feed, os formatos em que as artes já são geradas.

O que acontece quando falta um número:

| Situação | Resultado |
|---|---|
| Token sem `instagram_manage_insights` | Página 2 mostra só seguidores. Stories mostram os 6 mais recentes, sem número sobre a arte e sem "os 6 mais vistos". |
| Visualizações do perfil ou contas alcançadas ausentes ou zeradas | O número não aparece. |
| Sem nenhuma leitura de seguidores até o fim do mês | O bloco de seguidores não aparece. Se a página 2 ficar vazia, ela não entra. |
| Sem leitura de seguidores anterior ao mês | Aparece o total, sem a variação. |
| Variação de seguidores zero ou negativa | Aparece o total, sem a variação. |
| Curtidas ou comentários desconhecidos | Somem do subtítulo e de cima da arte; os posts continuam aparecendo, do mais recente para o mais antigo. |
| Mês sem post de feed, ou sem encarte | A página daquele tipo não entra. |
| Mês sem nenhuma publicação | Página única: "Nenhuma publicação em {mês}." |
| Mês corrente | A capa mostra "Parcial até DD/MM" sob o mês, e a legenda dos seguidores diz "em DD/MM" no lugar de "no fim de {mês}". |

### Aba "Relatórios"

Novo item no menu do projeto, depois de "Calendário": **Relatórios**
(`/projects/:projectId/relatorios`). Lista os meses que tiveram ao menos uma
publicação, do mais recente para o mais antigo. Cada linha mostra o mês, a
quantidade de publicações, o estado e o botão "Abrir relatório", que abre a
página do relatório em outra aba.

Estados:

- **Parcial** — é o mês corrente.
- **Fechando** — é o mês anterior e hoje é dia 1 ou 2. A Meta entrega
  números com até 48 horas de atraso.
- **Pronto** — os demais.

Quando o token do projeto não tem `instagram_manage_insights`, a aba mostra
no topo: "Este token não tem a permissão de alcance. O relatório sai sem
visualizações. Veja Conta e token."

### Página do relatório

`GET /api/projects/:projectId/report?month=YYYY-MM` devolve uma página HTML
independente do painel (como `/briefing` e `/prospect-mockup` já fazem).

- As páginas do relatório têm 360×640 px e aparecem empilhadas numa coluna
  centralizada.
- Uma barra no topo, só na tela, tem o nome do cliente, o mês e o botão
  "Salvar PDF", que chama a impressão do navegador.
- Na impressão: `@page { size: 360px 640px; margin: 0 }`, uma página do
  relatório por página do PDF, barra escondida, cores preservadas
  (`print-color-adjust: exact`).
- As artes vêm da rota de miniatura que já existe
  (`/api/projects/:id/assets-preview/...`), para o PDF não carregar PNGs de
  2 a 3 MB.
- `month` ausente ou fora do formato `YYYY-MM` responde 400.

Identidade visual (a da King, a mesma do modelo aprovado): faixa preta
`#0b0b0c` no topo de cada página com o logo da agência; fundo branco; texto
`#111`; cinza `#6b6b6b` para legendas; amarelo `#FFD100` para o destaque da
palavra "publicações" e para o selo de crescimento. Fonte do sistema, pesos
800 nos números e títulos. O logo e o nome da agência vêm de
`getCommercialAgency`; o logo do cliente vem de
`project.brandIdentity.logoPath` e, quando não existe, vira a inicial do
nome num círculo.

### Aviso "relatório pronto"

A partir do dia 3 de cada mês, todo projeto que teve publicação no mês
anterior ganha um aviso no painel inicial: "Relatório de setembro pronto."

- O aviso tem dois botões: **Abrir** (leva à aba Relatórios do projeto) e
  **Fechar** (o botão de fechar alertas que já existe).
- O aviso fica até ser fechado ou até o mês virar. O do mês seguinte é outro
  aviso.
- O e-mail desse aviso é enviado uma vez só, sem repetir a cada 24 horas
  como os outros alertas.

### Conta e token

Quando o projeto tem token configurado e `token.permissions` não inclui
`instagram_manage_insights`, a aba mostra: "Este token não tem a permissão
instagram_manage_insights. O relatório mensal sai sem visualizações e
alcance. Para incluir, gere o token de novo marcando essa permissão."

## Design técnico

### Módulos

O código novo vai em dois arquivos novos, em vez de crescer
`src/content-central.js` (10,7 mil linhas) e `src/content-central-server.js`
(6,3 mil linhas):

- `src/content-central-metrics.js` — lê a Graph API e grava o arquivo de
  métricas.
- `src/content-central-report.js` — monta os dados do relatório e o HTML.

O servidor só ganha as duas rotas e a ligação do agendador.
`content-central.js` passa a exportar `readJson` e `writeJson` (hoje
privados) para o coletor reaproveitar a gravação atômica que já trata o
`EPERM` do Windows, e ganha quatro funções pequenas de data em horário local
(`localDateKey`, `localMonthKey`, `previousMonthKey`, `monthNamePt`), usadas
pelo coletor, pelo relatório e pelo aviso.

### Arquivo de métricas

Um arquivo por projeto, `projects/<id>/metrics/instagram.json`, com novo
caminho `metricsPath` em `getCentralPaths`:

```json
{
  "schemaVersion": 1,
  "followers": { "2026-10-02": 1284 },
  "media": {
    "18086454155163927": { "kind": "story", "views": 412, "reach": 380, "replies": 2, "updatedAt": "2026-10-02T15:00:00.000Z" },
    "18113712817940871": { "kind": "feed", "likes": 31, "comments": 4, "views": 520, "reach": 410, "updatedAt": "2026-10-02T12:00:00.000Z" }
  },
  "months": {
    "2026-09": { "views": 9860, "reach": 2140, "updatedAt": "2026-10-03T12:00:00.000Z" }
  },
  "lastDailyRun": "2026-10-02"
}
```

- A chave de `media` é o ID da mídia no Instagram, o mesmo valor que a
  publicação já guarda em `publish.metaMediaId`. O relatório cruza os dois.
- `kind` é `story`, `feed` ou `reels`.
- Só o coletor grava esse arquivo. As métricas não vão para dentro dos
  arquivos de item: assim a coleta não disputa trava com geração e
  aprovação e não tem como estragar um item.
- Datas de `followers` e `lastDailyRun` são datas locais do servidor
  (`YYYY-MM-DD`).

### Coleta

`collectProjectMetrics(projectId, targetDir, { fetchImpl, now })`, com
`fetch` e relógio injetáveis, no mesmo padrão de `validateMetaToken`. Usa
`https://graph.facebook.com/v25.0`, a versão já usada no resto do código.

1. Carrega o projeto. Sem `instagram.instagramUserId` ou sem token
   (`readProjectToken`), não faz nada.
2. `insights = project.token.permissions` inclui `instagram_manage_insights`.
3. **Stories, a cada execução, só com `insights`:**
   `GET /{ig-user-id}/stories?fields=id,timestamp` lista os stories no ar.
   Para cada um, `GET /{id}/insights?metric=views,reach,replies` e grava
   `media[id]` com `kind: "story"`. A Meta responde erro de código 10 para
   story com menos de 5 visualizações; esse story é pulado em silêncio.
   Listar os stories direto da conta dispensa esperar a sincronização do
   resultado de publicação que vem da gaveta.
4. **Bloco diário, quando `lastDailyRun` não é hoje:**
   - Seguidores: `GET /{ig-user-id}?fields=followers_count` grava
     `followers[hoje]`. Funciona com os tokens atuais.
   - Feed e Reels:
     `GET /{ig-user-id}/media?fields=id,media_product_type,like_count,comments_count,timestamp&limit=50`.
     Para cada mídia `FEED` ou `REELS` cujo `timestamp` cai, em horário
     local, num mês aberto, grava `likes` e `comments`. Com `insights`,
     soma `GET /{id}/insights?metric=views,reach`. Sem paginação: 50 mídias
     cobrem com folga um mês de feed e Reels (o maior plano tem 12 posts de
     feed por mês).
   - Conta, só com `insights`, para cada mês aberto:
     `GET /{ig-user-id}/insights?metric=views&period=day&metric_type=total_value&since=…&until=…`
     e o mesmo com `metric=reach`. A Graph API aceita no máximo 30 dias
     entre `since` e `until`. `views` é somável: o mês é pedido em janelas
     de até 30 dias e os totais são somados. `reach` é de contas únicas e
     não pode ser somado: é pedido uma vez, para os últimos 30 dias do mês
     (ou do mês até hoje).
   - Grava `lastDailyRun = hoje` só quando a leitura de seguidores deu
     certo. Ela serve de sinal de que a Meta está acessível: se falhar, o
     bloco diário roda de novo na próxima execução, em vez de esperar o dia
     seguinte.
5. Grava o arquivo uma vez por execução.

**Meses abertos:** o mês corrente, e o mês anterior enquanto hoje for dia 3
ou antes. Depois disso um mês fechado nunca mais é regravado, então o
relatório dele mostra sempre os mesmos números.

Uma falha da Graph API em uma chamada é registrada em log e não interrompe
as demais. O formato exato da resposta de `metric_type=total_value` e o
limite de 30 dias foram lidos da documentação; os dois são conferidos com um
token real na validação.

`collectAllProjectsMetrics(targetDir, options)` percorre os projetos em
sequência; a falha de um projeto (token vencido, por exemplo) não impede os
outros.

`startInstagramMetricsScheduler(targetDir)` no servidor roda a coleta ao
iniciar e depois a cada `OPENSQUAD_METRICS_CHECK_INTERVAL_MS` (padrão
3600000, uma hora), com a mesma trava `running` dos outros agendadores para
duas execuções não se sobreporem. `OPENSQUAD_ENABLE_METRICS=false` desliga.
Fica ligado por padrão porque só lê dados da Meta; não publica nada. As duas
variáveis entram no `.env.example`.

### Montagem do relatório

Em `src/content-central-report.js`:

- `buildMonthlyReport({ project, agency, items, metrics, month, now })` —
  função pura. Recebe os itens de `listProjectContent`, o conteúdo do
  arquivo de métricas e devolve um objeto com tudo que a página mostra:
  totais e selos por canal, `audience` (`views`, `reach`), `followers`
  (`total`, `delta`), `stories` (`count`, `measured`, `top`, `more`), `feed`
  (`count`, `likes`, `comments`, `items`), `flyers` (`count`, `items`),
  `partial` e `partialUntil`. Campos sem dado ficam `null`.
- `listReportMonths({ items, now })` — meses com publicação, quantidade e
  estado (`parcial`, `fechando`, `pronto`).
- `renderReportPage(report)` — devolve o HTML. Números no formato
  brasileiro (`9.860`).

Regras dos seguidores: `total` é a última leitura com data até o último dia
do mês; a base é a última leitura com data anterior ao primeiro dia do mês;
`delta = total − base`, e só é devolvido quando existe base e o resultado é
maior que zero.

### Rotas

- `GET /api/projects/:projectId/reports` →
  `{ months: [{ month, label, publications, status }], insightsEnabled }`.
- `GET /api/projects/:projectId/report?month=YYYY-MM` → HTML.

As duas só leem.

### Aviso

- `listSystemAlerts` aceita `options.now` e, para cada projeto, quando o dia
  local é 3 ou mais e o mês anterior teve publicação, inclui
  `{ type: 'report_ready', projectId, projectName, month, message }`.
- `alertNotificationKey` inclui o mês quando o alerta tem `month`:
  `report_ready:<projectId>:<YYYY-MM>`.
- `sendDueAlertEmails` não reenvia `report_ready` enquanto a chave estiver
  registrada como enviada. Assunto, no formato dos outros alertas:
  "📊 [Opensquad] {projeto} — relatório de {mês} pronto".
- O fechamento do aviso usa `dismissSystemAlert`, que ainda está em trabalho
  não commitado no master (ver Pré-requisito).

### Frontend (`content-central-app`)

- `src/api/client.ts`: `SystemAlert.type` ganha `"report_ready"` e o campo
  `month?: string`; novas funções `getReports(projectId)` e
  `reportUrl(projectId, month)`, esta no modelo de `prospectMockupUrl`.
- `src/pages/workspace/Reports.tsx`: a aba. Rota `relatorios` em `App.tsx` e
  item "Relatórios" no grupo "Conteúdo" de `ProjectWorkspaceLayout.tsx`.
- `src/pages/Dashboard.tsx`: para `report_ready`, o botão de ação se chama
  "Abrir" e leva a `/projects/:projectId/relatorios`.
- `src/pages/workspace/Account.tsx`: o aviso da permissão.

O painel cloud (`cloud-panel-app`) não muda.

## Limites conhecidos

- **A coleta roda no PC do operador.** Se o servidor do painel ficar
  desligado durante as 24 horas de um story, esse story fica sem número; o
  relatório conta o story na capa e não o mostra entre os mais vistos. Se
  isso pesar, a coleta pode ir para um cron no Supabase.
- **O número de um story é o da última leitura antes de ele expirar.** Com
  o servidor desligado nas últimas horas, o valor fica menor que o real.
- **Stories com menos de 5 visualizações não têm número.** Limite da Meta.
- **"Contas alcançadas" cobre os últimos 30 dias do mês** em meses de 31
  dias. Limite da Meta.
- **O crescimento de seguidores só aparece** a partir do primeiro mês que
  tem uma leitura anterior a ele.
- **Só o Instagram tem número.** Status do WhatsApp e Facebook entram na
  contagem de publicações, sem visualização.
- **Queda de seguidores não aparece no relatório**, só o total. É uma
  escolha de tom; o número fica no arquivo de métricas.

## Fora de escopo

- Envio ao cliente por WhatsApp ou e-mail.
- PDF gerado e salvo pelo servidor; cada página como imagem solta.
- Métricas de Status do WhatsApp, de Facebook e de anúncios pagos.
- Painel cloud.
- Gráfico de evolução por semana ou por dia.
- Opção por cliente para esconder curtidas e comentários.
- Comparação com o mês anterior, além do crescimento de seguidores.

## Testes

Backend (`node --test`), em `tests/content-central-metrics.test.js` e
`tests/content-central-report.test.js`:

1. Coleta com `fetch` falso: grava seguidores uma vez por dia e não repete
   o bloco diário no mesmo dia.
2. Coleta: grava visualizações dos stories no ar; pula o story que responde
   erro de código 10; uma chamada com erro não impede as outras.
3. Coleta: sem `instagram_manage_insights`, nenhuma URL de `/insights` nem
   de `/stories` é chamada, e seguidores e curtidas são gravados mesmo
   assim.
4. Coleta: mês fechado é regravado até o dia 3 e não é mais tocado a partir
   do dia 4.
5. Coleta: `views` de um mês de 31 dias soma duas janelas; `reach` usa uma
   janela de 30 dias.
6. `collectAllProjectsMetrics`: a falha de um projeto não impede o seguinte;
   projeto sem token é pulado sem chamada de rede.
7. Relatório: conta publicações pelo mês local de `publishedAt`, ignorando
   `scheduledDate`; selos só dos canais com publicação.
8. Relatório: agrupa por `creativeGroupKey`; separa encartes, stories e
   feed.
9. Relatório: stories — os 6 de mais visualizações e o "e mais N"; sem
   métrica, os 6 mais recentes e `measured: false`.
10. Relatório: feed ordenado por curtidas, com as somas; curtidas
    desconhecidas viram `null`.
11. Relatório: seguidores — total e variação; sem base, variação `null`;
    variação zero ou negativa, `null`.
12. Relatório: mês corrente marca `partial` e `partialUntil`.
13. `listReportMonths`: `parcial`, `fechando` (dias 1 e 2) e `pronto` (dia
    3 em diante).
14. `renderReportPage`: contém nome do cliente, mês por extenso e total;
    não contém a página de encartes quando não há encarte; números no
    formato brasileiro.
15. Rotas: `/report` responde HTML para mês válido e 400 para mês inválido;
    `/reports` devolve os meses e `insightsEnabled`.
16. Aviso: `report_ready` aparece do dia 3 em diante e não antes; a chave
    inclui o mês; o e-mail sai uma vez só.

Frontend (`vitest`):

17. `Reports.tsx`: lista os meses com estado e link; mostra o aviso da
    permissão quando `insightsEnabled` é falso.
18. `Dashboard.tsx`: alerta `report_ready` mostra "Abrir" apontando para a
    aba Relatórios.
19. `Account.tsx`: mostra o aviso quando falta a permissão e não mostra
    quando ela existe.

Verificação completa: `npm test`, `npm run lint` e, em
`content-central-app`, `npm run test` e `npm run build` (o `tsc --noEmit`
sozinho não confere nada neste projeto).

Validação real, com o operador:

- Gerar de novo o token da King marcando `instagram_manage_insights`, rodar
  uma coleta e conferir no arquivo de métricas: seguidores, visualizações
  dos stories no ar e os totais do mês. É aqui que o formato da resposta e
  o limite de 30 dias são confirmados, e também que o ID devolvido por
  `/stories` é o mesmo que a publicação guarda em `publish.metaMediaId`.
- Abrir o relatório de agosto da Hygi (sem métricas: tem que sair no modo
  reduzido) e comparar com o modelo aprovado.
- Salvar em PDF e conferir que cada página do relatório é uma página do
  PDF, no tamanho de celular.

## Pré-requisito

O botão "Fechar" dos alertas (`dismissSystemAlert`, a rota
`POST /api/alerts/dismiss` e a parte do Dashboard) está em 7 arquivos
modificados e não commitados no master. O aviso do relatório depende dele.
O operador commita esse trabalho antes de a branch `relatorio-mensal` ser
criada, para a branch já nascer com ele.

## Isolamento

- Todo código, teste e este spec vivem na branch `relatorio-mensal`.
- Nenhum commit, merge ou push no master sem pedido explícito.
- A coleta só lê dados da Meta; nada neste trabalho publica ou envia
  mensagem.
