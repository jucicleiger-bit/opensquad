# Divisão nuvem/local — Fase 3b-iii-a: painel de Referências

## Contexto

Fase 3b-i (Empresa + Marca/Raio-X) e 3b-ii (Ofertas + Pilares) estão em
produção. Esta fatia traz apenas **Referências** — imagens/arquivos de
inspiração visual, produto real ou ativo oficial de marca que o sistema
local usa para orientar geração de conteúdo. `Aprendizado` (dado global,
não por projeto) fica fora, é fatia separada e futura.

Diferente de 3b-i/3b-ii, esta fatia **não precisa de coluna nova**: a
Fase 1 já migrou `project.brand` inteiro (verbatim) para a coluna
`brand_profile`, o que inclui `brand.references` — confirmado numa consulta
real contra o Supabase já migrado (`boss-pizzaria`: 15 itens,
`terco-que-vende`: 1, `casa-de-embalagem`: 13, demais projetos: 0). O que
falta é só os **bytes reais dos arquivos**: hoje cada item tem
`relativePath`/`previewUrl` apontando para o servidor local
(`/api/projects/<slug>/assets/assets/references/<arquivo>`), que a nuvem
não alcança.

Local: `listProjectReferences`/`deleteProjectReference`/
`updateProjectReference` em `src/content-central.js` (~linha 4880-4920),
mais `normalizeProjectReferences`/`normalizeReferenceMetadata`/
`normalizeReferenceCategory`/`roleForReferenceCategory` (~linha
8760-8839). Upload local aceita `image/*,.pdf,.txt,.md,.doc,.docx`
(`content-central-server.js`, aba "Referências e imagem").

## Escopo desta fase

- **Migração**: estende `src/migrate-to-supabase.js` para subir os bytes
  reais de cada referência existente para o bucket `content-media` (já
  criado na Fase 1, usado hoje por `content_items.media_url`), e gravar um
  campo novo `storagePath` em cada item do array `references` dentro de
  `brand_profile`.
- **Tela Referências** no `cloud-panel-app`, por projeto:
  - Lista de referências com preview (signed URL, só quando `mimeType`
    começa com `image/`; outros tipos mostram nome do arquivo + rótulo do
    tipo, sem preview).
  - Editar por item: categoria (`official_asset`/`real_product`/
    `visual_inspiration`, com role derivado automaticamente — ver mapa
    abaixo), peso (`low`/`medium`/`high`), instrução (texto livre),
    "usar na próxima geração" (checkbox).
  - Apagar: remove o item do array **e** o arquivo do Storage.
  - Adicionar: upload de arquivo novo direto do navegador para o Storage,
    gera metadata, acrescenta ao array.
- Fora de escopo: `usageRoles` múltiplos (mantém como veio, não editável),
  `automaticRule` customizado (mantém o texto padrão que já existe no
  item, não editável), vínculo com `photoReferenceIds` de oferta (campo
  fica preservado intocado se existir no item, sem UI de edição). Qualquer
  outro campo raro do objeto local (`aspectRatio`, `width`, `height`,
  `bytes`, `createdAt`, `filename`, `id`) só é lido/preservado via spread,
  nunca reconstruído do zero — mesmo padrão de 3b-i/3b-ii.
- Aprendizado (Aprendizado/Learning, dado global) continua totalmente fora
  desta fase.

## Modelo de dados

Nenhuma migração SQL nova. `brand_profile` já existe
(`supabase/migrations/0003_company_brand.sql`), jsonb, default `'{}'`.

Forma do item de referência dentro de `brand_profile.references[]`
(documentada, não imposta por constraint — mesmo padrão já usado):

```ts
{
  id: string;
  filename: string;
  relativePath: string;      // legado local — preservado, não usado pela nuvem para servir o arquivo
  storagePath: string;       // novo — path no bucket content-media: `${slug}/${relativePath}`
  mimeType: string;
  bytes: number;
  role: string;               // derivado da categoria, ver mapa abaixo
  usageRoles: string[];
  referenceCategory: string;  // 'official_asset' | 'real_product' | 'visual_inspiration'
  weight: 'low' | 'medium' | 'high';
  instruction: string;
  automaticRule: string;
  useInNextGeneration: boolean;
  createdAt: string;
  // + width, height, aspectRatio: preservados via spread, não editados aqui
}
```

