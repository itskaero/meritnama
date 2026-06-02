'use strict';
// simulation.js — Induction 21 live simulation for MeritNama
// Translates merit.py run_placement() faithfully into JavaScript.

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
const SIM = {
  candidates:   [],
  seats:        null,   // {PROG: {quota: {spec: {hosp: n}}}}  or null
  flatSeats:    [],     // raw flat array [{typeName, quotaName, specialityName, hospitalName, seats}]
  seatsLoaded:  false,
  myId:         null,   // applicantId string | null
  customCand:   null,   // manually-added candidate | null
  activeTab:    'candidates',

  cand: {
    filter:   '',
    program:  '',
    sortKey:  'marksTotal',
    sortDir:  -1,
    page:     0,
    filtered: [],
  },

  sb: { program: '', quota: '', spec: '', hosp: '', candidateId: null, clickedCandId: null },
  notifications: [],

  sim: {
    program:     'FCPS',
    result:      null,
    running:     false,
    parentBonus: false,
    filter:      '',
  },
};

const MY_ID_KEY      = 'mn_sim_my_id';
const CUSTOM_KEY     = 'mn_sim_custom_cand';
const PAGE_SIZE      = 50;
const MAX_PASSES     = 200;

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  SIM.myId      = localStorage.getItem(MY_ID_KEY) || null;
  SIM.customCand = loadCustomCand();

  showLoading(true);
  await loadData();
  showLoading(false);
  renderNotifications();

  setupTabs();
  setupHamburger();
  handleSimURLParams();
  setupFindMe();
  setupCandidateFilters();
  applyAndRenderCandidates();
  renderCandStats();
  setupSlotBrowser();
  setupSimulationTab();
  setupChat();
  updateMyBadge();

  // If navigated from profile "Run My Simulation" — scroll to the YOU row
  if (localStorage.getItem('mn_sim_open_candidates') === '1') {
    localStorage.removeItem('mn_sim_open_candidates');
    if (SIM.myId) {
      setTimeout(() => {
        const row = document.querySelector('tr.row-me');
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 350);
    }
  }

  document.getElementById('candidateModalOverlay')
    ?.addEventListener('click', closeModal);
  document.getElementById('candidateModalClose')
    ?.addEventListener('click', closeModal);
  document.getElementById('customModalClose')
    ?.addEventListener('click', closeCustomModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSbModal(); });
});

// ═══════════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════════
async function loadData() {
  setStatus('loading', 'Loading…');
  try {
    const r = await fetch('data/induction21_candidates.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    // Support both {candidates:[...]} and the ID-keyed object format {"27267":{...}, ...}
    SIM.candidates = Array.isArray(d)
      ? d
      : (d.candidates || Object.values(d));
  } catch (e) {
    setStatus('error', 'No data');
    document.getElementById('noDataBanner')?.classList.remove('hidden');
    return;
  }

  // Optional seats
  try {
    const r = await fetch('data/induction21_seats.json');
    if (r.ok) {
      const raw = await r.json();
      // Support both the flat array format [{typeName, quotaName, specialityName, hospitalName, seats}]
      // and the pre-nested format {program: {quota: {spec: {hosp: n}}}}
      if (Array.isArray(raw)) {
        SIM.flatSeats = raw;
        const nested = {};
        for (const row of raw) {
          const prog  = row.typeName;
          const quota = row.quotaName;
          const spec  = row.specialityName;
          const hosp  = row.hospitalName;
          nested[prog]        ??= {};
          nested[prog][quota] ??= {};
          nested[prog][quota][spec] ??= {};
          nested[prog][quota][spec][hosp] = row.seats;
        }
        SIM.seats = nested;
      } else {
        SIM.seats = raw;
        SIM.flatSeats = [];
      }
      SIM.seatsLoaded = true;
    }
  } catch (_) {}

  // Notifications
  try {
    const nr = await fetch('data/notifications.json');
    if (nr.ok) SIM.notifications = await nr.json();
  } catch (_) {}

  const n   = SIM.candidates.length;
  const smsg = SIM.seatsLoaded ? ' + seats' : '';
  setStatus('ok', `${n} candidates${smsg}`);
  document.getElementById('simNoSeatsWarn')?.classList.toggle('hidden', SIM.seatsLoaded);
}

function setStatus(type, msg) {
  const el = document.getElementById('dataStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = `badge badge-${type === 'error' ? 'danger' : type === 'loading' ? 'muted' : 'info'}`;
}

function showLoading(on) {
  const ov = document.getElementById('simLoadingOverlay');
  if (ov) ov.classList.toggle('hidden', !on);
}

// ═══════════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════════
function setupTabs() {
  const nav = document.getElementById('mainNav');
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tab;
      document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${t}`)?.classList.add('active');
      SIM.activeTab = t;
      // Lazy-render induction-data tabs on first activation
      if (t === 'seatmatrix')  renderSeatMatrixTab();
      if (t === 'competition') renderCompetitionTab();
      if (t === 'hospitals')   renderHospitalsTab();
      if (t === 'profiles')    renderProfilesTab();
      if (t === 'community') {
        CHAT.tabActive = true;
        _resetUnread();
        _renderAllChatMessages();
        _chatScrollBottom('chatTabMessages');
      } else {
        CHAT.tabActive = false;
      }
      // close hamburger menu after tab selection on mobile
      nav?.classList.remove('nav-open');
      document.getElementById('hamburgerBtn')?.setAttribute('aria-expanded', 'false');
    });
  });
}

function setupHamburger() {
  const btn = document.getElementById('hamburgerBtn');
  const nav = document.getElementById('mainNav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // close when clicking outside
  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && !btn.contains(e.target)) {
      nav.classList.remove('nav-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// FIND ME
// ═══════════════════════════════════════════════════════════════════
function setupFindMe() {
  const btn   = document.getElementById('findMeBtn');
  const input = document.getElementById('findMeInput');
  const clr   = document.getElementById('clearMeBtn');
  const addBtn = document.getElementById('addManuallyBtn');

  btn?.addEventListener('click', () => identifyUser(input?.value?.trim()));
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter') identifyUser(input.value.trim());
  });
  clr?.addEventListener('click', clearMe);
  addBtn?.addEventListener('click', openCustomModal);

  if (SIM.myId) updateMyBadge();
}

function identifyUser(idStr) {
  const id = String(idStr || '').trim();
  if (!id) return;

  // Check custom candidate first
  if (SIM.customCand && String(SIM.customCand.applicantId) === id) {
    SIM.myId = id;
    localStorage.setItem(MY_ID_KEY, id);
    updateMyBadge();
    showToast(`Found (manual): ${SIM.customCand.nameFull}`, 'success');
    if (SIM.activeTab === 'candidates') applyAndRenderCandidates();
    return;
  }

  const found = SIM.candidates.find(c => String(c.applicantId) === id);
  if (!found) {
    showToast(`ID ${id} not in dataset. Use "Add Manually" to add yourself.`, 'warning');
    return;
  }
  SIM.myId = id;
  localStorage.setItem(MY_ID_KEY, id);
  updateMyBadge();
  showToast(`Found: ${found.nameFull} — ${baseMarks(found).toFixed(2)} marks`, 'success');
  if (SIM.activeTab === 'candidates') applyAndRenderCandidates();
}

function clearMe() {
  SIM.myId = null;
  localStorage.removeItem(MY_ID_KEY);
  updateMyBadge();
  if (SIM.activeTab === 'candidates') applyAndRenderCandidates();
  showToast('Identity cleared.', 'info');
}

function updateMyBadge() {
  const badge = document.getElementById('myBadge');
  const clr   = document.getElementById('clearMeBtn');
  const input = document.getElementById('findMeInput');
  if (!badge) return;

  const me = SIM.myId ? (allCandidates().find(c => String(c.applicantId) === SIM.myId)) : null;
  if (me) {
    badge.textContent = `${me.nameFull.split(' ')[0]} — ${baseMarks(me).toFixed(2)}`;
    badge.classList.remove('hidden');
    clr?.classList.remove('hidden');
    if (input) input.value = SIM.myId;
  } else {
    badge.classList.add('hidden');
    clr?.classList.add('hidden');
  }
}

// Returns all candidates including custom if present
function allCandidates() {
  if (SIM.customCand) {
    const withoutCustom = SIM.candidates.filter(
      c => String(c.applicantId) !== String(SIM.customCand.applicantId)
    );
    return [SIM.customCand, ...withoutCustom];
  }
  return SIM.candidates;
}

// ── Custom candidate (manual add) ─────────────────────────────────
function loadCustomCand() {
  try {
    const s = localStorage.getItem(CUSTOM_KEY);
    return s ? JSON.parse(s) : null;
  } catch (_) { return null; }
}

function saveCustomCand(c) {
  SIM.customCand = c;
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(c));
}

function openCustomModal() {
  const m = document.getElementById('customModal');
  if (!m) return;

  const existing = SIM.customCand;
  if (existing) {
    document.getElementById('customName').value      = existing.nameFull;
    document.getElementById('customId').value        = existing.applicantId;
    document.getElementById('customMarksTotal').value = existing.marksTotal;
    document.getElementById('customMarksFCPS').value = existing.programMarks?.FCPS ?? '';
    document.getElementById('customMarksMS').value   = existing.programMarks?.MS  ?? '';
    document.getElementById('customMarksMD').value   = existing.programMarks?.MD  ?? '';
  }
  m.classList.remove('hidden');
}

function closeCustomModal() {
  document.getElementById('customModal')?.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  // Close profile view modal when clicking outside the sheet
  document.getElementById('profileViewModal')?.addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });

  document.getElementById('customSaveBtn')?.addEventListener('click', () => {
    const name  = document.getElementById('customName')?.value?.trim() || '(Me)';
    const id    = parseInt(document.getElementById('customId')?.value) || 99999;
    const total = parseFloat(document.getElementById('customMarksTotal')?.value) || 0;
    const fcps  = parseFloat(document.getElementById('customMarksFCPS')?.value) || total;
    const ms    = parseFloat(document.getElementById('customMarksMS')?.value) || total;
    const md    = parseFloat(document.getElementById('customMarksMD')?.value) || total;

    const prefs = gatherCustomPrefs();

    const cand = {
      applicantId:  id,
      nameFull:     name,
      marksTotal:   total,
      programMarks: { FCPS: fcps, MS: ms, MD: md },
      applied_in:   {
        FCPS: !!prefs.FCPS?.length,
        MS:   !!prefs.MS?.length,
        MD:   !!prefs.MD?.length,
      },
      preference:   prefs,
      _custom:      true,
    };
    saveCustomCand(cand);
    SIM.myId = String(id);
    localStorage.setItem(MY_ID_KEY, String(id));
    updateMyBadge();
    closeCustomModal();
    applyAndRenderCandidates();
    renderCandStats();
    showToast(`Saved as "${name}" (ID ${id}).`, 'success');
  });
});

function gatherCustomPrefs() {
  const prefs = {};
  document.querySelectorAll('.custom-pref-row').forEach(row => {
    const prog  = row.querySelector('.cp-prog')?.value;
    const no    = parseInt(row.querySelector('.cp-no')?.value) || 1;
    const quota = row.querySelector('.cp-quota')?.value;
    const spec  = row.querySelector('.cp-spec')?.value;
    const hosp  = row.querySelector('.cp-hosp')?.value;
    if (!prog || !quota || !spec || !hosp) return;
    prefs[prog] ??= [];
    prefs[prog].push({ preferenceNo: no, quotaName: quota, typeName: prog,
                       specialityName: spec, hospitalName: hosp,
                       marks: 0, parentInstitute: false });
  });
  return prefs;
}

// ═══════════════════════════════════════════════════════════════════
// CANDIDATES TAB
// ═══════════════════════════════════════════════════════════════════
function renderCandStats() {
  const all = allCandidates();
  if (!all.length) return;

  let fcps = 0, ms = 0, md = 0, multi = 0, noPrefs = 0, lowMarks = 0;
  for (const c of all) {
    const ai    = c.applied_in || {};
    const progs = (ai.FCPS ? 1 : 0) + (ai.MS ? 1 : 0) + (ai.MD ? 1 : 0);
    if (ai.FCPS) fcps++;
    if (ai.MS)   ms++;
    if (ai.MD)   md++;
    if (progs >= 2) multi++;
    if (progs === 0) noPrefs++;
    if ((c.marksTotal || 0) < 5) lowMarks++;
  }

  const bar = document.getElementById('candStats');
  if (!bar) return;
  bar.classList.remove('hidden');

  document.getElementById('cstat-fcps').textContent    = fcps.toLocaleString();
  document.getElementById('cstat-ms').textContent      = ms.toLocaleString();
  document.getElementById('cstat-md').textContent      = md.toLocaleString();
  document.getElementById('cstat-multi').textContent   = multi.toLocaleString();

  document.getElementById('cstat-noprefs').textContent = noPrefs.toLocaleString();
  document.getElementById('cstats-noprefs-item')
    ?.classList.toggle('cstats-ok', noPrefs === 0);

  document.getElementById('cstat-lowmarks').textContent = lowMarks.toLocaleString();
  document.getElementById('cstats-lowmarks-item')
    ?.classList.toggle('cstats-ok', lowMarks === 0);
}

function setupCandidateFilters() {
  const search  = document.getElementById('candSearch');
  const progSel = document.getElementById('candProgram');

  search?.addEventListener('input', () => {
    SIM.cand.filter = search.value.trim().toLowerCase();
    SIM.cand.page   = 0;
    applyAndRenderCandidates();
  });

  progSel?.addEventListener('change', () => {
    SIM.cand.program = progSel.value;
    SIM.cand.page    = 0;
    applyAndRenderCandidates();
  });

  document.getElementById('candTable')?.querySelector('thead')
    ?.addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const key = th.dataset.sort;
      if (SIM.cand.sortKey === key) SIM.cand.sortDir *= -1;
      else { SIM.cand.sortKey = key; SIM.cand.sortDir = -1; }
      SIM.cand.page = 0;
      applyAndRenderCandidates();
    });
}

function applyAndRenderCandidates() {
  let list = allCandidates().slice();

  if (SIM.cand.filter) {
    list = list.filter(c => c.nameFull.toLowerCase().includes(SIM.cand.filter));
  }
  if (SIM.cand.program) {
    list = list.filter(c => effectiveMark(c, SIM.cand.program) != null);
  }

  const { sortKey: key, sortDir: dir } = SIM.cand;
  list.sort((a, b) => {
    let av, bv;
    if (key === 'nameFull') { av = a.nameFull; bv = b.nameFull; }
    else if (['FCPS','MS','MD'].includes(key)) {
      av = effectiveMark(a, key) ?? 0; bv = effectiveMark(b, key) ?? 0;
    } else {
      av = a[key] ?? 0; bv = b[key] ?? 0;
    }
    return typeof av === 'string'
      ? av.localeCompare(bv) * dir
      : (av - bv) * dir;
  });

  SIM.cand.filtered = list;

  const total = list.length;
  const slice = list.slice(SIM.cand.page * PAGE_SIZE, (SIM.cand.page + 1) * PAGE_SIZE);
  renderCandidateTable(slice, total);
}

function renderCandidateTable(slice, total) {
  const tbody = document.getElementById('candBody');
  if (!tbody) return;

  const PROGS = ['FCPS', 'MS', 'MD'];
  tbody.innerHTML = slice.map(c => {
    const isMe   = String(c.applicantId) === SIM.myId;
    const rank   = SIM.cand.filtered.indexOf(c) + 1;
    const tags   = PROGS.filter(p => effectiveMark(c, p) != null)
                        .map(p => `<span class="prog-tag prog-${p.toLowerCase()}">${p}</span>`).join('');
    const custom = c._custom ? '<span class="custom-tag">manual</span>' : '';
    return `<tr class="${isMe ? 'row-me' : ''}" data-id="${c.applicantId}" style="cursor:pointer">
      <td class="td-num">${rank}</td>
      <td>${esc(c.nameFull)} ${custom}${isMe ? '<span class="me-tag">YOU</span>' : ''}</td>
      <td class="td-num">${fmtM(baseMarks(c))}</td>
      <td class="td-num">${fmtM(effectiveMark(c, 'FCPS'))}</td>
      <td class="td-num">${fmtM(effectiveMark(c, 'MS'))}</td>
      <td class="td-num">${fmtM(effectiveMark(c, 'MD'))}</td>
      <td>${tags}</td>
      <td><button class="btn btn-sm view-btn" data-id="${c.applicantId}">View</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--text-muted)">No candidates match the filter.</td></tr>';

  const countEl = document.getElementById('candCount');
  if (countEl) countEl.textContent = `${total.toLocaleString()} candidates`;

  renderPagination('candPager', total, SIM.cand.page, PAGE_SIZE, p => {
    SIM.cand.page = p;
    applyAndRenderCandidates();
  });

  tbody.querySelectorAll('.view-btn').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openCandidateDetail(btn.dataset.id); })
  );
  tbody.querySelectorAll('tr[data-id]').forEach(row =>
    row.addEventListener('click', () => openCandidateDetail(row.dataset.id))
  );
}

