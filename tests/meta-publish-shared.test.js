import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { publishToMeta } from '../supabase/functions/_shared/meta-publish.js';

function startStubGraphServer(handler) {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, () => resolvePromise(server));
  });
}

function graphBaseFor(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test('publishToMeta instagram_feed: creates container, waits for FINISHED, publishes, fetches permalink', async () => {
  const calls = [];
  const server = await startStubGraphServer((req, res) => {
    calls.push(req.url);
    if (req.url.startsWith('/ig123/media?')) {
      res.end(JSON.stringify({ id: 'container-1' }));
    } else if (req.url.startsWith('/container-1?fields=status_code')) {
      res.end(JSON.stringify({ status_code: 'FINISHED' }));
    } else if (req.url.startsWith('/ig123/media_publish')) {
      res.end(JSON.stringify({ id: 'media-1' }));
    } else if (req.url.startsWith('/media-1?fields=permalink')) {
      res.end(JSON.stringify({ permalink: 'https://instagram.com/p/abc' }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });

  const result = await publishToMeta({
    channel: 'instagram_feed',
    token: 'fake-token',
    igId: 'ig123',
    imageUrl: 'https://cdn.example.com/img.png',
    caption: 'Legenda de teste',
    graphBase: graphBaseFor(server),
  });

  assert.equal(result.ok, true);
  assert.equal(result.mediaId, 'media-1');
  assert.equal(result.containerId, 'container-1');
  assert.equal(result.permalink, 'https://instagram.com/p/abc');
  server.close();
});

test('publishToMeta retries container creation on Meta\'s transient media-fetch error (code 9004, subcode 2207052)', async () => {
  let containerAttempts = 0;
  const server = await startStubGraphServer((req, res) => {
    if (req.url.startsWith('/ig123/media?')) {
      containerAttempts += 1;
      if (containerAttempts === 1) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'Falha ao baixar mídia', code: 9004, error_subcode: 2207052 } }));
        return;
      }
      res.end(JSON.stringify({ id: 'container-2' }));
    } else if (req.url.startsWith('/container-2?fields=status_code')) {
      res.end(JSON.stringify({ status_code: 'FINISHED' }));
    } else if (req.url.startsWith('/ig123/media_publish')) {
      res.end(JSON.stringify({ id: 'media-2' }));
    } else if (req.url.startsWith('/media-2?fields=permalink')) {
      res.end(JSON.stringify({ permalink: null }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });

  const result = await publishToMeta({
    channel: 'instagram_feed',
    token: 'fake-token',
    igId: 'ig123',
    imageUrl: 'https://cdn.example.com/img.png',
    caption: '',
    graphBase: graphBaseFor(server),
  });

  assert.equal(result.ok, true);
  assert.equal(containerAttempts, 2);
  server.close();
});

test('publishToMeta throws a descriptive error on a non-retryable Graph API failure', async () => {
  const server = await startStubGraphServer((req, res) => {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { message: 'Invalid OAuth access token', code: 190, fbtrace_id: 'abc123' } }));
  });

  await assert.rejects(
    () => publishToMeta({ channel: 'instagram_feed', token: 'bad', igId: 'ig123', imageUrl: 'https://cdn.example.com/img.png', graphBase: graphBaseFor(server) }),
    /Invalid OAuth access token.*code=190.*fbtrace_id=abc123/,
  );
  server.close();
});

test('publishToMeta facebook_story: photo (unpublished) then photo_stories', async () => {
  const calls = [];
  const server = await startStubGraphServer((req, res) => {
    calls.push(req.url.split('?')[0]);
    if (req.url.startsWith('/page456/photos?')) {
      res.end(JSON.stringify({ id: 'photo-1' }));
    } else if (req.url.startsWith('/page456/photo_stories')) {
      res.end(JSON.stringify({ post_id: 'story-post-1' }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });

  const result = await publishToMeta({
    channel: 'facebook_story',
    token: 'fake-token',
    pageId: 'page456',
    imageUrl: 'https://cdn.example.com/img.png',
    graphBase: graphBaseFor(server),
  });

  assert.equal(result.ok, true);
  assert.equal(result.mediaId, 'photo-1');
  assert.equal(result.postId, 'story-post-1');
  assert.deepEqual(calls, ['/page456/photos', '/page456/photo_stories']);
  server.close();
});

test('publishToMeta rejects an unsupported channel', async () => {
  await assert.rejects(
    () => publishToMeta({ channel: 'instagram_reels', token: 'x', igId: 'x', imageUrl: 'x' }),
    /Unsupported publish channel: instagram_reels/,
  );
});
