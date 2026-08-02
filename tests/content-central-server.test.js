import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import {
  animateImageForReelsWithFfmpeg,
  buildAiImageGenerationPrompt,
  buildAiImageReviewPrompt,
  buildCatalogOutpaintPrompt,
  composeProductStoryImage,
  cropOpenAiImageToChannel,
  fetchSiteText,
  htmlToReadableText,
  loadContentCentralEnv,
  nousFalAspectRatioForChannel,
  openAiImageSizeForChannel,
  startContentCentralServer,
  uploadGeneratedImagePublicly,
  uploadGeneratedVideoPublicly,
  xaiAspectRatioForChannel,
} from '../src/content-central-server.js';
import {
  createCentralProject,
  generateCatalogSchedulePlan,
  generateContentSchedulePlan,
  saveProjectAsset,
  saveProjectOffer,
} from '../src/content-central.js';

async function withServer(fn, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-content-server-'));
  const server = await startContentCentralServer({ targetDir: dir, port: 0, openBrowser: false, ...options });
  try {
    return await fn(dir, server);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function request(server, path, options = {}) {
  const response = await fetch(`${server.url}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { response, body };
}

test('AI image reviewer prompt blocks square-looking Story price dominance and product mismatch', () => {
  const prompt = buildAiImageReviewPrompt({
    content: {
      channel: 'instagram_story',
      formatLabel: 'Instagram Stories',
      image: { url: 'https://cdn.example.com/story.png' },
      contentTopic: {
        offerName: 'Combo 20 Esfihas',
        price: '97,00',
        items: '20 esfihas abertas',
        cta: '',
        autoGenerateCta: true,
        type: 'combo',
      },
    },
    project: { name: 'Boss Pizzaria' },
    note: '',
  });

  assert.match(prompt, /massa visual concentrada apenas no centro/i);
  assert.match(prompt, /pouco uso da área superior e inferior/i);
  assert.match(prompt, /aparência de card 1:1 dentro de 9:16/i);
  assert.match(prompt, /selo de preço cobrir mais destaque que o produto/i);
  assert.match(prompt, /oferta disser esfiha e imagem parecer pizza/i);
  assert.match(prompt, /combo e imagem mostrar item único/i);
});

test('AI image generation prompt uses ChatGPT/OpenAI instead of Grok', () => {
  const prompt = buildAiImageGenerationPrompt({
    content: {
      channel: 'instagram_story',
      formatLabel: 'Instagram Stories',
      image: {
        aspectRatio: 'portrait',
        dimensions: { width: 1080, height: 1920 },
        prompt: 'FORMATO\n- Story vertical 9:16.\n\nTEXTOS OBRIGATÓRIOS\n- Título exato: 3 Pizzas Grandes',
        references: [
          {
            absolutePath: 'C:/tmp/logo.png',
            role: 'brand_asset',
            weight: 'high',
            instruction: 'Logo oficial',
            mimeType: 'image/png',
          },
        ],
      },
    },
    note: '',
  });

  assert.match(prompt, /ChatGPT/i);
  assert.match(prompt, /OpenAI/i);
  assert.match(prompt, /9:16 vertical/i);
  assert.match(prompt, /use as imagens de referência/i);
  assert.doesNotMatch(prompt, /Grok/i);
  assert.doesNotMatch(prompt, /2:3 Alto/i);
  assert.doesNotMatch(prompt, /3:2 Ampla/i);
});

test('content central loads OpenAI image settings from local env file without overriding process env', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-content-env-'));
  try {
    await writeFile(join(dir, '.env'), [
      '# local secrets',
      'OPENSQUAD_OPENAI_API_KEY=from_file',
      'OPENSQUAD_OPENAI_IMAGE_MODEL=gpt-image-1',
      'OPENSQUAD_OPENAI_IMAGE_SIZE="1024x1536"',
    ].join('\n'));
    const env = { OPENSQUAD_OPENAI_API_KEY: 'already_configured' };

    const result = await loadContentCentralEnv(dir, env);

    assert.equal(result.loaded, true);
    assert.deepEqual(result.keys, [
      'OPENSQUAD_OPENAI_API_KEY',
      'OPENSQUAD_OPENAI_IMAGE_MODEL',
      'OPENSQUAD_OPENAI_IMAGE_SIZE',
    ]);
    assert.equal(env.OPENSQUAD_OPENAI_API_KEY, 'already_configured');
    assert.equal(env.OPENSQUAD_OPENAI_IMAGE_MODEL, 'gpt-image-1');
    assert.equal(env.OPENSQUAD_OPENAI_IMAGE_SIZE, '1024x1536');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('OpenAI image size chosen per channel is a supported gpt-image-1 size', () => {
  assert.equal(openAiImageSizeForChannel('instagram_story'), '1024x1536');
  assert.equal(openAiImageSizeForChannel('instagram_reels'), '1024x1536');
  assert.equal(openAiImageSizeForChannel('instagram_feed'), '1024x1536');
  assert.equal(openAiImageSizeForChannel('facebook_story'), '1024x1536');
  assert.equal(openAiImageSizeForChannel('facebook_feed'), '1024x1536');
});

test('xAI aspect ratio chosen per channel is a supported grok-imagine-image value', () => {
  assert.equal(xaiAspectRatioForChannel('instagram_story'), '9:16');
  assert.equal(xaiAspectRatioForChannel('instagram_reels'), '9:16');
  assert.equal(xaiAspectRatioForChannel('instagram_feed'), '3:4');
  assert.equal(xaiAspectRatioForChannel('facebook_story'), '9:16');
  assert.equal(xaiAspectRatioForChannel('facebook_feed'), '3:4');
  assert.equal(xaiAspectRatioForChannel('unknown_channel'), '1:1');
});

test('Nous/FAL aspect ratio chosen per channel is a supported preset keyword', () => {
  assert.equal(nousFalAspectRatioForChannel('instagram_story'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('instagram_reels'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('instagram_feed'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('facebook_story'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('facebook_feed'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('unknown_channel'), 'square');
});

test('cropOpenAiImageToChannel resizes a generated buffer to the exact target aspect ratio', async () => {
  const { Jimp } = await import('jimp');
  const source = new Jimp({ width: 1024, height: 1536, color: 0xffffffff });
  const sourceBuffer = await source.getBuffer('image/png');

  const storyBuffer = await cropOpenAiImageToChannel(sourceBuffer, { width: 1080, height: 1920 });
  const storyImage = await Jimp.read(storyBuffer);
  assert.equal(storyImage.bitmap.width, 1080);
  assert.equal(storyImage.bitmap.height, 1920);

  const feedBuffer = await cropOpenAiImageToChannel(sourceBuffer, { width: 1080, height: 1350 });
  const feedImage = await Jimp.read(feedBuffer);
  assert.equal(feedImage.bitmap.width, 1080);
  assert.equal(feedImage.bitmap.height, 1350);
});

test('cropOpenAiImageToChannel preserves the full composition with an extended blurred background instead of cutting content', async () => {
  const { Jimp, intToRGBA } = await import('jimp');
  const width = 1024;
  const height = 1536;
  const source = new Jimp({ width, height, color: 0xff0000ff });
  const edgeMarker = 0x00ff00ff;
  for (let x = 0; x < width; x += 1) source.setPixelColor(edgeMarker, x, 0);
  const sourceBuffer = await source.getBuffer('image/png');

  // A plain cover-crop would discard the top edge marker entirely for the
  // Feed ratio (source is proportionally taller than 4:5), leaving pure red.
  const feedBuffer = await cropOpenAiImageToChannel(sourceBuffer, { width: 1080, height: 1350 });
  const feedImage = await Jimp.read(feedBuffer);
  const topPixel = intToRGBA(feedImage.getPixelColor(540, 0));
  assert.ok(
    topPixel.g > topPixel.r,
    `expected the top-edge marker to still be visible (letterboxed, not cropped away); got rgba=${JSON.stringify(topPixel)}`
  );
});

test('animateImageForReelsWithFfmpeg renders a real short vertical MP4 from a static image ("Animar para Reels")', async () => {
  const { Jimp } = await import('jimp');
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-animate-'));
  try {
    const projectId = 'animar-real';
    const assetsDir = join(dir, '_opensquad', 'content-central', 'projects', projectId, 'assets', 'generated');
    await mkdir(assetsDir, { recursive: true });
    const source = new Jimp({ width: 1080, height: 1920, color: 0xff6600ff });
    const sourceBuffer = await source.getBuffer('image/png');
    await writeFile(join(assetsDir, 'source.png'), sourceBuffer);

    const content = { image: { url: `/api/projects/${projectId}/assets/assets/generated/source.png` } };
    const project = { projectId };

    const result = await animateImageForReelsWithFfmpeg({ content, project }, dir);

    assert.match(result.url, /\/api\/projects\/animar-real\/assets\/assets\/generated\/reels-\d+\.mp4$/);
    assert.equal(result.mimeType, 'video/mp4');
    assert.equal(result.durationSeconds, 7);
    assert.ok(existsSync(result.localPath), 'expected the rendered MP4 to exist on disk');
    const stats = await stat(result.localPath);
    assert.ok(stats.size > 1000, `expected a real non-trivial MP4 file, got ${stats.size} bytes`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('animateImageForReelsWithFfmpeg throws when the content has no locally-hosted generated image', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-animate-'));
  try {
    await assert.rejects(
      () => animateImageForReelsWithFfmpeg(
        { content: { image: { url: 'https://not-local.example.com/pic.png' } }, project: { projectId: 'animar-sem-imagem' } },
        dir,
      ),
      /Imagem gerada não encontrada localmente/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('composeProductStoryImage renders a real 1080x1920 PNG from a catalog product photo, with name/price badge', async () => {
  const { Jimp } = await import('jimp');
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-catalog-compose-'));
  try {
    const projectId = 'catalogo-compose-real';
    await createCentralProject({
      projectId,
      name: 'Loja de Celulares Compose',
      handle: '@lojacompose',
      approvalEmail: 'aprovacao@example.com',
      projectType: 'catalog',
    }, dir);

    const photo = new Jimp({ width: 800, height: 800, color: 0x3388ffff });
    const dataUrl = `data:image/png;base64,${(await photo.getBuffer('image/png')).toString('base64')}`;
    const asset = await saveProjectAsset(projectId, {
      kind: 'reference',
      filename: 'iphone-13.png',
      dataUrl,
      role: 'product_photo',
    }, dir);

    const { offer, project } = await saveProjectOffer(projectId, {
      name: 'iPhone 13 128GB',
      price: 'R$ 2.499,00',
      active: true,
      photoReferenceId: asset.metadata.id,
    }, dir);

    const batch = await generateCatalogSchedulePlan(projectId, { days: 1, storiesPerDay: 1, startDate: '2026-08-01' }, dir);
    assert.equal(batch.items[0].contentTopic.offerId, offer.id);

    const composed = await composeProductStoryImage({ content: batch.items[0], project, targetDir: dir });

    assert.match(composed.url, /\/api\/projects\/catalogo-compose-real\/assets\/assets\/generated\/catalogo-\d+\.png$/);
    assert.equal(composed.mimeType, 'image/png');

    const localPath = join(
      dir, '_opensquad', 'content-central', 'projects', projectId, 'assets', 'generated',
      composed.url.split('/').pop(),
    );
    assert.ok(existsSync(localPath), 'expected the composed PNG to exist on disk');
    const stats = await stat(localPath);
    assert.ok(stats.size > 1000, `expected a real non-trivial PNG, got ${stats.size} bytes`);

    const rendered = await Jimp.read(localPath);
    assert.equal(rendered.bitmap.width, 1080);
    assert.equal(rendered.bitmap.height, 1920);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('uploading a WEBP product photo through the real /assets route converts it to PNG so composeProductStoryImage can actually read it', async () => {
  const { Jimp, intToRGBA } = await import('jimp');
  const sharp = (await import('sharp')).default;
  await withServer(async (dir, server) => {
    const projectId = 'catalogo-webp-upload';
    await createCentralProject({
      projectId,
      name: 'Loja de Carros WEBP',
      handle: '@lojacarros',
      approvalEmail: 'aprovacao@example.com',
      projectType: 'catalog',
    }, dir);

    const sourcePng = await new Jimp({ width: 800, height: 800, color: 0x3388ffff }).getBuffer('image/png');
    const webpBuffer = await sharp(sourcePng).webp().toBuffer();
    const dataUrl = `data:image/webp;base64,${webpBuffer.toString('base64')}`;

    const { body } = await request(server, `/api/projects/${projectId}/assets`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'reference', filename: 'gol-1.6.webp', dataUrl, role: 'product_photo' }),
    });

    assert.match(body.asset.filename, /\.png$/, 'expected the uploaded webp to be converted to .png at upload time');
    assert.equal(body.asset.metadata.mimeType, 'image/png');

    const localPath = join(dir, '_opensquad', 'content-central', 'projects', projectId, body.asset.relativePath);
    const decoded = await Jimp.read(localPath);
    assert.equal(decoded.bitmap.width, 800, 'the converted PNG should still be readable by Jimp with the original dimensions');

    const { body: offerBody } = await request(server, `/api/projects/${projectId}/offers`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Gol 1.6', price: 'R$ 46.500,00', active: true, photoReferenceId: body.asset.metadata.id }),
    });

    const batch = await generateCatalogSchedulePlan(projectId, { days: 1, storiesPerDay: 1, startDate: '2026-08-01' }, dir);
    const composed = await composeProductStoryImage({ content: batch.items[0], project: offerBody.project, targetDir: dir });
    const composedLocalPath = join(
      dir, '_opensquad', 'content-central', 'projects', projectId, 'assets', 'generated',
      composed.url.split('/').pop(),
    );
    const composedImage = await Jimp.read(composedLocalPath);
    // A pixel from the middle of the photo area should carry the source
    // photo's blue tint, not the flat dark badge-background fallback color
    // that composeProductStoryImage falls back to when it can't read the photo.
    const { r, g, b } = intToRGBA(composedImage.getPixelColor(540, 400));
    assert.ok(b > r + 40 && b > g + 20, `expected a visibly blue pixel from the real photo, got rgb(${r},${g},${b})`);
  });
});

test('composeProductStoryImage paints the banner in the brand\'s extracted color, includes the logo, general info, and multiple photos without crashing', async () => {
  const { Jimp, intToRGBA } = await import('jimp');
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-catalog-brand-'));
  try {
    const projectId = 'catalogo-marca';
    await createCentralProject({
      projectId,
      name: 'Loja de Carros Marca',
      handle: '@lojamarca',
      approvalEmail: 'aprovacao@example.com',
      projectType: 'catalog',
    }, dir);

    const logoBuffer = await new Jimp({ width: 200, height: 200, color: 0xffffffff }).getBuffer('image/png');
    await saveProjectAsset(projectId, { kind: 'logo', filename: 'logo.png', dataUrl: `data:image/png;base64,${logoBuffer.toString('base64')}` }, dir);

    const photo1 = await new Jimp({ width: 800, height: 800, color: 0x336699ff }).getBuffer('image/png');
    const photo2 = await new Jimp({ width: 800, height: 800, color: 0x996633ff }).getBuffer('image/png');
    const asset1 = await saveProjectAsset(projectId, { kind: 'reference', filename: 'carro-1.png', dataUrl: `data:image/png;base64,${photo1.toString('base64')}`, role: 'product_photo' }, dir);
    const asset2 = await saveProjectAsset(projectId, { kind: 'reference', filename: 'carro-2.png', dataUrl: `data:image/png;base64,${photo2.toString('base64')}`, role: 'product_photo' }, dir);

    // Manually stamp the extracted brand color and general info onto the
    // project — the real path is saveProjectAsset(logo)'s AI color analyzer,
    // which isn't configured here; this asserts what composeProductStoryImage
    // does with those fields once they exist, independent of how they got set.
    const paths = { projectPath: join(dir, '_opensquad', 'content-central', 'projects', projectId, 'project.json') };
    const projectJson = JSON.parse(await readFile(paths.projectPath, 'utf-8'));
    projectJson.brandIdentity.extractedColors = ['#c1121f', '#1d3557'];
    projectJson.contentSettings.catalogGeneralInfo = 'Entrada facilitada · Parcelamos em até 48x';
    await writeFile(paths.projectPath, JSON.stringify(projectJson, null, 2));

    const { offer, project } = await saveProjectOffer(projectId, {
      name: 'Gol 1.6',
      price: 'R$ 46.500,00',
      active: true,
      photoReferenceIds: [asset1.metadata.id, asset2.metadata.id],
    }, dir);

    const batch = await generateCatalogSchedulePlan(projectId, { days: 1, storiesPerDay: 1, startDate: '2026-08-01' }, dir);
    assert.equal(batch.items[0].contentTopic.offerId, offer.id);
    assert.deepEqual(batch.items[0].contentTopic.photoReferenceIds, [asset1.metadata.id, asset2.metadata.id]);

    const composed = await composeProductStoryImage({ content: batch.items[0], project, targetDir: dir });
    const localPath = join(dir, '_opensquad', 'content-central', 'projects', projectId, 'assets', 'generated', composed.url.split('/').pop());
    const rendered = await Jimp.read(localPath);
    assert.equal(rendered.bitmap.width, 1080);
    assert.equal(rendered.bitmap.height, 1920);

    // Bottom-right corner of the banner sits below the diagonal seam and
    // away from the centered text, so it should be pure brand-color fill.
    const { r, g, b } = intToRGBA(rendered.getPixelColor(1080 - 30, 1920 - 30));
    assert.ok(Math.abs(r - 0xc1) < 6 && Math.abs(g - 0x12) < 6 && Math.abs(b - 0x1f) < 6, `expected banner pixel to match brand color #c1121f, got rgb(${r},${g},${b})`);

    // The logo chip is a near-white square in the bottom band, below the
    // price seal — distinct from the red brand color everywhere else in
    // that region. Coordinates mirror composeProductStoryImage's own
    // layout math (bottom band height, seal diameter, chip position).
    const bottomBandHeight = Math.round(1920 * 0.2);
    const sealDiameter = Math.round(1080 * 0.4);
    const bottomContentTop = 1920 - bottomBandHeight + Math.round(sealDiameter / 2) + 16;
    const logoChip = intToRGBA(rendered.getPixelColor(80, bottomContentTop + 42));
    assert.ok(logoChip.r > 230 && logoChip.g > 230 && logoChip.b > 230, `expected a near-white logo chip pixel, got rgb(${logoChip.r},${logoChip.g},${logoChip.b})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('composeProductStoryImage falls back to a neutral banner color when the project has no extracted brand color yet', async () => {
  const { Jimp, intToRGBA } = await import('jimp');
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-catalog-nobrand-'));
  try {
    const projectId = 'catalogo-sem-marca';
    await createCentralProject({
      projectId,
      name: 'Loja Sem Cor Ainda',
      handle: '@lojasemcor',
      approvalEmail: 'aprovacao@example.com',
      projectType: 'catalog',
    }, dir);

    const { offer, project } = await saveProjectOffer(projectId, { name: 'Onix 1.0', price: 'R$ 55.000,00', active: true }, dir);
    const batch = await generateCatalogSchedulePlan(projectId, { days: 1, storiesPerDay: 1, startDate: '2026-08-01' }, dir);
    assert.equal(batch.items[0].contentTopic.offerId, offer.id);

    const composed = await composeProductStoryImage({ content: batch.items[0], project, targetDir: dir });
    const localPath = join(dir, '_opensquad', 'content-central', 'projects', projectId, 'assets', 'generated', composed.url.split('/').pop());
    const rendered = await Jimp.read(localPath);
    const { r, g, b } = intToRGBA(rendered.getPixelColor(1080 - 30, 1920 - 30));
    assert.ok(Math.abs(r - 0x1b) < 6 && Math.abs(g - 0x1b) < 6 && Math.abs(b - 0x1b) < 6, `expected the neutral fallback color, got rgb(${r},${g},${b})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updateCatalogSettings persists catalogGeneralInfo and catalogStoriesPerDay, reachable through the real HTTP route', async () => {
  await withServer(async (dir, server) => {
    const projectId = 'catalogo-config';
    await createCentralProject({
      projectId,
      name: 'Loja de Config',
      handle: '@lojaconfig',
      approvalEmail: 'aprovacao@example.com',
      projectType: 'catalog',
    }, dir);

    const { body } = await request(server, `/api/projects/${projectId}/catalog-settings`, {
      method: 'POST',
      body: JSON.stringify({ catalogGeneralInfo: 'Entrada facilitada · Parcelamos em até 48x', catalogStoriesPerDay: 5 }),
    });

    assert.equal(body.project.contentSettings.catalogGeneralInfo, 'Entrada facilitada · Parcelamos em até 48x');
    assert.equal(body.project.contentSettings.catalogStoriesPerDay, 5);

    const { body: state } = await request(server, `/api/state`);
    const reloaded = state.projects.find((p) => p.projectId === projectId);
    assert.equal(reloaded.contentSettings.catalogGeneralInfo, 'Entrada facilitada · Parcelamos em até 48x');
  });
});

// composeCatalogAiOutpaint itself shells out to a real local Hermes/Codex
// install (same as the pre-existing generateAiImageWithCodex, which has no
// direct test for the same reason) — not safely mockable or hermetic, so
// only the pure prompt-building logic is tested directly here. The
// AI-then-local-fallback wiring (composeCatalogImage) is exercised for real
// by composeProductStoryImage's own tests, since that's exactly what it
// falls back to whenever the AI path isn't available.
test('buildCatalogOutpaintPrompt is generic (no vehicle/car-specific wording) and includes the product name, business name and segment', () => {
  const prompt = buildCatalogOutpaintPrompt({
    project: { name: 'Loja de Celulares Compose', companyProfile: { segment: 'venda de celulares' } },
    offer: { offerName: 'iPhone 13 128GB' },
  });

  assert.match(prompt, /Loja de Celulares Compose/);
  assert.match(prompt, /venda de celulares/);
  assert.match(prompt, /iPhone 13 128GB/);
  assert.doesNotMatch(prompt, /carro|ve[íi]culo/i);
});

test('buildCatalogOutpaintPrompt falls back to a generic product label when the offer has no name yet', () => {
  const prompt = buildCatalogOutpaintPrompt({ project: { name: 'Loja Teste' }, offer: {} });
  assert.match(prompt, /produto à venda/);
});

test('content central server serves only supported API channels and upload controls', async () => {
  await withServer(async (_dir, server) => {
    const response = await fetch(`${server.url}/classic`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('Central de Conteúdo Opensquad'));
    assert.ok(html.includes('design-shell'));
    assert.ok(html.includes('font-size:15px'));
    assert.ok(html.includes('min-height:44px'));
    assert.ok(html.includes('grid-template-columns:280px 216px minmax(0,1fr)'));
    assert.ok(html.includes('action-primary'));
    assert.ok(html.includes('action-secondary'));
    assert.ok(html.includes('grid-template-columns:repeat(auto-fit,minmax(118px,1fr))'));
    assert.ok(html.includes('min-width:0;max-width:100%'));
    assert.ok(html.includes('.workspace-main>.card{min-width:0;max-width:100%}'));
    assert.ok(html.includes('.selected-info{line-height:1.7;min-width:0;overflow-wrap:anywhere;position:relative}'));
    assert.ok(html.includes('.section-nav{position:sticky'));
    assert.ok(html.includes('Refeito automaticamente'));
    assert.ok(html.includes('modo resgate extra sem modelos de layout'));
    assert.ok(html.includes('Gerando imagem IA e revisando automaticamente'));
    assert.ok(!html.includes('30 a 90 segundos'));
    assert.ok(!html.includes('min-width:414px'));
    assert.ok(html.includes('panel-kicker'));
    assert.ok(html.includes('step-card'));
    assert.ok(html.includes('field-card'));
    assert.ok(html.includes('button-row'));
    assert.ok(html.includes('Criar projeto'));
    assert.ok(html.includes('type="checkbox" name="channels"'));
    assert.ok(html.includes('Instagram Feed'));
    assert.ok(html.includes('Instagram Stories'));
    assert.ok(html.includes('Instagram Reels'));
    assert.ok(!html.includes('TikTok'));
    assert.ok(!html.includes('LinkedIn'));
    assert.ok(!html.includes('WhatsApp Status'));
    assert.ok(!html.includes('Facebook Feed'));
    assert.ok(html.includes('type="file" id="logoFile"'));
    assert.ok(html.includes('type="file" id="referenceFile"'));
    assert.ok(html.includes('Painel de referências'));
    assert.ok(html.includes('id="referenceGallery"'));
    assert.ok(html.includes('id="referenceInstruction"'));
    assert.ok(html.includes('Referência não deve disputar com o Raio-X'));
    assert.ok(html.includes('Preservar exatamente como enviado'));
    assert.ok(html.includes('Usar só como inspiração'));
    assert.ok(html.includes('name="referenceUsageRoles"'));
    assert.ok(html.includes('value="layout_model"'));
    assert.ok(html.includes('Modelo visual que gostei'));
    assert.ok(html.includes('Foto real do produto'));
    assert.ok(html.includes('Ativo oficial/logo'));
    assert.ok(html.includes('Exemplo de texto/oferta'));
    assert.ok(html.includes('Inspiração visual'));
    assert.ok(!html.includes('id="referenceOrder"'));
    assert.ok(!html.includes('id="referenceActive"'));
    assert.ok(!html.includes('Usar esta referência no próximo prompt'));
    assert.ok(!html.includes('id="logoPosition"'));
    assert.ok(!html.includes('id="logoSizePercent"'));
    assert.ok(!html.includes('Posição da logo oficial'));
    assert.ok(html.includes('object-fit:cover'));
    assert.ok(html.includes('previewClass(item)'));
    assert.ok(html.includes('channel-instagram_story'));
    assert.ok(html.includes('aspect-ratio:9/16'));
    assert.ok(html.includes('aspect-ratio:4/5'));
    assert.ok(!html.includes('composed-preview'));
    assert.ok(!html.includes('composed-overlay'));
    assert.ok(!html.includes('imagem IA + texto exato do Opensquad'));
    assert.ok(html.includes('imagem IA desenhada pelo ChatGPT'));
    assert.ok(!html.includes('imagem IA desenhada pelo Grok'));
    assert.ok(html.includes('renderImagePreview(item'));
    assert.ok(html.includes('function imageSource'));
    assert.ok(html.includes("generatedSource==='ai'"));
    assert.ok(html.includes("return item.image?.previewUrl||item.image?.url||item.image?.previewDataUrl"));
    assert.ok(html.includes('Modo estável: usa a imagem IA real'));
    assert.ok(!html.includes('Prioridade final da geração'));
    assert.ok(!html.includes('id="priorityPreview"'));
    assert.ok(!html.includes('Ativa no próximo prompt'));
    assert.ok(!html.includes('renderPriorityPreview'));
    assert.ok(html.includes('Apagar referência'));
    assert.ok(html.includes('deleteReference'));
    assert.ok(html.includes('data-edit-reference'));
    assert.ok(html.includes('function editReference'));
    assert.ok(html.includes('function cancelEditReference'));
    assert.ok(html.includes('function saveReferenceEdit'));
    assert.ok(html.includes('references-update'));
    assert.ok(html.includes('Direção visual consolidada'));
    assert.ok(html.includes('id="imageRules"'));
    assert.ok(html.includes('Regras técnicas extras para o ChatGPT'));
    assert.ok(!html.includes('Regras técnicas extras para o Grok'));
    assert.ok(html.includes('Salvar direção visual consolidada'));
    assert.ok(html.includes('Teste rápido antes de programar'));
    assert.ok(html.includes('id="nextTestTopic"'));
    assert.ok(html.includes('Próximo assunto do Teste seguro'));
    assert.ok(html.includes('renderNextTestTopic(p)'));
    assert.ok(html.includes('Agente Revisor de Criativo'));
    assert.ok(html.includes('function renderCreativeReview'));
    assert.ok(html.includes('Gerar conteúdo + simular postagem'));
    assert.ok(html.includes('Não publica de verdade'));
    assert.ok(html.includes('<select id="testChannel"><option value="instagram_story" selected>Instagram Stories</option>'));
    assert.ok(html.includes('id="testPostButton"'));
    assert.ok(html.includes('id="testResult"'));
    assert.ok(html.includes('Imagem gerada no teste'));
    assert.ok(html.includes('renderTestPreview'));
    assert.ok(html.includes('Gerando imagem'));
    assert.ok(html.includes('setButtonBusy'));
    assert.ok(html.includes('Validar token e salvar'));
    assert.ok(!html.includes('id="expiresAt"'));
    assert.ok(html.includes('Organizar por formato'));
    assert.ok(html.includes('Ofertas e assuntos'));
    assert.ok(html.includes('id="offerName"'));
    assert.ok(html.includes('id="offerType"'));
    assert.ok(html.includes('id="offerAutoCta"'));
    assert.ok(html.includes('id="offersList"'));
    assert.ok(html.includes('saveOffer'));
    assert.ok(html.includes('deleteOffer'));
    assert.ok(html.includes('data-edit-offer'));
    assert.ok(html.includes('function editOffer'));
    assert.ok(html.includes('function cancelEditOffer'));
    assert.ok(html.includes('id="offerSaveButton"'));
    assert.ok(html.includes('id="offerCancelEditButton"'));
    assert.ok(html.includes('Vezes por dia'));
    assert.ok(html.includes('Dia sim/dia não'));
    assert.ok(html.includes('Visão geral'));
    assert.ok(html.includes('Referências e imagem'));
    assert.ok(html.includes('Ofertas e assuntos'));
    assert.ok(html.includes('Agenda e geração'));
    assert.ok(html.includes('Conteúdos gerados'));
    assert.ok(html.includes('Empresa / Raio-X'));
    assert.ok(html.includes('id="brandName"'));
    assert.ok(html.includes('id="brandSegment"'));
    assert.ok(html.includes('id="brandProductsOrServices"'));
    assert.ok(html.includes('id="brandDescription"'));
    assert.ok(html.includes('id="brandServiceRegion"'));
    assert.ok(html.includes('id="brandMainDifferential"'));
    assert.ok(html.includes('O que você quer alcançar com as postagens?'));
    assert.ok(html.includes('Vender produtos'));
    assert.ok(html.includes('Receber pedidos no WhatsApp'));
    assert.ok(html.includes('Analisar minha marca'));
    assert.ok(html.includes('Raio-X da marca'));
    assert.ok(html.includes('Usar este Raio-X'));
    assert.ok(html.includes('id="brandXrayBlocks"'));
    assert.ok(html.includes('brand-xray-grid'));
    assert.ok(html.includes('brand-xray-card'));
    assert.ok(html.includes('autoGrowTextareas'));
    assert.ok(html.includes('Revise os 4 blocos'));
    assert.ok(html.includes('id="projectReadiness"'));
    assert.ok(html.includes('function renderProjectReadiness'));
    assert.ok(html.includes('Raio-X aprovado'));
    assert.ok(html.includes('Raio-X ainda não usado'));
    assert.ok(html.includes('Informações básicas preenchidas'));
    assert.ok(html.includes('Logo enviada'));
    assert.ok(html.includes('Objetivos do conteúdo escolhidos'));
    assert.ok(html.includes('Ofertas cadastradas'));
    assert.ok(html.includes('Referências cadastradas'));
    assert.ok(!html.includes('Analisar empresa e gerar briefing'));
    assert.ok(!html.includes('Aprovar briefing da marca'));
    assert.ok(!html.includes('id="brandBriefingBlocks"'));
    assert.ok(html.includes('Configurações avançadas'));
    assert.ok(!html.includes('name="companyContentGoals"'));
    assert.ok(!html.includes('name="companyTone"'));
    assert.ok(html.includes('Ativos oficiais da marca'));
    assert.ok(html.includes('Fotos reais e produtos'));
    assert.ok(html.includes('Inspirações visuais'));
    assert.ok(html.includes('Direção visual consolidada'));
    assert.ok(html.includes('id="referenceCategory"'));
    assert.ok(html.includes('id="referenceUseInNextGeneration"'));
    assert.ok(html.includes('saveCompanyProfile'));
    assert.ok(html.includes('Conta e token'));
    assert.ok(html.includes('switchTab'));
    assert.ok(html.includes('content-card'));
    assert.ok(html.includes('deleteContent'));

    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new vm.Script(script));
  });
});

test('content central server serves the React app at "/" with SPA fallback on client routes, keeping the old panel at "/classic"', async () => {
  await withServer(async (_dir, server) => {
    const root = await fetch(server.url);
    const rootHtml = await root.text();
    assert.equal(root.status, 200);
    assert.ok(rootHtml.includes('<div id="root">'));
    assert.ok(rootHtml.includes('/assets/'));

    const deepRoute = await fetch(`${server.url}/projects/boss-pizzaria/calendario`);
    assert.equal(deepRoute.status, 200);
    assert.ok((await deepRoute.text()).includes('<div id="root">'));

    const asset = await fetch(`${server.url}/assets/does-not-exist.js`);
    assert.equal(asset.status, 404);

    const classic = await fetch(`${server.url}/classic`);
    const classicHtml = await classic.text();
    assert.equal(classic.status, 200);
    assert.ok(classicHtml.includes('Central de Conteúdo Opensquad'));
  });
});

test('content central API saves company raio-x profile and uses it in prompts', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'perfil-web',
        name: 'Perfil Web',
        handle: '@perfilweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const saved = await request(server, '/api/projects/perfil-web/company-profile', {
      method: 'POST',
      body: JSON.stringify({
        segment: 'Serviços locais',
        description: 'Empresa de manutenção residencial para condomínios e casas.',
        audience: 'síndicos e famílias que precisam de atendimento confiável',
        productsOrServices: 'manutenção elétrica, hidráulica e pequenos reparos',
        differentiators: 'atendimento rápido, orçamento claro e pós-venda',
        tone: ['direto', 'confiável', 'educativo'],
        contentGoals: ['service', 'authority', 'education'],
        brandColors: 'azul, branco e cinza',
        avoid: 'não prometer atendimento instantâneo se não estiver cadastrado',
        positioning: 'serviço local profissional e transparente',
      }),
    });

    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.project.companyProfile.segment, 'Serviços locais');
    assert.deepEqual(saved.body.project.companyProfile.contentGoals, ['service', 'authority', 'education']);

    const state = await request(server, '/api/state');
    assert.equal(state.body.projects[0].companyProfile.productsOrServices, 'manutenção elétrica, hidráulica e pequenos reparos');

    const generated = await request(server, '/api/projects/perfil-web/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-07-20', channel: 'instagram_story' }),
    });

    const prompt = generated.body.batch.items[0].image.prompt;
    assert.match(prompt, /INFORMAÇÕES FACTUAIS OBRIGATÓRIAS/);
    assert.match(prompt, /Serviços locais/);
    assert.match(prompt, /manutenção elétrica, hidráulica e pequenos reparos/);
    assert.match(prompt, /não prometer atendimento instantâneo/);
  });
});

