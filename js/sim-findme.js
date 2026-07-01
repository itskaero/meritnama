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
  const appSimInput = document.getElementById('appSimIdInput');
  if (!badge) return;

  const me = SIM.myId ? (allCandidates().find(c => String(c.applicantId) === SIM.myId)) : null;
  if (me) {
    badge.textContent = `${me.nameFull.split(' ')[0]} — ${baseMarks(me).toFixed(2)}`;
    badge.classList.remove('hidden');
    clr?.classList.remove('hidden');
    if (input) input.value = SIM.myId;
    if (appSimInput && !appSimInput.value) appSimInput.value = SIM.myId;
  } else {
    badge.classList.add('hidden');
    clr?.classList.add('hidden');
    if (appSimInput) appSimInput.value = '';
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

function candidateEmail(c) {
  return String(c?.emailId || c?.email || c?.emailID || c?.email_id || '').toLowerCase().trim();
}

function supporterBadgeForCandidate(c) {
  const email = candidateEmail(c);
  return email && SIM.donor.byEmail.has(email)
    ? '<span class="supporter-tag" title="Verified MeritNama supporter">★ Supporter</span>'
    : '';
}

function getSessionEmail() {
  try {
    const raw = localStorage.getItem('meritnama_auth_session');
    const session = raw ? JSON.parse(raw) : null;
    return (session && typeof session.email === 'string') ? session.email.toLowerCase().trim() : '';
  } catch (_) {
    return '';
  }
}

async function initDonorEntitlements() {
  try {
    const db = firebase.firestore();
    const snap = await db.collection('contributions').get();
    SIM.donor.byEmail.clear();
    snap.docs.forEach(doc => {
      const d = doc.data();
      const email = String(d.email || '').toLowerCase().trim();
      if (!email) return;
      const prev = SIM.donor.byEmail.get(email) || { count: 0, amountPKR: 0, amountUSD: 0 };
      prev.count += 1;
      prev.amountPKR += Number(d.amountPKR) || 0;
      prev.amountUSD += Number(d.amountUSD) || 0;
      SIM.donor.byEmail.set(email, prev);
    });
    const sessionEmail = getSessionEmail();
    SIM.donor.current = sessionEmail ? SIM.donor.byEmail.get(sessionEmail) || null : null;
    SIM.donor.loaded = true;
    updateSbDownloadGate();
    updateCandidateDownloadGate();
    updateSimulationDownloadGate();
    if (SIM.cand.filtered?.length) renderCandidateTable(
      SIM.cand.filtered.slice(SIM.cand.page * PAGE_SIZE, (SIM.cand.page + 1) * PAGE_SIZE),
      SIM.cand.filtered.length
    );
  } catch (e) {
    console.warn('Donor entitlement load failed:', e);
    SIM.donor.loaded = true;
    updateSbDownloadGate();
    updateCandidateDownloadGate();
    updateSimulationDownloadGate();
  }
}

// ── Custom candidate (manual add) ─────────────────────────────────
function loadCustomCand() {
  try {
    const s = localStorage.getItem(CUSTOM_KEY);
    return s ? JSON.parse(s) : null;
  } catch (_) { return null; }
}

function saveCustomCand(c) {
  SIM.customCand = ensureCandidateAdjusted(c);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(SIM.customCand));
  refreshCandidateRevisionOptions();
}

function populateCustomFormFromCandidate(c) {
  if (!c) return;
  document.getElementById('customName').value         = c.nameFull || '';
  document.getElementById('customId').value           = c.applicantId || '';
  document.getElementById('customMarksTotal').value   = c.marksTotal ?? '';
  document.getElementById('customMarksFCPS').value    = c.programMarks?.FCPS ?? '';
  document.getElementById('customMarksFCPSD').value   = c.programMarks?.FCPSD ?? '';
  document.getElementById('customMarksMS').value      = c.programMarks?.MS ?? '';
  document.getElementById('customMarksMD').value      = c.programMarks?.MD ?? '';
  document.getElementById('customMarksMDS').value     = c.programMarks?.MDS ?? '';
  document.getElementById('customSourceId').value     = c.applicantId || '';
  if (typeof window.populateCustomPrefRows === 'function') {
    window.populateCustomPrefRows(c.preference || {});
  }
}

function clearCustomForm() {
  ['customName','customId','customMarksTotal','customMarksFCPS','customMarksFCPSD',
   'customMarksMS','customMarksMD','customMarksMDS','customSourceId'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (typeof window.clearCustomPrefRows === 'function') {
    window.clearCustomPrefRows();
  }
}

function openCustomModal() {
  const m = document.getElementById('customModal');
  if (!m) return;
  populateCustomFormFromCandidate(SIM.customCand);
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

  document.getElementById('customLoadByIdBtn')?.addEventListener('click', () => {
    const id = document.getElementById('customLookupId')?.value?.trim();
    if (!id) { showToast('Enter an Applicant ID to load.', 'warning'); return; }
    const c = allCandidates().find(x => String(x.applicantId) === id);
    if (!c) { showToast(`ID ${id} not found in dataset.`, 'warning'); return; }
    populateCustomFormFromCandidate(c);
    showToast(`Loaded: ${c.nameFull}`, 'success');
  });

  document.getElementById('customBlankBtn')?.addEventListener('click', () => {
    clearCustomForm();
  });

  document.getElementById('customModalClose')?.addEventListener('click', closeCustomModal);

  document.getElementById('customSaveBtn')?.addEventListener('click', () => {
    const name   = document.getElementById('customName')?.value?.trim() || '(Me)';
    const id     = parseInt(document.getElementById('customId')?.value) || 99999;
    const total  = parseFloat(document.getElementById('customMarksTotal')?.value) || 0;
    const fcps   = parseFloat(document.getElementById('customMarksFCPS')?.value) || total;
    const fcpsd  = parseFloat(document.getElementById('customMarksFCPSD')?.value) || fcps;
    const ms     = parseFloat(document.getElementById('customMarksMS')?.value) || total;
    const md     = parseFloat(document.getElementById('customMarksMD')?.value) || total;
    const mds    = parseFloat(document.getElementById('customMarksMDS')?.value) || total;

    const prefs = gatherCustomPrefs();
    const hasPref = p => !!(prefs[p] || []).length;

    const cand = {
      applicantId:  id,
      nameFull:     name,
      marksTotal:   total,
      programMarks: { FCPS: fcps, FCPSD: fcpsd, MS: ms, MD: md, MDS: mds },
      applied_in:   {
        FCPS:            hasPref('FCPS'),
        'FCPS Dentistry': hasPref('FCPS Dentistry'),
        MS:              hasPref('MS'),
        MD:              hasPref('MD'),
        MDS:             hasPref('MDS'),
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
