# GitHub Fork Deploy + Private Backup — Design

## Problem

Repo's only remote is `renatoasse/opensquad` (upstream, not owned by the user). The user's own GitHub account (`jucicleiger-bit`, authenticated via `gh`, 0 public repos) has nothing published yet. The user wants:

1. Their own code published on GitHub (`master` = deploy snapshot).
2. A `work` branch to continue active development, without polluting `master` with in-progress changes.
3. A full-recovery story: if this computer is lost, cloning from GitHub restores everything needed to keep working — including local-only files (secrets, browser sessions, skill configs) that never touch the public repo.

## Current state (verified)

- `origin` → `https://github.com/renatoasse/opensquad.git` (upstream fork source).
- Local branches: `master` (current, 5 commits ahead of nothing — clean history), plus stale `work/content-central-agents-20260809-223628` (5 commits *behind* master, nothing unique — ignored, not reused).
- `gh auth status` → logged in as `jucicleiger-bit`, `repo`/`workflow` scopes present.
- Working tree: 7 modified tracked files (content-central code, real in-progress work) + a long list of untracked/gitignored local files (secrets, sessions, skill configs, throwaway screenshots/tmp files).

## Design

### Two GitHub repos, one account (`jucicleiger-bit`)

1. **`jucicleiger-bit/opensquad`** — public, forked from `renatoasse/opensquad` via `gh repo fork`. Ordinary single `.git` repo (the existing one). Branch `master` stays named `master` (not renamed to `main` — avoids breaking `.github/workflows/ci.yml`, which triggers on `master`). Holds only what's already tracked by git today.
2. **`jucicleiger-bit/opensquad-private`** — private, new (not a fork). Tracks secrets, skill configs, browser sessions, and local tool configs that must never reach the public repo, without duplicating the files into another folder.

### Remote layout on `opensquad` (public)

- `origin` → `jucicleiger-bit/opensquad` (the fork; where the user pushes).
- `upstream` → `renatoasse/opensquad` (kept, so future `git fetch upstream` / merges stay possible).

### Private backup mechanism

The private files stay exactly where the app/skills expect them on disk (e.g. `.claude/`, `_opensquad/_browser_profile/`). A **second, independent git control directory** — `.git-private` — is initialized in the same working tree via `git --git-dir=.git-private --work-tree=.`. Its own ignore file excludes everything except the whitelisted private paths, so it version-controls only:

- `.env`, `.env.bak.*`
- `_opensquad/_browser_profile/` (logged-in sessions)
- `_opensquad/_memory/` (`company.md`, `preferences.md`)
- `_opensquad/content-central/secrets/`
- `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/skills/`
- `.codex/`, `.hermes/`
- `skills-lock.json`
- `skills/grok-papercraft-director/`

This repo's only remote is `origin` → `jucicleiger-bit/opensquad-private`. No duplication: the same on-disk file is tracked once by the public repo's `.git` (if applicable — it mostly won't be, since these paths are gitignored there) and once by `.git-private`.

An alias/wrapper script (`git-private`) is added so the user doesn't need to remember the `--git-dir` flag by hand.

### Explicitly out of scope (tracked by neither repo)

Throwaway/test artifacts with no backup value: loose screenshots (`review-step-full.png`, `test_grok_imagine.png`, `uigram-home.png`), `graphify-out/`, `tmp-panel-script.js`, `scripts/`, `content-central-app/.hallmark/`. These stay untracked, local-only, recreatable on demand.

### `work` branch

New branch `work`, created off current `master`. The 7 currently-modified files (real in-progress content-central changes) are committed there — not on `master`. Pushed to `origin` (the public fork) once created.

### Deploy sequence

1. `gh repo fork renatoasse/opensquad --remote=false` — creates the public fork under `jucicleiger-bit`.
2. Rename local `origin` → `upstream`; add new `origin` pointing at the fork.
3. `git push origin master` — deploy snapshot.
4. `git checkout -b work`; commit the 7 modified files; `git push origin work`.
5. Create `jucicleiger-bit/opensquad-private` via `gh repo create ... --private`.
6. Init `.git-private`, add the whitelist ignore rules, commit the listed paths, push to the private repo's `origin`.

### Recovery story (if this machine is lost)

1. `gh repo clone jucicleiger-bit/opensquad` — full code history, both branches.
2. Inside that folder, restore `.git-private` from `jucicleiger-bit/opensquad-private` (clone its objects into `.git-private`, checkout onto the same working tree) — brings back `.env`, sessions, skill configs in place.
3. `npm install` in the repo root and in `content-central-app/`.

Result: working tree matches the old machine, no manual reconfiguration.

## Testing / verification

- After push: `git log origin/master` and `git log origin/work` (public repo) match local.
- `git --git-dir=.git-private log` shows the private commit; `gh repo view jucicleiger-bit/opensquad-private` confirms it's private.
- Confirm `.env`, `_opensquad/_browser_profile/`, `.claude/skills/` etc. are **absent** from `git show origin/master` listing (never leaked into the public repo).
- Dry-run the recovery sequence in a scratch directory to confirm both clones combine into a working tree.

## Error handling

- If `gh repo fork` fails (name collision, rate limit): surface the `gh` error verbatim, don't retry blindly.
- If pushing `master`/`work` rejects (fork not yet visible, auth issue): re-run `gh auth status` before retrying push.
- If `.git-private` accidentally stages a file outside the whitelist: caught by reviewing `git --git-dir=.git-private status` before each commit — the ignore file is allow-list style (ignore all, `!path` for each whitelisted entry), so anything new defaults to excluded.