test('content central API analyzes and approves brand briefing before it enters prompts', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'briefing-web',
        name: 'Briefing Web',
        handle: '@briefingweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    await request(server, '/api/projects/briefing-web/company-profile', {
      method: 'POST',
      body: JSON.stringify({
        segment: 'Clínica estética',
        description: 'Clínica local focada em atendimento seguro e acolhedor.',
        productsOrServices: 'limpeza de pele, depilação e massagem relaxante',
        primaryObjective: 'gerar autoridade e agendamentos sem prometer resultado garantido',
        factualConstraints: 'não usar antes/depois e não prometer resultado imediato',
      }),
    });

    const analyzed = await request(server, '/api/projects/briefing-web/brand-briefing/analyze', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(analyzed.response.status, 200);
    assert.equal(analyzed.body.project.brandBriefing.status, 'generated');
    assert.match(analyzed.body.project.brandBriefing.blocks.summary.text, /Clínica estética/);

    const generatedBefore = await request(server, '/api/projects/briefing-web/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-07-20', channel: 'instagram_story' }),
    });
    assert.doesNotMatch(generatedBefore.body.batch.items[0].image.prompt, /BRIEFING APROVADO DA MARCA/);

    const approved = await request(server, '/api/projects/briefing-web/brand-briefing/approve', {
      method: 'POST',
      body: JSON.stringify({ edits: { tone: 'acolhedor, autoridade e educativo' } }),
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.project.brandBriefing.status, 'approved');
    assert.match(approved.body.project.brand.visualStyle, /Direção visual consolidada/);

    const generatedAfter = await request(server, '/api/projects/briefing-web/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-07-21', channel: 'instagram_story' }),
    });
    assert.match(generatedAfter.body.batch.items[0].image.prompt, /BRIEFING APROVADO DA MARCA/);
    assert.match(generatedAfter.body.batch.items[0].image.prompt, /acolhedor, autoridade e educativo/);
  });
});

