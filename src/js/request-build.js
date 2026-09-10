/* Request a Website Build — client for /request-a-build/.
 *
 * Deliberately small and ES5-shaped, like build-brief.js: no build step, no framework,
 * and it must work on the old phone browser a Kalispell shop owner is holding.
 *
 * The form is `novalidate` so the browser's own bubbles never fire — every message the
 * person sees is written here, in the page's voice, next to the field it belongs to.
 * The server validates the same rules again; this half is a convenience, not a control.
 */
(function () {
  "use strict";

  var form = document.getElementById("rbForm");
  var done = document.getElementById("rbDone");
  if (!form || !done) return;

  var btn = form.querySelector(".rb-submit");

  // Which fields are required, and the check each one has to pass. Kept as data so the
  // rules read in one place instead of being spread through the submit handler.
  var RULES = [
    { name: "name", test: function (v) { return !!v; } },
    { name: "business", test: function (v) { return !!v; } },
    { name: "email", test: function (v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); } },
    { name: "website", test: function (v) { return !!v; } },
    { name: "want", test: function (v) { return !!v; }, radio: true },
  ];

  function fieldOf(el) {
    while (el && el.classList && !el.classList.contains("rb-field")) el = el.parentNode;
    return el;
  }

  function valueOf(rule) {
    if (rule.radio) {
      var picked = form.querySelector('input[name="' + rule.name + '"]:checked');
      return picked ? picked.value : "";
    }
    var input = form.elements[rule.name];
    return input && input.value ? input.value.trim() : "";
  }

  function mark(rule, bad) {
    var el = rule.radio
      ? form.querySelector('input[name="' + rule.name + '"]')
      : form.elements[rule.name];
    var field = fieldOf(el);
    if (!field) return field;
    field.classList.toggle("is-bad", bad);
    var err = field.querySelector(".rb-error");
    if (err) err.hidden = !bad;
    return field;
  }

  // Clear a field's error the moment the person starts fixing it. Leaving red on a
  // field someone is actively correcting reads as "still wrong" when it is not.
  form.addEventListener("input", clearNear, true);
  form.addEventListener("change", clearNear, true);
  function clearNear(e) {
    var field = fieldOf(e.target);
    if (!field || !field.classList.contains("is-bad")) return;
    field.classList.remove("is-bad");
    var err = field.querySelector(".rb-error");
    if (err) err.hidden = true;
  }

  function clearSubmitError() {
    var box = document.getElementById("rbSubmitError");
    if (box) box.parentNode.removeChild(box);
  }

  function showSubmitError(msg) {
    clearSubmitError();
    var box = document.createElement("div");
    box.className = "rb-submit-error";
    box.id = "rbSubmitError";
    box.setAttribute("role", "alert");
    var head = document.createElement("strong");
    head.textContent = "Your request was not sent.";
    var p = document.createElement("p");
    // textContent, not innerHTML: this string can carry a server message.
    p.textContent = msg;
    box.appendChild(head);
    box.appendChild(p);
    form.appendChild(box);
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearSubmitError();

    var firstBad = null;
    for (var i = 0; i < RULES.length; i++) {
      var ok = RULES[i].test(valueOf(RULES[i]));
      var field = mark(RULES[i], !ok);
      if (!ok && !firstBad) firstBad = field;
    }
    if (firstBad) {
      firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
      var focusable = firstBad.querySelector("input, textarea");
      if (focusable) focusable.focus({ preventScroll: true });
      return;
    }

    btn.disabled = true;
    btn.textContent = "Sending...";

    var payload = {
      name: valueOf({ name: "name" }),
      business: valueOf({ name: "business" }),
      email: valueOf({ name: "email" }),
      phone: valueOf({ name: "phone" }),
      website: valueOf({ name: "website" }),
      want: valueOf({ name: "want", radio: true }),
      notes: valueOf({ name: "notes" }),
      company_hp: valueOf({ name: "company_hp" }),
    };

    fetch("/.netlify/functions/build-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        // A non-JSON body means something upstream answered instead of our function —
        // a 404 page, a proxy error, an outage. Never show a parse error to a person.
        return res.text().then(function (raw) {
          var body = null;
          try { body = JSON.parse(raw); } catch (err) { body = null; }
          if (!body) {
            throw new Error(
              res.status === 404
                ? "The form's submit address could not be reached. Please call (406) 840-0404 — nothing you typed is lost."
                : "The server returned an unexpected response (" + res.status + "). Nothing was sent."
            );
          }
          return { ok: res.ok, body: body };
        });
      })
      .then(function (r) {
        if (!r.ok || r.body.ok !== true) {
          throw new Error(r.body.error || "The server did not confirm your request was saved.");
        }
        form.hidden = true;
        done.hidden = false;
        done.scrollIntoView({ behavior: "smooth", block: "center" });
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Send my request";
        // A dead network throws a TypeError whose message is browser-specific gibberish.
        showSubmitError(
          err && err.message && err.message.indexOf("Failed to fetch") === -1
            ? err.message
            : "We could not reach the server. Check your connection and try again, or call (406) 840-0404."
        );
      });
  });
})();
