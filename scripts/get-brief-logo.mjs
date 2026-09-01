#!/usr/bin/env node
/**
 * get-brief-logo.mjs — list and download logos submitted through /build-brief/.
 *
 * WHY THIS EXISTS: the submit function writes uploaded logos to a Netlify Blobs store
 * and records the key on the GHL contact. Without this script that store is
 * WRITE-ONLY — a client uploads a logo, the contact says `uploaded: <key>`, and
 * nothing on earth can read it back. A feature that stores something nobody can
 * retrieve is not a feature.
 *
 * Usage:
 *   node scripts/get-brief-logo.mjs                       # list everything, newest first
 *   node scripts/get-brief-logo.mjs --match smith         # filter by key/email substring
 *   node scripts/get-brief-logo.mjs --get <key>           # download one
 *   node scripts/get-brief-logo.mjs --get <key> --out D:/somewhere
 *
 * Auth: reads the Netlify PAT from ~/.hivemind/netlify-token.txt (outside the vault,
 * excluded from backups by name) unless NETLIFY_AUTH_TOKEN is already set. The token
 * is never printed.
 */
import { getStore } from "@netlify/blobs";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SITE_ID = "6099da85-5729-4d4b-b40a-beacd07e5499"; // 406frontdesk (not secret)
const STORE = "build-brief-logos";

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
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? "";
};

const store = getStore({ name: STORE, siteID: SITE_ID, token: token() });

const getKey = flag("--get");
if (getKey) {
  const res = await store.getWithMetadata(getKey, { type: "arrayBuffer" });
  if (!res) {
    console.error(`No blob with key: ${getKey}\nRun without --get to list what is there.`);
    process.exit(1);
  }
  const outDir = resolve(flag("--out") || process.cwd());
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const name = (res.metadata?.originalName || getKey).replace(/[^A-Za-z0-9._-]+/g, "-");
  const dest = join(outDir, name);
  writeFileSync(dest, Buffer.from(res.data));
  console.log(`saved ${Buffer.from(res.data).length} bytes -> ${dest}`);
  if (res.metadata?.email) console.log(`submitted by: ${res.metadata.email}`);
} else {
  const match = (flag("--match") || "").toLowerCase();
  const { blobs } = await store.list();
  const rows = blobs
    .filter((b) => !match || b.key.toLowerCase().includes(match))
    .sort((a, b) => b.key.localeCompare(a.key)); // keys are timestamp-prefixed

  if (!rows.length) {
    console.log(match ? `No logos matching "${match}".` : "No logos submitted yet.");
  } else {
    console.log(`${rows.length} logo(s):\n`);
    for (const b of rows) {
      const ts = Number(b.key.split("-")[0]);
      const when = Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 16).replace("T", " ") : "?";
      console.log(`  ${when}  ${b.key}`);
    }
    console.log(`\nDownload one:  node scripts/get-brief-logo.mjs --get "<key>"`);
  }
}