test('content central API supports simplified brand xray flow', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'xray-web',
        name: 'Xray Web',
        handle: '@xrayweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const saved = await request(server, '/api/projects/xray-web/brand-input', {
      method: 'POST',
      body: JSON.stringify({
        brandName: 'Boss Pizzaria',
        segment: 'Pizzaria',
        productsOrServices: 'rodízio, delivery e atendimento no salão',
        description: 'Pizzaria familiar com rodízio de terça a domingo.',
        serviceRegion: 'Várzea Grande/MT',
        mainDifferential: 'pizza bem recheada e ambiente familiar',
        contentGoals: ['sell_products', 'promotions', 'whatsapp_orders', 'show_products'],
      }),
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.project.brandInput.segment, 'Pizzaria');
    assert.deepEqual(saved.body.project.brandInput.contentGoals, ['sell_products', 'promotions', 'whatsapp_orders', 'show_products']);

    const analyzed = await request(server, '/api/projects/xray-web/brand-xray/analyze', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(analyzed.response.status, 200);
    assert.equal(analyzed.body.project.brandXray.status, 'generated');
    assert.deepEqual(Object.keys(analyzed.body.project.brandXray.blocks), ['summary', 'communication', 'contentStrategy', 'visualIdentity']);

    const approved = await request(server, '/api/projects/xray-web/brand-xray/approve', {
      method: 'POST',
      body: JSON.stringify({ edits: { communication: 'Sugestão da IA: próximo, comercial e apetitoso.' } }),
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.project.brandXray.status, 'approved');

    const generated = await request(server, '/api/projects/xray-web/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-07-20', channel: 'instagram_story' }),
    });
    assert.match(generated.body.batch.items[0].image.prompt, /RAIO-X APROVADO DA MARCA/);
    assert.match(generated.body.batch.items[0].image.prompt, /próximo, comercial e apetitoso/);
  });
});

