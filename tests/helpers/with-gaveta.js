import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// A real local bare repo stands in for "GitHub" — no network needed, and it
// proves push/pull actually round-trip instead of just asserting the local
// working tree looks right.
export async function withGaveta(fn) {
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
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareDir });
  await execFileAsync('git', ['checkout', 'main'], { cwd: workDir });
  try {
    await fn({ workDir, bareDir, checkDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
