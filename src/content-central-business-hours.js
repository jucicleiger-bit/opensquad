// The client's opening hours, set in the Raio-X (project.businessHours). The
// cérebro only plans posts inside them; "Agenda e geração" only warns. Not
// the social-selling businessHours (src/social-selling-safety.js): that one
// is a single window for the agency's own outreach.
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEK_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_LABELS = { mon: 'segunda', tue: 'terça', wed: 'quarta', thu: 'quinta', fri: 'sexta', sat: 'sábado', sun: 'domingo' };

export const isClockTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ''));

// Strict: the operator's form gets the reason it was not saved. A week with
// every day empty is "not configured" (null): an all-closed shop can't be
// planned for, and it is most likely the untouched card being saved.
export function validateBusinessHours(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Horário de funcionamento inválido.');
  const hours = {};
  for (const day of WEEK_ORDER) {
    const label = WEEKDAY_LABELS[day];
    const periods = input[day] ?? [];
    if (!Array.isArray(periods) || periods.length > 2) throw new Error(`${label}: no máximo dois períodos.`);
    const clean = periods.map((period) => ({ from: String(period?.from ?? ''), to: String(period?.to ?? '') }));
    for (const period of clean) {
      if (!isClockTime(period.from) || !isClockTime(period.to)) throw new Error(`${label}: use HH:MM.`);
      if (period.to === '00:00') throw new Error(`${label}: para fechar à meia-noite use 23:59.`);
      if (period.from >= period.to) throw new Error(`${label}: a abertura precisa ser antes do fechamento.`);
    }
    clean.sort((a, b) => a.from.localeCompare(b.from));
    if (clean.length === 2 && clean[1].from < clean[0].to) throw new Error(`${label}: os períodos se sobrepõem.`);
    hours[day] = clean;
  }
  return WEEK_ORDER.some((day) => hours[day].length) ? hours : null;
}

// Lenient read of what is stored: anything malformed reads as not configured.
export function normalizeBusinessHours(value) {
  try {
    return value ? validateBusinessHours(value) : null;
  } catch {
    return null;
  }
}

function weekdayOf(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function isOpenDay(hours, dateKey) {
  return !hours || hours[weekdayOf(dateKey)].length > 0;
}

// The closing minute counts as closed: from <= time < to.
export function isOpenAt(hours, dateKey, time) {
  if (!hours) return true;
  return hours[weekdayOf(dateKey)].some((period) => period.from <= time && time < period.to);
}

export function firstOpenTime(hours, dateKey) {
  return hours?.[weekdayOf(dateKey)][0]?.from || null;
}

export function openHours(hours) {
  return [...Array(24).keys()].filter((hour) => {
    const time = `${String(hour).padStart(2, '0')}:00`;
    return WEEK_ORDER.some((day) => hours[day].some((period) => period.from <= time && time < period.to));
  });
}

export function describeBusinessHours(hours) {
  if (!hours) return '(não configurado)';
  return WEEK_ORDER.map((day) => `- ${WEEKDAY_LABELS[day]}: ${hours[day].length ? hours[day].map((period) => `${period.from}–${period.to}`).join(' e ') : 'fechado'}`).join('\n');
}
