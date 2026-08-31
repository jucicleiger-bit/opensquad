# Divisão nuvem/local — Fase 3b-iv: Aprendizado (segmento, tipo de oferta, templates)

## Contexto

Última fatia da Fase 3. Diferente de toda fatia anterior (Empresa,
Ofertas/Pilares, Referências), Aprendizado **não é dado por projeto** — é
dado global, compartilhado entre todos os projetos. São 3 modelos
diferentes, hoje 3 arquivos/pastas globais em
`_opensquad/content-central/`:

- `segment-learnings.json` — árvore setor → nicho → especialidade, cada nó
  com entradas de texto/imagem marcadas como `technical`/`approved`/`avoid`.
  Local só mostra o(s) nó(s) ancestrais do **projeto aberto** (via
  `loadSegmentLearningNodesForSelection`, `src/content-central.js:5250`) —
  não existe tela de "ver tudo" nem localmente.
- `offer-type-learnings.json` — 1 nó por tipo de oferta (os 11 valores de
  `OFFER_TYPES`), cada um com `baseInstruction` (texto) + entradas
  texto/imagem. Isso é global de verdade, sem contexto de projeto.
- `segment-templates/<segmentId>/` — peças de criativo já aprovadas
  (imagens reais) por segmento, usadas para adaptar conteúdo novo pra
  prospects daquele segmento. **Registrado só via script de operador
  (`registerSegmentTemplate`) — o painel local em si só lista/lê, nunca
  cria/edita.** `src/content-central.js:2152-2239`.

Botão "IA analisa a imagem e sugere o texto" (`analyzeLearningImage`,
`POST /api/segment-learnings/analyze-image`) fica de fora — é geração,
Fase 4. Na nuvem, imagem de aprendizado é sempre texto digitado na hora do
upload (mesmo padrão já usado em Referências).

## Escopo desta fase

- **Aprendizado de Segmento**: tela dentro do projeto
  (`/projects/:id/aprendizado`), mostrando as entradas dos nós ancestrais
  do segmento DESSE projeto (setor/nicho/especialidade, lidos de
  `company_profile.segmentGroup/segmentCategory/segmentSpecialty`, já
  migrados na 3b-i). CRUD de entradas (texto ou imagem), buckets
  `technical`/`approved`/`avoid`.
- **Aprendizado por Tipo de Oferta**: tela nova, global, fora de qualquer
  projeto (`/aprendizado/tipos-de-oferta`), lista os 11 tipos de oferta,
  cada um com `baseInstruction` editável + CRUD de entradas
  texto/imagem.
- **Templates de Segmento**: tela nova, global, **somente leitura**
  (`/aprendizado/templates`) — lista os templates já registrados, mostra
  as peças (imagens reais) de cada um. Criar/editar template continua só
  via script local, igual hoje.
- Campos raros de uma entrada de imagem (`purpose`, `postType`, `shape` —
  usados só pra "criativo" avançado) ficam preservados via spread, sem
  campo de formulário nesta fase — mesmo padrão de "campo raro preservado
  intocado" das fases anteriores.

Fora de escopo: análise de imagem por IA; criar/editar template de
segmento pela nuvem; qualquer geração de conteúdo a partir de aprendizado
(Fase 4).

## Modelo de dados

Duas tabelas novas — nenhuma é por-projeto, então não entram em `projects`:

```sql
create table if not exists global_learning (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  segment_learnings jsonb not null default '{}'::jsonb,
  offer_type_learnings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table global_learning enable row level security;
create policy "owner full access" on global_learning
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists segment_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  segment_id text not null,
  label text not null,
  pieces jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, segment_id)
);
alter table segment_templates enable row level security;
create policy "owner full access" on segment_templates
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
```

`global_learning` é singleton por dono (1 linha só, `owner_id unique`) —
mesmo espírito de `projects`, mas sem chave de projeto. Reaproveita o
bucket `content-media` já existente pra imagens (sem bucket novo).

Formas (documentadas, não impostas por constraint — mesmo padrão já
usado):

```ts
// global_learning.segment_learnings — espelha segment-learnings.json
{
  nodes: {
    // chave = path com tag: "group:alimenticio/category:pizzaria" etc,
    // produzido por segmentNodePathsFromFields — NUNCA re-slugificar
    [path: string]: { label: string; entries: LearningEntry[] };
  };
}

// global_learning.offer_type_learnings — espelha offer-type-learnings.json
{
  types: {
    [offerType: string]: { baseInstruction?: string; entries: LearningEntry[] };
  };
}

interface LearningEntry {
  id: string;
  bucket: 'technical' | 'approved' | 'avoid';
  kind: 'text' | 'image';
  text: string;
  title: string;          // só kind:'image'
  imagePath: string;      // legado — caminho local, preservado, não usado pra servir arquivo
  storagePath?: string;   // novo — path no bucket content-media
  source: 'manual' | 'auto';
  createdAt: string;
  // purpose, postType, shape, sourceProjectId: preservados via spread, sem UI
}

// segment_templates.pieces
Array<{
  key: string; label: string; channel: string; angleNote: string;
  imagePath: string;      // legado
  storagePath: string;    // novo — path no bucket content-media
}>
```

