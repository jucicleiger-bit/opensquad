import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { upsertQueueItem, removeQueueItem, pullQueue, readQueueItem, syncQueue } from '../src/gaveta-sync.js';
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

// Two approvals clicked together, or one landing during the 5-minute sync,
// run git in the same clone at once: one hits .git/index.lock and fails.
test('upsertQueueItem calls made at the same time all reach the remote', async () => {
  await withGaveta(async ({ workDir, bareDir, checkDir }) => {
    const ids = ['a', 'b', 'c'];
    await Promise.all(ids.map((id) => upsertQueueItem(workDir, 'boss-pizzaria', `content-${id}`, {
      channel: 'instagram_story', caption: id, mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '18:00',
    })));

    await execFileAsync('git', ['clone', bareDir, checkDir]);
    for (const id of ids) {
      const raw = JSON.parse(await readFile(join(checkDir, 'queue', 'boss-pizzaria', `content-${id}.json`), 'utf-8'));
      assert.equal(raw.caption, id);
    }
  });
});

// 2026-10-05, mid bulk-approve: GitHub Actions pushed a publish result
// between the approve's pull and push, the push was refused and the operator
// saw "1 com erro". A hook refusing the first push stands in for that race.
test('upsertQueueItem pulls and pushes again when its push is refused', async () => {
  await withGaveta(async ({ workDir, bareDir, checkDir }) => {
    await writeFile(join(bareDir, 'hooks', 'pre-receive'), '#!/bin/sh\nif [ ! -f refused-once ]; then touch refused-once; exit 1; fi\n');

    await upsertQueueItem(workDir, 'boss-pizzaria', 'content-race', { channel: 'instagram_story', caption: 'race', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '18:00' });

    await execFileAsync('git', ['clone', bareDir, checkDir]);
    const raw = JSON.parse(await readFile(join(checkDir, 'queue', 'boss-pizzaria', 'content-race.json'), 'utf-8'));
    assert.equal(raw.caption, 'race');
  });
});

// The 5-minute sync compares the app with this clone, so a commit whose
// push failed for good would look in step and never reach GitHub.
test('syncQueue pushes a commit that an earlier failed push left behind', async () => {
  await withGaveta(async ({ workDir, bareDir, checkDir }) => {
    await mkdir(join(workDir, 'queue', 'boss-pizzaria'), { recursive: true });
    await writeFile(join(workDir, 'queue', 'boss-pizzaria', 'content-left.json'), '{"caption":"left"}');
    await execFileAsync('git', ['add', '.'], { cwd: workDir });
    await execFileAsync('git', ['commit', '-m', 'unpushed'], { cwd: workDir });

    await syncQueue(workDir);

    await execFileAsync('git', ['clone', bareDir, checkDir]);
    const raw = JSON.parse(await readFile(join(checkDir, 'queue', 'boss-pizzaria', 'content-left.json'), 'utf-8'));
    assert.equal(raw.caption, 'left');
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

test('commitAndPush aborts a same-file rebase conflict instead of leaving the clone stuck mid-rebase', async () => {
  await withGaveta(async ({ workDir, bareDir }) => {
    // Shared starting point for the item both sides are about to edit.
    await upsertQueueItem(workDir, 'boss-pizzaria', 'content-conflict', { channel: 'instagram_feed', caption: 'v1', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '09:00' });

    // otherClone stands in for GitHub Actions: it pulls the shared item,
    // then edits and pushes the exact same field of the exact same file.
    const otherClone = `${workDir}-other`;
    await execFileAsync('git', ['clone', bareDir, otherClone]);
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: otherClone });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: otherClone });
    await upsertQueueItem(otherClone, 'boss-pizzaria', 'content-conflict', { channel: 'instagram_feed', caption: 'published-by-actions', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '09:00' });

    // workDir (the PC), unaware of that push, edits the same "caption" line
    // of the same file at close to the same time. Its `git commit` (inside
    // commitAndPush) succeeds locally, but the following `pull --rebase`
    // must replay that commit on top of otherClone's push — both changed
    // the same line, so this is a real, unresolvable textual conflict, not
    // something a 3-way merge can silently paper over.
    await assert.rejects(
      upsertQueueItem(workDir, 'boss-pizzaria', 'content-conflict', { channel: 'instagram_feed', caption: 'edited-by-pc', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '09:00' })
    );

    // The call must throw (the caller still needs to know it failed), but
    // the clone must NOT be left mid-rebase: no rebase-merge directory, and
    // `git status` must show a normal diverged-but-clean state, not
    // unmerged paths waiting for a human to run `git rebase --abort`.
    await assert.rejects(stat(join(workDir, '.git', 'rebase-merge')));
    const status = await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: workDir });
    assert.ok(!/^(U|AA|DD)/m.test(status.stdout), `expected no unmerged paths, got:\n${status.stdout}`);

    // workDir's failed edit is still sitting as an unpushed local commit
    // that will keep conflicting with the remote until it's resolved or
    // discarded — that's real, unavoidable git semantics (the same
    // conflict would need resolving no matter what wrote the code), not a
    // symptom of being wedged. What the fix guarantees is that the clone is
    // a normal, workable git repo again, so an ordinary recovery action —
    // here, giving up on the losing local edit and syncing to the latest
    // remote truth — is all it takes to get back to normal, instead of
    // requiring the specialized manual surgery the old bug demanded.
    await execFileAsync('git', ['reset', '--hard', 'origin/main'], { cwd: workDir });

    // A subsequent, unrelated, non-conflicting operation on that same
    // clone must now succeed normally, proving it isn't wedged.
    await upsertQueueItem(workDir, 'boss-pizzaria', 'content-after', { channel: 'instagram_feed', caption: 'fine', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '10:00' });
    const after = await readQueueItem(workDir, 'boss-pizzaria', 'content-after');
    assert.equal(after.caption, 'fine');

    // removeQueueItem must also work normally on the unwedged clone.
    await removeQueueItem(workDir, 'boss-pizzaria', 'content-after');
    assert.equal(await readQueueItem(workDir, 'boss-pizzaria', 'content-after'), null);

    await rm(otherClone, { recursive: true, force: true });
  });
});

