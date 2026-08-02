import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  approveContent,
  buildApprovalPayload,
  calculateTokenDaysRemaining,
  createCentralProject,
  deleteProjectContent,
  deleteProjectReference,
  enrichBatchItemsWithRealImages,
  generateCatalogSchedulePlan,
  generateContentBatch,
  generateContentSchedulePlan,
  getCentralPaths,
  listCentralProjects,
  listSystemAlerts,
  reconcileInterruptedGenerations,
  sendDueAlertEmails,
  listProjectReferences,
  listProjectContent,
  publishSingleContent,
  regenerateContentDay,
  regenerateContentGroup,
  researchOnlineVisualTrends,
  runDuePublishSweep,
  deleteProjectOffer,
  deleteProjectPillar,
  saveProjectOffer,
  saveProjectPillar,
  suggestProjectPillars,
  saveProjectAsset,
  saveProjectToken,
  simulateTestPost,
  updateContentCaption,
  animateContentForReels,
  analyzeProjectBrandXray,
  analyzeProjectBrandBriefing,
  approveProjectBrandXray,
  approveProjectBrandBriefing,
  updateProjectBrandInput,
  updateProjectCompanyProfile,
  updateProjectImageRules,
  validateMetaToken,
} from '../src/content-central.js';

async function withTempProject(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-content-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('createCentralProject creates isolated project files with global and project rules', async () => {
  await withTempProject(async (dir) => {
    const project = await createCentralProject({
      projectId: 'Novo Cliente Teste',
      name: 'Novo Cliente Teste',
      handle: '@novocliente',
      approvalEmail: 'aprovacao@example.com',
      mode: 'semi_automatic',
      projectRules: ['Usar azul e branco', 'Tom consultivo'],
    }, dir);

    assert.equal(project.projectId, 'novo-cliente-teste');
    assert.equal(project.mode, 'semi_automatic');
    assert.equal(project.instagram.handle, '@novocliente');
    assert.deepEqual(project.rules.project, ['Usar azul e branco', 'Tom consultivo']);

    const paths = getCentralPaths(dir, project.projectId);
    await stat(paths.globalRulesPath);
    await stat(paths.projectPath);
    await stat(paths.manualPath);

    const globalRules = JSON.parse(await readFile(paths.globalRulesPath, 'utf-8'));
    assert.ok(globalRules.rules.some((rule) => rule.text.includes('Não publicar sem aprovação')));
  });
});

test('company profile starts empty, can be updated, and feeds the image prompt raio-x', async () => {
  await withTempProject(async (dir) => {
    const project = await createCentralProject({
      projectId: 'clinica-sorriso',
      name: 'Clínica Sorriso',
      handle: '@clinicasorriso',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    assert.deepEqual(project.companyProfile, {
      segment: '',
      description: '',
      audience: '',
      location: '',
      productsOrServices: '',
      differentiators: '',
      primaryObjective: '',
      websiteOrInstagram: '',
      factualConstraints: '',
      tone: [],
      contentGoals: [],
      brandColors: '',
      avoid: '',
      positioning: '',
    });

    const updated = await updateProjectCompanyProfile('clinica-sorriso', {
      segment: 'Saúde e estética',
      description: 'Clínica odontológica local focada em atendimento humanizado.',
      audience: 'adultos da região que querem melhorar o sorriso com segurança',
      location: 'Campinas/SP',
      productsOrServices: 'clareamento dental, avaliação e limpeza',
      differentiators: 'explicação simples, atendimento calmo e equipe especializada',
      tone: ['educativo', 'autoridade', 'acolhedor', 'educativo'],
      contentGoals: ['authority', 'education', 'service', 'authority'],
      brandColors: 'branco, azul claro e dourado discreto',
      avoid: 'não prometer resultado garantido nem usar antes/depois sensacionalista',
      positioning: 'profissional, seguro e próximo',
    }, dir);

    assert.equal(updated.companyProfile.segment, 'Saúde e estética');
    assert.deepEqual(updated.companyProfile.tone, ['educativo', 'autoridade', 'acolhedor']);
    assert.deepEqual(updated.companyProfile.contentGoals, ['authority', 'education', 'service']);

    const batch = await generateContentBatch('clinica-sorriso', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_story',
      contentRules: ['Assunto atual: explicar clareamento dental sem vender agressivamente'],
    }, dir);
    const prompt = batch.items[0].image.prompt;

    assert.match(prompt, /INFORMAÇÕES FACTUAIS OBRIGATÓRIAS/i);
    assert.match(prompt, /Saúde e estética/);
    assert.match(prompt, /Clínica odontológica local/);
    assert.match(prompt, /clareamento dental, avaliação e limpeza/);
    assert.doesNotMatch(prompt, /Tom de voz: educativo, autoridade, acolhedor/);
    assert.doesNotMatch(prompt, /Interesses\/objetivos das postagens: Autoridade, Educativo, Serviço/);
    assert.match(prompt, /não prometer resultado garantido/i);
    assert.doesNotMatch(prompt, /programa para sair hoje e comer bem/i);
  });
});

test('brand xray input uses simple user facts and approved four-block analysis in prompts', async () => {
  await withTempProject(async (dir) => {
    const project = await createCentralProject({
      projectId: 'boss-xray',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    assert.deepEqual(project.brandInput, {
      brandName: '',
      segment: '',
      productsOrServices: '',
      description: '',
      serviceRegion: '',
      mainDifferential: '',
      contentGoals: [],
      audience: '',
      tone: [],
      avoid: '',
      positioning: '',
      brandColors: '',
      factualConstraints: '',
      websiteOrInstagram: '',
    });
    assert.equal(project.brandXray.status, 'empty');

    const updated = await updateProjectBrandInput('boss-xray', {
      brandName: 'Boss Pizzaria',
      segment: 'Pizzaria',
      productsOrServices: 'rodízio de pizzas, delivery, bebidas e atendimento no salão',
      description: 'Pizzaria familiar com rodízio de terça a domingo.',
      serviceRegion: 'Várzea Grande/MT',
      mainDifferential: 'Pizza bem recheada, ambiente familiar e rodízio completo',
      contentGoals: ['sell_products', 'promotions', 'whatsapp_orders', 'show_products', 'relationship', 'sell_products'],
    }, dir);

    assert.equal(updated.brandInput.segment, 'Pizzaria');
    assert.deepEqual(updated.brandInput.contentGoals, ['sell_products', 'promotions', 'whatsapp_orders', 'show_products', 'relationship']);
    assert.equal(updated.companyProfile.segment, 'Pizzaria');
    assert.equal(updated.companyProfile.location, 'Várzea Grande/MT');

    const before = await generateContentBatch('boss-xray', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_story',
    }, dir);
    assert.doesNotMatch(before.items[0].image.prompt, /RAIO-X APROVADO DA MARCA/);
    assert.match(before.items[0].image.prompt, /rodízio de pizzas, delivery/);

    const analyzed = await analyzeProjectBrandXray('boss-xray', {}, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.equal(analyzed.project.brandXray.status, 'generated');
    assert.deepEqual(Object.keys(analyzed.project.brandXray.blocks), ['summary', 'communication', 'contentStrategy', 'visualIdentity']);
    assert.match(analyzed.project.brandXray.blocks.summary.text, /Várzea Grande\/MT/);
    assert.match(analyzed.project.brandXray.blocks.communication.text, /Sugestão da IA/i);
    assert.match(analyzed.project.brandXray.blocks.contentStrategy.text, /Receber pedidos no WhatsApp/i);
    assert.match(analyzed.project.brandXray.blocks.visualIdentity.text, /não inventar/i);

    const approved = await approveProjectBrandXray('boss-xray', {
      edits: {
        communication: 'Sugestão da IA: tom próximo, convidativo, apetitoso e comercial.',
        visualIdentity: 'Extraído da logo/identidade: preto, vermelho, branco e dourado. Sugestão da IA: comida em destaque e alto contraste.',
      },
    }, dir, new Date('2026-07-20T12:05:00.000Z'));

    assert.equal(approved.project.brandXray.status, 'approved');
    assert.equal(approved.project.brandXray.blocks.summary.status, 'approved');
    assert.match(approved.project.brand.visualStyle, /Raio-X visual aprovado/);

    const after = await generateContentBatch('boss-xray', {
      days: 1,
      startDate: '2026-07-21',
      channel: 'instagram_story',
    }, dir);
    const prompt = after.items[0].image.prompt;

    assert.match(prompt, /RAIO-X APROVADO DA MARCA/);
    assert.match(prompt, /Resumo da marca/);
    assert.match(prompt, /tom próximo, convidativo/);
    assert.match(prompt, /Receber pedidos no WhatsApp/);
    assert.match(prompt, /preto, vermelho, branco e dourado/);
    assert.match(prompt, /Referência visual nunca pode alterar preço, logo, produto, nome, promoção ou informação factual/i);
  });
});

test('brand xray analysis uses an injected AI analyzer when provided, and falls back to the template on failure', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'boss-xray-ai',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectBrandInput('boss-xray-ai', {
      brandName: 'Boss Pizzaria',
      segment: 'Pizzaria',
      productsOrServices: 'rodízio de pizzas e delivery',
      serviceRegion: 'Várzea Grande/MT',
      contentGoals: ['sell_products'],
    }, dir);

    const fakeAnalyzer = async ({ project }) => {
      assert.equal(project.brandInput.segment, 'Pizzaria');
      return {
        summary: 'Resumo escrito pela IA de teste.',
        communication: 'Comunicação escrita pela IA de teste.',
        contentStrategy: 'Estratégia escrita pela IA de teste.',
        visualIdentity: 'Identidade visual escrita pela IA de teste.',
      };
    };

    const withAi = await analyzeProjectBrandXray('boss-xray-ai', {}, dir, new Date(), { brandAnalyzer: fakeAnalyzer });
    assert.equal(withAi.xray.source, 'ai_analysis');
    assert.equal(withAi.xray.blocks.summary.text, 'Resumo escrito pela IA de teste.');
    assert.ok(withAi.xray.blocks.summary.sources.includes('ai_suggestion'));

    const failingAnalyzer = async () => { throw new Error('provider offline'); };
    const withFailure = await analyzeProjectBrandXray('boss-xray-ai', {}, dir, new Date(), { brandAnalyzer: failingAnalyzer });
    assert.notEqual(withFailure.xray.blocks.summary.text, 'Resumo escrito pela IA de teste.');
    assert.match(withFailure.xray.blocks.summary.text, /Informado pelo usuário/);

    const partialAnalyzer = async () => ({ summary: 'Só o resumo veio da IA desta vez.' });
    const withPartial = await analyzeProjectBrandXray('boss-xray-ai', {}, dir, new Date(), { brandAnalyzer: partialAnalyzer });
    assert.equal(withPartial.xray.blocks.summary.text, 'Só o resumo veio da IA desta vez.');
    assert.match(withPartial.xray.blocks.communication.text, /Informado pelo usuário/);
  });
});

test('simulateTestPost uses the approved brand xray for content goal, segment, visual direction and CTA', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'teste-seguro-xray',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    await updateProjectBrandInput('teste-seguro-xray', {
      brandName: 'Boss Pizzaria',
      segment: 'Pizzaria',
      productsOrServices: 'rodízio de pizzas, delivery, bebidas e atendimento no salão',
      description: 'Pizzaria familiar com rodízio de terça a domingo.',
      serviceRegion: 'Várzea Grande/MT',
      mainDifferential: 'Pizza bem recheada, ambiente familiar e rodízio completo',
      contentGoals: ['whatsapp_orders', 'promotions'],
    }, dir);

    await saveProjectOffer('teste-seguro-xray', {
      name: 'Rodízio da casa',
      type: 'rodizio',
      price: 'R$49,90',
      items: 'pizzas salgadas e doces',
      cta: 'Peça agora no WhatsApp',
    }, dir, new Date('2026-07-20T11:00:00.000Z'));

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await saveProjectAsset('teste-seguro-xray', { kind: 'logo', filename: 'logo.png', dataUrl }, dir, new Date('2026-07-20T11:30:00.000Z'), {
      logoColorAnalyzer: async () => ['#000000', '#c1121f', '#ffffff', '#d4af37'],
    });

    await analyzeProjectBrandXray('teste-seguro-xray', {}, dir, new Date('2026-07-20T12:00:00.000Z'));
    const approved = await approveProjectBrandXray('teste-seguro-xray', {}, dir, new Date('2026-07-20T12:05:00.000Z'));
    assert.equal(approved.project.brandXray.status, 'approved');

    const content = await simulateTestPost('teste-seguro-xray', {
      channel: 'instagram_story',
      note: 'teste após raio-x aprovado',
      imageGenerator: async ({ content: draft }) => ({
        url: 'https://cdn.example.com/story.png',
        mimeType: 'image/png',
        prompt: draft.image.prompt,
      }),
    }, dir, new Date('2026-07-20T12:10:00.000Z'));

    const prompt = content.image.prompt;
    // buildCreativeObjective must prefer the offer's own specific objective
    // (naming the real product) over the generic type-based fallback string.
    assert.match(prompt, /Criar chamada para rodízio de Rodízio da casa, destacando itens inclusos, preço e convite para aproveitar/);
    assert.match(prompt, /Pizzaria/);
    assert.match(prompt, /Cores da marca a respeitar: #000000, #c1121f, #ffffff, #d4af37\./);
    assert.match(prompt, /Rodízio da casa/);
    assert.match(prompt, /Peça agora no WhatsApp/);
    assert.equal(content.publish.dryRun, true);
    assert.equal(content.publish.realPublished, false);
    assert.equal(content.image.generatedSource, 'ai');
  });
});

test('logo upload uses an injected AI color analyzer when provided, and falls back to local pixel extraction otherwise', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'logo-cores',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const fakeColorAnalyzer = async ({ mimeType }) => {
      assert.equal(mimeType, 'image/png');
      return ['#112233', '#445566', 'not-a-color'];
    };
    const withAi = await saveProjectAsset('logo-cores', { kind: 'logo', filename: 'logo.png', dataUrl }, dir, new Date(), { logoColorAnalyzer: fakeColorAnalyzer });
    assert.deepEqual(withAi.project.brandIdentity.extractedColors, ['#112233', '#445566']);

    const failingColorAnalyzer = async () => { throw new Error('vision provider offline'); };
    const withFallback = await saveProjectAsset('logo-cores', { kind: 'logo', filename: 'logo.png', dataUrl }, dir, new Date(), { logoColorAnalyzer: failingColorAnalyzer });
    assert.ok(Array.isArray(withFallback.project.brandIdentity.extractedColors));
  });
});

test('brand briefing is generated from factual company info and only approved briefing enters prompts', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'boss-briefing',
      name: 'Boss Pizzaria & Choperia',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    await updateProjectCompanyProfile('boss-briefing', {
      segment: 'Pizzaria e choperia',
      description: 'Restaurante local com rodízio, delivery e ambiente para grupos.',
      productsOrServices: 'pizzas, rodízio, delivery, chopp e esfihas',
      location: 'Campinas/SP',
      differentiators: 'ambiente noturno, preço acessível e variedade de sabores',
      audience: 'famílias e grupos de amigos da região',
      primaryObjective: 'atrair pedidos e visitas no salão sem inventar promoção',
      websiteOrInstagram: '@bosspizzaria',
      factualConstraints: 'não inventar frete grátis, preço ou horário de funcionamento',
      tone: ['premium'],
      contentGoals: ['authority'],
      positioning: 'campo antigo não aprovado ainda',
    }, dir);

    const generatedBeforeApproval = await generateContentBatch('boss-briefing', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_story',
    }, dir);
    const beforePrompt = generatedBeforeApproval.items[0].image.prompt;

    assert.match(beforePrompt, /INFORMAÇÕES FACTUAIS OBRIGATÓRIAS/);
    assert.match(beforePrompt, /pizzas, rodízio, delivery, chopp e esfihas/);
    assert.match(beforePrompt, /não inventar frete grátis/);
    assert.doesNotMatch(beforePrompt, /campo antigo não aprovado ainda/);
    assert.doesNotMatch(beforePrompt, /Tom de voz: premium/);

    const analyzed = await analyzeProjectBrandBriefing('boss-briefing', {}, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.equal(analyzed.project.brandBriefing.status, 'generated');
    assert.equal(analyzed.project.brandBriefing.approvedAt, null);
    assert.ok(analyzed.project.brandBriefing.blocks.summary.text.includes('Pizzaria e choperia'));
    assert.ok(analyzed.project.brandBriefing.blocks.positioning.text.includes('sugerido'));
    assert.ok(analyzed.project.brandBriefing.blocks.missingInfo.text.length > 0);

    const generatedStillUnapproved = await generateContentBatch('boss-briefing', {
      days: 1,
      startDate: '2026-07-21',
      channel: 'instagram_story',
    }, dir);
    assert.doesNotMatch(generatedStillUnapproved.items[0].image.prompt, /BRIEFING APROVADO DA MARCA/);

    const approved = await approveProjectBrandBriefing('boss-briefing', {
      edits: {
        tone: 'próximo, apetitoso, descontraído e comercial',
        contentPillars: 'Produtos e sabores\nRodízio\nPromoções\nBastidores\nProva social',
        visualDirection: 'fundo escuro, tons quentes, comida em destaque, contraste forte e visual premium',
      },
    }, dir, new Date('2026-07-20T12:05:00.000Z'));

    assert.equal(approved.project.brandBriefing.status, 'approved');
    assert.equal(approved.project.brandBriefing.blocks.tone.status, 'approved');
    assert.match(approved.project.brand.visualStyle, /Direção visual consolidada/);
    assert.match(approved.project.brand.visualStyle, /fundo escuro/);

    const generatedAfterApproval = await generateContentBatch('boss-briefing', {
      days: 1,
      startDate: '2026-07-22',
      channel: 'instagram_story',
    }, dir);
    const afterPrompt = generatedAfterApproval.items[0].image.prompt;

    assert.match(afterPrompt, /BRIEFING APROVADO DA MARCA/);
    assert.match(afterPrompt, /próximo, apetitoso, descontraído e comercial/);
    assert.match(afterPrompt, /Produtos e sabores/);
    assert.match(afterPrompt, /DIREÇÃO VISUAL CONSOLIDADA/);
    assert.match(afterPrompt, /Referência visual nunca pode alterar preço, logo, produto, nome, promoção ou informação factual/i);
  });
});

