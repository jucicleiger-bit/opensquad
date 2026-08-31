//
// Cloud equivalent of listSystemAlerts/alertNotificationKey/
// alertEmailSubject/alertEmailBody/the cooldown check in
// src/content-central.js (sendDueAlertEmails) — scoped down to what the
// cloud publish-sweep can actually see (no local-generation-only alert
// types). Zero Deno-specific APIs — same portability rule as meta-publish.js.

const TOKEN_EXPIRING_WITHIN_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysRemaining(expiresAt, now) {
  return Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS);
}

function subjectFor(type, projectName) {
  const icon = type === 'token_expired' ? '🔴' : type === 'token_expiring' ? '🟡' : '⚠️';
  const topic = type === 'publish_failed' ? 'falha ao publicar' : 'token da Meta';
  return `${icon} [Opensquad] ${projectName} — ${topic}`;
}

// projects: [{ id, name, instagram_token_expires_at }]
// failedItems: [{ id, project_id, project_name, content_id, channel, publish_error }]
export function buildAlerts({ projects, failedItems }, now = new Date()) {
  const alerts = [];

  for (const project of projects) {
    if (!project.instagram_token_expires_at) continue;
    const remaining = daysRemaining(project.instagram_token_expires_at, now);
    if (remaining <= 0) {
      alerts.push({
        type: 'token_expired',
        key: `token_expired:${project.id}`,
        subject: subjectFor('token_expired', project.name),
        body: `Token da Meta expirado — publicação real vai falhar até renovar.\n\nProjeto: ${project.name} (${project.id})`,
      });
    } else if (remaining <= TOKEN_EXPIRING_WITHIN_DAYS) {
      alerts.push({
        type: 'token_expiring',
        key: `token_expiring:${project.id}`,
        subject: subjectFor('token_expiring', project.name),
        body: `Token da Meta vence em ${remaining} dia(s).\n\nProjeto: ${project.name} (${project.id})`,
      });
    }
  }

  for (const item of failedItems) {
    alerts.push({
      type: 'publish_failed',
      key: `publish_failed:${item.project_id}:${item.content_id}`,
      subject: subjectFor('publish_failed', item.project_name),
      body: `Falha ao publicar "${item.content_id}" (${item.channel}): ${item.publish_error}\n\nProjeto: ${item.project_name} (${item.project_id})`,
    });
  }

  return alerts;
}

// alerts: Alert[]; notified: { [key]: isoTimestamp }
export function dueAlerts(alerts, notified, now, cooldownMs) {
  return alerts.filter((alert) => {
    const lastSentAt = notified[alert.key] ? new Date(notified[alert.key]) : null;
    if (!lastSentAt || Number.isNaN(lastSentAt.getTime())) return true;
    return now.getTime() - lastSentAt.getTime() >= cooldownMs;
  });
}
