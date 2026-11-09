// Static site generator for localvibecheck.site
// Reads data/*.json (plus the channel's YouTube feed, so new uploads show up on their own)
// and writes the finished site to public/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDescription, priceSection } from "./describe.mjs";
import { awardSeal, awardBar, pinSvg } from "./award.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const site = readJson("data/site.json");
const places = readJson("data/places.json");
const biz = readJson("data/businesses.json");
const data = readJson("data/videos.json");
const YEAR = site.year;

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s) => s.toLowerCase().normalize("NFKD").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fmtDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const toSec = (t) => t.split(":").reduce((a, b) => a * 60 + +b, 0);
const telHref = (p) => "tel:+1" + String(p).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const listJoin = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
const plural = (n, w, p = w + "s") => `${n} ${n === 1 ? w : p}`;
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const ext = (url, label) => `<a href="${esc(url)}" rel="noopener" target="_blank">${esc(label ?? host(url))}</a>`;
// Bold the money in a line of copy.
const money = (s) => esc(s).replace(/(\$[\d,.]+(?:[KkM])?\+?(?:\s?[–-]\s?\$[\d,.]+(?:[KkM])?\+?)?(?:\/mo)?)/g, "<b class=\"money\">$1</b>");

function write(rel, html) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

// ---------- YouTube feed ----------
// The channel feed carries the 15 newest uploads with full descriptions. Anything new that
// isn't in data/videos.json yet gets a page built from its description.
const decode = (t) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();
async function loadFeed() {
  if (process.env.SKIP_YOUTUBE_FEED) return [];
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${site.channelId}`, { signal: AbortSignal.timeout(20000), headers: { "user-agent": "LocalVibeCheckSite/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
      const tag = (t) => decode((e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [, ""])[1]);
      return { id: tag("yt:videoId"), title: tag("title"), published: tag("published").slice(0, 10), description: tag("media:description"), link: (e.match(/<link[^>]*href="([^"]+)"/) || [, ""])[1] };
    }).filter((v) => v.id && v.title);
  } catch (err) {
    console.warn(`YouTube feed unavailable (${err.message}); using data/videos.json only.`);
    return [];
  }
}
const cleanTitle = (t) => t.replace(/\s#\S+/g, "").replace(/\p{Extended_Pictographic}\uFE0F?/gu, "").replace(/\s{2,}/g, " ").trim();
const placeByName = Object.entries(places).sort((a, b) => b[1].name.length - a[1].name.length);
function autoVideo(f) {
  const kind = /\/shorts\//.test(f.link) ? "short" : /^business spotlight/i.test(f.title) ? "spotlight" : "guide";
  const title = cleanTitle(f.title);
  const match = placeByName.find(([, p]) => title.toLowerCase().includes(p.name.toLowerCase()));
  return { id: f.id, kind, title: f.title, published: f.published, description: f.description, auto: true,
    slug: slugify(title.replace(/^business spotlight:\s*/i, "").replace(/\(.*?\)/g, "")).slice(0, 70).replace(/-$/, ""),
    headline: title.replace(/^business spotlight:\s*/i, "").replace(/\s*\((?!\d{4}\))[^)]*\)\s*$/, ""), places: match ? [match[0]] : [] };
}
const feed = await loadFeed();
const known = new Set(data.videos.map((v) => v.id));
const fresh = feed.filter((f) => !known.has(f.id)).map(autoVideo);
if (fresh.length) console.log(`YouTube: ${fresh.length} new upload(s) from the feed: ${fresh.map((v) => v.title).join("; ")}`);

// ---------- derived data ----------
const placeObj = (slug) => ({ slug, ...places[slug], url: `/places/${slug}/`, label: places[slug].kind === "state" ? places[slug].name : `${places[slug].name}, ${places[slug].abbr}` });
for (const v of data.videos) for (const p of v.places || []) if (!places[p]) throw new Error(`videos.json ${v.id}: unknown place "${p}"`);
for (const v of data.videos) if (v.business && !biz[v.business]) throw new Error(`videos.json ${v.id}: unknown business "${v.business}"`);

const thumbFor = (id, vertical) => {
  const local = `/img/thumbs/${id}${vertical ? "-v" : ""}.jpg`;
  return fs.existsSync(path.join(ROOT, "static", local)) ? local : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
};
const videos = [...data.videos, ...fresh].map((v) => {
  const parsed = parseDescription(v.description);
  const pl = (v.places || []).map(placeObj);
  const url = v.kind === "spotlight" ? `/spotlight/${v.slug}/` : v.kind === "short" ? null : `/guides/${v.slug}/`;
  return {
    ...v, parsed, places: pl, url,
    headline: v.headline || cleanTitle(v.title),
    placeLabel: pl.length ? pl.map((p) => p.label).join(" · ") : v.placeLabel || "",
    thumb: thumbFor(v.id, false),
    vthumb: thumbFor(v.id, v.kind === "short"),
    yt: v.kind === "short" ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
    label: { guide: "Price guide", pick: "Local pick", spotlight: "Business Spotlight", short: "Short" }[v.kind],
  };
}).sort((a, b) => b.published.localeCompare(a.published));

const byId = Object.fromEntries(videos.map((v) => [v.id, v]));
const guides = videos.filter((v) => v.kind === "guide" || v.kind === "pick");
const spotlights = videos.filter((v) => v.kind === "spotlight");
const shorts = videos.filter((v) => v.kind === "short");
const longform = videos.filter((v) => v.kind !== "short");
for (const v of videos) {
  v.shortVid = v.short ? byId[v.short] : shorts.find((s) => s.guide === v.id);
  if (v.kind === "short") v.parent = v.guide ? byId[v.guide] : null;
  v.biz = v.business ? { name: v.business, ...biz[v.business] } : null;
}
// Award holders: spotlights with an award block.
const awardFiles = (v) => ({ seal: `/awards/${v.slug}-${YEAR}-vibe-check-passed.png`, bar: `/awards/${v.slug}-${YEAR}-vibe-check-passed-bar.png` });
const holders = spotlights.filter((v) => v.award);
const holderFor = (name) => holders.find((h) => h.business === name);

const placeList = Object.keys(places).map(placeObj).map((p) => ({
  ...p,
  videos: videos.filter((v) => v.places.some((x) => x.slug === p.slug)),
})).filter((p) => p.videos.length).sort((a, b) => a.name.localeCompare(b.name));
const categories = [...new Set(guides.map((g) => g.category || "More guides"))];

// ---------- layout ----------
const NAV = [["/guides/", "Price Guides"], ["/spotlight/", "Spotlight"], ["/places/", "Places"], ["/videos/", "Videos"], ["/award/", "The Award"], ["/about/", "About"]];
const logo = (cls = "") => `<span class="logo ${cls}">${pinSvg("lg-" + cls, "logo-pin")}<span class="logo-word">Local Vibe Check</span></span>`;

function layout({ title, description, canonical, body, active = "", ogImage = "/img/og-default.jpg", jsonld = [] }) {
  const full = canonical.startsWith("http") ? canonical : site.url + canonical;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${full}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${full}">
<meta property="og:image" content="${ogImage.startsWith("http") ? ogImage : site.url + ogImage}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b2545">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/img/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="preload" href="/fonts/anton-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/poppins-latin-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/styles.css">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/" aria-label="${esc(site.name)} home">${logo("hd")}</a>
    <button class="menu-toggle" aria-label="Menu" aria-expanded="false" aria-controls="nav"><span></span><span></span><span></span></button>
    <nav class="nav" id="nav">
      ${NAV.map(([h, l]) => `<a href="${h}"${active === h ? ' aria-current="page"' : ""}>${l}</a>`).join("\n      ")}
      <a class="btn btn-navy btn-sm" href="${site.youtube}" rel="noopener" target="_blank">${ytIcon} YouTube</a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <a class="foot-logo" href="/">${logo("ft")}</a>
        <p>${esc(site.tagline)} What things cost, places worth your time, and the local businesses worth calling.</p>
        <a class="btn btn-primary btn-sm" href="${site.youtube}?sub_confirmation=1" rel="noopener" target="_blank">Subscribe on YouTube</a>
      </div>
      <div>
        <h4>Price guides</h4>
        <ul>
          ${guides.slice(0, 7).map((g) => `<li><a href="${g.url}">${esc(g.headline)}</a></li>`).join("\n          ")}
          <li><a href="/guides/">All price guides</a></li>
        </ul>
      </div>
      <div>
        <h4>Places</h4>
        <ul>
          ${placeList.map((p) => `<li><a href="${p.url}">${esc(p.label)}</a></li>`).join("\n          ")}
        </ul>
      </div>
      <div>
        <h4>Local Vibe Check</h4>
        <ul>
          <li><a href="/spotlight/">Business Spotlight</a></li>
          <li><a href="/award/">The Vibe Check award</a></li>
          <li><a href="/videos/">All videos</a></li>
          <li><a href="/how-we-check/">How we check</a></li>
          <li><a href="/about/">About</a></li>
          <li><a href="${site.youtube}" rel="noopener" target="_blank">YouTube</a></li>
        </ul>
      </div>
    </div>
    <div class="legal">© ${YEAR} ${esc(site.name)}. Prices are ballpark ranges as of the date on each guide, taken from published prices and the sources named on the page. They are not a quote. Always get a written estimate.</div>
  </div>
</footer>
<script>
document.querySelector('.menu-toggle').addEventListener('click',function(){var n=document.getElementById('nav');var o=n.classList.toggle('open');this.setAttribute('aria-expanded',o)});
document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){var t=document.getElementById(b.dataset.copy).textContent;navigator.clipboard.writeText(t).then(function(){var l=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=l},1600)})})});
document.querySelectorAll('[data-yt]').forEach(function(b){b.addEventListener('click',function(){var f=document.createElement('iframe');f.src='https://www.youtube-nocookie.com/embed/'+b.dataset.yt+'?autoplay=1&rel=0';f.title=b.getAttribute('aria-label');f.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';f.allowFullscreen=true;b.replaceWith(f)})});
</script>
</body>
</html>
`;
}

