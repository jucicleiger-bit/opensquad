export const ACTION_TYPES = ['like', 'comment', 'follow', 'dm'];

// `now` is read in the server process's own local time zone — this
// scheduler is designed to run on the operator's own PC (same
// assumption as the whatsapp_status local scheduler), so "business
// hours" means business hours where that PC lives, not UTC.
export function isWithinBusinessHours(now, businessHours) {
  const day = now.getDay();
  const hour = now.getHours();
  return businessHours.days.includes(day) && hour >= businessHours.startHour && hour < businessHours.endHour;
}

function todayKey(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function isUnderDailyLimit(counters, action, dailyLimits, now) {
  const key = todayKey(now);
  const count = counters.date === key ? (counters[action] || 0) : 0;
  const limit = dailyLimits[action];
  return typeof limit !== 'number' || count < limit;
}

export function recordAction(counters, action, now) {
  const key = todayKey(now);
  if (counters.date !== key) {
    for (const type of ACTION_TYPES) counters[type] = 0;
    counters.date = key;
  }
  counters[action] = (counters[action] || 0) + 1;
}
