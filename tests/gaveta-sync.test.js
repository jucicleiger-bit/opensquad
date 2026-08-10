import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { upsertQueueItem, removeQueueItem, pullQueue } from '../src/gaveta-sync.js';
import { withGaveta } from './helpers/with-gaveta.js';

const execFileAsync = promisify(execFile);

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

    // Verify the file was pushed to the remote
    await execFileAsync('git', ['clone', bareDir, checkDir]);
    const preRemovalContent = JSON.parse(await readFile(join(checkDir, 'queue', 'boss-pizzaria', 'content-1.json'), 'utf-8'));
    assert.equal(preRemovalContent.caption, 'x');

    // Remove the item and verify the removal was pushed
    await removeQueueItem(workDir, 'boss-pizzaria', 'content-1');
    const checkDir2 = join(checkDir, '..', 'check2');
    await execFileAsync('git', ['clone', bareDir, checkDir2]);
    await assert.rejects(readFile(join(checkDir2, 'queue', 'boss-pizzaria', 'content-1.json'), 'utf-8'));
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