test('reference categories apply automatic rules and prompt hierarchy prevents visual references from overriding facts', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'referencias-novas',
      name: 'Referências Novas',
      handle: '@refsnovas',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const official = await saveProjectAsset('referencias-novas', {
      kind: 'reference',
      filename: 'logo-oficial.png',
      dataUrl: `data:image/png;base64,${Buffer.from('official-logo').toString('base64')}`,
      referenceCategory: 'official_asset',
      useInNextGeneration: true,
      instruction: 'Logo oficial da marca',
    }, dir);
    const realPhoto = await saveProjectAsset('referencias-novas', {
      kind: 'reference',
      filename: 'produto-real.png',
      dataUrl: `data:image/png;base64,${Buffer.from('real-product').toString('base64')}`,
      referenceCategory: 'real_product',
      useInNextGeneration: true,
    }, dir);
    const inspiration = await saveProjectAsset('referencias-novas', {
      kind: 'reference',
      filename: 'flyer-concorrente.png',
      dataUrl: `data:image/png;base64,${Buffer.from('competitor-flyer').toString('base64')}`,
      referenceCategory: 'visual_inspiration',
      useInNextGeneration: true,
      weight: 'high',
      instruction: 'Gostei da hierarquia e iluminação',
    }, dir);

    assert.equal(official.metadata.referenceCategory, 'official_asset');
    assert.equal(official.metadata.role, 'brand_asset');
    assert.match(official.metadata.automaticRule, /Preservar exatamente/);
    assert.equal(realPhoto.metadata.referenceCategory, 'real_product');
    assert.match(realPhoto.metadata.automaticRule, /Preservar a aparência real/);
    assert.equal(inspiration.metadata.referenceCategory, 'visual_inspiration');
    assert.match(inspiration.metadata.automaticRule, /apenas como inspiração visual/i);

    const refs = await listProjectReferences('referencias-novas', dir);
    assert.equal(refs.length, 3);
    assert.equal(refs.every((ref) => ref.useInNextGeneration === true), true);

    const batch = await generateContentBatch('referencias-novas', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_feed',
      contentRules: ['Preço factual obrigatório: R$ 49,99'],
    }, dir);
    const prompt = batch.items[0].image.prompt;

    assert.match(prompt, /HIERARQUIA OBRIGATÓRIA DO PROMPT/);
    assert.match(prompt, /Ativos oficiais/);
    assert.match(prompt, /Fotos reais dos produtos/);
    assert.match(prompt, /Referências visuais/);
    assert.match(prompt, /Preservar exatamente o ativo enviado/);
    assert.match(prompt, /Preservar a aparência real/);
    assert.match(prompt, /Utilizar apenas como inspiração visual/);
    assert.match(prompt, /R\$ 49,99/);
  });
});

test('saveProjectToken stores token outside project config and records masked validity metadata', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'token-demo',
      name: 'Token Demo',
      handle: '@tokendemo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const updated = await saveProjectToken('token-demo', {
      token: 'EAAB-real-token-secret-1234567890',
      expiresAt: '2026-08-14T12:00:00.000Z',
      permissions: ['instagram_content_publish'],
      account: { instagramUserId: '1789', pageId: '123', handle: '@tokendemo' },
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    assert.equal(updated.token.configured, true);
    assert.equal(updated.token.masked, '****7890');
    assert.equal(updated.token.daysRemaining, 30);
    assert.equal(updated.instagram.instagramUserId, '1789');

    const paths = getCentralPaths(dir, 'token-demo');
    const configRaw = await readFile(paths.projectPath, 'utf-8');
    assert.equal(configRaw.includes('EAAB-real-token-secret'), false);

    const secretRaw = await readFile(paths.tokenSecretPath, 'utf-8');
    assert.equal(secretRaw, 'EAAB-real-token-secret-1234567890');
  });
});

test('saveProjectToken marks a token with no known expiration as valid instead of "about to expire"', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'token-permanente',
      name: 'Token Permanente',
      handle: '@tokenpermanente',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    // Meta reports expires_at: 0 for permanent Page/System User tokens; the
    // route layer turns that into expiresAt: null before calling here — no
    // `null <= 10` should ever slip this into "vence_em_breve".
    const updated = await saveProjectToken('token-permanente', {
      token: 'EAAB-permanent-token-1234567890',
      expiresAt: null,
      permissions: ['instagram_content_publish'],
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    assert.equal(updated.token.configured, true);
    assert.equal(updated.token.expiresAt, null);
    assert.equal(updated.token.daysRemaining, null);
    assert.equal(updated.token.status, 'valido');
  });
});

test('calculateTokenDaysRemaining rounds future validity up and clamps expired tokens at zero', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  assert.equal(calculateTokenDaysRemaining('2026-07-16T11:00:00.000Z', now), 1);
  assert.equal(calculateTokenDaysRemaining('2026-07-17T12:00:00.000Z', now), 2);
  assert.equal(calculateTokenDaysRemaining('2026-07-14T12:00:00.000Z', now), 0);
});

test('validateMetaToken derives expiry days from only the pasted token', async () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  const expiresAtUnix = Math.floor(Date.parse('2026-08-14T12:00:00.000Z') / 1000);
  const calls = [];
  const fakeFetch = async (url) => {
    const urlStr = String(url);
    calls.push(urlStr);
    if (urlStr.includes('debug_token')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            is_valid: true,
            expires_at: expiresAtUnix,
            scopes: ['instagram_content_publish', 'pages_show_list'],
            user_id: '12345',
          },
        }),
      };
    }
    if (urlStr.includes('/me/accounts')) {
      return { ok: true, json: async () => ({ data: [{ id: '107938912006111', name: 'Boss Pizzaria' }] }) };
    }
    if (urlStr.includes('107938912006111')) {
      return { ok: true, json: async () => ({ instagram_business_account: { id: '17841454459517363' } }) };
    }
    throw new Error(`unexpected fetch call: ${urlStr}`);
  };

  const validation = await validateMetaToken('EAAB-token-from-panel', { fetchImpl: fakeFetch, now });

  assert.equal(validation.expiresAt, '2026-08-14T12:00:00.000Z');
  assert.equal(validation.daysRemaining, 30);
  assert.deepEqual(validation.permissions, ['instagram_content_publish', 'pages_show_list']);
  // The real Instagram Business Account ID (resolved via the connected
  // Facebook Page) must never be confused with /debug_token's own
  // user_id/profile_id — those belong to the Facebook user, not the
  // Instagram account, and publishing to them fails with a Graph API error.
  assert.equal(validation.account.instagramUserId, '17841454459517363');
  assert.equal(validation.account.pageId, '107938912006111');
  assert.equal(calls.length, 3);
  assert.ok(calls[0].includes('debug_token'));
  assert.equal(calls[0].includes('EAAB-token-from-panel'), true);
});

test('validateMetaToken keeps the account empty (not the debug_token user_id) when no Page/Instagram link resolves', async () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  const fakeFetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('debug_token')) {
      return { ok: true, json: async () => ({ data: { is_valid: true, scopes: [], user_id: '999999' } }) };
    }
    if (urlStr.includes('/me/accounts')) {
      return { ok: true, json: async () => ({ data: [] }) };
    }
    throw new Error(`unexpected fetch call: ${urlStr}`);
  };

  const validation = await validateMetaToken('EAAB-no-pages-token', { fetchImpl: fakeFetch, now });

  assert.equal(validation.account.instagramUserId, '');
  assert.equal(validation.account.pageId, '');
});

test('generateContentBatch creates one editable content card per day using all rule levels', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'conteudo-demo',
      name: 'Conteúdo Demo',
      handle: '@conteudodemo',
      approvalEmail: 'aprovacao@example.com',
      projectRules: ['Usar visual premium'],
    }, dir);

    const batch = await generateContentBatch('conteudo-demo', {
      days: 3,
      startDate: '2026-07-20',
      channel: 'instagram_feed',
      contentRules: ['Focar em autoridade local'],
    }, dir);

    assert.equal(batch.items.length, 3);
    assert.equal(batch.items[0].dayNumber, 1);
    assert.equal(batch.items[0].scheduledDate, '2026-07-20');
    assert.equal(batch.items[1].scheduledDate, '2026-07-21');
    assert.equal(batch.items[0].status, 'draft_generated');
    assert.ok(batch.items[0].generationContext.globalRules.length > 0);
    assert.deepEqual(batch.items[0].generationContext.projectRules, ['Usar visual premium']);
    assert.deepEqual(batch.items[0].generationContext.contentRules, ['Focar em autoridade local']);
  });
});

test('updateProjectImageRules saves editable visual rules and uses them in image prompts', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'regras-imagem',
      name: 'Regras Imagem',
      handle: '@regrasimagem',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const updated = await updateProjectImageRules('regras-imagem', {
      visualStyle: 'fotografia realista de pizzaria local',
      imageRules: [
        'Usar pizza com queijo derretendo',
        'Preço grande e legível',
        'Nunca repetir palavras no texto da imagem',
      ],
    }, dir);

    assert.equal(updated.brand.visualStyle, 'fotografia realista de pizzaria local');
    assert.deepEqual(updated.brand.imageRules, [
      'Usar pizza com queijo derretendo',
      'Preço grande e legível',
      'Nunca repetir palavras no texto da imagem',
    ]);

    const batch = await generateContentBatch('regras-imagem', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_story',
    }, dir);

    assert.match(batch.items[0].image.prompt, /fotografia realista de pizzaria local/);
    assert.match(batch.items[0].image.prompt, /Usar pizza com queijo derretendo/);
    assert.match(batch.items[0].image.prompt, /Nunca repetir palavras/);
  });
});

test('researchOnlineVisualTrends folds real online findings into image rules, tagged with the date, without wiping rules the operator wrote by hand', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'pesquisa-online',
      name: 'Pesquisa Online',
      handle: '@pesquisaonline',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectCompanyProfile('pesquisa-online', {
      segment: 'Pizzaria',
      productsOrServices: 'Pizzas e esfihas',
    }, dir);
    await updateProjectImageRules('pesquisa-online', {
      imageRules: ['Regra escrita à mão pelo operador'],
    }, dir);

    const result = await researchOnlineVisualTrends('pesquisa-online', {
      webResearcher: async () => 'Fundo escuro com foto do produto centralizada\nPreço em selo circular colorido no canto inferior',
    }, dir, new Date('2026-07-27T12:00:00.000Z'));

    assert.equal(result.findings.length, 2);
    assert.match(result.findings[0], /^\[Pesquisa online\] Fundo escuro/);
    assert.equal(result.researchedAt, '2026-07-27T12:00:00.000Z');

    const batch = await generateContentBatch('pesquisa-online', { days: 1, startDate: '2026-07-20', channel: 'instagram_feed' }, dir);
    assert.match(batch.items[0].image.prompt, /Fundo escuro com foto do produto centralizada/);
    assert.match(batch.items[0].image.prompt, /Regra escrita à mão pelo operador/);
  });
});

test('researchOnlineVisualTrends replaces its own previous findings on a new run instead of stacking forever', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'pesquisa-atualiza',
      name: 'Pesquisa Atualiza',
      handle: '@pesquisaatualiza',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectCompanyProfile('pesquisa-atualiza', { segment: 'Pizzaria', productsOrServices: 'Pizzas' }, dir);

    await researchOnlineVisualTrends('pesquisa-atualiza', {
      webResearcher: async () => 'Achado antigo e ultrapassado',
    }, dir, new Date('2026-07-01T12:00:00.000Z'));
    await researchOnlineVisualTrends('pesquisa-atualiza', {
      webResearcher: async () => 'Achado novo e atual',
    }, dir, new Date('2026-07-27T12:00:00.000Z'));

    const batch = await generateContentBatch('pesquisa-atualiza', { days: 1, startDate: '2026-07-20', channel: 'instagram_feed' }, dir);
    assert.match(batch.items[0].image.prompt, /Achado novo e atual/);
    assert.doesNotMatch(batch.items[0].image.prompt, /Achado antigo e ultrapassado/);
  });
});

test('researchOnlineVisualTrends requires a webResearcher and a registered segment/products, and rejects an empty result instead of silently doing nothing', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'pesquisa-erros',
      name: 'Pesquisa Erros',
      handle: '@pesquisaerros',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    await assert.rejects(
      () => researchOnlineVisualTrends('pesquisa-erros', {}, dir),
      /Nenhum pesquisador online configurado/,
    );

    await assert.rejects(
      () => researchOnlineVisualTrends('pesquisa-erros', { webResearcher: async () => 'algo' }, dir),
      /Cadastre o segmento\/produtos/,
    );

    await updateProjectCompanyProfile('pesquisa-erros', { segment: 'Pizzaria', productsOrServices: 'Pizzas' }, dir);
    await assert.rejects(
      // Resolves without throwing but with nothing usable (blank/whitespace
      // response) — must not be silently treated as "done, nothing to add".
      () => researchOnlineVisualTrends('pesquisa-erros', { webResearcher: async () => '   ' }, dir),
      /não retornou nenhum achado/,
    );
  });
});

test('generated image prompts include uploaded visual references for the whole project', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'referencia-visual',
      name: 'Referência Visual',
      handle: '@referenciavisual',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    await saveProjectAsset('referencia-visual', {
      kind: 'reference',
      filename: 'flyer-rodizio.png',
      dataUrl: `data:image/png;base64,${Buffer.from('fake-reference').toString('base64')}`,
    }, dir);
    await updateProjectImageRules('referencia-visual', {
      visualStyle: 'flyer promocional de rodízio, não foto genérica',
      imageRules: ['Seguir a referência visual do projeto', 'Usar cards de preço legíveis'],
    }, dir);

    const batch = await generateContentBatch('referencia-visual', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_story',
    }, dir);

    assert.match(batch.items[0].image.prompt, /REFERÊNCIAS VISUAIS DO PROJETO/i);
    assert.match(batch.items[0].image.prompt, /assets\/references\/flyer-rodizio.png/);
    assert.match(batch.items[0].image.prompt, /flyer promocional de rodízio/);
    assert.match(batch.items[0].image.prompt, /cards de preço legíveis/);
  });
});

test('project references keep visible metadata, allow more than 20 files, and can be deleted', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'referencias-metadata',
      name: 'Referências Metadata',
      handle: '@refsmetadata',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const first = await saveProjectAsset('referencias-metadata', {
      kind: 'reference',
      filename: 'Modelo Rodizio.png',
      dataUrl: `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`,
      role: 'layout_model',
      weight: 'high',
      instruction: 'Copiar composição de flyer promocional, cards de preço e hierarquia.',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    assert.equal(first.metadata.role, 'layout_model');
    assert.equal(first.metadata.weight, 'high');
    assert.match(first.metadata.instruction, /cards de preço/);
    assert.equal(first.metadata.previewUrl, '/api/projects/referencias-metadata/assets/assets/references/modelo-rodizio.png');

    const references = await listProjectReferences('referencias-metadata', dir);
    assert.equal(references.length, 1);
    assert.equal(references[0].filename, 'modelo-rodizio.png');
    assert.equal(references[0].mimeType, 'image/png');

    for (let index = 2; index <= 21; index += 1) {
      await saveProjectAsset('referencias-metadata', {
        kind: 'reference',
        filename: `Referencia ${index}.png`,
        dataUrl: `data:image/png;base64,${Buffer.from(`fake-${index}`).toString('base64')}`,
        role: 'product_photo',
        weight: 'medium',
      }, dir);
    }

    const afterMany = await listProjectReferences('referencias-metadata', dir);
    assert.equal(afterMany.length, 21);

    const deleted = await deleteProjectReference('referencias-metadata', 'assets/references/modelo-rodizio.png', dir);
    assert.equal(deleted.deleted, true);
    const afterDelete = await listProjectReferences('referencias-metadata', dir);
    assert.equal(afterDelete.length, 20);
    assert.equal(afterDelete.some((reference) => reference.relativePath === 'assets/references/modelo-rodizio.png'), false);
  });
});

test('generated image prompts use simple reference guidance without priority blocks', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'prioridade-marca',
      name: 'Prioridade Marca',
      handle: '@prioridademarca',
      approvalEmail: 'aprovacao@example.com',
      projectRules: ['Tom premium e marca amarela obrigatória'],
    }, dir);

    await saveProjectAsset('prioridade-marca', {
      kind: 'reference',
      filename: 'flyer-inspiracao.png',
      dataUrl: `data:image/png;base64,${Buffer.from('layout').toString('base64')}`,
      role: 'layout_model',
      weight: 'high',
      order: 1,
      instruction: 'Copiar somente hierarquia e distribuição dos cards.',
    }, dir);
    await saveProjectAsset('prioridade-marca', {
      kind: 'reference',
      filename: 'logo-oficial.png',
      dataUrl: `data:image/png;base64,${Buffer.from('logo').toString('base64')}`,
      role: 'brand_asset',
      weight: 'high',
      order: 2,
      instruction: 'Logo oficial. Não redesenhar, não mudar cor e reservar área segura.',
    }, dir);
    await saveProjectAsset('prioridade-marca', {
      kind: 'reference',
      filename: 'foto-produto.png',
      dataUrl: `data:image/png;base64,${Buffer.from('produto').toString('base64')}`,
      role: 'product_photo',
      weight: 'medium',
      order: 3,
      instruction: 'Produto real. Não alterar sabor nem aparência principal.',
    }, dir);
    await saveProjectAsset('prioridade-marca', {
      kind: 'reference',
      filename: 'referencia-antiga.png',
      dataUrl: `data:image/png;base64,${Buffer.from('inactive').toString('base64')}`,
      role: 'visual_reference',
      active: false,
      instruction: 'Não deve entrar no prompt quando desativada.',
    }, dir);
    await updateProjectImageRules('prioridade-marca', {
      visualStyle: 'fotografia realista com iluminação quente',
      imageRules: ['Texto curto e legível', 'Não inventar preço'],
    }, dir);

    const batch = await generateContentBatch('prioridade-marca', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_story',
      contentRules: ['Oferta atual: delivery pelo WhatsApp'],
    }, dir);
    const prompt = batch.items[0].image.prompt;

    assert.match(prompt, /OBJETIVO/);
    assert.match(prompt, /REGRAS DE SEGURANÇA/);
    assert.match(prompt, /HIERARQUIA OBRIGATÓRIA DO PROMPT/);
    assert.match(prompt, /INFORMAÇÕES FACTUAIS OBRIGATÓRIAS/);
    assert.match(prompt, /REFERÊNCIAS VISUAIS DO PROJETO/);
    assert.match(prompt, /DIREÇÃO VISUAL CONSOLIDADA/);
    assert.match(prompt, /INSTRUÇÃO DO CONTEÚDO ATUAL/);
    assert.match(prompt, /RESTRIÇÕES FINAIS/);
    assert.match(prompt, /Logo\/marca/);
    assert.match(prompt, /Oferta atual: delivery pelo WhatsApp/);
    assert.equal(prompt.includes('referencia-antiga.png'), false);

    assert.ok(prompt.indexOf('flyer-inspiracao.png') < prompt.indexOf('foto-produto.png'));
    assert.ok(prompt.indexOf('Oferta atual: delivery pelo WhatsApp') < prompt.indexOf('VARIAÇÃO CRIATIVA'));
  });
});

