#!/usr/bin/env node
/**
 * dev-discovery.mjs — serve dist/ and run the REAL /discovery/ function handler locally,
 * against a FAKE GHL and an in-memory blob store.
 *
 * WHY: there is no Netlify CLI on this machine, and the alternative way to test the
 * form end to end is to submit it for real, which writes a contact, a task and an
 * archive record into the live 406 sub every time. This exercises the same handler
 * code, byte for byte, and writes nothing anywhere.
 *
 *   npm run build && node scripts/dev-discovery.mjs          # http://localhost:8765/discovery/
 *   node scripts/dev-discovery.mjs --ghl-fail                # GHL rejects the write (502 path)
 *   node scripts/dev-discovery.mjs --selftest                # drive the handler headlessly, assert, exit
 *
 * Everything the handler WOULD have sent to GHL is kept in memory and shown at
 * http://localhost:8765/__sent so a browser test can assert on it.
 *
 * What this does NOT prove: that the deployed function has a working credential, or
 * that GHL accepts the payload. The health endpoint and one real submission prove those.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../dist/", import.meta.url));
const PORT = Number(process.env.PORT) || 8765;
const GHL_FAIL = process.argv.includes("--ghl-fail");

/* ---- @netlify/blobs -> an in-memory store ---------------------------------- */
const MOCK = `
const stores = (globalThis.__blobs ||= new Map());
export function getStore(name) {
  const s = stores.get(name) || stores.set(name, new Map()).get(name);
  return {
    async set(k, v) { s.set(k, typeof v === "string" ? v : Buffer.from(v).toString("utf8")); },
    async setJSON(k, v) { s.set(k, JSON.stringify(v)); },
    async get(k, o) { if (!s.has(k)) return null; const v = s.get(k); return o && o.type === "json" ? JSON.parse(v) : v; },
    async delete(k) { s.delete(k); },
  };
}`;
const MOCK_URL = "data:text/javascript," + encodeURIComponent(MOCK);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@netlify/blobs") return { url: MOCK_URL, shortCircuit: true };
    return next(specifier, context);
  },
});

/* ---- GHL -> a fake that records what it was sent ---------------------------- */
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith("https://services.leadconnectorhq.com")) return realFetch(url, init);
  const body = init.body ? JSON.parse(init.body) : null;
  sent.push({ method: init.method || "GET", url: u.replace("https://services.leadconnectorhq.com", ""), body });
  const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  if (GHL_FAIL && u.endsWith("/contacts/upsert")) return reply(500, { message: "simulated outage" });
  if (u.endsWith("/contacts/upsert")) return reply(200, { contact: { id: "FAKE_CONTACT_ID" } });
  if (u.includes("/tasks")) return reply(201, { task: { id: "FAKE_TASK_ID" } });
  if (u.includes("/customFields")) {
    const map = JSON.parse(await readFile(new URL("../src/_data/discoveryFields.json", import.meta.url), "utf8"));
    return reply(200, { customFields: Object.values(map.fields).map((f) => ({ id: f.id })) });
  }
  return reply(404, {});
};

process.env.GHL_PIT = "fake-token-for-local-dev";
const { default: handler } = await import(pathToFileURL(join(ROOT, "../netlify/functions/discovery.js")).href);

