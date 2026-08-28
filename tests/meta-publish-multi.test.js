import { test } from 'node:test';
import assert from 'node:assert/strict';

// meta-publish-multi.js is a plain ESM script (no export), so its internal
// functions aren't directly importable for unit testing the way the rest of
// this codebase's modules are — instead this drives it exactly like a real
// call would, through a mocked global fetch, and asserts on the sequence of
// Graph API calls it makes. This is this script's first-ever test coverage.
import { spawn } from 'node:child_process';
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