test('layout references are included directly again in the simple 16h reference flow', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'logo-segura',
      name: 'Logo Segura',
      handle: '@logosegura',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectAsset('logo-segura', {
      kind: 'reference',
      filename: 'flyer-concorrente.png',
      dataUrl: `data:image/png;base64,${Buffer.from('layout-with-competitor-logo').toString('base64')}`,
      role: 'layout_model',
      weight: 'high',
      instruction: 'Usar o layout do flyer, mas ele contém marca de outra empresa.',
    }, dir);
    await saveProjectAsset('logo-segura', {
      kind: 'reference',
      filename: 'pizza-real.png',
      dataUrl: `data:image/png;base64,${Buffer.from('real-product').toString('base64')}`,
      role: 'product_photo',
      weight: 'high',
      instruction: 'Foto real do produto.',
    }, dir);

    const batch = await generateContentBatch('logo-segura', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_story',
    }, dir);
    const item = batch.items[0];

    assert.match(item.image.prompt, /Modelo de layout/);
    assert.match(item.image.prompt, /Usar o layout do flyer/);
    assert.equal(item.image.references.some((reference) => reference.relativePath.endsWith('flyer-concorrente.png')), true);
    assert.equal(item.image.references.some((reference) => reference.relativePath.endsWith('pizza-real.png')), true);
  });
});

test('references can carry multiple selected uses such as layout product and copy', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'multiuso-referencia',
      name: 'Multiuso Referencia',
      handle: '@multiuso',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const asset = await saveProjectAsset('multiuso-referencia', {
      kind: 'reference',
      filename: 'modelo-produto-copy.png',
      dataUrl: `data:image/png;base64,${Buffer.from('layout-product-copy').toString('base64')}`,
      role: 'layout_model',
      usageRoles: ['layout_model', 'product_photo', 'text_parameter'],
      weight: 'high',
      instruction: 'Gosto do formato, da copy curta e do destaque do produto.',
    }, dir);

    assert.deepEqual(asset.metadata.usageRoles, ['layout_model', 'product_photo', 'text_parameter']);

    const batch = await generateContentBatch('multiuso-referencia', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_feed',
    }, dir);
    const prompt = batch.items[0].image.prompt;

    assert.match(prompt, /funções: Modelo de layout, Foto\/produto, Parâmetro textual/);
    assert.match(prompt, /Gosto do formato, da copy curta e do destaque do produto/);
  });
});

test('image prompt uses stable flyer-style generation and keeps text inside safe areas', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'stable-flyer-image',
      name: 'Stable Flyer Image',
      handle: '@stableflyer',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const batch = await generateContentBatch('stable-flyer-image', {
      days: 1,
      channel: 'instagram_feed',
      startDate: '2026-07-20',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));
    const prompt = batch.items[0].image.prompt;

    assert.match(prompt, /anúncio\/flyer simples/i);
    assert.match(prompt, /selo de preço legível/i);
    assert.match(prompt, /área segura/i);
    assert.match(prompt, /nunca deixar letras cortadas/i);
    assert.doesNotMatch(prompt, /imagem base limpa/i);
  });
});

test('image prompt requires uploaded logo to appear and uses product visual and layout references', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'referencias-completas',
      name: 'Referências Completas',
      handle: '@referenciascompletas',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectAsset('referencias-completas', {
      kind: 'logo',
      filename: 'marca.png',
      dataUrl: `data:image/png;base64,${Buffer.from('logo-real').toString('base64')}`,
    }, dir);
    await saveProjectAsset('referencias-completas', {
      kind: 'reference',
      filename: 'produto.png',
      dataUrl: `data:image/png;base64,${Buffer.from('produto-real').toString('base64')}`,
      role: 'product_photo',
      weight: 'high',
      instruction: 'Produto real que deve guiar aparência e apetite.',
    }, dir);
    await saveProjectAsset('referencias-completas', {
      kind: 'reference',
      filename: 'visual.png',
      dataUrl: `data:image/png;base64,${Buffer.from('visual').toString('base64')}`,
      role: 'visual_reference',
      weight: 'medium',
      instruction: 'Clima visual e cores.',
    }, dir);
    await saveProjectAsset('referencias-completas', {
      kind: 'reference',
      filename: 'layout.png',
      dataUrl: `data:image/png;base64,${Buffer.from('layout').toString('base64')}`,
      role: 'layout_model',
      weight: 'medium',
      instruction: 'Composição e distribuição dos elementos.',
    }, dir);

    const batch = await generateContentBatch('referencias-completas', {
      days: 1,
      channel: 'instagram_feed',
      startDate: '2026-07-20',
    }, dir);
    const item = batch.items[0];

    assert.match(item.image.prompt, /LOGO DO PROJETO/);
    assert.match(item.image.prompt, /A logo\/marca cadastrada deve aparecer no criativo/i);
    assert.match(item.image.prompt, /onde ficar melhor no criativo/i);
    assert.match(item.image.prompt, /assets\/logo.png/);
    assert.match(item.image.prompt, /produto.png.*Foto\/produto/s);
    assert.match(item.image.prompt, /visual.png.*Referência visual/s);
    assert.match(item.image.prompt, /layout.png.*Modelo de layout/s);
    assert.equal(item.image.references.some((reference) => reference.relativePath === 'assets/logo.png'), true);
    assert.equal(item.image.references.some((reference) => reference.relativePath.endsWith('produto.png')), true);
    assert.equal(item.image.references.some((reference) => reference.relativePath.endsWith('visual.png')), true);
    assert.equal(item.image.references.some((reference) => reference.relativePath.endsWith('layout.png')), true);
  });
});

test('project logo upload is stored without automatic overlay in local previews', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'overlay-logo',
      name: 'Overlay Logo',
      handle: '@overlaylogo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectAsset('overlay-logo', {
      kind: 'logo',
      filename: 'logo.svg',
      dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>LOGO OFICIAL</text></svg>').toString('base64')}`,
    }, dir);

    const batch = await generateContentBatch('overlay-logo', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_feed',
    }, dir);
    const item = batch.items[0];
    const svg = Buffer.from(item.image.previewDataUrl.split(',')[1], 'base64').toString('utf-8');

    assert.equal(item.image.logoOverlay, undefined);
    assert.doesNotMatch(item.image.prompt, /Logo oficial do projeto/);
    assert.doesNotMatch(svg, /<image/);
    assert.doesNotMatch(svg, /data:image\/svg\+xml;base64/);
  });
});

test('AI image results keep the raw ChatGPT-designed final image without automatic overlay composition', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'ai-overlay-logo',
      name: 'AI Overlay Logo',
      handle: '@aioverlaylogo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectAsset('ai-overlay-logo', {
      kind: 'logo',
      filename: 'logo.svg',
      dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>LOGO FINAL</text></svg>').toString('base64')}`,
    }, dir);

    const content = await simulateTestPost('ai-overlay-logo', {
      channel: 'instagram_story',
      imageGenerator: async () => ({
        url: 'https://cdn.example.com/generated-story.png',
        mimeType: 'image/png',
      }),
    }, dir, new Date('2026-07-15T12:00:00.000Z'));
    assert.equal(content.image.generatedSource, 'ai');
    assert.equal(content.image.previewUrl, 'https://cdn.example.com/generated-story.png');
    assert.equal(content.image.url, 'https://cdn.example.com/generated-story.png');
    assert.equal(content.image.logoApplied, undefined);
    assert.equal(content.image.previewMode, 'direct_ai_css_cover');
    assert.equal(content.image.previewFit, 'cover');
    assert.equal(content.image.composition, undefined);
    assert.equal(content.image.baseUrl, undefined);
    assert.doesNotMatch(content.image.previewDataUrl || '', /cdn\.example\.com\/generated-story\.png/);
  });
});

test('projects without an uploaded logo do not receive logo overlay metadata', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'sem-logo',
      name: 'Sem Logo',
      handle: '@semlogo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const batch = await generateContentBatch('sem-logo', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_story',
    }, dir);

    assert.equal(batch.items[0].image.logoOverlay, undefined);
    assert.doesNotMatch(batch.items[0].image.prompt, /Projeto sem logo oficial cadastrada/);
  });
});

test('deleteProjectContent removes a generated content card and local preview file', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'apagar-conteudo',
      name: 'Apagar Conteúdo',
      handle: '@apagarconteudo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('apagar-conteudo', { days: 1, startDate: '2026-07-20' }, dir);
    const content = batch.items[0];
    const paths = getCentralPaths(dir, 'apagar-conteudo');
    const imagePath = join(paths.projectDir, content.image.localPath);
    await stat(content.filePath);
    await stat(imagePath);

    const result = await deleteProjectContent('apagar-conteudo', content.contentId, dir);
    assert.equal(result.deleted, true);
    assert.equal((await listProjectContent('apagar-conteudo', dir)).length, 0);
    await assert.rejects(() => stat(content.filePath));
    await assert.rejects(() => stat(imagePath));
  });
});

test('approveContent records a short summary into project.learnings.approved for future prompts', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'aprender-aprovado',
      name: 'Aprender Aprovado',
      handle: '@aprenderaprovado',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('aprender-aprovado', { days: 1, startDate: '2026-07-20', channel: 'instagram_story' }, dir);
    const content = batch.items[0];

    await approveContent('aprender-aprovado', content.contentId, dir, content.batchId);

    const project = (await listCentralProjects(dir)).find((p) => p.projectId === 'aprender-aprovado');
    assert.equal(project.learnings.approved.length, 1);
    assert.match(project.learnings.approved[0], /Instagram Stories/);
    assert.match(project.learnings.approved[0], /aprovado/);

    const paths = getCentralPaths(dir, 'aprender-aprovado');
    const manual = await readFile(paths.manualPath, 'utf-8');
    assert.match(manual, /## Aprendizados aprovados\n- .*aprovado/);
  });
});

test('deleteProjectContent with a reason records it into project.learnings.avoid and feeds it into future image prompts', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'aprender-rejeitado',
      name: 'Aprender Rejeitado',
      handle: '@aprenderrejeitado',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('aprender-rejeitado', { days: 1, startDate: '2026-07-20' }, dir);
    const content = batch.items[0];

    await deleteProjectContent('aprender-rejeitado', content.contentId, dir, content.batchId, 'preço saiu ilegível na imagem');

    const project = (await listCentralProjects(dir)).find((p) => p.projectId === 'aprender-rejeitado');
    assert.equal(project.learnings.avoid.length, 1);
    assert.match(project.learnings.avoid[0], /preço saiu ilegível na imagem/);

    const nextBatch = await generateContentBatch('aprender-rejeitado', { days: 1, startDate: '2026-07-21' }, dir);
    assert.match(nextBatch.items[0].image.prompt, /EVITAR — APRENDIZADOS DE CONTEÚDOS REJEITADOS ANTES/);
    assert.match(nextBatch.items[0].image.prompt, /preço saiu ilegível na imagem/);
  });
});

test('deleteProjectContent without a reason does not record anything into learnings.avoid', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'apagar-sem-motivo',
      name: 'Apagar Sem Motivo',
      handle: '@apagarsemmotivo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('apagar-sem-motivo', { days: 1, startDate: '2026-07-20' }, dir);
    const content = batch.items[0];

    await deleteProjectContent('apagar-sem-motivo', content.contentId, dir, content.batchId);

    const project = (await listCentralProjects(dir)).find((p) => p.projectId === 'apagar-sem-motivo');
    assert.equal(project.learnings.avoid.length, 0);
  });
});

test('simulateTestPost creates a real local image file, not only a prompt', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'imagem-teste',
      name: 'Imagem Teste',
      handle: '@imagemteste',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const content = await simulateTestPost('imagem-teste', {
      channel: 'instagram_feed',
      note: 'gerar imagem real para revisar',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    assert.equal(content.image.generated, true);
    assert.equal(content.image.mimeType, 'image/svg+xml');
    assert.ok(content.image.localPath.endsWith('.svg'));

    const paths = getCentralPaths(dir, 'imagem-teste');
    const imagePath = join(paths.projectDir, content.image.localPath);
    const svg = await readFile(imagePath, 'utf-8');
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('Imagem Teste'));
  });
});

test('simulateTestPost obeys selected Story channel and marks portrait 9:16 format', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'canal-story',
      name: 'Canal Story',
      handle: '@canalstory',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const content = await simulateTestPost('canal-story', {
      channel: 'instagram_story',
      note: 'teste em story, não feed',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    assert.equal(content.channel, 'instagram_story');
    assert.equal(content.formatLabel, 'Instagram Stories');
    assert.equal(content.image.aspectRatio, 'portrait');
    assert.equal(content.image.dimensions.width, 1080);
    assert.equal(content.image.dimensions.height, 1920);
    assert.match(content.image.prompt, /Instagram Stories/);
    assert.match(content.image.prompt, /Story vertical 9:16/i);
    assert.match(content.image.prompt, /criar composição vertical nativa/i);
    assert.match(content.image.prompt, /não gerar 1:1\/quadrado/i);
    assert.match(content.image.prompt, /não flyer quadrado/i);
    assert.match(content.image.prompt, /selo\/card compacto/i);
    assert.doesNotMatch(content.image.prompt, /Instagram Feed de Canal Story/);
  });
});

test('safe tests and scheduled posts use the correct dimensions for Story Feed and Reels', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'tamanhos-canais',
      name: 'Tamanhos Canais',
      handle: '@tamanhoscanais',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const expected = {
      instagram_story: { aspectRatio: 'portrait', width: 1080, height: 1920 },
      instagram_feed: { aspectRatio: 'portrait', width: 1080, height: 1350 },
      instagram_reels: { aspectRatio: 'portrait', width: 1080, height: 1920 },
    };
    const paths = getCentralPaths(dir, 'tamanhos-canais');
    const readSvgSize = async (item) => {
      const svg = await readFile(join(paths.projectDir, item.image.localPath), 'utf-8');
      const match = svg.match(/<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/);
      return { width: Number(match[1]), height: Number(match[2]) };
    };

    for (const [channel, size] of Object.entries(expected)) {
      const content = await simulateTestPost('tamanhos-canais', {
        channel,
        note: `verificar ${channel}`,
        testSeed: channel,
      }, dir, new Date('2026-07-15T12:00:00.000Z'));
      assert.equal(content.channel, channel);
      assert.equal(content.image.aspectRatio, size.aspectRatio);
      assert.deepEqual(content.image.dimensions, { width: size.width, height: size.height });
      assert.deepEqual(await readSvgSize(content), { width: size.width, height: size.height });
      if (channel === 'instagram_feed') {
        assert.match(content.image.prompt, /Feed vertical 4:5/i);
        assert.match(content.image.prompt, /1080x1350/);
        assert.match(content.image.prompt, /não gerar Story/i);
      }
    }

    const batch = await generateContentSchedulePlan('tamanhos-canais', {
      days: 1,
      startDate: '2026-07-20',
      formats: Object.keys(expected).map((channel) => ({ channel, postsPerDay: 1, everyDays: 1, startTime: '12:00', intervalMinutes: 0 })),
    }, dir);

    for (const item of batch.items) {
      const size = expected[item.channel];
      assert.equal(item.image.aspectRatio, size.aspectRatio);
      assert.deepEqual(item.image.dimensions, { width: size.width, height: size.height });
      assert.deepEqual(await readSvgSize(item), { width: size.width, height: size.height });
      if (item.channel === 'instagram_feed') {
        assert.match(item.image.prompt, /Feed vertical 4:5/i);
        assert.match(item.image.prompt, /1080x1350/);
        assert.match(item.image.prompt, /não gerar Story/i);
      }
    }
  });
});

test('Facebook Feed and Story generate with the same real dimensions as their Instagram counterparts', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'canais-facebook',
      name: 'Canais Facebook',
      handle: '@canaisfacebook',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const storyBatch = await generateContentBatch('canais-facebook', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'facebook_story',
    }, dir);
    const storyItem = storyBatch.items[0];
    assert.equal(storyItem.channel, 'facebook_story');
    assert.equal(storyItem.image.aspectRatio, 'portrait');
    assert.deepEqual(storyItem.image.dimensions, { width: 1080, height: 1920 });
    assert.match(storyItem.image.prompt, /Facebook Story 9:16 vertical real, 1080x1920/);

    const feedBatch = await generateContentBatch('canais-facebook', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'facebook_feed',
    }, dir);
    const feedItem = feedBatch.items[0];
    assert.equal(feedItem.channel, 'facebook_feed');
    assert.equal(feedItem.image.aspectRatio, 'portrait');
    assert.deepEqual(feedItem.image.dimensions, { width: 1080, height: 1350 });
    assert.match(feedItem.image.prompt, /Facebook Feed vertical 4:5, 1080x1350/);
  });
});

test('simulateTestPost can attach an AI image URL when a generator is available', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'imagem-ai',
      name: 'Imagem AI',
      handle: '@imagemai',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const content = await simulateTestPost('imagem-ai', {
      channel: 'instagram_story',
      note: 'pizza rodizio hoje',
      imageGenerator: async ({ content: draft }) => ({
        url: 'https://cdn.example.com/story.png',
        mimeType: 'image/png',
        prompt: draft.image.prompt,
      }),
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    assert.equal(content.image.generatedSource, 'ai');
    assert.equal(content.image.mimeType, 'image/png');
    assert.equal(content.image.url, 'https://cdn.example.com/story.png');
    assert.equal(content.image.previewUrl, 'https://cdn.example.com/story.png');
    assert.equal(content.image.previewMode, 'direct_ai_css_cover');
    assert.equal(content.image.previewFit, 'cover');
    assert.equal(content.image.composition, undefined);
    assert.doesNotMatch(content.image.previewDataUrl || '', /cdn\.example\.com\/story\.png/);
  });
});

test('animateContentForReels attaches a rendered video to the card using the injected animator', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'animar-reels',
      name: 'Animar Reels',
      handle: '@animarreels',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('animar-reels', { days: 1, startDate: '2026-07-20', channel: 'instagram_reels' }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'animar-reels');
    await enrichBatchItemsWithRealImages(batch, project, 'animar-reels', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/reels.png', mimeType: 'image/png' }),
    });
    const targetContentId = batch.items[0].contentId;

    const content = await animateContentForReels('animar-reels', targetContentId, {
      batchId: batch.items[0].batchId,
      videoAnimator: async ({ content: passed }) => {
        assert.equal(passed.contentId, targetContentId);
        return {
          url: '/api/projects/animar-reels/assets/assets/generated/reels-123.mp4',
          localPath: 'C:/tmp/reels-123.mp4',
          durationSeconds: 7,
        };
      },
    }, dir);

    assert.equal(content.video.url, '/api/projects/animar-reels/assets/assets/generated/reels-123.mp4');
    assert.equal(content.video.mimeType, 'video/mp4');
    assert.equal(content.video.durationSeconds, 7);
    assert.equal(content.video.generatedSource, 'ffmpeg_zoompan');
    assert.ok(content.video.generatedAt);

    const reloaded = (await listProjectContent('animar-reels', dir)).find((item) => item.contentId === targetContentId);
    assert.equal(reloaded.video.url, content.video.url);
  });
});

