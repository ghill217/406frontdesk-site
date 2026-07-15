# 406 Front Desk — Website

Marketing site for [406 Front Desk](https://406frontdesk.com), built with [Eleventy](https://www.11ty.dev/)
and deployed on Netlify. Static HTML, no client framework.

## Local development

```bash
npm install      # once
npm start        # dev server with live reload → http://localhost:8080
npm run build    # production build → dist/
```

Node 24 LTS required (see `.nvmrc`). On this machine Node is at `C:\Program Files\nodejs`.

## Structure

```
src/
├── _data/site.json          business facts + nav links (single source)
├── _includes/
│   ├── layouts/base.njk      HTML shell: SEO, schema, header/footer, chat widget
│   └── partials/             header.njk, footer.njk
├── css/<page>.css            per-page styles
├── assets/img/               images
├── index.njk, *.njk          pages
├── sitemap.njk               → /sitemap.xml
└── robots.txt
```

## Deploy

Connected to Netlify via Git — every push to `main` triggers `npm run build` and publishes `dist/`.
Netlify config is in `netlify.toml`.

## Editing

- **Change nav or footer links:** edit `src/_data/site.json` only.
- **Edit a page:** edit its `.njk` file in `src/`. Styles live in `src/css/<page>.css`.
- **Add a redirect:** `src/_redirects`.

See `PROGRESS.md` for migration status and remaining work.
