import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyReport, listReportMonths, monthLabel, renderReportPage } from '../src/content-central-report.js';

const project = {
  projectId: 'hygi',
  name: 'Hygi Embalagem',
  instagram: { handle: '@hygiembalagem' },
  brandIdentity: { logoPath: 'assets/logo.jpg' },
};
const agency = { name: 'King Assessoria de MKT', contactPhone: '65 98108-6707', logoPath: 'logo.jpg' };
const closedNow = new Date(2026, 9, 5, 9);

let sequence = 0;
// A published August item; local noon keeps it inside August in any timezone.
function item(overrides = {}) {
  sequence += 1;
  return {
    contentId: `c${sequence}`,
    batchId: 'lote',
    channel: 'instagram_story',
    scheduledDate: '2026-08-10',
    contentTopic: { type: 'offer' },
    image: { url: `/api/projects/hygi/assets/assets/generated/arte-${sequence}.png` },
    publish: { publishedAt: new Date(2026, 7, 10, 12).toISOString(), metaMediaId: `m${sequence}` },
    ...overrides,
  };
}

const report = (items, metrics = {}, now = closedNow, month = '2026-08') => buildMonthlyReport({ project, agency, items, metrics, month, now });

test('monthLabel writes the month the way a client reads it', () => {
  assert.equal(monthLabel('2026-08'), 'Agosto de 2026');
});

test('counts publications by the local month they went out, not by the scheduled date', () => {
  const items = [
    item({ scheduledDate: '2029-07-01' }),
    item({ channel: 'instagram_feed' }),
    item({ channel: 'facebook_feed' }),
    item({ channel: 'facebook_story' }),
    item({ publish: { publishedAt: new Date(2026, 8, 1, 12).toISOString() } }),
    item({ publish: { publishedAt: null } }),
  ];
  const result = report(items);
  assert.equal(result.totals.publications, 4);
  assert.deepEqual(result.totals.byChannel.map((chip) => chip.text), ['1 story', '1 post no feed', '2 no Facebook']);
  assert.equal(result.monthLabel, 'Agosto de 2026');
  assert.equal(result.partial, false);
});

test('shows one arte per creative group and splits stories, feed and encartes', () => {
  const items = [
    item({ creativeGroupKey: 'g1', channel: 'instagram_story' }),
    item({ creativeGroupKey: 'g1', channel: 'whatsapp_status' }),
    item({ creativeGroupKey: 'g2', channel: 'instagram_feed' }),
    item({ creativeGroupKey: 'g2', channel: 'facebook_feed' }),
    item({ batchId: 'flyer-1', creativeGroupKey: 'flyer-1::vertical', channel: 'instagram_story', contentTopic: { source: 'flyer' } }),
    item({ batchId: 'flyer-1', creativeGroupKey: 'flyer-1::feed', channel: 'instagram_feed', contentTopic: { source: 'flyer' } }),
  ];
  const result = report(items);
  assert.equal(result.totals.publications, 6);
  assert.equal(result.stories.count, 1);
  assert.equal(result.feed.count, 1);
  assert.equal(result.flyers.count, 1);
  // The encarte shows its vertical arte, served through the resized-preview route.
  assert.equal(result.flyers.items[0].imageUrl, `/api/projects/hygi/assets-preview/assets/generated/arte-${sequence - 1}.png`);
});

test('stories show the six most viewed, with the rest counted', () => {
  const items = Array.from({ length: 8 }, () => item());
  const media = Object.fromEntries(items.map((entry, index) => [entry.publish.metaMediaId, { kind: 'story', views: (index + 1) * 10 }]));
  const result = report(items, { media });
  assert.equal(result.stories.count, 8);
  assert.equal(result.stories.measured, true);
  assert.deepEqual(result.stories.top.map((story) => story.views), [80, 70, 60, 50, 40, 30]);
  assert.equal(result.stories.more, 2);
});

test('without numbers, stories show the six most recent and are marked unmeasured', () => {
  const items = Array.from({ length: 7 }, (_, index) => item({ publish: { publishedAt: new Date(2026, 7, index + 1, 12).toISOString() } }));
  const result = report(items);
  assert.equal(result.stories.measured, false);
  assert.equal(result.stories.top.length, 6);
  assert.deepEqual(result.stories.top.map((story) => story.views), [null, null, null, null, null, null]);
  assert.match(result.stories.top[0].imageUrl, new RegExp(`arte-${sequence}\\.png$`));
});

test('feed posts are ordered by likes and summed; unknown likes stay null', () => {
  const low = item({ channel: 'instagram_feed' });
  const high = item({ channel: 'instagram_feed' });
  const media = {
    [low.publish.metaMediaId]: { kind: 'feed', likes: 5, comments: 1 },
    [high.publish.metaMediaId]: { kind: 'feed', likes: 31, comments: 4 },
  };
  const measured = report([low, high], { media });
  assert.deepEqual(measured.feed.items.map((post) => post.likes), [31, 5]);
  assert.equal(measured.feed.likes, 36);
  assert.equal(measured.feed.comments, 5);

  const unmeasured = report([low, high]);
  assert.equal(unmeasured.feed.likes, null);
  assert.equal(unmeasured.feed.comments, null);
  assert.deepEqual(unmeasured.feed.items.map((post) => post.likes), [null, null]);
});

