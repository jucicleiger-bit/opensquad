// The per-project planning agent ("cérebro"): its stored chat, current draft
// plan, pending proposals and client notebook, plus the context it reads at
// the start of a conversation. See
// docs/superpowers/specs/2026-10-03-cerebro-do-projeto-design.md.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  applyPlanSlotChoices, buildOfferUsage, getCentralPaths, listProjectContent, listProjectGoalTopics,
  loadProject, localDateKey, normalizeProjectOffers, offersEligibleOn, previewContentSchedulePlan, saveProjectOffer,
  updateProjectContentGoalWeights, validContentGoalWeights,
} from './content-central.js';
import {
  describeBusinessHours, firstOpenTime, isOpenAt, isOpenDay, normalizeBusinessHours, openHours,
} from './content-central-business-hours.js';
import { contractProblems, describeContractedPlan, normalizeContractedPlan, STORY_CHANNELS } from './content-central-contract.js';
import { goalName, slotTag } from './content-central-goals.js';
import { buildPostingTimeStats, loadProjectMetrics } from './content-central-metrics.js';

// What the cérebro may propose to change on an offer. Price, name and photos
// stay with the operator's own form.
const OFFER_FIELDS = new Set(['validFrom', 'validUntil', 'sector', 'active', 'groupId']);
const CHANGE_KINDS = new Set(['offer', 'goalWeights', 'notebook']);
// Same list the generate route accepts (API_SUPPORTED_CHANNELS in
// content-central-server.js): a plan built on any other channel would only
// fail when the operator approves it.
const PLAN_CHANNELS = new Set(['instagram_feed', 'instagram_story', 'instagram_reels', 'facebook_feed', 'facebook_story', 'whatsapp_status']);

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function brainPaths(targetDir, projectId) {
  const dir = join(getCentralPaths(targetDir, projectId).projectDir, 'brain');
  return {
    dir,
    chatPath: join(dir, 'chat.json'),
    planPath: join(dir, 'plan.json'),
    proposalsPath: join(dir, 'proposals.json'),
    notebookPath: join(dir, 'notebook.md'),
  };
}

// Every brain route goes through here first, so a mistyped project id is a
// 404 instead of a brain/ folder created where no project exists.
export async function requireBrainProject(projectId, targetDir) {
  try {
    return await loadProject(getCentralPaths(targetDir, projectId));
  } catch (err) {
    if (/^Project not found/.test(err.message)) throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
    throw err;
  }
}

