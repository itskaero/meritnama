'use strict';

if (typeof firebase !== 'undefined') {
  window.db = window.db || firebase.firestore();
}

/**
 * MeritNama SPA — Admin & Data views.
 * Handles the Admin Console, Gazette Changes Log, and Share Card generator.
 */

// ═══════════════════════════════════════════════════════
// DYNAMIC SCRIPT LOADER
// ═══════════════════════════════════════════════════════

let _adminScriptsPromise = null;
function loadAdminScripts() {
  if (_adminScriptsPromise) return _adminScriptsPromise;
  _adminScriptsPromise = (async () => {
    const scripts = ['notifications.js', 'js/admin-core.js', 'js/admin-induction.js', 'js/admin-toggles.js', 'js/app-jobs.js'];
    for (const url of scripts) {
      if (document.querySelector(`script[src="${url}"]`)) continue;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => {
          if (url === 'js/admin-core.js') {
            document.dispatchEvent(new Event('DOMContentLoaded'));
          }
          resolve();
        };
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }
  })();
  return _adminScriptsPromise;
}

// ═══════════════════════════════════════════════════════
// VIEW: ADMIN PANEL
// ═══════════════════════════════════════════════════════

async function renderAdmin(container) {
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; gap: var(--spacing-md);">
      <div class="skeleton-shimmer" style="width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div>
      <p style="color:var(--text-secondary); font-size:14px;">Loading Admin Portal…</p>
    </div>
  `;

  try {
    await loadAdminScripts();

    // Check if session is active
    if (typeof window.getAdminSession === 'function' && window.getAdminSession()) {
      renderAdminDashboard(container);
    } else {
      renderAdminLogin(container);
    }
  } catch (err) {
    console.error('[Admin View] Initialization failure:', err);
    container.innerHTML = `<div class="card" style="border-color:var(--color-reach); padding:24px; text-align:center;"><p style="color:var(--color-reach);">Failed to load Admin scripts.</p></div>`;
  }
}

function renderAdminLogin(container) {
  container.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; min-height:60vh; padding: var(--spacing-md);">
      <div class="card" style="max-width:400px; width:100%; text-align:center;">
        <h3 style="margin-top:0;">Administrator Sign In</h3>
        <p style="color:var(--text-secondary); font-size:13px; margin-bottom: var(--spacing-lg);">Enter credential PIN to configure platform settings.</p>
        <div style="display:flex; flex-direction:column; gap:12px; text-align:left;">
          <div class="form-group">
            <label for="adminEmail">Email Address</label>
            <input type="email" id="adminEmail" class="input" placeholder="admin@example.com" autocomplete="email" />
          </div>
          <div class="form-group">
            <label for="adminPass">Credential PIN</label>
            <input type="password" id="adminPass" class="input" placeholder="••••••" autocomplete="current-password" />
          </div>
          <button class="btn btn-primary" id="adminSubmit" style="width:100%; margin-top:8px;">Sign In</button>
          <p id="adminError" style="font-size:12.5px; text-align:center; color:var(--color-reach); min-height:1.2em; margin:0;"></p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('adminPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('adminSubmit').click();
  });

  document.getElementById('adminSubmit').addEventListener('click', async function() {
    const email = document.getElementById('adminEmail').value;
    const pin = document.getElementById('adminPass').value;
    const errorEl = document.getElementById('adminError');

    if (!email || !pin) {
      errorEl.textContent = 'Enter email and PIN.';
      return;
    }

    this.disabled = true;
    errorEl.textContent = 'Verifying…';

    const valid = await window.verifyAdmin(email, pin);
    if (valid) {
      window.setAdminSession(email);
      renderAdminDashboard(container);
    } else {
      errorEl.textContent = 'Invalid credentials.';
      this.disabled = false;
    }
  });
}

function renderAdminDashboard(container) {
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: var(--spacing-lg);">
      <div class="section-header" style="margin:0;">
        <h2>PGMI Admin Console</h2>
        <p>Modify induction state parameters, verify hospital support tokens, and control scrapper tasks.</p>
      </div>
      <button class="btn btn-secondary" id="logoutBtn" style="padding:6px 12px; font-size:12.5px;">Sign Out</button>
    </div>

    <div style="display:grid; grid-template-columns: 200px 1fr; gap: var(--spacing-lg); min-height:550px;">
      <!-- Admin Nav Sub Sidebar -->
      <aside style="border-right: 1px solid var(--border-default); padding-right: var(--spacing-md);">
        <nav style="display:flex; flex-direction:column; gap:4px;" id="adminSubNav">
          <button class="btn btn-ghost active" style="justify-content:flex-start;" data-tab="overview"><i class="ph ph-chart-bar"></i> Overview</button>
          <button class="btn btn-ghost" style="justify-content:flex-start;" data-tab="config"><i class="ph ph-gear"></i> Config Settings</button>
          <button class="btn btn-ghost" style="justify-content:flex-start;" data-tab="access-requests"><i class="ph ph-envelope-open"></i> Access Requests</button>
          <button class="btn btn-ghost" style="justify-content:flex-start;" data-tab="logs"><i class="ph ph-list-bullets"></i> System Logs</button>
          <button class="btn btn-ghost" style="justify-content:flex-start;" data-tab="jobs-sync"><i class="ph ph-briefcase"></i> Jobs Sync</button>
        </nav>
      </aside>

      <!-- Admin Tab Pages Content -->
      <div id="adminTabContent">
        <div id="tab-overview" class="admin-tab-pane">
          <div class="metrics-grid grid grid-3" style="gap:12px; margin-bottom:16px;" id="overviewMetrics">
            <div class="card"><div class="metric-val" id="ovOnline" style="font-size:24px; font-weight:700;">—</div><div class="metric-lbl">Online now</div></div>
            <div class="card"><div class="metric-val" id="ovUsers" style="font-size:24px; font-weight:700;">—</div><div class="metric-lbl">Authorized Users</div></div>
            <div class="card"><div class="metric-val" id="ovProfiles" style="font-size:24px; font-weight:700;">—</div><div class="metric-lbl">User Profiles</div></div>
          </div>
          <div class="card">
            <h4>Live Presence list</h4>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Status</th><th>Email</th><th>Page</th><th>Last seen</th></tr></thead>
                <tbody id="presenceBody">
                  <tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">Syncing online statuses…</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="tab-config" class="admin-tab-pane" style="display:none;">
          <div class="card" id="configControls">
            <h3>Configuration Controls</h3>
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom:12px;">Toggle verification stages and sync metadata directly to Firestore.</p>
            <div id="adminTogglesList" style="display:flex; flex-direction:column; gap:12px;"></div>
          </div>
        </div>

        <div id="tab-access-requests" class="admin-tab-pane" style="display:none;">
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <h3>Pending Credentials Requests</h3>
              <button class="btn btn-secondary" id="refreshRequestsBtn" style="padding:4px 8px; font-size:11px;">Refresh</button>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Email</th><th>Applicant ID</th><th>Proof declared</th><th>Amount declared</th><th>Status</th><th>Action</th></tr></thead>
                <tbody id="requestsBody">
                  <tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">No requests pending approval.</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="tab-logs" class="admin-tab-pane" style="display:none;">
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <h3>Log Feed</h3>
              <button class="btn btn-secondary" id="refreshBtn" style="padding:4px 8px; font-size:11px;">Refresh</button>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Time</th><th>User Email</th><th>Event</th><th>Action</th></tr></thead>
                <tbody id="logsBody">
                  <tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">Loading system logs…</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="tab-jobs-sync" class="admin-tab-pane" style="display:none;">
          <div class="card">
            <h3>Medical Jobs Scraper</h3>
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom:12px;">Rerun automated scrapper pipeline task to sync medical job vacancies from newspaper feeds.</p>
            <button class="btn btn-primary" id="runJobsScraperBtn">Run Scraper Task</button>
            <div id="jobsScraperStatus" style="font-size:12px; margin-top:8px; min-height:1.2em;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind logout
  document.getElementById('logoutBtn').addEventListener('click', () => {
    if (typeof window.clearAdminSession === 'function') window.clearAdminSession();
    renderAdminLogin(container);
  });

  // Bind sidebar nav tabs selection
  const navButtons = document.querySelectorAll('#adminSubNav button');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tabId = btn.dataset.tab;
      document.querySelectorAll('.admin-tab-pane').forEach(pane => pane.style.display = 'none');
      document.getElementById(`tab-${tabId}`).style.display = 'block';

      // Load data triggers per tab
      if (tabId === 'access-requests' && typeof window.loadAccessRequests === 'function') {
        window.loadAccessRequests();
      }
      if (tabId === 'logs' && typeof window.loadLogs === 'function') {
        window.loadLogs();
      }
    });
  });

  // Initialize scripts bindings
  if (typeof window.showDashboard === 'function') {
    window.showDashboard();
  }
}

// ═══════════════════════════════════════════════════════
// VIEW: GAZETTE CHANGES LOG
// ═══════════════════════════════════════════════════════

async function renderChangesLog(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header" style="margin-bottom: var(--spacing-lg);">
      <h2>Gazette Data Changes</h2>
      <p>Verify candidate data synchronization snapshots, delta margins, and updates audit records.</p>
    </div>

    <div id="changesMetrics" style="margin-bottom: var(--spacing-lg);">
      <div style="display:flex; justify-content:center; padding:40px;"><div class="skeleton-shimmer" style="width: 40px; height: 40px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div></div>
    </div>

    <div class="card" style="padding:0; overflow:hidden;">
      <div style="padding:16px 20px; border-bottom:1px solid var(--border-default); background:var(--surface-secondary);">
        <h3 style="margin:0; font-size:14px; font-weight:700;">Record Changes Delta</h3>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Field</th>
              <th class="num">Old Value</th>
              <th class="num">New Value</th>
              <th class="num">Delta</th>
            </tr>
          </thead>
          <tbody id="changesTableBody">
            <tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-muted);">Loading delta changes log…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  try {
    const res = await fetch('data/candidates_changes.json', { cache: 'no-store' });
    const log = await res.json();

    const stats = log.summary || {};
    const changes = log.changes || [];

    // Draw stats grid
    const metricsDiv = document.getElementById('changesMetrics');
    if (metricsDiv) {
      metricsDiv.innerHTML = `
        <div class="grid grid-3" style="gap:12px;">
          <div class="card">
            <span style="font-size:24px; font-weight:700; color:var(--brand-primary);">${stats.oldCount || '—'}</span>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">Previous Pool Count</div>
          </div>
          <div class="card">
            <span style="font-size:24px; font-weight:700; color:var(--brand-primary);">${stats.newCount || '—'}</span>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">Current Pool Count</div>
          </div>
          <div class="card">
            <span style="font-size:24px; font-weight:700; color:var(--color-safe);">${stats.changed || '—'}</span>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">Candidates Updated</div>
          </div>
        </div>
      `;
    }

    const tableBody = document.getElementById('changesTableBody');
    if (tableBody) {
      if (!changes.length) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-muted);">No snapshot changes logged.</td></tr>`;
        return;
      }

      tableBody.innerHTML = changes.slice(0, 100).map(c => {
        const delta = typeof c.delta === 'number' ? (c.delta >= 0 ? '+' : '') + c.delta.toFixed(4) : '—';
        const color = typeof c.delta === 'number' ? (c.delta >= 0 ? 'var(--color-safe)' : 'var(--color-reach)') : 'var(--text-primary)';

        return `
          <tr>
            <td><code style="font-family:var(--font-mono);">${c.applicantId}</code></td>
            <td><strong>${c.name || 'Anonymous'}</strong></td>
            <td><span class="badge badge-secondary" style="font-size:11px;">${c.field || 'marks'}</span></td>
            <td class="num font-mono">${c.oldVal !== null ? Number(c.oldVal).toFixed(4) : '—'}</td>
            <td class="num font-mono">${c.newVal !== null ? Number(c.newVal).toFixed(4) : '—'}</td>
            <td class="num font-mono" style="font-weight:700; color:${color};">${delta}</td>
          </tr>
        `;
      }).join('');
    }

  } catch (err) {
    console.error('[Changes Log] Fetch error:', err);
    const tableBody = document.getElementById('changesTableBody');
    if (tableBody) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--color-reach);">Failed to load changes log feed.</td></tr>`;
    }
  }
}

