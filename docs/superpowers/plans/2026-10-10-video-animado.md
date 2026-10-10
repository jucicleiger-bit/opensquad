# Vídeo animado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Vídeo animado" tab to Content Central. Claude Code writes each Reels video per subject (script → approval → production with preview → approval), and the existing HTML motor renders it to MP4.

**Architecture:** The hand-run motor in `videos/_motor/` moves to `src/video-motor/` and exposes `renderVideo()`. `src/content-central-video.js` owns the per-project video folders, statuses, the brand block, the real-material inventory, script validation and the prompts. `src/content-central-video-jobs.js` runs Claude Code (`claude -p`, the same way `runClaudeTurn` in `content-central-brain.js` does) and the renderer through a one-at-a-time queue. The server exposes `/api/projects/:id/videos…`, and a new React page drives the flow.

**Tech Stack:** Node ESM (server, `node --test`), Playwright Chromium + ffmpeg (render), Python + edge-tts + faster-whisper via uv (voice, already working), Claude Code CLI, React + Vite + vitest (app).

**Spec:** `docs/superpowers/specs/2026-10-10-video-animado-design.md`

## Global Constraints

- The feature is enabled only by `project.json` → `"videoAnimado": { "ativo": true, ... }`; every video endpoint returns 404 otherwise.
- Writer: Claude Code CLI (`claude -p`, `--model opus`), never the Anthropic API. The prompt goes through stdin, with `--setting-sources project` (same reasons as `runClaudeTurn`).
- One job at a time across all projects.
- Statuses: `roteiro_gerando`, `roteiro_pronto`, `producao_gerando`, `previa_pronta`, `render_gerando`, `pronto`, `erro`, `aguardando_limite`, `interrompido`.
- Briefing values: objetivo `alcance|anuncio`; duracao `15|30|45|60`; tom `criador|vendedor`; legenda `simples|karaoke|pop|destaque|caixa|do-video|sem`.
- Voice is always `gemini:Puck`, with the direction chosen by tom. The motor's chain (TTS → Live → Brian) is not touched.
- The server only accepts GET and POST (`if (method !== 'POST') return 405`), so saving and deleting are POST routes.
- Work in a git worktree (`.claude/worktrees/video-animado`, branch `video-animado`). Run git through PowerShell; `docs/` needs `git add -f`.
- Root tests: `node --test tests/<file>.test.js` (pass the file; `--test-name-pattern` only filters when placed before the file). App tests: `cd content-central-app && npx vitest run <file>`. App type-check: `npm run build` in `content-central-app` (`tsc --noEmit` checks nothing).
- Do not restart production (port 3333). The operator restarts it.

## Waves (per `.claude/rules/parallel-subagent-driven-development.md`)

| Task | Files | Depends-on |
|---|---|---|
| 1 Motor in repo | `src/video-motor/**`, `tests/video-motor.test.js`, `tests/fixtures/video-minimo/**` | none |
| 2 Video data module | `src/content-central-video.js`, `tests/content-central-video.test.js` | none |
| 5 UI | `content-central-app/src/api/client.ts`, `content-central-app/src/pages/workspace/VideoAnimado.tsx`, `…/VideoAnimado.module.css`, `…/VideoAnimado.test.tsx`, `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx`, `content-central-app/src/App.tsx` | none (HTTP contract fixed in Task 4) |
| 3 Jobs (Claude + queue) | `src/content-central-video-jobs.js`, `tests/content-central-video-jobs.test.js`, `src/video-motor/PEDIDO-*.md` | 1, 2 |
| 4 Server endpoints | `src/content-central-server.js`, `src/content-central.js` (summary only), `tests/content-central-video-server.test.js` | 2, 3 |
| 6 Enable King + real run | `_opensquad/content-central/projects/king-assessoria-mkt/project.json` (data, not committed) | 1–5 |

Wave 1: Tasks 1, 2 and 5 · Wave 2: Task 3 · Wave 3: Task 4 · Wave 4: Task 6.

---

### Task 0 (controller, before Wave 1): worktree

- [ ] **Step 1: Create the worktree from master** (PowerShell)

```powershell
git worktree add .claude/worktrees/video-animado -b video-animado
cd .claude/worktrees/video-animado
npm install
cd content-central-app; npm install; cd ..
```

- [ ] **Step 2: Baseline**

Run: `node --test tests/content-central-brain-server.test.js`
Expected: PASS. This proves the worktree runs before anything changes.

---

### Task 1: Motor in the repo (`src/video-motor/`) with `renderVideo()`

**Files:**
- Create: `src/video-motor/player.html` (from `videos/_motor/player.html`, edited)
- Create: `src/video-motor/render.mjs` (rewritten, below)
- Create (copied as-is): `src/video-motor/legendas.js`, `src/video-motor/alinhar.py`, `src/video-motor/cutout.py`
- Create (copied, 1-line edit): `src/video-motor/tts.py`, `src/video-motor/gen-images.mjs`
- Create: `src/video-motor/REGRAS.md` (copied from `videos/_motor/REGRAS.md`)
- Create: `src/video-motor/exemplos/<nome>/{roteiro.json,cenas.js}` for `king-vitrine-apagada`, `king-do-balcao-pro-story`, `king-apresentacao`, `teste-claude-1-urgencia`, `teste-claude-2-diagnostico`, `teste-claude-3-bio`
- Create: `tests/fixtures/video-minimo/roteiro.json`, `tests/fixtures/video-minimo/cenas.js`, `tests/fixtures/video-minimo/voz/tempos.json`
- Test: `tests/video-motor.test.js`

**Interfaces:**
- Produces: `export const MOTOR_DIR: string` (absolute path of `src/video-motor/`); `export async function renderVideo({ videoDir, stills?: number[], legenda?: string|null, trecho?: [number, number]|null }): Promise<{ duration: number, stills?: string[], out?: string }>`. Stills land in `<videoDir>/stills/t<seconds>.jpg` (JS number formatting, e.g. `t0.05.jpg`). The full render goes to `<videoDir>/video.mp4`, or `<videoDir>/trecho.mp4` when `trecho` is set. Page errors reject with the player's message.
- Produces: the player loads everything for the video from `/v/…` (`roteiro.json`, `voz/tempos.json`, `cenas.js`, files) and the motor from `/_motor/…`.
- CLI: `node src/video-motor/render.mjs <videoDir> [--stills 0.05,2] [--legenda pop] [--trecho 3,9]`; `python src/video-motor/tts.py <videoDir>`; `node src/video-motor/gen-images.mjs <videoDir> [objeto]`.

- [ ] **Step 1: Write the fixture video**

`tests/fixtures/video-minimo/roteiro.json`:
```json
{
  "marca": { "nome": "Teste", "logo": "fotos/logo.png", "whatsapp": "65 0000-0000", "instagram": "@teste" },
  "voz": "gemini:Puck",
  "cenas": [
    { "tipo": "um", "fala": "Olá mundo bonito.", "descricao": "Título" },
    { "tipo": "dois", "fala": "Segunda cena aqui.", "descricao": "Texto" }
  ]
}
```

`tests/fixtures/video-minimo/voz/tempos.json`:
```json
{ "arquivo": "voz/narracao.mp3", "cenas": [
  { "words": [ { "w": "Olá", "t": 0.05, "d": 0.3, "fim": false }, { "w": "mundo", "t": 0.4, "d": 0.3, "fim": false }, { "w": "bonito", "t": 0.75, "d": 0.4, "fim": true } ] },
  { "words": [ { "w": "Segunda", "t": 1.4, "d": 0.4, "fim": false }, { "w": "cena", "t": 1.85, "d": 0.3, "fim": false }, { "w": "aqui", "t": 2.2, "d": 0.3, "fim": true } ] }
] }
```

`tests/fixtures/video-minimo/cenas.js`:
```js
// Minimal two-scene video used by the motor smoke test.
window.VIDEO = {
  estrelas: false,
  tipos: {
    um: {
      html: () => '<div class="abs" data-k="t" style="left:40px;top:300px;font:900 60px sans-serif;color:#fff">OLÁ</div>',
      frame(t, c, q, A) { q('t').style.opacity = t >= A('mundo') ? 1 : 0.5; },
      sfx: () => [],
    },
    dois: {
      html: () => '<div class="abs" data-k="t" style="left:40px;top:300px;font:900 60px sans-serif;color:#FFD100">CENA 2</div>',
      frame(t, c, q, A) { q('t').style.opacity = t >= A('cena') ? 1 : 0.5; },
      sfx: () => [],
    },
  },
};
```

- [ ] **Step 2: Write the failing test**

`tests/video-motor.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderVideo, MOTOR_DIR } from '../src/video-motor/render.mjs';

async function withFixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'video-motor-'));
  await cp('tests/fixtures/video-minimo', dir, { recursive: true });
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

test('MOTOR_DIR points at the motor files', async () => {
  assert.ok((await readdir(MOTOR_DIR)).includes('player.html'));
});

test('renderVideo stills draws a tiny video without page errors', async () => {
  await withFixture(async (dir) => {
    const result = await renderVideo({ videoDir: dir, stills: [0.05, 1.6] });
    assert.deepEqual(result.stills, ['t0.05.jpg', 't1.6.jpg']);
    assert.deepEqual((await readdir(join(dir, 'stills'))).sort(), ['t0.05.jpg', 't1.6.jpg']);
    assert.ok(result.duration > 2);
  });
});

test('a scene anchored to a word missing from its line fails with the player message', async () => {
  await withFixture(async (dir) => {
    const cenas = (await readFile(join(dir, 'cenas.js'), 'utf8')).replace("A('cena')", "A('inexistente')");
    await writeFile(join(dir, 'cenas.js'), cenas);
    await assert.rejects(renderVideo({ videoDir: dir, stills: [1.6] }), /inexistente/);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/video-motor.test.js`
Expected: FAIL, `Cannot find module '…/src/video-motor/render.mjs'`.

- [ ] **Step 4: Copy the motor files**

PowerShell:
```powershell
New-Item -ItemType Directory -Force src/video-motor/exemplos | Out-Null
$m = '../../../videos/_motor'   # the worktree sits 3 levels below the main checkout
Copy-Item "$m/player.html","$m/legendas.js","$m/alinhar.py","$m/cutout.py","$m/tts.py","$m/gen-images.mjs","$m/REGRAS.md" src/video-motor/
foreach ($n in 'king-vitrine-apagada','king-do-balcao-pro-story','king-apresentacao','teste-claude-1-urgencia','teste-claude-2-diagnostico','teste-claude-3-bio') {
  New-Item -ItemType Directory -Force "src/video-motor/exemplos/$n" | Out-Null
  Copy-Item "../../../videos/$n/roteiro.json","../../../videos/$n/cenas.js" "src/video-motor/exemplos/$n/"
}
```

- [ ] **Step 5: Edit `src/video-motor/player.html`**

1. Delete the line `<script src="blocos.js"></script>`.
2. Delete the two lines `Object.assign(TYPES, BLOCOS);` and ``document.head.insertAdjacentHTML('beforeend', `<style>${BLOCOS_CSS}</style>`);``.
3. Replace the whole built-in scene table, from the line `const TYPES = {` through its closing `};` (just before the comment `// Transitions cycle so consecutive cuts never repeat the same move.`), with:
   ```js
   // Every video brings its own scene types in cenas.js (VIDEO.tipos).
   const TYPES = {};
   ```
4. Replace
   ```js
   const V = new URLSearchParams(location.search).get('v');
   ```
   with nothing (delete it). Replace
   ```js
   const asset = (path) => `/${V}/${path}`;
   const logoSrc = (key) => (key.includes('.') ? asset(key) : `/_motor/logos/${key}.svg`);
   ```
   with
   ```js
   // The renderer serves the video folder at /v/ and the motor at /_motor/.
   const asset = (path) => `/v/${path}`;
   ```
5. Search the file for `logoSrc(`. After step 3 there must be no matches.

- [ ] **Step 6: Point `tts.py` and `gen-images.mjs` at an absolute video folder**

In `src/video-motor/tts.py` replace
```python
pasta = motor.parent / sys.argv[1]
```
with
```python
pasta = Path(sys.argv[1]).resolve()  # the video folder (absolute or relative to cwd)
```
`env_key()` keeps reading `motor.parent.parent / ".env"`, which is the repo root `.env`.

In `src/video-motor/gen-images.mjs` replace
```js
const pasta = join(motor, '..', videoName);
```
with
```js
const pasta = resolve(videoName); // the video folder (absolute or relative to cwd)
```
and change the usage text to `uso: node gen-images.mjs <pasta-do-video> [objeto]` (unchanged words, but now any path).

- [ ] **Step 7: Write `src/video-motor/render.mjs`**

