import { loadSocialSellingConfig, withSocialSellingState, findDueLead, nextStage, actionForStage, randomDelayMs } from './social-selling-store.js';
import { isWithinBusinessHours, isUnderDailyLimit, recordAction } from './social-selling-safety.js';

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
      if (!verdict.approved) { skipped.push({ handle: candidate.handle, reason: verdict.reason || 'not_qualified' }); continue; }
      state.leads.push({
        id: candidate.handle,
        handle: candidate.handle,
        source: candidate.source,
        foundOn: candidate.foundOn,
        postUrl: candidate.postUrl,
        postSnippet: candidate.postSnippet,
        stage: 'descoberto',
        nextActionAt: now.toISOString(),
        draftComment: verdict.comment || null,
        draftDm: null,
        discardedReason: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
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
      return { acted: null, reason: 'action_failed', error: err.message };
    }

    if (result?.blocked) {
      state.paused = true;
      state.pausedReason = result.reason || 'instagram_blocked';
      state.pausedAt = now.toISOString();
      return { acted: null, reason: 'blocked', blocked: true };
    }

    recordAction(state.counters, action, now);
    lead.stage = nextStage(lead.stage);
    if (action === 'follow' && result?.draftDm) lead.draftDm = result.draftDm;
    lead.nextActionAt = computeNextActionAt(lead.stage, now, config).toISOString();
    lead.updatedAt = now.toISOString();

    return { acted: { handle: lead.handle, action, newStage: lead.stage }, reason: null };
  });
}
