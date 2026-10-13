// Renders a video folder (roteiro.json + cenas.js + voz/tempos.json) with player.html.
//   renderVideo({ videoDir })                     -> <videoDir>/video.mp4 (1080x1920, 30fps)
//   renderVideo({ videoDir, stills: [0.05, 2] })  -> <videoDir>/stills/t0.05.jpg, ...
//   legenda: caption model name; trecho: [a, b] renders only that stretch (trecho.mp4)
// CLI: node src/video-motor/render.mjs <videoDir> [--stills 1,5] [--legenda pop] [--trecho 3,9]
/* global process, console, URL, window -- eslint.config.js only gives .js files the node globals */
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
export function serve(videoDir) {
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
      ...voz.map((v) => ({ tipo: 'voz', file: join(videoDir, v.arquivo), t: v.inicio - t0, vol: 1 })),
      ...sfx.map((c) => ({ tipo: 'sfx', file: join(MOTOR_DIR, 'sfx', `${c.s}.wav`), t: c.t - t0, vol: VOLUME[c.s] })),
    ].filter((tr) => tr.t < length && tr.t > -60);
    const delays = tracks.map((tr, i) => {
      const ms = Math.max(0, Math.round(tr.t * 1000));
      const cut = tr.t < 0 ? `atrim=start=${-tr.t},asetpts=PTS-STARTPTS,` : '';
      return `[${i + 1}:a]${cut}aformat=sample_rates=44100:channel_layouts=stereo,adelay=${ms}|${ms},volume=${tr.vol}[a${i}]`;
    });
    // Music bed (roteiro.trilha): looped, ducked by the voice, faded out at the end. Never fails a render.
    const roteiro = JSON.parse(await readFile(join(videoDir, 'roteiro.json'), 'utf8'));
    const trilha = roteiro.trilha ? join(MOTOR_DIR, 'trilhas', roteiro.trilha) : null;
    const comTrilha = Boolean(trilha && existsSync(trilha));
    if (trilha && !comTrilha) console.warn(`aviso: trilha ${roteiro.trilha} não encontrada; vídeo sem música`);
    const ivoz = tracks.map((tr, i) => (tr.tipo === 'voz' ? `[a${i}]` : null)).filter(Boolean);
    const isfx = tracks.map((tr, i) => (tr.tipo === 'sfx' ? `[a${i}]` : null)).filter(Boolean);
    let mix;
    if (!ivoz.length) {
      // no voice (cannot happen in a finished video): plain mix, no music
      mix = `${delays.join(';')};${tracks.map((_, i) => `[a${i}]`).join('')}amix=inputs=${tracks.length}:normalize=0:duration=longest,loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
    } else {
      const m = tracks.length + 1; // ffmpeg input index of the music (0 is the video pipe)
      const partes = [delays.join(';')];
      // Voices are split: one copy for the mix, one as the key that ducks the music. Padded to the full
      // length so duration=first below keeps the music (and effects) after the narration ends.
      partes.push(`${ivoz.join('')}amix=inputs=${ivoz.length}:normalize=0,apad=whole_dur=${length},asplit=2[voz][chave]`);
      let finais = '[voz]';
      if (isfx.length) { partes.push(`${isfx.join('')}amix=inputs=${isfx.length}:normalize=0[sfx]`); finais += '[sfx]'; }
      if (comTrilha) {
        partes.push(`[${m}:a]atrim=start=${Math.max(0, t0)},asetpts=PTS-STARTPTS,atrim=0:${length},aformat=sample_rates=44100:channel_layouts=stereo,volume=0.32,afade=t=out:st=${Math.max(0, length - 1.2)}:d=1.2[musica]`);
        partes.push('[musica][chave]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[fundo]');
        finais += '[fundo]';
      } else partes.push('[chave]anullsink');
      const n = 1 + (isfx.length ? 1 : 0) + (comTrilha ? 1 : 0);
      mix = `${partes.join(';')};${finais}amix=inputs=${n}:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
    }
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...tracks.flatMap((tr) => ['-i', tr.file]), ...(comTrilha && ivoz.length ? ['-stream_loop', '-1', '-i', trilha] : []),
      '-filter_complex', mix, '-map', '0:v', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-movflags', '+faststart', '-t', String(length), out], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    let exited = false;
    ff.stderr.on('data', (c) => { ffErr += c; });
    ff.stdin.on('error', () => {}); // EPIPE when ffmpeg dies early: reported through the exit code below
    const closed = new Promise((ok, fail) => {
      ff.on('error', (err) => { exited = true; fail(new Error(`ffmpeg falhou: ${err.message}`)); });
      ff.on('close', (code) => { exited = true; ok(code); });
    });
    closed.catch(() => {}); // rejection is awaited below; avoid an unhandled one while frames render
    try {
      for (let f = 0; f < Math.ceil(length * FPS) && !exited; f += 1) {
        const buf = await shot(t0 + f / FPS);
        if (exited) break;
        if (!ff.stdin.write(buf)) await Promise.race([new Promise((ok) => ff.stdin.once('drain', ok)), closed.catch(() => {})]);
      }
      ff.stdin.end();
      const code = await closed;
      if (code !== 0) throw new Error(`ffmpeg falhou: ${ffErr.slice(-400)}`);
    } finally {
      if (!exited) ff.kill();
    }
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