test('content central API saves project image rules and applies them to generated prompts', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'pizza-rules-web',
        name: 'Pizza Rules Web',
        handle: '@pizzarules',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const saved = await request(server, '/api/projects/pizza-rules-web/image-rules', {
      method: 'POST',
      body: JSON.stringify({
        visualStyle: 'fotografia realista de rodízio de pizza',
        imageRules: 'Queijo derretendo\nPreço grande e legível\nNão repetir palavras',
      }),
    });

    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.project.brand.visualStyle, 'fotografia realista de rodízio de pizza');
    assert.deepEqual(saved.body.project.brand.imageRules, [
      'Queijo derretendo',
      'Preço grande e legível',
      'Não repetir palavras',
    ]);

    const generated = await request(server, '/api/projects/pizza-rules-web/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-07-20', channel: 'instagram_story' }),
    });

    assert.match(generated.body.batch.items[0].image.prompt, /fotografia realista de rodízio de pizza/);
    assert.match(generated.body.batch.items[0].image.prompt, /Preço grande e legível/);
  });
});

test('content central API creates a project and returns dashboard state', async () => {
  await withServer(async (_dir, server) => {
    const created = await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'cliente-web',
        name: 'Cliente Web',
        handle: '@clienteweb',
        approvalEmail: 'aprovacao@example.com',
        mode: 'semi_automatic',
      }),
    });

    assert.equal(created.response.status, 201);
    assert.equal(created.body.project.projectId, 'cliente-web');

    const state = await request(server, '/api/state');
    assert.equal(state.response.status, 200);
    assert.equal(state.body.projects.length, 1);
    assert.equal(state.body.projects[0].instagram.handle, '@clienteweb');
    assert.deepEqual(state.body.alerts, []);
  });
});

test('content central API surfaces an expiring-token alert in /api/state', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'alerta-token',
        name: 'Alerta Token',
        handle: '@alertatoken',
        approvalEmail: 'aprovacao@example.com',
      }),
    });
    await request(server, '/api/projects/alerta-token/token', {
      method: 'POST',
      body: JSON.stringify({ token: 'EAAB-soon-token', expiresAt: new Date(Date.now() + 3 * 86400000).toISOString() }),
    });

    const state = await request(server, '/api/state');
    const alert = state.body.alerts.find((a) => a.projectId === 'alerta-token');
    assert.ok(alert);
    assert.equal(alert.type, 'token_expiring');
  });
});

test('content central API deletes a project and its stored token secret for good', async () => {
  await withServer(async (dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'cliente-apagar',
        name: 'Cliente Apagar',
        handle: '@clienteapagar',
        approvalEmail: 'aprovacao@example.com',
      }),
    });
    await request(server, '/api/projects/cliente-apagar/token', {
      method: 'POST',
      body: JSON.stringify({ token: 'EAAB-secret-token', expiresAt: '2026-12-01T00:00:00.000Z' }),
    });

    const projectDir = join(dir, '_opensquad', 'content-central', 'projects', 'cliente-apagar');
    const tokenSecretPath = join(dir, '_opensquad', 'content-central', 'secrets', 'cliente-apagar.token');
    assert.equal(existsSync(projectDir), true);
    assert.equal(existsSync(tokenSecretPath), true);

    const deleted = await request(server, '/api/projects/cliente-apagar', { method: 'POST' });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.deleted, true);

    assert.equal(existsSync(projectDir), false);
    assert.equal(existsSync(tokenSecretPath), false);

    const state = await request(server, '/api/state');
    assert.equal(state.body.projects.length, 0);

    const deletedAgain = await request(server, '/api/projects/cliente-apagar', { method: 'POST' });
    assert.equal(deletedAgain.response.status, 500);
  });
});

