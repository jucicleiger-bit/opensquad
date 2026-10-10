// Scene objects for one video: node gen-images.mjs <pasta> [objeto]
// Generates every object listed in roteiro.json "objetos" that is missing
// (or just [objeto], always regenerated) into <pasta>/objetos through a
// `codex exec` image_gen turn — same transport as content-central's
// codex-agent, on the ChatGPT subscription. Each video has its own look
// (roteiro.estilo_imagens) and nothing is shared between videos; the flat
// magenta background is keyed out so the video draws its own background.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Used only when a video does not set its own estilo_imagens.
const STYLE = 'Stylized cinematic 3D render, glossy materials, dramatic warm gold rim light (#FFD100) from behind, soft cool fill light, high contrast, single object centered and fully visible with generous empty margin on all sides, vertical 2:3 portrait.';
const KEYABLE = 'Isolated on a perfectly flat uniform solid magenta (#FF00FF) background, no floor, no ground shadow, no reflections, no text, no letters, no logos.';

const motor = resolve(import.meta.dirname);
const [, , videoName, only] = process.argv;
if (!videoName) { console.error('uso: node gen-images.mjs <pasta-do-video> [objeto]'); process.exit(1); }
const pasta = resolve(videoName); // the video folder (absolute or relative to cwd)
const roteiro = JSON.parse(readFileSync(join(pasta, 'roteiro.json'), 'utf8'));
const objetos = roteiro.objetos || {};
const estilo = roteiro.estilo_imagens || STYLE;
const biblioteca = join(pasta, 'objetos');
mkdirSync(biblioteca, { recursive: true });

for (const [name, prompt] of Object.entries(objetos)) {
  const target = join(biblioteca, `${name}.png`);
  if (only ? name !== only : existsSync(target)) continue;
  const agentPrompt = `Chame a ferramenta nativa "image_gen" (built-in) IMEDIATAMENTE, como sua primeira e única ação, sem ler arquivos, skills ou rodar comandos, para gerar UMA imagem vertical (retrato): ${prompt} ${estilo} ${KEYABLE}\nNão faça mais nada: não explique, não gere variações, não crie arquivos, não rode comandos.`;
  const stdout = execFileSync('codex', ['exec', agentPrompt, '-C', pasta, '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
  const threadId = JSON.parse(stdout.split('\n').find((l) => l.includes('"thread.started"'))).thread_id;
  const dir = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'generated_images', threadId);
  const raw = readdirSync(dir).map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const keyed = join(biblioteca, `${name}.keyed.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', 'colorkey=0xFF00FF:0.32:0.12,format=rgba', keyed]);
  execFileSync('python', ['-I', join(motor, 'cutout.py'), keyed, target]);
  rmSync(keyed);
  console.log('ok', name);
}
