import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { withGaveta } from './helpers/with-gaveta.js';
import { upsertQueueItem } from '../src/gaveta-sync.js';
import {
  animateImageForReelsWithFfmpeg,
  buildAiImageGenerationPrompt,
  buildAiImageReviewPrompt,
  buildCatalogOutpaintPrompt,
  buildAdCopyPrompt,
  buildCarouselOutlinePrompt,
  CONTENT_CENTRAL_PERSONAS,
  buildDanteOptimizerPrompt,
  buildSofiaSocialCaptionPrompt,
  composeProductStoryImage,
  cropCircularAvatar,
  cropOpenAiImageToChannel,
  fetchSiteText,
  htmlToReadableText,
  loadContentCentralEnv,
  nousFalAspectRatioForChannel,
  normalizeProspectExtraction,
  openAiImageSizeForChannel,
  publishCarouselToInstagram,
  publishContentToWhatsAppStatus,
  publishWithGaveteSync,
  resolveContentImageAbsolutePath,
  selectImageReferencesForCodex,
  selectOpenAiImageEditReferences,
  startContentCentralServer,
  startPublishScheduler,
  startWhatsAppPublishScheduler,
  startStuckMediaRetryScheduler,
  startSocialSellingRadarScheduler,
  startSocialSellingEngagementScheduler,
  uploadGeneratedImagePublicly,
  uploadGeneratedVideoPublicly,
  xaiAspectRatioForChannel,
  syncTokenSecretsToGitHub,
} from '../src/content-central-server.js';
import * as serverModule from '../src/content-central-server.js';
import {
  analyzeLearningImage,
  approveContent,
  createCentralProject,
  generateCatalogSchedulePlan,
  getCentralPaths,
  generateContentSchedulePlan,
  loadProjectForTest,
  registerSegmentTemplate,
  saveLearningEntry,
  saveProjectAsset,
  saveProjectOffer,
  saveProjectToken,
  saveProjectWhatsAppInstance,
  updateProjectBrandInput,
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

// Captured once at module load, before any test can swap globalThis.fetch
// via withMockedFetch — request() must always reach the real local test
// server over the real network, even from inside a withMockedFetch block
// where the *server's own* outbound fetch (to the real Evolution API) is
// what's meant to be intercepted, not this client-side HTTP call to it.
const realFetch = globalThis.fetch;

async function request(server, path, options = {}) {
  const response = await realFetch(`${server.url}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { response, body };
}

const execFileAsync = promisify(execFile);

// buildPrimaryAiImageReferences now requires a registered creative template
// (a segment-learning entry tagged purpose:'creative' with a matching
// postType/shape) before AI generation is allowed to proceed — see task-3 of
// the mandatory-creative-templates plan. Every pre-existing test that
// reaches real AI image generation needs one of these registered in its
// setup, or it now fails with "Nenhum modelo de criativo cadastrado".
let registerCreativeTemplateCounter = 0;
async function registerCreativeTemplate(groupKey, postType, shape, dir) {
  registerCreativeTemplateCounter += 1;
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const template = await analyzeLearningImage({
    scope: 'segment', groupKey, dataUrl, filename: `modelo-teste-${registerCreativeTemplateCounter}.png`,
  }, dir, new Date(), { learningImageAnalyzer: async () => 'modelo' });
  await saveLearningEntry({
    scope: 'segment', groupKey, bucket: 'approved', kind: 'image',
    text: 'modelo de referência', imagePath: template.imagePath,
    purpose: 'creative', postType, shape,
  }, dir);
  return template;
}

// Builds one approved-and-scheduled content item the same way the panel
// does (create project -> generate a schedule plan -> approve one item
// through the real route), for tests that exercise approve/publish/token
// routes end to end.
async function createApprovedItem(server, dir, projectId) {
  await createCentralProject({ projectId, name: projectId }, dir);
  const batch = await generateContentSchedulePlan(projectId, {
    days: 1,
    startDate: '2026-08-10',
    formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '18:00', intervalMinutes: 0 }],
  }, dir);
  const contentId = batch.items[0].contentId;
  const approved = await request(server, `/api/projects/${projectId}/content/${contentId}/approve`, { method: 'POST' });
  assert.equal(approved.response.status, 200);
  return { contentId, batchId: batch.batchId };
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
  assert.match(prompt, /produto final pertencer a outra categoria/i);
  assert.match(prompt, /quantidade diferente da referência\/oferta/i);
});

test('Content Central exposes the official persona map and prompt builders use those persona identities', () => {
  assert.deepEqual(Object.keys(CONTENT_CENTRAL_PERSONAS), ['sofia', 'dante', 'clara', 'diego', 'renata']);

  const content = {
    channel: 'instagram_feed',
    formatLabel: 'Instagram Feed',
    image: { prompt: 'Briefing aprovado', dimensions: { width: 1080, height: 1350 } },
    contentTopic: { offerName: 'Combo Família', price: '89,90', type: 'combo' },
  };
  const project = { name: 'Boss Pizzaria', brandInput: {} };

  assert.match(buildSofiaSocialCaptionPrompt({ content, project }), /Sofia Social/);
  assert.match(buildDanteOptimizerPrompt({ content, project, draft: 'Legenda inicial.' }), /Dante Conteúdo/);
  assert.match(buildAiImageGenerationPrompt({ content }), /Clara Criativa/);
  assert.match(buildAdCopyPrompt({ adCreative: { objective: 'sales', objectiveLabel: 'Vendas', contentTopic: content.contentTopic }, project }), /Diego Performance/);
  assert.match(buildAiImageReviewPrompt({ content, project }), /Renata Revisão/);
});

test('AI image reviewer prompt also blocks missing required items (by default, with no note needed) and letterbox blur bars, and switches framing when the image is attached instead of linked', () => {
  const linked = buildAiImageReviewPrompt({
    content: {
      channel: 'instagram_feed',
      formatLabel: 'Instagram Feed',
      image: { url: 'https://cdn.example.com/rodizio.png' },
      contentTopic: { offerName: 'Rodizio da boss', price: '29,99', items: 'pizza salgado, pizza doce, batata frita e esfiha' },
    },
    project: { name: 'Boss Pizzaria' },
    note: '',
  });
  assert.match(linked, /Imagem: https:\/\/cdn\.example\.com\/rodizio\.png/);
  assert.match(linked, /item.*não apareça visualmente reconhecível/i);
  assert.match(linked, /todos os itens listados precisam estar representados/i);
  assert.match(linked, /barras, faixas ou bordas desfocadas/i);

  const attached = buildAiImageReviewPrompt({
    content: { channel: 'instagram_feed', formatLabel: 'Instagram Feed', image: { url: 'https://cdn.example.com/rodizio.png' }, contentTopic: {} },
    project: { name: 'Boss Pizzaria' },
    attachedAsFile: true,
  });
  assert.doesNotMatch(attached, /Imagem: https:\/\//);
  assert.match(attached, /imagem final anexada a este turno/i);
});

test('AI image reviewer receives the product/layout comparison manifest and returns structured codes and scores', () => {
  const prompt = buildAiImageReviewPrompt({
    content: {
      channel: 'instagram_story',
      formatLabel: 'Instagram Stories',
      image: {
        url: '/api/projects/loja/assets/generated/final.png',
        references: [
          { role: 'product_photo', absolutePath: 'C:/tmp/produto.png', relativePath: 'assets/produto.png', mimeType: 'image/png' },
          { role: 'layout_model', absolutePath: 'C:/tmp/layout.png', relativePath: 'assets/layout.png', mimeType: 'image/png' },
        ],
      },
      creativeSpec: {
        product: { treatment: 'creative_redraw' },
        layout: { strength: 'strict', zones: ['Topo: título.', 'Centro: produto.', 'Base: preço e CTA.'] },
      },
      contentTopic: { offerName: 'Pote G695', price: 'R$ 19,90', items: '100 unidades', notes: 'Não inventar capacidade térmica.' },
    },
    project: { name: 'Loja de Embalagens' },
    attachedAsFile: true,
  });

  assert.match(prompt, /Anexo 1: criativo final/i);
  assert.match(prompt, /Anexo 2: product_photo.*assets\/produto\.png/i);
  assert.match(prompt, /Anexo 3: layout_model.*assets\/layout\.png/i);
  assert.match(prompt, /Redesenho criativo é permitido/i);
  assert.match(prompt, /LAYOUT_MISMATCH/);
  assert.match(prompt, /"scores"/);
  assert.match(prompt, /Não inventar capacidade térmica/i);
});

test('resolveContentImageAbsolutePath derives the real file path on disk from content.filePath + image.url, without needing targetDir threaded in separately', () => {
  const projectDir = 'C:\\Users\\op\\OneDrive\\Documentos\\PROJETO\\OPENSQUAD\\_opensquad\\content-central\\projects\\boss-pizzaria';
  const resolved = resolveContentImageAbsolutePath({
    projectId: 'boss-pizzaria',
    filePath: `${projectDir}\\content\\ad-creatives\\boss-pizzaria-anuncio-123.json`,
    image: { url: '/api/projects/boss-pizzaria/assets/assets/generated/codexagent-123.png' },
  });
  assert.equal(resolved, `${projectDir}\\assets\\generated\\codexagent-123.png`);

  // No usable filePath/url — returns null instead of guessing or throwing.
  assert.equal(resolveContentImageAbsolutePath({ projectId: 'boss-pizzaria', filePath: '', image: {} }), null);
  assert.equal(resolveContentImageAbsolutePath({ filePath: 'C:\\x\\_opensquad\\...', image: { url: '/api/projects/x/assets/assets/y.png' } }), null);
});

test('offer direction endpoint sends title, details and uploaded image to the suggester', async () => {
  let received = null;
  await withServer(async (dir, server) => {
    await createCentralProject({
      projectId: 'casa-de-embalagem',
      name: 'Casa de embalagem',
      brandInput: { audienceType: 'b2b', productsOrServices: 'embalagens para restaurantes, delivery e mercados' },
    }, dir);
    const result = await request(server, '/api/projects/casa-de-embalagem/offers/suggest-direction', {
      method: 'POST',
      body: JSON.stringify({
        name: 'FILME 280X300M - DISPAFILM',
        price: 'R$ 33,90',
        items: 'rolo para embalar alimentos',
        imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      }),
    });

    assert.equal(result.response.status, 200);
    assert.match(result.body.notes, /Chamada sugerida/);
    assert.equal(received.name, 'FILME 280X300M - DISPAFILM');
    assert.equal(received.price, 'R$ 33,90');
    assert.equal(received.audienceType, 'b2b');
    assert.match(received.productsOrServices, /restaurantes/);
    assert.ok(received.imagePaths[0].endsWith('.png'));
  }, {
    offerDirectionSuggester: async (payload) => {
      received = payload;
      return 'Direcionamento: food-service. Chamada sugerida: Proteção prática para embalar melhor. Benefícios permitidos: protege alimentos, agiliza preparo, apoia balcão/delivery.';
    },
  });
});

test('offer direction fallback allows basic B2B commercial promises without technical claims', async () => {
  await withServer(async (dir, server) => {
    await createCentralProject({
      projectId: 'casa-de-embalagem',
      name: 'Casa de embalagem',
      brandInput: { audienceType: 'b2b', productsOrServices: 'embalagens para restaurantes, delivery e mercados' },
    }, dir);
    const result = await request(server, '/api/projects/casa-de-embalagem/offers/suggest-direction', {
      method: 'POST',
      body: JSON.stringify({ name: 'INSUFILME 30CM X 100M', price: 'R$ 62,40', items: 'rolo de 100m; largura 30cm' }),
    });

    assert.equal(result.response.status, 200);
    assert.match(result.body.notes, /Promessas básicas permitidas/i);
    assert.match(result.body.notes, /praticidade|economia operacional|reposição/i);
    assert.match(result.body.notes, /Não prometer/i);
  });
});

test('offer direction fallback allows family-specific bag and sealing promises when supported', async () => {
  await withServer(async (dir, server) => {
    await createCentralProject({
      projectId: 'casa-de-embalagem',
      name: 'Casa de embalagem',
      brandInput: { audienceType: 'b2b', productsOrServices: 'sacolas, sacos e embalagens para comércio' },
    }, dir);

    const bag = await request(server, '/api/projects/casa-de-embalagem/offers/suggest-direction', {
      method: 'POST',
      body: JSON.stringify({ name: 'SACOLA PLÁSTICA REFORÇADA', price: 'R$ 28,90', items: 'pacote com sacolas para comércio' }),
    });
    const sealable = await request(server, '/api/projects/casa-de-embalagem/offers/suggest-direction', {
      method: 'POST',
      body: JSON.stringify({ name: 'SACO ZIP LOCK TRANSPARENTE', price: 'R$ 12,90', items: 'embalagem com fechamento zip' }),
    });

    assert.equal(bag.response.status, 200);
    assert.match(bag.body.notes, /resist|refor/i);
    assert.doesNotMatch(bag.body.notes, /veda/i);
    assert.equal(sealable.response.status, 200);
    assert.match(sealable.body.notes, /veda|fechamento/i);
  });
});

test('offer direction fallback allows real product-family promises beyond bags', async () => {
  await withServer(async (dir, server) => {
    await createCentralProject({
      projectId: 'casa-de-embalagem',
      name: 'Casa de embalagem',
      brandInput: { audienceType: 'b2b', productsOrServices: 'embalagens, descartáveis e limpeza para comércio' },
    }, dir);

    const cases = [
      ['DETERGENTE NEUTRO 5L', 'limpeza de utensílios e remoção de gordura', /gordura|limpeza/i],
      ['GUARDANAPO FOLHA SIMPLES', 'pacote para balcão e delivery', /absor|servir/i],
      ['COPO DESCARTÁVEL 200ML', 'copo para bebidas', /bebida|servir/i],
      ['POTE REDONDO COM TAMPA', 'embalagem para delivery', /fechamento|organiza/i],
    ];

    for (const [name, items, expected] of cases) {
      const result = await request(server, '/api/projects/casa-de-embalagem/offers/suggest-direction', {
        method: 'POST',
        body: JSON.stringify({ name, price: 'R$ 19,90', items }),
      });
      assert.equal(result.response.status, 200);
      assert.match(result.body.notes, expected);
    }
  });
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
  // Confirmed live (2026-08-07): real ad creatives came back with blurred
  // letterbox bars on the edges when the raw image_gen output didn't land
  // on the exact target aspect ratio. Both the from-scratch and targeted-
  // edit prompts must tell the model to fill the whole frame.
  assert.match(prompt, /preenchendo o quadro inteiro/i);
});

test('a targeted edit prompt also asks the model to fill the whole frame, same anti-letterbox instruction as the from-scratch prompt', () => {
  const prompt = buildAiImageGenerationPrompt({
    content: { channel: 'instagram_feed', formatLabel: 'Instagram Feed', image: { aspectRatio: 'portrait', dimensions: { width: 1080, height: 1350 } } },
    note: 'Trocar o preço para R$ 19,90.',
    targetedEdit: true,
  });
  assert.match(prompt, /preenchendo o quadro inteiro/i);
});

test('a targeted edit (an operator correction note) asks the model to change only that, instead of the from-scratch brief that pushes it to redo at least 3 things', () => {
  const content = {
    channel: 'instagram_story',
    formatLabel: 'Instagram Stories',
    image: {
      aspectRatio: 'portrait',
      dimensions: { width: 1080, height: 1920 },
      prompt: 'FORMATO\n- Story vertical 9:16.\n\nTEXTOS OBRIGATÓRIOS\n- Título exato: Galinha com Arroz',
    },
  };

  const editPrompt = buildAiImageGenerationPrompt({ content, note: 'aumentar o preço', targetedEdit: true });
  assert.match(editPrompt, /EDIÇÃO pontual/i);
  assert.match(editPrompt, /aumentar o preço/);
  assert.match(editPrompt, /preserve exatamente o restante da composição/i);
  assert.match(editPrompt, /Se o pedido citar logo\/marca, ajuste somente a logo/i);
  assert.doesNotMatch(editPrompt, /mudar claramente pelo menos 3 itens/i);
  assert.doesNotMatch(editPrompt, /HIERARQUIA/i);
  // A realism-focused correction ("isso ficou com cara de IA") needs the
  // same concrete anti-AI technique vocabulary the full brief carries —
  // otherwise the model has nothing but the bare complaint to act on.
  assert.match(editPrompt, /evite aparência de IA/i);
  assert.match(editPrompt, /materiais e texturas realistas/i);

  // A rescue pass (fixing a broken canvas/aspect ratio) needs a real
  // from-scratch regeneration — editing the same broken image can't fix a
  // structural problem, so targetedEdit must be ignored there.
  const rescuePrompt = buildAiImageGenerationPrompt({ content, note: 'aumentar o preço', targetedEdit: true, rescueMode: true });
  assert.doesNotMatch(rescuePrompt, /EDIÇÃO pontual/i);
  assert.match(rescuePrompt, /MODO RESGATE ATIVO/i);

  // No note at all ("try something different") has nothing to edit toward —
  // stays a normal from-scratch generation.
  const noNotePrompt = buildAiImageGenerationPrompt({ content, note: '', targetedEdit: true });
  assert.doesNotMatch(noNotePrompt, /EDIÇÃO pontual/i);
});

test('caption prompts adapt tone to the project\'s B2B/B2C audience focus, and stay silent when unset', () => {
  const content = { formatLabel: 'Instagram Stories', channel: 'instagram_story', contentTopic: { offerName: 'Combo 20 Esfihas', price: '97,00' } };

  const b2bPrompt = buildSofiaSocialCaptionPrompt({ content, project: { name: 'Casa de Embalagem', brandInput: { audienceType: 'b2b' } } });
  assert.match(b2bPrompt, /B2B/);
  assert.match(b2bPrompt, /revenda, atacado, operação/i);
  assert.doesNotMatch(b2bPrompt, /B2C/);

  const b2cPrompt = buildSofiaSocialCaptionPrompt({ content, project: { name: 'Boss Pizzaria', brandInput: { audienceType: 'b2c' } } });
  assert.match(b2cPrompt, /B2C/);
  assert.match(b2cPrompt, /consumidor final/i);

  const unsetPrompt = buildSofiaSocialCaptionPrompt({ content, project: { name: 'Boss Pizzaria', brandInput: {} } });
  assert.doesNotMatch(unsetPrompt, /Foco comercial/i);

  const b2bOptimizerPrompt = buildDanteOptimizerPrompt({ content, project: { name: 'Casa de Embalagem', brandInput: { audienceType: 'b2b' } }, draft: 'Rascunho de teste.' });
  assert.match(b2bOptimizerPrompt, /B2B/);
});

test('ad copy prompt asks for headline/primaryText/description within Meta\'s real character limits, and its guidance changes with the ad objective', () => {
  const adCreative = { objective: 'sales', objectiveLabel: 'Vendas/Conversão', contentTopic: { offerName: 'Combo 20 Esfihas', price: '97,00' } };
  const salesPrompt = buildAdCopyPrompt({ adCreative, project: { name: 'Boss Pizzaria' } });
  assert.match(salesPrompt, /"description"/);
  assert.match(salesPrompt, /máximo 30 caracteres/);
  assert.match(salesPrompt, /Compre agora/i);

  const engagementCreative = { ...adCreative, objective: 'engagement', objectiveLabel: 'Engajamento' };
  const engagementPrompt = buildAdCopyPrompt({ adCreative: engagementCreative, project: { name: 'Boss Pizzaria' } });
  assert.match(engagementPrompt, /Comenta aqui/i);
  assert.doesNotMatch(engagementPrompt, /Compre agora/i);

  const awarenessCreative = { ...adCreative, objective: 'awareness', objectiveLabel: 'Reconhecimento de marca' };
  const awarenessPrompt = buildAdCopyPrompt({ adCreative: awarenessCreative, project: { name: 'Boss Pizzaria' } });
  assert.match(awarenessPrompt, /Sem venda dura/i);
});

test('ad copy prompt treats the operator\'s note as one more input by default, but as the whole brief in "base_total" mode', () => {
  const adCreative = { objective: 'whatsapp', objectiveLabel: 'Tráfego para o WhatsApp', contentTopic: {} };
  const recomendacaoPrompt = buildAdCopyPrompt({ adCreative, project: { name: 'Boss Pizzaria' }, note: 'menos de R$5/dia move seu Instagram', noteMode: 'recomendacao' });
  assert.match(recomendacaoPrompt, /use como inspiração adicional/i);
  assert.doesNotMatch(recomendacaoPrompt, /todas baseadas na MESMA ideia central/i);

  const baseTotalPrompt = buildAdCopyPrompt({ adCreative, project: { name: 'Boss Pizzaria' }, note: 'menos de R$5/dia move seu Instagram', noteMode: 'base_total' });
  assert.match(baseTotalPrompt, /baseie tudo nela/i);
  assert.match(baseTotalPrompt, /todas baseadas na MESMA ideia central/i);
});

test('ad copy prompt folds in the project\'s approved/avoid learnings from past organic posts, same signal the image prompt already gets', () => {
  const adCreative = { objective: 'whatsapp', objectiveLabel: 'Tráfego para o WhatsApp', contentTopic: {} };
  const projectWithLearnings = {
    name: 'Boss Pizzaria',
    learnings: {
      avoid: ['Combo Família (Instagram Feed, 2026-07-01): rejeitado — tom agressivo demais, cliente pediu mais leveza.'],
      approved: ['Pizza Grande (Instagram Feed, 2026-07-15): aprovado.'],
    },
  };
  const promptWithLearnings = buildAdCopyPrompt({ adCreative, project: projectWithLearnings });
  assert.match(promptWithLearnings, /APRENDIZADOS DE CONTEÚDOS ANTERIORES/i);
  assert.match(promptWithLearnings, /tom agressivo demais/i);
  assert.match(promptWithLearnings, /Pizza Grande.*aprovado/i);

  const promptWithoutLearnings = buildAdCopyPrompt({ adCreative, project: { name: 'Boss Pizzaria' } });
  assert.doesNotMatch(promptWithoutLearnings, /APRENDIZADOS DE CONTEÚDOS ANTERIORES/i);
});

test('buildCarouselOutlinePrompt embeds the briefing, the requested slide count, and the instagram-feed.md formats reference verbatim', () => {
  const prompt = buildCarouselOutlinePrompt({
    project: { name: 'Boss Pizzaria', brandInput: { segment: 'Pizzaria' } },
    briefing: '5 dicas de pizza',
    slideCount: 5,
    formatsReference: 'CONTEUDO-DE-REFERENCIA-UNICO-12345',
  });

  assert.match(prompt, /5 dicas de pizza/);
  assert.match(prompt, /exatamente 5 slides/);
  assert.match(prompt, /CONTEUDO-DE-REFERENCIA-UNICO-12345/);
  assert.match(prompt, /Boss Pizzaria/);
  assert.match(prompt, /"format"/);
  assert.match(prompt, /"slideText"/);
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
  assert.equal(openAiImageSizeForChannel('whatsapp_status'), '1024x1536');
});

test('xAI aspect ratio chosen per channel is a supported grok-imagine-image value', () => {
  assert.equal(xaiAspectRatioForChannel('instagram_story'), '9:16');
  assert.equal(xaiAspectRatioForChannel('instagram_reels'), '9:16');
  assert.equal(xaiAspectRatioForChannel('instagram_feed'), '3:4');
  assert.equal(xaiAspectRatioForChannel('facebook_story'), '9:16');
  assert.equal(xaiAspectRatioForChannel('facebook_feed'), '3:4');
  assert.equal(xaiAspectRatioForChannel('whatsapp_status'), '9:16');
  assert.equal(xaiAspectRatioForChannel('unknown_channel'), '1:1');
});

test('Nous/FAL aspect ratio chosen per channel is a supported preset keyword', () => {
  assert.equal(nousFalAspectRatioForChannel('instagram_story'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('instagram_reels'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('instagram_feed'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('facebook_story'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('facebook_feed'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('whatsapp_status'), 'portrait');
  assert.equal(nousFalAspectRatioForChannel('unknown_channel'), 'square');
});

test('selectImageReferencesForCodex forwards a layout_model reference alongside brand_asset/product_photo (Codex/Codex-agent have headroom for it)', () => {
  const brand = { role: 'brand_asset', absolutePath: '/brand.png' };
  const product1 = { role: 'product_photo', absolutePath: '/product1.png' };
  const product2 = { role: 'product_photo', absolutePath: '/product2.png' };
  const product3 = { role: 'product_photo', absolutePath: '/product3.png' };
  const layout = { role: 'layout_model', absolutePath: '/layout.png' };

  const selected = selectImageReferencesForCodex([brand, product1, product2, product3, layout]);

  assert.deepEqual(selected, [brand, product1, product2, layout]);
});

test('selectImageReferencesForCodex still returns an empty list when there are no references at all', () => {
  assert.deepEqual(selectImageReferencesForCodex([]), []);
});

test('selectOpenAiImageEditReferences reserves a slot for the layout reference instead of letting a well-configured project\'s own 4+ references push it out by array position under the 4-image cap', () => {
  const logo = { role: 'brand_asset', absolutePath: '/logo.png' };
  const photos = ['/p1.png', '/p2.png', '/p3.png', '/p4.png'].map((absolutePath) => ({ role: 'product_photo', absolutePath }));
  const layout = { role: 'layout_model', absolutePath: '/layout.png' };
  // Mirrors buildImageReferencePayload's real order: project's own
  // references first, layout reference appended last.
  const references = [logo, ...photos, layout];

  const selected = selectOpenAiImageEditReferences(references, 4);

  assert.equal(selected.length, 4);
  assert.ok(selected.includes(layout), 'the layout reference must not be dropped just because it is last in array order');
  assert.deepEqual(selected, [logo, photos[0], photos[1], layout]);
});

test('selectOpenAiImageEditReferences never returns a layout reference alone — it must not become the sole/leading image for /v1/images/edits', () => {
  const layout = { role: 'layout_model', absolutePath: '/layout.png' };

  assert.deepEqual(selectOpenAiImageEditReferences([layout], 4), []);
  assert.deepEqual(selectOpenAiImageEditReferences([layout, layout], 4), []);
});

test('selectOpenAiImageEditReferences keeps a layout reference when at least one real project reference is present', () => {
  const logo = { role: 'brand_asset', absolutePath: '/logo.png' };
  const layout = { role: 'layout_model', absolutePath: '/layout.png' };

  assert.deepEqual(selectOpenAiImageEditReferences([logo, layout], 4), [logo, layout]);
});

test('image reference selectors reserve two layout_model slots without allowing them to become edit canvases alone', () => {
  const logo = { role: 'brand_asset', absolutePath: '/logo.png' };
  const layoutCreative = { role: 'layout_model', absolutePath: '/creative.png' };
  const layoutProduct = { role: 'layout_model', absolutePath: '/product.png' };

  assert.deepEqual(selectOpenAiImageEditReferences([layoutCreative, layoutProduct], 4), []);
  assert.deepEqual(
    selectOpenAiImageEditReferences([logo, layoutCreative, layoutProduct], 4),
    [logo, layoutCreative, layoutProduct]
  );
  assert.deepEqual(
    selectImageReferencesForCodex([logo, layoutCreative, layoutProduct]),
    [logo, layoutCreative, layoutProduct]
  );
});

test('selectOpenAiImageEditReferences never lets the additive segment product reference evict a real primary reference (logo + 2 real product photos survive intact)', () => {
  const logo = { role: 'brand_asset', absolutePath: '/logo.png' };
  const product1 = { role: 'product_photo', absolutePath: '/product1.png' };
  const product2 = { role: 'product_photo', absolutePath: '/product2.png' };
  const layoutCreative = { role: 'layout_model', absolutePath: '/creative.png' };
  const layoutProduct = { role: 'layout_model', absolutePath: '/product-ref.png' };

  const selected = selectOpenAiImageEditReferences([logo, product1, product2, layoutCreative, layoutProduct], 4);

  assert.equal(selected.length, 4);
  assert.ok(selected.includes(product1), 'a real product photo must never be dropped for the generic segment product reference');
  assert.ok(selected.includes(product2), 'a real product photo must never be dropped for the generic segment product reference');
  assert.ok(selected.includes(layoutCreative), 'the structure reference always wins the single remaining layout slot');
  assert.ok(!selected.includes(layoutProduct), 'the generic segment product reference is the one dropped, not either real product photo');
});

test('selectOpenAiImageEditReferences at the 3-slot targeted-edit capacity keeps the real product photo and drops the segment product reference', () => {
  const logo = { role: 'brand_asset', absolutePath: '/logo.png' };
  const product = { role: 'product_photo', absolutePath: '/product.png' };
  const layoutCreative = { role: 'layout_model', absolutePath: '/creative.png' };
  const layoutProduct = { role: 'layout_model', absolutePath: '/product-ref.png' };

  const selected = selectOpenAiImageEditReferences([logo, product, layoutCreative, layoutProduct], 3);

  assert.equal(selected.length, 3);
  assert.deepEqual(selected, [logo, product, layoutCreative]);
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

test('cropOpenAiImageToChannel fills the target frame edge-to-edge instead of masking a wrong canvas with blurred letterbox bars', async () => {
  const { Jimp, intToRGBA } = await import('jimp');
  const width = 1024;
  const height = 1536;
  const source = new Jimp({ width, height, color: 0xff0000ff });
  const edgeMarker = 0x00ff00ff;
  for (let x = 0; x < width; x += 1) source.setPixelColor(edgeMarker, x, 0);
  const sourceBuffer = await source.getBuffer('image/png');

  // Filling 4:5 from this taller source crops the unsafe outer edge. The old
  // blurred-letterbox path preserved/blurred the green marker into the final
  // canvas and hid the fact that the provider returned the wrong shape.
  const feedBuffer = await cropOpenAiImageToChannel(sourceBuffer, { width: 1080, height: 1350 });
  const feedImage = await Jimp.read(feedBuffer);
  const topPixel = intToRGBA(feedImage.getPixelColor(540, 0));
  assert.ok(topPixel.r > topPixel.g, `expected edge-to-edge cover crop with no green blur bar; got rgba=${JSON.stringify(topPixel)}`);
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

test('cropCircularAvatar cuts a real square crop out of a screenshot and zeroes the alpha outside the circle', async () => {
  const { Jimp } = await import('jimp');
  // A 400x400 solid-blue "screenshot" — the avatar box asks for the middle
  // 50% square (100,100 to 300,300).
  const screenshot = new Jimp({ width: 400, height: 400, color: 0x3388ffff });
  const buffer = await screenshot.getBuffer('image/png');

  const dataUrl = await cropCircularAvatar(buffer, { xPct: 25, yPct: 25, sizePct: 50 });
  assert.ok(dataUrl.startsWith('data:image/png;base64,'));

  const pngBuffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  const cropped = await Jimp.read(pngBuffer);
  assert.equal(cropped.bitmap.width, 200);
  assert.equal(cropped.bitmap.height, 200);

  const centerIdx = (100 * 200 + 100) * 4;
  assert.equal(cropped.bitmap.data[centerIdx + 3], 255, 'center of the circle must stay fully opaque');
  assert.equal(cropped.bitmap.data[centerIdx], 0x33, 'center pixel must keep the real screenshot color, not a guessed one');

  const cornerIdx = (0 * 200 + 0) * 4;
  assert.equal(cropped.bitmap.data[cornerIdx + 3], 0, 'corners outside the circle must be fully transparent');
});

test('cropCircularAvatar returns null instead of guessing when there is no box or the box falls outside the image', async () => {
  const { Jimp } = await import('jimp');
  const screenshot = new Jimp({ width: 400, height: 400, color: 0x3388ffff });
  const buffer = await screenshot.getBuffer('image/png');

  assert.equal(await cropCircularAvatar(buffer, null), null);
  assert.equal(await cropCircularAvatar(buffer, { xPct: 80, yPct: 80, sizePct: 50 }), null, 'a box that runs past the image edge must not be silently clamped');
});

const FAKE_PROSPECT_EXTRACTION = {
  businessName: 'Empório Rei da Mussarela',
  handle: '@emporioreidamussarela',
  nicheGuess: 'delivery de frios e laticínios',
  bioText: 'Serviço de entrega de comida. Loja de frios e Fatiados.',
  differentiators: ['Qualidade e preço justo', 'O melhor preço de Cuiabá'],
  realFollowers: 4388,
  realPosts: 20,
  realFollowing: 35,
  avatarCrop: { xPct: 25, yPct: 25, sizePct: 50 },
};

test('POST /api/prospects reads a real profile screenshot end to end: creates a manual-mode isProspect project pre-filled with the real facts, and saves the cropped avatar as the logo', async () => {
  const { Jimp } = await import('jimp');
  // Same injection pattern as every other AI feature in this file
  // (imageGenerator, webResearcher, siteAnalyzer...) — the real
  // prospectScreenshotAnalyzer runs `hermes chat --image`, a real
  // subprocess call with no mocking seam, so tests inject a fake one here
  // exactly like startContentCentralServer already lets an operator inject
  // any of the others.
  const analyzerCalls = [];
  await withServer(async (dir, server) => {
    const screenshot = new Jimp({ width: 400, height: 400, color: 0xdc2626ff });
    const dataUrl = `data:image/png;base64,${(await screenshot.getBuffer('image/png')).toString('base64')}`;

    const { response, body } = await request(server, '/api/prospects', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    assert.equal(response.status, 201);

    assert.equal(body.project.isProspect, true);
    assert.equal(body.project.mode, 'manual', 'a prospect must never auto-publish');
    assert.equal(body.project.name, 'Empório Rei da Mussarela');
    assert.deepEqual(body.project.prospectSource, {
      handle: '@emporioreidamussarela',
      bio: 'Serviço de entrega de comida. Loja de frios e Fatiados.',
      realFollowers: 4388,
      realPosts: 20,
      realFollowing: 35,
    });
    assert.equal(body.extracted.nicheGuess, 'delivery de frios e laticínios');

    // The cropped avatar really landed on disk as the project's logo.
    assert.match(body.project.brand.logoPath, /^assets\/logo\.png$/);
    const logoPath = join(dir, '_opensquad', 'content-central', 'projects', body.project.projectId, 'assets', 'logo.png');
    assert.ok(existsSync(logoPath), 'expected the cropped avatar to be saved as the real logo file');
    const savedLogo = await Jimp.read(logoPath);
    assert.equal(savedLogo.bitmap.width, 200);
    assert.equal(savedLogo.bitmap.height, 200);

    const { body: state } = await request(server, '/api/state');
    const listed = state.projects.find((p) => p.projectId === body.project.projectId);
    assert.equal(listed.isProspect, true, 'must still be flagged as a prospect through the real project list, not just the create response');
  }, {
    prospectScreenshotAnalyzer: async (payload) => {
      analyzerCalls.push(payload);
      return FAKE_PROSPECT_EXTRACTION;
    },
  });
  assert.equal(analyzerCalls.length, 1);
  assert.ok(Buffer.isBuffer(analyzerCalls[0].buffer), 'the real uploaded screenshot bytes must reach the analyzer');
  assert.equal(analyzerCalls[0].mimeType, 'image/png');
});

test('POST /api/prospects still creates the project with no analyzer configured (enableAiImages off, the default), with blank fields instead of failing the request', async () => {
  const { Jimp } = await import('jimp');
  await withServer(async (_dir, server) => {
    const screenshot = new Jimp({ width: 400, height: 400, color: 0xdc2626ff });
    const dataUrl = `data:image/png;base64,${(await screenshot.getBuffer('image/png')).toString('base64')}`;

    const { response, body } = await request(server, '/api/prospects', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    assert.equal(response.status, 201);
    assert.equal(body.extracted, null);
    assert.equal(body.project.isProspect, true);
    // Still the normalized shape (same convention as normalizeLearnings/
    // normalizeCompanyProfile elsewhere) — every field null instead of
    // fabricating a value, but never a bare null for the whole object.
    assert.deepEqual(body.project.prospectSource, { handle: null, bio: null, realFollowers: null, realPosts: null, realFollowing: null });
    assert.match(body.project.name, /^Nova prospecção \d+$/);
  });
});

test('POST /api/prospects still creates the project when the injected analyzer throws, instead of failing the request', async () => {
  const { Jimp } = await import('jimp');
  await withServer(async (_dir, server) => {
    const screenshot = new Jimp({ width: 400, height: 400, color: 0xdc2626ff });
    const dataUrl = `data:image/png;base64,${(await screenshot.getBuffer('image/png')).toString('base64')}`;

    const { response, body } = await request(server, '/api/prospects', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    assert.equal(response.status, 201);
    assert.equal(body.extracted, null);
    assert.equal(body.project.isProspect, true);
  }, {
    prospectScreenshotAnalyzer: async () => { throw new Error('hermes chat failed'); },
  });
});

test('GET prospect-mockup renders the real profile counts/bio from prospectSource (never invented) with the freshly generated posts in a real Instagram-profile layout', async () => {
  const { Jimp } = await import('jimp');
  await withServer(async (_dir, server) => {
    const screenshot = new Jimp({ width: 400, height: 400, color: 0xdc2626ff });
    const dataUrl = `data:image/png;base64,${(await screenshot.getBuffer('image/png')).toString('base64')}`;
    const { body: created } = await request(server, '/api/prospects', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    const projectId = created.project.projectId;

    await request(server, `/api/projects/${projectId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-08-10', channel: 'instagram_feed' }),
    });
    await request(server, `/api/projects/${projectId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-08-10', channel: 'instagram_story' }),
    });

    const response = await fetch(`${server.url}/api/projects/${projectId}/prospect-mockup`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.ok(html.includes('4.388'), 'must quote the real follower count exactly as the screenshot showed it');
    assert.ok(html.includes('20'), 'real post count');
    assert.ok(html.includes('35'), 'real following count');
    assert.ok(html.includes('Serviço de entrega de comida. Loja de frios e Fatiados.'), 'must quote the real bio verbatim');
    assert.ok(html.includes('Empório Rei da Mussarela'));
    assert.ok(html.includes('onclick="window.print()"'));
    assert.match(html, /class="ig-grid"/, 'the generated feed posts must render as a real profile grid, not a linear card list');
    assert.match(html, /class="ig-highlights"/);
    assert.match(
      html,
      new RegExp(`<img src="/api/projects/${projectId}/assets/assets/logo\\.png" alt="Foto de perfil">`),
      'a real cropped avatar must render as a real <img>, not the fallback initial',
    );
  }, {
    prospectScreenshotAnalyzer: async () => FAKE_PROSPECT_EXTRACTION,
  });
});

test('GET /api/segment-templates lists nothing before any template is registered, then the real registered ones', async () => {
  await withServer(async (dir, server) => {
    const empty = await request(server, '/api/segment-templates');
    assert.equal(empty.response.status, 200);
    assert.deepEqual(empty.body.templates, []);

    const source = join(dir, 'source.png');
    await writeFile(source, Buffer.from('89504e470d0a1a0a', 'hex'));
    await registerSegmentTemplate('embalagens', {
      label: 'Embalagens',
      pieces: [{ key: 'sell-products', label: 'Venda direta', channel: 'instagram_feed', angleNote: 'atacado e varejo', sourceImagePath: source }],
    }, dir);

    const { response, body } = await request(server, '/api/segment-templates');
    assert.equal(response.status, 200);
    assert.deepEqual(body.templates, [{
      segmentId: 'embalagens',
      label: 'Embalagens',
      pieceCount: 1,
      pieces: [{ key: 'sell-products', label: 'Venda direta', channel: 'instagram_feed', imagePath: 'images/sell-products.png' }],
    }]);
  });
});

test('GET /api/segment-templates/:id/images/:file serves the real registered art directly, with path traversal rejected', async () => {
  await withServer(async (dir, server) => {
    const source = join(dir, 'source.png');
    const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');
    await writeFile(source, pngBytes);
    await registerSegmentTemplate('embalagens', {
      label: 'Embalagens',
      pieces: [{ key: 'sell-products', label: 'Venda direta', channel: 'instagram_feed', angleNote: 'atacado e varejo', sourceImagePath: source }],
    }, dir);

    // Binary image response — bypasses the request() helper above, which
    // always tries to JSON-parse the body.
    const served = await fetch(`${server.url}/api/segment-templates/embalagens/images/sell-products.png`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), pngBytes);

    const missing = await fetch(`${server.url}/api/segment-templates/embalagens/images/nao-existe.png`);
    assert.equal(missing.status, 404);

    const traversal = await fetch(`${server.url}/api/segment-templates/embalagens/images/..%2F..%2Ftemplate.json`);
    assert.equal(traversal.status, 404);
  });
});

test('root-level segment-learnings and offer-type-learnings routes work with no project in the URL', async () => {
  await withServer(async (_dir, server) => {
    const analyzeResponse = await request(server, '/api/segment-learnings/analyze-image', {
      method: 'POST',
      body: JSON.stringify({
        scope: 'segment',
        groupKey: 'group:alimenticio/category:pizzaria',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        filename: 'teste.png',
      }),
    });
    // enableAiImages is off by default in tests, matches every sibling AI route's behavior
    assert.equal(analyzeResponse.response.status, 501);

    const offerTypesResponse = await request(server, '/api/offer-type-learnings');
    assert.equal(offerTypesResponse.response.status, 200);
    assert.ok(Array.isArray(offerTypesResponse.body.types));
    assert.ok(offerTypesResponse.body.types.length >= 10);
    assert.ok(offerTypesResponse.body.types.some((entry) => entry.type === 'service'));

    const saveResponse = await request(server, '/api/offer-type-learnings', {
      method: 'POST',
      body: JSON.stringify({ type: 'combo', baseInstruction: 'Combo: sempre mostrar caixa aberta.' }),
    });
    assert.equal(saveResponse.response.status, 200);
    assert.equal(saveResponse.body.baseInstruction, 'Combo: sempre mostrar caixa aberta.');
  });
});

test('GET /api/learning-assets/:path serves an uploaded learning reference image, with missing/traversal cases rejected', async () => {
  const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const dataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`;

  await withServer(
    async (_dir, server) => {
      const analyzeResponse = await request(server, '/api/segment-learnings/analyze-image', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'segment',
          groupKey: 'group:alimenticio/category:pizzaria',
          dataUrl,
          filename: 'teste.png',
        }),
      });
      assert.equal(analyzeResponse.response.status, 200);
      const { imagePath } = analyzeResponse.body;
      assert.ok(imagePath);

      // Binary image response — bypasses the request() helper above, which
      // always tries to JSON-parse the body.
      const served = await fetch(`${server.url}/api/learning-assets/${imagePath.split('/').map(encodeURIComponent).join('/')}`);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), pngBytes);

      const missing = await fetch(`${server.url}/api/learning-assets/segment/nao-existe/nao-existe.png`);
      assert.equal(missing.status, 404);

      // A sibling directory sharing the "learning" prefix string
      // (.../assets/learning-evil/) — the exact CWE-22 partial-path-prefix
      // shape the guard was fixed for. A plain filePath.startsWith(root)
      // check would have passed this straight through to readFile (a 404,
      // since the file doesn't exist); the fixed root+sep guard rejects it
      // with 400 before ever reaching the filesystem.
      const traversal = await fetch(`${server.url}/api/learning-assets/..%2Flearning-evil%2Fsecret`);
      assert.equal(traversal.status, 400);
    },
    { learningImageAnalyzer: async () => 'Referência de pizza com massa dourada.' },
  );
});