```js
// Renders a video folder (roteiro.json + cenas.js + voz/tempos.json) with player.html.
//   renderVideo({ videoDir })                     -> <videoDir>/video.mp4 (1080x1920, 30fps)
//   renderVideo({ videoDir, stills: [0.05, 2] })  -> <videoDir>/stills/t0.05.jpg, ...
//   legenda: caption model name; trecho: [a, b] renders only that stretch (trecho.mp4)
// CLI: node src/video-motor/render.mjs <videoDir> [--stills 1,5] [--legenda pop] [--trecho 3,9]
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const MOTOR_DIR = fileURLToPath(new URL('.', import.meta.url));
const FPS = 30;
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.js': 'text/javascript' };

// Synthesized effects, so there is nothing to license or download.
const SOUNDS = {
  whoosh: 'anoisesrc=d=0.55:c=pink:a=0.9,highpass=f=350,lowpass=f=5000,afade=t=in:d=0.32:curve=exp,afade=t=out:st=0.32:d=0.23',
  impact: "aevalsrc='0.9*sin(2*PI*(38+110*exp(-12*t))*t)*exp(-4.5*t)+0.35*(random(0)*2-1)*exp(-45*t)':d=0.9:s=44100,lowpass=f=2500",
  pop: "aevalsrc='0.5*sin(2*PI*(520+1200*exp(-35*t))*t)*exp(-22*t)':d=0.2:s=44100",
  zap: "aevalsrc='0.22*sin(2*PI*(180+60*sin(2*PI*28*t))*t)*(1-exp(-40*t))*exp(-5*t)+0.12*(random(0)*2-1)*exp(-9*t)':d=0.6:s=44100,highpass=f=120",
  ding: "aevalsrc='0.3*(sin(2*PI*1318*t)+0.6*sin(2*PI*1976*t)+0.3*sin(2*PI*2637*t))*exp(-4*t)':d=1.2:s=44100",
  click: "aevalsrc='0.7*(random(0)*2-1)*exp(-180*t)+0.4*sin(2*PI*1800*t)*exp(-120*t)':d=0.08:s=44100,highpass=f=600",
  thud: "aevalsrc='0.8*sin(2*PI*(70+60*exp(-25*t))*t)*exp(-14*t)+0.2*(random(0)*2-1)*exp(-60*t)':d=0.35:s=44100,lowpass=f=1200",
  tick: "aevalsrc='0.35*sin(2*PI*2400*t)*exp(-90*t)':d=0.05:s=44100",
};
const VOLUME = { whoosh: 0.55, impact: 0.8, pop: 0.45, zap: 0.5, ding: 0.5, click: 0.6, thud: 0.6, tick: 0.4 };

async function ensureSounds() {
  await mkdir(join(MOTOR_DIR, 'sfx'), { recursive: true });
  for (const [name, graph] of Object.entries(SOUNDS)) {
    const out = join(MOTOR_DIR, 'sfx', `${name}.wav`);
    if (!existsSync(out)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', graph, '-ac', '2', '-ar', '44100', out]);
  }
}

// /_motor/* from the motor folder, /v/* from the video folder; nothing else.
function serve(videoDir) {
  const roots = { _motor: resolve(MOTOR_DIR), v: resolve(videoDir) };
  const server = createServer(async (req, res) => {
    try {
      const [, root, ...rest] = decodeURIComponent(new URL(req.url, 'http://x').pathname).split('/');
      const base = roots[root];
      const file = base && resolve(base, ...rest);
      if (!file || !file.startsWith(base + sep)) throw new Error('outside');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

export async function renderVideo({ videoDir, stills = null, legenda = null, trecho = null }) {
  videoDir = resolve(videoDir);
  const server = await serve(videoDir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
    let pageError = null;
    page.on('pageerror', (err) => { pageError = err; });
    await page.goto(`http://127.0.0.1:${server.address().port}/_motor/player.html${legenda ? `?legenda=${encodeURIComponent(legenda)}` : ''}`);
    const duration = await page.evaluate(() => window.ready).catch((err) => { throw pageError || err; });
    if (pageError) throw pageError;
    const shot = async (t) => {
      await page.evaluate((x) => window.seek(x), t);
      if (pageError) throw pageError;
      return page.screenshot({ type: 'jpeg', quality: 92 });
    };

    if (stills) {
      await mkdir(join(videoDir, 'stills'), { recursive: true });
      const names = [];
      for (const t of stills) {
        const name = `t${t}.jpg`;
        await writeFile(join(videoDir, 'stills', name), await shot(t));
        names.push(name);
      }
      return { duration, stills: names };
    }

    await ensureSounds();
    const { sfx, voz } = await page.evaluate(() => ({ sfx: window.SFX, voz: window.VOZ }));
    const t0 = trecho ? trecho[0] : 0;
    const length = trecho ? trecho[1] - t0 : duration;
    const out = join(videoDir, trecho ? 'trecho.mp4' : 'video.mp4');
    const tracks = [
      ...voz.map((v) => ({ file: join(videoDir, v.arquivo), t: v.inicio - t0, vol: 1 })),
      ...sfx.map((c) => ({ file: join(MOTOR_DIR, 'sfx', `${c.s}.wav`), t: c.t - t0, vol: VOLUME[c.s] })),
    ].filter((tr) => tr.t < length && tr.t > -60);
    const delays = tracks.map((tr, i) => {
      const ms = Math.max(0, Math.round(tr.t * 1000));
      const cut = tr.t < 0 ? `atrim=start=${-tr.t},asetpts=PTS-STARTPTS,` : '';
      return `[${i + 1}:a]${cut}aformat=sample_rates=44100:channel_layouts=stereo,adelay=${ms}|${ms},volume=${tr.vol}[a${i}]`;
    });
    const mix = `${delays.join(';')};${tracks.map((_, i) => `[a${i}]`).join('')}amix=inputs=${tracks.length}:normalize=0:duration=longest,loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...tracks.flatMap((tr) => ['-i', tr.file]),
      '-filter_complex', mix, '-map', '0:v', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-movflags', '+faststart', '-t', String(length), out], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    ff.stderr.on('data', (c) => { ffErr += c; });
    const closed = new Promise((ok) => ff.on('close', ok));
    for (let f = 0; f < Math.ceil(length * FPS); f += 1) {
      const buf = await shot(t0 + f / FPS);
      if (!ff.stdin.write(buf)) await new Promise((ok) => ff.stdin.once('drain', ok));
    }
    ff.stdin.end();
    const code = await closed;
    if (code !== 0) throw new Error(`ffmpeg falhou: ${ffErr.slice(-400)}`);
    return { duration, out };
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const result = await renderVideo({
    videoDir: process.argv[2],
    stills: arg('--stills')?.split(',').map(Number) ?? null,
    legenda: arg('--legenda'),
    trecho: arg('--trecho')?.split(',').map(Number) ?? null,
  });
  console.log('ok', result.out || result.stills.join(' '));
}
```

- [ ] **Step 8: Update `src/video-motor/REGRAS.md`, section "Princípio", second paragraph**, to:

```markdown
As cenas de cada vídeo ficam em `cenas.js` na pasta do vídeo (veja os exemplos em `exemplos/`) e os objetos em `objetos/`. O motor (`src/video-motor/`) só cuida da parte técnica: o tempo preso às palavras da fala (`A('palavra')`), a voz (`python tts.py <pasta>`), a legenda, os efeitos sonoros e o render (`node render.mjs <pasta> --stills …`).
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `node --test tests/video-motor.test.js`
Expected: PASS (3 tests).

- [ ] **Step 10: Lint and commit** (PowerShell)

```powershell
npx eslint tests/video-motor.test.js src/video-motor/render.mjs
git add src/video-motor tests/video-motor.test.js tests/fixtures/video-minimo
git commit -m "feat(video): move the video motor into src/video-motor with renderVideo()" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Video data module (`src/content-central-video.js`)

**Files:**
- Create: `src/content-central-video.js`
- Test: `tests/content-central-video.test.js`

**Interfaces:**
- Consumes: `getCentralPaths(targetDir, projectId)`, `loadProject(paths)`, `readJson(path, fallback)` and `writeJson(path, value)` from `./content-central.js` (all exported today).
- Produces (exact exports):
  - `STATUS` (object of the 9 status strings), `ESTADOS_GERANDO: Set<string>`
  - `normalizeVideoAnimado(value) → { ativo: boolean, projetosDeMaterial: string[], whatsapp: string }`
  - `requireVideoProject(projectId, targetDir) → Promise<project>` (throws `err.status = 404`)
  - `videoDir(targetDir, projectId, videoId) → string`
  - `normalizeBriefing(input) → briefing` (throws `err.status = 400`)
  - `createVideo(projectId, input, targetDir) → Promise<video>` (status `roteiro_gerando`)
  - `updateVideo(projectId, videoId, patch, targetDir) → Promise<video>`
  - `readVideo(projectId, videoId, targetDir) → Promise<video>` (throws 404)
  - `readVideoState(projectId, videoId, targetDir) → Promise<{ video, roteiro, estimativa, avisos, stills, arquivos, vozUsada }>`
  - `listVideos(projectId, targetDir) → Promise<summary[]>`
  - `saveRoteiroCenas(projectId, videoId, cenas, targetDir) → Promise<roteiro>` (409 unless `roteiro_pronto`)
  - `deleteVideo(projectId, videoId, targetDir) → Promise<void>` (409 while a `*_gerando` status runs)
  - `estimateSeconds(cenas) → number`, `validateRoteiro(roteiro, briefing) → { erros: string[], avisos: string[] }`
  - `buildMarca(project, settings) → { nome, subtitulo, logo: 'fotos/logo.png', whatsapp, instagram, cor }`
  - `buildMaterialInventory(projectIds, targetDir) → Promise<Array<{ projeto, produto, canal, status, arte, cru }>>`
  - `reconcileInterruptedVideos(targetDir) → Promise<number>`

- [ ] **Step 1: Write the failing tests**

`tests/content-central-video.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCentralProject, getCentralPaths } from '../src/content-central.js';
import {
  STATUS, normalizeBriefing, createVideo, updateVideo, readVideoState, listVideos, saveRoteiroCenas, deleteVideo,
  estimateSeconds, validateRoteiro, buildMarca, buildMaterialInventory, reconcileInterruptedVideos, requireVideoProject, videoDir,
} from '../src/content-central-video.js';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-video-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

async function enable(dir, projectId, extra = {}) {
  const path = getCentralPaths(dir, projectId).projectPath;
  const project = JSON.parse(await readFile(path, 'utf8'));
  project.videoAnimado = { ativo: true, projetosDeMaterial: ['mercado'], whatsapp: '65 98108-6707', ...extra };
  await writeFile(path, JSON.stringify(project));
}

const briefing = { assunto: 'Diagnóstico antes do anúncio', objetivo: 'anuncio', duracao: 30, tom: 'vendedor', legenda: 'karaoke', observacao: '' };

test('a project without videoAnimado.ativo is a 404 for every video call', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await assert.rejects(requireVideoProject('king', dir), (err) => err.status === 404);
    await assert.rejects(createVideo('king', briefing, dir), (err) => err.status === 404);
  });
});

test('briefing is validated and normalized', () => {
  assert.throws(() => normalizeBriefing({ ...briefing, assunto: ' ' }), (err) => err.status === 400);
  assert.throws(() => normalizeBriefing({ ...briefing, objetivo: 'venda' }), (err) => err.status === 400);
  assert.throws(() => normalizeBriefing({ ...briefing, duracao: 20 }), (err) => err.status === 400);
  assert.deepEqual(normalizeBriefing({ ...briefing, duracao: '45' }).duracao, 45);
});

test('createVideo writes video.json in roteiro_gerando and listVideos returns it', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await enable(dir, 'king');
    const video = await createVideo('king', briefing, dir);
    assert.equal(video.status, STATUS.ROTEIRO_GERANDO);
    assert.match(video.id, /^\d{4}-\d{2}-\d{2}-diagnostico-antes-do-anuncio-[0-9a-f]{4}$/);
    const list = await listVideos('king', dir);
    assert.deepEqual(list.map((v) => [v.id, v.assunto, v.status]), [[video.id, briefing.assunto, STATUS.ROTEIRO_GERANDO]]);
  });
});

test('updateVideo records status history; saveRoteiroCenas only in roteiro_pronto', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await enable(dir, 'king');
    const video = await createVideo('king', briefing, dir);
    await writeFile(join(videoDir(dir, 'king', video.id), 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'a', fala: 'Oi.', descricao: 'x' }] }));
    const cenas = [{ tipo: 'a', fala: 'Olá, tudo bem?', descricao: 'Título' }];
    await assert.rejects(saveRoteiroCenas('king', video.id, cenas, dir), (err) => err.status === 409);
    const updated = await updateVideo('king', video.id, { status: STATUS.ROTEIRO_PRONTO }, dir);
    assert.deepEqual(updated.historico.map((h) => h.status), [STATUS.ROTEIRO_GERANDO, STATUS.ROTEIRO_PRONTO]);
    const roteiro = await saveRoteiroCenas('king', video.id, cenas, dir);
    assert.equal(roteiro.cenas[0].fala, 'Olá, tudo bem?');
    await assert.rejects(saveRoteiroCenas('king', video.id, [{ tipo: '', fala: 'x' }], dir), (err) => err.status === 400);
  });
});

test('estimateSeconds counts spoken words at 2.6 per second plus holds', () => {
  const cenas = [{ fala: 'um dois três quatro cinco', segura: 1 }, { fala: 'seis sete oito' }];
  assert.equal(estimateSeconds(cenas), Math.round((8 / 2.6 + 1) * 10) / 10);
});

test('validateRoteiro: errors block, objective mismatches and timing only warn', () => {
  const ok = { cenas: [{ tipo: 'a', fala: 'Antes de anunciar, pensa.', descricao: 'x' }, { tipo: 'b', fala: 'Chama no WhatsApp!', descricao: 'y' }] };
  assert.deepEqual(validateRoteiro(ok, { ...briefing, duracao: 15 }).erros, []);
  assert.ok(validateRoteiro(ok, { ...briefing, duracao: 60 }).avisos.some((a) => /tempo/i.test(a)));
  assert.ok(validateRoteiro(ok, { ...briefing, objetivo: 'alcance' }).avisos.some((a) => /pergunta/i.test(a)));
  assert.ok(validateRoteiro({ cenas: [] }, briefing).erros.length > 0);
  assert.ok(validateRoteiro({ cenas: [{ tipo: 'a', fala: '' }] }, briefing).erros.length > 0);
});

test('buildMarca takes name, Instagram, WhatsApp and the most saturated brand color', () => {
  const marca = buildMarca(
    { name: 'KING', brandInput: { brandName: 'King Assessoria MKT' }, instagram: { handle: '@king.assessoriamkt' }, brandIdentity: { extractedColors: ['#000000', '#FFFFFF', '#FFD100'], editedColors: [] } },
    { whatsapp: '65 98108-6707' },
  );
  assert.deepEqual(marca, { nome: 'King Assessoria MKT', subtitulo: '', logo: 'fotos/logo.png', whatsapp: '65 98108-6707', instagram: '@king.assessoriamkt', cor: '#FFD100' });
});

test('buildMaterialInventory lists generated Stories with their raw photo, approved first', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'mercado', name: 'Mercado' }, dir);
    const paths = getCentralPaths(dir, 'mercado');
    await mkdir(join(paths.assetsDir, 'generated'), { recursive: true });
    await mkdir(paths.referencesDir, { recursive: true });
    await writeFile(join(paths.assetsDir, 'generated', 'arte-1.png'), 'x');
    await writeFile(join(paths.referencesDir, 'cru-1.jpg'), 'x');
    await mkdir(paths.draftsDir, { recursive: true });
    await writeFile(join(paths.draftsDir, 'day-01.json'), JSON.stringify({ items: [
      { channel: 'instagram_story', status: 'test_post_simulated', contentTopic: { offerName: 'Bacon' }, image: { url: '/x/arte-1.png', references: [{ absolutePath: join(paths.referencesDir, 'cru-1.jpg') }] } },
      { channel: 'instagram_story', status: 'aprovado', contentTopic: { label: 'Rotina' }, image: { url: '/x/arte-1.png', references: [] } },
      { channel: 'instagram_story', status: 'aprovado', contentTopic: { label: 'Some' }, image: { url: '/x/nao-existe.png' } },
    ] }));
    const items = await buildMaterialInventory(['mercado', 'inexistente'], dir);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'aprovado');
    assert.equal(items[0].arte, join(paths.assetsDir, 'generated', 'arte-1.png'));
    // The approved item had no raw photo; the test-run one did, and it is kept.
    assert.equal(items[0].cru, join(paths.referencesDir, 'cru-1.jpg'));
  });
});

test('reconcileInterruptedVideos turns running statuses into interrompido', async () => {
  await withDir(async (dir) => {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    await enable(dir, 'king');
    const video = await createVideo('king', briefing, dir);
    assert.equal(await reconcileInterruptedVideos(dir), 1);
    const state = await readVideoState('king', video.id, dir);
    assert.equal(state.video.status, STATUS.INTERROMPIDO);
    await deleteVideo('king', video.id, dir);
    assert.deepEqual(await listVideos('king', dir), []);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/content-central-video.test.js`
