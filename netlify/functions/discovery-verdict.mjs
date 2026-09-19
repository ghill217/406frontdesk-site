/**
 * discovery-verdict.mjs — turn a set of Front Desk Discovery answers into an honest
 * fit verdict, the readable answer card, and the values for the shared GHL fields.
 *
 * Pure functions, no network, selftested. The handler in discovery.js stays thin.
 *
 *   node netlify/functions/discovery-verdict.mjs --selftest
 *
 * THE RULES THIS FILE IS HELD TO (they come from the vault, not from taste):
 *  - Every sentence shown to a prospect must be literally true of what 406 delivers.
 *  - No pricing, anywhere.
 *  - No number that is not theirs. The leak math runs only on inputs they typed, uses
 *    the same formula as /roi/ (missed x close rate x customer value) so the two can
 *    never disagree, and is skipped entirely when any input is missing or "not sure".
 *  - The assistant never quotes a custom price. Say so.
 *  - Texting a list that never opted in is not something 406 does. Say so.
 *  - Out-of-lane work (inventory, books, payroll, hiring) is named plainly as not mine.
 *    A "not a fit" verdict is a feature: the form exists to help someone find out
 *    whether I can help them OR NOT.
 *  - A verdict built on a half-filled form says which parts it could not assess.
 */

const has = (v, opt) => (Array.isArray(v) ? v.includes(opt) : v === opt);
const any = (v, opts) => opts.some((o) => has(v, o));
const filled = (v) => (Array.isArray(v) ? v.length > 0 : String(v ?? "").trim() !== "");

const CLINIC = "We're a clinic or handle health information";
const ECOM = "We sell products online";

/** Time-audit picks that are squarely the front desk's work. */
const MINE = new Set([
  "Answering the phone", "Returning calls and voicemails", "Texts, DMs and emails",
  "Quotes and estimates", "Scheduling and rescheduling", "Chasing past customers", "Asking for reviews",
]);
/** Picks that are an add-on conversation rather than the core. */
const TALK = new Set(["Social media and marketing"]);
/** Picks that are not mine, with where they do belong. */
const NOT_MINE = {
  "Ordering, inventory and shipping":
    "Inventory, ordering and freight aren't my lane. Your store or point-of-sale system's own stock tools, or a dedicated inventory app, is the right home for that.",
  "Payroll, books and taxes":
    "Payroll, bookkeeping and taxes belong with a payroll service and a bookkeeper or CPA. I don't touch them.",
  "Hiring and managing staff":
    "Hiring and managing people stays with you. Nothing I build replaces that.",
};

/**
 * The pains that ARE the front desk. Fit is judged on whether one of these is present,
 * never on how many boxes got ticked: an owner whose only problem is unanswered calls is
 * the strongest fit there is, and the first version of this rule called them "partial"
 * because it counted items. Reviews, reminders and price questions alone are real work
 * I do, but on their own they are a partial fit.
 */
const CORE = new Set([
  "Calls nobody can get to", "Nights and weekends", "Texts, DMs and website messages",
  "Quote requests", "Booking without the phone tag", "Past customers you never get back to",
]);

const WEEKS_PER_MONTH = 4; // deliberately the low, round figure
const MISSED = { "1–5": [1, 5], "6–15": [6, 15], "15+": [15, null] };
const CLOSE = { "About 1 in 10": 0.1, "About 1 in 4": 0.25, "About half": 0.5, "Most of them": 0.75 };

/** Their numbers only. Returns null unless all three inputs are really there. */
export function leakMath(a) {
  const range = MISSED[a.unanswered];
  const rate = CLOSE[a.close_rate];
  const worth = Number(String(a.worth ?? "").replace(/[^0-9.]/g, ""));
  if (!range || !rate || !Number.isFinite(worth) || worth <= 0) return null;
  const month = (n) => Math.round(n * WEEKS_PER_MONTH * rate * worth);
  return {
    low: month(range[0]),
    high: range[1] == null ? null : month(range[1]),
    basis: `${a.unanswered} unanswered a week, ${a.close_rate.toLowerCase()} becoming customers, $${worth.toLocaleString("en-US")} a customer. Your numbers, not mine.`,
  };
}

