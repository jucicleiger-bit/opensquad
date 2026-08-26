import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  analyzeLearningImage,
  approveContent,
  buildApprovalPayload,
  calculateTokenDaysRemaining,
  createCentralProject,
  deleteCommercialCatalogItem,
  deleteCommercialProposal,
  deleteCommercialPortfolioItem,
  deleteCommercialProspect,
  duplicateCentralProject,
  getCommercialAgency,
  getCommercialProposal,
  listCommercialCatalogItems,
  listCommercialPortfolioItems,
  listCommercialProspects,
  listCommercialProcesses,
  listCommercialProposals,
  saveCommercialAgency,
  saveCommercialAgencyLogo,
  saveCommercialCatalogItem,
  saveCommercialPortfolioItem,
  saveCommercialProcess,
  saveCommercialProspect,
  saveCommercialProposal,
  buildSegmentLayoutReferences,
  buildSegmentTemplateContentItem,
  deleteAdCreative,
  deleteCarousel,
  deleteLearningEntry,
  deleteProjectContent,
  deleteProjectReference,
  enqueueSegmentTemplateAdaptation,
  enrichAdCreativeWithRealImage,
  enrichBatchItemsWithRealImages,
  enrichSegmentTemplateItemsForProspect,
  generateAdCreative,
  generateCarousel,
  listAdCreatives,
  listCarousels,
  generateCatalogSchedulePlan,
  creativeShapeGroupForChannel,
  generateContentBatch,
  generateContentSchedulePlan,
  previewContentSchedulePlan,
  generateSpecialDateContent,
  getCentralPaths,
  listCentralProjects,
  listCommemorativeDates,
  listSegmentTemplates,
  listSystemAlerts,
  loadOfferTypeLearning,
  loadProjectForTest,
  loadSegmentLearningNodes,
  loadSegmentLearningNodesForSelection,
  loadSegmentTemplate,
  migrateSegmentLearningStoreV1ToV2,
  registerSegmentTemplate,
  reconcileInterruptedGenerations,
  saveLearningEntry,
  saveOfferTypeBaseInstruction,
  sendDueAlertEmails,
  listProjectReferences,
  listProjectContent,
  publishSingleContent,
  regenerateAdCreative,
  regenerateContentDay,
  regenerateContentGroup,
  refreshProjectTopicIdeas,
  researchOnlineVisualTrends,
  runDuePublishSweep,
  retryStuckMediaUploads,
  deleteProjectOffer,
  deleteProjectOfferGroup,
  deleteProjectPillar,
  saveProjectOffer,
  saveProjectOfferGroup,
  saveProjectPillar,
  suggestProjectPillars,
  saveProjectAsset,
  saveProjectToken,
  saveProjectWhatsAppInstance,
  simulateTestPost,
  updateContentCaption,
  animateContentForReels,
  analyzeProjectBrandXray,
  analyzeProjectBrandBriefing,
  analyzeProjectTechnicalBase,
  approveProjectBrandXray,
  approveProjectBrandBriefing,
  updateProjectBrandInput,
  updateProjectCompanyProfile,
  updateProjectSettings,
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

// Sales/product-driven post types require a registered creative template (a
// segment-learning entry tagged purpose:'creative' with a matching postType /
// shape) before AI generation is allowed to proceed. Service and
// non-sales/content types intentionally stay free-form.
let registerCreativeTemplateCounter = 0;
async function registerCreativeTemplate(groupKey, postType, shape, dir, filename) {
  registerCreativeTemplateCounter += 1;
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const template = await analyzeLearningImage({
    scope: 'segment', groupKey, dataUrl, filename: filename || `modelo-teste-${registerCreativeTemplateCounter}.png`,
  }, dir, new Date(), { learningImageAnalyzer: async () => 'modelo' });
  await saveLearningEntry({
    scope: 'segment', groupKey, bucket: 'approved', kind: 'image',
    text: 'modelo de referência', imagePath: template.imagePath,
    purpose: 'creative', postType, shape,
  }, dir);
  return template;
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

test('duplicateCentralProject copies Raio-X text fields into a new project and resets what must stay per-project', async () => {
  await withTempProject(async (dir) => {
    const source = await createCentralProject({
      projectId: 'boss-pizzaria',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
      mode: 'semi_automatic',
      voice: 'Tom direto, informal e apetitoso.',
      visualStyle: 'Fundo claro, fotografia realista.',
      imageRules: ['Preservar a aparência real dos produtos.'],
      projectRules: ['Usar vermelho e branco'],
    }, dir);
    assert.equal(source.projectId, 'boss-pizzaria');

    await updateProjectCompanyProfile('boss-pizzaria', {
      segment: 'Pizzaria',
      description: 'Pizzaria de bairro com rodízio e delivery.',
      productsOrServices: 'rodízio de pizzas, delivery',
    }, dir);

    const analyzed = await analyzeProjectBrandXray('boss-pizzaria', {}, dir, new Date('2026-08-19T12:00:00.000Z'));
    assert.equal(analyzed.project.brandXray.status, 'generated');
    const approved = await approveProjectBrandXray('boss-pizzaria', { edits: {} }, dir, new Date('2026-08-19T12:05:00.000Z'));
    assert.equal(approved.project.brandXray.status, 'approved');

    await saveProjectOffer('boss-pizzaria', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    await saveProjectPillar('boss-pizzaria', { name: 'Ensina', role: 'ensina', weight: 1 }, dir);
    await saveProjectOfferGroup('boss-pizzaria', { name: 'Fim de semana' }, dir);
    await saveProjectToken('boss-pizzaria', { token: 'fake-token', expiresAt: '2026-12-01T00:00:00.000Z' }, dir, new Date('2026-08-19T12:10:00.000Z'));

    const sourceProject = await loadProjectForTest('boss-pizzaria', dir);

    const duplicated = await duplicateCentralProject('boss-pizzaria', {
      projectId: 'boss-pizzaria-zona-sul',
      name: 'Boss Pizzaria Zona Sul',
    }, dir);

    assert.equal(duplicated.projectId, 'boss-pizzaria-zona-sul');
    assert.equal(duplicated.name, 'Boss Pizzaria Zona Sul');
    assert.equal(duplicated.mode, 'semi_automatic');
    assert.equal(duplicated.projectType, 'marketing');

    assert.deepEqual(duplicated.companyProfile, sourceProject.companyProfile);
    assert.deepEqual(duplicated.brandInput, sourceProject.brandInput);
    assert.equal(duplicated.brandXray.status, 'approved');
    assert.deepEqual(duplicated.brandXray.blocks, sourceProject.brandXray.blocks);
    assert.equal(duplicated.brand.voice, 'Tom direto, informal e apetitoso.');
    assert.equal(duplicated.brand.visualStyle, 'Fundo claro, fotografia realista.');
    assert.deepEqual(duplicated.brand.imageRules, ['Preservar a aparência real dos produtos.']);
    assert.deepEqual(duplicated.rules.project, ['Usar vermelho e branco']);
    assert.equal(duplicated.contentStrategy.offers.length, 1);
    assert.equal(duplicated.contentStrategy.offers[0].name, 'Pizza Grande');
    assert.equal(duplicated.contentStrategy.pillars.length, 1);
    assert.equal(duplicated.contentStrategy.pillars[0].name, 'Ensina');
    assert.equal(duplicated.contentStrategy.offerGroups.length, 1);
    assert.equal(duplicated.contentStrategy.offerGroups[0].name, 'Fim de semana');

    assert.equal(duplicated.instagram.handle, '');
    assert.equal(duplicated.approvalEmail, '');
    assert.equal(duplicated.token.configured, false);
    assert.equal(duplicated.brand.logoPath, 'assets/logo.png');
    assert.deepEqual(duplicated.brand.references, []);
    assert.equal(duplicated.isProspect, false);
    assert.equal(duplicated.prospectSource, null);
    assert.deepEqual(duplicated.learnings, { approved: [], avoid: [] });

    const sourceAfter = await loadProjectForTest('boss-pizzaria', dir);
    assert.equal(sourceAfter.instagram.handle, '@bosspizzaria');
    assert.equal(sourceAfter.token.configured, true);
    assert.equal(sourceAfter.contentStrategy.offers.length, 1);

    const paths = getCentralPaths(dir, 'boss-pizzaria-zona-sul');
    const manual = await readFile(paths.manualPath, 'utf-8');
    assert.match(manual, /Pizza Grande/);
    assert.match(manual, /Ensina/);
  });
});

test('duplicateCentralProject brings offer photos (metadata + file) along, not just the offer text', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'casa-embalagem-a', name: 'Casa Embalagem A', handle: '@ce', approvalEmail: 'a@example.com' }, dir);
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const uploaded = await saveProjectAsset('casa-embalagem-a', {
      kind: 'reference',
      filename: 'caixa.png',
      dataUrl,
      role: 'product_photo',
      referenceCategory: 'real_product',
      scope: 'offer',
    }, dir);
    const photoId = uploaded.metadata.id;

    await saveProjectOffer('casa-embalagem-a', { name: 'Caixa de papelão', type: 'offer', photoReferenceIds: [photoId] }, dir);

    const duplicated = await duplicateCentralProject('casa-embalagem-a', {
      projectId: 'casa-embalagem-b',
      name: 'Casa Embalagem B',
    }, dir);

    assert.equal(duplicated.offerAssets?.length, 1);
    assert.equal(duplicated.offerAssets[0].id, photoId);
    assert.deepEqual(duplicated.contentStrategy.offers[0].photoReferenceIds, [photoId]);

    const destPaths = getCentralPaths(dir, 'casa-embalagem-b');
    await access(join(destPaths.projectDir, duplicated.offerAssets[0].relativePath));
  });
});

test('duplicateCentralProject rejects a target id that already exists', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'origem', name: 'Origem' }, dir);
    await createCentralProject({ projectId: 'ja-existe', name: 'Já Existe' }, dir);

    await assert.rejects(
      () => duplicateCentralProject('origem', { projectId: 'ja-existe', name: 'Outro Nome' }, dir),
      /Project already exists: ja-existe/,
    );
  });
});

test('duplicateCentralProject rejects a missing source project', async () => {
  await withTempProject(async (dir) => {
    await assert.rejects(
      () => duplicateCentralProject('nao-existe', { projectId: 'novo', name: 'Novo' }, dir),
      /Project not found: nao-existe/,
    );
  });
});

test('saveCommercialCatalogItem creates and updates catalog items, listCommercialCatalogItems returns them normalized', async () => {
  await withTempProject(async (dir) => {
    const created = await saveCommercialCatalogItem({
      category: 'Criação de Conteúdo',
      name: 'Profissional',
      description: '3 artes por dia, 2 feed por semana.',
      whatWeDeliver: ['3 artes/dia', '2 feed/semana'],
      whatClientProvides: ['Fotos quando pedido'],
      billingType: 'mensal',
      price: 497,
    }, dir);

    assert.equal(created.id, 'profissional');
    assert.equal(created.category, 'Criação de Conteúdo');
    assert.equal(created.billingType, 'mensal');
    assert.equal(created.price, 497);
    assert.equal(created.fullPrice, 0);
    assert.deepEqual(created.whatWeDeliver, ['3 artes/dia', '2 feed/semana']);

    const setupFee = await saveCommercialCatalogItem({
      category: 'Criação de Conteúdo',
      name: 'Configuração inicial',
      billingType: 'unica',
      fullPrice: 250,
      discountedPrice: 0,
    }, dir);
    assert.equal(setupFee.billingType, 'unica');
    assert.equal(setupFee.fullPrice, 250);
    assert.equal(setupFee.discountedPrice, 0);
    assert.equal(setupFee.price, 0);

    let items = await listCommercialCatalogItems(dir);
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((item) => item.id).sort(), ['configuracao-inicial', 'profissional']);

    const updated = await saveCommercialCatalogItem({ id: 'profissional', category: 'Criação de Conteúdo', name: 'Profissional', price: 597, billingType: 'mensal' }, dir);
    assert.equal(updated.price, 597);

    items = await listCommercialCatalogItems(dir);
    assert.equal(items.length, 2, 'updating an existing id must not create a duplicate entry');
    assert.equal(items.find((item) => item.id === 'profissional').price, 597);
  });
});

test('saveCommercialCatalogItem rejects a missing name or category', async () => {
  await withTempProject(async (dir) => {
    await assert.rejects(() => saveCommercialCatalogItem({ category: 'X' }, dir), /Nome do item é obrigatório/);
    await assert.rejects(() => saveCommercialCatalogItem({ name: 'X' }, dir), /Categoria é obrigatória/);
  });
});

test('deleteCommercialCatalogItem removes only the targeted item', async () => {
  await withTempProject(async (dir) => {
    await saveCommercialCatalogItem({ category: 'Tráfego Pago', name: 'Básico', billingType: 'unica', fullPrice: 250, discountedPrice: 0 }, dir);
    await saveCommercialCatalogItem({ category: 'Tráfego Pago', name: 'Avançado', billingType: 'unica', fullPrice: 400, discountedPrice: 0 }, dir);

    const result = await deleteCommercialCatalogItem('basico', dir);
    assert.deepEqual(result, { id: 'basico', deleted: true });

    const items = await listCommercialCatalogItems(dir);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'avancado');
  });
});

test('saveCommercialAgency stores name/contact, saveCommercialAgencyLogo stores the file and never gets wiped by a later saveCommercialAgency call', async () => {
  await withTempProject(async (dir) => {
    let agency = await getCommercialAgency(dir);
    assert.deepEqual(agency, { name: '', logoPath: '', contactPhone: '', contactInstagram: '', about: '', updatedAt: null });

    agency = await saveCommercialAgency({ name: 'King Assessoria de Mkt', contactPhone: '(65) 99999-0000', contactInstagram: '@kingassessoria', about: 'Agência de marketing digital.' }, dir);
    assert.equal(agency.name, 'King Assessoria de Mkt');
    assert.equal(agency.about, 'Agência de marketing digital.');
    assert.equal(agency.logoPath, '');

    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    agency = await saveCommercialAgencyLogo({ filename: 'minha-logo.PNG', dataUrl: pngDataUrl }, dir);
    assert.equal(agency.logoPath, 'logo.png');
    assert.equal(agency.name, 'King Assessoria de Mkt', 'uploading the logo must not lose the name already saved');

    const paths = getCentralPaths(dir);
    await stat(join(paths.commercialAssetsDir, 'logo.png'));

    agency = await saveCommercialAgency({ name: 'King Assessoria de Mkt', contactPhone: '(65) 98888-1111', contactInstagram: '@kingassessoria' }, dir);
    assert.equal(agency.logoPath, 'logo.png', 'a plain settings save must never wipe the previously uploaded logo');
    assert.equal(agency.contactPhone, '(65) 98888-1111');
  });
});

test('saveCommercialProcess stores one process text per category, saving the same category again overwrites instead of duplicating', async () => {
  await withTempProject(async (dir) => {
    let list = await listCommercialProcesses(dir);
    assert.deepEqual(list, []);

    await saveCommercialProcess({ category: 'Criação de Conteúdo', text: 'Cada peça é feita sob medida pro negócio do cliente.' }, dir);
    await saveCommercialProcess({ category: 'Tráfego Pago', text: 'Testamos públicos e criativos até achar o que converte.' }, dir);

    list = await listCommercialProcesses(dir);
    assert.equal(list.length, 2);
    assert.deepEqual(list.find((entry) => entry.category === 'Criação de Conteúdo'), { category: 'Criação de Conteúdo', text: 'Cada peça é feita sob medida pro negócio do cliente.' });

    await saveCommercialProcess({ category: 'Criação de Conteúdo', text: 'Texto atualizado.' }, dir);
    list = await listCommercialProcesses(dir);
    assert.equal(list.length, 2, 'saving the same category again must overwrite, not add a second entry');
    assert.equal(list.find((entry) => entry.category === 'Criação de Conteúdo').text, 'Texto atualizado.');
  });
});

test('saveCommercialProcess rejects a missing category', async () => {
  await withTempProject(async (dir) => {
    await assert.rejects(() => saveCommercialProcess({ text: 'X' }, dir), /Categoria é obrigatória/);
  });
});

test('saveCommercialPortfolioItem saves the image file and an entry, listCommercialPortfolioItems returns them, deleteCommercialPortfolioItem removes both', async () => {
  await withTempProject(async (dir) => {
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const created = await saveCommercialPortfolioItem({ category: 'Criação de Conteúdo', caption: 'Post de lançamento', filename: 'arte.PNG', dataUrl: pngDataUrl }, dir);
    assert.equal(created.category, 'Criação de Conteúdo');
    assert.equal(created.caption, 'Post de lançamento');
    assert.ok(created.id);
    assert.equal(created.imagePath, `portfolio-${created.id}.png`);

    const paths = getCentralPaths(dir);
    await stat(join(paths.commercialAssetsDir, created.imagePath));

    let items = await listCommercialPortfolioItems(dir);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, created.id);

    const result = await deleteCommercialPortfolioItem(created.id, dir);
    assert.deepEqual(result, { id: created.id, deleted: true });

    items = await listCommercialPortfolioItems(dir);
    assert.equal(items.length, 0);
    await assert.rejects(() => stat(join(paths.commercialAssetsDir, created.imagePath)));
  });
});

test('saveCommercialPortfolioItem rejects a missing category', async () => {
  await withTempProject(async (dir) => {
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await assert.rejects(() => saveCommercialPortfolioItem({ caption: 'X', filename: 'a.png', dataUrl: pngDataUrl }, dir), /Categoria é obrigatória/);
  });
});

test('saveCommercialProspect creates an item with default status, listCommercialProspects returns it, saveCommercialProspect with the same id updates it in place', async () => {
  await withTempProject(async (dir) => {
    const created = await saveCommercialProspect({ name: 'Padaria Bom Pão', googleMapsUrl: 'https://maps.google.com/x', instagram: '@padariabompao', phone: '11999990000' }, dir);
    assert.ok(created.id);
    assert.equal(created.name, 'Padaria Bom Pão');
    assert.equal(created.status, 'nao_contatado');

    let items = await listCommercialProspects(dir);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, created.id);

    const updated = await saveCommercialProspect({ id: created.id, name: created.name, googleMapsUrl: created.googleMapsUrl, instagram: created.instagram, phone: created.phone, status: 'respondeu' }, dir);
    assert.equal(updated.id, created.id);
    assert.equal(updated.status, 'respondeu');

    items = await listCommercialProspects(dir);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'respondeu');
  });
});

test('saveCommercialProspect rejects a missing name and falls back to nao_contatado for an invalid status', async () => {
  await withTempProject(async (dir) => {
    await assert.rejects(() => saveCommercialProspect({ status: 'fechou' }, dir), /Nome é obrigatório/);

    const created = await saveCommercialProspect({ name: 'Loja X', status: 'inventado' }, dir);
    assert.equal(created.status, 'nao_contatado');
  });
});

test('deleteCommercialProspect removes the item', async () => {
  await withTempProject(async (dir) => {
    const created = await saveCommercialProspect({ name: 'Loja Y' }, dir);
    const result = await deleteCommercialProspect(created.id, dir);
    assert.deepEqual(result, { id: created.id, deleted: true });
    const items = await listCommercialProspects(dir);
    assert.equal(items.length, 0);
  });
});

test('saveCommercialProposal stores a full proposal with mixed single/comparison sections, listCommercialProposals summarizes newest-first, getCommercialProposal reopens it in full', async () => {
  await withTempProject(async (dir) => {
    const input = {
      clientName: 'Arthur Frios',
      clientLogoDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      sections: [
        {
          category: 'Criação de Conteúdo',
          mode: 'comparison',
          items: [
            { name: 'Essencial', billingType: 'mensal', price: 297 },
            { name: 'Profissional', billingType: 'mensal', price: 497 },
          ],
        },
        {
          category: 'Tráfego Pago',
          mode: 'single',
          items: [
            { catalogItemId: 'trafego-basico', name: 'Gestão Básica', billingType: 'unica', fullPrice: 250, discountedPrice: 0 },
          ],
        },
      ],
    };

    const saved = await saveCommercialProposal(input, dir);
    assert.ok(saved.id.startsWith('prop-'));
    assert.equal(saved.clientName, 'Arthur Frios');
    assert.equal(saved.sections.length, 2);
    assert.equal(saved.sections[0].items.length, 2);
    assert.equal(saved.sections[1].items[0].discountedPrice, 0);

    const list = await listCommercialProposals(dir);
    assert.equal(list.length, 1);
    assert.equal(list[0].clientName, 'Arthur Frios');
    assert.deepEqual(list[0].categories, ['Criação de Conteúdo', 'Tráfego Pago']);

    const reopened = await getCommercialProposal(saved.id, dir);
    assert.deepEqual(reopened, saved);
  });
});

test('saveCommercialProposal rejects a comparison-mode section masquerading as single, and a section with zero items', async () => {
  await withTempProject(async (dir) => {
    await assert.rejects(
      () => saveCommercialProposal({
        clientName: 'Teste',
        sections: [{ category: 'X', mode: 'single', items: [{ name: 'A', price: 1 }, { name: 'B', price: 2 }] }],
      }, dir),
      /modo único só pode ter 1 item/,
    );
    await assert.rejects(
      () => saveCommercialProposal({ clientName: 'Teste', sections: [{ category: 'X', mode: 'single', items: [] }] }, dir),
      /precisa de ao menos um item/,
    );
    await assert.rejects(
      () => saveCommercialProposal({ clientName: 'Teste', sections: [] }, dir),
      /ao menos uma seção/,
    );
  });
});

test('deleteCommercialProposal removes only the targeted proposal, getCommercialProposal then rejects it', async () => {
  await withTempProject(async (dir) => {
    const a = await saveCommercialProposal({ clientName: 'A', sections: [{ category: 'X', mode: 'single', items: [{ name: 'Item', price: 1 }] }] }, dir);
    const b = await saveCommercialProposal({ clientName: 'B', sections: [{ category: 'X', mode: 'single', items: [{ name: 'Item', price: 1 }] }] }, dir);

    const result = await deleteCommercialProposal(a.id, dir);
    assert.deepEqual(result, { id: a.id, deleted: true });

    await assert.rejects(() => getCommercialProposal(a.id, dir), /Proposta não encontrada/);
    const stillThere = await getCommercialProposal(b.id, dir);
    assert.equal(stillThere.clientName, 'B');
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
      segmentGroup: '',
      segmentCategory: '',
      segmentSpecialty: '',
      segment: '',
      description: '',
      audience: '',
      audienceType: '',
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
      segmentGroup: 'Saúde e estética',
      segmentCategory: 'Saúde e estética',
      segmentSpecialty: 'odontologia estética',
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
    assert.equal(updated.companyProfile.segmentGroup, 'Saúde e estética');
    assert.equal(updated.companyProfile.segmentCategory, 'Saúde e estética');
    assert.equal(updated.companyProfile.segmentSpecialty, 'odontologia estética');
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
    assert.match(prompt, /Setor principal selecionado pelo operador: Saúde e estética/);
    assert.match(prompt, /Categoria selecionada pelo operador: Saúde e estética/);
    assert.match(prompt, /Especialidade\/subsegmento selecionado: odontologia estética/);
    assert.match(prompt, /Trava de segmento: não misturar/);
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
      segmentGroup: '',
      segmentCategory: '',
      segmentSpecialty: '',
      segment: '',
      productsOrServices: '',
      description: '',
      serviceRegion: '',
      mainDifferential: '',
      contentGoals: [],
      contentGoalWeights: {},
      audience: '',
      audienceType: '',
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
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segmentSpecialty: 'Rodízio e delivery',
      segment: 'Pizzaria',
      productsOrServices: 'rodízio de pizzas, delivery, bebidas e atendimento no salão',
      description: 'Pizzaria familiar com rodízio de terça a domingo.',
      serviceRegion: 'Várzea Grande/MT',
      mainDifferential: 'Pizza bem recheada, ambiente familiar e rodízio completo',
      websiteOrInstagram: '@bossconteudo',
      contentGoals: ['sell_products', 'promotions', 'whatsapp_orders', 'show_products', 'relationship', 'sell_products'],
    }, dir);

    assert.equal(updated.brandInput.segment, 'Pizzaria');
    assert.equal(updated.brandInput.segmentGroup, 'Alimentício');
    assert.equal(updated.brandInput.segmentCategory, 'Pizzaria');
    assert.equal(updated.brandInput.segmentSpecialty, 'Rodízio e delivery');
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

    await updateProjectImageRules('boss-xray', {
      visualStyle: 'Direção da aba Imagem: fundo claro, fotografia realista e detalhes vermelhos.',
      imageRules: ['Preservar a aparência real dos produtos.'],
    }, dir);

    const analyzed = await analyzeProjectBrandXray('boss-xray', {}, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.equal(analyzed.project.brandXray.status, 'generated');
    assert.equal(analyzed.project.brandXray.analysisMode, 'fallback');
    assert.equal(analyzed.project.brandXray.source, 'structured_fallback');
    assert.deepEqual(Object.keys(analyzed.project.brandXray.blocks), ['summary', 'communication', 'contentStrategy', 'visualIdentity']);
    assert.match(analyzed.project.brandXray.blocks.summary.text, /Várzea Grande\/MT/);
    assert.match(analyzed.project.brandXray.blocks.summary.text, /Alimentício \/ Pizzaria \/ Rodízio e delivery/i);
    assert.match(analyzed.project.brandXray.blocks.communication.text, /possíveis compradores/i);
    assert.match(analyzed.project.brandXray.blocks.contentStrategy.text, /Receber pedidos no WhatsApp/i);
    assert.match(analyzed.project.brandXray.blocks.visualIdentity.text, /não inventar/i);
    assert.ok(analyzed.project.brandXray.fieldSuggestions.some((suggestion) => suggestion.field === 'audience'));
    assert.ok(analyzed.project.brandXray.fieldSuggestions.some((suggestion) => suggestion.field === 'tone'));
    assert.ok(analyzed.project.brandXray.fieldSuggestions.every((suggestion) => !['segmentGroup', 'segmentCategory', 'segmentSpecialty'].includes(suggestion.field)));

    const approved = await approveProjectBrandXray('boss-xray', {
      edits: {
        communication: 'Sugestão da IA: tom próximo, convidativo, apetitoso e comercial.',
        visualIdentity: 'Extraído da logo/identidade: preto, vermelho, branco e dourado. Sugestão da IA: comida em destaque e alto contraste.',
      },
    }, dir, new Date('2026-07-20T12:05:00.000Z'));

    assert.equal(approved.project.brandXray.status, 'approved');
    assert.equal(approved.project.brandXray.blocks.summary.status, 'approved');
    assert.deepEqual(approved.project.brandXray.fieldSuggestions, []);
    assert.equal(
      approved.project.brand.visualStyle,
      'Direção da aba Imagem: fundo claro, fotografia realista e detalhes vermelhos.',
    );

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
    assert.match(prompt, /Direção da aba Imagem: fundo claro, fotografia realista e detalhes vermelhos/);
    assert.doesNotMatch(prompt, /preto, vermelho, branco e dourado/);
    assert.match(prompt, /Instagram: @bossconteudo/i);
    assert.match(prompt, /Referência visual nunca pode alterar preço, logo, produto, nome, promoção ou informação factual/i);
  });
});

