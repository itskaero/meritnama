'use strict';

let _configTabRendered = false;

// Read admin config from localStorage (set by admin portal)
function _readAdminCfg() {
  try {
    const raw = localStorage.getItem('mn_admin_sim_config');
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function _shouldShowDropdown(key) {
  const cfg = _readAdminCfg();
  return cfg ? cfg.dropdownVisibility?.[key] !== false : true;
}

function _adminDefaultValue(key) {
  const cfg = _readAdminCfg();
  return cfg?.defaultValues?.[key] || '';
}

function renderConfigTab() {
  const container = document.getElementById('configContent');
  if (!container) return;

  if (!_configTabRendered) {
    _configTabRendered = true;
    container.innerHTML = '';
    renderActiveOverview(container);
    renderUserControls(container);
  }

  // Always refresh controls state (visibility, defaults, options)
  renderConfigControlsHelp();
}

function renderConfigControlsHelp() {
  syncMarksSelectorUI();
  refreshCandidateRevisionOptions();
  syncSimulationStatusScopeUI();
  _applyAdminVisibilityAndDefaults();
}

function _applyAdminVisibilityAndDefaults() {
  const controls = [
    { key: 'marksBasis', selectId: 'cfgMarksBasis', badgeId: null },
    { key: 'revision', selectId: 'cfgCandidateRevision', badgeId: null },
    { key: 'statusScope', selectId: 'cfgSimStatusScope', badgeId: null },
  ];

  for (const ctrl of controls) {
    const sel = document.getElementById(ctrl.selectId);
    if (!sel) continue;

    const visible = _shouldShowDropdown(ctrl.key);
    const parent = sel.closest('.config-editor-field') || sel.parentElement;
    if (parent) parent.style.display = visible ? '' : 'none';

    if (!visible) {
      const defVal = _adminDefaultValue(ctrl.key);
      if (defVal) {
        const opt = Array.from(sel.options).find(o => o.value === defVal);
        if (opt) {
          sel.value = defVal;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  }
}

// ── Active Config Overview (visually appealing cards) ──

function _escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function renderActiveOverview(container) {
  const marksOpts = SIM.marks?.options || [];
  const activeMarksId = SIM.marks?.activeOptionId || marksOpts[0]?.id;
  const activeMarks = marksOpts.find(o => o.id === activeMarksId);

  const revIds = collectCandidateRevisionIds();
  const activeRevId = SIM.candidateRevision?.activeId;
  const activeRevLabel = activeRevId && typeof candidateRevisionLabel === 'function'
    ? candidateRevisionLabel(activeRevId) : activeRevId || 'None';

  const scope = getActiveSimStatusScope();
  const scopeLabel = scope?.label || 'All';
  const scopeDesc = scope?.description || '';
  const scopeCount = typeof countScopeMatches === 'function' ? countScopeMatches(scope) : 0;

  const candCount = SIM.candidates?.length || 0;
  const seatsLoaded = SIM.seatsLoaded;
  const statusLoaded = SIM.profileStatus?.loaded;

  container.innerHTML = `
    <div class="config-overview-grid" style="margin-bottom:18px">
      <div class="config-overview-card">
        <span class="cov-label">Merit Formula</span>
        <span class="cov-value active">${_escHtml(activeMarks?.label || activeMarksId || '—')}</span>
        <span class="cov-meta">Base: ${_escHtml(activeMarks?.base || 'marksTotal')}</span>
      </div>
      <div class="config-overview-card">
        <span class="cov-label">Candidate Revision</span>
        <span class="cov-value">${_escHtml(activeRevLabel)}</span>
        <span class="cov-meta">${revIds.length} revision(s) available</span>
      </div>
      <div class="config-overview-card">
        <span class="cov-label">Status Scope</span>
        <span class="cov-value">${_escHtml(scopeLabel)}</span>
        <span class="cov-meta">${scopeCount.toLocaleString()} candidate(s) match · ${_escHtml(scopeDesc)}</span>
      </div>
      <div class="config-overview-card">
        <span class="cov-label">Candidates</span>
        <span class="cov-value">${candCount.toLocaleString()}</span>
        <span class="cov-meta">${seatsLoaded ? 'Seats loaded' : 'No seat data'}</span>
      </div>
      <div class="config-overview-card ${statusLoaded ? 'cov-source' : 'cov-source-missing'}">
        <span class="cov-label">Profile Status</span>
        <span class="cov-value">${statusLoaded ? 'Loaded' : 'Not loaded'}</span>
        <span class="cov-meta">${statusLoaded ? (Object.keys(SIM.profileStatus.byId || {}).length.toLocaleString() + ' records') : 'Snapshot or live'}</span>
      </div>
    </div>
    <p style="margin:-10px 0 14px;font-size:0.78rem;color:var(--text-muted)">
      &#9432; Active config overview. Use the dropdowns below to switch between available options.
      Administrators can hide these dropdowns and set defaults via the Admin portal.
    </p>
  `;
}

// ── Per-User Config Controls ──

function renderUserControls(container) {
  const controlsWrap = document.getElementById('configControls');
  if (!controlsWrap) return;

  // Ensure the editor grid exists inside configControls
  let grid = controlsWrap.querySelector('.config-editor-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.className = 'config-editor-grid';
    controlsWrap.insertBefore(grid, controlsWrap.querySelector('.marks-basis-note') || null);
  }

  // Fields are already in the HTML: cfgMarksBasis, cfgCandidateRevision, cfgSimStatusScope
  // Just ensure they're in the right position
  const existingFields = controlsWrap.querySelectorAll('.config-editor-field');
  if (!existingFields.length) {
    // Fallback: create them
    grid.innerHTML = `
      <div class="config-editor-field">
        <label for="cfgMarksBasis">Merit formula</label>
        <select id="cfgMarksBasis" class="mt-filter-sel"></select>
      </div>
      <div class="config-editor-field candidate-revision-wrap hidden">
        <label for="cfgCandidateRevision">Candidate revision</label>
        <select id="cfgCandidateRevision" class="mt-filter-sel"></select>
      </div>
      <div class="config-editor-field">
        <label for="cfgSimStatusScope">Status scope</label>
        <select id="cfgSimStatusScope" class="mt-filter-sel"></select>
      </div>
    `;
  }
}
