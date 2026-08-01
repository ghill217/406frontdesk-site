# 406 Front Desk — working notes for Claude

Marketing site for [406frontdesk.com](https://406frontdesk.com). Eleventy, static HTML,
no client framework. See `README.md` for structure and `PROGRESS.md` for history.

## The things that will bite you

**`main` deploys to production.** Netlify is git-connected: every push to `main` publishes
to the live site within a minute or two. There is no staging gate. Work on a branch and let
a human merge unless they explicitly say otherwise.

**Never change the four A2P opt-in slugs or their consent wording.**
`/ktrt-opt-in`, `/tls-opt-in`, `/mob-opt-in`, `/mikeys-tint-shop-opt-in` are registered with
carriers against approved A2P campaigns. The URLs and the consent language on them are load-
bearing legal text. Styling changes are fine; wording and slugs are not. If you touch
`_includes/layouts/optin.njk`, diff the *rendered* text before and after to prove it's unchanged.

**`optin.njk` is standalone.** It loads neither `tokens.css` nor `a11y.css` — it carries its
own inline `:root` palette. Site-wide CSS fixes silently do not reach those four pages. This
has already caused one miss.

**Never invent proof.** No testimonial, star rating, client logo, or call statistic goes on
the site until it's real and confirmed. Pages for verticals without a client (`/gyms/`,
`/accounting/`) carry a comment saying exactly this. Build the argument from things that are
true on their face instead.

## CSS cascade — load order matters

`base.njk` loads, in order: `fonts.css` → `tokens.css` → `<page>.css` → `a11y.css`.

Most page stylesheets still carry their **own duplicate `:root` palette**, a leftover from the
byte-for-byte GHL port. That means a change to `tokens.css` is overridden on those pages.
`a11y.css` loads last, so it is the only reliable place for a site-wide palette override —
that's why `--ink-muted`, `--accent-dark` and friends are set there rather than in `tokens.css`.
When you migrate a page onto tokens, delete its local `:root` block.

**Amber is a fill colour, not a text colour.** `--accent` (#E8A435) is 2.0:1 on cream and
`--accent-dark` was 2.8:1 — both fail WCAG AA as body text. For amber *text on light
backgrounds* use `--accent-text` (#976411, AA at any size) or `--accent-display` (#c08016,
AA at ≥24px only). Amber on the navy bands passes and is deliberately left alone.

## Adding a vertical landing page

`/barbershops/`, `/clinics/`, `/gyms/`, `/accounting/` are one pattern. To add another, copy
the closest existing pair:

1. `src/<name>.njk` — header band, `.wrap` with three `.lcard` problem cards, `.inner-sec`
   service grid, `.book-band` of that industry's scheduling software, `.proof-band`, `.cta-band`.
2. `src/css/<name>.css` — copy `gyms.css`. It has **no local `:root`** (tokens cover it); keep
   it that way for new pages.
3. Add it to `footerGroups` → Industries in `src/_data/site.json`.
4. Card headings are `<h2 class="lcard-title">`, not `h3` — an `h3` straight after the page
   `h1` is a heading-order break.

The sitemap picks up any page without `noindex: true` automatically.

## Verify before you hand anything over

```bash
npm run build     # required first — audit reads dist/
npm i --no-save playwright   # not a dependency; see below
npm run audit     # contrast, heading order, alt text, labels, overflow, dead links
```

`npm run audit` covers **all** pages in `dist/`, exits non-zero on any failure, and is the
check to re-run before shipping a palette change. It found 43 real contrast failures on its
first run, including body copy that was rendering white-on-cream (invisible) and an amber
button whose navy text was being overridden by a more specific selector.

Playwright is deliberately **not** in `package.json`: Netlify installs devDependencies during
the production build and this tool is never used there.

Screenshots of pages need third-party requests blocked — the GHL chat widget and booking
iframe hold the network open, so `networkidle` never fires otherwise. `scripts/a11y-audit.mjs`
shows the routing pattern.

## Editing conventions

- Nav and footer links live in `src/_data/site.json` only.
- Business facts (phone, email, city, booking URL, widget IDs) also live there — don't hardcode.
- Internal links are root-relative (`/features/`).
- Copy voice: second person, concrete scenario first, no hype, em-dashes over semicolons.
  Read `/barbershops/` before writing new marketing copy.
- Commit granularity: one concern per commit, so a risky change can be reverted alone.
