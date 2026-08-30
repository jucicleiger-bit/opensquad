import { test } from 'node:test';
import assert from 'node:assert/strict';

// meta-publish-multi.js is a plain ESM script (no export), so its internal
// functions aren't directly importable for unit testing the way the rest of
// this codebase's modules are — instead this drives it exactly like a real
// call would, through a mocked global fetch, and asserts on the sequence of
// Graph API calls it makes. This is this script's first-ever test coverage.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'squads', 'conteudo-multicanal', 'tools', 'meta-publish-multi.js');

function runScript(payload, env = {}, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SCRIPT_PATH, ...extraArgs, '--payload-json', JSON.stringify(payload)], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `exited with code ${code}`));
      resolve(JSON.parse(stdout));
    });
  });
}

test('meta-publish-multi validates a carousel target needs 2-10 image_urls, rejecting 1 and 11', async () => {
  await assert.rejects(
    () => runScript({
      publish_targets: [{ channel: 'instagram_feed', image_urls: ['https://cdn.example.com/only-one.png'] }],
    }, { INSTAGRAM_ACCESS_TOKEN: 'fake', INSTAGRAM_USER_ID: 'fake' }),
    /2-10 image_urls/,
  );
  const tooMany = Array.from({ length: 11 }, (_, i) => `https://cdn.example.com/${i}.png`);
  await assert.rejects(
    () => runScript({
      publish_targets: [{ channel: 'instagram_feed', image_urls: tooMany }],
    }, { INSTAGRAM_ACCESS_TOKEN: 'fake', INSTAGRAM_USER_ID: 'fake' }),
    /2-10 image_urls/,
  );
});

test('meta-publish-multi rejects a carousel-shaped target (image_urls) on a channel other than instagram_feed', async () => {
  await assert.rejects(
    () => runScript({
      publish_targets: [{ channel: 'instagram_story', image_urls: ['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png'] }],
    }, { INSTAGRAM_ACCESS_TOKEN: 'fake', INSTAGRAM_USER_ID: 'fake' }),
    /does not support carousel/,
  );
});

test('meta-publish-multi --dry-run reports a carousel target correctly without calling the real API', async () => {
  const result = await runScript({
    publish_targets: [{ channel: 'instagram_feed', image_urls: ['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png'], caption: 'Legenda' }],
  }, { INSTAGRAM_ACCESS_TOKEN: 'fake', INSTAGRAM_USER_ID: 'fake' }, ['--dry-run']);
  // --dry-run short-circuits before any Graph API call, so a resolved
  // promise here proves validateTarget accepted this well-formed carousel
  // target (2 image_urls, instagram_feed) with no live network call.
  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].channel, 'instagram_feed');
  assert.equal(result.targets[0].caption_length, 'Legenda'.length);
});

// The script is a separate process, so global.fetch can't be monkey-patched
// from here. Pointing its GRAPH_BASE at a local stub server is the smallest
// way to exercise publishInstagramCarousel's REAL multi-step call sequence
// (N child containers -> 1 CAROUSEL parent -> media_publish) end to end,
// including the URL/param shape it actually puts on the wire.
async function withGraphStub(run) {
  const requests = [];
  let nextId = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ path: url.pathname, params: Object.fromEntries(url.searchParams) });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.searchParams.get('fields') === 'status_code') return res.end(JSON.stringify({ status_code: 'FINISHED' }));
    if (url.searchParams.get('fields') === 'permalink') return res.end(JSON.stringify({ permalink: 'https://instagram.com/p/abc' }));
    nextId += 1;
    res.end(JSON.stringify({ id: `id-${nextId}` }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('meta-publish-multi publishes a real carousel as N is_carousel_item children, then one CAROUSEL parent, then media_publish', async () => {
  await withGraphStub(async (base, requests) => {
    const result = await runScript({
      publish_targets: [{
        channel: 'instagram_feed',
        image_urls: ['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png', 'https://cdn.example.com/3.png'],
        caption: 'Legenda do carrossel',
      }],
    }, {
      META_GRAPH_BASE: base,
      INSTAGRAM_ACCESS_TOKEN: 'tok',
      INSTAGRAM_USER_ID: '17841400000000000',
    });

    assert.equal(result.ok, true);
    assert.equal(result.results[0].media_id, 'id-5', 'media_publish is the 5th container-creating call (3 children + 1 parent + publish)');
    assert.equal(result.results[0].permalink, 'https://instagram.com/p/abc');

    const media = requests.filter((r) => r.path.endsWith('/media'));
    assert.equal(media.length, 4, '3 child containers + 1 parent container');

    const children = media.slice(0, 3);
    children.forEach((call, index) => {
      assert.equal(call.path, '/17841400000000000/media');
      assert.equal(call.params.is_carousel_item, 'true');
      assert.equal(call.params.image_url, `https://cdn.example.com/${index + 1}.png`, 'children are created in slide order');
      assert.equal(call.params.caption, undefined, 'Meta ignores a per-child caption — it must not be sent');
      assert.equal(call.params.media_type, undefined);
    });

    const parent = media[3];
    assert.equal(parent.params.media_type, 'CAROUSEL');
    assert.equal(parent.params.children, 'id-1,id-2,id-3', 'parent references every child container id, in order');
    assert.equal(parent.params.caption, 'Legenda do carrossel');
    assert.equal(parent.params.is_carousel_item, undefined);

    // Parent container is polled to FINISHED before publishing, and the
    // publish call references the parent (id-4), never a child.
    const statusPoll = requests.find((r) => r.params.fields === 'status_code');
    assert.equal(statusPoll.path, '/id-4');

    const publishes = requests.filter((r) => r.path.endsWith('/media_publish'));
    assert.equal(publishes.length, 1);
    assert.equal(publishes[0].params.creation_id, 'id-4');
  });
});