Expected: FAIL, `Cannot find module '…/src/content-central-video.js'`.

- [ ] **Step 3: Write `src/content-central-video.js`**

```js
// Vídeo animado: per-project video folders, their status, and what Claude
// needs to write a video (brand block, real-material inventory, validation).
// Running Claude Code and the renderer lives in content-central-video-jobs.js.
import { mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getCentralPaths, loadProject, readJson, writeJson } from './content-central.js';

export const STATUS = {
  ROTEIRO_GERANDO: 'roteiro_gerando', ROTEIRO_PRONTO: 'roteiro_pronto',
  PRODUCAO_GERANDO: 'producao_gerando', PREVIA_PRONTA: 'previa_pronta',
  RENDER_GERANDO: 'render_gerando', PRONTO: 'pronto',
  ERRO: 'erro', AGUARDANDO_LIMITE: 'aguardando_limite', INTERROMPIDO: 'interrompido',
};
export const ESTADOS_GERANDO = new Set([STATUS.ROTEIRO_GERANDO, STATUS.PRODUCAO_GERANDO, STATUS.RENDER_GERANDO]);
const OBJETIVOS = new Set(['alcance', 'anuncio']);
const DURACOES = new Set([15, 30, 45, 60]);
const TONS = new Set(['criador', 'vendedor']);
const LEGENDAS = new Set(['simples', 'karaoke', 'pop', 'destaque', 'caixa', 'do-video', 'sem']);
const PALAVRAS_POR_SEGUNDO = 2.6;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function normalizeVideoAnimado(value) {
  return {
    ativo: value?.ativo === true,
    projetosDeMaterial: Array.isArray(value?.projetosDeMaterial) ? value.projetosDeMaterial.filter((id) => typeof id === 'string' && id) : [],
    whatsapp: typeof value?.whatsapp === 'string' ? value.whatsapp : '',
  };
}

export async function requireVideoProject(projectId, targetDir) {
  const paths = getCentralPaths(targetDir, projectId);
  const raw = await readJson(paths.projectPath, null);
  if (!raw || !normalizeVideoAnimado(raw.videoAnimado).ativo) throw httpError(404, 'Vídeo animado não está ligado neste projeto.');
  return loadProject(paths);
}

export function videoDir(targetDir, projectId, videoId) {
  if (!/^[a-z0-9-]+$/.test(String(videoId))) throw httpError(400, 'Vídeo inválido.');
  return join(getCentralPaths(targetDir, projectId).projectDir, 'videos', videoId);
}

const slug = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function normalizeBriefing(input = {}) {
  const assunto = String(input.assunto || '').trim();
  if (!assunto) throw httpError(400, 'Informe o assunto do vídeo.');
  const objetivo = String(input.objetivo || '');
  if (!OBJETIVOS.has(objetivo)) throw httpError(400, 'Objetivo deve ser alcance ou anúncio.');
  const duracao = Number(input.duracao);
  if (!DURACOES.has(duracao)) throw httpError(400, 'Duração deve ser 15, 30, 45 ou 60 segundos.');
  const tom = String(input.tom || 'criador');
  if (!TONS.has(tom)) throw httpError(400, 'Tom deve ser criador ou vendedor.');
  const legenda = String(input.legenda || 'do-video');
  if (!LEGENDAS.has(legenda)) throw httpError(400, 'Modelo de legenda desconhecido.');
  return { assunto, objetivo, duracao, tom, legenda, observacao: String(input.observacao || '').trim() };
}

export async function createVideo(projectId, input, targetDir) {
  await requireVideoProject(projectId, targetDir);
  const briefing = normalizeBriefing(input);
  const agora = new Date().toISOString();
  const id = `${agora.slice(0, 10)}-${slug(briefing.assunto) || 'video'}-${randomBytes(2).toString('hex')}`;
  const dir = videoDir(targetDir, projectId, id);
  await mkdir(join(dir, 'fotos'), { recursive: true });
  const video = { id, projectId, briefing, status: STATUS.ROTEIRO_GERANDO, erro: null, criadoEm: agora, atualizadoEm: agora, historico: [{ em: agora, status: STATUS.ROTEIRO_GERANDO }] };
  await writeJson(join(dir, 'video.json'), video);
  return video;
}

export async function readVideo(projectId, videoId, targetDir) {
  const video = await readJson(join(videoDir(targetDir, projectId, videoId), 'video.json'), null);
  if (!video) throw httpError(404, 'Vídeo não encontrado.');
  return video;
}

export async function updateVideo(projectId, videoId, patch, targetDir) {
  const video = await readVideo(projectId, videoId, targetDir);
  const agora = new Date().toISOString();
  const next = { ...video, ...patch, atualizadoEm: agora };
  if (patch.status && patch.status !== video.status) next.historico = [...(video.historico || []), { em: agora, status: patch.status }];
  if (patch.status && patch.status !== STATUS.ERRO && patch.status !== STATUS.AGUARDANDO_LIMITE && !('erro' in patch)) next.erro = null;
  await writeJson(join(videoDir(targetDir, projectId, videoId), 'video.json'), next);
  return next;
}

export function estimateSeconds(cenas = []) {
  const palavras = cenas.reduce((n, c) => n + (String(c.fala || '').match(/[\p{L}\d]+/gu) || []).length, 0);
  const segura = cenas.reduce((n, c) => n + (Number(c.segura) || 0), 0);
  return Math.round((palavras / PALAVRAS_POR_SEGUNDO + segura) * 10) / 10;
}

export function validateRoteiro(roteiro, briefing) {
  const erros = [];
  const avisos = [];
  const cenas = Array.isArray(roteiro?.cenas) ? roteiro.cenas : [];
  if (!cenas.length) erros.push('O roteiro não tem cenas.');
  cenas.forEach((c, i) => {
    if (!String(c.tipo || '').trim()) erros.push(`Cena ${i + 1} sem tipo.`);
    if (!String(c.fala || '').trim()) erros.push(`Cena ${i + 1} sem fala.`);
  });
  if (!erros.length && briefing) {
    const est = estimateSeconds(cenas);
    if (Math.abs(est - briefing.duracao) > briefing.duracao * 0.15) avisos.push(`Tempo estimado ${est}s, a meta é ${briefing.duracao}s.`);
    const fecho = String(cenas[cenas.length - 1].fala || '');
    if (briefing.objetivo === 'alcance' && !/\?/.test(cenas.slice(-2).map((c) => c.fala).join(' '))) avisos.push('Vídeo de alcance deve fechar com uma pergunta (enquete).');
    if (briefing.objetivo === 'anuncio' && !/whats/i.test(fecho)) avisos.push('Anúncio deve fechar chamando no WhatsApp.');
  }
  return { erros, avisos };
}

export async function saveRoteiroCenas(projectId, videoId, cenas, targetDir) {
  const video = await readVideo(projectId, videoId, targetDir);
  if (video.status !== STATUS.ROTEIRO_PRONTO) throw httpError(409, 'O roteiro só pode ser editado quando estiver pronto para revisão.');
  const limpas = (Array.isArray(cenas) ? cenas : []).map((c) => ({
    ...c,
    tipo: String(c.tipo || '').trim(),
    fala: String(c.fala || '').trim(),
    descricao: String(c.descricao || '').trim(),
  }));
  const { erros } = validateRoteiro({ cenas: limpas });
  if (erros.length) throw httpError(400, erros.join(' '));
  const path = join(videoDir(targetDir, projectId, videoId), 'roteiro.json');
  const roteiro = { ...(await readJson(path, {})), cenas: limpas };
  await writeJson(path, roteiro);
  return roteiro;
}

export async function readVideoState(projectId, videoId, targetDir) {
  const video = await readVideo(projectId, videoId, targetDir);
  const dir = videoDir(targetDir, projectId, videoId);
  const roteiro = await readJson(join(dir, 'roteiro.json'), null);
  const { avisos } = roteiro ? validateRoteiro(roteiro, video.briefing) : { avisos: [] };
  const stills = existsSync(join(dir, 'stills')) ? (await readdir(join(dir, 'stills'))).filter((n) => n.endsWith('.jpg')).sort((a, b) => parseFloat(a.slice(1)) - parseFloat(b.slice(1))) : [];
  const has = (name) => existsSync(join(dir, name));
  const narracao = await readJson(join(dir, 'voz', 'narracao.json'), null);
  return {
    video,
    roteiro,
    estimativa: roteiro ? estimateSeconds(roteiro.cenas) : null,
    avisos,
    stills,
    arquivos: { video: has('video.mp4'), narracaoMp3: has('voz/narracao.mp3'), narracaoTxt: has('voz/narracao.txt'), legendaPost: has('legenda-post.txt'), notas: has('NOTAS.md') },
    vozUsada: narracao?.usada || null,
  };
}

export async function listVideos(projectId, targetDir) {
  await requireVideoProject(projectId, targetDir);
  const base = join(getCentralPaths(targetDir, projectId).projectDir, 'videos');
  if (!existsSync(base)) return [];
  const videos = [];
  for (const id of await readdir(base)) {
    const video = await readJson(join(base, id, 'video.json'), null);
    if (!video) continue;
    videos.push({ id: video.id, assunto: video.briefing.assunto, objetivo: video.briefing.objetivo, duracao: video.briefing.duracao, status: video.status, erro: video.erro, criadoEm: video.criadoEm, atualizadoEm: video.atualizadoEm, temVideo: existsSync(join(base, id, 'video.mp4')) });
  }
  return videos.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

export async function deleteVideo(projectId, videoId, targetDir) {
  const video = await readVideo(projectId, videoId, targetDir);
  if (ESTADOS_GERANDO.has(video.status)) throw httpError(409, 'O vídeo está sendo gerado; espere terminar para excluir.');
  await rm(videoDir(targetDir, projectId, videoId), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

// The most saturated color in the brand identity is the highlight color.
function pickAccent(colors = []) {
  const sat = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  };
  const valid = colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  return valid.sort((a, b) => sat(b) - sat(a))[0] || '#FFD100';
}

export function buildMarca(project, settings = {}) {
  const colors = [...(project.brandIdentity?.editedColors || []), ...(project.brandIdentity?.extractedColors || [])];
  return {
    nome: project.brandInput?.brandName || project.name,
    subtitulo: '',
    logo: 'fotos/logo.png',
    whatsapp: settings.whatsapp || project.companyProfile?.contact || '',
    instagram: project.instagram?.handle || '',
    cor: pickAccent(colors),
  };
}

const STATUS_MATERIAL = ['aprovado', 'published', 'scheduled', 'test_post_simulated', 'regenerated', 'draft_generated'];
const CANAIS_MATERIAL = new Set(['instagram_story', 'whatsapp_status', 'facebook_story', 'instagram_feed']);

// Real material Claude may use: generated arts that exist on disk, with the
// raw product photo when the item kept one. Approved first.
export async function buildMaterialInventory(projectIds, targetDir) {
  const out = [];
  const rank = (status) => STATUS_MATERIAL.indexOf(status);
  for (const projeto of projectIds) {
    const paths = getCentralPaths(targetDir, projeto);
    if (!existsSync(paths.contentDir)) continue;
    // One entry per art file; when the same art appears in several items,
    // keep the best status (approved over test runs).
    const best = new Map();
    const files = (await readdir(paths.contentDir, { recursive: true })).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const data = await readJson(join(paths.contentDir, f), null);
      const items = Array.isArray(data) ? data : data?.items || data?.contents || [];
      for (const it of Array.isArray(items) ? items : []) {
        if (!it || !CANAIS_MATERIAL.has(it.channel) || !STATUS_MATERIAL.includes(it.status)) continue;
        const url = it.image?.url;
        if (!url) continue;
        const arte = join(paths.assetsDir, 'generated', basename(url));
        if (!existsSync(arte)) continue;
        const atual = best.get(arte);
        if (atual && rank(atual.status) <= rank(it.status)) continue;
        const crua = (it.image.references || []).map((r) => r?.absolutePath).find((p) => p && !/logo/i.test(p) && existsSync(p)) || atual?.cru || null;
        const topic = it.contentTopic || {};
        best.set(arte, { projeto, produto: topic.offerName || topic.label || atual?.produto || '', canal: it.channel, status: it.status, arte, cru: crua });
      }
    }
    out.push(...best.values());
  }
  return out.sort((a, b) => rank(a.status) - rank(b.status));
}

export async function reconcileInterruptedVideos(targetDir) {
  const projectsDir = getCentralPaths(targetDir).projectsDir;
  if (!existsSync(projectsDir)) return 0;
  let count = 0;
  for (const projectId of await readdir(projectsDir)) {
    const base = join(projectsDir, projectId, 'videos');
    if (!existsSync(base)) continue;
    for (const id of await readdir(base)) {
      const video = await readJson(join(base, id, 'video.json'), null);
      if (video && ESTADOS_GERANDO.has(video.status)) {
        await updateVideo(projectId, id, { status: STATUS.INTERROMPIDO, erro: 'O servidor reiniciou no meio da geração.', etapaInterrompida: video.status }, targetDir);
        count += 1;
      }
    }
  }
  return count;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/content-central-video.test.js`
