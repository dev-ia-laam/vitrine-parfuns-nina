/* Site vitrine premium Parfums — sans base de données (JSON + CSV/JSONL) */
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = path.join(__dirname, 'data');
const ANALYTICS_FILE = path.join(DATA, 'analytics', 'events.jsonl');
const CONTACTS_FILE = path.join(DATA, 'contacts.csv');

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', etag: true }));

// ---------- helpers ----------
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function loadProducts() { return readJSON(path.join(DATA, 'products.json'), { products: [] }).products || []; }
function loadConfig() { return readJSON(path.join(DATA, 'config.json'), {}); }
function loadI18n(lang) {
  const l = ['fr', 'en', 'es'].includes(lang) ? lang : 'fr';
  return readJSON(path.join(DATA, 'i18n', `${l}.json`), {});
}
function getLang(req) {
  const q = (req.query.lang || '').toLowerCase();
  if (['fr', 'en', 'es'].includes(q)) return q;
  const c = (req.cookies.lang || '').toLowerCase();
  if (['fr', 'en', 'es'].includes(c)) return c;
  return 'fr';
}
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function storageWritable() {
  try { fs.accessSync(DATA, fs.constants.W_OK); fs.accessSync(path.join(DATA, 'analytics'), fs.constants.W_OK); return true; }
  catch { try { fs.accessSync(DATA, fs.constants.W_OK); return true; } catch { return false; } }
}
function ensureFiles() {
  try { fs.mkdirSync(path.join(DATA, 'analytics'), { recursive: true }); } catch {}
  try { if (!fs.existsSync(CONTACTS_FILE)) fs.writeFileSync(CONTACTS_FILE, 'date,nom,email,telephone,message,page,statut\n'); } catch {}
  try { if (!fs.existsSync(ANALYTICS_FILE)) fs.writeFileSync(ANALYTICS_FILE, ''); } catch {}
}
ensureFiles();