test('content central server regenerates a shared-creative group through /content-group-regenerate, calling the AI once for the whole group', async () => {
  let imageCalls = 0;
  await withServer(
    async (dir, server) => {
      // Set up the pending group directly through the domain module (no
      // background auto-enrichment involved) so the AI-call count below only
      // reflects the explicit group-regenerate call being tested.
      await createCentralProject({ projectId: 'grupo-web', name: 'Grupo Web' }, dir);
      const batch = await generateContentSchedulePlan('grupo-web', {
        days: 1,
        startDate: '2026-07-20',
        formats: [
          { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
          { channel: 'facebook_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        ],
      }, dir);
      const contentIds = batch.items.map((item) => item.contentId);

      const regenerated = await request(server, '/api/projects/grupo-web/content-group-regenerate', {
        method: 'POST',
        body: JSON.stringify({ contentIds, batchId: batch.batchId, regenerate: 'creative', note: 'mais vibrante' }),
      });

      assert.equal(regenerated.response.status, 200);
      assert.equal(regenerated.body.items.length, 2);
      assert.equal(imageCalls, 1);
      const urls = regenerated.body.items.map((item) => item.image.url);
      assert.equal(urls[0], urls[1]);
    },
    {
      imageGenerator: async () => {
        imageCalls += 1;
        return { url: 'https://cdn.example.com/grupo.png', mimeType: 'image/png' };
      },
    },
  );
});

test('client-facing briefing page offers a PDF download that hides interactive controls when printed', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'briefing-pdf',
        name: 'Briefing PDF',
        handle: '@briefingpdf',
        approvalEmail: 'aprovacao@example.com',
      }),
    });
    await request(server, '/api/projects/briefing-pdf/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-07-20', channel: 'instagram_feed' }),
    });

    const response = await fetch(`${server.url}/api/projects/briefing-pdf/briefing`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.ok(html.includes('Baixar em PDF'));
    assert.ok(html.includes('onclick="window.print()"'));
    assert.match(html, /@media print\{[\s\S]*\.briefing-approve,\.download-pdf\{display:none\}/);
  });
});

test('client-facing briefing page groups same-shape channels that share a creative into one card, separated into Stories vs Feed sections', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'briefing-grupo',
        name: 'Briefing Grupo',
        handle: '@briefinggrupo',
        approvalEmail: 'aprovacao@example.com',
      }),
    });
    await request(server, '/api/projects/briefing-grupo/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 1,
        startDate: '2026-07-20',
        formats: [
          { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
          { channel: 'facebook_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
          { channel: 'instagram_reels', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
          { channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '12:00', intervalMinutes: 0 },
        ],
      }),
    });

    const response = await fetch(`${server.url}/api/projects/briefing-grupo/briefing`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /Stories, Reels e Facebook Story/);
    assert.match(html, /Feed e Facebook Feed/);

    const cardCount = (html.match(/class="briefing-card"/g) || []).length;
    assert.equal(cardCount, 2, 'expected one grouped card for the vertical trio and one solo card for the feed item');

    assert.match(html, /Aprovar estes 3 formatos/);
    assert.match(html, /Aprovar este card/);

    const groupedItemsMatch = html.match(/data-items='(\[[^']*\])'/);
    assert.ok(groupedItemsMatch, 'expected a data-items attribute on the grouped approve button');
    const payloads = [...html.matchAll(/data-items='(\[[^']*\])'/g)].map((match) => JSON.parse(match[1].replace(/&quot;/g, '"')));
    const groupedPayload = payloads.find((payload) => payload.length === 3);
    assert.ok(groupedPayload, 'expected one approve button whose data-items lists all 3 grouped contentIds');
    assert.deepEqual(
      groupedPayload.map((entry) => entry.contentId).sort(),
      [
        'briefing-grupo-2026-07-20-facebook_story-01',
        'briefing-grupo-2026-07-20-instagram_reels-01',
        'briefing-grupo-2026-07-20-instagram_story-01',
      ],
    );
  });
});

test('content central API saves a manually edited caption without touching the image', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'legenda-web',
        name: 'Legenda Web',
        handle: '@legendaweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const generated = await request(server, '/api/projects/legenda-web/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-07-20', channel: 'instagram_feed' }),
    });
    const contentId = generated.body.batch.items[0].contentId;

    const updated = await request(server, `/api/projects/legenda-web/content/${contentId}/caption`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Legenda revisada direto no painel.' }),
    });

    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.content.caption.text, 'Legenda revisada direto no painel.');
    assert.equal(updated.body.content.caption.generatedSource, 'operator_edit');

    const empty = await request(server, `/api/projects/legenda-web/content/${contentId}/caption`, {
      method: 'POST',
      body: JSON.stringify({ text: '   ' }),
    });
    assert.equal(empty.response.status, 500);
  });
});

test('content central API generates content days and prepares approval', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'fluxo-web',
        name: 'Fluxo Web',
        handle: '@fluxoweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const generated = await request(server, '/api/projects/fluxo-web/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 2, startDate: '2026-07-20', channel: 'instagram_feed' }),
    });

    assert.equal(generated.response.status, 201);
    assert.equal(generated.body.batch.items.length, 2);

    const contentId = generated.body.batch.items[0].contentId;
    const approval = await request(server, `/api/projects/fluxo-web/content/${contentId}/approval`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    assert.equal(approval.response.status, 201);
    assert.equal(approval.body.payload.contentId, contentId);
    assert.equal(approval.body.payload.approval.requiredPhrase, 'APROVADO');
  });
});

test('content central API generates content for multiple selected channels', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'multi-web',
        name: 'Multi Web',
        handle: '@multiweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const generated = await request(server, '/api/projects/multi-web/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 2,
        startDate: '2026-07-20',
        channels: ['instagram_feed', 'instagram_story'],
      }),
    });

    assert.equal(generated.response.status, 201);
    assert.equal(generated.body.batches.length, 2);
    assert.deepEqual(generated.body.batches.map((batch) => batch.channel), ['instagram_feed', 'instagram_story']);

    const content = await request(server, '/api/projects/multi-web/content');
    assert.equal(content.body.content.length, 4);
    assert.deepEqual(
      [...new Set(content.body.content.map((item) => item.channel))].sort(),
      ['instagram_feed', 'instagram_story']
    );
  });
});

test('content central API generates a schedule plan with formats, daily slots and intervals', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'agenda-web',
        name: 'Agenda Web',
        handle: '@agendaweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const generated = await request(server, '/api/projects/agenda-web/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 7,
        startDate: '2026-07-20',
        formats: [
          { channel: 'instagram_story', postsPerDay: 3, everyDays: 1, startTime: '09:00', intervalMinutes: 240 },
          { channel: 'instagram_feed', postsPerDay: 1, everyDays: 2, startTime: '12:00', intervalMinutes: 0 },
        ],
      }),
    });

    assert.equal(generated.response.status, 201);
    assert.equal(generated.body.batch.items.length, 25);
    assert.equal(generated.body.batch.items.filter((item) => item.channel === 'instagram_story').length, 21);
    assert.equal(generated.body.batch.items.filter((item) => item.channel === 'instagram_feed').length, 4);
    assert.equal(generated.body.batch.items[0].image.generated, true);
  });
});

test('content central API saves offers and uses them as varied generation topics', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'ofertas-web',
        name: 'Ofertas Web',
        handle: '@ofertasweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const combo = await request(server, '/api/projects/ofertas-web/offers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Combo 3 pizzas',
        type: 'combo',
        price: 'R$99,00',
        items: '3 pizzas selecionadas',
        cta: '',
        autoGenerateCta: true,
      }),
    });
    assert.equal(combo.response.status, 200);
    assert.equal(combo.body.offer.name, 'Combo 3 pizzas');
    assert.equal(combo.body.offer.autoGenerateCta, true);

    await request(server, '/api/projects/ofertas-web/offers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Rodízio completo',
        type: 'rodizio',
        price: 'R$49,90',
        items: 'pizzas salgadas, doces e massas',
        cta: 'Aproveite hoje no salão',
      }),
    });

    const state = await request(server, '/api/state');
    assert.equal(state.body.projects[0].contentStrategy.offers.length, 2);

    const generated = await request(server, '/api/projects/ofertas-web/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 1,
        startDate: '2026-07-20',
        formats: [
          { channel: 'instagram_story', postsPerDay: 2, everyDays: 1, startTime: '09:00', intervalMinutes: 240 },
        ],
      }),
    });

    assert.equal(generated.response.status, 201);
    assert.deepEqual(generated.body.batch.items.map((item) => item.contentTopic.offerName), [
      'Combo 3 pizzas',
      'Rodízio completo',
    ]);
    assert.match(generated.body.batch.items[0].image.prompt, /R\$99,00/);
    assert.match(generated.body.batch.items[0].image.prompt, /CTA automático/i);
    assert.match(generated.body.batch.items[1].image.prompt, /Aproveite hoje no salão/);
  });
});

test('content central API edits an existing offer in place when the request includes its id', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'ofertas-edicao',
        name: 'Ofertas Edicao',
        handle: '@ofertasedicao',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const created = await request(server, '/api/projects/ofertas-edicao/offers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Combo 3 pizzas',
        type: 'combo',
        price: 'R$99,00',
        items: '3 pizzas selecionadas',
        cta: 'Peça agora',
      }),
    });
    const offerId = created.body.offer.id;

    const edited = await request(server, '/api/projects/ofertas-edicao/offers', {
      method: 'POST',
      body: JSON.stringify({
        id: offerId,
        name: 'Combo 3 pizzas grandes',
        type: 'combo',
        price: 'R$119,00',
        items: '3 pizzas grandes selecionadas',
        cta: 'Peça agora no delivery',
      }),
    });
    assert.equal(edited.response.status, 200);
    assert.equal(edited.body.offer.id, offerId);
    assert.equal(edited.body.offer.price, 'R$119,00');

    const state = await request(server, '/api/state');
    assert.equal(state.body.projects[0].contentStrategy.offers.length, 1);
    assert.equal(state.body.projects[0].contentStrategy.offers[0].name, 'Combo 3 pizzas grandes');
    assert.equal(state.body.projects[0].contentStrategy.offers[0].price, 'R$119,00');
  });
});