const ytIcon = `<svg class="yt-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>`;
const orgLd = { "@context": "https://schema.org", "@type": "Organization", name: site.name, url: site.url, logo: site.url + "/img/icon-512.png", sameAs: [site.youtube] };
const crumbsLd = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: site.url + url })) });
const crumbsHtml = (items) => `<ol class="crumbs">${items.map(([n, u], i) => `<li>${i === items.length - 1 ? esc(n) : `<a href="${u}">${esc(n)}</a>`}</li>`).join("")}</ol>`;
const videoLd = (v) => ({ "@context": "https://schema.org", "@type": "VideoObject", name: v.title, description: (v.parsed.intro[0] || v.headline).slice(0, 500), thumbnailUrl: `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`, uploadDate: v.published, embedUrl: `https://www.youtube.com/embed/${v.id}`, contentUrl: v.yt, ...(v.duration ? { duration: "PT" + v.duration.replace(/^(\d+):(\d+)$/, "$1M$2S") } : {}) });

// ---------- components ----------
const waves = `<svg class="waves" viewBox="0 0 1440 140" preserveAspectRatio="none" aria-hidden="true"><path d="M0 70c180-40 360-40 540 0s360 40 540 0 270-40 360-20v110H0z" fill="#7fd6cc" opacity=".55"/><path d="M0 100c200-36 420-30 640 4s440 34 800-18v54H0z" fill="#ffd3a1" opacity=".8"/><path d="M0 118c260-20 520-14 760 6s460 14 680-8v24H0z" fill="#2cb6bd" opacity=".35"/></svg>`;
const dots = `<span class="dots" aria-hidden="true"></span>`;
const accent = `<span class="accent" aria-hidden="true"></span>`;
const pills = (v) => (v.price ? `<span class="pill pill-price">${esc(v.price)}</span>` : "") + `<span class="pill pill-year">${v.published.slice(0, 4)}</span>`;
const placeLine = (v) => [v.placeLabel, v.topic].filter(Boolean).join(" · ");

const videoFrame = (v, cls = "") => `<div class="video-frame ${cls}" id="video"><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${v.id}?rel=0" title="${esc(v.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>${pinSvg("vf-" + v.id, "frame-pin")}</div>`;

const card = (v) => `<a class="card" href="${v.url}">
  <div class="card-thumb"><img src="${v.thumb}" alt="" loading="lazy" width="640" height="360"><span class="play" aria-hidden="true"></span>${v.duration ? `<span class="dur">${v.duration}</span>` : ""}</div>
  <div class="card-body">
    <span class="card-meta">${esc(v.label)}${v.placeLabel ? ` · ${esc(v.placeLabel)}` : ""}</span>
    <h3>${esc(v.headline)}</h3>
    <div class="card-pills">${v.kind === "spotlight" ? `<span class="pill pill-pass">${checkDot} Vibe check: passed</span>` : pills(v)}</div>
  </div>
</a>`;
const cards = (list) => `<div class="cards">${list.map(card).join("\n")}</div>`;
const checkDot = `<span class="check-dot" aria-hidden="true"></span>`;

const shortCard = (s) => `<figure class="short">
  <button class="short-play" type="button" data-yt="${s.id}" aria-label="Play: ${esc(cleanTitle(s.title))}"><img src="${s.vthumb}" alt="" loading="lazy" width="360" height="640"><span class="play" aria-hidden="true"></span></button>
  <figcaption><b>${esc(cleanTitle(s.title))}</b>${s.parent ? `<a href="${s.parent.url}">Full ${{ pick: "video", spotlight: "spotlight" }[s.parent.kind] || "price guide"} →</a>` : `<a href="${s.yt}" rel="noopener" target="_blank">Watch on YouTube →</a>`}</figcaption>
</figure>`;

const awardStamp = (small) => `<span class="stamp${small ? " stamp-sm" : ""}">${checkDot}<span>Passed</span></span>`;

const steps = `<div class="steps">
  <div class="step"><div><h3>Pick a place and a question</h3><p>One job or one decision in one town: what a kitchen remodel costs in Calabasas, what drain cleaning runs in Iowa City, which agency to call.</p></div></div>
  <div class="step"><div><h3>Pull real, published prices</h3><p>We use prices companies post on their own websites and named cost guides, and we put the date on every number.</p></div></div>
  <div class="step"><div><h3>Break it down by tier</h3><p>What each price tier actually gets you, what moves the number up or down, and the permits, rules and local quirks to plan for.</p></div></div>
  <div class="step"><div><h3>Name a business worth calling</h3><p>Every guide ends with a local business you can call. Business Spotlights go deeper, and the ones that pass earn the Vibe Check award.</p></div></div>
</div>`;

const band = `<section class="band"><div class="wrap"><div><h2>New local guides every week</h2><p>Subscribe on YouTube and catch the next price guide, spotlight and short.</p></div><a class="btn btn-navy" href="${site.youtube}?sub_confirmation=1" rel="noopener" target="_blank">${ytIcon} Subscribe on YouTube</a></div></section>`;