Expected: PASS (9 tests). If `buildMaterialInventory` returns 0 items on Windows, check that `readdir(…, { recursive: true })` returns backslash paths. `join()` copes with that, so the usual cause is a wrong fixture path.

- [ ] **Step 5: Lint and commit** (PowerShell)

```powershell
npx eslint src/content-central-video.js tests/content-central-video.test.js
git add src/content-central-video.js tests/content-central-video.test.js
git commit -m "feat(video): per-project video folders, statuses, brand block and material inventory" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Jobs: Claude Code runner, stage prompts and the queue

**Files:**
- Create: `src/content-central-video-jobs.js`
- Create: `src/video-motor/PEDIDO-roteiro.md`, `src/video-motor/PEDIDO-producao.md`
- Test: `tests/content-central-video-jobs.test.js`

**Interfaces:**
- Consumes (Task 2): `STATUS`, `requireVideoProject`, `readVideo`, `updateVideo`, `videoDir`, `validateRoteiro`, `buildMarca`, `buildMaterialInventory`, `normalizeVideoAnimado`. From Task 1: `MOTOR_DIR` and `renderVideo` (dynamic import, so the server doesn't load Playwright until a render runs).
- Produces:
  - `runClaudeCode({ prompt, cwd, addDirs = [], timeoutMs }) → Promise<{ text }>`. It rejects with `Error`; `err.limite === true` when Claude Code reports a usage limit.
  - `isUsageLimit(text) → boolean`
  - `DIRECOES: { criador: string, vendedor: string }`
  - `createVideoJobs({ targetDir, runner = runClaudeCode, renderer = defaultRenderer }) → { enqueue(projectId, videoId, etapa, { ajuste } = {}): Promise<void>, isBusy(projectId, videoId): boolean, idle(): Promise<void> }`. `etapa` is `'roteiro' | 'producao' | 'render'`; `enqueue` resolves once the job is queued, not when it finishes. `idle()` resolves when the queue is empty (tests use it).

- [ ] **Step 1: Write the stage instructions**

`src/video-motor/PEDIDO-roteiro.md`:
```markdown
# Etapa 1: roteiro de um vídeo vertical (Reels)

Você está na pasta do vídeo. Leia `briefing.json` (assunto, objetivo, duração, tom, observação), `marca.json` (marca e identidade do cliente) e `material.json` (material real disponível: artes de Stories aprovados e fotos cruas, com o caminho absoluto).

Leia também `REGRAS.md` e os exemplos em `exemplos/` (são de formato; NÃO copie o visual nem a estrutura deles: cada vídeo é novo).

Entregue só nesta pasta:
1. `roteiro.json` no formato `{ "cenas": [ { "tipo": "<nome-curto-da-cena>", "fala": "<texto falado>", "descricao": "<o que aparece na tela, em uma ou duas frases>", "segura": <segundos, opcional> } ], "objetos": { opcional, prompts em inglês }, "estilo_imagens": "opcional" }`. Escreva a fala no estilo Reels (frases curtas, perguntas, exclamações). Tamanho: cerca de 2,6 palavras por segundo para caber na duração do briefing. Feche de acordo com o objetivo (REGRAS.md § Objetivo do vídeo).
2. Copie para `fotos/` as imagens do `material.json` que você vai usar (o logo já está em `fotos/logo.png`).
3. `NOTAS.md` com o conceito visual em 3 a 6 linhas.

Não gere voz, não gere imagens, não renderize. Se houver `ajuste.txt`, ele traz o pedido de ajuste do operador sobre o roteiro atual: aplique-o.
```

`src/video-motor/PEDIDO-producao.md`:
```markdown
# Etapa 2: produção do vídeo aprovado

O `roteiro.json` desta pasta foi aprovado pelo operador. Não mude as falas nem a ordem das cenas (pode acrescentar `"segura"` se uma cena precisar de mais tempo de imagem).

1. Se o roteiro declara `objetos`, rode `node <MOTOR>/gen-images.mjs .` uma vez. Se falhar por limite, siga sem aquele objeto e anote no NOTAS.md.
2. Rode `python <MOTOR>/tts.py .` UMA vez (gera `voz/tempos.json`; a voz já está configurada no roteiro).
3. Escreva `cenas.js` com as cenas só deste vídeo, seguindo `REGRAS.md` e o contrato do motor (`<MOTOR>/player.html`: helpers `st, p, eo, eio, back, lerp, flick, esc, asset, obj, R, S`; `A('palavra')` dá o instante da palavra na fala da própria cena). Use as fotos de `fotos/` com `asset('fotos/<arquivo>')`.
4. Confira: `node <MOTOR>/render.mjs . --stills 0.05,<vários instantes>` e olhe as imagens em `stills/`. Compare com as regras de qualidade 1 a 10 e corrija o `cenas.js` até todas valerem.
5. Escreva `legenda-post.txt` (legenda do post para o Instagram, com 3 a 6 hashtags) e atualize `NOTAS.md` (conceito, o que você conferiu, qualquer limitação).

Não rode o render completo. Se houver `ajuste.txt`, ele traz o pedido de ajuste do operador sobre a prévia atual: aplique-o.
```

- [ ] **Step 2: Write the failing tests**

`tests/content-central-video-jobs.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCentralProject, getCentralPaths } from '../src/content-central.js';
import { STATUS, createVideo, readVideo, updateVideo, videoDir } from '../src/content-central-video.js';
import { createVideoJobs, isUsageLimit, DIRECOES } from '../src/content-central-video-jobs.js';

const briefing = { assunto: 'Bio do Instagram', objetivo: 'alcance', duracao: 15, tom: 'vendedor', legenda: 'sem', observacao: 'usar Carvalho' };

async function withProject(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-video-jobs-'));
  try {
    await createCentralProject({ projectId: 'king', name: 'King' }, dir);
    const paths = getCentralPaths(dir, 'king');
    const project = JSON.parse(await readFile(paths.projectPath, 'utf8'));
    project.videoAnimado = { ativo: true, projetosDeMaterial: [], whatsapp: '65 98108-6707' };
    await writeFile(paths.projectPath, JSON.stringify(project));
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

// A fake Claude that writes the files a real run would, for each stage.
function fakeRunner(calls, { fail } = {}) {
  return async ({ prompt, cwd }) => {
    calls.push({ prompt, cwd });
    if (fail) throw fail;
    if (/Etapa 1/.test(prompt)) {
      await writeFile(join(cwd, 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'a', fala: 'Sua bio tem os cinco itens?', descricao: 'Pergunta' }, { tipo: 'b', fala: 'Comenta quantos tem a sua?', descricao: 'Enquete' }] }));
    } else {
      await writeFile(join(cwd, 'cenas.js'), 'window.VIDEO = {};');
      await mkdir(join(cwd, 'voz'), { recursive: true });
      await writeFile(join(cwd, 'voz', 'tempos.json'), JSON.stringify({ cenas: [{ words: [{ w: 'Sua', t: 0.05, d: 0.2 }] }, { words: [{ w: 'Comenta', t: 2, d: 0.3 }] }] }));
    }
    return { text: 'feito' };
  };
}

test('isUsageLimit recognises Claude Code limit messages', () => {
  assert.equal(isUsageLimit('Claude AI usage limit reached|1791700000'), true);
  assert.equal(isUsageLimit("You've hit your limit · resets 3pm"), true);
  assert.equal(isUsageLimit('erro de sintaxe'), false);
});

test('stage 1 prepares the folder, runs Claude with the stage prompt and forces brand, voice and caption', async () => {
  await withProject(async (dir) => {
    const calls = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner(calls), renderer: async () => ({}) });
    const video = await createVideo('king', briefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    const vdir = videoDir(dir, 'king', video.id);
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.ROTEIRO_PRONTO);
    assert.match(calls[0].prompt, /Etapa 1/);
    assert.equal(calls[0].cwd, vdir);
    for (const f of ['briefing.json', 'marca.json', 'material.json', 'REGRAS.md']) assert.ok(existsSync(join(vdir, f)), f);
    const roteiro = JSON.parse(await readFile(join(vdir, 'roteiro.json'), 'utf8'));
    assert.equal(roteiro.voz, 'gemini:Puck');
    assert.equal(roteiro.direcao, DIRECOES.vendedor);
    assert.equal(roteiro.legendas, false);
    assert.equal(roteiro.marca.whatsapp, '65 98108-6707');
  });
});

test('stage 2 runs Claude, checks the preview with the renderer and lands in previa_pronta', async () => {
  await withProject(async (dir) => {
    const calls = [];
    const renders = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner(calls), renderer: async (opts) => { renders.push(opts); return { stills: ['t0.05.jpg'] }; } });
    const video = await createVideo('king', briefing, dir);
    await jobs.enqueue('king', video.id, 'roteiro');
    await jobs.idle();
    await updateVideo('king', video.id, { status: STATUS.PRODUCAO_GERANDO }, dir);
    await jobs.enqueue('king', video.id, 'producao', { ajuste: 'mais rápido' });
    await jobs.idle();
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.PREVIA_PRONTA);
    assert.match(calls[1].prompt, /Etapa 2/);
    assert.equal(await readFile(join(videoDir(dir, 'king', video.id), 'ajuste.txt'), 'utf8'), 'mais rápido');
    assert.ok(renders[0].stills.length >= 2);
  });
});

test('a usage limit sets aguardando_limite and any other failure sets erro', async () => {
  await withProject(async (dir) => {
    const limite = Object.assign(new Error("You've hit your limit"), { limite: true });
    const jobsA = createVideoJobs({ targetDir: dir, runner: fakeRunner([], { fail: limite }), renderer: async () => ({}) });
    const a = await createVideo('king', briefing, dir);
    await jobsA.enqueue('king', a.id, 'roteiro');
    await jobsA.idle();
    assert.equal((await readVideo('king', a.id, dir)).status, STATUS.AGUARDANDO_LIMITE);
    const jobsB = createVideoJobs({ targetDir: dir, runner: fakeRunner([], { fail: new Error('quebrou') }), renderer: async () => ({}) });
    const b = await createVideo('king', briefing, dir);
    await jobsB.enqueue('king', b.id, 'roteiro');
    await jobsB.idle();
    const vb = await readVideo('king', b.id, dir);
    assert.equal(vb.status, STATUS.ERRO);
    assert.match(vb.erro, /quebrou/);
  });
});

