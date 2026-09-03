/**
 * brief-tasks.mjs — turn a build brief into GHL tasks on the contact.
 *
 * WHY: the brief names dates and blockers (content due, an existing site that needs
 * its as-found grade captured BEFORE anything changes, a domain nobody can log into)
 * and until now every one of them lived only in a 57-field record Gus had to reread.
 * Tasks put them where the day starts, with due dates derived from what the client
 * said -- not from hope.
 *
 * Pure planning here (selftested); the network write lives in build-brief.js and is
 * best-effort after the confirmed contact write. No task, ever, is client-facing.
 *
 *   node netlify/functions/brief-tasks.mjs --selftest
 */

const DAY = 86400000;

/** Days until content is "due", from the client's own timing answer. */
const CONTENT_DUE = {
  "I have it ready now": 2,
  "Within a week": 7,
  "2-4 weeks": 28,
  "Not sure yet": 14,
};

const at = (now, days) => new Date(now.getTime() + days * DAY).toISOString();
const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

/**
 * @param answers  the brief (fieldKey -> value)
 * @param flags    scope-fence hits [{flag, why}] incl. measured ones
 * @param now      Date, injectable for tests
 * @returns [{title, body, dueDate}]  -- never more than a handful; a task list
 *          longer than the brief defeats the point.
 */
export function planTasks(answers, flags = [], now = new Date()) {
  const a = answers || {};
  const tasks = [];
  const name = str(a.business_name_for_the_website) || "this client";
  const flagText = (needle) => flags.filter((f) => f.flag.includes(needle));

  // 1. Content due -- always. The chaser workflow fires at day 7 for the two "due by
  //    now" answers; this task is the build-side mirror with the real date.
  const timing = str(a.when_can_we_have_your_content);
  const days = CONTENT_DUE[timing];
  if (days !== undefined) {
    tasks.push({
      title: timing === "Not sure yet" ? `Get a content date from ${name}` : `Content due: ${name}`,
      body: `They said "${timing}" on ${now.toISOString().slice(0, 10)}. Words: ${str(a.who_is_writing_the_words) || "unspecified"}. Photos: ${str(a.photos_for_the_site) || "unspecified"}. The site does not move until this lands.`,
      dueDate: at(now, days),
    });
  }

  // 2. Baseline audit -- only when there is an existing site. The before/after proof
  //    needs the as-found grade captured before anything is touched; once the
  //    rebuild starts, that measurement is gone for good.
  const site = str(a.current_website_url);
  if (site && !/^(none|n\/?a|no|nothing)$/i.test(site)) {
    tasks.push({
      title: `Baseline /site-audit BEFORE touching ${site}`,
      body: `Capture the as-found scorecard first: it is the "before" in every case study and re-grade. Existing site: ${site}. Host: ${str(a.who_hosts_your_current_site) || "unknown"}.`,
      dueDate: at(now, 3),
    });
  }

  // 3. Domain access -- when the fence says it is unknown or unregistered.
  const dom = flagText("Domain access is unknown").concat(flagText("UNREGISTERED"), flagText("available to register"));
  if (dom.length) {
    tasks.push({
      title: `Resolve domain access: ${str(a.what_web_address_do_you_want) || "domain"}`,
      body: dom.map((f) => `${f.flag}: ${f.why}`).join("\n") + `\nRegistered at (their answer): ${str(a.where_is_it_registered) || "unknown"}. Do this BEFORE promising a go-live date.`,
      dueDate: at(now, 3),
    });
  }

  // 4. Email on the domain -- measured OR claimed. Repointing DNS on a guess takes
  //    their business email down.
  const mail = flagText("Live email");
  if (mail.length) {
    tasks.push({
      title: `Map MX/SPF/DKIM before any DNS change: ${str(a.what_web_address_do_you_want) || "domain"}`,
      body: mail.map((f) => `${f.flag}: ${f.why}`).join("\n"),
      dueDate: at(now, 3),
    });
  }

  // 5. Hard deadline -- when they gave one. The date is free text, so the task is a
  //    prompt to put a real date against the content answer, not a parsed deadline.
  const deadline = str(a.does_this_need_to_be_live_by_a_certain_date);
  if (deadline) {
    tasks.push({
      title: `Deadline check for ${name}: "${deadline.slice(0, 60)}"`,
      body: `They need it live by: ${deadline}. Set that against the content answer ("${timing || "none"}") and one edit round, then tell them whether it is real.`,
      dueDate: at(now, 2),
    });
  }

  return tasks;
}

