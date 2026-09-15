# Endpoint /api/projects/:id — Design

## Problema

Abrir qualquer página dentro de um projeto é lento: `ProjectWorkspaceLayout.tsx` chama `getState()` (`GET /api/state`), que devolve **todos os projetos** do disco, não só o aberto. Medido com 9 projetos: 545KB, ~1.6s por chamada — e isso roda toda vez que `projectId` muda (cada navegação de projeto).

O custo maior não é nem o tamanho da resposta, é `listSystemAlerts()` (`src/content-central.js:4650-4707`), chamado dentro do handler de `/api/state`: relê o `project.json` de **cada** projeto e varre o **histórico completo de conteúdo já gerado** (`listProjectContent`) de **cada** projeto, a cada request — pra montar um dado (`alerts`) que `ProjectWorkspaceLayout` nem usa.

## Estado atual (verificado)

- `content-central-server.js:475-479` — handler de `/api/state`: `{ projects: await listCentralProjects(targetDir), globalRules: await getGlobalRules(targetDir), alerts: await listSystemAlerts(targetDir) }`.
- `ProjectWorkspaceLayout.tsx:32-50` — `WorkspaceContext` só expõe `project` (um `ProjectSummary`) e `refreshProject`; `globalRules`/`alerts` da resposta são descartados sem uso.
- Nenhuma página filha (`useOutletContext<WorkspaceContext>`) lê `alerts` ou `globalRules` — confirmado por busca no diretório `pages/workspace/`.
- `alerts` só é exibido em `Dashboard.tsx:335-341` (banner no topo de "Seus projetos"), que já paga esse custo uma vez por visita à Dashboard — uso legítimo, fora de escopo.
- `AprendizadoSegmento.tsx:22` também usa `getState()` completo (`result.projects`) pra listar todos os projetos por segmento — uso legítimo, fora de escopo.
- `listCentralProjects` (`content-central.js:4629-4642`) já isola a transformação por projeto em `toProjectSummary(project, paths)` (não exportada) — reaproveitável para um único projeto sem duplicar lógica.
- Padrão de rota já usado pra outras sub-rotas de projeto: `content-central-server.js:729-734`, `parts = route.split('/').filter(Boolean)`, checagem por `parts.length` e `parts[3]`.

## Design

### Backend

Nova função exportada `getCentralProjectSummary(projectId, targetDir)` em `content-central.js`, logo perto de `listCentralProjects`:

```js
export async function getCentralProjectSummary(projectId, targetDir = process.cwd()) {
  const paths = getCentralPaths(targetDir);
  const project = await readJson(join(paths.projectsDir, projectId, 'project.json'), null);
  if (!project) return null;
  return toProjectSummary(project, paths);
}
```

Novo handler em `content-central-server.js`, junto do bloco de rotas `/api/projects/:id/...` (`:729+`), como `parts.length === 3` (bare `/api/projects/:id`, sem sub-recurso):

```js
if (method === 'GET' && parts.length === 3) {
  const project = await getCentralProjectSummary(projectId, targetDir);
  if (!project) return sendJson(res, 404, { error: 'Project not found' });
  return sendJson(res, 200, { project });
}
```

Sem `listSystemAlerts`, sem `getGlobalRules`, sem varrer os outros projetos — só lê 1 `project.json`.

### Frontend

Nova função em `client.ts`:

```ts
export function getProject(projectId: string): Promise<{ project: ProjectSummary }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}`);
}
```

`ProjectWorkspaceLayout.tsx:42-50` troca `getState()` por `getProject(projectId)`. Como o backend agora responde 404 (`{ error: 'Project not found' }`) pra um projeto inexistente, e `api()` lança em qualquer resposta não-ok, o `catch` precisa distinguir esse 404 esperado (→ mesma tela "Projeto não encontrado" de hoje, `project = null`) de um erro de verdade (→ tela de erro genérica, como já é):

```ts
const refreshProject = useCallback(async () => {
  try {
    const { project } = await getProject(projectId!);
    setProject(project);
    setError(null);
  } catch (err) {
    if ((err as Error).message === 'Project not found') {
      setProject(null);
    } else {
      setError((err as Error).message);
    }
  }
}, [projectId]);
```

Preserva exatamente o comportamento visível de hoje — nenhuma tela muda pro usuário.

### Fora de escopo

- `Dashboard.tsx` e `AprendizadoSegmento.tsx` continuam usando `/api/state` sem alteração — precisam legitimamente da lista completa.
- Alerts (token expirado, falha ao publicar) continuam existindo só na Dashboard, sem nenhuma mudança de comportamento ali.
- Nenhum indicador de alerta novo dentro das páginas de projeto — não existe hoje, não é pedido agora.

## Testes

- Backend (`tests/content-central-server.test.js`): `GET /api/projects/:id` devolve 200 com o mesmo formato de um item de `state.projects`, pra um projeto existente; devolve 404 `{ error: 'Project not found' }` pra um id inexistente; e (prova de escopo) funciona corretamente mesmo quando só aquele projeto existe no diretório de projetos — não depende de nenhum outro projeto estar cadastrado.
- Frontend (`ProjectWorkspaceLayout.test.tsx`, já existe): mocks trocam de `/api/state` pra `/api/projects/:id`; teste de "projeto não encontrado" agora estuba uma resposta 404 (em vez de uma lista de projetos sem o id buscado) e continua esperando a mesma `EmptyState` "Projeto não encontrado" de hoje — comportamento inalterado, só a forma do mock muda.