test('segment learnings are reused only for the same selected segment category/specialty', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'inova-solos', name: 'Inova Solos', handle: '@inova', approvalEmail: 'aprovacao@example.com' }, dir);
    await updateProjectBrandInput('inova-solos', {
      brandName: 'Inova Solos',
      segmentCategory: 'Engenharia — controle tecnológico/concreto/solos',
      segmentSpecialty: 'controle tecnológico de concreto e solos',
      segment: 'engenharia técnica',
      productsOrServices: 'ensaios de concreto, análise de solo e laudos técnicos',
    }, dir);
    const badBatch = await generateContentBatch('inova-solos', { days: 1, startDate: '2026-07-20' }, dir);
    await deleteProjectContent('inova-solos', badBatch.items[0].contentId, dir, badBatch.batchId, 'não misturar concreto com obra predial genérica');

    await createCentralProject({ projectId: 'novo-lab-solos', name: 'Novo Lab Solos', handle: '@lab', approvalEmail: 'aprovacao@example.com' }, dir);
    await updateProjectBrandInput('novo-lab-solos', {
      brandName: 'Novo Lab Solos',
      segmentCategory: 'Engenharia — controle tecnológico/concreto/solos',
      segmentSpecialty: 'controle tecnológico de concreto e solos',
      segment: 'engenharia técnica',
      productsOrServices: 'controle de concreto e solos para obras',
    }, dir);
    const sameSegment = await generateContentBatch('novo-lab-solos', { days: 1, startDate: '2026-07-21' }, dir);
    assert.match(sameSegment.items[0].image.prompt, /EVITAR — APRENDIZADOS DESTE SEGMENTO/);
    assert.match(sameSegment.items[0].image.prompt, /não misturar concreto com obra predial genérica/);

    await createCentralProject({ projectId: 'obra-civil', name: 'Obra Civil', handle: '@obra', approvalEmail: 'aprovacao@example.com' }, dir);
    await updateProjectBrandInput('obra-civil', {
      brandName: 'Obra Civil',
      segmentCategory: 'Engenharia — construção civil/obras',
      segmentSpecialty: 'construção de casas',
      segment: 'engenharia de construção',
      productsOrServices: 'construção e reforma residencial',
    }, dir);
    const otherSegment = await generateContentBatch('obra-civil', { days: 1, startDate: '2026-07-22' }, dir);
    assert.doesNotMatch(otherSegment.items[0].image.prompt, /não misturar concreto com obra predial genérica/);
  });
});

test('segment learnings at the Setor level are shared across different Nicho/Categoria within the same Setor, but not with a different Setor', async () => {
  await withTempProject(async (dir) => {
    // Setor-level sharing only applies to entries that already live at the
    // Setor node (manual entries added via the future Setor-level editor —
    // Task 8/B2's saveLearningEntry, out of scope here). Seed the Setor node
    // directly instead of going through addSegmentLearning, which always
    // writes to a project's own deepest node by design (see the separate
    // "does NOT leak sideways" test below) — this test is only responsible
    // for the read/sum side (loadSegmentLearningsForProject).
    await createCentralProject({ projectId: 'rei-hamburguer', name: 'Rei Hambúrguer', handle: '@rei', approvalEmail: 'a@example.com' }, dir);
    const paths = getCentralPaths(dir, 'rei-hamburguer');
    await writeFile(paths.segmentLearningsPath, JSON.stringify({
      schemaVersion: 2,
      nodes: {
        'group:alimenticio': {
          label: 'Alimentício',
          entries: [{
            id: 'e1',
            bucket: 'avoid',
            kind: 'text',
            text: 'não parecer gerado por IA, mais detalhista',
            imagePath: '',
            source: 'manual',
            createdAt: new Date().toISOString(),
          }],
        },
      },
    }, null, 2), 'utf-8');

    await updateProjectBrandInput('rei-hamburguer', {
      brandName: 'Rei Hambúrguer',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Hamburgueria',
      segmentSpecialty: 'artesanal',
      segment: 'hamburgueria',
      productsOrServices: 'hambúrgueres',
    }, dir);
    const sameSetor = await generateContentBatch('rei-hamburguer', { days: 1, startDate: '2026-07-21' }, dir);
    assert.match(sameSetor.items[0].image.prompt, /não parecer gerado por IA, mais detalhista/);

    await createCentralProject({ projectId: 'obra-civil-2', name: 'Obra Civil 2', handle: '@obra2', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('obra-civil-2', {
      brandName: 'Obra Civil 2',
      segmentGroup: 'Engenharia',
      segmentCategory: 'Construção civil',
      segmentSpecialty: 'residencial',
      segment: 'engenharia',
      productsOrServices: 'construção',
    }, dir);
    const otherSetor = await generateContentBatch('obra-civil-2', { days: 1, startDate: '2026-07-22' }, dir);
    assert.doesNotMatch(otherSetor.items[0].image.prompt, /não parecer gerado por IA, mais detalhista/);
  });
});

test('addSegmentLearning writes only to the deepest node — an auto-avoid learned by one Nicho does NOT leak sideways to a sibling Nicho in the same Setor', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'boss-pizza', name: 'Boss Pizza', handle: '@boss', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('boss-pizza', {
      brandName: 'Boss Pizza',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segmentSpecialty: 'napolitana',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);
    const badBatch = await generateContentBatch('boss-pizza', { days: 1, startDate: '2026-07-20' }, dir);
    await deleteProjectContent('boss-pizza', badBatch.items[0].contentId, dir, badBatch.batchId, 'não parecer gerado por IA, mais detalhista');

    await createCentralProject({ projectId: 'rei-hamburguer', name: 'Rei Hambúrguer', handle: '@rei', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('rei-hamburguer', {
      brandName: 'Rei Hambúrguer',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Hamburgueria',
      segmentSpecialty: 'artesanal',
      segment: 'hamburgueria',
      productsOrServices: 'hambúrgueres',
    }, dir);
    const sameSetorDifferentNicho = await generateContentBatch('rei-hamburguer', { days: 1, startDate: '2026-07-21' }, dir);
    assert.doesNotMatch(sameSetorDifferentNicho.items[0].image.prompt, /não parecer gerado por IA, mais detalhista/);
  });
});

test('segmentNodePaths does not collide a project categorized under "Solos" with a project specialized in "Solos" (same group, different field)', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'categoria-solos', name: 'Categoria Solos', handle: '@cat', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('categoria-solos', {
      brandName: 'Categoria Solos',
      segmentGroup: 'Engenharia',
      segmentCategory: 'Solos',
      segment: 'engenharia de solos',
      productsOrServices: 'ensaios de solo',
    }, dir);
    const badBatch = await generateContentBatch('categoria-solos', { days: 1, startDate: '2026-07-20' }, dir);
    await deleteProjectContent('categoria-solos', badBatch.items[0].contentId, dir, badBatch.batchId, 'não misturar laudo de solo com laudo de concreto');

    await createCentralProject({ projectId: 'especialidade-solos', name: 'Especialidade Solos', handle: '@esp', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('especialidade-solos', {
      brandName: 'Especialidade Solos',
      segmentGroup: 'Engenharia',
      segmentSpecialty: 'Solos',
      segment: 'engenharia especializada em solos',
      productsOrServices: 'consultoria em solos',
    }, dir);
    const otherBatch = await generateContentBatch('especialidade-solos', { days: 1, startDate: '2026-07-21' }, dir);
    assert.doesNotMatch(otherBatch.items[0].image.prompt, /não misturar laudo de solo com laudo de concreto/);
  });
});

test('segmentNodePaths never collides unrelated no-Setor projects into a shared "data" node (slugify("") fallback regression guard)', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-setor-a', name: 'Sem Setor A', handle: '@a', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('sem-setor-a', {
      brandName: 'Sem Setor A',
      segmentCategory: 'Engenharia — controle tecnológico/concreto/solos',
      segmentSpecialty: 'controle tecnológico de concreto e solos',
      segment: 'engenharia técnica',
      productsOrServices: 'ensaios de concreto, análise de solo e laudos técnicos',
    }, dir);
    const badBatch = await generateContentBatch('sem-setor-a', { days: 1, startDate: '2026-07-20' }, dir);
    await deleteProjectContent('sem-setor-a', badBatch.items[0].contentId, dir, badBatch.batchId, 'não usar tom institucional demais');

    const paths = getCentralPaths(dir);
    const store = JSON.parse(await readFile(paths.segmentLearningsPath, 'utf-8'));
    assert.ok(!Object.keys(store.nodes).some((path) => path === 'data' || path.startsWith('data/')));
  });
});

test('migrateSegmentLearningStoreV1ToV2 splits the flat label into a Setor/Nicho/Especialidade node chain', () => {
  const v1 = {
    schemaVersion: 1,
    segments: {
      'engenharia-controle-tecnologico-solos-e-pavimentacao': {
        key: 'engenharia-controle-tecnologico-solos-e-pavimentacao',
        label: 'Engenharia / Controle tecnológico / solos e pavimentação',
        technical: ['CBR, limite de liquidez'],
        approved: [],
        avoid: ['não misturar concreto com obra predial genérica'],
      },
    },
  };
  const v2 = migrateSegmentLearningStoreV1ToV2(v1);
  assert.equal(v2.schemaVersion, 2);
  assert.ok(v2.nodes['engenharia']);
  assert.ok(v2.nodes['engenharia/controle-tecnologico']);
  assert.ok(v2.nodes['engenharia/controle-tecnologico/solos-e-pavimentacao']);
  const deepest = v2.nodes['engenharia/controle-tecnologico/solos-e-pavimentacao'].entries;
  assert.ok(deepest.some((e) => e.bucket === 'technical' && e.text === 'CBR, limite de liquidez'));
  assert.ok(deepest.some((e) => e.bucket === 'avoid' && e.text === 'não misturar concreto com obra predial genérica'));
});

test('loadSegmentLearningNodesForSelection returns the same nodes as loadSegmentLearningNodes for an equivalent project', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sel-test', name: 'Sel Test', handle: '@sel', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('sel-test', {
      brandName: 'Sel Test',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segmentSpecialty: 'napolitana',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);
    const badBatch = await generateContentBatch('sel-test', { days: 1, startDate: '2026-07-20' }, dir);
    await deleteProjectContent('sel-test', badBatch.items[0].contentId, dir, badBatch.batchId, 'esfiha vindo retangular, tem que ser redonda');

    const paths = getCentralPaths(dir, 'sel-test');
    const project = await loadProjectForTest('sel-test', dir);
    const fromProject = await loadSegmentLearningNodes(paths, project);
    const fromSelection = await loadSegmentLearningNodesForSelection(paths, {
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segmentSpecialty: 'napolitana',
    });

    assert.deepEqual(fromSelection.map((n) => n.path), fromProject.map((n) => n.path));
    assert.deepEqual(fromSelection.map((n) => n.label), fromProject.map((n) => n.label));
    const napolitanaNode = fromSelection.find((n) => n.level === 'especialidade');
    assert.ok(napolitanaNode.entries.some((e) => e.text.includes('esfiha vindo retangular')));
  });
});

test('real operator-authored v1 segment-learnings data (pre-v2, flat-keyed) stays reachable in prompts and survives a write after the v1->v2 upgrade-on-read, instead of being silently orphaned then deleted', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'boss-pizzaria-legado', name: 'Boss Pizzaria', handle: '@bosspizzaria', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('boss-pizzaria-legado', {
      brandName: 'Boss Pizzaria',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);

    const paths = getCentralPaths(dir, 'boss-pizzaria-legado');
    // Reproduces the real repo's gitignored segment-learnings.json shape —
    // v1, flat-keyed by slugify('Alimentício / Pizzaria'), with real
    // operator-written approve/reject history.
    const v1Store = {
      schemaVersion: 1,
      segments: {
        'alimenticio-pizzaria': {
          key: 'alimenticio-pizzaria',
          label: 'Alimentício / Pizzaria',
          technical: [],
          approved: ['fotos com fatia puxando o queijo derretendo'],
          avoid: ['não parecer gerado por IA, mais detalhista'],
        },
      },
    };
    await writeFile(paths.segmentLearningsPath, JSON.stringify(v1Store, null, 2), 'utf-8');

    // Loading the project (any content generation triggers
    // loadSegmentLearningsForProject) must still surface the old data even
    // though it lives under the old flat key, not the new tagged node path.
    const batch = await generateContentBatch('boss-pizzaria-legado', { days: 1, startDate: '2026-07-20' }, dir);
    assert.match(batch.items[0].image.prompt, /fotos com fatia puxando o queijo derretendo/);
    assert.match(batch.items[0].image.prompt, /não parecer gerado por IA, mais detalhista/);

    // A completely unrelated write (a fresh manual entry on the Setor node)
    // must not drop the legacy `segments` bucket from disk — that's the
    // actual data-loss bug: migrateSegmentLearningStoreV1ToV2's in-memory
    // result used to have no `segments` key at all, so the first write
    // after a read silently deleted the real v1 history.
    await saveLearningEntry({
      scope: 'segment',
      groupKey: 'group:alimenticio',
      bucket: 'avoid',
      kind: 'text',
      text: 'nova regra manual',
    }, dir);

    const onDisk = JSON.parse(await readFile(paths.segmentLearningsPath, 'utf-8'));
    assert.equal(onDisk.schemaVersion, 2);
    assert.ok(onDisk.segments, 'legacy v1 segments bucket must survive the write, not be dropped');
    assert.ok(onDisk.segments['alimenticio-pizzaria']);
    assert.deepEqual(onDisk.segments['alimenticio-pizzaria'].avoid, ['não parecer gerado por IA, mais detalhista']);
    assert.deepEqual(onDisk.segments['alimenticio-pizzaria'].approved, ['fotos com fatia puxando o queijo derretendo']);

    // The new manual entry itself must have actually been saved into the
    // new tagged-node scheme, alongside (not instead of) the legacy data.
    assert.ok(onDisk.nodes['group:alimenticio']);
    assert.ok(onDisk.nodes['group:alimenticio'].entries.some((entry) => entry.text === 'nova regra manual'));
  });
});

test('a project with segmentGroup/segmentCategory/segmentSpecialty all EMPTY (only a free-text `segment` field set — the real engineering-client shape) still reaches its legacy approve/reject history in prompts, and a NEW rejection is actually written and reaches later generations too', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'engenharia-legado', name: 'Engenharia Legado', handle: '@el', approvalEmail: 'a@example.com' }, dir);
    // Deliberately mirrors the real repo's second gitignored production
    // segment: no segmentGroup/segmentCategory/segmentSpecialty ever set —
    // segmentNodePaths() returns [] for this project, only the free-text
    // `segment` field carries any information at all.
    await updateProjectBrandInput('engenharia-legado', {
      brandName: 'Engenharia Legado',
      segment: 'Controle tecnológico de solos, concreto e pavimentação',
      productsOrServices: 'ensaios de solo, concreto e pavimentação',
    }, dir);
    const paths = getCentralPaths(dir, 'engenharia-legado');

    const firstBatch = await generateContentBatch('engenharia-legado', { days: 1, startDate: '2026-07-20' }, dir);
    assert.doesNotMatch(firstBatch.items[0].image.prompt, /não parecer robótico demais/);

    // A real rejection (the write path) — for this project shape there is
    // no tagged node to write to, only the legacy flat key. Before this
    // fix, addSegmentLearning's `if (!nodePaths.length) return;` guard
    // silently dropped this write entirely.
    await deleteProjectContent('engenharia-legado', firstBatch.items[0].contentId, dir, firstBatch.batchId, 'não parecer robótico demais');

    const afterReject = JSON.parse(await readFile(paths.segmentLearningsPath, 'utf-8'));
    const legacyKeys = Object.keys(afterReject.segments || {});
    assert.equal(legacyKeys.length, 1, 'expected exactly one legacy flat key for this project\'s free-text segment');
    const legacyKey = legacyKeys[0];
    assert.ok(afterReject.segments[legacyKey].avoid.some((text) => text.includes('não parecer robótico demais')), 'the new rejection must actually have been written to the legacy bucket, not dropped');
    assert.deepEqual(afterReject.nodes, {}, 'a project with no tagged hierarchy must never gain a tagged node just from this write');

    // Now simulate real pre-existing operator history sitting in the same
    // legacy bucket (the "real v1 data" the coordinator's report describes)
    // alongside the fresh write above, written directly the way a v1 file
    // on disk would have it.
    afterReject.segments[legacyKey].approved = ['fotos de campo com equipamento real, nunca mockup'];
    await writeFile(paths.segmentLearningsPath, JSON.stringify(afterReject, null, 2), 'utf-8');

    // A later generation (day 2) must surface BOTH the pre-existing legacy
    // "approved" text AND the freshly-written "avoid" text from the
    // rejection above — proving the read-side fix reaches this project
    // shape, and that the write from addSegmentLearning is not just
    // persisted but actually reachable by subsequent generations.
    const secondBatch = await generateContentBatch('engenharia-legado', { days: 1, startDate: '2026-07-21' }, dir);
    assert.match(secondBatch.items[0].image.prompt, /fotos de campo com equipamento real, nunca mockup/);
    assert.match(secondBatch.items[0].image.prompt, /não parecer robótico demais/);
  });
});

test('analyzeLearningImage/saveLearningEntry/deleteLearningEntry work without a project, storing images under the global assets/learning directory', async () => {
  await withTempProject(async (dir) => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const fakeAnalyzer = async () => 'Esfiha redonda, borda dourada natural, sem formato retangular.';

    const analyzed = await analyzeLearningImage({
      scope: 'segment',
      groupKey: 'group:alimenticio/category:pizzaria',
      dataUrl,
      filename: 'esfiha-redonda.png',
    }, dir, new Date(), { learningImageAnalyzer: fakeAnalyzer });

    assert.match(analyzed.imagePath, /^segment\/group-alimenticio-category-pizzaria\/esfiha-redonda\.png$/);
    assert.equal(analyzed.suggestedText, 'Esfiha redonda, borda dourada natural, sem formato retangular.');

    const paths = getCentralPaths(dir);
    const fileOnDisk = join(paths.root, 'assets', 'learning', analyzed.imagePath);
    await access(fileOnDisk);

    const saved = await saveLearningEntry({
      scope: 'segment',
      groupKey: 'group:alimenticio/category:pizzaria',
      bucket: 'approved',
      kind: 'image',
      text: analyzed.suggestedText,
      imagePath: analyzed.imagePath,
    }, dir, new Date());

    assert.equal(saved.length, 1);
    assert.equal(saved[0].imagePath, analyzed.imagePath);
    assert.equal(saved[0].sourceProjectId, '');

    await deleteLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', entryId: saved[0].id }, dir);
    const nodes = await loadSegmentLearningNodesForSelection(paths, { segmentGroup: 'Alimentício', segmentCategory: 'Pizzaria' });
    assert.equal(nodes.find((n) => n.path === 'group:alimenticio/category:pizzaria').entries.length, 0);
  });
});

test('analyzeLearningImage asks for structure-only analysis when the uploaded learning image is a creative-structure reference', async () => {
  await withTempProject(async (dir) => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    let receivedContext = '';
    let receivedPurpose = '';
    const analyzed = await analyzeLearningImage({
      scope: 'segment',
      groupKey: 'group:embalagens/category:casa-de-embalagem',
      dataUrl,
      filename: 'modelo-oferta.png',
      purpose: 'creative',
    }, dir, new Date(), {
      learningImageAnalyzer: async (_imagePath, context, purpose) => {
        receivedContext = context;
        receivedPurpose = purpose;
        return 'Layout vertical: logo no topo, chamada principal, produto em destaque, benefícios, preço e CTA.';
      },
    });

    assert.equal(receivedPurpose, 'creative');
    assert.match(receivedContext, /estrutura de criativo/i);
    assert.match(receivedContext, /layout|hierarquia|CTA/i);
    assert.doesNotMatch(receivedContext, /textura do produto|formato real do produto/i);
    assert.match(analyzed.suggestedText, /Layout vertical/);
  });
});

test('saveLearningEntry tags a creative-purpose image entry with postType and shape, and strips them from any other entry kind/purpose', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'template-tags', name: 'Template Tags', handle: '@templatetags', approvalEmail: 'a@example.com' }, dir);
    const groupKey = 'group:alimenticio/category:pizzaria';

    const creativeEntries = await saveLearningEntry({
      scope: 'segment', groupKey, bucket: 'approved', kind: 'image',
      text: 'modelo de oferta', imagePath: 'segment/x/oferta.png',
      purpose: 'creative', postType: 'offer', shape: 'vertical',
    }, dir);
    const creative = creativeEntries[0];
    assert.equal(creative.postType, 'offer');
    assert.equal(creative.shape, 'vertical');

    // A product-purpose image entry never carries these tags, even if the
    // caller sends them — postType/shape describe LAYOUT templates, and a
    // product-purpose entry isn't one (see buildSegmentLayoutReferences,
    // which only ever tags the 'creative' branch).
    const productEntries = await saveLearningEntry({
      scope: 'segment', groupKey, bucket: 'approved', kind: 'image',
      text: 'foto de produto', imagePath: 'segment/x/produto.png',
      purpose: 'product', postType: 'offer', shape: 'vertical',
    }, dir);
    const product = productEntries.find((entry) => entry.text === 'foto de produto');
    assert.equal(product.postType, '');
    assert.equal(product.shape, '');

    // A text entry (no image at all) never carries these tags either.
    const textEntries = await saveLearningEntry({
      scope: 'segment', groupKey, bucket: 'approved', kind: 'text',
      text: 'não parecer gerado por IA', postType: 'offer', shape: 'vertical',
    }, dir);
    const textEntry = textEntries.find((entry) => entry.text === 'não parecer gerado por IA');
    assert.equal(textEntry.postType, '');
    assert.equal(textEntry.shape, '');

    // An unrecognized value gets dropped to '' instead of stored verbatim.
    const junkEntries = await saveLearningEntry({
      scope: 'segment', groupKey, bucket: 'approved', kind: 'image',
      text: 'lixo', imagePath: 'segment/x/lixo.png',
      purpose: 'creative', postType: 'nao-existe', shape: 'quadrado',
    }, dir);
    const junk = junkEntries.find((entry) => entry.text === 'lixo');
    assert.equal(junk.postType, '');
    assert.equal(junk.shape, '');
  });
});

test('saveLearningEntry throws instead of silently no-op succeeding when entryId matches no existing entry', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'edit-mismatch', name: 'Edit Mismatch', handle: '@editmismatch', approvalEmail: 'a@example.com' }, dir);
    const groupKey = 'group:alimenticio/category:pizzaria';

    await saveLearningEntry({
      scope: 'segment', groupKey, bucket: 'approved', kind: 'image',
      text: 'modelo de oferta', imagePath: 'segment/x/oferta.png',
      purpose: 'creative', postType: 'offer', shape: 'vertical',
    }, dir);

    await assert.rejects(
      saveLearningEntry({
        scope: 'segment', groupKey, entryId: 'no-such-entry', bucket: 'approved', kind: 'image',
        title: 'Nome novo', text: 'texto novo', purpose: 'creative', postType: 'offer', shape: 'vertical',
      }, dir),
      /Entrada não encontrada para edição\./,
    );
  });
});

test('buildSegmentLayoutReferences returns every approved creative image, newest first, skips avoid/text entries', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pizzaria-layout', name: 'Pizzaria Layout', handle: '@pizzarialayout', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('pizzaria-layout', {
      brandName: 'Pizzaria Layout',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const groupKey = 'group:alimenticio/category:pizzaria';
    const imagePaths = {};
    for (const name of ['img1', 'img2', 'img3', 'img4', 'img5']) {
      const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: `${name}.png` }, dir, new Date(), { learningImageAnalyzer: async () => `Descrição ${name}` });
      await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: `Descrição ${name}`, imagePath: analyzed.imagePath, purpose: 'creative' }, dir, new Date());
      imagePaths[name] = analyzed.imagePath;
    }
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'text', text: 'não parecer gerado por IA' }, dir, new Date());
    const avoidAnalyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'evitar.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'Evitar isso' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'avoid', kind: 'image', text: 'Evitar isso', imagePath: avoidAnalyzed.imagePath }, dir, new Date());

    const paths = getCentralPaths(dir, 'pizzaria-layout');
    const store = JSON.parse(await readFile(paths.segmentLearningsPath, 'utf-8'));
    const node = store.nodes[groupKey];
    const stampOrder = ['img1', 'img2', 'img3', 'img4', 'img5', 'evitar', 'não parecer gerado por IA'];
    for (const entry of node.entries) {
      const key = entry.kind === 'image' ? Object.keys(imagePaths).find((name) => imagePaths[name] === entry.imagePath) || 'evitar' : entry.text;
      const index = stampOrder.indexOf(key);
      entry.createdAt = `2026-01-01T00:0${index}:00.000Z`;
    }
    await writeFile(paths.segmentLearningsPath, JSON.stringify(store, null, 2));

    const project = await loadProjectForTest('pizzaria-layout', dir);
    const references = await buildSegmentLayoutReferences(project, paths);

    assert.deepEqual(
      references.map((r) => r.relativePath),
      [imagePaths.img5, imagePaths.img4, imagePaths.img3, imagePaths.img2, imagePaths.img1],
      'every approved creative image comes back, newest first — avoid/text entries excluded'
    );
    assert.ok(references.every((r) => r.role === 'layout_model'));
    assert.ok(references.every((r) => r.weight === 'medium'));
    assert.equal(
      references[0].instruction,
      'Modelo de composição aprovado no aprendizado de segmento: usar como referência de distribuição dos elementos (título, blocos de benefício, selo, hierarquia). Não copiar marca, produto ou cores da imagem de referência.'
    );
    await access(references[0].absolutePath);
  });
});

test('buildSegmentLayoutReferences returns the newest creative reference plus a randomly selected product reference', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'purpose-split', name: 'Purpose Split', handle: '@purpose', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('purpose-split', {
      brandName: 'Purpose Split', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    const paths = getCentralPaths(dir, 'purpose-split');
    const groupKey = 'group:alimenticio/category:pizzaria';
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const savedPaths = {};
    for (const [name, purpose] of [['legacy', undefined], ['creative-a', 'creative'], ['product-a', 'product'], ['product-b', 'product']]) {
      const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: `${name}.png` }, dir, new Date(), { learningImageAnalyzer: async () => name });
      await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: name, imagePath: analyzed.imagePath, purpose }, dir);
      savedPaths[name] = analyzed.imagePath;
    }

    const project = await loadProjectForTest('purpose-split', dir);
    const first = await buildSegmentLayoutReferences(project, paths, { random: () => 0 });
    const second = await buildSegmentLayoutReferences(project, paths, { random: () => 0.999 });

    assert.equal(first.length, 2, 'purpose omitted ("legacy") is excluded — only the explicitly-tagged creative entry plus one product entry come back');
    assert.equal(first[0].relativePath, savedPaths['creative-a'], 'only an explicit purpose:"creative" entry counts as a creative reference');
    assert.match(first[0].instruction, /Modelo de composi/);
    assert.match(first[1].instruction, /produto real aprovada/);
    assert.equal(second[0].relativePath, savedPaths['creative-a']);
    assert.notEqual(first[1].relativePath, second[1].relativePath, 'injected random selection reaches distinct approved product photos');
  });
});

test('buildSegmentLayoutReferences skips a missing-on-disk image and still returns the remaining valid ones', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pizzaria-layout-missing', name: 'Pizzaria Layout Missing', handle: '@pizzarialayoutmissing', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('pizzaria-layout-missing', {
      brandName: 'Pizzaria Layout Missing',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const groupKey = 'group:alimenticio/category:pizzaria';
    const imagePaths = {};
    for (const name of ['img1', 'img2']) {
      const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: `${name}.png` }, dir, new Date(), { learningImageAnalyzer: async () => `Descrição ${name}` });
      await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: `Descrição ${name}`, imagePath: analyzed.imagePath, purpose: 'creative' }, dir, new Date());
      imagePaths[name] = analyzed.imagePath;
    }

    const paths = getCentralPaths(dir, 'pizzaria-layout-missing');
    const store = JSON.parse(await readFile(paths.segmentLearningsPath, 'utf-8'));
    const node = store.nodes[groupKey];
    for (const entry of node.entries) {
      const key = Object.keys(imagePaths).find((name) => imagePaths[name] === entry.imagePath);
      entry.createdAt = `2026-01-01T00:0${['img1', 'img2'].indexOf(key)}:00.000Z`;
    }
    await writeFile(paths.segmentLearningsPath, JSON.stringify(store, null, 2));

    // Delete img2's file on disk (the newest) — it must be skipped, but
    // img1 (still on disk) must still come back, not an empty list.
    await rm(join(paths.root, 'assets', 'learning', imagePaths.img2));

    const project = await loadProjectForTest('pizzaria-layout-missing', dir);
    const references = await buildSegmentLayoutReferences(project, paths);

    assert.deepEqual(references.map((r) => r.relativePath), [imagePaths.img1]);
  });
});

