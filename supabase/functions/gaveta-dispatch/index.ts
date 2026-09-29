// supabase/functions/gaveta-dispatch/index.ts
//
// Called every minute by pg_cron (job "gaveta-dispatch-every-min", same
// net.http_post shape as publish-sweep's job). Reads the opensquad-gaveta
// queue and fires its "Publish due posts" workflow when a post is due —
// GitHub's own schedule trigger on that workflow runs hours late. The
// decision itself lives in _shared/gaveta-dispatch.js.
//
// Secrets: GAVETA_REPO ("owner/name") and GAVETA_GITHUB_TOKEN, a
// fine-grained PAT on that repo only with Contents: read and
// Actions: read & write.
import { shouldDispatch } from '../_shared/gaveta-dispatch.js';

const WORKFLOW = 'publish.yml';

// ponytail: pulls every queue file each call; prune published files from
// the gaveta repo if this response ever gets slow.
const QUEUE_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    object(expression: "HEAD:queue") {
      ... on Tree { entries { object { ... on Tree { entries { name object { ... on Blob { text } } } } } } }
    }
  }
}`;

Deno.serve(async (req) => {
  const expectedAuth = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if ((req.headers.get('Authorization') ?? '') !== expectedAuth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const repo = Deno.env.get('GAVETA_REPO');
  const token = Deno.env.get('GAVETA_GITHUB_TOKEN');
  if (!repo || !token) return json({ ok: false, error: 'GAVETA_REPO/GAVETA_GITHUB_TOKEN not set' }, 500);

  const github = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'opensquad-gaveta-dispatch',
      ...init.headers,
    },
  });

  try {
    const [owner, name] = repo.split('/');
    const queueRes = await github('/graphql', { method: 'POST', body: JSON.stringify({ query: QUEUE_QUERY, variables: { owner, name } }) });
    const queue = await queueRes.json();
    if (!queueRes.ok || queue.errors) throw new Error(`queue read failed: ${JSON.stringify(queue.errors || queue)}`);
    const repository = queue.data.repository;
    const items = (repository.object?.entries || [])
      .flatMap((projectDir) => projectDir.object?.entries || [])
      .filter((file) => file.name.endsWith('.json') && file.object?.text)
      .map((file) => JSON.parse(file.object.text));

    const runsRes = await github(`/repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=1`);
    if (!runsRes.ok) throw new Error(`runs read failed: ${runsRes.status} ${await runsRes.text()}`);
    const latestRun = (await runsRes.json()).workflow_runs?.[0] || null;

    if (!shouldDispatch({ items, latestRun })) return json({ ok: true, dispatched: false });

    const dispatchRes = await github(`/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: repository.defaultBranchRef.name }),
    });
    if (!dispatchRes.ok) throw new Error(`dispatch failed: ${dispatchRes.status} ${await dispatchRes.text()}`);
    return json({ ok: true, dispatched: true });
  } catch (err) {
    console.error('[gaveta-dispatch]', err.message);
    return json({ ok: false, error: err.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