function openCandidateDetail(idStr) {
  const c = allCandidates().find(c => String(c.applicantId) === String(idStr));
  if (!c) return;

  const modal = document.getElementById('candidateModal');
  const body  = document.getElementById('candidateModalBody');
  if (!modal || !body) return;

  const isMe   = String(c.applicantId) === SIM.myId;
  const progs  = Object.keys(c.programMarks || {}).filter(p => effectiveMark(c, p) != null);

  const scoreRows = [
    ['MBBS',       c.degree],
    ['House Job',  c.houseJob],
    ['Experience', c.experience],
    ['Research',   c.research],
    ['Position',   c.position],
    ['Hard Areas', c.hardAreas],
    ['MDCAT',      c.mdcat],
  ].filter(([, v]) => v);

  body.innerHTML = `
    <div class="cand-detail-hdr">
      <div>
        <h3>${esc(c.nameFull)} ${isMe ? '<span class="me-tag">YOU</span>' : ''}
          ${c._custom ? '<span class="custom-tag">manual</span>' : ''}</h3>
        <p class="cand-detail-meta">ID: ${c.applicantId} &nbsp;·&nbsp; Base: <strong>${fmtM(baseMarks(c))}</strong></p>
      </div>
    </div>

    <div class="cand-scores-grid">
      ${Object.entries(c.programMarks || {}).map(([p, m]) => {
        const eff = effectiveMark(c, p);
        const applied = c.applied_in?.[p];
        return `
        <div class="cand-score-card ${applied ? 'applied' : ''}" data-prog="${esc(p)}">
          <span class="cand-score-prog">${p}</span>
          <span class="cand-score-val">${eff != null ? fmtM(eff) : '—'}</span>
          <span class="cand-score-lbl">${applied ? `✓ Applied${m ? ` (+${fmtM(m)})` : ''}` : 'Not applied'}</span>
        </div>`;
      }).join('')}
    </div>

    ${scoreRows.length ? `
    <details class="score-breakdown">
      <summary>Score breakdown</summary>
      <div class="score-bk-grid">
        ${scoreRows.map(([l, v]) => `<span>${l}</span><span class="score-bk-val">${fmtM(v)}</span>`).join('')}
        <span><strong>Base Total</strong></span><span class="score-bk-val"><strong>${fmtM(baseMarks(c))}</strong></span>
      </div>
    </details>` : ''}

    ${progs.map(prog => {
      const prefs = (c.preference[prog] || []).slice().sort((a, b) => a.preferenceNo - b.preferenceNo);
      if (!prefs.length) return '';
      return `<div class="pref-section">
        <h4><span class="prog-tag prog-${prog.toLowerCase()}">${prog}</span> Preferences (${prefs.length})</h4>
        <div class="pref-list">
          ${prefs.map(p => `
            <div class="pref-item ${p.parentInstitute ? 'pref-parent' : ''}">
              <span class="pref-no">${p.preferenceNo}</span>
              <div class="pref-details">
                <span class="pref-spec">${esc(p.specialityName)}</span>
                <span class="pref-hosp">${esc(p.hospitalName)}</span>
                <span class="pref-quota-tag">${esc(p.quotaName)}${p.parentInstitute ? ' ⭐' : ''}</span>
              </div>
              <button class="btn btn-sm pref-browse-btn"
                data-prog="${esc(prog)}" data-quota="${esc(p.quotaName)}"
                data-spec="${esc(p.specialityName)}" data-hosp="${esc(p.hospitalName)}">
                Browse slot →
              </button>
            </div>`).join('')}
        </div>
      </div>`;
    }).join('')}
  `;

  // "Browse slot" buttons jump to Slot Browser
  body.querySelectorAll('.pref-browse-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { prog, quota, spec, hosp } = btn.dataset;
      closeModal();
      jumpToSlot(prog, quota, spec, hosp);
    });
  });

  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('candidateModal')?.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════
// SLOT BROWSER
// ═══════════════════════════════════════════════════════════════════
function setupSlotBrowser() {
  const programs = new Set();
  SIM.candidates.forEach(c => Object.keys(c.preference || {}).forEach(p => programs.add(p)));
  if (SIM.customCand) Object.keys(SIM.customCand.preference || {}).forEach(p => programs.add(p));

  const progSel = document.getElementById('sbProgram');
  [...programs].sort().forEach(p => {
    const o = document.createElement('option');
    o.value = p; o.textContent = p;
    progSel?.appendChild(o);
  });

  progSel?.addEventListener('change', e => {
    SIM.sb.program = e.target.value;
    SIM.sb.quota = SIM.sb.spec = SIM.sb.hosp = '';
    refreshSbDropdowns();
    renderSlot();
  });

  document.getElementById('sbQuota')?.addEventListener('change', e => {
    SIM.sb.quota = e.target.value;
    SIM.sb.spec = SIM.sb.hosp = '';
    refreshSbDropdowns('quota');
    renderSlot();
  });

  document.getElementById('sbSpec')?.addEventListener('change', e => {
    SIM.sb.spec = e.target.value;
    SIM.sb.hosp = '';
    refreshSbDropdowns('spec');
    renderSlot();
  });

  document.getElementById('sbHosp')?.addEventListener('change', e => {
    SIM.sb.hosp = e.target.value;
    renderSlot();
  });

  // Default to FCPS
  if (programs.has('FCPS')) {
    progSel.value = 'FCPS';
    SIM.sb.program = 'FCPS';
    refreshSbDropdowns();
  }

  setupSbCandSearch();
}

function refreshSbDropdowns(from) {
  const prog = SIM.sb.program;
  if (!prog) return;

  // Candidate-preference entries for this program
  const entries = [];
  allCandidates().forEach(c => (c.preference?.[prog] || []).forEach(p => entries.push(p)));

  // Seats-data entries for this program (may include quotas/specs/hosps absent from candidate prefs)
  const seatRows = SIM.seatsLoaded ? SIM.flatSeats.filter(s => s.typeName === prog) : [];

  if (!from || from === 'program') {
    const candQ = new Set(entries.map(e => e.quotaName));
    const seatQ = new Set(seatRows.map(s => s.quotaName));
    const quotas = [...new Set([...candQ, ...seatQ])].filter(Boolean).sort();
    fillSelect('sbQuota', quotas, SIM.sb.quota, '— Quota —');
  }

  const byQ     = SIM.sb.quota ? entries.filter(e => e.quotaName === SIM.sb.quota) : entries;
  const byQSeat = SIM.sb.quota ? seatRows.filter(s => s.quotaName === SIM.sb.quota) : seatRows;
  if (!from || from === 'program' || from === 'quota') {
    const candS = new Set(byQ.map(e => e.specialityName));
    const seatS = new Set(byQSeat.map(s => s.specialityName));
    const specs = [...new Set([...candS, ...seatS])].filter(Boolean).sort();
    fillSelect('sbSpec', specs, SIM.sb.spec, '— Specialty —');
  }

  const byQS     = SIM.sb.spec ? byQ.filter(e => e.specialityName === SIM.sb.spec) : byQ;
  const byQSSeat = SIM.sb.spec ? byQSeat.filter(s => s.specialityName === SIM.sb.spec) : byQSeat;
  if (!from || from === 'program' || from === 'quota' || from === 'spec') {
    const candH = new Set(byQS.map(e => e.hospitalName));
    const seatH = new Set(byQSSeat.map(s => s.hospitalName));
    const hosps = [...new Set([...candH, ...seatH])].filter(Boolean).sort();
    fillSelect('sbHosp', hosps, SIM.sb.hosp, '— Hospital —');
  }
}