test('POST /api/projects/:id/adapt-segment-template adapts a registered template into real content items through the real endpoint, instead of generating from scratch', async () => {
  await withServer(async (dir, server) => {
    const source = join(dir, 'source.png');
    await writeFile(source, Buffer.from('89504e470d0a1a0a', 'hex'));
    await registerSegmentTemplate('embalagens', {
      label: 'Embalagens',
      pieces: [
        { key: 'sell-products', label: 'Venda direta', channel: 'instagram_feed', angleNote: 'atacado e varejo', sourceImagePath: source },
        { key: 'produtos', label: 'Destaque Produtos', channel: 'instagram_story', angleNote: 'vitrine', sourceImagePath: source },
      ],
    }, dir);

    const { body: created } = await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'prospect-adapt', name: 'Prospect Adapt', isProspect: true }),
    });
    const projectId = created.project.projectId;
    await updateProjectBrandInput(projectId, { segmentGroup: 'Embalagens', segmentCategory: 'Casa de Embalagem' }, dir);
    await registerCreativeTemplate('group:embalagens/category:casa-de-embalagem', 'offer', 'feed', dir);
    await registerCreativeTemplate('group:embalagens/category:casa-de-embalagem', 'offer', 'vertical', dir);

    const { response, body } = await request(server, `/api/projects/${projectId}/adapt-segment-template`, {
      method: 'POST',
      body: JSON.stringify({ segmentId: 'embalagens' }),
    });
    assert.equal(response.status, 202);
    assert.equal(body.queued, true);

    for (let i = 0; i < 50; i += 1) {
      const { body: contentBody } = await request(server, `/api/projects/${projectId}/content`);
      if (contentBody.content.length === 2 && contentBody.content.every((item) => !item.image.generating)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }

    const { body: finalContent } = await request(server, `/api/projects/${projectId}/content`);
    assert.equal(finalContent.content.length, 2);
    assert.deepEqual(finalContent.content.map((item) => item.channel).sort(), ['instagram_feed', 'instagram_story']);
    assert.ok(finalContent.content.every((item) => item.image.generatedSource === 'ai'));
    assert.ok(finalContent.content.every((item) => item.imageGenerationError === null));
  }, {
    imageGenerator: async (payload) => ({ url: `https://cdn.example.com/adapted-${payload.content.contentTopic.id}.png`, mimeType: 'image/png' }),
  });
});