test('followers show the month-end total, and growth only when there is a base and it is positive', () => {
  const items = [item()];
  const grew = report(items, { followers: { '2026-07-31': 1247, '2026-08-15': 1260, '2026-08-31': 1284, '2026-09-02': 1300 } });
  assert.deepEqual(grew.followers, { total: 1284, delta: 37 });

  const noBase = report(items, { followers: { '2026-08-15': 1260, '2026-08-31': 1284 } });
  assert.deepEqual(noBase.followers, { total: 1284, delta: null });

  const shrank = report(items, { followers: { '2026-07-31': 1300, '2026-08-31': 1284 } });
  assert.deepEqual(shrank.followers, { total: 1284, delta: null });

  assert.deepEqual(report(items).followers, { total: null, delta: null });
});

test('profile views and reach come from the stored month and hide when zero', () => {
  const items = [item()];
  assert.deepEqual(report(items, { months: { '2026-08': { views: 9860, reach: 2140 } } }).audience, { views: 9860, reach: 2140 });
  assert.deepEqual(report(items, { months: { '2026-08': { views: 0, reach: 0 } } }).audience, { views: null, reach: null });
  assert.deepEqual(report(items).audience, { views: null, reach: null });
});

test('the current month is marked partial', () => {
  const result = report([item()], {}, new Date(2026, 7, 20, 9));
  assert.equal(result.partial, true);
  assert.equal(result.partialUntil, '20/08');
});

test('listReportMonths names each month and its state around day 3', () => {
  const items = [
    item(),
    item({ publish: { publishedAt: new Date(2026, 8, 10, 12).toISOString() } }),
    item({ publish: { publishedAt: new Date(2026, 9, 1, 12).toISOString() } }),
    item({ publish: { publishedAt: null } }),
  ];
  const states = (now) => listReportMonths({ items, now }).map((entry) => [entry.month, entry.publications, entry.status]);
  assert.deepEqual(states(new Date(2026, 9, 2, 9)), [['2026-10', 1, 'parcial'], ['2026-09', 1, 'fechando'], ['2026-08', 1, 'pronto']]);
  assert.deepEqual(states(new Date(2026, 9, 3, 9)), [['2026-10', 1, 'parcial'], ['2026-09', 1, 'pronto'], ['2026-08', 1, 'pronto']]);
  assert.equal(listReportMonths({ items, now: closedNow })[2].label, 'Agosto de 2026');
});

test('the page shows the client, the month and Brazilian-formatted numbers', () => {
  const items = Array.from({ length: 2 }, () => item());
  const html = renderReportPage(report(items, {
    months: { '2026-08': { views: 9860, reach: 2140 } },
    followers: { '2026-07-31': 1247, '2026-08-31': 1284 },
  }));
  assert.match(html, /Hygi Embalagem/);
  assert.match(html, /@hygiembalagem/);
  assert.match(html, /Agosto de 2026/);
  assert.match(html, /9\.860/);
  assert.match(html, /\+37 no mês/);
  assert.match(html, /no fim de agosto/);
  assert.match(html, /Preparado por King Assessoria de MKT · 65 98108-6707/);
  assert.match(html, /size:\s*360px 640px/);
  assert.doesNotMatch(html, /Encartes/);
  assert.doesNotMatch(html, /Posts no feed/);
});

test('the page degrades without numbers and says so for an empty month', () => {
  const plain = renderReportPage(report([item()]));
  assert.doesNotMatch(plain, /Quem viu a sua marca/);
  assert.doesNotMatch(plain, /Seguidores/);
  assert.doesNotMatch(plain, /mais vistos/);

  const empty = renderReportPage(report([]));
  assert.match(empty, /Nenhuma publicação em agosto de 2026\./);
});

test('every number carries a plain-language explanation, only where the number shows', () => {
  const story = item();
  const post = item({ channel: 'instagram_feed' });
  const full = renderReportPage(report([story, post], {
    months: { '2026-08': { views: 9860, reach: 2140 } },
    followers: { '2026-07-31': 1247, '2026-08-31': 1284 },
    media: {
      [story.publish.metaMediaId]: { kind: 'story', views: 412 },
      [post.publish.metaMediaId]: { kind: 'feed', likes: 31, comments: 4 },
    },
  }));
  assert.match(full, /Tudo o que publicamos/);
  assert.match(full, /apareceram na tela de alguém/);
  assert.match(full, /Pessoas diferentes/);
  assert.match(full, /seguem o seu perfil/);
  assert.match(full, /ficam 24 horas no ar/);
  assert.match(full, /quantas vezes ela foi vista/);
  assert.match(full, /ficam fixas no seu perfil/);
  assert.match(full, /tocou no coração/);

  // No number on screen, no explanation of that number.
  const plain = renderReportPage(report([item(), item({ channel: 'instagram_feed' })]));
  assert.match(plain, /ficam 24 horas no ar/);
  assert.match(plain, /ficam fixas no seu perfil/);
  assert.doesNotMatch(plain, /quantas vezes ela foi vista/);
  assert.doesNotMatch(plain, /tocou no coração/);
  assert.doesNotMatch(plain, /Pessoas diferentes/);
});

test('the page escapes names coming from the project', () => {
  const html = renderReportPage(buildMonthlyReport({
    project: { ...project, name: 'Loja <b>X</b>' }, agency, items: [item()], metrics: {}, month: '2026-08', now: closedNow,
  }));
  assert.match(html, /Loja &lt;b&gt;X&lt;\/b&gt;/);
  assert.doesNotMatch(html, /Loja <b>X<\/b>/);
});