export function verdict(a = {}) {
  const ours = [], talk = [], notMine = [], unassessed = [];
  const add = (list, title, body) => { if (!list.some((x) => x.title === title)) list.push({ title, body }); };
  const clinic = has(a.applies, CLINIC);
  const picks = Array.isArray(a.time_sucks) ? a.time_sucks : [];

  /* ---- calls that nobody answers ---------------------------------------- */
  const missedCalls =
    any(a.who_answers, ["Voicemail", "Nobody"]) ||
    any(a.unanswered, ["1–5", "6–15", "15+"]) ||
    any(a.busy_calls, ["It goes to voicemail", "They usually don't leave a message", "They call someone else"]) ||
    any(picks, ["Answering the phone", "Returning calls and voicemails"]) ||
    a.interrupts === "The phone";
  if (missedCalls) {
    add(ours, "Calls nobody can get to",
      "Every missed call gets a text back right away, so the caller hears from you instead of dialing the next name on the list. If you want it, an AI receptionist can answer the phone itself, take the details, and hand you a clean message.");
  }

  /* ---- after hours ------------------------------------------------------- */
  if (any(a.after_hours, ["Voicemail", "Nothing until we reopen", "It rings my cell"])) {
    add(ours, "Nights and weekends",
      "Texts and website chat get answered around the clock, and phone calls too if you add the voice receptionist. Anything that really needs you still reaches you, and the rest waits in one tidy list for the morning.");
  }

  /* ---- messages and DMs -------------------------------------------------- */
  if (any(picks, ["Texts, DMs and emails"]) || a.interrupts === "Texts and DMs" ||
      any(a.first_contact, ["Facebook or Instagram message", "Text", "Website form or chat"])) {
    add(ours, "Texts, DMs and website messages",
      "One assistant covers text, Facebook and Instagram messages and website chat. It answers the routine questions, collects what you need to know, and passes along the ones that need a person.");
  }

  /* ---- quoting ------------------------------------------------------------ */
  if (any(a.pricing, ["Every job is custom", "A mix"]) || has(a.applies, "We quote custom jobs") || has(picks, "Quotes and estimates")) {
    add(ours, "Quote requests",
      "It collects what you need to price a job (what, where, when, photos if they have them) so the first time you touch a lead it's ready to quote. It never quotes a custom price for you. You confirm every number.");
  } else if (any(a.pricing, ["Set price list", "\"Starting at\" prices"])) {
    add(ours, "Pricing questions",
      "It can give out the prices you've already set, as \"starting at\" figures, and hands anything unusual to you. It never invents a price.");
  }

  /* ---- booking ------------------------------------------------------------ */
  if (a.booking === "Back-and-forth texting or calls" || has(picks, "Scheduling and rescheduling")) {
    add(ours, "Booking without the phone tag",
      "Customers pick a time from your real availability and get a confirmation. Reschedules work the same way.");
  } else if (a.booking === "I book it myself") {
    add(talk, "Your calendar, your call",
      "Some owners keep the schedule in their own hands on purpose, and that's fine. It can book for you, or it can just collect requests and leave the calendar alone. Worth two minutes of conversation.");
  } else if (a.booking === "An online booking app") {
    add(talk, "Your existing booking app",
      "You already have online booking, so I wouldn't replace it for the sake of it. Whether my side can work alongside it depends on the app, and I'd check yours specifically before promising anything.");
  }

  /* ---- no-shows ----------------------------------------------------------- */
  if (any(a.noshows, ["Every week", "It's a real problem", "A few a month"])) {
    add(ours, "No-shows and late cancellations",
      "Automatic reminders before the appointment, and an easy way to reschedule instead of just not turning up.");
  }

  /* ---- past customers ----------------------------------------------------- */
  const wantsRevive = any(a.dormant, ["Yes, a lot", "Some"]) || has(picks, "Chasing past customers");
  if (wantsRevive) {
    const onPaper = Array.isArray(a.list_has) && a.list_has.length > 0 &&
      a.list_has.every((x) => x === "It's in my head or on paper" || x === "Mailing addresses");
    const noConsent = any(a.opted_in, ["No", "Not sure"]);
    if (onPaper) {
      add(talk, "Your past customers",
        "Follow-up is squarely what I do, but it runs on a list, and yours isn't in a system yet. The first job would be getting it into one. Worth a conversation about how much of it is recoverable.");
    } else if (noConsent) {
      add(talk, "Your past customers",
        "Follow-up with past customers is squarely what I do, with one honest limit: people have to agree to get texts before I'll send them any. If your list never opted in, we'd start with email and a fresh opt-in, and I'd walk you through exactly what's allowed before anything goes out.");
    } else {
      add(ours, "Past customers you never get back to",
        "Check-ins, \"it's been a while\" reminders and seasonal nudges go out on a schedule, to the people who agreed to hear from you, without you remembering to send them.");
    }
  }

  /* ---- reviews ------------------------------------------------------------ */
  if (any(a.reviews, ["We don't", "When I remember"]) || has(picks, "Asking for reviews")) {
    add(ours, "Reviews",
      "Every finished job gets one polite ask for a Google review, automatically. Everyone gets asked, never just the happy ones.");
  }

  /* ---- things that need a conversation ------------------------------------- */
  if (picks.some((p) => TALK.has(p))) {
    add(talk, "Social media and marketing",
      "Planning and queueing your posts is something I offer as an add-on, not part of the core front desk. It works best as a weekly approval pass: I queue, you glance and approve.");
  }
  if (has(a.applies, ECOM)) {
    add(talk, "Your online store",
      "The assistant can take the repeat questions off you (fitment, shipping times, your return policy). It does not replace your store, and it can't see inside an individual order. Order lookups and fulfillment stay where they are.");
  }
  if (clinic) {
    add(talk, "Anything that touches patient information",
      "Healthcare is work I do, under a HIPAA setup with a signed agreement, and it's a conversation rather than a checkbox. Until that's in place, nothing about a patient goes through my systems.");
  }
  if (filled(a.tools) && !talk.some((x) => x.title === "Your existing booking app")) {
    add(talk, "The tools you already use",
      "Whether my side connects to what you already run depends on the tool. I'd look at yours specifically and tell you straight, rather than promise an integration from a checkbox.");
  }

  /* ---- not mine ------------------------------------------------------------ */
  for (const p of picks) if (NOT_MINE[p]) add(notMine, p, NOT_MINE[p]);

  /* ---- what a half-filled form could not tell me --------------------------- */
  if (!filled(a.time_sucks)) unassessed.push("where your week goes");
  if (!filled(a.who_answers) && !filled(a.busy_calls) && !filled(a.unanswered)) unassessed.push("calls and messages");
  if (!filled(a.pricing) && !filled(a.booking)) unassessed.push("quotes and booking");
  if (!filled(a.dormant) && !filled(a.reviews)) unassessed.push("past customers and reviews");

  /* ---- the headline --------------------------------------------------------- */
  const minePicks = picks.filter((p) => MINE.has(p)).length;
  const otherPicks = picks.filter((p) => NOT_MINE[p]).length;
  let level, title, body;
  if (ours.length === 0 && unassessed.length >= 3) {
    level = "unknown";
    title = "Not enough yet to call it";
    body = "You sent the headline, which is the part that matters most, and I'll read it myself. I can't honestly tell you whether I'm a fit from one answer. Come back to this link whenever you get a minute (it remembers where you were), or just reply to my email and tell me about your week.";
  } else if (ours.length === 0) {
    level = "not";
    title = "Honestly, I don't think I'm your fix";
    body = "From what you've told me, the things eating your time aren't the things I build. I'd rather say that now than sell you something that doesn't touch your actual problem. If the phone, the inbox or follow-up ever becomes the bottleneck, that's when to call me.";
  } else if (!ours.some((x) => CORE.has(x.title)) || (otherPicks >= 2 && otherPicks > minePicks)) {
    level = "partial";
    title = "A partial fit. Here's the honest split";
    body = "Some of what's on your plate is exactly what I take off people's plates, and some of it isn't my lane at all. Both lists are below, so you can judge whether the part I can help with is worth a conversation.";
  } else {
    level = "strong";
    title = "This looks like a strong fit";
    body = "Most of what you described is the work I take off owners' plates every day. Here's specifically what I'd take, what we'd want to talk through first, and what stays yours.";
  }
  if (notMine.length && level !== "not") {
    body += " One thing I'll say plainly: I can't do the out-of-lane items for you, but I can give you back the hours the phone and the inbox are taking, so there's time for them.";
  }

  return { level, title, body, ours, talk, notMine, unassessed, leak: leakMath(a) };
}

