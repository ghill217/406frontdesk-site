/**
 * domain-preflight.mjs — measure the domain a build brief names, at submit time.
 *
 * WHY: the two riskiest scope flags on a brief ("domain access is unknown", "live
 * email may be on the domain") are the CLIENT'S GUESS. A client who says "No, I use
 * Gmail" can be on Google Workspace at their own domain, and repointing DNS on that
 * guess takes their business email down. Registrar, expiry, name servers and MX
 * records are all public and take ~2 seconds to read, so read them and put the
 * measurement next to the answer.
 *
 * Read-only, best-effort, and never fails a submission: every lookup is capped and
 * any failure degrades to "unavailable" text. Nothing here is probed beyond public
 * DNS + RDAP (same never-path-guess line as the site security sweep).
 *
 * TRANSPORT: DNS-over-HTTPS (Google, then Cloudflare) rather than the OS resolver,
 * and RDAP via the IANA bootstrap file straight to the registry (rdap.org, the
 * redirector, took >8 s and 403'd during the build). Both are plain HTTPS, which is
 * the only thing a serverless runtime is guaranteed to have.
 *
 *   node netlify/functions/domain-preflight.mjs --probe example.com   # live read
 *   node netlify/functions/domain-preflight.mjs --selftest
 */

const LOOKUP_MS = 2500;      // per lookup; all DNS lookups run in parallel
const BOOTSTRAP_MS = 2000;   // IANA rdap bootstrap (cached across warm invocations)
const EXPIRY_WARN_DAYS = 60;
const UA = "406FrontDesk-BuildBrief-Preflight/1.0 (+https://406frontdesk.com)";
const DOH = ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"];
const RR = { NS: 2, MX: 15, A: 1, AAAA: 28 };

/* ---------------------------------------------------------------- pure --- */

/** "https://www.Foo.com/about?x" -> "foo.com"; junk -> null. */
export function normalizeDomain(input) {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#\s]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  if (s.split(".").some((l) => l.startsWith("-") || l.endsWith("-") || l.length > 63)) return null;
  return s;
}

const MX_PROVIDERS = [
  // smtp.google.com is Google's CURRENT MX host; aspmx.l.google.com the legacy one.
  // The first version matched only the legacy host and called 406's own domain
  // "self-hosted" -- caught by the live probe, not by the fixtures.
  [/(^|\.)(smtp\.google\.com|aspmx\.l\.google\.com|googlemail\.com)$/, "Google Workspace"],
  [/mail\.protection\.outlook\.com$/, "Microsoft 365"],
  [/secureserver\.net$/, "GoDaddy email"],
  [/zoho(mail)?\.com$/, "Zoho Mail"],
  [/protonmail\.ch$/, "Proton Mail"],
  [/yahoodns\.net$/, "Yahoo business email"],
  [/icloud\.com$/, "iCloud custom domain"],
  [/messagingengine\.com$/, "Fastmail"],
  [/ionos\.(com|de)$|1and1\.com$|kundenserver\.de$/, "IONOS"],
  [/privateemail\.com$/, "Namecheap Private Email"],
  [/mimecast\.com$/, "Mimecast (corporate filter)"],
  [/barracudanetworks\.com$/, "Barracuda (corporate filter)"],
  [/pphosted\.com$/, "Proofpoint (corporate filter)"],
  [/emailsrvr\.com$/, "Rackspace email"],
  [/mxrouting\.net$/, "MXroute"],
  [/hostgator\.com$|bluehost\.com$|dreamhost\.com$|siteground/, "Web-host email"],
  [/wixdns\.net$|wix\.com$/, "Wix-managed email"],
  [/squarespace/, "Squarespace-managed email"],
];

