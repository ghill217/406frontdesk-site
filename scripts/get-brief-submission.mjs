#!/usr/bin/env node
/**
 * get-brief-submission.mjs — read the immutable archive of build brief submissions.
 *
 * WHY THIS EXISTS: the GHL-hosted form had a Submissions tab. Moving the brief to
 * custom HTML removed it, and the contact's field values became the only record --
 * editable, and overwritten wholesale if a client resubmits. The function now archives
 * every accepted submission, and this reads them back.
 *
 * A store nobody can read is not a record, it is a leak of disk space. That mistake
 * was already made once here with the logo store; this is the reader that stops it
 * happening twice.
 *
 * Usage:
 *   node scripts/get-brief-submission.mjs                    # list, newest first
 *   node scripts/get-brief-submission.mjs --match smith      # filter by key/email
 *   node scripts/get-brief-submission.mjs --show <key>       # print one, readable
 *   node scripts/get-brief-submission.mjs --show <key> --json
 *
 * Auth: NETLIFY_AUTH_TOKEN, else ~/.hivemind/netlify-token.txt. Never printed.
 */
import { getStore } from "@netlify/blobs";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SITE_ID = "6099da85-5729-4d4b-b40a-beacd07e5499"; // 406frontdesk (not secret)
const STORE = "build-brief-submissions";

function token() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN.trim();
  const p = join(homedir(), ".hivemind", "netlify-token.txt");
  try {
    return readFileSync(p, "utf8").trim();
  } catch {
    console.error(`No Netlify token. Set NETLIFY_AUTH_TOKEN, or put the PAT at:\n  ${p}`);
    process.exit(2);
  }
}

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(n);
  return i === -1 ? null : argv[i + 1] ?? "";
};

const store = getStore({ name: STORE, siteID: SITE_ID, token: token() });
const showKey = flag("--show");

if (showKey) {
  const raw = await store.get(showKey);
  if (!raw) {
    console.error(`No submission with key: ${showKey}\nRun without --show to list them.`);
    process.exit(1);
  }
  const d = JSON.parse(raw);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(d, null, 2));
  } else {
    console.log(`${d.name}  <${d.email}>  ${d.phone || ""}`);
    console.log(`received ${d.receivedAt}   contact ${d.contactId || "(unknown)"}`);
    if (d.logoKey) console.log(`logo: ${d.logoKey}\n  node scripts/get-brief-logo.mjs --get "${d.logoKey}"`);
    console.log("\n" + "-".repeat(70) + "\n" + (d.scopeFlags || "") + "\n" + "-".repeat(70) + "\n");
    for (const [k, v] of Object.entries(d.answers)) {
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
      const label = k.replace(/_/g, " ");
      const text = Array.isArray(v) ? v.join(", ") : String(v);
      console.log(`${label}\n  ${text.replace(/\n/g, "\n  ")}\n`);
    }
  }
} else {
  const match = (flag("--match") || "").toLowerCase();
  const { blobs } = await store.list();
  const rows = blobs
    .filter((b) => !match || b.key.toLowerCase().includes(match))
    .sort((a, b) => b.key.localeCompare(a.key)); // keys are ISO-timestamp prefixed

  if (!rows.length) {
    console.log(match ? `No submissions matching "${match}".` : "No submissions archived yet.");
  } else {
    console.log(`${rows.length} submission(s):\n`);
    for (const b of rows) console.log("  " + b.key);
    console.log(`\nRead one:  node scripts/get-brief-submission.mjs --show "<key>"`);
  }
}