/** Plain text for the GHL field and the alert email. No markdown, no HTML. */
export function verdictText(v) {
  const lines = [`FIT: ${v.level.toUpperCase()} :: ${v.title}`];
  const block = (label, list) => { if (list.length) { lines.push("", `${label}:`); list.forEach((x) => lines.push(`- ${x.title}`)); } };
  block("WOULD TAKE", v.ours);
  block("TALK THROUGH FIRST", v.talk);
  block("NOT MINE (said so on screen)", v.notMine);
  if (v.unassessed.length) lines.push("", `COULD NOT ASSESS (skipped): ${v.unassessed.join("; ")}`);
  if (v.leak) {
    const money = (n) => "$" + n.toLocaleString("en-US");
    lines.push("", `LEAK MATH (their inputs): ${v.leak.high == null ? "at least " + money(v.leak.low) : money(v.leak.low) + " to " + money(v.leak.high)} a month. ${v.leak.basis}`);
  } else {
    lines.push("", "LEAK MATH: not run (an input was missing or 'not sure'). Run their real numbers at the sit-down.");
  }
  return lines.join("\n");
}

const flat = (v) => (Array.isArray(v) ? v.join("; ") : String(v ?? "").trim());

/** One question's answer as a single readable string: the taps, then their own words. */
export function composeAnswer(q, a) {
  const tapped = flat(a[q.id]);
  const own = q.own ? String(a[`${q.id}__own`] ?? "").trim() : "";
  if (tapped && own) return `${tapped}. In their words: ${own}`;
  return tapped || own;
}

