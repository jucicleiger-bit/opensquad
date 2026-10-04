// What the client bought, filled in by hand per project
// (project.contractedPlan): stories a day, feeds a week, the channels each
// goes to (a story is one art on all of them) and how many encartes a month
// the operator makes by hand. The cérebro plans to it; saveBrainPlan checks.
import { isOpenDay } from './content-central-business-hours.js';

export const STORY_CHANNELS = ['instagram_story', 'facebook_story', 'whatsapp_status'];
export const FEED_CHANNELS = ['instagram_feed', 'facebook_feed'];
const CHANNEL_NAMES = {
  instagram_story: 'Instagram', facebook_story: 'Facebook', whatsapp_status: 'Status do WhatsApp',
  instagram_feed: 'Instagram', facebook_feed: 'Facebook',
};

function count(value, label, max) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new Error(`${label}: use um número inteiro de 0 a ${max}.`);
  return number;
}

function channels(value, allowed, label) {
  const list = Array.isArray(value) ? value.map(String) : [];
  const unknown = list.find((channel) => !allowed.includes(channel));
  if (unknown) throw new Error(`${label}: canal desconhecido "${unknown}".`);
  return allowed.filter((channel) => list.includes(channel));
}

// Strict: the operator's form gets the reason. All counts at zero reads as
// not configured.
export function validateContractedPlan(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Plano contratado inválido.');
  const plan = {
    storiesPerDay: count(input.storiesPerDay, 'Stories por dia', 10),
    feedsPerWeek: count(input.feedsPerWeek, 'Feed por semana', 14),
    storyChannels: channels(input.storyChannels, STORY_CHANNELS, 'Canais do story'),
    feedChannels: channels(input.feedChannels, FEED_CHANNELS, 'Canais do feed'),
    flyersPerMonth: count(input.flyersPerMonth, 'Encartes por mês', 31),
  };
  if (plan.storiesPerDay && !plan.storyChannels.length) throw new Error('Escolha em quais canais o story sai.');
  if (plan.feedsPerWeek && !plan.feedChannels.length) throw new Error('Escolha em quais canais o feed sai.');
  if (!plan.storiesPerDay && !plan.feedsPerWeek && !plan.flyersPerMonth) return null;
  return plan;
}

export function normalizeContractedPlan(value) {
  try {
    return value ? validateContractedPlan(value) : null;
  } catch {
    return null;
  }
}

const names = (list) => list.map((channel) => CHANNEL_NAMES[channel]).join(', ');

export function describeContractedPlan(plan) {
  if (!plan) return '(não configurado)';
  return [
    `- Stories por dia: ${plan.storiesPerDay}${plan.storiesPerDay ? ` (mesma arte em: ${names(plan.storyChannels)})` : ''}`,
    `- Feed por semana: ${plan.feedsPerWeek}${plan.feedsPerWeek ? ` (em: ${names(plan.feedChannels)})` : ''}`,
    `- Encartes por mês: ${plan.flyersPerMonth}${plan.flyersPerMonth ? ' (feitos à mão pelo operador; você não gera, só lembra)' : ''}`,
  ].join('\n');
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Monday of the date's week.
function weekStart(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return addDays(dateKey, -((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7));
}

// Every way the plan departs from the contract, [] when it matches. Closed
// days are expected empty (saveBrainPlan empties them first). Feeds are
// counted per Monday–Sunday week, the plan's plus `existing` ([{ date,
// channel }]: content already scheduled outside the plan's dates): never more
// than contracted, and exactly that many when the plan covers every open day
// of the week from its first date on (earlier days are past or already planned).
export function contractProblems(plan, contract, hours, existing = []) {
  if (!contract) return [];
  const problems = [];
  const storyChannels = contract.storiesPerDay ? contract.storyChannels : [];
  const feedChannels = contract.feedsPerWeek ? contract.feedChannels : [];
  const used = new Set(plan.dayPlans.flatMap((day) => day.regular.map((slot) => slot.channel)));
  for (const channel of used) if (![...storyChannels, ...feedChannels].includes(channel)) problems.push(`o canal ${channel} não está no plano contratado`);
  // Feeds are weekly, so a short plan may rightly have none; the week count below covers them.
  for (const channel of storyChannels) if (!used.has(channel)) problems.push(`falta o canal ${channel} do plano contratado`);
  for (const day of plan.dayPlans.filter((entry) => isOpenDay(hours, entry.date))) {
    for (const channel of storyChannels) {
      const posts = day.regular.filter((slot) => slot.channel === channel).length;
      if (posts !== contract.storiesPerDay) problems.push(`${day.date}: ${posts} post(s) em ${channel}, o contratado é ${contract.storiesPerDay} por dia`);
    }
  }
  if (feedChannels.length) {
    const covered = new Set(plan.dayPlans.map((day) => day.date));
    const first = [...covered].sort()[0];
    for (const start of new Set(plan.dayPlans.map((day) => weekStart(day.date)))) {
      const weekDays = Array.from({ length: 7 }, (_, index) => addDays(start, index));
      const toCover = weekDays.filter((date) => date >= first && isOpenDay(hours, date));
      const coversWeek = toCover.length > 0 && toCover.every((date) => covered.has(date));
      for (const channel of feedChannels) {
        const slots = plan.dayPlans.filter((day) => weekDays.includes(day.date)).flatMap((day) => day.regular).filter((slot) => slot.channel === channel);
        const feeds = slots.length + existing.filter((entry) => entry.channel === channel && weekDays.includes(entry.date)).length;
        if (feeds > contract.feedsPerWeek || (coversWeek && feeds < contract.feedsPerWeek)) {
          const ids = feeds > contract.feedsPerWeek && slots.every((slot) => slot.id) ? slots.map((slot) => slot.id) : [];
          const skip = ids.length ? ` — pule ("skip": true) até sobrar ${contract.feedsPerWeek}: ${ids.join(', ')}` : '';
          problems.push(`semana de ${start}: ${feeds} feed(s) em ${channel}, o contratado é ${contract.feedsPerWeek} por semana${skip}`);
        }
      }
    }
  }
  return problems;
}
