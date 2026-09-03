/**
 * POST /.netlify/functions/build-brief
 *
 * Receives the Website Build Brief and writes it to the GHL contact record.
 *
 * This function owns something the old GHL-hosted form owned for us: DELIVERY. So the
 * contract with the browser is strict — it returns `{ ok: true }` only when GHL has
 * confirmed the write. Anything else is a non-2xx with a message, and the browser keeps
 * the client's answers in localStorage rather than clearing them.
 *
 * Environment (set in Netlify UI, never in the repo):
 *   GHL_PIT   — the 406 Front Desk Private Integration Token. Needs contacts.write.
 *
 * The field map is NOT written here. It comes from src/_data/buildBrief.json, which is
 * generated from the live GHL API by scripts/sync-build-brief.mjs — a hand-typed
 * fieldKey is accepted silently by GHL and the answer is dropped.
 */
import { getStore } from "@netlify/blobs";
import briefData from "../../src/_data/buildBrief.json" with { type: "json" };

const LOCATION_ID = briefData.locationId;
const GHL = "https://services.leadconnectorhq.com";
const MAX_LOGO = 4 * 1024 * 1024;

const FIELDS = briefData.fields;
const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));
const REQUIRED = FIELDS.filter((f) => f.required).map((f) => f.key);
const MULTI = new Set(FIELDS.filter((f) => f.type === "CHECKBOX" || f.type === "MULTIPLE_OPTIONS").map((f) => f.key));

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function clean(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed." });

  // .trim(): a value pasted into a dashboard field can carry whitespace, and a
  // malformed Authorization header fails as an auth error rather than a format one.
  const token = (process.env.GHL_PIT || "").trim();
  if (!token) {
    // Fail loudly rather than pretending. A silent success here would lose a real brief.
    console.error("GHL_PIT is not set on this deploy.");
    return json(500, { ok: false, error: "This form is not finished being set up (no credential configured). Please email admin@406frontdesk.com — nothing you typed is lost.", code: "no_token" });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: "That submission could not be read." });
  }

  // Honeypot: a real person never fills a field they cannot see.
  if (clean(payload.website_hp)) {
    console.log("honeypot tripped — dropping silently");
    return json(200, { ok: true, note: "ignored" });
  }

  const a = payload.answers || {};
  const name = clean(a.full_name);
  const email = clean(a.email);
  const phone = clean(a.phone);

  const missing = [];
  if (!name) missing.push("your name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) missing.push("a valid email");
  if (!phone) missing.push("a phone number");
  // Never trust the client's own validation — it is a convenience, not a control.
  for (const key of REQUIRED) {
    const v = clean(a[key]);
    if (!v || (Array.isArray(v) && !v.length)) missing.push(BY_KEY.get(key).label);
  }
  // Caps are enforced here too. The client's lock is an affordance; a crafted or
  // resumed-then-edited payload must not be able to exceed a stated limit.
  for (const f of FIELDS) {
    if (!f.maxSelections) continue;
    const v = clean(a[f.key]);
    if (Array.isArray(v) && v.length > f.maxSelections) {
      return json(400, { ok: false, error: `"${f.label}" allows at most ${f.maxSelections} choices; ${v.length} were sent.` });
    }
  }

  if (missing.length) {
    return json(400, { ok: false, error: `Still needed: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? `, and ${missing.length - 4} more` : ""}.` });
  }

  // Stash the logo before touching GHL, so a storage failure never produces a contact
  // that claims to have a logo nobody can find.
  let logoNote = "";
  if (payload.logo && payload.logo.data) {
    const { name: fileName, type, data } = payload.logo;
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_LOGO) {
      return json(400, { ok: false, error: "That logo is over the 4 MB limit. Send the brief without it and email the file over." });
    }
    try {
      const store = getStore("build-brief-logos");
      const key = `${Date.now()}-${email.replace(/[^a-z0-9]+/gi, "-")}-${String(fileName || "logo").replace(/[^a-z0-9.]+/gi, "-")}`;
      await store.set(key, bytes, { metadata: { email, type: type || "", originalName: fileName || "" } });
      logoNote = key;
    } catch (e) {
      console.error("blob store failed:", e && e.message);
      return json(502, { ok: false, error: "Your logo could not be saved, so nothing was submitted. Try again without the logo and email it over separately." });
    }
  }

  const customFields = [];
  for (const f of FIELDS) {
    // GHL's FILE_UPLOAD fields do not accept a plain string. /contacts/upsert takes the
    // request, returns 200, and DROPS the value -- a direct PUT of the same thing
    // returns 400, so the endpoint validates and the upsert does not. Verified 2026-09-03.
    // The logo reference therefore goes in a TEXT field (logo_upload_reference); the
    // FILE_UPLOAD field is left for the GHL-hosted form that can actually populate it.
    if (f.type === "FILE_UPLOAD") continue;
    if (f.key === "logo_upload_reference") {
      if (logoNote) customFields.push({ id: f.id, field_value: logoNote });
      continue;
    }
    const v = clean(a[f.key]);
    if (!v || (Array.isArray(v) && !v.length)) continue;
    customFields.push({ id: f.id, field_value: MULTI.has(f.key) ? (Array.isArray(v) ? v : [v]) : String(v) });
  }

  const parts = name.split(/\s+/);
  const body = {
    locationId: LOCATION_ID,
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || parts[0],
    name,
    email,
    phone,
    source: "Website Build Brief (406frontdesk.com)",
    tags: ["website build brief"],
    customFields,
  };

  let res, text;
  try {
    res = await fetch(`${GHL}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    text = await res.text();
  } catch (e) {
    console.error("GHL request failed:", e && e.message);
    return json(502, { ok: false, error: "We could not reach the system that stores your brief. Nothing was saved — please try again in a moment." });
  }

  if (!res.ok) {
    // The blob was written before GHL was touched (so a storage failure can never
    // produce a contact claiming a logo nobody can find). If GHL then rejects the
    // write, that blob is an orphan -- nothing references it and nobody will ever
    // look for it. Drop it rather than accumulate junk in the store.
    if (logoNote) {
      try { await getStore("build-brief-logos").delete(logoNote); }
      catch (e) { console.error("orphan blob cleanup failed:", e && e.message); }
    }
    // Log the status and GHL's message, never the token.
    console.error(`GHL upsert failed ${res.status} :: ${text.slice(0, 500)}`);
    console.error(`token fingerprint: len=${token.length} head=${token.slice(0, 6)} tail=${token.slice(-4)}`);
    if (res.status === 401 || res.status === 403) {
      // Distinct from the no_token case above ON PURPOSE. Both used to return the
      // same sentence, which made a misconfigured credential indistinguishable from
      // a missing one -- the operator cannot tell which thing to go fix.
      return json(502, {
        ok: false,
        error: "This form's credential was rejected by our CRM. Please email admin@406frontdesk.com — nothing you typed is lost.",
        code: "auth_rejected",
        upstream: res.status,
      });
    }
    return json(502, { ok: false, error: "Your brief could not be saved. Nothing was lost — please try again, or email admin@406frontdesk.com." });
  }

  let contactId = null;
  try { contactId = (JSON.parse(text).contact || {}).id || null; } catch {}
  console.log(`build brief stored for ${email}${contactId ? ` (contact ${contactId})` : ""}, ${customFields.length} fields${logoNote ? ", logo attached" : ""}`);

  return json(200, { ok: true, fields: customFields.length, logo: !!logoNote });
};