test('buildSegmentLayoutReferences filters creative images by postType and shape when given', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'template-filter', name: 'Template Filter', handle: '@templatefilter', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('template-filter', {
      brandName: 'Template Filter', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    const paths = getCentralPaths(dir, 'template-filter');
    const groupKey = 'group:alimenticio/category:pizzaria';
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const savedPaths = {};
    const combos = [
      ['offer-vertical', 'offer', 'vertical'],
      ['offer-feed', 'offer', 'feed'],
      ['rodizio-vertical', 'rodizio', 'vertical'],
      ['institutional-vertical', 'institutional', 'vertical'],
    ];
    for (const [name, postType, shape] of combos) {
      const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: `${name}.png` }, dir, new Date(), { learningImageAnalyzer: async () => name });
      await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: name, imagePath: analyzed.imagePath, purpose: 'creative', postType, shape }, dir);
      savedPaths[name] = analyzed.imagePath;
    }

    const project = await loadProjectForTest('template-filter', dir);
    const offerVertical = await buildSegmentLayoutReferences(project, paths, { postType: 'offer', shape: 'vertical' });
    assert.deepEqual(offerVertical.map((r) => r.relativePath), [savedPaths['offer-vertical']]);

    const rodizioVertical = await buildSegmentLayoutReferences(project, paths, { postType: 'rodizio', fallbackPostType: 'offer', shape: 'vertical' });
    assert.deepEqual(rodizioVertical.map((r) => r.relativePath), [savedPaths['rodizio-vertical']]);

    const serviceFallback = await buildSegmentLayoutReferences(project, paths, { postType: 'service', fallbackPostType: 'offer', shape: 'vertical' });
    assert.deepEqual(serviceFallback.map((r) => r.relativePath), [savedPaths['offer-vertical']]);

    const specialDate = await buildSegmentLayoutReferences(project, paths, { postType: 'special_date', shape: 'vertical' });
    assert.deepEqual(specialDate, []);

    const allUnfiltered = await buildSegmentLayoutReferences(project, paths);
    assert.equal(allUnfiltered.length, 4, 'no filter passed → every creative entry comes back, matching existing callers that never asked for a filter');

    // A blank-shape structure means "works for both" (mirrors the relaxed
    // match in buildPrimaryAiImageReferences) — it must not be dropped by
    // this filter just because a specific shape was requested.
    const blankShapeAnalyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'offer-blank-shape.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'offer-blank-shape' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: 'offer-blank-shape', imagePath: blankShapeAnalyzed.imagePath, purpose: 'creative', postType: 'offer' }, dir);
    const projectWithBlank = await loadProjectForTest('template-filter', dir);
    const offerVerticalWithBlank = await buildSegmentLayoutReferences(projectWithBlank, paths, { postType: 'offer', shape: 'vertical' });
    assert.deepEqual(
      offerVerticalWithBlank.map((r) => r.relativePath).sort(),
      [savedPaths['offer-vertical'], blankShapeAnalyzed.imagePath].sort(),
    );
  });
});

test('buildSegmentLayoutReferences caps an operator-supplied structure title at 80 chars before it reaches the AI prompt instruction', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'title-cap', name: 'Title Cap', handle: '@titlecap', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('title-cap', {
      brandName: 'Title Cap', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    const paths = getCentralPaths(dir, 'title-cap');
    const groupKey = 'group:alimenticio/category:pizzaria';
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const longTitle = 'A'.repeat(200);
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'long-title.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'long-title' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', title: longTitle, text: 'long-title', imagePath: analyzed.imagePath, purpose: 'creative', postType: 'offer' }, dir);

    const project = await loadProjectForTest('title-cap', dir);
    const references = await buildSegmentLayoutReferences(project, paths);

    assert.equal(references.length, 1);
    assert.match(references[0].instruction, new RegExp(`Nome da estrutura: ${'A'.repeat(80)}\\.$`));
    assert.doesNotMatch(references[0].instruction, new RegExp('A'.repeat(81)));
  });
});

test('buildSegmentLayoutReferences returns nothing when the project has no Setor/Nicho set', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-segmento', name: 'Sem Segmento', handle: '@semsegmento', approvalEmail: 'a@example.com' }, dir);
    const paths = getCentralPaths(dir, 'sem-segmento');
    const project = await loadProjectForTest('sem-segmento', dir);
    const references = await buildSegmentLayoutReferences(project, paths);
    assert.deepEqual(references, []);
  });
});

test('buildSegmentLayoutReferences tags creative entries segment_structure and the product entry segment_product', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'kind-tags', name: 'Kind Tags', handle: '@kindtags', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('kind-tags', {
      brandName: 'Kind Tags', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    const paths = getCentralPaths(dir, 'kind-tags');
    const groupKey = 'group:alimenticio/category:pizzaria';
    await registerCreativeTemplate(groupKey, 'offer', 'vertical', dir, 'estrutura.png');

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'produto.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'produto' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: 'mussarela derretendo', imagePath: analyzed.imagePath, purpose: 'product' }, dir);

    const project = await loadProjectForTest('kind-tags', dir);
    const references = await buildSegmentLayoutReferences(project, paths);

    const structureRef = references.find((r) => r.referenceKind === 'segment_structure');
    const productRef = references.find((r) => r.referenceKind === 'segment_product');
    assert.ok(structureRef, 'creative entry keeps its segment_structure tag');
    assert.ok(productRef, 'product entry gets tagged segment_product');
    assert.equal(structureRef.role, 'layout_model');
    assert.equal(productRef.role, 'layout_model');
  });
});

test('a structure with no Formato set matches generation for both vertical and feed channels', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'formato-livre', name: 'Formato Livre', handle: '@formatolivre', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('formato-livre', {
      brandName: 'Formato Livre', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('formato-livre', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', '', dir, 'universal.png');

    const story = await simulateTestPost('formato-livre', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.equal(story.imageGenerationError, null);

    const feed = await simulateTestPost('formato-livre', {
      channel: 'instagram_feed',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-21T12:00:00.000Z'));
    assert.equal(feed.imageGenerationError, null);
  });
});

test('a registered product reference alone never satisfies the mandatory creative-template match', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'so-produto', name: 'So Produto', handle: '@soproduto', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('so-produto', {
      brandName: 'So Produto', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('so-produto', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'produto.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'produto' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'mussarela derretendo', imagePath: analyzed.imagePath, purpose: 'product' }, dir);

    const content = await simulateTestPost('so-produto', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.match(content.imageGenerationError, /Nenhum modelo de criativo cadastrado/);
  });
});

test('a registered product reference rides along as an additional reference when a matching structure exists', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'estrutura-mais-produto', name: 'Estrutura Mais Produto', handle: '@emp', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('estrutura-mais-produto', {
      brandName: 'Estrutura Mais Produto', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('estrutura-mais-produto', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    const groupKey = 'group:alimenticio/category:pizzaria';
    await registerCreativeTemplate(groupKey, 'offer', 'vertical', dir, 'estrutura.png');

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'produto.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'produto' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: 'mussarela derretendo', imagePath: analyzed.imagePath, purpose: 'product' }, dir);

    const content = await simulateTestPost('estrutura-mais-produto', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.equal(content.imageGenerationError, null);
    const kinds = content.image.references.map((r) => r.referenceKind).filter(Boolean);
    assert.deepEqual(kinds.sort(), ['segment_product', 'segment_structure']);
  });
});

test('generation blocks with a clear error when no creative template matches the topic\'s postType and shape, and simulateTestPost records it instead of leaving a half-written draft', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-modelo', name: 'Sem Modelo', handle: '@semmodelo', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('sem-modelo', {
      brandName: 'Sem Modelo', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('sem-modelo', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);

    // Same "record the error on the item, don't throw" contract as every
    // other real-image call site — simulateTestPost must not reject here,
    // it must return a well-formed, fully-written content draft with the
    // error recorded on it (see task-6 final-review fix: this used to throw
    // uncaught, escaping before the content file was written and before
    // nextTestTopicIndex advanced).
    const content = await simulateTestPost('sem-modelo', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.match(content.imageGenerationError, /Nenhum modelo de criativo cadastrado/);
    assert.equal(content.status, 'test_post_simulated');

    const persisted = JSON.parse(await readFile(content.filePath, 'utf-8'));
    assert.match(persisted.imageGenerationError, /Nenhum modelo de criativo cadastrado/);
    assert.equal(persisted.status, 'test_post_simulated');

    const project = await loadProjectForTest('sem-modelo', dir);
    assert.equal(typeof project.contentStrategy.nextTestTopicIndex, 'number', 'the batch state still advances even when generation failed');
  });
});

test('generation proceeds once a matching creative template exists for the topic\'s postType and shape', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'com-modelo', name: 'Com Modelo', handle: '@commodelo', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('com-modelo', {
      brandName: 'Com Modelo', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('com-modelo', { name: 'Rodizio da Casa', type: 'rodizio', price: 'R$ 49,90' }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const offerAnalyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'modelo-oferta.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'modelo oferta' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'modelo oferta', imagePath: offerAnalyzed.imagePath, purpose: 'creative', postType: 'offer', shape: 'vertical' }, dir);
    const rodizioAnalyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'modelo-rodizio.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'modelo rodizio' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'modelo rodizio', imagePath: rodizioAnalyzed.imagePath, purpose: 'creative', postType: 'rodizio', shape: 'vertical' }, dir);

    const generatorCalls = [];
    await simulateTestPost('com-modelo', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => { generatorCalls.push(payload); return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.equal(generatorCalls.length, 1);
    assert.match(generatorCalls[0].content.image.prompt, /modelo-rodizio\.png/);
    assert.doesNotMatch(generatorCalls[0].content.image.prompt, /modelo-oferta\.png/);
  });
});

test('only sales/product post types require an exact creative structure; service and content types generate freely', async () => {
  const requiredTypes = ['offer', 'combo', 'rodizio', 'delivery', 'product'];
  for (const type of requiredTypes) {
    await withTempProject(async (dir) => {
      const projectId = `modelo-obrigatorio-${type}`;
      await createCentralProject({ projectId, name: `Modelo Obrigatorio ${type}`, handle: `@${type}`, approvalEmail: 'a@example.com' }, dir);
      await updateProjectBrandInput(projectId, {
        brandName: `Modelo Obrigatorio ${type}`, segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
      }, dir);
      await saveProjectOffer(projectId, { name: `Assunto ${type}`, type, price: type === 'offer' ? 'R$ 49,90' : '' }, dir);
      if (type !== 'offer') {
        // An Oferta direta template must not satisfy Combo/Rodízio/Delivery/
        // Produto destaque: these sales types require their own exact model.
        await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir, 'modelo-oferta.png');
      }

      let imageCalls = 0;
      const content = await simulateTestPost(projectId, {
        channel: 'instagram_story',
        imageGenerator: async () => { imageCalls += 1; return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
      }, dir, new Date('2026-07-20T12:00:00.000Z'));

      assert.equal(imageCalls, 0, `${type} should block before calling the image generator`);
      assert.match(content.imageGenerationError, /Nenhum modelo de criativo cadastrado/);
    });
  }

  const freeTypes = ['service', 'orientation', 'desire', 'urgency', 'institutional', 'social_proof'];
  for (const type of freeTypes) {
    await withTempProject(async (dir) => {
      const projectId = `modelo-livre-${type}`;
      await createCentralProject({ projectId, name: `Modelo Livre ${type}`, handle: `@${type}`, approvalEmail: 'a@example.com' }, dir);
      await updateProjectBrandInput(projectId, {
        brandName: `Modelo Livre ${type}`, segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
      }, dir);
      await saveProjectOffer(projectId, { name: `Assunto ${type}`, type, price: '' }, dir);

      let imageCalls = 0;
      const content = await simulateTestPost(projectId, {
        channel: 'instagram_story',
        imageGenerator: async () => { imageCalls += 1; return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
      }, dir, new Date('2026-07-20T12:00:00.000Z'));

      assert.equal(imageCalls, 1, `${type} should generate without a creative structure`);
      assert.equal(content.imageGenerationError, null);
      assert.equal(content.creativeStructureUsed, null);
      assert.equal(content.image.references.some((reference) => reference.referenceKind === 'segment_structure'), false);
    });
  }
});

test('records which creative structure was used and whether a segment product reference rode along', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'registra-uso', name: 'Registra Uso', handle: '@registrauso', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('registra-uso', {
      brandName: 'Registra Uso', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('registra-uso', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    const groupKey = 'group:alimenticio/category:pizzaria';

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const structure = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'estrutura.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'estrutura' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', title: 'Oferta vertical com preco', text: 'modelo', imagePath: structure.imagePath, purpose: 'creative', postType: 'offer', shape: 'vertical' }, dir);

    const productPhoto = await analyzeLearningImage({ scope: 'segment', groupKey, dataUrl, filename: 'produto.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'produto' });
    await saveLearningEntry({ scope: 'segment', groupKey, bucket: 'approved', kind: 'image', text: 'mussarela derretendo', imagePath: productPhoto.imagePath, purpose: 'product' }, dir);

    const content = await simulateTestPost('registra-uso', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.deepEqual(content.creativeStructureUsed, { title: 'Oferta vertical com preco', postType: 'offer', shape: 'vertical' });
    assert.equal(content.usedSegmentProductReference, true);

    const persisted = JSON.parse(await readFile(content.filePath, 'utf-8'));
    assert.deepEqual(persisted.creativeStructureUsed, { title: 'Oferta vertical com preco', postType: 'offer', shape: 'vertical' });
    assert.equal(persisted.usedSegmentProductReference, true);
  });
});

test('creativeStructureUsed and usedSegmentProductReference reflect no product reference registered', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-produto', name: 'Sem Produto', handle: '@semproduto', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('sem-produto', {
      brandName: 'Sem Produto', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('sem-produto', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir, 'estrutura.png');

    const content = await simulateTestPost('sem-produto', {
      channel: 'instagram_story',
      imageGenerator: async () => ({ url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }),
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.deepEqual(content.creativeStructureUsed, { title: '', postType: 'offer', shape: 'vertical' });
    assert.equal(content.usedSegmentProductReference, false);
  });
});

test('a corrupted/hand-edited learning store file (schemaVersion set but nodes/types missing) does not crash saveLearningEntry — it self-heals with an empty collection instead of throwing', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'store-corrompido', name: 'Store Corrompido', handle: '@sc', approvalEmail: 'a@example.com' }, dir);
    const paths = getCentralPaths(dir, 'store-corrompido');

    await writeFile(paths.segmentLearningsPath, JSON.stringify({ schemaVersion: 2 }), 'utf-8');
    const segmentEntries = await saveLearningEntry({
      scope: 'segment',
      groupKey: 'group:teste',
      bucket: 'approved',
      kind: 'text',
      text: 'entrada de teste',
    }, dir);
    assert.equal(segmentEntries.length, 1);

    await writeFile(paths.offerTypeLearningsPath, JSON.stringify({ schemaVersion: 1 }), 'utf-8');
    const offerTypeEntries = await saveLearningEntry({
      scope: 'offerType',
      groupKey: 'combo',
      bucket: 'approved',
      kind: 'text',
      text: 'entrada de teste',
    }, dir);
    assert.equal(offerTypeEntries.length, 1);
  });
});

test('technical base summarizes pasted sector material and reuses it only inside the same segment hierarchy', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'inova-tecnica', name: 'Inova Técnica', handle: '@inova', approvalEmail: 'aprovacao@example.com' }, dir);
    await updateProjectBrandInput('inova-tecnica', {
      brandName: 'Inova Técnica',
      segmentGroup: 'Engenharia',
      segmentCategory: 'Controle tecnológico / concreto / solos / asfalto',
      segmentSpecialty: 'solos e pavimentação',
      segment: 'controle tecnológico de solos, concreto e pavimentação',
      productsOrServices: 'CBR, limite de liquidez, limite de plasticidade, granulometria e laudos técnicos',
    }, dir);

    const analyzed = await analyzeProjectTechnicalBase('inova-tecnica', {
      sourceText: 'Ensaios de solo: CBR/ISC para pavimentação, limite de liquidez, limite de plasticidade, granulometria e compactação Proctor. token=segredo123',
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.match(analyzed.technicalBase.summary, /CBR/);
    assert.match(analyzed.technicalBase.summary, /limite de liquidez/);
    assert.doesNotMatch(analyzed.technicalBase.sourceText, /segredo123/);

    await createCentralProject({ projectId: 'outro-lab', name: 'Outro Lab', handle: '@outrolab', approvalEmail: 'aprovacao@example.com' }, dir);
    await updateProjectBrandInput('outro-lab', {
      brandName: 'Outro Lab',
      segmentGroup: 'Engenharia',
      segmentCategory: 'Controle tecnológico / concreto / solos / asfalto',
      segmentSpecialty: 'solos e pavimentação',
      segment: 'controle tecnológico de solos',
      productsOrServices: 'ensaios de solo e laudos técnicos',
    }, dir);
    const sameSegment = await generateContentBatch('outro-lab', { days: 1, startDate: '2026-07-21' }, dir);
    assert.match(sameSegment.items[0].image.prompt, /BASE TÉCNICA DO SEGMENTO/);
    assert.match(sameSegment.items[0].image.prompt, /CBR/);

    await createCentralProject({ projectId: 'casa-embalagem', name: 'Casa Embalagem', handle: '@casa', approvalEmail: 'aprovacao@example.com' }, dir);
    await updateProjectBrandInput('casa-embalagem', {
      brandName: 'Casa Embalagem',
      segmentGroup: 'Negócios locais e lojas',
      segmentCategory: 'Casa de embalagem',
      segment: 'loja local de embalagens',
      productsOrServices: 'embalagens, descartáveis e utilidades',
    }, dir);
    const otherSegment = await generateContentBatch('casa-embalagem', { days: 1, startDate: '2026-07-22' }, dir);
    assert.doesNotMatch(otherSegment.items[0].image.prompt, /limite de liquidez/);
  });
});

test('audienceType (B2B/B2C/mixed) normalizes, mirrors between brandInput/companyProfile, and reaches the image prompt as a fact', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'casa-de-embalagem',
      name: 'Casa de Embalagem',
      handle: '@casadeembalagem',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const updated = await updateProjectBrandInput('casa-de-embalagem', {
      segment: 'Atacado de embalagens',
      productsOrServices: 'embalagens, descartáveis e utilidades para revenda',
      audienceType: 'B2B',
    }, dir);
    assert.equal(updated.brandInput.audienceType, 'b2b');
    assert.equal(updated.companyProfile.audienceType, 'b2b');

    const batch = await generateContentBatch('casa-de-embalagem', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'instagram_story',
    }, dir);
    assert.match(batch.items[0].image.prompt, /Foco comercial informado: B2B/);

    const mixed = await updateProjectBrandInput('casa-de-embalagem', {
      segment: 'Atacado e varejo de embalagens',
      audienceType: 'mixed',
    }, dir);
    assert.equal(mixed.brandInput.audienceType, 'mixed');
    assert.equal(mixed.companyProfile.audienceType, 'mixed');

    const cleared = await updateProjectBrandInput('casa-de-embalagem', {
      segment: 'Atacado de embalagens',
      audienceType: 'not-a-real-value',
    }, dir);
    assert.equal(cleared.brandInput.audienceType, '');
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
        fieldSuggestions: [
          { field: 'audience', value: 'Famílias e clientes de delivery', reason: 'Inferido do negócio', confidence: 'medium' },
          { field: 'segmentCategory', value: 'Restaurante', reason: 'Tentativa de reclassificação', confidence: 'high' },
        ],
      };
    };

    const withAi = await analyzeProjectBrandXray('boss-xray-ai', {}, dir, new Date(), { brandAnalyzer: fakeAnalyzer });
    assert.equal(withAi.xray.source, 'ai_analysis');
    assert.equal(withAi.xray.analysisMode, 'ai');
    assert.equal(withAi.xray.blocks.summary.text, 'Resumo escrito pela IA de teste.');
    assert.ok(withAi.xray.blocks.summary.sources.includes('ai_analysis'));
    assert.equal(withAi.xray.fieldSuggestions.find((suggestion) => suggestion.field === 'audience')?.source, 'ai_analysis');
    assert.equal(withAi.xray.fieldSuggestions.some((suggestion) => suggestion.field === 'segmentCategory'), false);
    assert.equal(withAi.project.brandInput.segmentCategory, '');

    const failingAnalyzer = async () => { throw new Error('provider offline'); };
    const withFailure = await analyzeProjectBrandXray('boss-xray-ai', {}, dir, new Date(), { brandAnalyzer: failingAnalyzer });
    assert.equal(withFailure.xray.analysisMode, 'fallback');
    assert.notEqual(withFailure.xray.blocks.summary.text, 'Resumo escrito pela IA de teste.');
    assert.match(withFailure.xray.blocks.summary.text, /Informado pelo usuário/);

    const partialAnalyzer = async () => ({ summary: 'Só o resumo veio da IA desta vez.' });
    const withPartial = await analyzeProjectBrandXray('boss-xray-ai', {}, dir, new Date(), { brandAnalyzer: partialAnalyzer });
    assert.equal(withPartial.xray.blocks.summary.text, 'Só o resumo veio da IA desta vez.');
    assert.match(withPartial.xray.blocks.communication.text, /Informado pelo usuário/);

    await updateProjectBrandInput('boss-xray-ai', { audience: 'Público confirmado pelo operador' }, dir);
    const triesToReplaceConfirmedAudience = async () => ({
      fieldSuggestions: [{ field: 'audience', value: 'Outro público inventado', reason: 'não deve entrar' }],
    });
    const protectedAudience = await analyzeProjectBrandXray('boss-xray-ai', {}, dir, new Date(), { brandAnalyzer: triesToReplaceConfirmedAudience });
    assert.equal(protectedAudience.xray.fieldSuggestions.some((suggestion) => suggestion.field === 'audience'), false);
    assert.equal(protectedAudience.project.brandInput.audience, 'Público confirmado pelo operador');
  });
});

test('pizzeria delivery suggests consumer buyers without misclassifying the business as a packaging supplier', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pizzaria-delivery-xray', name: 'Pizzaria Delivery' }, dir);
    await updateProjectBrandInput('pizzaria-delivery-xray', {
      brandName: 'Pizzaria Delivery',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segment: 'Pizzaria e delivery',
      productsOrServices: 'pizzas, esfihas e entrega por delivery',
      audienceType: 'b2c',
    }, dir);

    const analyzed = await analyzeProjectBrandXray('pizzaria-delivery-xray', {}, dir);
    const audienceSuggestion = analyzed.xray.fieldSuggestions.find((suggestion) => suggestion.field === 'audience');

    assert.match(audienceSuggestion.value, /famílias|consumidores finais/i);
    assert.doesNotMatch(audienceSuggestion.value, /padarias|mercados|organizadores de festas/i);
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
      segmentGroup: 'Alimenticio',
      segmentCategory: 'Pizzaria',
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

    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'rodizio', 'vertical', dir);

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

test('saveProjectAsset with scope "offer" stores the photo on project.offerAssets, not project.brand.references', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'oferta-fotos', name: 'Oferta Fotos', handle: '@of', approvalEmail: 'a@example.com' }, dir);
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const result = await saveProjectAsset('oferta-fotos', {
      kind: 'reference',
      filename: 'produto.png',
      dataUrl,
      role: 'product_photo',
      referenceCategory: 'real_product',
      scope: 'offer',
    }, dir);

    assert.equal(result.project.brand?.references?.length ?? 0, 0);
    assert.equal(result.project.offerAssets?.length, 1);
    assert.equal(result.project.offerAssets[0].filename, 'produto.png');
    assert.ok(result.metadata?.id);
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

test('creativeShapeGroupForChannel treats whatsapp_status as the same vertical shape group as Story/Reels', () => {
  assert.equal(creativeShapeGroupForChannel('whatsapp_status'), 'vertical');
  assert.equal(creativeShapeGroupForChannel('instagram_story'), 'vertical');
});

test('WhatsApp Status generates with the same real vertical dimensions as the other Story channels', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'canal-whatsapp',
      name: 'Canal WhatsApp',
      handle: '@canalwhatsapp',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const batch = await generateContentBatch('canal-whatsapp', {
      days: 1,
      startDate: '2026-07-20',
      channel: 'whatsapp_status',
    }, dir);
    const item = batch.items[0];
    assert.equal(item.channel, 'whatsapp_status');
    assert.equal(item.image.aspectRatio, 'portrait');
    assert.deepEqual(item.image.dimensions, { width: 1080, height: 1920 });
    assert.match(item.image.prompt, /WhatsApp Status 9:16 vertical real, 1080x1920/);
  });
});

test('saveProjectWhatsAppInstance records the session name with no secret file', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'whatsapp-demo',
      name: 'WhatsApp Demo',
      handle: '@whatsappdemo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const updated = await saveProjectWhatsAppInstance('whatsapp-demo', {
      sessionName: 'opensquad-whatsapp-demo',
    }, dir, new Date('2026-08-24T12:00:00.000Z'));

    assert.equal(updated.whatsapp.configured, true);
    assert.equal(updated.whatsapp.sessionName, 'opensquad-whatsapp-demo');
    assert.equal(updated.whatsapp.maskedApiKey, undefined);
  });
});

test('saveProjectWhatsAppInstance rejects a missing session name', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'whatsapp-incompleto', name: 'WhatsApp Incompleto' }, dir);
    await assert.rejects(
      () => saveProjectWhatsAppInstance('whatsapp-incompleto', {}, dir),
      /required/,
    );
  });
});

test('a project summary always carries a whatsapp block, defaulted for projects created before this field existed', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'whatsapp-default', name: 'WhatsApp Default' }, dir);
    const [project] = await (await import('../src/content-central.js')).listCentralProjects(dir);
    assert.deepEqual(project.whatsapp, { configured: false, sessionName: '' });
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

