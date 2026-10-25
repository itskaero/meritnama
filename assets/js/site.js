/* MeritNama public site behaviour. No dependencies; every feature degrades to static HTML. */
(function () {
  "use strict";

  var cfg = window.MERITNAMA_CONFIG || {};
  var appUrl = cfg.appUrl || "app.html";
  var SESSION_KEY = "meritnama_auth_session";

  // ── Application entry links ──────────────────────────────
  // Every "Sign in" / "Open app" link carries data-app-link; the href in the
  // markup is only a no-JS fallback.
  function appHref(path) {
    if (!path) return appUrl;
    return appUrl.replace(/\/?$/, "/") + path.replace(/^\//, "");
  }
  document.querySelectorAll("[data-app-link]").forEach(function (a) {
    a.setAttribute("href", appHref(a.getAttribute("data-app-path")));
  });

  // ── Header: scrolled state + mobile menu ─────────────────
  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  if (header) {
    var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 24); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  if (header && toggle) {
    var setOpen = function (open) {
      header.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    toggle.addEventListener("click", function () { setOpen(!header.classList.contains("is-open")); });
    header.querySelectorAll(".nav-menu a").forEach(function (a) {
      a.addEventListener("click", function () { setOpen(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
    });
  }

  // ── Legacy session: sign-out link ────────────────────────
  var signOut = document.getElementById("signOutBtn");
  if (signOut) {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (s && s.email) signOut.hidden = false;
    } catch (e) { /* storage blocked */ }
    signOut.addEventListener("click", function () {
      try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
      window.location.reload();
    });
  }

  // ── Application availability ─────────────────────────────
  // Only runs when a health URL is configured (the private app). Any failure —
  // network, CORS, non-2xx, timeout — shows the same plain notice.
  var status = document.getElementById("appStatus");
  if (status && cfg.appHealthUrl && window.fetch) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 5000);
    fetch(cfg.appHealthUrl, { method: "GET", mode: "cors", cache: "no-store", credentials: "omit", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("unavailable"); })
      .catch(function () { status.classList.add("is-visible"); })
      .then(function () { clearTimeout(timer); });
  }

  // ── Admin-edited hero copy and snapshot figures ──────────
  // Plain Firestore REST read (no SDK). Empty fields keep the built-in defaults.
  if (cfg.homepageContentUrl && window.fetch) {
    var signal = window.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined;
    fetch(cfg.homepageContentUrl, { signal: signal })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) {
        if (!doc || !doc.fields) return;
        var f = doc.fields;
        var txt = function (field) { return field && field.stringValue ? field.stringValue : ""; };
        var map = {
          heroSubhead: txt(f.subhead),
          heroStat1Val: txt(f.stat1Value), heroStat1Lab: txt(f.stat1Label),
          heroStat2Val: txt(f.stat2Value), heroStat2Lab: txt(f.stat2Label),
          heroStat3Val: txt(f.stat3Value), heroStat3Lab: txt(f.stat3Label)
        };
        Object.keys(map).forEach(function (id) {
          if (!map[id]) return;
          var el = document.getElementById(id);
          if (el) el.textContent = map[id];
        });
      })
      .catch(function () { /* offline or blocked — defaults already rendered */ });
  }

  // ── Footer year ──────────────────────────────────────────
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