// Regression (king-assessoria-mkt 2026-08-22/08-28/09-01, casa-de-embalagem
// 2026-08-17): after GitHub Actions published a story, regenerating it
// (queue remove) and/or re-approving it (queue upsert, which never carries
// `publish`) wrote realPublished:false back over the real publish record,
// so the next hourly sweep posted the same slot to Instagram a second time.
test('re-approving an already-published item keeps it marked published', async () => {
  await withGaveta(async ({ workDir }) => {
    const data = { channel: 'instagram_story', caption: 'v1', mediaUrl: 'https://i.ibb.co/a.png', scheduledDate: '2026-08-22', scheduledTime: '09:00' };
    const published = { realPublished: true, publishedAt: '2026-08-22T12:40:28.999Z', metaMediaId: '17930702736379909', permalink: null, error: null };
    await upsertQueueItem(workDir, 'king', 'story-01', { ...data, publish: published });

    await upsertQueueItem(workDir, 'king', 'story-01', { ...data, caption: 'v2', mediaUrl: 'https://i.ibb.co/b.png' });

    const item = await readQueueItem(workDir, 'king', 'story-01');
    assert.deepEqual(item.publish, published);
    assert.equal(item.caption, 'v2');
  });
});

test('regenerate (remove) then re-approve of an already-published item keeps it marked published', async () => {
  await withGaveta(async ({ workDir }) => {
    const data = { channel: 'instagram_story', caption: 'v1', mediaUrl: 'https://i.ibb.co/a.png', scheduledDate: '2026-08-17', scheduledTime: '09:00' };
    const published = { realPublished: true, publishedAt: '2026-08-17T12:45:23.342Z', metaMediaId: '18088724465533897', permalink: null, error: null };
    await upsertQueueItem(workDir, 'casa', 'story-01', { ...data, publish: published });

    await removeQueueItem(workDir, 'casa', 'story-01');
    await upsertQueueItem(workDir, 'casa', 'story-01', { ...data, caption: 'v2' });

    assert.equal((await readQueueItem(workDir, 'casa', 'story-01')).publish.realPublished, true);
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

// Regression: a mangled/relative OPENSQUAD_GAVETA_DIR (e.g. backslashes
// eaten by a shell somewhere upstream) must fail loudly, not silently write
// the queue file into whatever `process.cwd()` happens to be — that silent
// version of this bug is exactly how an approved post's queue entry once
// landed inside the main app repo instead of the real gaveta clone, where
// the GitHub Actions publisher never saw it.
test('upsertQueueItem rejects a relative gaveteDir instead of writing into process.cwd()', async () => {
  await assert.rejects(
    upsertQueueItem('relative/not-a-real-path', 'boss-pizzaria', 'content-1', { channel: 'instagram_feed', caption: 'x', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '18:00' }),
    /absolute path/
  );
});

test('upsertQueueItem rejects an absolute path that is not a git checkout', async () => {
  await withGaveta(async ({ workDir }) => {
    await assert.rejects(
      upsertQueueItem(join(workDir, 'queue'), 'boss-pizzaria', 'content-1', { channel: 'instagram_feed', caption: 'x', mediaUrl: null, scheduledDate: '2026-08-10', scheduledTime: '18:00' }),
      /no \.git found/
    );
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