test('researchOnlineVisualTrends rejects web-tool configuration failures instead of saving them as prompt rules', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'pesquisa-firecrawl',
      name: 'Pesquisa Firecrawl',
      handle: '@pesquisafirecrawl',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectCompanyProfile('pesquisa-firecrawl', { segment: 'Pizzaria', productsOrServices: 'Pizzas' }, dir);
    await updateProjectImageRules('pesquisa-firecrawl', {
      imageRules: ['Regra escrita à mão pelo operador'],
    }, dir);

    await assert.rejects(
      () => researchOnlineVisualTrends('pesquisa-firecrawl', {
        webResearcher: async () => '[Pesquisa online] Não consegui pesquisar/navegar em tempo real: as ferramentas web deste ambiente estão sem configuração (FIRECRAWL_API_KEY/FIRECRAWL_API_URL ausentes), então não posso cumprir a exigência “use busca e navegação real” sem inventar.',
      }, dir),
      /não conseguiu navegar de verdade/,
    );

    const project = await loadProjectForTest('pesquisa-firecrawl', dir);
    assert.deepEqual(project.brand.imageRules, ['Regra escrita à mão pelo operador']);
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

test('generated image prompts only include layout references from the SAME segment — a pizzaria never sees Casa de Embalagem\'s approved image and vice versa', async () => {
  await withTempProject(async (dir) => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    await createCentralProject({ projectId: 'pizzaria-cruz', name: 'Pizzaria Cruz', handle: '@pizzariacruz', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('pizzaria-cruz', {
      brandName: 'Pizzaria Cruz', segmentGroup: 'Alimentício', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    const pizzaAnalyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'pizza-layout.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'Layout de pizza' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'Layout de pizza', imagePath: pizzaAnalyzed.imagePath, purpose: 'creative', postType: 'offer' }, dir, new Date());
    await saveProjectOffer('pizzaria-cruz', { name: 'Pizza Grande', type: 'offer', price: 'R$ 45' }, dir);

    await createCentralProject({ projectId: 'casa-embalagem', name: 'Casa de Embalagem', handle: '@casaembalagem', approvalEmail: 'b@example.com' }, dir);
    await updateProjectBrandInput('casa-embalagem', {
      brandName: 'Casa de Embalagem', segmentGroup: 'Negócios locais e lojas', segmentCategory: 'Casa de embalagem', segment: 'casa de embalagem', productsOrServices: 'embalagens',
    }, dir);
    const embalagemAnalyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:negocios-locais-e-lojas/category:casa-de-embalagem', dataUrl, filename: 'embalagem-layout.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'Layout de embalagem' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:negocios-locais-e-lojas/category:casa-de-embalagem', bucket: 'approved', kind: 'image', text: 'Layout de embalagem', imagePath: embalagemAnalyzed.imagePath, purpose: 'creative', postType: 'offer' }, dir, new Date());
    await saveProjectOffer('casa-embalagem', { name: 'Papel Alumínio 100m', type: 'offer', price: 'R$ 62,40' }, dir);

    const pizzaBatch = await generateContentBatch('pizzaria-cruz', { days: 1, startDate: '2026-07-20', channel: 'instagram_story' }, dir);
    const embalagemBatch = await generateContentBatch('casa-embalagem', { days: 1, startDate: '2026-07-20', channel: 'instagram_story' }, dir);

    const pizzaRefs = pizzaBatch.items[0].image.references.filter((r) => r.role === 'layout_model');
    const embalagemRefs = embalagemBatch.items[0].image.references.filter((r) => r.role === 'layout_model');

    assert.equal(pizzaRefs.length, 1);
    assert.match(pizzaRefs[0].relativePath, /pizza-layout\.png$/);
    assert.equal(embalagemRefs.length, 1);
    assert.match(embalagemRefs[0].relativePath, /embalagem-layout\.png$/);
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
    await updateProjectBrandInput('ai-overlay-logo', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir);

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

test('deleteProjectContent ignores housekeeping reasons like tests or regenerate later', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'apagar-motivo-ruido',
      name: 'Apagar Motivo Ruido',
      handle: '@apagarmotivoruido',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('apagar-motivo-ruido', { days: 1, startDate: '2026-07-20' }, dir);
    const content = batch.items[0];

    await deleteProjectContent('apagar-motivo-ruido', content.contentId, dir, content.batchId, 'foi apenas um teste');

    const project = (await listCentralProjects(dir)).find((p) => p.projectId === 'apagar-motivo-ruido');
    assert.equal(project.learnings.avoid.length, 0);
  });
});

test('deleteProjectContent saves Renata feedback instead of noisy operator reason', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'apagar-feedback-renata',
      name: 'Apagar Feedback Renata',
      handle: '@apagarfeedbackrenata',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('apagar-feedback-renata', { days: 1, startDate: '2026-07-20', channel: 'instagram_story' }, dir);
    const content = {
      ...batch.items[0],
      creativeReview: {
        status: 'blocked',
        summary: 'Story parece flyer quadrado centralizado.',
        warnings: ['Pouco uso de topo e base do Story.'],
        errors: ['Formato 1:1 dentro do 9:16.'],
      },
    };
    await writeFile(content.filePath, JSON.stringify(content, null, 2), 'utf-8');

    await deleteProjectContent('apagar-feedback-renata', content.contentId, dir, content.batchId, 'vou gerar outro teste');

    const project = (await listCentralProjects(dir)).find((p) => p.projectId === 'apagar-feedback-renata');
    assert.equal(project.learnings.avoid.length, 1);
    assert.match(project.learnings.avoid[0], /Formato 1:1 dentro do 9:16/);
    assert.match(project.learnings.avoid[0], /Pouco uso de topo e base/);
    assert.doesNotMatch(project.learnings.avoid[0], /vou gerar outro teste/);
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

test('simulateTestPost with an explicit offerId always uses that product, even when a weekday-restricted offer ahead of it in the pool would otherwise shift the topic index', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'produto-escolhido',
      name: 'Produto Escolhido',
      handle: '@produtoescolhido',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    // B only runs on Tuesdays, so it drops out of Monday's topic pool —
    // shifting every later offer's index down by one in that filtered pool.
    const { offer: offerB } = await saveProjectOffer('produto-escolhido', { name: 'Produto B', type: 'offer', daysOfWeek: ['tue'] }, dir);
    const { offer: offerA } = await saveProjectOffer('produto-escolhido', { name: 'Produto A', type: 'offer' }, dir);
    const { offer: offerC } = await saveProjectOffer('produto-escolhido', { name: 'Produto C', type: 'offer' }, dir);
    void offerB;

    // 2026-07-20 is a Monday: offer B is filtered out, so a naive index
    // lookup against the unfiltered pool (where A sits at index 1) lands on
    // C instead once the pool is re-filtered for Monday.
    const content = await simulateTestPost('produto-escolhido', {
      channel: 'instagram_story',
      offerId: offerA.id,
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.equal(content.contentTopic.offerId, offerA.id);
    assert.equal(content.contentTopic.offerName, 'Produto A');
    assert.notEqual(content.contentTopic.offerId, offerC.id);
  });
});

test('two simulateTestPost runs the same day on the same channel land in different batches instead of the second silently overwriting the first on disk', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'dois-testes-mesmo-dia',
      name: 'Dois Testes Mesmo Dia',
      handle: '@doistestes',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('dois-testes-mesmo-dia', { name: 'Produto Um', type: 'offer' }, dir);

    const now = new Date('2026-07-20T12:00:00.000Z');
    const first = await simulateTestPost('dois-testes-mesmo-dia', { channel: 'instagram_story', note: 'primeiro teste' }, dir, now);
    const second = await simulateTestPost('dois-testes-mesmo-dia', { channel: 'instagram_story', note: 'segundo teste' }, dir, new Date(now.getTime() + 1000));

    assert.notEqual(first.batchId, second.batchId);

    const all = await listProjectContent('dois-testes-mesmo-dia', dir);
    const tests = all.filter((item) => item.status === 'test_post_simulated');
    assert.equal(tests.length, 2, 'both tests must still exist on disk, not just the latest one');
    assert.ok(tests.some((item) => item.publish?.simulationNote === 'primeiro teste'));
    assert.ok(tests.some((item) => item.publish?.simulationNote === 'segundo teste'));
  });
});

test('simulateTestPost writes the very first draft file already marked as a test, never briefly indistinguishable from a real draft awaiting approval', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'marca-teste-desde-o-inicio',
      name: 'Marca Teste Desde O Inicio',
      handle: '@marcateste',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectBrandInput('marca-teste-desde-o-inicio', {
      brandName: 'Marca Teste Desde O Inicio', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('marca-teste-desde-o-inicio', { name: 'Produto Um', type: 'offer', price: 'R$ 49,90' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir, 'estrutura.png');

    let statusDuringImageGeneration = null;
    await simulateTestPost('marca-teste-desde-o-inicio', {
      channel: 'instagram_story',
      imageGenerator: async () => {
        // Read the item back off disk mid-generation — the same moment
        // Aguardando aprovação/the dashboard would see it if they polled
        // right now — before the image (or the post-generation status
        // re-assignment) has finished.
        const onDisk = (await listProjectContent('marca-teste-desde-o-inicio', dir))
          .find((item) => item.status !== undefined);
        statusDuringImageGeneration = onDisk?.status;
        return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.equal(statusDuringImageGeneration, 'test_post_simulated');
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
    await updateProjectBrandInput('imagem-ai', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir);

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
    await updateProjectBrandInput('animar-reels', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir);
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
    await updateProjectBrandInput('animar-vazio', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir);
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
    await updateProjectBrandInput('overlay-exato', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'combo', 'vertical', dir);

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
  });
});

test('Feed offer prompt uses a sales hook title, stronger CTA and blocks fake urgency', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'feed-conversao-real',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('feed-conversao-real', {
      name: 'Combo Família',
      type: 'combo',
      price: '89,90',
      items: 'pizza grande, refrigerante e borda recheada',
      autoGenerateCta: true,
      active: true,
    }, dir, new Date('2026-07-18T09:00:00.000Z'));
    await updateProjectBrandInput('feed-conversao-real', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'combo', 'feed', dir);

    const generatorCalls = [];
    await simulateTestPost('feed-conversao-real', {
      channel: 'instagram_feed',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/feed.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-07-18T09:05:00.000Z'));

    const prompt = generatorCalls[0].content.image.prompt;
    assert.match(prompt, /Título: criar um título-gancho curto.*Combo Família/i);
    assert.match(prompt, /CTA sutil: "Peça agora"/i);
    assert.doesNotMatch(prompt, /CTA sutil: "Saiba mais"/i);
    assert.match(prompt, /Não criar urgência, estoque, prazo, desconto ou garantia falsa/i);
  });
});

test('offer prices typed as plain decimals are normalized as Brazilian currency across topic prompt caption and image brief', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'preco-moeda-br',
      name: 'Hygi Comércio',
      handle: '@hygicomercio',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('preco-moeda-br', {
      name: 'Pano Microfibra 30x30',
      type: 'offer',
      price: '3,5',
      items: '2 unidades',
      active: true,
    }, dir, new Date('2026-07-18T09:00:00.000Z'));
    await updateProjectBrandInput('preco-moeda-br', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'feed', dir);

    const project = await loadProjectForTest('preco-moeda-br', dir);
    assert.equal(project.contentStrategy.offers[0].price, 'R$ 3,50');

    const generatorCalls = [];
    const content = await simulateTestPost('preco-moeda-br', {
      channel: 'instagram_feed',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/microfibra.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-07-18T09:05:00.000Z'));

    assert.equal(content.contentTopic.price, 'R$ 3,50');
    assert.match(content.image.prompt, /Preço exato: R\$ 3,50/);
    assert.match(content.caption.text, /Preço: R\$ 3,50\./);
    assert.match(generatorCalls[0].content.image.prompt, /Preço exato: R\$ 3,50/);
    assert.match(generatorCalls[0].content.image.prompt, /Preço “R\$ 3,50” em selo compacto/);
    assert.doesNotMatch(generatorCalls[0].content.image.prompt, /Preço exato: 3,5\b/);
  });
});

test('Urgency offer prompt uses only the real urgency written by the operator', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'urgencia-real-operador',
      name: 'Boss Pizzaria',
      handle: '@bosspizzaria',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('urgencia-real-operador', {
      name: 'Rodízio especial de sexta',
      type: 'urgency',
      price: '49,90',
      items: 'rodízio completo no salão',
      notes: 'Válido somente nesta sexta-feira no salão.',
      active: true,
    }, dir, new Date('2026-07-18T09:00:00.000Z'));
    await updateProjectBrandInput('urgencia-real-operador', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'feed', dir);

    const generatorCalls = [];
    await simulateTestPost('urgencia-real-operador', {
      channel: 'instagram_feed',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/urgencia.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-07-18T09:05:00.000Z'));

    const prompt = generatorCalls[0].content.image.prompt;
    assert.match(prompt, /Urgência real cadastrada: Válido somente nesta sexta-feira no salão\.?/i);
    assert.match(prompt, /Não inventar outra urgência além da cadastrada/i);
    assert.match(prompt, /CTA sutil: "Peça agora"/i);
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
      segmentGroup: 'Alimenticio',
      segmentCategory: 'Pizzaria',
      productsOrServices: 'delivery de pizzas e atendimento no salão',
      description: 'Descrição livre ainda não informada',
      serviceRegion: 'Várzea Grande-MT',
      mainDifferential: 'diferencial ainda não informado',
    }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'combo', 'vertical', dir);
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
    assert.match(prompt, /cores oficiais da marca têm prioridade absoluta/i);
    assert.match(prompt, /não copiar cores, paleta ou identidade visual da referência/i);
    assert.match(prompt, /LIBERDADE CRIATIVA/);
    assert.match(prompt, /Título exato:\s*2 Pizzas Grandes/i);
    assert.match(prompt, /Preço exato:\s*R\$ 79,99/i);
    assert.match(prompt, /CTA sutil: "Peça agora"/i);
    assert.match(prompt, /Identificação da marca: @bosspizzaria — manter exatamente este @ nos criativos/i);
    assert.doesNotMatch(prompt, /BRIEFING COMPLETO ORIGINAL/);
    assert.doesNotMatch(prompt, /Informado pelo usuário/i);
    assert.doesNotMatch(prompt, /Sugestão da IA/i);
    assert.doesNotMatch(prompt, /Descrição livre ainda não informada/i);
    assert.doesNotMatch(prompt, /diferencial ainda não informado/i);
    assert.doesNotMatch(prompt, /modo de operação/i);
    assert.doesNotMatch(prompt, /Não publicar sem aprovação/i);
    assert.doesNotMatch(prompt, /Variação criativa de teste: 2026/i);
    assert.ok(prompt.length < 6500);
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
    await updateProjectBrandInput('story-esfiha-nativo', { segmentGroup: 'Alimenticio', segmentCategory: 'Esfiharia' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:esfiharia', 'combo', 'vertical', dir);

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

test('multi-product offers rotate a persisted hero focus and prioritize its matching product photo', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'rodizio-rotativo', name: 'Boss Pizzaria', handle: '@boss', approvalEmail: 'aprovacao@example.com',
    }, dir);
    await saveProjectOffer('rodizio-rotativo', {
      name: 'Rodízio da Boss', type: 'rodizio', price: '49,90',
      items: 'pizza salgada, pizza doce, batata frita, esfiha e frango frito', active: true,
    }, dir);
    const dataUrl = `data:image/png;base64,${Buffer.from('produto').toString('base64')}`;
    for (const filename of ['pizza-salgada.jpg', 'pizza-doce.jpg', 'batata-frita.jpg', 'esfiha.jpg', 'frango-frito.jpg']) {
      await saveProjectAsset('rodizio-rotativo', { kind: 'reference', filename, dataUrl, role: 'product_photo' }, dir);
    }
    await updateProjectBrandInput('rodizio-rotativo', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'rodizio', 'feed', dir);

    const batch = await generateContentBatch('rodizio-rotativo', {
      days: 5, startDate: '2026-08-10', channel: 'instagram_feed',
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'rodizio-rotativo');
    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'rodizio-rotativo', {
      imageGenerator: async (payload) => {
        calls.push(payload);
        return { url: 'https://cdn.example.com/rodizio.png', mimeType: 'image/png' };
      },
    });

    const focusedProducts = calls.map((call) => {
      const match = call.content.image.prompt.match(/O foco visual desta peça é ([^.]+)\./i);
      assert.ok(match, 'expected a generic multi-product focus line');
      const item = match[1].toLowerCase();
      const firstProductPhoto = call.content.image.references.find((reference) => reference.role === 'product_photo');
      assert.ok(firstProductPhoto, 'expected a prioritized product photo');
      const terms = item.split(' ').filter((term) => term.length > 2);
      assert.equal(terms.some((term) => firstProductPhoto.filename.toLowerCase().includes(term)), true);
      return item;
    });
    assert.equal(new Set(focusedProducts).size, 5);

    const original = batch.items[0];
    const regenerated = await regenerateContentDay('rodizio-rotativo', original.contentId, { regenerate: 'creative' }, dir);
    assert.equal(regenerated.contentTopic.productRotationSeed, original.contentTopic.productRotationSeed);
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
      segmentGroup: 'Alimenticio',
      segmentCategory: 'Pizzaria',
      productsOrServices: 'rodízio de pizzas e delivery',
    }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir);
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
      segmentGroup: 'Servicos',
      segmentCategory: 'Engenharia',
      productsOrServices: 'ensaios técnicos de concreto, solo e asfalto em canteiros de obra',
    }, dir);
    await registerCreativeTemplate('group:servicos/category:engenharia', 'offer', 'vertical', dir);
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
      segmentGroup: 'Servicos',
      segmentCategory: 'Marketing',
      productsOrServices: 'Gestão de redes sociais e criação de anúncios',
    }, dir);
    await registerCreativeTemplate('group:servicos/category:marketing', 'offer', 'feed', dir);

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
    await updateProjectBrandInput('agencia-com-portfolio', { segmentGroup: 'Servicos', segmentCategory: 'Marketing' }, dir);
    await registerCreativeTemplate('group:servicos/category:marketing', 'offer', 'feed', dir);

    const calls = [];
    await simulateTestPost('agencia-com-portfolio', {
      channel: 'instagram_feed',
      imageGenerator: async (payload) => { calls.push(payload); return { url: 'https://cdn.example.com/portfolio.png', mimeType: 'image/png' }; },
    }, dir);

    assert.doesNotMatch(calls[0].content.image.prompt, /provavelmente vende serviço, não produto físico/);
  });
});