test('POST /api/projects/:id/adapt-segment-template rejects a missing segmentId instead of queueing nothing silently', async () => {
  await withServer(async (dir, server) => {
    const { body: created } = await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'prospect-sem-segmento', name: 'Prospect Sem Segmento' }),
    });
    const { response, body } = await request(server, `/api/projects/${created.project.projectId}/adapt-segment-template`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    assert.match(body.error, /segmentId/);
  }, {
    imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
  });
});

test('POST /api/projects/:id/duplicate creates a new project with the source Raio-X through the real endpoint', async () => {
  await withServer(async (dir, server) => {
    const { body: created } = await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'origem-dup', name: 'Origem Dup', handle: '@origemdup' }),
    });
    await updateProjectBrandInput(created.project.projectId, { segmentGroup: 'Alimentício' }, dir);
    await saveProjectOffer(created.project.projectId, { name: 'Combo Família', type: 'offer', price: 'R$ 79,90' }, dir);

    const { response, body } = await request(server, `/api/projects/${created.project.projectId}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ projectId: 'copia-dup', name: 'Cópia Dup' }),
    });

    assert.equal(response.status, 201);
    assert.equal(body.project.projectId, 'copia-dup');
    assert.equal(body.project.name, 'Cópia Dup');
    assert.equal(body.project.instagram.handle, '');
    assert.equal(body.project.contentStrategy.offers[0].name, 'Combo Família');
  });
});

test('commercial catalog routes: create, list, and delete a catalog item through the real endpoints', async () => {
  await withServer(async (dir, server) => {
    const { response: createResponse, body: created } = await request(server, '/api/commercial/catalog', {
      method: 'POST',
      body: JSON.stringify({ category: 'Criação de Conteúdo', name: 'Profissional', billingType: 'mensal', price: 497 }),
    });
    assert.equal(createResponse.status, 200);
    assert.equal(created.item.id, 'profissional');

    const { body: listed } = await request(server, '/api/commercial/catalog');
    assert.equal(listed.items.length, 1);

    const { response: deleteResponse, body: deleted } = await request(server, '/api/commercial/catalog/profissional/delete', { method: 'POST' });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(deleted, { id: 'profissional', deleted: true });

    const { body: listedAfter } = await request(server, '/api/commercial/catalog');
    assert.equal(listedAfter.items.length, 0);
  });
});

test('commercial agency routes: save identity, upload logo, and serve it back through /api/commercial/assets', async () => {
  await withServer(async (dir, server) => {
    const { body: saved } = await request(server, '/api/commercial/agency', {
      method: 'POST',
      body: JSON.stringify({ name: 'King Assessoria de Mkt', contactPhone: '', contactInstagram: '@king' }),
    });
    assert.equal(saved.agency.name, 'King Assessoria de Mkt');

    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const { body: withLogo } = await request(server, '/api/commercial/agency/logo', {
      method: 'POST',
      body: JSON.stringify({ filename: 'logo.png', dataUrl: pngDataUrl }),
    });
    assert.equal(withLogo.agency.logoPath, 'logo.png');

    const assetResponse = await fetch(`${server.url}/api/commercial/assets/logo.png`);
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get('content-type'), 'image/png');

    const { body: fetched } = await request(server, '/api/commercial/agency');
    assert.equal(fetched.agency.name, 'King Assessoria de Mkt');
    assert.equal(fetched.agency.logoPath, 'logo.png');
  });
});

test('commercial proposal routes: save, list, reopen, and delete a proposal through the real endpoints', async () => {
  await withServer(async (dir, server) => {
    const { response: createResponse, body: created } = await request(server, '/api/commercial/proposals', {
      method: 'POST',
      body: JSON.stringify({
        clientName: 'Arthur Frios',
        sections: [{ category: 'Criação de Conteúdo', mode: 'single', items: [{ name: 'Profissional', billingType: 'mensal', price: 497 }] }],
      }),
    });
    assert.equal(createResponse.status, 201);
    assert.ok(created.proposal.id.startsWith('prop-'));

    const { body: listed } = await request(server, '/api/commercial/proposals');
    assert.equal(listed.proposals.length, 1);
    assert.equal(listed.proposals[0].clientName, 'Arthur Frios');

    const { body: fetched } = await request(server, `/api/commercial/proposals/${created.proposal.id}`);
    assert.equal(fetched.proposal.clientName, 'Arthur Frios');

    const { body: deleted } = await request(server, `/api/commercial/proposals/${created.proposal.id}/delete`, { method: 'POST' });
    assert.deepEqual(deleted, { id: created.proposal.id, deleted: true });

    const { body: listedAfter } = await request(server, '/api/commercial/proposals');
    assert.equal(listedAfter.proposals.length, 0);
  });
});

test('commercial process routes: save and list a process text per category through the real endpoints', async () => {
  await withServer(async (dir, server) => {
    const { response: createResponse, body: created } = await request(server, '/api/commercial/processes', {
      method: 'POST',
      body: JSON.stringify({ category: 'Criação de Conteúdo', text: 'Cada peça sob medida.' }),
    });
    assert.equal(createResponse.status, 200);
    assert.equal(created.process.category, 'Criação de Conteúdo');

    const { body: listed } = await request(server, '/api/commercial/processes');
    assert.equal(listed.processes.length, 1);
    assert.equal(listed.processes[0].text, 'Cada peça sob medida.');
  });
});

test('commercial portfolio routes: create, list, and delete an item through the real endpoints', async () => {
  await withServer(async (dir, server) => {
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const { response: createResponse, body: created } = await request(server, '/api/commercial/portfolio', {
      method: 'POST',
      body: JSON.stringify({ category: 'Criação de Conteúdo', caption: 'Post de lançamento', filename: 'arte.png', dataUrl: pngDataUrl }),
    });
    assert.equal(createResponse.status, 201);
    assert.ok(created.item.id);

    const assetResponse = await fetch(`${server.url}/api/commercial/assets/${created.item.imagePath}`);
    assert.equal(assetResponse.status, 200);

    const { body: listed } = await request(server, '/api/commercial/portfolio');
    assert.equal(listed.items.length, 1);

    const { body: deleted } = await request(server, `/api/commercial/portfolio/${created.item.id}/delete`, { method: 'POST' });
    assert.deepEqual(deleted, { id: created.item.id, deleted: true });

    const { body: listedAfter } = await request(server, '/api/commercial/portfolio');
    assert.equal(listedAfter.items.length, 0);
  });
});

test('commercial prospeccao routes: create, list, update via upsert, and delete a prospect through the real endpoints', async () => {
  await withServer(async (dir, server) => {
    const { response: createResponse, body: created } = await request(server, '/api/commercial/prospeccao', {
      method: 'POST',
      body: JSON.stringify({ name: 'Padaria Bom Pão', googleMapsUrl: 'https://maps.google.com/x', instagram: '@padariabompao', phone: '11999990000' }),
    });
    assert.equal(createResponse.status, 200);
    assert.ok(created.item.id);
    assert.equal(created.item.status, 'nao_contatado');

    const { body: listed } = await request(server, '/api/commercial/prospeccao');
    assert.equal(listed.items.length, 1);

    const { body: updated } = await request(server, '/api/commercial/prospeccao', {
      method: 'POST',
      body: JSON.stringify({ ...created.item, status: 'contatado' }),
    });
    assert.equal(updated.item.id, created.item.id);
    assert.equal(updated.item.status, 'contatado');

    const { body: listedAfterUpdate } = await request(server, '/api/commercial/prospeccao');
    assert.equal(listedAfterUpdate.items.length, 1);
    assert.equal(listedAfterUpdate.items[0].status, 'contatado');

    const { body: deleted } = await request(server, `/api/commercial/prospeccao/${created.item.id}/delete`, { method: 'POST' });
    assert.deepEqual(deleted, { id: created.item.id, deleted: true });

    const { body: listedAfterDelete } = await request(server, '/api/commercial/prospeccao');
    assert.equal(listedAfterDelete.items.length, 0);
  });
});

test('GET prospect-mockup never fabricates a stat it does not have — shows "—" instead of 0 when the vision read came back empty, and never shows a broken-image avatar when no crop was saved', async () => {
  await withServer(async (dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'prospect-vazio', name: 'Prospect Vazio', isProspect: true }),
    });

    const response = await fetch(`${server.url}/api/projects/prospect-vazio/prospect-mockup`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('—'), 'missing stats must render as an explicit unknown marker, never 0');
    // brand.logoPath defaults to 'assets/logo.png' at creation regardless of
    // whether a file actually exists there — the mockup must not render an
    // <img> against that default path when no avatar was ever saved.
    assert.ok(!html.includes('<img src="/api/projects/prospect-vazio/assets/'), 'must not render a broken-image <img> for a logo path that was never actually saved');
    assert.match(html, /class="ig-profile-avatar-fallback"/, 'must fall back to the initial-letter bubble instead');
  });
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
    assert.ok(html.includes('Imagem e identidade visual'));
    assert.ok(html.includes('id="referenceGallery"'));
    assert.ok(html.includes('id="referenceInstruction"'));
    assert.ok(html.includes('O Raio-X fornece o contexto estratégico'));
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
    assert.ok(html.includes('Direção visual dos criativos'));
    assert.ok(html.includes('id="imageRules"'));
    assert.ok(html.includes('Regras técnicas extras para o ChatGPT'));
    assert.ok(!html.includes('Regras técnicas extras para o Grok'));
    assert.ok(html.includes('Salvar direção visual'));
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
    assert.ok(html.includes('Aprovar estratégia da marca'));
    assert.ok(html.includes('id="brandXrayBlocks"'));
    assert.ok(html.includes('brand-xray-grid'));
    assert.ok(html.includes('brand-xray-card'));
    assert.ok(html.includes('autoGrowTextareas'));
    assert.ok(html.includes('Revise a estratégia sugerida'));
    assert.ok(!html.includes("const ids=['summary','communication','contentStrategy','visualIdentity']"));
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
    assert.ok(html.includes('Direção visual dos criativos'));
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

    // A hard navigation (e.g. opening the proposal print view in a new tab)
    // hits the server directly for whatever client-side route it lands on —
    // any top-level route not under /api/ must fall back to the SPA shell,
    // not just the prefixes the server happened to allow-list explicitly.
    const comercialRoute = await fetch(`${server.url}/comercial/propostas/prop-123/imprimir`);
    assert.equal(comercialRoute.status, 200);
    assert.ok((await comercialRoute.text()).includes('<div id="root">'));

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

test('POST generate forwards carouselsPerWeek and maxCarouselSlides through to the batch', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'carrossel-http-config', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }),
    });
    const { body, response } = await request(server, '/api/projects/carrossel-http-config/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 7,
        startDate: '2026-08-24',
        formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
        carouselsPerWeek: 2,
        maxCarouselSlides: 4,
      }),
    });
    assert.equal(response.status, 201);
    assert.equal(body.batch.carouselsPerWeek, 2);
    assert.equal(body.batch.maxCarouselSlides, 4);
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

test('content central API surfaces a topic-idea fallback alert in /api/state', async () => {
  await withServer(async (dir, server) => {
    await createCentralProject({ projectId: 'alerta-assuntos', name: 'Alerta Assuntos' }, dir);
    await updateProjectBrandInput('alerta-assuntos', {
      brandName: 'Alerta Assuntos',
      segment: 'consultoria',
      productsOrServices: 'diagnóstico estratégico',
      contentGoals: ['authority'],
    }, dir);

    await request(server, '/api/projects/alerta-assuntos/topic-ideas-refresh', { method: 'POST' });

    const state = await request(server, '/api/state');
    const alert = state.body.alerts.find((a) => a.projectId === 'alerta-assuntos');
    assert.ok(alert);
    assert.equal(alert.type, 'topic_ideas_fallback');
    assert.match(alert.message, /fallback baseado no Raio-X/);
  }, { topicIdeaGenerator: async () => { throw new Error('web off'); } });
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
      await updateProjectBrandInput('grupo-web', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
      await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'vertical', dir);
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

test('POST .../approve upserts the queue item into the configured gaveta', async () => {
  await withGaveta(async ({ workDir, bareDir }) => {
    process.env.OPENSQUAD_GAVETA_DIR = workDir;
    try {
      await withServer(async (dir, server) => {
        const { contentId } = await createApprovedItem(server, dir, 'gaveta-approve-route');

        const checkDir = `${workDir}-check`;
        await execFileAsync('git', ['clone', bareDir, checkDir]);
        const raw = JSON.parse(await readFile(join(checkDir, 'queue', 'gaveta-approve-route', `${contentId}.json`), 'utf-8'));
        assert.equal(raw.publish.realPublished, false);
        await rm(checkDir, { recursive: true, force: true });
      });
    } finally {
      delete process.env.OPENSQUAD_GAVETA_DIR;
    }
  });
});

test('GET .../briefing renders a carousel item as every slide stacked with its role label, not a blank card', async () => {
  await withServer(async (dir, server) => {
    await createCentralProject({ projectId: 'briefing-carrossel', name: 'Boss Pizzaria' }, dir);
    const batch = await generateContentSchedulePlan('briefing-carrossel', {
      days: 2,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      carouselsPerWeek: 1,
      maxCarouselSlides: 3,
    }, dir);
    const carouselItem = batch.items.find((item) => item.format === 'carousel');
    assert.ok(carouselItem);

    // Give each slide a distinguishable image + role, the shape
    // runCarouselGeneration produces once the roteiro lands.
    const roles = ['cover', 'content', 'cta'];
    carouselItem.slides.forEach((slide, index) => {
      slide.role = roles[index];
      slide.image.generating = false;
      slide.image.url = `https://cdn.example.com/slide-${index + 1}.png`;
    });
    await writeFile(carouselItem.filePath, JSON.stringify(carouselItem, null, 2), 'utf-8');

    const res = await realFetch(`${server.url}/api/projects/briefing-carrossel/briefing`);
    const html = await res.text();
    assert.equal(res.status, 200);

    for (const index of [1, 2, 3]) {
      assert.ok(html.includes(`https://cdn.example.com/slide-${index}.png`), `slide ${index} must be embedded in the presentation page`);
    }
    assert.match(html, /1\. Capa/);
    assert.match(html, /2\. Conteúdo/);
    assert.match(html, /3\. CTA/);
    // Slides render in order.
    assert.ok(html.indexOf('slide-1.png') < html.indexOf('slide-2.png'));
    assert.ok(html.indexOf('slide-2.png') < html.indexOf('slide-3.png'));
  });
});

