'use strict';
// ═══════════════════════════════════════════════════════════════════════
// MeritNama Design System — Phase 4 interactive components
//
// New, additive, standalone. Doesn't touch any existing page logic —
// pages opt in by adding <script src="js/design-system.js"></script> and
// calling window.MN.toast(...) / MN.dialog(...) / MN.drawer(...) /
// MN.commandPalette.open(). Nothing here is required for any existing
// page to keep working.
//
// Every component lazily creates its own DOM region on first use, so
// including this file has zero visible effect until something calls it.
// ═══════════════════════════════════════════════════════════════════════

(function () {

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  // ── Toast ────────────────────────────────────────────────────────────
  var TOAST_ICONS = { info: 'ℹ', success: '✅', warning: '⚠️', danger: '⛔' };

  function toastRegion() {
    var r = document.getElementById('mnToastRegion');
    if (!r) {
      r = el('div', { id: 'mnToastRegion' });
      document.body.appendChild(r);
    }
    return r;
  }

  function toast(message, opts) {
    opts = opts || {};
    var type = opts.type || 'info';
    var duration = opts.duration != null ? opts.duration : 4000;
    var region = toastRegion();
    var node = el('div', { class: 'mn-toast ' + type, role: 'status' }, [
      el('span', { class: 'mn-toast-icon', html: TOAST_ICONS[type] || TOAST_ICONS.info }),
      el('span', { class: 'mn-toast-msg', html: esc(message) }),
    ]);
    var closeBtn = el('button', {
      class: 'mn-toast-close', type: 'button', 'aria-label': 'Dismiss', html: '&times;',
      onclick: function () { dismiss(); },
    });
    node.appendChild(closeBtn);
    region.appendChild(node);

    var timer = null;
    function dismiss() {
      if (timer) clearTimeout(timer);
      node.classList.add('leaving');
      setTimeout(function () { node.remove(); }, 200);
    }
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return dismiss;
  }
  toast.success = function (msg, opts) { return toast(msg, Object.assign({}, opts, { type: 'success' })); };
  toast.warning = function (msg, opts) { return toast(msg, Object.assign({}, opts, { type: 'warning' })); };
  toast.danger  = function (msg, opts) { return toast(msg, Object.assign({}, opts, { type: 'danger' })); };

  // ── Dialog (promise-based) ──────────────────────────────────────────
  function dialogRegion() {
    var r = document.getElementById('mnDialogRegion');
    if (!r) {
      r = el('div', { id: 'mnDialogRegion' });
      document.body.appendChild(r);
    }
    return r;
  }

  function dialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var region = dialogRegion();
      region.innerHTML = '';

      var actions = (opts.actions || [{ label: 'OK', value: true, variant: 'primary' }]).map(function (a) {
        return el('button', {
          class: 'btn' + (a.variant === 'primary' ? ' btn-primary' : ''),
          type: 'button',
          onclick: function () { close(a.value); },
        }, [document.createTextNode(a.label)]);
      });

      var box = el('div', { class: 'mn-dialog' + (opts.danger ? ' danger' : ''), role: 'alertdialog', 'aria-modal': 'true' }, [
        opts.title ? el('h3', { html: esc(opts.title) }) : null,
        opts.body ? el('p', { html: opts.html ? opts.body : esc(opts.body) }) : null,
        el('div', { class: 'mn-dialog-actions' }, actions),
      ]);

      var overlay = el('div', {
        class: 'mn-dialog-overlay',
        onclick: function (e) { if (e.target === overlay && opts.dismissible !== false) close(null); },
      }, [box]);

      region.appendChild(overlay);
      region.classList.add('open');

      function onKey(e) {
        if (e.key === 'Escape' && opts.dismissible !== false) close(null);
      }
      document.addEventListener('keydown', onKey);

      function close(value) {
        document.removeEventListener('keydown', onKey);
        region.classList.remove('open');
        region.innerHTML = '';
        resolve(value);
      }

      var firstBtn = box.querySelector('button');
      if (firstBtn) firstBtn.focus();
    });
  }

  dialog.confirm = function (message, opts) {
    opts = opts || {};
    return dialog({
      title: opts.title || 'Are you sure?',
      body: message,
      danger: opts.danger,
      actions: [
        { label: opts.cancelLabel || 'Cancel', value: false },
        { label: opts.confirmLabel || 'Confirm', value: true, variant: 'primary' },
      ],
    }).then(function (v) { return !!v; });
  };

  dialog.alert = function (message, opts) {
    opts = opts || {};
    return dialog({ title: opts.title, body: message, actions: [{ label: 'OK', value: true, variant: 'primary' }] });
  };

  // ── Drawer ───────────────────────────────────────────────────────────
  function drawerRegion() {
    var r = document.getElementById('mnDrawerRegion');
    if (!r) {
      r = el('div', { id: 'mnDrawerRegion' });
      document.body.appendChild(r);
    }
    return r;
  }

  function drawer(opts) {
    opts = opts || {};
    var region = drawerRegion();
    region.innerHTML = '';

    var body = el('div', { class: 'mn-drawer-body' });
    if (opts.bodyEl) body.appendChild(opts.bodyEl);
    else if (opts.html) body.innerHTML = opts.html;
    else if (opts.body) body.textContent = opts.body;

    var panel = el('div', { class: 'mn-drawer' + (opts.side === 'left' ? ' left' : '') }, [
      el('div', { class: 'mn-drawer-head' }, [
        el('h3', { html: esc(opts.title || '') }),
        el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Close', html: '&times;', onclick: close }),
      ]),
      body,
    ]);

    var overlay = el('div', { class: 'mn-drawer-overlay', onclick: close }, []);
    region.appendChild(overlay);
    region.appendChild(panel);
    region.classList.add('open');

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    function close() {
      document.removeEventListener('keydown', onKey);
      region.classList.remove('open');
      region.innerHTML = '';
      if (opts.onClose) opts.onClose();
    }
    return { close: close };
  }

  // ── Command palette ─────────────────────────────────────────────────
  var cmdkItems = [];
  var cmdkState = { open: false, activeIndex: 0, filtered: [] };

  function cmdkRegisterDefaults() {
    // Sensible defaults matching the proposed IA — pages can add more via
    // MN.commandPalette.register(), or replace entirely with .items = [].
    cmdkItems = [
      { group: 'Analyze', icon: '\u{1F4CA}', label: 'Merit Table', href: 'app.html?tab=merit' },
      { group: 'Analyze', icon: '\u{1F3AF}', label: 'My Prediction', href: 'app.html?tab=predictor' },
      { group: 'Analyze', icon: '\u{1F9EE}', label: 'Calculator', href: 'app.html?tab=calculator' },
      { group: 'Analyze', icon: '⚖️', label: 'Compare Specialties', href: 'app.html?tab=compare' },
      { group: 'Induction Portal', icon: '\u{1F393}', label: 'Induction Portal — Guide', href: 'simulation.html' },
      { group: 'Induction Portal', icon: '\u{1F465}', label: 'Candidate Pool', href: 'simulation.html?tab=candidates' },
      { group: 'Induction Portal', icon: '⚡', label: 'Seat Allocation', href: 'simulation.html?tab=simulation' },
      { group: 'Directory', icon: '\u{1F3E5}', label: 'Hospitals', href: 'hospitals.html' },
      { group: 'Directory', icon: '✅', label: 'Accreditation', href: 'accreditation.html' },
      { group: 'Community', icon: '\u{1F4AC}', label: 'Discussion', href: 'reviews.html' },
      { group: 'Community', icon: '\u{1F30D}', label: 'Community Feed', href: 'community.html' },
      { group: 'Community', icon: '\u{1F4D6}', label: 'Editorial', href: 'editorial.html' },
      { group: 'Account', icon: '\u{1F464}', label: 'My Profile', href: 'candidate.html' },
    ];
  }
  cmdkRegisterDefaults();

  function cmdkRegister(items, opts) {
    if (opts && opts.replace) cmdkItems = items.slice();
    else cmdkItems = cmdkItems.concat(items);
  }

  function fuzzyMatch(query, text) {
    query = query.toLowerCase();
    text = text.toLowerCase();
    if (!query) return true;
    var qi = 0;
    for (var i = 0; i < text.length && qi < query.length; i++) {
      if (text[i] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  function cmdkRegion() {
    var r = document.getElementById('mnCmdkRegion');
    if (!r) {
      r = el('div', { id: 'mnCmdkRegion' });
      document.body.appendChild(r);
    }
    return r;
  }

  function cmdkRender(query) {
    var list = document.getElementById('mnCmdkList');
    if (!list) return;
    var filtered = cmdkItems.filter(function (it) { return fuzzyMatch(query, it.label + ' ' + (it.group || '')); });
    cmdkState.filtered = filtered;
    cmdkState.activeIndex = 0;
    list.innerHTML = '';

    if (!filtered.length) {
      list.appendChild(el('div', { class: 'mn-cmdk-empty', html: 'No matches for &ldquo;' + esc(query) + '&rdquo;' }));
      return;
    }

    var lastGroup = null;
    filtered.forEach(function (it, i) {
      if (it.group && it.group !== lastGroup) {
        list.appendChild(el('div', { class: 'mn-cmdk-group-label', html: esc(it.group) }));
        lastGroup = it.group;
      }
      var item = el('div', {
        class: 'mn-cmdk-item' + (i === 0 ? ' active' : ''),
        role: 'option',
        onclick: function () { cmdkActivate(it); },
      }, [
        el('span', { class: 'mn-cmdk-item-icon', html: it.icon || '' }),
        el('span', {}, [document.createTextNode(it.label)]),
        it.desc ? el('span', { class: 'mn-cmdk-item-desc', html: esc(it.desc) }) : null,
      ]);
      list.appendChild(item);
    });
  }

  function cmdkActivate(item) {
    cmdkClose();
    if (item.action) item.action();
    else if (item.href) window.location.href = item.href;
  }

  function cmdkMove(delta) {
    var nodes = document.querySelectorAll('.mn-cmdk-item');
    if (!nodes.length) return;
    cmdkState.activeIndex = (cmdkState.activeIndex + delta + nodes.length) % nodes.length;
    nodes.forEach(function (n, i) { n.classList.toggle('active', i === cmdkState.activeIndex); });
    nodes[cmdkState.activeIndex].scrollIntoView({ block: 'nearest' });
  }

  function cmdkOpen() {
    if (cmdkState.open) return;
    cmdkState.open = true;
    var region = cmdkRegion();
    region.innerHTML = '';

    var input = el('input', {
      class: 'mn-cmdk-input', id: 'mnCmdkInput', type: 'text',
      placeholder: 'Jump to… (type to search)', autocomplete: 'off', spellcheck: 'false',
    });

    var palette = el('div', { class: 'mn-cmdk', role: 'listbox' }, [
      el('div', { class: 'mn-cmdk-input-wrap' }, [
        el('span', { class: 'mn-cmdk-icon', html: '\u{1F50D}' }),
        input,
        el('span', { class: 'mn-cmdk-hint', html: 'Esc' }),
      ]),
      el('div', { class: 'mn-cmdk-list', id: 'mnCmdkList' }),
    ]);

    var overlay = el('div', { class: 'mn-cmdk-overlay', onclick: function (e) { if (e.target === overlay) cmdkClose(); } }, [palette]);
    region.appendChild(overlay);
    region.classList.add('open');

    input.addEventListener('input', function () { cmdkRender(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); cmdkMove(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkMove(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var target = cmdkState.filtered[cmdkState.activeIndex];
        if (target) cmdkActivate(target);
      } else if (e.key === 'Escape') {
        cmdkClose();
      }
    });

    cmdkRender('');
    setTimeout(function () { input.focus(); }, 0);
  }

  function cmdkClose() {
    if (!cmdkState.open) return;
    cmdkState.open = false;
    var region = document.getElementById('mnCmdkRegion');
    if (region) { region.classList.remove('open'); region.innerHTML = ''; }
  }

  function cmdkToggle() { if (cmdkState.open) cmdkClose(); else cmdkOpen(); }

  // Global Cmd/Ctrl+K listener — active as soon as this file loads.
  document.addEventListener('keydown', function (e) {
    var isK = e.key === 'k' || e.key === 'K';
    if (isK && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      cmdkToggle();
    }
  });

  // ── Public API ───────────────────────────────────────────────────────
  window.MN = window.MN || {};
  window.MN.toast = toast;
  window.MN.dialog = dialog;
  window.MN.drawer = drawer;
  window.MN.commandPalette = {
    open: cmdkOpen,
    close: cmdkClose,
    toggle: cmdkToggle,
    register: cmdkRegister,
  };

})();
