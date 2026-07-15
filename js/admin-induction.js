'use strict';

/**
 * Admin Induction — Candidate browser, JSON bulk upload, and simulation
 * dropdown visibility/defaults for the admin portal (admin.html).
 *
 * Uses fetch() to load static JSON data files from data/. Does NOT depend
 * on SIM or any simulation-portal JS module.
 */

(function () {

  const ADMIN_CFG_KEY = 'mn_admin_sim_config';

  const AI = {
    candidates: null,
    candidateArray: null,
    certificates: null,       // Map<applicantId, cert[]>
    profileStatus: null,
    disciplineMap: null,      // Map<disciplineId, discipline>
    specialityMap: null,      // Map<specialityId, specialityName>
    revisions: null,
    loaded: false,
  };

  // ── Helpers ────────────────────────────────────────────────────────────

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }

  function fmtM(v) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : '—';
  }

  function showStatus(elId, msg, color) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.style.color = color || 'var(--text-muted)';
  }

  function initials(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function specialityName(pref) {
    if (pref.specialityName) return pref.specialityName;
    if (pref.specialityId != null && AI.specialityMap) {
      const name = AI.specialityMap.get(Number(pref.specialityId));
      if (name) return name;
    }
    return '—';
  }

  // ── Data loading ───────────────────────────────────────────────────────

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  async function ensureData() {
    if (AI.loaded) return;
    showStatus('aiCandStatus', 'Loading candidate data…', 'var(--neon-cyan)');

    try {
      const [cands, certs, ps, disc] = await Promise.all([
        loadJson('data/induction21_candidates.json'),
        loadJson('data/induction21_certificates.json'),
        loadJson('data/ProfileStatus.json'),
        loadJson('data/disciplineFullData.json'),
      ]);

      // Build certificate map (keyed by applicantId as string)
      AI.certificates = new Map();
      const certRaw = certs && typeof certs === 'object' ? certs : {};
      for (const k of Object.keys(certRaw)) {
        if (Array.isArray(certRaw[k])) AI.certificates.set(k, certRaw[k]);
      }

      // Build candidate map + attach certificates
      AI.candidates = new Map();
      const raw = cands && typeof cands === 'object' ? cands : {};
      for (const k of Object.keys(raw)) {
        const c = raw[k];
        if (c && c.applicantId != null) {
          // Attach certificates to candidate
          c.certificates = AI.certificates.get(String(c.applicantId)) || [];
          AI.candidates.set(Number(c.applicantId), c);
        }
      }
      AI.candidateArray = Array.from(AI.candidates.values()).sort((a, b) =>
        (a.applicantId || 0) - (b.applicantId || 0));

      // Build profile status
      // byId131  — type 131 (Verification Round) only
      // byId132  — type 132 (Amendment Process) only
      // effectiveById — 132 if exists, else 131 (definitive status per candidate)
      AI.profileStatus = { byId: new Map(), byId132: new Map(), effectiveById: new Map(), types: {}, entries: [] };
      if (ps && ps.statusTypes) AI.profileStatus.types = ps.statusTypes;
      if (ps && Array.isArray(ps.entries)) {
        AI.profileStatus.entries = ps.entries;
        for (const e of ps.entries) {
          const aid = Number(e.applicantId);
          if (e.statusTypeId === 131) AI.profileStatus.byId.set(aid, e);
          if (e.statusTypeId === 132) AI.profileStatus.byId132.set(aid, e);
        }
        // Build effective: 132 overrides 131
        for (const [aid, e131] of AI.profileStatus.byId) {
          AI.profileStatus.effectiveById.set(aid, e131);
        }
        for (const [aid, e132] of AI.profileStatus.byId132) {
          AI.profileStatus.effectiveById.set(aid, e132);
        }
      }

      // Build discipline map + speciality map
      AI.disciplineMap = new Map();
      AI.specialityMap = new Map();
      if (Array.isArray(disc)) {
        for (const d of disc) {
          if (d.disciplineId != null) AI.disciplineMap.set(Number(d.disciplineId), d);
          if (Array.isArray(d.specialities)) {
            for (const s of d.specialities) {
              if (s.specialityId != null) AI.specialityMap.set(Number(s.specialityId), s.specialityName || s.name || '');
            }
          }
        }
      }

      // Load revisions — static baseline, with admin-entered overrides from the
      // candidate_revisions Firestore collection merged additively on top (per
      // candidate, keyed by revId) so admin edits layer onto the shipped file
      // instead of replacing it.
      try {
        AI.revisions = await loadJson('data/induction21_revisions.json');
      } catch (_) {
        AI.revisions = {};
      }
      try {
        const snap = await firebase.firestore().collection('candidate_revisions').get();
        snap.forEach(doc => {
          const overrides = doc.data() || {};
          AI.revisions[doc.id] = { ...(AI.revisions[doc.id] || {}), ...overrides };
        });
      } catch (_) {
        // Firestore unavailable — fall back to the static baseline only.
      }

      AI.loaded = true;
      showStatus('aiCandStatus', '', '');
    } catch (err) {
      showStatus('aiCandStatus', 'Failed to load data: ' + err.message, 'var(--neon-pink)');
      throw err;
    }
  }

  // ── Certificate → Preference marks matching ────────────────────────────

  function certForPreference(pref, certs) {
    if (!pref || !Array.isArray(certs) || !certs.length) return null;
    const discIds = pref.disciplineIds || [];
    const typeId = pref.typeId;
    if (discIds.length) {
      return certs.find(c =>
        c.disciplineId != null &&
        discIds.includes(c.disciplineId) &&
        (typeId == null || c.typeId == null || c.typeId === typeId)
      ) || null;
    }
    return certs.find(c =>
      c.typeId === typeId &&
      (c.disciplineName && pref.specialityName && c.disciplineName.toLowerCase().includes(pref.specialityName.toLowerCase()))
    ) || null;
  }

  function prefBonusDetails(pref, certs) {
    const cert = certForPreference(pref, certs);
    if (!cert) return { value: 0, source: 'none', cert: null };

    const portalMarks = parseFloat(cert.certificateMarks);
    if (Number.isFinite(portalMarks) && portalMarks > 0) {
      return { value: portalMarks, source: 'certificate', cert };
    }
    const compMarks = parseFloat(cert.computerizedMarks);
    if (Number.isFinite(compMarks) && compMarks > 0) {
      return { value: compMarks, source: 'computerized', cert };
    }
    const pm = parseFloat(pref.programMarks || pref.marks);
    if (Number.isFinite(pm) && pm > 0) {
      return { value: pm, source: 'programMarks', cert };
    }
    return { value: 0, source: 'zero', cert };
  }

  // ── Profile status helpers ─────────────────────────────────────────────

  const STATUS_COLORS = {
    1: { bg: 'rgba(62,207,142,0.12)', fg: 'var(--neon-green)', label: 'Accepted' },
    2: { bg: 'rgba(220,60,60,0.12)', fg: 'var(--neon-pink)', label: 'Rejected' },
    11: { bg: 'rgba(245,200,66,0.12)', fg: 'var(--neon-gold)', label: 'Pending' },
  };

  function effectiveStatus(cand) {
    if (!AI.profileStatus) return null;
    return AI.profileStatus.effectiveById.get(Number(cand.applicantId)) || null;
  }

  function statusBadge(cand) {
    if (!AI.profileStatus) return '<span class="ai-status-pill ai-status-none">—</span>';
    const e = effectiveStatus(cand);
    if (!e) return '<span class="ai-status-pill ai-status-none">—</span>';
    const type = AI.profileStatus.types[String(e.statusTypeId)] || {};
    const labels = type.statusLabels || {};
    const label = labels[String(e.statusId)] || ('Status ' + e.statusId);
    const cls = e.statusId === 1 ? 'ai-status-accepted'
      : e.statusId === 2 ? 'ai-status-rejected'
      : e.statusId === 11 ? 'ai-status-pending'
      : 'ai-status-none';
    const viaAmendment = e.statusTypeId === 132;
    const suffix = viaAmendment ? ' <span class="ai-status-amend" title="Via Amendment Process"> Amend</span>' : '';
    return `<span class="ai-status-pill ${cls}">${esc(label)}${suffix}</span>`;
  }

  function allStatusEntries(cand) {
    if (!AI.profileStatus) return [];
    const id = Number(cand.applicantId);
    return AI.profileStatus.entries.filter(e => Number(e.applicantId) === id);
  }

  // ── Stats ──────────────────────────────────────────────────────────────

  function computeStats() {
    if (!AI.candidateArray) return { total: 0, accepted: 0, rejected: 0, pending: 0, noStatus: 0, amendAccepted: 0 };
    let accepted = 0, rejected = 0, pending = 0, noStatus = 0, amendAccepted = 0;
    for (const c of AI.candidateArray) {
      const e = effectiveStatus(c);
      if (!e) { noStatus++; continue; }
      if (e.statusId === 1) {
        accepted++;
        if (e.statusTypeId === 132) amendAccepted++;
      }
      else if (e.statusId === 2) rejected++;
      else if (e.statusId === 11) pending++;
      else noStatus++;
    }
    return { total: AI.candidateArray.length, accepted, rejected, pending, noStatus, amendAccepted };
  }

  function renderStats() {
    const el = document.getElementById('aiStatsRow');
    if (!el) return;
    const s = computeStats();
    el.innerHTML = `
      <div class="ai-stat-card">
        <span class="ai-stat-icon" style="color:var(--neon-cyan)">👥</span>
        <div class="ai-stat-body">
          <span class="ai-stat-val">${s.total.toLocaleString()}</span>
          <span class="ai-stat-lbl">Total</span>
        </div>
      </div>
      <div class="ai-stat-card ai-stat-accepted">
        <span class="ai-stat-icon" style="color:var(--neon-green)">✓</span>
        <div class="ai-stat-body">
          <span class="ai-stat-val">${s.accepted.toLocaleString()}</span>
          <span class="ai-stat-lbl">Accepted${s.amendAccepted > 0 ? ' <span class=\"ai-stat-amend\">(' + s.amendAccepted + ' amend)</span>' : ''}</span>
        </div>
      </div>
      <div class="ai-stat-card ai-stat-pending">
        <span class="ai-stat-icon" style="color:var(--neon-gold)">⏳</span>
        <div class="ai-stat-body">
          <span class="ai-stat-val">${s.pending.toLocaleString()}</span>
          <span class="ai-stat-lbl">Pending</span>
        </div>
      </div>
      <div class="ai-stat-card ai-stat-rejected">
        <span class="ai-stat-icon" style="color:var(--neon-pink)">✕</span>
        <div class="ai-stat-body">
          <span class="ai-stat-val">${s.rejected.toLocaleString()}</span>
          <span class="ai-stat-lbl">Rejected</span>
        </div>
      </div>
      <div class="ai-stat-card">
        <span class="ai-stat-icon" style="color:var(--text-muted)">?</span>
        <div class="ai-stat-body">
          <span class="ai-stat-val">${s.noStatus.toLocaleString()}</span>
          <span class="ai-stat-lbl">No Status</span>
        </div>
      </div>
    `;
  }

  // ── Candidates tab ─────────────────────────────────────────────────────

  let aiFilter = { q: '', status: '', program: '' };

  async function loadCandidatesTab() {
    await ensureData();
    renderStats();
    renderCandidateTable();
  }

  function renderCandidateTable() {
    const tbody = document.getElementById('aiCandBody');
    const countEl = document.getElementById('aiCandCount');
    if (!tbody || !AI.candidateArray) return;

    const q = (aiFilter.q || '').toLowerCase().trim();
    const statusFilter = aiFilter.status;
    const progFilter = aiFilter.program;

    let rows = AI.candidateArray;

    if (q) {
      rows = rows.filter(c => {
        const name = String(c.nameFull || '').toLowerCase();
        const id = String(c.applicantId || '');
        const pmdc = String(c.pmdcNo || '').toLowerCase();
        const cnic = String(c.cnic || '');
        return name.includes(q) || id.includes(q) || pmdc.includes(q) || cnic.includes(q);
      });
    }

    if (statusFilter) {
      const sid = Number(statusFilter);
      rows = rows.filter(c => {
        const e = effectiveStatus(c);
        return e && Number(e.statusId) === sid;
      });
    }

    if (progFilter) {
      rows = rows.filter(c => {
        const prefs = c.preferences || [];
        return prefs.some(p => p.typeName === progFilter);
      });
    }

    const visible = rows.slice(0, 200);
    if (countEl) countEl.textContent = rows.length.toLocaleString() + ' candidate' + (rows.length === 1 ? '' : 's');

    tbody.innerHTML = visible.map(c => {
      const marks = fmtM(c.marksTotal);
      const marksCls = c.marksTotal >= 80 ? 'ai-marks-high' : c.marksTotal >= 60 ? 'ai-marks-mid' : 'ai-marks-low';
      const st = statusBadge(c);
      const prefs = c.preferences || [];
      const progSet = new Set(prefs.map(p => p.typeName).filter(Boolean));
      const progs = Array.from(progSet).map(p => `<span class="ai-prog-chip">${esc(p)}</span>`).join('') || '<span style="color:var(--text-muted)">—</span>';
      const certs = c.certificates || [];
      const certCount = certs.length;
      return `<tr class="ai-cand-row" data-id="${esc(c.applicantId)}">
        <td class="ai-cand-id">${esc(c.applicantId)}</td>
        <td class="ai-cand-name">
          <div class="ai-cand-avatar">${esc(initials(c.nameFull))}</div>
          <span>${esc(c.nameFull)}</span>
        </td>
        <td class="ai-cand-marks ${marksCls}">${marks}</td>
        <td class="ai-cand-prog">${progs}</td>
        <td class="ai-cand-prefs"><span class="ai-pref-count">${prefs.length}</span> <span class="ai-cert-count" title="Certificates">${certCount} 📜</span></td>
        <td class="ai-cand-status">${st}</td>
      </tr>`;
    }).join('');

    if (rows.length > 200) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="6" class="ai-table-overflow">Showing 200 of ${rows.length.toLocaleString()} — narrow your search</td>`;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('.ai-cand-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = Number(tr.dataset.id);
        const c = AI.candidates.get(id);
        if (c) openCandidateDetail(c);
      });
    });
  }

  // ── Candidate detail modal ─────────────────────────────────────────────

  function openCandidateDetail(c) {
    const overlay = document.getElementById('aiDetailOverlay');
    const body = document.getElementById('aiDetailBody');
    if (!overlay || !body) return;

    const prefs = c.preferences || [];
    const certs = c.certificates || [];
    const allSt = allStatusEntries(c);
    const revs = (AI.revisions && AI.revisions[String(c.applicantId)]) || {};

    // Status entries
    const statusHtml = allSt.length ? allSt.map(e => {
      const type = AI.profileStatus.types[String(e.statusTypeId)] || {};
      const labels = type.statusLabels || {};
      const label = labels[String(e.statusId)] || ('Status ' + e.statusId);
      const cls = e.statusId === 1 ? 'ai-status-accepted'
        : e.statusId === 2 ? 'ai-status-rejected'
        : e.statusId === 11 ? 'ai-status-pending' : 'ai-status-none';
      const isEffective = e.statusTypeId === 132 || (e.statusTypeId === 131 && !AI.profileStatus.byId132.has(Number(c.applicantId)));
      const effBadge = isEffective ? ' <span class="ai-status-amend" title="Effective status">effective</span>' : '';
      return `<tr${isEffective ? ' class="ai-status-row-effective"' : ''}>
        <td style="font-size:0.78rem;color:var(--text-muted)">${esc(type.label || ('Type ' + e.statusTypeId))}</td>
        <td><span class="ai-status-pill ${cls}">${esc(label)}</span>${effBadge}</td>
        <td style="font-size:0.75rem;color:var(--text-muted)">${esc(e.remarks || '—')}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:8px">No status entries</td></tr>';

    // Revisions
    const revIds = Object.keys(revs);
    const revHtml = revIds.length ? revIds.map(rid => {
      const rev = revs[rid];
      const fields = Object.keys(rev).filter(k => k !== '_timestamp');
      const fieldHtml = fields.map(f => {
        const v = rev[f];
        if (typeof v === 'object' && v !== null) return `<span class="ai-rev-field">${esc(f)}: ${esc(JSON.stringify(v))}</span>`;
        return `<span class="ai-rev-field">${esc(f)} = ${esc(String(v))}</span>`;
      }).join(' ');
      return `<tr>
        <td><span class="ai-rev-id">${esc(rid)}</span></td>
        <td style="font-size:0.78rem">${fieldHtml || '<em style="color:var(--text-muted)">no fields</em>'}</td>
        <td style="font-size:0.72rem;color:var(--text-muted)">${esc(rev._timestamp || '—')}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:8px">No revisions</td></tr>';

    // Marks breakdown
    const markFields = [
      { key: 'marksTotal', label: 'Total', highlight: true },
      { key: 'degree', label: 'Degree' },
      { key: 'houseJob', label: 'House Job' },
      { key: 'mdcat', label: 'MDCAT' },
      { key: 'matric', label: 'Matric' },
      { key: 'fsc', label: 'FSc' },
      { key: 'position', label: 'Position' },
      { key: 'experience', label: 'Experience' },
      { key: 'research', label: 'Research' },
      { key: 'hardAreas', label: 'Hard Areas' },
      { key: 'attempts', label: 'Attempts' },
    ];
    const marksHtml = markFields.map(f => {
      const v = c[f.key];
      const cls = f.highlight ? 'ai-marks-row-total' : '';
      return `<tr class="${cls}"><td>${esc(f.label)}</td><td class="ai-marks-val">${fmtM(v)}</td></tr>`;
    }).join('');

    // Certificates
    const certsHtml = certs.length ? certs.map(cert => {
      const discName = cert.disciplineName || (AI.disciplineMap.get(Number(cert.disciplineId))?.name || '—');
      const marks = parseFloat(cert.certificateMarks) || parseFloat(cert.computerizedMarks) || 0;
      const marksCls = marks > 0 ? 'ai-cert-marks-active' : 'ai-cert-marks-zero';
      const statusCls = cert.status === 'Pass' ? 'ai-cert-pass' : 'ai-cert-fail';
      return `<div class="ai-cert-card">
        <div class="ai-cert-header">
          <span class="ai-cert-type">${esc(cert.typeName || '—')}</span>
          <span class="ai-cert-disc">${esc(discName)}</span>
          <span class="ai-cert-status ${statusCls}">${esc(cert.status || '—')}</span>
        </div>
        <div class="ai-cert-body">
          <div class="ai-cert-marks ${marksCls}">
            <span class="ai-cert-marks-val">${fmtM(cert.certificateMarks)}</span>
            <span class="ai-cert-marks-lbl">portal</span>
          </div>
          <div class="ai-cert-marks ${marksCls}">
            <span class="ai-cert-marks-val">${fmtM(cert.computerizedMarks)}</span>
            <span class="ai-cert-marks-lbl">computed</span>
          </div>
          <div class="ai-cert-meta">
            <span>Attempt: <strong>${esc(cert.attempt || '—')}</strong></span>
            <span>Session: <strong>${esc(cert.session || '—')}</strong></span>
          </div>
        </div>
      </div>`;
    }).join('') : '<p style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">No certificates</p>';

    // Preferences (card-based with proper marks)
    const prefsHtml = prefs.length ? prefs.map((p, i) => {
      const discIds = p.disciplineIds || [];
      const discNames = discIds.map(id => {
        const d = AI.disciplineMap.get(Number(id));
        return d ? d.name : ('Disc ' + id);
      });
      const discChips = discNames.map(n => `<span class="ai-pref-disc">${esc(n)}</span>`).join('');

      // Calculate marks from certificates
      const bonus = prefBonusDetails(p, certs);
      const marksVal = bonus.value > 0 ? fmtM(bonus.value) : '0.00';
      const sourceLabel = {
        certificate: 'cert',
        computerized: 'computed',
        programMarks: 'pref',
        zero: 'none',
        none: 'no cert',
      }[bonus.source] || bonus.source;
      const marksCls = bonus.value > 0 ? 'ai-pref-marks-active' : 'ai-pref-marks-zero';

      return `<div class="ai-pref-row${p.parentInstitute ? ' ai-pref-parent' : ''}">
        <div class="ai-pref-no"><span class="ai-pref-no-badge">${esc(p.preferenceNo || (i + 1))}</span></div>
        <div class="ai-pref-body">
          <div class="ai-pref-spec-row">
            <span class="ai-pref-spec">${esc(specialityName(p))}</span>
            <span class="ai-pref-type-chip">${esc(p.typeName || '—')}</span>
            <span class="ai-pref-marks-badge ${marksCls}">
              <span class="ai-pref-marks-val">${marksVal}</span>
              <span class="ai-pref-marks-src">${sourceLabel}</span>
            </span>
          </div>
          <div class="ai-pref-meta-row">
            <span class="ai-pref-hosp">🏥 ${esc(p.hospitalName || '—')}</span>
            <span class="ai-pref-meta-sep">·</span>
            <span class="ai-pref-quota">📍 ${esc(p.quotaName || '—')}</span>
            ${discChips ? `<span class="ai-pref-meta-sep">·</span><span class="ai-pref-discs">${discChips}</span>` : ''}
            ${p.parentInstitute ? '<span class="ai-pref-parent-star" title="Parent institute">★</span>' : ''}
          </div>
        </div>
      </div>`;
    }).join('') : '<p style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">No preferences</p>';

    body.innerHTML = `
      <div class="ai-detail-header">
        <div class="ai-detail-avatar">${esc(initials(c.nameFull))}</div>
        <div class="ai-detail-header-info">
          <h3>${esc(c.nameFull)}</h3>
          <p class="ai-detail-sub">
            <span class="ai-detail-tag">Applicant #${esc(c.applicantId)}</span>
            <span class="ai-detail-tag">PMDC: ${esc(c.pmdcNo || '—')}</span>
            <span class="ai-detail-tag">CNIC: ${esc(c.cnic || '—')}</span>
          </p>
        </div>
        <div class="ai-detail-header-status">${statusBadge(c)}</div>
      </div>

      <div class="ai-detail-grid">
        <div class="ai-detail-card">
          <h4>📊 Marks Breakdown</h4>
          <table class="ai-detail-table">
            <tbody>${marksHtml}</tbody>
          </table>
        </div>

        <div class="ai-detail-card">
          <h4>🛡️ Profile Status</h4>
          <table class="ai-detail-table">
            <thead><tr><th>Round</th><th>Status</th><th>Remarks</th></tr></thead>
            <tbody>${statusHtml}</tbody>
          </table>
        </div>

        <div class="ai-detail-card">
          <h4>📝 Revisions</h4>
          <table class="ai-detail-table">
            <thead><tr><th>ID</th><th>Fields</th><th>Time</th></tr></thead>
            <tbody>${revHtml}</tbody>
          </table>
        </div>
      </div>

      <div class="ai-detail-card" id="aiMarksEditCard">
        <h4>✏️ Edit Marks</h4>
        <p style="font-size:0.75rem;color:var(--text-muted);margin:0 0 10px">Override individual mark fields. Saved as a revision on the server, visible to every admin and reflected on the simulation portal after refresh.</p>
        <div class="marks-edit-grid">
          ${markFields.map(f => `
            <div class="marks-edit-field">
              <label>${esc(f.label)}</label>
              <input type="number" step="0.001" class="cand-edit-input" data-field="${f.key}" value="${c[f.key] ?? ''}" />
            </div>
          `).join('')}
        </div>
        <div class="marks-edit-actions">
          <button class="ai-btn-primary" id="aiSaveMarksEdit">Save Revision</button>
          <button class="ai-btn-secondary" id="aiResetMarksEdit">Reset</button>
          <span id="aiMarksEditStatus" style="font-size:0.78rem;color:var(--text-muted);margin-left:10px"></span>
        </div>
      </div>

      <div class="ai-detail-card ai-detail-prefs">
        <h4>🎯 Preferences (${prefs.length})</h4>
        <div class="ai-pref-list">${prefsHtml}</div>
      </div>

      <div class="ai-detail-card">
        <h4>📜 Certificates (${certs.length})</h4>
        <div class="ai-cert-list">${certsHtml}</div>
      </div>

      <div class="ai-detail-card">
        <h4>✉️ Contact</h4>
        <div class="ai-detail-contact">
          <div class="ai-contact-item"><span class="ai-contact-icon">📧</span> ${esc(c.emailId || '—')}</div>
          <div class="ai-contact-item"><span class="ai-contact-icon">📱</span> ${esc(c.contactNumber || '—')}</div>
        </div>
      </div>
    `;

    document.getElementById('aiSaveMarksEdit')?.addEventListener('click', () => saveAdminCandMarks(c));
    document.getElementById('aiResetMarksEdit')?.addEventListener('click', () => resetAdminCandMarks(c));

    overlay.classList.add('visible');
    overlay.style.display = 'flex';
  }

  function closeCandidateDetail() {
    const overlay = document.getElementById('aiDetailOverlay');
    if (overlay) {
      overlay.classList.remove('visible');
      overlay.style.display = 'none';
    }
  }

  // ── JSON bulk upload ───────────────────────────────────────────────────

  function setupJsonUpload() {
    const fileInput = document.getElementById('aiRevFile');
    const uploadBtn = document.getElementById('aiRevUploadBtn');
    if (!fileInput || !uploadBtn) return;

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) {
        showStatus('aiRevUploadStatus', `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'var(--text-muted)');
      }
    });

    uploadBtn.addEventListener('click', () => {
      const file = fileInput.files[0];
      if (!file) {
        showStatus('aiRevUploadStatus', 'Please select a JSON file first.', 'var(--neon-pink)');
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('JSON must be an object keyed by applicantId');
          }
          showStatus('aiRevUploadStatus', 'Uploading to server…', 'var(--text-muted)');
          const db = firebase.firestore();
          const col = db.collection('candidate_revisions');
          const entries = Object.entries(parsed).filter(([, revs]) => revs && typeof revs === 'object' && !Array.isArray(revs));
          let mergedCount = 0;
          for (let i = 0; i < entries.length; i += 400) {
            const batch = db.batch();
            for (const [appId, revs] of entries.slice(i, i + 400)) {
              batch.set(col.doc(String(appId)), revs, { merge: true });
              mergedCount += Object.keys(revs).length;
            }
            await batch.commit();
          }
          for (const [appId, revs] of entries) {
            AI.revisions[appId] = { ...(AI.revisions[appId] || {}), ...revs };
          }
          showStatus('aiRevUploadStatus',
            `Uploaded ${mergedCount} revision(s) across ${entries.length} candidate(s) to the server — visible to every admin.`,
            'var(--neon-green)');
        } catch (err) {
          showStatus('aiRevUploadStatus', 'Upload error: ' + err.message, 'var(--neon-pink)');
        }
      };
      reader.readAsText(file);
    });

    const loadStaticBtn = document.getElementById('aiRevLoadStaticBtn');
    if (loadStaticBtn) {
      loadStaticBtn.addEventListener('click', async () => {
        showStatus('aiRevUploadStatus', 'Reloading revisions from server…', 'var(--text-muted)');
        try {
          let baseline = {};
          try { baseline = await loadJson('data/induction21_revisions.json'); } catch (_) {}
          const snap = await firebase.firestore().collection('candidate_revisions').get();
          snap.forEach(doc => {
            baseline[doc.id] = { ...(baseline[doc.id] || {}), ...(doc.data() || {}) };
          });
          AI.revisions = baseline;
          showStatus('aiRevUploadStatus',
            `Reloaded — ${Object.keys(baseline).length} candidate(s) have revisions (static file + admin overrides).`,
            'var(--neon-green)');
        } catch (err) {
          showStatus('aiRevUploadStatus', 'Reload error: ' + err.message, 'var(--neon-pink)');
        }
      });
    }

    const clearBtn = document.getElementById('aiRevClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!confirm('Discard any unsaved local changes and reload revisions from the server?')) return;
        loadStaticBtn?.click();
      });
    }
  }

  // ── Dropdown visibility / defaults config ──────────────────────────────

  function adminConfigDefault() {
    return {
      dropdownVisibility: { marksBasis: true, revision: true, statusScope: true },
      defaultValues: { marksBasis: '', revision: '', statusScope: '' },
    };
  }

  function loadAdminConfig() {
    try {
      const raw = localStorage.getItem(ADMIN_CFG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const def = adminConfigDefault();
        return {
          dropdownVisibility: { ...def.dropdownVisibility, ...parsed.dropdownVisibility },
          defaultValues: { ...def.defaultValues, ...parsed.defaultValues },
        };
      }
    } catch (_) {}
    return adminConfigDefault();
  }

  function saveAdminConfig(cfg) {
    localStorage.setItem(ADMIN_CFG_KEY, JSON.stringify(cfg));
  }

  function renderDropdownConfig() {
    const container = document.getElementById('aiDropdownCfgContent');
    if (!container) return;

    const cfg = loadAdminConfig();
    const scopes = (typeof DEFAULT_SIM_STATUS_SCOPES_ADMIN !== 'undefined' ? DEFAULT_SIM_STATUS_SCOPES_ADMIN : []);

    container.innerHTML = `
      <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 0.75rem;max-width:640px;">
        Control which dropdowns are visible on the simulation portal's Config tab.
        When a dropdown is hidden, the default value below is applied automatically.
        Stored in <code>localStorage</code> key <code>mn_admin_sim_config</code> (per-browser).
      </p>
      <table class="logs-table" style="width:100%;max-width:640px;">
        <thead>
          <tr><th>Control</th><th>Visible</th><th>Default (when hidden)</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Merit Formula</strong><br><span style="font-size:0.72rem;color:var(--text-muted)">cfgMarksBasis</span></td>
            <td><label class="toggle-row"><input type="checkbox" id="aiCfgVisMarks" ${cfg.dropdownVisibility.marksBasis ? 'checked' : ''} /> Show</label></td>
            <td><input type="text" id="aiCfgDefMarks" value="${esc(cfg.defaultValues.marksBasis)}" placeholder="(use Firestore default)" style="width:100%;padding:5px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.78rem;" ${cfg.dropdownVisibility.marksBasis ? 'disabled' : ''} /></td>
          </tr>
          <tr>
            <td><strong>Candidate Revision</strong><br><span style="font-size:0.72rem;color:var(--text-muted)">cfgCandidateRevision</span></td>
            <td><label class="toggle-row"><input type="checkbox" id="aiCfgVisRev" ${cfg.dropdownVisibility.revision ? 'checked' : ''} /> Show</label></td>
            <td><input type="text" id="aiCfgDefRev" value="${esc(cfg.defaultValues.revision)}" placeholder="(use Firestore default)" style="width:100%;padding:5px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.78rem;" ${cfg.dropdownVisibility.revision ? 'disabled' : ''} /></td>
          </tr>
          <tr>
            <td><strong>Status Scope</strong><br><span style="font-size:0.72rem;color:var(--text-muted)">cfgSimStatusScope</span></td>
            <td><label class="toggle-row"><input type="checkbox" id="aiCfgVisScope" ${cfg.dropdownVisibility.statusScope ? 'checked' : ''} /> Show</label></td>
            <td>
              <select id="aiCfgDefScope" style="width:100%;padding:5px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.78rem;" ${cfg.dropdownVisibility.statusScope ? 'disabled' : ''}>
                <option value="">(use Firestore default)</option>
                ${scopes.map(s => `<option value="${esc(s.id)}"${cfg.defaultValues.statusScope === s.id ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top:0.75rem;display:flex;gap:0.5rem;align-items:center;">
        <button id="aiCfgSaveBtn" style="padding:7px 18px;background:var(--accent);color:#0a0e1a;border:none;border-radius:8px;font-weight:700;cursor:pointer;">Save</button>
        <span id="aiCfgSaveStatus" style="font-size:0.78rem;color:var(--text-muted);"></span>
      </div>
    `;

    ['Marks', 'Rev', 'Scope'].forEach(suffix => {
      const cb = document.getElementById('aiCfgVis' + suffix);
      const def = document.getElementById('aiCfgDef' + suffix);
      if (cb && def) cb.addEventListener('change', () => { def.disabled = cb.checked; });
    });

    document.getElementById('aiCfgSaveBtn')?.addEventListener('click', () => {
      const cfg = adminConfigDefault();
      cfg.dropdownVisibility.marksBasis = document.getElementById('aiCfgVisMarks')?.checked ?? true;
      cfg.dropdownVisibility.revision = document.getElementById('aiCfgVisRev')?.checked ?? true;
      cfg.dropdownVisibility.statusScope = document.getElementById('aiCfgVisScope')?.checked ?? true;
      cfg.defaultValues.marksBasis = document.getElementById('aiCfgDefMarks')?.value || '';
      cfg.defaultValues.revision = document.getElementById('aiCfgDefRev')?.value || '';
      cfg.defaultValues.statusScope = document.getElementById('aiCfgDefScope')?.value || '';
      saveAdminConfig(cfg);
      const st = document.getElementById('aiCfgSaveStatus');
      if (st) { st.textContent = 'Saved.'; st.style.color = 'var(--neon-green)'; }
      setTimeout(() => { if (st) st.textContent = ''; }, 2500);
    });
  }

  async function saveAdminCandMarks(c) {
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
      showStatus('aiMarksEditStatus', 'No changes detected.', 'var(--text-muted)');
      return;
    }
    const id = String(c.applicantId);
    const revId = 'admin_revision_' + Date.now();
    showStatus('aiMarksEditStatus', 'Saving…', 'var(--text-muted)');
    try {
      await firebase.firestore().collection('candidate_revisions').doc(id).set({ [revId]: revision }, { merge: true });
      AI.revisions = AI.revisions || {};
      AI.revisions[id] = { ...(AI.revisions[id] || {}), [revId]: revision };
      showStatus('aiMarksEditStatus', 'Saved — visible to every admin, and on the simulation portal after refresh.', 'var(--neon-green)');
      setTimeout(() => showStatus('aiMarksEditStatus', '', ''), 4000);
    } catch (e) {
      showStatus('aiMarksEditStatus', 'Error saving to server: ' + e.message, 'var(--neon-pink)');
    }
  }

  function resetAdminCandMarks(c) {
    document.querySelectorAll('.cand-edit-input[data-field]').forEach(inp => {
      const field = inp.dataset.field;
      inp.value = c[field] ?? '';
    });
    const st = document.getElementById('aiMarksEditStatus');
    if (st) { st.textContent = 'Reset to original values.'; st.style.color = 'var(--text-muted)'; }
    setTimeout(() => { if (st) st.textContent = ''; }, 2500);
  }

  // ── Init ───────────────────────────────────────────────────────────────

  function init() {
    const searchEl = document.getElementById('aiCandSearch');
    if (searchEl) searchEl.addEventListener('input', () => {
      aiFilter.q = searchEl.value;
      renderCandidateTable();
    });

    const statusSel = document.getElementById('aiCandStatusFilter');
    if (statusSel) statusSel.addEventListener('change', () => {
      aiFilter.status = statusSel.value;
      renderCandidateTable();
    });

    const progSel = document.getElementById('aiCandProgFilter');
    if (progSel) progSel.addEventListener('change', () => {
      aiFilter.program = progSel.value;
      renderCandidateTable();
    });

    setupJsonUpload();

    const closeBtn = document.getElementById('aiDetailClose');
    if (closeBtn) closeBtn.addEventListener('click', closeCandidateDetail);
    const overlay = document.getElementById('aiDetailOverlay');
    if (overlay) overlay.addEventListener('click', e => {
      if (e.target === overlay) closeCandidateDetail();
    });

    renderDropdownConfig();
  }

  window.loadCandidatesTab = loadCandidatesTab;
  window.renderDropdownConfig = renderDropdownConfig;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
