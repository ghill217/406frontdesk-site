#!/usr/bin/env node
/**
 * sync-build-brief.mjs — pull the Website Build Brief field definitions from GHL and
 * regenerate src/_data/buildBrief.json.
 *
 * WHY THIS IS GENERATED, NOT TYPED:
 * The custom form has to write into 55 GHL custom fields by their exact fieldKey. A
 * typo in a key does not throw — GHL accepts the payload and silently drops that
 * answer, so the brief comes back missing a field and nothing anywhere reports it.
 * Pulling the keys, types and option lists straight from the API removes the class of
 * bug entirely, and re-running this after any change in GHL keeps them in step.
 *
 * Usage:
 *   node scripts/sync-build-brief.mjs            # regenerate from the live API
 *   node scripts/sync-build-brief.mjs --check    # fail if the file is out of date
 *
 * Reads the token from C:/Users/ghill/.hivemind/ghl-406-pit.txt (outside the vault,
 * excluded from backups by name). Never prints it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOCATION_ID = "To7tF3i6kQHNNNuJGqpQ";
const BRIEF_FOLDER = "up6EcQ8npmidLXGDKJav";      // "FORM | WEBSITE BUILD BRIEF"
const TOKEN_FILE = join(homedir(), ".hivemind", "ghl-406-pit.txt");
const OUT = new URL("../src/_data/buildBrief.json", import.meta.url);

/**
 * Which of the spec's 8 steps each field belongs to, keyed by GHL fieldKey.
 * Assigned EXPLICITLY rather than inferred from `position`: position is the GHL
 * builder's own ordering and has drifted before (the v1 form ran backwards from ~#25).
 * The generator fails if a field arrives that is not listed here, so a new field in
 * GHL cannot silently vanish from the form.
 */
const SECTION_OF = {
  // 1 — the basics + what this site has to do
  business_name_for_the_website: 1,
  what_does_your_business_do_in_one_sentence: 1,
  who_is_this_site_for: 1,
  whats_the_one_thing_you_want_a_visitor_to_do: 1,
  secondmostimportant_action: 1,
  whats_wrong_with_what_you_have_now: 1,
  if_this_site_works_whats_different_in_6_months: 1,

  // 2 — design direction (the load-bearing section)
  which_of_these_feels_closest_to_what_you_want: 2,
  three_websites_you_like: 2,
  three_websites_you_dont_like: 2,
  your_23_main_competitors: 2,
  do_you_have_a_logo: 2,
  logo_file: 2,
  design_directions_picked: 2,
  logo_upload_reference: 2,
  brand_colors: 2,
  fonts_you_own_or_have_to_use: 2,
  existing_brand_materials: 2,
  how_do_you_want_to_come_across_pick_up_to_4: 2,
  anything_you_definitely_do_not_want_to_see: 2,

  // 3 — pages & structure
  which_pages_do_you_want: 3,
  roughly_how_many_pages_total: 3,
  any_other_pages_not_listed_above: 3,
  current_website_url: 3,
  anything_on_your_current_site_that_must_carry_over: 3,
  anything_on_the_current_site_to_kill: 3,
  what_should_be_in_the_top_menu: 3,

  // 4 — content: words & photos
  who_is_writing_the_words: 4,
  when_can_we_have_your_content: 4,
  photos_for_the_site: 4,
  headshots__team_photos: 4,
  reviews_or_testimonials_to_feature: 4,
  certifications_licenses_awards_affiliations: 4,
  documents_to_put_on_the_site: 4,
  anything_youre_legally_required_to_display: 4,

  // 5 — features & functionality
  what_should_the_site_actually_do: 5,
  online_store__roughly_how_many_products: 5,
  does_it_need_to_connect_to_software_you_already_use: 5,
  do_you_run_ads_that_point_at_your_site: 5,
  what_should_people_be_googling_to_find_you: 5,
  what_area_do_you_serve: 5,
  any_accessibility_requirements: 5,

  // 6 — domain, hosting & access
  what_web_address_do_you_want: 6,
  do_you_already_own_it: 6,
  where_is_it_registered: 6,
  who_hosts_your_current_site: 6,
  do_you_have_email_on_that_domain: 6,
  other_web_addresses_you_own: 6,
  who_else_should_be_able_to_make_edits: 6,
  who_worked_on_this_site_before: 6,

  // 7 — scope, timeline & approvals
  does_this_need_to_be_live_by_a_certain_date: 7,
  who_has_final_say_on_the_design: 7,
  anyone_else_who_must_review_before_golive: 7,
  how_do_you_want_updates_during_the_build: 7,
  have_you_had_a_website_built_before_howd_it_go: 7,
  anything_youre_worried_about: 7,

  // 8 — anything else
  anything_we_didnt_ask_that_we_should_know: 8,
};

/**
 * Required fields, from the spec. GHL's API does not expose the form's own required
 * flags (the field definition is location-level, the flag lives on the form), so this
 * is the spec's list -- 20 of them -- and it is asserted against SECTION_OF below.
 */