/** The full Q-and-A card, in form order, skipping what they skipped. */
export function cardText(bank, a) {
  const out = [];
  for (const step of bank.steps) {
    const rows = [];
    for (const q of step.questions) {
      if (q.kind === "note" || ["full_name", "email"].includes(q.id)) continue;
      const v = composeAnswer(q, a);
      if (v) rows.push(`Q: ${q.label}\nA: ${v}`);
    }
    if (rows.length) out.push(`== ${step.n}. ${step.title} ==`, ...rows, "");
  }
  return out.join("\n").trim();
}

/**
 * Values for the SHARED Problem Discovery fields, keyed by GHL field key.
 * The past-customers field carries the whole list picture, not just the yes/no,
 * because that is what decides whether re-engagement is even possible.
 */
export function sharedFieldValues(bank, a) {
  const out = {};
  for (const step of bank.steps) {
    for (const q of step.questions) {
      if (!q.ghl) continue;
      let v = q.exact ? flat(a[q.id]) : composeAnswer(q, a);
      if (q.id === "dormant" && v) {
        const extra = [
          ["How many", a.list_size], ["Has", a.list_has], ["Lives in", a.list_lives], ["Opted in", a.opted_in],
        ].filter(([, x]) => filled(x)).map(([k, x]) => `${k}: ${flat(x)}`);
        if (extra.length) v += `. ${extra.join(". ")}`;
      }
      if (!v) continue;
      if (q.exact && !q.options.includes(v)) continue; // never send a picklist a value it does not have
      for (const key of [].concat(q.ghl)) out[key] = v;
    }
  }
  return out;
}

