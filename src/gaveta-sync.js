import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function queueItemPath(gaveteDir, projectId, contentId) {
  return join(gaveteDir, 'queue', projectId, `${contentId}.json`);
}

async function git(gaveteDir, args) {
  return execFileAsync('git', args, { cwd: gaveteDir });
}

// Commits whatever is currently staged and pushes. `git commit` exits
// non-zero when there's nothing staged (e.g. upsert writing byte-identical
// content twice) — that's not a failure here, just nothing to sync.
async function commitAndPush(gaveteDir, message) {
  try {
    await git(gaveteDir, ['commit', '-m', message]);
  } catch (err) {
    if (!/nothing to commit/.test(err.stdout || err.message || '')) throw err;
    return;
  }
  await git(gaveteDir, ['push']);
}

export async function upsertQueueItem(gaveteDir, projectId, contentId, data) {
  const path = queueItemPath(gaveteDir, projectId, contentId);
  const payload = {
    projectId,
    contentId,
    channel: data.channel,
    caption: data.caption,
    mediaUrl: data.mediaUrl,
    scheduledDate: data.scheduledDate,
    scheduledTime: data.scheduledTime,
    publish: data.publish || { realPublished: false, publishedAt: null, metaMediaId: null, permalink: null, error: null },
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf-8');
  await git(gaveteDir, ['add', join('queue', projectId, `${contentId}.json`)]);
  await commitAndPush(gaveteDir, `queue: ${projectId}/${contentId}`);
}

export async function removeQueueItem(gaveteDir, projectId, contentId) {
  const path = queueItemPath(gaveteDir, projectId, contentId);
  try {
    await readFile(path, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  await rm(path, { force: true });
  await git(gaveteDir, ['add', join('queue', projectId, `${contentId}.json`)]);
  await commitAndPush(gaveteDir, `queue: remove ${projectId}/${contentId}`);
}

export async function pullQueue(gaveteDir) {
  await git(gaveteDir, ['pull']);
}