test('POST .../approve does NOT upsert a carousel item into the gaveta (that queue only understands single-image Meta publishing)', async () => {
  await withGaveta(async ({ workDir, bareDir }) => {
    process.env.OPENSQUAD_GAVETA_DIR = workDir;
    try {
      await withServer(async (dir, server) => {
        await createCentralProject({ projectId: 'gaveta-carrossel', name: 'Gaveta Carrossel' }, dir);
        // One carousel day plus a normal single-image day — the second is
        // the control that proves the skip is targeted and did not just
        // break queueing for everything.
        const batch = await generateContentSchedulePlan('gaveta-carrossel', {
          days: 2,
          startDate: '2026-08-10',
          formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '18:00', intervalMinutes: 0 }],
          carouselsPerWeek: 1,
          maxCarouselSlides: 2,
        }, dir);
        const carouselItem = batch.items.find((item) => item.format === 'carousel');
        const singleItem = batch.items.find((item) => item.format !== 'carousel');
        assert.ok(carouselItem && singleItem, 'fixture must contain one of each');

        for (const item of [carouselItem, singleItem]) {
          const approved = await request(server, `/api/projects/gaveta-carrossel/content/${item.contentId}/approve`, { method: 'POST' });
          assert.equal(approved.response.status, 200);
        }

        const checkDir = `${workDir}-check`;
        await execFileAsync('git', ['clone', bareDir, checkDir]);
        const queueDir = join(checkDir, 'queue', 'gaveta-carrossel');
        assert.equal(existsSync(join(queueDir, `${carouselItem.contentId}.json`)), false, 'a carousel has no top-level image — queued it would retry a broken mediaUrl:null upload forever');
        assert.equal(existsSync(join(queueDir, `${singleItem.contentId}.json`)), true, 'a normal single-image item must still be queued exactly as before');
        await rm(checkDir, { recursive: true, force: true });
      });
    } finally {
      delete process.env.OPENSQUAD_GAVETA_DIR;
    }
  });
});