// ═══════════════════════════════════════════════════════
// VIEW: DIAGNOSTIC SHARE CARD GENERATOR
// ═══════════════════════════════════════════════════════

let _shareTplId = 'gradient';
const SHARE_TEMPLATES = [
  { id: 'gradient', label: 'Sunset Orange', bg: ['#1c0c05', '#2b1003'], accent: '#ea580c', textColor: '#fbf5f2', barColor: 'rgba(234,88,12,0.15)', glowColor: 'rgba(234,88,12,0.25)' },
  { id: 'dark',     label: 'Obsidian Zinc', bg: ['#09090b', '#18181b'], accent: '#ea580c', textColor: '#fafafa',  barColor: 'rgba(234,88,12,0.12)', glowColor: 'rgba(234,88,12,0.2)'  },
  { id: 'minimal',  label: 'Polar Light',   bg: ['#ffffff', '#f4f4f5'], accent: '#09090b', textColor: '#09090b',  barColor: 'rgba(9,9,11,0.06)',    glowColor: 'rgba(9,9,11,0.1)'     }
];

async function renderAnimationSandbox(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header" style="margin-bottom: var(--spacing-lg);">
      <h2>Diagnostic Share Card</h2>
      <p>Enter your induction scores to render a high-end shareable card onto a Canvas element and download it.</p>
    </div>

    <div class="grid grid-2" style="gap: var(--spacing-lg); align-items: flex-start;">
      <!-- Controls -->
      <div class="card">
        <h3>Card customizer</h3>
        <div style="display:flex; flex-direction:column; gap:12px; margin-top:12px;">
          <div class="form-group">
            <label>Name / Alias</label>
            <input type="text" id="shName" class="input" placeholder="Dr. Jane Doe" />
          </div>
          <div class="form-group">
            <label>Applicant ID</label>
            <input type="number" id="shId" class="input" placeholder="E.g. 35183" />
          </div>
          <div class="form-group">
            <label>Total aggregate marks</label>
            <input type="number" id="shMarks" class="input" step="0.0001" placeholder="E.g. 78.4523" />
          </div>
          <div class="form-group">
            <label>Percentile Rank</label>
            <input type="text" id="shPercentile" class="input" placeholder="E.g. Top 2.4%" />
          </div>
          <div class="form-group">
            <label>Parent Hospital</label>
            <input type="text" id="shParent" class="input" placeholder="E.g. KEMU / Mayo" />
          </div>

          <div class="form-group">
            <label>Theme Style</label>
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top:4px;">
              ${SHARE_TEMPLATES.map(t => `
                <button class="btn btn-secondary sh-tpl-btn" data-id="${t.id}" style="padding:6px; font-size:11.5px; border-radius:8px;">${t.label}</button>
              `).join('')}
            </div>
          </div>

          <button class="btn btn-primary" id="shDownloadBtn" style="margin-top:8px;">Download PNG Card</button>
        </div>
      </div>

      <!-- Canvas Preview Wrap -->
      <div style="display:flex; justify-content:center;">
        <div class="card" style="padding:12px; max-width:320px; width:100%; border-color:var(--border-subtle);">
          <canvas id="shCardCanvas" width="480" height="640" style="width:100%; height:auto; display:block; border-radius:8px;"></canvas>
        </div>
      </div>
    </div>
  `;

  // Pre-fill inputs with logged-in user profile details if available
  try {
    const profile = getSessionProfile();
    if (profile) {
      document.getElementById('shName').value = profile.name || '';
      document.getElementById('shId').value = profile.applicantId || '';
    }
  } catch(_) {}

  // Initial draw
  drawShareCard();

  // Attach event binds
  ['shName', 'shId', 'shMarks', 'shPercentile', 'shParent'].forEach(id => {
    document.getElementById(id).addEventListener('input', drawShareCard);
  });

  const tplBtns = document.querySelectorAll('.sh-tpl-btn');
  tplBtns.forEach(btn => {
    if (btn.dataset.id === _shareTplId) btn.classList.add('active');
    btn.addEventListener('click', () => {
      tplBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _shareTplId = btn.dataset.id;
      drawShareCard();
    });
  });

  document.getElementById('shDownloadBtn').addEventListener('click', () => {
    const canvas = document.getElementById('shCardCanvas');
    const link = document.createElement('a');
    link.download = `MeritNama-share-${_shareTplId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

function drawShareCard() {
  const canvas = document.getElementById('shCardCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const tpl = SHARE_TEMPLATES.find(t => t.id === _shareTplId) || SHARE_TEMPLATES[0];

  // Inputs
  const name   = document.getElementById('shName').value.trim()       || 'Dr. Candidate';
  const id     = document.getElementById('shId').value.trim()         || '—';
  const marks  = document.getElementById('shMarks').value.trim()      || '—';
  const pct    = document.getElementById('shPercentile').value.trim() || '—';
  const parent = document.getElementById('shParent').value.trim()     || '—';

  // Background
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, tpl.bg[0]);
  grad.addColorStop(1, tpl.bg[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Top header border
  ctx.fillStyle = tpl.accent;
  ctx.fillRect(0, 0, W, 6);

  // Logo title
  ctx.fillStyle = tpl.accent;
  ctx.font = 'bold 28px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('MeritNama Diagnostics', W / 2, 44);

  ctx.fillStyle = tpl.textColor;
  ctx.font = '13px "IBM Plex Sans", sans-serif';
  ctx.fillText('Induction 2021 Allocation Profile', W / 2, 84);

  // Horizontal divider
  ctx.fillStyle = tpl.barColor;
  ctx.fillRect(W * 0.1, 114, W * 0.8, 1);

  // Render variables
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const rows = [
    { label: 'Candidate Name',   value: name   },
    { label: 'Applicant ID',     value: id     },
    { label: 'Total merit score',value: marks  },
    { label: 'Percentile Rank',  value: pct    },
    { label: 'Parent Hospital',  value: parent }
  ];

  let startY = 160;
  rows.forEach(row => {
    ctx.fillStyle = tpl.accent;
    ctx.font = 'bold 12px "IBM Plex Mono", monospace';
    ctx.fillText(row.label.toUpperCase(), W * 0.15, startY);

    ctx.fillStyle = tpl.textColor;
    ctx.font = '600 18px "IBM Plex Sans", sans-serif';
    ctx.fillText(row.value, W * 0.15, startY + 18);

    startY += 64;
  });

  // Footer URL
  ctx.fillStyle = tpl.textColor;
  ctx.font = '12.5px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('meritnama.pk  ·  Open-Source analytics platform', W / 2, H - 44);
}

// Expose renderers globally
window.renderAdmin = renderAdmin;
window.renderChangesLog = renderChangesLog;
window.renderAnimationSandbox = renderAnimationSandbox;