test('jobs run one at a time', async () => {
  await withProject(async (dir) => {
    let running = 0;
    let peak = 0;
    const base = fakeRunner([]);
    const runner = async (input) => { running += 1; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 30)); try { return await base(input); } finally { running -= 1; } };
    const jobs = createVideoJobs({ targetDir: dir, runner, renderer: async () => ({}) });
    const a = await createVideo('king', briefing, dir);
    const b = await createVideo('king', briefing, dir);
    await jobs.enqueue('king', a.id, 'roteiro');
    await jobs.enqueue('king', b.id, 'roteiro');
    assert.equal(jobs.isBusy('king', a.id) || jobs.isBusy('king', b.id), true);
    await jobs.idle();
    assert.equal(peak, 1);
  });
});

test('stage 3 renders the full video and lands in pronto', async () => {
  await withProject(async (dir) => {
    const renders = [];
    const jobs = createVideoJobs({ targetDir: dir, runner: fakeRunner([]), renderer: async (opts) => { renders.push(opts); return { out: 'x' }; } });
    const video = await createVideo('king', briefing, dir);
    await updateVideo('king', video.id, { status: STATUS.RENDER_GERANDO }, dir);
    await jobs.enqueue('king', video.id, 'render');
    await jobs.idle();
    assert.equal((await readVideo('king', video.id, dir)).status, STATUS.PRONTO);
    assert.deepEqual(renders, [{ videoDir: videoDir(dir, 'king', video.id) }]);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test tests/content-central-video-jobs.test.js`
Expected: FAIL, `Cannot find module '…/src/content-central-video-jobs.js'`.

- [ ] **Step 4: Write `src/content-central-video-jobs.js`**

```js
// Runs the Vídeo animado stages: Claude Code writes the script (stage 1) and
// the per-video scene code (stage 2) inside the video folder; the motor
// renders the MP4 (stage 3). One job at a time: Claude, Whisper and the
// renderer all compete for the same CPU.
import { spawn } from 'node:child_process';
import { copyFile, writeFile, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, getCentralPaths } from './content-central.js';
import {
  STATUS, requireVideoProject, readVideo, updateVideo, videoDir, validateRoteiro, buildMarca, buildMaterialInventory, normalizeVideoAnimado,
} from './content-central-video.js';

const MOTOR_DIR = fileURLToPath(new URL('./video-motor/', import.meta.url));
const CLAUDE_TIMEOUT_MS = 45 * 60 * 1000;

export const DIRECOES = {
  criador: 'Leia em português do Brasil, como um criador de conteúdo de Instagram: animado, sorrindo, ritmo rápido, com energia e variação de entonação, dando ênfase nas palavras importantes. Leia exatamente o texto abaixo, sem acrescentar nada:',
  vendedor: 'Leia em português do Brasil, como um vendedor simpático e confiante de loja de bairro: próximo, caloroso e natural, sem exagero, com ritmo de anúncio de Instagram. Leia exatamente o texto abaixo, sem acrescentar nada:',
};

export function isUsageLimit(text) {
  return /usage limit|hit your limit|limit reached|limite de uso/i.test(String(text || ''));
}

// Same shape as runClaudeTurn (content-central-brain.js): prompt on stdin
// (Windows command-line limit), project settings only (no personal plugins
// or hooks restyling the work), JSON result. Here Claude edits files and
// runs the motor, so it gets file tools and Bash.
export function runClaudeCode({ prompt, cwd, addDirs = [], timeoutMs = CLAUDE_TIMEOUT_MS }) {
  const args = ['-p', '--output-format', 'json', '--setting-sources', 'project', '--model', 'opus',
    '--permission-mode', 'bypassPermissions', '--tools', 'Read,Write,Edit,Bash,Glob,Grep',
    ...addDirs.flatMap((d) => ['--add-dir', d])];
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('O Claude Code passou de 45 minutos e foi interrompido.')); }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`Não consegui abrir o Claude Code: ${err.message}`)); });
    child.on('close', () => {
      clearTimeout(timer);
      let result;
      try { result = JSON.parse(stdout); } catch {
        const text = (stderr || stdout || 'O Claude Code não respondeu.').trim().slice(-600);
        return reject(Object.assign(new Error(text), { limite: isUsageLimit(text) }));
      }
      const text = String(result.result || '');
      if (result.is_error) return reject(Object.assign(new Error(text.slice(-600) || 'O Claude Code devolveu erro.'), { limite: isUsageLimit(text) }));
      resolve({ text });
    });
    child.stdin.end(prompt);
  });
}

const defaultRenderer = async (opts) => (await import('./video-motor/render.mjs')).renderVideo(opts);

async function prepareFolder(project, video, dir, targetDir) {
  const settings = normalizeVideoAnimado(project.videoAnimado);
  const marca = buildMarca(project, settings);
  await writeJson(join(dir, 'briefing.json'), video.briefing);
  await writeJson(join(dir, 'marca.json'), {
    marca,
    identidade: project.brand?.visualStyle || '',
    empresa: project.companyProfile || {},
  });
  await writeJson(join(dir, 'material.json'), await buildMaterialInventory(settings.projetosDeMaterial, targetDir));
  const logo = project.brand?.logoPath ? join(getCentralPaths(targetDir, project.projectId).projectDir, project.brand.logoPath) : null;
  if (logo && existsSync(logo)) await copyFile(logo, join(dir, 'fotos', 'logo.png'));
  await copyFile(join(MOTOR_DIR, 'REGRAS.md'), join(dir, 'REGRAS.md'));
  await cp(join(MOTOR_DIR, 'exemplos'), join(dir, 'exemplos'), { recursive: true });
  return { marca, settings };
}

async function writeAjuste(dir, ajuste) {
  const path = join(dir, 'ajuste.txt');
  if (ajuste) await writeFile(path, ajuste);
  else await rm(path, { force: true });
}

function stagePrompt(nome, video) {
  const b = video.briefing;
  return [
    `Leia e siga ${join(MOTOR_DIR, nome)}. Onde ele diz <MOTOR>, use: ${MOTOR_DIR}`,
    `Assunto: ${b.assunto}. Objetivo: ${b.objetivo}. Duração alvo: ${b.duracao}s.${b.observacao ? ` Observação do operador: ${b.observacao}` : ''}`,
  ].join('\n');
}