/* ------------------------------------------------------------- selftest -- */
if (process.argv[1] && /brief-tasks\.mjs$/.test(process.argv[1]) && process.argv.includes("--selftest")) {
  const now = new Date("2026-09-03T12:00:00Z");
  let bad = 0;
  const T = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) bad++; };
  const titles = (a, f = []) => planTasks(a, f, now).map((t) => t.title);
  const one = (a, f, needle) => planTasks(a, f, now).find((t) => t.title.includes(needle));

  const clean = { business_name_for_the_website: "Acme Fencing", when_can_we_have_your_content: "Within a week" };
  T("content task always, dated from the answer", one(clean, [], "Content due").dueDate === "2026-09-10T12:00:00.000Z");
  T("'ready now' -> 2 days", one({ ...clean, when_can_we_have_your_content: "I have it ready now" }, [], "Content due").dueDate === "2026-09-05T12:00:00.000Z");
  T("'not sure' -> asks for a date at 14d", one({ ...clean, when_can_we_have_your_content: "Not sure yet" }, [], "Get a content date").dueDate === "2026-09-17T12:00:00.000Z");
  T("unknown timing -> no content task", !titles({ ...clean, when_can_we_have_your_content: "" }).some((t) => t.includes("ontent")));
  T("clean brief -> exactly one task", titles(clean).length === 1);

  T("existing site -> baseline audit", titles({ ...clean, current_website_url: "https://acmefencing.example.com" }).some((t) => t.startsWith("Baseline /site-audit")));
  T("'none' as site -> no audit task", !titles({ ...clean, current_website_url: "none" }).some((t) => t.startsWith("Baseline")));

  const domFlag = [{ flag: "Domain access is unknown", why: "w" }];
  T("domain-access flag -> task", titles({ ...clean, what_web_address_do_you_want: "acme.example" }, domFlag).some((t) => t.startsWith("Resolve domain access: acme.example")));
  T("unregistered flag -> same task", titles(clean, [{ flag: "x.example appears UNREGISTERED but they say they own it", why: "w" }]).some((t) => t.startsWith("Resolve domain access")));
  T("no domain flag -> no task", !titles(clean).some((t) => t.startsWith("Resolve domain")));

  const mailFlag = [{ flag: "Live email MEASURED on acme.example: Google Workspace", why: "w" }];
  T("measured email -> MX task", titles(clean, mailFlag).some((t) => t.startsWith("Map MX/SPF/DKIM")));
  T("claimed email flag -> MX task too", titles(clean, [{ flag: "Live email may be on the domain", why: "w" }]).some((t) => t.startsWith("Map MX")));
  T("MX task body carries the why", one(clean, mailFlag, "Map MX").body.includes("Google Workspace"));

  T("deadline -> check task at 2d", one({ ...clean, does_this_need_to_be_live_by_a_certain_date: "Before hunting season" }, [], "Deadline check").dueDate === "2026-09-05T12:00:00.000Z");
  T("no deadline -> no task", !titles(clean).some((t) => t.startsWith("Deadline")));

  const loaded = planTasks({ ...clean, current_website_url: "https://a.example", does_this_need_to_be_live_by_a_certain_date: "Oct 1" }, domFlag.concat(mailFlag), now);
  T("fully loaded brief -> 5 tasks, no more", loaded.length === 5);
  T("every task has title/body/dueDate", loaded.every((t) => t.title && t.body && /^\d{4}-\d{2}-\d{2}T/.test(t.dueDate)));
  T("empty answers -> zero tasks, no throw", planTasks({}, [], now).length === 0);

  console.log(bad === 0 ? "\nselftest: 18/18 controls behave (positive + negative)." : `\nselftest: ${bad} CONTROL(S) BROKEN`);
  process.exitCode = bad === 0 ? 0 : 1;
}