test('a project whose ONLY product photo was uploaded offer-scoped (scope: "offer", no brand.references entries at all) is still correctly recognized as having a real product when generating for a DIFFERENT photo-less offer, not wrongly flagged as a service business', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'so-foto-de-oferta',
      name: 'So Foto De Oferta',
      handle: '@sfo',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const dataUrl = `data:image/png;base64,${Buffer.from('produto').toString('base64')}`;
    const saved = await saveProjectAsset('so-foto-de-oferta', {
      kind: 'reference',
      filename: 'produto-a.png',
      dataUrl,
      role: 'product_photo',
      weight: 'medium',
      scope: 'offer',
    }, dir);
    // Confirms the fixture actually reproduces the bug's precondition: zero
    // entries in the shared references gallery, the photo only exists on
    // project.offerAssets.
    assert.equal(saved.project.brand?.references?.length ?? 0, 0);
    assert.equal(saved.project.offerAssets?.length, 1);

    // Photo A is claimed by Offer A. Offer B has no photo of its own — its
    // generation must never borrow Photo A (see the sibling "never borrows"
    // test above), which means productReferences ends up EMPTY for Offer B
    // and buildChatGptFinalCardPrompt falls back to hasAnyProductPhotoReference
    // to decide between "no photo selected this round" (correct — this
    // project does sell a real, photographed product) and "sells services,
    // don't invent a product" (wrong here). This is the exact branch the
    // bug affected — normalizeProjectReferences() alone never sees
    // offer-scoped photos, so it used to answer "no real product ever
    // uploaded" for a project whose only photo lives on project.offerAssets.
    await saveProjectOffer('so-foto-de-oferta', {
      name: 'Produto A',
      type: 'offer',
      price: 'R$ 100',
      photoReferenceIds: [saved.metadata.id],
      active: true,
    }, dir, new Date('2026-08-01T12:00:00.000Z'));
    await saveProjectOffer('so-foto-de-oferta', {
      name: 'Produto B',
      type: 'offer',
      price: 'R$ 200',
      active: true,
    }, dir, new Date('2026-08-01T12:01:00.000Z'));
    await updateProjectBrandInput('so-foto-de-oferta', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'feed', dir);

    const batch = await generateContentBatch('so-foto-de-oferta', { days: 2, startDate: '2026-08-03', channel: 'instagram_feed' }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'so-foto-de-oferta');
    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'so-foto-de-oferta', {
      imageGenerator: async (payload) => { calls.push(payload); return { url: 'https://cdn.example.com/img.png', mimeType: 'image/png' }; },
    });

    const productBPayload = calls.find((call) => call.content.contentTopic.offerName === 'Produto B');
    assert.ok(productBPayload, 'expected a generation call for the photo-less offer');
    const prompt = productBPayload.content.image.prompt;
    assert.doesNotMatch(prompt, /provavelmente vende serviço, não produto físico/);
    assert.doesNotMatch(prompt, /Não inventar um produto físico genérico/);
    assert.match(prompt, /Sem foto real selecionada nesta geração/);
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
    await updateProjectBrandInput('layout-rotativo', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    // Rotation can now only happen among multiple MATCHING registered
    // templates (a directly-uploaded, untagged layout_model reference never
    // counts as a candidate anymore — see buildPrimaryAiImageReferences).
    await saveProjectOffer('layout-rotativo', { name: 'Oferta rotativa', type: 'offer', price: 'R$ 49,90' }, dir);
    const templateA = await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir);
    const templateB = await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'offer', 'vertical', dir);

    const seenLayouts = new Set();
    for (const seed of ['seed-1', 'seed-2', 'seed-3', 'seed-4', 'seed-5', 'seed-6']) {
      const calls = [];
      await simulateTestPost('layout-rotativo', {
        channel: 'instagram_story',
        testSeed: seed,
        imageGenerator: async (payload) => { calls.push(payload); return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
      }, dir, new Date('2026-07-21T12:00:00.000Z'));
      const prompt = calls[0].content.image.prompt;
      if (prompt.includes(`Layout principal: ${templateA.imagePath}`)) seenLayouts.add('a');
      if (prompt.includes(`Layout principal: ${templateB.imagePath}`)) seenLayouts.add('b');
    }
    assert.ok(seenLayouts.size > 1, `expected rotation across both matching templates, only saw: ${[...seenLayouts]}`);
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
    await updateProjectBrandInput('foto-produto-certa', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'combo', 'vertical', dir);

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

test('a marketing offer with its own linked photo shows that exact real product, not a generic/guessed one, for a reseller with many distinct SKUs', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'rei-do-xiaomi-teste',
      name: 'Rei do Xiaomi',
      handle: '@reidoxiaomi',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const dataUrl = `data:image/png;base64,${Buffer.from('img').toString('base64')}`;
    const redmiPhoto = await saveProjectAsset('rei-do-xiaomi-teste', {
      kind: 'reference',
      filename: 'redmi-note-15.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
      instruction: 'Foto real do Redmi Note 15, autorizada pela marca.',
    }, dir);
    const pocoPhoto = await saveProjectAsset('rei-do-xiaomi-teste', {
      kind: 'reference',
      filename: 'poco-x8-pro.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
      instruction: 'Foto real do Poco X8 Pro, autorizada pela marca.',
    }, dir);

    await saveProjectOffer('rei-do-xiaomi-teste', {
      name: 'Redmi Note 15 8/256GB',
      type: 'offer',
      price: 'R$ 1.349',
      photoReferenceIds: [redmiPhoto.metadata.id],
      active: true,
    }, dir, new Date('2026-08-01T12:00:00.000Z'));
    await saveProjectOffer('rei-do-xiaomi-teste', {
      name: 'Poco X8 Pro 12/512GB',
      type: 'offer',
      price: 'R$ 2.649',
      photoReferenceIds: [pocoPhoto.metadata.id],
      active: true,
    }, dir, new Date('2026-08-01T12:01:00.000Z'));
    await updateProjectBrandInput('rei-do-xiaomi-teste', { segmentGroup: 'Varejo', segmentCategory: 'Eletronicos' }, dir);
    await registerCreativeTemplate('group:varejo/category:eletronicos', 'offer', 'feed', dir);

    const generatorCalls = [];
    await simulateTestPost('rei-do-xiaomi-teste', {
      channel: 'instagram_feed',
      testSeed: 'rei-do-xiaomi-primeira-oferta',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/redmi.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-08-01T12:05:00.000Z'));

    const prompt = generatorCalls[0].content.image.prompt;
    const offerName = generatorCalls[0].content.contentTopic.offerName;
    const expectedPhoto = offerName.includes('Redmi') ? 'redmi-note-15.jpg' : 'poco-x8-pro.jpg';
    const unexpectedPhoto = offerName.includes('Redmi') ? 'poco-x8-pro.jpg' : 'redmi-note-15.jpg';

    // The linked photo for the actual offer being generated must be used —
    // never the other product's photo, and never the "no real product,
    // probably a service business" fallback that fires when nothing is
    // selected.
    assert.match(prompt, new RegExp(`Foto selecionada: assets/references/${expectedPhoto}`));
    assert.doesNotMatch(prompt, new RegExp(`Foto selecionada: assets/references/${unexpectedPhoto}`));
    assert.doesNotMatch(prompt, /provavelmente vende serviço, não produto físico/);
    assert.match(prompt, new RegExp(`O produto principal é o item real da foto anexada: ${offerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
});

test('an offer-scoped photo (scope: "offer", stored on project.offerAssets) still reaches the real generation prompt and catalog composition, not just the shared references gallery', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'oferta-foto-gera-imagem',
      name: 'Oferta Foto Gera Imagem',
      handle: '@ofgi',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const dataUrl = `data:image/png;base64,${Buffer.from('produto-real').toString('base64')}`;
    const offerPhoto = await saveProjectAsset('oferta-foto-gera-imagem', {
      kind: 'reference',
      filename: 'produto-real.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
      instruction: 'Foto real do produto, autorizada pela marca.',
      scope: 'offer',
    }, dir);

    // Confirms the write side still keeps it out of the shared gallery.
    assert.equal(offerPhoto.project.brand?.references?.length ?? 0, 0);
    assert.equal(offerPhoto.project.offerAssets?.length, 1);

    await saveProjectOffer('oferta-foto-gera-imagem', {
      name: 'Produto Real 1un',
      type: 'offer',
      price: 'R$ 199',
      photoReferenceIds: [offerPhoto.metadata.id],
      active: true,
    }, dir, new Date('2026-08-01T12:00:00.000Z'));
    await updateProjectBrandInput('oferta-foto-gera-imagem', { segmentGroup: 'Varejo', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:varejo/category:geral', 'offer', 'feed', dir);

    const generatorCalls = [];
    await simulateTestPost('oferta-foto-gera-imagem', {
      channel: 'instagram_feed',
      testSeed: 'oferta-foto-gera-imagem',
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/produto-real.png', mimeType: 'image/png' };
      },
    }, dir, new Date('2026-08-01T12:05:00.000Z'));

    const content = generatorCalls[0].content;
    // The offer-scoped photo must actually reach the AI: both in the prompt
    // text and in the reference payload sent to the image generator — not
    // silently dropped because it lives on project.offerAssets instead of
    // project.brand.references.
    assert.match(content.image.prompt, /Foto selecionada: assets\/references\/produto-real\.jpg/);
    assert.ok(content.image.references.some((reference) => reference.relativePath === 'assets/references/produto-real.jpg'));
  });
});

test('a marketing offer with NO photo of its own never borrows a photo already claimed by a different offer', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'rei-do-xiaomi-sem-foto',
      name: 'Rei do Xiaomi',
      handle: '@reidoxiaomi',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const dataUrl = `data:image/png;base64,${Buffer.from('img').toString('base64')}`;
    const redmiPhoto = await saveProjectAsset('rei-do-xiaomi-sem-foto', {
      kind: 'reference',
      filename: 'redmi-a7-pro.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
      instruction: 'Foto real do Redmi A7 Pro, autorizada pela marca.',
    }, dir);

    await saveProjectOffer('rei-do-xiaomi-sem-foto', {
      name: 'Redmi A7 Pro 4/64GB',
      type: 'offer',
      price: 'R$ 749',
      photoReferenceIds: [redmiPhoto.metadata.id],
      active: true,
    }, dir, new Date('2026-08-01T12:00:00.000Z'));
    // No photoReferenceIds here — this is the offer that has no photo of
    // its own, reproducing the real report: generating a post for it must
    // never pick up the Redmi A7 Pro's photo just because it's the only one
    // sitting in the project's reference pool.
    await saveProjectOffer('rei-do-xiaomi-sem-foto', {
      name: 'Redmi Note 15 8/256GB',
      type: 'offer',
      price: 'R$ 1.349',
      active: true,
    }, dir, new Date('2026-08-01T12:01:00.000Z'));
    await updateProjectBrandInput('rei-do-xiaomi-sem-foto', { segmentGroup: 'Varejo', segmentCategory: 'Eletronicos' }, dir);
    await registerCreativeTemplate('group:varejo/category:eletronicos', 'offer', 'feed', dir);

    const batch = await generateContentBatch('rei-do-xiaomi-sem-foto', {
      days: 2,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'rei-do-xiaomi-sem-foto');
    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'rei-do-xiaomi-sem-foto', {
      imageGenerator: async (payload) => {
        calls.push(payload);
        return { url: 'https://cdn.example.com/img.png', mimeType: 'image/png' };
      },
    });

    const notePayload = calls.find((call) => call.content.contentTopic.offerName === 'Redmi Note 15 8/256GB');
    assert.ok(notePayload, 'expected a generation call for the photo-less offer');
    const notePrompt = notePayload.content.image.prompt;
    assert.doesNotMatch(notePrompt, /Foto selecionada: assets\/references\/redmi-a7-pro\.jpg/);
    assert.doesNotMatch(notePrompt, /O produto principal é exatamente o item real da foto anexada: Redmi A7 Pro/);

    const proPayload = calls.find((call) => call.content.contentTopic.offerName === 'Redmi A7 Pro 4/64GB');
    if (proPayload) {
      assert.match(proPayload.content.image.prompt, /Foto selecionada: assets\/references\/redmi-a7-pro\.jpg/);
    }
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
    await updateProjectBrandInput('story-combo-3-pizzas', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    // Two registered templates matching the same postType/shape — isSquareLikeReference
    // must still exclude the square-oriented one from Story even though its
    // shape tag matches (analyzeLearningImage/saveLearningEntry have no
    // width/height/aspectRatio fields, so the filename text fallback in
    // isSquareLikeReference is the only way to reproduce square detection here).
    const squareTemplate = await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'combo', 'vertical', dir, 'layout-quadrado.jpg');
    const storyTemplate = await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'combo', 'vertical', dir, 'layout-story.jpg');

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
    assert.match(prompt, /Subtítulo\/benefícios obrigatórios:\s*Sabores selecionados/i);
    assert.match(prompt, /A composição deve comunicar visualmente um combo de 3 pizzas grandes/i);
    assert.match(prompt, /Não mostrar apenas uma pizza como item unitário/i);
    assert.match(prompt, /ESTRUTURA VERTICAL OBRIGATÓRIA/i);
    assert.match(prompt, /Topo: logo \+ título principal/i);
    assert.match(prompt, /Centro: combo de 3 pizzas como protagonista visual/i);
    assert.match(prompt, /Parte inferior média: preço em selo compacto/i);
    assert.match(prompt, /Rodapé: chamada “Peça agora” em texto pequeno/i);
    assert.doesNotMatch(prompt, new RegExp(`Layout principal: ${squareTemplate.imagePath}`));
    assert.match(prompt, new RegExp(`Layout principal: ${storyTemplate.imagePath}`));
    assert.match(prompt, /Força estrutural:\s*STRICT/i);
    assert.match(prompt, /Topo \(0-18%\)/i);
    assert.ok(references.every((reference) => reference.relativePath !== squareTemplate.imagePath));
    assert.ok(references.some((reference) => reference.relativePath === storyTemplate.imagePath));
    assert.ok(content.creativePreflight.warnings.some((warning) => warning.includes('3 Pizza grande')));
    assert.ok(content.creativePreflight.checks.some((check) => check.includes('referência de layout quadrada')));
    assert.equal(content.creativeSpec.product.treatment, 'faithful_enhance');
    assert.match(prompt, /Modo PRODUTO FIEL MELHORADO/i);
    assert.match(prompt, /apoio visual nunca pode disputar atenção com o produto/i);
    assert.equal(content.creativeSpec.layout.strength, 'strict');
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

    assert.match(content.image.prompt, /Preço obrigatório: R\$ 49,99/);
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

test('generateAiImageWithReviewLoop (via generation) never calls imageReviewer and always generates exactly once', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-revisor', name: 'Sem Revisor', handle: '@semrevisor', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('sem-revisor', {
      brandName: 'Sem Revisor', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas',
    }, dir);
    await saveProjectOffer('sem-revisor', { name: 'Pizza Grande', type: 'offer', price: 'R$ 49,90' }, dir);
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'modelo.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'modelo' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'modelo', imagePath: analyzed.imagePath, purpose: 'creative', postType: 'offer', shape: 'vertical' }, dir);

    const generatorCalls = [];
    let reviewerCalls = 0;
    await simulateTestPost('sem-revisor', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => { generatorCalls.push(payload); return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
      imageReviewer: async () => { reviewerCalls += 1; return { status: 'blocked', errors: ['nunca deveria rodar'] }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.equal(reviewerCalls, 0);
    assert.equal(generatorCalls.length, 1);
    assert.equal(generatorCalls[0].content.image.generationAttempts, 1);
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

test('Feed gets a direct default CTA for sales offers when the offer has no explicit CTA', async () => {
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
    await updateProjectBrandInput('cta-feed-suave', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'combo', 'feed', dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'combo', 'vertical', dir);

    const feedCalls = [];
    await simulateTestPost('cta-feed-suave', {
      channel: 'instagram_feed',
      imageGenerator: async (payload) => { feedCalls.push(payload); return { url: 'https://cdn.example.com/feed.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.match(feedCalls[0].content.image.prompt, /CTA sutil: "Peça agora"/i);

    const fbFeedCalls = [];
    await simulateTestPost('cta-feed-suave', {
      channel: 'facebook_feed',
      imageGenerator: async (payload) => { fbFeedCalls.push(payload); return { url: 'https://cdn.example.com/fbfeed.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.match(fbFeedCalls[0].content.image.prompt, /CTA sutil: "Peça agora"/i);

    const storyCalls = [];
    await simulateTestPost('cta-feed-suave', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => { storyCalls.push(payload); return { url: 'https://cdn.example.com/story.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.match(storyCalls[0].content.image.prompt, /CTA sutil: "Peça agora"/i);
  });
});

test('an offer\'s explicit CTA is still respected on Feed, folded into the same subtle text treatment as Story — no drawn button/selo outside ad creatives', async () => {
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
    await updateProjectBrandInput('cta-explicito-feed', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'rodizio', 'feed', dir);

    const feedCalls = [];
    await simulateTestPost('cta-explicito-feed', {
      channel: 'instagram_feed',
      imageGenerator: async (payload) => { feedCalls.push(payload); return { url: 'https://cdn.example.com/feed.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));
    assert.match(feedCalls[0].content.image.prompt, /CTA sutil: "Reserve sua mesa"/i);
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
    await updateProjectBrandInput('conteudo-sem-venda', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'vertical', dir);

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

test('a service is preserved as a sales topic without being described as a physical product', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'servico-real', name: 'Consultoria Real' }, dir);
    const saved = await saveProjectOffer('servico-real', {
      name: 'Consultoria financeira inicial',
      type: 'service',
      items: 'diagnóstico e plano de ação',
      cta: 'Agende uma conversa',
    }, dir);

    assert.equal(saved.offer.type, 'service');

    const batch = await generateContentBatch('servico-real', {
      days: 1,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
    }, dir);
    const topic = batch.items[0].contentTopic;

    assert.equal(topic.type, 'service');
    assert.equal(topic.label, 'Serviço');
    assert.match(topic.objective, /explicando benefício, processo e próxima ação/i);
    assert.match(topic.objective, /sem inventar produto físico, resultado ou garantia/i);
    assert.equal(topic.cta, 'Agende uma conversa');
  });
});

test('a registered sales offer keeps its CTA and full notes even when assigned to a non-sales pillar', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'oferta-pilar-prova',
      name: 'Loja de Embalagens',
      handle: '@embalagens',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectBrandInput('oferta-pilar-prova', {
      brandName: 'Loja de Embalagens',
      segment: 'Casa de embalagem e descartáveis',
      segmentGroup: 'Embalagens',
      segmentCategory: 'Casa de Embalagem',
      productsOrServices: 'Embalagens para alimentação, limpeza e delivery',
    }, dir);
    await registerCreativeTemplate('group:embalagens/category:casa-de-embalagem', 'offer', 'vertical', dir);
    const { pillar } = await saveProjectPillar('oferta-pilar-prova', {
      name: 'Prova e confiança',
      role: 'prova',
    }, dir);
    const { offer } = await saveProjectOffer('oferta-pilar-prova', {
      name: 'Pote G695',
      type: 'offer',
      price: 'R$ 19,90',
      items: 'Pacote com 100 unidades',
      notes: 'Destacar fechamento prático e uso profissional. Não inventar capacidade térmica.',
      pillarId: pillar.id,
      productTreatment: 'creative_redraw',
      layoutStrength: 'strict',
    }, dir);
    assert.equal(offer.productTreatment, 'creative_redraw');
    assert.equal(offer.layoutStrength, 'strict');

    const calls = [];
    const content = await simulateTestPost('oferta-pilar-prova', {
      channel: 'instagram_story',
      imageGenerator: async (payload) => {
        calls.push(payload);
        return { url: 'https://cdn.example.com/pote.png', mimeType: 'image/png', provider: 'fake' };
      },
    }, dir, new Date('2026-08-15T13:00:00.000Z'));

    assert.match(calls[0].content.image.prompt, /CTA sutil: "Peça agora"/i);
    assert.match(calls[0].content.image.prompt, /Destacar fechamento prático e uso profissional/i);
    assert.match(calls[0].content.image.prompt, /Não inventar capacidade térmica/i);
    assert.doesNotMatch(calls[0].content.image.prompt, /Visual gastronômico|arroz\/prato|ambiente real de pizzaria/i);
    assert.equal(content.creativeSpec.offer.isSales, true);
    assert.equal(content.creativeGenerationManifest[0].provider, 'fake');
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

test('topic idea agent creates 10 subjects per selected organic goal and feeds generation', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'banco-assuntos', name: 'Banco Assuntos' }, dir);
    await updateProjectBrandInput('banco-assuntos', {
      brandName: 'Banco Assuntos',
      segment: 'Agência de marketing digital',
      productsOrServices: 'sites, landing pages e tráfego pago',
      audience: 'donos de negócios locais',
      mainDifferential: 'diagnóstico e estratégia antes de vender execução',
      contentGoals: ['authority', 'education', 'brand_awareness'],
    }, dir);

    const generated = await refreshProjectTopicIdeas('banco-assuntos', {
      topicIdeaGenerator: async ({ goalKeys }) => ({
        goals: Object.fromEntries(goalKeys.map((goalKey) => [goalKey, {
          items: Array.from({ length: 10 }, (_, index) => ({
            title: `${goalKey} assunto ${index + 1}`,
            angle: `${goalKey} ângulo ${index + 1}`,
            detail: `${goalKey} complemento ${index + 1}`,
          })),
        }])),
      }),
    }, dir, new Date('2026-08-21T10:00:00.000Z'));

    assert.equal(generated.topicIdeas.refreshDays, 15);
    assert.equal(generated.topicIdeas.ideasPerGoal, 10);
    assert.equal(generated.topicIdeas.goals.authority.items.length, 10);
    assert.equal(generated.topicIdeas.goals.education.items.length, 10);
    assert.equal(generated.topicIdeas.goals.brand_awareness.items.length, 10);
    assert.equal(generated.topicIdeas.goals.authority.items[0].title, 'authority assunto 1');

    const batch = await generateContentBatch('banco-assuntos', {
      days: 3,
      startDate: '2026-08-03',
      channel: 'instagram_story',
    }, dir);
    const titles = batch.items.map((item) => item.contentTopic.ideaTitle);
    assert.deepEqual(titles, ['authority assunto 1', 'education assunto 1', 'brand_awareness assunto 1']);
    assert.match(batch.items[0].image.prompt, /authority complemento 1/);
    assert.match(batch.items[0].caption.text, /authority assunto 1/);
  });
});

test('topic idea bank refreshes after 15 days and stays unchanged before the due date', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'assuntos-quinzenais', name: 'Assuntos Quinzenais' }, dir);
    await updateProjectBrandInput('assuntos-quinzenais', {
      brandName: 'Assuntos Quinzenais',
      segment: 'Consultoria',
      productsOrServices: 'diagnóstico estratégico',
      contentGoals: ['authority'],
    }, dir);
    let run = 0;
    const topicIdeaGenerator = async () => {
      run += 1;
      return {
        goals: {
          authority: {
            items: Array.from({ length: 10 }, (_, index) => ({
              title: `rodada ${run} assunto ${index + 1}`,
              angle: `rodada ${run} ângulo ${index + 1}`,
              detail: `rodada ${run} detalhe ${index + 1}`,
            })),
          },
        },
      };
    };

    await generateContentBatch('assuntos-quinzenais', {
      days: 1,
      startDate: '2026-08-03',
      topicIdeaGenerator,
    }, dir);
    let project = await loadProjectForTest('assuntos-quinzenais', dir);
    assert.equal(project.contentStrategy.topicIdeas.goals.authority.items[0].title, 'rodada 1 assunto 1');

    await generateContentBatch('assuntos-quinzenais', {
      days: 1,
      startDate: '2026-08-04',
      topicIdeaGenerator,
    }, dir);
    project = await loadProjectForTest('assuntos-quinzenais', dir);
    assert.equal(project.contentStrategy.topicIdeas.goals.authority.items[0].title, 'rodada 1 assunto 1');
    assert.equal(run, 1);

    project.contentStrategy.topicIdeas.nextRefreshAt = '2026-08-16T10:00:00.000Z';
    await writeFile(getCentralPaths(dir, 'assuntos-quinzenais').projectPath, JSON.stringify(project, null, 2));

    await generateContentBatch('assuntos-quinzenais', {
      days: 1,
      startDate: '2026-08-18',
      topicIdeaGenerator,
    }, dir);
    project = await loadProjectForTest('assuntos-quinzenais', dir);
    assert.equal(project.contentStrategy.topicIdeas.goals.authority.items[0].title, 'rodada 2 assunto 1');
    assert.equal(run, 2);
  });
});

test('with no contentGoalWeights configured, active buckets split evenly by default', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'split-padrao', name: 'Split Padrão' }, dir);
    await updateProjectBrandInput('split-padrao', { brandName: 'Split', segment: 'loja', contentGoals: ['engagement'] }, dir);
    await saveProjectOffer('split-padrao', { name: 'Produto X', price: 'R$99' }, dir);

    // 2 buckets (sales + engagement), no weights saved => 50/50 default.
    // smoothWeightedRotation([sales:50, engagement:50]) alternates
    // deterministically, so the first 4 slots are exactly 2 offer + 2 goal.
    const batch = await generateContentBatch('split-padrao', { days: 4, startDate: '2026-08-03', channel: 'instagram_feed' }, dir);
    const offerCount = batch.items.filter((item) => item.contentTopic.source === 'offer').length;
    const goalCount = batch.items.filter((item) => item.contentTopic.source === 'goal').length;
    assert.equal(offerCount, 2);
    assert.equal(goalCount, 2);
  });
});

test('marking a priced-intent goal (e.g. "Divulgar promoções") has no special boosting effect anymore — only configured weight does', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-boost-especial', name: 'Sem Boost Especial' }, dir);
    await updateProjectBrandInput('sem-boost-especial', { brandName: 'Sem Boost', segment: 'loja', contentGoals: ['engagement', 'promotions'] }, dir);
    await saveProjectOffer('sem-boost-especial', { name: 'Produto X', price: 'R$99' }, dir);

    const batch = await generateContentBatch('sem-boost-especial', { days: 4, startDate: '2026-08-03', channel: 'instagram_feed' }, dir);
    const offerCount = batch.items.filter((item) => item.contentTopic.source === 'offer').length;
    // Still the plain 50/50 default split — "promotions" contributes no
    // bucket of its own (no template) and no longer duplicates the offer pool.
    assert.equal(offerCount, 2);
    assert.ok(batch.items.every((item) => item.contentTopic.type !== 'promotions'), 'promotions goal must never spawn its own topic type');
  });
});

test('a configured content-goal weight actually shifts generation toward the heavier bucket', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'peso-configurado', name: 'Peso Configurado' }, dir);
    await updateProjectBrandInput('peso-configurado', {
      brandName: 'Peso Configurado',
      segment: 'loja',
      contentGoals: ['brand_awareness'],
      contentGoalWeights: { sales: 90, brand_awareness: 10 },
    }, dir);
    await saveProjectOffer('peso-configurado', { name: 'Produto X', price: 'R$99' }, dir);

    // 10 slots, 90/10 split => exactly 9 offer + 1 goal, spread out (not clustered).
    const batch = await generateContentBatch('peso-configurado', { days: 10, startDate: '2026-08-03', channel: 'instagram_feed' }, dir);
    const offerCount = batch.items.filter((item) => item.contentTopic.source === 'offer').length;
    const goalCount = batch.items.filter((item) => item.contentTopic.source === 'goal').length;
    assert.equal(offerCount, 9);
    assert.equal(goalCount, 1);
  });
});

test('the "sales" bucket exists whenever there are active offers, even with no priced-intent goal marked at all', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'venda-sem-meta', name: 'Venda Sem Meta' }, dir);
    await updateProjectBrandInput('venda-sem-meta', { brandName: 'Venda Sem Meta', segment: 'loja', contentGoals: ['engagement'] }, dir);
    await saveProjectOffer('venda-sem-meta', { name: 'Produto X', price: 'R$99' }, dir);

    const batch = await generateContentBatch('venda-sem-meta', { days: 4, startDate: '2026-08-03', channel: 'instagram_feed' }, dir);
    assert.ok(batch.items.some((item) => item.contentTopic.source === 'offer'), 'the offer pool must still compete for slots');
  });
});

test('offersOnly still overrides any configured content-goal weight', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'override-offers-only', name: 'Override OffersOnly' }, dir);
    await updateProjectBrandInput('override-offers-only', {
      brandName: 'Override',
      segment: 'loja',
      contentGoals: ['authority'],
      contentGoalWeights: { sales: 10, authority: 90 },
    }, dir);
    const { group } = await saveProjectOfferGroup('override-offers-only', { name: 'Fim de semana' }, dir);
    await saveProjectOffer('override-offers-only', { name: 'Combo', price: 'R$29', groupId: group.id }, dir);

    const batch = await generateContentBatch('override-offers-only', {
      days: 5,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);
    assert.ok(batch.items.every((item) => item.contentTopic.source === 'offer' && item.contentTopic.offerName === 'Combo'), 'offersOnly must win over the 90% authority weight');
  });
});

test('a stale saved weight that no longer covers the active buckets falls back to an even split instead of failing', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'peso-desatualizado', name: 'Peso Desatualizado' }, dir);
    // Weight only covers "sales" + "authority", but the goal actually
    // marked below is "engagement" — the saved split no longer matches the
    // active bucket set, so generation must not throw or silently misweight.
    await updateProjectBrandInput('peso-desatualizado', {
      brandName: 'Peso Desatualizado',
      segment: 'loja',
      contentGoals: ['engagement'],
      contentGoalWeights: { sales: 80, authority: 20 },
    }, dir);
    await saveProjectOffer('peso-desatualizado', { name: 'Produto X', price: 'R$99' }, dir);

    const batch = await generateContentBatch('peso-desatualizado', { days: 4, startDate: '2026-08-03', channel: 'instagram_feed' }, dir);
    const offerCount = batch.items.filter((item) => item.contentTopic.source === 'offer').length;
    assert.equal(offerCount, 2, 'falls back to the 50/50 even split between the 2 actually-active buckets');
  });
});

test('a priced-intent goal has zero effect when there are no offers registered — no invented sales content', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-oferta-boost', name: 'Sem Oferta Boost' }, dir);
    await updateProjectBrandInput('sem-oferta-boost', {
      brandName: 'Sem Oferta',
      segment: 'consultoria',
      contentGoals: ['authority', 'sell_services', 'leads'],
    }, dir);

    const batch = await generateContentBatch('sem-oferta-boost', { days: 2, startDate: '2026-08-03', channel: 'instagram_feed' }, dir);
    const sources = batch.items.map((item) => item.contentTopic.source);
    assert.ok(sources.every((source) => source === 'goal'), 'expected only the real "authority" goal topic, never an offer/invented topic');
  });
});

test('offer groups can be created, edited and deleted, and an offer can be assigned to one', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'grupos-teste', name: 'Grupos Teste' }, dir);

    const { group: geral } = await saveProjectOfferGroup('grupos-teste', { name: 'Geral' }, dir);
    const { group: blackFriday } = await saveProjectOfferGroup('grupos-teste', { name: 'Black Friday' }, dir);
    assert.notEqual(geral.id, blackFriday.id);

    const { offer } = await saveProjectOffer('grupos-teste', { name: 'Produto X', groupId: blackFriday.id }, dir);
    assert.equal(offer.groupId, blackFriday.id);

    const renamed = await saveProjectOfferGroup('grupos-teste', { id: blackFriday.id, name: 'Black Friday 2026' }, dir);
    assert.equal(renamed.group.name, 'Black Friday 2026');
    assert.equal(renamed.project.contentStrategy.offerGroups.length, 2);

    const deleted = await deleteProjectOfferGroup('grupos-teste', geral.id, dir);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.project.contentStrategy.offerGroups.length, 1);
    // Deleting a group never touches offers that reference a DIFFERENT
    // group — same precedent as deleting a pillar.
    const stillLinked = deleted.project.contentStrategy.offers.find((entry) => entry.id === offer.id);
    assert.equal(stillLinked.groupId, blackFriday.id);
  });
});

test('offer group comboChance defaults to 0 and clamps to 0-100', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'combo-chance-clamp', name: 'Combo Chance Clamp' }, dir);
    const { group: defaulted } = await saveProjectOfferGroup('combo-chance-clamp', { name: 'Geral' }, dir);
    assert.equal(defaulted.comboChance, 0);

    const { group: clampedHigh } = await saveProjectOfferGroup('combo-chance-clamp', { name: 'Alto', comboChance: 500 }, dir);
    assert.equal(clampedHigh.comboChance, 100);

    const { group: clampedLow } = await saveProjectOfferGroup('combo-chance-clamp', { name: 'Baixo', comboChance: -10 }, dir);
    assert.equal(clampedLow.comboChance, 0);

    const { group: set } = await saveProjectOfferGroup('combo-chance-clamp', { name: 'Definido', comboChance: 25 }, dir);
    assert.equal(set.comboChance, 25);
  });
});

test('renaming a group (partial payload, no comboChance) preserves its existing comboChance and createdAt', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'renomear-grupo', name: 'Renomear Grupo' }, dir);
    const { group: created } = await saveProjectOfferGroup('renomear-grupo', { name: 'Pizzas', comboChance: 40 }, dir);
    assert.equal(created.comboChance, 40);

    const { group: renamed } = await saveProjectOfferGroup('renomear-grupo', { id: created.id, name: 'Pizzas Grandes' }, dir);
    assert.equal(renamed.name, 'Pizzas Grandes');
    assert.equal(renamed.comboChance, 40);
    assert.equal(renamed.createdAt, created.createdAt);
  });
});

test('offers from a deleted group are retained as history but never re-enter the generation pool', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'grupo-removido', name: 'Grupo Removido' }, dir);
    const { group: antiga } = await saveProjectOfferGroup('grupo-removido', { name: 'Campanha antiga' }, dir);
    const { group: atual } = await saveProjectOfferGroup('grupo-removido', { name: 'Produtos atuais' }, dir);
    await saveProjectOffer('grupo-removido', { name: 'Produto antigo', groupId: antiga.id }, dir);
    await saveProjectOffer('grupo-removido', { name: 'Produto atual', groupId: atual.id }, dir);

    await deleteProjectOfferGroup('grupo-removido', antiga.id, dir);
    const batch = await generateContentBatch('grupo-removido', {
      days: 3,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
    }, dir);

    const offerNames = batch.items.filter((item) => item.contentTopic.source === 'offer').map((item) => item.contentTopic.offerName);
    assert.ok(offerNames.every((name) => name === 'Produto atual'));
    assert.ok(!offerNames.includes('Produto antigo'));
  });
});

test('a selected group keeps its own product queue while authority posts are interleaved', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'fila-por-grupo', name: 'Fila por Grupo' }, dir);
    await updateProjectBrandInput('fila-por-grupo', { brandName: 'Fila', segment: 'loja', contentGoals: ['engagement'] }, dir);
    const { group } = await saveProjectOfferGroup('fila-por-grupo', { name: 'Produtos para venda' }, dir);
    await saveProjectOffer('fila-por-grupo', { name: 'Produto 1', groupId: group.id }, dir);
    await saveProjectOffer('fila-por-grupo', { name: 'Produto 2', groupId: group.id }, dir);
    await saveProjectOffer('fila-por-grupo', { name: 'Produto 3', groupId: group.id }, dir);

    const first = await generateContentSchedulePlan('fila-por-grupo', {
      days: 4,
      startDate: '2026-08-03',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      groupIds: [group.id],
    }, dir);
    const second = await generateContentSchedulePlan('fila-por-grupo', {
      days: 2,
      startDate: '2026-08-07',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      groupIds: [group.id],
    }, dir);

    const generatedOffers = [...first.items, ...second.items]
      .filter((item) => item.contentTopic.source === 'offer')
      .map((item) => item.contentTopic.offerName);
    assert.deepEqual(generatedOffers.slice(0, 3), ['Produto 1', 'Produto 2', 'Produto 3']);
    assert.ok([...first.items, ...second.items].some((item) => item.contentTopic.source === 'goal'));
  });
});

test('generating a schedule with groupIds only pulls offers from the requested group(s), leaving goal topics untouched', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'grupos-geracao', name: 'Grupos Geracao' }, dir);
    await updateProjectBrandInput('grupos-geracao', { brandName: 'Grupos', segment: 'loja', contentGoals: ['engagement'] }, dir);

    const { group: blackFriday } = await saveProjectOfferGroup('grupos-geracao', { name: 'Black Friday' }, dir);
    await saveProjectOfferGroup('grupos-geracao', { name: 'Geral' }, dir);
    await saveProjectOffer('grupos-geracao', { name: 'Produto Black Friday', price: 'R$1', groupId: blackFriday.id }, dir);
    await saveProjectOffer('grupos-geracao', { name: 'Produto Geral Sem Grupo' }, dir);

    // Pool scoped to the Black Friday group: interleave([produtoBF], [engagement]) = 2 slots.
    const batch = await generateContentBatch('grupos-geracao', {
      days: 2,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [blackFriday.id],
    }, dir);

    const offerNames = batch.items.filter((item) => item.contentTopic.source === 'offer').map((item) => item.contentTopic.offerName);
    assert.ok(offerNames.every((name) => name === 'Produto Black Friday'), 'only the Black Friday group offer should appear');
    assert.ok(!offerNames.includes('Produto Geral Sem Grupo'), 'the ungrouped offer must never appear when a group filter is set');
    assert.ok(batch.items.some((item) => item.contentTopic.source === 'goal'), 'goal-driven topics keep working regardless of the group filter');
  });
});

test('a group with comboChance=100 always pairs the drawn offer with a same-group sibling into one combo topic', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'combo-pairing', name: 'Combo Pairing' }, dir);
    const { group } = await saveProjectOfferGroup('combo-pairing', { name: 'Pizzas', comboChance: 100 }, dir);
    await saveProjectOffer('combo-pairing', { name: 'Pizza Calabresa', price: 'R$45', groupId: group.id }, dir);
    await saveProjectOffer('combo-pairing', { name: 'Pizza Marguerita', price: 'R$50', groupId: group.id }, dir);

    const batch = await generateContentBatch('combo-pairing', {
      days: 1,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    const topic = batch.items[0].contentTopic;
    assert.equal(topic.type, 'combo');
    assert.ok(topic.offerName.includes('Pizza Calabresa'));
    assert.ok(topic.offerName.includes('Pizza Marguerita'));
    assert.ok(topic.notes.includes('R$45'));
    assert.ok(topic.notes.includes('R$50'));
    // The price field itself must carry both prices too — leaving it empty
    // would make downstream "no price registered" prompt logic contradict
    // the notes text, which does mention both (see finding 2).
    assert.equal(topic.price, 'R$45 + R$50');
  });
});

test('comboChance=100 with only one offer in the group falls back to a single-product topic', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'combo-pairing-sozinho', name: 'Combo Pairing Sozinho' }, dir);
    const { group } = await saveProjectOfferGroup('combo-pairing-sozinho', { name: 'Pizzas', comboChance: 100 }, dir);
    await saveProjectOffer('combo-pairing-sozinho', { name: 'Pizza Única', price: 'R$45', groupId: group.id }, dir);

    const batch = await generateContentBatch('combo-pairing-sozinho', {
      days: 1,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    const topic = batch.items[0].contentTopic;
    assert.equal(topic.type, 'offer');
    assert.equal(topic.offerName, 'Pizza Única');
  });
});

test('an offer that is already type combo is never paired again even with comboChance=100', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'combo-no-nest', name: 'Combo No Nest' }, dir);
    const { group } = await saveProjectOfferGroup('combo-no-nest', { name: 'Promos', comboChance: 100 }, dir);
    await saveProjectOffer('combo-no-nest', { name: 'Combo Família', type: 'combo', price: 'R$60', groupId: group.id }, dir);
    await saveProjectOffer('combo-no-nest', { name: 'Pizza Solo', price: 'R$45', groupId: group.id }, dir);

    const batch = await generateContentBatch('combo-no-nest', {
      days: 2,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    // Neither draw should become a synthetic merged topic (id pattern
    // "<a.id>+<b.id>") — "Combo Família" is already type combo (skips
    // pairing as the primary), and "Pizza Solo" has no eligible non-combo
    // partner to pair with (the only sibling is the combo itself).
    assert.ok(batch.items.every((item) => !String(item.contentTopic.id || '').includes('+')));
  });
});

test('a combo partner restricted to a weekday the primary is NOT drawn on is never picked, falling back to single-product', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'combo-parceiro-dia', name: 'Combo Parceiro Dia' }, dir);
    const { group } = await saveProjectOfferGroup('combo-parceiro-dia', { name: 'Pizzas', comboChance: 100 }, dir);
    // Primary offer has no weekday restriction, so it is always drawn.
    await saveProjectOffer('combo-parceiro-dia', { name: 'Pizza Calabresa', price: 'R$45', groupId: group.id }, dir);
    // Its only same-group sibling is restricted to Saturdays — ineligible
    // as a combo partner on a Monday draw (see finding 3).
    await saveProjectOffer('combo-parceiro-dia', { name: 'Pizza Marguerita', price: 'R$50', groupId: group.id, daysOfWeek: ['sat'] }, dir);

    // 2026-08-03 is a Monday.
    const batch = await generateContentBatch('combo-parceiro-dia', {
      days: 1,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    const topic = batch.items[0].contentTopic;
    assert.equal(topic.type, 'offer');
    assert.equal(topic.offerName, 'Pizza Calabresa');
  });
});

test('a paired combo topic carries exactly one photo per offer through to real image generation, never duplicating one offer\'s photos while dropping the other\'s', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'combo-fotos',
      name: 'Combo Fotos',
      handle: '@combofotos',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const dataUrl = `data:image/png;base64,${Buffer.from('img').toString('base64')}`;
    const photoA = await saveProjectAsset('combo-fotos', {
      kind: 'reference',
      filename: 'pizza-calabresa.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
      instruction: 'Foto real da Pizza Calabresa, autorizada pela marca.',
    }, dir);
    const photoB = await saveProjectAsset('combo-fotos', {
      kind: 'reference',
      filename: 'pizza-marguerita.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
      instruction: 'Foto real da Pizza Marguerita, autorizada pela marca.',
    }, dir);

    const { group } = await saveProjectOfferGroup('combo-fotos', { name: 'Pizzas', comboChance: 100 }, dir);
    await saveProjectOffer('combo-fotos', {
      name: 'Pizza Calabresa', price: 'R$45', groupId: group.id, photoReferenceIds: [photoA.metadata.id],
    }, dir);
    await saveProjectOffer('combo-fotos', {
      name: 'Pizza Marguerita', price: 'R$50', groupId: group.id, photoReferenceIds: [photoB.metadata.id],
    }, dir);
    await updateProjectBrandInput('combo-fotos', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'combo', 'feed', dir);

    const batch = await generateContentBatch('combo-fotos', {
      days: 1,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);
    assert.equal(batch.items[0].contentTopic.type, 'combo');

    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'combo-fotos');
    const calls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'combo-fotos', {
      imageGenerator: async (payload) => { calls.push(payload); return { url: 'https://cdn.example.com/combo.png', mimeType: 'image/png' }; },
    });

    assert.equal(calls.length, 1);
    // buildPrimaryAiImageReferences must end up with exactly one product
    // photo from EACH paired offer — not two from one and none from the
    // other (see finding 4).
    const productPhotoIds = calls[0].content.image.references
      .filter((reference) => reference.role === 'product_photo')
      .map((reference) => reference.id)
      .sort();
    assert.deepEqual(productPhotoIds, [photoA.metadata.id, photoB.metadata.id].sort());
  });
});

test('an offer flagged uniqueProposal never pulls in a combo partner, even at comboChance=100', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'unique-proposal-primary', name: 'Unique Proposal Primary' }, dir);
    const { group } = await saveProjectOfferGroup('unique-proposal-primary', { name: 'Pizzas', comboChance: 100 }, dir);
    await saveProjectOffer('unique-proposal-primary', { name: 'Pizza Exclusiva', price: 'R$60', groupId: group.id, uniqueProposal: true }, dir);
    await saveProjectOffer('unique-proposal-primary', { name: 'Pizza Comum', price: 'R$45', groupId: group.id }, dir);

    const batch = await generateContentBatch('unique-proposal-primary', {
      days: 2,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    const exclusiva = batch.items.find((item) => item.contentTopic.offerName === 'Pizza Exclusiva');
    assert.ok(exclusiva, 'Pizza Exclusiva should still be drawn on its own turn');
    assert.equal(exclusiva.contentTopic.type, 'offer');
  });
});

test('an offer flagged uniqueProposal is never picked as another offer\'s combo partner, even at comboChance=100', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'unique-proposal-partner', name: 'Unique Proposal Partner' }, dir);
    const { group } = await saveProjectOfferGroup('unique-proposal-partner', { name: 'Pizzas', comboChance: 100 }, dir);
    await saveProjectOffer('unique-proposal-partner', { name: 'Pizza Comum', price: 'R$45', groupId: group.id }, dir);
    await saveProjectOffer('unique-proposal-partner', { name: 'Pizza Exclusiva', price: 'R$60', groupId: group.id, uniqueProposal: true }, dir);

    const batch = await generateContentBatch('unique-proposal-partner', {
      days: 2,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    // "Pizza Comum" is the only non-flagged offer in the group, so its only
    // possible partner is the flagged "Pizza Exclusiva" — with that excluded,
    // no combo topic can ever be produced.
    assert.ok(batch.items.every((item) => item.contentTopic.type !== 'combo'));
  });
});

test('offersOnly excludes goal-driven topics entirely, generating a batch that is 100% the requested group', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'grupo-exclusivo', name: 'Grupo Exclusivo' }, dir);
    await updateProjectBrandInput('grupo-exclusivo', { brandName: 'Grupo Exclusivo', segment: 'loja', contentGoals: ['authority', 'engagement'] }, dir);

    const { group: fimDeSemana } = await saveProjectOfferGroup('grupo-exclusivo', { name: 'Promoção fim de semana' }, dir);
    await saveProjectOffer('grupo-exclusivo', { name: 'Combo Fim de Semana', price: 'R$29', groupId: fimDeSemana.id }, dir);

    const batch = await generateContentBatch('grupo-exclusivo', {
      days: 5,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
      groupIds: [fimDeSemana.id],
      offersOnly: true,
    }, dir);

    assert.equal(batch.items.length, 5);
    assert.ok(batch.items.every((item) => item.contentTopic.source === 'offer' && item.contentTopic.offerName === 'Combo Fim de Semana'));
  });
});

test('offersOnly with a group that has no active offers fails clearly instead of silently falling back to goal/default topics', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'grupo-vazio', name: 'Grupo Vazio' }, dir);
    await updateProjectBrandInput('grupo-vazio', { brandName: 'Grupo Vazio', segment: 'loja', contentGoals: ['authority'] }, dir);
    const { group: vazio } = await saveProjectOfferGroup('grupo-vazio', { name: 'Grupo Sem Ofertas' }, dir);

    await assert.rejects(
      generateContentBatch('grupo-vazio', {
        days: 1,
        startDate: '2026-08-03',
        channel: 'instagram_feed',
        groupIds: [vazio.id],
        offersOnly: true,
      }, dir),
      /não têm nenhuma oferta ativa/,
    );
  });
});

test('offersOnly is also respected by generateContentSchedulePlan (the pillar-aware path)', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'grupo-exclusivo-formatos', name: 'Grupo Exclusivo Formatos' }, dir);
    await updateProjectBrandInput('grupo-exclusivo-formatos', { brandName: 'Grupo Exclusivo Formatos', segment: 'loja', contentGoals: ['authority'] }, dir);
    const { group: fimDeSemana } = await saveProjectOfferGroup('grupo-exclusivo-formatos', { name: 'Promoção fim de semana' }, dir);
    await saveProjectOffer('grupo-exclusivo-formatos', { name: 'Combo Fim de Semana', price: 'R$29', groupId: fimDeSemana.id }, dir);

    const batch = await generateContentSchedulePlan('grupo-exclusivo-formatos', {
      days: 3,
      startDate: '2026-08-03',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      groupIds: [fimDeSemana.id],
      offersOnly: true,
    }, dir);

    assert.equal(batch.items.length, 3);
    assert.ok(batch.items.every((item) => item.contentTopic.source === 'offer' && item.contentTopic.offerName === 'Combo Fim de Semana'));
  });
});

test('pillar-aware planning never relabels a selected-group sale as education or positioning', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'intencao-pilares', name: 'Casa de Embalagem' }, dir);
    await updateProjectBrandInput('intencao-pilares', {
      brandName: 'Casa de Embalagem',
      segment: 'Casa de embalagem',
      productsOrServices: 'Embalagens para restaurantes e delivery',
      contentGoals: ['sell_products', 'authority', 'relationship', 'engagement'],
    }, dir);
    const { group } = await saveProjectOfferGroup('intencao-pilares', { name: 'Produtos de venda' }, dir);
    await saveProjectOffer('intencao-pilares', { name: 'Marmita com tampa', type: 'offer', groupId: group.id }, dir);
    await saveProjectOffer('intencao-pilares', { name: 'Copo para delivery', type: 'offer', groupId: group.id }, dir);
    await saveProjectPillar('intencao-pilares', { name: 'Ensina', role: 'ensina', weight: 1 }, dir);
    await saveProjectPillar('intencao-pilares', { name: 'Prova', role: 'prova', weight: 1 }, dir);
    await saveProjectPillar('intencao-pilares', { name: 'Posiciona', role: 'posiciona', weight: 1 }, dir);
    await saveProjectPillar('intencao-pilares', { name: 'Convida', role: 'convida', weight: 1 }, dir);

    const plan = await previewContentSchedulePlan('intencao-pilares', {
      days: 12,
      startDate: '2026-08-17',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      groupIds: [group.id],
      offersOnly: false,
    }, dir);

    const topics = plan.dayPlans.flatMap((day) => day.regular).map((slot) => slot.topic);
    const offers = topics.filter((topic) => topic.source === 'offer');
    assert.ok(offers.length > 0, 'selected group should keep producing real offers');
    assert.ok(offers.every((topic) => topic.pillar?.role === 'convida'), 'sales offers must stay in the Convida pillar');
    assert.ok(topics.some((topic) => topic.goalKey === 'authority' && topic.pillar?.role === 'ensina'));
    assert.ok(topics.some((topic) => topic.goalKey === 'relationship' && topic.pillar?.role === 'posiciona'));
    assert.ok(topics.some((topic) => topic.goalKey === 'engagement' && topic.pillar?.role === 'posiciona'));
  });
});

test('previewContentSchedulePlan summarizes regular slots and adds commemorative extras without consuming the daily quota', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'preview-agenda', name: 'Casa de Embalagem' }, dir);
    await updateProjectBrandInput('preview-agenda', {
      brandName: 'Casa de Embalagem',
      segment: 'Casa de embalagem',
      productsOrServices: 'embalagens, descartáveis e produtos de limpeza',
      contentGoals: ['sell_products', 'authority', 'relationship'],
    }, dir);
    const { group: limpeza } = await saveProjectOfferGroup('preview-agenda', { name: 'Limpeza' }, dir);
    await saveProjectOffer('preview-agenda', { name: 'Pano Microfibra 30x30', price: '3,5', groupId: limpeza.id }, dir);
    await saveProjectOffer('preview-agenda', { name: 'Detergente para Máquina', price: '46,95', groupId: limpeza.id }, dir);
    await saveProjectOffer('preview-agenda', { name: 'Oferta fora do grupo', price: 'R$ 99,00' }, dir);

    const plan = await previewContentSchedulePlan('preview-agenda', {
      days: 3,
      startDate: '2026-09-14',
      formats: [
        { channel: 'instagram_story', postsPerDay: 3, everyDays: 1, startTime: '09:00', intervalMinutes: 240 },
        { channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '12:00', intervalMinutes: 0 },
      ],
      groupIds: [limpeza.id],
    }, dir);

    assert.equal(plan.days, 3);
    assert.equal(plan.dayPlans.length, 3);
    assert.equal(plan.regularCount, 12);
    assert.equal(plan.dayPlans[0].regular.length, 4);
    assert.equal(plan.dayPlans[1].date, '2026-09-15');
    assert.equal(plan.dayPlans[1].regular.length, 4, 'regular quota stays intact on commemorative dates');
    assert.deepEqual(plan.dayPlans[1].extras.map((item) => item.specialDateLabel), ['Dia do Cliente', 'Dia do Cliente']);
    assert.equal(plan.extraCount, 2);
    assert.ok(plan.dayPlans[1].extras.every((item) => item.extra === true && item.source === 'special_date'));
    assert.ok(plan.dayPlans.flatMap((day) => day.regular).some((item) => item.source === 'goal'), 'unchecking offersOnly keeps Raio-X/content-goal subjects mixed in');
    assert.ok(!plan.dayPlans.flatMap((day) => day.regular).some((item) => item.offerName === 'Oferta fora do grupo'));
    assert.match(plan.summary, /12 posts normais/);
    assert.match(plan.summary, /2 extras/);
  });
});

test('previewContentSchedulePlan honors offersOnly for the selected group while still listing commemorative extras outside the quota', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'preview-so-grupo', name: 'Preview Só Grupo' }, dir);
    await updateProjectBrandInput('preview-so-grupo', { brandName: 'Preview Só Grupo', segment: 'loja', contentGoals: ['authority'] }, dir);
    const { group } = await saveProjectOfferGroup('preview-so-grupo', { name: 'Promoções' }, dir);
    await saveProjectOffer('preview-so-grupo', { name: 'Combo Promo', price: '29,9', groupId: group.id }, dir);

    const plan = await previewContentSchedulePlan('preview-so-grupo', {
      days: 2,
      startDate: '2026-09-15',
      formats: [{ channel: 'instagram_story', postsPerDay: 2, everyDays: 1, startTime: '09:00', intervalMinutes: 240 }],
      groupIds: [group.id],
      offersOnly: true,
    }, dir);

    assert.equal(plan.regularCount, 4);
    assert.ok(plan.dayPlans.flatMap((day) => day.regular).every((item) => item.source === 'offer' && item.offerName === 'Combo Promo'));
    assert.deepEqual(plan.dayPlans[0].extras.map((item) => item.label), ['Extra — Dia do Cliente']);
    assert.equal(plan.dayPlans[0].extras[0].extra, true);
    assert.equal(plan.dayPlans[0].regular.length, 2);
  });
});

test('generateContentSchedulePlan applies operator edits from the approved preview plan to the generated card', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'plano-editado', name: 'Plano Editado' }, dir);
    await saveProjectOffer('plano-editado', { name: 'Espeto para Churrasco', price: '6,2' }, dir);

    const batch = await generateContentSchedulePlan('plano-editado', {
      days: 1,
      startDate: '2026-08-14',
      formats: [{ channel: 'instagram_story', postsPerDay: 1, everyDays: 1, startTime: '09:00', intervalMinutes: 0 }],
      approvedPlan: {
        dayPlans: [{
          regular: [{
            id: '2026-08-14-instagram_story-01',
            label: 'Venda — Kit churrasco editado',
            reason: 'Focar em comércio que vende espetinho no fim de semana.',
          }],
        }],
      },
    }, dir);

    assert.equal(batch.items[0].contentTopic.planEdited, true);
    assert.equal(batch.items[0].contentTopic.planLabel, 'Venda — Kit churrasco editado');
    assert.match(batch.items[0].contentTopic.objective, /Kit churrasco editado/);
    assert.match(batch.items[0].image.prompt, /Plano aprovado pelo operador: Venda — Kit churrasco editado/);
    assert.match(batch.items[0].image.prompt, /Focar em comércio que vende espetinho/);
  });
});

test('an offer restricted to specific weekdays only competes for a slot on those days', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'rodizio-dias', name: 'Boss Pizzaria' }, dir);
    await saveProjectOffer('rodizio-dias', {
      name: 'Rodízio Seg-Sex',
      price: 'R$ 49,90',
      daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
    }, dir);
    await saveProjectOffer('rodizio-dias', {
      name: 'Rodízio Fim de Semana',
      price: 'R$ 69,90',
      daysOfWeek: ['sat', 'sun'],
    }, dir);

    // 2026-08-03 is a Monday — 7 days covers a full week (Mon..Sun).
    const batch = await generateContentBatch('rodizio-dias', {
      days: 7,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
    }, dir);

    const byDate = new Map(batch.items.map((item) => [item.scheduledDate, item.contentTopic.offerName]));
    assert.equal(byDate.get('2026-08-03'), 'Rodízio Seg-Sex'); // mon
    assert.equal(byDate.get('2026-08-04'), 'Rodízio Seg-Sex'); // tue
    assert.equal(byDate.get('2026-08-05'), 'Rodízio Seg-Sex'); // wed
    assert.equal(byDate.get('2026-08-06'), 'Rodízio Seg-Sex'); // thu
    assert.equal(byDate.get('2026-08-07'), 'Rodízio Seg-Sex'); // fri
    assert.equal(byDate.get('2026-08-08'), 'Rodízio Fim de Semana'); // sat
    assert.equal(byDate.get('2026-08-09'), 'Rodízio Fim de Semana'); // sun
  });
});

test('an offer with no daysOfWeek set stays eligible every day, unchanged from before the feature existed', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sem-restricao-dia', name: 'Sem Restricao' }, dir);
    await saveProjectOffer('sem-restricao-dia', { name: 'Produto Sempre Ativo', price: 'R$10' }, dir);

    const batch = await generateContentBatch('sem-restricao-dia', {
      days: 7,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
    }, dir);

    assert.ok(batch.items.every((item) => item.contentTopic.offerName === 'Produto Sempre Ativo'));
  });
});

test('day-of-week offer restriction is also respected by generateContentSchedulePlan (the pillar-aware path)', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'rodizio-dias-plano', name: 'Boss Pizzaria' }, dir);
    await saveProjectOffer('rodizio-dias-plano', {
      name: 'Rodízio Seg-Sex',
      type: 'rodizio',
      price: 'R$ 49,90',
      daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
    }, dir);
    await saveProjectOffer('rodizio-dias-plano', {
      name: 'Rodízio Fim de Semana',
      type: 'rodizio',
      price: 'R$ 69,90',
      daysOfWeek: ['sat', 'sun'],
    }, dir);

    const batch = await generateContentSchedulePlan('rodizio-dias-plano', {
      days: 7,
      startDate: '2026-08-03',
      formats: [{ channel: 'instagram_feed', postsPerDay: 1, everyDays: 1, startTime: '12:00', intervalMinutes: 0 }],
    }, dir);

    const byDate = new Map(batch.items.map((item) => [item.scheduledDate, item.contentTopic.offerName]));
    assert.equal(byDate.get('2026-08-06'), 'Rodízio Seg-Sex'); // thu
    assert.equal(byDate.get('2026-08-08'), 'Rodízio Fim de Semana'); // sat
    assert.equal(byDate.get('2026-08-09'), 'Rodízio Fim de Semana'); // sun
  });
});

test('saveProjectOffer normalizes daysOfWeek — keeps valid weekday codes, drops invalid ones, dedupes', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'dias-validacao', name: 'Dias Validacao' }, dir);
    const { offer } = await saveProjectOffer('dias-validacao', {
      name: 'Produto X',
      daysOfWeek: ['mon', 'MON', 'sat', 'not-a-day', 'sun', ''],
    }, dir);
    assert.deepEqual(offer.daysOfWeek, ['mon', 'sat', 'sun']);
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
    await updateProjectBrandInput('cta-pilar', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'vertical', dir);

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
    await updateProjectBrandInput('copy-agent-batch', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'feed', dir);
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
    await updateProjectBrandInput('imagem-sem-url', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'feed', dir);
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
    await updateProjectBrandInput('compartilhar-criativo', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'vertical', dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'feed', dir);

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
    await updateProjectBrandInput('reels-auto-animar', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'vertical', dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'feed', dir);

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
    await updateProjectBrandInput('reels-auto-falha', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'vertical', dir);

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

test('regenerating a card picks up a real photo attached to the offer AFTER the card was first generated', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'foto-anexada-depois',
      name: 'Rei do Xiaomi Teste',
      handle: '@reidoxiaomiteste',
      approvalEmail: 'aprovacao@example.com',
    }, dir);

    const { offer } = await saveProjectOffer('foto-anexada-depois', {
      name: 'Redmi A7 Pro 4/64GB',
      type: 'offer',
      price: 'R$ 749',
      active: true,
    }, dir, new Date('2026-08-02T10:00:00.000Z'));
    await updateProjectBrandInput('foto-anexada-depois', { segmentGroup: 'Varejo', segmentCategory: 'Eletronicos' }, dir);
    await registerCreativeTemplate('group:varejo/category:eletronicos', 'offer', 'feed', dir);

    // First generation happens with no photo attached yet — matches the
    // real sequence: card generated, sits "aguardando aprovação", THEN the
    // operator goes back and attaches the real product photo to the offer.
    const batch = await generateContentBatch('foto-anexada-depois', {
      days: 1,
      startDate: '2026-08-02',
      channel: 'instagram_feed',
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'foto-anexada-depois');
    await enrichBatchItemsWithRealImages(batch, project, 'foto-anexada-depois', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/generico.png', mimeType: 'image/png' }),
    });
    const beforePhoto = await listProjectContent('foto-anexada-depois', dir);
    assert.doesNotMatch(beforePhoto[0].image.prompt, /Foto selecionada:/);

    const dataUrl = `data:image/png;base64,${Buffer.from('redmi-a7-pro').toString('base64')}`;
    const uploaded = await saveProjectAsset('foto-anexada-depois', {
      kind: 'reference',
      filename: 'redmi-a7-pro.jpg',
      dataUrl,
      role: 'product_photo',
      usageRoles: ['product_photo'],
      referenceCategory: 'real_product',
      weight: 'high',
      instruction: 'Foto real do Redmi A7 Pro, autorizada pela marca.',
    }, dir, new Date('2026-08-02T11:00:00.000Z'));
    await saveProjectOffer('foto-anexada-depois', {
      id: offer.id,
      name: 'Redmi A7 Pro 4/64GB',
      type: 'offer',
      price: 'R$ 749',
      active: true,
      photoReferenceIds: [uploaded.metadata.id],
    }, dir, new Date('2026-08-02T11:05:00.000Z'));

    const generatorCalls = [];
    await regenerateContentDay('foto-anexada-depois', beforePhoto[0].contentId, {
      regenerate: 'creative',
      batchId: beforePhoto[0].batchId,
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/redmi-real.png', mimeType: 'image/png' };
      },
    }, dir);

    const prompt = generatorCalls[0].content.image.prompt;
    assert.match(prompt, /Foto selecionada: assets\/references\/redmi-a7-pro\.jpg/);
    assert.match(prompt, /O produto principal é o item real da foto anexada: Redmi A7 Pro 4\/64GB/);
    assert.deepEqual(generatorCalls[0].content.contentTopic.photoReferenceIds, [uploaded.metadata.id]);
  });
});

test('a "Pedido de alteração" note asks the image generator for a targeted edit; regenerating with no note does not', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'pedido-alteracao',
      name: 'Casa de Embalagem Teste',
      handle: '@casadeembalagemteste',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    await updateProjectBrandInput('pedido-alteracao', { segmentGroup: 'Embalagens', segmentCategory: 'Casa de Embalagem' }, dir);
    await registerCreativeTemplate('group:embalagens/category:casa-de-embalagem', 'offer', 'feed', dir);
    const batch = await generateContentBatch('pedido-alteracao', {
      days: 1,
      startDate: '2026-08-02',
      channel: 'instagram_feed',
    }, dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'pedido-alteracao');
    await enrichBatchItemsWithRealImages(batch, project, 'pedido-alteracao', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/original.png', mimeType: 'image/png' }),
    });
    const [before] = await listProjectContent('pedido-alteracao', dir);

    const withNoteCalls = [];
    await regenerateContentDay('pedido-alteracao', before.contentId, {
      regenerate: 'creative',
      batchId: before.batchId,
      note: 'aumentar o preço',
      imageGenerator: async (payload) => {
        withNoteCalls.push(payload);
        return { url: 'https://cdn.example.com/edited.png', mimeType: 'image/png' };
      },
    }, dir);
    assert.equal(withNoteCalls[0].targetedEdit, true);

    const [afterFirstEdit] = await listProjectContent('pedido-alteracao', dir);
    const withoutNoteCalls = [];
    await regenerateContentDay('pedido-alteracao', afterFirstEdit.contentId, {
      regenerate: 'creative',
      batchId: afterFirstEdit.batchId,
      imageGenerator: async (payload) => {
        withoutNoteCalls.push(payload);
        return { url: 'https://cdn.example.com/fresh-take.png', mimeType: 'image/png' };
      },
    }, dir);
    assert.equal(withoutNoteCalls[0].targetedEdit, false);
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
    await updateProjectBrandInput('desvincular-criativo', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'vertical', dir);

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
    await updateProjectBrandInput('regenerar-grupo', { segmentGroup: 'Servicos', segmentCategory: 'Geral' }, dir);
    await registerCreativeTemplate('group:servicos/category:geral', 'offer', 'vertical', dir);

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

test('runDuePublishSweep only publishes the earliest overdue (date, time) slot per call, instead of bursting every backlogged slot out at once', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'publish-backlog',
      name: 'Publish Backlog',
      handle: '@publishbacklog',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    // Two days worth of content, both left unpublished long enough that
    // both slots are now overdue by the time the scheduler finally runs
    // (e.g. the server was down/restarted) — this is the exact backlog
    // shape confirmed live on a real client whose Stories all went out
    // within the same second instead of spread across separate days.
    const batch = await generateContentBatch('publish-backlog', { days: 2, startDate: '2026-07-20', postTime: '09:00' }, dir);
    await approveContent('publish-backlog', batch.items[0].contentId, dir, batch.batchId);
    await approveContent('publish-backlog', batch.items[1].contentId, dir, batch.batchId);

    const publisherCalls = [];
    const firstSweep = await runDuePublishSweep(dir, {
      now: new Date('2026-07-25T12:00:00.000Z'),
      metaPublisher: async (payload) => { publisherCalls.push(payload.content.contentId); return { mediaId: `media-${publisherCalls.length}` }; },
    });

    assert.deepEqual(firstSweep.published, [batch.items[0].contentId]);
    assert.deepEqual(publisherCalls, [batch.items[0].contentId]);
    const day1AfterFirst = JSON.parse(await readFile(batch.items[0].filePath, 'utf-8'));
    const day2AfterFirst = JSON.parse(await readFile(batch.items[1].filePath, 'utf-8'));
    assert.equal(day1AfterFirst.publish.realPublished, true);
    assert.notEqual(day2AfterFirst.publish.realPublished, true);

    // Next sweep cycle picks up the next backlogged slot — still one at a
    // time, never dumping the whole remaining backlog in a single call.
    const secondSweep = await runDuePublishSweep(dir, {
      now: new Date('2026-07-25T12:03:00.000Z'),
      metaPublisher: async (payload) => { publisherCalls.push(payload.content.contentId); return { mediaId: `media-${publisherCalls.length}` }; },
    });
    assert.deepEqual(secondSweep.published, [batch.items[1].contentId]);
    const day2AfterSecond = JSON.parse(await readFile(batch.items[1].filePath, 'utf-8'));
    assert.equal(day2AfterSecond.publish.realPublished, true);
  });
});

test('runDuePublishSweep with a channels filter only sees content on those channels, leaving other due items on other channels completely untouched', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'publish-channel-filter',
      name: 'Publish Channel Filter',
      handle: '@publishchannelfilter',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    // Two items, same project, same due slot, different channels — the
    // exact shape a whatsapp-only scheduler must never let an Instagram
    // item block or falsely fail on.
    const igBatch = await generateContentBatch('publish-channel-filter', {
      days: 1, startDate: '2026-07-20', postTime: '09:00', channel: 'instagram_story',
    }, dir);
    const waBatch = await generateContentBatch('publish-channel-filter', {
      days: 1, startDate: '2026-07-20', postTime: '09:00', channel: 'whatsapp_status',
    }, dir);
    await approveContent('publish-channel-filter', igBatch.items[0].contentId, dir, igBatch.batchId);
    await approveContent('publish-channel-filter', waBatch.items[0].contentId, dir, waBatch.batchId);

    const publisherCalls = [];
    const result = await runDuePublishSweep(dir, {
      now: new Date('2026-07-25T12:00:00.000Z'),
      channels: new Set(['whatsapp_status']),
      metaPublisher: async (payload) => {
        if (payload.content.channel !== 'whatsapp_status') throw new Error('should never be called for a non-whatsapp channel');
        publisherCalls.push(payload.content.contentId);
        return { mediaId: 'wa-media-1' };
      },
    });

    assert.deepEqual(result.published, [waBatch.items[0].contentId]);
    assert.deepEqual(publisherCalls, [waBatch.items[0].contentId]);

    const waAfter = JSON.parse(await readFile(waBatch.items[0].filePath, 'utf-8'));
    assert.equal(waAfter.publish.realPublished, true);

    const igAfter = JSON.parse(await readFile(igBatch.items[0].filePath, 'utf-8'));
    assert.notEqual(igAfter.publish?.realPublished, true);
    assert.ok(!igAfter.publish?.error);
  });
});

test('approveContent calls queueSync with an upsert for the approved item', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sync-approve', name: 'Sync Approve', handle: '@syncapprove', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('sync-approve', { days: 1, startDate: '2026-08-10', postTime: '18:00' }, dir);

    const calls = [];
    await approveContent('sync-approve', batch.items[0].contentId, dir, batch.batchId, {
      queueSync: async (action, payload) => calls.push({ action, payload }),
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'upsert');
    assert.equal(calls[0].payload.projectId, 'sync-approve');
    assert.equal(calls[0].payload.contentId, batch.items[0].contentId);
    assert.equal(calls[0].payload.data.scheduledDate, '2026-08-10');
  });
});

test('approveContent works with no queueSync provided (back-compat)', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sync-none', name: 'Sync None', handle: '@syncnone', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('sync-none', { days: 1, startDate: '2026-08-10', postTime: '18:00' }, dir);
    const content = await approveContent('sync-none', batch.items[0].contentId, dir, batch.batchId);
    assert.equal(content.status, 'aprovado');
  });
});

test('approveContent still approves the item when mediaUploader throws, recording the error instead of failing the approve', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sync-upload-fail', name: 'Sync Upload Fail', handle: '@syncuploadfail', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('sync-upload-fail', { days: 1, startDate: '2026-08-10', postTime: '18:00' }, dir);

    const content = await approveContent('sync-upload-fail', batch.items[0].contentId, dir, batch.batchId, {
      mediaUploader: async () => { throw new Error('imgBB is down'); },
    });

    assert.equal(content.status, 'aprovado');
    assert.equal(content.publish.mediaUrl, null);
    assert.equal(content.publish.mediaUploadError, 'imgBB is down');
  });
});

test('retryStuckMediaUploads re-uploads a mediaUploadError item and clears the error on success', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'retry-stuck-ok', name: 'Retry Stuck Ok', handle: '@retrystuckok', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('retry-stuck-ok', { days: 1, startDate: '2099-01-01', postTime: '18:00' }, dir);
    await approveContent('retry-stuck-ok', batch.items[0].contentId, dir, batch.batchId, {
      mediaUploader: async () => { throw new Error('imgBB is down'); },
    });

    const result = await retryStuckMediaUploads(dir, {
      mediaUploader: async () => 'https://i.ibb.co/fresh.png',
    });

    assert.deepEqual(result, { retried: [batch.items[0].contentId], failed: [] });
    const content = await listProjectContent('retry-stuck-ok', dir);
    assert.equal(content[0].publish.mediaUrl, 'https://i.ibb.co/fresh.png');
    assert.equal(content[0].publish.mediaUploadError, null);
  });
});

test('retryStuckMediaUploads keeps the item stuck and records the new error when the retry itself fails', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'retry-stuck-fail', name: 'Retry Stuck Fail', handle: '@retrystuckfail', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('retry-stuck-fail', { days: 1, startDate: '2099-01-01', postTime: '18:00' }, dir);
    await approveContent('retry-stuck-fail', batch.items[0].contentId, dir, batch.batchId, {
      mediaUploader: async () => { throw new Error('imgBB is down'); },
    });

    const result = await retryStuckMediaUploads(dir, {
      mediaUploader: async () => { throw new Error('still down'); },
    });

    assert.equal(result.retried.length, 0);
    assert.equal(result.failed.length, 1);
    const content = await listProjectContent('retry-stuck-fail', dir);
    assert.equal(content[0].publish.mediaUrl, null);
    assert.equal(content[0].publish.mediaUploadError, 'still down');
  });
});

test('retryStuckMediaUploads leaves a healthy approved item untouched, and is a no-op with no mediaUploader', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'retry-stuck-healthy', name: 'Retry Stuck Healthy', handle: '@retrystuckhealthy', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('retry-stuck-healthy', { days: 1, startDate: '2099-01-01', postTime: '18:00' }, dir);
    await approveContent('retry-stuck-healthy', batch.items[0].contentId, dir, batch.batchId, {
      mediaUploader: async () => 'https://i.ibb.co/already-fine.png',
    });

    assert.deepEqual(await retryStuckMediaUploads(dir), { retried: [], failed: [] });

    const called = [];
    const result = await retryStuckMediaUploads(dir, { mediaUploader: async () => called.push(1) });
    assert.deepEqual(result, { retried: [], failed: [] });
    assert.equal(called.length, 0);
  });
});

test('updateProjectSettings edits name, handle, approvalEmail and mode without touching projectId', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'settings-edit',
      name: 'Original Name',
      handle: '@original',
      approvalEmail: 'old@example.com',
      mode: 'manual',
    }, dir);

    const project = await updateProjectSettings('settings-edit', {
      name: 'New Name',
      handle: 'novo',
      approvalEmail: 'new@example.com',
      mode: 'semi_automatic',
    }, dir);

    assert.equal(project.projectId, 'settings-edit');
    assert.equal(project.name, 'New Name');
    assert.equal(project.instagram.handle, '@novo');
    assert.equal(project.approvalEmail, 'new@example.com');
    assert.equal(project.mode, 'semi_automatic');
  });
});

test('updateProjectSettings only touches the fields given, and rejects an unsupported mode', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'settings-partial',
      name: 'Kept Name',
      handle: '@kept',
      approvalEmail: 'kept@example.com',
    }, dir);

    const project = await updateProjectSettings('settings-partial', { name: 'Renamed' }, dir);
    assert.equal(project.name, 'Renamed');
    assert.equal(project.instagram.handle, '@kept');
    assert.equal(project.approvalEmail, 'kept@example.com');

    await assert.rejects(
      () => updateProjectSettings('settings-partial', { mode: 'not-a-real-mode' }, dir),
      /Unsupported project mode/,
    );
  });
});

test('regenerateContentDay calls queueSync with a remove when leaving aprovado status', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sync-regen', name: 'Sync Regen', handle: '@syncregen', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('sync-regen', { days: 1, startDate: '2026-08-10', postTime: '18:00' }, dir);
    await approveContent('sync-regen', batch.items[0].contentId, dir, batch.batchId);

    const calls = [];
    await regenerateContentDay('sync-regen', batch.items[0].contentId, {
      batchId: batch.batchId,
      queueSync: async (action, payload) => calls.push({ action, payload }),
    }, dir);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'remove');
    assert.equal(calls[0].payload.contentId, batch.items[0].contentId);
  });
});

test('deleteProjectContent calls queueSync with a remove', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'sync-delete', name: 'Sync Delete', handle: '@syncdelete', approvalEmail: 'a@example.com' }, dir);
    const batch = await generateContentBatch('sync-delete', { days: 1, startDate: '2026-08-10', postTime: '18:00' }, dir);
    await approveContent('sync-delete', batch.items[0].contentId, dir, batch.batchId);

    const calls = [];
    await deleteProjectContent('sync-delete', batch.items[0].contentId, dir, batch.batchId, undefined, {
      queueSync: async (action, payload) => calls.push({ action, payload }),
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'remove');
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

test('publishSingleContent is idempotent: retrying an already-published item never calls metaPublisher again', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'publish-retry',
      name: 'Publish Retry',
      handle: '@publishretry',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('publish-retry', { days: 1, startDate: '2099-01-01', postTime: '09:00' }, dir);
    await approveContent('publish-retry', batch.items[0].contentId, dir, batch.batchId);

    const first = await publishSingleContent('publish-retry', batch.items[0].contentId, dir, {
      metaPublisher: async () => ({ mediaId: 'media-3', permalink: 'https://instagram.com/p/xyz' }),
    }, batch.batchId);
    assert.equal(first.publish.realPublished, true);

    // Simulates the operator retrying "Publicar agora" after the real Meta
    // publish succeeded but something downstream (e.g. the gaveta push)
    // failed and surfaced as an error — metaPublisher must not be called a
    // second time, or the post would go live twice.
    const retry = await publishSingleContent('publish-retry', batch.items[0].contentId, dir, {
      metaPublisher: async () => { assert.fail('metaPublisher must not be called for an already-published item'); },
    }, batch.batchId);

    assert.equal(retry.publish.realPublished, true);
    assert.equal(retry.publish.metaMediaId, 'media-3');
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

test('listSystemAlerts flags an approved item stuck with no mediaUrl after a failed upload, even though publish.error is null', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({
      projectId: 'falha-upload',
      name: 'Falha Upload',
      handle: '@falhaupload',
      approvalEmail: 'aprovacao@example.com',
    }, dir);
    const batch = await generateContentBatch('falha-upload', { days: 1, startDate: '2026-07-20', postTime: '09:00' }, dir);
    // Mirrors the real bug: the approve-time mediaUploader throws (CDN not
    // propagated yet), so publish.error stays null — only mediaUploadError
    // is set — and this alert must still catch it.
    await approveContent('falha-upload', batch.items[0].contentId, dir, batch.batchId, {
      mediaUploader: async () => { throw new Error('Imagem hospedada em https://i.ibb.co/x/y.png não respondeu como imagem'); },
    });

    const alerts = await listSystemAlerts(dir);
    const alert = alerts.find((a) => a.type === 'media_upload_failed' && a.projectId === 'falha-upload');
    assert.ok(alert);
    assert.match(alert.message, /não respondeu como imagem/);
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

test('isProspect defaults to false, forces manual mode when true, carries the real profile facts as prospectSource, and is echoed by loadProject/toProjectSummary/listCentralProjects', async () => {
  await withTempProject(async (dir) => {
    const client = await createCentralProject({
      projectId: 'boss-pizzaria',
      name: 'Boss Pizzaria',
      mode: 'automatic',
    }, dir);
    assert.equal(client.isProspect, false);
    assert.equal(client.prospectSource, null);
    assert.equal(client.mode, 'automatic');

    const prospect = await createCentralProject({
      projectId: 'emporio-rei-da-mussarela',
      name: 'Empório Rei da Mussarela',
      isProspect: true,
      mode: 'automatic', // must be overridden — a prospect never auto-publishes
      prospectSource: {
        handle: '@emporioreidamussarela',
        bio: 'Serviço de entrega de comida. Loja de frios e Fatiados.',
        realFollowers: 4388,
        realPosts: 20,
        realFollowing: 35,
      },
    }, dir);
    assert.equal(prospect.isProspect, true);
    assert.equal(prospect.mode, 'manual');
    assert.deepEqual(prospect.prospectSource, {
      handle: '@emporioreidamussarela',
      bio: 'Serviço de entrega de comida. Loja de frios e Fatiados.',
      realFollowers: 4388,
      realPosts: 20,
      realFollowing: 35,
    });

    const projects = await listCentralProjects(dir);
    const clientSummary = projects.find((p) => p.projectId === 'boss-pizzaria');
    const prospectSummary = projects.find((p) => p.projectId === 'emporio-rei-da-mussarela');
    assert.equal(clientSummary.isProspect, false);
    assert.equal(prospectSummary.isProspect, true);
    assert.equal(prospectSummary.prospectSource.realFollowers, 4388);
  });
});

test('a prospect with no extracted counts (vision read failed) stays null through a second load/save cycle instead of flipping to 0 — Number(null) is 0, not NaN', async () => {
  await withTempProject(async (dir) => {
    // Same shape POST /api/prospects writes when analyzeProspectScreenshotWithAi
    // returns null: isProspect true, prospectSource explicitly null.
    await createCentralProject({
      projectId: 'prospect-sem-leitura',
      name: 'Nova prospecção 123',
      isProspect: true,
      prospectSource: null,
    }, dir);

    // Anything that round-trips through loadProject + writeJson (the real
    // Dashboard flow calls saveBrandInput right after upload, before
    // generating the mockup) re-normalizes prospectSource a second time.
    await updateProjectBrandInput('prospect-sem-leitura', { segment: 'delivery de frios' }, dir);

    const projects = await listCentralProjects(dir);
    const summary = projects.find((p) => p.projectId === 'prospect-sem-leitura');
    assert.deepEqual(summary.prospectSource, { handle: null, bio: null, realFollowers: null, realPosts: null, realFollowing: null });
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

test('listCommemorativeDates computes national holidays and commercial dates correctly for a real year (2026)', () => {
  const dates = listCommemorativeDates('2026-01-01', '2026-12-31');
  const byLabel = new Map(dates.map((entry) => [entry.label, entry]));

  // Fixed-date national holidays.
  assert.equal(byLabel.get('Confraternização Universal')?.date, '2026-01-01');
  assert.equal(byLabel.get('Independência do Brasil')?.date, '2026-09-07');
  assert.equal(byLabel.get('Natal')?.date, '2026-12-25');
  assert.equal(byLabel.get('Confraternização Universal')?.kind, 'holiday');

  // Easter-derived movable holidays — 2026's real Easter Sunday is April 5.
  assert.equal(byLabel.get('Páscoa')?.date, '2026-04-05');
  assert.equal(byLabel.get('Carnaval')?.date, '2026-02-17');
  assert.equal(byLabel.get('Sexta-feira Santa')?.date, '2026-04-03');
  assert.equal(byLabel.get('Corpus Christi')?.date, '2026-06-04');

  // Commercial dates computed by weekday rule.
  assert.equal(byLabel.get('Dia das Mães')?.date, '2026-05-10'); // 2nd Sunday of May
  assert.equal(byLabel.get('Dia dos Pais')?.date, '2026-08-09'); // 2nd Sunday of August
  assert.equal(byLabel.get('Black Friday')?.date, '2026-11-27'); // last Friday of November
  assert.equal(byLabel.get('Dia das Mães')?.kind, 'commercial');

  // Filtering by range excludes anything outside it.
  const may = listCommemorativeDates('2026-05-01', '2026-05-31');
  assert.deepEqual(may.map((entry) => entry.label), ['Dia do Trabalho', 'Dia das Mães']);

  // Results are sorted ascending by date.
  const sorted = [...dates].sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(dates.map((d) => d.date), sorted.map((d) => d.date));
});

test('generateSpecialDateContent creates a one-off themed post for a commemorative date, independent of the offer/goal rotation', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'data-comemorativa', name: 'Boss Pizzaria' }, dir);
    await updateProjectBrandInput('data-comemorativa', { brandName: 'Boss Pizzaria', segment: 'pizzaria', contentGoals: ['authority'] }, dir);
    await saveProjectOffer('data-comemorativa', { name: 'Rodízio', price: 'R$49,90' }, dir);

    // A normal scheduled batch first, to give the rotation cursor a real,
    // non-zero position — generating a special date afterward must not
    // read from or advance that cursor.
    const before = await generateContentBatch('data-comemorativa', {
      days: 3,
      startDate: '2026-08-03',
      channel: 'instagram_feed',
    }, dir);
    const projectBefore = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'data-comemorativa');
    const cursorBefore = projectBefore.contentStrategy?.nextScheduleTopicIndex;

    const batch = await generateSpecialDateContent('data-comemorativa', {
      date: '2026-05-10',
      label: 'Dia das Mães',
      channel: 'instagram_story',
    }, dir);

    assert.equal(batch.items.length, 1);
    const item = batch.items[0];
    assert.equal(item.scheduledDate, '2026-05-10');
    assert.equal(item.channel, 'instagram_story');
    assert.equal(item.contentTopic.source, 'special_date');
    assert.equal(item.contentTopic.specialDateLabel, 'Dia das Mães');
    assert.match(item.contentTopic.objective, /Dia das Mães/);
    assert.match(item.title, /Dia das Mães/);
    assert.equal(item.status, 'draft_generated');

    const projectAfter = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'data-comemorativa');
    assert.equal(projectAfter.contentStrategy?.nextScheduleTopicIndex, cursorBefore, 'the regular rotation cursor must be untouched');

    // The normal batch's own items are still exactly what they were before —
    // nothing about the special-date call altered them.
    const allContent = await listProjectContent('data-comemorativa', dir);
    assert.equal(allContent.length, before.items.length + 1);
  });
});

test('an institutional special-date post (no offer linked) gets a warm, celebratory hook title about the occasion — not the raw project name, and not a commercial/pitch-style hook either', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'data-sem-oferta', name: 'CASA DE EMBALAGEM' }, dir);
    await updateProjectBrandInput('data-sem-oferta', { segmentGroup: 'Embalagens', segmentCategory: 'Casa de Embalagem' }, dir);
    await registerCreativeTemplate('group:embalagens/category:casa-de-embalagem', 'special_date', 'vertical', dir);
    const batch = await generateSpecialDateContent('data-sem-oferta', {
      date: '2026-08-09',
      label: 'Dia dos Pais',
      channel: 'instagram_story',
    }, dir);
    assert.equal(batch.items[0].contentTopic.offerId, undefined);

    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'data-sem-oferta');
    const generatorCalls = [];
    await enrichBatchItemsWithRealImages(batch, project, 'data-sem-oferta', {
      imageGenerator: async (payload) => {
        generatorCalls.push(payload);
        return { url: 'https://cdn.example.com/dia-dos-pais.png', mimeType: 'image/png' };
      },
    });

    assert.equal(generatorCalls.length, 1);
    const prompt = generatorCalls[0].content.image.prompt;
    assert.doesNotMatch(prompt, /Título exato: CASA DE EMBALAGEM/i, 'must not force the raw project name as the whole headline — that was the bug (no real message, just the brand name)');
    assert.match(prompt, /tom caloroso e comemorativo sobre "Dia dos Pais"/i, 'must build a warm, occasion-themed hook');
    assert.match(prompt, /não uma oferta nem uma peça comercial/i, 'must explicitly steer away from a sales/pitch framing — a real client flagged an occasion post that read like a business pitch');
    // The pillar/authority hook wording (tuned for a punchy business hook,
    // not a celebration) must stay scoped to goal topics only.
    assert.doesNotMatch(prompt, /gancho ou pergunta específica sobre "Dia dos Pais"/i);
    // The title wording alone isn't enough — the brand's own approved Raio-X
    // visualIdentity text can independently describe a business-dashboard
    // visual style (confirmed on a real client), which the model then
    // applies to the whole composition regardless of the title. Must be
    // overridden explicitly for this occasion post too.
    assert.match(prompt, /mesmo que a direção acima descreva um estilo de dashboard, gráfico, mockup de tela\/software/i, 'must override the brand\'s standing business-visual identity for this specific occasion piece');
  });
});

test('generateSpecialDateContent can tie the post to a real registered offer instead of running purely institutional', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'data-com-oferta', name: 'Boss Pizzaria' }, dir);
    const { offer } = await saveProjectOffer('data-com-oferta', { name: 'Combo Namorados', price: 'R$79,90' }, dir);

    const batch = await generateSpecialDateContent('data-com-oferta', {
      date: '2026-06-12',
      label: 'Dia dos Namorados',
      channel: 'instagram_feed',
      offerId: offer.id,
    }, dir);

    const item = batch.items[0];
    assert.equal(item.contentTopic.source, 'special_date');
    assert.equal(item.contentTopic.offerName, 'Combo Namorados');
    assert.equal(item.contentTopic.price, 'R$79,90');
    assert.match(item.contentTopic.objective, /Dia dos Namorados/);
  });
});

test('generateSpecialDateContent rejects an invalid date or a missing label instead of writing a broken card', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'data-invalida', name: 'Boss Pizzaria' }, dir);

    await assert.rejects(
      () => generateSpecialDateContent('data-invalida', { date: 'não é uma data', label: 'Black Friday' }, dir),
      /Data inválida/,
    );
    await assert.rejects(
      () => generateSpecialDateContent('data-invalida', { date: '2026-11-27', label: '' }, dir),
      /Informe o nome da data comemorativa/,
    );
  });
});

test('generateSpecialDateContent shares one creative across same-shape channels when several formats are requested for the same date, instead of each format paying for its own AI generation', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'data-varios-formatos', name: 'Boss Pizzaria' }, dir);
    await updateProjectBrandInput('data-varios-formatos', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'special_date', 'vertical', dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'special_date', 'feed', dir);

    const batch = await generateSpecialDateContent('data-varios-formatos', {
      date: '2026-08-09',
      label: 'Dia dos Pais',
      channels: ['instagram_story', 'instagram_reels', 'facebook_story', 'instagram_feed', 'facebook_feed'],
    }, dir);

    assert.equal(batch.items.length, 5);
    // All five formats of the same occasion live in one shared batch now
    // (used to be one separate batchId per channel).
    assert.ok(batch.items.every((item) => item.batchId === batch.batchId));

    const story = batch.items.find((item) => item.channel === 'instagram_story');
    const reels = batch.items.find((item) => item.channel === 'instagram_reels');
    const fbStory = batch.items.find((item) => item.channel === 'facebook_story');
    const feed = batch.items.find((item) => item.channel === 'instagram_feed');
    const fbFeed = batch.items.find((item) => item.channel === 'facebook_feed');

    assert.ok(story.creativeGroupKey, 'vertical-shape channels must get a shared group key');
    assert.equal(story.creativeGroupKey, reels.creativeGroupKey);
    assert.equal(story.creativeGroupKey, fbStory.creativeGroupKey);
    assert.ok(feed.creativeGroupKey, 'feed-shape channels must get a shared group key');
    assert.equal(feed.creativeGroupKey, fbFeed.creativeGroupKey);
    assert.notEqual(story.creativeGroupKey, feed.creativeGroupKey);

    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'data-varios-formatos');
    let imageCalls = 0;
    await enrichBatchItemsWithRealImages(batch, project, 'data-varios-formatos', {
      imageGenerator: async () => {
        imageCalls += 1;
        return { url: `https://cdn.example.com/dia-dos-pais-${imageCalls}.png`, mimeType: 'image/png' };
      },
    });

    // One AI generation for the vertical group (Story/Reels/Facebook Story),
    // one for the feed group (Feed/Facebook Feed) — 2 total, not 5.
    assert.equal(imageCalls, 2);

    const content = await listProjectContent('data-varios-formatos', dir);
    const storyAfter = content.find((item) => item.channel === 'instagram_story');
    const reelsAfter = content.find((item) => item.channel === 'instagram_reels');
    const fbStoryAfter = content.find((item) => item.channel === 'facebook_story');
    const feedAfter = content.find((item) => item.channel === 'instagram_feed');
    const fbFeedAfter = content.find((item) => item.channel === 'facebook_feed');

    assert.equal(storyAfter.image.url, reelsAfter.image.url);
    assert.equal(storyAfter.image.url, fbStoryAfter.image.url);
    assert.equal(feedAfter.image.url, fbFeedAfter.image.url);
    assert.notEqual(storyAfter.image.url, feedAfter.image.url);
  });
});

