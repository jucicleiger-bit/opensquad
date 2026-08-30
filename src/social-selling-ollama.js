// Zero-cost AI adapter — same prompts as social-selling-ai.js, but sent to
// a local Ollama server instead of the Claude API. Draws on the operator's
// own machine/electricity only, never touches an Anthropic account or its
// usage limits. Quality is lower than Opus (small local model), and every
// call needs Ollama running locally (`ollama serve`, started automatically
// by the Windows app/service once installed).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseJsonResponse } from './social-selling-ai.js';

const here = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(here, 'social-selling-prompts');

async function chatWithOllama(systemPrompt, userPrompt, config) {
  const baseUrl = (config.ollama?.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  const model = config.ollama?.model || 'qwen2.5:1.5b';
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(Number(config.ollama?.timeoutMs) || 60000),
  });
  if (!res.ok) throw new Error(`Ollama respondeu ${res.status}: ${await res.text()}`);
  const parsed = await res.json();
  return parsed.message?.content || '';
}

export async function qualifyWithOllama(candidate, config) {
  const systemPrompt = await readFile(join(PROMPTS_DIR, 'qualify-lead.md'), 'utf-8');
  const userPrompt = [
    `Perfil: ${candidate.handle}`,
    `Fonte: ${candidate.source} (${candidate.foundOn})`,
    `Post: ${candidate.postSnippet || '(sem prévia)'}`,
    `Critério: no máximo ${config.qualification.maxFollowers} seguidores; descartar se a bio citar: ${config.qualification.excludeBioKeywords.join(', ')}.`,
    'Responda só com um JSON: {"approved": boolean, "reason": string, "comment": string}',
  ].join('\n');
  const text = await chatWithOllama(systemPrompt, userPrompt, config);
  const parsed = parseJsonResponse(text) || {};
  return { approved: !!parsed.approved, reason: parsed.reason || '', comment: parsed.comment || '' };
}

export async function draftDmWithOllama(lead, config) {
  const systemPrompt = await readFile(join(PROMPTS_DIR, 'draft-message.md'), 'utf-8');
  const userPrompt = [
    `Perfil: ${lead.handle}`,
    `Post original: ${lead.postSnippet || '(sem prévia)'}`,
    `Comentário já feito: ${lead.draftComment || '(nenhum)'}`,
    'Responda só com um JSON: {"dm": string}',
  ].join('\n');
  const text = await chatWithOllama(systemPrompt, userPrompt, config);
  const parsed = parseJsonResponse(text) || {};
  return parsed.dm || '';
}
