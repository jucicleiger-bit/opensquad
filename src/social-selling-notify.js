// Minimal WAHA text-send helper for social selling alerts (pause/error
// notices to the operator's own WhatsApp) — reuses the same
// OPENSQUAD_WAHA_ADMIN_URL / OPENSQUAD_WAHA_APIKEY env vars the
// whatsapp_status channel already relies on, and WAHA's own documented
// POST /api/sendText endpoint. Never throws: a failed notification must
// not be allowed to crash or wedge either scheduler.
export async function notifySocialSellingOperator(text, config) {
  const url = process.env.OPENSQUAD_WAHA_ADMIN_URL;
  const apiKey = process.env.OPENSQUAD_WAHA_APIKEY;
  const { wahaSessionName, operatorChatId } = config?.notifications || {};
  if (!url || !apiKey || !wahaSessionName || !operatorChatId) {
    console.error('[content-central] social selling notification skipped (WAHA or notifications.* not configured):', text);
    return;
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ session: wahaSessionName, chatId: operatorChatId, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error('[content-central] social selling WAHA notification failed:', res.status, await res.text());
  } catch (err) {
    console.error('[content-central] social selling WAHA notification failed:', err.message);
  }
}
