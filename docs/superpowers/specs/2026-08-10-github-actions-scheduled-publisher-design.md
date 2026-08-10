# GitHub Actions Scheduled Publisher

**Date:** 2026-08-10
**Status:** Approved, not yet implemented
**Scope:** `src/content-central.js`, `src/content-central-server.js`, new private GitHub repo (the "gaveta")

## Problem

`content-central-server.js` publishes approved, scheduled posts to Instagram/Facebook via a `setInterval` sweep (`startPublishScheduler`, `runDuePublishSweep`) that only runs while the operator's PC is on. Two side effects of that:

1. Posts don't go out if the PC is asleep/off/terminal closed.
2. On 2026-08-09, two publisher processes ran at once without knowing about each other and double-posted. The fix must guarantee exactly one process is ever responsible for time-based publishing.

Goal: move the time-based sweep to GitHub Actions (free), while the PC stays the only place that generates/approves content and keeps an instant "Publicar agora" override — for $0/month.

## Solution

A new **private GitHub repo** ("the gaveta") holds one JSON file per approved/scheduled post plus its publish status. It is the single shared source of truth between the PC and GitHub Actions:

- **PC**: generates and approves content as today. On approve/regenerate/delete, it also mirrors that change into a local clone of the gaveta repo and pushes. The "Publicar agora" button keeps working for instant publishes, publishing straight from the PC.
- **GitHub Actions** (new repo, hourly cron): pulls the gaveta, publishes whatever is `aprovado`, due, and not yet published, writes the result back, and pushes.

Because both publishers read/write the same git-tracked state and always pull before checking `realPublished`, only one of them ever actually calls the Meta API for a given post.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo visibility | New private repo, separate from `renatoasse/opensquad` (upstream, public, not owned by the operator) | Client captions/images shouldn't be public before they're posted. |
| Sweep interval | Hourly (`0 * * * *`) | Private repos get 2,000 free Action minutes/month; each run costs a minimum of 1 billed minute regardless of actual duration. Hourly ≈ 720 min/month, leaving headroom for the existing CI workflow. 15/30-min intervals get close to or over the free cap. |
| Media hosting timing | Upload to imgBB/Catbox **at approval time** (PC), not at publish time | GitHub Actions has no access to the PC's local disk, so the gaveta item must already carry a public URL, not a local path. |
| Meta token sync | Automatic: PC calls `gh secret set` when a project's token is saved/rotated | 6 projects, each with its own expiring token; manual copy-paste is easy to forget and leaves the Action publishing with a stale credential. |
| Manual "Publicar agora" | Stays enabled on the PC, real-publishing flag stays `true` locally | Operator needs instant publish sometimes; can't be GitHub-only. |
| Race prevention between PC-manual and Actions-hourly | Both `git pull` the gaveta before checking `!item.publish?.realPublished`, and `git push` immediately after writing a result | Keeps a single logical state without needing a distributed lock; matches the existing "self-heal" tolerance already documented in `content-central-server.js` around Meta's crawler race. |
| Automatic time-based scheduler on the PC | Disabled via a new, independent env var | Splitting "real publishing allowed" (needed by the manual button) from "the interval-based sweep runs" (must NOT run locally) is required — today one flag (`OPENSQUAD_ENABLE_REAL_PUBLISHING`) gates both, which would either break the manual button or bring back the duplication bug. |
| Deleting an already-approved/scheduled post | Delete also removes the item from the gaveta clone and pushes | `deleteProjectContent` today only does a local `rm` with no trace. Without propagating the delete, the Action has no way to know the post was cancelled and would still publish it. Real scenario: client asks for more info on an already-approved event post → operator deletes it and creates a new one. |
| Regenerating the image of an already-approved post | Same sync hook fires on the `aprovado` → `regenerated` status transition (`applyContentRegeneration`) | Regenerating already resets local status away from `aprovado`, correctly pulling it out of the local due-filter — but the gaveta's copy would still say `aprovado` with the old image and old schedule until this syncs. Re-approving after liking the new image re-syncs it with the fresh image URL, same as first approval. |

## Architecture