test('animateContentForReels requires a configured animator and a real AI-generated image first', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'animar-erros',
      name: 'Animar Erros',
      handle: '@animarerros',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('animar-erros', { days: 1, startDate: '2026-07-20', channel: 'instagram_reels' }, dir);
    const targetContentId = batch.items[0].contentId;
    const targetBatchId = batch.items[0].batchId;

    await assert.rejects(
      () => animateContentForReels('animar-erros', targetContentId, { batchId: targetBatchId }, dir),
      /Nenhum animador de vídeo configurado/,
    );

    await assert.rejects(
      // Card still only has the local SVG placeholder — no real AI image yet.
      () => animateContentForReels('animar-erros', targetContentId, {
        batchId: targetBatchId,
        videoAnimator: async () => ({ url: '/whatever.mp4' }),
      }, dir),
      /ainda não tem uma imagem final gerada por IA/,
    );
  });
});

test('animateContentForReels rejects an animator that resolves without a usable video instead of silently doing nothing', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'animar-vazio',
      name: 'Animar Vazio',
      handle: '@animarvazio',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('animar-vazio', { days: 1, startDate: '2026-07-20', channel: 'instagram_reels' }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'animar-vazio');
    await enrichBatchItemsWithRealImages(batch, project, 'animar-vazio', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/reels.png', mimeType: 'image/png' }),
    });

    await assert.rejects(
      () => animateContentForReels('animar-vazio', batch.items[0].contentId, {
        batchId: batch.items[0].batchId,
        videoAnimator: async () => ({}),
      }, dir),
      /não retornou um vídeo válido/,
    );
  });
});

test('creative reviewer treats an empty/malformed AI response as needing manual review, not automatic approval', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'revisor-vazio',
      name: 'Revisor Vazio',
      handle: '@revisorvazio',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const content = await simulateTestPost('revisor-vazio', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/story.png', mimeType: 'image/png' }),
      // Simulates a reviewer call that resolved with valid-but-empty JSON —
      // no status, no checks, no errors, no warnings.
      imageReviewer: async () => ({}),
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    assert.equal(content.creativeReview.status, 'warning');
    assert.match(content.creativeReview.summary, /resposta vazia/i);
    assert.ok(content.creativeReview.warnings.some((w) => /não retornou avaliação válida/i.test(w)));
  });
});

test('AI safe test asks ChatGPT for a complete designed card and avoids automatic overlay fields', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'overlay-exato',
      name: 'Arte Exata',
      handle: '@overlayexato',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('overlay-exato', {
      name: '2 Pizzas Grande',
      type: 'combo',
      price: '79,99',
      items: '2 pizzas grandes.',
      cta: 'Peça no delivery',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    const generatorCalls = [];
    const content = await simulateTestPost('overlay-exato', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return {
          url: 'https://cdn.example.com/card-pizza-final.png',
          mimeType: 'image/png',
          prompt: payload.content.image.prompt,
        };
      },
      imageReviewer: async () => ({
        status: 'ok',
        summary: 'Card final ChatGPT aprovado com texto e preço corretos.',
        checks: ['Canvas Story 9:16 ok.', 'Texto, preço e CTA conferem.'],
      }),
    }, dir, new Date('2026-07-18T09:00:00.000Z'));

    assert.equal(generatorCalls.length, 1);
    // The offer's own specific objective replaces the generic "arte
    // publicitária final" filler line once buildCreativeObjective prefers
    // topic.objective — no point repeating a vague sentence next to a
    // specific one.
    assert.match(generatorCalls[0].content.image.prompt, /Criar oferta de combo para 2 Pizzas Grande, com preço e CTA de delivery claros/i);
    assert.match(generatorCalls[0].content.image.prompt, /Título exato: 2 Pizzas Grandes/i);
    assert.match(generatorCalls[0].content.image.prompt, /Preço exato: R\$ 79,99/i);
    assert.match(generatorCalls[0].content.image.prompt, /CTA sutil: "Peça no delivery"/i);
    assert.doesNotMatch(generatorCalls[0].content.image.prompt, /SEM texto/i);
    assert.equal(content.image.url, 'https://cdn.example.com/card-pizza-final.png');
    assert.equal(content.image.previewMode, 'direct_ai_css_cover');
    assert.equal(content.image.composition, undefined);
    assert.equal(content.image.baseUrl, undefined);
    assert.match(content.creativeReview.summary, /Card final ChatGPT aprovado/);
  });
});

test('AI final prompt is compiled into concise creative brief and limited references', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'prompt-compilado',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
      mode: 'semi_automatic',
    }, dir);
    await updateProjectBrandInput('prompt-compilado', {
      brandName: 'Boss Pizzaria',
      segment: 'pizzaria',
      productsOrServices: 'delivery de pizzas e atendimento no salão',
      description: 'Descrição livre ainda não informada',
      serviceRegion: 'Várzea Grande-MT',
      mainDifferential: 'diferencial ainda não informado',
    }, dir);
    await approveProjectBrandXray('prompt-compilado', {
      edits: {
        summary: 'Informado pelo usuário: pizzaria local. Sugestão da IA: marca acolhedora e comercial. Descrição livre ainda não informada.',
        communication: 'Sugestão da IA: comunicação próxima, convidativa e confiável. Sem tratar essa sugestão como fato confirmado.',
        contentStrategy: 'Informado pelo usuário: vender pizzas. Sugestão da IA: priorizar famílias, casais e grupos de amigos.',
        visualIdentity: 'Extraído da logo: cores ainda não identificadas/editadas. Sugestão da IA: visual quente, premium e apetitoso.',
      },
    }, dir);
    await saveProjectOffer('prompt-compilado', {
      name: '2 Pizzas Grande',
      type: 'combo',
      price: '79,99',
      items: 'duas pizzas grandes selecionadas',
      cta: '',
      autoGenerateCta: true,
      active: true,
    }, dir, new Date('2026-07-15T12:00:00.000Z'));
    const dataUrl = `data:image/png;base64,${Buffer.from('img').toString('base64')}`;
    await saveProjectAsset('prompt-compilado', { kind: 'logo', filename: 'logo.png', dataUrl }, dir);
    for (let index = 0; index < 5; index += 1) {
      await saveProjectAsset('prompt-compilado', {
        kind: 'reference',
        filename: `pizza-${index}.png`,
        dataUrl,
        role: 'product_photo',
        weight: 'high',
      }, dir);
    }
    for (let index = 0; index < 4; index += 1) {
      await saveProjectAsset('prompt-compilado', {
        kind: 'reference',
        filename: `layout-${index}.png`,
        dataUrl,
        role: 'layout_model',
        weight: 'high',
        instruction: 'Usar apenas composição e hierarquia do preço.',
      }, dir);
    }

    const generatorCalls = [];
    await simulateTestPost('prompt-compilado', {
      channel: 'instagram_story',
      testSeed: 'prompt-compilado-sem-ruido',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/story.png', mimeType: 'image/png', prompt: payload.content.image.prompt };
      },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    const prompt = generatorCalls[0].content.image.prompt;
    const references = generatorCalls[0].content.image.references;

    assert.match(prompt, /FORMATO/);
    assert.match(prompt, /TEXTOS OBRIGATÓRIOS/);
    assert.match(prompt, /DIREÇÃO VISUAL/);
    assert.match(prompt, /REFERÊNCIA PRINCIPAL/);
    assert.match(prompt, /LIBERDADE CRIATIVA/);
    assert.match(prompt, /Título exato:\s*2 Pizzas Grandes/i);
    assert.match(prompt, /Preço exato:\s*R\$ 79,99/i);
    assert.match(prompt, /CTA sutil: "Peça agora"/i);
    assert.doesNotMatch(prompt, /BRIEFING COMPLETO ORIGINAL/);
    assert.doesNotMatch(prompt, /Informado pelo usuário/i);
    assert.doesNotMatch(prompt, /Sugestão da IA/i);
    assert.doesNotMatch(prompt, /Descrição livre ainda não informada/i);
    assert.doesNotMatch(prompt, /diferencial ainda não informado/i);
    assert.doesNotMatch(prompt, /modo de operação/i);
    assert.doesNotMatch(prompt, /Não publicar sem aprovação/i);
    assert.doesNotMatch(prompt, /Variação criativa de teste: 2026/i);
    assert.ok(prompt.length < 4700);
    assert.equal((prompt.match(/9:16 Vertical/g) || []).length <= 2, true);
    assert.equal(references.filter((reference) => reference.role === 'product_photo').length, 2);
    assert.equal(references.filter((reference) => reference.role === 'layout_model').length, 1);
    assert.equal(references.filter((reference) => reference.role === 'brand_asset').length, 1);
    assert.ok(references.length <= 4);
  });
});

test('Story prompt treats esfiha offer as native vertical composition with compact price', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'story-esfiha-nativo',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('story-esfiha-nativo', {
      name: 'Combo 20 Esfihas',
      type: 'combo',
      price: '97,00',
      items: 'Salgadas: Presunto, Queijo, Bacon, Atum, Milho, Carne, Calabresa, Frango, Palmito. Doce: Brigadeiro, Beijinho',
      active: true,
      autoGenerateCta: true,
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    const generatorCalls = [];
    await simulateTestPost('story-esfiha-nativo', {
      channel: 'instagram_story',
      testSeed: 'story-esfiha-nativo',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/story-esfiha.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    const prompt = generatorCalls[0].content.image.prompt;
    assert.match(prompt, /A composição deve ser nativa de Story vertical/i);
    assert.match(prompt, /Não criar um flyer quadrado ou bloco central com aparência 1:1/i);
    assert.match(prompt, /Distribuir os elementos ao longo da altura do canvas/i);
    assert.match(prompt, /Esfihas reais em destaque como produto principal/i);
    assert.match(prompt, /O foco visual desta peça são esfihas, não pizzas/i);
    assert.match(prompt, /Evitar aparência de pizza grande, fatia de pizza ou mini pizza genérica/i);
    assert.match(prompt, /O produto deve ser o protagonista/i);
    assert.match(prompt, /O selo de preço não pode cobrir parte relevante/i);
    assert.match(prompt, /Não posicionar o preço no centro cobrindo o produto principal/i);
  });
});

test('food-specific visual language only appears in the prompt for actual food businesses', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'boss-comida',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectBrandInput('boss-comida', {
      brandName: 'Boss Pizzaria',
      segment: 'pizzaria',
      productsOrServices: 'rodízio de pizzas e delivery',
    }, dir);
    const foodCalls = [];
    await simulateTestPost('boss-comida', {
      channel: 'instagram_story',
      testSeed: 'food-check',
      imageGenerator: async (payload) => { foodCalls.push(payload); return { url: 'https://cdn.example.com/food.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.match(foodCalls[0].content.image.prompt, /gastron[oô]mico.*apetitoso/i);

    await createCentralProject({
      projectId: 'inova-engenharia',
      name: 'inova',
      handle: '@inova',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectBrandInput('inova-engenharia', {
      brandName: 'inova controle de obras',
      segment: 'controle tecnológico de obras',
      productsOrServices: 'ensaios técnicos de concreto, solo e asfalto em canteiros de obra',
    }, dir);
    const engineeringCalls = [];
    await simulateTestPost('inova-engenharia', {
      channel: 'instagram_story',
      testSeed: 'non-food-check',
      imageGenerator: async (payload) => { engineeringCalls.push(payload); return { url: 'https://cdn.example.com/eng.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.doesNotMatch(engineeringCalls[0].content.image.prompt, /apetitoso/i);
    assert.doesNotMatch(engineeringCalls[0].content.image.prompt, /gastron[oô]mico premium/i);
  });
});

test('a project with no real product/work photo ever uploaded gets a conceptual-design instruction instead of "invent a coherent product"', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'agencia-sem-produto',
      name: 'Agencia Sem Produto',
      handle: '@agenciasemproduto',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectBrandInput('agencia-sem-produto', {
      brandName: 'Agencia Sem Produto',
      segment: 'Agência de marketing digital',
      productsOrServices: 'Gestão de redes sociais e criação de anúncios',
    }, dir);

    const calls = [];
    await simulateTestPost('agencia-sem-produto', {
      channel: 'instagram_feed',
      imageGenerator: async (payload) => { calls.push(payload); return { url: 'https://cdn.example.com/agencia.png', mimeType: 'image/png' }; },
    }, dir);

    assert.match(calls[0].content.image.prompt, /provavelmente vende serviço, não produto físico/);
    assert.match(calls[0].content.image.prompt, /Não inventar um produto físico genérico/);
    assert.doesNotMatch(calls[0].content.image.prompt, /Sem foto real selecionada nesta geração/);
  });
});

test('a project with a real product/work photo uploaded keeps the existing "no photo selected this round" wording instead of the no-product fallback', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'agencia-com-portfolio',
      name: 'Agencia Com Portfolio',
      handle: '@agenciacomportfolio',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectAsset('agencia-com-portfolio', {
      kind: 'reference',
      filename: 'peca-portfolio.png',
      dataUrl: `data:image/png;base64,${Buffer.from('portfolio').toString('base64')}`,
      role: 'product_photo',
      weight: 'medium',
    }, dir);

    const calls = [];
    await simulateTestPost('agencia-com-portfolio', {
      channel: 'instagram_feed',
      imageGenerator: async (payload) => { calls.push(payload); return { url: 'https://cdn.example.com/portfolio.png', mimeType: 'image/png' }; },
    }, dir);

    assert.doesNotMatch(calls[0].content.image.prompt, /provavelmente vende serviço, não produto físico/);
  });
});

test('layout reference rotates across different test runs instead of always using the first upload', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'layout-rotativo',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const dataUrl = `data:image/png;base64,${Buffer.from('img').toString('base64')}`;
    await saveProjectAsset('layout-rotativo', {
      kind: 'reference', filename: 'layout-a.jpg', dataUrl,
      role: 'layout_model', usageRoles: ['layout_model'], referenceCategory: 'visual_inspiration',
    }, dir, new Date('2026-07-16T12:00:00.000Z'));
    await saveProjectAsset('layout-rotativo', {
      kind: 'reference', filename: 'layout-b.jpg', dataUrl,
      role: 'layout_model', usageRoles: ['layout_model'], referenceCategory: 'visual_inspiration',
    }, dir, new Date('2026-07-16T12:01:00.000Z'));

    const seenLayouts = new Set();
    for (const seed of ['seed-1', 'seed-2', 'seed-3', 'seed-4', 'seed-5', 'seed-6']) {
      const calls = [];
      await simulateTestPost('layout-rotativo', {
        channel: 'instagram_story',
        testSeed: seed,
        imageGenerator: async (payload) => { calls.push(payload); return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
      }, dir, new Date('2026-07-21T12:00:00.000Z'));
      const match = calls[0].content.image.prompt.match(/Layout principal: assets\/references\/(layout-[ab])\.jpg/);
      if (match) seenLayouts.add(match[1]);
    }
    assert.ok(seenLayouts.size > 1, `expected rotation across both layout references, only saw: ${[...seenLayouts]}`);
  });
});

