import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// OPENSQUAD_GAVETA_DIR reaching here already mangled (relative, or just
// plain wrong) is exactly how a real incident happened: `join()`/`mkdir`
// don't care whether a path "makes sense", so a bad value silently created
// a nonsense `queue/` folder *inside the main app repo* instead of the
// actual gaveta clone — and the GitHub Actions publisher, which only
// watches the real gaveta repo, never saw the approved post. Failing loud
// here turns that into an immediate, obvious error instead of a silent
// miss discovered only when a client asks why a post never went out.
async function assertValidGaveteDir(gaveteDir) {
  if (!isAbsolute(gaveteDir)) {
    throw new Error(`OPENSQUAD_GAVETA_DIR must be an absolute path, got: ${JSON.stringify(gaveteDir)}`);
  }
  try {
    if (!(await stat(join(gaveteDir, '.git'))).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`OPENSQUAD_GAVETA_DIR does not point at a git checkout (no .git found): ${gaveteDir}`);
  }
}

function queueItemPath(gaveteDir, projectId, contentId) {
  return join(gaveteDir, 'queue', projectId, `${contentId}.json`);
}

async function git(gaveteDir, args) {
  return execFileAsync('git', args, { cwd: gaveteDir });
}

// Commits whatever is currently staged, then pulls (rebasing local commits
// on top) and pushes. `git commit` exits non-zero when there's nothing
// staged (e.g. upsert writing byte-identical content twice) — that's not a
// failure here, just nothing new to commit *this call*. But it must not
// short-circuit the pull+push: an earlier commit from this same process may
// still be sitting unpushed (e.g. a previous push attempt failed because the
// remote had moved on, such as GitHub Actions pushing a publish result), and
// "nothing new to commit this time" must not mean "nothing to sync."
async function commitAndPush(gaveteDir, message) {
  try {
    await git(gaveteDir, ['commit', '-m', message]);
  } catch (err) {
    if (!/nothing to commit/.test(err.stdout || err.message || '')) throw err;
  }
  try {
    await git(gaveteDir, ['pull', '--rebase']);
  } catch (err) {
    // A same-file conflict here would otherwise leave the clone stuck
    // mid-rebase forever — every subsequent commit/pull throws until a
    // human runs `git rebase --abort` by hand. Abort automatically so a
    // conflict degrades to "this push failed, try again" (the same
    // recoverable failure mode this function had before pull-rebase was
    // added) instead of "every gaveta operation is now broken."
    await git(gaveteDir, ['rebase', '--abort']).catch(() => {});
    throw err;
  }
  await git(gaveteDir, ['push']);
}

export async function upsertQueueItem(gaveteDir, projectId, contentId, data) {
  await assertValidGaveteDir(gaveteDir);
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
  await assertValidGaveteDir(gaveteDir);
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
  await assertValidGaveteDir(gaveteDir);
  await git(gaveteDir, ['pull']);
}

// Reads back a single queue item — used by publishWithGaveteSync to check
// whether GitHub Actions' hourly sweep already published this item before
// the PC's own manual "Publicar agora" gets a chance to publish it again.
export async function readQueueItem(gaveteDir, projectId, contentId) {
  await assertValidGaveteDir(gaveteDir);
  try {
    return JSON.parse(await readFile(queueItemPath(gaveteDir, projectId, contentId), 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