// ---------- description sections ----------
const isMoney = (it) => /\$/.test(it.value) || /\$/.test(it.label);
function tierCards(sec) {
  return `<div class="tiers">${sec.items.map((it, i) => {
    const popular = /most popular|most common/i.test(it.label);
    const name = it.label.replace(/\s*\((most popular|most common)\)/i, "");
    const details = it.detail ? it.detail.split(/;\s*/) : [];
    return `<div class="tier${popular ? " tier-pop" : ""}">
      ${popular ? '<span class="tier-tag">Most popular</span>' : `<span class="tier-num">Tier ${i + 1}</span>`}
      <h3>${esc(name || it.text)}</h3>
      <div class="tier-price">${esc(it.value)}</div>
      ${details.length ? `<ul class="checks">${details.map((d) => `<li>${esc(cap(d))}</li>`).join("")}</ul>` : ""}
    </div>`;
  }).join("")}</div>`;
}
function priceTable(sec) {
  const compare = sec.items.some((it) => / · /.test(it.label));
  const hasNote = sec.items.some((it) => it.detail);
  return `<div class="table-wrap"><table class="ptable${hasNote ? " ptable-wide" : ""}">
    <thead><tr><th scope="col">${compare ? "Company &amp; scope" : "Item"}</th><th scope="col">Price</th>${hasNote ? `<th scope="col">${compare ? "Compared with" : "Notes"}</th>` : ""}</tr></thead>
    <tbody>${sec.items.map((it) => {
      const [who, scope] = it.label.split(" · ");
      const label = compare && scope ? `<b>${esc(who)}</b><span class="muted">${esc(scope)}</span>` : `<b>${esc(it.label || it.text)}</b>`;
      return `<tr><td>${label}</td><td class="num">${esc(it.label ? it.value : "")}</td>${hasNote ? `<td>${money(it.detail)}</td>` : ""}</tr>`;
    }).join("")}</tbody></table></div>`;
}
function bulletList(sec) {
  const tag = sec.ordered ? "ol" : "ul";
  return `<${tag} class="${sec.ordered ? "numbered" : "checks"}">${sec.items.map((it) => `<li>${it.label ? `<b>${esc(it.label)}:</b> ` : ""}${money(it.label ? it.value + (it.detail ? ` (${it.detail})` : "") : it.text)}</li>`).join("")}</${tag}>`;
}
function renderSections(v, skip) {
  return v.parsed.sections.filter((s) => s !== skip).map((s) => {
    if (s.type === "text") return s.heading ? `<h3>${esc(s.heading)}</h3><p>${money(cap(s.text))}</p>` : `<p>${money(cap(s.text))}</p>`;
    const head = `<h3>${esc(s.heading)}${s.value ? ` <span class="h-value">${esc(s.value)}</span>` : ""}</h3>`;
    const moneyRows = s.items.filter(isMoney).length;
    const body = !s.ordered && s.items.length > 1 && moneyRows === s.items.length && s.items.every((it) => it.label && it.value.length < 60) ? priceTable(s) : bulletList(s);
    return head + body + (s.foot.length ? `<p class="foot">${s.foot.map(money).join(" ")}</p>` : "");
  }).join("\n");
}
const chaptersBlock = (v) => v.parsed.chapters.length ? `<details class="chapters"><summary>In this video: ${plural(v.parsed.chapters.length, "chapter")}</summary><ol>${v.parsed.chapters.map(([t, l]) => `<li><a href="https://www.youtube.com/watch?v=${v.id}&amp;t=${toSec(t)}s" rel="noopener" target="_blank"><span class="ts">${t}</span>${esc(l)}</a></li>`).join("")}</ol></details>` : "";

