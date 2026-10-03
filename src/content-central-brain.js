// The per-project planning agent ("cérebro"): its stored chat, current draft
// plan, pending proposals and client notebook, plus the context it reads at
// the start of a conversation. See
// docs/superpowers/specs/2026-10-03-cerebro-do-projeto-design.md.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  applyPlanSlotChoices, buildOfferUsage, getCentralPaths, listProjectContent, loadProject,
  normalizeProjectOffers, previewContentSchedulePlan, saveProjectOffer, updateProjectBrandInput,
} from './content-central.js';

// What the cérebro may propose to change on an offer. Price, name and photos
// stay with the operator's own form.
const OFFER_FIELDS = new Set(['validFrom', 'validUntil', 'sector', 'active', 'groupId']);
const CHANGE_KINDS = new Set(['offer', 'goalWeights', 'notebook']);

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

export async function saveBrainPlan(projectId, { startDate, days, formats, slots } = {}, targetDir) {
  if (!Array.isArray(formats) || !formats.length) throw new Error('O plano precisa de pelo menos um formato (canal, posts por dia, horário).');
  const preview = await previewContentSchedulePlan(projectId, { startDate, days: Number(days), formats }, targetDir);
  const plan = await applyPlanSlotChoices(projectId, preview, slots || [], targetDir);
  const stored = { startDate: plan.startDate, days: plan.days, formats, plan, updatedAt: new Date().toISOString() };
  await write(brainPaths(targetDir, projectId).planPath, stored);
  return stored;
}

function checkChange(change) {
  if (!CHANGE_KINDS.has(change?.kind)) throw new Error(`Tipo de mudança desconhecido: ${change?.kind}`);
  if (change.kind === 'offer' && !OFFER_FIELDS.has(change.field)) throw new Error(`Campo de oferta não permitido: ${change.field}`);
}

async function currentValue(projectId, change, targetDir) {
  if (change.kind === 'notebook') return (await readBrainState(projectId, targetDir)).notebook;
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  if (change.kind === 'goalWeights') return project.brandInput?.contentGoalWeights || {};
  const offer = normalizeProjectOffers(project.contentStrategy?.offers || []).find((entry) => entry.id === change.offerId);
  if (!offer) throw new Error(`Oferta ${change.offerId} não existe.`);
  return offer[change.field];
}

export async function createProposal(projectId, { summary, changes } = {}, targetDir) {
  if (!Array.isArray(changes) || !changes.length) throw new Error('A proposta precisa de pelo menos uma mudança.');
  const withBefore = [];
  for (const change of changes) {
    checkChange(change);
    withBefore.push({ ...change, before: await currentValue(projectId, change, targetDir) });
  }
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
  const now = await currentValue(projectId, change, targetDir);
  if (JSON.stringify(now ?? null) !== JSON.stringify(change.before ?? null)) {
    throw new Error('O dado mudou desde a proposta; peça ao cérebro para propor de novo.');
  }
  if (change.kind === 'notebook') return saveNotebook(projectId, change.after, targetDir);
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  if (change.kind === 'goalWeights') {
    return updateProjectBrandInput(projectId, { ...project.brandInput, contentGoalWeights: change.after }, targetDir);
  }
  const offer = normalizeProjectOffers(project.contentStrategy?.offers || []).find((entry) => entry.id === change.offerId);
  return saveProjectOffer(projectId, { ...offer, [change.field]: change.after }, targetDir);
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
  proposal.status = action === 'apply' ? 'applied' : 'rejected';
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

export async function buildBrainContext(projectId, targetDir) {
  const project = await loadProject(getCentralPaths(targetDir, projectId));
  const state = await readBrainState(projectId, targetDir);
  const usage = buildOfferUsage(project, await listProjectContent(projectId, targetDir));
  const groups = new Map((project.contentStrategy?.offerGroups || []).map((group) => [group.id, group.name]));
  const offers = normalizeProjectOffers(project.contentStrategy?.offers || []).map((offer) => offerLine(offer, groups, usage));
  const plan = state.plan
    ? [
      `Início ${state.plan.startDate}, ${state.plan.days} dia(s), formatos: ${JSON.stringify(state.plan.formats)}`,
      ...state.plan.plan.dayPlans.flatMap((day) => day.regular.map((slot) => `- ${slot.id} ${slot.scheduledTime}: ${slot.label}`)),
    ].join('\n')
    : '(nenhum)';
  return [
    `# Projeto ${project.name} (${project.projectId})`,
    `Hoje: ${new Date().toISOString().slice(0, 10)}`,
    '## Caderno do cliente',
    state.notebook.trim() || '(vazio)',
    '## Ofertas',
    offers.join('\n') || '(nenhuma)',
    '## Objetivos e percentuais do Raio-X',
    `Objetivos marcados: ${(project.brandInput?.contentGoals || []).join(', ') || '(nenhum)'}; percentuais: ${JSON.stringify(project.brandInput?.contentGoalWeights || {})}`,
    '## Plano atual',
    plan,
    '## Propostas pendentes',
    state.proposals.filter((proposal) => proposal.status === 'pending').map((proposal) => `- ${proposal.id}: ${proposal.summary}`).join('\n') || '(nenhuma)',
  ].join('\n\n');
}
