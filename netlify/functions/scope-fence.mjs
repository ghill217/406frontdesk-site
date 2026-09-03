/**
 * scope-fence.mjs — flag the answers on a build brief that fall outside the flat rate.
 *
 * WHY: the build price is flat ($750 founding / $1,500 standard), so the intake's
 * second job is catching the answers that do not fit inside it. The Intake Spec calls
 * this out as a table you are supposed to read every brief against, BEFORE building.
 * Doing that by hand, every time, is exactly the sort of check that gets skipped on a
 * busy week -- and the cost of skipping it is a conversation in week three instead of
 * week zero.
 *
 * Every answer is already structured, so this is mechanical. It FLAGS ONLY: it never
 * prices anything and never decides anything. Pricing is Gus's, per DECISIONS.md.
 *
 * Option strings are matched EXACTLY against the live GHL picklists (pulled
 * 2026-09-03), not against the spec's prose -- several differ. e.g. the spec says
 * "Yes, contract requires it"; the field actually says
 * "Yes - a contract or regulation requires it".
 */

/** Each rule: which answer trips it, and what the conversation is. */
const RULES = [
  {
    key: "what_should_the_site_actually_do",
    includes: "Online store",
    flag: "Online store requested",
    why: "E-commerce is catalog + payments + tax + shipping + ongoing product upkeep. A different product, not a page.",
  },
  {
    key: "what_should_the_site_actually_do",
    includes: "Customer login area",
    flag: "Customer login area requested",
    why: "Auth, accounts, and a support surface forever.",
  },
  {
    key: "what_should_the_site_actually_do",
    includes: "Quote / estimate calculator",
    flag: "Quote / estimate calculator requested",
    why: "Custom logic build, not a template page.",
  },
  {
    key: "what_should_the_site_actually_do",
    includes: "Second language",
    flag: "Second language requested",
    why: "Doubles the content and doubles every future edit.",
  },
  {
    key: "does_it_need_to_connect_to_software_you_already_use",
    nonEmpty: true,
    flag: "Wants an integration with existing software",
    why: "Every integration is a live API dependency someone has to own. Some have no clean path.",
  },
  {
    key: "any_accessibility_requirements",
    equals: "Yes - a contract or regulation requires it",
    flag: "Accessibility is contractually required",
    why: "WCAG conformance is an audit + remediation discipline, not a checkbox. Do not promise conformance.",
  },
  {
    key: "roughly_how_many_pages_total",
    equals: "9 or more",
    flag: "Nine or more pages",
    why: "The flat rate assumes a small-business site. Confirm the count and re-price above ~8.",
  },
  {
    key: "photos_for_the_site",
    equals: "I need someone to come take photos",
    flag: "Needs a photographer",
    why: "Photography is a vendor, not a build task. Refer out or quote separately.",
  },
  {
    key: "who_is_writing_the_words",
    equals: "You write it from what I tell you",
    flag: "Wants full copywriting",
    why: "Copywriting from an interview is real hours. Fine to do, just price it or set expectations.",
  },
  {
    key: "do_you_have_a_logo",
    equals: "No, I need one",
    flag: "Needs a logo designed",
    why: "Identity design is its own project. Do not fold a logo into a site build.",
  },
  {
    key: "do_you_already_own_it",
    equalsAny: ["Yes, but I don't know the login", "Not sure"],
    flag: "Domain access is unknown",
    why: "Recovery can take days and sometimes fails. Resolve BEFORE promising a go-live date.",
  },
  {
    key: "do_you_have_email_on_that_domain",
    equalsAny: ["Yes - tell us BEFORE we point the domain, or your email can go down", "Not sure"],
    flag: "Live email may be on the domain",
    why: "Repointing DNS can take their business email down. Map MX records before touching DNS; never guess.",
  },
  {
    key: "does_this_need_to_be_live_by_a_certain_date",
    nonEmpty: true,
    flag: "Has a hard deadline",
    why: "One edit round plus their content lag rarely fits a fixed date. Set it against the content answer, not hope.",
  },
];

const val = (answers, key) => {
  const v = answers[key];
  if (Array.isArray(v)) return v;
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
};

/**
 * Returns the tripped rules, in the order declared, followed by any MEASURED
 * flags (from domain-preflight.mjs) -- same shape, different provenance.
 */
export function scopeFlags(answers, measured = []) {
  const hits = [];
  for (const r of RULES) {
    const v = val(answers, r.key);
    let tripped = false;
    if (r.includes) tripped = Array.isArray(v) ? v.includes(r.includes) : v === r.includes;
    else if (r.equals) tripped = v === r.equals;
    else if (r.equalsAny) tripped = r.equalsAny.includes(v);
    else if (r.nonEmpty) tripped = Array.isArray(v) ? v.length > 0 : String(v).length > 0;
    if (tripped) hits.push(r);
  }
  return hits.concat(measured || []);
}

/**
 * Human-readable summary for the contact record and the alert email.
 * Deliberately plain text: it is read in a GHL field and an email body, neither of
 * which renders markdown. `extra.measured` are preflight flags; `extra.preflight`
 * is the measurement block itself, appended after the flags so the alert carries
 * the evidence next to the conclusion.
 */
export function scopeFlagsText(answers, extra = {}) {
  const { measured = [], preflight = "" } = extra;
  const hits = scopeFlags(answers, measured);
  const lines = [];
  if (!hits.length) {
    lines.push("No scope flags. Every answer on this brief fits inside the flat build rate.");
  } else {
    lines.push(`${hits.length} SCOPE FLAG${hits.length === 1 ? "" : "S"} — talk about these BEFORE building, not in week three:`, "");
    hits.forEach((h, i) => {
      lines.push(`${i + 1}. ${h.flag}`);
      lines.push(`   ${h.why}`);
    });
    lines.push("");
    lines.push("Flags only. Nothing here has been priced — that is yours.");
  }
  if (preflight) lines.push("", preflight);
  return lines.join("\n");
}