test('content central API deletes offers and removes them from state', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'delete-offers-web',
        name: 'Delete Offers Web',
        handle: '@deleteoffers',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const combo = await request(server, '/api/projects/delete-offers-web/offers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Combo 3 pizzas',
        type: 'combo',
        price: 'R$99,00',
        items: '3 pizzas selecionadas',
        cta: 'Peça agora',
      }),
    });
    await request(server, '/api/projects/delete-offers-web/offers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Rodízio completo',
        type: 'rodizio',
        price: 'R$49,90',
        items: 'pizzas doces e salgadas',
        cta: 'Aproveite hoje',
      }),
    });

    const deleted = await request(server, '/api/projects/delete-offers-web/offers-delete', {
      method: 'POST',
      body: JSON.stringify({ offerId: combo.body.offer.id }),
    });

    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.deleted, true);
    assert.equal(deleted.body.offerId, combo.body.offer.id);

    const state = await request(server, '/api/state');
    assert.deepEqual(state.body.projects[0].contentStrategy.offers.map((offer) => offer.name), ['Rodízio completo']);
  });
});

test('content central API saves, edits and deletes content pillars', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'pilares-web',
        name: 'Pilares Web',
        handle: '@pilaresweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const created = await request(server, '/api/projects/pilares-web/pillars', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bastidor & Sabor',
        role: 'prova',
        objective: 'Mostrar o preparo real.',
        visualTreatment: 'cru',
        color: '#C2784A',
        weight: 2,
      }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.body.pillar.role, 'prova');
    assert.equal(created.body.pillar.requiresEvidence, true);

    const pillarId = created.body.pillar.id;
    const edited = await request(server, '/api/projects/pilares-web/pillars', {
      method: 'POST',
      body: JSON.stringify({
        id: pillarId,
        name: 'Bastidor & Sabor',
        role: 'prova',
        objective: 'Mostrar o preparo real, com foco no forno a lenha.',
        visualTreatment: 'cru',
        color: '#C2784A',
        weight: 3,
      }),
    });
    assert.equal(edited.response.status, 200);
    assert.equal(edited.body.pillar.weight, 3);

    const state = await request(server, '/api/state');
    assert.equal(state.body.projects[0].contentStrategy.pillars.length, 1);
    assert.equal(state.body.projects[0].contentStrategy.pillars[0].weight, 3);

    const deleted = await request(server, '/api/projects/pilares-web/pillars-delete', {
      method: 'POST',
      body: JSON.stringify({ pillarId }),
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.deleted, true);

    const finalState = await request(server, '/api/state');
    assert.deepEqual(finalState.body.projects[0].contentStrategy.pillars, []);
  });
});

test('content central server falls back to the deterministic pillar template when no pillarSuggester is configured', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'sugerir-pilares-sem-ia', name: 'Sugerir Pilares Sem IA' }),
    });

    const suggested = await request(server, '/api/projects/sugerir-pilares-sem-ia/pillars-suggest', {
      method: 'POST',
      body: '{}',
    });

    assert.equal(suggested.response.status, 200);
    assert.equal(suggested.body.source, 'template');
    assert.deepEqual(suggested.body.pillars.map((p) => p.role).sort(), ['convida', 'ensina', 'posiciona', 'prova']);
    assert.deepEqual(suggested.body.clarifyingQuestions, []);
  });
});

test('content central server wires the injected pillarSuggester through the real route, including extraContext', async () => {
  const calls = [];
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'sugerir-pilares-ia', name: 'Sugerir Pilares IA' }),
      });

      const suggested = await request(server, '/api/projects/sugerir-pilares-ia/pillars-suggest', {
        method: 'POST',
        body: JSON.stringify({ extraContext: 'Ainda não tenho nenhum case de cliente fechado.' }),
      });

      assert.equal(suggested.response.status, 200);
      assert.equal(suggested.body.source, 'ai_suggestion');
      assert.equal(calls[0].extraContext, 'Ainda não tenho nenhum case de cliente fechado.');
      assert.deepEqual(suggested.body.pillars.map((p) => p.name), ['Bastidor & Sabor']);
      assert.equal(suggested.body.pillars[0].role, 'prova');
      assert.deepEqual(suggested.body.clarifyingQuestions, ['Você tem algum resultado real de cliente pra alimentar o pilar Prova?']);
    },
    {
      pillarSuggester: async (payload) => {
        calls.push(payload);
        return {
          pillars: [{ name: 'Bastidor & Sabor', role: 'prova', objective: 'Mostrar o preparo real.', weight: 2 }],
          clarifyingQuestions: ['Você tem algum resultado real de cliente pra alimentar o pilar Prova?'],
        };
      },
    },
  );
});

test('content central API rejects unsupported channels', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'api-safe',
        name: 'API Safe',
        handle: '@apisafe',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const generated = await request(server, '/api/projects/api-safe/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 1,
        startDate: '2026-07-20',
        channels: ['instagram_feed', 'tiktok'],
      }),
    });

    assert.equal(generated.response.status, 500);
    assert.match(generated.body.error, /Canal não suportado/);
  });
});

test('content central API accepts Facebook Feed and Story as generation channels', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'api-facebook',
        name: 'API Facebook',
        handle: '@apifacebook',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const generated = await request(server, '/api/projects/api-facebook/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 1,
        startDate: '2026-07-20',
        channels: ['facebook_feed', 'facebook_story'],
      }),
    });

    assert.equal(generated.response.status, 201);
    assert.deepEqual(generated.body.batches.map((batch) => batch.items[0].channel), ['facebook_feed', 'facebook_story']);
  });
});

test('content central API uploads logo and reference files into project assets', async () => {
  await withServer(async (dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'brand-web',
        name: 'Brand Web',
        handle: '@brandweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const logo = await request(server, '/api/projects/brand-web/assets', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'logo',
        filename: 'Logo Cliente.png',
        dataUrl: `data:image/png;base64,${Buffer.from('fake-logo').toString('base64')}`,
      }),
    });

    assert.equal(logo.response.status, 201);
    assert.equal(logo.body.asset.relativePath, 'assets/logo.png');
    assert.equal(
      await readFile(join(dir, '_opensquad', 'content-central', 'projects', 'brand-web', 'assets', 'logo.png'), 'utf-8'),
      'fake-logo'
    );

    const reference = await request(server, '/api/projects/brand-web/assets', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'reference',
        filename: 'Referencia 01.txt',
        dataUrl: `data:text/plain;base64,${Buffer.from('brand notes').toString('base64')}`,
        role: 'layout_model',
        usageRoles: ['layout_model', 'product_photo', 'text_parameter'],
        weight: 'high',
        instruction: 'Usar como modelo principal de composição.',
      }),
    });

    assert.equal(reference.response.status, 201);
    assert.equal(reference.body.asset.relativePath, 'assets/references/referencia-01.txt');
    assert.equal(reference.body.asset.metadata.role, 'layout_model');
    assert.deepEqual(reference.body.asset.metadata.usageRoles, ['layout_model', 'product_photo', 'text_parameter']);
    assert.equal(reference.body.asset.metadata.weight, 'high');
    assert.equal(reference.body.asset.metadata.previewUrl, '/api/projects/brand-web/assets/assets/references/referencia-01.txt');
    assert.equal(
      await readFile(join(dir, '_opensquad', 'content-central', 'projects', 'brand-web', 'assets', 'references', 'referencia-01.txt'), 'utf-8'),
      'brand notes'
    );

    const state = await request(server, '/api/state');
    assert.equal(state.body.projects[0].brand.references.length, 1);
    assert.equal(state.body.projects[0].brand.references[0].instruction, 'Usar como modelo principal de composição.');
    assert.deepEqual(state.body.projects[0].brand.references[0].usageRoles, ['layout_model', 'product_photo', 'text_parameter']);

    const served = await fetch(`${server.url}/api/projects/brand-web/assets/assets/references/referencia-01.txt`);
    assert.equal(served.status, 200);
    assert.equal(await served.text(), 'brand notes');

    const updated = await request(server, '/api/projects/brand-web/references-update', {
      method: 'POST',
      body: JSON.stringify({
        relativePath: 'assets/references/referencia-01.txt',
        referenceCategory: 'real_product',
        instruction: 'Preservar o prato real, sem trocar ingredientes.',
        weight: 'low',
        useInNextGeneration: false,
      }),
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.reference.referenceCategory, 'real_product');
    assert.equal(updated.body.reference.role, 'product_photo');
    assert.equal(updated.body.reference.instruction, 'Preservar o prato real, sem trocar ingredientes.');
    assert.equal(updated.body.reference.weight, 'low');
    assert.equal(updated.body.reference.useInNextGeneration, false);
    // Editing metadata must not touch the stored file or lose byte/mimeType bookkeeping.
    assert.equal(updated.body.reference.bytes, reference.body.asset.metadata.bytes);
    assert.equal(updated.body.reference.mimeType, reference.body.asset.metadata.mimeType);

    const stateAfterUpdate = await request(server, '/api/state');
    assert.equal(stateAfterUpdate.body.projects[0].brand.references[0].referenceCategory, 'real_product');
    assert.equal(
      await readFile(join(dir, '_opensquad', 'content-central', 'projects', 'brand-web', 'assets', 'references', 'referencia-01.txt'), 'utf-8'),
      'brand notes'
    );

    const updateMissing = await request(server, '/api/projects/brand-web/references-update', {
      method: 'POST',
      body: JSON.stringify({ relativePath: 'assets/references/nao-existe.txt', weight: 'high' }),
    });
    assert.equal(updateMissing.response.status, 500);

    const deleted = await request(server, '/api/projects/brand-web/references-delete', {
      method: 'POST',
      body: JSON.stringify({ relativePath: 'assets/references/referencia-01.txt' }),
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.deleted, true);

    const stateAfterDelete = await request(server, '/api/state');
    assert.equal(stateAfterDelete.body.projects[0].brand.references.length, 0);
  });
});

test('content central API deletes generated content cards', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'delete-web',
        name: 'Delete Web',
        handle: '@deleteweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const generated = await request(server, '/api/projects/delete-web/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-07-20', channel: 'instagram_feed' }),
    });
    const contentId = generated.body.batch.items[0].contentId;

    const deleted = await request(server, `/api/projects/delete-web/content/${contentId}/delete`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.deleted, true);

    const content = await request(server, '/api/projects/delete-web/content');
    assert.equal(content.body.content.length, 0);
  });
});