function waLink(number, text) {
  const n = String(number || '').replace(/\D/g, '');
  if (!n) return '#contact';
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
function trackEvent(ev) {
  if (!storageWritable()) return false;
  try {
    fs.appendFileSync(ANALYTICS_FILE, JSON.stringify(ev) + '\n');
    return true;
  } catch { return false; }
}
function readEvents() {
  try {
    const raw = fs.readFileSync(ANALYTICS_FILE, 'utf8');
    return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function saveContact({ nom, email, telephone, message, page }) {
  if (!storageWritable()) return { ok: false, reason: 'storage_readonly' };
  const line = `${new Date().toISOString()},${csvq(nom)},${csvq(email)},${csvq(telephone)},${csvq(message)},${csvq(page)},Nouveau\n`;
  try { fs.appendFileSync(CONTACTS_FILE, line); return { ok: true }; }
  catch { return { ok: false, reason: 'write_error' }; }
}
function csvq(v) { const s = String(v ?? '').replace(/"/g, '""'); return /[",\n]/.test(s) ? `"${s}"` : s; }
function readContacts() {
  try {
    const raw = fs.readFileSync(CONTACTS_FILE, 'utf8').split('\n');
    const rows = [];
    for (let i = 1; i < raw.length; i++) {
      const line = raw[i].trim(); if (!line) continue;
      // parse CSV simple
      const m = line.match(/^(.*?),(.*?),(.*?),(.*?),(.*?),([^,]*?),?(Nouveau|Lu|Traité|Traite)?$/);
      // fallback: split respecting quotes
      const cols = parseCsvLine(line);
      if (cols.length >= 6) rows.push({ date: cols[0], nom: cols[1], email: cols[2], telephone: cols[3], message: cols[4], page: cols[5], statut: cols[6] || 'Nouveau' });
    }
    return rows.reverse();
  } catch { return []; }
}
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  }
  out.push(cur); return out;
}

// ---------- auth admin ----------
function checkPassword(pwd, hash) {
  if (!hash || !hash.startsWith('sha256:')) return false;
  const h = crypto.createHash('sha256').update(pwd, 'utf8').digest('hex');
  const a = Buffer.from(h), b = Buffer.from(hash.slice(7));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function signToken(email) {
  const secret = process.env.ADMIN_SECRET || 'change-me';
  const exp = Date.now() + 12 * 3600 * 1000;
  const data = `${email}:${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return Buffer.from(`${data}:${sig}`).toString('base64');
}
function verifyToken(tok) {
  try {
    const s = Buffer.from(tok, 'base64').toString('utf8');
    const [email, exp, sig] = s.split(':');
    if (!email || !exp || !sig) return null;
    if (Number(exp) < Date.now()) return null;
    const secret = process.env.ADMIN_SECRET || 'change-me';
    const good = crypto.createHmac('sha256', secret).update(`${email}:${exp}`).digest('hex');
    if (sig !== good) return null;
    if (email !== process.env.ADMIN_EMAIL) return null;
    return email;
  } catch { return null; }
}
function requireAdmin(req, res, next) {
  const t = req.cookies.admin_token;
  const email = t && verifyToken(t);
  if (!email) return res.redirect('/admin/login');
  req.adminEmail = email; next();
}
function requireAdminApi(req, res, next) {
  const t = req.cookies.admin_token;
  const email = t && verifyToken(t);
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  req.adminEmail = email; next();
}

// ---------- layout ----------
function langUrls(reqPath) {
  const clean = reqPath.split('?')[0];
  return { fr: `${clean}?lang=fr`, en: `${clean}?lang=en`, es: `${clean}?lang=es` };
}
function layout({ lang, t, config, title, desc, path: reqPath, active, content, extraHead = '', productJsonLd = null }) {
  const urls = langUrls(reqPath);
  const waNum = config.whatsappNumber || '';
  const waMsg = (config.whatsappMessage && (config.whatsappMessage[lang] || config.whatsappMessage.fr)) || 'Bonjour';
  const waHref = waLink(waNum, waMsg.replace('[NOM]', '').replace('[NAME]', '').replace('[NOMBRE]', ''));
  const s = config.socials || {};
  const year = new Date().getFullYear();
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc || '')}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc || '')}"><meta property="og:type" content="website">
<meta property="og:image" content="${esc(config.heroImage || '/images/branding/brand-p3-632.jpg')}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>◈</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
${productJsonLd ? `<script type="application/ld+json">${productJsonLd}</script>` : ''}
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":${JSON.stringify(config.brandName || 'Parfumerie')},"sameAs":[${[s.instagram, s.facebook, s.tiktok, s.youtube].filter(Boolean).map(x => JSON.stringify(x)).join(',')}]}</script>
${extraHead}</head>
<body data-lang="${lang}" data-path="${esc(reqPath)}">
<header class="header"><div class="wrap header-in">
<a class="brand" href="/?lang=${lang}"><span class="brand-mark">◈</span><span class="brand-name">${esc(config.brandName || 'Parfumerie')}</span></a>
<nav class="nav" id="nav">
<a href="/?lang=${lang}" class="${active === 'home' ? 'on' : ''}">${esc(t['nav.home'] || 'Accueil')}</a>
<a href="/femme?lang=${lang}" class="${active === 'femme' ? 'on' : ''}">${esc(t['nav.femme'] || 'Femme')}</a>
<a href="/homme?lang=${lang}" class="${active === 'homme' ? 'on' : ''}">${esc(t['nav.homme'] || 'Homme')}</a>
<a href="/collection?lang=${lang}" class="${active === 'collection' ? 'on' : ''}">${esc(t['nav.collection'] || 'Collection')}</a>
<a href="/a-propos?lang=${lang}" class="${active === 'about' ? 'on' : ''}">${esc(t['nav.about'] || 'À propos')}</a>
<a href="/contact?lang=${lang}" class="${active === 'contact' ? 'on' : ''}">${esc(t['nav.contact'] || 'Contact')}</a>
</nav>
<div class="header-acts">
<div class="langswitch" role="group" aria-label="FR EN ES">
<a href="${urls.fr}" class="${lang === 'fr' ? 'on' : ''}">FR</a><span>|</span><a href="${urls.en}" class="${lang === 'en' ? 'on' : ''}">EN</a><span>|</span><a href="${urls.es}" class="${lang === 'es' ? 'on' : ''}">ES</a>
</div>
${waNum ? `<a class="btn btn-wa" data-ev="whatsapp_click" data-wa href="${esc(waHref)}" target="_blank" rel="noopener">WhatsApp</a>` : `<a class="btn btn-wa" href="/contact?lang=${lang}">WhatsApp</a>`}
<button class="burger" id="burger" aria-label="Menu">☰</button>
</div></div></header>
<main>${content}</main>
<footer class="footer"><div class="wrap foot-grid">
<div><div class="brand-name">${esc(config.brandName || '')}</div><p class="muted">${esc((config.tagline && (config.tagline[lang] || config.tagline.fr)) || '')}</p>
<p class="muted small">${esc(config.legalDisclaimer || '').slice(0, 220)}…</p></div>
<div><h4>Navigation</h4><p><a href="/femme?lang=${lang}">${esc(t['nav.femme'])}</a><br><a href="/homme?lang=${lang}">${esc(t['nav.homme'])}</a><br><a href="/collection?lang=${lang}">${esc(t['nav.collection'])}</a><br><a href="/a-propos?lang=${lang}">${esc(t['nav.about'])}</a><br><a href="/contact?lang=${lang}">${esc(t['nav.contact'])}</a></p></div>
<div><h4>Contact</h4><p class="muted">${config.contact?.email ? `<a data-ev="email_click" href="mailto:${esc(config.contact.email)}">${esc(config.contact.email)}</a><br>` : ''}${config.contact?.phone ? `<a data-ev="phone_click" href="tel:${esc(config.contact.phone.replace(/\s/g, ''))}">${esc(config.contact.phone)}</a><br>` : ''}${waNum ? `<a data-ev="whatsapp_click" data-wa href="${esc(waHref)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${config.contact?.address ? `<br>${esc(config.contact.address)}` : ''}</p>
<p class="socials">${s.instagram ? `<a data-ev="instagram_click" href="${esc(s.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ''} ${s.facebook ? `<a data-ev="facebook_click" href="${esc(s.facebook)}" target="_blank" rel="noopener">Facebook</a>` : ''} ${s.tiktok ? `<a data-ev="tiktok_click" href="${esc(s.tiktok)}" target="_blank" rel="noopener">TikTok</a>` : ''} ${s.youtube ? `<a data-ev="youtube_click" href="${esc(s.youtube)}" target="_blank" rel="noopener">YouTube</a>` : ''}</p></div>
<div><h4>FR / EN / ES</h4><p><a href="${urls.fr}">Français</a><br><a href="${urls.en}">English</a><br><a href="${urls.es}">Español</a></p><p class="muted small"><a href="/mentions-legales?lang=${lang}">${esc(t['footer.legal'])}</a> · <a href="/confidentialite?lang=${lang}">${esc(t['footer.privacy'])}</a><br><a href="/admin">Admin</a></p></div>
</div><div class="wrap foot-base"><span>© ${year} ${esc(config.brandName || '')} — ${esc(t['footer.rights'] || '')}</span></div></footer>
${waNum ? `<a class="wa-float" data-ev="whatsapp_click" data-wa href="${esc(waHref)}" target="_blank" rel="noopener" aria-label="WhatsApp">✆</a>` : ''}
<div class="consent" id="consent" hidden><span>🍪 <span id="consent-txt">Analytics anonymes ?</span></span><span><button id="c-ok" class="btn small">OK</button> <button id="c-no" class="btn ghost small">Non</button></span></div>
<script src="/js/main.js" defer></script>
</body></html>`;
}

function productCard(p, lang, t, config) {
  const name = `${p.ref}. ${p.name}`;
  const img = p.images[0];
  const desc = (p.description && (p.description[lang] || p.description.fr) || '').slice(0, 110);
  return `<article class="card reveal"><a class="card-img" href="/produit/${esc(p.id)}?lang=${lang}" aria-label="${esc(name)}"><img loading="lazy" src="${esc(img)}" alt="${esc(name)} — ${esc(p.inspirationBrand)}"></a>
<div class="card-body"><div class="card-ref">Réf ${esc(p.ref)} · ${esc(p.inspirationBrand)}</div><h3 class="card-title"><a href="/produit/${esc(p.id)}?lang=${lang}">${esc(name)}</a></h3>
<p class="card-desc">${esc(desc)}…</p>
<div class="card-foot"><a class="btn small" href="/produit/${esc(p.id)}?lang=${lang}">${esc(t['product.discover'] || 'Découvrir')}</a></div></div></article>`;
}

// ---------- public routes ----------
app.get('/', (req, res) => {
  const lang = getLang(req); res.cookie('lang', lang, { maxAge: 365 * 864e5 });
  const t = loadI18n(lang), config = loadConfig(), products = loadProducts();
  const feat = products.filter(p => p.featured).slice(0, 8);
  const fFeat = feat.length ? feat : products.filter(p => p.category === 'femme').slice(0, 4).concat(products.filter(p => p.category === 'homme').slice(0, 4));
  const heroImg = config.heroImage || '/images/branding/brand-p3-632.jpg';
  const content = `
<section class="hero" style="background-image:linear-gradient(180deg,rgba(5,5,8,.72),rgba(5,5,8,.45) 45%,rgba(5,5,8,.88)),url('${esc(heroImg)}')">
<div class="wrap hero-in"><p class="kicker">${esc(config.brandName || '')} — Femme · Homme</p>
<h1>${esc(t['hero.title'] || '')}</h1><p class="lede">${esc(t['hero.subtitle'] || '')}</p>
<div class="hero-cta"><a class="btn gold" href="/femme?lang=${lang}">${esc(t['hero.cta_femme'])}</a><a class="btn ghost" href="/homme?lang=${lang}">${esc(t['hero.cta_homme'])}</a></div>
<div class="hero-meta"><span>◈ Extrait 30 %</span><span>◈ 70 ml · 30 ml · 15 ml</span><span>◈ ${products.length} fragrances</span></div></div></section>
<section class="wrap sect"><div class="sect-head"><h2>${esc(t['collection.femme_title'])}</h2><a class="link" href="/femme?lang=${lang}">→</a></div>
<div class="grid">${products.filter(p => p.category === 'femme').slice(0, 4).map(p => productCard(p, lang, t, config)).join('')}</div></section>
<section class="wrap sect"><div class="sect-head"><h2>${esc(t['collection.homme_title'])}</h2><a class="link" href="/homme?lang=${lang}">→</a></div>
<div class="grid">${products.filter(p => p.category === 'homme').slice(0, 4).map(p => productCard(p, lang, t, config)).join('')}</div></section>
<section class="band"><div class="wrap band-in"><h2>Dark Luxury</h2><p class="muted">Noir profond · Anthracite · Blanc cassé · Or champagne — ${esc(config.legalDisclaimer || '').slice(0, 140)}…</p>
<div class="hero-cta"><a class="btn gold" href="/collection?lang=${lang}">${esc(t['nav.collection'])}</a><a class="btn ghost" href="/contact?lang=${lang}">${esc(t['nav.contact'])}</a></div></div></section>
<section class="wrap sect"><div class="sect-head"><h2>★ Sélection</h2></div><div class="grid">${fFeat.map(p => productCard(p, lang, t, config)).join('')}</div></section>`;
  res.send(layout({ lang, t, config, title: `${config.brandName} — ${t['hero.title']}`, desc: t['hero.subtitle'], path: req.path, active: 'home', content }));
});

function collectionPage(cat, req, res) {
  const lang = getLang(req); res.cookie('lang', lang, { maxAge: 365 * 864e5 });
  const t = loadI18n(lang), config = loadConfig(), products = loadProducts();
  const list = products.filter(p => p.category === cat);
  const title = cat === 'femme' ? t['collection.femme_title'] : t['collection.homme_title'];
  const content = `<section class="wrap page-head"><p class="kicker">${esc(config.brandName)}</p><h1>${esc(title)}</h1>
<p class="muted">${list.length} parfums — ${cat === 'femme' ? 'Elle' : 'Lui'} · Extrait concentré 30 %</p>
<div class="toolbar"><input id="q" class="search" placeholder="${esc(t['search.placeholder'])}" aria-label="search"><select id="gamme" class="search"><option value="">Toutes gammes</option><option value="classic">Classique</option><option value="luxe">Luxe</option><option value="luxury">Luxury</option></select></div></section>
<section class="wrap"><div class="grid" id="grid">${list.map(p => productCard(p, lang, t, config)).join('')}</div></section>
<script>window.__PRODUCTS__=${JSON.stringify(list.map(p => ({ id: p.id, ref: p.ref, name: p.name, brand: p.inspirationBrand, gamme: p.gamme })))}</script>`;
  res.send(layout({ lang, t, config, title: `${config.brandName} — ${title}`, desc: `${title} — ${list.length} parfums`, path: req.path, active: cat, content }));
}
app.get('/femme', (req, res) => collectionPage('femme', req, res));
app.get('/homme', (req, res) => collectionPage('homme', req, res));
app.get('/collection', (req, res) => {
  const lang = getLang(req); res.cookie('lang', lang, { maxAge: 365 * 864e5 });
  const t = loadI18n(lang), config = loadConfig(), products = loadProducts();
  const f = products.filter(p => p.category === 'femme'), h = products.filter(p => p.category === 'homme'), m = products.filter(p => p.category === 'mixte'), e = products.filter(p => p.category === 'enfant');
  const block = (title, arr, link) => `<div class="sect-head"><h2>${esc(title)} (${arr.length})</h2><a class="link" href="${link}?lang=${lang}">→</a></div><div class="grid">${arr.slice(0, 4).map(p => productCard(p, lang, t, config)).join('')}</div>`;
  const content = `<section class="wrap page-head"><p class="kicker">${esc(config.brandName)}</p><h1>${esc(t['nav.collection'])}</h1>
<div class="hero-cta"><a class="btn gold" href="/femme?lang=${lang}">${esc(t['hero.cta_femme'])}</a><a class="btn ghost" href="/homme?lang=${lang}">${esc(t['hero.cta_homme'])}</a></div></section>
<section class="wrap sect">${block(t['collection.femme_title'], f, '/femme')}</section>
<section class="wrap sect">${block(t['collection.homme_title'], h, '/homme')}</section>
<section class="wrap sect"><div class="sect-head"><h2>${esc(t['collection.mixte_title'])} (${m.length})</h2></div><div class="grid">${m.slice(0, 8).map(p => productCard(p, lang, t, config)).join('')}</div>
<h2 style="margin-top:34px">Enfants (${e.length})</h2><div class="grid">${e.map(p => productCard(p, lang, t, config)).join('')}</div></section>`;
  res.send(layout({ lang, t, config, title: `${config.brandName} — Collection`, desc: 'Collections Femme, Homme, Mixte', path: req.path, active: 'collection', content }));
});

app.get('/produit/:id', (req, res) => {
  const lang = getLang(req); res.cookie('lang', lang, { maxAge: 365 * 864e5 });
  const t = loadI18n(lang), config = loadConfig(), products = loadProducts();
  const p = products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).send(layout({ lang, t, config, title: '404', desc: '', path: req.path, active: '', content: '<section class="wrap page-head"><h1>404</h1></section>' }));
  const waNum = config.whatsappNumber || '';
  const tpl = (config.whatsappMessage && (config.whatsappMessage[lang] || config.whatsappMessage.fr)) || '';
  const waText = tpl.replace('[NOM]', `${p.ref} ${p.name}`).replace('[NAME]', `${p.ref} ${p.name}`).replace('[NOMBRE]', `${p.ref} ${p.name}`);
  const waHref = waLink(waNum, waText);
  const desc = p.description[lang] || p.description.fr;
  const formats = (p.formats || []).map(f => `<li><span>${esc(f.size)} — Réf ${esc(f.ref)}</span><strong>${esc(f.price)}</strong></li>`).join('');
  const others = products.filter(x => x.category === p.category && x.id !== p.id).slice(0, 4);
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: `${p.ref} ${p.name}`, brand: p.inspirationBrand, image: p.images, description: desc, sku: p.ref });
  const content = `<section class="wrap crumb"><a href="/?lang=${lang}">${esc(t['nav.home'])}</a> → <a href="/${p.category === 'homme' ? 'homme' : p.category === 'femme' ? 'femme' : 'collection'}?lang=${lang}">${esc(p.category)}</a> → <span>Réf ${esc(p.ref)}</span></section>
<section class="wrap fiche"><div class="fiche-img"><img src="${esc(p.images[0])}" alt="${esc(p.ref + ' ' + p.name)}" fetchpriority="high"></div>
<div class="fiche-body"><p class="kicker">${esc(p.inspirationBrand)} · ${esc(p.gamme)}</p><h1>${esc(p.ref)}. ${esc(p.name)}</h1>
<p class="muted">Réf ${esc(p.ref)} · ${esc(t['product.ref'])} ${esc(p.ref)} · ${esc(p.category)}</p>
<p>${esc(desc)}</p>
<h3>${esc(t['product.formats'])}</h3><ul class="formats">${formats}</ul>
<p class="muted small">${esc(config.legalDisclaimer)}</p>
<div class="hero-cta">${waNum ? `<a class="btn gold" data-ev="whatsapp_click" data-wa data-product="${esc(p.id)}" href="${esc(waHref)}" target="_blank" rel="noopener">${esc(t['product.whatsapp'])}</a>` : `<a class="btn gold" href="/contact?lang=${lang}&parfum=${esc(p.id)}">${esc(t['product.whatsapp'])}</a>`}
<a class="btn ghost" href="/contact?lang=${lang}&parfum=${esc(p.id)}">${esc(t['nav.contact'])}</a></div></div></section>
<section class="wrap sect"><div class="sect-head"><h2>→ ${esc(p.category)}</h2></div><div class="grid">${others.map(x => productCard(x, lang, t, config)).join('')}</div></section>
<script>window.__PRODUCT__=${JSON.stringify({ id: p.id, ref: p.ref, name: p.name })}</script>`;
  res.send(layout({ lang, t, config, title: `${p.ref} ${p.name} — ${config.brandName}`, desc, path: req.path, active: p.category, content, productJsonLd: ld }));
});

