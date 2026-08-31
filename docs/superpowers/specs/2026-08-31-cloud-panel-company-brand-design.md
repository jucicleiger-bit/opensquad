# Divisão nuvem/local — Fase 3b-i: painel de Empresa + Marca/Raio-X

## Contexto

Fase 3a (painel núcleo: dashboard, aprovação, calendário) está em produção
no Vercel. Esta fatia (3b-i) é a primeira de três que expandem o painel
para cobrir os dados que hoje só existem localmente — começando pela base
que a geração de conteúdo usa para montar o prompt: perfil da empresa e
raio-X/briefing de marca.

Local hoje: `Company.tsx` (828 linhas) mistura dado puro (perfil da
empresa, edição de blocos) com ações de IA (`analyzeBrandXray` — analisa e
gera os blocos do raio-X a partir do perfil). Esta fase só traz o dado
puro para a nuvem; a ação "Analisar com IA" continua sem equivalente na
nuvem até a Fase 4 (agente local) existir — mesma regra da Fase 3a.

## Escopo desta fase

- 3 colunas novas em `projects` (jsonb), espelhando exatamente as formas
  já normalizadas em `src/content-central.js` (`normalizeCompanyProfile`,
  `normalizeBrandXray`, `normalizeBrandBriefing`) — sem redesenhar o
  formato.
- Tela **Empresa** no `cloud-panel-app`, por projeto:
  - Formulário editável do perfil da empresa (17 campos de texto/lista:
    segmento, descrição, público, diferenciais, tom de voz, cores,
    posicionamento, etc.) — salva em `company_profile`.
  - Visualização dos blocos do Raio-X de marca (`brand_xray`) e do
    Briefing (`brand_briefing`), cada bloco com texto + status
    (`draft`/`generated`/`approved`) — ação de **aprovar** (uma ação só,
    aprova todos os blocos de uma vez e marca o status geral como
    `'approved'` — mesmo comportamento de `approveProjectBrandXray` hoje,
    não é aprovação bloco a bloco).

Fora de escopo: botão "Analisar com IA" (gera os blocos automaticamente a
partir do perfil) — precisa do agente local (Fase 4). Editar o texto de um
bloco manualmente também fica fora desta fatia (só aprovar o que já foi
gerado localmente e migrado) — pode entrar numa fatia futura se fizer
falta.

## Modelo de dados

```sql
alter table projects add column if not exists company_profile jsonb not null default '{}'::jsonb;
alter table projects add column if not exists brand_xray jsonb not null default '{}'::jsonb;
alter table projects add column if not exists brand_briefing jsonb not null default '{}'::jsonb;
```

Formas (documentadas aqui, não impostas por constraint — mesmo padrão
"jsonb livre, validado na aplicação" já usado em `content_items.metadata`
desde a Fase 1):

```ts
// company_profile
{
  segmentGroup: string; segmentCategory: string; segmentSpecialty: string;
  segment: string; description: string; audience: string;
  audienceType: string; location: string; productsOrServices: string;
  differentiators: string; primaryObjective: string;
  websiteOrInstagram: string; factualConstraints: string;
  tone: string[]; contentGoals: string[]; brandColors: string;
  avoid: string; positioning: string;
}

// brand_xray / brand_briefing (mesma forma pras duas)
{
  status: 'empty' | 'generated' | 'approved' | 'needs_review';
  source: string;
  blocks: {
    [blockId: string]: {
      id: string; label: string; text: string;
      status: 'draft' | 'generated' | 'approved';
      approvedAt: string | null;
    };
  };
  generatedAt: string | null;
  approvedAt: string | null;
}
```

Nota: `projects.brand_profile` (jsonb, já existe desde a Fase 1, veio de
`project.brand` na migração) é um campo **diferente** — não confundir com
`company_profile` desta fase. Ambos ficam, cada um com sua origem local.

## Migração dos dados existentes

Os 9 projetos já migrados na Fase 1 têm `companyProfile`/`brandXray`/
`brandBriefing` nos `project.json` locais, nunca trazidos ainda. Precisa
de um script de migração pontual (mesmo padrão do
`src/migrate-to-supabase.js` da Fase 1): para cada projeto, ler
`project.json`, normalizar com as funções já existentes
(`normalizeCompanyProfile`/`normalizeBrandXray`/`normalizeBrandBriefing`,
já importáveis de `src/content-central.js`) e fazer upsert das 3 colunas.
Idempotente por natureza (upsert por `projects.id`, que já existe).

## Fluxos

**Editar perfil**: formulário lê `company_profile`, salva com
`update projects set company_profile = ? where id = ?` (substitui o objeto
inteiro — o formulário sempre manda a forma completa, mesmo padrão que
`Approval.tsx` já usa pra `copy`).

**Aprovar raio-X/briefing**: uma ação por documento (não por bloco),
espelhando `approveProjectBrandXray`/`approveProjectBrandBriefing`. O app
lê o `brand_xray`/`brand_briefing` atual, marca TODOS os blocos como
`status: 'approved'` com `approvedAt: new Date().toISOString()`, marca o
`status` do nível superior como `'approved'` também, e escreve o objeto
inteiro de volta — sem função no banco pra edição parcial de jsonb, o app
sempre manda a forma completa.

## Testes

- Lógica pura de aprovação (dado um `brand_xray`/`brand_briefing`, retorna
  o objeto com todos os blocos + status geral marcados como `'approved'`)
  testada com Vitest — mesma convenção da Fase 3a.
- Formulário e chamadas reais ao Supabase: verificação manual contra o
  projeto real, sem teste automatizado — mesma convenção de toda fase
  anterior.

## Fora de escopo / próximas fases

- 3b-ii: Ofertas + Pilares (tabelas relacionais, CRUD de lista).
- 3b-iii: Referências (upload de arquivo pro Storage) + Aprendizado
  (segmento/tipo de oferta).
- Botão "Analisar com IA" e edição manual de texto de bloco — Fase 4.