test('content central API runs a safe test post simulation without real publishing', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'safe-test',
        name: 'Safe Test',
        handle: '@safetest',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const result = await request(server, '/api/projects/safe-test/test-post', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'instagram_feed',
        note: 'teste antes de programar',
      }),
    });

    assert.equal(result.response.status, 201);
    assert.equal(result.body.content.status, 'test_post_simulated');
    assert.equal(result.body.content.image.generated, true);
    assert.equal(result.body.content.image.mimeType, 'image/svg+xml');
    assert.equal(result.body.content.publish.dryRun, true);
    assert.equal(result.body.content.publish.realPublished, false);
    assert.match(result.body.message, /simulação/i);

    const content = await request(server, '/api/projects/safe-test/content');
    assert.equal(content.body.content.length, 1);
    assert.equal(content.body.content[0].status, 'test_post_simulated');
  });
});

test('content central API runs creative reviewer after AI safe test image generation', async () => {
  const generatorCalls = [];
  const reviewerCalls = [];
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'review-agent-web',
        name: 'Review Agent Web',
        handle: '@reviewagent',
        approvalEmail: 'aprovacao@example.com',
      }),
    });
    await request(server, '/api/projects/review-agent-web/offers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Combo 3 pizzas',
        type: 'combo',
        price: '99,99',
        items: '3 pizzas grandes',
      }),
    });

    const result = await request(server, '/api/projects/review-agent-web/test-post', {
      method: 'POST',
      body: JSON.stringify({ channel: 'instagram_feed' }),
    });

    assert.equal(result.response.status, 201);
    assert.equal(result.body.content.image.generatedSource, 'ai');
    assert.equal(generatorCalls.length, 1);
    assert.equal(reviewerCalls.length, 1);
    assert.equal(result.body.content.image.generationAttempts, 1);
    assert.equal(result.body.content.creativeReview.agent, 'Agente Revisor de Criativo');
    assert.equal(result.body.content.creativeReview.status, 'blocked');
    assert.match(result.body.content.creativeReview.summary, /preço extra/i);
    assert.equal(result.body.content.contentReview.status, 'blocked');
  }, {
    imageGenerator: async (payload) => {
      generatorCalls.push(payload);
      return { url: 'https://cdn.example.com/ruim.png', mimeType: 'image/png' };
    },
    imageReviewer: async (payload) => {
      reviewerCalls.push(payload);
      return {
        status: 'blocked',
        summary: 'Detectado preço extra de outra oferta.',
        errors: ['Card contém Rodízio R$39,90, que não pertence ao combo atual.'],
        warnings: [],
        checks: ['Formato feed conferido.'],
      };
    },
  });
});

test('content central API keeps safe test fast when Story review blocks canvas', async () => {
  const generatorCalls = [];
  const reviewerCalls = [];
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'quick-story-web',
        name: 'Quick Story Web',
        handle: '@quickstory',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const result = await request(server, '/api/projects/quick-story-web/test-post', {
      method: 'POST',
      body: JSON.stringify({ channel: 'instagram_story' }),
    });

    assert.equal(result.response.status, 201);
    assert.equal(generatorCalls.length, 1);
    assert.equal(reviewerCalls.length, 1);
    assert.equal(result.body.content.image.generationAttempts, 1);
    assert.equal(result.body.content.creativeReview.status, 'blocked');
  }, {
    imageGenerator: async (payload) => {
      generatorCalls.push(payload);
      return { url: 'https://cdn.example.com/story-bloqueado.png', mimeType: 'image/png' };
    },
    imageReviewer: async (payload) => {
      reviewerCalls.push(payload);
      return {
        status: 'blocked',
        summary: 'Bloqueado por formato incompatível com Instagram Stories.',
        errors: ['Formato visual está quadrado, incompatível com Instagram Stories 9:16.'],
      };
    },
  });
});

test('content central API keeps Story selected in safe test post', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'story-test',
        name: 'Story Test',
        handle: '@storytest',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const result = await request(server, '/api/projects/story-test/test-post', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'instagram_story',
        note: 'quero testar story, não feed',
      }),
    });

    assert.equal(result.response.status, 201);
    assert.equal(result.body.content.channel, 'instagram_story');
    assert.equal(result.body.content.formatLabel, 'Instagram Stories');
    assert.equal(result.body.content.image.aspectRatio, 'portrait');
    assert.equal(result.body.content.image.dimensions.width, 1080);
    assert.equal(result.body.content.image.dimensions.height, 1920);
    assert.match(result.body.content.image.prompt, /Story vertical 9:16/i);
    assert.doesNotMatch(result.body.content.image.prompt, /Instagram Feed de Story Test/);
  });
});

async function withMockedImageUpload(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-image-upload-'));
  const imagePath = join(dir, 'generated.jpg');
  await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

  const originalFetch = globalThis.fetch;
  const hadImgbbKey = Object.prototype.hasOwnProperty.call(process.env, 'IMGBB_API_KEY');
  const originalImgbbKey = process.env.IMGBB_API_KEY;
  try {
    return await fn({ imagePath, dir });
  } finally {
    globalThis.fetch = originalFetch;
    if (hadImgbbKey) process.env.IMGBB_API_KEY = originalImgbbKey;
    else delete process.env.IMGBB_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
}

test('uploadGeneratedImagePublicly falls back to Catbox when IMGBB_API_KEY is not set', async () => {
  await withMockedImageUpload(async ({ imagePath }) => {
    delete process.env.IMGBB_API_KEY;
    const calledUrls = [];
    globalThis.fetch = async (url) => {
      calledUrls.push(String(url));
      if (String(url) === 'https://catbox.moe/user/api.php') {
        return new Response('https://files.catbox.moe/abc123.jpg', { status: 200 });
      }
      if (String(url) === 'https://files.catbox.moe/abc123.jpg') {
        return new Response('', { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      throw new Error(`unexpected fetch call: ${url}`);
    };

    const url = await uploadGeneratedImagePublicly(imagePath);

    assert.equal(url, 'https://files.catbox.moe/abc123.jpg');
    assert.ok(calledUrls.includes('https://catbox.moe/user/api.php'));
    assert.ok(!calledUrls.some((called) => called.includes('imgbb.com')));
  });
});

test('uploadGeneratedImagePublicly keeps using ImgBB when IMGBB_API_KEY is set', async () => {
  await withMockedImageUpload(async ({ imagePath }) => {
    process.env.IMGBB_API_KEY = 'fake-key';
    const calledUrls = [];
    globalThis.fetch = async (url) => {
      calledUrls.push(String(url));
      if (String(url).startsWith('https://api.imgbb.com/1/upload')) {
        return new Response(JSON.stringify({ success: true, data: { url: 'https://i.ibb.co/xyz/generated.jpg' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url) === 'https://i.ibb.co/xyz/generated.jpg') {
        return new Response('', { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      throw new Error(`unexpected fetch call: ${url}`);
    };

    const url = await uploadGeneratedImagePublicly(imagePath);

    assert.equal(url, 'https://i.ibb.co/xyz/generated.jpg');
    assert.ok(calledUrls.some((called) => called.startsWith('https://api.imgbb.com/1/upload')));
    assert.ok(!calledUrls.some((called) => called.includes('catbox')));
  });
});

test('uploadGeneratedImagePublicly rejects a hosted URL that does not serve an image', async () => {
  await withMockedImageUpload(async ({ imagePath }) => {
    delete process.env.IMGBB_API_KEY;
    globalThis.fetch = async (url) => {
      if (String(url) === 'https://catbox.moe/user/api.php') {
        return new Response('https://files.catbox.moe/not-really-an-image.jpg', { status: 200 });
      }
      if (String(url) === 'https://files.catbox.moe/not-really-an-image.jpg') {
        return new Response('<html>not an image</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      throw new Error(`unexpected fetch call: ${url}`);
    };

    await assert.rejects(() => uploadGeneratedImagePublicly(imagePath), /não respondeu como imagem|not an image|image\//i);
  });
});

test('uploadGeneratedImagePublicly falls back to uguu.se when Catbox is unreachable', async () => {
  await withMockedImageUpload(async ({ imagePath }) => {
    delete process.env.IMGBB_API_KEY;
    const calledUrls = [];
    globalThis.fetch = async (url) => {
      calledUrls.push(String(url));
      if (String(url) === 'https://catbox.moe/user/api.php') {
        throw new Error('fetch failed');
      }
      if (String(url) === 'https://uguu.se/upload') {
        return new Response(JSON.stringify({ success: true, files: [{ url: 'https://d.uguu.se/generated.jpg' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url) === 'https://d.uguu.se/generated.jpg') {
        return new Response('', { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      throw new Error(`unexpected fetch call: ${url}`);
    };

    const url = await uploadGeneratedImagePublicly(imagePath);

    assert.equal(url, 'https://d.uguu.se/generated.jpg');
    assert.ok(calledUrls.includes('https://catbox.moe/user/api.php'), 'Catbox should still be tried first');
    assert.ok(calledUrls.includes('https://uguu.se/upload'), 'uguu.se should be tried once Catbox fails');
  });
});

test('uploadGeneratedImagePublicly reports both hosts when Catbox and uguu.se both fail', async () => {
  await withMockedImageUpload(async ({ imagePath }) => {
    delete process.env.IMGBB_API_KEY;
    globalThis.fetch = async (url) => {
      if (String(url) === 'https://catbox.moe/user/api.php') throw new Error('fetch failed');
      if (String(url) === 'https://uguu.se/upload') throw new Error('fetch failed too');
      throw new Error(`unexpected fetch call: ${url}`);
    };

    await assert.rejects(() => uploadGeneratedImagePublicly(imagePath), /Catbox.*uguu\.se|uguu\.se.*Catbox/i);
  });
});

test('uploadGeneratedVideoPublicly falls back to uguu.se when Catbox is unreachable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-video-upload-'));
  const videoPath = join(dir, 'generated.mp4');
  await writeFile(videoPath, Buffer.from([0x00, 0x00, 0x00, 0x18]));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url) === 'https://catbox.moe/user/api.php') throw new Error('fetch failed');
      if (String(url) === 'https://uguu.se/upload') {
        return new Response(JSON.stringify({ success: true, files: [{ url: 'https://n.uguu.se/generated.mp4' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url) === 'https://n.uguu.se/generated.mp4') {
        return new Response('', { status: 200, headers: { 'content-type': 'video/mp4' } });
      }
      throw new Error(`unexpected fetch call: ${url}`);
    };

    const url = await uploadGeneratedVideoPublicly(videoPath);
    assert.equal(url, 'https://n.uguu.se/generated.mp4');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('htmlToReadableText strips tags, scripts and entities down to plain readable text', () => {
  const html = `
    <html><head><style>.x{color:red}</style><script>track();</script></head>
    <body>
      <h1>Boss Pizzaria</h1>
      <p>Rodízio de pizzas &amp; delivery.</p>
      <ul><li>Pizza Grande &mdash; R$ 49,90</li><li>Combo 10 Esfihas &ndash; R$ 55,00</li></ul>
    </body></html>
  `;

  const text = htmlToReadableText(html);

  assert.ok(!text.includes('track()'));
  assert.ok(!text.includes('color:red'));
  assert.ok(!text.includes('<'));
  assert.match(text, /Boss Pizzaria/);
  assert.match(text, /Rodízio de pizzas & delivery/);
  assert.match(text, /Pizza Grande/);
});

async function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('fetchSiteText rejects non-http(s) URLs before making any network call', async () => {
  await assert.rejects(() => fetchSiteText('ftp://example.com/menu'), /http:\/\/ ou https:\/\//);
  await assert.rejects(() => fetchSiteText('not a url'), /URL inválida/);
});

test('fetchSiteText fetches a page and returns its readable text', async () => {
  await withMockedFetch(
    async () => new Response('<html><body><h1>Boss Pizzaria</h1><p>Pizza Grande R$ 49,90</p></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
    async () => {
      const text = await fetchSiteText('https://bosspizzaria.example.com');
      assert.match(text, /Boss Pizzaria/);
      assert.match(text, /Pizza Grande R\$ 49,90/);
    },
  );
});

test('fetchSiteText rejects when the site responds with an error status', async () => {
  await withMockedFetch(
    async () => new Response('not found', { status: 404 }),
    async () => {
      await assert.rejects(() => fetchSiteText('https://example.com/missing'), /status 404/);
    },
  );
});

test('fetchSiteText rejects a URL whose response is not an HTML/text page', async () => {
  await withMockedFetch(
    async () => new Response('binary', { status: 200, headers: { 'content-type': 'application/pdf' } }),
    async () => {
      await assert.rejects(() => fetchSiteText('https://example.com/menu.pdf'), /não parece ser uma página web/);
    },
  );
});

test('content central server exposes site-analyze as 501 when no analyzer is configured', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'site-web', name: 'Site Web' }),
    });
    const analyzed = await request(server, '/api/projects/site-web/site-analyze', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    assert.equal(analyzed.response.status, 501);
  });
});

test('content central server wires the injected siteAnalyzer through the real route, returning brand info and offer candidates', async () => {
  const calls = [];
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'site-web', name: 'Site Web' }),
      });

      const analyzed = await request(server, '/api/projects/site-web/site-analyze', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://bosspizzaria.example.com' }),
      });

      assert.equal(analyzed.response.status, 200);
      assert.equal(calls[0], 'https://bosspizzaria.example.com');
      assert.equal(analyzed.body.brandInput.brandName, 'Boss Pizzaria');
      assert.deepEqual(analyzed.body.offers, [{ name: 'Pizza Grande', price: 'R$ 49,90', items: '' }]);
    },
    {
      siteAnalyzer: async ({ url }) => {
        calls.push(url);
        return {
          brandInput: {
            brandName: 'Boss Pizzaria',
            segment: 'Pizzaria',
            productsOrServices: '',
            description: '',
            serviceRegion: '',
            mainDifferential: '',
          },
          offers: [{ name: 'Pizza Grande', price: 'R$ 49,90', items: '' }],
        };
      },
    },
  );
});

test('content central server exposes research-online as 501 when no webResearcher is configured', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'pesquisa-web', name: 'Pesquisa Web' }),
    });
    const researched = await request(server, '/api/projects/pesquisa-web/research-online', { method: 'POST', body: '{}' });
    assert.equal(researched.response.status, 501);
  });
});

test('content central server wires the injected webResearcher through the real route and folds findings into image rules', async () => {
  const calls = [];
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'pesquisa-web', name: 'Pesquisa Web' }),
      });
      await request(server, '/api/projects/pesquisa-web/company-profile', {
        method: 'POST',
        body: JSON.stringify({ segment: 'Pizzaria', productsOrServices: 'Pizzas e esfihas' }),
      });

      const researched = await request(server, '/api/projects/pesquisa-web/research-online', { method: 'POST', body: '{}' });

      assert.equal(researched.response.status, 200);
      assert.equal(calls[0].segment, 'Pizzaria');
      assert.equal(researched.body.findings.length, 1);
      assert.match(researched.body.findings[0], /^\[Pesquisa online\] Fundo escuro com foto do produto/);
      assert.ok(researched.body.researchedAt);
    },
    {
      webResearcher: async (payload) => {
        calls.push(payload);
        return 'Fundo escuro com foto do produto centralizada';
      },
    },
  );
});