app.get('/a-propos', (req, res) => {
  const lang = getLang(req); res.cookie('lang', lang, { maxAge: 365 * 864e5 });
  const t = loadI18n(lang), config = loadConfig();
  const about = (config.about && (config.about[lang] || config.about.fr)) || '';
  const content = `<section class="wrap page-head"><p class="kicker">${esc(config.brandName)}</p><h1>${esc(t['nav.about'])}</h1></section>
<section class="wrap fiche"><div class="fiche-img"><img loading="lazy" src="${esc(config.heroImage || '')}" alt="Maison"></div>
<div class="fiche-body"><p>${esc(about)}</p><p class="muted small">${esc(config.legalDisclaimer)}</p>
<h3>70 ml · 30 ml · 15 ml</h3><p class="muted">Classique 11,90 € / 18,00 € / 35,00 € — Luxe & Luxury voir fiches. Enfants 29,00 €.</p></div></section>`;
  res.send(layout({ lang, t, config, title: `${config.brandName} — ${t['nav.about']}`, desc: about.slice(0, 150), path: req.path, active: 'about', content }));
});

app.get('/contact', (req, res) => {
  const lang = getLang(req); res.cookie('lang', lang, { maxAge: 365 * 864e5 });
  const t = loadI18n(lang), config = loadConfig();
  const pre = String(req.query.parfum || '');
  const waNum = config.whatsappNumber || '';
  const waHref = waLink(waNum, (config.whatsappMessage?.[lang] || config.whatsappMessage?.fr || 'Bonjour'));
  const content = `<section class="wrap page-head"><p class="kicker">${esc(config.brandName)}</p><h1>${esc(t['contact.title'])}</h1>
<p class="muted">${config.contact?.email ? `<a data-ev="email_click" href="mailto:${esc(config.contact.email)}">${esc(config.contact.email)}</a> · ` : ''}${config.contact?.phone ? `<a data-ev="phone_click" href="tel:${esc(config.contact.phone.replace(/\s/g, ''))}">${esc(config.contact.phone)}</a> · ` : ''}${waNum ? `<a data-ev="whatsapp_click" data-wa href="${esc(waHref)}" target="_blank">WhatsApp</a>` : ''}${config.contact?.address ? ` · ${esc(config.contact.address)}` : ''}</p></section>
<section class="wrap fiche"><div class="fiche-body"><form id="cform" class="form">
<label>${esc(t['contact.name'])}<input name="nom" required autocomplete="name"></label>
<label>${esc(t['contact.email'])}<input name="email" type="email" required autocomplete="email"></label>
<label>${esc(t['contact.phone'])}<input name="telephone" autocomplete="tel"></label>
<label>${esc(t['contact.message'])}<textarea name="message" rows="5" required>${esc(pre ? `Réf ${pre} — ` : '')}</textarea></label>
<input type="hidden" name="page" value="/contact"><input type="hidden" name="lang" value="${lang}">
<button class="btn gold" type="submit">${esc(t['contact.send'])}</button>
<p id="cok" class="ok" hidden>${esc(t['contact.success'])}</p><p id="cerr" class="err" hidden></p>
${storageWritable() ? '' : '<p class="muted small">Stockage local indisponible — configurez un endpoint externe.</p>'}</form></div>
<div class="fiche-img"><img loading="lazy" src="${esc(config.heroImage || '')}" alt="Contact"></div></section>`;
  res.send(layout({ lang, t, config, title: `${config.brandName} — ${t['contact.title']}`, desc: t['contact.title'], path: req.path, active: 'contact', content }));
});

