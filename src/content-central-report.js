import { creativeShapeGroupForChannel, localMonthKey, monthNamePt, previousMonthKey } from './content-central.js';

const STORIES_SHOWN = 6;
const FEED_PER_PAGE = 4;
const FLYERS_PER_PAGE = 6;

// One chip per channel family, in the order the cover lists them.
const CHANNEL_CHIPS = [
  { channels: ['instagram_story'], names: ['story', 'stories'] },
  { channels: ['instagram_feed'], names: ['post no feed', 'posts no feed'] },
  { channels: ['instagram_reels'], names: ['Reel', 'Reels'] },
  { channels: ['whatsapp_status'], names: ['Status do WhatsApp', 'Status do WhatsApp'] },
  { channels: ['facebook_feed', 'facebook_story'], names: ['no Facebook', 'no Facebook'] },
];

const formatNumber = (value) => Number(value).toLocaleString('pt-BR');
const countOf = (count, [one, many]) => `${formatNumber(count)} ${count === 1 ? one : many}`;
const positive = (value) => (Number.isFinite(value) && value > 0 ? value : null);
const publishedMonth = (item) => (item.publish?.publishedAt ? localMonthKey(new Date(item.publish.publishedAt)) : null);

export function monthLabel(month) {
  const name = monthNamePt(month);
  return `${name[0].toUpperCase()}${name.slice(1)} de ${month.slice(0, 4)}`;
}

export function listReportMonths({ items = [], now = new Date() }) {
  const counts = new Map();
  for (const item of items) {
    const month = publishedMonth(item);
    if (month) counts.set(month, (counts.get(month) || 0) + 1);
  }
  const current = localMonthKey(now);
  const previous = previousMonthKey(current);
  return [...counts.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, publications]) => ({
      month,
      label: monthLabel(month),
      publications,
      // Meta delivers numbers up to 48 hours late, so last month is only
      // final on day 3.
      status: month === current ? 'parcial' : month === previous && now.getDate() < 3 ? 'fechando' : 'pronto',
    }));
}

// Same rewrite the briefing page uses: the resized preview keeps the PDF
// from carrying 2-3 MB PNGs.
function imageUrlOf(item, projectId) {
  const image = item.image || item.slides?.[0]?.image || {};
  const src = image.previewUrl || image.url || '';
  const marker = `/api/projects/${projectId}/assets/`;
  return src.startsWith(marker) ? `/api/projects/${projectId}/assets-preview/${src.slice(marker.length)}` : src;
}

// The same arte published to several channels is one group. An encarte is
// one group per batch, whatever its channels.
function groupKeyOf(item) {
  if (item.contentTopic?.source === 'flyer') return `flyer:${item.batchId}`;
  return item.creativeGroupKey || `solo:${item.contentId}`;
}

function buildGroups(published, media, projectId) {
  const byKey = new Map();
  for (const item of published) {
    const key = groupKeyOf(item);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }
  const metricOf = (item) => media[item.publish?.metaMediaId] || {};
  const isVertical = (item) => creativeShapeGroupForChannel(item.channel) === 'vertical';

  return [...byKey.values()].map((members) => {
    const ordered = [...members].sort((a, b) => String(a.publish.publishedAt).localeCompare(String(b.publish.publishedAt)));
    const flyer = ordered[0].contentTopic?.source === 'flyer';
    const views = ordered.map((item) => metricOf(item).views).filter(Number.isFinite);
    const feedMetric = metricOf(ordered.find((item) => item.channel === 'instagram_feed') || {});

    // The arte shown is the most viewed member's; an encarte prefers its
    // vertical arte because its page is a vertical grid.
    const withImage = ordered.filter((item) => imageUrlOf(item, projectId));
    const pool = flyer && withImage.some(isVertical) ? withImage.filter(isVertical) : withImage;
    const cover = pool.reduce((best, item) => ((metricOf(item).views ?? -1) > (metricOf(best).views ?? -1) ? item : best), pool[0]);

    return {
      shape: flyer ? 'flyer' : ordered.map((item) => creativeShapeGroupForChannel(item.channel)).find(Boolean) || null,
      publishedAt: String(ordered[0].publish.publishedAt),
      imageUrl: cover ? imageUrlOf(cover, projectId) : '',
      views: views.length ? Math.max(...views) : null,
      likes: Number.isFinite(feedMetric.likes) ? feedMetric.likes : null,
      comments: Number.isFinite(feedMetric.comments) ? feedMetric.comments : null,
    };
  });
}

