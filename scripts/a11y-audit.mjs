#!/usr/bin/env node
/**
 * 406 Front Desk — accessibility + link audit.
 *
 *   npm run build          # dist/ must exist and be current
 *   npx playwright@1 install-deps   # only if chromium is missing
 *   npm run audit
 *
 * Checks every page in dist/ for:
 *   - WCAG AA contrast (4.5:1 body text, 3:1 for >=24px or >=18.66px bold)
 *   - heading-order jumps (h1 -> h3 with no h2)
 *   - <img> without alt, links with no accessible name, unlabelled form fields
 *   - duplicate ids, missing lang, h1 count != 1
 *   - horizontal overflow at 390px
 *   - dangling internal links
 *
 * Exits non-zero if anything fails, so it can gate a release.
 *
 * WHY THIS EXISTS: brand amber is a *fill* colour. #E8A435 is 2.0:1 on cream
 * and #c98a1a is 2.8:1 — both fail as body text. src/css/a11y.css defines
 * --accent-text (#976411) and --accent-display (#c08016) for amber text on
 * light backgrounds. Re-run this before shipping any palette change; the
 * first run of it found 43 real failures including white-on-cream body copy
 * that was effectively invisible.
 *
 * playwright is deliberately NOT a package.json dependency — Netlify installs
 * devDependencies during the production build and this tool is never used
 * there. Install it ad hoc: `npm i --no-save playwright`.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.AUDIT_PORT || 8099);

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon' };

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed. Run:\n  npm i --no-save playwright\n');
  process.exit(2);
}

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(2);
}

// ---- static server (no dependency) -----------------------------------------
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(PORT, r));

// ---- discover pages + build the set of valid internal URLs -----------------
const pages = [], built = new Set();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    const url = '/' + path.relative(DIST, full).split(path.sep).join('/');
    built.add(url);
    if (url.endsWith('/index.html')) {
      built.add(url.slice(0, -'index.html'.length));
      pages.push(url.slice(0, -'index.html'.length));
    } else if (url.endsWith('.html')) {
      pages.push(url);
    }
  }
})(DIST);
pages.sort();

// ---- contrast maths --------------------------------------------------------
const lum = ([r, g, b]) => {
  const f = v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const parse = s => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
  const p = m[1].split(',').map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
const flatten = (fg, bg) => fg.a >= 1 ? fg.rgb : fg.rgb.map((v, i) => v * fg.a + bg[i] * (1 - fg.a));

const report = { contrast: [], structure: [], overflow: [], links: [] };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// Block third parties: the GHL chat widget and booking iframe hold the network
// open forever, so networkidle never fires with them enabled.
await ctx.route('**/*', r => r.request().url().includes(`localhost:${PORT}`) ? r.continue() : r.abort());
const page = await ctx.newPage();