async function readOr(path, fallback, parse = JSON.parse) {
  try {
    return parse(await readFile(path, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function write(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf-8');
}

export async function readBrainState(projectId, targetDir) {
  const paths = brainPaths(targetDir, projectId);
  return {
    chat: await readOr(paths.chatPath, { sessionId: null, messages: [] }),
    plan: await readOr(paths.planPath, null),
    proposals: await readOr(paths.proposalsPath, []),
    notebook: await readOr(paths.notebookPath, '', (text) => text),
  };
}

export async function appendBrainMessages(projectId, messages, sessionId, targetDir) {
  const paths = brainPaths(targetDir, projectId);
  const chat = await readOr(paths.chatPath, { sessionId: null, messages: [] });
  const next = { sessionId: sessionId || chat.sessionId, messages: [...chat.messages, ...messages] };
  await write(paths.chatPath, next);
  return next;
}

export async function saveNotebook(projectId, text, targetDir) {
  await write(brainPaths(targetDir, projectId).notebookPath, String(text || ''));
}

// A plan's formats repeat every day, so closed days and the slots the cérebro
// skips ("skip", e.g. the days a weekly feed doesn't go out) leave the plan
// and are listed in skippedSlotIds, which generation skips (after their
// rotation turn, so the other slots keep what the preview showed). A slot at
// a closed hour of an open day is the cérebro's to move with "time". A
// closed day keeps its holiday / commemorative post; an extra at a closed
// hour of an open day moves to the day's opening.
function fitPlan(plan, hours) {
  const skippedSlotIds = [];
  const outside = [];
  const dayPlans = plan.dayPlans.map((planDay) => {
    // The operator wants holiday / commemorative posts only on the stories.
    const day = { ...planDay, extras: planDay.extras.filter((extra) => STORY_CHANNELS.includes(extra.channel)) };
    const closed = !isOpenDay(hours, day.date);
    const regular = day.regular.filter((slot) => {
      if (closed || slot.skip) { skippedSlotIds.push(slot.id); return false; }
      return true;
    });
    if (closed || !hours) return { ...day, regular };
    outside.push(...regular.filter((slot) => !isOpenAt(hours, day.date, slot.scheduledTime)).map((slot) => `${slot.id} (${slot.scheduledTime})`));
    const extras = day.extras.map((extra) => (isOpenAt(hours, day.date, extra.scheduledTime) ? extra : { ...extra, scheduledTime: firstOpenTime(hours, day.date) }));
    return { ...day, regular, extras };
  });
  if (outside.length) throw new Error(`Fora do horário de funcionamento: ${outside.join(', ')}. Mova esses horários com "time" ou mude o startTime do formato.`);
  return {
    ...plan,
    dayPlans,
    skippedSlotIds,
    regularCount: dayPlans.reduce((sum, day) => sum + day.regular.length, 0),
    extraCount: dayPlans.reduce((sum, day) => sum + day.extras.length, 0),
  };
}

const KIND_OF_CHANNEL = {
  instagram_story: 'story', facebook_story: 'story', whatsapp_status: 'story', instagram_feed: 'feed', facebook_feed: 'feed', instagram_reels: 'reels',
};

function nextDay(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

// What the cérebro must fix or explain to the operator. With few products a
// repeat is normal, so a consecutive-day repeat only warns while some active
// offer valid on both days went unused on both.
function planWarnings(plan, project, stats, hours) {
  const warnings = new Set();
  const offers = normalizeProjectOffers(project.contentStrategy?.offers || []);
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const days = plan.dayPlans.filter((day) => day.regular.length);
  // Rotation-picked slots carry only offerId; offerIds exists once the cérebro pins offers.
  const idsOf = (slot) => (slot.offerIds?.length ? slot.offerIds : (slot.offerId ? [slot.offerId] : []));
  const offersOn = (day) => new Set(day.regular.flatMap(idsOf));
  for (const day of days) {
    for (const slot of day.regular) {
      for (const id of idsOf(slot)) {
        if (byId.has(id) && !byId.get(id).price) warnings.add(`${byId.get(id).name} está sem preço no post de ${day.date} às ${slot.scheduledTime}.`);
      }
    }
  }
  for (let index = 1; index < days.length; index += 1) {
    const [before, after] = [days[index - 1], days[index]];
    if (nextDay(before.date) !== after.date) continue;
    const used = new Set([...offersOn(before), ...offersOn(after)]);
    const idle = offersEligibleOn(project, [before.date, after.date]).filter((offer) => !used.has(offer.id)).map((offer) => offer.name);
    if (!idle.length) continue;
    for (const id of offersOn(before)) {
      if (offersOn(after).has(id) && byId.has(id)) {
        warnings.add(`${byId.get(id).name} sai em dias seguidos (${before.date} e ${after.date}) e há ofertas sem usar nesses dias: ${idle.slice(0, 5).join(', ')}.`);
      }
    }
  }
  if (hours) {
    const open = openHours(hours);
    for (const kind of ['story', 'feed']) {
      const planned = days.flatMap((day) => day.regular).filter((slot) => KIND_OF_CHANNEL[slot.channel] === kind).map((slot) => Number(slot.scheduledTime.slice(0, 2)));
      if (!planned.length) continue;
      const tried = new Set(stats.filter((entry) => entry.kind === kind).map((entry) => entry.hour));
      const untried = open.filter((hour) => !tried.has(hour));
      if (untried.length && !planned.some((hour) => untried.includes(hour))) {
        warnings.add(`Nenhum ${kind} em horário novo; horas abertas nunca testadas: ${untried.map((hour) => `${hour}h`).join(', ')}.`);
      }
    }
  }
  return [...warnings];
}

// Builds the week through the same preview "Agenda e geração" uses, then
// pins the cérebro's choices. The stored formats are the normalized ones the
// preview used, so approving sends generation exactly what was shown.
export async function saveBrainPlan(projectId, { startDate, days, formats, slots } = {}, targetDir, { topicIdeaGenerator } = {}) {
  if (!isDateKey(String(startDate || ''))) throw new Error('Data inicial inválida: use AAAA-MM-DD.');
  if (!Array.isArray(formats) || !formats.length) throw new Error('O plano precisa de pelo menos um formato (canal, posts por dia, horário).');
  const channels = formats.map((format) => String(format?.channel || '').trim());
  const unsupported = channels.find((channel) => !PLAN_CHANNELS.has(channel));
  if (unsupported !== undefined) throw new Error(`Canal não suportado: "${unsupported}". Use: ${[...PLAN_CHANNELS].join(', ')}.`);
  const preview = await previewContentSchedulePlan(projectId, {
    startDate,
    days: Number(days),
    formats: formats.map((format, index) => ({ ...format, channel: channels[index] })),
    topicIdeaGenerator,
  }, targetDir);
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  // summary and businessHoursWarnings describe the preview before the choices
  // and the trimming, so they would be stale here; nothing reads them.
  // eslint-disable-next-line no-unused-vars
  const { summary, businessHoursWarnings, ...chosen } = await applyPlanSlotChoices(projectId, preview, slots || [], targetDir);
  const hours = normalizeBusinessHours(project.businessHours);
  const fitted = fitPlan(chosen, hours);
  const items = await listProjectContent(projectId, targetDir);
  // Content already scheduled outside the plan's own dates (contractProblems
  // keeps the plan's weeks). Not weekly feeds: rehearsals (test posts), the
  // operator's hand-made encartes and holiday / commemorative posts.
  const planDates = new Set(fitted.dayPlans.map((day) => day.date));
  const existing = items
    .filter((item) => item.status !== 'test_post_simulated' && !['flyer', 'special_date'].includes(item.contentTopic?.source) && !planDates.has(item.scheduledDate))
    .map((item) => ({ date: item.scheduledDate, channel: item.channel }));
  const problems = contractProblems(fitted, normalizeContractedPlan(project.contractedPlan), hours, existing);
  if (problems.length) {
    throw new Error(`O plano não bate com o plano contratado: ${problems.join('; ')}. Ajuste os formatos ou pule horários com "skip".`);
  }
  const stats = buildPostingTimeStats(await loadProjectMetrics(projectId, targetDir), items);
  const plan = { ...fitted, warnings: planWarnings(fitted, project, stats, hours) };
  const stored = { startDate: plan.startDate, days: plan.days, formats: plan.formats, plan, approvedAt: null, updatedAt: new Date().toISOString() };
  await write(brainPaths(targetDir, projectId).planPath, stored);
  return stored;
}

// Recorded after "Aprovar e gerar" succeeds, so the same plan can't be
// generated twice by accident; a new plan from the cérebro starts unapproved.
export async function markBrainPlanApproved(projectId, targetDir) {
  const { planPath } = brainPaths(targetDir, projectId);
  const stored = await readOr(planPath, null);
  if (!stored) throw new Error('Não há plano para aprovar.');
  stored.approvedAt = new Date().toISOString();
  await write(planPath, stored);
  return stored;
}

function findOffer(project, offerId) {
  const offer = normalizeProjectOffers(project.contentStrategy?.offers || []).find((entry) => entry.id === offerId);
  if (!offer) throw new Error(`Oferta ${offerId} não existe.`);
  return offer;
}

// Checks and normalizes what a change would write, so the "antes → depois"
// the operator approves is exactly what gets saved (a malformed date would
// otherwise be saved as "no validity", and "false" as text as active).
function normalizeChange(project, change) {
  if (!CHANGE_KINDS.has(change?.kind)) throw new Error(`Tipo de mudança desconhecido: ${change?.kind}`);
  if (change.kind === 'notebook') return { kind: 'notebook', after: String(change.after ?? '') };
  if (change.kind === 'goalWeights') return { kind: 'goalWeights', after: validContentGoalWeights(project, change.after) };
  if (!OFFER_FIELDS.has(change.field)) throw new Error(`Campo de oferta não permitido: ${change.field}`);
  const offer = findOffer(project, change.offerId);
  let after = change.after;
  if (change.field === 'validFrom' || change.field === 'validUntil') {
    after = String(after ?? '').trim();
    if (after && !isDateKey(after)) throw new Error(`Data inválida em ${change.field} de ${offer.name}: use AAAA-MM-DD, ou "" para apagar.`);
  } else if (change.field === 'sector') {
    after = String(after ?? '').trim();
  } else if (change.field === 'active') {
    if (typeof after !== 'boolean') throw new Error(`"active" de ${offer.name} precisa ser true ou false.`);
  } else {
    after = after ? String(after) : null;
    if (after && !(project.contentStrategy?.offerGroups || []).some((group) => group.id === after)) {
      throw new Error(`Grupo ${after} não existe.`);
    }
  }
  return { kind: 'offer', offerId: offer.id, field: change.field, after };
}

function valueIn(project, notebook, change) {
  if (change.kind === 'notebook') return notebook;
  if (change.kind === 'goalWeights') return project.brandInput?.contentGoalWeights || {};
  return findOffer(project, change.offerId)[change.field];
}

export async function createProposal(projectId, { summary, changes } = {}, targetDir) {
  if (!Array.isArray(changes) || !changes.length) throw new Error('A proposta precisa de pelo menos uma mudança.');
  const project = await requireBrainProject(projectId, targetDir);
  const { notebook } = await readBrainState(projectId, targetDir);
  const withBefore = changes.map((change) => {
    const normalized = normalizeChange(project, change);
    return { ...normalized, before: valueIn(project, notebook, normalized) };
  });
  const proposal = {
    id: randomUUID(),
    summary: String(summary || '').trim(),
    changes: withBefore,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  const paths = brainPaths(targetDir, projectId);
  await write(paths.proposalsPath, [...await readOr(paths.proposalsPath, []), proposal]);
  return proposal;
}

// Refuses a change whose data moved since it was proposed: the operator
// approved "antes → depois", not whatever happens to be there now.
async function applyChange(projectId, change, targetDir) {
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  const { notebook } = await readBrainState(projectId, targetDir);
  if (JSON.stringify(valueIn(project, notebook, change) ?? null) !== JSON.stringify(change.before ?? null)) {
    throw new Error('O dado mudou desde a proposta; peça ao cérebro para propor de novo.');
  }
  if (change.kind === 'notebook') return saveNotebook(projectId, change.after, targetDir);
  if (change.kind === 'goalWeights') return updateProjectContentGoalWeights(projectId, change.after, targetDir);
  return saveProjectOffer(projectId, { ...findOffer(project, change.offerId), [change.field]: change.after }, targetDir);
}

export async function resolveProposal(projectId, proposalId, action, targetDir) {
  if (!['apply', 'reject'].includes(action)) throw new Error(`Ação inválida: ${action}`);
  const paths = brainPaths(targetDir, projectId);
  const proposals = await readOr(paths.proposalsPath, []);
  const proposal = proposals.find((entry) => entry.id === proposalId);
  if (!proposal) throw new Error('Proposta não encontrada.');
  if (proposal.status !== 'pending') throw new Error('Essa proposta já foi resolvida.');
  const results = [];
  if (action === 'apply') {
    for (const [index, change] of proposal.changes.entries()) {
      try {
        await applyChange(projectId, change, targetDir);
        results.push({ index, ok: true });
      } catch (err) {
        results.push({ index, ok: false, error: err.message });
      }
    }
  }
  proposal.status = action === 'reject' ? 'rejected' : results.some((result) => result.ok) ? 'applied' : 'failed';
  proposal.results = results;
  proposal.resolvedAt = new Date().toISOString();
  await write(paths.proposalsPath, proposals);
  return { proposal, results };
}

function offerLine(offer, groups, usage) {
  const use = usage.offers[offer.id] || {};
  const validity = offer.validFrom || offer.validUntil
    ? ` · vale ${[offer.validFrom && `de ${offer.validFrom}`, offer.validUntil && `até ${offer.validUntil}`].filter(Boolean).join(' ')}`
    : ' · vale sempre';
  return [
    `- [${offer.id}] ${offer.name}`,
    offer.price || 'sem preço',
    `setor: ${offer.sector || '(sem setor)'}`,
    `grupo: ${groups.get(offer.groupId) || '-'}`,
  ].join(' · ')
    + validity
    + (offer.daysOfWeek?.length ? ` · só ${offer.daysOfWeek.join(',')}` : '')
    + (offer.active ? '' : ' · PAUSADA')
    + (offer.uniqueProposal ? ' · não entra em combo' : '')
    + ` · saiu ${use.publishedCount || 0}x`
    + (use.nextScheduledDate ? ` · na fila ${use.nextScheduledDate}` : '');
}

const PROPOSAL_STATUS_LABELS = { applied: 'aplicada', rejected: 'recusada', failed: 'não aplicada' };

const KIND_LABELS = { story: 'Story', feed: 'Feed', reels: 'Reels' };

function clip(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function brandLines(project) {
  const input = project.brandInput || {};
  const xray = project.brandXray?.status === 'approved' ? project.brandXray.blocks || {} : {};
  return [
    `Público: ${input.audience || '-'}`,
    `Região: ${input.serviceRegion || '-'}`,
    `Diferencial: ${input.mainDifferential || '-'}`,
    `Tom: ${(input.tone || []).join(', ') || '-'}`,
    `Evitar: ${input.avoid || '-'}`,
    xray.summary?.text ? `Resumo aprovado: ${clip(xray.summary.text, 600)}` : 'Raio-X da marca ainda não aprovado.',
    xray.communication?.text ? `Comunicação: ${clip(xray.communication.text, 600)}` : '',
  ].filter(Boolean).join('\n');
}

function topicBankLines(project, items) {
  const lastUse = new Map();
  for (const item of items) {
    const id = item.contentTopic?.ideaId;
    if (id && String(item.scheduledDate || '') > (lastUse.get(id) || '')) lastUse.set(id, item.scheduledDate);
  }
  return listProjectGoalTopics(project)
    .map((topic) => `- [${topic.ideaId}] (${goalName(topic.goalKey)}) ${topic.title} — ${topic.detail}${lastUse.has(topic.ideaId) ? ` · já saiu ${lastUse.get(topic.ideaId)}` : ''}`)
    .join('\n');
}

function postingTimeLines(stats, hours) {
  const lines = stats.map((entry) => `- ${KIND_LABELS[entry.kind] || entry.kind} às ${entry.hour}h: alcance médio ${entry.avgReach} em ${entry.count} post(s) (maior ${entry.best}, menor ${entry.worst})${entry.count < 3 ? ' — em teste' : ''}`);
  if (hours) {
    const open = openHours(hours);
    for (const kind of ['story', 'feed']) {
      const tried = new Set(stats.filter((entry) => entry.kind === kind).map((entry) => entry.hour));
      const untried = open.filter((hour) => !tried.has(hour));
      if (untried.length) lines.push(`- ${KIND_LABELS[kind]}: horas abertas nunca testadas: ${untried.map((hour) => `${hour}h`).join(', ')}`);
    }
  }
  return lines.join('\n') || '(nenhum post medido ainda)';
}

export async function buildBrainContext(projectId, targetDir) {
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  const state = await readBrainState(projectId, targetDir);
  const items = await listProjectContent(projectId, targetDir);
  const usage = buildOfferUsage(project, items);
  const hours = normalizeBusinessHours(project.businessHours);
  const stats = buildPostingTimeStats(await loadProjectMetrics(projectId, targetDir), items);
  const groups = new Map((project.contentStrategy?.offerGroups || []).map((group) => [group.id, `${group.name} [${group.id}]`]));
  const offers = normalizeProjectOffers(project.contentStrategy?.offers || []).map((offer) => offerLine(offer, groups, usage));
  const skipped = state.plan?.plan?.skippedSlotIds || [];
  const plan = state.plan
    ? [
      `Início ${state.plan.startDate}, ${state.plan.days} dia(s), formatos: ${JSON.stringify(state.plan.formats)}`
        + (state.plan.approvedAt ? ` — JÁ APROVADO e gerado em ${state.plan.approvedAt.slice(0, 10)}; para outra semana monte um plano novo.` : ''),
      ...state.plan.plan.dayPlans.flatMap((day) => day.regular.map((slot) => `- ${slot.id} ${slot.scheduledTime} [${slotTag(slot)}]: ${slot.label}`)),
      ...(skipped.length ? [`Sem post (loja fechada ou pulado): ${skipped.join(', ')}`] : []),
      ...(state.plan?.plan?.warnings?.length ? [`Avisos do plano:\n${state.plan.plan.warnings.map((warning) => `- ${warning}`).join('\n')}`] : []),
    ].join('\n')
    : '(nenhum)';
  const resolved = state.proposals.filter((proposal) => proposal.status !== 'pending').slice(-5).map((proposal) => {
    const errors = (proposal.results || []).filter((result) => !result.ok).map((result) => result.error);
    return `- ${proposal.summary}: ${PROPOSAL_STATUS_LABELS[proposal.status] || proposal.status}${errors.length ? ` (falhou: ${errors.join('; ')})` : ''}`;
  });
  const weights = Object.entries(project.brandInput?.contentGoalWeights || {}).map(([key, value]) => `${goalName(key)} ${value}%`).join(', ');
  const avoid = [...(project.learnings?.avoid || []), ...(project.segmentLearnings?.avoid || [])].slice(0, 10).map((entry) => `- ${entry}`);
  const now = new Date();
  return [
    `# Projeto ${project.name} (${project.projectId})`,
    `Hoje: ${localDateKey(now)} (${now.toLocaleDateString('pt-BR', { weekday: 'long' })})`,
    '## Caderno do cliente',
    state.notebook.trim() || '(vazio)',
    '## Raio-X da marca',
    brandLines(project),
    '## O que evitar',
    avoid.join('\n') || '(nada registrado)',
    '## Objetivos e percentuais do Raio-X',
    `${weights || '(sem percentuais; o sistema divide por igual)'}. O sistema já divide os horários do plano por esses percentuais: cada horário vem marcado [venda] ou com o objetivo.`,
    '## Banco de assuntos',
    topicBankLines(project, items) || '(vazio — marque objetivos no Raio-X)',
    '## Horário de funcionamento',
    hours ? describeBusinessHours(hours) : '(não configurado — peça ao operador para configurar na aba Empresa / Raio-X)',
    '## Plano contratado',
    describeContractedPlan(normalizeContractedPlan(project.contractedPlan)) + (project.contractedPlan ? '' : '\nPeça ao operador para preencher na aba Empresa / Raio-X.'),
    '## Desempenho por horário (Instagram)',
    `Alcance de posts com mais de 24h, por hora em que saíram.\n${postingTimeLines(stats, hours)}`,
    '## Ofertas',
    offers.join('\n') || '(nenhuma)',
    '## Plano atual',
    plan,
    '## Propostas pendentes',
    state.proposals.filter((proposal) => proposal.status === 'pending').map((proposal) => `- ${proposal.id}: ${proposal.summary}`).join('\n') || '(nenhuma)',
    '## Últimas propostas resolvidas',
    resolved.join('\n') || '(nenhuma)',
  ].join('\n\n');
}

const CEREBRO_CLI = fileURLToPath(new URL('../bin/cerebro.js', import.meta.url)).replaceAll('\\', '/');
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

export function brainSystemPrompt(projectId) {
  const cli = `node ${CEREBRO_CLI}`;
  return [
    `Você é o cérebro do projeto "${projectId}" no Content Central: o administrador do planejamento de conteúdo desse cliente (uma loja local).`,
    'O operador (dono da agência) conversa com você para planejar a semana. Fale em português simples, num tom leve e animado de parceiro de trabalho, e use emojis com moderação (um ou dois por bloco) para deixar a conversa mais leve 😊. Não fale de código nem de arquivos.',
    'Formato da resposta: curta e fácil de ler na tela, com negrito e listas. Nunca use tabela nem repita o plano dia a dia: o plano já aparece no painel ao lado. Diga só o que decidiu e por quê (horários, testes, escolhas), os avisos e o que falta o operador fazer.',
    'Você só age pelo comando abaixo, usando a ferramenta Bash. Não leia nem edite arquivos.',
    `- ${cli} context ${projectId}  → estado atual: ofertas (id, setor, validade, uso), caderno, Raio-X, plano e propostas. Rode no começo de cada resposta: o operador pode ter aplicado ou recusado propostas e mudado ofertas na tela.`,
    `- ${cli} plan ${projectId} '<json>'  → monta ou refaz o plano. JSON: {"startDate":"AAAA-MM-DD","days":N,"formats":[{"channel":"${[...PLAN_CHANNELS].join('|')}","postsPerDay":N,"everyDays":1,"startTime":"HH:MM","intervalMinutes":N}],"slots":[{"id":"<id do horário>","offerIds":["<id>"] ou ["<id1>","<id2>"] para combo (só em horário [venda]),"topicId":"<id do banco>" (só em horário de objetivo),"time":"HH:MM" (muda a hora desse post),"skip":true (pula esse post),"reason":"por quê"}]}. Rode primeiro sem "slots" para ver os ids dos horários e o que o rodízio escolheria; depois rode com as suas escolhas. Os ids seguem AAAA-MM-DD-<canal>-NN (NN = 01, 02… por canal por dia). Com plano contratado, a primeira rodada pode ser recusada: leia a mensagem e corrija com "skip"/"time". Horário sem escolha fica com o rodízio automático. Depois de salvar, o comando mostra avisos: corrija cada um ou explique ao operador por que fica assim.`,
    `- ${cli} propose ${projectId} '<json>'  → propõe mudança de cadastro para o operador aprovar. JSON: {"summary":"...","changes":[{"kind":"offer","offerId":"<id>","field":"validFrom|validUntil|sector|active|groupId","after":<valor>} | {"kind":"goalWeights","after":{"sales":N,"<cada objetivo marcado>":N}} | {"kind":"notebook","after":"<caderno inteiro novo>"}]}. Datas em AAAA-MM-DD ("" apaga a validade); active é true ou false; groupId é o id entre colchetes no context; goalWeights traz "sales" e todos os objetivos marcados, somando 100.`,
    'Regras:',
    '- O plano você monta direto. Ofertas, percentuais do Raio-X e caderno você só PROPÕE; o operador aplica na tela.',
    '- O caderno guarda o que vale sempre para esse cliente. Quando o operador disser algo que deve ser lembrado, ou que contradiz o caderno, proponha o caderno novo e diga o que sai e o que entra.',
    '- Combo junta só ofertas do mesmo setor. Oferta fora da validade não entra.',
    '- O Raio-X manda na divisão: oferta só entra em horário marcado [venda]. Nos horários de objetivo, escolha no banco de assuntos (topicId) o que faz sentido para a semana, sem repetir o que saiu há pouco.',
    '- Horário de funcionamento: só programe dentro dele. Dias fechados ficam sem post sozinhos, exceto o post de feriado ou data comemorativa. Se não estiver configurado, peça ao operador para configurar no Raio-X.',
    '- Horários: use o desempenho por horário. Hora com menos de 3 posts medidos está em teste. Enquanto houver horas abertas nunca testadas, ponha cerca de 1 em cada 3 posts numa hora nova (com "time") e diga quais são teste. Com 3 ou mais posts medidos, prefira as horas de maior alcance e cite os números. Nunca tire conclusão de um post só.',
    '- Plano contratado é a regra fixa: monte exatamente os stories por dia (em todos os canais do story, mesma arte) e os feeds por semana. Para feed por semana, use o formato de feed diário e pule ("skip": true) os dias sem feed, escolhendo o melhor dia. O sistema recusa plano fora do contratado. Encartes são feitos à mão pelo operador: você não gera, só lembra quando houver.',
    '- Com poucas ofertas, repetir é normal: siga a sequência do rodízio (a que está há mais tempo sem sair vem primeiro) e só repita em dias seguidos quando não houver outra livre. Oferta sem setor não forma combo: se houver várias sem setor, proponha o setor delas para variar a semana com combos.',
    '- Oferta sem preço em post de venda: avise o operador.',
    '- Story, Reels, Facebook Story e Status do WhatsApp no mesmo horário dividem a mesma arte, assim como Feed e Facebook Feed: a oferta escolhida para um vale para todos.',
    '- Não monte plano começando antes de hoje.',
    '- Você nunca gera nem publica. O operador aprova o plano na tela com "Aprovar e gerar".',
    '- Termine cada resposta dizendo o que você fez e o que espera do operador.',
  ].join('\n');
}

// One turn of the cérebro: `claude -p`, resuming the project's session.
// --setting-sources project keeps the operator's personal plugins and hooks
// (which restyle answers) out; the only tool is Bash, and only the cerebro
// CLI runs without a prompt — anything else is denied in print mode. The
// prompt goes through stdin: the first turn carries the whole project
// context, which can outgrow Windows' command-line limit. serverUrl points
// the CLI at the server that asked, not at the default port: a test bench
// must never write into production.
export function runClaudeTurn({ prompt, sessionId, systemPrompt, cwd, serverUrl }) {
  const args = ['-p', '--output-format', 'json', '--setting-sources', 'project', '--tools', 'Bash',
    '--allowedTools', `Bash(node ${CEREBRO_CLI}:*)`, '--append-system-prompt', systemPrompt];
  if (sessionId) args.push('--resume', sessionId);
  const env = serverUrl ? { ...process.env, CONTENT_CENTRAL_URL: serverUrl } : process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('O cérebro demorou mais de 5 minutos e foi interrompido.'));
    }, CLAUDE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Não consegui abrir o Claude Code: ${err.message}`));
    });
    child.on('close', () => {
      clearTimeout(timer);
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        return reject(new Error((stderr || stdout || 'O Claude Code não respondeu.').trim().slice(0, 500)));
      }
      if (result.is_error) return reject(new Error(String(result.result || 'O Claude Code devolveu erro.')));
      resolve({ sessionId: result.session_id, text: String(result.result || '') });
    });
    child.stdin.end(prompt);
  });
}

const busyProjects = new Set();

// The turn keeps running on the server when the operator leaves the tab, so a
// page that opens mid-turn asks this to keep showing "Pensando…".
export const isBrainBusy = (projectId) => busyProjects.has(projectId);

export async function sendBrainMessage(projectId, text, targetDir, runner = runClaudeTurn, { serverUrl } = {}) {
  const message = String(text || '').trim();
  if (!message) throw Object.assign(new Error('Mensagem vazia.'), { status: 400 });
  await requireBrainProject(projectId, targetDir);
  if (busyProjects.has(projectId)) throw Object.assign(new Error('O cérebro ainda está respondendo.'), { status: 409 });
  busyProjects.add(projectId);
  try {
    const { chat } = await readBrainState(projectId, targetDir);
    await appendBrainMessages(projectId, [{ role: 'user', text: message, at: new Date().toISOString() }], null, targetDir);
    const { dir } = brainPaths(targetDir, projectId);
    await mkdir(dir, { recursive: true });
    const withContext = async () => `${await buildBrainContext(projectId, targetDir)}\n\n---\nMensagem do operador:\n${message}`;
    const turn = async (sessionId, prompt) => runner({ prompt, sessionId, systemPrompt: brainSystemPrompt(projectId), cwd: dir, serverUrl });
    try {
      let reply;
      try {
        reply = await turn(chat.sessionId, chat.sessionId ? message : await withContext());
      } catch (err) {
        // Claude Code deletes old transcripts (after 30 days by default); a
        // session that is gone would fail every turn from then on. Start a
        // new one with the full context — the notebook keeps what matters.
        if (!chat.sessionId || !/No conversation found/i.test(err.message)) throw err;
        reply = await turn(null, await withContext());
      }
      const next = await appendBrainMessages(projectId, [{ role: 'assistant', text: reply.text, at: new Date().toISOString() }], reply.sessionId, targetDir);
      return { chat: next };
    } catch (err) {
      const failed = await appendBrainMessages(projectId, [{ role: 'error', text: err.message, at: new Date().toISOString() }], null, targetDir);
      throw Object.assign(new Error(err.message), { status: 502, chat: failed });
    }
  } finally {
    busyProjects.delete(projectId);
  }
}
