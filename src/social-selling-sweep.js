import { loadSocialSellingConfig, withSocialSellingState, findDueLead, nextStage, actionForStage, randomDelayMs } from './social-selling-store.js';
import { isWithinBusinessHours, isUnderDailyLimit, recordAction } from './social-selling-safety.js';

// A lead's own profile page, derived from the handle — the only URL we can
// trust to be theirs. `postUrl` is the post they were *found* on, which for
// a reference-mined lead belongs to the reference account, not to them.
function profileUrlFor(handle) {
  return `https://www.instagram.com/${handle.replace(/^@/, '')}/`;
}

// A failed action is retried at most this many times before the lead is
// dropped — otherwise one permanently broken lead sits at the head of the
// due queue and blocks every other lead behind it forever.
const MAX_ACTION_ATTEMPTS = 3;
const FAILED_ACTION_RETRY_MS = { min: 1800000, max: 3600000 };

export async function runSocialSellingRadarSweep(targetDir, options = {}) {
  if (typeof options.discover !== 'function' || typeof options.qualify !== 'function') {
    return { discovered: [], skipped: [], blocked: null };
  }
  const now = options.now || new Date();
  const config = options.config || await loadSocialSellingConfig(targetDir);
  const discovered = [];
  const skipped = [];
  let blocked = null;

  await withSocialSellingState(targetDir, async (state) => {
    if (state.paused) return;
    const known = new Set(state.leads.map((lead) => lead.id));

    let candidates;
    try {
      candidates = await options.discover(config);
    } catch (err) {
      if (!err.blocked) throw err;
      state.paused = true;
      state.pausedReason = err.reason || 'instagram_blocked';
      state.pausedAt = now.toISOString();
      blocked = state.pausedReason;
      return;
    }

    for (const candidate of candidates) {
      if (known.has(candidate.handle)) { skipped.push({ handle: candidate.handle, reason: 'duplicate' }); continue; }
      const verdict = await options.qualify(candidate, config);
      const base = {
        id: candidate.handle,
        handle: candidate.handle,
        source: candidate.source,
        foundOn: candidate.foundOn,
        postUrl: candidate.postUrl,
        profileUrl: profileUrlFor(candidate.handle),
        postSnippet: candidate.postSnippet,
        draftDm: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      if (!verdict.approved) {
        // Stored as a terminal `descartado` lead, not just skipped: `known`
        // is built from state.leads, so a rejected profile that isn't stored
        // gets re-discovered and re-qualified (a paid AI call) every sweep.
        state.leads.push({
          ...base,
          stage: 'descartado',
          nextActionAt: now.toISOString(),
          draftComment: null,
          discardedReason: verdict.reason || 'not_qualified',
        });
        known.add(candidate.handle);
        skipped.push({ handle: candidate.handle, reason: verdict.reason || 'not_qualified' });
        continue;
      }

      // Reference-mined leads are people who liked the *reference account's*
      // post — we have no post that's genuinely theirs to like or comment on,
      // so they skip straight to the profile-level part of the funnel (next
      // action: follow) and carry no draft comment.
      const fromReference = candidate.source === 'reference_mining';
      state.leads.push({
        ...base,
        stage: fromReference ? 'comentado' : 'descoberto',
        nextActionAt: new Date(now.getTime() + randomDelayMs(config.initialActionDelayMs.min, config.initialActionDelayMs.max)).toISOString(),
        draftComment: fromReference ? null : (verdict.comment || null),
        discardedReason: null,
      });
      known.add(candidate.handle);
      discovered.push(candidate.handle);
    }
  });

  return { discovered, skipped, blocked };
}

function computeNextActionAt(stage, now, config) {
  if (stage === 'like') {
    return new Date(now.getTime() + randomDelayMs(config.transitionDelayMs.toComentado.min, config.transitionDelayMs.toComentado.max));
  }
  if (stage === 'comentado') {
    const days = randomDelayMs(config.transitionDelayMs.toSeguidoDays.min, config.transitionDelayMs.toSeguidoDays.max);
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }
  if (stage === 'seguido') {
    return new Date(now.getTime() + randomDelayMs(config.transitionDelayMs.toDmEnviado.min, config.transitionDelayMs.toDmEnviado.max));
  }
  return now; // dm_enviado is terminal — value is never read again
}

export async function runSocialSellingEngagementSweep(targetDir, options = {}) {
  if (typeof options.performAction !== 'function') return { acted: null, reason: 'no_performer' };
  const now = options.now || new Date();
  const config = options.config || await loadSocialSellingConfig(targetDir);

  if (!isWithinBusinessHours(now, config.businessHours)) {
    return { acted: null, reason: 'outside_business_hours' };
  }

  return withSocialSellingState(targetDir, async (state) => {
    if (state.paused) return { acted: null, reason: 'paused' };
    state.counters = state.counters || {};

    const lead = findDueLead(state, now);
    if (!lead) return { acted: null, reason: 'no_due_lead' };

    const action = actionForStage(lead.stage);
    if (!action) return { acted: null, reason: 'terminal_stage' };

    if (!isUnderDailyLimit(state.counters, action, config.dailyLimits, now)) {
      return { acted: null, reason: `daily_limit_${action}` };
    }

    let result;
    try {
      result = await options.performAction({ lead, action, config });
    } catch (err) {
      // `lead` is the live object inside state.leads (findDueLead returns a
      // reference, same as the success path below relies on), so these
      // mutations are persisted by withSocialSellingState.
      lead.attempts = (lead.attempts || 0) + 1;
      lead.updatedAt = now.toISOString();
      if (lead.attempts >= MAX_ACTION_ATTEMPTS) {
        lead.stage = 'descartado';
        lead.discardedReason = 'action_failed_repeatedly';
        return { acted: null, reason: 'action_failed', error: err.message, handle: lead.handle, giveUp: true };
      }
      // Push it out of the due queue, otherwise the very next tick retries
      // the same failing lead and nothing else ever gets a turn.
      lead.nextActionAt = new Date(now.getTime() + randomDelayMs(FAILED_ACTION_RETRY_MS.min, FAILED_ACTION_RETRY_MS.max)).toISOString();
      return { acted: null, reason: 'action_failed', error: err.message, handle: lead.handle };
    }

    if (result?.blocked) {
      state.paused = true;
      state.pausedReason = result.reason || 'instagram_blocked';
      state.pausedAt = now.toISOString();
      return { acted: null, reason: 'blocked', blocked: true, blockedReason: state.pausedReason };
    }

    lead.attempts = 0;
    recordAction(state.counters, action, now);
    lead.stage = nextStage(lead.stage);
    if (action === 'follow' && result?.draftDm) lead.draftDm = result.draftDm;
    lead.nextActionAt = computeNextActionAt(lead.stage, now, config).toISOString();
    lead.updatedAt = now.toISOString();

    return { acted: { handle: lead.handle, action, newStage: lead.stage }, reason: null };
  });
}