test('product photo selection prefers a reference matching the offer\'s product over an earlier-uploaded, unrelated one', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'foto-produto-certa',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('foto-produto-certa', {
      name: 'Combo 20 Esfihas',
      type: 'combo',
      price: '97,00',
      items: 'Salgadas e doces',
      active: true,
      autoGenerateCta: true,
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    const dataUrl = `data:image/png;base64,${Buffer.from('img').toString('base64')}`;
    // Pizza photo uploaded first — a naive "first 2" slice would pick this
    // (and crowd out both esfiha photos) even though the offer being
    // generated is about esfihas.
    await saveProjectAsset('foto-produto-certa', {
      kind: 'reference',
      filename: 'pizza-produto.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
    }, dir, new Date('2026-07-16T12:00:00.000Z'));
    await saveProjectAsset('foto-produto-certa', {
      kind: 'reference',
      filename: 'esfiha-produto-aberta.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
      instruction: 'Esfiha real da Boss Pizzaria, aberta',
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    await saveProjectAsset('foto-produto-certa', {
      kind: 'reference',
      filename: 'esfiha-produto-fechada.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
      instruction: 'Esfiha real da Boss Pizzaria, fechada',
    }, dir, new Date('2026-07-20T12:05:00.000Z'));

    const generatorCalls = [];
    await simulateTestPost('foto-produto-certa', {
      channel: 'instagram_story',
      testSeed: 'foto-produto-certa',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/esfiha.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-07-21T12:00:00.000Z'));

    const prompt = generatorCalls[0].content.image.prompt;
    assert.match(prompt, /Foto selecionada: assets\/references\/esfiha-produto-aberta\.jpg/);
    assert.match(prompt, /Foto selecionada: assets\/references\/esfiha-produto-fechada\.jpg/);
    assert.doesNotMatch(prompt, /Foto selecionada: assets\/references\/pizza-produto\.jpg/);
  });
});

test('Story prompt prevalidates pizza combo text quantity and ignores square layout references', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'story-combo-3-pizzas',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('story-combo-3-pizzas', {
      name: '3 Pizza grande',
      type: 'combo',
      price: '99,99',
      items: 'Sabores selecionados',
      active: true,
      autoGenerateCta: true,
    }, dir, new Date('2026-07-15T12:00:00.000Z'));
    const dataUrl = `data:image/png;base64,${Buffer.from('img').toString('base64')}`;
    await saveProjectAsset('story-combo-3-pizzas', { kind: 'logo', filename: 'logo.png', dataUrl }, dir);
    await saveProjectAsset('story-combo-3-pizzas', {
      kind: 'reference',
      filename: 'pizza-unitaria.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      weight: 'high',
      instruction: 'Foto real de pizza unitária.',
    }, dir);
    await saveProjectAsset('story-combo-3-pizzas', {
      kind: 'reference',
      filename: 'layout-quadrado.jpg',
      dataUrl,
      role: 'layout_model',
      usageRoles: ['layout_model'],
      weight: 'high',
      aspectRatio: 'square',
      width: 1080,
      height: 1080,
      instruction: 'Post quadrado bonito, mas não deve guiar Story.',
    }, dir);
    await saveProjectAsset('story-combo-3-pizzas', {
      kind: 'reference',
      filename: 'layout-story.jpg',
      dataUrl,
      role: 'layout_model',
      usageRoles: ['layout_model'],
      weight: 'medium',
      aspectRatio: 'vertical',
      width: 1080,
      height: 1920,
      instruction: 'Layout vertical de Story.',
    }, dir);

    const generatorCalls = [];
    const content = await simulateTestPost('story-combo-3-pizzas', {
      channel: 'instagram_story',
      testSeed: 'story-combo-3-pizzas',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/story-combo-pizza.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    const prompt = generatorCalls[0].content.image.prompt;
    const references = generatorCalls[0].content.image.references;
    assert.match(prompt, /Título exato:\s*3 Pizzas Grandes/i);
    assert.match(prompt, /Subtítulo permitido:\s*Sabores selecionados/i);
    assert.match(prompt, /A composição deve comunicar visualmente um combo de 3 pizzas grandes/i);
    assert.match(prompt, /Não mostrar apenas uma pizza como item unitário/i);
    assert.match(prompt, /ESTRUTURA VERTICAL OBRIGATÓRIA/i);
    assert.match(prompt, /Topo: logo \+ título principal/i);
    assert.match(prompt, /Centro: combo de 3 pizzas como protagonista visual/i);
    assert.match(prompt, /Parte inferior média: preço em selo compacto/i);
    assert.match(prompt, /Rodapé: chamada “Peça agora” em texto pequeno/i);
    assert.doesNotMatch(prompt, /Layout principal: assets\/references\/layout-quadrado\.jpg/i);
    assert.match(prompt, /Layout principal: assets\/references\/layout-story\.jpg/i);
    assert.ok(references.every((reference) => reference.relativePath !== 'assets/references/layout-quadrado.jpg'));
    assert.ok(references.some((reference) => reference.relativePath === 'assets/references/layout-story.jpg'));
    assert.ok(content.creativePreflight.warnings.some((warning) => warning.includes('3 Pizza grande')));
    assert.ok(content.creativePreflight.checks.some((check) => check.includes('referência de layout quadrada')));
  });
});

test('Story AI safe test limits references and ignores square layout on the normal attempt', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'refs-livres-story',
      name: 'Refs Livres Story',
      handle: '@refslivres',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const dataUrl = `data:image/png;base64,${Buffer.from('img').toString('base64')}`;
    await saveProjectAsset('refs-livres-story', {
      kind: 'logo',
      filename: 'logo.png',
      dataUrl,
    }, dir);
    await saveProjectAsset('refs-livres-story', {
      kind: 'reference',
      filename: 'layout-quadrado.png',
      dataUrl,
      role: 'layout_model',
      usageRoles: ['layout_model'],
      weight: 'high',
      instruction: 'Modelo bonito mas quadrado, não deve prender o Story.',
    }, dir);
    await saveProjectAsset('refs-livres-story', {
      kind: 'reference',
      filename: 'copy-preco.png',
      dataUrl,
      role: 'text_parameter',
      usageRoles: ['text_parameter'],
      weight: 'high',
      instruction: 'Texto de referência não deve ser enviado como imagem.',
    }, dir);
    await saveProjectAsset('refs-livres-story', {
      kind: 'reference',
      filename: 'pizza-produto.png',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      weight: 'high',
      instruction: 'Produto real.',
    }, dir);
    await saveProjectAsset('refs-livres-story', {
      kind: 'reference',
      filename: 'estilo.png',
      dataUrl,
      role: 'visual_reference',
      usageRoles: ['visual_reference'],
      weight: 'medium',
      instruction: 'Clima visual.',
    }, dir);

    const generatorCalls = [];
    await simulateTestPost('refs-livres-story', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/story-livre.png', mimeType: 'image/png' };
      },
      imageReviewer: async () => ({ status: 'ok', summary: 'ok' }),
    }, dir, new Date('2026-07-18T09:00:00.000Z'));

    const roles = generatorCalls[0].content.image.references.map((reference) => reference.role);
    assert.deepEqual(roles, ['brand_asset', 'product_photo', 'visual_reference']);
    assert.ok(generatorCalls[0].content.image.references.every((reference) => reference.role !== 'text_parameter'));
    assert.equal(generatorCalls[0].content.image.references.filter((reference) => reference.role === 'layout_model').length, 0);
    assert.ok(generatorCalls[0].content.creativePreflight.checks.some((check) => check.includes('referência de layout quadrada')));
    assert.match(generatorCalls[0].content.image.prompt, /Sem layout principal selecionado/i);
  });
});

test('image prompt excludes unrelated offer price rules that conflict with current topic', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'preco-isolado',
      name: 'Preco Isolado',
      handle: '@precoisolado',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectImageRules('preco-isolado', {
      visualStyle: 'Pizzaria premium com fundo escuro.',
      imageRules: [
        'O título deve ser grande e legível.',
        'Mantenha margens de segurança.',
        'preço do rodizio 39,90',
        'preço de combo 3 pizza por 99,90',
      ],
    }, dir);
    await saveProjectOffer('preco-isolado', {
      name: 'Pizza Grande',
      type: 'offer',
      price: '49,99',
      items: 'Pizza grande',
      notes: 'Delivery',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    const content = await simulateTestPost('preco-isolado', {
      channel: 'instagram_story',
      testSeed: 'seed-preco',
    }, dir, new Date('2026-07-18T09:00:00.000Z'));

    assert.match(content.image.prompt, /Preço obrigatório: 49,99/);
    assert.doesNotMatch(content.image.prompt, /rodizio 39,90/i);
    assert.doesNotMatch(content.image.prompt, /combo 3 pizza por 99,90/i);
    assert.match(content.image.prompt, /O título deve ser grande e legível/);
  });
});

test('single-offer safe test variations avoid asking for two price cards', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'variacao-preco-unico',
      name: 'Variacao Preco Unico',
      handle: '@variacaoprecounico',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('variacao-preco-unico', {
      name: 'Combo 3 pizzas',
      type: 'combo',
      price: '99,99',
      items: '3 pizzas grandes',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    for (const seed of ['seed-a', 'seed-b', 'seed-c', 'seed-d', 'seed-e', 'seed-f']) {
      const content = await simulateTestPost('variacao-preco-unico', {
        channel: 'instagram_feed',
        testSeed: seed,
      }, dir, new Date(`2026-07-18T09:0${seed.at(-1).charCodeAt(0) % 6}:00.000Z`));
      assert.doesNotMatch(content.image.prompt, /dois cards de preço/i);
      assert.doesNotMatch(content.image.prompt, /comparar com rod[ií]zio/i);
    }
  });
});

test('creative reviewer blocks AI images with cropped text or unrelated offer prices', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'revisor-criativo',
      name: 'Revisor Criativo',
      handle: '@revisorcriativo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('revisor-criativo', {
      name: 'Combo 3 pizzas',
      type: 'combo',
      price: '99,99',
      items: '3 pizzas grandes',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    const content = await simulateTestPost('revisor-criativo', {
      channel: 'instagram_feed',
      imageGenerator: async () => ({
        url: 'https://cdn.example.com/combo-ruim.png',
        mimeType: 'image/png',
      }),
      imageReviewer: async () => ({
        status: 'blocked',
        summary: 'Texto cortado e preço de rodízio indevido.',
        errors: ['Texto principal cortado na borda.', 'Preço/oferta extra: Rodízio R$39,90.'],
        warnings: [],
        checks: ['Preço esperado 99,99 encontrado.'],
      }),
    }, dir, new Date('2026-07-18T09:00:00.000Z'));

    assert.equal(content.creativeReview.status, 'blocked');
    assert.match(content.creativeReview.summary, /Texto cortado/);
    assert.deepEqual(content.creativeReview.errors, [
      'Texto principal cortado na borda.',
      'Preço/oferta extra: Rodízio R$39,90.',
    ]);
    assert.equal(content.contentReview.status, 'blocked');
    assert.ok(content.contentReview.warnings.some((warning) => warning.includes('Revisor de Criativo bloqueou')));
  });
});

test('safe test retries AI image generation with reviewer feedback until creative review passes', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'revisor-refaz',
      name: 'Revisor Refaz',
      handle: '@revisorrefaz',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('revisor-refaz', {
      name: 'Combo 10 Esfiha',
      type: 'combo',
      price: '55,00',
      items: 'Salgadas: Presunto, Queijo, Bacon, Atum, Milho, Carne, Calabresa, Frango e Palmito.',
      cta: 'Peça no delivery',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    const generatorCalls = [];
    const reviewerCalls = [];
    const content = await simulateTestPost('revisor-refaz', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return {
          url: `https://cdn.example.com/tentativa-${generatorCalls.length}.png`,
          mimeType: 'image/png',
          prompt: payload.content.image.prompt,
        };
      },
      imageReviewer: async (payload) => {
        reviewerCalls.push(payload);
        if (reviewerCalls.length === 1) {
          return {
            status: 'blocked',
            summary: 'Formato quadrado e texto cortado.',
            errors: [
              'Formato visual está quadrado, incompatível com Instagram Stories 9:16.',
              'Texto principal cortado na lateral esquerda.',
              'Box do preço está grande demais e com moldura simples.',
            ],
          };
        }
        return {
          status: 'ok',
          summary: 'Imagem refeita em Story 9:16 com texto e preço dentro da área segura.',
          checks: ['Formato Story 9:16 aprovado.', 'Preço 55,00 legível e sem moldura exagerada.'],
        };
      },
    }, dir, new Date('2026-07-18T09:00:00.000Z'));

    assert.equal(generatorCalls.length, 2);
    assert.equal(reviewerCalls.length, 2);
    assert.equal(content.image.url, 'https://cdn.example.com/tentativa-2.png');
    assert.equal(content.creativeReview.status, 'ok');
    assert.equal(content.contentReview.status, 'ok');
    assert.equal(content.image.generationAttempts, 2);
    assert.match(generatorCalls[1].reviewFeedback, /Formato visual está quadrado/i);
    assert.match(generatorCalls[1].content.image.prompt, /Correções obrigatórias do revisor/i);
    assert.match(generatorCalls[1].content.image.prompt, /moldura simples/i);
  });
});

test('safe test enters rescue mode after repeated Story canvas format blocks', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'story-resgate',
      name: 'Story Resgate',
      handle: '@storyresgate',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lm9U5wAAAABJRU5ErkJggg==';
    await saveProjectAsset('story-resgate', {
      kind: 'reference',
      filename: 'layout-horizontal.png',
      dataUrl,
      role: 'layout_model',
      usageRoles: ['layout_model'],
      weight: 'high',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));
    await saveProjectAsset('story-resgate', {
      kind: 'reference',
      filename: 'pizza-produto.png',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      weight: 'high',
    }, dir, new Date('2026-07-15T12:01:00.000Z'));
    await saveProjectOffer('story-resgate', {
      name: 'Pizza Grande',
      type: 'direct_offer',
      price: '49,99',
      items: 'Pizza grande.',
      cta: 'Peça no delivery',
    }, dir, new Date('2026-07-15T12:02:00.000Z'));

    const generatorCalls = [];
    const reviewerCalls = [];
    const content = await simulateTestPost('story-resgate', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return {
          url: `https://cdn.example.com/story-resgate-${generatorCalls.length}.png`,
          mimeType: 'image/png',
          prompt: payload.content.image.prompt,
        };
      },
      imageReviewer: async () => {
        reviewerCalls.push(true);
        if (reviewerCalls.length < 4) {
          return {
            status: 'blocked',
            summary: 'Bloqueado por formato incompatível com Instagram Stories.',
            errors: [
              'Formato visual claramente incompatível com Instagram Stories: imagem em canvas horizontal com área central vertical, não em arte final 9:16 própria para Stories.',
              'A composição parece uma prévia vertical dentro de formato horizontal, o que viola a regra de bloquear Story/Reels quando não estiver claramente em formato vertical adequado.',
            ],
          };
        }
        return {
          status: 'ok',
          summary: 'Story vertical resgatado e aprovado.',
          checks: ['Canvas final 9:16 real aprovado.'],
        };
      },
    }, dir, new Date('2026-07-18T09:00:00.000Z'));

    assert.equal(generatorCalls.length, 4);
    assert.equal(reviewerCalls.length, 4);
    assert.equal(content.creativeReview.status, 'ok');
    assert.equal(content.image.generationAttempts, 4);
    assert.equal(generatorCalls[3].rescueMode, true);
    assert.match(generatorCalls[3].content.image.prompt, /MODO RESGATE DE STORY/i);
    assert.ok(generatorCalls[3].content.image.references.every((reference) => reference.role !== 'layout_model'));
    assert.ok(generatorCalls[3].content.image.references.some((reference) => reference.role === 'product_photo'));
  });
});

test('blocked creative review prevents approval payload creation', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'bloqueia-aprovacao',
      name: 'Bloqueia Aprovacao',
      handle: '@bloqueiaaprovacao',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('bloqueia-aprovacao', {
      name: 'Combo 3 pizzas',
      type: 'combo',
      price: '99,99',
      items: '3 pizzas grandes',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));
    const content = await simulateTestPost('bloqueia-aprovacao', {
      channel: 'instagram_feed',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/bloqueado.png', mimeType: 'image/png' }),
      imageReviewer: async () => ({
        status: 'blocked',
        summary: 'Texto cortado.',
        errors: ['Texto cortado na lateral.'],
      }),
    }, dir, new Date('2026-07-18T09:00:00.000Z'));

    await assert.rejects(
      () => buildApprovalPayload('bloqueia-aprovacao', content.contentId, dir),
      /Revisor de Criativo bloqueou/
    );
  });
});

test('simulateTestPost adds a fresh creative variation to avoid repeated test creatives', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'varia-teste',
      name: 'Varia Teste',
      handle: '@variateste',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const first = await simulateTestPost('varia-teste', {
      channel: 'instagram_feed',
      note: 'teste de oferta',
      testSeed: 'seed-a',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));
    const second = await simulateTestPost('varia-teste', {
      channel: 'instagram_feed',
      note: 'teste de oferta',
      testSeed: 'seed-b',
    }, dir, new Date('2026-07-15T12:01:00.000Z'));

    assert.match(first.image.prompt, /Variação criativa de teste: seed-a/);
    assert.match(first.image.prompt, /Não repetir exatamente o criativo anterior/);
    assert.match(second.image.prompt, /Variação criativa de teste: seed-b/);
    assert.notEqual(first.image.prompt, second.image.prompt);
    assert.notEqual(first.publish.variationSeed, second.publish.variationSeed);
    assert.ok(first.publish.creativeVariation);
  });
});

test('simulateTestPost rotates active offers instead of always using the first topic', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'teste-rotacao-ofertas',
      name: 'Teste Rotacao Ofertas',
      handle: '@testerotacao',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('teste-rotacao-ofertas', {
      name: 'Rodízio da casa',
      type: 'rodizio',
      price: 'R$49,90',
      items: 'pizzas salgadas e doces',
      cta: 'Aproveite hoje',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));
    await saveProjectOffer('teste-rotacao-ofertas', {
      name: 'Pizza grande',
      type: 'offer',
      price: 'R$49,99',
      items: 'pizza grande',
      notes: 'delivery',
    }, dir, new Date('2026-07-15T12:01:00.000Z'));
    await saveProjectOffer('teste-rotacao-ofertas', {
      name: 'Combo 3 pizzas',
      type: 'combo',
      price: 'R$99,99',
      items: '3 pizzas com sabores selecionados',
    }, dir, new Date('2026-07-15T12:02:00.000Z'));

    const first = await simulateTestPost('teste-rotacao-ofertas', {
      channel: 'instagram_story',
      testSeed: 'seed-1',
    }, dir, new Date('2026-07-18T09:00:00.000Z'));
    const second = await simulateTestPost('teste-rotacao-ofertas', {
      channel: 'instagram_story',
      testSeed: 'seed-2',
    }, dir, new Date('2026-07-18T09:01:00.000Z'));
    const third = await simulateTestPost('teste-rotacao-ofertas', {
      channel: 'instagram_story',
      testSeed: 'seed-3',
    }, dir, new Date('2026-07-18T09:02:00.000Z'));

    assert.deepEqual([
      first.contentTopic.offerName,
      second.contentTopic.offerName,
      third.contentTopic.offerName,
    ], ['Rodízio da casa', 'Pizza grande', 'Combo 3 pizzas']);
    assert.match(second.image.prompt, /Pizza grande/);
    assert.match(second.image.prompt, /R\$49,99/);
    assert.match(second.image.prompt, /delivery/i);
    assert.match(third.image.prompt, /Combo 3 pizzas/);
  });
});

test('simulateTestPost starts after the latest legacy test topic when no rotation index exists', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'teste-rotacao-legado',
      name: 'Teste Rotacao Legado',
      handle: '@testerotacaolegado',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('teste-rotacao-legado', {
      name: 'Rodízio da casa',
      type: 'rodizio',
      price: 'R$49,90',
      items: 'pizzas salgadas e doces',
      cta: 'Aproveite hoje',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));
    await saveProjectOffer('teste-rotacao-legado', {
      name: 'Pizza grande',
      type: 'offer',
      price: 'R$49,99',
      items: 'pizza grande',
      notes: 'delivery',
    }, dir, new Date('2026-07-15T12:01:00.000Z'));

    const first = await simulateTestPost('teste-rotacao-legado', {
      channel: 'instagram_story',
      testSeed: 'seed-1',
    }, dir, new Date('2026-07-18T09:00:00.000Z'));
    assert.equal(first.contentTopic.offerName, 'Rodízio da casa');

    const paths = getCentralPaths(dir, 'teste-rotacao-legado');
    const project = JSON.parse(await readFile(paths.projectPath, 'utf-8'));
    delete project.contentStrategy.nextTestTopicIndex;
    await writeFile(paths.projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');

    const second = await simulateTestPost('teste-rotacao-legado', {
      channel: 'instagram_story',
      testSeed: 'seed-2',
    }, dir, new Date('2026-07-18T09:01:00.000Z'));
    assert.equal(second.contentTopic.offerName, 'Pizza grande');
  });
});

test('generateContentSchedulePlan organizes multiple formats by frequency and interval', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'agenda-formatos',
      name: 'Agenda Formatos',
      handle: '@agendaformatos',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const batch = await generateContentSchedulePlan('agenda-formatos', {
      days: 7,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 3, everyDays: 1, startTime: '09:00', intervalMinutes: 240 },
        { channel: 'instagram_feed', postsPerDay: 1, everyDays: 2, startTime: '12:00', intervalMinutes: 0 },
      ],
    }, dir);

    const stories = batch.items.filter((item) => item.channel === 'instagram_story');
    const feeds = batch.items.filter((item) => item.channel === 'instagram_feed');

    assert.equal(batch.items.length, 25);
    assert.equal(stories.length, 21);
    assert.equal(feeds.length, 4);
    assert.deepEqual(stories.slice(0, 3).map((item) => item.scheduledTime), ['09:00', '13:00', '17:00']);
    assert.deepEqual(feeds.map((item) => item.scheduledDate), ['2026-07-20', '2026-07-22', '2026-07-24', '2026-07-26']);
    assert.equal(stories[2].slotNumber, 3);
    assert.equal(feeds[1].scheduleRule.everyDays, 2);
  });
});

