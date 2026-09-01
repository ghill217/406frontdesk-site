#!/usr/bin/env node
/**
 * check-directions.mjs — contrast + variety gate for src/_data/directions.json
 *
 * WHY: the design directions are offered to clients as "all high quality". That is
 * enforced here, not asserted in prose. A palette that sings on screen can be
 * unreadable as type -- the `accent` / `accentInk` two-role split is exactly the
 * lesson already baked into .claude/scripts/brandkit.py, and it is checked here for
 * the same reason.
 *
 * Run:  node scripts/check-directions.mjs
 *       node scripts/check-directions.mjs --selftest
 *
 * --selftest builds deliberately broken directions and asserts every check FAILS on
 * them. A check that can only ever pass is worse than no check.
 */
import { readFileSync, writeFileSync } from "node:fs";

const MIN_BODY = 4.5;   // WCAG AA, normal text
const MIN_LARGE = 3.0;  // WCAG AA, large text / UI boundaries

const hex = (h) => {
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (!m) throw new Error(`not a 6-digit hex: ${h}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (h) => {
  const [r, g, b] = hex(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const r2 = (n) => Math.round(n * 100) / 100;

/** The label colour a filled accent button uses. Declared in the JSON, not inferred,
 *  so the template needs no contrast math -- and checked here so a declared value that
 *  cannot carry words is a build failure rather than a rendering surprise. */
export function buttonLabel(d) {
  return d.palette.btnLabel;
}


/**
 * The Google Fonts request is DERIVED from the data: the family/weight list from the
 * type pairings, and a `text=` subset from the sample copy plus the direction names.
 *
 * Subsetting takes the 20 live previews from ~1.0 MB of webfont to ~420 KB. The cost
 * is that a glyph outside the subset silently falls back to the system face -- which
 * is why this is generated and then CHECKED below, never hand-maintained.
 */
export function fontUrl(data) {
  const rendered = [];
  const s = data.sample;
  rendered.push(...s.nav, s.navCta, s.eyebrow, s.headline, s.body, s.ctaPrimary, s.ctaSecondary);
  for (const t of s.tiles) rendered.push(t.h, t.p);
  for (const it of data.items) rendered.push(it.name);   // the preview wordmark
  const charset = [...new Set(rendered.join(""))].sort().join("");

  const weights = new Map();
  for (const it of data.items) {
    const h = it.type.heading, b = it.type.body;
    if (!weights.has(h.name)) weights.set(h.name, new Set());
    weights.get(h.name).add(h.weight);
    if (!weights.has(b.name)) weights.set(b.name, new Set());
    weights.get(b.name).add(400); weights.get(b.name).add(600);
  }
  const fams = [...weights.keys()].sort().map((name) => {
    if (name === "Fraunces") return "Fraunces:opsz,wght@9..144,600;9..144,700";
    const ws = [...weights.get(name)].sort((a, b) => a - b);
    const slug = name.replace(/ /g, "+");
    return ws.length === 1 && ws[0] === 400 ? slug : `${slug}:wght@${ws.join(";")}`;
  });
  return "https://fonts.googleapis.com/css2?" + fams.map((f) => "family=" + f).join("&")
       + "&text=" + encodeURIComponent(charset) + "&display=swap";
}

export function checkDirection(d) {
  const p = d.palette;
  const fails = [];
  const need = (fg, bg, min, what) => {
    const c = contrast(fg, bg);
    if (c < min) fails.push(`${d.code} ${what}: ${fg} on ${bg} = ${r2(c)}:1, need ${min}:1`);
  };

  need(p.ink, p.page, MIN_BODY, "body text on page");
  need(p.ink, p.surface, MIN_BODY, "body text on surface");
  need(p.muted, p.page, MIN_BODY, "muted text on page");
  need(p.muted, p.surface, MIN_BODY, "muted text on surface");
  // accentInk is checked precisely because accent itself usually cannot carry words.
  need(p.accentInk, p.page, MIN_BODY, "accent used as TYPE on page");
  need(p.accent, p.page, MIN_LARGE, "accent as a UI fill against page");
  if (!p.btnLabel) fails.push(`${d.code} palette.btnLabel is not declared`);
  else need(p.btnLabel, p.accent, MIN_BODY, "button label on accent fill");
  need(p.hair, p.page, 1.15, "hairline visible against page");

  return fails;
}

export function checkSet(items) {
  const fails = [];
  const codes = items.map((d) => d.code);
  if (new Set(codes).size !== codes.length) fails.push("duplicate direction codes");

  const grounds = new Set(items.map((d) => d.ground));
  if (!grounds.has("light") || !grounds.has("dark"))
    fails.push(`variety: the set must span light AND dark grounds (has: ${[...grounds].join(", ")})`);

  const heads = items.map((d) => d.type.heading.name);
  const dupe = heads.filter((h, i) => heads.indexOf(h) !== i);
  if (dupe.length) fails.push(`variety: heading font reused (${[...new Set(dupe)].join(", ")})`);

  return fails;
}

/** Catches the silent rot: someone edits sample copy or adds a direction, and the
 *  stored font request no longer carries the glyphs the page renders. */
export function checkFontUrl(data) {
  const want = fontUrl(data);
  if (data.googleFonts === want) return [];
  return ["googleFonts is STALE for the current data -- regenerate with: node scripts/check-directions.mjs --fix-fonts"];
}

/** The check that actually protects the page: every family+weight the data needs must
 *  exist as an @font-face in the generated stylesheet, and every file it points at must
 *  be on disk. A missing face renders as a system fallback -- which looks fine, and is
 *  wrong, which is exactly why this is mechanical. */
export function checkSelfHostedFonts(data, cssText, fileExists) {
  const fails = [];
  const faces = [];
  for (const m of cssText.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const fam = /font-family:\s*'([^']+)'/.exec(m[1]);
    const wgt = /font-weight:\s*([0-9]+)(?:\s+([0-9]+))?/.exec(m[1]);
    const src = /url\('([^']+)'\)/.exec(m[1]);
    if (!fam || !src) continue;
    const lo = wgt ? +wgt[1] : 400;
    const hi = wgt && wgt[2] ? +wgt[2] : lo;
    faces.push({ family: fam[1], lo, hi, src: src[1] });
    if (!fileExists(src[1])) fails.push(`font file missing on disk: ${src[1]}`);
  }
  if (!faces.length) return ["no @font-face rules found -- the page would render in system fonts"];

  const need = new Map();
  for (const it of data.items) {
    const h = it.type.heading, b = it.type.body;
    need.set(`${h.name}|${h.weight}`, [h.name, h.weight]);
    need.set(`${b.name}|400`, [b.name, 400]);
    need.set(`${b.name}|600`, [b.name, 600]);
  }
  for (const [family, weight] of need.values()) {
    const ok = faces.some((f) => f.family === family && weight >= f.lo && weight <= f.hi);
    if (!ok) fails.push(`no self-hosted face for ${family} ${weight}`);
  }
  return fails;
}

function selftest() {
  const good = {
    code: "T-OK", ground: "light",
    palette: { page: "#FFFFFF", surface: "#FFFFFF", ink: "#111111", muted: "#595959",
               accent: "#9E2B25", accentInk: "#7E1F1A", hair: "#E0E0E0", btnLabel: "#FFFFFF" },
    type: { heading: { name: "A" }, body: { name: "B" } },
  };
  const clone = (patch) => ({ ...good, palette: { ...good.palette, ...patch } });
  const cases = [
    ["clean direction passes", () => checkDirection(good).length === 0],
    ["unreadable body text caught", () => checkDirection(clone({ ink: "#CCCCCC" })).some((f) => f.includes("body text on page"))],
    ["unreadable muted text caught", () => checkDirection(clone({ muted: "#D8D8D8" })).some((f) => f.includes("muted text on page"))],
    // The control that matters: accentInk = accent is the exact mistake brandkit's own
    // selftest was written to catch. A raw screen accent usually cannot carry words.
    ["accentInk set to a raw screen accent caught", () => checkDirection(clone({ accent: "#E8A435", accentInk: "#E8A435" })).some((f) => f.includes("accent used as TYPE"))],
    ["invisible accent fill caught", () => checkDirection(clone({ accent: "#FDFDFD", accentInk: "#7E1F1A" })).some((f) => f.includes("accent as a UI fill"))],
    ["unreadable declared button label caught", () => checkDirection(clone({ btnLabel: "#E8A435" })).some((f) => f.includes("button label on accent"))],
    ["missing btnLabel caught", () => checkDirection(clone({ btnLabel: undefined })).some((f) => f.includes("btnLabel is not declared"))],
    ["invisible hairline caught", () => checkDirection(clone({ hair: "#FEFEFE" })).some((f) => f.includes("hairline"))],
    ["all-light set caught", () => checkSet([{ ...good, ground: "light" }, { ...good, code: "T-2", ground: "light", type: { heading: { name: "C" }, body: { name: "B" } } }]).some((f) => f.includes("light AND dark"))],
    ["reused heading font caught", () => checkSet([{ ...good, ground: "light" }, { ...good, code: "T-2", ground: "dark" }]).some((f) => f.includes("heading font reused"))],
    ["stale font request caught", () => {
      const data = JSON.parse(readFileSync(new URL("../src/_data/directions.json", import.meta.url)));
      data.sample.headline = data.sample.headline + " Zzz";   // introduces glyphs the subset lacks
      return checkFontUrl(data).length === 1;
    }],
    ["current font request passes", () => {
      const data = JSON.parse(readFileSync(new URL("../src/_data/directions.json", import.meta.url)));
      return checkFontUrl(data).length === 0;
    }],
    ["missing self-hosted face caught", () => {
      const data = { items: [{ type: { heading: { name: "Nope", weight: 700 }, body: { name: "Nope", weight: 400 } } }] };
      const css = "@font-face { font-family: 'Other'; font-weight: 400; src: url('/assets/fonts/directions/x.woff2'); }";
      return checkSelfHostedFonts(data, css, () => true).some((f) => f.includes("no self-hosted face for Nope"));
    }],
    ["font file missing on disk caught", () => {
      const data = { items: [] };
      const css = "@font-face { font-family: 'A'; font-weight: 400; src: url('/assets/fonts/directions/gone.woff2'); }";
      return checkSelfHostedFonts(data, css, () => false).some((f) => f.includes("missing on disk"));
    }],
    ["empty stylesheet caught", () => checkSelfHostedFonts({ items: [] }, "/* nothing */", () => true).length === 1],
    ["duplicate codes caught", () => checkSet([{ ...good, ground: "light" }, { ...good, ground: "dark", type: { heading: { name: "C" }, body: { name: "B" } } }]).some((f) => f.includes("duplicate direction codes"))],
  ];
  let bad = 0;
  for (const [label, fn] of cases) {
    let ok = false;
    try { ok = fn(); } catch (e) { ok = false; }
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) bad++;
  }
  console.log(bad === 0 ? "\nselftest: 16/16 controls behave (positive + negative)." : `\nselftest: ${bad} CONTROL(S) BROKEN`);
  return bad === 0 ? 0 : 1;
}

function main() {
  if (process.argv.includes("--selftest")) process.exit(selftest());

  const data = JSON.parse(readFileSync(new URL("../src/_data/directions.json", import.meta.url)));
  const items = data.items;

  if (process.argv.includes("--fix-fonts")) {
    data.googleFonts = fontUrl(data);
    writeFileSync(new URL("../src/_data/directions.json", import.meta.url),
                  JSON.stringify(data, null, 2) + String.fromCharCode(10));
    console.log("googleFonts regenerated from the data.");
    process.exit(0);
  }

  const cssUrl = new URL("../src/css/directions-fonts.css", import.meta.url);
  let cssText = "";
  try { cssText = readFileSync(cssUrl, "utf8"); }
  catch { cssText = ""; }
  const exists = (webPath) => {
    try { readFileSync(new URL(".." + webPath.replace("/assets/", "/src/assets/"), import.meta.url)); return true; }
    catch { return false; }
  };
  const fails = [
    ...items.flatMap(checkDirection),
    ...checkSet(items),
    ...checkFontUrl(data),
    ...(cssText ? checkSelfHostedFonts(data, cssText, exists)
                : ["src/css/directions-fonts.css is missing -- run: python scripts/selfhost-fonts.py"]),
  ];

  console.log(`Checked ${items.length} direction(s).\n`);
  for (const d of items) {
    const p = d.palette;
    console.log(
      `  ${d.code} ${d.name.padEnd(9)} ${String(d.ground).padEnd(5)} ` +
      `ink ${r2(contrast(p.ink, p.page))}  muted ${r2(contrast(p.muted, p.page))}  ` +
      `accentInk ${r2(contrast(p.accentInk, p.page))}  btn ${r2(contrast(buttonLabel(d), p.accent))}`
    );
  }
  if (fails.length) {
    console.log(`\n${fails.length} FAILURE(S):`);
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll directions pass contrast + variety. (Run --selftest to prove the checks can fail.)");
}
// Only run the CLI when invoked directly, so other modules can import the helpers.
import { argv } from "node:process";
if (argv[1] && argv[1].endsWith("check-directions.mjs")) main();
