# Social Selling Instagram — 24h

## Contexto

Hoje existe um único canal de prospecção: `ComercialProspeccao.tsx`, um CRUD
manual (`squads`/nada envolvido) onde o usuário cadastra empresa por empresa
à mão e acompanha um funil (`nao_contatado → contatado → respondeu →
fechou`). Esse fluxo continua existindo, sem nenhuma mudança.

Este design cria um **segundo canal, independente**: um squad Opensquad que
descobre empresas no Instagram sozinho e conduz uma sequência de social
selling (like → comentário → follow → DM) até o horário comercial permitir
o próximo passo — rodando o dia inteiro, mas só agindo (curtir/comentar/
seguir/mandar DM) dentro de janela comercial e com ritmo humano, pra não
levantar suspeita de automação nem arriscar ban da conta.

## Por que não é "só um squad Opensquad"

Squads existentes (`atendimento-vendas-whatsapp`, etc.) geram documentos sob
demanda quando o usuário roda `/opensquad run` com o Claude Code aberto. Isso
não é 24h — precisa de alguém sentado na sessão. O Playwright que o projeto
já tem (`.mcp.json`) também só funciona preso a uma sessão de agente ativa.

Pra rodar de verdade sem depender de sessão aberta, o motor de execução vive
como **processo de fundo dentro do `content-central-server.js`**, mesmo
padrão já usado por `startWhatsAppPublishScheduler` (`setInterval`, gate por
env var, mesmo arquivo, mesmo bootstrap) — só que autônomo e independente do
Claude Code. O squad Opensquad (`squads/social-selling-instagram/`) guarda a
configuração e os prompts (critério de qualificação, tom da mensagem,
company.md), mas quem executa é o server, chamando a API da Claude
diretamente pros pontos que precisam de IA.

Duas dependências novas, justificadas por isso:

- `playwright` (pacote npm) — abre um Chromium controlado com contexto
  persistente próprio (`_opensquad/_browser_profile/social-selling-ig/`,
  login feito uma vez manualmente, igual ao fluxo do Sherlock hoje).
- `@anthropic-ai/sdk` — chamadas à API da Claude (`claude-opus-5`, padrão da
  skill `claude-api`) pra qualificar sinal e escrever comentário/DM.
  Custo real por chamada; ritmo baixo (poucas dezenas de ações/dia) mantém
  isso barato, mas é bom o usuário estar ciente.

## Modelo de dados

`squads/social-selling-instagram/output/leads.yaml`, um `SocialSellingLead`
por empresa achada:

| campo | tipo | notas |
|---|---|---|
| id | string | handle do Instagram, é a chave natural |
| handle | string | `@perfil` |
| source | `'hashtag' \| 'location' \| 'reference_mining'` | como foi achado |
| foundOn | string | hashtag/localização/conta-referência de origem |
| postUrl | string | post que originou o sinal |
| postSnippet | string | trecho do post, usado pela IA pra personalizar |
| stage | `'descoberto' \| 'like' \| 'comentado' \| 'seguido' \| 'dm_enviado' \| 'descartado'` | próximo passo pendente é sempre o estágio seguinte |
| nextActionAt | ISO string | quando o próximo passo pode disparar |
| draftComment / draftDm | string | gerado pela IA quando o estágio anterior completa |
| discardedReason | string, opcional | motivo do descarte (duplicado, sem sinal, etc.) |
| createdAt / updatedAt | ISO string | |

Mesmo padrão de arquivo do `social-account-registry.yaml` que já existe no
projeto — volume baixo (dezenas/centenas de leads), YAML serve.

## Dois ciclos, dois riscos diferentes

**Ciclo Radar** — `startSocialSellingRadarScheduler(targetDir)`,
`setInterval` a cada `OPENSQUAD_SOCIAL_SELLING_RADAR_INTERVAL_MS` (default
30 min), roda a qualquer hora, todo dia:

1. Playwright abre o perfil persistente, varre hashtag/localização
   configurada e minera interações de contas-referência (config em
   `squad.yaml`).
2. Pra cada perfil candidato novo (não existe ainda em `leads.yaml`):
   chamada à API da Claude qualifica (categoria comercial, posts recentes
   ativos, sem link de agência de marketing na bio, poucos seguidores) e,
   se aprovado, já escreve o rascunho de comentário citando o post.
3. Grava em `leads.yaml` com `stage: 'descoberto'`, `nextActionAt: now`.

É leitura + navegação de página pública — mesmo risco que uma pessoa
rolando o feed. Por isso pode rodar 24h sem gate de horário.

