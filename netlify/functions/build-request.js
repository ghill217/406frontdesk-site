/**
 * POST /.netlify/functions/build-request
 *
 * Receives the short public "request a website build" form from /request-a-build/
 * and writes it to GoHighLevel as a contact + a note + a task for Gus.
 *
 * DELIBERATELY NOT THE BUILD BRIEF. The brief (/build-brief/) is a 56-field client
 * form sent after the yes; this is six fields from a stranger. The answers go into a
 * NOTE rather than a wall of custom fields -- a human can read it on day one, and it
 * needs no generated id map to stay correct.
 *
 * It writes exactly ONE custom field (`current_website_url`, looked up not hard-coded,
 * see CURRENT_SITE_FIELD_ID below) because that single fact is asked again in the brief
 * and would otherwise have two homes that can disagree. That lookup degrades to nothing
 * if the field is deleted, so a field-map drift still cannot fail a submission here.
 *
 * Environment (set in the Netlify UI, never in the repo):
 *   GHL_PIT -- the 406 Front Desk Private Integration Token. Needs contacts.write.
 *              The same credential the build brief uses; if one is dead they both are.
 *
 * NO SMS CONSENT HERE, ON PURPOSE. The phone is an optional callback field, not an
 * opt-in. 406's A2P campaigns name the opt-in pages as the only opt-in method, so this
 * form must never carry consent wording, and a submission here is NOT permission to
 * text. Call or email these people.
 */
import { getStore } from "@netlify/blobs";
import briefData from "../../src/_data/buildBrief.json" with { type: "json" };

const LOCATION_ID = briefData.locationId;
const GHL = "https://services.leadconnectorhq.com";
// Gus's GHL user id, for task assignment. The same value the build brief uses.
const ASSIGNEE_USER_ID = "0qYqX1PQslaWmsCvbJnY";

// The four answers the radio can carry, and the tag each one earns. Validated as a
// closed set: an unknown value means a crafted payload or a template that drifted away
// from this file, and either way it must not silently become a tag.
const WANTS = {
  "New site": "build request: new site",
  "Rebuild of what I have": "build request: rebuild",
  "Tune-up, keep the site": "build request: tune-up",
  "Not sure yet": "build request: unsure",
};

const MAX = { name: 120, business: 160, email: 200, phone: 40, website: 300, notes: 2000 };

/**
 * THE ONE CUSTOM FIELD THIS ENDPOINT WRITES, and why it is worth the exception.
 *
 * "What is their current website" is asked twice across the funnel -- here, and again as
 * `current_website_url` in the build brief. Left alone that fact has two homes on one
 * contact (the standard `website` field and the custom one) which can hold different
 * answers, and nothing says which is right. Writing both from here means the brief's
 * field is already populated when Gus opens the contact, and when they later fill the
 * brief it overwrites the SAME field rather than creating a second version of the truth.
 *
 * Deliberately NOT extended to the business name. The brief's `business_name_for_the_website`
 * asks a different question -- "exactly as you want it to appear on the site" -- and this
 * form only asks what the business is called. Filling it here would put an unvetted value
 * in the field Gus reads as authoritative for the site header, which is worse than a duplicate.
 *
 * Looked up, never hard-coded: a hand-typed fieldKey is accepted silently by GHL and the
 * answer is dropped. And it degrades to nothing -- if the field is ever deleted the id is
 * absent from the generated map, this returns null, and the submission still succeeds. That
 * is the whole reason this endpoint kept its distance from the field map in the first place.
 */
const CURRENT_SITE_FIELD_ID =
  (briefData.fields.find((f) => f.key === "current_website_url") || {}).id || null;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const clean = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

const ghlHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Version: "2021-07-28",
  "Content-Type": "application/json",
});

/**
 * A website answer is free text on purpose -- "I do not have one" is a valid answer and
 * so is "facebook.com/myshop". Normalise anything that looks like a host into a URL so
 * the contact's website field is clickable, and leave prose alone.
 */
function normaliseSite(raw) {
  const v = clean(raw);
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/|$)/i.test(v)) return `https://${v}`;
  return v;
}

/**
 * GET = health, the same contract as build-brief: says whether a credential is
 * configured and, with ?deep=1, whether GHL accepts it. Nothing here reveals a value.
 * The nightly Health Monitor reads this -- an endpoint nobody watches is an endpoint
 * that dies quietly, which has already happened twice on the brief.
 */