```
PC (content-central-server.js)                   GitHub (new private repo)
──────────────────────────────                   ──────────────────────────
generate → approve ───────────────sync (push)───▶ queue/<projectId>/<contentId>.json
regenerate (aprovado→regenerated) ─sync (push)───▶   { channel, caption, mediaUrl,
delete approved/scheduled post ────sync (push)───▶     scheduledDate/Time, status,
                                                        publish: { realPublished,
"Publicar agora" (instant) ◀──pull, then push──▶       publishedAt, metaMediaId,
  (still real-publishes from PC)                       permalink, error } }
                                                   .github/workflows/publish.yml
                                                     (hourly cron, ubuntu-latest)
                                                   scripts/publish-due.js
                                                     (pull → filter due & not
                                                      published → call Meta
                                                      Graph API → write result
                                                      → commit + push)
```

## Changes to existing code

### `src/content-central.js`

- New `syncQueueItem(projectId, contentId, action, targetDir)` helper (upsert on approve/regenerate-with-new-image, remove on delete or on the `aprovado → regenerated` transition), invoked from:
  - the `aprovado` transition (~line 2812)
  - the `regenerated` transition inside `applyContentRegeneration` (~line 2670)
  - `deleteProjectContent` (~line 3162), after the local `rm`
- Media upload (`uploadGeneratedImagePublicly` / `uploadGeneratedVideoPublicly`, currently called inside `publishContentToInstagram` at publish time) moves to run at approval time instead, so the queue item written to the gaveta always carries a public URL.

### `src/content-central-server.js`

- `startPublishScheduler` gains a second gate: `OPENSQUAD_AUTO_PUBLISH_SCHEDULER !== 'false'`, independent from `OPENSQUAD_ENABLE_REAL_PUBLISHING`. Local `.env` sets `OPENSQUAD_AUTO_PUBLISH_SCHEDULER=false` so only GitHub's cron runs the time-based sweep, while `OPENSQUAD_ENABLE_REAL_PUBLISHING=true` stays on so "Publicar agora" keeps working.
- `publishSingleContent` (the manual-publish path) does a `git pull` on the local gaveta clone before its `realPublished` check, and a `git commit && git push` right after writing the result.
- `saveProjectToken` (or its caller) shells out to `gh secret set META_TOKEN_<PROJECT_ID> --repo <owner>/<gaveta-repo>` whenever a project's token is saved, using a GitHub PAT stored once in the local `.env`.

### New private repo (the gaveta)

- `queue/<projectId>/<contentId>.json` — one file per approved/scheduled post.
- `scripts/publish-due.js` — a lean, standalone port of `isPublishDue` + `publishOneItem` + the Meta Graph API call (mirrors `meta-publish-multi.js`), reading secrets from the Action's environment (`META_TOKEN_<PROJECT_ID>`, plus each project's `instagramUserId`/`pageId` — either stored per-item in the queue JSON or as additional secrets).
- `.github/workflows/publish.yml` — `on: schedule: cron: '0 * * * *'`, `runs-on: ubuntu-latest` (1x minute multiplier), checkout → `node scripts/publish-due.js` → commit+push any status changes.

## Free-tier accounting

| Item | Cost |
|---|---|
| Private repo Actions minutes | Hourly cron ≈ 720 min/month, within the 2,000 free minutes |
| GitHub Secrets | Free |
| `gh` CLI | Free (already authenticated locally as `jucicleiger-bit`) |
| imgBB / Catbox hosting | Free (already in use today) |

Total added cost: $0/month.

## Testing

- `scripts/publish-due.js` gets its own small test (mirrors the existing pattern in `tests/content-central.test.js` for `runDuePublishSweep`): a fake Meta publisher, asserting it only publishes items that are `aprovado` + due + not yet `realPublished`, and that a second run against the same (now-published) item is a no-op.
- Existing `tests/content-central.test.js` / `tests/content-central-server.test.js` gain coverage for `syncQueueItem` being called on approve, regenerate-away-from-aprovado, and delete.

## Setup steps (one-time, manual)

1. Create the new private GitHub repo.
2. Create a fine-grained GitHub PAT scoped to just that repo (secrets: write), store as `OPENSQUAD_GITHUB_TOKEN` in the local `.env`.
3. Run `gh secret set META_TOKEN_<PROJECT_ID>` once per existing project (6 today) to seed the Actions secrets; after that, the PC keeps them in sync automatically.
4. Set `OPENSQUAD_AUTO_PUBLISH_SCHEDULER=false` in the local `.env`.