const REQUIRED = new Set([
  "business_name_for_the_website",
  "what_does_your_business_do_in_one_sentence",
  "who_is_this_site_for",
  "whats_the_one_thing_you_want_a_visitor_to_do",
  "which_of_these_feels_closest_to_what_you_want",
  "three_websites_you_like",
  "do_you_have_a_logo",
  "which_pages_do_you_want",
  "roughly_how_many_pages_total",
  "who_is_writing_the_words",
  "when_can_we_have_your_content",
  "photos_for_the_site",
  "what_should_the_site_actually_do",
  "what_web_address_do_you_want",
  "do_you_already_own_it",
  "do_you_have_email_on_that_domain",
  "who_has_final_say_on_the_design",
]);

const SECTIONS = [
  { n: 1, title: "The basics", blurb: "Who you are and what this site has to do." },
  { n: 2, title: "Design direction", blurb: "The most useful section on this form. Pick first, then tell us why." },
  { n: 3, title: "Pages & structure", blurb: "What the site is made of." },
  { n: 4, title: "Words & photos", blurb: "Be honest here. This is the step that decides whether we ship on time." },
  { n: 5, title: "Features", blurb: "What the site should actually do. We'll flag anything that's an add-on before we start." },
  { n: 6, title: "Domain & hosting", blurb: "So go-live is quiet instead of a fire drill." },
  { n: 7, title: "Scope & approvals", blurb: "Who decides, and by when." },
  { n: 8, title: "Anything else", blurb: "The stuff that doesn't fit a box." },
];

async function fetchFields() {
  let token;
  try {
    token = readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    console.error(`Cannot read the GHL token at ${TOKEN_FILE}.`);
    console.error("This script only regenerates the field map; the site builds fine without it.");
    process.exit(2);
  }
  const res = await fetch(
    `https://services.leadconnectorhq.com/locations/${LOCATION_ID}/customFields`,
    { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" } }
  );
  if (!res.ok) {
    console.error(`GHL returned ${res.status}. Token scope or network problem.`);
    process.exit(2);
  }
  const body = await res.json();
  return (body.customFields || []).filter((f) => f.parentId === BRIEF_FOLDER);
}

function build(raw) {
  const problems = [];
  const fields = raw.map((f) => {
    const key = f.fieldKey.replace(/^contact\./, "");
    const section = SECTION_OF[key];
    if (!section) problems.push(`field in GHL with no section assigned: ${key}`);
    return {
      key,
      fieldKey: f.fieldKey,
      id: f.id,
      label: f.name,
      help: f.placeholder || "",
      type: f.dataType,
      options: (f.picklistOptions || []).map((o) => (typeof o === "string" ? o : o.label ?? o.value)),
      required: REQUIRED.has(key),
      // "Pick up to 4" is a real constraint, not decoration -- derived from the
      // label/help so it cannot drift from the words the client actually reads.
      maxSelections: (() => {
        const m = /up to (\d+)/i.exec(`${f.name} ${f.placeholder || ""}`);
        return m ? Number(m[1]) : null;
      })(),
      section,
    };
  });

  const seen = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(SECTION_OF)) {
    if (!seen.has(key)) problems.push(`SECTION_OF lists a field that no longer exists in GHL: ${key}`);
  }
  for (const key of REQUIRED) {
    if (!seen.has(key)) problems.push(`REQUIRED lists a field that no longer exists in GHL: ${key}`);
  }
  if (problems.length) {
    console.error("Refusing to write a field map that does not match GHL:");
    problems.forEach((p) => console.error("  - " + p));
    process.exitCode = 1;
    return null;
  }

  fields.sort((a, b) => a.section - b.section || a.key.localeCompare(b.key));
  return {
    note: "GENERATED by scripts/sync-build-brief.mjs from the live GHL API. Do not hand-edit: a wrong fieldKey is accepted silently by GHL and the answer is dropped.",
    locationId: LOCATION_ID,
    folderId: BRIEF_FOLDER,
    sections: SECTIONS,
    fields,
  };
}

const raw = await fetchFields();
const data = build(raw);
if (!data) { /* build() already reported and set exitCode */ }
else {
const text = JSON.stringify(data, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = (() => { try { return readFileSync(OUT, "utf8"); } catch { return ""; } })();
  // Compare line-ending-agnostically. This repo runs core.autocrlf=true, so git hands
  // back CRLF on checkout while the generator writes LF -- comparing raw text made the
  // check fail on every fresh clone regardless of the data, and a gate that always
  // fails is as useless as one that never does.
  const norm = (t) => t.split(String.fromCharCode(13)).join("");
  if (norm(current) !== norm(text)) {
    console.error("src/_data/buildBrief.json is STALE vs GHL. Run: node scripts/sync-build-brief.mjs");
    process.exitCode = 1;
  } else {
  // No process.exit(0) here: on Windows it races Node's pending handles and the
  // process dies with exit 127 AFTER printing success -- which would make this gate
  // fail every CI run while claiming to pass. Let it end naturally instead.
  console.log(`buildBrief.json matches GHL (${data.fields.length} fields).`);
  }
} else {

  writeFileSync(OUT, text);
  const bySection = SECTIONS.map((s) => `${s.n}:${data.fields.filter((f) => f.section === s.n).length}`).join("  ");
  console.log(`wrote ${data.fields.length} fields  [${bySection}]`);
  console.log(`required: ${data.fields.filter((f) => f.required).length}`);
}
}