async function health(req, token) {
  const out = {
    ok: !!token,
    service: "build-request",
    credential: token ? "configured" : "missing",
    checkedAt: new Date().toISOString(),
  };
  if (new URL(req.url).searchParams.get("deep") === "1" && token) {
    let ghlAuth = "unknown";
    try {
      const res = await fetch(`${GHL}/locations/${LOCATION_ID}/customFields`, { headers: ghlHeaders(token) });
      ghlAuth = res.ok ? "ok" : res.status === 401 || res.status === 403 ? "rejected" : `http_${res.status}`;
    } catch {
      ghlAuth = "unreachable";
    }
    out.deep = { ghlAuth };
    if (ghlAuth !== "ok") out.ok = false;
  }
  return json(out.ok ? 200 : 503, out);
}

export default async (req) => {
  const token = (process.env.GHL_PIT || "").trim();

  if (req.method === "GET") return health(req, token);
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed." });

  if (!token) {
    console.error("GHL_PIT is not set on this deploy.");
    return json(500, {
      ok: false,
      code: "no_token",
      error: "This form is not finished being set up. Please call (406) 840-0404 or email admin@406frontdesk.com — nothing you typed is lost.",
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: "That submission could not be read." });
  }

  // Honeypot. A real person never fills a field they cannot see.
  if (clean(payload.company_hp)) {
    console.log("honeypot tripped — dropping silently");
    return json(200, { ok: true, note: "ignored" });
  }

  const name = clean(payload.name).slice(0, MAX.name);
  const business = clean(payload.business).slice(0, MAX.business);
  const email = clean(payload.email).slice(0, MAX.email);
  const phone = clean(payload.phone).slice(0, MAX.phone);
  const website = normaliseSite(payload.website).slice(0, MAX.website);
  const want = clean(payload.want);
  const notes = clean(payload.notes).slice(0, MAX.notes);

  // Server-side validation. The browser's own checks are a convenience, not a control.
  const missing = [];
  if (!name) missing.push("your name");
  if (!business) missing.push("your business name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) missing.push("a valid email");
  if (!website) missing.push("your current website (or that you do not have one)");
  if (!WANTS[want]) missing.push("what you are after");
  if (missing.length) {
    return json(400, { ok: false, error: `Still needed: ${missing.join(", ")}.` });
  }

  const parts = name.split(/\s+/);
  const body = {
    locationId: LOCATION_ID,
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || parts[0],
    name,
    email,
    companyName: business,
    source: "Website build request (406frontdesk.com)",
  };
  // ⛔ TAGS ARE DELIBERATELY NOT SENT HERE. Measured 2026-09-10: `/contacts/upsert` treats the
  // `tags` array as AUTHORITATIVE and REPLACES the contact's whole tag set. Proven with a throwaway
  // tag: a contact carrying `zz-tag-merge-probe` plus two others came back with only the two this
  // endpoint sends. On a returning prospect that would silently strip `scorecard-request` /
  // `scorecard-delivered` and drop them out of the Scorecard Nurture drip, plus any client-status
  // tags. They go through POST /contacts/<id>/tags below instead, which ADDS.
  // Only send the optional keys when they hold something. An empty string on `phone` is
  // accepted and blanks a value an existing contact already had -- this endpoint
  // upserts, so a returning prospect must not lose the number they gave last time.
  if (phone) body.phone = phone;
  if (/^https?:\/\//i.test(website)) body.website = website;
  // The prose answers ("I don't have one") go here too -- the custom field is free text, and
  // "they told us they have no site" is a fact worth keeping, not a blank.
  if (CURRENT_SITE_FIELD_ID) body.customFields = [{ id: CURRENT_SITE_FIELD_ID, field_value: website }];

  let res, text;
  try {
    res = await fetch(`${GHL}/contacts/upsert`, {
      method: "POST",
      headers: ghlHeaders(token),
      body: JSON.stringify(body),
    });
    text = await res.text();
  } catch (e) {
    console.error("GHL request failed:", e && e.message);
    return json(502, {
      ok: false,
      error: "We could not reach the system that stores your request. Nothing was saved — please try again in a moment, or call (406) 840-0404.",
    });
  }

  if (!res.ok) {
    // Log the status and GHL's message, never the token.
    console.error(`GHL upsert failed ${res.status} :: ${text.slice(0, 500)}`);
    if (res.status === 401 || res.status === 403) {
      return json(502, {
        ok: false,
        code: "auth_rejected",
        upstream: res.status,
        error: "This form's credential was rejected by our CRM. Please call (406) 840-0404 or email admin@406frontdesk.com — nothing you typed is lost.",
      });
    }
    return json(502, { ok: false, error: "Your request could not be saved. Nothing was lost — please try again, or call (406) 840-0404." });
  }

  let contactId = null;
  try { contactId = (JSON.parse(text).contact || {}).id || null; } catch {}

  // TAGS, ADDED not replaced -- see the note on the upsert body above.
  // 🔴 This one is load-bearing beyond bookkeeping: the workflow that emails the requester
  // triggers on *Tag added -> website build request*. If this call fails, the contact and the task
  // still exist so the lead is not lost, but NO confirmation email goes out and the page's
  // "within one business day" promise is carried by Gus alone. Hence the loud log.
  let tagsOk = false;
  if (contactId) {
    try {
      const tagRes = await fetch(`${GHL}/contacts/${contactId}/tags`, {
        method: "POST",
        headers: ghlHeaders(token),
        body: JSON.stringify({ tags: ["website build request", WANTS[want]] }),
      });
      tagsOk = tagRes.ok;
      if (!tagRes.ok) {
        console.error(`TAG WRITE FAILED ${tagRes.status} for ${contactId} :: ${(await tagRes.text()).slice(0, 300)} -- the confirmation email will NOT have been sent`);
      }
    } catch (e) {
      console.error("TAG WRITE FAILED (unreachable):", e && e.message, "-- the confirmation email will NOT have been sent");
    }
  }

  // THE ANSWERS AS A NOTE. The upsert above carries name/email/phone/company/website;
  // the two answers that make this a build request -- what they want, and what they
  // said in their own words -- have nowhere on a contact record to live.
  const noteBody = [
    `Website build request — ${new Date().toLocaleString("en-US", { timeZone: "America/Denver" })} MT`,
    "",
    `Business: ${business}`,
    `Current website: ${website}`,
    `What they are after: ${want}`,
    phone ? `Phone (callback only — NOT an SMS opt-in): ${phone}` : "Phone: not given",
    "",
    notes ? `In their words:\n${notes}` : "No extra notes.",
    "",
    "Next: run the scorecard on the site above and send it back.",
  ].join("\n");

  // Best-effort after the confirmed write. A failed note must never fail a submission
  // GHL has already accepted, or the person is told to send it again and you get two.
  let noteOk = false;
  let taskOk = false;
  if (contactId) {
    const [noteRes, taskRes] = await Promise.allSettled([
      fetch(`${GHL}/contacts/${contactId}/notes`, {
        method: "POST",
        headers: ghlHeaders(token),
        body: JSON.stringify({ body: noteBody, userId: ASSIGNEE_USER_ID }),
      }).then(async (r) => { if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`); }),
      fetch(`${GHL}/contacts/${contactId}/tasks`, {
        method: "POST",
        headers: ghlHeaders(token),
        body: JSON.stringify({
          title: `Website build request — ${business}`,
          body: `${want}. Site: ${website}. Run the scorecard and reply within one business day.`,
          // Due tomorrow: the page promises a reply within one business day.
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          completed: false,
          assignedTo: ASSIGNEE_USER_ID,
        }),
      }).then(async (r) => { if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`); }),
    ]);
    noteOk = noteRes.status === "fulfilled";
    taskOk = taskRes.status === "fulfilled";
    if (!noteOk) console.error("note write failed:", noteRes.reason && noteRes.reason.message);
    if (!taskOk) console.error("task write failed:", taskRes.reason && taskRes.reason.message);
  }

  // IMMUTABLE SUBMISSION RECORD. This endpoint upserts, so a prospect who submits twice
  // overwrites their own contact with no trace of what they first said. Same reasoning
  // as the build brief's archive, and the only place the free text survives if the note
  // write above failed.
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await getStore("build-request-submissions").set(
      `${stamp}-${email.replace(/[^a-z0-9]+/gi, "-")}.json`,
      JSON.stringify(
        { receivedAt: new Date().toISOString(), contactId, name, business, email, phone, website, want, notes },
        null,
        2
      ),
      { metadata: { email, contactId: contactId || "" } }
    );
  } catch (e) {
    console.error("submission archive failed (contact was still saved):", e && e.message);
  }

  console.log(`build request stored for ${email}${contactId ? ` (contact ${contactId})` : ""} — ${want}, tags ${tagsOk}, note ${noteOk}, task ${taskOk}`);
  return json(200, { ok: true });
};
