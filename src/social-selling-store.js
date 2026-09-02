import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getCentralPaths } from './content-central.js';

export const STAGE_ORDER = ['descoberto', 'like', 'comentado', 'seguido', 'dm_enviado'];
export const TERMINAL_STAGES = new Set(['dm_enviado', 'descartado']);

export const DEFAULT_SOCIAL_SELLING_CONFIG = {
  hashtags: [],
  locationHashtags: [],
  referenceAccounts: [],
  qualification: {
    maxFollowers: 5000,
    excludeBioKeywords: ['agência', 'marketing digital', 'social media'],
  },
  businessHours: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 },
  dailyLimits: { like: 20, comment: 10, follow: 5, dm: 8 },
  transitionDelayMs: {
    toComentado: { min: 300000, max: 3600000 },
    toSeguidoDays: { min: 1, max: 3 },
    toDmEnviado: { min: 0, max: 900000 },
  },
  // Spread the first action of every lead discovered in the same radar
  // sweep over the next half hour — otherwise N leads all become due at
  // the same instant and fire back to back, which is exactly the burst
  // pattern Instagram flags.
  initialActionDelayMs: { min: 0, max: 1800000 },
  notifications: { wahaSessionName: null, operatorChatId: null },
  // false = never call any LLM (no cost, no API/Ollama dependency).
  // Qualification becomes a simple "has a caption" check and the
  // comment/DM come from messageTemplates below instead of an
  // AI-personalized message.
  useAi: true,
  // Only read when useAi is true. 'anthropic' = Claude API (paid, best
  // quality). 'ollama' = a local model via a local Ollama server (free,
  // runs on the operator's own machine, lower quality).
  aiProvider: 'anthropic',
  ollama: { baseUrl: 'http://localhost:11434', model: 'qwen2.5:1.5b', timeoutMs: 60000 },
  messageTemplates: {
    comment: 'Boa! Curti o que vocês postaram por aqui.',
    dm: 'Oi! Vi seu perfil e achei que dá pra ajudar vocês a vender mais por aqui. Podemos conversar?',
  },
};

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override || {})) {
    result[key] = isPlainObject(base[key]) && isPlainObject(override[key])
      ? mergeConfig(base[key], override[key])
      : override[key];
  }
  return result;
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Same atomic write-then-rename shape as content-central.js's own
// writeJson — that one isn't exported, so this is a deliberate small
// duplicate rather than a cross-module reach into a private helper.
async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(tempPath, path);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY'].includes(err.code)) {
        await rm(tempPath, { force: true }).catch(() => {});
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

export async function loadSocialSellingConfig(targetDir = process.cwd()) {
  const { socialSellingConfigPath } = getCentralPaths(targetDir);
  const override = await readJsonFile(socialSellingConfigPath, {});
  return mergeConfig(DEFAULT_SOCIAL_SELLING_CONFIG, override);
}

function defaultState() {
  return { leads: [], counters: {}, paused: false, pausedReason: null, pausedAt: null };
}

export async function loadSocialSellingState(targetDir = process.cwd()) {
  const { socialSellingStatePath } = getCentralPaths(targetDir);
  return readJsonFile(socialSellingStatePath, defaultState());
}

// Single in-process mutex — this file is only ever touched by the two
// social selling schedulers inside this same server process (no HTTP
// route reads or writes it), so a cross-process file lock like
// content-central.js's withProjectLock would be unused complexity here.
// Mirrors its "queue every writer" shape at a fraction of the code.
let stateQueue = Promise.resolve();

export async function withSocialSellingState(targetDir, mutator) {
  const { socialSellingStatePath } = getCentralPaths(targetDir);
  const run = stateQueue.catch(() => {}).then(async () => {
    const state = await readJsonFile(socialSellingStatePath, defaultState());
    const result = await mutator(state);
    await writeJsonFile(socialSellingStatePath, state);
    return result;
  });
  stateQueue = run.catch(() => {});
  return run;
}

export function findDueLead(state, now) {
  return state.leads
    .filter((lead) => !TERMINAL_STAGES.has(lead.stage) && new Date(lead.nextActionAt) <= now)
    .sort((a, b) => a.nextActionAt.localeCompare(b.nextActionAt))[0] || null;
}

export function nextStage(stage) {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export function actionForStage(stage) {
  return { descoberto: 'like', like: 'comment', comentado: 'follow', seguido: 'dm' }[stage] || null;
}

export function randomDelayMs(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
