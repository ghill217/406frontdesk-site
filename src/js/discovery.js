/* Front Desk Discovery — steps, autosave, carry-to-another-device, send, verdict.
 *
 * Forked from build-brief.js rather than shared with it: that file runs a live client
 * form, and a refactor there is a risk this page does not need to impose on it.
 *
 * The rules, in the order they bite:
 * 1. NEVER LOSE THEIR ANSWERS. Written to localStorage on every change. After a send
 *    from the LAST step the local copy is cleared; after an early "send what you have"
 *    it is kept, because the whole point of that button is that they may come back.
 * 2. NEVER CLAIM A SEND THAT DIDN'T HAPPEN, and never show a verdict for answers that
 *    were not stored: the verdict arrives on the same confirmed response.
 * 3. ONLY STEP 1 IS REQUIRED. Everything else may be skipped.
 * 4. THE VERDICT IS RENDERED, NOT DECIDED, HERE. The rules live server-side in one
 *    selftested module. Server strings go in with textContent, never innerHTML.
 */
(function () {
  "use strict";

  var form = document.getElementById("dvForm");
  if (!form) return;

  var STORE = "406-discovery-v1";
  var ENDPOINT = "/.netlify/functions/discovery";
  var steps = Array.prototype.slice.call(form.querySelectorAll(".bb-step"));
  var rail = document.getElementById("bbRail");
  var savedFlag = document.getElementById("bbSaved");
  var resumeBox = document.getElementById("dvResume");
  var verdictBox = document.getElementById("dvVerdict");
  var carryBtn = document.getElementById("dvCarryBtn");
  var carryOut = document.getElementById("dvCarryOut");
  var current = 1;
  var draftKey = "";
  var syncTimer = null;

  /* ---------- persistence ------------------------------------------------ */

  function collect() {
    var out = {};
    form.querySelectorAll("input, textarea").forEach(function (el) {
      if (!el.name || el.name === "website_hp") return;
      if (el.type === "checkbox") {
        if (!out[el.name]) out[el.name] = [];
        if (el.checked) out[el.name].push(el.value);
      } else if (el.type === "radio") {
        if (el.checked) out[el.name] = el.value;
      } else if (el.value.trim() !== "") {
        out[el.name] = el.value;
      }
    });
    return out;
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ step: current, answers: collect(), draftKey: draftKey }));
      if (savedFlag) {
        savedFlag.hidden = false;
        clearTimeout(save._t);
        save._t = setTimeout(function () { savedFlag.hidden = true; }, 1600);
      }
    } catch (e) { /* private mode, quota: the form still works, it just won't resume */ }
    // Once they have asked for a carry link, keep the server copy in step with this one,
    // or the other device opens a stale draft. Debounced; failures are silent because
    // the local copy is still the one that matters on THIS device.
    if (draftKey) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(function () { pushDraft().catch(function () {}); }, 4000);
    }
  }

  function apply(answers) {
    Object.keys(answers || {}).forEach(function (name) {
      var val = answers[name];
      form.querySelectorAll('[name="' + CSS.escape(name) + '"]').forEach(function (el) {
        if (el.type === "checkbox") el.checked = Array.isArray(val) && val.indexOf(el.value) > -1;
        else if (el.type === "radio") el.checked = el.value === val;
        else el.value = val;
        // An "own words" box with something in it must not come back folded shut.
        var d = el.closest("details");
        if (d && el.value) d.open = true;
      });
    });
    capped.forEach(syncCap);
    syncShowIf();
  }

  function restoreLocal() {
    var raw;
    try { raw = localStorage.getItem(STORE); } catch (e) { return false; }
    if (!raw) return false;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return false; }
    draftKey = data.draftKey || "";
    apply(data.answers);
    if (data.step) go(Math.min(data.step, steps.length), true);
    return Object.keys(data.answers || {}).length > 0;
  }

  function note(msg) {
    if (!resumeBox) return;
    resumeBox.textContent = msg;
    resumeBox.hidden = false;
  }

  /* ---------- navigation ------------------------------------------------- */

  function go(n, silent, nosave) {
    current = n;
    steps.forEach(function (s) { s.hidden = +s.dataset.step !== n; });
    if (rail) {
      rail.querySelectorAll(".bb-rail__step").forEach(function (li) {
        var i = +li.dataset.step;
        li.classList.toggle("is-current", i === n);
        li.classList.toggle("is-done", i < n);
      });
    }
    if (!silent) {
      var band = document.querySelector(".header-band");
      window.scrollTo({ top: band ? band.offsetHeight - 40 : 0, behavior: "smooth" });
    }
    if (!nosave) save();
  }

  /** Only step 1 carries required fields, but the check is generic. */
  function validate(step) {
    var ok = true, firstBad = null;
    step.querySelectorAll(".bb-field").forEach(function (field) {
      if (field.hidden) return;
      var err = field.querySelector(".bb-error");
      var inputs = field.querySelectorAll("[required]");
      if (!inputs.length) return;
      var first = inputs[0], good;
      if (first.type === "radio") {
        good = !!field.querySelector('input[type="radio"]:checked');
      } else {
        good = String(first.value || "").trim() !== "";
        if (good && first.type === "email") good = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(first.value.trim());
      }
      field.classList.toggle("is-bad", !good);
      if (err) err.hidden = good;
      if (!good) { ok = false; if (!firstBad) firstBad = field; }
    });
    if (firstBad) firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
    return ok;
  }

  form.addEventListener("click", function (e) {
    var next = e.target.closest("[data-next]");
    var back = e.target.closest("[data-back]");
    if (next) { if (validate(next.closest(".bb-step"))) go(current + 1); }
    else if (back) go(current - 1);
  });

  if (rail) {
    rail.addEventListener("click", function (e) {
      var li = e.target.closest(".bb-rail__step");
      if (!li) return;
      var target = +li.dataset.step;
      // Every step after the first is optional, so once step 1 passes they may jump anywhere.
      if (target === current) return;
      if (target < current || validate(steps[0])) go(target); else go(1);
    });
  }

  form.addEventListener("input", save);
  form.addEventListener("change", function () { syncShowIf(); save(); });

  /* ---------- a tapped chip can be un-tapped ------------------------------ */
  // A radio cannot normally be cleared, which turns a mis-tap on an OPTIONAL question
  // into an answer they did not mean to give.
  form.addEventListener("pointerdown", function (e) {
    var label = e.target.closest(".dv-chips .bb-option");
    if (!label) return;
    var input = label.querySelector('input[type="radio"]');
    if (input) input.dataset.was = input.checked ? "1" : "";
  });
  form.addEventListener("click", function (e) {
    var input = e.target.closest && e.target.closest('.dv-chips input[type="radio"]');
    if (!input || input.required) return;
    if (input.dataset.was === "1") {
      input.checked = false;
      input.dataset.was = "";
      syncShowIf();
      save();
    }
  });

  /* ---------- capped checkbox groups -------------------------------------- */

  function syncCap(group) {
    var max = +group.dataset.max;
    if (!max) return;
    var boxes = Array.prototype.slice.call(group.querySelectorAll('input[type="checkbox"]'));
    var n = boxes.filter(function (b) { return b.checked; }).length;
    boxes.forEach(function (b) {
      var lock = !b.checked && n >= max;
      b.disabled = lock;
      b.closest(".bb-option").classList.toggle("is-locked", lock);
    });
    var counter = group.parentNode.querySelector(".bb-count");
    if (counter) {
      counter.textContent = n + " of " + max + " picked" + (n >= max ? ". Untick one to change your mind" : "");
      counter.classList.toggle("is-full", n >= max);
    }
  }
  var capped = Array.prototype.slice.call(form.querySelectorAll(".bb-options[data-max]"));
  capped.forEach(function (group) {
    group.addEventListener("change", function () { syncCap(group); });
    syncCap(group);
  });

  /* ---------- conditional questions --------------------------------------- */

  function syncShowIf() {
    form.querySelectorAll("[data-show-q]").forEach(function (field) {
      var sel = '[name="' + CSS.escape(field.dataset.showQ) + '"]:checked';
      var on = Array.prototype.some.call(form.querySelectorAll(sel), function (el) { return el.value === field.dataset.showHas; });
      field.hidden = !on;
      // A hidden question must not send an answer given before it was hidden.
      if (!on) field.querySelectorAll("input, textarea").forEach(function (el) {
        if (el.type === "radio" || el.type === "checkbox") el.checked = false; else el.value = "";
      });
    });
  }

  /* ---------- carry on from another device -------------------------------- */

  function pushDraft() {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: true, answers: collect(), step: current, draftKey: draftKey,
        website_hp: (form.querySelector('[name="website_hp"]') || {}).value || "" }),
    }).then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
      .then(function (r) {
        if (!r.ok || !r.body || r.body.ok !== true || !r.body.draftKey) throw new Error((r.body && r.body.error) || "The link could not be created just now.");
        draftKey = r.body.draftKey;
        try { localStorage.setItem(STORE, JSON.stringify({ step: current, answers: collect(), draftKey: draftKey })); } catch (e) {}
        return draftKey;
      });
  }

  function showCarry(key) {
    var url = location.origin + "/discovery/?r=" + key;
    carryOut.textContent = "";
    var p = document.createElement("p");
    p.textContent = "Your answers so far are now stored under this private link. Open it on the other device and you'll be where you left off. It keeps updating as you go. Nobody is notified, and nothing counts as sent until you hit send.";
    var input = document.createElement("input");
    input.className = "bb-input"; input.readOnly = true; input.value = url;
    input.setAttribute("aria-label", "Your private link");
    input.addEventListener("focus", function () { input.select(); });
    var row = document.createElement("div"); row.className = "dv-carry__row";
    var copy = document.createElement("button");
    copy.type = "button"; copy.className = "bb-btn bb-btn--ghost"; copy.textContent = "Copy link";
    copy.addEventListener("click", function () {
      var done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy link"; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { input.select(); });
      else { input.select(); try { document.execCommand("copy"); done(); } catch (e) {} }
    });
    row.appendChild(copy);
    if (navigator.share) {
      var share = document.createElement("button");
      share.type = "button"; share.className = "bb-btn bb-btn--ghost"; share.textContent = "Send it to myself";
      share.addEventListener("click", function () { navigator.share({ title: "My Front Desk Discovery, in progress", url: url }).catch(function () {}); });
      row.appendChild(share);
    }
    carryOut.appendChild(p); carryOut.appendChild(input); carryOut.appendChild(row);
    carryOut.hidden = false;
  }

  if (carryBtn) {
    carryBtn.addEventListener("click", function () {
      if (draftKey) { showCarry(draftKey); return; }
      carryBtn.disabled = true; carryBtn.textContent = "Making your link...";
      pushDraft().then(function (key) { showCarry(key); })
        .catch(function (err) {
          carryOut.textContent = (err && err.message) || "The link could not be created just now. Your answers are still saved on this device.";
          carryOut.hidden = false;
        })
        .then(function () { carryBtn.disabled = false; carryBtn.textContent = "Finish on another device?"; });
    });
  }

  /** ?r=<key>: pull the carried draft, then take the key OUT of the address bar. */
  function restoreCarried() {
    var key = new URLSearchParams(location.search).get("r");
    if (!key) return Promise.resolve(false);
    history.replaceState(null, "", location.pathname);
    if (!/^[a-f0-9]{32}$/.test(key)) { note("That link doesn't look right, so I've started you on a fresh form."); return Promise.resolve(false); }
    return fetch(ENDPOINT + "?draft=" + key)
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
      .then(function (r) {
        if (!r.ok || !r.body || r.body.ok !== true) { note((r.body && r.body.error) || "That saved copy could not be opened."); return false; }
        draftKey = key;
        apply(r.body.answers);
        go(Math.min(r.body.step || 1, steps.length), true);
        note("Picked up where you left off. Everything you'd answered is back.");
        return true;
      })
      .catch(function () { note("That saved copy could not be reached just now. Anything saved on this device is still here."); return false; });
  }

  /* ---------- send --------------------------------------------------------- */

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.submitter || steps[steps.length - 1].querySelector("[data-send]");
    var fromLastStep = current === steps.length;

    if (!validate(steps[0])) {
      go(1);
      showError("Step 1 has something blank. It's highlighted below, and it's the only step that's required.");
      return;
    }

    var label = btn.textContent;
    btn.disabled = true; btn.textContent = "Sending...";
    clearError();

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: collect(), draftKey: draftKey,
        website_hp: (form.querySelector('[name="website_hp"]') || {}).value || "" }),
    })
      .then(function (res) {
        // A non-JSON body means something upstream answered instead of the function.
        return res.text().then(function (raw) {
          var body = null;
          try { body = JSON.parse(raw); } catch (err) { body = null; }
          if (!body) {
            throw new Error(res.status === 404
              ? "The form's send endpoint could not be reached. Please email admin@406frontdesk.com."
              : "The server returned an unexpected response (" + res.status + "). Nothing was sent.");
          }
          return { ok: res.ok, body: body };
        });
      })
      .then(function (r) {
        if (!r.ok || !r.body || r.body.ok !== true) throw new Error((r.body && r.body.error) || "The server did not confirm your answers were saved.");
        btn.disabled = false; btn.textContent = label;
        draftKey = ""; // the server deleted the carried draft on a confirmed send
        if (fromLastStep) { try { localStorage.removeItem(STORE); } catch (err) {} }
        else save();
        if (r.body.verdict) renderVerdict(r.body.verdict, r.body.firstName || "", !fromLastStep);
        else renderVerdict({ level: "unknown", title: "Got it, thank you.", body: "Your answers are in and I'll read them myself.", ours: [], talk: [], notMine: [], unassessed: [], leak: null }, "", !fromLastStep);
      })
      .catch(function (err) {
        btn.disabled = false; btn.textContent = label;
        showError(err.message || "Something went wrong sending your answers.");
      });
  });

  function showError(msg) {
    clearError();
    var box = document.createElement("div");
    box.className = "bb-submit-error"; box.id = "dvSubmitError"; box.setAttribute("role", "alert");
    var strong = document.createElement("strong"); strong.textContent = "Your answers were not sent.";
    var p = document.createElement("p"); p.textContent = msg;
    var keep = document.createElement("p"); keep.className = "bb-submit-error__keep";
    keep.textContent = "Nothing you entered has been lost. It is still saved on this device, so you can try again. If it keeps failing, email admin@406frontdesk.com and I'll sort it out.";
    box.appendChild(strong); box.appendChild(p); box.appendChild(keep);
    var step = steps[current - 1];
    step.insertBefore(box, step.querySelector(".bb-nav"));
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function clearError() { var old = document.getElementById("dvSubmitError"); if (old) old.remove(); }

  /* ---------- the verdict --------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

  function list(parent, cls, heading, items) {
    if (!items || !items.length) return;
    var sec = el("div", "dv-v__sec " + cls);
    sec.appendChild(el("h3", null, heading));
    items.forEach(function (it) {
      var row = el("div", "dv-v__item");
      row.appendChild(el("strong", null, it.title));
      row.appendChild(el("p", null, it.body));
      sec.appendChild(row);
    });
    parent.appendChild(sec);
  }

  function renderVerdict(v, firstName, early) {
    verdictBox.textContent = "";
    verdictBox.dataset.level = v.level;
    verdictBox.appendChild(el("p", "dv-v__eyebrow", firstName ? "Sent. Thanks, " + firstName + ". Here's my honest read" : "Sent. Here's my honest read"));
    verdictBox.appendChild(el("h2", null, v.title));
    verdictBox.appendChild(el("p", "dv-v__body", v.body));

    list(verdictBox, "is-ours", "What I'd take off your plate", v.ours);
    list(verdictBox, "is-talk", "Worth talking through first", v.talk);
    list(verdictBox, "is-not", "Not something I do", v.notMine);

    if (v.leak) {
      var leak = el("div", "dv-v__sec is-leak");
      leak.appendChild(el("h3", null, "What the unanswered calls may be worth"));
      leak.appendChild(el("p", "dv-v__figure", v.leak.high == null ? "At least " + money(v.leak.low) + " a month" : money(v.leak.low) + " to " + money(v.leak.high) + " a month"));
      leak.appendChild(el("p", null, "Worked out from " + v.leak.basis + " It's a rough range, not a promise, and we'd run it properly together."));
      verdictBox.appendChild(leak);
    }
    if (v.unassessed && v.unassessed.length) {
      verdictBox.appendChild(el("p", "dv-v__gap", "What I couldn't judge, because those parts were skipped: " + v.unassessed.join(", ") + ". That's fine. It just means this read is partial."));
    }

    var next = el("div", "dv-v__next");
    if (v.level === "not") {
      next.appendChild(el("p", null, "No hard feelings and no follow-up pitch. If things change, you know where I am."));
    } else {
      next.appendChild(el("p", null, "I read every one of these myself, and you'll hear from me at the email you gave. If you'd rather not wait, take twenty minutes with me: we run your real numbers, you talk to the system live, and you leave with a straight answer on whether it pays for itself."));
      var a = el("a", "bb-btn", "Pick a time");
      a.href = "/start/schedule/";
      next.appendChild(a);
    }
    var tools = el("div", "dv-v__tools");
    if (early) {
      var more = el("button", "bb-btn bb-btn--ghost", "Add more answers and re-send");
      more.type = "button";
      more.addEventListener("click", function () {
        verdictBox.hidden = true; form.hidden = false; if (rail) rail.hidden = false;
        go(Math.min(current + 1, steps.length));
      });
      tools.appendChild(more);
    }
    var print = el("button", "bb-btn bb-btn--ghost", "Print or save this");
    print.type = "button";
    print.addEventListener("click", function () { window.print(); });
    tools.appendChild(print);
    next.appendChild(tools);
    verdictBox.appendChild(next);

    form.hidden = true;
    if (rail) rail.hidden = true;
    var intro = document.getElementById("dvIntro"); if (intro) intro.hidden = true;
    if (resumeBox) resumeBox.hidden = true;
    verdictBox.hidden = false;
    verdictBox.focus({ preventScroll: true });
    verdictBox.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- boot ----------------------------------------------------------- */

  restoreCarried().then(function (carried) {
    if (carried) { save(); return; }
    if (restoreLocal()) note("Welcome back. Your answers were saved on this device, so you're right where you left off.");
    else go(1, true, true); // paint the rail without writing an empty record or flashing "saved"
  });
})();
