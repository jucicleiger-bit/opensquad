import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { upsertQueueItem, removeQueueItem, pullQueue } from '../src/gaveta-sync.js';

const execFileAsync = promisify(execFile);

// A real local bare repo stands in for "GitHub" — no network needed, and it
// proves push/pull actually round-trip instead of just asserting the local
// working tree looks right.
async function withGaveta(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gaveta-'));
  const bareDir = join(root, 'remote.git');
  const workDir = join(root, 'work');
  const checkDir = join(root, 'check');
  await execFileAsync('git', ['init', '--bare', bareDir]);
  await execFileAsync('git', ['clone', bareDir, workDir]);
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: workDir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: workDir });
  // git init --bare has no commits yet, so the initial clone has no branch
  // checked out until the first push — make an empty first commit so
  // upsertQueueItem's `git push` has a branch to push.
  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: workDir });
  await execFileAsync('git', ['push', 'origin', 'HEAD:main'], { cwd: workDir });
  await execFileAsync('git', ['checkout', 'main'], { cwd: workDir });
  try {
    await fn({ workDir, bareDir, checkDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('upsertQueueItem writes the item and pushes it to the remote', async () => {
  await withGaveta(async ({ workDir, bareDir, checkDir }) => {
    await upsertQueueItem(workDir, 'boss-pizzaria', 'content-1', {
      channel: 'instagram_feed',
      caption: 'Promo de hoje',
      mediaUrl: 'https://i.ibb.co/abc/image.jpg',
      scheduledDate: '2026-08-10',
      scheduledTime: '18:00',
    });

    await execFileAsync('git', ['clone', bareDir, checkDir]);
    const raw = JSON.parse(await readFile(join(checkDir, 'queue', 'boss-pizzaria', 'content-1.json'), 'utf-8'));
    assert.equal(raw.caption, 'Promo de hoje');
    assert.equal(raw.publish.realPublished, false);
  });
});

test('removeQueueItem deletes the item and pushes the removal', async () => {
  await withGaveta(async ({ workDir, bareDir, checkDir }) => {
    await upsertQueueItem(workDir, 'boss-pizzaria', 'content-1', { channel: 'instagram_feed', caption: 'x', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '18:00' });
    await removeQueueItem(workDir, 'boss-pizzaria', 'content-1');

    await execFileAsync('git', ['clone', bareDir, checkDir]);
    await assert.rejects(readFile(join(checkDir, 'queue', 'boss-pizzaria', 'content-1.json'), 'utf-8'));
  });
});

test('removeQueueItem on an item that was never synced is a no-op', async () => {
  await withGaveta(async ({ workDir }) => {
    await assert.doesNotReject(removeQueueItem(workDir, 'boss-pizzaria', 'never-existed'));
  });
});

test('pullQueue brings in changes pushed from another clone', async () => {
  await withGaveta(async ({ workDir, bareDir }) => {
    const otherClone = `${workDir}-other`;
    await execFileAsync('git', ['clone', bareDir, otherClone]);
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: otherClone });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: otherClone });
    await upsertQueueItem(otherClone, 'boss-pizzaria', 'content-2', { channel: 'instagram_feed', caption: 'y', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '19:00' });

    await pullQueue(workDir);

    const raw = JSON.parse(await readFile(join(workDir, 'queue', 'boss-pizzaria', 'content-2.json'), 'utf-8'));
    assert.equal(raw.caption, 'y');
    await rm(otherClone, { recursive: true, force: true });
  });
});