**Ciclo Engajamento** — `startSocialSellingEngagementScheduler(targetDir)`,
`setInterval` curto (ex.: a cada 5 min), mas só age se `now` cair dentro da
janela comercial configurada (padrão seg-sex 9h-18h). A cada disparo:

1. Verifica os limites diários por tipo de ação (`checkSocialSellingSafetyLimits`
   — ver seção seguinte). Se algum já bateu o teto, pula esse tipo de ação
   nesta rodada.
2. Pega **um** lead cujo `nextActionAt <= now` (nunca processa em lote — um
   passo por disparo, com jitter aleatório entre disparos, é o que evita
   sequência robótica).
3. Executa a ação do estágio atual via Playwright (like, comentário,
   follow, ou DM — a DM só é gerada nesse momento, referenciando o post e o
   que já foi comentado antes).
4. Avança `stage`, define `nextActionAt` do próximo passo (delay aleatório
   de 1-3 dias entre like/comentário e follow/DM, conforme a sequência
   combinada).

Sequência completa: `descoberto → like → comentado → seguido → dm_enviado`.
Cada seta é um disparo do Ciclo Engajamento, nunca mais de um por lead por
disparo.

## Proteção contra ban

- **Limites diários por tipo de ação**, configuráveis em `squad.yaml`
  (default: 20 likes, 10 comentários, 5 follows, 8 DMs/dia). Contados
  resetando à meia-noite, guardados junto do `leads.yaml` ou um contador
  simples ao lado.
- **Jitter aleatório** entre disparos do Ciclo Engajamento — nunca ritmo
  fixo.
- Ciclo Engajamento só roda dentro da janela comercial configurada; Ciclo
  Radar roda 24h mas nunca executa ação de escrita (like/comment/
  follow/DM) — só lê.
- **Freio de segurança**: se o Playwright encontrar captcha, tela de
  verificação, ou taxa de erro do Instagram subir, o ciclo marca um estado
  `paused: true` (arquivo ao lado do `leads.yaml`) e para de agir até
  alguém destravar manualmente. **Não tenta contornar a verificação** —
  isso seria evasão de detecção, fora do escopo.
- Notificação do pause e de qualquer erro via WAHA (já existe no projeto
  pro whatsapp_status) pro número do operador.

## Master switch

Gate próprio, separado do `OPENSQUAD_ENABLE_REAL_PUBLISHING` (esse é sobre
publicar conteúdo, não sobre agir em contas de terceiros no Instagram):
`OPENSQUAD_ENABLE_SOCIAL_SELLING=true` liga os dois schedulers. Fica `false`
por padrão — precisa ser ligado de propósito, e só depois do modo dry-run
validado (ver Testes).

## Squad `social-selling-instagram/`

Guarda config e critério, não executa nada sozinho:

- `squad.yaml` — hashtags/localizações alvo, contas-referência pra
  minerar, critério de qualificação, limites diários, janela comercial,
  tom da mensagem (referencia `company.md` existente).
- Prompts usados pelas chamadas à API da Claude (qualificação e redação)
  ficam como arquivos de dados do squad, não hardcoded no server.

## Testes / verificação

Sem suite de integração contra o Instagram real (é automação de
navegador). Cobertura possível, sem rede/browser:

- Funções puras testáveis isoladas: transição de `stage`, cálculo de
  `nextActionAt` (jitter dentro do range certo), `checkSocialSellingSafetyLimits`
  (teto por tipo, reset diário), checagem de janela comercial.
- **Modo dry-run** (`OPENSQUAD_SOCIAL_SELLING_DRY_RUN=true`): os dois
  ciclos rodam, decidem e gravam em `leads.yaml`, mas o Playwright não
  clica em nada real e nenhuma chamada de IA gera custo além da
  qualificação (a etapa mais barata). Rodar alguns ciclos em dry-run antes
  de ligar `OPENSQUAD_ENABLE_SOCIAL_SELLING` de verdade.

## Fora de escopo (YAGNI)

- Detectar resposta do lead (leitura de inbox do Instagram) — v1 só
  conduz a sequência de saída; ler resposta é squad/ciclo futuro.
- Multi-rede (LinkedIn, WhatsApp) — só Instagram por agora.
- Envio de imagem/mídia na DM — só texto.
- Qualquer tentativa de contornar captcha/verificação do Instagram.
- Ferramenta paga de automação — descartado na fase de brainstorm (custo
  recorrente, menos controle sobre o comportamento).
- Integrar `leads.yaml` com a tabela `ComercialProspeccao` — ficam
  separados de propósito (decisão do usuário no brainstorm).