function followersFor(followers, month) {
  const dates = Object.keys(followers).sort();
  const last = dates.filter((date) => date <= `${month}-31`).at(-1);
  const base = dates.filter((date) => date < `${month}-01`).at(-1);
  const total = last ? followers[last] : null;
  const delta = total !== null && base ? total - followers[base] : null;
  // A flat or shrinking month shows the total alone — a choice of tone.
  return { total, delta: delta > 0 ? delta : null };
}

export function buildMonthlyReport({ project, agency = {}, items = [], metrics = {}, month, now = new Date() }) {
  const published = items.filter((item) => publishedMonth(item) === month);
  const groups = buildGroups(published, metrics.media || {}, project.projectId);
  const byRecent = (a, b) => b.publishedAt.localeCompare(a.publishedAt);
  const sum = (list, field) => (list.length ? list.reduce((acc, group) => acc + group[field], 0) : null);

  const stories = groups.filter((group) => group.shape === 'vertical').sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || byRecent(a, b));
  const feed = groups.filter((group) => group.shape === 'feed').sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1) || byRecent(a, b));
  const flyers = groups.filter((group) => group.shape === 'flyer').sort((a, b) => byRecent(b, a));
  const top = stories.slice(0, STORIES_SHOWN);

  const partial = month === localMonthKey(now);
  const logoPath = project.brandIdentity?.logoPath;
  const monthData = metrics.months?.[month] || {};

  return {
    month,
    monthLabel: monthLabel(month),
    monthName: monthNamePt(month),
    partial,
    partialUntil: partial ? `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}` : null,
    client: {
      name: project.name,
      handle: project.instagram?.handle || '',
      logoUrl: logoPath ? `/api/projects/${project.projectId}/assets/${logoPath}` : '',
      initial: (String(project.name || '?').trim()[0] || '?').toUpperCase(),
    },
    agency: {
      name: agency.name || '',
      phone: agency.contactPhone || '',
      logoUrl: agency.logoPath ? `/api/commercial/assets/${agency.logoPath}` : '',
    },
    totals: {
      publications: published.length,
      byChannel: CHANNEL_CHIPS
        .map((chip) => ({ chip, count: published.filter((item) => chip.channels.includes(item.channel)).length }))
        .filter(({ count }) => count > 0)
        .map(({ chip, count }) => ({ count, text: countOf(count, chip.names) })),
    },
    audience: { views: positive(monthData.views), reach: positive(monthData.reach) },
    followers: followersFor(metrics.followers || {}, month),
    stories: {
      count: stories.length,
      measured: stories.some((group) => group.views !== null),
      top: top.map((group) => ({ imageUrl: group.imageUrl, views: group.views })),
      more: stories.length - top.length,
    },
    feed: {
      count: feed.length,
      likes: sum(feed.filter((group) => group.likes !== null), 'likes'),
      comments: sum(feed.filter((group) => group.comments !== null), 'comments'),
      items: feed.map((group) => ({ imageUrl: group.imageUrl, likes: group.likes })),
    },
    flyers: {
      count: flyers.length,
      items: flyers.map((group) => ({ imageUrl: group.imageUrl, views: group.views })),
    },
  };
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function chunk(list, size) {
  const pages = [];
  for (let index = 0; index < list.length; index += size) pages.push(list.slice(index, index + size));
  return pages;
}

