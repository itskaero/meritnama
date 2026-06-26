'use strict';

const ADMIN_CONFIG_KEY = 'mn_admin_sim_config';

function _escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function adminConfigDefault() {
  return {
    dropdownVisibility: {
      marksBasis: true,
      revision: true,
      statusScope: true,
    },
    defaultValues: {
      marksBasis: '',
      revision: '',
      statusScope: '',
    },
  };
}

function loadAdminConfig() {
  try {
    const raw = localStorage.getItem(ADMIN_CONFIG_KEY);
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
  localStorage.setItem(ADMIN_CONFIG_KEY, JSON.stringify(cfg));
}

function setupAdminConfigTab() {
  const container = document.getElementById('adminConfigContent');
  if (!container) return;
  renderAdminConfigPanel(container);
}

function renderAdminConfigPanel(container) {
  const cfg = loadAdminConfig();
  const marksOpts = typeof SIM !== 'undefined' && SIM.marks?.options ? SIM.marks.options : [];
  const revIds = typeof collectCandidateRevisionIds === 'function' ? collectCandidateRevisionIds() : [];
  const scopeOpts = typeof getDefaultStatusScopes === 'function'
    ? getDefaultStatusScopes()
    : [{ id: 'all', label: 'All Candidates' }, { id: 'accepted', label: 'Accepted Only' }, { id: 'rejected', label: 'Rejected Only' }, { id: 'pending', label: 'Pending Only' }];

  container.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">Simulation Portal — Config Controls</h3>
      <p style="margin:0 0 14px;color:var(--text-muted);font-size:0.85rem">
        Control which dropdowns are visible in the simulation portal's Config tab,
        and set default values used when a dropdown is hidden.
      </p>

      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th>Control</th>
            <th>Visible</th>
            <th>Default Value (when hidden)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Merit Formula</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">cfgMarksBasis</span></td>
            <td>
              <label class="admin-toggle">
                <input type="checkbox" id="acfg-vis-marksBasis" ${cfg.dropdownVisibility.marksBasis ? 'checked' : ''} />
                <span class="admin-toggle-slider"></span>
              </label>
            </td>
            <td>
              <select id="acfg-def-marksBasis" class="admin-cfg-sel" ${cfg.dropdownVisibility.marksBasis ? 'disabled' : ''}>
                <option value="">Use Firestore default</option>
                ${marksOpts.map(o => `<option value="${_escHtml(o.id)}"${cfg.defaultValues.marksBasis === o.id ? ' selected' : ''}>${_escHtml(o.label || o.id)}</option>`).join('')}
              </select>
            </td>
          </tr>
          <tr>
            <td><strong>Candidate Revision</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">cfgCandidateRevision</span></td>
            <td>
              <label class="admin-toggle">
                <input type="checkbox" id="acfg-vis-revision" ${cfg.dropdownVisibility.revision ? 'checked' : ''} />
                <span class="admin-toggle-slider"></span>
              </label>
            </td>
            <td>
              <select id="acfg-def-revision" class="admin-cfg-sel" ${cfg.dropdownVisibility.revision ? 'disabled' : ''}>
                <option value="">Use Firestore default</option>
                ${revIds.map(id => `<option value="${_escHtml(id)}"${cfg.defaultValues.revision === id ? ' selected' : ''}>${_escHtml(id)}</option>`).join('')}
              </select>
            </td>
          </tr>
          <tr>
            <td><strong>Status Scope</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">cfgSimStatusScope</span></td>
            <td>
              <label class="admin-toggle">
                <input type="checkbox" id="acfg-vis-statusScope" ${cfg.dropdownVisibility.statusScope ? 'checked' : ''} />
                <span class="admin-toggle-slider"></span>
              </label>
            </td>
            <td>
              <select id="acfg-def-statusScope" class="admin-cfg-sel" ${cfg.dropdownVisibility.statusScope ? 'disabled' : ''}>
                <option value="">Use Firestore default</option>
                ${scopeOpts.map(s => `<option value="${_escHtml(s.id)}"${cfg.defaultValues.statusScope === s.id ? ' selected' : ''}>${_escHtml(s.label || s.id)}</option>`).join('')}
              </select>
            </td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary btn-sm" id="acfgSaveBtn">Save Config</button>
        <span id="acfgStatus" style="font-size:0.82rem;color:var(--text-muted)"></span>
      </div>
    </div>

    <div id="adminConfigDetails">
      <p class="text-muted" style="font-size:0.85rem">Loading configuration details…</p>
    </div>
  `;

  // Toggle handler: when visible is unchecked, enable the default value select
  ['marksBasis', 'revision', 'statusScope'].forEach(key => {
    const visCb = document.getElementById('acfg-vis-' + key);
    const defSel = document.getElementById('acfg-def-' + key);
    if (visCb && defSel) {
      visCb.addEventListener('change', () => {
        defSel.disabled = visCb.checked;
      });
    }
  });

  document.getElementById('acfgSaveBtn')?.addEventListener('click', () => {
    const cfg = adminConfigDefault();
    ['marksBasis', 'revision', 'statusScope'].forEach(key => {
      const visCb = document.getElementById('acfg-vis-' + key);
      const defSel = document.getElementById('acfg-def-' + key);
      if (visCb) cfg.dropdownVisibility[key] = visCb.checked;
      if (defSel && !visCb?.checked) cfg.defaultValues[key] = defSel.value;
      else cfg.defaultValues[key] = '';
    });
    saveAdminConfig(cfg);
    const status = document.getElementById('acfgStatus');
    if (status) { status.textContent = 'Saved.'; status.style.color = 'var(--neon-green)'; }
    setTimeout(() => { if (status) status.textContent = ''; }, 2500);
  });

  // Render admin-only details below (only in simulation portal where SIM is available)
  if (typeof SIM !== 'undefined') renderAdminConfigDetails(container);
}

function renderAdminConfigDetails(container) {
  const detailsEl = document.getElementById('adminConfigDetails');
  if (!detailsEl) return;

  // Data sources
  const sources = [
    { id: 'candidates', file: 'induction21_candidates.json', count: SIM.candidates?.length, desc: 'Candidate records' },
    { id: 'certificates', file: 'induction21_certificates.json', count: SIM.certificatesByApplicantId ? Object.keys(SIM.certificatesByApplicantId).length : 0, desc: 'Certificate records' },
    { id: 'components', file: 'induction21_components.json', count: SIM.componentsByApplicantId ? Object.keys(SIM.componentsByApplicantId).length : 0, desc: 'Component marks' },
    { id: 'policy', file: 'induction21_certificate_policy.json', count: SIM.certificatePolicy ? 'loaded' : null, desc: 'Certificate policy' },
    { id: 'revisions', file: 'induction21_revisions.json', count: SIM.revisionsByApplicantId ? Object.keys(SIM.revisionsByApplicantId).length : 0, desc: 'Revisions' },
    { id: 'seats', file: 'induction21_seats.json', count: SIM.seatsLoaded ? (SIM.flatSeats?.length || 'nested') : null, desc: 'Training seats' },
    { id: 'disciplineLookup', file: 'disciplineFullData.json', count: SIM.disciplineMap ? Object.keys(SIM.disciplineMap).length : 0, desc: 'Discipline lookup' },
    { id: 'statuses', file: 'ProfileStatus.json', count: SIM.profileStatus?.loaded ? Object.keys(SIM.profileStatus.byId || {}).length : 0, desc: 'Profile statuses' },
  ];

  const sourcesHtml = sources.map(s => {
    const loaded = s.count != null;
    return `<tr class="${loaded ? 'config-source-ok' : 'config-source-missing'}">
      <td><strong>${_escHtml(s.id)}</strong><br><span class="config-source-desc">${_escHtml(s.desc)}</span></td>
      <td style="font-size:0.8rem;color:var(--text-muted)">${_escHtml(s.file)}</td>
      <td><span class="config-source-status ${loaded ? 'config-source-status-ok' : 'config-source-status-missing'}">${loaded ? 'Loaded' : 'Not loaded'}</span></td>
      <td class="td-num">${s.count === 'loaded' ? '✓' : String(s.count ?? '—')}</td>
    </tr>`;
  }).join('');

  // Tracked fields
  const tracked = SIM.trackedFields?.length ? SIM.trackedFields : ['houseJob', 'position', 'mdcat', 'degree'];
  const trackedHtml = tracked.map(f => `<span class="config-chip">${_escHtml(f)}</span>`).join('');

  // Revision stats
  const totalRev = typeof collectCandidateRevisionIds === 'function' ? collectCandidateRevisionIds().length : 0;
  const candWithRev = (SIM.candidates || []).filter(c => typeof candidateHasRevisions === 'function' && candidateHasRevisions(c)).length;
  const disabledRev = SIM.globallyDisabledRevisionIds || [];

  // Marks formula
  const marksOpts = SIM.marks?.options || [];
  const activeMarksId = SIM.marks?.activeOptionId || marksOpts[0]?.id;
  const formulaHtml = marksOpts.map(opt => {
    const isActive = opt.id === activeMarksId;
    const adjustments = (opt.adjustments || []).map(a =>
      `${a.op === 'subtract' ? '&minus;' : '+'} ${_escHtml(a.field)}`
    ).join(', ') || '<em>none</em>';
    const sumFields = opt.base === 'sum' && opt.sumFields?.length
      ? opt.sumFields.map(f => _escHtml(f)).join(', ')
      : '<em>marksTotal</em>';
    return `<tr${isActive ? ' style="background:var(--accent-glow, rgba(77,184,217,0.08))"' : ''}>
      <td>${_escHtml(opt.id)}${isActive ? ' <span style="color:var(--neon-cyan)">&#9668; active</span>' : ''}</td>
      <td>${_escHtml(opt.label)}</td>
      <td>${_escHtml(opt.base)}</td>
      <td style="font-size:0.85rem">${sumFields}</td>
      <td style="font-size:0.85rem">${adjustments}</td>
    </tr>`;
  }).join('');

  // Certificate policy
  const policy = SIM.certificatePolicy || {};
  const fcpsAttempts = Object.entries(policy.fcps?.attemptMarks || {}).map(([a, m]) =>
    `<tr><td>${_escHtml(a)}</td><td>${_escHtml(String(m))}</td></tr>`
  ).join('');
  const msmdTiers = (policy.msmd?.percentageMarks || []).map(tier => {
    const label = tier.gt != null ? `>${tier.gt}` : String(tier.min);
    return `<tr><td>${_escHtml(label)}%</td><td>${_escHtml(String(tier.marks))}</td></tr>`;
  }).join('');

  detailsEl.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">Data Sources</h3>
      <table class="data-table" style="width:100%">
        <thead><tr><th>Source</th><th>File</th><th>Status</th><th>Records</th></tr></thead>
        <tbody>${sourcesHtml}</tbody>
      </table>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">Mark Formula</h3>
      <table class="data-table" style="width:100%">
        <thead><tr><th>ID</th><th>Label</th><th>Base</th><th>Sum Fields</th><th>Adjustments</th></tr></thead>
        <tbody>${formulaHtml}</tbody>
      </table>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">Tracked Fields</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${trackedHtml}</div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">Revision Management</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
        <div class="config-stat"><span class="config-stat-val">${totalRev}</span><span class="config-stat-label">Available revision IDs</span></div>
        <div class="config-stat"><span class="config-stat-val">${candWithRev}</span><span class="config-stat-label">Candidates with revisions</span></div>
        <div class="config-stat"><span class="config-stat-val">${disabledRev.length}</span><span class="config-stat-label">Globally disabled</span></div>
      </div>
      ${disabledRev.length ? `<p style="margin:0 0 6px;font-weight:600;font-size:0.85rem">Disabled revision IDs:</p><div style="display:flex;flex-wrap:wrap;gap:6px">${disabledRev.map(id => `<span class="config-chip config-chip-disabled">${_escHtml(id)}</span>`).join('')}</div>` : '<p style="color:var(--text-muted);font-size:0.85rem">No globally disabled revision IDs.</p>'}
    </div>

    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">Certificate Policy</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><h4>FCPS Attempt Marks</h4><table class="data-table" style="width:100%"><thead><tr><th>Attempt</th><th>Marks</th></tr></thead><tbody>${fcpsAttempts || '<tr><td colspan="2" style="color:var(--text-muted)">No data</td></tr>'}</tbody></table></div>
        <div><h4>MS/MD Percentage Tiers</h4><table class="data-table" style="width:100%"><thead><tr><th>Min %</th><th>Marks</th></tr></thead><tbody>${msmdTiers || '<tr><td colspan="2" style="color:var(--text-muted)">No data</td></tr>'}</tbody></table></div>
      </div>
    </div>
  `;
}

// Called from app-notif-init.js
function setupAdminConfig() {
  if (document.getElementById('tab-admin')) {
    setupAdminConfigTab();
  }
}
