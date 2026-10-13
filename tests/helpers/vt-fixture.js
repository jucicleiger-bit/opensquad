import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Jimp } from 'jimp';
import { MOTOR_DIR } from '../../src/video-motor/render.mjs';

// The VT padrão fixture with a given frame, ready to render. The caller removes the folder.
export async function fixtureVt(moldura) {
  const dir = await mkdtemp(join(tmpdir(), `vt-${moldura}-`));
  await cp('tests/fixtures/vt-padrao', dir, { recursive: true });
  await cp(join(MOTOR_DIR, 'modelos', 'vt-padrao', 'cenas.js'), join(dir, 'cenas.js'));
  await mkdir(join(dir, 'fotos'), { recursive: true });
  const im = new Jimp({ width: 300, height: 400, color: 0x00000000 });
  for (let y = 20; y < 380; y++) for (let x = 40; x < 260; x++) im.setPixelColor(0x2266ccff, x, y);
  await im.write(join(dir, 'fotos', 'produto-a.png'));
  const r = JSON.parse(await readFile(join(dir, 'roteiro.json'), 'utf8'));
  await writeFile(join(dir, 'roteiro.json'), JSON.stringify({ ...r, moldura, campanha: 'Ofertas da Semana', ritmo: 'rapido', trilha: 'funkee-monkeee.mp3', legendas: false }));
  return dir;
}