const thumb = (imageUrl, badge) => `<div class="th">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="">` : '<div class="noimg"></div>'}${badge ? `<b>${escapeHtml(badge)}</b>` : ''}</div>`;
const hint = (text) => `<p class="hint">${text}</p>`;
const stat = (value, label, explanation) => (value === null ? '' : `<div class="stat"><div class="n">${formatNumber(value)}</div><div class="t">${label}</div>${hint(explanation)}</div>`);

// One plain sentence under each number, for a shop owner who has never read
// an Instagram report. An explanation only shows next to the number it explains.
const HINTS = {
  publications: 'Tudo o que publicamos para a sua marca neste mês, somando todos os canais.',
  views: 'Vezes que os seus conteúdos apareceram na tela de alguém. A mesma pessoa pode ver várias vezes.',
  reach: 'Pessoas diferentes que viram pelo menos um conteúdo seu.',
  followers: 'Pessoas que seguem o seu perfil.',
  stories: 'Stories são publicações que ficam 24 horas no ar, no topo do Instagram.',
  storyViews: ' O número em cada arte é quantas vezes ela foi vista.',
  feed: 'Posts são publicações que ficam fixas no seu perfil.',
  likes: ' Curtida é quando alguém tocou no coração para dizer que gostou.',
  flyers: 'Encartes de ofertas publicados no mês.',
};

const REPORT_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#1a1a1d;color:#111;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;line-height:1.25;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 20px;background:#0b0b0c;color:#fff;font-size:14px}
.bar button{background:#FFD100;color:#111;border:0;border-radius:8px;padding:9px 16px;font-weight:700;font-size:14px;cursor:pointer}
.pages{display:flex;flex-wrap:wrap;gap:20px;justify-content:center;padding:24px 16px 48px}
.page{width:360px;height:640px;background:#fff;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.top{background:#0b0b0c;color:#fff;padding:15px 20px;display:flex;align-items:center;gap:11px;font-size:15px;min-height:63px}
.top img{width:33px;height:33px;border-radius:7px;object-fit:cover}
.body{padding:23px 23px 20px;flex:1;display:flex;flex-direction:column;min-height:0}
.kicker{font-size:14px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#6b6b6b}
.month{font-size:35px;font-weight:800;letter-spacing:-.02em;margin-top:3px}
.partial{font-size:14px;color:#6b6b6b;margin-top:4px}
.client{display:flex;flex-direction:column;align-items:flex-start;gap:10px;margin-top:20px}
.client img{height:72px;width:auto;max-width:100%;border-radius:10px;border:1px solid #e3e3e3;object-fit:contain;background:#fff}
.client .initial{width:57px;height:57px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#0b0b0c;color:#fff;font-weight:800;font-size:24px}
.client b{display:block;font-size:20px}
.client span{font-size:16px;color:#6b6b6b}
.hero{margin-top:auto}
.hero .num{font-size:127px;font-weight:800;letter-spacing:-.04em;line-height:.9}
.hero .lbl{font-size:21px;font-weight:600;margin-top:7px}
.mark{background:#FFD100;padding:0 8px;border-radius:5px}
.chips{display:flex;gap:10px;margin-top:17px;flex-wrap:wrap}
.chip{font-size:16px;font-weight:600;border:1.5px solid #111;border-radius:99px;padding:5px 13px}
h2{font-size:25px;font-weight:800;letter-spacing:-.01em;margin:0 0 5px}
.sub{font-size:16px;color:#555;margin:0 0 6px}
.hint{font-size:13px;line-height:1.35;color:#6b6b6b;margin:0 0 13px}
.stat{margin:8px 0 16px}
.stat .n{font-size:56px;font-weight:800;letter-spacing:-.03em;line-height:1}
.stat .t{font-size:17.5px;color:#333;margin-top:5px}
.stat .hint{margin:5px 0 0}
.hero .hint{margin:7px 0 0}
.delta{display:inline-block;font-size:16.5px;font-weight:700;background:#FFD100;border-radius:99px;padding:3px 13px;margin-left:10px;vertical-align:middle;letter-spacing:0}
hr{border:0;border-top:1px solid #e3e3e3;margin:0 0 20px}
.grid{display:grid;gap:8px;width:100%;margin:0 auto}
.g3{grid-template-columns:repeat(3,1fr);max-width:288px}
.g2{grid-template-columns:repeat(2,1fr);gap:10px;max-width:270px}
.th{position:relative}
.th img,.th .noimg{width:100%;display:block;border-radius:7px;object-fit:cover;background:#eee}
.g3 .th img,.g3 .th .noimg{aspect-ratio:9/16}
.g2 .th img,.g2 .th .noimg{aspect-ratio:4/5}
.th b{position:absolute;left:5px;bottom:5px;background:rgba(11,11,12,.82);color:#fff;font-size:13px;font-weight:700;border-radius:5px;padding:2px 7px}
.more{font-size:16.5px;color:#555;margin-top:15px;text-align:center}
.foot{margin-top:auto;font-size:12.5px;color:#6b6b6b;border-top:1px solid #e3e3e3;padding-top:12px}
.empty{margin:auto;font-size:20px;color:#555;text-align:center}
@page{size:360px 640px;margin:0}
@media print{body{background:#fff}.bar{display:none}.pages{display:block;padding:0}.page{border-radius:0;box-shadow:none;break-after:page}.page:last-child{break-after:auto}}
`;