test('generateSpecialDateContent still defaults to a single channel (backward compatible with callers that only ever pass one)', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'data-um-canal', name: 'Boss Pizzaria' }, dir);
    const batch = await generateSpecialDateContent('data-um-canal', {
      date: '2026-08-09',
      label: 'Dia dos Pais',
      channel: 'instagram_story',
    }, dir);
    assert.equal(batch.items.length, 1);
    assert.equal(batch.items[0].channel, 'instagram_story');
  });
});

test('generateAdCreative builds a standalone ad creative — no scheduledDate/approval/publish fields, tied to an offer when one is given', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'anuncio-oferta', name: 'Boss Pizzaria' }, dir);
    const { offer } = await saveProjectOffer('anuncio-oferta', { name: 'Rodízio', price: 'R$49,90', items: 'pizzas salgadas e doces' }, dir);

    const adCreative = await generateAdCreative('anuncio-oferta', { objective: 'whatsapp', offerId: offer.id }, dir);

    assert.equal(adCreative.objective, 'whatsapp');
    assert.equal(adCreative.channel, 'instagram_feed');
    assert.equal(adCreative.offerId, offer.id);
    assert.equal(adCreative.offerName, 'Rodízio');
    assert.equal(adCreative.contentTopic.source, 'ad_creative');
    assert.match(adCreative.contentTopic.objective, /anúncio pago/i);
    assert.match(adCreative.image.prompt, /Rodízio/);
    assert.equal(adCreative.variations.length, 0);
    // Genuinely a different shape from organic content — no scheduling or
    // approval concept applies to an ad creative.
    assert.equal('scheduledDate' in adCreative, false);
    assert.equal('approval' in adCreative, false);
    assert.equal('publish' in adCreative, false);
  });
});

