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
| SEO: Kalispell | TBD | seo-pages/kalispell-page.html | ⬜ | |
| SEO: Barbershops | TBD | seo-pages/barbershops-page.html | ⬜ | |
| Blog (6 drafts) | `/blog/...` | website/blog-drafts/*.md | ⬜ | later |

**Live preview (git-connected, auto-deploys on push):** https://rainbow-dragon-3f699c.netlify.app
Repo: https://github.com/ghill217/406frontdesk-site · connected 2026-07-15.

## Remaining phases
1. Port pages 2–10 (same machine: extract `<style>`→css, body→template, base64→files, links root-relative).
2. Asset polish: real square favicon, proper 1200×630 OG image, optimize/serve WebP, self-host fonts (perf).
3. A2P/compliance check: SMS disclosures render in static HTML (SSR — better for GHL scanner). Re-run /a2p-check.
4. One-time connect (Gus): create GitHub repo, push, connect Netlify to repo, deploy → Netlify preview URL.
5. Pixel-compare new build vs live GHL site; run /site-audit before/after for the A+ receipt.
6. DNS cutover: point 406frontdesk.com at Netlify only after pixel-verified. Add `_redirects` for any changed URLs.
7. Verify booking iframe + chat widget + demo form all work post-cutover; confirm A2P scanner still passes.

## Notes / gotchas
- Local build: `npm run build`; dev server: `npm start` (Eleventy serve on :8080). Node at `C:\Program Files\nodejs`.
- Preview-pane screenshots time out because the GHL chat widget + form iframe keep the network open;
  verify render via `javascript_tool` computed styles instead (proven this works).
- Internal links converted to root-relative (`/features/`) so previews are self-contained pre-cutover.