test('content offers drive varied schedule topics with exact prices and post types', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'ofertas-pizza',
      name: 'Ofertas Pizza',
      handle: '@ofertaspizza',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    await saveProjectOffer('ofertas-pizza', {
      name: 'Combo 3 pizzas',
      type: 'combo',
      price: 'R$99,00',
      items: '3 pizzas selecionadas',
      cta: 'Peça agora no delivery',
      notes: 'Não prometer frete grátis.',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    await saveProjectOffer('ofertas-pizza', {
      name: 'Rodízio completo',
      type: 'rodizio',
      price: 'R$49,90',
      items: 'pizzas salgadas, pizzas doces e massas',
      cta: 'Aproveite o rodízio hoje',
      notes: 'Oferta presencial no salão.',
    }, dir, new Date('2026-07-15T12:01:00.000Z'));

    const batch = await generateContentSchedulePlan('ofertas-pizza', {
      days: 2,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 2, everyDays: 1, startTime: '09:00', intervalMinutes: 240 },
      ],
    }, dir);

    assert.equal(batch.items.length, 4);
    assert.deepEqual(batch.items.slice(0, 2).map((item) => item.contentTopic.offerName), [
      'Combo 3 pizzas',
      'Rodízio completo',
    ]);
    assert.deepEqual(batch.items.slice(0, 2).map((item) => item.contentTopic.type), ['combo', 'rodizio']);
    assert.match(batch.items[0].image.prompt, /Combo 3 pizzas/);
    assert.match(batch.items[0].image.prompt, /R\$99,00/);
    assert.match(batch.items[0].image.prompt, /Peça agora no delivery/);
    assert.match(batch.items[1].image.prompt, /Rodízio completo/);
    assert.match(batch.items[1].image.prompt, /pizzas salgadas, pizzas doces e massas/);
    assert.match(batch.items[1].caption.text, /R\$49,90/);
    assert.notEqual(batch.items[0].contentTopic.type, batch.items[1].contentTopic.type);
    assert.equal(batch.items[0].contentReview.status, 'ok');
    assert.ok(batch.items[0].contentReview.checks.some((check) => check.includes('Preço obrigatório presente')));
    assert.ok(batch.items[1].contentReview.checks.some((check) => check.includes('Itens/detalhes presentes')));
  });
});

test('Feed gets a softer default CTA than Story/Reels when the offer has no explicit CTA', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'cta-feed-suave',
      name: 'CTA Feed Suave',
      handle: '@ctafeedsuave',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('cta-feed-suave', {
      name: 'Combo Família',
      type: 'combo',
      price: 'R$ 89,90',
      items: '2 pizzas grandes',
    }, dir);

    const feedCalls = [];
    await simulateTestPost('cta-feed-suave', {
      channel: 'instagram_feed',
      imageGenerator: async (payload) => { feedCalls.push(payload); return { url: 'https://cdn.example.com/feed.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.match(feedCalls[0].content.image.prompt, /CTA exato:\s*Saiba mais/i);

    const fbFeedCalls = [];
    await simulateTestPost('cta-feed-suave', {
      channel: 'facebook_feed',
      imageGenerator: async (payload) => { fbFeedCalls.push(payload); return { url: 'https://cdn.example.com/fbfeed.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.match(fbFeedCalls[0].content.image.prompt, /CTA exato:\s*Saiba mais/i);

    const storyCalls = [];
    await simulateTestPost('cta-feed-suave', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => { storyCalls.push(payload); return { url: 'https://cdn.example.com/story.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.match(storyCalls[0].content.image.prompt, /CTA sutil: "Peça agora"/i);
  });
});

test('an offer\'s explicit CTA is still respected on Feed, instead of being overridden by the softer default', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'cta-explicito-feed',
      name: 'CTA Explicito Feed',
      handle: '@ctaexplicitofeed',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('cta-explicito-feed', {
      name: 'Rodízio de pizzas',
      type: 'rodizio',
      price: 'R$ 59,90',
      cta: 'Reserve sua mesa',
    }, dir);

    const feedCalls = [];
    await simulateTestPost('cta-explicito-feed', {
      channel: 'instagram_feed',
      imageGenerator: async (payload) => { feedCalls.push(payload); return { url: 'https://cdn.example.com/feed.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.match(feedCalls[0].content.image.prompt, /CTA exato:\s*Reserve sua mesa/i);
  });
});

test('a plain orientation/institutional offer with no pillar and no explicit CTA gets no CTA button on the creative, on Story or Feed', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'conteudo-sem-venda',
      name: 'Conteúdo Sem Venda',
      handle: '@semvenda',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('conteudo-sem-venda', { name: 'O que comprar primeiro', type: 'orientation' }, dir);
    await saveProjectOffer('conteudo-sem-venda', { name: 'Quem somos', type: 'institutional' }, dir);

    const batch = await generateContentSchedulePlan('conteudo-sem-venda', {
      days: 1,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 2, everyDays: 1, startTime: '09:00', intervalMinutes: 60 },
      ],
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'conteudo-sem-venda');

    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'conteudo-sem-venda', {
      imageGenerator: async (payload) => { calls.push(payload); return { url: `https://cdn.example.com/${calls.length}.png`, mimeType: 'image/png' }; },
    });

    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.doesNotMatch(call.content.image.prompt, /CTA exato/i, `expected no CTA line for a ${call.content.contentTopic.type} post`);
      assert.match(call.content.image.prompt, /Sem CTA nesta peça/i);
      assert.match(call.content.image.prompt, /Rodapé: fechamento visual limpo/i);
    }
  });
});

test('schedule generation mixes registered offers with selected content goals instead of only offers', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'mix-pizza',
      name: 'Mix Pizza',
      handle: '@mixpizza',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectBrandInput('mix-pizza', {
      brandName: 'Mix Pizza',
      segment: 'pizzaria',
      productsOrServices: 'pizzas e massas',
      contentGoals: ['sell_products', 'authority', 'engagement'],
    }, dir);
    await saveProjectOffer('mix-pizza', {
      name: 'Pizza Grande',
      type: 'offer',
      price: 'R$49,90',
      cta: 'Peça agora',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    const batch = await generateContentSchedulePlan('mix-pizza', {
      days: 3,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);

    const sources = batch.items.map((item) => item.contentTopic.source);
    assert.ok(sources.includes('offer'), 'expected at least one offer-driven topic');
    assert.ok(sources.includes('goal'), 'expected at least one goal-driven topic');
  });
});

test('schedule generation with zero offers uses the project\'s selected content goals instead of the generic retail fallback', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'servicos-tecnicos',
      name: 'Serviços Técnicos',
      handle: '@servicostecnicos',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectBrandInput('servicos-tecnicos', {
      brandName: 'Serviços Técnicos',
      segment: 'controle tecnológico de obras',
      productsOrServices: 'inspeção e laudos técnicos',
      contentGoals: ['sell_services', 'authority', 'brand_awareness', 'relationship', 'engagement', 'education'],
    }, dir);

    const batch = await generateContentSchedulePlan('servicos-tecnicos', {
      days: 5,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);

    const sources = batch.items.map((item) => item.contentTopic.source);
    assert.ok(sources.every((source) => source === 'goal'), `expected all topics to be goal-driven, got: ${sources.join(', ')}`);
    assert.ok(batch.items.every((item) => item.contentTopic.id !== 'urgencia-hoje'), 'should not fall back to the generic retail "urgência hoje" topic when goals are selected');
    assert.ok(batch.items.every((item) => !item.contentTopic.price), 'goal-driven topics must not carry an invented price');
  });
});

test('offers can let AI generate a contextual CTA when the CTA field is empty', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'cta-automatico',
      name: 'CTA Automatico',
      handle: '@ctaautomatico',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const saved = await saveProjectOffer('cta-automatico', {
      name: 'Pizza especial da casa',
      type: 'product',
      price: '',
      items: 'pizza artesanal com queijo derretendo',
      cta: '',
      autoGenerateCta: true,
      notes: 'Evitar chamada massiva ou apelativa.',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    assert.equal(saved.offer.cta, '');
    assert.equal(saved.offer.autoGenerateCta, true);

    const batch = await generateContentSchedulePlan('cta-automatico', {
      days: 1,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '12:00', intervalMinutes: 0 },
      ],
    }, dir);

    const item = batch.items[0];
    assert.equal(item.contentTopic.autoGenerateCta, true);
    assert.match(item.image.prompt, /CTA automático/i);
    assert.match(item.image.prompt, /criar uma chamada curta, natural e contextual/i);
    assert.match(item.caption.text, /CTA: \[IA deve sugerir uma chamada curta/);
    assert.ok(item.contentReview.checks.some((check) => check.includes('CTA automático')));
    assert.equal(item.contentReview.warnings.some((warning) => warning.includes('Assunto sem CTA cadastrado')), false);
  });
});

test('project offers can be deleted and stop driving future content topics', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'apagar-ofertas',
      name: 'Apagar Ofertas',
      handle: '@apagarofertas',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const combo = await saveProjectOffer('apagar-ofertas', {
      name: 'Combo 3 pizzas',
      type: 'combo',
      price: 'R$99,00',
      items: '3 pizzas selecionadas',
      cta: 'Peça agora',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));
    await saveProjectOffer('apagar-ofertas', {
      name: 'Rodízio completo',
      type: 'rodizio',
      price: 'R$49,90',
      items: 'pizzas salgadas e doces',
      cta: 'Aproveite hoje',
    }, dir, new Date('2026-07-15T12:01:00.000Z'));

    const deleted = await deleteProjectOffer('apagar-ofertas', combo.offer.id, dir);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.offerId, combo.offer.id);
    assert.deepEqual(deleted.project.contentStrategy.offers.map((offer) => offer.name), ['Rodízio completo']);

    const batch = await generateContentSchedulePlan('apagar-ofertas', {
      days: 1,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);

    assert.equal(batch.items[0].contentTopic.offerName, 'Rodízio completo');
    assert.doesNotMatch(batch.items[0].image.prompt, /Combo 3 pizzas/);
  });
});

test('project pillars can be created, edited and deleted with sensible defaults', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'pilares-crud',
      name: 'Pilares CRUD',
      handle: '@pilarescrud',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const saved = await saveProjectPillar('pilares-crud', {
      name: 'Bastidor & Sabor',
      role: 'prova',
      objective: 'Mostrar o preparo real.',
      visualTreatment: 'cru',
      color: '#C2784A',
      weight: 2,
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    assert.equal(saved.pillar.id, 'bastidor-sabor');
    assert.equal(saved.pillar.role, 'prova');
    assert.equal(saved.pillar.requiresEvidence, true, 'prova pillars should require evidence by default');
    assert.equal(saved.pillar.active, true);
    assert.equal(saved.project.contentStrategy.pillars.length, 1);

    const edited = await saveProjectPillar('pilares-crud', {
      id: saved.pillar.id,
      name: 'Bastidor & Sabor',
      role: 'prova',
      objective: 'Mostrar o preparo real, com foco no forno a lenha.',
      visualTreatment: 'cru',
      color: '#C2784A',
      weight: 3,
    }, dir, new Date('2026-07-15T12:05:00.000Z'));
    assert.equal(edited.project.contentStrategy.pillars.length, 1, 'editing an existing pillar should not duplicate it');
    assert.equal(edited.pillar.weight, 3);

    const invalidRole = await saveProjectPillar('pilares-crud', {
      name: 'Pilar com role inválida',
      role: 'nao-existe',
    }, dir, new Date('2026-07-15T12:06:00.000Z'));
    assert.equal(invalidRole.pillar.role, 'ensina', 'unknown roles should fall back to a safe default');

    const deleted = await deleteProjectPillar('pilares-crud', saved.pillar.id, dir);
    assert.equal(deleted.deleted, true);
    assert.deepEqual(deleted.project.contentStrategy.pillars.map((pillar) => pillar.name), ['Pilar com role inválida']);

    await assert.rejects(deleteProjectPillar('pilares-crud', 'nao-existe', dir), /não encontrado/);
  });
});

test('pillar rotation distributes schedule slots by weight and spaces out the sales ("convida") pillar', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'rotacao-pilares',
      name: 'Rotação Pilares',
      handle: '@rotacaopilares',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const ensina = await saveProjectPillar('rotacao-pilares', { name: 'Ensina', role: 'ensina', weight: 3 }, dir);
    const prova = await saveProjectPillar('rotacao-pilares', { name: 'Prova', role: 'prova', weight: 2 }, dir);
    const posiciona = await saveProjectPillar('rotacao-pilares', { name: 'Posiciona', role: 'posiciona', weight: 2 }, dir);
    const convida = await saveProjectPillar('rotacao-pilares', { name: 'Convida', role: 'convida', weight: 1 }, dir);

    await saveProjectOffer('rotacao-pilares', { name: 'Assunto Ensina', type: 'offer', pillarId: ensina.pillar.id }, dir);
    await saveProjectOffer('rotacao-pilares', { name: 'Assunto Prova', type: 'offer', pillarId: prova.pillar.id }, dir);
    await saveProjectOffer('rotacao-pilares', { name: 'Assunto Posiciona', type: 'offer', pillarId: posiciona.pillar.id }, dir);
    await saveProjectOffer('rotacao-pilares', { name: 'Assunto Convida', type: 'offer', pillarId: convida.pillar.id }, dir);

    const batch = await generateContentSchedulePlan('rotacao-pilares', {
      days: 8,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);

    const roles = batch.items.map((item) => item.contentTopic.pillar?.role);
    assert.equal(roles.every(Boolean), true, 'every scheduled slot should resolve to a pillar');
    assert.equal(roles.filter((role) => role === 'ensina').length, 3);
    assert.equal(roles.filter((role) => role === 'prova').length, 2);
    assert.equal(roles.filter((role) => role === 'posiciona').length, 2);
    assert.equal(roles.filter((role) => role === 'convida').length, 1);

    for (let i = 1; i < roles.length; i += 1) {
      assert.ok(!(roles[i] === 'convida' && roles[i - 1] === 'convida'), `two "convida" pillars scheduled back to back at slots ${i - 1}/${i}`);
    }
  });
});

test('a heavily weighted sales pillar still never lands two slots in a row', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'rotacao-pilares-extremo',
      name: 'Rotação Pilares Extremo',
      handle: '@rotacaoextremo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const ensina = await saveProjectPillar('rotacao-pilares-extremo', { name: 'Ensina', role: 'ensina', weight: 1 }, dir);
    const prova = await saveProjectPillar('rotacao-pilares-extremo', { name: 'Prova', role: 'prova', weight: 1 }, dir);
    const posiciona = await saveProjectPillar('rotacao-pilares-extremo', { name: 'Posiciona', role: 'posiciona', weight: 1 }, dir);
    const convida = await saveProjectPillar('rotacao-pilares-extremo', { name: 'Convida', role: 'convida', weight: 3 }, dir);

    await saveProjectOffer('rotacao-pilares-extremo', { name: 'Assunto Ensina', type: 'offer', pillarId: ensina.pillar.id }, dir);
    await saveProjectOffer('rotacao-pilares-extremo', { name: 'Assunto Prova', type: 'offer', pillarId: prova.pillar.id }, dir);
    await saveProjectOffer('rotacao-pilares-extremo', { name: 'Assunto Posiciona', type: 'offer', pillarId: posiciona.pillar.id }, dir);
    await saveProjectOffer('rotacao-pilares-extremo', { name: 'Assunto Convida', type: 'offer', pillarId: convida.pillar.id }, dir);

    const batch = await generateContentSchedulePlan('rotacao-pilares-extremo', {
      days: 6,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);

    const roles = batch.items.map((item) => item.contentTopic.pillar?.role);
    assert.equal(roles.filter((role) => role === 'convida').length, 3);
    for (let i = 1; i < roles.length; i += 1) {
      assert.ok(!(roles[i] === 'convida' && roles[i - 1] === 'convida'), `two "convida" pillars scheduled back to back at slots ${i - 1}/${i}, got: ${roles.join(', ')}`);
    }
  });
});

test('schedule generation without any pillar configured keeps the original flat topic rotation untouched', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'sem-pilares',
      name: 'Sem Pilares',
      handle: '@sempilares',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('sem-pilares', { name: 'Pizza Grande', type: 'offer', price: 'R$49,90' }, dir);

    const batch = await generateContentSchedulePlan('sem-pilares', {
      days: 3,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);

    assert.ok(batch.items.every((item) => item.contentTopic.pillar === undefined), 'projects without pillars should never attach pillar metadata to a topic');
    assert.ok(batch.items.every((item) => item.contentTopic.offerName === 'Pizza Grande'));
  });
});

test('a resolved "convida" pillar drives a real sales CTA, while a non-sales pillar like "ensina" gets no CTA on the creative at all', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'cta-pilar',
      name: 'CTA Pilar',
      handle: '@ctapilar',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const convida = await saveProjectPillar('cta-pilar', { name: 'Convite Direto', role: 'convida', weight: 1 }, dir);
    const ensina = await saveProjectPillar('cta-pilar', { name: 'Dica Rápida', role: 'ensina', weight: 1 }, dir);
    await saveProjectOffer('cta-pilar', { name: 'Combo Família', type: 'institutional', pillarId: convida.pillar.id }, dir);
    await saveProjectOffer('cta-pilar', { name: 'Dica de bastidor', type: 'institutional', pillarId: ensina.pillar.id }, dir);

    const batch = await generateContentSchedulePlan('cta-pilar', {
      days: 2,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'cta-pilar');

    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'cta-pilar', {
      imageGenerator: async (payload) => { calls.push(payload); return { url: `https://cdn.example.com/${calls.length}.png`, mimeType: 'image/png' }; },
    });

    const convidaCall = calls.find((call) => call.content.contentTopic.pillar?.role === 'convida');
    const ensinaCall = calls.find((call) => call.content.contentTopic.pillar?.role === 'ensina');
    assert.match(convidaCall.content.image.prompt, /CTA sutil: "Peça agora"/i);
    // A pillar that isn't "convida" isn't asking for an order — the image
    // should carry no CTA button at all, only the pillar-driven objective
    // text; the caption keeps its own separate, softer closing line.
    assert.doesNotMatch(ensinaCall.content.image.prompt, /CTA exato/i);
    assert.match(ensinaCall.content.image.prompt, /Sem CTA nesta peça/i);
  });
});