function fillSelect(id, options, selected, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    options.map(v => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
}

function jumpToSlot(prog, quota, spec, hosp) {
  // Switch to Slot Browser tab and pre-fill dropdowns
  document.querySelector('.tab-btn[data-tab="slotbrowser"]')?.click();
  SIM.sb.program = prog; SIM.sb.quota = quota; SIM.sb.spec = spec; SIM.sb.hosp = hosp;
  const progSel = document.getElementById('sbProgram');
  if (progSel) progSel.value = prog;
  refreshSbDropdowns();
  renderSlot();
}

function renderSlot() {
  const { program, quota, spec, hosp } = SIM.sb;
  const container = document.getElementById('sbResult');
  if (!container) return;

  if (!program || !quota) {
    container.innerHTML = '<p class="sb-placeholder">Select a programme and quota above (specialty and hospital are optional) to see applicants.</p>';
    return;
  }
  if (!spec || !hosp) {
    renderPartialSlot();
    return;
  }

  const applicants = [];
  allCandidates().forEach(c => {
    // Skip candidates who did not apply in this program (programMarks === 0)
    const em = effectiveMark(c, program);
    if (em == null) return;
    const pref = (c.preference?.[program] || []).find(
      p => p.quotaName === quota && p.specialityName === spec && p.hospitalName === hosp
    );
    if (pref) {
      applicants.push({
        applicantId:     c.applicantId,
        nameFull:        c.nameFull,
        marksTotal:      em,
        preferenceNo:    pref.preferenceNo,
        parentInstitute: pref.parentInstitute,
        _custom:         c._custom,
      });
    }
  });

  applicants.sort((a, b) => b.marksTotal - a.marksTotal);
  applicants.forEach((a, i) => { a._meritRank = i + 1; });

  // ── Simulation overlay ─────────────────────────────────────────
  // If the simulation has been run for this program, annotate each
  // applicant so candidates placed at a higher-preference slot are
  // clearly marked — they won't actually compete at this slot.
  const useSimData = !!(SIM.sim.result && SIM.sim.program === program);
  if (useSimData) {
    const simMap = {};
    for (const sc of SIM.sim.result.candidates) simMap[String(sc.applicantId)] = sc;
    for (const a of applicants) {
      const sc = simMap[String(a.applicantId)];
      if (!sc) { a._simStatus = null; continue; }
      if (sc.placed && sc._q === quota && sc._s === spec && sc._h === hosp) {
        a._simStatus = 'selected';
      } else if (sc.placed) {
        const placedPref = sc._prefs?.find(
          p => p.quotaName === sc._q && p.specialityName === sc._s && p.hospitalName === sc._h
        );
        a._simStatus = (placedPref && placedPref.preferenceNo < a.preferenceNo)
          ? 'higher-pref' : 'elsewhere';
        a._placedAt = `${sc._s} @ ${sc._h.split(',')[0].trim()}`;
      } else {
        a._simStatus = 'unplaced';
      }
    }
  }

  // Float simulation-selected candidates to top of the display list
  const selectedGroup = useSimData ? applicants.filter(a => a._simStatus === 'selected') : [];
  const restGroup     = useSimData ? applicants.filter(a => a._simStatus !== 'selected') : applicants;
  const displayList   = selectedGroup.length ? [...selectedGroup, ...restGroup] : applicants;

  const seats   = SIM.seats?.[program]?.[quota]?.[spec]?.[hosp] ?? null;
  const isMe    = id => String(id) === SIM.myId;
  const myPos   = SIM.myId ? applicants.findIndex(a => isMe(a.applicantId)) + 1 : 0;
  // Effective applicants excludes those already placed at a higher-preference slot
  const effectiveCount = useSimData
    ? applicants.filter(a => a._simStatus !== 'higher-pref').length
    : applicants.length;
  const ratio = seats ? (effectiveCount / seats).toFixed(1) : null;

  container.innerHTML = `
    <div class="sb-header">
      <div class="sb-title-block">
        <span class="sb-spec">${esc(spec)}</span>
        <span class="sb-hosp">${esc(hosp)}</span>
        <span class="sb-meta">${esc(program)} &middot; ${esc(quota)}</span>
      </div>
      <div class="sb-stats">
        <div class="sb-stat">
          <span class="sb-stat-v">${applicants.length}${useSimData && effectiveCount !== applicants.length ? `<span class="sb-eff-count"> (${effectiveCount} eff.)</span>` : ''}</span>
          <span class="sb-stat-l">Applicants</span>
        </div>
        <div class="sb-stat ${seats === null ? 'sb-stat-unknown' : ''}">
          <span class="sb-stat-v">${seats ?? '?'}</span>
          <span class="sb-stat-l">Seats</span>
        </div>
        ${ratio ? `<div class="sb-stat"><span class="sb-stat-v">${ratio}:1</span><span class="sb-stat-l">Competition</span></div>` : ''}
        ${myPos ? `<div class="sb-stat sb-stat-me"><span class="sb-stat-v">#${myPos}</span><span class="sb-stat-l">Your rank</span></div>` : ''}
      </div>
    </div>
    ${useSimData
      ? `<p class="sb-sim-note">Simulation active &mdash; &#10003; selected pinned to top. Dimmed = placed at a higher-preference slot.</p>`
      : `<p class="sb-sim-note sb-merit-hint">&#9432; Sorted by marks only &mdash; run the <strong>Simulation</strong> tab for merit-accurate predictions.</p>`}
    ${!SIM.seatsLoaded ? '<p class="sb-no-seats">⚠️ Seat count not loaded — cutoff line unavailable.</p>' : ''}
    <div class="sb-list">
      ${(() => {
        if (!displayList.length) return '<p class="sb-empty">No applicants listed this slot.</p>';
        const rows = [];
        let cutoffShown = false;
        displayList.forEach((a, di) => {
          if (di === 0 && selectedGroup.length)
            rows.push(`<div class="sb-section-hdr sb-section-sel"><span>&#10003; Selected by simulation</span></div>`);
          if (di === selectedGroup.length && selectedGroup.length)
            rows.push(`<div class="sb-section-hdr"><span>All applicants by merit</span></div>`);
          if (!cutoffShown && seats && a._meritRank > seats) {
            cutoffShown = true;
            rows.push(`<div class="sb-cutoff"><span>─── Merit closes here (estimated) ───</span></div>`);
          }
          const topN      = seats != null;
          const elsewhere = a._simStatus === 'higher-pref' || a._simStatus === 'elsewhere';
          const selected  = a._simStatus === 'selected';
          const above     = topN && a._meritRank <= seats && !elsewhere;
          const me        = isMe(a.applicantId);
          const searched  = SIM.sb.candidateId && String(a.applicantId) === SIM.sb.candidateId;
          const simTag = a._simStatus === 'higher-pref'
            ? `<span class="sb-sim-tag sb-sim-elsewhere" title="Placed at higher-preference: ${esc(a._placedAt || '')}">↑ higher pref</span>`
            : a._simStatus === 'elsewhere'
            ? `<span class="sb-sim-tag sb-sim-elsewhere" title="Placed elsewhere: ${esc(a._placedAt || '')}">placed elsewhere</span>`
            : a._simStatus === 'selected'
            ? `<span class="sb-sim-tag sb-sim-selected">✓ selected</span>`
            : '';
          rows.push(`<div class="sb-row ${above ? 'sb-above' : topN && !elsewhere ? 'sb-below' : ''} ${me ? 'sb-row-me' : ''} ${searched ? 'sb-row-search' : ''} ${elsewhere ? 'sb-row-elsewhere' : ''} ${selected ? 'sb-row-selected' : ''}" data-cand-id="${a.applicantId}">
            <span class="sb-rank">#${a._meritRank}</span>
            <span class="sb-pref-no">Pref ${a.preferenceNo}</span>
            ${a.parentInstitute ? '<span class="sb-parent">⭐</span>' : '<span></span>'}
            <span class="sb-name">${esc(a.nameFull)}${me ? ' <span class="me-tag">YOU</span>' : ''}${a._custom ? ' <span class="custom-tag">manual</span>' : ''}${searched && !me ? ' <span class="custom-tag">↑ found</span>' : ''}${simTag}</span>
            <span class="sb-marks">${fmtM(a.marksTotal)}</span>
          </div>`);
        });
        return rows.join('');
      })()}
    </div>
  `;

  // Candidate row click → modal
  container.querySelectorAll('.sb-row[data-cand-id]').forEach(row => {
    row.addEventListener('click', () => showSbCandQuickView(row.dataset.candId));
  });
  // Refresh modal if already open (slot context may have changed)
  if (SIM.sb.clickedCandId) renderSbQuickViewContent();
}

// ═══════════════════════════════════════════════════════════════════
// SLOT BROWSER — partial view (prog + quota, spec and/or hosp optional)
// ═══════════════════════════════════════════════════════════════════
function renderPartialSlot() {
  const { program, quota, spec, hosp } = SIM.sb;
  const container = document.getElementById('sbResult');
  if (!container) return;

  const useSimData = !!(SIM.sim.result && SIM.sim.program === program);

  // Determine grouping dimension
  // spec set → group by hospital | hosp set → group by specialty | neither → group by specialty
  const groupKey   = spec ? 'hospitalName' : 'specialityName';
  const groupLabel = spec ? 'Hospital'     : 'Specialty';

  // Collect groups from seats data first
  const groupMap = new Map();
  const seatRows = SIM.flatSeats.filter(s =>
    s.typeName  === program &&
    s.quotaName === quota &&
    (!spec || s.specialityName === spec) &&
    (!hosp || s.hospitalName   === hosp)
  );
  for (const s of seatRows) {
    const key = s[groupKey];
    if (!groupMap.has(key)) groupMap.set(key, { key, seats: 0, slots: [] });
    const g = groupMap.get(key);
    g.seats += s.seats;
    g.slots.push({ spec: s.specialityName, hosp: s.hospitalName, seats: s.seats });
  }

  // Supplement with candidate-preference slots not in seats
  allCandidates().forEach(c => {
    const em = effectiveMark(c, program);
    if (em == null) return;
    (c.preference?.[program] || []).forEach(p => {
      if (p.quotaName !== quota) return;
      if (spec && p.specialityName !== spec) return;
      if (hosp && p.hospitalName  !== hosp) return;
      const key = p[groupKey];
      if (!groupMap.has(key)) groupMap.set(key, { key, seats: 0, slots: [] });
    });
  });

  // Build applicant list per group
  for (const [, grp] of groupMap) {
    const applicants = [];
    allCandidates().forEach(c => {
      const em = effectiveMark(c, program);
      if (em == null) return;
      const matched = (c.preference?.[program] || []).find(p =>
        p.quotaName === quota &&
        (!spec || p.specialityName === spec) &&
        (!hosp || p.hospitalName   === hosp) &&
        p[groupKey] === grp.key
      );
      if (matched) {
        applicants.push({
          applicantId:     c.applicantId,
          nameFull:        c.nameFull,
          marksTotal:      em,
          preferenceNo:    matched.preferenceNo,
          slotSpec:        matched.specialityName,
          slotHosp:        matched.hospitalName,
          parentInstitute: matched.parentInstitute,
        });
      }
    });
    applicants.sort((a, b) => b.marksTotal - a.marksTotal);
    grp.applicants = applicants;
  }

  const groups = [...groupMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const isMe   = id => String(id) === SIM.myId;

  const totalSeats = groups.reduce((s, g) => s + g.seats, 0);

  let html = `
    <div class="sb-header">
      <div class="sb-title-block">
        <span class="sb-spec">${spec ? esc(spec) : hosp ? esc(hosp) : esc(program) + ' \u00b7 ' + esc(quota)}</span>
        <span class="sb-hosp">${spec ? 'All hospitals \u00b7 ' + esc(quota) : hosp ? esc(hosp) + ' \u2014 all specialties' : 'All slots \u00b7 ' + esc(quota)}</span>
        <span class="sb-meta">${esc(program)} \u00b7 ${esc(quota)}${spec ? ' \u00b7 ' + esc(spec) : ''}${hosp ? ' \u00b7 ' + esc(hosp) : ''}</span>
      </div>
      <div class="sb-stats">
        <div class="sb-stat"><span class="sb-stat-v">${groups.length}</span><span class="sb-stat-l">${groupLabel}s</span></div>
        <div class="sb-stat ${totalSeats === 0 ? 'sb-stat-unknown' : ''}"><span class="sb-stat-v">${totalSeats || '?'}</span><span class="sb-stat-l">Total Seats</span></div>
      </div>
    </div>
    ${!useSimData
      ? `<div class="sb-partial-warn">&#9888;&#65039; Without running the <strong>Simulation</strong> first, the same candidate may appear in multiple slots below. Run the Simulation tab for a de-duplicated, merit-accurate view.</div>`
      : `<p class="sb-sim-note">Simulation active &mdash; showing predicted standings per slot.</p>`}
    <div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
  `;

  if (!groups.length) {
    html += '<p class="sb-empty">No slots or applicants found for this filter.</p>';
  } else {
    for (const grp of groups) {
      const top5   = grp.applicants.slice(0, 5);
      const extra  = grp.applicants.length - 5;
      const myIdx  = SIM.myId ? grp.applicants.findIndex(a => isMe(a.applicantId)) : -1;
      // Jump button(s): link directly into the full slot view
      const canSingleJump = grp.slots.length === 1 && grp.slots[0].spec && grp.slots[0].hosp;
      const jumpBtns = canSingleJump
        ? `<button class="btn btn-sm sb-partial-jump-btn" data-prog="${esc(program)}" data-quota="${esc(quota)}" data-spec="${esc(grp.slots[0].spec)}" data-hosp="${esc(grp.slots[0].hosp)}">View slot &rarr;</button>`
        : grp.slots.map(sl =>
            `<button class="btn btn-sm sb-partial-jump-btn" style="font-size:0.7rem" data-prog="${esc(program)}" data-quota="${esc(quota)}" data-spec="${esc(sl.spec)}" data-hosp="${esc(sl.hosp)}">${esc(spec ? sl.hosp.split(',')[0].trim() : sl.spec)} &rarr;</button>`
          ).join('');

      html += `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">
          <div class="sb-partial-group-hdr">
            <div>
              <span class="sb-spec" style="font-size:0.95rem">${esc(grp.key)}</span>
              <span class="sb-meta" style="display:block;margin-top:2px">
                ${grp.slots.length > 1 ? grp.slots.length + ' slots · ' : ''}${grp.seats || '?'} seat${grp.seats !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; ${grp.applicants.length} applicant${grp.applicants.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              ${myIdx >= 0 ? `<span class="sim-me-badge" style="font-size:0.72rem">YOU #${myIdx + 1}</span>` : ''}
              ${jumpBtns}
            </div>
          </div>
          <div class="sb-list" style="padding:6px 12px">
            ${top5.length ? top5.map((a, i) => {
              const above = grp.seats > 0 && (i + 1) <= grp.seats;
              const showSlot = grp.slots.length > 1;
              return `<div class="sb-row ${above ? 'sb-above' : 'sb-below'} ${isMe(a.applicantId) ? 'sb-row-me' : ''}">
                <span class="sb-rank">#${i + 1}</span>
                <span class="sb-marks">${fmtM(a.marksTotal)}</span>
                <span class="sb-pref-no sb-parent">${a.parentInstitute ? '\u2605' : ''}</span>
                <span class="sb-name">${esc(a.nameFull)}${isMe(a.applicantId) ? ' <span class="me-tag">YOU</span>' : ''}${showSlot ? `<span style="font-size:0.7rem;color:var(--text-muted);margin-left:5px">${esc(spec ? a.slotHosp.split(',')[0].trim() : a.slotSpec)}</span>` : ''}</span>
                <span></span>
              </div>`;
            }).join('') : '<p class="sb-empty">No applicants listed this slot.</p>'}
            ${extra > 0 ? `<p style="text-align:center;font-size:0.74rem;color:var(--text-muted);padding:4px 0 8px">+${extra} more &mdash; view the full slot for complete list</p>` : ''}
          </div>
        </div>
      `;
    }
  }

  html += '</div>';
  container.innerHTML = html;

  // Wire up jump buttons
  container.querySelectorAll('.sb-partial-jump-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      jumpToSlot(btn.dataset.prog, btn.dataset.quota, btn.dataset.spec, btn.dataset.hosp);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// SLOT BROWSER — candidate search
// ═══════════════════════════════════════════════════════════════════
function setupSbCandSearch() {
  const input = document.getElementById('sbCandSearch');
  const btn   = document.getElementById('sbCandFindBtn');
  const clr   = document.getElementById('sbCandClearBtn');

  const doSearch = () => {
    const q = input?.value?.trim();
    if (!q) { clearSbCandidatePanel(); return; }
    sbSearchCandidate(q);
  };

  btn?.addEventListener('click', doSearch);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  clr?.addEventListener('click', () => {
    if (input) input.value = '';
    clearSbCandidatePanel();
    if (clr) clr.classList.add('hidden');
  });
}

function sbSearchCandidate(query) {
  const q = query.toLowerCase();
  const isIdSearch = /^\d+$/.test(query.trim());
  const matches = allCandidates().filter(c =>
    isIdSearch
      ? String(c.applicantId) === query.trim()
      : c.nameFull.toLowerCase().includes(q)
  );

  const panel = document.getElementById('sbCandPanel');
  const clr   = document.getElementById('sbCandClearBtn');
  if (!panel) return;
  if (clr) clr.classList.remove('hidden');

  if (!matches.length) {
    panel.innerHTML = `<p style="color:var(--neon-gold);font-size:0.82rem">No candidate found for "${esc(query)}".</p>`;
    panel.classList.remove('hidden');
    return;
  }

  if (matches.length === 1) {
    renderSbCandidatePanel(matches[0]);
    return;
  }

  // Multiple matches — show pick list
  panel.innerHTML = `
    <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">${matches.length} candidates match — select one:</p>
    <div class="sb-pick-list">
      ${matches.slice(0, 12).map(c =>
        `<button class="sb-pick-btn" data-id="${c.applicantId}">
          ${esc(c.nameFull.split(' ').slice(0, 3).join(' '))}
          <span style="opacity:0.5;font-size:0.88em"> (${c.applicantId})</span>
        </button>`).join('')}
      ${matches.length > 12
        ? `<span style="font-size:0.74rem;color:var(--text-muted);align-self:center">+${matches.length - 12} more — be more specific</span>`
        : ''}
    </div>
  `;
  panel.classList.remove('hidden');
  panel.querySelectorAll('.sb-pick-btn').forEach(b => {
    b.addEventListener('click', () => {
      const c = allCandidates().find(c => String(c.applicantId) === b.dataset.id);
      if (c) renderSbCandidatePanel(c);
    });
  });
}

function renderSbCandidatePanel(c) {
  const panel = document.getElementById('sbCandPanel');
  if (!panel) return;

  const prog  = SIM.sb.program || 'FCPS';
  const prefs = (c.preference?.[prog] || []).slice().sort((a, b) => a.preferenceNo - b.preferenceNo);

  SIM.sb.candidateId = String(c.applicantId);

  // Highlight in current slot view
  renderSlot();

  if (!prefs.length) {
    panel.innerHTML = `
      <div class="sb-cand-hdr">
        <span class="sb-cand-name">${esc(c.nameFull)}</span>
        <span class="sb-cand-meta">ID ${c.applicantId}</span>
        <button class="btn btn-sm" style="margin-left:auto" onclick="clearSbCandidatePanel()">✕ Clear</button>
      </div>
      <p style="font-size:0.8rem;color:var(--text-muted)">No ${esc(prog)} preferences found.</p>
    `;
    panel.classList.remove('hidden');
    return;
  }

  panel.innerHTML = `
    <div class="sb-cand-hdr">
      <span class="sb-cand-name">${esc(c.nameFull)}</span>
      <span class="sb-cand-meta">ID ${c.applicantId} &nbsp;·&nbsp; ${esc(prog)} marks: <strong>${fmtM(effectiveMark(c, prog))}</strong></span>
      <button class="btn btn-sm" style="margin-left:auto" id="sbClearPanelBtn">✕ Clear</button>
    </div>
    <p class="sb-cand-prefs-lbl">${prefs.length} ${esc(prog)} preferences — click any to jump to that slot and highlight this candidate:</p>
    <div class="sb-cand-prefs">
      ${prefs.map(p => `
        <button class="sb-jump-btn"
          data-prog="${esc(prog)}" data-quota="${esc(p.quotaName)}"
          data-spec="${esc(p.specialityName)}" data-hosp="${esc(p.hospitalName)}"
          title="${esc(p.quotaName)} · ${esc(p.specialityName)} · ${esc(p.hospitalName)}">
          <span class="pno">#${p.preferenceNo}</span>${esc(p.specialityName.split(' ').slice(0, 2).join(' '))}
          <span style="opacity:0.45;font-size:0.72em"> @ ${esc(p.hospitalName.split(',')[0])}</span>
        </button>`).join('')}
    </div>
  `;
  panel.classList.remove('hidden');

  panel.querySelector('#sbClearPanelBtn')?.addEventListener('click', () => {
    const input = document.getElementById('sbCandSearch');
    if (input) input.value = '';
    const clr = document.getElementById('sbCandClearBtn');
    if (clr) clr.classList.add('hidden');
    clearSbCandidatePanel();
  });

  panel.querySelectorAll('.sb-jump-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SIM.sb.candidateId = String(c.applicantId);
      jumpToSlot(btn.dataset.prog, btn.dataset.quota, btn.dataset.spec, btn.dataset.hosp);
    });
  });
}

function clearSbCandidatePanel() {
  const panel = document.getElementById('sbCandPanel');
  if (panel) { panel.innerHTML = ''; panel.classList.add('hidden'); }
  SIM.sb.candidateId = null;
  renderSlot();
}

// ═══════════════════════════════════════════════════════════════════
// SLOT BROWSER — candidate quick-view (click a row)
// ═══════════════════════════════════════════════════════════════════
function showSbCandQuickView(applicantId) {
  if (SIM.sb.clickedCandId === String(applicantId)) { closeSbModal(); return; }
  SIM.sb.clickedCandId = String(applicantId);
  renderSbQuickViewContent();
}

function closeSbModal() {
  SIM.sb.clickedCandId = null;
  document.getElementById('sbCandModal')?.classList.add('hidden');
}

function renderSbQuickViewContent() {
  const modal = document.getElementById('sbCandModal');
  const inner = document.getElementById('sbCandModalInner');
  if (!modal || !inner || !SIM.sb.clickedCandId) return;

  const { program, quota, spec, hosp } = SIM.sb;
  const c = allCandidates().find(c => String(c.applicantId) === SIM.sb.clickedCandId);
  if (!c) { modal.classList.add('hidden'); return; }

  const prefs = (c.preference?.[program] || []).slice().sort((a, b) => a.preferenceNo - b.preferenceNo);
  const marks = effectiveMark(c, program);

  const simCand = (SIM.sim.result && SIM.sim.program === program)
    ? SIM.sim.result.candidates.find(sc => String(sc.applicantId) === SIM.sb.clickedCandId)
    : null;
  const placedPrefNo = simCand?.placed
    ? (simCand._prefs?.find(p =>
        p.quotaName === simCand._q && p.specialityName === simCand._s && p.hospitalName === simCand._h
      )?.preferenceNo ?? null)
    : null;

  const simSummary = simCand
    ? (simCand.placed
        ? `<span class="sbqv-status-placed">&#10003; Pref #${placedPrefNo ?? '?'} &mdash; ${esc(simCand._s)} @ ${esc(simCand._h.split(',')[0].trim())}</span>`
        : `<span class="sbqv-status-unplaced">Not placed</span>`)
    : '';

  inner.innerHTML = `
    <div class="sbqv-header">
      <div class="sbqv-header-main">
        <span class="sbqv-name">${esc(c.nameFull)}</span>
        <span class="sbqv-meta">${esc(program)} &middot; ${fmtM(marks)}${simSummary ? ` &middot; ${simSummary}` : ''}</span>
      </div>
      <button class="sbqv-close" aria-label="Close">&#10005;</button>
    </div>
    <div class="sbqv-prefs">
      ${prefs.length ? prefs.map(p => {
        const isCurrent = p.quotaName === quota && p.specialityName === spec && p.hospitalName === hosp;
        const seats = SIM.seats?.[program]?.[p.quotaName]?.[p.specialityName]?.[p.hospitalName] ?? null;
        let statusTag = '';
        if (simCand) {
          if (simCand.placed && simCand._q === p.quotaName && simCand._s === p.specialityName && simCand._h === p.hospitalName) {
            statusTag = '<span class="sbqv-tag sbqv-tag-placed">&#10003; Selected</span>';
          } else if (simCand.placed && placedPrefNo !== null && p.preferenceNo > placedPrefNo) {
            statusTag = '<span class="sbqv-tag sbqv-tag-skip">&#8593; skipped</span>';
          } else if (simCand.placed) {
            statusTag = '<span class="sbqv-tag sbqv-tag-miss">not placed</span>';
          }
        }
        return `<div class="sbqv-pref-row${isCurrent ? ' sbqv-pref-current' : ''}">
          <span class="sbqv-pref-no">${p.preferenceNo}</span>
          <div class="sbqv-pref-info">
            <span class="sbqv-pref-spec">${esc(p.specialityName)}</span>
            <span class="sbqv-pref-hosp">${esc(p.hospitalName)}${isCurrent ? ' <span class="sbqv-viewing-tag">viewing</span>' : ''}</span>
            <span class="sbqv-pref-quota">${esc(p.quotaName)}${seats ? ` &middot; ${seats} seat${seats > 1 ? 's' : ''}` : ''}</span>
          </div>
          <div class="sbqv-pref-status">${statusTag}</div>
        </div>`;
      }).join('') : `<p style="padding:12px;font-size:0.82rem;color:var(--text-muted)">No ${esc(program)} preferences found.</p>`}
    </div>
  `;
  modal.classList.remove('hidden');
  inner.querySelector('.sbqv-close')?.addEventListener('click', closeSbModal);
  modal.onclick = e => { if (e.target === modal) closeSbModal(); };
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════
function renderNotifications() {
  const bar = document.getElementById('notifBar');
  if (!bar || !SIM.notifications?.length) return;
  const DISMISSED_KEY = 'mn_sim_dismissed_notifs';
  const dismissed = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
  const active = SIM.notifications.filter(n => n.active && !dismissed.includes(n.id));
  if (!active.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = active.map(n => `
    <div class="notif-item notif-${esc(n.type || 'info')}" data-notif-id="${esc(n.id)}">
      ${n.icon ? `<span class="notif-icon">${n.icon}</span>` : ''}
      <div class="notif-body">
        ${n.title ? `<div class="notif-title">${esc(n.title)}</div>` : ''}
        <div class="notif-text">${esc(n.body || '')}${
          n.link ? ` <a href="${esc(n.link)}" class="notif-link" target="_blank" rel="noopener noreferrer">${esc(n.linkText || 'Learn more')}</a>` : ''
        }</div>
      </div>
      ${n.dismissable ? `<button class="notif-dismiss" data-dismiss-id="${esc(n.id)}" title="Dismiss">&#10005;</button>` : ''}
    </div>
  `).join('');
  bar.querySelectorAll('.notif-dismiss').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.dismissId;
      const list = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
      list.push(id);
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(list));
      btn.closest('.notif-item')?.remove();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// PLACEMENT ALGORITHM  (faithful JS translation of merit.py)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build an empty seat tree from SIM.seats for the given program.
 * If SIM.seats not loaded, falls back to 1 seat per slot derived from prefs.
 */
function buildSeatTree(program) {
  if (SIM.seatsLoaded && SIM.seats[program]) {
    const tree = {};
    const ps = SIM.seats[program];
    for (const [q, specs] of Object.entries(ps)) {
      tree[q] = {};
      for (const [s, hosps] of Object.entries(specs)) {
        tree[q][s] = {};
        for (const [h, n] of Object.entries(hosps)) {
          tree[q][s][h] = { jobs: n, candidates: [], others: [] };
        }
      }
    }
    return tree;
  }
  // Fallback: 1 seat per unique slot found in preferences
  const tree = {};
  allCandidates().forEach(c => {
    (c.preference?.[program] || []).forEach(p => {
      tree[p.quotaName] ??= {};
      tree[p.quotaName][p.specialityName] ??= {};
      tree[p.quotaName][p.specialityName][p.hospitalName] ??= { jobs: 1, candidates: [], others: [] };
    });
  });
  return tree;
}

/**
 * Run the PRP placement algorithm.
 *
 * @param {Object[]} candidates - candidates filtered to this program
 * @param {Object}   seatTree   - {quota: {spec: {hosp: {jobs, candidates:[], others:[]}}}}
 * @param {string}   program    - program name for selecting program-specific marks
 * @param {boolean}  parentBonus - add pref.marks to effective marks if true
 * @returns {{ seatTree, candidates }}
 */
function runPlacement(candidates, seatTree, program, parentBonus = false) {
  // Working copies
  const prog = candidates.map(c => ({
    applicantId: c.applicantId,
    nameFull:    c.nameFull,
    marksTotal:  effectiveMark(c, program) ?? baseMarks(c),
    _prefs:      (c.preference?.[program] || [])
                   .slice().sort((a, b) => a.preferenceNo - b.preferenceNo),
    placed: false, _q: null, _s: null, _h: null,
  }));

  const slot   = (q, s, h) => seatTree?.[q]?.[s]?.[h];
  const effM   = (cand, pref) => cand.marksTotal + (parentBonus ? (pref.marks || 0) : 0);
  const entry  = (cand, pref) => ({
    applicantId:  cand.applicantId,
    nameFull:     cand.nameFull,
    marksTotal:   effM(cand, pref),
    preferenceNo: pref.preferenceNo,
  });

  let prevPlaced = -1;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const unplaced = prog.filter(c => !c.placed)
                        .sort((a, b) => b.marksTotal - a.marksTotal);
    if (!unplaced.length) break;

    let placed = 0;

    for (const cand of unplaced) {
      for (const pref of cand._prefs) {
        const sl = slot(pref.quotaName, pref.specialityName, pref.hospitalName);
        if (!sl) continue;

        const em = effM(cand, pref);

        if (sl.candidates.length < sl.jobs) {
          sl.candidates.push(entry(cand, pref));
          cand.placed = true;
          cand._q = pref.quotaName; cand._s = pref.specialityName; cand._h = pref.hospitalName;
          placed++;
          break;
        } else {
          const lowest = sl.candidates.reduce((m, c) => c.marksTotal < m.marksTotal ? c : m);
          if (em > lowest.marksTotal) {
            sl.candidates = sl.candidates.filter(
              c => String(c.applicantId) !== String(lowest.applicantId)
            );
            const evicted = prog.find(c => String(c.applicantId) === String(lowest.applicantId));
            if (evicted) {
              evicted.placed = false;
              evicted._q = evicted._s = evicted._h = null;
            }
            sl.candidates.push(entry(cand, pref));
            cand.placed = true;
            cand._q = pref.quotaName; cand._s = pref.specialityName; cand._h = pref.hospitalName;
            placed++;
            break;
          }
        }
      }
    }

    const total = prog.filter(c => c.placed).length;
    if (total === prevPlaced) break;
    prevPlaced = total;
  }

  // Build "others" list for each slot
  const isMe = id => String(id) === SIM.myId;
  for (const cand of prog) {
    const placedPrefNo = cand.placed
      ? cand._prefs.find(p =>
          p.quotaName === cand._q &&
          p.specialityName === cand._s &&
          p.hospitalName === cand._h
        )?.preferenceNo ?? null
      : null;
    for (const pref of cand._prefs) {
      const sl = slot(pref.quotaName, pref.specialityName, pref.hospitalName);
      if (!sl) continue;
      const inC = sl.candidates.some(c => String(c.applicantId) === String(cand.applicantId));
      const inO = sl.others.some(c => String(c.applicantId) === String(cand.applicantId));
      if (!inC && !inO) {
        sl.others.push({
          ...entry(cand, pref),
          placed:   cand.placed,
          placedAtHigherPref: (placedPrefNo !== null && placedPrefNo < pref.preferenceNo),
          placedAt: cand.placed ? { q: cand._q, s: cand._s, h: cand._h } : null,
        });
      }
    }
  }

  // Sort placed and others by marks desc
  for (const specs of Object.values(seatTree)) {
    for (const hosps of Object.values(specs)) {
      for (const sl of Object.values(hosps)) {
        sl.candidates.sort((a, b) => b.marksTotal - a.marksTotal);
        sl.others.sort((a, b) => b.marksTotal - a.marksTotal);
      }
    }
  }

  return { seatTree, candidates: prog };
}

// ═══════════════════════════════════════════════════════════════════
// SIMULATION TAB
// ═══════════════════════════════════════════════════════════════════
function setupSimulationTab() {
  document.getElementById('simProgram')?.addEventListener('change', e => {
    SIM.sim.program = e.target.value;
    SIM.sim.result  = null;
    document.getElementById('simResults').innerHTML = '';
  });

  document.getElementById('simParentBonus')?.addEventListener('change', e => {
    SIM.sim.parentBonus = e.target.checked;
  });

  document.getElementById('simFilter')?.addEventListener('input', e => {
    SIM.sim.filter = e.target.value.trim().toLowerCase();
    if (SIM.sim.result) renderSimResults();
  });

  document.getElementById('runSimBtn')?.addEventListener('click', runSimulation);
}

function runSimulation() {
  const prog  = SIM.sim.program;
  const cands = allCandidates().filter(c => effectiveMark(c, prog) != null);
  if (!cands.length) { showToast('No candidates for this program.', 'warning'); return; }

  const btn = document.getElementById('runSimBtn');
  btn.disabled = true; btn.textContent = 'Running…';

  // Defer so the browser has time to update the button state
  setTimeout(() => {
    try {
      const tree = buildSeatTree(prog);
      SIM.sim.result = runPlacement(cands, tree, prog, SIM.sim.parentBonus);
      renderSimResults();
    } catch (e) {
      showToast(`Simulation error: ${e.message}`, 'error');
      console.error(e);
    }
    btn.disabled = false; btn.textContent = '⚡ Run Simulation';
  }, 30);
}

function renderSimResults() {
  const { result, program, filter } = SIM.sim;
  if (!result) return;

  const { seatTree, candidates } = result;
  const container = document.getElementById('simResults');
  if (!container) return;

  // My result banner
  const me = SIM.myId ? candidates.find(c => String(c.applicantId) === SIM.myId) : null;
  let myHtml = '';
  if (me) {
    if (me.placed) {
      const prefNo = me._prefs?.find(p =>
        p.quotaName === me._q && p.specialityName === me._s && p.hospitalName === me._h
      )?.preferenceNo ?? '?';
      myHtml = `<div class="sim-my placed">
        ✅ <strong>Projected placement:</strong> ${esc(me._s)} at ${esc(me._h)}
        &nbsp;(${esc(me._q)} &middot; ${program} &middot; Pref #${prefNo})
      </div>`;
    } else {
      myHtml = `<div class="sim-my unplaced">
        ⚠️ <strong>Not placed</strong> in this simulation.
        All your preferences are full with higher-scoring candidates.
      </div>`;
    }
  }

  const placed  = candidates.filter(c => c.placed).length;
  const total   = candidates.length;

  // Flatten tree to rows, apply filter
  const rows = [];
  for (const [q, specs] of Object.entries(seatTree)) {
    for (const [s, hosps] of Object.entries(specs)) {
      for (const [h, sl] of Object.entries(hosps)) {
        if (filter) {
          const hay = `${s} ${h} ${q}`.toLowerCase();
          if (!hay.includes(filter)) continue;
        }
        const cutoff = sl.candidates.length
          ? Math.min(...sl.candidates.map(c => c.marksTotal))
          : null;
        const eligibleOthers = sl.others.filter(o => !o.placedAtHigherPref);
        const nextInLine = eligibleOthers.find(o => !o.placed) ?? eligibleOthers[0] ?? null;
        const skippedHigherPrefCount = sl.others.length - eligibleOthers.length;
        const meInSlot   = me ? sl.candidates.some(c => String(c.applicantId) === SIM.myId) : false;
        rows.push({ q, s, h, sl, cutoff, nextInLine, meInSlot, eligibleOthers, skippedHigherPrefCount });
      }
    }
  }
  rows.sort((a, b) => a.s.localeCompare(b.s) || a.h.localeCompare(b.h));

  const filledSlots = rows.filter(r => r.sl.candidates.length > 0).length;

  container.innerHTML = `
    ${myHtml}
    <div class="sim-summary card">
      <div class="sim-summary-grid">
        <div><span class="sim-sum-val">${placed.toLocaleString()}</span><span class="sim-sum-lbl">Placed</span></div>
        <div><span class="sim-sum-val">${(total - placed).toLocaleString()}</span><span class="sim-sum-lbl">Unplaced</span></div>
        <div><span class="sim-sum-val">${filledSlots}</span><span class="sim-sum-lbl">Slots filled</span></div>
        <div><span class="sim-sum-val">${rows.length}</span><span class="sim-sum-lbl">Total slots</span></div>
      </div>
    </div>
    <div class="sim-grid">
      ${rows.map(r => renderSimCard(r, program)).join('')}
    </div>
  `;

  container.querySelectorAll('.sim-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.sim-card');
      const expanded = card.classList.toggle('expanded');
      btn.textContent = expanded ? '▲ Fewer' : `▼ ${btn.dataset.count} others`;
    });
  });

  // Delegate clicks on candidate rows → open placement detail modal
  container.addEventListener('click', e => {
    const el = e.target.closest('[data-sim-cand]');
    if (el) openSimCandidateDetail(el.dataset.simCand);
  });
}

function renderSimCard({ q, s, h, sl, cutoff, nextInLine, meInSlot, eligibleOthers, skippedHigherPrefCount }, program) {
  const isMe    = id => String(id) === SIM.myId;
  const seats   = sl.jobs;
  const filled  = sl.candidates.length;
  const vacancy = Math.max(0, seats - filled);

  return `<div class="sim-card ${meInSlot ? 'sim-card-me' : ''} ${vacancy > 0 ? 'sim-card-open' : ''}">
    <div class="sim-card-head">
      <div class="sim-card-title">
        <span class="sim-card-spec">${esc(s)}</span>
        <span class="sim-card-hosp">${esc(h)}</span>
        <span class="sim-card-meta">${esc(program)} &middot; ${esc(q)}</span>
      </div>
      <div class="sim-card-badges">
        <span class="sim-badge ${vacancy > 0 ? 'badge-open' : 'badge-full'}">${filled}/${seats}</span>
        ${cutoff !== null ? `<span class="sim-badge badge-cutoff">Cutoff: ${fmtM(cutoff)}</span>` : ''}
      </div>
    </div>

    <div class="sim-placed">
      ${sl.candidates.length
        ? sl.candidates.map(c => `
          <div class="sim-row ${isMe(c.applicantId) ? 'sim-row-me' : ''}" data-sim-cand="${c.applicantId}">
            <span class="sim-row-name">${esc(c.nameFull)}${isMe(c.applicantId) ? ' <span class="me-tag">YOU</span>' : ''}</span>
            <span class="sim-row-marks">${fmtM(c.marksTotal)}</span>
            <span class="sim-row-pref">P${c.preferenceNo}</span>
          </div>`).join('')
        : '<span class="sim-empty-slot">— no placements —</span>'
      }
    </div>

    ${nextInLine ? `
    <div class="sim-next-line ${isMe(nextInLine.applicantId) ? 'sim-next-me' : ''} ${nextInLine.placed ? 'sim-next-placed-elsewhere' : ''}" data-sim-cand="${nextInLine.applicantId}">
      <span class="sim-next-lbl">${nextInLine.placed ? 'Best applicant:' : 'Next in line:'}</span>
      <span class="sim-next-name">${esc(nextInLine.nameFull)}${isMe(nextInLine.applicantId) ? ' <span class="me-tag">YOU</span>' : ''}${nextInLine.placed ? ` <span class="custom-tag">→ ${esc(nextInLine.placedAt?.s ?? '?')}</span>` : ''}</span>
      <span class="sim-next-marks">${fmtM(nextInLine.marksTotal)}</span>
    </div>` : ''}

    ${eligibleOthers.length ? `
    <button class="btn btn-sm sim-expand-btn" data-count="${eligibleOthers.length}">▼ ${eligibleOthers.length} others</button>
    <div class="sim-others">
      ${eligibleOthers.map(o => `
        <div class="sim-other-row ${isMe(o.applicantId) ? 'sim-row-me' : ''}" data-sim-cand="${o.applicantId}">
          <span class="sim-other-name">${esc(o.nameFull)}${isMe(o.applicantId) ? ' <span class="me-tag">YOU</span>' : ''}</span>
          <span class="sim-other-marks">${fmtM(o.marksTotal)}</span>
          <span class="sim-other-status">${o.placed ? `→ ${esc(o.placedAt?.s ?? o.placedAt?.h ?? '?')}` : 'unplaced'}</span>
        </div>`).join('')}
    </div>` : ''}
    ${skippedHigherPrefCount ? `<div class="sim-empty-slot">${skippedHigherPrefCount} hidden (already placed at higher preferences)</div>` : ''}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

// ── Simulation candidate detail ──────────────────────────────────

/**
 * For a working candidate from runPlacement, compute per-preference history
 * based on the final seatTree state after convergence.
 *
 * Each entry: { pref, status, cutoff?, capacity? }
 * status: 'placed' | 'beaten' | 'not_attempted' | 'no_slot'
 */
function computeCandidateHistory(workCand, seatTree) {
  const placedPref = workCand.placed
    ? workCand._prefs.find(p =>
        p.quotaName       === workCand._q &&
        p.specialityName  === workCand._s &&
        p.hospitalName    === workCand._h)
    : null;
  const placedPrefNo = placedPref?.preferenceNo ?? Infinity;

  const history = [];
  for (const pref of workCand._prefs) {
    const sl = seatTree?.[pref.quotaName]?.[pref.specialityName]?.[pref.hospitalName];

    if (!sl) {
      history.push({ pref, status: 'no_slot' });
      continue;
    }

    const isPlacedHere =
      workCand.placed &&
      pref.quotaName      === workCand._q &&
      pref.specialityName === workCand._s &&
      pref.hospitalName   === workCand._h;

    if (isPlacedHere) {
      history.push({ pref, status: 'placed' });
      break; // remaining prefs are 'not_attempted'
    }

    if (pref.preferenceNo > placedPrefNo) {
      // Already placed at a better (earlier) preference
      history.push({ pref, status: 'not_attempted' });
      continue;
    }

    // Slot full or partial — determine cutoff
    const cutoff = sl.candidates.length > 0
      ? Math.min(...sl.candidates.map(c => c.marksTotal))
      : null;

    history.push({
      pref,
      status:   'beaten',
      cutoff:   cutoff,
      capacity: sl.jobs,
      filled:   sl.candidates.length,
    });
  }

  return history;
}

function openSimCandidateDetail(applicantId) {
  if (!SIM.sim.result) return;
  const { seatTree, candidates } = SIM.sim.result;
  const prog = SIM.sim.program;

  const workCand = candidates.find(c => String(c.applicantId) === String(applicantId));
  const origCand = allCandidates().find(c => String(c.applicantId) === String(applicantId));
  if (!workCand || !origCand) return;

  const history      = computeCandidateHistory(workCand, seatTree);
  const isMe         = String(applicantId) === SIM.myId;
  const modal        = document.getElementById('candidateModal');
  const body         = document.getElementById('candidateModalBody');
  if (!modal || !body) return;

  // Placement banner
  let banner;
  if (workCand.placed) {
    const prefNo = workCand._prefs.find(p =>
      p.quotaName      === workCand._q &&
      p.specialityName === workCand._s &&
      p.hospitalName   === workCand._h
    )?.preferenceNo ?? '?';
    banner = `<div class="sim-my placed" style="margin-bottom:16px">
      ✅ <strong>Placed:</strong> ${esc(workCand._s)}
      <span style="opacity:0.75"> @ ${esc(workCand._h)}</span>
      &nbsp;·&nbsp; <span style="font-size:0.86em;opacity:0.8">${esc(workCand._q)} &nbsp;·&nbsp; Preference #${prefNo}</span>
    </div>`;
  } else {
    banner = `<div class="sim-my unplaced" style="margin-bottom:16px">
      ⚠️ <strong>Not placed.</strong>
      All ${workCand._prefs.length} preferences were filled by higher-scoring candidates.
    </div>`;
  }

  // History rows
  const notAttempted = workCand._prefs.length - history.length;
  const histRows = history.map(h => {
    const { pref, status } = h;
    let icon, detail, cls;

    if (status === 'placed') {
      icon = '✅'; cls = 'sim-hist-placed';
      detail = '<strong>Placed here</strong>';
    } else if (status === 'beaten') {
      icon = '✗'; cls = 'sim-hist-beaten';
      const cutoffStr = h.cutoff != null ? fmtM(h.cutoff) : '—';
      detail = `Cutoff: <strong style="color:#e05470">${cutoffStr}</strong>`;
      if (h.capacity != null) detail += `<br><span style="opacity:0.65">${h.filled}/${h.capacity} seats</span>`;
    } else if (status === 'not_attempted') {
      icon = '⏭'; cls = 'sim-hist-skip';
      detail = 'Already placed at better pref';
    } else {
      icon = '—'; cls = 'sim-hist-nodata';
      detail = 'No seat data';
    }

    return `<div class="sim-hist-row ${cls}">
      <span class="sim-hist-icon">${icon}</span>
      <span class="sim-hist-no">#${pref.preferenceNo}</span>
      <div class="sim-hist-slot">
        <span class="sim-hist-spec">${esc(pref.specialityName)}</span>
        <span class="sim-hist-hosp">${esc(pref.hospitalName)}</span>
        <span class="sim-hist-quota">${esc(pref.quotaName)}</span>
      </div>
      <span class="sim-hist-detail">${detail}</span>
    </div>`;
  }).join('');

  const notAttemptedRow = notAttempted > 0
    ? `<div class="sim-hist-row sim-hist-skip" style="opacity:0.35">
        <span class="sim-hist-icon">⏭</span>
        <span style="font-size:0.77rem;color:var(--text-muted);grid-column:2/-1">
          ${notAttempted} lower preference${notAttempted > 1 ? 's' : ''} not attempted (placed at an earlier preference)
        </span>
      </div>`
    : '';

  body.innerHTML = `
    <div class="cand-detail-hdr">
      <h3>${esc(origCand.nameFull)} ${isMe ? '<span class="me-tag">YOU</span>' : ''}</h3>
      <p class="cand-detail-meta">
        ID: ${origCand.applicantId}
        &nbsp;·&nbsp; ${esc(prog)} marks: <strong>${fmtM(workCand.marksTotal)}</strong>
      </p>
    </div>
    ${banner}
    <p class="sim-hist-section-lbl">Preference-by-preference breakdown (${esc(prog)})</p>
    <div class="sim-hist-list">
      ${histRows || '<p style="color:var(--text-muted);font-size:0.82rem">No preferences recorded.</p>'}
      ${notAttemptedRow}
    </div>
  `;

  modal.classList.remove('hidden');
}

/**
 * Base marks for a candidate — the raw marksTotal.
 * marksTotal is already the sum of housejob + position + degree + MDCAT (etc.)
 * and does NOT include experience, so no subtraction is needed.
 */
function baseMarks(c) {
  return (c.marksTotal ?? 0);
}

/**
 * Effective marks for a candidate in a specific program.
 * = baseMarks(c) + programMarks[program]  (programMarks is a per-program bonus)
 * Returns null when applied_in[program] is false (candidate did not apply).
 * A candidate may have applied_in=true but programMarks=0 (0 bonus) — they
 * are still valid and ranked on baseMarks alone.
 */
function effectiveMark(c, program) {
  if (!c.applied_in?.[program]) return null;   // did not apply
  return baseMarks(c) + (c.programMarks?.[program] ?? 0);
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtM(v) {
  if (v == null || v === '') return '—';
  const n = parseFloat(v);
  return isNaN(n) ? '—' : n.toFixed(2);
}

function renderPagination(containerId, total, page, pageSize, onPage) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = page > 0 ? `<button class="page-btn" data-p="${page - 1}">‹ Prev</button>` : '';
  html += `<span class="page-info">Page ${page + 1} of ${pages}</span>`;
  if (page < pages - 1) html += `<button class="page-btn" data-p="${page + 1}">Next ›</button>`;
  el.innerHTML = html;
  el.querySelectorAll('.page-btn').forEach(b =>
    b.addEventListener('click', () => onPage(+b.dataset.p))
  );
}

let _toastTimer = null;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} toast-visible`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('toast-visible'), 3500);
}

// ═══════════════════════════════════════════════════════════════════
// URL PARAM HANDLER  — ?tab=seatmatrix etc.
// ═══════════════════════════════════════════════════════════════════
function handleSimURLParams() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (!tab) return;
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!btn) return;
  document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  SIM.activeTab = tab;
  // Trigger lazy renderers so URL-directed tabs aren't stuck on placeholders
  if (tab === 'seatmatrix')  renderSeatMatrixTab();
  if (tab === 'competition') renderCompetitionTab();
  if (tab === 'hospitals')   renderHospitalsTab();
  if (tab === 'profiles')    renderProfilesTab();
}

// ═══════════════════════════════════════════════════════════════════
// TRAINING SEATS TAB
// ═══════════════════════════════════════════════════════════════════
let _smSetup = false;

function renderSeatMatrixTab() {
  const seats = SIM.flatSeats;
  if (!seats.length) {
    document.getElementById('smResults').innerHTML =
      '<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)">Seat data not loaded.</div>';
    return;
  }

  if (!_smSetup) {
    // Populate filter dropdowns
    const programs = [...new Set(seats.map(s => s.typeName))].filter(Boolean).sort();
    const quotas   = [...new Set(seats.map(s => s.quotaName))].filter(Boolean).sort();
    const smProg  = document.getElementById('smProgram');
    const smQuota = document.getElementById('smQuota');
    programs.forEach(p => { const o = document.createElement('option'); o.value = o.textContent = p; smProg.appendChild(o); });
    quotas.forEach(q => {   const o = document.createElement('option'); o.value = o.textContent = q; smQuota.appendChild(o); });
    smProg.addEventListener('change',  renderSeatMatrixTab);
    smQuota.addEventListener('change', renderSeatMatrixTab);
    document.getElementById('smSearch').addEventListener('input', renderSeatMatrixTab);
    _smSetup = true;
  }

  const prog   = document.getElementById('smProgram').value;
  const quota  = document.getElementById('smQuota').value;
  const search = (document.getElementById('smSearch').value || '').toLowerCase();

  const filtered = seats.filter(s =>
    (!prog  || s.typeName === prog) &&
    (!quota || s.quotaName === quota) &&
    (!search || s.specialityName.toLowerCase().includes(search) || s.hospitalName.toLowerCase().includes(search))
  );

  // Group by specialty
  const bySpec = {};
  for (const s of filtered) {
    if (!bySpec[s.specialityName]) bySpec[s.specialityName] = { total: 0, rows: [] };
    bySpec[s.specialityName].total += s.seats;
    bySpec[s.specialityName].rows.push(s);
  }

  const totalSeats  = filtered.reduce((sum, s) => sum + s.seats, 0);
  const totalHospitals = new Set(filtered.map(s => s.hospitalName)).size;
  const specCount   = Object.keys(bySpec).length;

  // Summary bar
  const summary = document.getElementById('smSummary');
  summary.style.display = '';
  summary.innerHTML = `
    <div class="card" style="padding:1rem;">
      <div style="display:flex;gap:2rem;flex-wrap:wrap;font-size:0.85rem;">
        <div><strong style="color:var(--neon-cyan);">${totalSeats.toLocaleString()}</strong> total seats</div>
        <div><strong style="color:var(--neon-purple);">${specCount}</strong> specialties</div>
        <div><strong style="color:var(--neon-green);">${totalHospitals}</strong> hospitals</div>
        <div><strong>${filtered.length}</strong> slots</div>
      </div>
    </div>`;

  const cards = Object.entries(bySpec).sort((a, b) => a[0].localeCompare(b[0])).map(([spec, d]) => {
    const hospRows = d.rows.sort((a, b) => b.seats - a.seats).map(h => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:0.8rem;">${esc(h.hospitalName)}</span>
        <span style="font-size:0.8rem;font-weight:700;color:var(--neon-cyan);min-width:30px;text-align:right;">${h.seats}</span>
      </div>`).join('');
    return `<div class="card" style="margin-bottom:0.75rem;padding:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <strong style="font-size:0.92rem;">${esc(spec)}</strong>
        <span style="background:rgba(77,184,217,0.1);color:var(--neon-cyan);padding:2px 10px;border-radius:100px;font-weight:700;font-size:0.82rem;">${d.total} seats</span>
      </div>
      <div style="max-height:200px;overflow-y:auto;">${hospRows}</div>
    </div>`;
  }).join('');

  document.getElementById('smResults').innerHTML =
    cards || '<div style="text-align:center;color:var(--text-muted);padding:2rem;">No seats found.</div>';
}

// ═══════════════════════════════════════════════════════════════════
// COMPETITION TAB
// ═══════════════════════════════════════════════════════════════════
let _compData  = null;
let _compSetup = false;

function buildCompetitionData() {
  if (_compData) return _compData;
  const seats      = SIM.flatSeats;
  const candidates = SIM.candidates;
  if (!seats.length || !candidates.length) return null;

  // Build seat lookup: prog|quota|specialty → seats
  const seatMap = {};
  for (const s of seats) {
    const key = `${s.typeName}|${s.quotaName}|${s.specialityName}`;
    seatMap[key] = (seatMap[key] || 0) + s.seats;
  }

  // Count applicants per slot (unique per candidate)
  const applicantMap = {};
  for (const c of candidates) {
    if (!c.preference) continue;
    for (const [prog, prefs] of Object.entries(c.preference)) {
      const seen = new Set();
      for (const p of prefs) {
        const key = `${prog}|${p.quotaName}|${p.specialityName}`;
        if (!seen.has(key)) { seen.add(key); applicantMap[key] = (applicantMap[key] || 0) + 1; }
      }
    }
  }

  const allKeys = new Set([...Object.keys(seatMap), ...Object.keys(applicantMap)]);
  _compData = [];
  for (const key of allKeys) {
    const [prog, quota, specialty] = key.split('|');
    const totalSeats = seatMap[key] || 0;
    const applicants = applicantMap[key] || 0;
    const ratio = totalSeats > 0 ? applicants / totalSeats : (applicants > 0 ? Infinity : 0);
    _compData.push({ prog, quota, specialty, totalSeats, applicants, ratio });
  }
  return _compData;
}

function renderCompetitionTab() {
  const container = document.getElementById('compResults');
  const data = buildCompetitionData();
  if (!data) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)">Competition data unavailable. Candidates or seat data not loaded.</div>';
    return;
  }

  if (!_compSetup) {
    const programs = [...new Set(SIM.flatSeats.map(s => s.typeName))].filter(Boolean).sort();
    const quotas   = [...new Set(SIM.flatSeats.map(s => s.quotaName))].filter(Boolean).sort();
    const cp = document.getElementById('compProgram');
    const cq = document.getElementById('compQuota');
    programs.forEach(p => { const o = document.createElement('option'); o.value = o.textContent = p; cp.appendChild(o); });
    quotas.forEach(q => {   const o = document.createElement('option'); o.value = o.textContent = q; cq.appendChild(o); });
    cp.addEventListener('change',  renderCompetitionTab);
    cq.addEventListener('change',  renderCompetitionTab);
    document.getElementById('compSearch').addEventListener('input',  renderCompetitionTab);
    document.getElementById('compSort').addEventListener('change', renderCompetitionTab);
    _compSetup = true;
  }

  const prog   = document.getElementById('compProgram').value;
  const quota  = document.getElementById('compQuota').value;
  const search = (document.getElementById('compSearch').value || '').toLowerCase();
  const sort   = document.getElementById('compSort').value;

  let filtered = data.filter(r =>
    (!prog  || r.prog === prog) &&
    (!quota || r.quota === quota) &&
    (!search || r.specialty.toLowerCase().includes(search))
  );

  if (sort === 'ratio-desc')       filtered.sort((a, b) => b.ratio - a.ratio);
  else if (sort === 'ratio-asc')   filtered.sort((a, b) => a.ratio - b.ratio);
  else if (sort === 'specialty')   filtered.sort((a, b) => a.specialty.localeCompare(b.specialty));
  else if (sort === 'applicants-desc') filtered.sort((a, b) => b.applicants - a.applicants);

  if (!filtered.length) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)">No results.</div>';
    return;
  }

  const totalApps  = filtered.reduce((s, r) => s + r.applicants, 0);
  const totalSeats = filtered.reduce((s, r) => s + r.totalSeats, 0);
  const avgRatio   = totalSeats > 0 ? (totalApps / totalSeats).toFixed(1) : '—';
  const finite     = filtered.filter(r => isFinite(r.ratio)).map(r => r.ratio);
  const maxRatio   = finite.length ? Math.max(...finite) : 1;

  const rows = filtered.slice(0, 150).map(r => {
    const ratioStr  = r.ratio === Infinity ? '∞' : r.ratio.toFixed(1);
    const barW      = maxRatio > 0 ? Math.min(100, ((isFinite(r.ratio) ? r.ratio : maxRatio) / maxRatio) * 100) : 0;
    const heatColor = r.ratio > 10 ? '#dc3c3c' : r.ratio > 5 ? 'var(--neon-gold)' : 'var(--neon-green)';
    return `<tr>
      <td>${esc(r.specialty)}</td><td>${esc(r.prog)}</td><td>${esc(r.quota)}</td>
      <td style="text-align:right">${r.totalSeats}</td>
      <td style="text-align:right">${r.applicants}</td>
      <td style="text-align:right;font-weight:700;color:${heatColor};">${ratioStr}:1</td>
      <td><div style="background:${heatColor};height:8px;border-radius:4px;width:${barW}%;opacity:0.7;"></div></td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card" style="margin-bottom:1rem;padding:1rem;">
      <div style="display:flex;gap:2rem;flex-wrap:wrap;font-size:0.85rem;">
        <div><strong style="color:var(--neon-cyan);">${filtered.length}</strong> specialties shown</div>
        <div>Total seats: <strong>${totalSeats.toLocaleString()}</strong></div>
        <div>Total applications: <strong>${totalApps.toLocaleString()}</strong></div>
        <div>Average ratio: <strong>${avgRatio}:1</strong></div>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Specialty</th><th>Program</th><th>Quota</th>
          <th style="text-align:right">Seats</th><th style="text-align:right">Applicants</th>
          <th style="text-align:right">Ratio</th><th>Demand</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${filtered.length > 150 ? '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.5rem;">Showing top 150 results.</p>' : ''}`;
}

// ═══════════════════════════════════════════════════════════════════
// HOSPITALS TAB
// ═══════════════════════════════════════════════════════════════════
let _hospData       = null;
let _hospSearchWired = false;

function renderHospitalsTab() {
  const grid = document.getElementById('hospTabGrid');
  if (!grid) return;

  if (!_hospData) {
    const seats = SIM.flatSeats;
    if (!seats.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">Seat data not loaded.</div>';
      return;
    }
    const map = {};
    for (const s of seats) {
      const id = s.hospitalId ?? s.hospitalName;
      if (!map[id]) map[id] = { id, name: s.hospitalName, specialties: new Set(), types: new Set(), totalSeats: 0 };
      map[id].specialties.add(s.specialityName);
      map[id].types.add(s.typeName);
      map[id].totalSeats += s.seats;
    }
    _hospData = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }

  if (!_hospSearchWired) {
    const inp = document.getElementById('hospTabSearch');
    if (inp) inp.addEventListener('input', function () {
      const q = this.value.trim().toLowerCase();
      renderHospGrid(q ? _hospData.filter(h => h.name.toLowerCase().includes(q)) : _hospData);
    });
    _hospSearchWired = true;
  }

  renderHospGrid(_hospData);
}

function renderHospGrid(hospitals) {
  const grid = document.getElementById('hospTabGrid');
  if (!grid) return;
  if (!hospitals.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">No hospitals found.</div>';
    return;
  }
  grid.innerHTML = hospitals.map(h => {
    const types = Array.from(h.types).sort().join(', ');
    const specs = Array.from(h.specialties).sort().join(', ');
    return `<a href="hospital.html?id=${encodeURIComponent(h.id)}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.2rem 1.4rem;text-decoration:none;color:var(--text);display:flex;flex-direction:column;gap:0.6rem;transition:border-color 0.2s,transform 0.15s;" onmouseover="this.style.borderColor='var(--border-hover)';this.style.transform='translateY(-2px)';" onmouseout="this.style.borderColor='var(--border)';this.style.transform='';">
      <div style="font-size:1rem;font-weight:700;color:var(--neon-cyan);line-height:1.3;">${esc(h.name)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;font-size:0.78rem;">
        <span style="padding:2px 8px;border-radius:100px;border:1px solid rgba(62,207,142,0.3);background:rgba(62,207,142,0.07);color:var(--neon-green);">&#129681; ${h.totalSeats} seats</span>
        <span style="padding:2px 8px;border-radius:100px;border:1px solid rgba(124,101,196,0.3);background:rgba(124,101,196,0.07);color:var(--neon-purple);">&#129657; ${h.specialties.size} specialties</span>
        <span style="padding:2px 8px;border-radius:100px;border:1px solid rgba(232,166,39,0.3);background:rgba(232,166,39,0.07);color:var(--neon-gold);">&#128220; ${esc(types)}</span>
      </div>
      <div style="font-size:0.77rem;color:var(--text-muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(specs)}</div>
    </a>`;
  }).join('');
}


// ═══════════════════════════════════════════════════════════════════
// COMMUNITY PROFILES TAB
// ═══════════════════════════════════════════════════════════════════
let _profilesLoaded = false;
let _allProfiles = [];
let _profilesWired = false;
// Pre-computed merit rankings: Map<applicantId string, {rank, total, pctile, tier, tierColor, programs}>
let _meritRankCache = new Map();

function _buildMeritCache() {
  if (!SIM.candidates?.length) return;
  const sorted = SIM.candidates.slice().sort((a, b) => (b.marksTotal ?? 0) - (a.marksTotal ?? 0));
  const total = sorted.length;
  _meritRankCache.clear();
  sorted.forEach((c, idx) => {
    const rank   = idx + 1;
    const pctile = Math.round(((total - rank) / total) * 100);
    let tier, tierColor;
    if (pctile >= 95)      { tier = 'Top 5%';    tierColor = '#3ecf8e'; }
    else if (pctile >= 90) { tier = 'Top 10%';   tierColor = '#3ecf8e'; }
    else if (pctile >= 75) { tier = 'Top 25%';   tierColor = '#4db8d9'; }
    else if (pctile >= 50) { tier = 'Top 50%';   tierColor = '#4db8d9'; }
    else                   { tier = 'Lower 50%'; tierColor = '#a0a0b0'; }
    const programs = ['FCPS','MS','MD'].filter(prog => c.applied_in?.[prog]);
    _meritRankCache.set(String(c.applicantId), { rank, total, pctile, tier, tierColor, programs });
  });
}

async function renderProfilesTab() {
  const grid = document.getElementById('profilesGrid');
  if (!grid) return;

  // Wire search/filter controls once
  if (!_profilesWired) {
    const searchEl = document.getElementById('profilesSearch');
    const statusEl = document.getElementById('profilesStatusFilter');
    if (searchEl) searchEl.addEventListener('input', _applyProfileFilters);
    if (statusEl) statusEl.addEventListener('change', _applyProfileFilters);
    _profilesWired = true;
  }

  if (_profilesLoaded) { _applyProfileFilters(); return; }

  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">Loading profiles…</div>';

  try {
    const db = firebase.firestore();
    const [profilesSnap, adminsSnap] = await Promise.all([
      db.collection('user_profiles').orderBy('updatedAt', 'desc').get(),
      db.collection('authorized_users').where('isAdmin', '==', true).get(),
    ]);
    const adminEmails = new Set(adminsSnap.docs.map(d => d.id));
    const allProfileDocs = profilesSnap.docs.map(d => ({ email: d.id, isAdmin: adminEmails.has(d.id), ...d.data() }));
    const totalWithData  = allProfileDocs.filter(p => p.name || p.specialty || p.hospital).length;
    _allProfiles = allProfileDocs.filter(p => p.isPublic && (p.name || p.specialty || p.hospital));
    const privateCount = totalWithData - _allProfiles.length;

    // Build merit rank cache once (O(n log n) sort, done here not per click)
    _buildMeritCache();

    // Show private-profile ticker
    if (privateCount > 0) {
      const ticker = document.getElementById('profilesTicker');
      const tickerText = document.getElementById('profilesTickerText');
      if (ticker && tickerText) {
        tickerText.textContent = `${privateCount} member${privateCount !== 1 ? 's have' : ' has'} a profile but ${privateCount !== 1 ? 'have' : 'has'} set it to private. Only public profiles are shown below.`;
        ticker.style.display = '';
      }
    }

    _profilesLoaded = true;
    _applyProfileFilters();
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">Could not load profiles — ${esc(e.message)}</div>`;
  }
}

function _applyProfileFilters() {
  const q      = (document.getElementById('profilesSearch')?.value || '').trim().toLowerCase();
  const status = document.getElementById('profilesStatusFilter')?.value || '';

  let list = _allProfiles;
  if (q) {
    list = list.filter(p =>
      (p.name      || '').toLowerCase().includes(q) ||
      (p.specialty || '').toLowerCase().includes(q) ||
      (p.hospital  || '').toLowerCase().includes(q)
    );
  }
  if (status === 'inducted')  list = list.filter(p => p.inducted);
  if (status === 'applicant') list = list.filter(p => !p.inducted);

  _renderProfileGrid(list);
}

// Returns pre-computed merit insight for a profile (O(1) lookup, no re-sort per click)
function _profileMeritInsight(p) {
  if (!p.applicantId) return null;
  return _meritRankCache.get(String(p.applicantId)) ?? null;
}

function _renderProfileGrid(profiles) {
  const grid = document.getElementById('profilesGrid');
  if (!grid) return;

  if (!profiles.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">No profiles match your search.</div>';
    return;
  }

  grid.innerHTML = profiles.map((p, i) => {
    const initial = (p.name || p.email || '?').charAt(0).toUpperCase();
    const hue = p.profileHue ?? 205;
    const avatarBorder = p.profilePicBase64
      ? `border:2px solid rgba(77,184,217,0.4)`
      : `border:2px solid hsl(${hue},60%,55%)`;
    const avatarBg = p.profilePicBase64
      ? ''
      : `background:linear-gradient(135deg,hsla(${hue},60%,50%,0.2),hsla(${hue+60},60%,50%,0.15));`;
    const avatarHtml = p.profilePicBase64
      ? `<img src="${p.profilePicBase64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="" />`
      : `<span style="font-size:1.3rem;font-weight:700;color:hsl(${hue},70%,65%);">${esc(initial)}</span>`;

    const statusTag = p.inducted
      ? `<span style="padding:2px 8px;border-radius:100px;background:rgba(62,207,142,0.1);border:1px solid rgba(62,207,142,0.25);color:var(--neon-green);font-size:0.68rem;font-weight:700;">✔ Ind.${p.inductionYear ? ' ' + esc(String(p.inductionYear)) : ''}</span>`
      : `<span style="padding:2px 8px;border-radius:100px;background:rgba(77,184,217,0.08);border:1px solid rgba(77,184,217,0.2);color:var(--neon-cyan);font-size:0.68rem;font-weight:700;">Applicant</span>`;
    const adminBadge = p.isAdmin
      ? `<span style="padding:2px 7px;border-radius:100px;background:rgba(232,166,39,0.12);border:1px solid rgba(232,166,39,0.35);color:var(--neon-gold,#e8a627);font-size:0.65rem;font-weight:700;">⚡ Admin</span>`
      : '';

    // Merit insight (only if candidate data loaded)
    const insight = _profileMeritInsight(p);
    const tierPill = insight
      ? `<span style="padding:2px 8px;border-radius:100px;background:rgba(0,0,0,0.2);border:1px solid ${insight.tierColor}44;color:${insight.tierColor};font-size:0.65rem;font-weight:700;">📊 ${insight.tier}</span>`
      : '';

    const progPills = insight?.programs.length
      ? insight.programs.map(pr =>
          `<span style="padding:2px 6px;border-radius:4px;background:rgba(124,101,196,0.1);border:1px solid rgba(124,101,196,0.25);color:var(--neon-purple,#7c65c4);font-size:0.65rem;font-weight:600;">${pr}</span>`
        ).join('')
      : '';

    const specialty = p.specialty ? `<div style="display:flex;align-items:center;gap:0.35rem;font-size:0.78rem;color:var(--text-muted);">🩺 <span style="color:var(--text);">${esc(p.specialty)}</span></div>` : '';
    const hospital  = p.hospital  ? `<div style="display:flex;align-items:center;gap:0.35rem;font-size:0.78rem;color:var(--text-muted);">🏥 <span style="color:var(--text-muted);">${esc(p.hospital)}</span></div>` : '';

    return `<div data-pidx="${i}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.1rem 1.2rem;display:flex;flex-direction:column;gap:0.6rem;cursor:pointer;transition:border-color 0.18s,transform 0.15s,box-shadow 0.18s;" onmouseover="this.style.borderColor='hsl(${hue},50%,45%)';this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 24px rgba(0,0,0,0.3)';" onmouseout="this.style.borderColor='var(--border)';this.style.transform='';this.style.boxShadow='';">
      <div style="display:flex;align-items:center;gap:0.8rem;">
        <div style="width:48px;height:48px;border-radius:50%;${avatarBg}${avatarBorder};flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">${avatarHtml}</div>
        <div style="min-width:0;flex:1;">
          <div style="font-size:0.92rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:0.3rem;">${esc(p.name || '(no name)')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:0.28rem;">${statusTag}${adminBadge}${tierPill}</div>
        </div>
      </div>
      ${specialty || hospital ? `<div style="display:flex;flex-direction:column;gap:0.18rem;padding-top:0.15rem;border-top:1px solid rgba(255,255,255,0.04);">${specialty}${hospital}</div>` : ''}
      ${progPills ? `<div style="display:flex;gap:0.3rem;flex-wrap:wrap;">${progPills}</div>` : ''}
    </div>`;
  }).join('');

  // Click to open profile modal
  grid.querySelectorAll('[data-pidx]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.pidx, 10);
      _showProfileModal(_allProfiles[idx]);
    });
  });
}