// The "give them a shout" card for the business a video names.
function bizCard(v, heading = "Give them a shout") {
  const b = v.biz || {};
  const cta = v.parsed.cta || {};
  const name = b.name || v.parsed.pick || "";
  if (!name && !cta.heading) return "";
  const phone = cta.phone || b.phone;
  const website = cta.website || b.website;
  const addresses = cta.address.length ? cta.address : (b.locations || []).filter((l) => /\d/.test(l.address)).map((l) => l.address);
  const features = cta.features.length ? cta.features : b.summary ? [b.summary] : [];
  const holder = holderFor(b.name);
  return `<section class="biz" id="business" aria-label="${esc(name)}">
    <div class="biz-head">
      ${b.logo ? `<img class="biz-logo" src="${b.logo}" alt="" width="64" height="64">` : `<span class="biz-pin">${pinSvg("bz-" + v.id, "pin")}</span>`}
      <div><span class="eyebrow">${esc(heading)}</span><h2>${esc(b.legalName || name)}</h2>${b.type ? `<p class="muted">${esc(b.type)}${v.placeLabel ? ` · ${esc(v.placeLabel)}` : ""}</p>` : ""}</div>
      ${holder ? `<a class="biz-award" href="${holder.url}" title="Vibe check: passed. See the Business Spotlight">${awardSeal({ id: "ba-" + v.id, line: holder.award.line, year: YEAR, title: `${holder.business}: Vibe check passed, Local Vibe Check Business Spotlight ${YEAR}` })}</a>` : ""}
    </div>
    ${cta.heading ? `<p class="biz-lede">${esc(cta.heading.replace(/[.:]$/, ""))}.</p>` : ""}
    ${cta.lines.filter((l) => !/:$/.test(l)).map((l) => `<p>${money(l)}</p>`).join("")}
    ${features.length ? `<ul class="checks">${features.map((f) => `<li>${money(f.charAt(0).toUpperCase() + f.slice(1))}</li>`).join("")}</ul>` : ""}
    <ul class="links">
      ${phone ? `<li><span class="lk">Phone</span><span><a href="${telHref(phone)}">${esc(phone)}</a></span></li>` : ""}
      ${website ? `<li><span class="lk">Website</span><span>${ext(website, host(website) + new URL(website).pathname.replace(/\/$/, ""))}</span></li>` : ""}
      ${cta.email || b.email ? `<li><span class="lk">Email</span><span><a href="mailto:${esc(cta.email || b.email)}">${esc(cta.email || b.email)}</a></span></li>` : ""}
      ${addresses.map((a) => `<li><span class="lk">Address</span><span>${ext("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent((b.legalName || name) + " " + a.replace(/^[^:]+:\s*/, "")), a)}</span></li>`).join("")}
      ${cta.hours || b.hours ? `<li><span class="lk">Hours</span><span>${esc(cta.hours || b.hours)}</span></li>` : ""}
      ${cta.serving || b.serves ? `<li><span class="lk">Serving</span><span>${esc((cta.serving || b.serves).replace(/^Serving\s+/i, ""))}</span></li>` : ""}
    </ul>
    <div class="biz-actions">${phone ? `<a class="btn btn-primary" href="${telHref(phone)}">Call ${esc(phone)}</a>` : ""}${website ? `<a class="btn btn-outline" href="${esc(website)}" rel="noopener" target="_blank">Visit website</a>` : ""}${holder ? `<a class="btn btn-outline" href="${holder.url}">Watch their spotlight</a>` : ""}</div>
  </section>`;
}

const embedBlock = (id, heading, text, png, alt, url, w, h) => {
  const code = `<a href="${site.url}${url}" target="_blank" rel="noopener"><img src="${site.url}${png}" alt="${esc(alt)}" width="${w}" height="${h}"></a>`;
  return `<div class="embed">
  <div>
    <h3>${heading}</h3>
    <p>${text}</p>
    <pre id="${id}">${esc(code)}</pre>
    <button class="btn btn-outline btn-sm" data-copy="${id}" type="button">Copy embed code</button>
  </div>
  <div class="preview"><img src="${png}" alt="${esc(alt)}" width="${w}" height="${h}"><a href="${png}" download>Download PNG</a></div>
</div>`;
};

// ---------- pages ----------
function homePage() {
  const latest = longform[0];
  const spot = spotlights[0];
  const body = `
<section class="hero">
  ${dots}
  <div class="wrap hero-grid">
    <div>
      <span class="tag">${checkDot} Price guides · Places · Trusted local businesses</span>
      <h1>Local prices, <span class="hl">checked.</span></h1>
      <p class="subline">What it costs and who to call, town by town.</p>
      ${accent}
      <p class="lede">We break down real local prices for kitchens, roofs, drains, ADUs and more, compare what companies actually publish, and point you to the local businesses worth calling. Every guide is a short video with the numbers written out here.</p>
      <div class="actions"><a class="btn btn-primary" href="/guides/">Browse price guides</a><a class="btn btn-outline" href="${site.youtube}" rel="noopener" target="_blank">${ytIcon} Watch on YouTube</a></div>
    </div>
    <a class="hero-feature" href="${latest.url}">
      <span class="tilt"><img src="${latest.thumb}" alt="${esc(latest.title)}" width="640" height="360"></span>
      <span class="stamp-round"><b>New</b>${esc(latest.label)}</span>
      ${pinSvg("hero-pin", "hero-pin")}
    </a>
  </div>
  ${waves}
</section>
<div class="stats"><div class="wrap stats-grid">
  <div class="stat"><div class="v">${guides.length}</div><div class="k">Price guides</div></div>
  <div class="stat"><div class="v">${videos.length}</div><div class="k">Videos &amp; shorts</div></div>
  <div class="stat"><div class="v">${placeList.length}</div><div class="k">Places covered</div></div>
  <div class="stat"><div class="v">${spotlights.length}</div><div class="k">Business spotlight${spotlights.length === 1 ? "" : "s"}</div></div>
</div></div>

${spot ? `<section class="section spot-feature">
  <div class="wrap spot-grid">
    <div>
      <span class="eyebrow eyebrow-light">New series · Business Spotlight</span>
      <p class="vibe-line">Vibe check:</p>
      ${awardStamp()}
      <h2 class="spot-biz">${esc(spot.biz?.legalName || spot.headline)}</h2>
      <p>${esc(spot.biz?.summary || spot.parsed.intro[1] || spot.parsed.intro[0] || "")}</p>
      <div class="actions"><a class="btn btn-primary" href="${spot.url}">See the spotlight</a><a class="btn btn-ghost" href="/award/">About the award</a></div>
    </div>
    <div class="spot-media">
      ${videoFrame(spot, "frame-dark")}
    </div>
  </div>
</section>` : ""}

<section class="section">
  <div class="wrap">
    <div class="section-head"><div><span class="eyebrow">Latest</span><h2>Price guides</h2></div><p>Each guide comes with the full video, every price tier written out, and a local business you can call. <a href="/guides/">All guides</a></p></div>
    ${cards(guides.slice(0, 9))}
  </div>
</section>

<section class="section section-alt" id="places">
  <div class="wrap">
    <div class="section-head"><div><span class="eyebrow">Browse</span><h2>By place</h2></div><p>Every guide is filed under the town it covers.</p></div>
    <div class="tiles">${placeList.map((p) => `<a class="tile" href="${p.url}">${pinSvg("t-" + p.slug, "tile-pin")}<span><b>${esc(p.label)}</b><span>${plural(p.videos.length, "video")}</span></span></a>`).join("")}</div>
  </div>
</section>

${shorts.length ? `<section class="section">
  <div class="wrap">
    <div class="section-head"><div><span class="eyebrow">Shorts</span><h2>The 60-second versions</h2></div><p>The price ranges in under a minute. Tap to play.</p></div>
    <div class="shorts">${shorts.map(shortCard).join("")}</div>
  </div>
</section>` : ""}

${holders.length ? `<section class="section section-alt">
  <div class="wrap award-feature">
    <div class="award-art">${awardSeal({ id: "home-aw", line: holders[0].award.line, year: YEAR, title: "Vibe Check: Passed award" })}</div>
    <div>
      <span class="eyebrow">The award</span>
      <h2>Vibe check: passed</h2>
      <p>Every business featured in our Business Spotlight series earns the Vibe Check award: a seal for their website, socials and storefront that links back to the video that earned it.</p>
      <p class="muted">${plural(holders.length, "business", "businesses")} so far: ${listJoin(holders.map((h) => `<a href="${h.url}">${esc(h.business)}</a>`))}.</p>
      <div class="actions"><a class="btn btn-primary" href="/award/">About the award</a></div>
    </div>
  </div>
</section>` : ""}

<section class="section">
  <div class="wrap">
    <div class="section-head"><div><span class="eyebrow">How we check</span><h2>How a guide is made</h2></div><p><a href="/how-we-check/">Read the details</a></p></div>
    ${steps}
  </div>
</section>
${band}`;
  return layout({
    title: `${site.name} | Local price guides & trusted local businesses (${YEAR})`,
    description: `Local Vibe Check breaks down what things really cost in your town, from kitchen remodels in Westlake Village to drain cleaning in Iowa City, and names the local businesses worth calling. ${guides.length} video price guides and counting.`,
    canonical: "/", body,
    jsonld: [orgLd, { "@context": "https://schema.org", "@type": "WebSite", name: site.name, url: site.url }],
  });
}

function guidesIndex() {
  const trail = [["Home", "/"], ["Price Guides", "/guides/"]];
  const body = `
<section class="hero hero-sub">${dots}<div class="wrap">
  ${crumbsHtml(trail)}
  <span class="tag">${checkDot} ${YEAR} price guides</span>
  <h1>Every price guide</h1>
  <p class="lede">${plural(guides.length, "guide")} across ${plural(placeList.length, "place")}. Pick your town and project, watch the breakdown, and see who to call.</p>
</div>${waves}</section>
<section class="section"><div class="wrap">
  <div class="section-head"><div><span class="eyebrow">All guides</span><h2>Newest first</h2></div></div>
  ${cards(guides)}
</div></section>
<section class="section section-alt"><div class="wrap">
  <div class="section-head"><div><span class="eyebrow">Browse</span><h2>By topic</h2></div></div>
  ${categories.map((c) => `<h3 class="cat-title">${esc(c)}</h3><div class="cat-list">${guides.filter((g) => (g.category || "More guides") === c).map((g) => `<div class="cat"><h4><a href="${g.url}">${esc(g.headline)}</a></h4><p>${esc(placeLine(g))}</p><p>${pills(g)}</p></div>`).join("")}</div>`).join("\n")}
</div></section>
${band}`;
  return layout({ title: `All ${YEAR} Price Guides | ${site.name}`, description: `Browse ${guides.length} Local Vibe Check price guides: ${guides.slice(0, 5).map((g) => g.headline.toLowerCase()).join(", ")} and more.`, canonical: "/guides/", body, active: "/guides/", jsonld: [crumbsLd(trail)] });
}

function guidePage(v) {
  const pl = v.places[0];
  const trail = [["Home", "/"], ["Price Guides", "/guides/"], ...(pl ? [[pl.label, pl.url]] : []), [v.headline, v.url]];
  const ps = v.kind === "guide" ? priceSection(v.parsed) : null;
  const useCards = ps && ps.items.length <= 5 && ps.items.some((it) => it.detail);
  const related = guides.filter((g) => g !== v && (g.places.some((p) => v.places.some((q) => q.slug === p.slug)) || (g.topic && g.topic === v.topic))).slice(0, 3);
  const intro = v.parsed.intro;
  const body = `
<section class="hero guide-hero">
  ${dots}
  <div class="wrap hero-grid">
    <div>
      ${crumbsHtml(trail)}
      <span class="tag">${checkDot} ${esc(v.label)}${v.placeLabel ? ` · ${esc(v.placeLabel)}` : ""} · ${v.published.slice(0, 4)}</span>
      <h1>${esc(v.headline)}</h1>
      ${v.topic ? `<p class="subline">${esc(placeLine(v))}</p>` : ""}
      ${accent}
      <div class="hero-pills">${v.kind === "pick" && v.parsed.pick ? `<span class="pill pill-price">Top pick: ${esc(v.parsed.pick)}</span><span class="pill pill-year">${v.published.slice(0, 4)}</span>` : pills(v)}</div>
      <p class="meta">Published ${fmtDate(v.published)}${v.duration ? ` · ${v.duration} video` : ""} · <a href="${v.yt}" rel="noopener" target="_blank">Watch on YouTube</a></p>
    </div>
    <div class="hero-media">${videoFrame(v)}</div>
  </div>
  ${waves}
</section>

<section class="section">
  <div class="wrap layout">
    <article class="prose">
      ${intro.map((p, i) => `<p${i === 0 ? ' class="intro"' : ""}>${money(p)}</p>`).join("\n      ")}
      ${chaptersBlock(v)}
      ${ps ? `<h2 id="prices">${esc(ps.heading)}${ps.value ? ` <span class="h-value">${esc(ps.value)}</span>` : ""}</h2>${useCards ? tierCards(ps) : priceTable(ps)}${ps.foot.length ? `<p class="foot">${ps.foot.map(money).join(" ")}</p>` : ""}` : ""}
      ${v.parsed.sections.filter((s) => s !== ps).length ? `<h2>${v.kind === "pick" ? "The breakdown" : "What else to know"}</h2>` : ""}
      ${renderSections(v, ps)}
      ${v.shortVid ? `<div class="short-inline"><div><span class="eyebrow">Short</span><h3>The 60-second version</h3><p>The same ${v.kind === "pick" ? "pick" : "prices"}, in under a minute. Good for sending to whoever you're splitting the bill with.</p><a href="${v.shortVid.yt}" rel="noopener" target="_blank">Open on YouTube Shorts →</a></div>${shortCard(v.shortVid)}</div>` : ""}
      ${bizCard(v, v.kind === "pick" ? "Our top pick" : /best option/i.test(v.parsed.cta?.heading || "") ? "Best option" : "Give them a shout")}
      ${v.parsed.links.length ? `<h3>Sources &amp; links</h3><ul class="checks">${v.parsed.links.map((l) => `<li>${esc(l.label.replace(/^Our top pick:\s*/i, ""))}: ${ext(l.url, host(l.url) + new URL(l.url).pathname.replace(/\/$/, ""))}</li>`).join("")}</ul>` : ""}
      ${v.parsed.notes.length ? `<div class="notice" role="note">${v.parsed.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>` : ""}
    </article>
    <aside class="facts" aria-label="Guide facts">
      <dl>
        <div class="row"><dt>Type</dt><dd>${esc(v.label)}</dd></div>
        ${v.topic ? `<div class="row"><dt>Topic</dt><dd>${esc(v.topic)}</dd></div>` : ""}
        <div class="row"><dt>Place</dt><dd>${v.places.length ? v.places.map((p) => `<a href="${p.url}">${esc(p.label)}</a>`).join(", ") : esc(v.placeLabel || "—")}</dd></div>
        ${v.range ? `<div class="row"><dt>Price range</dt><dd>${esc(v.range)}</dd></div>` : ""}
        ${v.business ? `<div class="row"><dt>${v.kind === "pick" ? "Top pick" : "Call"}</dt><dd><a href="#business">${esc(v.business)}</a></dd></div>` : ""}
        <div class="row"><dt>Published</dt><dd>${fmtDate(v.published)}</dd></div>
        ${v.duration ? `<div class="row"><dt>Video</dt><dd>${v.duration}</dd></div>` : ""}
      </dl>
      <div class="cta"><a class="btn btn-navy" href="${v.yt}" rel="noopener" target="_blank">${ytIcon} Watch on YouTube</a>${(v.parsed.cta?.phone || v.biz?.phone) ? `<a class="btn btn-primary" href="${telHref(v.parsed.cta?.phone || v.biz.phone)}">Call ${esc(v.business || "")}</a>` : ""}</div>
    </aside>
  </div>
</section>
${related.length ? `<section class="section section-alt"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Keep going</span><h2>Related guides</h2></div></div>${cards(related)}</div></section>` : ""}
${band}`;
  const desc = v.kind === "pick"
    ? `${v.headline} Our ${YEAR} pick is ${v.parsed.pick || v.business}. Watch the video and read the breakdown.`
    : `${v.headline} (${YEAR}): ${v.range || v.price || ""}. Watch the Local Vibe Check video, see every price tier, and find ${v.business ? v.business : "a local business"} to call.`;
  return layout({ title: `${v.headline} (${YEAR}) | ${site.name}`, description: desc, canonical: v.url, body, ogImage: `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`, active: "/guides/", jsonld: [crumbsLd(trail), videoLd(v)] });
}

function spotlightIndex() {
  const trail = [["Home", "/"], ["Business Spotlight", "/spotlight/"]];
  const body = `
<section class="hero hero-dark hero-sub"><div class="wrap">
  ${crumbsHtml(trail)}
  <span class="eyebrow eyebrow-light">Series</span>
  <h1>Business Spotlight</h1>
  <p class="lede">Short videos on local businesses worth knowing: what they do, how they work, and what their customers say. Every business we spotlight earns the <a href="/award/">Vibe Check award</a>.</p>
</div></section>
<section class="section"><div class="wrap">
  ${spotlights.map((s) => `<a class="spot-row" href="${s.url}">
    <img src="${s.thumb}" alt="" width="640" height="360" loading="lazy">
    <div><span class="card-meta">${esc(s.placeLabel)} · ${fmtDate(s.published)}</span><h2>${esc(s.biz?.legalName || s.headline)}</h2><p>${esc(s.parsed.intro[0] || "")}</p><span class="pill pill-pass">${checkDot} Vibe check: passed</span></div>
  </a>`).join("")}
  <div class="nominate"><h2>Know a business that deserves a Local Vibe Check?</h2><p>Tell us in the comments on any of our videos. We read them all.</p><a class="btn btn-primary" href="${spotlights[0] ? spotlights[0].yt : site.youtube}" rel="noopener" target="_blank">Comment on YouTube</a></div>
</div></section>
${band}`;
  return layout({ title: `Business Spotlight | ${site.name}`, description: `The Local Vibe Check Business Spotlight series: ${spotlights.map((s) => s.business || s.headline).join(", ")}.`, canonical: "/spotlight/", body, active: "/spotlight/", jsonld: [crumbsLd(trail)] });
}

function spotlightPage(v) {
  const trail = [["Home", "/"], ["Business Spotlight", "/spotlight/"], [v.biz?.legalName || v.headline, v.url]];
  const b = v.biz || {};
  const name = b.legalName || v.headline;
  const how = v.parsed.sections.find((s) => s.type === "list" && /how it works/i.test(s.heading));
  // Any other lists in the description ("When a storm hits", "The Cuevas promise", ...).
  const extra = v.parsed.sections.filter((s) => s.type === "list" && s !== how);
  const vibe = v.parsed.sections.find((s) => s.type === "text" && /vibe/i.test(s.heading));
  const files = v.award ? awardFiles(v) : null;
  const sealTitle = `${v.business || name}: Vibe check passed. Local Vibe Check Business Spotlight ${YEAR}`;
  const locs = b.locations || [];
  const inVideo = (v.parsed.intro.find((p) => /In this video:/.test(p)) || "").replace(/^.*?In this video:\s*/, "");
  const body = `
<section class="hero hero-dark spot-hero">
  <div class="wrap hero-grid">
    <div>
      ${crumbsHtml(trail)}
      <span class="eyebrow eyebrow-light">${pinSvg("sh-pin", "inline-pin")} Business Spotlight${v.regionLabel || v.placeLabel ? ` · ${esc(v.regionLabel || v.placeLabel)}` : ""}</span>
      <p class="vibe-line">Vibe check:</p>
      ${awardStamp()}
      <div class="spot-name">${b.logo ? `<img src="${b.logo}" alt="" width="72" height="72">` : ""}<h1>${esc(name)}</h1></div>
      ${locs.length ? `<p class="spot-locs">${pinSvg("sl-pin", "inline-pin")} ${plural(locs.length, "location")}: ${esc(locs.map((l) => l.label).join(", "))}</p>` : ""}
      <p class="meta">Published ${fmtDate(v.published)}${v.duration ? ` · ${v.duration} video` : ""} · <a href="${v.yt}" rel="noopener" target="_blank">Watch on YouTube</a></p>
    </div>
    <div class="hero-media">${videoFrame(v, "frame-dark")}</div>
  </div>
</section>

<section class="section">
  <div class="wrap layout">
    <article class="prose">
      ${v.parsed.intro.slice(1).filter((p) => !(b.services && /^What they build:/.test(p))).map((p, i) => `<p${i === 0 ? ' class="intro"' : ""}>${money(p)}</p>`).join("\n      ")}
      ${b.services ? `<h2>What they do</h2><ul class="chips">${b.services.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>${inVideo ? `<p class="muted">In this video: ${esc(inVideo)}</p>` : ""}` : ""}
      ${chaptersBlock(v)}
      ${how ? `<h2>How it works</h2><ol class="step-list">${how.items.map((it) => `<li><b>${esc(it.label)}</b><span>${esc(it.value)}</span></li>`).join("")}</ol>` : ""}
      ${extra.map((s) => `<h2>${esc(s.heading)}</h2>${bulletList(s)}`).join("\n      ")}
      ${v.shortVid ? `<div class="short-inline"><div><span class="eyebrow">Short</span><h3>The quick version</h3><p>The whole spotlight in under a minute. Easy to share with anyone looking for ${esc((b.type || "a pro").toLowerCase())} help.</p><a href="${v.shortVid.yt}" rel="noopener" target="_blank">Open on YouTube Shorts →</a></div>${shortCard(v.shortVid)}</div>` : ""}
      ${vibe ? `<h2>The vibe from clients</h2><p class="big-quote">${esc(vibe.text.charAt(0).toUpperCase() + vibe.text.slice(1))}</p>` : ""}
      ${locs.length ? `<h2>Locations</h2><div class="locs">${locs.map((l) => `<div class="loc">${pinSvg("lc-" + slugify(l.label), "pin")}<div><b>${esc(l.label)}</b><span>${/\d/.test(l.address) ? ext("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(name + " " + l.address), l.address) : esc(l.address)}</span></div></div>`).join("")}</div>` : ""}
      ${b.serves ? `<p class="muted">Serving ${esc(b.serves)}.</p>` : ""}
      <div class="estimate">
        <div><span class="eyebrow">Get a free estimate</span><h3>${esc(b.legalName || name)}</h3><p>${[b.phone && `Call <a href="${telHref(b.phone)}">${esc(b.phone)}</a>`, b.hours, b.license].filter(Boolean).join(" · ")}</p></div>
        <div class="biz-actions">${b.phone ? `<a class="btn btn-primary" href="${telHref(b.phone)}">Call ${esc(b.phone)}</a>` : ""}${b.website ? `<a class="btn btn-outline" href="${esc(b.website)}" rel="noopener" target="_blank">Visit ${esc(host(b.website))}</a>` : ""}</div>
      </div>

      ${files ? `<h2 id="award">The Vibe Check award</h2>
      <div class="award-hero">
        <div class="award-art">${awardSeal({ id: "sp-aw", line: v.award.line, year: YEAR, title: sealTitle })}</div>
        <div>
          <p><b>${esc(v.business)}</b> passed the Local Vibe Check and was featured in our Business Spotlight series on ${fmtDate(v.award.awarded || v.published)}.</p>
          <p>${esc(v.business)} may display the award on its website, social profiles, vehicles and printed materials. Each badge links back to this page, so customers can watch the spotlight for themselves.</p>
        </div>
      </div>
      ${embedBlock("code-seal", "Award seal", "The round seal, for websites, socials and print.", files.seal, sealTitle, v.url, 200, 200)}
      ${embedBlock("code-bar", "Footer badge", "A horizontal version for website footers and email signatures.", files.bar, sealTitle, v.url, 300, 83)}` : ""}
      ${v.parsed.notes.length ? `<div class="notice" role="note">${v.parsed.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>` : ""}
      ${v.parsed.nominate ? `<div class="nominate"><h2>Know a business that deserves a Local Vibe Check?</h2><p>Tell us in the comments on the video.</p><a class="btn btn-primary" href="${v.yt}" rel="noopener" target="_blank">Comment on YouTube</a></div>` : ""}
    </article>
    <aside class="facts" aria-label="Business facts">
      <dl>
        <div class="row"><dt>Business</dt><dd>${esc(name)}</dd></div>
        ${b.type ? `<div class="row"><dt>Type</dt><dd>${esc(b.type)}</dd></div>` : ""}
        ${b.license ? `<div class="row"><dt>License</dt><dd>${esc(b.license)}</dd></div>` : ""}
        ${b.phone ? `<div class="row"><dt>Phone</dt><dd><a href="${telHref(b.phone)}">${esc(b.phone)}</a></dd></div>` : ""}
        ${v.places.length ? `<div class="row"><dt>Places</dt><dd>${v.places.map((p) => `<a href="${p.url}">${esc(p.name)}</a>`).join(", ")}</dd></div>` : ""}
        <div class="row"><dt>Spotlight</dt><dd>${fmtDate(v.published)}</dd></div>
        ${v.award ? `<div class="row"><dt>Award</dt><dd><a href="#award">Vibe check: passed</a></dd></div>` : ""}
      </dl>
      <div class="cta"><a class="btn btn-navy" href="${v.yt}" rel="noopener" target="_blank">${ytIcon} Watch on YouTube</a>${b.phone ? `<a class="btn btn-primary" href="${telHref(b.phone)}">Call ${esc(b.phone)}</a>` : ""}${b.youtube ? `<a class="btn btn-outline" href="${esc(b.youtube)}" rel="noopener" target="_blank">Their YouTube channel</a>` : ""}</div>
    </aside>
  </div>
</section>
${guides.some((g) => g.business === v.business) ? `<section class="section section-alt"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Also featuring ${esc(v.business)}</span><h2>Their price guides</h2></div></div>${cards(guides.filter((g) => g.business === v.business))}</div></section>` : ""}
${band}`;
  const ld = [crumbsLd(trail), videoLd(v)];
  if (b.website) ld.push({ "@context": "https://schema.org", "@type": "GeneralContractor", name, url: b.website, telephone: b.phone, ...(locs.filter((l) => /\d/.test(l.address)).length ? { address: locs.filter((l) => /\d/.test(l.address)).map((l) => l.address) } : {}), ...(v.award ? { award: `Vibe Check: Passed, Local Vibe Check Business Spotlight ${YEAR}` } : {}) });
  return layout({ title: `Business Spotlight: ${name} | ${site.name}`, description: `${name}: ${(v.parsed.intro[0] || "").replace(/\s+On this Local Vibe Check.*$/, "")} Watch the Local Vibe Check Business Spotlight. Vibe check: passed.`, canonical: v.url, body, ogImage: `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`, active: "/spotlight/", jsonld: ld });
}

function awardPage() {
  const trail = [["Home", "/"], ["The Award", "/award/"]];
  const first = holders[0];
  const body = `
<section class="hero hero-dark hero-sub"><div class="wrap">
  ${crumbsHtml(trail)}
  <span class="eyebrow eyebrow-light">Recognition</span>
  <h1>The Vibe Check award</h1>
  <p class="lede">One seal, earned on camera. Every business featured in our Business Spotlight series has passed the Local Vibe Check, and gets a badge that links back to the video.</p>
</div></section>
<section class="section"><div class="wrap">
  <div class="award-duo">
    <div class="award-card"><div class="award-art">${awardSeal({ id: "ap-seal", line: first ? first.award.line : "Business Spotlight", year: YEAR, title: "Vibe Check: Passed award seal" })}</div><div><span class="eyebrow">The seal</span><h3>Vibe check: passed</h3><p>The round seal for websites, social profiles, vehicles and storefront windows. It names the business type and area, and the year it was earned.</p></div></div>
    <div class="award-card"><div class="award-art award-art-bar">${awardBar({ id: "ap-bar", year: YEAR, title: "Vibe Check: Passed footer badge" })}</div><div><span class="eyebrow">The footer badge</span><h3>For websites and email</h3><p>A horizontal version that fits in a website footer or an email signature.</p></div></div>
  </div>
  <div class="prose" style="max-width:780px;margin-top:48px">
    <h2>What we check before a spotlight</h2>
    <ul class="checks">
      <li><b>A real local presence.</b> An address, a phone that gets answered, and a service area that makes sense.</li>
      <li><b>Licensed and insured where the trade requires it,</b> with the license number shown where we can.</li>
      <li><b>What customers say.</b> Ratings read alongside how many reviews back them up.</li>
      <li><b>A clear way to work with them.</b> Free consultations, written estimates or published prices, and one point of contact.</li>
    </ul>
    <h2>Who can display it</h2>
    <p>Only businesses featured in a Local Vibe Check Business Spotlight. The embed code and PNG downloads are on each business's spotlight page, and every badge links back to that page.</p>
    <h2>Know a business that deserves one?</h2>
    <p>Tell us in the comments on any <a href="${site.youtube}" rel="noopener" target="_blank">Local Vibe Check video</a>.</p>
  </div>
</div></section>
<section class="section section-alt"><div class="wrap">
  <div class="section-head"><div><span class="eyebrow">${YEAR}</span><h2>Award holders</h2></div></div>
  <div class="holders">${holders.map((h) => `<a class="holder" href="${h.url}#award">${awardSeal({ id: "hd-" + h.slug, line: h.award.line, year: YEAR, title: `${h.business}: Vibe check passed` })}<div><b>${esc(h.biz?.legalName || h.business)}</b><span>${esc(h.placeLabel)}</span><span>Awarded ${fmtDate(h.award.awarded || h.published)}</span></div></a>`).join("")}</div>
</div></section>
${band}`;
  return layout({ title: `The Vibe Check Award | ${site.name}`, description: "The Vibe Check: Passed award from Local Vibe Check, given to every business featured in our Business Spotlight series. Who holds it and how to display it.", canonical: "/award/", body, active: "/award/", jsonld: [crumbsLd(trail)] });
}

function placesIndex() {
  const trail = [["Home", "/"], ["Places", "/places/"]];
  const states = [...new Set(placeList.map((p) => p.state))].sort();
  const body = `
<section class="hero hero-sub">${dots}<div class="wrap">
  ${crumbsHtml(trail)}
  <span class="tag">${checkDot} Places</span>
  <h1>Every place we've checked</h1>
  <p class="lede">${plural(placeList.length, "place")} so far, from the Westside of L.A. to Eastern Iowa.</p>
</div>${waves}</section>
<section class="section"><div class="wrap">
  ${states.map((s) => `<h2 class="cat-title">${esc(s)}</h2><div class="tiles">${placeList.filter((p) => p.state === s).map((p) => `<a class="tile" href="${p.url}">${pinSvg("pi-" + p.slug, "tile-pin")}<span><b>${esc(p.label)}</b><span>${plural(p.videos.length, "video")}</span></span></a>`).join("")}</div>`).join("\n")}
</div></section>
${band}`;
  return layout({ title: `Places | ${site.name}`, description: `Local Vibe Check price guides and spotlights by place: ${placeList.map((p) => p.name).join(", ")}.`, canonical: "/places/", body, active: "/places/", jsonld: [crumbsLd(trail)] });
}

function placePage(p) {
  const trail = [["Home", "/"], ["Places", "/places/"], [p.label, p.url]];
  const pg = p.videos.filter((v) => v.kind === "guide" || v.kind === "pick");
  const ps = p.videos.filter((v) => v.kind === "spotlight");
  const pshorts = p.videos.filter((v) => v.kind === "short");
  const body = `
<section class="hero hero-sub">${dots}<div class="wrap">
  ${crumbsHtml(trail)}
  <span class="tag">${checkDot} ${esc(p.region || p.state)}</span>
  <h1>${esc(p.name)}</h1>
  <p class="subline">${esc(p.kind === "state" ? "Statewide" : p.state)} · ${plural(p.videos.length, "video")}</p>
  ${accent}
  <p class="lede">${esc(p.blurb)}</p>
</div>${waves}</section>
${ps.length ? `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Business Spotlight</span><h2>Vibe check: passed in ${esc(p.name)}</h2></div></div>${cards(ps)}</div></section>` : ""}
${pg.length ? `<section class="section${ps.length ? " section-alt" : ""}"><div class="wrap"><div class="section-head"><div><span class="eyebrow">${YEAR}</span><h2>${esc(p.name)} price guides</h2></div></div>${cards(pg)}</div></section>` : ""}
${pshorts.length ? `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Shorts</span><h2>Quick hits</h2></div></div><div class="shorts">${pshorts.map(shortCard).join("")}</div></div></section>` : ""}
${band}`;
  return layout({ title: `${p.label} Price Guides & Local Businesses (${YEAR}) | ${site.name}`, description: `What things cost in ${p.label} in ${YEAR}: ${pg.map((g) => (g.topic || g.headline).toLowerCase()).join(", ") || "local videos"}. Watch the Local Vibe Check videos and see who to call.`, canonical: p.url, body, jsonld: [crumbsLd(trail)] });
}

function videosPage() {
  const trail = [["Home", "/"], ["Videos", "/videos/"]];
  const body = `
<section class="hero hero-sub">${dots}<div class="wrap">
  ${crumbsHtml(trail)}
  <span class="tag">${checkDot} ${plural(videos.length, "video")}</span>
  <h1>All videos</h1>
  <p class="lede">Everything on the <a href="${site.youtube}" rel="noopener" target="_blank">Local Vibe Check channel</a>, each with its own page. New uploads show up here on their own.</p>
</div>${waves}</section>
<section class="section"><div class="wrap">
  <div class="section-head"><div><span class="eyebrow">Full videos</span><h2>Newest first</h2></div></div>
  ${cards(longform)}
</div></section>
${shorts.length ? `<section class="section section-alt"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Shorts</span><h2>The 60-second versions</h2></div></div><div class="shorts">${shorts.map(shortCard).join("")}</div></div></section>` : ""}
${band}`;
  const ld = { "@context": "https://schema.org", "@type": "ItemList", name: `${site.name} videos`, itemListElement: longform.map((v, i) => ({ "@type": "ListItem", position: i + 1, url: site.url + v.url, name: v.title })) };
  return layout({ title: `All Videos | ${site.name}`, description: `Every Local Vibe Check video: ${plural(longform.length, "full video")} and ${plural(shorts.length, "short")}, from price guides to business spotlights.`, canonical: "/videos/", body, active: "/videos/", jsonld: [crumbsLd(trail), ld] });
}

function simplePage({ slug, tag, h1, lede, content, title, description }) {
  const trail = [["Home", "/"], [h1, `/${slug}/`]];
  const body = `
<section class="hero hero-sub">${dots}<div class="wrap">
  ${crumbsHtml(trail)}
  <span class="tag">${checkDot} ${tag}</span>
  <h1>${esc(h1)}</h1>
  <p class="lede">${lede}</p>
</div>${waves}</section>
<section class="section page"><div class="wrap">${content}</div></section>
${band}`;
  return layout({ title, description, canonical: `/${slug}/`, body, active: `/${slug}/`, jsonld: [crumbsLd(trail)] });
}

function notFound() {
  return layout({
    title: `Page not found | ${site.name}`, description: "That page doesn't exist.", canonical: "/404.html",
    body: `<section class="hero hero-sub">${dots}<div class="wrap"><span class="tag">${checkDot} 404</span><h1>Vibe check: failed</h1><p class="lede">That page isn't here. The price guides are, though.</p><div class="actions"><a class="btn btn-primary" href="/guides/">Browse price guides</a><a class="btn btn-outline" href="/">Home</a></div></div>${waves}</section>`,
  });
}

// ---------- build ----------
fs.rmSync(OUT, { recursive: true, force: true });
copyDir(path.join(ROOT, "static"), OUT);

write("index.html", homePage());
write("guides/index.html", guidesIndex());
for (const g of guides) write(`guides/${g.slug}/index.html`, guidePage(g));
write("spotlight/index.html", spotlightIndex());
for (const s of spotlights) write(`spotlight/${s.slug}/index.html`, spotlightPage(s));
write("award/index.html", awardPage());
write("places/index.html", placesIndex());
for (const p of placeList) write(`places/${p.slug}/index.html`, placePage(p));
write("videos/index.html", videosPage());
write("how-we-check/index.html", simplePage({
  slug: "how-we-check", tag: "Methodology", h1: "How we check",
  lede: "Real published prices, dated. What each tier gets you. A local business you can call.",
  title: `How We Check | ${site.name}`,
  description: "How Local Vibe Check builds each price guide and Business Spotlight: published prices with dates, named sources, and what we look for in a business.",
  content: `${steps}<div class="prose" style="margin-top:44px">
    <h2>Where the prices come from</h2>
    <ul class="checks">
      <li><b>Published prices.</b> Price tiers come from the pricing pages local businesses publish, and each guide says whose.</li>
      <li><b>Comparisons.</b> When a guide compares companies, every number is as published on that company's own website, with the month we checked.</li>
      <li><b>Benchmarks.</b> National and state averages are credited to their source on the page, like This Old House, SEO.com or a named cost guide.</li>
      <li><b>Dates.</b> Every guide carries the year, and prices change. Treat them as ballpark ranges and get a written estimate for your own project.</li>
    </ul>
    <h2>The business we name</h2>
    <p>Each guide ends with a local business you can call, and the description says who and how to reach them. Our Business Spotlight series goes deeper on one business at a time, and the businesses that pass earn the <a href="/award/">Vibe Check award</a>.</p>
    <h2>Spot something out of date?</h2>
    <p>Let us know in the comments on the video and we'll take another look.</p>
  </div>`,
}));
write("about/index.html", simplePage({
  slug: "about", tag: "About", h1: "About Local Vibe Check",
  lede: esc(site.tagline),
  title: `About | ${site.name}`,
  description: site.about,
  content: `<div class="prose">
    <p class="intro">${esc(site.about)}</p>
    <p>Whether you're planning a trip, renovating your home, hunting for great eats, or just want honest local recommendations, we cut through the noise with clear, useful information.</p>
    <h2>What we make</h2>
    <ul class="checks">
      <li><b><a href="/guides/">Price guides.</a></b> What a project or service really costs in one town, tier by tier.</li>
      <li><b><a href="/spotlight/">Business Spotlights.</a></b> Short videos on local businesses worth knowing, with the <a href="/award/">Vibe Check award</a> for the ones that pass.</li>
      <li><b><a href="/videos/">Shorts.</a></b> The price ranges in under a minute.</li>
    </ul>
    <p>Every video starts on our <a href="${site.youtube}" rel="noopener" target="_blank">YouTube channel</a>. This site is the written version: the numbers, the sources, and how to reach the business.</p>
    <h2>Run a local business?</h2>
    <p>If you've been featured in a Business Spotlight, your award badge is on your spotlight page, ready to embed. Know a business that deserves a Local Vibe Check? Tell us in the comments on any video.</p>
  </div>`,
}));
write("404.html", notFound());

// sitemap + robots + headers
const urls = ["/", "/guides/", ...guides.map((g) => g.url), "/spotlight/", ...spotlights.map((s) => s.url), "/award/", "/places/", ...placeList.map((p) => p.url), "/videos/", "/how-we-check/", "/about/"];
const lastmod = videos[0].published;
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${site.url}${u}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`);
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`);
write("_headers", `/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/img/*\n  Cache-Control: public, max-age=604800\n/awards/*\n  Cache-Control: public, max-age=86400\n  Access-Control-Allow-Origin: *\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`);

// Award sources for the PNG renderer.
const jobs = holders.flatMap((h) => {
  const f = awardFiles(h), title = `${h.business}: Vibe check passed`;
  return [
    { out: f.seal, w: 240, h: 240, svg: awardSeal({ id: "x", line: h.award.line, year: YEAR, title }) },
    { out: f.bar, w: 360, h: 100, svg: awardBar({ id: "x", year: YEAR, title }) },
  ];
});
fs.writeFileSync(path.join(ROOT, "scripts/.award-jobs.json"), JSON.stringify(jobs));
const missing = jobs.filter((j) => !fs.existsSync(path.join(ROOT, "static", j.out)));
if (missing.length) console.warn(`Missing award PNGs (run npm run images): ${missing.map((j) => j.out).join(", ")}`);

console.log(`Built ${urls.length} pages from ${videos.length} videos (${guides.length} guides, ${plural(spotlights.length, "spotlight")}, ${shorts.length} shorts) -> public/`);