test('a pillar that requires evidence warns when the linked offer has no real data attached', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'evidencia-pilar',
      name: 'Evidência Pilar',
      handle: '@evidenciapilar',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const prova = await saveProjectPillar('evidencia-pilar', { name: 'Resultado de Cliente', role: 'prova', weight: 1 }, dir);
    await saveProjectOffer('evidencia-pilar', { name: 'Case sem dado', type: 'social_proof', pillarId: prova.pillar.id }, dir);

    const batch = await generateContentSchedulePlan('evidencia-pilar', {
      days: 1,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);

    const item = batch.items[0];
    assert.equal(item.contentTopic.pillar.requiresEvidence, true);
    assert.ok(item.contentReview.warnings.some((warning) => warning.includes('exige evidência real')), `expected an evidence warning, got: ${item.contentReview.warnings.join(' | ')}`);

    await saveProjectOffer('evidencia-pilar', {
      name: 'Case com dado',
      type: 'social_proof',
      pillarId: prova.pillar.id,
      items: 'Cliente saiu de CPL R$40 para R$12 em 3 semanas',
    }, dir);
    await deleteProjectOffer('evidencia-pilar', 'case-sem-dado', dir);

    const secondBatch = await generateContentSchedulePlan('evidencia-pilar', {
      days: 1,
      startDate: '2026-07-21',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);
    const secondItem = secondBatch.items[0];
    assert.equal(secondItem.contentReview.warnings.some((warning) => warning.includes('exige evidência real')), false, `expected no evidence warning once real data is attached, got: ${secondItem.contentReview.warnings.join(' | ')}`);
  });
});

test('suggestProjectPillars falls back to the deterministic 4-role template when no pillarSuggester is configured', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'sugerir-sem-ia',
      name: 'Sugerir Sem IA',
      handle: '@sugerirsemia',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const result = await suggestProjectPillars('sugerir-sem-ia', {}, dir);
    assert.equal(result.source, 'template');
    assert.deepEqual(result.clarifyingQuestions, []);
    assert.deepEqual(result.pillars.map((p) => p.role).sort(), ['convida', 'ensina', 'posiciona', 'prova']);

    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'sugerir-sem-ia');
    assert.deepEqual(project.contentStrategy.pillars, [], 'suggestion is preview-only, nothing should be written to disk');
  });
});

test('suggestProjectPillars uses the injected AI suggestions and clarifying questions when available', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'sugerir-com-ia',
      name: 'Sugerir Com IA',
      handle: '@sugerircomia',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const result = await suggestProjectPillars('sugerir-com-ia', {
      pillarSuggester: async () => ({
        pillars: [
          { name: 'Bastidor & Sabor', role: 'prova', objective: 'Mostrar o preparo real.', weight: 2 },
          { name: 'Combo do Dia', role: 'convida', weight: 1 },
        ],
        clarifyingQuestions: ['Você tem algum caso real de cliente pra alimentar o pilar Prova?'],
      }),
    }, dir);

    assert.equal(result.source, 'ai_suggestion');
    assert.deepEqual(result.pillars.map((p) => p.name), ['Bastidor & Sabor', 'Combo do Dia']);
    assert.equal(result.pillars[0].requiresEvidence, true, 'prova role should still default requiresEvidence via normalizeProjectPillar');
    assert.deepEqual(result.clarifyingQuestions, ['Você tem algum caso real de cliente pra alimentar o pilar Prova?']);
  });
});

test('suggestProjectPillars falls back to the template instead of throwing when the pillarSuggester fails', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'sugerir-ia-falha',
      name: 'Sugerir IA Falha',
      handle: '@sugerirfalha',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const result = await suggestProjectPillars('sugerir-ia-falha', {
      pillarSuggester: async () => { throw new Error('rede fora do ar'); },
    }, dir);

    assert.equal(result.source, 'template');
    assert.equal(result.pillars.length, 4);
  });
});

test('regenerateContentDay updates only the selected day version and preserves siblings', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'regen-demo',
      name: 'Regeneração Demo',
      handle: '@regendemo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('regen-demo', { days: 2, startDate: '2026-07-20' }, dir);

    const changed = await regenerateContentDay('regen-demo', batch.items[1].contentId, {
      note: 'Mais emocional e menos vendedor',
      regenerate: 'creative',
    }, dir);

    assert.equal(changed.status, 'regenerated');
    assert.equal(changed.image.version, 2);
    assert.equal(changed.caption.version, 1);
    assert.equal(changed.dayRules.at(-1), 'Mais emocional e menos vendedor');

    const firstRaw = JSON.parse(await readFile(batch.items[0].filePath, 'utf-8'));
    assert.equal(firstRaw.image.version, 1);
    assert.equal(firstRaw.status, 'draft_generated');
  });
});

test('regenerateContentDay writes a real caption when a captionGenerator is available', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'copy-agent-demo',
      name: 'Copy Agent Demo',
      handle: '@copyagentdemo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('copy-agent-demo', { days: 1, startDate: '2026-07-20' }, dir);
    const draftText = batch.items[0].caption.text;

    const captionCalls = [];
    const changed = await regenerateContentDay('copy-agent-demo', batch.items[0].contentId, {
      regenerate: 'caption',
      note: 'Tom mais direto',
      captionGenerator: async (payload) => {
        captionCalls.push(payload);
        return 'Legenda final escrita pelo Agente Redator, pronta pra publicar.';
      },
    }, dir);

    assert.equal(changed.caption.text, 'Legenda final escrita pelo Agente Redator, pronta pra publicar.');
    assert.notEqual(changed.caption.text, draftText);
    assert.equal(changed.caption.generatedSource, 'ai');
    assert.equal(changed.caption.version, 2);
    assert.equal(changed.image.version, 1);
    assert.equal(captionCalls[0].note, 'Tom mais direto');
    assert.equal(captionCalls[0].project.name, 'Copy Agent Demo');
  });
});

test('regenerateContentDay records an error instead of silently leaving the raw skeleton when the caption generator returns nothing', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'copy-agent-empty-regen',
      name: 'Copy Agent Empty Regen',
      handle: '@copyagentemptyregen',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('copy-agent-empty-regen', { days: 1, startDate: '2026-07-20' }, dir);
    const draftText = batch.items[0].caption.text;

    const changed = await regenerateContentDay('copy-agent-empty-regen', batch.items[0].contentId, {
      regenerate: 'caption',
      captionGenerator: async () => '',
    }, dir);

    assert.equal(changed.caption.text, draftText);
    assert.notEqual(changed.caption.generatedSource, 'ai');
    assert.match(changed.captionGenerationError, /não retornou uma legenda/);
  });
});

test('regenerateContentDay keeps the draft-skeleton caption behavior when no captionGenerator is injected', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'copy-agent-fallback',
      name: 'Copy Agent Fallback',
      handle: '@copyagentfallback',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('copy-agent-fallback', { days: 1, startDate: '2026-07-20' }, dir);

    const changed = await regenerateContentDay('copy-agent-fallback', batch.items[0].contentId, {
      regenerate: 'caption',
      note: 'ajustar tom',
    }, dir);

    assert.match(changed.caption.text, /Revisão solicitada: ajustar tom/);
    assert.notEqual(changed.caption.generatedSource, 'ai');
  });
});

test('updateContentCaption saves the operator\'s own edited text without touching the image or calling any AI generator', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'legenda-manual',
      name: 'Legenda Manual',
      handle: '@legendamanual',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('legenda-manual', { days: 1, startDate: '2026-07-20' }, dir);
    const originalImagePrompt = batch.items[0].image.prompt;

    const updated = await updateContentCaption(
      'legenda-manual',
      batch.items[0].contentId,
      '  Legenda ajustada à mão pelo operador.  ',
      dir,
    );

    assert.equal(updated.caption.text, 'Legenda ajustada à mão pelo operador.');
    assert.equal(updated.caption.generatedSource, 'operator_edit');
    assert.equal(updated.caption.version, 2);
    assert.equal(updated.captionGenerationError, null);
    assert.equal(updated.image.prompt, originalImagePrompt);

    const reloaded = (await listProjectContent('legenda-manual', dir))[0];
    assert.equal(reloaded.caption.text, 'Legenda ajustada à mão pelo operador.');
  });
});

test('updateContentCaption rejects an empty caption', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'legenda-vazia',
      name: 'Legenda Vazia',
      handle: '@legendavazia',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('legenda-vazia', { days: 1, startDate: '2026-07-20' }, dir);

    await assert.rejects(
      () => updateContentCaption('legenda-vazia', batch.items[0].contentId, '   ', dir),
      /Legenda não pode ficar vazia/,
    );
  });
});

test('enrichBatchItemsWithRealImages writes real captions in parallel with the image for each item', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'copy-agent-batch',
      name: 'Copy Agent Batch',
      handle: '@copyagentbatch',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('copy-agent-batch', { days: 1, startDate: '2026-07-20' }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'copy-agent-batch');

    await enrichBatchItemsWithRealImages(batch, project, 'copy-agent-batch', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/batch.png', mimeType: 'image/png' }),
      captionGenerator: async () => 'Legenda pronta escrita pelo Agente Redator.',
    });

    assert.equal(batch.items[0].image.generatedSource, 'ai');
    assert.equal(batch.items[0].caption.text, 'Legenda pronta escrita pelo Agente Redator.');
    assert.equal(batch.items[0].caption.generatedSource, 'ai');
  });
});

test('enrichBatchItemsWithRealImages records an error instead of silently leaving the raw skeleton when the caption generator returns nothing', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'copy-agent-empty',
      name: 'Copy Agent Empty',
      handle: '@copyagentempty',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('copy-agent-empty', { days: 1, startDate: '2026-07-20' }, dir);
    const skeletonText = batch.items[0].caption.text;
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'copy-agent-empty');

    await enrichBatchItemsWithRealImages(batch, project, 'copy-agent-empty', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/batch.png', mimeType: 'image/png' }),
      // Simulates Hermes resolving without throwing but with an empty response.
      captionGenerator: async () => null,
    });

    assert.equal(batch.items[0].caption.text, skeletonText);
    assert.notEqual(batch.items[0].caption.generatedSource, 'ai');
    assert.match(batch.items[0].captionGenerationError, /não retornou uma legenda/);
  });
});

test('enrichBatchItemsWithRealImages records an error instead of silently keeping the placeholder image when the generator returns no url', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'imagem-sem-url',
      name: 'Imagem Sem URL',
      handle: '@imagemsemurl',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('imagem-sem-url', { days: 1, startDate: '2026-07-20' }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'imagem-sem-url');

    await enrichBatchItemsWithRealImages(batch, project, 'imagem-sem-url', {
      // Resolves without throwing, but with no usable url — used to be
      // silently treated as success (imageGenerationError stayed null)
      // while the card kept its local SVG placeholder forever.
      imageGenerator: async () => ({}),
    });

    assert.notEqual(batch.items[0].image.generatedSource, 'ai');
    assert.match(batch.items[0].imageGenerationError, /não retornou uma URL de imagem/);
  });
});

test('generateContentSchedulePlan pairs same-shape channels into one creative group per day/slot, sharing the same topic', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'grupo-criativo',
      name: 'Grupo Criativo',
      handle: '@grupocriativo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const batch = await generateContentSchedulePlan('grupo-criativo', {
      days: 1,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        { channel: 'facebook_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        { channel: 'instagram_reels', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        { channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '12:00', intervalMinutes: 0 },
        { channel: 'facebook_feed', postsPerDay: 1, everyDays: 1, startTime: '12:00', intervalMinutes: 0 },
      ],
    }, dir);

    const story = batch.items.find((item) => item.channel === 'instagram_story');
    const fbStory = batch.items.find((item) => item.channel === 'facebook_story');
    const reels = batch.items.find((item) => item.channel === 'instagram_reels');
    const feed = batch.items.find((item) => item.channel === 'instagram_feed');
    const fbFeed = batch.items.find((item) => item.channel === 'facebook_feed');

    assert.equal(story.creativeGroupKey, fbStory.creativeGroupKey);
    assert.equal(story.creativeGroupKey, reels.creativeGroupKey);
    assert.equal(feed.creativeGroupKey, fbFeed.creativeGroupKey);
    assert.notEqual(story.creativeGroupKey, feed.creativeGroupKey);
    // Sharing a creative only makes sense if it's for the same offer/subject.
    assert.equal(story.contentTopic.offerName, fbStory.contentTopic.offerName);
    assert.equal(story.contentTopic.offerName, reels.contentTopic.offerName);
    assert.equal(feed.contentTopic.offerName, fbFeed.contentTopic.offerName);
  });
});

test('enrichBatchItemsWithRealImages generates one creative per shape group and copies it to every same-shape sibling', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'compartilhar-criativo',
      name: 'Compartilhar Criativo',
      handle: '@compartilharcriativo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const batch = await generateContentSchedulePlan('compartilhar-criativo', {
      days: 1,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        { channel: 'facebook_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        { channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '12:00', intervalMinutes: 0 },
      ],
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'compartilhar-criativo');

    let imageCalls = 0;
    let captionCalls = 0;
    await enrichBatchItemsWithRealImages(batch, project, 'compartilhar-criativo', {
      imageGenerator: async () => {
        imageCalls += 1;
        return { url: `https://cdn.example.com/shared-${imageCalls}.png`, mimeType: 'image/png' };
      },
      captionGenerator: async () => {
        captionCalls += 1;
        return `Legenda gerada ${captionCalls}`;
      },
    });

    // Only two AI calls total: one for the Story/Facebook Story group, one for the solo Feed item.
    assert.equal(imageCalls, 2);
    assert.equal(captionCalls, 2);

    const content = await listProjectContent('compartilhar-criativo', dir);
    const story = content.find((item) => item.channel === 'instagram_story');
    const fbStory = content.find((item) => item.channel === 'facebook_story');
    const feed = content.find((item) => item.channel === 'instagram_feed');

    assert.equal(story.image.url, fbStory.image.url);
    assert.equal(story.caption.text, fbStory.caption.text);
    assert.deepEqual(story.creativeSharedWith, [fbStory.contentId]);
    assert.deepEqual(fbStory.creativeSharedWith, [story.contentId]);
    assert.equal(feed.creativeSharedWith, null);
    assert.notEqual(feed.image.url, story.image.url);
  });
});

test('enrichBatchItemsWithRealImages animates Reels slots automatically once their image is ready, without touching other channels', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'reels-auto-animar',
      name: 'Reels Auto Animar',
      handle: '@reelsautoanimar',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const batch = await generateContentSchedulePlan('reels-auto-animar', {
      days: 1,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_reels', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        { channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '12:00', intervalMinutes: 0 },
      ],
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'reels-auto-animar');

    let animateCalls = 0;
    await enrichBatchItemsWithRealImages(batch, project, 'reels-auto-animar', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/generated.png', mimeType: 'image/png' }),
      captionGenerator: async () => 'Legenda gerada',
      videoAnimator: async ({ content }) => {
        animateCalls += 1;
        assert.equal(content.channel, 'instagram_reels', 'videoAnimator should only ever be called for the Reels item');
        return { url: 'https://cdn.example.com/generated.mp4', mimeType: 'video/mp4', durationSeconds: 7 };
      },
    });

    assert.equal(animateCalls, 1);
    const content = await listProjectContent('reels-auto-animar', dir);
    const reels = content.find((item) => item.channel === 'instagram_reels');
    const feed = content.find((item) => item.channel === 'instagram_feed');

    assert.equal(reels.video.url, 'https://cdn.example.com/generated.mp4');
    assert.equal(reels.video.generatedSource, 'ffmpeg_zoompan');
    assert.equal(reels.videoGenerationError, null);
    assert.equal(feed.video, undefined, 'a non-Reels channel should never get a video attached');
  });
});

test('enrichBatchItemsWithRealImages records a videoGenerationError instead of failing the whole batch when the animator throws', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'reels-auto-falha',
      name: 'Reels Auto Falha',
      handle: '@reelsautofalha',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const batch = await generateContentSchedulePlan('reels-auto-falha', {
      days: 1,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_reels', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'reels-auto-falha');

    await enrichBatchItemsWithRealImages(batch, project, 'reels-auto-falha', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/generated.png', mimeType: 'image/png' }),
      videoAnimator: async () => { throw new Error('ffmpeg indisponível'); },
    });

    const content = await listProjectContent('reels-auto-falha', dir);
    const reels = content[0];
    assert.equal(reels.video, undefined);
    assert.equal(reels.videoGenerationError, 'ffmpeg indisponível');
    assert.equal(reels.imageGenerationError, null, 'a failed animation should not be mistaken for a failed image');
  });
});

test('regenerating one card\'s image individually unlinks it from its shared-creative siblings on both sides', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'desvincular-criativo',
      name: 'Desvincular Criativo',
      handle: '@desvincularcriativo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const batch = await generateContentSchedulePlan('desvincular-criativo', {
      days: 1,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        { channel: 'facebook_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'desvincular-criativo');

    await enrichBatchItemsWithRealImages(batch, project, 'desvincular-criativo', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/shared.png', mimeType: 'image/png' }),
    });

    const before = await listProjectContent('desvincular-criativo', dir);
    const story = before.find((item) => item.channel === 'instagram_story');
    const fbStoryBefore = before.find((item) => item.channel === 'facebook_story');
    assert.deepEqual(story.creativeSharedWith, [fbStoryBefore.contentId]);

    await regenerateContentDay('desvincular-criativo', story.contentId, {
      regenerate: 'creative',
      batchId: story.batchId,
      imageGenerator: async () => ({ url: 'https://cdn.example.com/nova-imagem-so-story.png', mimeType: 'image/png' }),
    }, dir);

    const after = await listProjectContent('desvincular-criativo', dir);
    const storyAfter = after.find((item) => item.channel === 'instagram_story');
    const fbStoryAfter = after.find((item) => item.channel === 'facebook_story');

    assert.equal(storyAfter.creativeSharedWith, null);
    assert.equal(fbStoryAfter.creativeSharedWith, null);
    assert.equal(storyAfter.image.url, 'https://cdn.example.com/nova-imagem-so-story.png');
    assert.equal(fbStoryAfter.image.url, 'https://cdn.example.com/shared.png');
  });
});

test('regenerateContentGroup regenerates a shared creative once and copies it to every member, keeping them linked', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'regenerar-grupo',
      name: 'Regenerar Grupo',
      handle: '@regenerargrupo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const batch = await generateContentSchedulePlan('regenerar-grupo', {
      days: 1,
      startDate: '2026-07-20',
      formats: [
        { channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        { channel: 'facebook_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
        { channel: 'instagram_reels', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 },
      ],
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'regenerar-grupo');

    await enrichBatchItemsWithRealImages(batch, project, 'regenerar-grupo', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/original.png', mimeType: 'image/png' }),
      captionGenerator: async () => 'Legenda original.',
    });

    const before = await listProjectContent('regenerar-grupo', dir);
    const groupIds = before.map((item) => item.contentId);
    assert.equal(groupIds.length, 3);

    let imageCalls = 0;
    let captionCalls = 0;
    const regenerated = await regenerateContentGroup('regenerar-grupo', groupIds, {
      regenerate: 'all',
      note: 'Deixar mais vibrante.',
      batchId: before[0].batchId,
      imageGenerator: async () => {
        imageCalls += 1;
        return { url: 'https://cdn.example.com/novo-grupo.png', mimeType: 'image/png' };
      },
      captionGenerator: async () => {
        captionCalls += 1;
        return 'Legenda nova para o grupo inteiro.';
      },
    }, dir);

    // Only one real AI call each — not one per channel.
    assert.equal(imageCalls, 1);
    assert.equal(captionCalls, 1);
    assert.equal(regenerated.length, 3);

    const after = await listProjectContent('regenerar-grupo', dir);
    for (const item of after) {
      assert.equal(item.image.url, 'https://cdn.example.com/novo-grupo.png');
      assert.equal(item.caption.text, 'Legenda nova para o grupo inteiro.');
      assert.equal(item.status, 'regenerated');
      // Still linked to the other two members after a group regenerate.
      assert.deepEqual(
        [...item.creativeSharedWith].sort(),
        groupIds.filter((id) => id !== item.contentId).sort(),
      );
    }
  });
});