app.get('/mentions-legales', (req, res) => {
  const lang = getLang(req); const t = loadI18n(lang), config = loadConfig();
  const c = `<section class="wrap page-head"><h1>${esc(t['footer.legal'])}</h1><p class="muted">${esc(config.legalDisclaimer)}</p><p class="muted">Marque : ${esc(config.brandName)}. Contenus modifiables dans /data/*.json. Hébergement : à compléter.</p></section>`;
  res.send(layout({ lang, t, config, title: t['footer.legal'], desc: '', path: req.path, active: '', content: c }));
});
app.get('/confidentialite', (req, res) => {
  const lang = getLang(req); const t = loadI18n(lang), config = loadConfig();
  const c = `<section class="wrap page-head"><h1>${esc(t['footer.privacy'])}</h1><p class="muted">Analytics anonymes (page_view, clics), sans données personnelles inutiles. Consentement via bannière. Événements stockés en JSONL local, contacts en CSV. Désactivation possible à tout moment (refuser la bannière). Sessions admin via cookie httpOnly 12 h.</p></section>`;
  res.send(layout({ lang, t, config, title: t['footer.privacy'], desc: '', path: req.path, active: '', content: c }));
});

// ---------- SEO ----------
app.get('/robots.txt', (req, res) => { res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${SITE_URL}/sitemap.xml\n`); });
app.get('/sitemap.xml', (req, res) => {
  const products = loadProducts();
  const urls = ['', '/femme', '/homme', '/collection', '/a-propos', '/contact'].map(p => `<url><loc>${SITE_URL}${p || '/'}</loc></url>`).join('');
  const pu = products.map(p => `<url><loc>${SITE_URL}/produit/${p.id}</loc></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}${pu}</urlset>`);
});

// ---------- API ----------
app.post('/api/track', (req, res) => {
  const { event, page, product_id, language, device, browser } = req.body || {};
  const allow = ['page_view', 'product_view', 'whatsapp_click', 'contact_form_start', 'contact_form_submit', 'instagram_click', 'facebook_click', 'tiktok_click', 'youtube_click', 'phone_click', 'email_click'];
  if (!allow.includes(event)) return res.status(400).json({ error: 'bad_event' });
  const sid = req.cookies.sid || crypto.randomBytes(8).toString('hex');
  res.cookie('sid', sid, { maxAge: 365 * 864e5, httpOnly: false });
  const ok = trackEvent({ timestamp: new Date().toISOString(), session_id: sid, event, page: String(page || '').slice(0, 200), product_id: String(product_id || '').slice(0, 80), language: String(language || '').slice(0, 8), device: String(device || '').slice(0, 20), browser: String(browser || '').slice(0, 40), ua: String(req.headers['user-agent'] || '').slice(0, 120) });
  res.json({ ok, storage: ok ? 'file' : 'disabled' });
});
app.post('/api/contact', (req, res) => {
  const { nom, email, telephone, message, page } = req.body || {};
  if (!nom || !email || !message) return res.status(400).json({ error: 'missing_fields' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'bad_email' });
  const r = saveContact({ nom: String(nom).slice(0, 120), email: String(email).slice(0, 160), telephone: String(telephone || '').slice(0, 40), message: String(message).slice(0, 4000), page: String(page || '/contact').slice(0, 200) });
  if (!r.ok) return res.status(500).json({ error: 'not_saved', reason: r.reason, message: 'Stockage indisponible — contactez via WhatsApp.' });
  trackEvent({ timestamp: new Date().toISOString(), session_id: req.cookies.sid || 'n/a', event: 'contact_form_submit', page: String(page || '/contact').slice(0, 200), product_id: '', language: getLang(req), device: '', browser: '' });
  res.json({ ok: true });
});
app.get('/api/health', (req, res) => res.json({ ok: true, storageWritable: storageWritable(), products: loadProducts().length }));

// ---------- ADMIN ----------
function adminLayout(active, content) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin — ${active}</title>
<link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/admin.css"></head><body class="admin">
<aside class="aside"><div class="brand-name">◈ Admin</div><nav>
<a href="/admin" class="${active === 'dashboard' ? 'on' : ''}">Dashboard</a>
<a href="/admin/pages" class="${active === 'pages' ? 'on' : ''}">Pages</a>
<a href="/admin/parfums" class="${active === 'parfums' ? 'on' : ''}">Parfums</a>
<a href="/admin/parcours" class="${active === 'parcours' ? 'on' : ''}">Parcours</a>
<a href="/admin/formulaires" class="${active === 'formulaires' ? 'on' : ''}">Formulaires</a>
<a href="/admin/conversions" class="${active === 'conversions' ? 'on' : ''}">Conversions</a>
<a href="/admin/visiteurs" class="${active === 'visiteurs' ? 'on' : ''}">Visiteurs</a>
<a href="/" target="_blank">Voir le site →</a>
<form method="post" action="/admin/logout"><button class="btn ghost small">Déconnexion</button></form></nav></aside>
<main class="amain">${content}</main><script src="/js/admin.js" defer></script></body></html>`;
}
app.get('/admin/login', (req, res) => {
  if (req.cookies.admin_token && verifyToken(req.cookies.admin_token)) return res.redirect('/admin');
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin login</title><link rel="stylesheet" href="/css/style.css"></head><body class="loginwrap"><form class="login" method="post" action="/admin/login"><h1>◈ Admin</h1><label>Email<input name="email" type="email" required></label><label>Mot de passe<input name="password" type="password" required></label><button class="btn gold">Se connecter</button>${req.query.e ? '<p class="err">Identifiants invalides.</p>' : ''}</form></body></html>`);
});
app.post('/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  if (email === process.env.ADMIN_EMAIL && checkPassword(password || '', process.env.ADMIN_PASSWORD_HASH || '')) {
    res.cookie('admin_token', signToken(email), { httpOnly: true, maxAge: 12 * 3600 * 1000, sameSite: 'lax' });
    return res.redirect('/admin');
  }
  trackEvent({ timestamp: new Date().toISOString(), session_id: 'admin', event: 'admin_login_fail', page: '/admin/login', product_id: '', language: '', device: '', browser: '' });
  res.redirect('/admin/login?e=1');
});
app.post('/admin/logout', (req, res) => { res.clearCookie('admin_token'); res.redirect('/admin/login'); });
app.get('/admin', requireAdmin, (req, res) => {
  res.send(adminLayout('dashboard', `<h1>Dashboard</h1><p class="muted">Visiteurs, pages vues, formulaires, clics WhatsApp & réseaux — sans base de données (JSONL/CSV).</p>
<div class="cards" id="cards"></div><div class="panel"><h3>Évolution (30 j)</h3><canvas id="ch" height="120"></canvas></div>
<div class="panel"><h3>Temps réel (5 min)</h3><div id="rt">…</div></div>
<div class="panel"><h3>Exports</h3><p><a class="btn small" href="/api/export/events">Exporter les événements</a> <a class="btn small" href="/api/export/contacts">Exporter les formulaires</a> <a class="btn small" href="/api/export/stats">Exporter les statistiques</a></p></div>`));
});
for (const p of ['pages', 'parfums', 'parcours', 'formulaires', 'conversions', 'visiteurs']) {
  app.get(`/admin/${p}`, requireAdmin, (req, res) => {
    const titles = { pages: 'Pages les plus consultées', parfums: 'Parfums les plus consultés', parcours: 'Parcours visiteurs', formulaires: 'Formulaires reçus', conversions: 'Conversions', visiteurs: 'Visiteurs (anonymisés)' };
    res.send(adminLayout(p, `<h1>${titles[p]}</h1><div class="toolbar"><select id="range"><option value="1">Aujourd'hui</option><option value="7" selected>7 jours</option><option value="30">30 jours</option><option value="90">3 mois</option></select> <button class="btn small" id="reload">Actualiser</button> <a class="btn small" href="/api/export/${p === 'formulaires' ? 'contacts' : 'events'}">Exporter CSV</a></div><div id="tbl">Chargement…</div><script>window.__PAGE__="${p}"</script>`));
  });
}