test('publishWithGaveteSync pulls the gaveta first and pushes the published result after', async () => {
  await withGaveta(async ({ workDir, bareDir }) => {
    const dir = await mkdtemp(join(tmpdir(), 'opensquad-content-server-'));
    try {
      await createCentralProject({ projectId: 'gaveta-publish', name: 'Gaveta Publish' }, dir);
      const batch = await generateContentSchedulePlan('gaveta-publish', {
        days: 1,
        startDate: '2026-08-10',
        formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '18:00', intervalMinutes: 0 }],
      }, dir);
      const contentId = batch.items[0].contentId;
      await approveContent('gaveta-publish', contentId, dir, batch.batchId);
      await upsertQueueItem(workDir, 'gaveta-publish', contentId, { channel: 'instagram_feed', caption: 'x', mediaUrl: 'https://i.ibb.co/x.jpg', scheduledDate: '2026-08-10', scheduledTime: '09:00' });

      process.env.OPENSQUAD_GAVETA_DIR = workDir;
      const content = await publishWithGaveteSync('gaveta-publish', contentId, dir, batch.batchId, {
        metaPublisher: async () => ({ mediaId: 'media-1', permalink: 'https://instagram.com/p/abc' }),
      });
      assert.equal(content.publish.realPublished, true);

      const checkDir = `${workDir}-check`;
      await execFileAsync('git', ['clone', bareDir, checkDir]);
      const raw = JSON.parse(await readFile(join(checkDir, 'queue', 'gaveta-publish', `${contentId}.json`), 'utf-8'));
      assert.equal(raw.publish.realPublished, true);
      await rm(checkDir, { recursive: true, force: true });
    } finally {
      delete process.env.OPENSQUAD_GAVETA_DIR;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('publishWithGaveteSync skips the real publish and syncs local state when the pulled gaveta already shows the item published', async () => {
  await withGaveta(async ({ workDir }) => {
    const dir = await mkdtemp(join(tmpdir(), 'opensquad-content-server-'));
    try {
      await createCentralProject({ projectId: 'gaveta-already-published', name: 'Gaveta Already Published' }, dir);
      const batch = await generateContentSchedulePlan('gaveta-already-published', {
        days: 1,
        startDate: '2026-08-10',
        formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '18:00', intervalMinutes: 0 }],
      }, dir);
      const contentId = batch.items[0].contentId;
      await approveContent('gaveta-already-published', contentId, dir, batch.batchId);

      // Simulate GitHub Actions' hourly sweep having already published this
      // item — the gaveta queue item already carries a real publish result.
      await upsertQueueItem(workDir, 'gaveta-already-published', contentId, {
        channel: 'instagram_feed',
        caption: 'x',
        mediaUrl: 'https://i.ibb.co/x.jpg',
        scheduledDate: '2026-08-10',
        scheduledTime: '09:00',
        publish: {
          realPublished: true,
          publishedAt: '2026-08-10T09:00:05.000Z',
          metaMediaId: 'media-from-actions',
          permalink: 'https://instagram.com/p/from-actions',
          error: null,
        },
      });

      process.env.OPENSQUAD_GAVETA_DIR = workDir;
      const content = await publishWithGaveteSync('gaveta-already-published', contentId, dir, batch.batchId, {
        metaPublisher: async () => { assert.fail('metaPublisher must not be called when the gaveta already shows this item published'); },
      });

      assert.equal(content.publish.realPublished, true);
      assert.equal(content.publish.metaMediaId, 'media-from-actions');
      assert.equal(content.publish.permalink, 'https://instagram.com/p/from-actions');

      // The local content file on disk must reflect it too, not just the
      // returned object — this is what stops a later "Publicar agora" click
      // from ever reaching this branch again.
      const onDisk = JSON.parse(await readFile(batch.items[0].filePath, 'utf-8'));
      assert.equal(onDisk.publish.realPublished, true);
      assert.equal(onDisk.publish.metaMediaId, 'media-from-actions');
    } finally {
      delete process.env.OPENSQUAD_GAVETA_DIR;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('publishCarouselToInstagram uploads every slide and sends image_urls (plural) to meta-publish-multi, not image_url', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-content-server-'));
  try {
    await createCentralProject({ projectId: 'carrossel-publish', name: 'Boss Pizzaria' }, dir);
    // expiresAt present so saveProjectToken's local-validation branch is
    // taken, never a real call to graph.facebook.com — same reasoning as
    // the 'POST .../token calls syncTokenSecretsToGitHub...' test's own
    // comment at content-central-server.test.js:4502-4508.
    await saveProjectToken('carrossel-publish', {
      token: 'EAAB-fake',
      expiresAt: '2026-12-01T00:00:00.000Z',
      account: { handle: '@bosspizzaria', instagramUserId: '999' },
    }, dir);

    const batch = await generateContentSchedulePlan('carrossel-publish', {
      days: 1,
      startDate: '2026-08-24',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      carouselsPerWeek: 7,
      maxCarouselSlides: 2,
    }, dir);
    const item = batch.items.find((entry) => entry.format === 'carousel');
    // Point each slide at a real local file resolveGeneratedImageAbsolutePath
    // can find — same /api/projects/:id/assets/ URL convention every
    // generated image already uses.
    const assetsDir = join(dir, '_opensquad', 'content-central', 'projects', 'carrossel-publish', 'assets', 'generated');
    await mkdir(assetsDir, { recursive: true });
    for (const [index, slide] of item.slides.entries()) {
      const filename = `slide-${index}.png`;
      await writeFile(join(assetsDir, filename), Buffer.from('fake-png'));
      slide.image.url = `/api/projects/carrossel-publish/assets/assets/generated/${filename}`;
    }
    item.caption = { text: 'Legenda do carrossel', version: 1 };
    const project = await loadProjectForTest('carrossel-publish', dir);

    const execCalls = [];
    const uploadedPaths = [];
    const result = await publishCarouselToInstagram({ content: item, project }, dir, {
      uploader: async (localPath) => {
        uploadedPaths.push(localPath);
        return `https://cdn.example.com/${uploadedPaths.length}.png`;
      },
      execFileAsync: async (cmd, args) => {
        execCalls.push({ cmd, args });
        return { stdout: JSON.stringify({ ok: true, results: [{ ok: true, media_id: 'media-carrossel', permalink: 'https://instagram.com/p/carrossel' }] }) };
      },
    });

    assert.equal(uploadedPaths.length, 2, 'one upload per slide');
    assert.equal(result.mediaId, 'media-carrossel');
    assert.equal(result.permalink, 'https://instagram.com/p/carrossel');

    assert.equal(execCalls.length, 1);
    const payloadArgIndex = execCalls[0].args.indexOf('--payload-json');
    const payload = JSON.parse(execCalls[0].args[payloadArgIndex + 1]);
    const target = payload.publish_targets[0];
    assert.deepEqual(target.image_urls, ['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png']);
    assert.equal(target.image_url, undefined, 'must never send the singular field for a carousel');
    assert.equal(target.caption, 'Legenda do carrossel');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET .../content syncs gaveta-published items so the calendar shows them as published', async () => {
  await withGaveta(async ({ workDir }) => {
    process.env.OPENSQUAD_GAVETA_DIR = workDir;
    try {
      await withServer(async (dir, server) => {
        await createCentralProject({ projectId: 'gaveta-calendar', name: 'Gaveta Calendar' }, dir);
        const batch = await generateContentSchedulePlan('gaveta-calendar', {
          days: 1,
          startDate: '2026-08-10',
          formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '18:00', intervalMinutes: 0 }],
        }, dir);
        const contentId = batch.items[0].contentId;
        await approveContent('gaveta-calendar', contentId, dir, batch.batchId);
        await upsertQueueItem(workDir, 'gaveta-calendar', contentId, {
          channel: 'instagram_feed',
          caption: 'x',
          mediaUrl: 'https://i.ibb.co/x.jpg',
          scheduledDate: '2026-08-10',
          scheduledTime: '18:00',
          publish: { realPublished: true, publishedAt: '2026-08-10T18:00:05.000Z', metaMediaId: 'media-calendar', permalink: 'https://instagram.com/p/calendar', error: null },
        });

        const listed = await request(server, '/api/projects/gaveta-calendar/content');

        assert.equal(listed.body.content.find((item) => item.contentId === contentId).publish.realPublished, true);
        const onDisk = JSON.parse(await readFile(batch.items[0].filePath, 'utf-8'));
        assert.equal(onDisk.publish.metaMediaId, 'media-calendar');
      });
    } finally {
      delete process.env.OPENSQUAD_GAVETA_DIR;
    }
  });
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
    assert.match(html, /@media print\{[\s\S]*\.download-pdf\{display:none\}/);
  });
});

test('client-facing briefing page serves a resized/compressed JPEG preview of each creative instead of the full-resolution PNG, so the page (and its PDF export) stays a reasonable size', async () => {
  const { Jimp } = await import('jimp');
  await withServer(
    async (dir, server) => {
      const generatedDir = join(dir, '_opensquad', 'content-central', 'projects', 'briefing-heavy', 'assets', 'generated');
      await mkdir(generatedDir, { recursive: true });
      // A real 1200x1500 PNG with per-pixel noise, not a flat color — a flat
      // fill already compresses losslessly to almost nothing under PNG,
      // which would make a JPEG re-encode look *bigger*, the opposite of
      // real AI-generated photos (2-4MB each in production) that this
      // stands in for. Noise is the worst case for PNG and the case where
      // JPEG's resize+lossy compression actually pays off, same as a photo.
      const source = new Jimp({ width: 1200, height: 1500, color: 0x2a6f4dff });
      source.scan(0, 0, source.bitmap.width, source.bitmap.height, (x, y, idx) => {
        source.bitmap.data[idx + 0] = Math.floor(Math.random() * 256);
        source.bitmap.data[idx + 1] = Math.floor(Math.random() * 256);
        source.bitmap.data[idx + 2] = Math.floor(Math.random() * 256);
      });
      const originalBuffer = await source.getBuffer('image/png');
      await writeFile(join(generatedDir, 'codex-heavy.png'), originalBuffer);

      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'briefing-heavy',
          name: 'Briefing Heavy',
          handle: '@briefingheavy',
          approvalEmail: 'aprovacao@example.com',
        }),
      });
      await updateProjectBrandInput('briefing-heavy', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
      await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'feed', dir);
      await request(server, '/api/projects/briefing-heavy/generate', {
        method: 'POST',
        body: JSON.stringify({ days: 1, startDate: '2026-07-20', channel: 'instagram_feed' }),
      });

      // enqueueBatchImageGeneration runs in the background, off the /generate
      // response — poll the content list until the injected imageGenerator's
      // result has actually landed.
      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/briefing-heavy/content');
        if (body.content[0]?.image?.url && !body.content[0]?.image?.generating) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }

      const page = await fetch(`${server.url}/api/projects/briefing-heavy/briefing`);
      const html = await page.text();
      assert.doesNotMatch(html, /src="\/api\/projects\/briefing-heavy\/assets\/assets\//, 'the raw full-resolution asset URL should not appear in the page');
      const previewMatch = html.match(/src="(\/api\/projects\/briefing-heavy\/assets-preview\/assets\/generated\/codex-heavy\.png)"/);
      assert.ok(previewMatch, 'expected the <img> to point at the resized-preview route');

      const preview = await fetch(`${server.url}${previewMatch[1]}`);
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get('content-type'), 'image/jpeg');
      const previewBuffer = Buffer.from(await preview.arrayBuffer());
      assert.ok(previewBuffer.length < originalBuffer.length / 3, `preview (${previewBuffer.length}B) should be much smaller than the original (${originalBuffer.length}B)`);
      const decoded = await Jimp.read(previewBuffer);
      assert.ok(decoded.bitmap.width <= 640, `preview should be resized down, got width ${decoded.bitmap.width}`);

      // The preview should be cached to disk, not recomputed on every request.
      const cachedFiles = await readdir(join(generatedDir, '..', 'previews')).catch(() => []);
      assert.ok(cachedFiles.some((name) => name.includes('codex-heavy.png')), 'expected the resized preview to be cached under assets/previews/');
    },
    {
      imageGenerator: async () => ({
        url: '/api/projects/briefing-heavy/assets/assets/generated/codex-heavy.png',
        mimeType: 'image/png',
      }),
    },
  );
});

test('client-facing briefing page is presentation-only — no approve action, no way to change real system state from it', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'briefing-presentation',
        name: 'Briefing Presentation',
        handle: '@briefingpresentation',
        approvalEmail: 'aprovacao@example.com',
      }),
    });
    await request(server, '/api/projects/briefing-presentation/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 1, startDate: '2026-07-20', channel: 'instagram_feed' }),
    });

    const response = await fetch(`${server.url}/api/projects/briefing-presentation/briefing`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.doesNotMatch(html, /Aprovar/);
    assert.doesNotMatch(html, /approveBriefingCard/);
    assert.doesNotMatch(html, /data-items=/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /Aguardando aprovação/);
    assert.match(html, /20 de julho de 2026/);
    assert.match(html, /Descrição da publicação/);
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

    // Channel tags still show which formats share the grouped creative — the
    // page just doesn't offer an action to approve them from here anymore.
    const groupedMeta = html.match(/<div class="briefing-meta">((?:(?!<\/div>)[\s\S])*)<\/div>/g) || [];
    const threeChannelMeta = groupedMeta.find((meta) => (meta.match(/class="pill"/g) || []).length === 3);
    assert.ok(threeChannelMeta, 'expected one card whose channel-tag row lists all 3 grouped channels');
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

test('content central API previews the schedule plan with selected groups and commemorative extras before generation', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'preview-web',
        name: 'Preview Web',
        handle: '@previewweb',
        approvalEmail: 'aprovacao@example.com',
      }),
    });
    await request(server, '/api/projects/preview-web/brand-input', {
      method: 'POST',
      body: JSON.stringify({ brandName: 'Preview Web', segment: 'loja', contentGoals: ['authority'] }),
    });
    const group = await request(server, '/api/projects/preview-web/offer-groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Limpeza' }),
    });
    await request(server, '/api/projects/preview-web/offers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Pano Microfibra', price: '3,5', groupId: group.body.group.id }),
    });

    const preview = await request(server, '/api/projects/preview-web/plan', {
      method: 'POST',
      body: JSON.stringify({
        days: 2,
        startDate: '2026-09-15',
        formats: [{ channel: 'instagram_story', postsPerDay: 2, everyDays: 1, startTime: '09:00', intervalMinutes: 240 }],
        groupIds: [group.body.group.id],
        offersOnly: true,
      }),
    });

    assert.equal(preview.response.status, 200);
    assert.equal(preview.body.plan.regularCount, 4);
    assert.equal(preview.body.plan.extraCount, 1);
    assert.equal(preview.body.plan.dayPlans[0].extras[0].specialDateLabel, 'Dia do Cliente');
    assert.ok(preview.body.plan.dayPlans.flatMap((day) => day.regular).every((item) => item.offerName === 'Pano Microfibra'));
  });
});

test('content central API generates from operator-edited approved plan notes', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'plan-edit-web', name: 'Plan Edit Web' }),
    });
    await request(server, '/api/projects/plan-edit-web/offers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Espeto para Churrasco', price: '6,2' }),
    });

    const generated = await request(server, '/api/projects/plan-edit-web/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 1,
        startDate: '2026-08-14',
        formats: [{ channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
        approvedPlan: {
          dayPlans: [{ regular: [{ id: '2026-08-14-instagram_story-01', label: 'Venda — Kit churrasco editado', reason: 'Trocar foco para fim de semana.' }] }],
        },
      }),
    });

    assert.equal(generated.response.status, 201);
    assert.equal(generated.body.batch.items[0].contentTopic.planEdited, true);
    assert.equal(generated.body.batch.items[0].contentTopic.planLabel, 'Venda — Kit churrasco editado');
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

test('content central API saves, edits and deletes offer groups, and links an offer to one', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'grupos-web', name: 'Grupos Web' }),
    });

    const created = await request(server, '/api/projects/grupos-web/offer-groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Black Friday' }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.body.group.name, 'Black Friday');
    const groupId = created.body.group.id;

    const offer = await request(server, '/api/projects/grupos-web/offers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Produto BF', groupId }),
    });
    assert.equal(offer.body.offer.groupId, groupId);

    const state = await request(server, '/api/state');
    assert.equal(state.body.projects[0].contentStrategy.offerGroups.length, 1);

    const deleted = await request(server, '/api/projects/grupos-web/offer-groups-delete', {
      method: 'POST',
      body: JSON.stringify({ groupId }),
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.deleted, true);

    const finalState = await request(server, '/api/state');
    assert.deepEqual(finalState.body.projects[0].contentStrategy.offerGroups, []);
  });
});