/* ---- selftest: the handler's contract, headlessly ---------------------------- */
if (process.argv.includes("--selftest")) {
  let bad = 0, n = 0;
  const check = (name, ok) => { n++; if (!ok) bad++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`); };
  const call = async (method, path, body) => {
    const res = await handler(new Request("http://localhost" + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: res.status, body: await res.json() };
  };
  const P = "/.netlify/functions/discovery";
  const base = { full_name: "Sam Example", business: "Example Cycle Works", email: "sam@example.com", role: "Owner", headline: "The phone" };

  const h = await call("GET", P);
  check("health: reports configured", h.status === 200 && h.body.credential === "configured");
  const hd = await call("GET", P + "?deep=1");
  check("health deep: every mapped field id exists", hd.status === 200 && hd.body.deep.missingIds.length === 0);

  sent.length = 0;
  const miss = await call("POST", P, { answers: { ...base, headline: "" } });
  check("required: a blank headline is refused", miss.status === 400 && /one thing/.test(miss.body.error));
  check("required: and nothing was sent to GHL", sent.length === 0);
  const badMail = await call("POST", P, { answers: { ...base, email: "nope" } });
  check("required: a malformed email is refused", badMail.status === 400);

  sent.length = 0;
  const hp = await call("POST", P, { answers: base, website_hp: "http://spam.example" });
  check("honeypot: answers ok, sends nothing", hp.status === 200 && hp.body.note === "ignored" && sent.length === 0);

  sent.length = 0;
  const ok = await call("POST", P, { answers: { ...base, who_answers: "Voicemail", unanswered: "6–15", time_sucks: ["Answering the phone", "Payroll, books and taxes", "Asking for reviews", "Quotes and estimates"],
    busy_calls: ["It goes to voicemail", "INJECTED OPTION"], busy_calls__own: "they call the next shop", role: "Owner", reviews: "We don't", close_rate: "About 1 in 4", worth: "500" } });
  const up = sent.find((s) => s.url === "/contacts/upsert");
  const fields = Object.fromEntries((up?.body.customFields || []).map((f) => [f.id, f.field_value]));
  const map = JSON.parse(await readFile(new URL("../src/_data/discoveryFields.json", import.meta.url), "utf8")).fields;
  check("submit: confirmed, with a verdict on the same response", ok.status === 200 && ok.body.ok === true && ok.body.verdict.level === "strong");
  check("submit: no phone is ever sent", up && !("phone" in up.body));
  check("submit: tagged and sourced", up.body.tags[0] === "front desk discovery" && up.body.companyName === "Example Cycle Works");
  check("submit: an injected option is dropped, the real tap and their words are kept", fields[map.what_happens_to_calls_when_your_hands_are_busy.id] === "It goes to voicemail. In their words: they call the next shop");
  check("submit: a 'pick up to 3' is capped server-side", !fields[map.biggest_admin_timesuck_outside_the_actual_work.id].includes("Quotes and estimates"));
  check("submit: the headline feeds both shared fields", fields[map.one_thing_off_your_plate_tomorrow__what_is_it.id] === "The phone" && fields[map.what_are_you_hoping_to_fix.id] === "The phone");
  check("submit: picklist value sent exactly", fields[map.roughly_how_many_calls_a_week_go_unanswered.id] === "6–15");
  check("submit: the card and the verdict are written", /Q: Who answers/.test(fields[map.discovery_answer_card.id]) && /^FIT: STRONG/.test(fields[map.discovery_fit_verdict.id]));
  check("submit: leak math used their inputs", ok.body.verdict.leak.low === 3000 && ok.body.verdict.leak.high === 7500);
  const task = sent.find((s) => s.url.endsWith("/tasks"));
  check("submit: Gus gets a task, assigned, due tomorrow", task && task.body.assignedTo && /Discovery in: Example Cycle Works \(strong fit\)/.test(task.body.title));
  check("submit: archived", [...globalThis.__blobs.get("discovery-submissions").keys()].some((k) => k.includes("sam-example-com")));

  sent.length = 0;
  const d1 = await call("POST", P, { draft: true, step: 3, answers: { full_name: "Sam Example", who_answers: "Me" } });
  check("draft: saved under a 32-hex key, GHL untouched", d1.status === 200 && /^[a-f0-9]{32}$/.test(d1.body.draftKey) && sent.length === 0);
  const d2 = await call("GET", P + "?draft=" + d1.body.draftKey);
  check("draft: reads back with its step", d2.status === 200 && d2.body.step === 3 && d2.body.answers.who_answers === "Me");
  const d3 = await call("GET", P + "?draft=../../etc/passwd");
  check("draft: a malformed key is refused", d3.status === 400);
  const d4 = await call("GET", P + "?draft=" + "0".repeat(32));
  check("draft: an unknown key is a 404, not a crash", d4.status === 404);
  await call("POST", P, { answers: base, draftKey: d1.body.draftKey });
  const d5 = await call("GET", P + "?draft=" + d1.body.draftKey);
  check("draft: deleted once the form is really sent", d5.status === 404);
  const big = await call("POST", P, { draft: true, answers: Object.fromEntries(["headline", "slips", "never", "say_yes"].map((k) => [k, "x".repeat(3000)])) });
  check("draft: free text is capped, so a draft cannot balloon", big.status === 200);

  console.log(bad === 0 ? `\nselftest: ${n}/${n} handler controls behave.` : `\nselftest: ${bad} CONTROL(S) BROKEN`);
  process.exit(bad === 0 ? 0 : 1);
}

/* ---- the server --------------------------------------------------------------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/__sent") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(sent, null, 2));
    }
    if (url.pathname === "/.netlify/functions/discovery") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await handler(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(await r.text());
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (p === "" || p.endsWith("/") || p.endsWith("\\") || !extname(p)) p = join(p, "index.html");
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, () => console.log(`discovery dev server: http://localhost:${PORT}/discovery/  (fake GHL${GHL_FAIL ? ", FAILING" : ""}; sent payloads at /__sent)`));
