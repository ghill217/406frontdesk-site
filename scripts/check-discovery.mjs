#!/usr/bin/env node
/**
 * check-discovery.mjs — drive /discovery/ in a real browser, the way the person it was
 * built for would use it: in pieces, across a reload and a second device, sending early,
 * coming back, and once while the CRM is down.
 *
 *   npm run build && node scripts/check-discovery.mjs [--shots <dir>]
 *
 * Runs against scripts/dev-discovery.mjs (the REAL handler, a fake GHL), so it writes
 * nothing to the live sub. Playwright is resolved the same way check-nav-occlusion.mjs
 * does it: `playwright` if importable, else PLAYWRIGHT_DIR.
 *
 * Exit 1 on any failed control. A run that could not start a browser exits 2 and says
 * so: it verified nothing, and must never read as a pass.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt > -1 ? process.argv[shotsAt + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

async function loadPlaywright() {
  try { return await import("playwright"); } catch {}
  for (const dir of [process.env.PLAYWRIGHT_DIR, process.cwd()].filter(Boolean)) {
    try { return await import(pathToFileURL(createRequire(path.join(dir, "noop.js")).resolve("playwright")).href); } catch {}
  }
  return null;
}

function boot(port, extra = []) {
  const child = spawn(process.execPath, [path.join(HERE, "dev-discovery.mjs"), ...extra], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("dev server did not start")), 15000);
    child.stdout.on("data", (d) => { if (String(d).includes("discovery dev server")) { clearTimeout(t); resolve(child); } });
    child.on("exit", (c) => reject(new Error("dev server exited " + c)));
  });
}

const pw = await loadPlaywright();
if (!pw) { console.error("NO BROWSER: playwright could not be loaded (set PLAYWRIGHT_DIR). Nothing was verified."); process.exit(2); }

let bad = 0, n = 0;
const check = (name, ok, detail) => { n++; if (!ok) bad++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? "  -> " + JSON.stringify(detail) : ""}`); };

const okServer = await boot(8765);
const failServer = await boot(8766, ["--ghl-fail"]);
const browser = await (pw.chromium || pw.default.chromium).launch();
const URL_OK = "http://localhost:8765/discovery/";
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("406-discovery-v1") || "null"));
const stepNow = (page) => page.evaluate(() => +document.querySelector(".bb-step:not([hidden])").dataset.step);
const tap = (page, q, label) => page.locator(`[data-q="${q}"] .bb-option`, { hasText: label }).first().click();

try {
  /* ---- device one: a phone, in pieces ------------------------------------- */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await phone.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL_OK);

  check("fresh load: step 1 showing, rail painted", (await stepNow(page)) === 1 && (await page.locator(".bb-rail__step.is-current").count()) === 1);
  check("fresh load: nothing written to storage just for looking", (await stored(page)) === null);

  await page.click("[data-next]");
  check("step 1 is enforced: blanks keep you there", (await stepNow(page)) === 1 && (await page.locator(".bb-field.is-bad").count()) >= 4);

  await page.fill("#f_full_name", "Sam Example");
  await page.fill("#f_business", "Example Cycle Works");
  await page.fill("#f_email", "sam@example.com");
  await tap(page, "role", "Owner");
  await tap(page, "applies", "We sell products online");
  await tap(page, "applies", "We're a clinic or handle health information");
  await page.fill("#f_headline", "Answering the same five questions all day");
  await page.click("[data-next]");
  check("step 1 passes once filled", (await stepNow(page)) === 2);

  for (const pick of ["Texts, DMs and emails", "Ordering, inventory and shipping", "Payroll, books and taxes"]) await tap(page, "time_sucks", pick);
  const locked = await page.locator('[data-q="time_sucks"] .bb-option.is-locked').count();
  check("'pick up to 3' locks the rest at three", locked === 9, locked);
  check("and says so", (await page.locator('[data-q="time_sucks"] .bb-count').innerText()).startsWith("3 of 3 picked"));

  await tap(page, "admin_hours", "10 to 20");
  await tap(page, "admin_hours", "10 to 20");
  check("an optional chip can be un-tapped", (await page.locator('[data-q="admin_hours"] input:checked').count()) === 0);
  await tap(page, "admin_hours", "10 to 20");

  await page.locator('[data-q="time_sucks"] .dv-own summary').click();
  await page.fill('[name="time_sucks__own"]', "Shipping quotes eat my afternoons");

  /* ---- conditional questions ------------------------------------------------ */
  await page.locator('.bb-rail__step[data-step="6"]').click();
  check("rail: any step is reachable once step 1 passes", (await stepNow(page)) === 6);
  check("clinic note + system question appear when 'clinic' was tapped", (await page.locator('[data-q="clinic_note"]').isVisible()) && (await page.locator('[data-q="clinic_system"]').isVisible()));
  check("store question appears when 'sell online' was tapped", await page.locator('[data-q="ecom_volume"]').isVisible());
  await page.fill("#f_clinic_system", "SomeSystem");
  await page.locator('.bb-rail__step[data-step="1"]').click();
  await tap(page, "applies", "We're a clinic or handle health information");
  await page.locator('.bb-rail__step[data-step="6"]').click();
  check("un-tapping 'clinic' hides them again", !(await page.locator('[data-q="clinic_system"]').isVisible()));
  check("and a hidden question's answer is not kept", !("clinic_system" in ((await stored(page)).answers)));

  /* ---- close the tab mid-thought, come back ---------------------------------- */
  await page.locator('.bb-rail__step[data-step="3"]').click();
  await tap(page, "who_answers", "Voicemail");
  await page.reload();
  check("reload: same step", (await stepNow(page)) === 3);
  check("reload: answers back, including own words (unfolded)", (await page.inputValue('[name="time_sucks__own"]')) === "Shipping quotes eat my afternoons" && (await page.locator('[data-q="who_answers"] input:checked').getAttribute("value")) === "Voicemail");
  check("reload: says so", (await page.locator("#dvResume").innerText()).includes("right where you left off"));
  check("reload: caps re-applied", (await page.locator('[data-q="time_sucks"] .bb-option.is-locked').count()) === 9);

  /* ---- carry to a second device ---------------------------------------------- */
  await page.click("#dvCarryBtn");
  await page.waitForSelector("#dvCarryOut input");
  const link = await page.inputValue("#dvCarryOut input");
  check("carry: a private link is issued", /\/discovery\/\?r=[a-f0-9]{32}$/.test(link), link);

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page2 = await desktop.newPage();
  page2.on("pageerror", (e) => errors.push(e.message));
  await page2.goto(link);
  await page2.waitForSelector("#dvResume:not([hidden])");
  check("second device: lands on the same step with the answers", (await stepNow(page2)) === 3 && (await page2.inputValue("#f_headline")) === "Answering the same five questions all day");
  check("second device: the key is taken out of the address bar", !page2.url().includes("?r="), page2.url());

  /* ---- out of time: send what you have ---------------------------------------- */
  await tap(page2, "unanswered", "6–15");
  await page2.locator('.bb-step:not([hidden]) .dv-early [data-send]').click();
  await page2.waitForSelector("#dvVerdict:not([hidden])");
  const level = await page2.getAttribute("#dvVerdict", "data-level");
  check("early send: a verdict comes back", ["strong", "partial"].includes(level), level);
  check("verdict: the step rail and the form are really gone, not just flagged hidden", !(await page2.locator("#bbRail").isVisible()) && !(await page2.locator("#dvForm").isVisible()));
  const vtext = await page2.locator("#dvVerdict").innerText();
  check("verdict: takes the calls", vtext.includes("Calls nobody can get to"));
  check("verdict: says inventory and payroll are NOT mine", /NOT SOMETHING I DO/i.test(vtext) && vtext.includes("Ordering, inventory and shipping") && vtext.includes("Payroll, books and taxes"));
  check("verdict: states the store limit", vtext.includes("It does not replace your store"));
  check("verdict: admits what it could not judge", vtext.includes("couldn't judge") && vtext.includes("quotes and booking"));
  check("verdict: no leak figure without their numbers", !/\$\d/.test(vtext));
  check("verdict: no pricing", !/\/mo|per month|\$\d+ ?a month/i.test(vtext));
  check("early send keeps their answers on the device", (await stored(page2)) !== null);
  if (SHOTS) await page2.screenshot({ path: path.join(SHOTS, "verdict-desktop.png"), fullPage: true });

  const sent = await (await fetch("http://localhost:8765/__sent")).json();
  const up = sent.filter((s) => s.url === "/contacts/upsert").pop();
  check("what reached GHL: no phone, tagged, company set", up && !("phone" in up.body) && up.body.tags.includes("front desk discovery") && up.body.companyName === "Example Cycle Works");
  check("what reached GHL: a task for Gus", sent.some((s) => s.url.endsWith("/tasks") && /Example Cycle Works/.test(s.body.title)));
  const gone = await fetch("http://localhost:8765/.netlify/functions/discovery?draft=" + link.split("?r=")[1]);
  check("the carried draft is deleted once it is really sent", gone.status === 404);

  /* ---- come back and finish ---------------------------------------------------- */
  await page2.locator("#dvVerdict button", { hasText: "Add more answers" }).click();
  check("'add more' returns to the form", await page2.locator("#dvForm").isVisible());
  await page2.locator('.bb-rail__step[data-step="7"]').click();
  await page2.fill("#f_worth", "800");
  await tap(page2, "close_rate", "About 1 in 4");
  await page2.locator('.bb-step:not([hidden]) button[type="submit"]').click();
  await page2.waitForSelector("#dvVerdict:not([hidden])");
  const v2 = await page2.locator("#dvVerdict").innerText();
  check("final send: leak math now runs, on their numbers", v2.includes("$4,800 to $12,000 a month") && v2.includes("Your numbers, not mine"), v2.match(/\$[\d,]+[^\n]*/)?.[0]);
  check("final send clears the device copy", (await stored(page2)) === null);

  /* ---- the verdict on a phone --------------------------------------------------- */
  const overflow = await page2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check("verdict does not overflow sideways (desktop)", !overflow);
  await page2.setViewportSize({ width: 390, height: 844 });
  const overflowM = await page2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check("verdict does not overflow sideways (390px)", !overflowM);
  if (SHOTS) await page2.screenshot({ path: path.join(SHOTS, "verdict-mobile.png"), fullPage: true });

  /* ---- the CRM is down ------------------------------------------------------------ */
  const page3 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page3.goto("http://localhost:8766/discovery/");
  await page3.fill("#f_full_name", "Sam Example");
  await page3.fill("#f_business", "Example Cycle Works");
  await page3.fill("#f_email", "sam@example.com");
  await tap(page3, "role", "Owner");
  await page3.fill("#f_headline", "The phone");
  if (SHOTS) await page3.screenshot({ path: path.join(SHOTS, "step1-mobile.png"), fullPage: true });
  await page3.click("[data-next]");
  if (SHOTS) await page3.screenshot({ path: path.join(SHOTS, "step2-mobile.png"), fullPage: true });
  await page3.locator('.bb-step:not([hidden]) .dv-early [data-send]').click();
  await page3.waitForSelector("#dvSubmitError");
  check("outage: says it was NOT sent", (await page3.locator("#dvSubmitError").innerText()).includes("Your answers were not sent"));
  check("outage: no verdict is shown for answers that were not stored", !(await page3.locator("#dvVerdict").isVisible()));
  check("outage: the form and the answers are still there", (await page3.locator("#dvForm").isVisible()) && (await stored(page3)).answers.headline === "The phone");
  check("outage: the button works again", await page3.locator('.bb-step:not([hidden]) .dv-early [data-send]').isEnabled());

  check("no JavaScript errors on any page", errors.length === 0, errors);
} finally {
  await browser.close();
  okServer.kill(); failServer.kill();
}

console.log(bad === 0 ? `\ncheck-discovery: ${n}/${n} controls behave.` : `\ncheck-discovery: ${bad} of ${n} CONTROL(S) BROKEN`);
process.exit(bad === 0 ? 0 : 1);
