'use strict';
// simulation.js — Induction 21 live simulation for MeritNama
// Translates merit.py run_placement() faithfully into JavaScript.

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
const SIM = {
  candidates:   [],
  seats:        null,   // {PROG: {quota: {spec: {hosp: n}}}}  or null
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
  setupFindMe();
  setupCandidateFilters();
  applyAndRenderCandidates();
  setupSlotBrowser();
  setupSimulationTab();
  updateMyBadge();

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
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tab;
      document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${t}`)?.classList.add('active');
      SIM.activeTab = t;
    });
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
  showToast(`Found: ${found.nameFull} — ${found.marksTotal.toFixed(2)} marks`, 'success');
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
    badge.textContent = `${me.nameFull.split(' ')[0]} — ${me.marksTotal.toFixed(2)}`;
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
      <td class="td-num">${fmtM(c.marksTotal)}</td>
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
    ['Degree',     c.degree],
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
        <p class="cand-detail-meta">ID: ${c.applicantId} &nbsp;·&nbsp; Total: <strong>${fmtM(c.marksTotal)}</strong></p>
      </div>
    </div>

    <div class="cand-scores-grid">
      ${Object.entries(c.programMarks || {}).map(([p, m]) => `
        <div class="cand-score-card ${c.applied_in?.[p] ? 'applied' : ''}" data-prog="${esc(p)}">
          <span class="cand-score-prog">${p}</span>
          <span class="cand-score-val">${fmtM(m)}</span>
          <span class="cand-score-lbl">${c.applied_in?.[p] ? '✓ Applied' : 'Not applied'}</span>
        </div>`).join('')}
    </div>

    ${scoreRows.length ? `
    <details class="score-breakdown">
      <summary>Score breakdown</summary>
      <div class="score-bk-grid">
        ${scoreRows.map(([l, v]) => `<span>${l}</span><span class="score-bk-val">${fmtM(v)}</span>`).join('')}
        <span><strong>Total</strong></span><span class="score-bk-val"><strong>${fmtM(c.marksTotal)}</strong></span>
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

  const entries = [];
  allCandidates().forEach(c => (c.preference?.[prog] || []).forEach(p => entries.push(p)));

  if (!from || from === 'program') {
    const quotas = [...new Set(entries.map(e => e.quotaName))].sort();
    fillSelect('sbQuota', quotas, SIM.sb.quota, '— Quota —');
  }

  const byQ = SIM.sb.quota ? entries.filter(e => e.quotaName === SIM.sb.quota) : entries;
  if (!from || from === 'program' || from === 'quota') {
    const specs = [...new Set(byQ.map(e => e.specialityName))].sort();
    fillSelect('sbSpec', specs, SIM.sb.spec, '— Specialty —');
  }

  const byQS = SIM.sb.spec ? byQ.filter(e => e.specialityName === SIM.sb.spec) : byQ;
  if (!from || from === 'program' || from === 'quota' || from === 'spec') {
    const hosps = [...new Set(byQS.map(e => e.hospitalName))].sort();
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

  if (!program || !quota || !spec || !hosp) {
    container.innerHTML = '<p class="sb-placeholder">Select a program, quota, specialty and hospital above to see ranked applicants.</p>';
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
    marksTotal:  effectiveMark(c, program) ?? c.marksTotal,
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
    for (const pref of cand._prefs) {
      const sl = slot(pref.quotaName, pref.specialityName, pref.hospitalName);
      if (!sl) continue;
      const inC = sl.candidates.some(c => String(c.applicantId) === String(cand.applicantId));
      const inO = sl.others.some(c => String(c.applicantId) === String(cand.applicantId));
      if (!inC && !inO) {
        sl.others.push({
          ...entry(cand, pref),
          placed:   cand.placed,
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
        const nextInLine = sl.others.find(o => !o.placed) ?? sl.others[0] ?? null;
        const meInSlot   = me ? sl.candidates.some(c => String(c.applicantId) === SIM.myId) : false;
        rows.push({ q, s, h, sl, cutoff, nextInLine, meInSlot });
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

function renderSimCard({ q, s, h, sl, cutoff, nextInLine, meInSlot }, program) {
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

    ${sl.others.length ? `
    <button class="btn btn-sm sim-expand-btn" data-count="${sl.others.length}">▼ ${sl.others.length} others</button>
    <div class="sim-others">
      ${sl.others.map(o => `
        <div class="sim-other-row ${isMe(o.applicantId) ? 'sim-row-me' : ''}" data-sim-cand="${o.applicantId}">
          <span class="sim-other-name">${esc(o.nameFull)}${isMe(o.applicantId) ? ' <span class="me-tag">YOU</span>' : ''}</span>
          <span class="sim-other-marks">${fmtM(o.marksTotal)}</span>
          <span class="sim-other-status">${o.placed ? `→ ${esc(o.placedAt?.s ?? o.placedAt?.h ?? '?')}` : 'unplaced'}</span>
        </div>`).join('')}
    </div>` : ''}
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
 * Effective marks for a candidate in a specific program.
 * = marksTotal + programMarks[program]  (programMarks is a per-program bonus)
 * Returns null when applied_in[program] is false (candidate did not apply).
 * A candidate may have applied_in=true but programMarks=0 (0 bonus) — they
 * are still valid and ranked on marksTotal alone.
 */
function effectiveMark(c, program) {
  if (!c.applied_in?.[program]) return null;   // did not apply
  return (c.marksTotal ?? 0) + (c.programMarks?.[program] ?? 0);
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