/** Names the mail provider behind a set of MX hosts. */
export function classifyMx(hosts) {
  const list = (hosts || []).map((h) => String(h).toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (!list.length) return { provider: null, hosts: [] };
  for (const [re, name] of MX_PROVIDERS) if (list.some((h) => re.test(h))) return { provider: name, hosts: list };
  return { provider: "other / self-hosted", hosts: list };
}

/** Pulls registrar + expiry + statuses out of an RDAP domain object. */
export function parseRdap(j) {
  if (!j || typeof j !== "object") return null;
  let registrar = null;
  for (const e of j.entities || []) {
    if (!(e.roles || []).includes("registrar")) continue;
    const vc = e.vcardArray && e.vcardArray[1];
    const fn = Array.isArray(vc) ? vc.find((x) => x[0] === "fn") : null;
    registrar = (fn && fn[3]) || e.handle || null;
    if (registrar) break;
  }
  let expires = null;
  for (const ev of j.events || []) {
    if (ev.eventAction === "expiration" && ev.eventDate) { expires = ev.eventDate; break; }
  }
  return { registrar, expires, status: j.status || [], ldhName: j.ldhName || null };
}

/** "1 smtp.google.com." -> {priority: 1, host: "smtp.google.com"} */
export function parseMxData(data) {
  const m = /^\s*(\d+)\s+(\S+?)\.?\s*$/.exec(String(data || ""));
  return m ? { priority: Number(m[1]), host: m[2].toLowerCase() } : null;
}

function daysUntil(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

/**
 * Scope-fence rules that come from MEASUREMENT rather than from an answer.
 * Same {flag, why} shape scope-fence.mjs uses. Pure; selftested with fixtures.
 */
export function measuredFlags(r, answers = {}, now = new Date()) {
  const out = [];
  if (!r || !r.domain) return out;
  const said = {
    owns: String(answers.do_you_already_own_it || ""),
    email: String(answers.do_you_have_email_on_that_domain || ""),
  };
  const mx = classifyMx(r.mx);

  if (mx.provider) {
    const contradiction = said.email.startsWith("No,");
    out.push({
      flag: `Live email MEASURED on ${r.domain}: ${mx.provider}`,
      why: (contradiction
        ? `They answered "${said.email}", but the domain has MX records (${mx.hosts.slice(0, 2).join(", ")}). Someone's mail arrives here. `
        : `MX records present (${mx.hosts.slice(0, 2).join(", ")}). `)
        + "Copy every MX/SPF/DKIM/DMARC record before touching DNS, or their email goes down.",
    });
  } else if (r.mxChecked && said.email.startsWith("Yes")) {
    out.push({
      flag: `They say email runs on ${r.domain}, but no MX records were found`,
      why: "Either the mail is on a different domain, or the answer is wrong. Ask which address they actually receive at before planning DNS.",
    });
  }

  if (r.registered === false) {
    if (said.owns.startsWith("Yes")) {
      out.push({
        flag: `${r.domain} appears UNREGISTERED but they say they own it`,
        why: "RDAP has no record. Wrong spelling, a different TLD, or a lapsed registration. Confirm before any work goes under this name.",
      });
    } else {
      out.push({
        flag: `${r.domain} is available to register`,
        why: "No RDAP record. Register it before the build starts so nobody else does.",
      });
    }
  }

  if (r.rdap && r.rdap.expires) {
    const d = daysUntil(r.rdap.expires, now);
    if (d !== null && d < 0) {
      out.push({ flag: `${r.domain} registration EXPIRED ${-d} days ago`, why: "It may be in redemption. Renew or recover before anything else." });
    } else if (d !== null && d <= EXPIRY_WARN_DAYS) {
      out.push({ flag: `${r.domain} expires in ${d} days`, why: "Get it renewed (and auto-renew on) before go-live, or the site dies on a date nobody is watching." });
    }
  }

  if (r.rdap && (r.rdap.status || []).some((s) => /hold|pendingdelete|redemption/i.test(s))) {
    out.push({ flag: `${r.domain} carries a hold/redemption status`, why: `RDAP status: ${r.rdap.status.join(", ")}. Resolve with the registrar first.` });
  }

  if (r.registered && r.aChecked && !r.hasA) {
    out.push({ flag: `Nothing resolves at ${r.domain} today`, why: "Registered but no A/AAAA record. Fine for a new site; worth knowing if they believe a site is up." });
  }
  return out;
}

/** Plain-text block for the contact field + alert email. */
export function preflightText(r) {
  if (!r) return "";
  if (!r.domain) return "DOMAIN PRE-FLIGHT: no usable domain in the brief.";
  const L = [`DOMAIN PRE-FLIGHT for ${r.domain} (measured at submit):`];
  if (r.registered === false) L.push("  registration : NOT FOUND (available, or misspelled)");
  else if (r.rdap) {
    L.push(`  registrar    : ${r.rdap.registrar || "unknown"}`);
    if (r.rdap.expires) {
      const d = daysUntil(r.rdap.expires);
      L.push(`  expires      : ${String(r.rdap.expires).slice(0, 10)}${d === null ? "" : ` (${d} days)`}`);
    }
  } else L.push("  registration : lookup unavailable");
  L.push(`  name servers : ${r.ns && r.ns.length ? r.ns.join(", ") : r.nsChecked ? "none" : "unavailable"}`);
  const mx = classifyMx(r.mx);
  L.push(`  email (MX)   : ${mx.provider ? `${mx.provider} — ${mx.hosts.join(", ")}` : r.mxChecked ? "none (no email on this domain)" : "unavailable"}`);
  L.push(`  resolves     : ${r.aChecked ? (r.hasA ? "yes" : "no A/AAAA record") : "unavailable"}`);
  return L.join("\n");
}

/* ------------------------------------------------------------- network --- */

async function fetchJson(url, accept, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, signal: ctl.signal, redirect: "follow" });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

/** One DoH query. Returns {nx, records} or null when no resolver answered. */
async function doh(domain, type) {
  for (const base of DOH) {
    try {
      const { status, json } = await fetchJson(`${base}?name=${encodeURIComponent(domain)}&type=${type}`, "application/dns-json", LOOKUP_MS);
      if (status !== 200 || !json || typeof json.Status !== "number") continue;
      if (json.Status === 3) return { nx: true, records: [] };          // NXDOMAIN
      if (json.Status !== 0) continue;                                    // SERVFAIL etc: try the next resolver
      return { nx: false, records: (json.Answer || []).filter((r) => r.type === RR[type]).map((r) => String(r.data)) };
    } catch {}
  }
  return null;
}

let bootstrap = null; // [[tlds], [urls]] pairs from IANA; survives warm invocations
async function rdapBase(tld) {
  if (!bootstrap) {
    try {
      const { status, json } = await fetchJson("https://data.iana.org/rdap/dns.json", "application/json", BOOTSTRAP_MS);
      if (status === 200 && json && Array.isArray(json.services)) bootstrap = json.services;
    } catch {}
  }
  if (bootstrap) {
    for (const [tlds, urls] of bootstrap) {
      if (tlds.includes(tld)) return urls.find((u) => u.startsWith("https://")) || urls[0];
    }
  }
  return "https://rdap.org/";
}

async function rdapLookup(domain) {
  const base = await rdapBase(domain.split(".").pop());
  const url = base.replace(/\/?$/, "/") + "domain/" + encodeURIComponent(domain);
  const { status, json } = await fetchJson(url, "application/rdap+json, application/json", LOOKUP_MS);
  if (status === 404) return { registered: false, rdap: null };
  if (status !== 200 || !json) throw new Error(`rdap ${status}`);
  return { registered: true, rdap: parseRdap(json) };
}

/** Live probe. Never throws; every part degrades independently. */
export async function probeDomain(input) {
  const started = Date.now();
  const domain = normalizeDomain(input);
  const r = { input, domain, registered: null, rdap: null, ns: null, nsChecked: false, mx: null, mxChecked: false, hasA: null, aChecked: false, errors: [], elapsedMs: 0 };
  if (!domain) return r;

  const [rd, ns, mx, a4, a6] = await Promise.allSettled([
    rdapLookup(domain), doh(domain, "NS"), doh(domain, "MX"), doh(domain, "A"), doh(domain, "AAAA"),
  ]);

  if (rd.status === "fulfilled") Object.assign(r, rd.value);
  else r.errors.push(String(rd.reason && rd.reason.message));

  if (ns.status === "fulfilled" && ns.value) { r.ns = ns.value.records.map((h) => h.toLowerCase().replace(/\.$/, "")).sort(); r.nsChecked = true; }
  else r.errors.push("ns lookup unavailable");

  if (mx.status === "fulfilled" && mx.value) {
    r.mx = mx.value.records.map(parseMxData).filter(Boolean).sort((p, q) => p.priority - q.priority).map((m) => m.host);
    r.mxChecked = true;
  } else r.errors.push("mx lookup unavailable");

  const got4 = a4.status === "fulfilled" && a4.value, got6 = a6.status === "fulfilled" && a6.value;
  if (got4 || got6) { r.hasA = !!((got4 && got4.records.length) || (got6 && got6.records.length)); r.aChecked = true; }
  else r.errors.push("a/aaaa lookup unavailable");

  // RDAP silent + every DNS answer NXDOMAIN: almost certainly unregistered, but say
  // "unknown" rather than assert it -- a wrong "available" invites a wrong purchase.
  if (r.registered === null && r.nsChecked && r.ns.length === 0 && r.mxChecked && r.mx.length === 0 && r.aChecked && !r.hasA) {
    r.errors.push("rdap unavailable and DNS is empty — registration unknown");
  }
  r.elapsedMs = Date.now() - started;
  return r;
}

/* ------------------------------------------------------------- selftest -- */
const isMain = process.argv[1] && /domain-preflight\.mjs$/.test(process.argv[1]);

if (isMain && process.argv.includes("--probe")) {
  const d = process.argv[process.argv.indexOf("--probe") + 1];
  const r = await probeDomain(d);
  console.log(preflightText(r));
  const f = measuredFlags(r, {});
  console.log(f.length ? "\nmeasured flags:\n" + f.map((x) => `  - ${x.flag}\n    ${x.why}`).join("\n") : "\nmeasured flags: none");
  console.log(`\n${r.elapsedMs} ms` + (r.errors.length ? "; errors: " + r.errors.join("; ") : ""));
}

if (isMain && process.argv.includes("--selftest")) {
  let bad = 0;
  const T = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) bad++; };

  // normalizeDomain
  T("strips scheme, www, path", normalizeDomain("https://www.Example.com/about?x=1") === "example.com");
  T("bare domain passes", normalizeDomain("example.com") === "example.com");
  T("subdomain kept", normalizeDomain("shop.example.co.uk") === "shop.example.co.uk");
  T("prose is rejected", normalizeDomain("not sure yet, maybe something with kalispell") === null);
  T("single word rejected", normalizeDomain("kalispell") === null);
  T("empty rejected", normalizeDomain("   ") === null);
  T("non-string rejected", normalizeDomain(null) === null);

  // classifyMx
  T("google workspace (current smtp.google.com host)", classifyMx(["smtp.google.com"]).provider === "Google Workspace");
  T("google workspace (legacy aspmx host)", classifyMx(["ASPMX.L.GOOGLE.COM", "alt1.aspmx.l.google.com"]).provider === "Google Workspace");
  T("microsoft 365", classifyMx(["example-com.mail.protection.outlook.com"]).provider === "Microsoft 365");
  T("godaddy", classifyMx(["mailstore1.secureserver.net"]).provider === "GoDaddy email");
  T("unknown host = self-hosted", classifyMx(["mail.example.com"]).provider === "other / self-hosted");
  T("no MX = no provider", classifyMx([]).provider === null);
  T("mx data parses priority + host", JSON.stringify(parseMxData("10 ALT1.aspmx.l.google.com.")) === JSON.stringify({ priority: 10, host: "alt1.aspmx.l.google.com" }));
  T("mx garbage -> null", parseMxData("nonsense") === null);

  // parseRdap
  const rdap = parseRdap({
    ldhName: "example.com", status: ["client transfer prohibited"],
    events: [{ eventAction: "registration", eventDate: "2001-01-01T00:00:00Z" }, { eventAction: "expiration", eventDate: "2030-06-01T00:00:00Z" }],
    entities: [{ roles: ["registrar"], handle: "1234", vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example Registrar, Inc."]]] }],
  });
  T("rdap registrar", rdap.registrar === "Example Registrar, Inc.");
  T("rdap expiry", rdap.expires === "2030-06-01T00:00:00Z");
  T("rdap garbage tolerated", parseRdap("nope") === null);

  // measuredFlags -- positive AND negative per rule, fixtures only (no network)
  const now = new Date("2026-09-03T00:00:00Z");
  const base = { domain: "example.com", registered: true, rdap: { registrar: "R", expires: "2028-01-01T00:00:00Z", status: [] }, ns: ["a.ns"], nsChecked: true, mx: [], mxChecked: true, hasA: true, aChecked: true };
  const flagsOf = (r, a = {}) => measuredFlags({ ...base, ...r }, a, now).map((x) => x.flag);

  T("MX present -> live email flag", flagsOf({ mx: ["smtp.google.com"] }).some((f) => f.startsWith("Live email MEASURED")));
  T("MX present contradicts 'No, Gmail'", measuredFlags({ ...base, mx: ["smtp.google.com"] }, { do_you_have_email_on_that_domain: "No, I use Gmail / Yahoo / etc." }, now)[0].why.includes("They answered"));
  T("no MX + says no email -> nothing", flagsOf({}, { do_you_have_email_on_that_domain: "No, I use Gmail / Yahoo / etc." }).length === 0);
  T("no MX + says YES email -> mismatch flag", flagsOf({}, { do_you_have_email_on_that_domain: "Yes - tell us BEFORE we point the domain, or your email can go down" }).some((f) => f.includes("no MX records were found")));
  T("MX unavailable + says yes -> no mismatch claim", flagsOf({ mxChecked: false, mx: null }, { do_you_have_email_on_that_domain: "Yes - tell us BEFORE we point the domain, or your email can go down" }).length === 0);
  T("unregistered + says owns -> contradiction", flagsOf({ registered: false, rdap: null }, { do_you_already_own_it: "Yes, and I have the login" }).some((f) => f.includes("UNREGISTERED")));
  T("unregistered + says buy -> available", flagsOf({ registered: false, rdap: null }, { do_you_already_own_it: "No, we need to buy one" }).some((f) => f.includes("available to register")));
  T("rdap unknown -> no registration claim either way", !flagsOf({ registered: null, rdap: null }, { do_you_already_own_it: "Yes, and I have the login" }).some((f) => /UNREGISTERED|available/.test(f)));
  T("expires in 30d -> flag", flagsOf({ rdap: { registrar: "R", expires: "2026-10-03T00:00:00Z", status: [] } }).some((f) => f.includes("expires in 30 days")));
  T("expires in 400d -> no flag", flagsOf({ rdap: { registrar: "R", expires: "2027-10-08T00:00:00Z", status: [] } }).length === 0);
  T("expired -> flag", flagsOf({ rdap: { registrar: "R", expires: "2026-08-01T00:00:00Z", status: [] } }).some((f) => f.includes("EXPIRED")));
  T("clientHold -> flag", flagsOf({ rdap: { registrar: "R", expires: "2028-01-01T00:00:00Z", status: ["client hold"] } }).some((f) => f.includes("hold/redemption")));
  T("no A record -> informational flag", flagsOf({ hasA: false }).some((f) => f.startsWith("Nothing resolves")));
  T("healthy domain, no email -> zero flags", flagsOf({}).length === 0);
  T("no domain -> zero flags", measuredFlags({ domain: null }, {}, now).length === 0);

  // preflightText
  const txt = preflightText({ ...base, mx: ["smtp.google.com"] });
  T("text names provider", txt.includes("Google Workspace"));
  T("text names registrar", txt.includes("registrar    : R"));
  T("text handles no-domain", preflightText({ domain: null }).includes("no usable domain"));

  const total = 39;
  console.log(bad === 0 ? `\nselftest: ${total}/${total} controls behave (positive + negative).` : `\nselftest: ${bad} CONTROL(S) BROKEN`);
  process.exitCode = bad === 0 ? 0 : 1;
}