// admin APIs
function inRange(ts, days) { return Date.now() - new Date(ts).getTime() <= days * 864e5; }
app.get('/api/admin/stats', requireAdminApi, (req, res) => {
  const days = Number(req.query.days || 30);
  const ev = readEvents().filter(e => inRange(e.timestamp, days));
  const sess = new Set(ev.map(e => e.session_id));
  const pv = ev.filter(e => e.event === 'page_view' || e.event === 'product_view');
  const wa = ev.filter(e => e.event === 'whatsapp_click').length;
  const forms = readContacts().length + ev.filter(e => e.event === 'contact_form_submit').length * 0; // contacts file is source
  const formsCount = readContacts().filter(c => days >= 3650 ? true : (Date.now() - new Date(c.date).getTime() <= days * 864e5)).length;
  const social = ['instagram_click', 'facebook_click', 'tiktok_click', 'youtube_click'].reduce((a, k) => (a[k] = ev.filter(e => e.event === k).length, a), {});
  const today = readEvents().filter(e => inRange(e.timestamp, 1));
  const d7 = readEvents().filter(e => inRange(e.timestamp, 7));
  // per day
  const perDay = {};
  for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); perDay[d] = 0; }
  ev.forEach(e => { const d = String(e.timestamp).slice(0, 10); if (perDay[d] !== undefined) perDay[d]++; });
  const rt = readEvents().filter(e => Date.now() - new Date(e.timestamp).getTime() < 5 * 60 * 1000);
  res.json({ visitorsToday: new Set(today.map(e => e.session_id)).size, visitors7: new Set(d7.map(e => e.session_id)).size, visitors: sess.size, sessions: sess.size, pageViews: pv.length, perSession: sess.size ? +(pv.length / sess.size).toFixed(2) : 0, whatsapp: wa, forms: formsCount, social, perDay, realtime: rt.length, realtimeRows: rt.slice(-10).reverse() });
});
app.get('/api/admin/pages', requireAdminApi, (req, res) => {
  const days = Number(req.query.days || 7);
  const ev = readEvents().filter(e => inRange(e.timestamp, days) && (e.event === 'page_view' || e.event === 'product_view'));
  const map = {};
  ev.forEach(e => { const k = e.page || '(?)'; map[k] = map[k] || { page: k, views: 0, sessions: new Set() }; map[k].views++; map[k].sessions.add(e.session_id); });
  res.json(Object.values(map).map(r => ({ page: r.page, vues: r.views, visites: r.sessions.size })).sort((a, b) => b.vues - a.vues).slice(0, 100));
});
app.get('/api/admin/parfums', requireAdminApi, (req, res) => {
  const days = Number(req.query.days || 30);
  const ev = readEvents().filter(e => inRange(e.timestamp, days));
  const products = loadProducts();
  const map = {};
  ev.filter(e => e.event === 'product_view').forEach(e => { map[e.product_id] = (map[e.product_id] || 0) + 1; });
  const wa = {};
  ev.filter(e => e.event === 'whatsapp_click' && e.product_id).forEach(e => { wa[e.product_id] = (wa[e.product_id] || 0) + 1; });
  const rows = products.map(p => ({ id: p.id, nom: `${p.ref} ${p.name}`, vues: map[p.id] || 0, whatsapp: wa[p.id] || 0 })).sort((a, b) => b.vues - a.vues).slice(0, 100);
  res.json(rows);
});
app.get('/api/admin/parcours', requireAdminApi, (req, res) => {
  const days = Number(req.query.days || 7);
  const ev = readEvents().filter(e => inRange(e.timestamp, days)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const byS = {};
  ev.forEach(e => { (byS[e.session_id] = byS[e.session_id] || []).push(e); });
  const seqs = {};
  Object.values(byS).forEach(list => {
    const seq = list.slice(0, 6).map(e => e.event === 'product_view' ? `Parfum(${(e.product_id || '').replace('parfum-', '')})` : ({ page_view: e.page || '/', whatsapp_click: 'WhatsApp', contact_form_submit: 'Formulaire', instagram_click: 'Instagram', facebook_click: 'Facebook', tiktok_click: 'TikTok', youtube_click: 'YouTube' }[e.event] || e.event)).join(' → ');
    seqs[seq] = (seqs[seq] || 0) + 1;
  });
  res.json(Object.entries(seqs).map(([parcours, n]) => ({ parcours, n })).sort((a, b) => b.n - a.n).slice(0, 50));
});
app.get('/api/admin/visiteurs', requireAdminApi, (req, res) => {
  const days = Number(req.query.days || 7);
  const ev = readEvents().filter(e => inRange(e.timestamp, days)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const byS = {};
  ev.forEach(e => { const s = byS[e.session_id] = byS[e.session_id] || { session: String(e.session_id).slice(0, 10) + '…', entrees: [], pages: 0, first: e.timestamp, last: e.timestamp, device: e.device, browser: e.browser, lang: e.language }; s.pages++; s.last = e.timestamp; if (e.event.includes('view') && s.entrees.length < 1) s.entrees.push(e.page); s.sortie = e.event; });
  res.json(Object.values(byS).map(v => ({ session: v.session, entree: v.entrees[0] || '', sortie: v.sortie, pages: v.pages, debut: v.first, duree: Math.round((new Date(v.last) - new Date(v.first)) / 1000) + 's', appareil: v.device, navigateur: v.browser, langue: v.lang })).slice(-200).reverse());
});
app.get('/api/admin/conversions', requireAdminApi, (req, res) => {
  const days = Number(req.query.days || 30);
  const ev = readEvents().filter(e => inRange(e.timestamp, days));
  const keys = ['whatsapp_click', 'contact_form_submit', 'instagram_click', 'facebook_click', 'tiktok_click', 'phone_click', 'email_click'];
  const perDay = {};
  for (let i = days - 1; i >= 0; i--) perDay[new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)] = {};
  ev.filter(e => keys.includes(e.event)).forEach(e => { const d = String(e.timestamp).slice(0, 10); if (perDay[d]) perDay[d][e.event] = (perDay[d][e.event] || 0) + 1; });
  const totals = {}; keys.forEach(k => totals[k] = ev.filter(e => e.event === k).length);
  res.json({ totals, perDay });
});
app.get('/api/admin/formulaires', requireAdminApi, (req, res) => res.json(readContacts().slice(0, 500)));
app.post('/api/admin/formulaires/statut', requireAdminApi, (req, res) => {
  const { date, email, statut } = req.body || {};
  try {
    const raw = fs.readFileSync(CONTACTS_FILE, 'utf8').split('\n');
    const out = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      if (!raw[i].trim()) continue;
      const cols = parseCsvLine(raw[i]);
      if (cols[0] === date && cols[2] === email) cols[6] = statut;
      out.push(cols.map(csvq).join(','));
    }
    fs.writeFileSync(CONTACTS_FILE, out.join('\n'));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'write' }); }
});

