'use strict';

let _configTabRendered = false;

function renderConfigTab() {
  if (_configTabRendered) return;
  _configTabRendered = true;

  const container = document.getElementById('configContent');
  if (!container) return;

  container.innerHTML = '';

  renderFormulaSection(container);
  renderTrackedFieldsSection(container);
  renderRevisionSection(container);
  renderCertificatePolicySection(container);
  renderSimulationConfigSection(container);
}

function _escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function renderFormulaSection(container) {
  const options = SIM.marks.options || [];
  const activeId = SIM.marks.activeOptionId || options[0]?.id;

  const section = document.createElement('div');
  section.className = 'card config-section';
  section.innerHTML = `
    <h3 style="margin-top:0">Mark Formula</h3>
    <p style="margin:0 0 12px;color:var(--text-muted);font-size:0.85rem">
      Merit formula options configured in <code>notifications/marks_config</code>.
      Active formula is highlighted.
    </p>
    <table class="data-table" style="width:100%">
      <thead><tr>
        <th>ID</th>
        <th>Label</th>
        <th>Base</th>
        <th>Sum Fields</th>
        <th>Adjustments</th>
      </tr></thead>
      <tbody>
        ${options.map(opt => {
          const isActive = opt.id === activeId;
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
        }).join('')}
      </tbody>
    </table>
  `;
  container.appendChild(section);
}

function renderTrackedFieldsSection(container) {
  const fields = SIM.trackedFields?.length ? SIM.trackedFields : ['houseJob', 'position', 'mdcat', 'degree'];

  const section = document.createElement('div');
  section.className = 'card config-section';
  section.style.marginTop = '16px';
  section.innerHTML = `
    <h3 style="margin-top:0">Tracked Fields</h3>
    <p style="margin:0 0 12px;color:var(--text-muted);font-size:0.85rem">
      Fields tracked for candidate revision delta display, from <code>notifications/revisions_config</code>.
    </p>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${fields.map(f => `<span class="config-chip">${_escHtml(f)}</span>`).join('')}
    </div>
  `;
  container.appendChild(section);
}

function renderRevisionSection(container) {
  const disabled = SIM.globallyDisabledRevisionIds || [];
  const totalAvail = collectCandidateRevisionIds().length;
  const candidatesWithRevisions = (SIM.candidates || []).filter(c => candidateHasRevisions(c)).length;

  const section = document.createElement('div');
  section.className = 'card config-section';
  section.style.marginTop = '16px';
  section.innerHTML = `
    <h3 style="margin-top:0">Revision Management</h3>
    <p style="margin:0 0 12px;color:var(--text-muted);font-size:0.85rem">
      Globally disabled revision IDs from <code>notifications/revisions_config</code>.
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="config-stat">
        <span class="config-stat-val">${totalAvail}</span>
        <span class="config-stat-label">Available revision IDs</span>
      </div>
      <div class="config-stat">
        <span class="config-stat-val">${candidatesWithRevisions}</span>
        <span class="config-stat-label">Candidates with revisions</span>
      </div>
      <div class="config-stat">
        <span class="config-stat-val">${disabled.length}</span>
        <span class="config-stat-label">Globally disabled</span>
      </div>
    </div>
    ${disabled.length ? `
      <p style="margin:0 0 6px;font-weight:600;font-size:0.85rem">Disabled revision IDs:</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${disabled.map(id => `<span class="config-chip config-chip-disabled">${_escHtml(id)}</span>`).join('')}
      </div>
    ` : '<p style="color:var(--text-muted);font-size:0.85rem">No globally disabled revision IDs.</p>'}
  `;
  container.appendChild(section);
}