export function createVideoJobs({ targetDir, runner = runClaudeCode, renderer = defaultRenderer }) {
  const queue = [];
  const busy = new Set();
  let running = null;

  async function etapaRoteiro(projectId, video, dir, { ajuste }) {
    const project = await requireVideoProject(projectId, targetDir);
    const { marca, settings } = await prepareFolder(project, video, dir, targetDir);
    await writeAjuste(dir, ajuste);
    const addDirs = [MOTOR_DIR, ...settings.projetosDeMaterial.map((id) => getCentralPaths(targetDir, id).assetsDir)];
    await runner({ prompt: `# Etapa 1\n${stagePrompt('PEDIDO-roteiro.md', video)}`, cwd: dir, addDirs });
    const roteiro = await readJson(join(dir, 'roteiro.json'), null);
    if (!roteiro) throw new Error('O Claude não escreveu o roteiro.json.');
    // Brand, voice and caption come from the briefing, never from the model.
    roteiro.marca = marca;
    roteiro.voz = 'gemini:Puck';
    roteiro.velocidade = '+6%';
    roteiro.direcao = DIRECOES[video.briefing.tom];
    roteiro.objetivo = video.briefing.objetivo;
    delete roteiro.legenda;
    delete roteiro.legendas;
    if (video.briefing.legenda === 'sem') roteiro.legendas = false;
    else if (video.briefing.legenda !== 'do-video') roteiro.legenda = video.briefing.legenda;
    const { erros } = validateRoteiro(roteiro, video.briefing);
    if (erros.length) throw new Error(erros.join(' '));
    await writeJson(join(dir, 'roteiro.json'), roteiro);
    return STATUS.ROTEIRO_PRONTO;
  }

  async function etapaProducao(projectId, video, dir, { ajuste }) {
    await writeAjuste(dir, ajuste);
    await runner({ prompt: `# Etapa 2\n${stagePrompt('PEDIDO-producao.md', video)}`, cwd: dir, addDirs: [MOTOR_DIR] });
    for (const f of ['cenas.js', 'voz/tempos.json']) if (!existsSync(join(dir, f))) throw new Error(`A produção não gerou ${f}.`);
    // Mechanical check: the scenes draw at every scene start without errors.
    const tempos = await readJson(join(dir, 'voz', 'tempos.json'), { cenas: [] });
    const marcas = [0.05, ...tempos.cenas.map((c) => c.words?.[c.words.length - 1]).filter(Boolean).map((w) => Math.round((w.t + w.d) * 100) / 100)];
    await renderer({ videoDir: dir, stills: marcas });
    return STATUS.PREVIA_PRONTA;
  }

  async function etapaRender(projectId, video, dir) {
    await renderer({ videoDir: dir });
    return STATUS.PRONTO;
  }

  const ETAPAS = { roteiro: etapaRoteiro, producao: etapaProducao, render: etapaRender };

  async function pump() {
    if (running) return;
    const job = queue.shift();
    if (!job) return;
    running = job;
    const { projectId, videoId, etapa, opts } = job;
    try {
      const video = await readVideo(projectId, videoId, targetDir);
      const dir = videoDir(targetDir, projectId, videoId);
      const status = await ETAPAS[etapa](projectId, video, dir, opts);
      await updateVideo(projectId, videoId, { status }, targetDir);
    } catch (err) {
      await updateVideo(projectId, videoId, { status: err.limite ? STATUS.AGUARDANDO_LIMITE : STATUS.ERRO, erro: String(err.message || err).slice(0, 800), etapaComErro: etapa }, targetDir).catch(() => {});
    } finally {
      busy.delete(`${projectId}/${videoId}`);
      running = null;
      job.done();
      pump();
    }
  }

  return {
    async enqueue(projectId, videoId, etapa, opts = {}) {
      if (!ETAPAS[etapa]) throw new Error(`Etapa desconhecida: ${etapa}`);
      let done;
      const finished = new Promise((r) => { done = r; });
      busy.add(`${projectId}/${videoId}`);
      queue.push({ projectId, videoId, etapa, opts, done, finished });
      pump();
    },
    isBusy: (projectId, videoId) => busy.has(`${projectId}/${videoId}`),
    async idle() {
      while (running || queue.length) await (running || queue[0]).finished;
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/content-central-video-jobs.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Lint and commit** (PowerShell)

```powershell
npx eslint src/content-central-video-jobs.js tests/content-central-video-jobs.test.js
git add src/content-central-video-jobs.js tests/content-central-video-jobs.test.js src/video-motor/PEDIDO-roteiro.md src/video-motor/PEDIDO-producao.md
git commit -m "feat(video): Claude Code runner, stage prompts and one-at-a-time video job queue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server endpoints and project summary

**Files:**
- Modify: `src/content-central-server.js`. Import; the `startContentCentralServer` options and context; the startup reconcile; a new route block right after the `brain` block (before `if (method !== 'POST') return 405`).
- Modify: `src/content-central.js` → `toProjectSummary()` adds `videoAnimado`.
- Test: `tests/content-central-video-server.test.js`

**Interfaces:**
- Consumes (Task 2): `normalizeVideoAnimado`, `requireVideoProject`, `createVideo`, `listVideos`, `readVideoState`, `updateVideo`, `saveRoteiroCenas`, `deleteVideo`, `reconcileInterruptedVideos`, `videoDir`, `STATUS`. From Task 3: `createVideoJobs`.
- Produces (HTTP, consumed by Task 5):

| Method | Path | Body | 2xx response |
|---|---|---|---|
| GET | `/api/projects/:id/videos` | — | `{ videos: summary[] }` |
| POST | `/api/projects/:id/videos` | briefing | `201 { video }` |
| GET | `/api/projects/:id/videos/:vid` | — | `{ video, roteiro, estimativa, avisos, stills, arquivos, vozUsada, ocupado }` |
| POST | `/api/projects/:id/videos/:vid/roteiro` | `{ cenas }` | `{ roteiro }` |
| POST | `/api/projects/:id/videos/:vid/ajuste` | `{ etapa: 'roteiro'\|'producao', pedido }` | `{ video }` |
| POST | `/api/projects/:id/videos/:vid/aprovar-roteiro` | — | `{ video }` |
| POST | `/api/projects/:id/videos/:vid/aprovar-previa` | — | `{ video }` |
| POST | `/api/projects/:id/videos/:vid/retomar` | — | `{ video }` |
| POST | `/api/projects/:id/videos/:vid/excluir` | — | `{ ok: true }` |
| GET | `/api/projects/:id/videos/:vid/arquivo/<nome>` | — | file (`video.mp4` with Range support) |

  Errors are `{ error }` with `err.status` (400/404/409), 400 by default. `<nome>` must match `^(video\.mp4|trecho\.mp4|voz/narracao\.(mp3|txt)|legenda-post\.txt|NOTAS\.md|stills/t[\d.]+\.jpg)$`.
- `ProjectSummary.videoAnimado: { ativo: boolean, projetosDeMaterial: string[], whatsapp: string }`.

- [ ] **Step 1: Write the failing tests**

`tests/content-central-video-server.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startContentCentralServer } from '../src/content-central-server.js';
import { createCentralProject, getCentralPaths } from '../src/content-central.js';
import { STATUS, updateVideo, videoDir } from '../src/content-central-video.js';

const realFetch = globalThis.fetch;
const briefing = { assunto: 'Bio', objetivo: 'alcance', duracao: 15, tom: 'criador', legenda: 'pop' };

async function withServer(fn, { ativo = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-video-server-'));
  await createCentralProject({ projectId: 'king', name: 'King' }, dir);
  const path = getCentralPaths(dir, 'king').projectPath;
  const project = JSON.parse(await readFile(path, 'utf8'));
  project.videoAnimado = { ativo, projetosDeMaterial: [] };
  await writeFile(path, JSON.stringify(project));
  const enqueued = [];
  const videoJobs = { enqueue: async (...args) => { enqueued.push(args); }, isBusy: () => false, idle: async () => {} };
  const server = await startContentCentralServer({ targetDir: dir, port: 0, openBrowser: false, videoJobs });
  try { return await fn(dir, server, enqueued); } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

async function call(server, path, body) {
  const res = await realFetch(`${server.url}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text, headers: res.headers };
}

test('video routes are 404 when the project does not have the feature', async () => {
  await withServer(async (_dir, server) => {
    assert.equal((await call(server, '/api/projects/king/videos')).status, 404);
    assert.equal((await call(server, '/api/projects/king/videos', briefing)).status, 404);
  }, { ativo: false });
});

test('creating a video queues stage 1 and the list shows it; the summary carries videoAnimado', async () => {
  await withServer(async (_dir, server, enqueued) => {
    const created = await call(server, '/api/projects/king/videos', briefing);
    assert.equal(created.status, 201);
    assert.deepEqual(enqueued, [['king', created.body.video.id, 'roteiro', {}]]);
    const list = await call(server, '/api/projects/king/videos');
    assert.equal(list.body.videos.length, 1);
    const state = await call(server, '/api/state');
    assert.equal(state.body.projects.find((p) => p.projectId === 'king').videoAnimado.ativo, true);
    assert.equal((await call(server, '/api/projects/king/videos', { ...briefing, duracao: 7 })).status, 400);
  });
});

test('approve, adjust and resume move the status and queue the right stage', async () => {
  await withServer(async (dir, server, enqueued) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    const id = body.video.id;
    assert.equal((await call(server, `/api/projects/king/videos/${id}/aprovar-roteiro`, {})).status, 409);
    await updateVideo('king', id, { status: STATUS.ROTEIRO_PRONTO }, dir);
    await writeFile(join(videoDir(dir, 'king', id), 'roteiro.json'), JSON.stringify({ cenas: [{ tipo: 'a', fala: 'Oi?', descricao: 'x' }] }));
    const saved = await call(server, `/api/projects/king/videos/${id}/roteiro`, { cenas: [{ tipo: 'a', fala: 'Olá, tudo bem?', descricao: 'x' }] });
    assert.equal(saved.body.roteiro.cenas[0].fala, 'Olá, tudo bem?');
    const adj = await call(server, `/api/projects/king/videos/${id}/ajuste`, { etapa: 'roteiro', pedido: 'mais curto' });
    assert.equal(adj.body.video.status, STATUS.ROTEIRO_GERANDO);
    assert.deepEqual(enqueued.at(-1), ['king', id, 'roteiro', { ajuste: 'mais curto' }]);
    await updateVideo('king', id, { status: STATUS.ROTEIRO_PRONTO }, dir);
    const ap = await call(server, `/api/projects/king/videos/${id}/aprovar-roteiro`, {});
    assert.equal(ap.body.video.status, STATUS.PRODUCAO_GERANDO);
    assert.deepEqual(enqueued.at(-1), ['king', id, 'producao', {}]);
    await updateVideo('king', id, { status: STATUS.PREVIA_PRONTA }, dir);
    const ok = await call(server, `/api/projects/king/videos/${id}/aprovar-previa`, {});
    assert.equal(ok.body.video.status, STATUS.RENDER_GERANDO);
    await updateVideo('king', id, { status: STATUS.ERRO, etapaComErro: 'render' }, dir);
    const again = await call(server, `/api/projects/king/videos/${id}/retomar`, {});
    assert.equal(again.body.video.status, STATUS.RENDER_GERANDO);
    assert.deepEqual(enqueued.at(-1), ['king', id, 'render', {}]);
  });
});

test('files are served from a whitelist, the MP4 honours Range', async () => {
  await withServer(async (dir, server) => {
    const { body } = await call(server, '/api/projects/king/videos', briefing);
    const vdir = videoDir(dir, 'king', body.video.id);
    await writeFile(join(vdir, 'video.mp4'), Buffer.from('0123456789'));
    await mkdir(join(vdir, 'stills'), { recursive: true });
    await writeFile(join(vdir, 'stills', 't0.05.jpg'), 'jpg');
    const base = `${server.url}/api/projects/king/videos/${body.video.id}/arquivo`;
    const ranged = await realFetch(`${base}/video.mp4`, { headers: { range: 'bytes=2-5' } });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), '2345');
    assert.equal((await realFetch(`${base}/stills/t0.05.jpg`)).status, 200);
    assert.equal((await realFetch(`${base}/video.json`)).status, 404);
    assert.equal((await realFetch(`${base}/..%2F..%2Fproject.json`)).status, 404);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/content-central-video-server.test.js`
Expected: FAIL. The first test gets a 404 for the wrong reason or a 405. The others fail on `created.status` (405/404).

- [ ] **Step 3: Add `videoAnimado` to the summary**

In `src/content-central.js`, add to the imports at the top of the file:
```js
import { normalizeVideoAnimado } from './content-central-video.js';
```
and in `toProjectSummary(project)`, right after the `contractedPlan: …` line:
```js
    videoAnimado: normalizeVideoAnimado(project.videoAnimado),
```
`content-central-video.js` imports from `content-central.js`, and ESM handles this cycle because `normalizeVideoAnimado` is only called at request time. If the test run shows `normalizeVideoAnimado is not a function` at import time, move `normalizeVideoAnimado` into `content-central.js`, export it from there, and re-export it from `content-central-video.js`.

- [ ] **Step 4: Wire the server**

In `src/content-central-server.js`:

1. Imports, next to the brain import:
```js
import { createReadStream, statSync } from 'node:fs';
import {
  STATUS as VIDEO_STATUS, requireVideoProject, createVideo, listVideos, readVideoState, readVideo, updateVideo, saveRoteiroCenas, deleteVideo, reconcileInterruptedVideos, videoDir,
} from './content-central-video.js';
import { createVideoJobs } from './content-central-video-jobs.js';
```
(If `createReadStream`/`statSync` are already imported from `node:fs`, extend that import instead.)

2. In the `startContentCentralServer({ … })` parameter list, after `brainRunner = null,` add `videoJobs = null,`. After `await reconcileInterruptedGenerations(…)`, add:
```js
  await reconcileInterruptedVideos(targetDir).catch((err) => console.error('[content-central] reconcile interrupted videos failed:', err.message));
```
and in the `context` object, after `brainRunner: …,`:
```js
    videoJobs: videoJobs || createVideoJobs({ targetDir }),
```

3. Right after the closing `}` of the `if (parts[3] === 'brain') { … }` block, add:
```js
  // Vídeo animado (content-central-video*.js). Errors come back as JSON
  // with their status so the tab can show them.
  if (parts[3] === 'videos') {
    try {
      await requireVideoProject(projectId, targetDir);
      const jobs = context.videoJobs;
      const vid = parts[4];
      if (method === 'GET' && parts.length === 4) return sendJson(res, 200, { videos: await listVideos(projectId, targetDir) });
      if (method === 'POST' && parts.length === 4) {
        const video = await createVideo(projectId, await readBody(req), targetDir);
        await jobs.enqueue(projectId, video.id, 'roteiro', {});
        return sendJson(res, 201, { video });
      }
      if (method === 'GET' && parts.length === 5) return sendJson(res, 200, { ...await readVideoState(projectId, vid, targetDir), ocupado: jobs.isBusy(projectId, vid) });
      if (method === 'GET' && parts[5] === 'arquivo') return sendVideoFile(req, res, videoDir(targetDir, projectId, vid), parts.slice(6).join('/'));
      if (method === 'POST' && parts.length === 6) {
        const body = await readBody(req);
        const video = await readVideo(projectId, vid, targetDir);
        const exige = (status) => { if (video.status !== status) throw Object.assign(new Error('Ação indisponível nesta etapa.'), { status: 409 }); };
        const iniciar = async (status, etapa, opts = {}) => {
          const next = await updateVideo(projectId, vid, { status }, targetDir);
          await jobs.enqueue(projectId, vid, etapa, opts);
          return sendJson(res, 200, { video: next });
        };
        if (parts[5] === 'roteiro') return sendJson(res, 200, { roteiro: await saveRoteiroCenas(projectId, vid, body.cenas, targetDir) });
        if (parts[5] === 'ajuste') {
          const pedido = String(body.pedido || '').trim();
          if (!pedido) throw Object.assign(new Error('Escreva o ajuste.'), { status: 400 });
          if (body.etapa === 'roteiro') { exige(VIDEO_STATUS.ROTEIRO_PRONTO); return iniciar(VIDEO_STATUS.ROTEIRO_GERANDO, 'roteiro', { ajuste: pedido }); }
          if (body.etapa === 'producao') { exige(VIDEO_STATUS.PREVIA_PRONTA); return iniciar(VIDEO_STATUS.PRODUCAO_GERANDO, 'producao', { ajuste: pedido }); }
          throw Object.assign(new Error('Etapa de ajuste inválida.'), { status: 400 });
        }
        if (parts[5] === 'aprovar-roteiro') { exige(VIDEO_STATUS.ROTEIRO_PRONTO); return iniciar(VIDEO_STATUS.PRODUCAO_GERANDO, 'producao'); }
        if (parts[5] === 'aprovar-previa') { exige(VIDEO_STATUS.PREVIA_PRONTA); return iniciar(VIDEO_STATUS.RENDER_GERANDO, 'render'); }
        if (parts[5] === 'retomar') {
          if (![VIDEO_STATUS.ERRO, VIDEO_STATUS.INTERROMPIDO, VIDEO_STATUS.AGUARDANDO_LIMITE].includes(video.status)) throw Object.assign(new Error('Nada para retomar.'), { status: 409 });
          const etapa = { roteiro_gerando: 'roteiro', producao_gerando: 'producao', render_gerando: 'render' }[video.etapaInterrompida] || video.etapaComErro || 'roteiro';
          const status = { roteiro: VIDEO_STATUS.ROTEIRO_GERANDO, producao: VIDEO_STATUS.PRODUCAO_GERANDO, render: VIDEO_STATUS.RENDER_GERANDO }[etapa];
          return iniciar(status, etapa);
        }
        if (parts[5] === 'excluir') { await deleteVideo(projectId, vid, targetDir); return sendJson(res, 200, { ok: true }); }
      }
      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      return sendJson(res, err.status || 400, { error: err.message });
    }
  }
```

4. Add this helper near `sendJson` (bottom of the file):
```js
const VIDEO_FILES = /^(video\.mp4|trecho\.mp4|voz\/narracao\.(mp3|txt)|legenda-post\.txt|NOTAS\.md|stills\/t[\d.]+\.jpg)$/;
const VIDEO_MIME = { '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.jpg': 'image/jpeg' };

// Whitelisted files of a video folder; MP4/MP3 honour Range so the player can seek.
function sendVideoFile(req, res, dir, name) {
  const decoded = decodeURIComponent(name);
  if (!VIDEO_FILES.test(decoded)) return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
  const file = join(dir, ...decoded.split('/'));
  let size;
  try { size = statSync(file).size; } catch { return sendJson(res, 404, { error: 'Arquivo não encontrado.' }); }
  const type = VIDEO_MIME[extname(file)] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  return createReadStream(file).pipe(res);
}
```
(`join` and `extname` from `node:path` are already imported in this file; check them and add whichever is missing.)

- [ ] **Step 5: Run the new tests and the neighbours**

Run: `node --test tests/content-central-video-server.test.js`
Expected: PASS (4 tests).
Run: `node --test tests/content-central-brain-server.test.js`
Expected: PASS (unchanged).

- [ ] **Step 6: Full root suite**

Run: `npm test`
Expected: PASS. It takes about 2.5 min. Any failure outside the new files is a regression to fix before committing.

- [ ] **Step 7: Lint and commit** (PowerShell)

```powershell
npx eslint src/content-central-server.js src/content-central.js tests/content-central-video-server.test.js
git add src/content-central-server.js src/content-central.js tests/content-central-video-server.test.js
git commit -m "feat(video): /api/projects/:id/videos endpoints, file serving with Range, summary flag" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The "Vídeo animado" tab

**Files:**
- Modify: `content-central-app/src/api/client.ts` (types + functions; `ProjectSummary.videoAnimado`)
- Create: `content-central-app/src/pages/workspace/VideoAnimado.tsx`, `content-central-app/src/pages/workspace/VideoAnimado.module.css`
- Modify: `content-central-app/src/layouts/ProjectWorkspaceLayout.tsx` (conditional section)
- Modify: `content-central-app/src/App.tsx` (route `video`)
- Test: `content-central-app/src/pages/workspace/VideoAnimado.test.tsx`

**Interfaces:**
- Consumes: the HTTP table in Task 4 (exact paths and shapes).
- Produces: route `/projects/:projectId/video`; sidebar entry "Vídeo animado" only when `project.videoAnimado?.ativo`.

- [ ] **Step 1: Add the client types and calls** (`client.ts`)

In `export interface ProjectSummary { … }`, add:
```ts
  videoAnimado?: { ativo: boolean; projetosDeMaterial: string[]; whatsapp: string };
```
At the end of the file:
```ts
export type VideoStatus = "roteiro_gerando" | "roteiro_pronto" | "producao_gerando" | "previa_pronta" | "render_gerando" | "pronto" | "erro" | "aguardando_limite" | "interrompido";
export interface VideoBriefing { assunto: string; objetivo: "alcance" | "anuncio"; duracao: 15 | 30 | 45 | 60; tom: "criador" | "vendedor"; legenda: "simples" | "karaoke" | "pop" | "destaque" | "caixa" | "do-video" | "sem"; observacao?: string }
export interface VideoCena { tipo: string; fala: string; descricao: string; segura?: number }
export interface VideoSummary { id: string; assunto: string; objetivo: string; duracao: number; status: VideoStatus; erro: string | null; criadoEm: string; atualizadoEm: string; temVideo: boolean }
export interface VideoRecord { id: string; projectId: string; briefing: VideoBriefing; status: VideoStatus; erro: string | null; criadoEm: string; atualizadoEm: string }
export interface VideoState {
  video: VideoRecord; roteiro: { cenas: VideoCena[] } | null; estimativa: number | null; avisos: string[]; stills: string[];
  arquivos: { video: boolean; narracaoMp3: boolean; narracaoTxt: boolean; legendaPost: boolean; notas: boolean }; vozUsada: string | null; ocupado: boolean;
}
const videosPath = (projectId: string, rest = "") => `/api/projects/${encodeURIComponent(projectId)}/videos${rest}`;
export const videoFileUrl = (projectId: string, videoId: string, name: string) => videosPath(projectId, `/${encodeURIComponent(videoId)}/arquivo/${name}`);
export function listVideos(projectId: string): Promise<{ videos: VideoSummary[] }> {
  return api(videosPath(projectId));
}
export function createVideo(projectId: string, briefing: VideoBriefing): Promise<{ video: VideoRecord }> {
  return api(videosPath(projectId), { method: "POST", body: JSON.stringify(briefing) });
}
export function getVideo(projectId: string, videoId: string): Promise<VideoState> {
  return api(videosPath(projectId, `/${encodeURIComponent(videoId)}`));
}
export function saveVideoRoteiro(projectId: string, videoId: string, cenas: VideoCena[]): Promise<{ roteiro: { cenas: VideoCena[] } }> {
  return api(videosPath(projectId, `/${encodeURIComponent(videoId)}/roteiro`), { method: "POST", body: JSON.stringify({ cenas }) });
}
export function videoAction(projectId: string, videoId: string, action: "aprovar-roteiro" | "aprovar-previa" | "retomar" | "excluir", body: unknown = {}): Promise<{ video?: VideoRecord; ok?: boolean }> {
  return api(videosPath(projectId, `/${encodeURIComponent(videoId)}/${action}`), { method: "POST", body: JSON.stringify(body) });
}
export function requestVideoAdjustment(projectId: string, videoId: string, etapa: "roteiro" | "producao", pedido: string): Promise<{ video: VideoRecord }> {
  return api(videosPath(projectId, `/${encodeURIComponent(videoId)}/ajuste`), { method: "POST", body: JSON.stringify({ etapa, pedido }) });
}
```

- [ ] **Step 2: Write the failing tests** (`VideoAnimado.test.tsx`)

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

afterEach(() => vi.unstubAllGlobals());

type Route = (url: string, init?: RequestInit) => unknown;
function stubApi(route: Route) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = route(url, init);
    return Promise.resolve({ ok: !(body as { __status?: number })?.__status, text: async () => JSON.stringify(body) });
  }));
  return calls;
}

const project = (ativo: boolean) => ({ projects: [{ projectId: "king", name: "King", videoAnimado: { ativo, projetosDeMaterial: [], whatsapp: "" }, contentStrategy: { offers: [{ id: "o1", name: "Encarte da semana" }], topicIdeas: { goals: { authority: { items: [{ id: "t1", title: "Diagnóstico antes do anúncio" }] } } } } }], globalRules: {} });

const roteiroPronto = {
  video: { id: "v1", projectId: "king", briefing: { assunto: "Bio", objetivo: "alcance", duracao: 15, tom: "criador", legenda: "pop" }, status: "roteiro_pronto", erro: null, criadoEm: "2026-10-10T10:00:00Z", atualizadoEm: "2026-10-10T10:05:00Z" },
  roteiro: { cenas: [{ tipo: "a", fala: "Sua bio tem os cinco?", descricao: "Pergunta" }, { tipo: "b", fala: "Comenta quantos!", descricao: "Enquete" }] },
  estimativa: 3.1, avisos: ["Tempo estimado 3.1s, a meta é 15s."], stills: [], arquivos: { video: false, narracaoMp3: false, narracaoTxt: false, legendaPost: false, notas: false }, vozUsada: null, ocupado: false,
};

function renderAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe("Vídeo animado", () => {
  it("only shows in the sidebar when the project has it on", async () => {
    stubApi((url) => (url === "/api/state" ? project(false) : { videos: [] }));
    renderAt("/projects/king/visao-geral");
    expect(await screen.findByText("King")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Vídeo animado" })).not.toBeInTheDocument();
  });

  it("creates a video from a registered subject with objective, duration, tone and caption", async () => {
    const calls = stubApi((url, init) => {
      if (url === "/api/state") return project(true);
      if (url.endsWith("/videos") && init?.method === "POST") return { video: { ...roteiroPronto.video, id: "v2", status: "roteiro_gerando" } };
      if (url.endsWith("/videos")) return { videos: [] };
      return { ...roteiroPronto, video: { ...roteiroPronto.video, id: "v2", status: "roteiro_gerando" }, roteiro: null, ocupado: true };
    });
    renderAt("/projects/king/video");
    await userEvent.click(await screen.findByRole("button", { name: "Novo vídeo" }));
    await userEvent.selectOptions(screen.getByLabelText("Importar assunto"), "Diagnóstico antes do anúncio");
    await userEvent.click(screen.getByRole("radio", { name: "Anúncio" }));
    await userEvent.click(screen.getByRole("radio", { name: "30s" }));
    await userEvent.selectOptions(screen.getByLabelText("Legenda"), "karaoke");
    await userEvent.click(screen.getByRole("button", { name: "Gerar roteiro" }));
    const post = calls.find((c) => c.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ assunto: "Diagnóstico antes do anúncio", objetivo: "anuncio", duracao: 30, tom: "criador", legenda: "karaoke" });
    expect(await screen.findByText(/Escrevendo o roteiro/)).toBeInTheDocument();
  });

  it("shows the script as editable scene cards with the time bar, saves and approves", async () => {
    const calls = stubApi((url, init) => {
      if (url === "/api/state") return project(true);
      if (url.endsWith("/videos")) return { videos: [{ id: "v1", assunto: "Bio", objetivo: "alcance", duracao: 15, status: "roteiro_pronto", erro: null, criadoEm: "", atualizadoEm: "", temVideo: false }] };
      if (url.endsWith("/roteiro")) return { roteiro: { cenas: JSON.parse(String(init?.body)).cenas } };
      if (url.endsWith("/aprovar-roteiro")) return { video: { ...roteiroPronto.video, status: "producao_gerando" } };
      return roteiroPronto;
    });
    renderAt("/projects/king/video?v=v1");
    const cards = await screen.findAllByTestId("cena");
    expect(cards).toHaveLength(2);
    // 5 words + 2 words at 2.6 words/s: 1.9s + 0.8s.
    expect(screen.getByText(/2.7s de 15s/)).toBeInTheDocument();
    expect(screen.getByText(/a meta é 15s/)).toBeInTheDocument();
    const fala = within(cards[0]).getByLabelText("Fala da cena 1");
    await userEvent.clear(fala);
    await userEvent.type(fala, "Sua bio convence?");
    await userEvent.click(screen.getByRole("button", { name: "Aprovar roteiro" }));
    const saved = calls.find((c) => c.url.endsWith("/roteiro"));
    expect(JSON.parse(String(saved?.init?.body)).cenas[0].fala).toBe("Sua bio convence?");
    expect(calls.some((c) => c.url.endsWith("/aprovar-roteiro"))).toBe(true);
  });

  it("final video offers the player, download, post caption and narration text", async () => {
    stubApi((url) => {
      if (url === "/api/state") return project(true);
      if (url.endsWith("/videos")) return { videos: [] };
      return { ...roteiroPronto, video: { ...roteiroPronto.video, status: "pronto" }, arquivos: { video: true, narracaoMp3: true, narracaoTxt: true, legendaPost: true, notas: true }, vozUsada: "gemini:Puck" };
    });
    renderAt("/projects/king/video?v=v1");
    expect(await screen.findByRole("link", { name: "Baixar MP4" })).toHaveAttribute("href", "/api/projects/king/videos/v1/arquivo/video.mp4");
    expect(screen.getByRole("link", { name: "Texto da narração" })).toHaveAttribute("href", "/api/projects/king/videos/v1/arquivo/voz/narracao.txt");
    expect(screen.getByRole("link", { name: "Legenda do post" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd content-central-app; npx vitest run src/pages/workspace/VideoAnimado.test.tsx`
Expected: FAIL (no route or section, missing labels).

- [ ] **Step 4: Sidebar and route**

`ProjectWorkspaceLayout.tsx`, in `SECTIONS` after the `carrossel` entry:
```ts
  { to: "video", label: "Vídeo animado", group: "Conteúdo", onlyIf: (p: ProjectSummary) => Boolean(p.videoAnimado?.ativo) },
```
and change the filter to:
```tsx
          {SECTIONS.filter((section) => !(section.hideForCatalog && project.projectType === "catalog") && (!("onlyIf" in section) || section.onlyIf?.(project))).map((section, index, visible) => {
```
(If TypeScript complains about the union, type `SECTIONS` as `Array<{ to: string; label: string; group: string | null; hideForCatalog?: boolean; catalogLabel?: string; onlyIf?: (p: ProjectSummary) => boolean }>` and use `!section.onlyIf || section.onlyIf(project)`.)

`App.tsx`: import `VideoAnimado` next to `Carousels` and add after the carrossel route:
```tsx
          <Route path="video" element={<VideoAnimado />} />
```

- [ ] **Step 5: Write the page** (`VideoAnimado.tsx`)

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
  createVideo, getVideo, listVideos, requestVideoAdjustment, saveVideoRoteiro, videoAction, videoFileUrl,
  type VideoBriefing, type VideoCena, type VideoState, type VideoSummary,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import styles from "./VideoAnimado.module.css";

const ROTULO: Record<string, string> = {
  roteiro_gerando: "Escrevendo o roteiro…", roteiro_pronto: "Roteiro para revisar", producao_gerando: "Produzindo (voz, cenas e prévia)…",
  previa_pronta: "Prévia para revisar", render_gerando: "Gerando o vídeo final…", pronto: "Pronto", erro: "Erro",
  aguardando_limite: "Aguardando o limite do Claude Code", interrompido: "Interrompido",
};
const GERANDO = new Set(["roteiro_gerando", "producao_gerando", "render_gerando"]);
const LEGENDAS: Array<[VideoBriefing["legenda"], string]> = [["do-video", "Do vídeo (sob medida)"], ["simples", "Simples"], ["karaoke", "Karaokê"], ["pop", "Pop (palavra por vez)"], ["destaque", "Destaque"], ["caixa", "Caixa"], ["sem", "Sem legenda"]];
const PALAVRAS_POR_SEGUNDO = 2.6;
const segundos = (fala: string) => Math.round(((fala.match(/[\p{L}\d]+/gu) || []).length / PALAVRAS_POR_SEGUNDO) * 10) / 10;

export function VideoAnimado() {
  const { project } = useOutletContext<WorkspaceContext>();
  const [params, setParams] = useSearchParams();
  const selected = params.get("v");
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [novo, setNovo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => listVideos(project.projectId).then((r) => setVideos(r.videos)).catch((e: Error) => setError(e.message)), [project.projectId]);
  useEffect(() => { reload(); }, [reload]);
  const open = (id: string | null) => setParams(id ? { v: id } : {});

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className="section-heading">Vídeo animado</h2>
        <Button type="button" onClick={() => { setNovo(true); open(null); }}>Novo vídeo</Button>
      </div>
      {error ? <div className="pill bad">{error}</div> : null}
      {novo ? <NovoVideo project={project} onCreated={(id) => { setNovo(false); reload(); open(id); }} onCancel={() => setNovo(false)} /> : null}
      {selected ? <VideoDetalhe projectId={project.projectId} videoId={selected} onChanged={reload} onClose={() => open(null)} /> : null}
      {!selected && !novo ? (
        <div className={styles.list}>
          {videos.length === 0 ? <p className="muted">Nenhum vídeo ainda.</p> : null}
          {videos.map((v) => (
            <Card key={v.id} style={{ padding: 16 }}>
              <button type="button" className={styles.cardButton} onClick={() => open(v.id)}>
                <b>{v.assunto}</b>
                <span className="muted">{v.objetivo === "anuncio" ? "Anúncio" : "Alcance"} · {v.duracao}s · {new Date(v.criadoEm).toLocaleDateString("pt-BR")}</span>
                <span className={styles.status}>{ROTULO[v.status]}</span>
              </button>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NovoVideo({ project, onCreated, onCancel }: { project: WorkspaceContext["project"]; onCreated: (id: string) => void; onCancel: () => void }) {
  const [b, setB] = useState<VideoBriefing>({ assunto: "", objetivo: "alcance", duracao: 30, tom: "criador", legenda: "do-video", observacao: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assuntos = useMemo(() => {
    const ofertas = (project.contentStrategy?.offers || []).map((o) => (o as { name?: string }).name).filter(Boolean) as string[];
    const banco = Object.values(project.contentStrategy?.topicIdeas?.goals || {}).flatMap((g) => (g.items || []).map((i) => i.title));
    return [...new Set([...ofertas, ...banco])];
  }, [project]);
  const set = <K extends keyof VideoBriefing>(k: K, v: VideoBriefing[K]) => setB((prev) => ({ ...prev, [k]: v }));

  async function submit() {
    setBusy(true);
    setError(null);
    try { onCreated((await createVideo(project.projectId, b)).video.id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Card style={{ padding: 20 }}>
      <label className={styles.field}>Assunto<input value={b.assunto} onChange={(e) => set("assunto", e.target.value)} placeholder="Ex.: O que colocar na bio do Instagram" /></label>
      <label className={styles.field}>Importar assunto
        <select value="" onChange={(e) => e.target.value && set("assunto", e.target.value)}>
          <option value="">Escolha um assunto cadastrado…</option>
          {assuntos.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <fieldset className={styles.row}><legend>Objetivo</legend>
        {(["alcance", "anuncio"] as const).map((o) => <label key={o}><input type="radio" name="objetivo" checked={b.objetivo === o} onChange={() => set("objetivo", o)} />{o === "alcance" ? "Alcance" : "Anúncio"}</label>)}
      </fieldset>
      <fieldset className={styles.row}><legend>Duração</legend>
        {([15, 30, 45, 60] as const).map((d) => <label key={d}><input type="radio" name="duracao" checked={b.duracao === d} onChange={() => set("duracao", d)} />{d}s</label>)}
      </fieldset>
      <fieldset className={styles.row}><legend>Tom da voz</legend>
        {(["criador", "vendedor"] as const).map((t) => <label key={t}><input type="radio" name="tom" checked={b.tom === t} onChange={() => set("tom", t)} />{t === "criador" ? "Criador de conteúdo" : "Vendedor de bairro"}</label>)}
      </fieldset>
      <label className={styles.field}>Legenda
        <select value={b.legenda} onChange={(e) => set("legenda", e.target.value as VideoBriefing["legenda"])}>
          {LEGENDAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className={styles.field}>Observação (opcional)<textarea value={b.observacao} onChange={(e) => set("observacao", e.target.value)} /></label>
      {error ? <div className="pill bad">{error}</div> : null}
      <div className={styles.actions}>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button type="button" disabled={busy || !b.assunto.trim()} onClick={submit}>{busy ? "Enviando…" : "Gerar roteiro"}</Button>
      </div>
    </Card>
  );
}

function VideoDetalhe({ projectId, videoId, onChanged, onClose }: { projectId: string; videoId: string; onChanged: () => void; onClose: () => void }) {
  const [state, setState] = useState<VideoState | null>(null);
  const [cenas, setCenas] = useState<VideoCena[]>([]);
  const [ajuste, setAjuste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => getVideo(projectId, videoId).then((s) => { setState(s); setCenas(s.roteiro?.cenas || []); return s; }), [projectId, videoId]);

  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);
  // Jobs keep running on the server; poll while one runs.
  useEffect(() => {
    if (!state || !GERANDO.has(state.video.status)) return;
    const timer = setInterval(() => { load().then((s) => { if (!GERANDO.has(s.video.status)) onChanged(); }).catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [state, load, onChanged]);

  if (!state) return error ? <div className="pill bad">{error}</div> : <p className="muted">Carregando…</p>;
  const { video } = state;
  const file = (name: string) => videoFileUrl(projectId, videoId, name);
  const run = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try { await fn(); setAjuste(""); await load(); onChanged(); } catch (e) { setError((e as Error).message); }
  };
  const total = Math.round((cenas.reduce((n, c) => n + segundos(c.fala) + (c.segura || 0), 0)) * 10) / 10;
  const move = (i: number, d: number) => setCenas((cs) => { const next = [...cs]; const [c] = next.splice(i, 1); next.splice(i + d, 0, c); return next; });

  return (
    <Card style={{ padding: 20 }}>
      <div className={styles.header}>
        <div><b>{video.briefing.assunto}</b><div className="muted">{video.briefing.objetivo === "anuncio" ? "Anúncio" : "Alcance"} · meta {video.briefing.duracao}s</div></div>
        <Button type="button" variant="secondary" onClick={onClose}>Voltar à lista</Button>
      </div>
      <div className={styles.status}>{ROTULO[video.status]}</div>
      {video.erro ? <div className="pill bad">{video.erro}</div> : null}
      {error ? <div className="pill bad">{error}</div> : null}
      {["erro", "interrompido", "aguardando_limite"].includes(video.status) ? <Button type="button" onClick={run(() => videoAction(projectId, videoId, "retomar"))}>Tentar de novo</Button> : null}

      {video.status === "roteiro_pronto" ? (
        <>
          <div className={styles.timebar}><span style={{ width: `${Math.min(100, (total / video.briefing.duracao) * 100)}%` }} />{total}s de {video.briefing.duracao}s</div>
          {state.avisos.map((a) => <div key={a} className="notice">{a}</div>)}
          {cenas.map((c, i) => (
            <div key={i} data-testid="cena" className={styles.cena}>
              <div className={styles.cenaHead}><b>Cena {i + 1}</b><span className="muted">~{segundos(c.fala)}s</span>
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir cena ${i + 1}`}>↑</button>
                <button type="button" disabled={i === cenas.length - 1} onClick={() => move(i, 1)} aria-label={`Descer cena ${i + 1}`}>↓</button>
                <button type="button" onClick={() => setCenas((cs) => cs.filter((_, j) => j !== i))} aria-label={`Apagar cena ${i + 1}`}>✕</button>
              </div>
              <label className={styles.field}>Fala da cena {i + 1}<textarea aria-label={`Fala da cena ${i + 1}`} value={c.fala} onChange={(e) => setCenas((cs) => cs.map((x, j) => (j === i ? { ...x, fala: e.target.value } : x)))} /></label>
              <p className="muted">{c.descricao}</p>
            </div>
          ))}
          <label className={styles.field}>Pedir ajuste no roteiro<textarea value={ajuste} onChange={(e) => setAjuste(e.target.value)} /></label>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={!ajuste.trim()} onClick={run(async () => { await saveVideoRoteiro(projectId, videoId, cenas); await requestVideoAdjustment(projectId, videoId, "roteiro", ajuste); })}>Pedir ajuste</Button>
            <Button type="button" onClick={run(async () => { await saveVideoRoteiro(projectId, videoId, cenas); await videoAction(projectId, videoId, "aprovar-roteiro"); })}>Aprovar roteiro</Button>
          </div>
        </>
      ) : null}

      {video.status === "previa_pronta" ? (
        <>
          <div className={styles.stills}>{state.stills.map((s) => <img key={s} src={file(`stills/${s}`)} alt={s} />)}</div>
          {state.arquivos.narracaoMp3 ? <audio controls src={file("voz/narracao.mp3")} /> : null}
          {state.vozUsada ? <div className="muted">Voz usada: {state.vozUsada}</div> : null}
          {state.arquivos.notas ? <a href={file("NOTAS.md")} target="_blank" rel="noreferrer">Notas do Claude</a> : null}
          <label className={styles.field}>Pedir ajuste na prévia<textarea value={ajuste} onChange={(e) => setAjuste(e.target.value)} /></label>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={!ajuste.trim()} onClick={run(() => requestVideoAdjustment(projectId, videoId, "producao", ajuste))}>Pedir ajuste</Button>
            <Button type="button" onClick={run(() => videoAction(projectId, videoId, "aprovar-previa"))}>Aprovar prévia</Button>
          </div>
        </>
      ) : null}

      {video.status === "pronto" ? (
        <>
          {state.arquivos.video ? <video className={styles.player} controls src={file("video.mp4")} /> : null}
          <div className={styles.actions}>
            <a href={file("video.mp4")} download>Baixar MP4</a>
            {state.arquivos.legendaPost ? <a href={file("legenda-post.txt")} target="_blank" rel="noreferrer">Legenda do post</a> : null}
            {state.arquivos.narracaoTxt ? <a href={file("voz/narracao.txt")} target="_blank" rel="noreferrer">Texto da narração</a> : null}
          </div>
        </>
      ) : null}

      {!GERANDO.has(video.status) ? (
        <div className={styles.actions}><Button type="button" variant="secondary" onClick={run(async () => { await videoAction(projectId, videoId, "excluir"); onClose(); })}>Excluir vídeo</Button></div>
      ) : null}
    </Card>
  );
}
```

`VideoAnimado.module.css`:
```css
.page { display: grid; gap: 16px; }
.header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.list { display: grid; gap: 12px; }
.cardButton { all: unset; cursor: pointer; display: grid; gap: 4px; width: 100%; }
.status { font-weight: 700; margin: 8px 0; }
.field { display: grid; gap: 6px; margin-top: 12px; }
.field textarea { min-height: 70px; }
.row { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; border: 0; padding: 0; }
.actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; margin-top: 14px; align-items: center; }
.cena { border: 1px solid var(--line); border-radius: 14px; padding: 12px; margin-top: 12px; }
.cenaHead { display: flex; gap: 8px; align-items: center; }
.cenaHead span { margin-right: auto; }
.timebar { position: relative; height: 26px; border-radius: 13px; background: var(--surface-2); overflow: hidden; display: flex; align-items: center; padding: 0 12px; font-size: 13px; font-weight: 700; }
.timebar span { position: absolute; inset: 0 auto 0 0; background: var(--accent-gradient); opacity: .35; }
.stills { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin: 12px 0; }
.stills img { width: 100%; border-radius: 10px; }
.player { width: 100%; max-width: 360px; border-radius: 14px; }
```

- [ ] **Step 6: Run the page tests**

Run: `cd content-central-app; npx vitest run src/pages/workspace/VideoAnimado.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 7: Full app tests and type-check**

Run: `cd content-central-app; npx vitest run; npm run build`
Expected: all PASS, and the build succeeds with no TypeScript errors.

- [ ] **Step 8: Commit** (PowerShell)

```powershell
git add content-central-app/src/api/client.ts content-central-app/src/pages/workspace/VideoAnimado.tsx content-central-app/src/pages/workspace/VideoAnimado.module.css content-central-app/src/pages/workspace/VideoAnimado.test.tsx content-central-app/src/layouts/ProjectWorkspaceLayout.tsx content-central-app/src/App.tsx
git commit -m "feat(video): Vídeo animado tab with briefing, script review, preview and download" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Enable King and run one real video end to end

**Files:**
- Modify (data, not committed): `_opensquad/content-central/projects/king-assessoria-mkt/project.json`

- [ ] **Step 1: Turn the feature on for King.** Add to its `project.json` (top level). This is the main checkout's data folder, the same one the worktree's test bench reads through `targetDir`:

```json
"videoAnimado": { "ativo": true, "projetosDeMaterial": ["mercado-carvalho", "arthur-frios"], "whatsapp": "65 98108-6707" }
```

- [ ] **Step 2: Start a test bench server from the worktree** (not production 3333) on port 3399, pointing at the main checkout as `targetDir`, the same way the `sabores` bench is run. Open `/projects/king-assessoria-mkt/video`.

- [ ] **Step 3: Real run.** Create a video (subject "O que colocar na bio do Instagram da empresa", alcance, 30s, criador, karaokê). Then check:
  - stage 1 reaches `roteiro_pronto`, and the cards show lines and descriptions;
  - an edit plus approval reaches `previa_pronta`, with stills and narration audio and `vozUsada` set;
  - approving the preview produces a playable, downloadable MP4, plus the post caption and narration text.

  Write down the time each stage took. If Claude Code runs out of limit, confirm that `aguardando_limite` shows the message and that "Tentar de novo" resumes.

- [ ] **Step 4: Watch the frames.** Extract frames from the final MP4 (`ffmpeg -i video.mp4 -vf fps=1,scale=140:-1,tile=10x4 sheet.jpg`), look at them, and check rules 1–10 by eye.

- [ ] **Step 5: Finish the branch** with superpowers:finishing-a-development-branch. The merge to master and the production restart are the operator's call.