export function renderReportPage(report) {
  const { client, agency, audience, followers, stories, feed, flyers } = report;
  const inner = `${client.name} · ${report.monthName}`;
  const pages = [];

  if (report.totals.publications === 0) {
    pages.push({ top: agency.name, body: `<p class="empty">Nenhuma publicação em ${escapeHtml(report.monthLabel.toLowerCase())}.</p>` });
  } else {
    const avatar = client.logoUrl
      ? `<img src="${escapeHtml(client.logoUrl)}" alt="">`
      : `<span class="initial">${escapeHtml(client.initial)}</span>`;
    const total = report.totals.publications;
    pages.push({
      top: agency.name,
      body: `<div class="kicker">Relatório mensal</div>
        <div class="month">${escapeHtml(report.monthLabel)}</div>
        ${report.partial ? `<div class="partial">Parcial até ${escapeHtml(report.partialUntil)}</div>` : ''}
        <div class="client">${avatar}<div><b>${escapeHtml(client.name)}</b><span>${escapeHtml(client.handle)}</span></div></div>
        <div class="hero">
          <div class="num">${formatNumber(total)}</div>
          <div class="lbl"><span class="mark">${total === 1 ? 'publicação' : 'publicações'}</span> no mês</div>
          ${hint(HINTS.publications)}
          <div class="chips">${report.totals.byChannel.map((chip) => `<span class="chip">${escapeHtml(chip.text)}</span>`).join('')}</div>
        </div>`,
    });

    const audienceBlock = audience.views !== null || audience.reach !== null
      ? `<h2>Quem viu a sua marca</h2>${stat(audience.views, 'visualizações do perfil no mês', HINTS.views)}${stat(audience.reach, 'contas alcançadas', HINTS.reach)}`
      : '';
    const followersBlock = followers.total !== null
      ? `${audienceBlock ? '<hr>' : ''}<h2>Seguidores</h2><div class="stat"><div class="n">${formatNumber(followers.total)}${followers.delta !== null ? `<span class="delta">+${formatNumber(followers.delta)} no mês</span>` : ''}</div><div class="t">${report.partial ? `em ${escapeHtml(report.partialUntil)}` : `no fim de ${escapeHtml(report.monthName)}`}</div>${hint(HINTS.followers)}</div>`
      : '';
    if (audienceBlock || followersBlock) pages.push({ top: inner, body: `${audienceBlock}${followersBlock}` });

    if (stories.count > 0) {
      const ranked = stories.measured && stories.more > 0 ? ` · os ${stories.top.length} mais vistos` : '';
      pages.push({
        top: inner,
        body: `<h2>Stories</h2><p class="sub">${formatNumber(stories.count)} no mês${ranked}</p>
          ${hint(`${HINTS.stories}${stories.top.some((story) => story.views !== null) ? HINTS.storyViews : ''}`)}
          <div class="grid g3">${stories.top.map((story) => thumb(story.imageUrl, story.views !== null ? formatNumber(story.views) : '')).join('')}</div>
          ${stories.more > 0 ? `<div class="more">e mais ${countOf(stories.more, ['story', 'stories'])}</div>` : ''}`,
      });
    }

    const feedSub = [
      `${formatNumber(feed.count)} no mês`,
      feed.likes !== null ? countOf(feed.likes, ['curtida', 'curtidas']) : '',
      feed.comments !== null ? countOf(feed.comments, ['comentário', 'comentários']) : '',
    ].filter(Boolean).join(' · ');
    for (const posts of chunk(feed.items, FEED_PER_PAGE)) {
      pages.push({
        top: inner,
        body: `<h2>Posts no feed</h2><p class="sub">${feedSub}</p>
          ${hint(`${HINTS.feed}${feed.likes !== null ? HINTS.likes : ''}`)}
          <div class="grid g2">${posts.map((post) => thumb(post.imageUrl, post.likes !== null ? countOf(post.likes, ['curtida', 'curtidas']) : '')).join('')}</div>`,
      });
    }

    for (const sheets of chunk(flyers.items, FLYERS_PER_PAGE)) {
      pages.push({
        top: inner,
        body: `<h2>Encartes</h2><p class="sub">${formatNumber(flyers.count)} no mês</p>
          ${hint(`${HINTS.flyers}${sheets.some((sheet) => sheet.views !== null) ? HINTS.storyViews : ''}`)}
          <div class="grid g3">${sheets.map((sheet) => thumb(sheet.imageUrl, sheet.views !== null ? formatNumber(sheet.views) : '')).join('')}</div>`,
      });
    }
  }

  if (agency.name) {
    pages[pages.length - 1].body += `<div class="foot">Preparado por ${escapeHtml(agency.name)}${agency.phone ? ` · ${escapeHtml(agency.phone)}` : ''}</div>`;
  }

  const logo = agency.logoUrl ? `<img src="${escapeHtml(agency.logoUrl)}" alt="">` : '';
  const title = `${client.name} — relatório de ${report.monthLabel.toLowerCase()}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="bar"><span>${escapeHtml(title)}</span><button type="button" onclick="window.print()">Salvar PDF</button></div>
<main class="pages">
${pages.map((page) => `<section class="page"><div class="top">${logo}<span>${escapeHtml(page.top)}</span></div><div class="body">${page.body}</div></section>`).join('\n')}
</main>
</body>
</html>`;
}
