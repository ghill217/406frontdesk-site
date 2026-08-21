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
| Gyms (vertical) | `/gyms/` | net-new | ✅ | ✅ 200, in sitemap, no h-overflow @390/1440 (2026-07-31) |
| Accounting (vertical) | `/accounting/` | net-new | ✅ | ✅ 200, in sitemap, a11y-clean (2026-07-31) |
| SEO: Kalispell | `/kalispell/` | seo-pages/kalispell-page.html | ✅ | ✅ 200, in sitemap |
| SEO: Barbershops | `/barbershops/` | seo-pages/barbershops-page.html | ✅ | ✅ 200, in sitemap |
| Scorecard | `/scorecard/` | scorecard.html | ✅ | ✅ 200, GHL form kept, noindex |
| Book | `/book` → GHL booking | book-blank.html | ✅ | ✅ 302 redirect |
| Blog index | `/blog/` | net-new (Eleventy collection) | ✅ | ✅ 200, lists 3 posts |
| Blog: 3 live posts | `/post/<slug>/` | blog-drafts/*.md (the 3 published) | ✅ | ✅ 200, URLs preserved |
| Blog: 3 more drafts | `/post/<slug>/` | blog-drafts/*.md (7/13) | ✅ | ✅ all 6 posts live in `src/posts/` |

**Marketing-site URLs cutover-ready (2026-07-15):** every live GHL *marketing* URL resolves on Netlify
(verified full inventory); GHL `/blog/category/*` + `/blog/author/*` → `/blog/` redirects added.

**✅ Client SMS opt-in pages MIGRATED (2026-07-15)** — the last hard cutover blocker, cleared. Each page embeds
the client's REAL GHL consent form at the byte-identical A2P-registered slug (standalone `optin.njk` layout,
noindex, SSR disclosure footer). URLs unchanged → no approved A2P campaign touched. Form IDs (grabbed live from
GHL Sites→Forms, 406 sub `To7tF3i6kQHNNNuJGqpQ`):

| Slug (A2P-registered) | GHL form ID | Client |
|---|---|---|
| `/ktrt-opt-in` | `eZs2YAlD0LMO1Wpw7KaN` | Kalispell TRT |
| `/tls-opt-in` | `G1uV03IAA5OPQCmyKnsd` | TL Slicks |
| `/mob-opt-in` | `YK4AOa23HvHovkOvY9Fp` | Montana's Okayest Barber |
| `/mikeys-tint-shop-opt-in` | `FV6rsGXId99ghK1FbweU` | Mikey's Tint Shop |

**🎉 CUTOVER COMPLETE — LIVE ON NETLIFY (2026-07-15):** `406frontdesk.com` now serves the Netlify site with
valid SSL. DNS is managed IN GHL (registrar). Two records changed in GHL DNS: apex `A → 75.2.60.5` (Netlify LB,
unproxied) + `CNAME www → 406frontdesk.netlify.app`; `links` (booking) + Google MX (email) + Mailgun left untouched.
Netlify project renamed to **`406frontdesk`** (→ `406frontdesk.netlify.app`). Post-cutover check clean: 15 site
pages + 4 A2P opt-in pages all 200, 18-URL sitemap, correct chat widget, booking + email unaffected.

**Post-cutover housekeeping (optional):** disconnect the old GHL connected-products (funnel/website/blog) for
tidiness; resubmit `sitemap.xml` to Google Search Console; (future) consolidate all domains onto Gus's own Cloudflare.

**Live preview (git-connected, auto-deploys on push):** https://rainbow-dragon-3f699c.netlify.app
Repo: https://github.com/ghill217/406frontdesk-site · connected 2026-07-15.

## Remaining phases
1. ✅ Port pages 2–10 (done 2026-07-15).
2. ✅ Asset polish: favicon + apple-touch + 1200×630 OG image; ✅ fonts self-hosted (2026-07-31, no more
   fonts.googleapis.com/gstatic requests); ✅ WebP where it wins (founder −25%, Kalispell TRT logo −65%;
   the small flat PNGs and the OG image are deliberately left alone — WebP was larger or riskier).
3. ✅ /a2p-check PASS (2026-07-15): consent pages preserve all clauses (checkbox-scoped, no bundling, no-third-party-share, STOP/HELP, freq, data rates); demo form checkbox-scoped + 406 LLC branded; scorecard email-only (no A2P scope). Static SSR reads clean for the scanner. Cutover keeps A2P valid (same URLs, same clauses).
4. ✅ One-time connect (done): GitHub `ghill217/406frontdesk-site` → Netlify `rainbow-dragon-3f699c.netlify.app`, auto-deploy on push.
5. ✅ /site-audit re-grade: **overall A, 12/12 A-range** (SEO+Perf A+; Trust/Local/A11y A−). 
6. ⬜ DNS cutover (Gus's trigger): point 406frontdesk.com at Netlify after final review. Add `_redirects` for any changed URLs.
7. ⬜ Verify booking iframe + chat widget + demo form post-cutover; confirm A2P scanner still passes.
8. ✅ **Chat widget — ROOT CAUSE FIXED (7/15):** the off-brand + "MOB LLC" consent was because the site loaded the WRONG widget id (`6a1f69...`). Corrected to the real 406 SMS bot `6a5100ae557ed325dae28d63`. Remaining = a quick visual confirm the correct widget renders navy/amber + consent = 406 Front Desk LLC.
9. ✅ **Phone-mockup hero scroll bug fixed (7/15):** `.phone-screen` was user-scrollable (`overflow-y:auto`) → now `overflow:hidden` + `pointer-events:none`; JS auto-scroll animation still works.
10. ✅ Remaining ports: all 6 blog posts published (verified 2026-07-31).

### A− → A+ paths (from the audit)
- Trust: add "established 2026" + a first testimonial to the homepage proof section.
- Local: add street address to LocalBusiness schema (base.njk) + contact page. (Hours already present;
  `areaServed` widened to Flathead Valley / Montana / US on 2026-07-31.)
- ✅ A11y: full contrast + keyboard pass done 2026-07-31. All 17 pages audited — 0 contrast failures,
  0 heading-order breaks, 0 mobile overflow. Amber is now a fill-only colour: `--accent-text` #976411
  and `--accent-display` #c08016 carry amber *text* on light backgrounds (see the block in `a11y.css`).
  Re-run the audit before shipping palette changes.

## Session log — 2026-08-20 (GSC 404 validation)

Google Search Console's *Not found (404)* fix-validation kept failing. Two URLs in the bucket;
only one was real.

- `/_preview/` — last crawled **Jul 17**, before the 8/9 redirect shipped. Already 301s. Stale flag.
- `/month` — crawled **Aug 16**, genuinely 404, and **linked from nowhere**: all 45 internal links
  and all 41 sitemap URLs returned 200.

**Root cause: Googlebot extracts URL-like string literals out of inline JavaScript and crawls them.**
`roi.njk`'s calculator built its result suffix with `span.textContent = "/month"` — a display string
that was never a path. Google read the literal and crawled it.

Fixed (`0ee0472`): the suffix moved into static markup with the JS writing only the number into its
own `#rMonthly` span; `.result-big span` → `.result-big .result-suffix` so the number no longer
inherits the 18px suffix styling; `/month → /roi/ 301` added to `src/_redirects` for the URL Google
already holds. Verified live: `/month` 301s, `/roi/` renders and computes identically ($900/month at
defaults), zero path-shaped literals left in the deployed page. Re-validation started 8/20
(PENDING 2 / FAILED 0).

Also confirmed **not** defects, so nobody re-chases them: *Page with redirect* (12) is slashless
variants 301ing to canonicals, and *Excluded by 'noindex'* (3) is `/start/`, `/404`, `/404.html`,
all deliberate. Both validations fail permanently because the flagged behavior is the correct one.

## Session log — 2026-08-18 (web-services search track)
- Gus: be a top result for web-design / SEO searches WITHOUT diluting the receptionist. Additive only.
- NEW `/websites/` (web-design hub) + `/seo/` (local SEO) on shared `css/web.css` (tokens-based, no local
  `:root`). Proof band names consented clients only (KTRT, TL Slicks, MOB); prices are floors worded "from".
- Nav: "Websites & SEO" (6 items). Footer: new "Web services" group. `/features/` + `/pricing/` link
  through; retired GBP "Q&A" claim → "posts".
- Schema (`base.njk`): `hasOfferCatalog` (4 services) + `knowsAbout`; description keeps the receptionist as
  the lead clause. Both CTAs point at `/scorecard/` (Gus confirmed keep, 2026-08-18).
- Commits `5e66921`→`b14107e`, deployed; GSC indexing requested for both URLs.

## Session log — 2026-07-31 / 08-01

Shipped (PR #1, merged as `39e5d8d`):
- `/gyms/` and `/accounting/` vertical pages. No brand chip on either — no client in those
  verticals yet, and both files carry a comment saying not to add proof until there is one.
- Out-of-area: new FAQ entry + JSON-LD; `areaServed` widened to Flathead Valley / Montana / US.
  Postal address stays Kalispell so the local-pack signal is untouched.
- Fonts self-hosted; no fonts.googleapis.com / gstatic requests remain anywhere.
- WebP for the two images where it was actually smaller (see phase 2 above).
- WCAG AA pass: amber retired as a text colour on light backgrounds.

Follow-up (same branch, after the merge): committed `scripts/a11y-audit.mjs` + `CLAUDE.md`.
Running the committed audit over **all 31 pages** — rather than the 17 checked by hand during
the PR — turned up two things the manual pass missed:
- **The four A2P opt-in pages had 20 contrast failures.** `optin.njk` is a standalone layout
  that loads neither `tokens.css` nor `a11y.css`, so every site-wide contrast fix skipped it.
  Fixed in its own inline palette. Colour only — rendered consent text verified byte-identical.
- **`/sms-consent/` scrolled 75px sideways at 390px.** The support address is `nowrap`
  (a11y.css keeps addresses unbroken), which stopped a flex row from shrinking. `flex-wrap`
  on the row fixes it without breaking the address.

Still open:
- Trust A+: a first testimonial in the homepage proof section.
- Local A+: street address in the LocalBusiness schema + contact page. Needs a real address.
- ~~`/trades/`~~ — built 2026-08-01 (HVAC, plumbing, electrical, roofing, GC/remodel,
  excavation/landscaping). Same shell as the other verticals; no proof/testimonial section
  until a trades client is live (same rule as the rest).
- Josh Snook / Living Proof Fitness: offered a founding-client build when the gym opens
  (waived setup + founding rate). Terms not sent yet — Gus's call.

## Notes / gotchas
- Local build: `npm run build`; dev server: `npm start` (Eleventy serve on :8080). Node at `C:\Program Files\nodejs`.
- Preview-pane screenshots time out because the GHL chat widget + form iframe keep the network open;
  verify render via `javascript_tool` computed styles instead (proven this works).
- Internal links converted to root-relative (`/features/`) so previews are self-contained pre-cutover.
- 🔴 **Never put a path-shaped string literal in inline JS** (`"/month"`, `"/day"`, `"/mo"`). Googlebot
  extracts URL-like strings from scripts and crawls them, producing 404s that no link-crawl or sitemap
  check can find because nothing links them. Put display suffixes in static markup. Cost a failed GSC
  validation 7/18–8/17/26.
