#!/usr/bin/env node
// The only door the cérebro (Claude Code, see src/content-central-brain.js)
// has into Content Central. It goes through the local HTTP API, so every
// existing validation and project lock applies.
import { slotTag } from '../src/content-central-goals.js';

const base = process.env.CONTENT_CENTRAL_URL || `http://127.0.0.1:${process.env.CONTENT_CENTRAL_PORT || 3333}`;
const [command, projectId, json] = process.argv.slice(2);

async function call(path, body) {
  const response = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/brain${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function parse(text) {
  try {
    return JSON.parse(text || '{}');
  } catch (err) {
    throw new Error(`JSON inválido: ${err.message}`, { cause: err });
  }
}

try {
  if (!projectId) throw new Error('Uso: cerebro <context|plan|apply|propose> <projeto> [json]');
  if (command === 'context') {
    console.log((await call('/context')).text);
  } else if (command === 'plan') {
    const stored = await call('/plan', parse(json));
    for (const day of stored.plan.dayPlans) {
      for (const slot of day.regular) console.log(`${slot.id} · ${slot.scheduledTime} · ${slot.channelLabel} [${slotTag(slot)}]${slot.topicId ? ` (assunto ${slot.topicId})` : ''}: ${slot.label}`);
      for (const extra of day.extras) console.log(`${day.date} · extra: ${extra.label}`);
    }
    if (stored.plan.skippedSlotIds?.length) console.log(`Sem post (loja fechada ou pulado): ${stored.plan.skippedSlotIds.join(', ')}`);
    for (const warning of stored.plan.warnings || []) console.log(`Aviso: ${warning}`);
    console.log('Plano salvo; o operador vê e aprova na tela.');
  } else if (command === 'propose') {
    const proposal = await call('/proposals', parse(json));
    console.log(`Proposta criada (${proposal.id}); aguardando o operador aplicar.`);
  } else if (command === 'apply') {
    // Keep the same proposal audit trail as the UI, but execute an explicit
    // operator request immediately so the cérebro can work as their proxy.
    const proposal = await call('/proposals', parse(json));
    const resolved = await call(`/proposals/${encodeURIComponent(proposal.id)}/apply`, {});
    const failed = (resolved.results || []).filter((result) => !result.ok);
    if (failed.length) throw new Error(failed.map((result) => result.error).filter(Boolean).join(' ') || 'A alteração não pôde ser aplicada.');
    console.log(`Alteração aplicada (${proposal.id}) e registrada no histórico.`);
  } else {
    throw new Error(`Comando desconhecido: ${command}`);
  }
} catch (err) {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
}
