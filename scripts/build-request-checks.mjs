/**
 * Offline checks for netlify/functions/build-request.js — the /request-a-build/ endpoint.
 *
 *   node scripts/build-request-checks.mjs        (or: npm run check:build-request)
 *
 * SAFE TO RUN ANYWHERE. `fetch` is stubbed, so nothing reaches GoHighLevel and no record is
 * created — which is why this lives here as a tracked file rather than under the gitignored
 * `scripts/*.local.mjs` rule, whose scripts create and purge real records.
 *
 * What it is guarding, and why each one earned a check:
 *   - The tag write. GHL's /contacts/upsert treats `tags` as AUTHORITATIVE and REPLACES the
 *     contact's whole tag set (measured 2026-09-10 with a throwaway tag). Sending tags there
 *     silently strips `scorecard-request` / `scorecard-delivered` off a returning prospect and
 *     drops them out of the nurture drip. The upsert body must carry NO tags at all; they go
 *     through POST /contacts/<id>/tags, which adds.
 *   - The closed answer set. An unknown `want` must never become a tag.
 *   - The optional phone. An empty string blanks a number an existing contact already had,
 *     because this endpoint upserts.
 *   - The prose website. "I don't have one" is a valid answer; it must stay out of the
 *     contact's URL field but survive in the note and the custom field.
 *
 * Exits 0 on success, 1 on any failure, so it can gate a deploy.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const fnUrl = pathToFileURL(resolve(process.cwd(), "netlify/functions/build-request.js"));
const { default: handler } = await import(fnUrl);

process.env.GHL_PIT = "test-token";

// Swallow the endpoint's own logging. It is deliberately loud in production (a failed tag write
// means no confirmation email), but here it drowns the results — and Netlify Blobs is never
// configured outside Netlify, so its archive step always complains.
const quiet = { log: console.log, error: console.error };
const silence = () => { console.log = () => {}; console.error = () => {}; };
const restore = () => { console.log = quiet.log; console.error = quiet.error; };

let calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
  if (String(url).endsWith("/contacts/upsert")) {
    return new Response(JSON.stringify({ contact: { id: "ct_123" } }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
};

const post = (body) => {
  calls = [];
  return handler(
    new Request("https://x/.netlify/functions/build-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
};

const GOOD = {
  name: "Dana Reyes",
  business: "Reyes Plumbing",
  email: "dana@example.com",
  phone: "406 555 0134",
  website: "reyesplumbing.com",
  want: "Rebuild of what I have",
  notes: "Phone number is wrong on every page.",
};

let failed = 0;
const check = (label, ok, detail = "") => {
  quiet.log(`${ok ? "PASS  " : "FAIL  "}${label}${ok ? "" : `  ->  ${detail}`}`);
  if (!ok) failed++;
};
const find = (frag) => calls.find((c) => c.url.includes(frag));

silence();

// ---- happy path -----------------------------------------------------------
let res = await post(GOOD);
let body = await res.json();
const upsert = find("/contacts/upsert");
const tagCall = find("/tags");
const note = find("/notes");
restore();

check("valid submission returns 200 ok", res.status === 200 && body.ok === true, JSON.stringify(body));
check("website normalised to https", upsert.body.website === "https://reyesplumbing.com", upsert.body.website);
check("company name sent", upsert.body.companyName === "Reyes Plumbing", upsert.body.companyName);
check("name split into first + last", upsert.body.firstName === "Dana" && upsert.body.lastName === "Reyes", upsert.body.lastName);
check("current_website_url written to the brief's own field id",
  JSON.stringify(upsert.body.customFields) === JSON.stringify([{ id: "MRIcJqtApub8r2RiRMop", field_value: "https://reyesplumbing.com" }]),
  JSON.stringify(upsert.body.customFields));
check("UPSERT SENDS NO TAGS (they would REPLACE the whole tag set)", upsert.body.tags === undefined, JSON.stringify(upsert.body.tags));
check("tags added via POST /contacts/<id>/tags", !!tagCall, "no tag call was made");
check("tag call carries both the marker and the ask",
  JSON.stringify(tagCall?.body.tags) === JSON.stringify(["website build request", "build request: rebuild"]),
  JSON.stringify(tagCall?.body));
check("a note was written", !!note, "no note call");
check("note warns the phone is not an SMS opt-in", /NOT an SMS opt-in/.test(note?.body.body ?? ""), "");
check("a task was opened", !!find("/tasks"), "no task call");

// ---- edge cases -----------------------------------------------------------
silence();
await post({ ...GOOD, name: "Cher" });
const oneName = find("/contacts/upsert");
restore();
check("single-word name still fills lastName (GHL rejects an empty one)", oneName.body.lastName === "Cher", oneName.body.lastName);

silence();
await post({ ...GOOD, website: "I don't have one" });
const prose = find("/contacts/upsert");
const proseNote = find("/notes");
restore();
check("prose website kept out of the contact's URL field", prose.body.website === undefined, String(prose.body.website));
check("prose website survives in the note", /I don't have one/.test(proseNote.body.body), "");
check("prose website still fills the custom field", prose.body.customFields[0].field_value === "I don't have one", JSON.stringify(prose.body.customFields));

silence();
await post({ ...GOOD, phone: "" });
const noPhone = find("/contacts/upsert");
restore();
check("empty phone omitted, so an existing number is not blanked", !("phone" in noPhone.body), String(noPhone.body.phone));

// ---- validation -----------------------------------------------------------
for (const [label, patch] of [
  ["missing name", { name: "" }],
  ["missing business", { business: "" }],
  ["malformed email", { email: "dana@" }],
  ["missing website", { website: "" }],
  ["missing want", { want: "" }],
  ["a want outside the closed set", { want: "Free stuff" }],
]) {
  silence();
  const r = await post({ ...GOOD, ...patch });
  const b = await r.json();
  restore();
  check(`rejects ${label}`, r.status === 400 && b.ok === false, `${r.status} ${JSON.stringify(b)}`);
}

// ---- guards ---------------------------------------------------------------
silence();
res = await post({ ...GOOD, company_hp: "spam" });
body = await res.json();
const honeypotCalls = calls.length;
restore();
check("honeypot drops silently without touching GHL", res.status === 200 && body.note === "ignored" && honeypotCalls === 0, `${honeypotCalls} calls`);

process.env.GHL_PIT = "";
silence();
res = await post(GOOD);
body = await res.json();
restore();
check("missing credential fails loudly as 500 no_token", res.status === 500 && body.code === "no_token", JSON.stringify(body));
process.env.GHL_PIT = "test-token";

silence();
res = await handler(new Request("https://x/", { method: "PUT" }));
restore();
check("PUT is rejected", res.status === 405, String(res.status));

quiet.log(failed ? `\n${failed} FAILURE(S)` : `\nall checks passed`);
process.exit(failed ? 1 : 0);