test('content central server generates content scoped to a group via /generate, ignoring offers outside it', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'grupos-generate-web', name: 'Grupos Generate Web' }),
    });
    const group = await request(server, '/api/projects/grupos-generate-web/offer-groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Black Friday' }),
    });
    const groupId = group.body.group.id;
    await request(server, '/api/projects/grupos-generate-web/offers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Produto BF', price: 'R$1', groupId }),
    });
    await request(server, '/api/projects/grupos-generate-web/offers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Produto Sem Grupo' }),
    });

    const generated = await request(server, '/api/projects/grupos-generate-web/generate', {
      method: 'POST',
      body: JSON.stringify({ days: 2, startDate: '2026-08-03', channel: 'instagram_feed', groupIds: [groupId] }),
    });
    assert.equal(generated.response.status, 201);
    const offerNames = generated.body.batch.items.map((item) => item.contentTopic.offerName);
    assert.ok(offerNames.every((name) => name === 'Produto BF'));
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

test('content central API accepts whatsapp_status as a generation channel', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'api-whatsapp',
        name: 'API WhatsApp',
        handle: '@apiwhatsapp',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const generated = await request(server, '/api/projects/api-whatsapp/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 1,
        startDate: '2026-07-20',
        channels: ['whatsapp_status'],
      }),
    });

    assert.equal(generated.response.status, 201);
    assert.deepEqual(generated.body.batches.map((batch) => batch.items[0].channel), ['whatsapp_status']);
  });
});

// Regression guard for the "Marcar todos os Stories" button: it selects
// instagram_story, instagram_reels, facebook_story AND whatsapp_status
// together (see VERTICAL_CREATIVE_CHANNELS in the React app) and submits
// them as one /generate call with a `formats` array — normalizeChannels
// used to reject whatsapp_status and 500 the whole batch, bricking the
// pre-existing Meta-channel flow too.
test('content central API generates a mixed instagram_story + whatsapp_status formats batch (Marcar todos os Stories)', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'todos-stories-web',
        name: 'Todos Stories Web',
        handle: '@todosstories',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const generated = await request(server, '/api/projects/todos-stories-web/generate', {
      method: 'POST',
      body: JSON.stringify({
        days: 1,
        startDate: '2026-07-20',
        formats: [
          { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
          { channel: 'whatsapp_status', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        ],
      }),
    });

    assert.equal(generated.response.status, 201);
    assert.deepEqual(
      [...new Set(generated.body.batch.items.map((item) => item.channel))].sort(),
      ['instagram_story', 'whatsapp_status'],
    );
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

// The vision call itself (analyzeProspectScreenshotWithHermes) runs
// `hermes chat --image <path>` — a real subprocess/CLI call, same as every
// other hermes-based function in this file (reviewAiImageWithHermes,
// callHermesChatText, writeAiCaptionWithHermes etc.), none of which are
// unit-tested directly for the same reason: no mocking seam for
// execFileAsync exists here (nor should one be bolted on just for this).
// It's exercised live instead (see the /api/prospects route tests below,
// which inject a fake prospectScreenshotAnalyzer the same way other AI
// features are injected via startContentCentralServer's context) and via
// manual verification against a real screenshot. What's unit-tested here is
// the normalization logic — the exact class of bug (locale-formatted counts,
// an incomplete avatarCrop) most likely to hide a real defect.
test('normalizeProspectExtraction cleans locale-formatted counts and drops a blank differentiator entry, without inventing anything', () => {
  const extracted = normalizeProspectExtraction({
    businessName: 'Empório Rei da Mussarela',
    handle: '@emporioreidamussarela',
    nicheGuess: 'delivery de frios e laticínios',
    bioText: 'Serviço de entrega de comida. Loja de frios e Fatiados.',
    differentiators: ['Qualidade e preço justo', 'O melhor preço de Cuiabá', ''],
    realFollowers: '4.388',
    realPosts: 20,
    realFollowing: 35,
    avatarCrop: { xPct: 4, yPct: 6, sizePct: 18 },
  });
  assert.equal(extracted.businessName, 'Empório Rei da Mussarela');
  assert.equal(extracted.handle, '@emporioreidamussarela');
  assert.equal(extracted.realFollowers, 4388, 'must strip the "4.388" locale formatting down to a plain number');
  assert.equal(extracted.realPosts, 20);
  assert.equal(extracted.realFollowing, 35);
  assert.deepEqual(extracted.differentiators, ['Qualidade e preço justo', 'O melhor preço de Cuiabá'], 'must drop the blank entry, never pad it back in');
  assert.deepEqual(extracted.avatarCrop, { xPct: 4, yPct: 6, sizePct: 18 });
});

test('normalizeProspectExtraction drops an incomplete avatar crop instead of guessing the missing side, and never invents a missing field', () => {
  const extracted = normalizeProspectExtraction({
    businessName: 'Loja Teste',
    handle: null,
    nicheGuess: null,
    bioText: null,
    differentiators: [],
    realFollowers: null,
    realPosts: null,
    realFollowing: null,
    avatarCrop: { xPct: 4, yPct: null, sizePct: 18 },
  });
  assert.equal(extracted.avatarCrop, null);
  assert.equal(extracted.handle, null);
  assert.equal(extracted.realFollowers, null);
});

test('normalizeProspectExtraction returns a safe empty shape for a garbage/non-object input instead of throwing', () => {
  assert.doesNotThrow(() => normalizeProspectExtraction(null));
  const extracted = normalizeProspectExtraction(null);
  assert.equal(extracted.businessName, null);
  assert.deepEqual(extracted.differentiators, []);
  assert.equal(extracted.avatarCrop, null);
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

test('publishContentToWhatsAppStatus posts the generated image to the WAHA status endpoint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-whatsapp-publish-'));
  try {
    await createCentralProject({ projectId: 'whatsapp-publish', name: 'WhatsApp Publish' }, dir);
    await saveProjectWhatsAppInstance('whatsapp-publish', {
      sessionName: 'opensquad-whatsapp-publish',
    }, dir);
    const project = {
      projectId: 'whatsapp-publish',
      whatsapp: { sessionName: 'opensquad-whatsapp-publish' },
    };
    const content = {
      contentId: 'content-1',
      channel: 'whatsapp_status',
      caption: { text: 'Promoção da semana!' },
      publish: { mediaUrl: 'https://cdn.example.com/whatsapp-test.png' },
    };

    process.env.OPENSQUAD_WAHA_ADMIN_URL = 'https://waha.example.com';
    process.env.OPENSQUAD_WAHA_APIKEY = 'waha-secret';
    try {
      const calls = [];
      await withMockedFetch(async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ id: 'true_status@broadcast_WA123_123@c.us' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }, async () => {
        const result = await publishContentToWhatsAppStatus({ content, project }, dir);
        assert.equal(result.mediaId, 'true_status@broadcast_WA123_123@c.us');
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://waha.example.com/api/opensquad-whatsapp-publish/status/image');
      assert.equal(calls[0].init.headers['X-Api-Key'], 'waha-secret');
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.file.url, 'https://cdn.example.com/whatsapp-test.png');
      assert.equal(body.caption, 'Promoção da semana!');
    } finally {
      delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
      delete process.env.OPENSQUAD_WAHA_APIKEY;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('publishContentToWhatsAppStatus surfaces a clear beta-instability error when WAHA times out', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-whatsapp-timeout-'));
  try {
    await createCentralProject({ projectId: 'whatsapp-timeout', name: 'WhatsApp Timeout' }, dir);
    await saveProjectWhatsAppInstance('whatsapp-timeout', {
      sessionName: 'opensquad-whatsapp-timeout',
    }, dir);
    const project = {
      projectId: 'whatsapp-timeout',
      whatsapp: { sessionName: 'opensquad-whatsapp-timeout' },
    };
    const content = {
      contentId: 'content-1',
      channel: 'whatsapp_status',
      caption: { text: 'x' },
      publish: { mediaUrl: 'https://cdn.example.com/whatsapp-test.png' },
    };

    process.env.OPENSQUAD_WAHA_ADMIN_URL = 'https://waha.example.com';
    process.env.OPENSQUAD_WAHA_APIKEY = 'waha-secret';
    process.env.OPENSQUAD_WHATSAPP_PUBLISH_TIMEOUT_MS = '10';
    try {
      await withMockedFetch(async (url, init) => new Promise((_resolve, reject) => {
        // Real fetch rejects with signal.reason when an AbortSignal.timeout()
        // fires — reject with that same reason here instead of a hand-built
        // error, so this test matches Node's actual behavior.
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }), async () => {
        await assert.rejects(
          () => publishContentToWhatsAppStatus({ content, project }, dir),
          /Canal beta instável.*WAHA não respondeu a tempo/,
        );
      });
    } finally {
      delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
      delete process.env.OPENSQUAD_WAHA_APIKEY;
      delete process.env.OPENSQUAD_WHATSAPP_PUBLISH_TIMEOUT_MS;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST .../whatsapp-instance/connect fails clearly when the WAHA server is not configured', async () => {
  delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
  delete process.env.OPENSQUAD_WAHA_APIKEY;
  await withServer(async (dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'rota-whatsapp-sem-admin', name: 'Rota WhatsApp Sem Admin' }),
    });
    const res = await request(server, '/api/projects/rota-whatsapp-sem-admin/whatsapp-instance/connect', { method: 'POST' });
    assert.equal(res.response.status, 500);
    assert.match(res.body.error, /Servidor WAHA não configurado/);
  });
});

test('POST .../whatsapp-instance/connect creates a new WAHA session and stores its name', async () => {
  await withServer(async (dir, server) => {
    process.env.OPENSQUAD_WAHA_ADMIN_URL = 'https://waha.example.com';
    process.env.OPENSQUAD_WAHA_APIKEY = 'waha-secret';
    try {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'rota-whatsapp-connect', name: 'Rota WhatsApp Connect' }),
      });

      const calls = [];
      await withMockedFetch(async (url, init) => {
        calls.push({ url: String(url), init });
        const u = String(url);
        if (u === 'https://waha.example.com/api/sessions/opensquad-rota-whatsapp-connect') {
          return new Response(JSON.stringify({ message: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
        }
        if (u === 'https://waha.example.com/api/sessions') {
          return new Response(JSON.stringify({ name: 'opensquad-rota-whatsapp-connect' }), { status: 201, headers: { 'content-type': 'application/json' } });
        }
        if (u === 'https://waha.example.com/api/sessions/opensquad-rota-whatsapp-connect/start') {
          return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (u === 'https://waha.example.com/api/opensquad-rota-whatsapp-connect/auth/qr?format=image') {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
        }
        throw new Error(`unexpected fetch call: ${u}`);
      }, async () => {
        const res = await request(server, '/api/projects/rota-whatsapp-connect/whatsapp-instance/connect', { method: 'POST' });
        assert.equal(res.response.status, 200);
        assert.equal(res.body.qrcode, `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`);
        assert.equal(res.body.project.whatsapp.configured, true);
        assert.equal(res.body.project.whatsapp.sessionName, 'opensquad-rota-whatsapp-connect');
      });

      assert.equal(calls.length, 4);
      const createCall = calls.find((c) => c.url === 'https://waha.example.com/api/sessions');
      assert.equal(JSON.parse(createCall.init.body).name, 'opensquad-rota-whatsapp-connect');
    } finally {
      delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
      delete process.env.OPENSQUAD_WAHA_APIKEY;
    }
  });
});

test('POST .../whatsapp-instance/connect leaves a WORKING session untouched and returns no QR', async () => {
  await withServer(async (dir, server) => {
    process.env.OPENSQUAD_WAHA_ADMIN_URL = 'https://waha.example.com';
    process.env.OPENSQUAD_WAHA_APIKEY = 'waha-secret';
    try {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'rota-whatsapp-working', name: 'Rota WhatsApp Working' }),
      });
      await saveProjectWhatsAppInstance('rota-whatsapp-working', {
        sessionName: 'opensquad-rota-whatsapp-working',
      }, dir);

      const calls = [];
      await withMockedFetch(async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ status: 'WORKING' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }, async () => {
        const res = await request(server, '/api/projects/rota-whatsapp-working/whatsapp-instance/connect', { method: 'POST' });
        assert.equal(res.response.status, 200);
        assert.equal(res.body.qrcode, null);
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://waha.example.com/api/sessions/opensquad-rota-whatsapp-working');
    } finally {
      delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
      delete process.env.OPENSQUAD_WAHA_APIKEY;
    }
  });
});

test('POST .../whatsapp-instance/connect restarts a FAILED session before fetching a fresh QR', async () => {
  await withServer(async (dir, server) => {
    process.env.OPENSQUAD_WAHA_ADMIN_URL = 'https://waha.example.com';
    process.env.OPENSQUAD_WAHA_APIKEY = 'waha-secret';
    try {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'rota-whatsapp-restart', name: 'Rota WhatsApp Restart' }),
      });
      await saveProjectWhatsAppInstance('rota-whatsapp-restart', {
        sessionName: 'opensquad-rota-whatsapp-restart',
      }, dir);

      const calls = [];
      await withMockedFetch(async (url, init) => {
        calls.push({ url: String(url), init });
        const u = String(url);
        if (u === 'https://waha.example.com/api/sessions/opensquad-rota-whatsapp-restart') {
          return new Response(JSON.stringify({ status: 'FAILED' }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (u === 'https://waha.example.com/api/sessions/opensquad-rota-whatsapp-restart/restart') {
          return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (u === 'https://waha.example.com/api/opensquad-rota-whatsapp-restart/auth/qr?format=image') {
          return new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': 'image/png' } });
        }
        throw new Error(`unexpected fetch call: ${u}`);
      }, async () => {
        const res = await request(server, '/api/projects/rota-whatsapp-restart/whatsapp-instance/connect', { method: 'POST' });
        assert.equal(res.response.status, 200);
        assert.equal(res.body.qrcode, `data:image/png;base64,${Buffer.from([9, 9]).toString('base64')}`);
      });

      assert.equal(calls.length, 3);
      assert.equal(calls[1].url, 'https://waha.example.com/api/sessions/opensquad-rota-whatsapp-restart/restart');
    } finally {
      delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
      delete process.env.OPENSQUAD_WAHA_APIKEY;
    }
  });
});

test('POST .../whatsapp-instance/connect migrates a project still carrying the old Evolution shape (configured: true, no sessionName)', async () => {
  await withServer(async (dir, server) => {
    process.env.OPENSQUAD_WAHA_ADMIN_URL = 'https://waha.example.com';
    process.env.OPENSQUAD_WAHA_APIKEY = 'waha-secret';
    try {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'rota-whatsapp-legado', name: 'Rota WhatsApp Legado' }),
      });
      // Simulate a project.json still on disk from before this migration —
      // configured: true, but shaped like Evolution's old instanceName/
      // maskedApiKey record instead of the new sessionName field.
      const projectJsonPath = join(dir, '_opensquad', 'content-central', 'projects', 'rota-whatsapp-legado', 'project.json');
      const project = JSON.parse(await readFile(projectJsonPath, 'utf-8'));
      project.whatsapp = { configured: true, instanceName: 'opensquad-rota-whatsapp-legado', maskedApiKey: '****1234' };
      await writeFile(projectJsonPath, JSON.stringify(project, null, 2), 'utf-8');

      const calls = [];
      await withMockedFetch(async (url, init) => {
        calls.push({ url: String(url), init });
        const u = String(url);
        if (u === 'https://waha.example.com/api/sessions/opensquad-rota-whatsapp-legado') {
          return new Response(JSON.stringify({ message: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
        }
        if (u === 'https://waha.example.com/api/sessions') {
          return new Response(JSON.stringify({ name: 'opensquad-rota-whatsapp-legado' }), { status: 201, headers: { 'content-type': 'application/json' } });
        }
        if (u === 'https://waha.example.com/api/sessions/opensquad-rota-whatsapp-legado/start') {
          return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (u === 'https://waha.example.com/api/opensquad-rota-whatsapp-legado/auth/qr?format=image') {
          return new Response(new Uint8Array([7]), { status: 200, headers: { 'content-type': 'image/png' } });
        }
        throw new Error(`unexpected fetch call: ${u}`);
      }, async () => {
        const res = await request(server, '/api/projects/rota-whatsapp-legado/whatsapp-instance/connect', { method: 'POST' });
        assert.equal(res.response.status, 200);
        assert.equal(res.body.project.whatsapp.configured, true);
        assert.equal(res.body.project.whatsapp.sessionName, 'opensquad-rota-whatsapp-legado');
        assert.equal(res.body.project.whatsapp.maskedApiKey, undefined);
      });
    } finally {
      delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
      delete process.env.OPENSQUAD_WAHA_APIKEY;
    }
  });
});