test('generateAdCreative without an offer produces an institutional ad creative instead of failing', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'anuncio-institucional', name: 'Boss Pizzaria' }, dir);

    const adCreative = await generateAdCreative('anuncio-institucional', { objective: 'whatsapp' }, dir);

    assert.equal(adCreative.offerId, null);
    assert.equal(adCreative.contentTopic.source, 'ad_creative');
    assert.match(adCreative.title, /Boss Pizzaria/);
  });
});

test('an institutional ad creative (no offer linked) gets a real hook title based on the ad objective, instead of forcing the raw project name — same problem goal topics and special-date posts already had, now closed for the ad-creative pipeline too', async () => {
  await withTempProject(async (dir) => {
    // The project's own display name deliberately isn't the real brand
    // name, mirroring a real case: "CASA DE EMBALAGEM" is a generic project
    // label, the actual brand is "Hygi Comércio" — forcing project.name as
    // a literal image headline was doubly wrong here, not just repetitive.
    await createCentralProject({ projectId: 'anuncio-institucional-titulo', name: 'CASA DE EMBALAGEM' }, dir);
    await updateProjectBrandInput('anuncio-institucional-titulo', { segmentGroup: 'Embalagens', segmentCategory: 'Casa de Embalagem' }, dir);
    await registerCreativeTemplate('group:embalagens/category:casa-de-embalagem', 'ad_creative', 'feed', dir);
    const adCreative = await generateAdCreative('anuncio-institucional-titulo', { objective: 'engagement' }, dir);
    assert.equal(adCreative.offerId, null);

    let receivedPrompt = null;
    await enrichAdCreativeWithRealImage(adCreative, { name: 'CASA DE EMBALAGEM', mode: 'semi_automatic', rules: { project: [] } }, 'anuncio-institucional-titulo', {
      imageGenerator: async (payload) => {
        receivedPrompt = payload.content.image.prompt;
        return { url: 'https://cdn.example.com/anuncio.png', mimeType: 'image/png' };
      },
    });

    assert.doesNotMatch(receivedPrompt, /Título exato: CASA DE EMBALAGEM/i, 'must not force the raw project name as the whole headline');
    assert.match(receivedPrompt, /gancho ou pergunta específica sobre "Engajamento"/i, 'must build a real hook keyed off the ad\'s real objective label');
  });
});

test('enrichAdCreativeWithRealImage attaches the real image and the 3 angle-based copy variations, and persists them to disk', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'anuncio-enriquecido', name: 'Boss Pizzaria' }, dir);
    await updateProjectBrandInput('anuncio-enriquecido', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'ad_creative', 'feed', dir);
    const adCreative = await generateAdCreative('anuncio-enriquecido', { objective: 'whatsapp' }, dir);

    let receivedPrompt = null;
    await enrichAdCreativeWithRealImage(adCreative, { name: 'Boss Pizzaria', mode: 'semi_automatic', rules: { project: [] } }, 'anuncio-enriquecido', {
      imageGenerator: async (payload) => {
        receivedPrompt = payload.content.image.prompt;
        return { url: 'https://cdn.example.com/anuncio.png', mimeType: 'image/png' };
      },
      adCopyGenerator: async () => ([
        { angle: 'dor', headline: 'Cansou de complicar o jantar?', primaryText: 'A Boss resolve rápido.', cta: 'Chame no WhatsApp' },
        { angle: 'desejo', headline: 'Pizza quentinha em minutos', primaryText: 'Peça agora e relaxe.', cta: 'Chame no WhatsApp' },
        { angle: 'urgencia', headline: 'Hoje tem rodízio', primaryText: 'Só até acabar o forno ligado.', cta: 'Chame no WhatsApp' },
      ]),
    });

    assert.match(receivedPrompt, /ANÚNCIO PAGO/);
    assert.equal(adCreative.image.url, 'https://cdn.example.com/anuncio.png');
    assert.equal(adCreative.image.generating, false);
    assert.equal(adCreative.variations.length, 3);
    assert.deepEqual(adCreative.variations.map((v) => v.angle), ['dor', 'desejo', 'urgencia']);
    assert.equal(adCreative.imageGenerationError, null);
    assert.equal(adCreative.copyGenerationError, null);

    const persisted = JSON.parse(await readFile(adCreative.filePath, 'utf-8'));
    assert.equal(persisted.variations.length, 3);
    assert.equal(persisted.image.url, 'https://cdn.example.com/anuncio.png');
  });
});