// exports CSV
app.get('/api/export/:kind', requireAdminApi, (req, res) => {
  const k = req.params.kind;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  if (k === 'contacts' || k === 'formulaires') { res.setHeader('Content-Disposition', 'attachment; filename="formulaires.csv"'); return res.send(fs.existsSync(CONTACTS_FILE) ? fs.readFileSync(CONTACTS_FILE, 'utf8') : 'date,nom,email,telephone,message,page,statut\n'); }
  if (k === 'events') { res.setHeader('Content-Disposition', 'attachment; filename="evenements.csv"'); const ev = readEvents(); return res.send('timestamp,session,event,page,product,lang,device,browser\n' + ev.map(e => [e.timestamp, e.session_id, e.event, csvq(e.page), e.product_id, e.language, e.device, e.browser].join(',')).join('\n')); }
  res.setHeader('Content-Disposition', 'attachment; filename="statistiques.csv"');
  const ev = readEvents(); return res.send('event,count\n' + [...new Set(ev.map(e => e.event))].map(x => `${x},${ev.filter(e => e.event === x).length}`).join('\n'));
});

// 404
app.use((req, res) => { const lang = getLang(req); res.status(404).send(layout({ lang, t: loadI18n(lang), config: loadConfig(), title: '404', desc: '', path: req.path, active: '', content: '<section class="wrap page-head"><h1>404</h1><p><a href="/">Accueil</a></p></section>' })); });

app.listen(PORT, () => console.log(`✔ Vitrine premium : http://localhost:${PORT} — storage writable: ${storageWritable()}`));