## Migração dos dados existentes

Estende `src/migrate-to-supabase.js`, 2 funções novas, chamadas **uma vez
só** (não por slug — são globais):

- `migrateGlobalLearning(targetDir, client)`: lê `segment-learnings.json`
  (aplica `migrateSegmentLearningStoreV1ToV2` se `schemaVersion !== 2`,
  mesma lógica de `readSegmentLearningStore`, reimplementada aqui — a
  função local não está exportada) e `offer-type-learnings.json`. Para
  cada entrada `kind:'image'` com `imagePath` apontando a um arquivo real
  em `assets/learning/<imagePath>`: sobe pro bucket `content-media` em
  `learning/<imagePath>`, stampa `storagePath` (mesmo padrão de
  `uploadReferenceFile` da fase anterior — arquivo ausente não é erro, só
  não ganha `storagePath`). Escreve `global_learning` via upsert
  `onConflict: 'owner_id'` (precisa do owner id, mesma busca via
  `client.auth.admin.listUsers()` já usada em `migrateProjects`).
- `migrateSegmentTemplates(targetDir, client)`: lista
  `segment-templates/*/template.json`, sobe cada `piece.imagePath` pro
  bucket em `segment-templates/<segmentId>/<imagePath>`, upsert em
  `segment_templates` por `onConflict: 'owner_id,segment_id'`.

Ambas chamadas uma vez em `runMigration` (fora do loop por slug), com
resultado agregado igual aos outros passos.

## Fluxos

### Aprendizado de Segmento (`/projects/:id/aprendizado`)

**Carregar**: busca `company_profile` do projeto (já tem
segmentGroup/Category/Specialty) + `global_learning.segment_learnings`.
Calcula os paths ancestrais em TS (porta `segmentNodePathsFromFields`/
`segmentNodeLabelFromFields` — funções puras pequenas, ~15 linhas cada).
Pra cada path, lê `nodes[path]?.entries || []`.

**Adicionar/editar entrada**: escolhe bucket + tipo (texto/imagem) + texto
(+ arquivo se imagem, upload direto pro Storage, mesmo padrão de
Referências) + qual nó (setor/nicho/especialidade do próprio projeto —
sempre um dos paths já calculados, não texto livre). Escreve
`global_learning` inteiro de volta com
`{...current, segment_learnings: {...current.segment_learnings, nodes: {...nodes, [path]: {label, entries: upsertById(...)}}}}`.

**Apagar**: `removeById` no array de entries do nó; se a entrada tinha
`storagePath`, remove do Storage só depois do update confirmar (mesma
ordem de Referências).

### Aprendizado por Tipo de Oferta (`/aprendizado/tipos-de-oferta`)

Mesmo fluxo, só que os "nós" são os 11 `OFFER_TYPES` fixos (sem árvore) e
cada um tem `baseInstruction` (textarea simples, salva direto, sem
draft/form) além das entradas.

### Templates de Segmento (`/aprendizado/templates`, leitura)

Lista `segment_templates`, cada linha mostra label + grid de imagens das
peças (signed URL, 300s, mesmo padrão). Sem criar/editar/apagar.

## Navegação

Dashboard ganha uma seção "Aprendizado" (fora da lista de projetos) com 2
links (Tipos de Oferta, Templates). Cada card de projeto ganha o link
"Aprendizado" ao lado de Empresa/Ofertas/Referências.

## Testes

- Funções puras (segmentNodePathsFromFields/segmentNodeLabelFromFields em
  TS, upsert/remove de entrada por bucket+path) testadas com Vitest —
  mesma convenção das fases anteriores.
- Migração: Node test runner, mesma convenção (`fakeClientForReferences`-
  style mock com `storage.upload`).
- Chamadas reais ao Supabase/Storage: verificação manual.

## Fora de escopo / próximas fases

- Análise de imagem por IA (Fase 4).
- Criar/editar/apagar template de segmento pela nuvem — continua script
  local (`registerSegmentTemplate`).
- Geração de conteúdo a partir de aprendizado/template — Fase 4.