test('listAdCreatives and deleteAdCreative round-trip real files on disk', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'anuncio-lista', name: 'Boss Pizzaria' }, dir);
    const a = await generateAdCreative('anuncio-lista', { objective: 'whatsapp' }, dir);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await generateAdCreative('anuncio-lista', { objective: 'whatsapp' }, dir);

    const listed = await listAdCreatives('anuncio-lista', dir);
    assert.equal(listed.length, 2);
    assert.equal(listed[0].adCreativeId, b.adCreativeId, 'newest first');

    await deleteAdCreative('anuncio-lista', a.adCreativeId, dir);
    const afterDelete = await listAdCreatives('anuncio-lista', dir);
    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete[0].adCreativeId, b.adCreativeId);
  });
});

test('listAdCreatives returns an empty list for a project that never generated an ad creative', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'anuncio-vazio', name: 'Boss Pizzaria' }, dir);
    assert.deepEqual(await listAdCreatives('anuncio-vazio', dir), []);
  });
});

test('generateCarousel creates a placeholder carousel with N generating slides, no image/roteiro yet', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-base', name: 'Boss Pizzaria' }, dir);

    const carousel = await generateCarousel('carrossel-base', { briefing: '5 dicas de pizza', slideCount: 5 }, dir);

    assert.equal(carousel.slideCount, 5);
    assert.equal(carousel.slides.length, 5);
    assert.equal(carousel.status, 'generating');
    assert.equal(carousel.format, '');
    assert.equal(carousel.outlineGenerationError, null);
    carousel.slides.forEach((slide, index) => {
      assert.equal(slide.order, index + 1);
      assert.equal(slide.channel, 'instagram_feed');
      assert.equal(slide.image.generating, true);
      assert.deepEqual(slide.image.dimensions, { width: 1080, height: 1350 });
      assert.equal(slide.contentTopic, null);
      assert.equal(slide.slideText, '');
    });
  });
});

test('generateCarousel clamps slideCount to the 2-10 range and requires a briefing', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-clamp', name: 'Boss Pizzaria' }, dir);

    const tooFew = await generateCarousel('carrossel-clamp', { briefing: 'teste', slideCount: 1 }, dir);
    assert.equal(tooFew.slideCount, 2);

    const tooMany = await generateCarousel('carrossel-clamp', { briefing: 'teste', slideCount: 99 }, dir);
    assert.equal(tooMany.slideCount, 10);

    await assert.rejects(
      () => generateCarousel('carrossel-clamp', { briefing: '   ' }, dir),
      /briefing/i,
    );
  });
});

test('listCarousels and deleteCarousel round-trip real files on disk', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-lista', name: 'Boss Pizzaria' }, dir);
    const a = await generateCarousel('carrossel-lista', { briefing: 'briefing A', slideCount: 3 }, dir);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await generateCarousel('carrossel-lista', { briefing: 'briefing B', slideCount: 4 }, dir);

    const listed = await listCarousels('carrossel-lista', dir);
    assert.equal(listed.length, 2);
    assert.equal(listed[0].carouselId, b.carouselId, 'newest first');

    await deleteCarousel('carrossel-lista', a.carouselId, dir);
    const afterDelete = await listCarousels('carrossel-lista', dir);
    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete[0].carouselId, b.carouselId);
  });
});

test('listCarousels returns an empty list for a project that never generated a carousel', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'carrossel-vazio', name: 'Boss Pizzaria' }, dir);
    assert.deepEqual(await listCarousels('carrossel-vazio', dir), []);
  });
});

test('generateAdCreative accepts a Story channel with the right dimensions, and exposes all 6 real Meta objectives', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'anuncio-story', name: 'Boss Pizzaria' }, dir);

    const story = await generateAdCreative('anuncio-story', { objective: 'sales', channel: 'instagram_story' }, dir);
    assert.equal(story.channel, 'instagram_story');
    assert.equal(story.image.aspectRatio, 'portrait');
    assert.equal(story.objectiveLabel, 'Vendas/Conversão');

    const feed = await generateAdCreative('anuncio-story', { objective: 'engagement', channel: 'instagram_feed' }, dir);
    assert.equal(feed.channel, 'instagram_feed');
    assert.equal(feed.objectiveLabel, 'Engajamento');

    for (const objective of ['whatsapp', 'awareness', 'engagement', 'leads', 'sales', 'app_promotion']) {
      const created = await generateAdCreative('anuncio-story', { objective }, dir);
      assert.ok(created.objectiveLabel, `expected a label for objective "${objective}"`);
    }
  });
});

test('the operator\'s free-text idea is folded into the creative brief differently depending on noteMode', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'anuncio-nota', name: 'Boss Pizzaria' }, dir);

    const recomendacao = await generateAdCreative('anuncio-nota', {
      objective: 'whatsapp',
      note: 'por menos de R$5 por dia você pode movimentar seu Instagram',
      noteMode: 'recomendacao',
    }, dir);
    assert.match(recomendacao.contentTopic.objective, /inspiração adicional/i);
    assert.match(recomendacao.contentTopic.objective, /R\$5 por dia/);
    assert.equal(recomendacao.contentTopic.adNoteMode, 'recomendacao');

    const baseTotal = await generateAdCreative('anuncio-nota', {
      objective: 'whatsapp',
      note: 'por menos de R$5 por dia você pode movimentar seu Instagram',
      noteMode: 'base_total',
    }, dir);
    assert.match(baseTotal.contentTopic.objective, /base totalmente/i);
    assert.equal(baseTotal.contentTopic.adNoteMode, 'base_total');
  });
});

test('regenerateAdCreative refreshes the image references from an already-generated ad creative on disk', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'anuncio-regen', name: 'Boss Pizzaria' }, dir);
    const created = await generateAdCreative('anuncio-regen', { objective: 'whatsapp' }, dir);

    const reloaded = await regenerateAdCreative('anuncio-regen', created.adCreativeId, dir);
    assert.equal(reloaded.adCreativeId, created.adCreativeId);
    assert.ok(Array.isArray(reloaded.image.references));
  });
});

test('a "Pedido de alteração" note on an existing ad creative triggers a targeted image edit; regenerating with no note does not, and copy variations are left untouched either way', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'anuncio-editar', name: 'Boss Pizzaria' }, dir);
    await updateProjectBrandInput('anuncio-editar', { segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria' }, dir);
    await registerCreativeTemplate('group:alimenticio/category:pizzaria', 'ad_creative', 'feed', dir);
    const adCreative = await generateAdCreative('anuncio-editar', { objective: 'whatsapp' }, dir);
    await enrichAdCreativeWithRealImage(adCreative, { name: 'Boss Pizzaria', mode: 'semi_automatic', rules: { project: [] } }, 'anuncio-editar', {
      imageGenerator: async () => ({ url: 'https://cdn.example.com/original.png', mimeType: 'image/png' }),
      adCopyGenerator: async () => ([
        { angle: 'dor', angleLabel: 'Dor', headline: 'h', primaryText: 'p', description: 'd', cta: 'c' },
      ]),
    });
    assert.equal(adCreative.variations.length, 1);

    const withNoteCalls = [];
    const reloadedForEdit = await regenerateAdCreative('anuncio-editar', adCreative.adCreativeId, dir);
    await enrichAdCreativeWithRealImage(reloadedForEdit, { name: 'Boss Pizzaria', mode: 'semi_automatic', rules: { project: [] } }, 'anuncio-editar', {
      imageGenerator: async (payload) => {
        withNoteCalls.push(payload);
        return { url: 'https://cdn.example.com/edited.png', mimeType: 'image/png' };
      },
      note: 'aumentar o preço',
      skipCopy: true,
    });
    assert.equal(withNoteCalls[0].targetedEdit, true);
    assert.equal(reloadedForEdit.variations.length, 1, 'copy variations must survive an image-only regenerate');

    const withoutNoteCalls = [];
    const reloadedForFresh = await regenerateAdCreative('anuncio-editar', adCreative.adCreativeId, dir);
    await enrichAdCreativeWithRealImage(reloadedForFresh, { name: 'Boss Pizzaria', mode: 'semi_automatic', rules: { project: [] } }, 'anuncio-editar', {
      imageGenerator: async (payload) => {
        withoutNoteCalls.push(payload);
        return { url: 'https://cdn.example.com/fresh.png', mimeType: 'image/png' };
      },
      skipCopy: true,
    });
    assert.equal(withoutNoteCalls[0].targetedEdit, false);
  });
});

test('withProjectLock now guards against a second OS process too, via a real lock file, not just in-memory serialization', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'lock-teste', name: 'Boss Pizzaria' }, dir);
    const paths = getCentralPaths(dir, 'lock-teste');
    const lockPath = join(paths.projectDir, '.lock');

    // A lock file left behind by a process that's still genuinely alive (a
    // slow Raio-X call, or literally a second server process) must block a
    // concurrent write — this is the actual cross-process race the file
    // lock exists to close, simulated here by planting the lock by hand
    // instead of spawning a second Node process.
    await writeFile(lockPath, 'other-process\n' + new Date().toISOString());
    let resolved = false;
    const pending = saveProjectOffer('lock-teste', { name: 'Pizza Grande' }, dir).then((offer) => {
      resolved = true;
      return offer;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(resolved, false, 'must not write while a fresh lock file from another holder still exists');

    await rm(lockPath, { force: true });
    const { offer } = await pending;
    assert.equal(resolved, true);
    assert.equal(offer.name, 'Pizza Grande');

    // A lock file abandoned by a crashed process (old mtime, nobody left to
    // release it) must eventually be reclaimed instead of blocking forever.
    await writeFile(lockPath, 'crashed-process\n' + new Date(0).toISOString());
    const staleMtime = new Date(Date.now() - 5 * 60 * 1000);
    await utimes(lockPath, staleMtime, staleMtime);
    const { offer: offerAfterStaleLock } = await saveProjectOffer('lock-teste', { name: 'Pizza Média' }, dir);
    assert.equal(offerAfterStaleLock.name, 'Pizza Média');
  });
});

test('saveLearningEntry/deleteLearningEntry/saveOfferTypeBaseInstruction share one global lock, not a per-project one, since they read-modify-write GLOBAL learning stores shared across every project', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'projeto-a', name: 'Projeto A', handle: '@a', approvalEmail: 'a@example.com' }, dir);
    await createCentralProject({ projectId: 'projeto-b', name: 'Projeto B', handle: '@b', approvalEmail: 'b@example.com' }, dir);

    // Two different projects writing to the shared learning store must take
    // the SAME lock — a per-projectId lock (the old bug) would let them
    // proceed concurrently and lose one of the two writes. Plant a fresh
    // lock file under the shared global-lock directory (whatever fixed key
    // withProjectLock is now called with for these three functions) and
    // confirm a write from an UNRELATED project ('projeto-b') still blocks
    // on it — proving it's the same lock, not projeto-b's own.
    const globalLockPaths = getCentralPaths(dir, '__global-learning__');
    const lockPath = join(globalLockPaths.projectDir, '.lock');
    await mkdir(globalLockPaths.projectDir, { recursive: true });
    await writeFile(lockPath, 'held-by-projeto-a\n' + new Date().toISOString());

    let resolved = false;
    const pending = saveLearningEntry({
      scope: 'offerType',
      groupKey: 'combo',
      bucket: 'approved',
      kind: 'text',
      text: 'sempre mostrar o combo completo',
    }, dir).then((result) => {
      resolved = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(resolved, false, 'a write from a different project must still block on the shared global learning lock');

    await rm(lockPath, { force: true });
    await pending;
    assert.equal(resolved, true);

    // saveOfferTypeBaseInstruction previously took no lock at all — confirm
    // it now also honors the same shared lock instead of writing straight
    // through a held one.
    await writeFile(lockPath, 'held-again\n' + new Date().toISOString());
    let baseInstructionResolved = false;
    const pendingBaseInstruction = saveOfferTypeBaseInstruction(dir, 'combo', 'Novo texto base do combo').then(() => {
      baseInstructionResolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(baseInstructionResolved, false, 'saveOfferTypeBaseInstruction must also honor the shared global learning lock');
    await rm(lockPath, { force: true });
    await pendingBaseInstruction;
    assert.equal(baseInstructionResolved, true);
  });
});

test('addSegmentLearning (the auto-learning write triggered by content rejection) also honors the shared global learning lock, not just its own per-project lock', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'rejeicao-lock', name: 'Rejeicao Lock', handle: '@rl', approvalEmail: 'a@example.com' }, dir);
    // addSegmentLearning() is a no-op (returns before ever touching the
    // store/lock) when the project has no segment hierarchy set at all —
    // segmentNodePaths() needs at least one of group/category/specialty.
    await updateProjectBrandInput('rejeicao-lock', {
      brandName: 'Rejeicao Lock',
      segmentGroup: 'Alimentício',
      segmentCategory: 'Pizzaria',
      segment: 'pizzaria',
      productsOrServices: 'pizzas',
    }, dir);
    const batch = await generateContentBatch('rejeicao-lock', { days: 1, startDate: '2026-07-20' }, dir);

    // deleteProjectContent (rejection with a reason) already runs inside its
    // OWN per-project lock, but internally calls addSegmentLearning, which
    // read-modify-writes the same GLOBAL segment-learnings.json
    // saveLearningEntry/deleteLearningEntry/saveOfferTypeBaseInstruction do.
    // Plant a lock file at the shared global-lock directory and confirm the
    // rejection call still blocks on it (nested inside its per-project
    // lock), proving addSegmentLearning takes the same shared lock too.
    const globalLockPaths = getCentralPaths(dir, '__global-learning__');
    const lockPath = join(globalLockPaths.projectDir, '.lock');
    await mkdir(globalLockPaths.projectDir, { recursive: true });
    await writeFile(lockPath, 'held-by-another-project\n' + new Date().toISOString());

    let resolved = false;
    const pending = deleteProjectContent('rejeicao-lock', batch.items[0].contentId, dir, batch.batchId, 'não parecer gerado por IA').then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(resolved, false, 'a content rejection must still block on the shared global learning lock');

    await rm(lockPath, { force: true });
    await pending;
    assert.equal(resolved, true);

    const store = JSON.parse(await readFile(getCentralPaths(dir, 'rejeicao-lock').segmentLearningsPath, 'utf-8'));
    const hasAvoidEntry = Object.values(store.nodes).some((node) => node.entries.some((entry) => entry.text.includes('não parecer gerado por IA')));
    assert.ok(hasAvoidEntry, 'the avoid learning must still have been written once the lock was released');
  });
});

const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function writeTinyPngFile(path) {
  const base64 = TINY_PNG_DATA_URL.split(',')[1];
  await writeFile(path, Buffer.from(base64, 'base64'));
}

test('registerSegmentTemplate/loadSegmentTemplate/listSegmentTemplates round-trip real files on disk', async () => {
  await withTempProject(async (dir) => {
    const sourceFeed = join(dir, 'source-feed.png');
    const sourceStory = join(dir, 'source-story.png');
    await writeTinyPngFile(sourceFeed);
    await writeTinyPngFile(sourceStory);

    assert.deepEqual(await listSegmentTemplates(dir), [], 'no templates registered yet — empty list, not an error');
    assert.equal(await loadSegmentTemplate('embalagens', dir), null);

    const template = await registerSegmentTemplate('embalagens', {
      label: 'Embalagens',
      pieces: [
        { key: 'sell-products', label: 'Venda direta', channel: 'instagram_feed', angleNote: 'atacado e varejo', sourceImagePath: sourceFeed },
        { key: 'produtos', label: 'Destaque Produtos', channel: 'instagram_story', angleNote: 'vitrine de produtos', sourceImagePath: sourceStory },
      ],
    }, dir);
    assert.equal(template.segmentId, 'embalagens');
    assert.equal(template.pieces.length, 2);

    const loaded = await loadSegmentTemplate('embalagens', dir);
    assert.equal(loaded.pieces.length, 2);
    const feedPiece = loaded.pieces.find((piece) => piece.key === 'sell-products');
    assert.ok(feedPiece.imageAbsolutePath.endsWith(join('images', 'sell-products.png')));
    const storedBytes = await readFile(feedPiece.imageAbsolutePath);
    assert.deepEqual(storedBytes, Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'), 'the copied file must be byte-identical to the source');

    const listed = await listSegmentTemplates(dir);
    assert.deepEqual(listed, [{
      segmentId: 'embalagens',
      label: 'Embalagens',
      pieceCount: 2,
      pieces: [
        { key: 'sell-products', label: 'Venda direta', channel: 'instagram_feed', imagePath: 'images/sell-products.png' },
        { key: 'produtos', label: 'Destaque Produtos', channel: 'instagram_story', imagePath: 'images/produtos.png' },
      ],
    }], 'listSegmentTemplates now includes the full piece list so the dashboard can render the fixed grid/highlight images directly');
  });
});

test('enrichSegmentTemplateItemsForProspect adapts a registered template with a targeted edit, using the templateEditBasePath instead of any in-project lookup, and the note carries the project\'s real extracted logo colors', async () => {
  await withTempProject(async (dir) => {
    const sourceFeed = join(dir, 'source-feed.png');
    await writeTinyPngFile(sourceFeed);
    await registerSegmentTemplate('embalagens', {
      label: 'Embalagens',
      pieces: [{ key: 'sell_products', label: 'Venda direta', channel: 'instagram_feed', angleNote: 'atacado e varejo', sourceImagePath: sourceFeed }],
    }, dir);

    await createCentralProject({ projectId: 'prospect-embalagens', name: 'Nova Embalagens Prospect' }, dir);
    await updateProjectBrandInput('prospect-embalagens', { segmentGroup: 'Embalagens', segmentCategory: 'Casa de Embalagem' }, dir);
    await registerCreativeTemplate('group:embalagens/category:casa-de-embalagem', 'offer', 'feed', dir);
    // The real path is saveProjectAsset(logo)'s AI color analyzer, not
    // configured in this unit test — stamp the field directly, same pattern
    // used across this suite whenever a test only needs the field to exist.
    const paths = getCentralPaths(dir, 'prospect-embalagens');
    const projectJson = JSON.parse(await readFile(paths.projectPath, 'utf-8'));
    projectJson.brandIdentity.extractedColors = ['#123456', '#abcdef'];
    await writeFile(paths.projectPath, JSON.stringify(projectJson, null, 2));

    const template = await loadSegmentTemplate('embalagens', dir);
    const project = (await listCentralProjects(dir)).find((entry) => entry.projectId === 'prospect-embalagens');
    const items = await Promise.all(template.pieces.map(async (piece) => {
      const item = await buildSegmentTemplateContentItem(piece, project, paths);
      item.templateEditBasePath = piece.imageAbsolutePath;
      return item;
    }));

    const calls = [];
    await enrichSegmentTemplateItemsForProspect(items, project, 'prospect-embalagens', {
      imageGenerator: async (payload) => {
        calls.push(payload);
        return { url: 'https://cdn.example.com/adaptado.png', mimeType: 'image/png' };
      },
      note: 'Troque a paleta de cor de fundo original pela nova paleta baseada na logo anexada: #123456, #abcdef.',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].content.templateEditBasePath, items[0].templateEditBasePath);
    assert.equal(calls[0].targetedEdit, true);
    assert.match(calls[0].note, /#123456, #abcdef/);
    assert.equal(items[0].image.url, 'https://cdn.example.com/adaptado.png');
    assert.equal(items[0].image.generatedSource, 'ai');
    assert.equal(items[0].imageGenerationError, null);
  });
});

test('enqueueSegmentTemplateAdaptation builds items for every piece and never invents a palette when the logo has no extracted colors yet', async () => {
  await withTempProject(async (dir) => {
    const sourceFeed = join(dir, 'source-feed.png');
    const sourceStory = join(dir, 'source-story.png');
    await writeTinyPngFile(sourceFeed);
    await writeTinyPngFile(sourceStory);
    await registerSegmentTemplate('embalagens', {
      label: 'Embalagens',
      pieces: [
        { key: 'sell-products', label: 'Venda direta', channel: 'instagram_feed', angleNote: 'atacado e varejo', sourceImagePath: sourceFeed },
        { key: 'produtos', label: 'Destaque Produtos', channel: 'instagram_story', angleNote: 'vitrine de produtos', sourceImagePath: sourceStory },
      ],
    }, dir);
    await createCentralProject({ projectId: 'prospect-sem-cor', name: 'Prospect Sem Cor Extraída' }, dir);
    await updateProjectBrandInput('prospect-sem-cor', { segmentGroup: 'Embalagens', segmentCategory: 'Casa de Embalagem' }, dir);
    await registerCreativeTemplate('group:embalagens/category:casa-de-embalagem', 'offer', 'feed', dir);
    await registerCreativeTemplate('group:embalagens/category:casa-de-embalagem', 'offer', 'vertical', dir);

    const calls = [];
    enqueueSegmentTemplateAdaptation('prospect-sem-cor', 'embalagens', {
      imageGenerator: async (payload) => {
        calls.push(payload);
        return { url: `https://cdn.example.com/${calls.length}.png`, mimeType: 'image/png' };
      },
    }, dir);

    for (let i = 0; i < 50 && calls.length < 2; i += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }

    assert.equal(calls.length, 2);
    assert.doesNotMatch(calls[0].note, /#[0-9a-fA-F]{6}/, 'must not invent a hex palette when the logo was never colour-analyzed');
    const content = await listProjectContent('prospect-sem-cor', dir);
    const channels = content.map((item) => item.channel).sort();
    assert.deepEqual(channels, ['instagram_feed', 'instagram_story']);
    assert.ok(content.every((item) => item.image.generatedSource === 'ai'));
  });
});

test('offerObjective uses a saved baseInstruction override instead of the hardcoded default, and approved learning entries are appended to the content topic', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'boss-pizza-3', name: 'Boss Pizza 3', handle: '@boss3', approvalEmail: 'a@example.com' }, dir);
    await saveOfferTypeBaseInstruction(dir, 'combo', 'Combo: foco no produto, borda visível, CTA de delivery direto, nunca cortar a caixa.');
    await saveLearningEntry({
      scope: 'offerType',
      groupKey: 'combo',
      bucket: 'approved',
      kind: 'text',
      text: 'Anúncios de combo com preço em selo circular convertem mais.',
    }, dir);

    const loaded = await loadOfferTypeLearning(dir, 'combo');
    assert.equal(loaded.baseInstruction, 'Combo: foco no produto, borda visível, CTA de delivery direto, nunca cortar a caixa.');
    assert.equal(loaded.entries.length, 1);
  });
});

test('offerObjective falls back to the original hardcoded default (unchanged wording) for an offer type with no saved override', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'boss-pizza-4', name: 'Boss Pizza 4', handle: '@boss4', approvalEmail: 'a@example.com' }, dir);
    const loaded = await loadOfferTypeLearning(dir, 'combo');
    // No override saved for this global file yet: baseInstruction is the
    // name-less generic template (used to pre-fill a future edit UI), while
    // the live prompt (see the "uses a saved override" test's sibling
    // assertions elsewhere in this file, e.g. the "Criar oferta de combo
    // para 2 Pizzas Grande" test) keeps using the original per-offer wording
    // via legacyOfferObjective — this only asserts the loader's own default.
    assert.equal(loaded.baseInstruction, 'Combo/promoção: mostrar todos os itens do combo, preço/condição se cadastrados, economia percebida e CTA de pedido. Não misturar com outras ofertas nem inventar desconto.');
    assert.equal(loaded.entries.length, 0);
    assert.equal(loaded.hasOverride, false);
  });
});

test('institutional structure is optional: used when present, not required when absent', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'strict-institucional', name: 'Strict Institucional', handle: '@strictinst', approvalEmail: 'a@example.com' }, dir);
    await updateProjectBrandInput('strict-institucional', {
      brandName: 'Strict Institucional', segmentGroup: 'Alimenticio', segmentCategory: 'Pizzaria', segment: 'pizzaria', productsOrServices: 'pizzas', contentGoals: ['authority'],
    }, dir);

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const analyzed = await analyzeLearningImage({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', dataUrl, filename: 'modelo-institucional.png' }, dir, new Date(), { learningImageAnalyzer: async () => 'modelo' });
    await saveLearningEntry({ scope: 'segment', groupKey: 'group:alimenticio/category:pizzaria', bucket: 'approved', kind: 'image', text: 'modelo', imagePath: analyzed.imagePath, purpose: 'creative', postType: 'institutional', shape: 'vertical' }, dir);

    const generatorCalls = [];
    await simulateTestPost('strict-institucional', {
      channel: 'instagram_story',
      goalKey: 'authority',
      imageGenerator: async (payload) => { generatorCalls.push(payload); return { url: 'https://cdn.example.com/x.png', mimeType: 'image/png' }; },
    }, dir, new Date('2026-07-20T12:00:00.000Z'));

    assert.equal(generatorCalls[0].content.creativeSpec.layout.strength, 'strict');
    assert.equal(generatorCalls[0].content.creativeStructureUsed?.postType, 'institutional');
    assert.ok(generatorCalls[0].content.image.references.some((reference) => reference.referenceKind === 'segment_structure'));
  });
});

test('contentGoalWeights are saved when the currently-marked goals sum to 100, and a stale key for an unmarked goal is kept but excluded from that sum check', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pesos-validos', name: 'Pesos Válidos' }, dir);
    const updated = await updateProjectBrandInput('pesos-validos', {
      brandName: 'Pesos Válidos',
      segment: 'loja',
      contentGoals: ['authority', 'engagement'],
      // brand_awareness isn't marked in contentGoals — it's a stale leftover
      // (e.g. from a goal unchecked after weights were configured) and must
      // NOT count against the 100% check for the goals that ARE marked.
      contentGoalWeights: { sales: 90, authority: 5, engagement: 5, brand_awareness: 40 },
    }, dir);
    assert.deepEqual(updated.brandInput.contentGoalWeights, { sales: 90, authority: 5, engagement: 5, brand_awareness: 40 });
  });
});

test('contentGoalWeights that do not sum to 100 across 2+ entries are rejected', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pesos-invalidos', name: 'Pesos Inválidos' }, dir);
    await assert.rejects(
      updateProjectBrandInput('pesos-invalidos', {
        brandName: 'Pesos Inválidos',
        segment: 'loja',
        contentGoals: ['authority', 'engagement'],
        contentGoalWeights: { authority: 90, engagement: 5 },
      }, dir),
      /precisam somar 100/,
    );
  });
});

test('a single contentGoalWeights entry needs no sum validation', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'peso-unico', name: 'Peso Único' }, dir);
    const updated = await updateProjectBrandInput('peso-unico', {
      brandName: 'Peso Único',
      segment: 'loja',
      contentGoals: ['authority'],
      contentGoalWeights: { authority: 37 },
    }, dir);
    assert.equal(updated.brandInput.contentGoalWeights.authority, 37);
  });
});

// No reachable write path can produce a stored contentGoalWeights that no
// longer sums to 100 — updateProjectBrandInput/analyzeProjectBrandXray both
// validate before writing. But a read path (listCentralProjects → every
// project's toProjectSummary, which GET /api/state runs for ALL projects)
// must still tolerate one if it ever shows up (hand-edited JSON, a restored
// backup, a future direct-write helper) instead of throwing and taking down
// the whole endpoint for every other project too. Simulate that by writing
// an unbalanced sum straight to disk, bypassing every validated writer.
test('listCentralProjects (a read path) does not throw on an already-stored, unbalanced contentGoalWeights', async () => {
  await withTempProject(async (dir) => {
    await createCentralProject({ projectId: 'pesos-corrompidos', name: 'Pesos Corrompidos' }, dir);
    const paths = getCentralPaths(dir, 'pesos-corrompidos');
    const raw = JSON.parse(await readFile(paths.projectPath, 'utf-8'));
    raw.brandInput = {
      ...raw.brandInput,
      contentGoals: ['authority', 'engagement'],
      contentGoalWeights: { authority: 90, engagement: 5 },
    };
    await writeFile(paths.projectPath, JSON.stringify(raw, null, 2), 'utf-8');

    const projects = await listCentralProjects(dir);
    const found = projects.find((project) => project.projectId === 'pesos-corrompidos');
    assert.ok(found);
    assert.deepEqual(found.brandInput.contentGoalWeights, { authority: 90, engagement: 5 });
  });
});
