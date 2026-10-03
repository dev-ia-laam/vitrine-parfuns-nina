# Parfumerie — Site vitrine premium (sans base de données)

Dark Luxury · FR/EN/ES · Femme/Homme · JSON + CSV/JSONL · Admin file-based.

## Démarrage
```bash
cd site
npm install
cp .env.example .env
node scripts/hash.js "votre-mot-de-passe"   # renseigner ADMIN_EMAIL + ADMIN_PASSWORD_HASH dans .env
npm start  # http://localhost:3000
```

## Données
- `data/products.json` : 143 parfums (ref, inspiration, catégorie femme/homme/mixte/enfant, gamme classic/luxe/luxury, formats/prix issus des PDF, images `/images/products/parfum-*.jpg` extraites des PDF).
- `data/config.json` : brandName, WhatsApp, réseaux, contact, hero, à-propos — **à renseigner** (vide = non inventé).
- `data/i18n/fr|en|es.json` : traductions.
- `public/images/products/` : 136 visuels extraits du PDF + fallback branding.
- `public/images/branding/` : visuels Olfazeta (hero…).

## Fonctionnement sans DB
- Contacts → `data/contacts.csv` (si écriture possible, sinon message honnête + fallback WhatsApp).
- Analytics → `data/analytics/events.jsonl` (`page_view, product_view, whatsapp_click, …`).
- `GET /api/health` indique `storageWritable`.
- RGPD : bannière consentement, anonymisation, `/confidentialite`.

## Admin
- `/admin/login` (env `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH=sha256:…`, cookie signé 12h).
- `/admin` : visiteurs j/7j/30j, sessions, pages vues, WhatsApp, formulaires, sociaux, courbe 30j, temps réel 5 min.
- `/admin/pages|parfums|parcours|visiteurs|formulaires|conversions` + exports CSV (`/api/export/contacts|events|stats`).

## SEO/perf
- title/meta/OG/JSON-LD, sitemap.xml, robots.txt, alt images, lazy loading, cache 7j, fonts display=swap.

## Déploiement
Node 18+ (`npm start`). Statique + Node requis pour formulaires/analytics. Si hébergeur 100 % statique : brancher un endpoint serverless externe vers CSV (voir `config.storage.mode`).