Mapa categoria → role (mesmo de `roleForReferenceCategory` local):
- `official_asset` → `brand_asset`
- `real_product` → `product_photo`
- `visual_inspiration` → `visual_reference` (default também para categoria desconhecida)

## Migração dos dados existentes

Nova função em `src/migrate-to-supabase.js`, chamada junto do passo por
projeto (mesmo loop de `migrateCompanyBrandData`):

1. Lê `project.brand.references` (já normalizado localmente pelo sistema
   ao carregar o projeto).
2. Para cada item com `relativePath` apontando a um arquivo que existe em
   disco (`assets/references/...`): lê o arquivo, sobe pro bucket
   `content-media` em `${slug}/${relativePath}`, `upsert: true`
   (idempotente — mesma convenção de `uploadItemMedia`). Sem compressão
   via `sharp` aqui — referências são material de inspiração, não mídia
   final publicada, então mantém o arquivo original.
3. Grava `storagePath` no item.
4. Escreve `brand_profile` inteiro de volta (`{...brand_profile,
   references: itensAtualizados}` — preserva todo o resto do objeto,
   nunca reconstrói do zero), mesma chamada de update que já grava
   `company_profile`/`brand_xray`/`brand_briefing`/`content_strategy`.
5. Item cujo arquivo não existe mais em disco: pula o upload, mantém o
   item no array sem `storagePath` (a tela mostra "arquivo indisponível"
   em vez de preview/erro).

## Fluxos (tela Referências)

**Carregar**: busca `brand_profile` do projeto, lê `.references` (array
vazio se ausente/não-array — checagem `Array.isArray`, não truthiness,
mesmo motivo do bug pego pelo Codex na 3b-i: `brand_profile` nunca é
`null`, é `{}` por default). Para cada item com `storagePath`, pede signed
URL (`storage.from('content-media').createSignedUrl(storagePath, 300)`) —
mesmo TTL e padrão de `Approval.tsx`.

**Adicionar**: usuário escolhe categoria + arquivo (input `accept="image/*,.pdf,.txt,.md,.doc,.docx"`,
mesma lista do upload local) + instrução opcional. App:
1. Gera `id` com `crypto.randomUUID()`.
2. `storagePath = ${slug}/references/${id}-${nomeDoArquivo}`.
3. Sobe o arquivo (`storage.from('content-media').upload(storagePath, file)`).
4. Monta o objeto de metadata (role derivado da categoria, `weight:
   'medium'` default, `useInNextGeneration: true` default,
   `automaticRule` com o texto padrão do papel escolhido, `createdAt: new
   Date().toISOString()`).
5. Acrescenta ao array em memória, escreve `brand_profile` inteiro de
   volta.
6. Falha no upload OU no update: nada é commitado (nem estado local nem
   Storage órfão sem registro) — mesma disciplina de `persist()` retornar
   sucesso/falha da 3b-ii.

**Editar**: localiza pelo `id`, `{ ...item, categoria/peso/instrução/
useInNextGeneration novos, role re-derivado se categoria mudou }`,
escreve array inteiro de volta. Preserva todo campo não tocado pelo
formulário.

**Apagar**: confirma, remove do array em memória, escreve `brand_profile`
de volta; **depois** (só se o update deu certo) chama
`storage.remove([storagePath])` se o item tinha `storagePath` — nunca
apaga o arquivo antes de confirmar que o registro sumiu, evita referência
quebrada se o update falhar.

## Testes

- Lógica pura de CRUD-em-array (adicionar, editar por id preservando
  campos não tocados, remover por id, derivação categoria→role) testada
  com Vitest — mesma convenção das fases anteriores.
- Chamadas reais ao Supabase/Storage: verificação manual, sem teste
  automatizado — mesma convenção de toda fase anterior.

## Fora de escopo / próximas fases

- Aprendizado (Learning) — fatia futura, dado global.
- Geração de conteúdo usando referência — Fase 4.
- Vínculo oferta↔referência (`photoReferenceIds`) editável na nuvem —
  preservado intocado, sem UI aqui.
