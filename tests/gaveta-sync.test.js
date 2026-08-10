import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { upsertQueueItem, removeQueueItem, pullQueue, readQueueItem } from '../src/gaveta-sync.js';
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

test('upsertQueueItem pulls and rebases before pushing when the remote has moved on since the last pull', async () => {
  await withGaveta(async ({ workDir, bareDir, checkDir }) => {
    // A second clone stands in for GitHub Actions pushing a queue update
    // while this PC's `workDir` clone is unaware of it — workDir's local
    // HEAD no longer matches the remote HEAD, so a naive push (no pull
    // first) would be rejected as non-fast-forward.
    const otherClone = `${workDir}-other`;
    await execFileAsync('git', ['clone', bareDir, otherClone]);
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: otherClone });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: otherClone });
    await upsertQueueItem(otherClone, 'boss-pizzaria', 'content-remote', { channel: 'instagram_feed', caption: 'from-actions', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '10:00' });

    // workDir never pulled that change — this must still succeed, not throw
    // a non-fast-forward rejection.
    await upsertQueueItem(workDir, 'boss-pizzaria', 'content-local', { channel: 'instagram_feed', caption: 'from-pc', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '11:00' });

    // Both commits' effects must be present on the remote.
    await execFileAsync('git', ['clone', bareDir, checkDir]);
    const remoteItem = JSON.parse(await readFile(join(checkDir, 'queue', 'boss-pizzaria', 'content-remote.json'), 'utf-8'));
    const localItem = JSON.parse(await readFile(join(checkDir, 'queue', 'boss-pizzaria', 'content-local.json'), 'utf-8'));
    assert.equal(remoteItem.caption, 'from-actions');
    assert.equal(localItem.caption, 'from-pc');

    await rm(otherClone, { recursive: true, force: true });
  });
});

test('upsertQueueItem still pushes an earlier unpushed commit even when this call has nothing new to commit', async () => {
  await withGaveta(async ({ workDir, bareDir, checkDir }) => {
    const data = { channel: 'instagram_feed', caption: 'v1', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '12:00' };

    // Break the remote so the commit succeeds locally but the push fails —
    // simulating a real prior failure mode (network blip, remote briefly
    // unreachable) that leaves a legitimate commit sitting unpushed.
    await execFileAsync('git', ['remote', 'set-url', 'origin', join(bareDir, 'does-not-exist')], { cwd: workDir });
    await assert.rejects(upsertQueueItem(workDir, 'boss-pizzaria', 'content-retry', data));

    // Restore the real remote and call again with byte-identical data —
    // `git commit` now fails "nothing to commit" (the working tree already
    // matches the commit made by the failed attempt above), which must not
    // skip pushing that still-unpushed commit.
    await execFileAsync('git', ['remote', 'set-url', 'origin', bareDir], { cwd: workDir });
    await upsertQueueItem(workDir, 'boss-pizzaria', 'content-retry', data);

    await execFileAsync('git', ['clone', bareDir, checkDir]);
    const raw = JSON.parse(await readFile(join(checkDir, 'queue', 'boss-pizzaria', 'content-retry.json'), 'utf-8'));
    assert.equal(raw.caption, 'v1');
  });
});

test('readQueueItem returns the parsed item, or null when it does not exist', async () => {
  await withGaveta(async ({ workDir }) => {
    await upsertQueueItem(workDir, 'boss-pizzaria', 'content-1', { channel: 'instagram_feed', caption: 'x', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '18:00' });

    const item = await readQueueItem(workDir, 'boss-pizzaria', 'content-1');
    assert.equal(item.caption, 'x');

    assert.equal(await readQueueItem(workDir, 'boss-pizzaria', 'never-existed'), null);
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
