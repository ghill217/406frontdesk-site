#!/usr/bin/env node
/**
 * get-discovery-submission.mjs — read the immutable archive of /discovery/ submissions.
 *
 * The function UPSERTS the contact, so a second send (the "add more answers and re-send"
 * path is built to encourage exactly that) overwrites the contact's fields. This archive
 * is the only place every send survives, and the structured answers here are what the
 * /discovery skill should build the report from, not the flattened card in GHL.
 *
 * Usage:
 *   node scripts/get-discovery-submission.mjs                    # list, newest first
 *   node scripts/get-discovery-submission.mjs --match voodoo     # filter by key/email
 *   node scripts/get-discovery-submission.mjs --show <key>       # the verdict + the answer card
 *   node scripts/get-discovery-submission.mjs --show <key> --json
 *
 * Auth: NETLIFY_AUTH_TOKEN, else ~/.hivemind/netlify-token.txt. Never printed.
 */
import { getStore } from "@netlify/blobs";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SITE_ID = "6099da85-5729-4d4b-b40a-beacd07e5499"; // 406frontdesk (not secret)
const STORE = "discovery-submissions";

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
    const a = d.answers || {};
    console.log(`${a.full_name}  <${a.email}>  ${a.business || ""}`);
    console.log(`received ${d.receivedAt}   contact ${d.contactId || "(unknown)"}   task ${d.taskCreated ? "created" : "NOT created"}`);
    const rule = "-".repeat(70);
    console.log(`\n${rule}\n${d.verdictText || ""}\n${rule}\n`);
    console.log(d.card || "(no card)");
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
    console.log(`\nRead one:  node scripts/get-discovery-submission.mjs --show "<key>"`);
  }
}
