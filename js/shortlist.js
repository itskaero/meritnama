'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Saved Shortlist — a cross-page "save for later" list (FREIDA/college-
// predictor-style save & compare), backed by localStorage. New, standalone,
// zero dependencies on any existing page logic beyond the optional design
// system (js/design-system.js) for the toast/drawer UI.
//
// Pages opt in with two things:
//   1. <script src="js/design-system.js"></script> then <script src="js/shortlist.js"></script>
//   2. Any button: <button class="mn-shortlist-btn" data-shortlist-id="hosp-3"
//        data-shortlist-type="hospital" data-shortlist-label="ABS Teaching Hospital"
//        data-shortlist-meta="Gujrat" data-shortlist-href="hospital.html?id=3">☆</button>
//      plus, anywhere, an opener: <button data-shortlist-trigger>My Shortlist</button>
// ═══════════════════════════════════════════════════════════════════════

(function () {
  var KEY = 'mn_shortlist';

  function getAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function persist(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
    document.dispatchEvent(new CustomEvent('mn-shortlist-change', { detail: { items: items } }));
  }
  function has(id) { return getAll().some(function (i) { return i.id === id; }); }
  function add(item) {
    var items = getAll();
    if (items.some(function (i) { return i.id === item.id; })) return;
    items.unshift(Object.assign({ addedAt: Date.now() }, item));
    persist(items);
  }
  function remove(id) { persist(getAll().filter(function (i) { return i.id !== id; })); }
  function toggle(item) {
    if (has(item.id)) { remove(item.id); return false; }
    add(item);
    return true;
  }
  function clear() { persist([]); }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // ── Star/bookmark buttons — any page can drop one in ──
  function syncButtons() {
    document.querySelectorAll('.mn-shortlist-btn[data-shortlist-id]').forEach(function (btn) {
      var on = has(btn.dataset.shortlistId);
      btn.classList.toggle('active', on);
      btn.innerHTML = on ? '&#9733;' : '&#9734;';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.mn-shortlist-btn[data-shortlist-id]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var added = toggle({
      id: btn.dataset.shortlistId,
      type: btn.dataset.shortlistType || 'item',
      label: btn.dataset.shortlistLabel || btn.dataset.shortlistId,
      href: btn.dataset.shortlistHref || null,
      meta: btn.dataset.shortlistMeta || '',
    });
    if (window.MN && MN.toast) {
      MN.toast(added ? 'Added to shortlist' : 'Removed from shortlist', { type: added ? 'success' : 'info', duration: 1800 });
    }
  });
  document.addEventListener('mn-shortlist-change', syncButtons);
  document.addEventListener('DOMContentLoaded', syncButtons);

  // ── "My Shortlist" drawer ──
  function openDrawer() {
    var items = getAll();
    var body = document.createElement('div');
    if (!items.length) {
      body.innerHTML =
        '<div class="mn-empty-state">' +
          '<div class="mn-empty-icon">&#11088;</div>' +
          '<div class="mn-empty-title">Nothing saved yet</div>' +
          '<div class="mn-empty-desc">Tap the star on any hospital or specialty to save it here for quick comparison later.</div>' +
        '</div>';
    } else {
      var list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
      items.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'card';
        row.style.cssText = 'margin-bottom:0;padding:12px 14px;display:flex;align-items:center;gap:10px;';
        var icon = item.type === 'hospital' ? '&#127973;' : item.type === 'specialty' ? '&#129658;' : '&#128204;';
        var metaHtml = item.meta ? '<div style="font-size:0.76rem;color:var(--text-muted);">' + escHtml(item.meta) + '</div>' : '';
        row.innerHTML =
          '<span style="font-size:1.1rem;flex-shrink:0;">' + icon + '</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:600;font-size:0.88rem;">' + escHtml(item.label) + '</div>' +
            metaHtml +
          '</div>';
        if (item.href) {
          var link = document.createElement('a');
          link.href = item.href;
          link.className = 'btn btn-xs';
          link.textContent = 'Open';
          row.appendChild(link);
        }
        var rmBtn = document.createElement('button');
        rmBtn.className = 'btn-icon btn-xs';
        rmBtn.innerHTML = '&times;';
        rmBtn.title = 'Remove';
        rmBtn.type = 'button';
        rmBtn.addEventListener('click', function () { remove(item.id); openDrawer(); });
        row.appendChild(rmBtn);
        list.appendChild(row);
      });
      body.appendChild(list);
    }
    if (window.MN && MN.drawer) {
      MN.drawer({ title: 'My Shortlist (' + items.length + ')', bodyEl: body });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-shortlist-trigger]').forEach(function (btn) {
      btn.addEventListener('click', openDrawer);
    });
    syncShortlistCount();
  });
  document.addEventListener('mn-shortlist-change', syncShortlistCount);
  function syncShortlistCount() {
    var n = getAll().length;
    document.querySelectorAll('[data-shortlist-trigger] .mn-shortlist-count').forEach(function (el) {
      el.textContent = n;
      el.style.display = n ? '' : 'none';
    });
  }

  // Pages that inject .mn-shortlist-btn markup dynamically (after DOMContentLoaded
  // has already fired, e.g. once an async fetch resolves) should call
  // MNShortlist.sync() right after inserting that markup so the star reflects
  // the real saved state instead of always starting hollow.
  window.MNShortlist = { getAll: getAll, has: has, add: add, remove: remove, toggle: toggle, clear: clear, openDrawer: openDrawer, sync: syncButtons };
})();