function _showProfileModal(p) {
  const modal = document.getElementById('profileViewModal');
  const sheet = document.getElementById('profileViewSheet');
  if (!modal || !sheet || !p) return;

  const initial = (p.name || p.email || '?').charAt(0).toUpperCase();
  const hue = p.profileHue ?? 205;
  const avatarBg = p.profilePicBase64
    ? ''
    : `background:linear-gradient(135deg,hsla(${hue},60%,50%,0.22),hsla(${hue+60},60%,50%,0.15));`;
  const avatarBorder = `border:2px solid hsl(${hue},55%,50%)`;
  const avatarHtml = p.profilePicBase64
    ? `<img src="${p.profilePicBase64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="" />`
    : `<span style="font-size:2rem;font-weight:700;color:hsl(${hue},70%,65%);">${esc(initial)}</span>`;

  const statusTag = p.inducted
    ? `<span style="padding:3px 11px;border-radius:100px;background:rgba(62,207,142,0.12);border:1px solid rgba(62,207,142,0.3);color:var(--neon-green);font-size:0.75rem;font-weight:700;">✔ Inducted${p.inductionYear ? ' ' + esc(String(p.inductionYear)) : ''}</span>`
    : `<span style="padding:3px 11px;border-radius:100px;background:rgba(77,184,217,0.1);border:1px solid rgba(77,184,217,0.22);color:var(--neon-cyan);font-size:0.75rem;font-weight:700;">Applicant</span>`;
  const adminBadge = p.isAdmin
    ? `<span style="padding:3px 10px;border-radius:100px;background:rgba(232,166,39,0.12);border:1px solid rgba(232,166,39,0.35);color:var(--neon-gold,#e8a627);font-size:0.73rem;font-weight:700;">⚡ Admin</span>`
    : '';

  // ── Projected placement from simulation result ─────────────────
  let placementHtml = '';
  if (p.applicantId) {
    const simResult = SIM.sim?.result;
    if (simResult) {
      const simCand = simResult.candidates.find(
        c => String(c.applicantId) === String(p.applicantId)
      );
      if (simCand) {
        const prog = SIM.sim.program || '';
        if (simCand.placed) {
          placementHtml = `
            <div style="margin:0.5rem 0;padding:0.9rem 1rem;border-radius:10px;background:rgba(62,207,142,0.05);border:1px solid rgba(62,207,142,0.2);">
              <div style="font-size:0.72rem;font-weight:700;color:var(--neon-green);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:0.55rem;">✅ Projected Placement <span style="opacity:0.6;font-weight:500;text-transform:none;">(${esc(prog)} simulation)</span></div>
              <div style="font-size:0.97rem;font-weight:700;color:var(--text);margin-bottom:0.2rem;">${esc(simCand._s)}</div>
              <div style="font-size:0.82rem;color:var(--text-muted);">🏥 ${esc(simCand._h)}</div>
              <div style="font-size:0.77rem;color:var(--text-muted);margin-top:0.25rem;">Quota: ${esc(simCand._q)}</div>
            </div>`;
        } else {
          placementHtml = `
            <div style="margin:0.5rem 0;padding:0.8rem 1rem;border-radius:10px;background:rgba(232,100,100,0.05);border:1px solid rgba(232,100,100,0.18);">
              <div style="font-size:0.72rem;font-weight:700;color:#e87070;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:0.3rem;">⚠️ Not Placed <span style="opacity:0.6;font-weight:500;text-transform:none;">(${esc(prog)} simulation)</span></div>
              <div style="font-size:0.8rem;color:var(--text-muted);">All preferences were filled by higher-scoring candidates in this run.</div>
            </div>`;
        }
      }
      // if simCand not found: candidate applied for a different program — silently omit placement block
    } else {
      // Simulation not yet run — show a nudge
      placementHtml = `
        <div style="margin:0.5rem 0;padding:0.75rem 1rem;border-radius:10px;background:rgba(77,184,217,0.04);border:1px solid rgba(77,184,217,0.14);">
          <div style="font-size:0.78rem;color:var(--text-muted);">💡 Run the <strong style="color:var(--neon-cyan);">Simulation</strong> tab to see projected specialty &amp; hospital placement for this candidate.</div>
        </div>`;
    }
  }

  // ── Static merit standing (percentile bar) ─────────────────────
  const insight = _profileMeritInsight(p);
  let meritHtml = '';
  if (insight) {
    const barPct = insight.pctile;
    const progBadges = insight.programs.map(pr =>
      `<span style="padding:3px 9px;border-radius:4px;background:rgba(124,101,196,0.12);border:1px solid rgba(124,101,196,0.3);color:var(--neon-purple,#7c65c4);font-size:0.72rem;font-weight:600;">${pr}</span>`
    ).join('');
    meritHtml = `
      <div style="margin:0.5rem 0;padding:0.9rem 1rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:0.6rem;">📊 Merit Standing</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
          <span style="font-size:0.82rem;color:var(--text-muted);">Rank among applicants</span>
          <span style="font-size:0.88rem;font-weight:700;color:${insight.tierColor};">${insight.tier}</span>
        </div>
        <div style="height:6px;border-radius:100px;background:rgba(255,255,255,0.08);overflow:hidden;margin-bottom:0.5rem;">
          <div style="height:100%;width:${barPct}%;border-radius:100px;background:linear-gradient(90deg,rgba(77,184,217,0.4),${insight.tierColor});"></div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:0.75rem;color:var(--text-muted);">Better than <strong style="color:var(--text);">${barPct}%</strong> of applicants</span>
          ${progBadges ? `<div style="display:flex;gap:0.3rem;">${progBadges}</div>` : ''}
        </div>
      </div>`;
  }

  // Info rows
  const rows = [];
  if (p.specialty) rows.push(['🩺', 'Specialty', esc(p.specialty)]);
  if (p.hospital)  rows.push(['🏥', 'Hospital',  esc(p.hospital)]);
  if (p.inducted && p.inductionYear) rows.push(['📅', 'Induction Year', esc(String(p.inductionYear))]);
  if (p.updatedAt) {
    const d = p.updatedAt.toDate ? p.updatedAt.toDate() : new Date(p.updatedAt);
    rows.push(['🕒', 'Profile updated', d.toLocaleDateString('en-PK', { year:'numeric', month:'short', day:'numeric' })]);
  }

  const rowsHtml = rows.map(([icon, label, val]) => `
    <div style="display:flex;align-items:center;gap:0.65rem;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <span style="font-size:0.95rem;min-width:22px;text-align:center;">${icon}</span>
      <span style="font-size:0.77rem;color:var(--text-muted);min-width:100px;">${label}</span>
      <span style="font-size:0.86rem;color:var(--text);font-weight:500;">${val}</span>
    </div>`).join('');

  sheet.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid rgba(255,255,255,0.07);position:sticky;top:0;z-index:1;background:var(--bg-card);">
      <span style="font-size:0.8rem;font-weight:600;color:var(--text-muted);letter-spacing:0.06em;text-transform:uppercase;">Community Member</span>
      <button onclick="document.getElementById('profileViewModal').classList.add('hidden')" style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer;line-height:1;padding:2px 6px;">&times;</button>
    </div>
    <div style="padding:1.4rem 1.4rem 0.6rem;display:flex;flex-direction:column;align-items:center;gap:0.7rem;text-align:center;">
      <div style="width:82px;height:82px;border-radius:50%;${avatarBg}${avatarBorder};display:flex;align-items:center;justify-content:center;overflow:hidden;">${avatarHtml}</div>
      <div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--text);margin-bottom:0.4rem;">${esc(p.name || '(no name)')}</div>
        <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0.35rem;">${statusTag}${adminBadge}</div>
      </div>
    </div>
    <div style="padding:0 1.2rem 1.5rem;">
      ${placementHtml}
      ${meritHtml}
      ${rowsHtml || (!meritHtml && !placementHtml ? '<div style="padding:1rem 0;text-align:center;color:var(--text-muted);font-size:0.85rem;">No additional information provided.</div>' : '')}
    </div>
  `;

  modal.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════════════
// COMMUNITY CHAT
// ═══════════════════════════════════════════════════════════════════

const CHAT = {
  unsubscribe:    null,   // Firestore listener teardown
  messages:       [],     // cached messages
  _legacy:        [],     // legacy applicant_chat messages
  unreadCount:    0,
  popupOpen:      false,
  tabActive:      false,
  uid:            null,   // anonymous user ID (localStorage)
  displayName:    null,   // display name (localStorage)
  COLLECTION:     'sim21_chat',
  CHAR_LIMIT:     500,
  MAX_MESSAGES:   80,
  EMOJIS: ['😊','😂','🙏','❤️','🎉','👍','🔥','💪','🤔','😅',
            '✅','⚡','🌟','💡','😢','🥺','😍','🙌','✨','🎯',
            '🏥','🩺','📚','💊','🧬','😎','🤝','👏','💯','🫡'],
};

function _chatUID() {
  if (CHAT.uid) return CHAT.uid;
  let uid = localStorage.getItem('_chat_uid');
  if (!uid) {
    uid = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('_chat_uid', uid);
  }
  CHAT.uid = uid;
  return uid;
}

function _chatName() {
  if (CHAT.displayName) return CHAT.displayName;
  const saved = localStorage.getItem('_chat_name');
  CHAT.displayName = saved || null;
  return CHAT.displayName;
}

function _relTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)  return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return d.toLocaleDateString('en-PK', { day:'numeric', month:'short' });
}

function setupChat() {
  // Pre-populate display name from Firestore profile if not already set
  if (!_chatName()) {
    try {
      const session = JSON.parse(localStorage.getItem('meritnama_auth_session') || 'null');
      const email   = session?.email;
      if (email) {
        const db = firebase.firestore();
        db.collection('user_profiles').doc(email).get().then(doc => {
          if (doc.exists && doc.data().name && !_chatName()) {
            const profileName = doc.data().name.trim().slice(0, 40);
            localStorage.setItem('_chat_name', profileName);
            CHAT.displayName = profileName;
            ['chatTabNameBar', 'chatPopupNameBar'].forEach(id => {
              const el = document.getElementById(id);
              if (el) _renderChatNameBar(el, id.includes('Tab') ? 'chatTabInput' : 'chatPopupInput');
            });
          }
        }).catch(() => {});
      }
    } catch (_) {}
  }

  // Setup bubble toggle
  const bubble = document.getElementById('chatBubbleBtn');
  const popup  = document.getElementById('chatPopup');
  if (bubble) {
    bubble.addEventListener('click', () => {
      const isHidden = popup?.classList.contains('hidden');
      if (isHidden) {
        popup?.classList.remove('hidden');
        CHAT.popupOpen = true;
        _resetUnread();
        _chatScrollBottom('chatPopupMessages');
      } else {
        popup?.classList.add('hidden');
        CHAT.popupOpen = false;
      }
    });
  }

  // Close popup when clicking outside
  document.addEventListener('click', e => {
    if (!CHAT.popupOpen) return;
    if (popup?.contains(e.target) || bubble?.contains(e.target)) return;
    popup?.classList.add('hidden');
    CHAT.popupOpen = false;
  });

  // Wire both chat UIs (tab and popup)
  _wireChatInput('chatTabInput', 'chatTabSendBtn', 'chatTabMessages', 'chatTabCharCount', 'chatTabEmojiBtn', 'chatTabEmojiPicker', 'chatTabNameBar');
  _wireChatInput('chatPopupInput', 'chatPopupSendBtn', 'chatPopupMessages', 'chatPopupCharCount', 'chatPopupEmojiBtn', 'chatPopupEmojiPicker', 'chatPopupNameBar');

  // Start Firestore listener
  _startChatListener();
}

function _wireChatInput(inputId, sendBtnId, msgsId, charCountId, emojiBtnId, emojiPickerId, namBarId) {
  const input     = document.getElementById(inputId);
  const sendBtn   = document.getElementById(sendBtnId);
  const charCount = document.getElementById(charCountId);
  const emojiBtn  = document.getElementById(emojiBtnId);
  const emojiPkr  = document.getElementById(emojiPickerId);
  const namBar    = document.getElementById(namBarId);

  if (!input || !sendBtn) return;

  // Character counter
  input.addEventListener('input', () => {
    const len = input.value.length;
    if (charCount) {
      charCount.textContent = `${len}/${CHAT.CHAR_LIMIT}`;
      charCount.style.color = len > CHAT.CHAR_LIMIT * 0.9 ? 'var(--neon-gold)' : '';
      charCount.style.fontWeight = len > CHAT.CHAR_LIMIT * 0.9 ? '700' : '';
    }
  });

  // Send on Enter (Shift+Enter = newline)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _sendChatMessage(inputId, msgsId);
    }
  });

  sendBtn.addEventListener('click', () => _sendChatMessage(inputId, msgsId));

  // Emoji picker
  if (emojiBtn && emojiPkr) {
    // Build emoji grid once
    if (!emojiPkr.dataset.built) {
      emojiPkr.innerHTML = CHAT.EMOJIS.map(em =>
        `<button class="chat-emoji-item" type="button">${em}</button>`
      ).join('');
      emojiPkr.dataset.built = '1';
      emojiPkr.querySelectorAll('.chat-emoji-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const pos = input.selectionStart ?? input.value.length;
          input.value = input.value.slice(0, pos) + btn.textContent + input.value.slice(pos);
          input.focus();
          input.dispatchEvent(new Event('input'));
          emojiPkr.classList.add('hidden');
        });
      });
    }
    emojiBtn.addEventListener('click', e => {
      e.stopPropagation();
      emojiPkr.classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      if (!emojiPkr.contains(e.target) && e.target !== emojiBtn) {
        emojiPkr.classList.add('hidden');
      }
    });
  }

  // Display name bar
  if (namBar) _renderChatNameBar(namBar, inputId);
}

function _renderChatNameBar(container, inputId) {
  const name = _chatName();
  container.innerHTML = name
    ? `<span style="font-size:0.75rem;color:var(--text-muted)">Chatting as <strong style="color:var(--neon-cyan)">${esc(name)}</strong></span>
       <button class="chat-name-change-btn" data-input="${inputId}" style="font-size:0.72rem;background:none;border:none;color:var(--text-muted);cursor:pointer;text-decoration:underline;padding:0">change</button>`
    : `<span style="font-size:0.75rem;color:var(--neon-gold)">&#9888; Set your display name to chat</span>
       <button class="chat-name-set-btn" data-input="${inputId}" style="font-size:0.72rem;padding:3px 10px;background:rgba(77,184,217,0.12);border:1px solid rgba(77,184,217,0.3);color:var(--neon-cyan);border-radius:100px;cursor:pointer;">Set name</button>`;

  container.querySelectorAll('.chat-name-set-btn, .chat-name-change-btn').forEach(btn => {
    btn.addEventListener('click', () => _promptChatName(btn.dataset.input));
  });
}

function _promptChatName(returnInputId) {
  const current = _chatName() || '';
  const input   = document.getElementById(returnInputId);
  const name    = window.prompt('Enter your display name for community chat:', current);
  if (name === null) return; // cancelled
  const cleaned = name.trim().slice(0, 40);
  if (!cleaned) {
    showToast('Display name cannot be empty.', 'warning');
    return;
  }
  localStorage.setItem('_chat_name', cleaned);
  CHAT.displayName = cleaned;
  showToast(`Name set to "${cleaned}"`, 'success');
  // Refresh name bars
  ['chatTabNameBar', 'chatPopupNameBar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) _renderChatNameBar(el, id.includes('Tab') ? 'chatTabInput' : 'chatPopupInput');
  });
  input?.focus();
}

function _sendChatMessage(inputId, msgsId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  if (text.length > CHAT.CHAR_LIMIT) {
    showToast(`Message too long (max ${CHAT.CHAR_LIMIT} chars)`, 'warning');
    return;
  }
  const name = _chatName();
  if (!name) {
    showToast('Please set a display name first.', 'warning');
    _promptChatName(inputId);
    return;
  }

  let db;
  try { db = firebase.firestore(); } catch { showToast('Chat unavailable.', 'error'); return; }

  const uid = _chatUID();

  db.collection(CHAT.COLLECTION).add({
    text:       text,
    name:       name,
    uid:        uid,
    ts:         firebase.firestore.FieldValue.serverTimestamp(),
  }).then(() => {
    input.value = '';
    const cc = document.getElementById(inputId.replace('Input', 'CharCount'));
    if (cc) cc.textContent = `0/${CHAT.CHAR_LIMIT}`;
    _chatScrollBottom(msgsId);
  }).catch(err => {
    showToast('Could not send message.', 'error');
    console.error('Chat send error:', err);
  });
}

function _startChatListener() {
  let db;
  try { db = firebase.firestore(); } catch { return; }

  if (CHAT.unsubscribe) CHAT.unsubscribe();

  // Also load legacy applicant_chat messages (one-time fetch, ordered by createdAt)
  const LEGACY = 'applicant_chat';
  db.collection(LEGACY).orderBy('createdAt', 'asc').limitToLast(CHAT.MAX_MESSAGES).get()
    .then(snap => {
      CHAT._legacy = snap.docs.map(d => {
        const data = d.data();
        return {
          id:   '_legacy_' + d.id,
          text: data.text,
          name: data.sender || 'Anonymous',
          uid:  '_legacy',
          ts:   data.createdAt,
        };
      });
    })
    .catch(() => { CHAT._legacy = []; });

  CHAT.unsubscribe = db.collection(CHAT.COLLECTION)
    .orderBy('ts', 'asc')
    .limitToLast(CHAT.MAX_MESSAGES)
    .onSnapshot(snap => {
      const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Merge legacy + new, dedup by id, keep sorted by ts
      const legacy = (CHAT._legacy || []).filter(l =>
        !fresh.some(f => f.text === l.text && f.name === l.name)
      );
      CHAT.messages = [...legacy, ...fresh].sort((a, b) => {
        const ta = a.ts?.toMillis?.() ?? a.ts ?? 0;
        const tb = b.ts?.toMillis?.() ?? b.ts ?? 0;
        return ta - tb;
      });
      const isVisible = CHAT.popupOpen || CHAT.tabActive;
      if (!isVisible) {
        CHAT.unreadCount++;
        _updateBadge();
      }
      _renderAllChatMessages();
      if (isVisible) _chatScrollBottom('chatTabMessages');
      if (CHAT.popupOpen) _chatScrollBottom('chatPopupMessages');
    }, err => {
      console.warn('Chat listener error:', err);
    });
}

function _renderAllChatMessages() {
  _renderChatMessages('chatTabMessages');
  _renderChatMessages('chatPopupMessages');
}

function _renderChatMessages(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const uid = _chatUID();
  if (!CHAT.messages.length) {
    container.innerHTML = `<div class="chat-empty">No messages yet. Say hello! 👋</div>`;
    return;
  }
  container.innerHTML = CHAT.messages.map(msg => {
    const isOwn  = msg.uid === uid;
    const relTm  = _relTime(msg.ts);
    // Sanitise output — esc() handles HTML chars
    return `<div class="chat-msg ${isOwn ? 'chat-msg-own' : ''}">
      <div class="chat-msg-meta">
        <span class="chat-msg-name ${isOwn ? 'chat-msg-name-own' : ''}">${esc(msg.name || 'Anonymous')}</span>
        <span class="chat-msg-time">${relTm}</span>
        ${isOwn ? `<button class="chat-del-btn" data-id="${msg.id}" title="Delete message">&times;</button>` : ''}
      </div>
      <div class="chat-msg-bubble ${isOwn ? 'chat-msg-bubble-own' : ''}">${esc(msg.text || '').replace(/\n/g, '<br>')}</div>
    </div>`;
  }).join('');

  // Wire delete buttons (own messages only)
  container.querySelectorAll('.chat-del-btn').forEach(btn => {
    btn.addEventListener('click', () => _deleteChatMessage(btn.dataset.id));
  });
}

function _deleteChatMessage(msgId) {
  if (!window.confirm('Delete this message?')) return;
  let db;
  try { db = firebase.firestore(); } catch { return; }
  db.collection(CHAT.COLLECTION).doc(msgId).delete()
    .catch(err => { showToast('Could not delete.', 'error'); console.error(err); });
}

function _chatScrollBottom(containerId) {
  requestAnimationFrame(() => {
    const el = document.getElementById(containerId);
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function _resetUnread() {
  CHAT.unreadCount = 0;
  _updateBadge();
}

function _updateBadge() {
  const badge = document.getElementById('chatBubbleBadge');
  if (!badge) return;
  if (CHAT.unreadCount > 0 && !CHAT.popupOpen && !CHAT.tabActive) {
    badge.textContent = CHAT.unreadCount > 99 ? '99+' : String(CHAT.unreadCount);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}
