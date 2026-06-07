'use strict';
/**
 * Shared notification + merit-basis notice helpers for simulation and admin.
 * Firestore: notifications/simulation_feed, notifications/marks_config
 */
window.MNNotifications = (function () {
  const MARKS_OPTION_KEY = 'mn_marks_option_id';
  const SIM_NOTIF_DISMISSED_KEY = 'mn_sim_dismissed_notifs';

  const ADJUSTED_MARKS_OPTION_IDS = new Set([
    'adjusted', 'adjusted-marks', 'uhs-adjusted',
  ]);

  const MARKS_OPTION_NOTICES = {
    official: 'Rankings use the portal aggregate (marksTotal) plus programme marks exactly as stored on the induction portal—FCPS attempt marks and raw MS/MD programme marks before UHS adjustment. This mirrors the unofficial portal breakdown. Simulation results are estimates only, not official PHF allocations.',
    portal: 'Rankings use the portal aggregate (marksTotal) plus programme marks exactly as stored on the induction portal—FCPS attempt marks and raw MS/MD programme marks before UHS adjustment. This mirrors the unofficial portal breakdown. Simulation results are estimates only, not official PHF allocations.',
    adjusted: 'Rankings use the same portal base total, but MS and MD programme marks follow the UHS adjustment policy (see Adjusted in candidate profiles). FCPS marks are unchanged from the portal. Use this view if you expect closing merit to reflect UHS-adjusted MS/MD scores. Estimates only—confirm with official PHF sources.',
    'adjusted-marks': 'Rankings use the same portal base total, but MS and MD programme marks follow the UHS adjustment policy (see Adjusted in candidate profiles). FCPS marks are unchanged from the portal. Use this view if you expect closing merit to reflect UHS-adjusted MS/MD scores. Estimates only—confirm with official PHF sources.',
    'uhs-adjusted': 'Rankings use the same portal base total, but MS and MD programme marks follow the UHS adjustment policy (see Adjusted in candidate profiles). FCPS marks are unchanged from the portal. Use this view if you expect closing merit to reflect UHS-adjusted MS/MD scores. Estimates only—confirm with official PHF sources.',
  };

  const DEFAULT_MARKS_OPTIONS = [
    {
      id: 'portal',
      label: 'Official (portal + programme marks)',
      base: 'marksTotal',
      adjustments: [],
      notice: MARKS_OPTION_NOTICES.portal,
    },
    {
      id: 'adjusted',
      label: 'Adjusted (UHS MS/MD policy)',
      base: 'marksTotal',
      adjustments: [
        { field: 'programMarks', op: 'subtract' },
        { field: 'adjusted', op: 'add' },
      ],
      notice: MARKS_OPTION_NOTICES.adjusted,
    },
    {
      id: 'minus-mdcat',
      label: 'marksTotal − MDCAT',
      base: 'marksTotal',
      adjustments: [{ field: 'mdcat', op: 'subtract' }],
    },
    {
      id: 'plus-mdcat',
      label: 'marksTotal + MDCAT',
      base: 'marksTotal',
      adjustments: [{ field: 'mdcat', op: 'add' }],
    },
    {
      id: 'minus-experience',
      label: 'marksTotal − Experience',
      base: 'marksTotal',
      adjustments: [{ field: 'experience', op: 'subtract' }],
    },
    {
      id: 'degree-housejob',
      label: 'Degree + House Job',
      base: 'sum',
      sumFields: ['degree', 'houseJob'],
      adjustments: [],
    },
  ];

  const DEFAULT_MARKS_CONFIG = {
    options: DEFAULT_MARKS_OPTIONS,
    defaultOptionId: 'portal',
    showSelector: true,
    showNotice: true,
    noticeTitle: 'About merit marks',
    candidateNotice: '',
  };

  function readMarksConfigBool(value, defaultValue = true) {
    if (value === true || value === false) return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return defaultValue;
  }

  function normalizeMarksOption(raw, idx = 0, isValidField = () => true) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `opt-${idx + 1}`;
    const label = typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : id;
    const base = raw.base === 'sum' ? 'sum' : 'marksTotal';
    const sumFields = Array.isArray(raw.sumFields)
      ? raw.sumFields.filter(f => isValidField(f))
      : [];
    const adjustments = Array.isArray(raw.adjustments)
      ? raw.adjustments
          .filter(a => a && (a.op === 'add' || a.op === 'subtract') && isValidField(a.field))
          .map(a => ({ field: a.field, op: a.op }))
      : [];
    const notice = typeof raw.notice === 'string' && raw.notice.trim() ? raw.notice.trim() : '';
    const out = { id, label, base, sumFields, adjustments };
    if (notice) out.notice = notice;
    else if (MARKS_OPTION_NOTICES[id]) out.notice = MARKS_OPTION_NOTICES[id];
    return out;
  }

  function getNoticeForOption(opt) {
    if (!opt) return '';
    if (opt.notice?.trim()) return opt.notice.trim();
    if (MARKS_OPTION_NOTICES[opt.id]) return MARKS_OPTION_NOTICES[opt.id];
    return '';
  }

  function defaultMarksNoticeBody(showSelector = true) {
    if (!showSelector) {
      return 'All candidates are ranked using the same merit formula. Administrators have set a fixed formula for everyone — you cannot change it here.';
    }
    return 'Two merit views are available from the Merit basis dropdown. Official uses portal programme marks as stored on the induction portal. Adjusted applies the UHS policy to MS/MD marks only—FCPS is the same in both views. Rankings and simulation results update when you switch. All output is unofficial; verify with PHF when results are published.';
  }

  /**
   * Update .marks-info-banner elements (Candidates + Simulation tabs).
   * @param {object} ctx
   * @param {string} ctx.activeOptionId
   * @param {boolean} ctx.showNotice
   * @param {string} ctx.noticeTitle
   * @param {string} ctx.candidateNotice
   * @param {boolean} ctx.showSelector
   * @param {string} ctx.formulaLabel - active formula label
   * @param {string} ctx.optionNotice - per-option notice text
   */
  function syncMarksNoticeUI(ctx) {
    const {
      activeOptionId = '',
      showNotice = true,
      noticeTitle = 'About merit marks',
      candidateNotice = '',
      showSelector = true,
      formulaLabel = 'Base',
      optionNotice = '',
    } = ctx;

    document.querySelectorAll('.marks-info-banner').forEach(banner => {
      const titleEl = banner.querySelector('.marks-info-banner-title');
      const textEl = banner.querySelector('.marks-info-banner-text');
      const formulaEl = banner.querySelector('[data-marks-banner-formula]');

      if (!showNotice) {
        banner.classList.add('hidden');
        return;
      }

      banner.classList.remove('hidden');
      banner.classList.toggle('is-adjusted', ADJUSTED_MARKS_OPTION_IDS.has(activeOptionId));

      if (titleEl) titleEl.textContent = noticeTitle || 'About merit marks';
      if (textEl) {
        const custom = candidateNotice?.trim();
        textEl.textContent = optionNotice || custom || defaultMarksNoticeBody(showSelector);
      }
      if (formulaEl) formulaEl.textContent = formulaLabel;
    });
  }

  async function loadFeedItems() {
    try {
      const snap = await firebase.firestore().collection('notifications').doc('simulation_feed').get();
      const data = snap.exists ? snap.data() : null;
      if (Array.isArray(data?.items)) return data.items;
    } catch (_) {}

    try {
      const res = await fetch('data/notifications.json', { cache: 'no-store' });
      if (res.ok) {
        const items = await res.json();
        if (Array.isArray(items)) return items;
      }
    } catch (_) {}

    return [];
  }

  function renderFeedBar(barEl, items, esc) {
    if (!barEl) return;
    if (!items?.length) {
      barEl.innerHTML = '';
      return;
    }

    const dismissed = JSON.parse(localStorage.getItem(SIM_NOTIF_DISMISSED_KEY) || '[]');
    const active = items.filter(n => n.active && !dismissed.includes(n.id));
    if (!active.length) {
      barEl.innerHTML = '';
      return;
    }

    barEl.innerHTML = active.map(n => `
      <div class="notif-item notif-${esc(n.type || 'info')}" data-notif-id="${esc(n.id)}">
        ${n.icon ? `<span class="notif-icon" aria-hidden="true">${n.icon}</span>` : ''}
        <div class="notif-body">
          ${n.title ? `<div class="notif-title">${esc(n.title)}</div>` : ''}
          <div class="notif-text">${esc(n.body || '')}${
            n.link ? ` <a href="${esc(n.link)}" class="notif-link" target="_blank" rel="noopener noreferrer">${esc(n.linkText || 'Learn more')}</a>` : ''
          }</div>
        </div>
        ${n.dismissable ? `<button type="button" class="notif-dismiss" data-dismiss-id="${esc(n.id)}" title="Dismiss" aria-label="Dismiss notification">&#10005;</button>` : ''}
      </div>
    `).join('');

    barEl.querySelectorAll('.notif-dismiss').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.dismissId;
        const list = JSON.parse(localStorage.getItem(SIM_NOTIF_DISMISSED_KEY) || '[]');
        list.push(id);
        localStorage.setItem(SIM_NOTIF_DISMISSED_KEY, JSON.stringify(list));
        btn.closest('.notif-item')?.remove();
      });
    });
  }

  function initFeedListener(onUpdate) {
    try {
      firebase.firestore().collection('notifications').doc('simulation_feed').onSnapshot(snap => {
        const data = snap.exists ? snap.data() : null;
        if (!Array.isArray(data?.items)) return;
        onUpdate(data.items);
      });
    } catch (_) {}
  }

  async function loadMarksConfigDoc() {
    try {
      const snap = await firebase.firestore().collection('notifications').doc('marks_config').get();
      if (snap.exists) return snap.data();
    } catch (_) {}
    return null;
  }

  function initMarksConfigListener(onData) {
    try {
      firebase.firestore().collection('notifications').doc('marks_config').onSnapshot(snap => {
        onData(snap.exists ? snap.data() : null);
      });
    } catch (_) {}
  }

  function cloneDefaultMarksOptions() {
    return DEFAULT_MARKS_OPTIONS.map(o => ({
      id: o.id,
      label: o.label,
      base: o.base,
      adjustments: (o.adjustments || []).slice(),
      sumFields: o.sumFields ? o.sumFields.slice() : undefined,
      notice: o.notice || MARKS_OPTION_NOTICES[o.id] || '',
    }));
  }

  return {
    MARKS_OPTION_KEY,
    SIM_NOTIF_DISMISSED_KEY,
    ADJUSTED_MARKS_OPTION_IDS,
    MARKS_OPTION_NOTICES,
    DEFAULT_MARKS_OPTIONS,
    DEFAULT_MARKS_CONFIG,
    readMarksConfigBool,
    normalizeMarksOption,
    getNoticeForOption,
    defaultMarksNoticeBody,
    syncMarksNoticeUI,
    loadFeedItems,
    renderFeedBar,
    initFeedListener,
    loadMarksConfigDoc,
    initMarksConfigListener,
    cloneDefaultMarksOptions,
  };
})();