/* ---------------------------------------------------------------------------
 * Selftest:  node netlify/functions/scope-fence.mjs --selftest
 *
 * Every rule gets BOTH a positive case (the exact live option string trips it) and
 * a negative case (a different valid answer does not). A rule that can only fire, or
 * can never fire, is worse than no rule -- the first cries wolf on every brief and
 * the second silently passes the thing it exists to catch.
 * ------------------------------------------------------------------------- */
const CASES = [
  ["online store",        { what_should_the_site_actually_do: ["Contact form", "Online store"] },        "Online store requested"],
  ["customer login",      { what_should_the_site_actually_do: ["Customer login area"] },                  "Customer login area requested"],
  ["quote calculator",    { what_should_the_site_actually_do: ["Quote / estimate calculator"] },          "Quote / estimate calculator requested"],
  ["second language",     { what_should_the_site_actually_do: ["Second language"] },                      "Second language requested"],
  ["integration",         { does_it_need_to_connect_to_software_you_already_use: "Housecall Pro" },       "Wants an integration with existing software"],
  ["accessibility",       { any_accessibility_requirements: "Yes - a contract or regulation requires it" }, "Accessibility is contractually required"],
  ["nine pages",          { roughly_how_many_pages_total: "9 or more" },                                  "Nine or more pages"],
  ["photographer",        { photos_for_the_site: "I need someone to come take photos" },                  "Needs a photographer"],
  ["copywriting",         { who_is_writing_the_words: "You write it from what I tell you" },              "Wants full copywriting"],
  ["logo needed",         { do_you_have_a_logo: "No, I need one" },                                       "Needs a logo designed"],
  ["domain login",        { do_you_already_own_it: "Yes, but I don't know the login" },                   "Domain access is unknown"],
  ["domain not sure",     { do_you_already_own_it: "Not sure" },                                          "Domain access is unknown"],
  ["email on domain",     { do_you_have_email_on_that_domain: "Yes - tell us BEFORE we point the domain, or your email can go down" }, "Live email may be on the domain"],
  ["hard deadline",       { does_this_need_to_be_live_by_a_certain_date: "Before the Fourth of July" },   "Has a hard deadline"],
];

// Answers that must trip NOTHING -- the ordinary small-business brief.
const CLEAN = {
  what_should_the_site_actually_do: ["Contact form", "Click-to-call button", "Google map"],
  roughly_how_many_pages_total: "5-8",
  photos_for_the_site: "I have phone photos that are decent",
  who_is_writing_the_words: "I'll send rough notes, you clean them up",
  do_you_have_a_logo: "Yes, I'll send it",
  do_you_already_own_it: "Yes, and I have the login",
  do_you_have_email_on_that_domain: "No, I use Gmail / Yahoo / etc.",
  any_accessibility_requirements: "Not that I know of",
  does_it_need_to_connect_to_software_you_already_use: "",
  does_this_need_to_be_live_by_a_certain_date: "",
};

if (process.argv[1] && process.argv[1].endsWith("scope-fence.mjs") && process.argv.includes("--selftest")) {
  let bad = 0;
  for (const [label, answers, expected] of CASES) {
    const got = scopeFlags({ ...CLEAN, ...answers }).map((h) => h.flag);
    const ok = got.includes(expected);
    console.log(`  ${ok ? "PASS" : "FAIL"}  trips on ${label}`);
    if (!ok) bad++;
  }
  const clean = scopeFlags(CLEAN);
  const cleanOk = clean.length === 0;
  console.log(`  ${cleanOk ? "PASS" : "FAIL"}  ordinary brief trips NOTHING${cleanOk ? "" : ` (got: ${clean.map((h) => h.flag).join(", ")})`}`);
  if (!cleanOk) bad++;

  const text = scopeFlagsText(CLEAN);
  const textOk = text.startsWith("No scope flags");
  console.log(`  ${textOk ? "PASS" : "FAIL"}  clean brief reads as clean`);
  if (!textOk) bad++;

  const multi = scopeFlagsText({ ...CLEAN, roughly_how_many_pages_total: "9 or more", do_you_have_a_logo: "No, I need one" });
  const multiOk = multi.startsWith("2 SCOPE FLAGS");
  console.log(`  ${multiOk ? "PASS" : "FAIL"}  counts multiple flags`);
  if (!multiOk) bad++;

  const measured = [{ flag: "Live email MEASURED on example.com: Google Workspace", why: "mx present" }];
  const withM = scopeFlagsText(CLEAN, { measured, preflight: "DOMAIN PRE-FLIGHT for example.com" });
  const mOk = withM.startsWith("1 SCOPE FLAG ") && withM.includes("Live email MEASURED") && withM.endsWith("DOMAIN PRE-FLIGHT for example.com");
  console.log(`  ${mOk ? "PASS" : "FAIL"}  measured flags count and the preflight block trails the text`);
  if (!mOk) bad++;

  const cleanPre = scopeFlagsText(CLEAN, { preflight: "DOMAIN PRE-FLIGHT for example.com" });
  const cpOk = cleanPre.startsWith("No scope flags") && cleanPre.endsWith("DOMAIN PRE-FLIGHT for example.com");
  console.log(`  ${cpOk ? "PASS" : "FAIL"}  clean brief still carries the preflight block`);
  if (!cpOk) bad++;

  console.log(bad === 0 ? `\nselftest: ${CASES.length + 5}/${CASES.length + 5} controls behave (positive + negative).` : `\nselftest: ${bad} CONTROL(S) BROKEN`);
  process.exitCode = bad === 0 ? 0 : 1;
}
