/* Website Build Brief — step navigation, autosave, and submit.
 *
 * Two rules drive most of the decisions here:
 *
 * 1. NEVER LOSE THEIR ANSWERS. A 56-field brief is 10-15 minutes of someone's evening.
 *    Everything is written to localStorage on every change, and the saved copy is only
 *    cleared after the server has confirmed a 200. A failed submit leaves the form
 *    exactly as it was, with a message that says so.
 *
 * 2. NEVER CLAIM A SUBMIT THAT DIDN'T HAPPEN. The old GHL form guaranteed delivery;
 *    owning the form means owning that. Anything other than a confirmed success is
 *    reported as a failure with a way to reach a human.
 */
(function () {
  "use strict";

  var form = document.getElementById("bbForm");
  if (!form) return;

  var STORE = "406-build-brief-v1";
  var MAX_LOGO = 4 * 1024 * 1024; // Netlify functions cap the request at 6 MB; base64 inflates ~33%
  var steps = Array.prototype.slice.call(form.querySelectorAll(".bb-step"));
  var rail = document.getElementById("bbRail");
  var savedFlag = document.getElementById("bbSaved");
  var done = document.getElementById("bbDone");
  var current = 1;

  /* ---------- persistence ------------------------------------------------ */

  function collect() {
    var out = {};
    steps.forEach(function (step) {
      step.querySelectorAll("input, textarea, select").forEach(function (el) {
        if (!el.name || el.type === "file" || el.name === "website_hp") return;
        if (el.type === "checkbox") {
          if (!out[el.name]) out[el.name] = [];
          if (el.checked) out[el.name].push(el.value);
        } else if (el.type === "radio") {
          if (el.checked) out[el.name] = el.value;
        } else {
          out[el.name] = el.value;
        }
      });
    });
    return out;
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ step: current, answers: collect() }));
      if (savedFlag) {
        savedFlag.hidden = false;
        clearTimeout(save._t);
        save._t = setTimeout(function () { savedFlag.hidden = true; }, 1600);
      }
    } catch (e) { /* private mode, quota — the form still works, it just won't resume */ }
  }

  function restore() {
    var raw;
    try { raw = localStorage.getItem(STORE); } catch (e) { return; }
    if (!raw) return;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    var a = data.answers || {};
    Object.keys(a).forEach(function (name) {
      var val = a[name];
      var els = form.querySelectorAll('[name="' + CSS.escape(name) + '"]');
      els.forEach(function (el) {
        if (el.type === "checkbox") el.checked = Array.isArray(val) && val.indexOf(el.value) > -1;
        else if (el.type === "radio") el.checked = el.value === val;
        else el.value = val;
      });
    });
    // rehydrate the direction picker from its hidden field
    var picked = document.getElementById("ddPicked");
    if (picked && picked.value) {
      picked.value.split(/,\s*/).forEach(function (chunk) {
        var code = (chunk.match(/D-\d+/) || [])[0];
        if (!code) return;
        var btn = form.querySelector('.bb-swatch[data-code="' + code + '"]');
        if (btn) btn.setAttribute("aria-pressed", "true");
      });
    }
    if (data.step) go(Math.min(data.step, steps.length), true);
  }

  /* ---------- navigation ------------------------------------------------- */

  function go(n, silent) {
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
    save();
  }

  /** Validates only the visible step. Returns true if it may advance. */
  function validate(step) {
    var ok = true;
    var firstBad = null;
    step.querySelectorAll(".bb-field").forEach(function (field) {
      var err = field.querySelector(".bb-error");
      var inputs = field.querySelectorAll("[required]");
      if (!inputs.length) return;
      var good;
      var first = inputs[0];
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
    if (next) {
      var step = next.closest(".bb-step");
      if (validate(step)) go(current + 1);
    } else if (back) {
      go(current - 1);
    }
  });

  if (rail) {
    rail.addEventListener("click", function (e) {
      var li = e.target.closest(".bb-rail__step");
      if (!li) return;
      var target = +li.dataset.step;
      // Jumping BACK is always fine; jumping forward has to pass the steps in between.
      if (target < current) go(target);
    });
  }

  form.addEventListener("input", save);
  form.addEventListener("change", save);

  /* ---------- the direction picker --------------------------------------- */

  var picked = document.getElementById("ddPicked");
  form.querySelectorAll(".bb-swatch").forEach(function (btn) {
    btn.addEventListener("click", function () {
      btn.setAttribute("aria-pressed", btn.getAttribute("aria-pressed") === "true" ? "false" : "true");
      var on = Array.prototype.slice.call(form.querySelectorAll('.bb-swatch[aria-pressed="true"]'));
      if (picked) picked.value = on.map(function (b) { return b.dataset.code + " " + b.dataset.name; }).join(", ");
      save();
    });
  });

  /* ---------- submit ------------------------------------------------------ */

  function readLogo() {
    var input = form.querySelector('input[type="file"]');
    if (!input || !input.files || !input.files[0]) return Promise.resolve(null);
    var file = input.files[0];
    if (file.size > MAX_LOGO) {
      return Promise.reject(new Error(
        "That logo is " + Math.round(file.size / 1048576) + " MB, and the limit here is 4 MB. " +
        "Send your brief without it and email the file to admin@406frontdesk.com instead."));
    }
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error("That file could not be read. Try again, or email it over.")); };
      fr.onload = function () {
        resolve({ name: file.name, type: file.type, size: file.size, data: String(fr.result).split(",")[1] });
      };
      fr.readAsDataURL(file);
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var last = steps[steps.length - 1];
    if (!validate(last)) return;

    // Every earlier step must still pass — someone can reach step 8 and then go back
    // and blank a required answer.
    for (var i = 0; i < steps.length; i++) {
      if (!validate(steps[i])) {
        go(+steps[i].dataset.step);
        showError("Something needed on step " + steps[i].dataset.step + " is blank. It's highlighted below.");
        return;
      }
    }

    var btn = last.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Sending...";
    clearError();

    readLogo()
      .then(function (logo) {
        return fetch("/.netlify/functions/build-brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: collect(),
            logo: logo,
            website_hp: (form.querySelector('[name="website_hp"]') || {}).value || "",
          }),
        });
      })
      .then(function (res) {
        // A non-JSON body means something upstream answered instead of our function --
        // a 404 HTML page, a proxy error, an outage. The client must never be shown a
        // JSON parse error, so translate it into something a human can act on.
        return res.text().then(function (raw) {
          var body = null;
          try { body = JSON.parse(raw); } catch (e) { body = null; }
          if (!body) {
            throw new Error(res.status === 404
              ? "The form's submit endpoint could not be reached. Please email admin@406frontdesk.com."
              : "The server returned an unexpected response (" + res.status + "). Nothing was saved.");
          }
          return { ok: res.ok, body: body };
        });
      })
      .then(function (r) {
        if (!r.ok || !r.body || r.body.ok !== true) {
          throw new Error((r.body && r.body.error) || "The server did not confirm your brief was saved.");
        }
        // ONLY NOW is it safe to drop the local copy.
        try { localStorage.removeItem(STORE); } catch (e) {}
        form.hidden = true;
        if (rail) rail.hidden = true;
        var intro = document.querySelector(".bb-intro");
        if (intro) intro.hidden = true;
        done.hidden = false;
        done.scrollIntoView({ behavior: "smooth", block: "center" });
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Send my brief";
        showError(err.message || "Something went wrong sending your brief.");
      });
  });

  function showError(msg) {
    clearError();
    var box = document.createElement("div");
    box.className = "bb-submit-error";
    box.id = "bbSubmitError";
    box.setAttribute("role", "alert");
    box.innerHTML =
      "<strong>Your brief was not sent.</strong><p></p>" +
      "<p class=\"bb-submit-error__keep\">Nothing you typed has been lost — it is still saved on this device, " +
      "so you can try again. If it keeps failing, email <a href=\"mailto:admin@406frontdesk.com\">" +
      "admin@406frontdesk.com</a> and I'll sort it out.</p>";
    box.querySelector("p").textContent = msg;
    var last = steps[steps.length - 1];
    last.insertBefore(box, last.querySelector(".bb-nav"));
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearError() {
    var old = document.getElementById("bbSubmitError");
    if (old) old.remove();
  }

  restore();
})();
