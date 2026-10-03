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

const CEREBRO_CLI = fileURLToPath(new URL('../bin/cerebro.js', import.meta.url)).replaceAll('\\', '/');
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

export function brainSystemPrompt(projectId) {
  const cli = `node ${CEREBRO_CLI}`;
  return [
    `Você é o cérebro do projeto "${projectId}" no Content Central: o administrador do planejamento de conteúdo desse cliente (uma loja local).`,
    'O operador (dono da agência) conversa com você para planejar a semana. Fale em português simples e direto, como um gerente de marketing. Não fale de código nem de arquivos.',
    'Você só age pelo comando abaixo, usando a ferramenta Bash. Não leia nem edite arquivos.',
    `- ${cli} context ${projectId}  → estado atual: ofertas (id, setor, validade, uso), caderno, Raio-X, plano e propostas.`,
    `- ${cli} plan ${projectId} '<json>'  → monta ou refaz o plano. JSON: {"startDate":"AAAA-MM-DD","days":N,"formats":[{"channel":"instagram_feed|instagram_story|instagram_reels|facebook_feed|facebook_story|whatsapp_status","postsPerDay":N,"everyDays":1,"startTime":"HH:MM","intervalMinutes":N}],"slots":[{"id":"<id do horário>","offerIds":["<id>"] ou ["<id1>","<id2>"] para combo,"reason":"por quê"}]}. Rode primeiro sem "slots" para ver os ids dos horários e o que o rodízio escolheria; depois rode com as suas escolhas. Horário sem escolha fica com o rodízio automático.`,
    `- ${cli} propose ${projectId} '<json>'  → propõe mudança de cadastro para o operador aprovar. JSON: {"summary":"...","changes":[{"kind":"offer","offerId":"<id>","field":"validFrom|validUntil|sector|active|groupId","after":<valor>} | {"kind":"goalWeights","after":{"<objetivo>":<percentual>}} | {"kind":"notebook","after":"<caderno inteiro novo>"}]}. Datas em AAAA-MM-DD; "" apaga a validade.`,
    'Regras:',
    '- O plano você monta direto. Ofertas, percentuais do Raio-X e caderno você só PROPÕE; o operador aplica na tela.',
    '- O caderno guarda o que vale sempre para esse cliente. Quando o operador disser algo que deve ser lembrado, ou que contradiz o caderno, proponha o caderno novo e diga o que sai e o que entra.',
    '- Combo junta só ofertas do mesmo setor. Oferta fora da validade não entra. Story, Reels e Facebook Story no mesmo horário dividem a mesma arte, assim como Feed e Facebook Feed: use a mesma oferta neles.',
    '- Você nunca gera nem publica. O operador aprova o plano na tela com "Aprovar e gerar".',
    '- Termine cada resposta dizendo o que você fez e o que espera do operador.',
  ].join('\n');
}

// One turn of the cérebro: `claude -p`, resuming the project's session.
// --setting-sources project keeps the operator's personal plugins and hooks
// (which restyle answers) out; the only tool is Bash, and only the cerebro
// CLI runs without a prompt — anything else is denied in print mode. The
// prompt goes through stdin: the first turn carries the whole project
// context, which can outgrow Windows' command-line limit.
export function runClaudeTurn({ prompt, sessionId, systemPrompt, cwd }) {
  const args = ['-p', '--output-format', 'json', '--setting-sources', 'project', '--tools', 'Bash',
    '--allowedTools', `Bash(node ${CEREBRO_CLI}:*)`, '--append-system-prompt', systemPrompt];
  if (sessionId) args.push('--resume', sessionId);
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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

export async function sendBrainMessage(projectId, text, targetDir, runner = runClaudeTurn) {
  const message = String(text || '').trim();
  if (!message) throw Object.assign(new Error('Mensagem vazia.'), { status: 400 });
  if (busyProjects.has(projectId)) throw Object.assign(new Error('O cérebro ainda está respondendo.'), { status: 409 });
  busyProjects.add(projectId);
  try {
    const { chat } = await readBrainState(projectId, targetDir);
    await appendBrainMessages(projectId, [{ role: 'user', text: message, at: new Date().toISOString() }], null, targetDir);
    const prompt = chat.sessionId
      ? message
      : `${await buildBrainContext(projectId, targetDir)}\n\n---\nMensagem do operador:\n${message}`;
    const { dir } = brainPaths(targetDir, projectId);
    await mkdir(dir, { recursive: true });
    try {
      const reply = await runner({ prompt, sessionId: chat.sessionId, systemPrompt: brainSystemPrompt(projectId), cwd: dir });
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