/* ------------------------------------------------------------- selftest -- */
if (process.argv[1] && /discovery-verdict\.mjs$/.test(process.argv[1]) && process.argv.includes("--selftest")) {
  let bad = 0, n = 0;
  const check = (name, ok) => { n++; if (!ok) bad++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`); };
  const titles = (list) => list.map((x) => x.title);
  // If a title in CORE is ever reworded in the rules above, CORE silently stops matching
  // and every verdict degrades to "partial". This proves each CORE title is still live.
  const everyTitle = () => new Set([
    { who_answers: "Voicemail", after_hours: ["Voicemail"], first_contact: ["Text"], pricing: "Every job is custom", booking: "Back-and-forth texting or calls", dormant: "Some", list_has: ["Emails"], opted_in: "Yes, they opted in" },
  ].flatMap((x) => verdict(x).ours.map((o) => o.title)));

  // The overloaded back office: phone pain plus out-of-lane picks.
  const backOffice = {
    applies: ["We quote custom jobs", ECOM], time_sucks: ["Texts, DMs and emails", "Ordering, inventory and shipping", "Payroll, books and taxes"],
    who_answers: "Me", busy_calls: ["It goes to voicemail"], unanswered: "6–15", after_hours: ["Voicemail"],
    pricing: "Every job is custom", dormant: "Yes, a lot", list_has: ["Emails", "Phone numbers"], opted_in: "Not sure", reviews: "We don't",
  };
  const v1 = verdict(backOffice);
  check("back office: inventory is named as not mine", titles(v1.notMine).includes("Ordering, inventory and shipping"));
  check("back office: payroll is named as not mine", titles(v1.notMine).includes("Payroll, books and taxes"));
  check("back office: inventory never appears under what I'd take", !titles(v1.ours).some((t) => /inventory|payroll/i.test(t)));
  check("back office: missed calls are taken", titles(v1.ours).includes("Calls nobody can get to"));
  check("back office: custom pricing says it never quotes", v1.ours.find((x) => x.title === "Quote requests").body.includes("never quotes"));
  check("back office: a list with unknown consent is a CONVERSATION, not a promise", titles(v1.talk).includes("Your past customers") && !titles(v1.ours).includes("Past customers you never get back to"));
  check("back office: the store caveat is stated", titles(v1.talk).includes("Your online store"));
  check("back office: reads as a fit, with the out-of-lane reframe", ["strong", "partial"].includes(v1.level) && v1.body.includes("out-of-lane"));

  // Nothing I build touches this person's problem.
  const notFit = { time_sucks: ["Payroll, books and taxes", "Hiring and managing staff"], who_answers: "Staff", unanswered: "Not sure",
    after_hours: ["We're open then"], booking: "Staff handles it", noshows: "Rare", dormant: "Not really", reviews: "It's already automated", pricing: "" };
  const v2 = verdict(notFit);
  check("not a fit: says so", v2.level === "not");
  check("not a fit: takes nothing", v2.ours.length === 0);
  check("not a fit: still names where the work belongs", v2.notMine.length === 2);

  // Opted-in list IS a promise.
  const v3 = verdict({ dormant: "Some", list_has: ["Phone numbers"], opted_in: "Yes, they opted in" });
  check("opted-in list: re-engagement is taken", titles(v3.ours).includes("Past customers you never get back to"));
  const v3b = verdict({ dormant: "Some", list_has: ["It's in my head or on paper"], opted_in: "Yes, they opted in" });
  check("paper list: a conversation even when consent is claimed", titles(v3b.talk).includes("Your past customers") && v3b.ours.length === 0);

  // Clinic: the PHI line is always drawn.
  const v4 = verdict({ applies: [CLINIC], who_answers: "Voicemail" });
  check("clinic: HIPAA is a conversation", titles(v4.talk).includes("Anything that touches patient information"));

  // Headline-only early exit must not be called 'not a fit'.
  const v5 = verdict({ headline: "the phone" });
  check("headline only: verdict is 'unknown', never 'not'", v5.level === "unknown" && v5.unassessed.length === 4);

  // Fit is about the KIND of pain, not the count of ticked boxes.
  check("one core pain alone is a STRONG fit", verdict({ who_answers: "Voicemail" }).level === "strong");
  check("peripheral work alone is a PARTIAL fit", verdict({ reviews: "We don't", noshows: "Every week" }).level === "partial");
  check("core pain, but out-of-lane picks dominate: PARTIAL", verdict({ who_answers: "Voicemail", time_sucks: ["Texts, DMs and emails", "Ordering, inventory and shipping", "Payroll, books and taxes"] }).level === "partial");
  check("every CORE title is one the engine can actually emit", [...CORE].every((t) => everyTitle().has(t)));

  // Set prices take the pricing line, not the quoting line.
  const v6 = verdict({ pricing: "Set price list" });
  check("set prices: pricing questions, not quote requests", titles(v6.ours).includes("Pricing questions") && !titles(v6.ours).includes("Quote requests"));

  // Leak math: theirs or nothing.
  check("leak: runs on three real inputs", JSON.stringify(leakMath({ unanswered: "6–15", close_rate: "About 1 in 4", worth: "400" })) ===
    JSON.stringify({ low: 2400, high: 6000, basis: "6–15 unanswered a week, about 1 in 4 becoming customers, $400 a customer. Your numbers, not mine." }));
  check("leak: 15+ has no invented ceiling", leakMath({ unanswered: "15+", close_rate: "About half", worth: 100 }).high === null);
  check("leak: 'Not sure' on missed calls skips it", leakMath({ unanswered: "Not sure", close_rate: "About half", worth: 100 }) === null);
  check("leak: 'Not sure' on close rate skips it", leakMath({ unanswered: "1–5", close_rate: "Not sure", worth: 100 }) === null);
  check("leak: no customer value skips it", leakMath({ unanswered: "1–5", close_rate: "About half", worth: "" }) === null);
  check("leak: junk in the value box skips it", leakMath({ unanswered: "1–5", close_rate: "About half", worth: "lots" }) === null);
  check("leak: a formatted figure is read", leakMath({ unanswered: "1–5", close_rate: "About half", worth: "$1,200" }).low === 2400);

  // Text + field composition.
  const bank = { steps: [{ n: 1, title: "T", questions: [
    { id: "role", kind: "chips", label: "Your role", options: ["Owner", "Manager", "Other"], ghl: "your_role", exact: true },
    { id: "busy_calls", kind: "multi", label: "Busy?", own: true, ghl: "busy_key" },
    { id: "after_hours", kind: "multi", label: "After?", ghl: ["k1", "k2"] },
    { id: "dormant", kind: "chips", label: "Dormant?", ghl: "past" },
    { id: "note1", kind: "note", text: "x" },
  ] }] };
  const ans = { role: "Owner", busy_calls: ["It goes to voicemail"], busy_calls__own: "and they never call back", after_hours: ["Voicemail"], dormant: "Some", list_size: "100 to 500", opted_in: "No" };
  const sf = sharedFieldValues(bank, ans);
  check("fields: taps and own words are both kept", sf.busy_key === "It goes to voicemail. In their words: and they never call back");
  check("fields: one answer can feed two shared fields", sf.k1 === "Voicemail" && sf.k2 === "Voicemail");
  check("fields: the past-customer field carries the list picture", sf.past === "Some. How many: 100 to 500. Opted in: No");
  check("fields: a picklist never receives a value it lacks", !("your_role" in sharedFieldValues(bank, { role: "Janitor" })));
  check("fields: a valid picklist value passes through exactly", sf.your_role === "Owner");
  check("fields: skipped questions write nothing", Object.keys(sharedFieldValues(bank, {})).length === 0);
  check("card: skips notes and blanks, keeps order", cardText(bank, ans).startsWith("== 1. T ==\nQ: Your role\nA: Owner"));
  const vt = verdictText(v1);
  check("text: no pricing or dollar figure without leak inputs", !/\$\d/.test(vt) && vt.includes("LEAK MATH: not run"));
  check("text: level leads", vt.startsWith("FIT: "));

  // Copy rules across EVERY sentence the engine can emit.
  const everything = [backOffice, notFit, { applies: [CLINIC, ECOM], time_sucks: ["Social media and marketing"], booking: "An online booking app", tools: ["A CRM"], pricing: "Set price list", noshows: "Every week", after_hours: ["Voicemail"], first_contact: ["Text"] },
    { booking: "I book it myself" }, { headline: "x" }].map(verdict)
    .flatMap((v) => [v.title, v.body, ...v.ours, ...v.talk, ...v.notMine].map((x) => (typeof x === "string" ? x : x.title + " " + x.body))).join(" ");
  check("copy: no price, no percentage, no invented figure anywhere", !/\$|\d+\s?%|\bper month\b|\/mo\b/i.test(everything));
  check("copy: American spelling", !/\b(colour|organis|behaviour|licence|centre|favour|cancell?ation policy's)\b/i.test(everything));
  check("copy: first person singular, never 'we at'", !/\bwe at\b|\bour team\b/i.test(everything));

  console.log(bad === 0 ? `\nselftest: ${n}/${n} controls behave (positive + negative).` : `\nselftest: ${bad} CONTROL(S) BROKEN`);
  process.exitCode = bad === 0 ? 0 : 1;
}