function renderCertificatePolicySection(container) {
  const policy = SIM.certificatePolicy || {};

  const section = document.createElement('div');
  section.className = 'card config-section';
  section.style.marginTop = '16px';
  section.innerHTML = `
    <h3 style="margin-top:0">Certificate Policy</h3>
    <p style="margin:0 0 12px;color:var(--text-muted);font-size:0.85rem">
      Loaded from <code>data/induction21_certificate_policy.json</code>.
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="config-policy-block">
        <h4>FCPS Attempt Marks</h4>
        <table class="data-table" style="width:100%">
          <thead><tr><th>Attempt</th><th>Marks</th></tr></thead>
          <tbody>
            ${Object.entries(policy.fcps?.attemptMarks || {}).map(([attempt, marks]) =>
              `<tr><td>${_escHtml(attempt)}</td><td>${_escHtml(String(marks))}</td></tr>`
            ).join('')}
          </tbody>
        </table>
        <p style="font-size:0.8rem;color:var(--text-muted);margin:6px 0 0">
          Require pass: ${policy.fcps?.requirePass !== false ? 'Yes' : 'No'}
        </p>
      </div>
      <div class="config-policy-block">
        <h4>MS/MD Percentage Tiers</h4>
        <table class="data-table" style="width:100%">
          <thead><tr><th>Min %</th><th>Marks</th></tr></thead>
          <tbody>
            ${(policy.msmd?.percentageMarks || []).map(tier => {
              const label = tier.gt != null ? `>${tier.gt}` : String(tier.min);
              return `<tr><td>${_escHtml(label)}%</td><td>${_escHtml(String(tier.marks))}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        <p style="font-size:0.8rem;color:var(--text-muted);margin:6px 0 0">
          March 2026 pass: ${policy.msmd?.specialRules?.March2026Pass != null ? `${policy.msmd.specialRules.March2026Pass} marks` : 'Not set'}
        </p>
      </div>
    </div>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-light,rgba(255,255,255,0.06))">
      <h4 style="margin:0 0 6px">Fallback</h4>
      <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:0.85rem">
        <span>Use program marks when no certificate match: <strong>${policy.fallback?.useProgramMarksWhenNoCertificateMatch !== false ? 'Yes' : 'No'}</strong></span>
        <span>Use program marks when certificate incomplete: <strong>${policy.fallback?.useProgramMarksWhenCertificateIncomplete !== false ? 'Yes' : 'No'}</strong></span>
      </div>
    </div>
  `;
  container.appendChild(section);
}

function renderSimulationConfigSection(container) {
  const section = document.createElement('div');
  section.className = 'card config-section';
  section.style.marginTop = '16px';
  section.innerHTML = `
    <h3 style="margin-top:0">Seat Allocation Config</h3>
    <p style="margin:0 0 12px;color:var(--text-muted);font-size:0.85rem">
      Candidate status scopes from <code>notifications/simulation_config</code>.
    </p>
    <div id="configStatusScopes">
      <p class="text-muted" style="font-size:0.85rem">Checking live config…</p>
    </div>
  `;
  container.appendChild(section);

  _loadSimulationConfigLive();
}

async function _loadSimulationConfigLive() {
  const el = document.getElementById('configStatusScopes');
  if (!el) return;
  try {
    const db = firebase.firestore();
    const snap = await db.collection('notifications').doc('simulation_config').get();
    if (!snap.exists) {
      el.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted)">No simulation config saved — using defaults.</p>';
      return;
    }
    const data = snap.data();
    const scopes = Array.isArray(data.statusScopes) ? data.statusScopes : [];
    const defaultId = data.defaultStatusScopeId || 'all';

    el.innerHTML = `
      <p style="margin:0 0 8px;font-size:0.85rem">
        Default scope: <strong>${_escHtml(defaultId)}</strong>
        &middot; Show selector: <strong>${data.showStatusScopeSelector !== false ? 'Yes' : 'No'}</strong>
      </p>
      <table class="data-table" style="width:100%">
        <thead><tr>
          <th>ID</th>
          <th>Label</th>
          <th>Description</th>
          <th>Include All</th>
          <th>Status IDs</th>
        </tr></thead>
        <tbody>
          ${scopes.map(s => {
            const isDefault = s.id === defaultId;
            return `<tr${isDefault ? ' style="background:var(--accent-glow, rgba(77,184,217,0.08))"' : ''}>
              <td>${_escHtml(s.id)}${isDefault ? ' <span style="color:var(--neon-cyan)">&#9668; default</span>' : ''}</td>
              <td>${_escHtml(s.label || '')}</td>
              <td style="font-size:0.85rem">${_escHtml(s.description || '')}</td>
              <td>${s.includeAll ? 'Yes' : 'No'}</td>
              <td style="font-size:0.85rem">${(s.statusIds || []).map(id => _escHtml(id)).join(', ') || '<em>none</em>'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    el.innerHTML = `<p style="font-size:0.85rem;color:var(--neon-pink)">Error loading: ${_escHtml(e.message)}</p>`;
  }
}
