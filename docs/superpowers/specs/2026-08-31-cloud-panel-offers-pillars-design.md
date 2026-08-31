# Divisão nuvem/local — Fase 3b-ii: painel de Ofertas + Pilares

## Contexto

Fase 3b-i (Empresa + Marca/Raio-X) está em produção. Esta fatia traz
Ofertas, Grupos de ofertas e Pilares — dados que o sistema local guarda
como arrays dentro de `project.contentStrategy`, não como arquivos
separados. Cada item tem seu próprio `id`, criado/editado/apagado via
`saveProjectOffer`/`deleteProjectOffer`/`saveProjectOfferGroup`/
`deleteProjectOfferGroup`/`saveProjectPillar`/`deleteProjectPillar` em
`src/content-central.js` — todas leem o projeto inteiro, mexem no array
em memória, escrevem o projeto inteiro de volta. Mesmo padrão já usado na
Fase 3b-i para `company_profile`/`brand_xray`/`brand_briefing`.

## Escopo desta fase

- 1 coluna nova em `projects` (jsonb): `content_strategy`, espelhando
  `project.contentStrategy` — mas só os 3 arrays que interessam aqui
  (`offers`, `offerGroups`, `pillars`); outros campos que já vivem em
  `contentStrategy` localmente (`nextTestTopicIndex`, `topicIdeas`, etc.)
  não são usados por esta fase e a migração os ignora silenciosamente
  (não removidos do local, só não trazidos ainda).
- Tela **Ofertas e Pilares** no `cloud-panel-app`, por projeto, com 3
  seções:
  - **Grupos de ofertas**: nome, `comboChance` (0-100). Criar/editar/
    apagar.
  - **Ofertas**: nome, tipo (os 11 valores de `OFFER_TYPES`: oferta
    direta, serviço, combo, rodízio, delivery, produto destaque, post de
    orientação, post de desejo, urgência, institucional, prova social),
    preço, itens, CTA, notas, ativo/inativo, vínculo com grupo (dropdown)
    e com pilar (dropdown). Criar/editar/apagar.
  - **Pilares**: nome, papel (`ensina`/`prova`/`posiciona`/`convida`),
    objetivo, tratamento visual (`cru`/`leve`/`desenhado`), cor (swatch
    hex), peso (número ≥ 1), ativo/inativo. Criar/editar/apagar.
- Campos raros do sistema local que não entram no formulário desta fase
  (`autoGenerateCta`, `productTreatment`, `layoutStrength`,
  `uniqueProposal`, `daysOfWeek`, `photoReferenceIds`,
  `requiresEvidence`) ficam **preservados intocados** — o app lê o item
  inteiro, só sobrescreve os campos que o formulário edita, nunca
  reconstrói o objeto do zero. Sem perda de dado, só não editáveis na
  nuvem ainda.

Fora de escopo: qualquer coisa que gere conteúdo a partir de oferta/pilar
(isso é Fase 4). `photoReferenceIds` fica como texto opaco (sem preview de
imagem — referências ainda não migradas, é a Fase 3b-iii).

## Modelo de dados

```sql
alter table projects add column if not exists content_strategy jsonb not null default '{}'::jsonb;
```

Forma (documentada, não imposta por constraint — mesmo padrão já usado):

```ts
{
  offers: Array<{
    id: string; name: string; type: string; price: unknown;
    items: string; cta: string; notes: string; active: boolean;
    pillarId: string | null; groupId: string | null;
    // + campos raros preservados via spread, não editados aqui
  }>;
  offerGroups: Array<{ id: string; name: string; comboChance: number; createdAt: string; updatedAt: string }>;
  pillars: Array<{
    id: string; name: string; role: string; objective: string;
    visualTreatment: string; color: string; weight: number; active: boolean;
    // + campos raros preservados
  }>;
}
```

## Migração dos dados existentes

Estende o mesmo migration script da Fase 3b-i: exporta
`normalizeProjectOffers`/`normalizeProjectOfferGroups`/
`normalizeProjectPillars` (arrays inteiros, hoje internas) de
`src/content-central.js`, e adiciona ao mesmo passo por projeto (junto de
`migrateCompanyBrandData` — ou uma função irmã) escrevendo
`content_strategy = { offers: normalizeProjectOffers(project.contentStrategy?.offers), offerGroups: ..., pillars: ... }`.
Idempotente (update por `slug`, mesma convenção).

## Fluxos

**Criar oferta/grupo/pilar**: o app gera um `id` novo com
`crypto.randomUUID()` (API nativa do navegador, sem lib), monta o objeto
com os campos do formulário + defaults sensatos (`active: true`,
`weight: 1`, cor padrão `#7C7C7C`), acrescenta ao array em memória, escreve
`content_strategy` inteiro de volta.

**Editar**: localiza o item pelo `id` no array em memória, faz
`{ ...item, ...camposDoFormulário }` (preserva os campos raros que o
formulário não toca), escreve o array inteiro de volta.

**Apagar**: filtra o item fora do array, escreve de volta. Ofertas dentro
de um grupo apagado **não** são apagadas junto (mesmo comportamento do
`deleteProjectOfferGroup` local — ficam órfãs/históricas, só saem da
rotação).

## Testes

- Lógica pura de CRUD-em-array (adicionar, editar por id preservando
  campos não tocados, remover por id) testada com Vitest — mesma
  convenção das fases anteriores.
- Chamadas reais ao Supabase: verificação manual, sem teste automatizado
  — mesma convenção de toda fase anterior.

## Fora de escopo / próximas fases

- 3b-iii: Referências (upload) + Aprendizado.
- Vínculo de oferta com foto de referência real (preview de imagem) —
  depende da 3b-iii existir primeiro.
- Geração de conteúdo a partir de oferta/pilar — Fase 4.
