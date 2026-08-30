// Zero-cost stand-ins for social-selling-ai.js — used when config.useAi is
// false, so the feature can run without ever calling the Claude API.
// Qualification loses AI judgment (approves anything with a real caption);
// comments/DMs lose per-lead personalization (same text every time, from
// config.messageTemplates) — the trade-off for free operation.

export function qualifyWithTemplate(candidate, config) {
  const hasCaption = !!(candidate.postSnippet && candidate.postSnippet.trim());
  if (!hasCaption) return { approved: false, reason: 'no_caption', comment: '' };
  return { approved: true, reason: '', comment: config.messageTemplates.comment };
}

export function draftDmWithTemplate(lead, config) {
  return config.messageTemplates.dm;
}