for (const url of pages) {
  const resp = await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'networkidle', timeout: 30000 });
  if (!resp || resp.status() >= 400) { report.structure.push({ url, issue: `HTTP ${resp && resp.status()}` }); continue; }

  const res = await page.evaluate(() => {
    const out = { texts: [], imgs: [], links: [], hrefs: [], labels: [], headings: [], dupIds: [],
                  lang: document.documentElement.lang, h1: document.querySelectorAll('h1').length };

    // Effective backdrop: walk ancestors for an opaque background-color, and
    // treat a gradient's first solid stop as the backdrop (background-color is
    // transparent on gradient elements, which otherwise reads as the body).
    function bgOf(el) {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
        if (m) { const p = m[1].split(',').map(Number); if (p.length < 4 || p[3] > 0.85) return cs.backgroundColor; }
        if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) {
          for (const stop of cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []) {
            const p = stop.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
            if (p.length < 4 || p[3] > 0.5) return stop;
          }
        }
      }
      return 'rgb(255,255,255)';
    }

    const seenIds = new Set();
    document.querySelectorAll('[id]').forEach(e => seenIds.has(e.id) ? out.dupIds.push(e.id) : seenIds.add(e.id));
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h =>
      out.headings.push({ lvl: +h.tagName[1], text: (h.textContent || '').trim().slice(0, 45) }));
    document.querySelectorAll('img').forEach(i => { if (!i.hasAttribute('alt')) out.imgs.push(i.getAttribute('src')); });
    document.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href');
      if (href && href.startsWith('/')) out.hrefs.push(href.split('#')[0]);
      if (!(a.getAttribute('aria-label') || (a.textContent || '').trim() ||
            a.querySelector('img[alt]:not([alt=""])'))) out.links.push(href);
    });
    document.querySelectorAll('input,select,textarea').forEach(f => {
      if (f.type === 'hidden') return;
      const lab = (f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`)) || f.closest('label');
      if (!lab && !f.getAttribute('aria-label') && !f.getAttribute('aria-labelledby'))
        out.labels.push(f.name || f.type);
    });

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n; (n = walker.nextNode());) {
      const t = n.textContent.trim();
      if (t.length < 3) continue;
      const el = n.parentElement;
      if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const bg = bgOf(el);
      const key = `${el.tagName}|${cs.color}|${cs.fontSize}|${cs.fontWeight}|${bg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.texts.push({ text: t.slice(0, 40), color: cs.color, bg,
        size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight) || 400,
        sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\s+/).join('.') : '') });
    }
    return out;
  });

  for (const t of res.texts) {
    const fg = parse(t.color), bg = parse(t.bg);
    if (!fg || !bg) continue;
    const cr = ratio(flatten(fg, bg.rgb), bg.rgb);
    const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
    const need = large ? 3.0 : 4.5;
    if (cr < need) report.contrast.push({ url, sel: t.sel.slice(0, 60), text: t.text,
      size: t.size, ratio: +cr.toFixed(2), need, color: t.color, bg: t.bg });
  }
  res.imgs.forEach(src => report.structure.push({ url, issue: 'img missing alt', detail: src }));
  res.links.forEach(h => report.structure.push({ url, issue: 'link has no accessible name', detail: h }));
  res.labels.forEach(f => report.structure.push({ url, issue: 'unlabelled form field', detail: f }));
  res.dupIds.forEach(id => report.structure.push({ url, issue: 'duplicate id', detail: id }));
  if (res.h1 !== 1) report.structure.push({ url, issue: `h1 count = ${res.h1}` });
  if (!res.lang) report.structure.push({ url, issue: 'no lang attribute' });

  let prev = 0;
  for (const h of res.headings) {
    if (prev && h.lvl > prev + 1) report.structure.push({ url, issue: `heading jump h${prev}->h${h.lvl}`, detail: h.text });
    prev = h.lvl;
  }
  for (const h of new Set(res.hrefs)) {
    if (!h) continue;
    if (!built.has(h) && !built.has(h.replace(/\/?$/, '/'))) report.links.push({ url, href: h });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (ov > 0) report.overflow.push({ url, px: ov });
  await page.setViewportSize({ width: 1280, height: 900 });
}

await browser.close();
server.close();

// ---- output ----------------------------------------------------------------
const line = (label, rows, fmt) => {
  console.log(`\n${label}: ${rows.length}`);
  rows.forEach(r => console.log('   ' + fmt(r)));
};
console.log(`Audited ${pages.length} pages from dist/`);
line('CONTRAST FAILURES', report.contrast,
  r => `${r.url}  ${r.sel}  ${r.size}px  ${r.ratio}:1 (needs ${r.need})  fg=${r.color} bg=${r.bg}  "${r.text}"`);
line('STRUCTURE ISSUES', report.structure, r => `${r.url}  ${r.issue}${r.detail ? '  — ' + r.detail : ''}`);
line('MOBILE OVERFLOW (390px)', report.overflow, r => `${r.url}  ${r.px}px`);
line('DANGLING INTERNAL LINKS', report.links, r => `${r.href}  <- ${r.url}`);

const total = report.contrast.length + report.structure.length + report.overflow.length + report.links.length;
console.log(total ? `\n${total} issue(s) found.` : '\nClean — 0 issues.');
process.exit(total ? 1 : 0);