test('regenerateContentGroup rejects an empty content list instead of silently doing nothing', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'regenerar-grupo-vazio',
      name: 'Regenerar Grupo Vazio',
      handle: '@regenerargrupovazio',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await assert.rejects(
      () => regenerateContentGroup('regenerar-grupo-vazio', [], { regenerate: 'all' }, dir),
      /Nenhum conteúdo informado/,
    );
  });
});

test('runDuePublishSweep publishes approved content whose scheduled time has already passed', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'publish-due',
      name: 'Publish Due',
      handle: '@publishdue',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('publish-due', { days: 1, startDate: '2026-07-20', postTime: '09:00' }, dir);
    await approveContent('publish-due', batch.items[0].contentId, dir, batch.batchId);

    const publisherCalls = [];
    const result = await runDuePublishSweep(dir, {
      now: new Date('2026-07-20T12:00:00.000Z'),
      metaPublisher: async (payload) => { publisherCalls.push(payload); return { mediaId: 'media-1', permalink: 'https://instagram.com/p/abc' }; },
    });

    assert.deepEqual(result.published, [batch.items[0].contentId]);
    assert.equal(result.failed.length, 0);
    assert.equal(publisherCalls[0].project.projectId, 'publish-due');
    const raw = JSON.parse(await readFile(batch.items[0].filePath, 'utf-8'));
    assert.equal(raw.publish.realPublished, true);
    assert.equal(raw.publish.metaMediaId, 'media-1');
    assert.equal(raw.publish.permalink, 'https://instagram.com/p/abc');
  });
});

test('runDuePublishSweep does not publish approved content scheduled in the future', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'publish-future',
      name: 'Publish Future',
      handle: '@publishfuture',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('publish-future', { days: 1, startDate: '2026-07-20', postTime: '09:00' }, dir);
    await approveContent('publish-future', batch.items[0].contentId, dir, batch.batchId);

    const result = await runDuePublishSweep(dir, {
      now: new Date('2026-07-19T00:00:00.000Z'),
      metaPublisher: async () => ({ mediaId: 'media-1' }),
    });

    assert.deepEqual(result.published, []);
    const raw = JSON.parse(await readFile(batch.items[0].filePath, 'utf-8'));
    assert.notEqual(raw.publish.realPublished, true);
  });
});

test('runDuePublishSweep records the error and keeps the item unpublished when the publisher fails', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'publish-fails',
      name: 'Publish Fails',
      handle: '@publishfails',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('publish-fails', { days: 1, startDate: '2026-07-20', postTime: '09:00' }, dir);
    await approveContent('publish-fails', batch.items[0].contentId, dir, batch.batchId);

    const result = await runDuePublishSweep(dir, {
      now: new Date('2026-07-20T12:00:00.000Z'),
      metaPublisher: async () => { throw new Error('Meta API rejected the request'); },
    });

    assert.equal(result.published.length, 0);
    assert.equal(result.failed[0].contentId, batch.items[0].contentId);
    const raw = JSON.parse(await readFile(batch.items[0].filePath, 'utf-8'));
    assert.notEqual(raw.publish.realPublished, true);
    assert.match(raw.publish.error, /Meta API rejected the request/);
  });
});

test('publishSingleContent publishes on demand even before the scheduled time', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'publish-manual',
      name: 'Publish Manual',
      handle: '@publishmanual',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('publish-manual', { days: 1, startDate: '2099-01-01', postTime: '09:00' }, dir);
    await approveContent('publish-manual', batch.items[0].contentId, dir, batch.batchId);

    const content = await publishSingleContent('publish-manual', batch.items[0].contentId, dir, {
      metaPublisher: async () => ({ mediaId: 'media-2', permalink: null }),
    }, batch.batchId);

    assert.equal(content.publish.realPublished, true);
    assert.equal(content.publish.metaMediaId, 'media-2');
  });
});

test('buildApprovalPayload creates a safe approval artifact for one content day', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'approval-demo',
      name: 'Approval Demo',
      handle: '@approvaldemo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('approval-demo', { days: 1, startDate: '2026-07-20' }, dir);

    const payload = await buildApprovalPayload('approval-demo', batch.items[0].contentId, dir);

    assert.equal(payload.projectId, 'approval-demo');
    assert.equal(payload.target.handle, '@approvaldemo');
    assert.equal(payload.approval.requiredPhrase, 'APROVADO');
    assert.ok(payload.files.json.endsWith('approval-demo-2026-07-20-instagram_feed-approval.json'));
    await stat(payload.files.json);
  });
});

test('listSystemAlerts flags an expired token and one about to expire, but not a permanent (no-expiry) token', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'token-expirado',
      name: 'Token Expirado',
      handle: '@tokenexpirado',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectToken('token-expirado', {
      token: 'EAAB-expired-token',
      expiresAt: '2026-07-10T12:00:00.000Z',
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    await createCentralProject({
      projectId: 'token-vencendo',
      name: 'Token Vencendo',
      handle: '@tokenvencendo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectToken('token-vencendo', {
      token: 'EAAB-soon-token',
      expiresAt: '2026-07-25T12:00:00.000Z',
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    await createCentralProject({
      projectId: 'token-permanente',
      name: 'Token Permanente',
      handle: '@tokenpermanente',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectToken('token-permanente', {
      token: 'EAAB-permanent-token',
      expiresAt: null,
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    await createCentralProject({
      projectId: 'sem-token',
      name: 'Sem Token',
      handle: '@semtoken',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const alerts = await listSystemAlerts(dir);
    const byProject = Object.fromEntries(alerts.map((a) => [a.projectId, a]));

    assert.equal(byProject['token-expirado'].type, 'token_expired');
    assert.equal(byProject['token-vencendo'].type, 'token_expiring');
    assert.match(byProject['token-vencendo'].message, /5 dia/);
    assert.equal(byProject['token-permanente'], undefined);
    assert.equal(byProject['sem-token'], undefined);
  });
});

test('listSystemAlerts flags an unresolved publish failure and clears once it publishes successfully', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'falha-publicar',
      name: 'Falha Publicar',
      handle: '@falhapublicar',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('falha-publicar', { days: 1, startDate: '2026-07-20', postTime: '09:00' }, dir);
    await approveContent('falha-publicar', batch.items[0].contentId, dir, batch.batchId);

    await runDuePublishSweep(dir, {
      now: new Date('2026-07-20T12:00:00.000Z'),
      metaPublisher: async () => { throw new Error('Meta API rejected the request'); },
    });

    const alertsAfterFailure = await listSystemAlerts(dir);
    const failureAlert = alertsAfterFailure.find((a) => a.type === 'publish_failed' && a.projectId === 'falha-publicar');
    assert.ok(failureAlert);
    assert.match(failureAlert.message, /Meta API rejected the request/);

    await runDuePublishSweep(dir, {
      now: new Date('2026-07-20T12:05:00.000Z'),
      metaPublisher: async () => ({ mediaId: 'abc123' }),
    });

    const alertsAfterSuccess = await listSystemAlerts(dir);
    assert.equal(alertsAfterSuccess.some((a) => a.type === 'publish_failed' && a.projectId === 'falha-publicar'), false);
  });
});

test('sendDueAlertEmails emails once per issue and respects the cooldown on the next sweep', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'email-alerta',
      name: 'Email Alerta',
      handle: '@emailalerta',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectToken('email-alerta', {
      token: 'EAAB-soon-token',
      expiresAt: '2026-07-23T12:00:00.000Z',
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    const sentEmails = [];
    const emailSender = async (email) => { sentEmails.push(email); };

    const first = await sendDueAlertEmails(dir, { now: new Date('2026-07-20T12:05:00.000Z'), emailSender });
    assert.equal(first.sent.length, 1);
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].subject, /Email Alerta/);
    assert.match(sentEmails[0].body, /Token da Meta vence em 3 dia\(s\)\./);

    // Same issue, well within the 24h cooldown — must not re-send.
    const second = await sendDueAlertEmails(dir, { now: new Date('2026-07-20T12:10:00.000Z'), emailSender });
    assert.equal(second.sent.length, 0);
    assert.equal(sentEmails.length, 1);

    // Past the cooldown — re-sends since the token is still expiring.
    const third = await sendDueAlertEmails(dir, {
      now: new Date('2026-07-21T13:00:00.000Z'),
      cooldownHours: 24,
      emailSender,
    });
    assert.equal(third.sent.length, 1);
    assert.equal(sentEmails.length, 2);
  });
});

test('sendDueAlertEmails re-notifies immediately after an alert resolves and recurs, instead of waiting out a stale cooldown', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'email-recorrente',
      name: 'Email Recorrente',
      handle: '@emailrecorrente',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const sentEmails = [];
    const emailSender = async (email) => { sentEmails.push(email); };

    await saveProjectToken('email-recorrente', {
      token: 'EAAB-soon-token',
      expiresAt: '2026-07-22T12:00:00.000Z',
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    await sendDueAlertEmails(dir, { now: new Date('2026-07-20T12:01:00.000Z'), emailSender });
    assert.equal(sentEmails.length, 1);

    // Resolved: a fresh, permanent (no-expiry) token — no active alert, so
    // the next sweep should prune the notified key instead of leaving it
    // sitting around blocking a future recurrence.
    await saveProjectToken('email-recorrente', {
      token: 'EAAB-permanent-token',
      expiresAt: null,
    }, dir, new Date('2026-07-20T12:02:00.000Z'));
    await sendDueAlertEmails(dir, { now: new Date('2026-07-20T12:03:00.000Z'), emailSender });
    assert.equal(sentEmails.length, 1);

    // Recurs minutes later (token swapped again, now expiring) — must alert
    // right away, not wait out the 24h cooldown from the resolved instance.
    await saveProjectToken('email-recorrente', {
      token: 'EAAB-soon-again-token',
      expiresAt: '2026-07-22T12:05:00.000Z',
    }, dir, new Date('2026-07-20T12:04:00.000Z'));
    await sendDueAlertEmails(dir, { now: new Date('2026-07-20T12:05:00.000Z'), emailSender });
    assert.equal(sentEmails.length, 2);
  });
});

test('reconcileInterruptedGenerations clears a card stuck "generating" from a previous server process and records why', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'geracao-travada',
      name: 'Geração Travada',
      handle: '@geracaotravada',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('geracao-travada', { days: 2, startDate: '2026-07-20' }, dir);
    const stuckItem = batch.items[0];
    const normalItem = batch.items[1];

    // Simulates the background promise from enqueueBatchImageGeneration
    // dying mid-flight when the process that started it got restarted —
    // the last thing written for this card was "still generating".
    const raw = JSON.parse(await readFile(stuckItem.filePath, 'utf-8'));
    raw.image.generating = true;
    await writeFile(stuckItem.filePath, JSON.stringify(raw, null, 2), 'utf-8');

    const fixed = await reconcileInterruptedGenerations(dir);
    assert.equal(fixed.length, 1);
    assert.equal(fixed[0].contentId, stuckItem.contentId);

    const reloadedStuck = JSON.parse(await readFile(stuckItem.filePath, 'utf-8'));
    assert.equal(reloadedStuck.image.generating, false);
    assert.match(reloadedStuck.imageGenerationError, /servidor foi reiniciado/);

    // A card that was never mid-generation must be left untouched.
    const reloadedNormal = JSON.parse(await readFile(normalItem.filePath, 'utf-8'));
    assert.ok(!reloadedNormal.image.generating);
    assert.equal(reloadedNormal.imageGenerationError, undefined);

    // Running it again with nothing stuck should be a no-op.
    const secondRun = await reconcileInterruptedGenerations(dir);
    assert.equal(secondRun.length, 0);
  });
});

test('listCentralProjects returns safe project summaries without secrets', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'zeta-cliente',
      name: 'Zeta Cliente',
      handle: '@zeta',
      approvalEmail: 'zeta@example.com',
    }, dir);
    await createCentralProject({
      projectId: 'alfa-cliente',
      name: 'Alfa Cliente',
      handle: '@alfa',
      approvalEmail: 'alfa@example.com',
      mode: 'manual',
    }, dir);
    await saveProjectToken('alfa-cliente', {
      token: 'secret-token-1234',
      expiresAt: '2026-08-14T12:00:00.000Z',
    }, dir, new Date('2026-07-15T12:00:00.000Z'));

    const projects = await listCentralProjects(dir);

    assert.deepEqual(projects.map((project) => project.projectId), ['alfa-cliente', 'zeta-cliente']);
    assert.equal(projects[0].name, 'Alfa Cliente');
    assert.equal(projects[0].token.masked, '****1234');
    assert.equal(JSON.stringify(projects).includes('secret-token-1234'), false);
  });
});

test('listProjectContent returns generated days for a project', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'lista-demo',
      name: 'Lista Demo',
      handle: '@lista',
      approvalEmail: 'lista@example.com',
    }, dir);
    const batch = await generateContentBatch('lista-demo', { days: 2, startDate: '2026-07-20' }, dir);

    const content = await listProjectContent('lista-demo', dir);

    assert.equal(content.length, 2);
    assert.equal(content[0].contentId, batch.items[0].contentId);
    assert.equal(content[1].scheduledDate, '2026-07-21');
  });
});

test('projectType defaults to marketing, is validated, and is echoed by loadProject/toProjectSummary/listCentralProjects', async () => {
  await withTempProject(async (dir) => {
    const marketing = await createCentralProject({
      projectId: 'pizzaria-marketing',
      name: 'Pizzaria Marketing',
      handle: '@pizzariamkt',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    assert.equal(marketing.projectType, 'marketing');

    const catalog = await createCentralProject({
      projectId: 'loja-celulares',
      name: 'Loja de Celulares',
      handle: '@lojacelulares',
      approvalEmail: 'aprovacao@example.com',
      projectType: 'catalog',
    }, dir);
    assert.equal(catalog.projectType, 'catalog');

    await assert.rejects(
      () => createCentralProject({
        projectId: 'tipo-invalido',
        name: 'Tipo Inválido',
        handle: '@invalido',
        approvalEmail: 'aprovacao@example.com',
        projectType: 'ecommerce',
      }, dir),
      /Unsupported project type/,
    );

    const projects = await listCentralProjects(dir);
    const summary = projects.find((project) => project.projectId === 'loja-celulares');
    assert.equal(summary.projectType, 'catalog');
  });
});

test('generateCatalogSchedulePlan round-robins only active products to Instagram Story and persists the rotation cursor', async () => {
  await withTempProject(async (dir) => {
    const projectId = 'catalogo-celulares';
    await createCentralProject({
      projectId,
      name: 'Catálogo de Celulares',
      handle: '@catalogocel',
      approvalEmail: 'aprovacao@example.com',
      projectType: 'catalog',
    }, dir);

    const { offer: iphone } = await saveProjectOffer(projectId, { name: 'iPhone 13 128GB', price: 'R$ 2.499,00', active: true }, dir);
    const { offer: galaxy } = await saveProjectOffer(projectId, { name: 'Galaxy S21', price: 'R$ 1.899,00', active: true }, dir);
    await saveProjectOffer(projectId, { name: 'Modelo Descontinuado', price: 'R$ 999,00', active: false }, dir);

    const firstBatch = await generateCatalogSchedulePlan(projectId, { days: 2, storiesPerDay: 2, startDate: '2026-08-01' }, dir);

    assert.equal(firstBatch.items.length, 4);
    assert.ok(firstBatch.items.every((item) => item.channel === 'instagram_story'));
    assert.deepEqual(
      firstBatch.items.map((item) => item.contentTopic.offerId),
      [iphone.id, galaxy.id, iphone.id, galaxy.id],
      'inactive product must never be scheduled, active products alternate evenly',
    );

    const secondBatch = await generateCatalogSchedulePlan(projectId, { days: 1, storiesPerDay: 2, startDate: '2026-08-03' }, dir);
    assert.deepEqual(
      secondBatch.items.map((item) => item.contentTopic.offerId),
      [iphone.id, galaxy.id],
      'rotation cursor must persist across separate generateCatalogSchedulePlan calls',
    );
  });
});

test('regenerateContentDay recomposes the real product photo for a catalog project, never calling the AI image generator', async () => {
  await withTempProject(async (dir) => {
    const projectId = 'catalogo-regen';
    await createCentralProject({
      projectId,
      name: 'Catálogo Regen',
      handle: '@catregen',
      approvalEmail: 'aprovacao@example.com',
      projectType: 'catalog',
    }, dir);
    await saveProjectOffer(projectId, { name: 'Onix 1.0', price: 'R$ 55.000,00', active: true }, dir);

    const batch = await generateCatalogSchedulePlan(projectId, { days: 1, storiesPerDay: 1, startDate: '2026-08-01' }, dir);
    const contentId = batch.items[0].contentId;

    let composerCalls = 0;
    const catalogImageComposer = async ({ content }) => {
      composerCalls += 1;
      assert.equal(content.contentId, contentId);
      return { url: '/fake/regenerated.png', mimeType: 'image/png' };
    };
    const imageGenerator = async () => { throw new Error('AI image generator should never be called for a catalog project'); };

    const content = await regenerateContentDay(projectId, contentId, {
      regenerate: 'creative',
      batchId: batch.batchId,
      catalogImageComposer,
      imageGenerator,
    }, dir);

    assert.equal(composerCalls, 1);
    assert.equal(content.image.url, '/fake/regenerated.png');
    assert.equal(content.image.generatedSource, 'catalog_compose');
    assert.equal(content.imageGenerationError, null);
  });
});

test('simulateTestPost refuses to run for a catalog project instead of silently generating fake AI art', async () => {
  await withTempProject(async (dir) => {
    const projectId = 'catalogo-teste-seguro';
    await createCentralProject({
      projectId,
      name: 'Catálogo Teste Seguro',
      handle: '@catts',
      approvalEmail: 'aprovacao@example.com',
      projectType: 'catalog',
    }, dir);

    await assert.rejects(
      () => simulateTestPost(projectId, { channel: 'instagram_story' }, dir),
      /Teste seguro.*não tem suporte para projetos de catálogo/,
    );
  });
});