test('content central server exposes animate-reels as 501 when no videoAnimator is configured', async () => {
  await withServer(async (dir, server) => {
    await createCentralProject({ projectId: 'animar-web', name: 'Animar Web' }, dir);
    const batch = await generateContentSchedulePlan('animar-web', {
      days: 1,
      startDate: '2026-07-20',
      formats: [{ channel: 'instagram_reels', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
    }, dir);

    const animated = await request(server, `/api/projects/animar-web/content/${batch.items[0].contentId}/animate-reels`, {
      method: 'POST',
      body: JSON.stringify({ batchId: batch.batchId }),
    });
    assert.equal(animated.response.status, 501);
  });
});

test('content central server wires the injected videoAnimator through the real animate-reels route', async () => {
  const calls = [];
  await withServer(
    async (dir, server) => {
      await createCentralProject({ projectId: 'animar-web-ok', name: 'Animar Web Ok' }, dir);
      const batch = await generateContentSchedulePlan('animar-web-ok', {
        days: 1,
        startDate: '2026-07-20',
        formats: [{ channel: 'instagram_reels', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      }, dir);
      const contentId = batch.items[0].contentId;

      // The route only requires a real AI-generated image, not a real
      // publish/hosting pipeline — patch that in directly for this route test.
      await request(server, `/api/projects/animar-web-ok/content/${contentId}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ regenerate: 'creative', batchId: batch.batchId }),
      });

      const animated = await request(server, `/api/projects/animar-web-ok/content/${contentId}/animate-reels`, {
        method: 'POST',
        body: JSON.stringify({ batchId: batch.batchId }),
      });

      assert.equal(animated.response.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(animated.body.content.video.url, '/api/projects/animar-web-ok/assets/assets/generated/reels-test.mp4');
      assert.equal(animated.body.content.video.generatedSource, 'ffmpeg_zoompan');
    },
    {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/reels-source.png', mimeType: 'image/png' }),
      videoAnimator: async (payload) => {
        calls.push(payload);
        return { url: '/api/projects/animar-web-ok/assets/assets/generated/reels-test.mp4', mimeType: 'video/mp4', durationSeconds: 7 };
      },
    },
  );
});

test('content central server animates Reels slots automatically as part of /generate, with no separate animate-reels call', async () => {
  let animateCalls = 0;
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'reels-auto-web', name: 'Reels Auto Web' }),
      });

      const generated = await request(server, '/api/projects/reels-auto-web/generate', {
        method: 'POST',
        body: JSON.stringify({
          days: 1,
          startDate: '2026-07-20',
          formats: [{ channel: 'instagram_reels', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
        }),
      });
      assert.equal(generated.response.status, 201);

      // /generate kicks off image (and now video) generation in the
      // background without blocking the response — poll the content list
      // until the async job finishes, the same way the real panel does.
      let reels = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const state = await request(server, '/api/projects/reels-auto-web/content');
        reels = state.body?.content?.find((item) => item.channel === 'instagram_reels') || null;
        if (reels?.video?.url || reels?.videoGenerationError) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      assert.ok(reels, 'expected the Reels content item to eventually appear');
      assert.equal(animateCalls, 1);
      assert.equal(reels.video.url, '/api/projects/reels-auto-web/assets/assets/generated/reels-auto.mp4');
      assert.equal(reels.video.generatedSource, 'ffmpeg_zoompan');
    },
    {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/reels-auto.png', mimeType: 'image/png' }),
      videoAnimator: async () => {
        animateCalls += 1;
        return { url: '/api/projects/reels-auto-web/assets/assets/generated/reels-auto.mp4', mimeType: 'video/mp4', durationSeconds: 7 };
      },
    },
  );
});

test('content central server passes pasted text through to the siteAnalyzer, not just url', async () => {
  const received = [];
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'site-web', name: 'Site Web' }),
      });

      const analyzed = await request(server, '/api/projects/site-web/site-analyze', {
        method: 'POST',
        body: JSON.stringify({ text: 'Pizza Grande R$ 49,90 - colado manualmente pelo operador' }),
      });

      assert.equal(analyzed.response.status, 200);
      assert.equal(received[0].url, undefined);
      assert.match(received[0].text, /colado manualmente/);
    },
    {
      siteAnalyzer: async ({ url, text }) => {
        received.push({ url, text });
        return { brandInput: { brandName: '', segment: '', productsOrServices: '', description: '', serviceRegion: '', mainDifferential: '' }, offers: [] };
      },
    },
  );
});

test('fetchSiteText follows relevant same-site links (sobre, cardápio) and combines their text, ignoring off-site links', async () => {
  await withMockedFetch(
    async (url) => {
      const u = String(url);
      if (u === 'https://pizza.example.com/') {
        return new Response(
          '<html><body><h1>Boss Pizzaria</h1>'
          + '<a href="/sobre">Sobre nós</a>'
          + '<a href="/cardapio">Cardápio</a>'
          + '<a href="https://outrosite.example.com/anuncio">Parceiro</a>'
          + '</body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      if (u === 'https://pizza.example.com/sobre') {
        return new Response('<html><body><p>Fundada em 2010, tradição em Várzea Grande.</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (u === 'https://pizza.example.com/cardapio') {
        return new Response('<html><body><p>Pizza Grande R$ 49,90</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      throw new Error(`unexpected fetch call in test: ${u}`);
    },
    async () => {
      const text = await fetchSiteText('https://pizza.example.com/');
      assert.match(text, /Boss Pizzaria/);
      assert.match(text, /Fundada em 2010/);
      assert.match(text, /Pizza Grande R\$ 49,90/);
    },
  );
});

test('fetchSiteText keeps the main page text even when every linked sub-page fails to load', async () => {
  await withMockedFetch(
    async (url) => {
      const u = String(url);
      if (u === 'https://pizza.example.com/') {
        return new Response('<html><body><h1>Boss Pizzaria</h1><a href="/sobre">Sobre</a></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('blocked', { status: 403 });
    },
    async () => {
      const text = await fetchSiteText('https://pizza.example.com/');
      assert.match(text, /Boss Pizzaria/);
    },
  );
});