test('GET .../whatsapp-instance/status reports connected true only when WAHA reports WORKING', async () => {
  await withServer(async (dir, server) => {
    process.env.OPENSQUAD_WAHA_ADMIN_URL = 'https://waha.example.com';
    process.env.OPENSQUAD_WAHA_APIKEY = 'waha-secret';
    try {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'rota-whatsapp-status', name: 'Rota WhatsApp Status' }),
      });
      await saveProjectWhatsAppInstance('rota-whatsapp-status', {
        sessionName: 'opensquad-rota-whatsapp-status',
      }, dir);

      await withMockedFetch(
        async () => new Response(JSON.stringify({ status: 'WORKING' }), { status: 200, headers: { 'content-type': 'application/json' } }),
        async () => {
          const res = await request(server, '/api/projects/rota-whatsapp-status/whatsapp-instance/status');
          assert.equal(res.response.status, 200);
          assert.equal(res.body.connected, true);
          assert.equal(res.body.state, 'WORKING');
        },
      );
    } finally {
      delete process.env.OPENSQUAD_WAHA_ADMIN_URL;
      delete process.env.OPENSQUAD_WAHA_APIKEY;
    }
  });
});

test('GET .../whatsapp-instance/status reports not_configured without any network call for a project with no session', async () => {
  await withServer(async (dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'rota-whatsapp-sem-instancia', name: 'Rota WhatsApp Sem Instância' }),
    });
    const calls = [];
    await withMockedFetch(async (url) => { calls.push(String(url)); throw new Error('should not be called'); }, async () => {
      const res = await request(server, '/api/projects/rota-whatsapp-sem-instancia/whatsapp-instance/status');
      assert.equal(res.response.status, 200);
      assert.equal(res.body.connected, false);
      assert.equal(res.body.state, 'not_configured');
    });
    assert.equal(calls.length, 0);
  });
});

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

test('content central server exposes improve-bio as 501 when no bioImprover is configured', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'prospect-bio', name: 'Prospect Bio' }),
    });
    const improved = await request(server, '/api/projects/prospect-bio/improve-bio', {
      method: 'POST',
      body: JSON.stringify({ bio: 'Pizzas boas', segment: 'Pizzaria' }),
    });
    assert.equal(improved.response.status, 501);
  });
});

test('content central server wires the injected bioImprover through the real route, and 502s when it returns nothing', async () => {
  const calls = [];
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'prospect-bio', name: 'Prospect Bio' }),
      });

      const improved = await request(server, '/api/projects/prospect-bio/improve-bio', {
        method: 'POST',
        body: JSON.stringify({ bio: 'Pizzas boas e baratas', segment: 'Pizzaria', businessName: 'Prospect Bio' }),
      });

      assert.equal(improved.response.status, 200);
      assert.deepEqual(calls[0], { bio: 'Pizzas boas e baratas', segment: 'Pizzaria', businessName: 'Prospect Bio' });
      assert.equal(improved.body.bio, 'Pizzas artesanais assadas na hora, direto pra sua mesa.');

      const empty = await request(server, '/api/projects/prospect-bio/improve-bio', {
        method: 'POST',
        body: JSON.stringify({ bio: '' }),
      });
      assert.equal(empty.response.status, 502);
    },
    {
      bioImprover: async ({ bio, segment, businessName }) => {
        calls.push({ bio, segment, businessName });
        return bio ? 'Pizzas artesanais assadas na hora, direto pra sua mesa.' : null;
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
      await updateProjectBrandInput('animar-web-ok', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
      await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'vertical', dir);
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
    async (dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'reels-auto-web', name: 'Reels Auto Web' }),
      });
      await updateProjectBrandInput('reels-auto-web', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
      await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'vertical', dir);

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

test('GET commemorative-dates returns upcoming national holidays/commercial dates within the requested window', async () => {
  await withServer(async (_dir, server) => {
    await request(server, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'datas-comemorativas',
        name: 'Datas Comemorativas',
        handle: '@datas',
        approvalEmail: 'aprovacao@example.com',
      }),
    });

    const { response, body } = await request(server, '/api/projects/datas-comemorativas/commemorative-dates?months=12');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.dates));
    assert.ok(body.dates.length > 5);
    assert.ok(body.dates.every((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.label && ['holiday', 'commercial'].includes(entry.kind)));
  });
});

test('POST generate-special-date creates a real content card for the chosen date, wired through the same image/caption generators as a normal batch', async () => {
  const captions = [];
  await withServer(
    async (dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'gerar-data-especial',
          name: 'Boss Pizzaria',
          handle: '@bosspizzaria',
          approvalEmail: 'aprovacao@example.com',
        }),
      });
      await updateProjectBrandInput('gerar-data-especial', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
      await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'special_date', 'feed', dir);

      const generated = await request(server, '/api/projects/gerar-data-especial/generate-special-date', {
        method: 'POST',
        body: JSON.stringify({ date: '2026-11-27', label: 'Black Friday', channel: 'instagram_feed' }),
      });
      assert.equal(generated.response.status, 201);
      assert.equal(generated.body.batch.items.length, 1);
      assert.equal(generated.body.batch.items[0].scheduledDate, '2026-11-27');
      assert.equal(generated.body.batch.items[0].contentTopic.specialDateLabel, 'Black Friday');

      const contentId = generated.body.batch.items[0].contentId;
      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/gerar-data-especial/content');
        const item = body.content.find((entry) => entry.contentId === contentId);
        if (item?.image?.url && !item?.image?.generating) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      const { body: finalContent } = await request(server, '/api/projects/gerar-data-especial/content');
      const finalItem = finalContent.content.find((entry) => entry.contentId === contentId);
      assert.equal(finalItem.image.url, 'https://cdn.example.com/black-friday.png');
      assert.equal(captions.length, 1);
    },
    {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/black-friday.png', mimeType: 'image/png' }),
      captionGenerator: async ({ content }) => {
        captions.push(content.contentTopic.specialDateLabel);
        return 'Legenda de Black Friday.';
      },
    },
  );
});

test('POST carousels creates a placeholder immediately and the background pipeline fills in the roteiro + real images', async () => {
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'carrossel-http', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }),
      });

      const generated = await request(server, '/api/projects/carrossel-http/carousels', {
        method: 'POST',
        body: JSON.stringify({ briefing: '3 dicas de pizza', slideCount: 3 }),
      });
      assert.equal(generated.response.status, 201);
      assert.equal(generated.body.carousel.slideCount, 3);
      assert.equal(generated.body.carousel.status, 'generating');

      const carouselId = generated.body.carousel.carouselId;
      let finalCarousel;
      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/carrossel-http/carousels');
        finalCarousel = body.carousels.find((entry) => entry.carouselId === carouselId);
        if (finalCarousel?.status === 'ready') break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }

      assert.equal(finalCarousel.status, 'ready');
      assert.equal(finalCarousel.format, 'listicle');
      assert.equal(finalCarousel.slides.length, 3);
      finalCarousel.slides.forEach((slide) => {
        assert.equal(slide.image.generating, false);
        assert.equal(slide.image.url, 'https://cdn.example.com/carrossel.png');
      });
    },
    {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/carrossel.png', mimeType: 'image/png' }),
      carouselOutlineGenerator: async ({ slideCount }) => ({
        format: 'listicle',
        slides: Array.from({ length: slideCount }, (_, index) => ({
          role: index === 0 ? 'cover' : index === slideCount - 1 ? 'cta' : 'content',
          slideText: `Slide ${index + 1}`,
        })),
      }),
    },
  );
});

test('carousels-delete removes it from the listing, and carousels-regenerate-slide replaces only the target slide', async () => {
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'carrossel-http-2', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }),
      });
      const generated = await request(server, '/api/projects/carrossel-http-2/carousels', {
        method: 'POST',
        body: JSON.stringify({ briefing: 'teste', slideCount: 2 }),
      });
      const carouselId = generated.body.carousel.carouselId;

      let ready;
      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/carrossel-http-2/carousels');
        ready = body.carousels.find((entry) => entry.carouselId === carouselId);
        if (ready?.status === 'ready') break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      const targetSlideId = ready.slides[0].slideId;
      const otherSlideId = ready.slides[1].slideId;

      const regenerated = await request(server, `/api/projects/carrossel-http-2/carousels-regenerate-slide/${carouselId}/${targetSlideId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      assert.equal(regenerated.response.status, 200);

      let final;
      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/carrossel-http-2/carousels');
        final = body.carousels.find((entry) => entry.carouselId === carouselId);
        const slide = final.slides.find((s) => s.slideId === targetSlideId);
        if (slide?.image.url === 'https://cdn.example.com/regen.png' && !slide.image.generating) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      assert.equal(final.slides.find((s) => s.slideId === targetSlideId).image.url, 'https://cdn.example.com/regen.png');
      assert.equal(final.slides.find((s) => s.slideId === otherSlideId).image.url, 'https://cdn.example.com/original.png');

      const deleted = await request(server, `/api/projects/carrossel-http-2/carousels-delete/${carouselId}`, { method: 'POST' });
      assert.equal(deleted.response.status, 200);
      const { body: afterDelete } = await request(server, '/api/projects/carrossel-http-2/carousels');
      assert.equal(afterDelete.carousels.length, 0);
    },
    {
      // Task 2's regenerate path never sends a `note` — unlike ad creatives,
      // there's no edit-note UI for a carousel slide in this plan (it's a
      // plain "regenerate this slide" click). So the original-vs-regenerated
      // image is distinguished by call order instead: the 2 slides from
      // `POST carousels` are calls 1-2 (concurrency 2, but both resolve
      // synchronously here so call order is still deterministic array
      // order), and the later `carousels-regenerate-slide` call is always
      // call 3.
      imageGenerator: (() => {
        let call = 0;
        return async () => {
          call += 1;
          return {
            url: call <= 2 ? 'https://cdn.example.com/original.png' : 'https://cdn.example.com/regen.png',
            mimeType: 'image/png',
          };
        };
      })(),
      carouselOutlineGenerator: async ({ slideCount }) => ({
        format: 'listicle',
        slides: Array.from({ length: slideCount }, (_, index) => ({ role: 'content', slideText: `Slide ${index + 1}` })),
      }),
    },
  );
});

test('carousel-regenerate-slide on a batch-item carousel regenerates only the target slide', async () => {
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'carrossel-item-regen', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }),
      });

      await request(server, '/api/projects/carrossel-item-regen/generate', {
        method: 'POST',
        body: JSON.stringify({
          days: 1,
          startDate: '2026-08-24',
          formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
          carouselsPerWeek: 7,
          maxCarouselSlides: 2,
        }),
      });

      let item;
      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/carrossel-item-regen/content');
        item = body.content.find((entry) => entry.format === 'carousel');
        if (item?.slides?.length === 2 && item.slides.every((slide) => !slide.image.generating)) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }

      const contentId = item.contentId;
      const targetSlideId = item.slides[0].slideId;
      const otherSlideId = item.slides[1].slideId;

      const regenerated = await request(server, `/api/projects/carrossel-item-regen/content/${contentId}/carousel-regenerate-slide/${targetSlideId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      assert.equal(regenerated.response.status, 200);

      let final;
      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/carrossel-item-regen/content');
        final = body.content.find((entry) => entry.contentId === contentId);
        const slide = final.slides.find((s) => s.slideId === targetSlideId);
        if (slide?.image.url === 'https://cdn.example.com/regen.png' && !slide.image.generating) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      assert.equal(final.slides.find((s) => s.slideId === targetSlideId).image.url, 'https://cdn.example.com/regen.png');
      assert.equal(final.slides.find((s) => s.slideId === otherSlideId).image.url, 'https://cdn.example.com/original.png');
    },
    {
      // Same call-order trick as the standalone-carousel version of this
      // test above: the 2 slides from the initial /generate are calls 1-2,
      // the later carousel-regenerate-slide call is always call 3.
      imageGenerator: (() => {
        let call = 0;
        return async () => {
          call += 1;
          return {
            url: call <= 2 ? 'https://cdn.example.com/original.png' : 'https://cdn.example.com/regen.png',
            mimeType: 'image/png',
          };
        };
      })(),
      carouselOutlineGenerator: async ({ slideCount }) => ({
        format: 'listicle',
        slides: Array.from({ length: slideCount }, (_, index) => ({ role: 'content', slideText: `Slide ${index + 1}` })),
      }),
    },
  );
});

test('POST ad-creatives with format "ambos" generates one Story and one Feed ad creative in a single call', async () => {
  await withServer(
    async (_dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'anuncio-ambos', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }),
      });

      const generated = await request(server, '/api/projects/anuncio-ambos/ad-creatives', {
        method: 'POST',
        body: JSON.stringify({ objective: 'sales', format: 'ambos' }),
      });
      assert.equal(generated.response.status, 201);
      assert.equal(generated.body.adCreatives.length, 2);
      assert.deepEqual(generated.body.adCreatives.map((entry) => entry.channel).sort(), ['instagram_feed', 'instagram_story']);

      const { body: listed } = await request(server, '/api/projects/anuncio-ambos/ad-creatives');
      assert.equal(listed.adCreatives.length, 2);
    },
    { imageGenerator: async () => ({ url: 'https://cdn.example.com/ambos.png', mimeType: 'image/png' }) },
  );
});

test('POST ad-creatives-regenerate with a note performs a targeted image edit and never touches the existing copy variations', async () => {
  await withServer(
    async (dir, server) => {
      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'anuncio-regen-http', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }),
      });
      await updateProjectBrandInput('anuncio-regen-http', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
      await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'ad_creative', 'feed', dir);

      const generated = await request(server, '/api/projects/anuncio-regen-http/ad-creatives', {
        method: 'POST',
        body: JSON.stringify({ objective: 'whatsapp' }),
      });
      const adCreativeId = generated.body.adCreatives[0].adCreativeId;

      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/anuncio-regen-http/ad-creatives');
        const item = body.adCreatives.find((entry) => entry.adCreativeId === adCreativeId);
        if (item?.image?.url && !item?.image?.generating && item?.variations?.length) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }

      const regenerated = await request(server, `/api/projects/anuncio-regen-http/ad-creatives-regenerate/${adCreativeId}`, {
        method: 'POST',
        body: JSON.stringify({ note: 'deixar o preço maior' }),
      });
      assert.equal(regenerated.response.status, 200);

      for (let i = 0; i < 50; i += 1) {
        const { body } = await request(server, '/api/projects/anuncio-regen-http/ad-creatives');
        const item = body.adCreatives.find((entry) => entry.adCreativeId === adCreativeId);
        if (item?.image?.url === 'https://cdn.example.com/edited.png' && !item?.image?.generating) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }

      const { body: finalContent } = await request(server, '/api/projects/anuncio-regen-http/ad-creatives');
      const finalItem = finalContent.adCreatives.find((entry) => entry.adCreativeId === adCreativeId);
      assert.equal(finalItem.image.url, 'https://cdn.example.com/edited.png');
      // The copy from the original generation must survive an image-only regenerate.
      assert.equal(finalItem.variations.length, 3);
    },
    {
      imageGenerator: async (payload) => ({
        url: payload.targetedEdit ? 'https://cdn.example.com/edited.png' : 'https://cdn.example.com/original.png',
        mimeType: 'image/png',
      }),
      adCopyGenerator: async () => ([
        { angle: 'dor', headline: 'h1', primaryText: 'p1', description: 'd1', cta: 'c1' },
        { angle: 'desejo', headline: 'h2', primaryText: 'p2', description: 'd2', cta: 'c2' },
        { angle: 'urgencia', headline: 'h3', primaryText: 'p3', description: 'd3', cta: 'c3' },
      ]),
    },
  );
});

