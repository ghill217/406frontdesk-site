# 406 Front Desk — GHL → Netlify Migration Tracker

**Goal:** Move 406frontdesk.com off GHL onto Netlify, pixel-for-pixel, scoring straight-A across the
12-variable /site-audit. Content/message unchanged; visual polish is a separate approved pass afterward.

**Decisions (2026-07-14):**
- Deploy: **git-connected auto-deploy** (dedicated GitHub repo → Netlify build on push).
- Stack: **Eleventy (11ty)** static site generator. Node 24 LTS installed locally this session.
- Visual scope: **pixel-exact port first**, invisible A+ wins captured during port, visual polish approved later.
- Repo lives **outside the Obsidian vault** at `C:\Users\ghill\Documents\406-frontdesk-site\`
  (a Node project can't live inside an Obsidian-synced vault — `node_modules` would wreck Sync).
- Source of truth for the *old* pages: `The Hive Mind/raw/assets/406-front-desk/website/` (immutable).

## Architecture
- `src/_includes/layouts/base.njk` — HTML shell: SEO meta, OG/Twitter, canonical, favicon, fonts,
  site-wide LocalBusiness JSON-LD, header + content + footer, async GHL chat widget.
- `src/_includes/partials/header.njk` + `footer.njk` — single-source nav/footer (links from `_data/site.json`).
- `src/_data/site.json` — business facts + nav (edit links in ONE place).
- `src/css/<page>.css` — each page's exact CSS extracted byte-for-byte from the GHL source.
- `src/assets/img/` — images pulled out of base64 into cached files.
- `src/sitemap.njk` → `/sitemap.xml` (auto-generated). `src/robots.txt`. `netlify.toml`, `_redirects`.

## Page port status
| Page | URL | Source | Ported | Verified |
|------|-----|--------|--------|----------|
| Home | `/` | home.html | ✅ | ✅ build+render |
| Features | `/features/` | features.html | ✅ | ✅ 200+title+css |
| Pricing | `/pricing/` | pricing.html | ✅ | ✅ render spot-check |
| FAQ | `/faq/` | faq.html | ✅ | ✅ 200+title+css |
| Contact | `/contact/` | contact.html | ✅ | ✅ tel+mailto live |
| Demo | `/demo/` | demo-page.html | ✅ | ✅ booking iframe kept |
| Privacy Policy | `/privacy-policy/` | privacy-policy.html | ✅ | ✅ 200+title+css |
| Terms | `/terms-conditions/` | terms-conditions.html | ✅ | ✅ 200+title+css |
| SMS Consent | `/sms-consent/` | sms-consent.html | ✅ | ✅ 200+title+css |
| 404 | `/404.html` | 404.html | ✅ | ✅ noindex |
| Essentials (Lite) | `/essentials/` | net-new (off-nav landing) | ✅ | ✅ 200+title+css+noindex (2026-07-15) |
| SEO: Kalispell | TBD | seo-pages/kalispell-page.html | ⬜ | |
| SEO: Barbershops | TBD | seo-pages/barbershops-page.html | ⬜ | |
| Blog (6 drafts) | `/blog/...` | website/blog-drafts/*.md | ⬜ | later |

**Live preview (git-connected, auto-deploys on push):** https://rainbow-dragon-3f699c.netlify.app
Repo: https://github.com/ghill217/406frontdesk-site · connected 2026-07-15.

## Remaining phases
1. ✅ Port pages 2–10 (done 2026-07-15).
2. ◑ Asset polish: ✅ favicon + apple-touch + 1200×630 OG image (from design system). Pending: WebP, self-host fonts.
3. ⬜ A2P/compliance check: SMS disclosures render in static HTML (SSR). Re-run /a2p-check on live pages + widget consent.
4. ✅ One-time connect (done): GitHub `ghill217/406frontdesk-site` → Netlify `rainbow-dragon-3f699c.netlify.app`, auto-deploy on push.
5. ✅ /site-audit re-grade: **overall A, 12/12 A-range** (SEO+Perf A+; Trust/Local/A11y A−). 
6. ⬜ DNS cutover (Gus's trigger): point 406frontdesk.com at Netlify after final review. Add `_redirects` for any changed URLs.
7. ⬜ Verify booking iframe + chat widget + demo form post-cutover; confirm A2P scanner still passes.
8. ⬜ **Chat widget (GHL-side, flagged):** off-brand + consent shows "MOB LLC" → must read 406 Front Desk LLC. Reconfigure in GHL (navy/amber, design-system avatar, footer), then /a2p-check. Queued for a live session with Gus.

### A− → A+ paths (from the audit)
- Trust: add "established 2026" + a first testimonial to the homepage proof section.
- Local: add street address + hours to LocalBusiness schema (base.njk) + contact page.
- A11y: full contrast + keyboard pass.

## Notes / gotchas
- Local build: `npm run build`; dev server: `npm start` (Eleventy serve on :8080). Node at `C:\Program Files\nodejs`.
- Preview-pane screenshots time out because the GHL chat widget + form iframe keep the network open;
  verify render via `javascript_tool` computed styles instead (proven this works).
- Internal links converted to root-relative (`/features/`) so previews are self-contained pre-cutover.
