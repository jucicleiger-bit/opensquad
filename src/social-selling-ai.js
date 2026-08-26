import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(here, 'social-selling-prompts');

let cachedClient = null;
// Prefer this project's own key (OPENSQUAD_* prefix, same convention as
// OPENSQUAD_OPENAI_API_KEY) but keep the SDK's normal fallback chain
// (ANTHROPIC_API_KEY / `ant auth login`) working when it isn't set.
function getClient() {
  if (!cachedClient) {
    cachedClient = process.env.OPENSQUAD_ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.OPENSQUAD_ANTHROPIC_API_KEY })
      : new Anthropic();
  }
  return cachedClient;
}

// Claude is prompted to answer with nothing but a JSON object, but that's
// a request, not a guarantee — pull the first {...} block out of
// whatever text comes back instead of assuming it parses as-is.
export function parseJsonResponse(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function qualifySocialSellingLead(candidate, config) {
  const systemPrompt = await readFile(join(PROMPTS_DIR, 'qualify-lead.md'), 'utf-8');
  const response = await getClient().messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        `Perfil: ${candidate.handle}`,
        `Fonte: ${candidate.source} (${candidate.foundOn})`,
        `Post: ${candidate.postSnippet || '(sem prévia)'}`,
        `Critério: no máximo ${config.qualification.maxFollowers} seguidores; descartar se a bio citar: ${config.qualification.excludeBioKeywords.join(', ')}.`,
        'Responda só com um JSON: {"approved": boolean, "reason": string, "comment": string}',
      ].join('\n'),
    }],
  });
  const text = response.content.find((block) => block.type === 'text')?.text;
  const parsed = parseJsonResponse(text) || {};
  return { approved: !!parsed.approved, reason: parsed.reason || '', comment: parsed.comment || '' };
}

// eslint-disable-next-line no-unused-vars
export async function draftSocialSellingDm(lead, _config) {
  const systemPrompt = await readFile(join(PROMPTS_DIR, 'draft-message.md'), 'utf-8');
  const response = await getClient().messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        `Perfil: ${lead.handle}`,
        `Post original: ${lead.postSnippet || '(sem prévia)'}`,
        `Comentário já feito: ${lead.draftComment || '(nenhum)'}`,
        'Responda só com um JSON: {"dm": string}',
      ].join('\n'),
    }],
  });
  const text = response.content.find((block) => block.type === 'text')?.text;
  const parsed = parseJsonResponse(text) || {};
  return parsed.dm || '';
}
