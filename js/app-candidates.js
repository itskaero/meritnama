'use strict';

const ADMIN_CAND = {
  data: null,
  filtered: [],
  searchQuery: '',
  programFilter: '',
  page: 0,
  pageSize: 50,
};

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtM(v) {
  if (v == null || v === '') return '—';
  const n = parseFloat(v);
  return isNaN(n) ? '—' : n.toFixed(2);
}

function fmtStat(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : '—';
}

async function loadAdminCandidates() {
  const errEl = document.getElementById('adminCandError');
  try {
    const r = await fetch('data/induction21_candidates.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    ADMIN_CAND.data = Array.isArray(d) ? d : (d.candidates || Object.values(d));

    const certsR = await fetch('data/induction21_certificates.json', { cache: 'no-store' });
    if (certsR.ok) {
      const certs = await certsR.json();
      for (const c of ADMIN_CAND.data) {
        const id = String(c.applicantId);
        if (Array.isArray(certs[id])) c.certificates = certs[id];
      }
    }

    const compR = await fetch('data/induction21_components.json', { cache: 'no-store' });
    if (compR.ok) {
      const comps = await compR.json();
      const fields = ['degree', 'houseJob', 'position', 'mdcat', 'experience', 'research', 'hardAreas', 'attempts', 'marksTotal'];
      for (const c of ADMIN_CAND.data) {
        const id = String(c.applicantId);
        const comp = comps[id];
        if (comp) {
          for (const f of fields) {
            if (comp[f] != null) c[f] = comp[f];
          }
        }
      }
    }

    applyAdminCandFilter();
  } catch (e) {
    if (errEl) { errEl.textContent = 'Failed to load candidate data: ' + e.message; errEl.classList.remove('hidden'); }
    ADMIN_CAND.data = [];
  }
}

function applyAdminCandFilter() {
  const data = ADMIN_CAND.data || [];
  let list = data.slice();

  if (ADMIN_CAND.searchQuery) {
    const q = ADMIN_CAND.searchQuery.toLowerCase();
    list = list.filter(c =>
      String(c.applicantId).includes(q) ||
      (c.nameFull || '').toLowerCase().includes(q)
    );
  }

  if (ADMIN_CAND.programFilter) {
    list = list.filter(c => {
      const prefs = c.preference?.[ADMIN_CAND.programFilter] || [];
      const ai = c.applied_in?.[ADMIN_CAND.programFilter];
      return prefs.length > 0 || ai;
    });
  }

  list.sort((a, b) => (b.marksTotal || 0) - (a.marksTotal || 0));
  ADMIN_CAND.filtered = list;
  ADMIN_CAND.page = 0;
  renderAdminCandTable();
}

function renderAdminCandTable() {
  const tbody = document.getElementById('adminCandBody');
  const countEl = document.getElementById('adminCandCount');
  if (!tbody) return;

  const list = ADMIN_CAND.filtered;
  const total = list.length;
  const page = ADMIN_CAND.page;
  const ps = ADMIN_CAND.pageSize;
  const slice = list.slice(page * ps, (page + 1) * ps);

  if (countEl) countEl.textContent = total.toLocaleString() + ' candidates';

  tbody.innerHTML = slice.map((c, i) => {
    const rank = i + 1 + page * ps;
    const certs = Array.isArray(c.certificates) ? c.certificates : [];
    const certCount = certs.length;
    const hasCerts = certCount > 0;
    const fcpsEff = effectiveMarkAdmin(c, 'FCPS');
    const msEff = effectiveMarkAdmin(c, 'MS');
    const mdEff = effectiveMarkAdmin(c, 'MD');
    return '<tr data-id="' + esc(c.applicantId) + '" style="cursor:pointer">' +
      '<td class="td-num">' + rank + '</td>' +
      '<td>' + esc(c.nameFull || '') + '</td>' +
      '<td class="td-num">' + esc(c.applicantId) + '</td>' +
      '<td class="td-num">' + fmtM(c.marksTotal) + '</td>' +
      '<td class="td-num">' + (fcpsEff != null ? fmtM(fcpsEff) : '—') + '</td>' +
      '<td class="td-num">' + (msEff != null ? fmtM(msEff) : '—') + '</td>' +
      '<td class="td-num">' + (mdEff != null ? fmtM(mdEff) : '—') + '</td>' +
      '<td>' + (hasCerts ? '<span class="cert-badge" title="' + certCount + ' certificate(s)">' + certCount + ' cert' + (certCount > 1 ? 's' : '') + '</span>' : '—') + '</td>' +
      '<td><button class="btn btn-sm view-btn" data-id="' + esc(c.applicantId) + '">View</button></td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--text-muted)">No candidates match filter.</td></tr>';

  renderAdminCandPager(total);

  tbody.querySelectorAll('.view-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showAdminCandDetail(btn.dataset.id);
    })
  );
  tbody.querySelectorAll('tr[data-id]').forEach(tr =>
    tr.addEventListener('click', () => showAdminCandDetail(tr.dataset.id))
  );
}

function effectiveMarkAdmin(c, program) {
  if (!c || !program) return null;
  const base = c.marksTotal || 0;
  const pm = c.programMarks?.[program];
  const bonus = pm != null ? parseFloat(pm) : 0;
  return Number.isFinite(bonus) ? base + bonus : base;
}

function renderAdminCandPager(total) {
  const el = document.getElementById('adminCandPager');
  if (!el) return;
  const pages = Math.ceil(total / ADMIN_CAND.pageSize);
  if (pages <= 1) { el.innerHTML = ''; return; }
  const p = ADMIN_CAND.page;
  let html = p > 0 ? '<button class="page-btn" data-p="' + (p - 1) + '">‹ Prev</button>' : '';
  html += '<span class="page-info">Page ' + (p + 1) + ' of ' + pages + '</span>';
  if (p < pages - 1) html += '<button class="page-btn" data-p="' + (p + 1) + '">Next ›</button>';
  el.innerHTML = html;
  el.querySelectorAll('.page-btn').forEach(b =>
    b.addEventListener('click', () => {
      ADMIN_CAND.page = +b.dataset.p;
      renderAdminCandTable();
    })
  );
}

function showAdminCandDetail(applicantId) {
  const c = (ADMIN_CAND.data || []).find(x => String(x.applicantId) === String(applicantId));
  if (!c) return;
  const detail = document.getElementById('adminCandDetail');
  const nameEl = document.getElementById('adminCandDetailName');
  const bodyEl = document.getElementById('adminCandDetailBody');
  if (!detail || !bodyEl) return;

  nameEl.textContent = c.nameFull + ' (ID: ' + c.applicantId + ')';

  const certs = Array.isArray(c.certificates) ? c.certificates : [];
  const prefs = c.preference || {};
  const allPrograms = ['FCPS', 'FCPS Dentistry', 'MS', 'MD', 'MDS'];

  const certsHtml = certs.length ? certs.map(cert =>
    '<div class="cert-row-admin">' +
      '<span class="cert-prog-tag">' + esc(cert.typeName || cert.program || '') + '</span>' +
      '<span class="cert-spec-name">' + esc(cert.disciplineName || cert.specialty || '') + '</span>' +
      '<span class="cert-status ' + (cert.status === 'Pass' ? 'pass' : '') + '">' + esc(cert.status || '') + '</span>' +
      '<span class="cert-marks">Marks: ' + fmtM(cert.certificateMarks) + '</span>' +
      '<span class="cert-comp-marks">Comp: ' + fmtM(cert.computerizedMarks) + '</span>' +
      '<span class="cert-attempt">' + esc(cert.attempt || '') + '</span>' +
    '</div>'
  ).join('') : '<p style="color:var(--text-muted);font-size:0.85rem">No certificates recorded.</p>';

  const marksHtml =
    '<div class="marks-grid-admin">' +
    '<div class="marks-item"><span class="marks-lbl">Degree</span><span class="marks-val">' + fmtStat(c.degree) + '</span></div>' +
    '<div class="marks-item"><span class="marks-lbl">House Job</span><span class="marks-val">' + fmtStat(c.houseJob) + '</span></div>' +
    '<div class="marks-item"><span class="marks-lbl">Experience</span><span class="marks-val">' + fmtStat(c.experience) + '</span></div>' +
    '<div class="marks-item"><span class="marks-lbl">Research</span><span class="marks-val">' + fmtStat(c.research) + '</span></div>' +
    '<div class="marks-item"><span class="marks-lbl">Position</span><span class="marks-val">' + fmtStat(c.position) + '</span></div>' +
    '<div class="marks-item"><span class="marks-lbl">Hard Areas</span><span class="marks-val">' + fmtStat(c.hardAreas) + '</span></div>' +
    '<div class="marks-item"><span class="marks-lbl">Matric</span><span class="marks-val">' + fmtStat(c.matric) + '</span></div>' +
    '<div class="marks-item"><span class="marks-lbl">FSC</span><span class="marks-val">' + fmtStat(c.fsc) + '</span></div>' +
    '<div class="marks-item"><span class="marks-lbl">Attempts</span><span class="marks-val">' + fmtStat(c.attempts) + '</span></div>' +
    '<div class="marks-item"><span class="marks-lbl">MDCAT</span><span class="marks-val">' + fmtStat(c.mdcat) + '</span></div>' +
    '<div class="marks-item marks-total"><span class="marks-lbl">marksTotal</span><span class="marks-val">' + fmtM(c.marksTotal) + '</span></div>' +
    '</div>';

  const progMarksHtml = allPrograms.map(p => {
    const pm = c.programMarks?.[p];
    const adj = c.adjusted?.[p];
    if (pm == null && adj == null) return '';
    return '<div class="prog-marks-row">' +
      '<span class="linked-prog-tag">' + esc(p) + '</span>' +
      '<span>Portal: <strong>' + fmtM(pm) + '</strong></span>' +
      (adj != null && adj !== pm ? '<span>Adjusted: <strong>' + fmtM(adj) + '</strong></span>' : '') +
    '</div>';
  }).filter(Boolean).join('');

  // Build discipline name lookup
  const adminDiscNames = {};
  try {
    if (typeof SIM !== 'undefined' && SIM.disciplineMap) {
      for (const d of Object.values(SIM.disciplineMap)) {
        adminDiscNames[d.disciplineId] = d.name;
      }
    }
  } catch (_) {}

  const prefsHtml = allPrograms.map(p => {
    const list = (prefs[p] || []).slice().sort((a, b) => a.preferenceNo - b.preferenceNo);
    if (!list.length) return '';
    return '<div class="pref-section-admin">' +
      '<h4>' + esc(p) + ' Preferences (' + list.length + ')</h4>' +
      '<div class="pref-list-admin">' +
      list.map(pref => {
        const dIds = Array.isArray(pref.disciplineIds) ? pref.disciplineIds : [];
        const discHtml = dIds.length ? [...new Set(dIds)].map(id => {
          const name = adminDiscNames[id] || String(id);
          return '<span class="admin-pref-disc">' + esc(name) + '</span>';
        }).join('') : '';
        const pMarks = pref.programMarks;
        const marksBadge = pMarks != null && pMarks !== '' && Number(pMarks) > 0
          ? '<span class="admin-pref-marks-badge"><span class="admin-pref-marks-val">' + fmtM(pMarks) + '</span><span class="admin-pref-marks-src">+prog</span></span>'
          : '';
        return '<div class="admin-pref-row' + (pref.parentInstitute ? ' admin-pref-parent' : '') + '">' +
          '<div class="admin-pref-no-col"><span class="admin-pref-no">' + pref.preferenceNo + '</span></div>' +
          '<div class="admin-pref-body">' +
            '<div class="admin-pref-spec-row">' +
              '<span class="admin-pref-spec">' + esc(pref.specialityName || '') + '</span>' +
              marksBadge +
            '</div>' +
            '<div class="admin-pref-meta-row">' +
              '<span class="admin-pref-hosp">' + esc(pref.hospitalName || '') + '</span>' +
              '<span class="admin-pref-meta-sep">&middot;</span>' +
              '<span class="admin-pref-quota">' + esc(pref.quotaName || '') + '</span>' +
              (pref.parentInstitute ? '<span class="admin-pref-parent-star">&#9733;</span>' : '') +
              (discHtml ? '<span class="admin-pref-meta-sep">&middot;</span><span class="admin-pref-discs">' + discHtml + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
      '</div></div>';
  }).filter(Boolean).join('');

  bodyEl.innerHTML =
    '<div class="admin-cand-sections">' +
      '<div class="card"><h4>Marks</h4>' + marksHtml + '</div>' +
      (progMarksHtml ? '<div class="card"><h4>Programme Marks</h4>' + progMarksHtml + '</div>' : '') +
      '<div class="card"><h4>Certificates (' + certs.length + ')</h4>' + certsHtml + '</div>' +
      (prefsHtml ? '<div class="card"><h4>Preferences</h4>' + prefsHtml + '</div>' : '') +
      '<div class="card" id="adminMarksEditCard">' +
        '<h4>Edit Marks</h4>' +
        '<p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 10px">Override individual mark fields for this candidate. Changes are saved to browser storage as a revision.</p>' +
        '<div class="marks-edit-grid">' +
          Object.entries({
            marksTotal: 'Total Marks',
            degree: 'Degree', houseJob: 'House Job', experience: 'Experience',
            research: 'Research', position: 'Position', hardAreas: 'Hard Areas',
            matric: 'Matric', fsc: 'FSC', attempts: 'Attempts', mdcat: 'MDCAT'
          }).map(([key, label]) =>
            '<div class="marks-edit-field">' +
              '<label>' + esc(label) + '</label>' +
              '<input type="number" step="0.001" class="cand-edit-input" data-field="' + esc(key) + '" value="' + (c[key] ?? '') + '" />' +
            '</div>'
          ).join('') +
        '</div>' +
        '<div class="marks-edit-actions">' +
          '<button class="btn btn-primary btn-sm" id="adminSaveMarksEdit">Save Revision</button>' +
          '<button class="btn btn-sm" id="adminResetMarksEdit">Reset</button>' +
          '<span id="adminMarksEditStatus" style="font-size:0.82rem;color:var(--text-muted);margin-left:10px"></span>' +
        '</div>' +
      '</div>' +
    '</div>';

  detail.classList.remove('hidden');

  document.getElementById('adminCandDetailClose').onclick = () => detail.classList.add('hidden');

  document.getElementById('adminSaveMarksEdit').onclick = () => saveAdminCandMarks(c);
  document.getElementById('adminResetMarksEdit').onclick = () => resetAdminCandMarks(c);
}

function saveAdminCandMarks(c) {
  const inputs = document.querySelectorAll('.cand-edit-input[data-field]');
  const revision = { _type: 'admin_revision', _createdAt: Date.now(), _applicantId: c.applicantId };
  let changed = 0;
  inputs.forEach(inp => {
    const field = inp.dataset.field;
    const raw = inp.value.trim();
    const orig = c[field];
    if (raw === '') {
      if (orig != null) { revision[field] = null; changed++; }
    } else {
      const num = parseFloat(raw);
      if (Number.isFinite(num) && num !== orig) { revision[field] = num; changed++; }
    }
  });

  if (!changed) {
    document.getElementById('adminMarksEditStatus').textContent = 'No changes detected.';
    return;
  }

  try {
    const saved = JSON.parse(localStorage.getItem('mn_admin_revisions') || '{}');
    const id = String(c.applicantId);
    saved[id] = saved[id] || {};
    const revId = 'admin_revision_' + Date.now();
    saved[id][revId] = revision;
    localStorage.setItem('mn_admin_revisions', JSON.stringify(saved));
    document.getElementById('adminMarksEditStatus').textContent = 'Revision saved. Refresh the simulation portal to see changes.';
    showAdminCandToast('Revision saved for candidate ' + c.applicantId, 'success');
  } catch (e) {
    document.getElementById('adminMarksEditStatus').textContent = 'Error saving: ' + e.message;
  }
}

function resetAdminCandMarks(c) {
  document.querySelectorAll('.cand-edit-input[data-field]').forEach(inp => {
    const field = inp.dataset.field;
    inp.value = c[field] ?? '';
  });
  document.getElementById('adminMarksEditStatus').textContent = 'Reset to original values.';
}

function showAdminCandToast(msg, type) {
  const el = document.getElementById('adminCandError');
  if (!el) return;
  el.textContent = msg;
  el.className = '';
  el.style.color = type === 'success' ? 'var(--neon-cyan)' : 'var(--neon-pink)';
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function setupAdminCandidates() {
  document.getElementById('adminCandSearchBtn')?.addEventListener('click', () => {
    const q = document.getElementById('adminCandSearch')?.value?.trim() || '';
    ADMIN_CAND.searchQuery = q;
    applyAdminCandFilter();
  });
  document.getElementById('adminCandSearch')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      ADMIN_CAND.searchQuery = e.target.value.trim();
      applyAdminCandFilter();
    }
  });
  document.getElementById('adminCandProgram')?.addEventListener('change', e => {
    ADMIN_CAND.programFilter = e.target.value;
    applyAdminCandFilter();
  });
  document.getElementById('adminCandClearRev')?.addEventListener('click', () => {
    document.getElementById('adminCandRevisionsBar').classList.add('hidden');
  });

  // Bulk JSON revision upload
  const uploadBtn = document.getElementById('adminRevUploadBtn');
  const uploadInput = document.getElementById('adminRevUploadInput');
  const uploadStatus = document.getElementById('adminRevUploadStatus');
  if (uploadBtn && uploadInput && uploadStatus) {
    uploadBtn.addEventListener('click', () => {
      const file = uploadInput.files?.[0];
      if (!file) { uploadStatus.textContent = 'Select a JSON file first.'; uploadStatus.style.color = 'var(--neon-pink)'; return; }
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Root must be an object keyed by applicantId');
          }
          const saved = JSON.parse(localStorage.getItem('mn_admin_revisions') || '{}');
          let totalRevisions = 0;
          for (const [aid, revisions] of Object.entries(parsed)) {
            if (typeof revisions !== 'object' || revisions === null) continue;
            saved[aid] = saved[aid] || {};
            for (const [revId, fields] of Object.entries(revisions)) {
              if (typeof fields !== 'object' || fields === null) continue;
              saved[aid][revId] = { ...saved[aid][revId], ...fields, _type: 'admin_revision', _createdAt: Date.now(), _applicantId: aid };
              totalRevisions++;
            }
          }
          localStorage.setItem('mn_admin_revisions', JSON.stringify(saved));
          uploadStatus.textContent = `Imported ${totalRevisions} revision(s) for ${Object.keys(parsed).length} candidate(s).`;
          uploadStatus.style.color = 'var(--neon-green)';
          uploadInput.value = '';
        } catch (err) {
          uploadStatus.textContent = 'Invalid JSON: ' + err.message;
          uploadStatus.style.color = 'var(--neon-pink)';
        }
      };
      reader.readAsText(file);
    });
  }

  loadAdminCandidates();
}

// setupAdminCandidates() is called from app-notif-init.js init chain
// to avoid duplicate data loading on DOMContentLoaded.