test('startPublishScheduler does not start the interval when OPENSQUAD_AUTO_PUBLISH_SCHEDULER=false, even with real publishing enabled', async () => {
  process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING = 'true';
  process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER = 'false';
  try {
    const timer = startPublishScheduler(process.cwd());
    assert.equal(timer, null);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
    delete process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER;
  }
});

test('startPublishScheduler still starts the interval when OPENSQUAD_AUTO_PUBLISH_SCHEDULER is unset and OPENSQUAD_ENABLE_REAL_PUBLISHING=true', async () => {
  process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING = 'true';
  delete process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER;
  // Real publishing is enabled here, so the interval this starts will
  // actually sweep targetDir for due, approved content and try to publish
  // it for real. Must never point at process.cwd() — in the main OPENSQUAD
  // checkout (not this worktree) that's the real content-central tree with
  // 6 live client projects and live Meta tokens.
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-content-server-'));
  try {
    const timer = startPublishScheduler(dir);
    assert.notEqual(timer, null);
    clearInterval(timer);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
    // startPublishScheduler fires one sweep immediately (not just on the
    // interval) — clearInterval only stops future ticks, so that first
    // sweep's async listCentralProjects()/writeJson calls can still be
    // in flight against `dir` right here. maxRetries/retryDelay lets rm's
    // own recursive-delete retry loop absorb that transient ENOTEMPTY/ENOENT
    // race instead of the cleanup itself failing the test.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('startWhatsAppPublishScheduler does not start when OPENSQUAD_ENABLE_REAL_PUBLISHING is not true', async () => {
  delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
  const timer = startWhatsAppPublishScheduler(process.cwd());
  assert.equal(timer, null);
});

test('startWhatsAppPublishScheduler starts independently of OPENSQUAD_AUTO_PUBLISH_SCHEDULER, which only gates the Meta-path scheduler', async () => {
  process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING = 'true';
  process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER = 'false';
  // Same safety rule as the startPublishScheduler test above: never point
  // this at process.cwd() with real publishing enabled — this sweeps for
  // due whatsapp_status content and would try to publish it for real
  // against the main OPENSQUAD checkout's live client projects.
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-content-server-'));
  try {
    const timer = startWhatsAppPublishScheduler(dir);
    assert.notEqual(timer, null);
    clearInterval(timer);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
    delete process.env.OPENSQUAD_AUTO_PUBLISH_SCHEDULER;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('startStuckMediaRetryScheduler does not start when OPENSQUAD_ENABLE_REAL_PUBLISHING is not true, even with OPENSQUAD_GAVETA_DIR set', async () => {
  delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
  process.env.OPENSQUAD_GAVETA_DIR = '/tmp/some-gaveta';
  try {
    const timer = startStuckMediaRetryScheduler(process.cwd());
    assert.equal(timer, null);
  } finally {
    delete process.env.OPENSQUAD_GAVETA_DIR;
  }
});

test('startStuckMediaRetryScheduler does not start when OPENSQUAD_GAVETA_DIR is unset, even with real publishing enabled', async () => {
  process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING = 'true';
  delete process.env.OPENSQUAD_GAVETA_DIR;
  try {
    const timer = startStuckMediaRetryScheduler(process.cwd());
    assert.equal(timer, null);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
  }
});

test('startStuckMediaRetryScheduler starts when both real publishing and OPENSQUAD_GAVETA_DIR are set', async () => {
  process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING = 'true';
  process.env.OPENSQUAD_GAVETA_DIR = '/tmp/some-gaveta';
  // Same safety rule as the other scheduler tests: an isolated temp dir, not
  // process.cwd(), since this sweeps for stuck media and would touch the
  // main OPENSQUAD checkout's live client projects otherwise.
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-content-server-'));
  try {
    const timer = startStuckMediaRetryScheduler(dir);
    assert.notEqual(timer, null);
    clearInterval(timer);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
    delete process.env.OPENSQUAD_GAVETA_DIR;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('startSocialSellingRadarScheduler does not start when OPENSQUAD_ENABLE_SOCIAL_SELLING is not true', async () => {
  delete process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING;
  const timer = startSocialSellingRadarScheduler(process.cwd());
  assert.equal(timer, null);
});

test('startSocialSellingRadarScheduler starts an interval when OPENSQUAD_ENABLE_SOCIAL_SELLING=true, independent of OPENSQUAD_ENABLE_REAL_PUBLISHING', async () => {
  delete process.env.OPENSQUAD_ENABLE_REAL_PUBLISHING;
  process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING = 'true';
  process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN = 'true';
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-social-selling-server-'));
  try {
    const timer = startSocialSellingRadarScheduler(dir);
    assert.notEqual(timer, null);
    clearInterval(timer);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING;
    delete process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('startSocialSellingEngagementScheduler does not start when OPENSQUAD_ENABLE_SOCIAL_SELLING is not true', async () => {
  delete process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING;
  const timer = startSocialSellingEngagementScheduler(process.cwd());
  assert.equal(timer, null);
});

test('startSocialSellingEngagementScheduler starts an interval when OPENSQUAD_ENABLE_SOCIAL_SELLING=true', async () => {
  process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING = 'true';
  process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN = 'true';
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-social-selling-server-'));
  try {
    const timer = startSocialSellingEngagementScheduler(dir);
    assert.notEqual(timer, null);
    clearInterval(timer);
  } finally {
    delete process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING;
    delete process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('startSocialSellingEngagementScheduler keeps sweeping on a jittered cadence and stops for good once its timer is cleared', async () => {
  process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING = 'true';
  process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN = 'true';
  process.env.OPENSQUAD_SOCIAL_SELLING_ENGAGEMENT_INTERVAL_MS = '20';
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-social-selling-server-'));
  let timer = null;
  try {
    const paths = getCentralPaths(dir);
    await mkdir(paths.root, { recursive: true });
    // All days, all hours — otherwise the sweep short-circuits on business
    // hours and never touches the state file when this test happens to run
    // at night or on a weekend.
    await writeFile(paths.socialSellingConfigPath, JSON.stringify({ businessHours: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24 } }), 'utf-8');

    timer = startSocialSellingEngagementScheduler(dir);
    assert.notEqual(timer, null);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let waited = 0; waited < 5000 && !existsSync(paths.socialSellingStatePath); waited += 25) await sleep(25);
    assert.equal(existsSync(paths.socialSellingStatePath), true, 'the scheduler never ran a sweep');

    clearInterval(timer);
    timer = null;
    await sleep(200); // let any sweep still in flight finish writing
    const stoppedAt = (await stat(paths.socialSellingStatePath)).mtimeMs;
    await sleep(400); // ~20 more ticks would have landed if the chain were alive
    assert.equal((await stat(paths.socialSellingStatePath)).mtimeMs, stoppedAt, 'clearInterval left the chain running');
  } finally {
    if (timer) clearInterval(timer);
    delete process.env.OPENSQUAD_ENABLE_SOCIAL_SELLING;
    delete process.env.OPENSQUAD_SOCIAL_SELLING_DRY_RUN;
    delete process.env.OPENSQUAD_SOCIAL_SELLING_ENGAGEMENT_INTERVAL_MS;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('syncTokenSecretsToGitHub sets three secrets when a gaveta repo is configured, passing the value via stdin not as a CLI arg', async () => {
  process.env.OPENSQUAD_GAVETA_REPO = 'someuser/gaveta';
  try {
    const calls = [];
    await syncTokenSecretsToGitHub('boss-pizzaria', { token: 'EAAB...', instagramUserId: '123', pageId: '456' }, {
      execFileAsync: async (cmd, args, input) => { calls.push({ cmd, args, input }); return { stdout: '' }; },
    });

    assert.equal(calls.length, 3);
    assert.ok(calls.every((c) => c.cmd === 'gh' && c.args[0] === 'secret' && c.args[1] === 'set'));
    assert.ok(calls.some((c) => c.args.includes('META_TOKEN_BOSS_PIZZARIA') && c.input === 'EAAB...'));
    assert.ok(calls.some((c) => c.args.includes('META_IG_USER_ID_BOSS_PIZZARIA') && c.input === '123'));
    assert.ok(calls.some((c) => c.args.includes('META_PAGE_ID_BOSS_PIZZARIA') && c.input === '456'));
    assert.ok(calls.every((c) => c.args.includes('--repo') && c.args.includes('someuser/gaveta')));
    // The secret values must never appear as literal CLI arguments (visible
    // to ps/tasklist) — only on the stdin `input` param.
    assert.ok(calls.every((c) => !c.args.includes('EAAB...') && !c.args.includes('123') && !c.args.includes('456')));
    assert.ok(calls.every((c) => !c.args.includes('--body')));
  } finally {
    delete process.env.OPENSQUAD_GAVETA_REPO;
  }
});

test('syncTokenSecretsToGitHub is a no-op when OPENSQUAD_GAVETA_REPO is unset', async () => {
  const calls = [];
  await syncTokenSecretsToGitHub('boss-pizzaria', { token: 'EAAB...' }, {
    execFileAsync: async (cmd, args, input) => { calls.push({ cmd, args, input }); return { stdout: '' }; },
  });
  assert.equal(calls.length, 0);
});

test('POST .../token calls syncTokenSecretsToGitHub after saving', async () => {
  await withServer(async (dir, server) => {
    process.env.OPENSQUAD_GAVETA_REPO = 'someuser/gaveta';
    try {
      const calls = [];
      const originalExecFileAsync = serverModule.__setExecFileAsyncForTests((cmd, args, input) => { calls.push({ cmd, args, input }); return Promise.resolve({ stdout: '' }); });

      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'gaveta-token', name: 'Gaveta Token', handle: '@gavetatoken', approvalEmail: 'a@example.com' }),
      });
      // Seed the project with a real Instagram User ID / Page ID the same
      // way validateMetaToken's real branch would (see
      // content-central.test.js's validateMetaToken tests for the shape) —
      // the real frontend (content-central-app/src/api/client.ts) only ever
      // sends { token, handle } on this route, never an `account` object, so
      // this must not come from the request body.
      await saveProjectToken('gaveta-token', {
        token: 'EAAB-prior-token',
        expiresAt: '2026-12-01T00:00:00.000Z',
        account: { handle: '@gavetatoken', instagramUserId: '123', pageId: '456' },
      }, dir);
      // expiresAt is supplied (unlike the brief's literal test body) so the
      // route takes the local-validation branch instead of calling the real
      // validateMetaToken -> graph.facebook.com, which would otherwise make
      // a real network call in this test — see task-7-report.md. No
      // top-level `handle` and no `account` in the body — saveProjectToken
      // preserves the instagramUserId/pageId seeded above when neither is
      // supplied on this call, exactly like a real re-save of the same token.
      const res = await request(server, '/api/projects/gaveta-token/token', {
        method: 'POST',
        body: JSON.stringify({ token: 'EAAB...', expiresAt: '2026-12-01T00:00:00.000Z' }),
      });

      assert.equal(res.response.status, 200);
      assert.equal(res.body.githubSyncWarning, undefined);
      const secretCalls = calls.filter((c) => c.cmd === 'gh' && c.args[0] === 'secret');
      assert.equal(secretCalls.length, 3);
      assert.ok(secretCalls.every((c) => !c.args.includes('EAAB...')));
      assert.ok(secretCalls.some((c) => c.args.includes('META_IG_USER_ID_GAVETA_TOKEN') && c.input === '123'));
      assert.ok(secretCalls.some((c) => c.args.includes('META_PAGE_ID_GAVETA_TOKEN') && c.input === '456'));
      serverModule.__setExecFileAsyncForTests(originalExecFileAsync);
    } finally {
      delete process.env.OPENSQUAD_GAVETA_REPO;
    }
  });
});

test('POST .../token still returns 200 with a githubSyncWarning when the GitHub sync fails', async () => {
  await withServer(async (dir, server) => {
    process.env.OPENSQUAD_GAVETA_REPO = 'someuser/gaveta';
    try {
      const originalExecFileAsync = serverModule.__setExecFileAsyncForTests(async () => {
        throw new Error('gh: command not found');
      });

      await request(server, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'gaveta-token-fail', name: 'Gaveta Token Fail', handle: '@gavetatokenfail', approvalEmail: 'a@example.com' }),
      });
      const res = await request(server, '/api/projects/gaveta-token-fail/token', {
        method: 'POST',
        body: JSON.stringify({ token: 'EAAB...', expiresAt: '2026-12-01T00:00:00.000Z' }),
      });

      assert.equal(res.response.status, 200);
      assert.equal(res.body.githubSyncWarning, 'gh: command not found');
      // the token save itself must still have gone through despite the sync failure
      assert.equal(res.body.project.token.configured, true);
      serverModule.__setExecFileAsyncForTests(originalExecFileAsync);
    } finally {
      delete process.env.OPENSQUAD_GAVETA_REPO;
    }
  });
});

// Regression for a bug found during Task 6 review (of the old
// project-nested routes; Task 3 of the global-learning-navigation plan moved
// this to a root-level route with no project in the URL): the
// segment-learnings routes (analyze-image/entries/entries-delete) always
// hardcoded `scope: 'segment'` when calling into content-central.js,
// silently discarding any `scope: 'offerType'` the client actually sent.
// This test goes through the real HTTP route (not the underlying
// saveLearningEntry function directly, which Task 5's tests already cover)
// to prove the route itself now respects an explicit scope: 'offerType' by
// writing to offer-type-learnings.json, not segment-learnings.json.
test('POST /api/segment-learnings/entries route respects scope: "offerType" from the client and writes to offer-type-learnings.json, not segment-learnings.json', async () => {
  await withServer(async (dir, server) => {
    const res = await request(server, '/api/segment-learnings/entries', {
      method: 'POST',
      body: JSON.stringify({
        scope: 'offerType',
        groupKey: 'combo',
        bucket: 'approved',
        kind: 'text',
        text: 'Route-level scope regression: must land in offer-type-learnings.json.',
      }),
    });

    assert.equal(res.response.status, 200);
    assert.equal(res.body.entries.length, 1);

    const offerTypeStorePath = join(dir, '_opensquad', 'content-central', 'offer-type-learnings.json');
    const offerTypeStore = JSON.parse(await readFile(offerTypeStorePath, 'utf8'));
    assert.equal(offerTypeStore.types.combo.entries.length, 1);
    assert.equal(offerTypeStore.types.combo.entries[0].text, 'Route-level scope regression: must land in offer-type-learnings.json.');

    const segmentStorePath = join(dir, '_opensquad', 'content-central', 'segment-learnings.json');
    if (existsSync(segmentStorePath)) {
      const segmentStore = JSON.parse(await readFile(segmentStorePath, 'utf8'));
      assert.ok(!JSON.stringify(segmentStore).includes('Route-level scope regression'), 'the entry must not have been written to segment-learnings.json');
    }
  });
});
