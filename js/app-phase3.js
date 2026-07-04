'use strict';

if (typeof firebase !== 'undefined') {
  window.db = window.db || firebase.firestore();
}

/**
 * MeritNama SPA - Phase 3 View Renderers
 * Discussion Forums, Admin Console, Donations, Access Requests, Changes Log, and Share Card generator.
 */

// ═══════════════════════════════════════════════════════
// DYNAMIC SCRIPT LOADERS FOR PHASE 3
// ═══════════════════════════════════════════════════════

let _discussionScriptsPromise = null;
function loadDiscussionScripts() {
  if (_discussionScriptsPromise) return _discussionScriptsPromise;
  _discussionScriptsPromise = (async () => {
    if (!document.querySelector('script[src="reviews.js"]')) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'reviews.js';
        script.onload = () => {
          // Trigger fake DOMContentLoaded for reviews.js IIFE registration
          document.dispatchEvent(new Event('DOMContentLoaded'));
          resolve();
        };
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }
  })();
  return _discussionScriptsPromise;
}

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

let _requestAccessPromise = null;
function loadRequestAccessScripts() {
  if (_requestAccessPromise) return _requestAccessPromise;
  _requestAccessPromise = (async () => {
    if (!document.querySelector('script[src="access-request.js"]')) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'access-request.js';
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }
  })();
  return _requestAccessPromise;
}

async function loadQrCodeScript() {
  if (window.QRCode) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

// ═══════════════════════════════════════════════════════
// ROUTE 1: DISCUSSION & SUB-FORUMS
// ═══════════════════════════════════════════════════════

async function renderDiscussion(container) {
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; gap: var(--spacing-md);">
      <div class="skeleton-shimmer" style="width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div>
      <p style="color:var(--text-secondary); font-size:14px;">Loading Community Forums…</p>
    </div>
  `;

  try {
    await loadDiscussionScripts();

    container.innerHTML = `
      <div class="section-header" style="margin-bottom: var(--spacing-lg);">
        <h2>Community Discussions</h2>
        <p>Connect with peers, check training ratings, and participate in competitive specialty threads.</p>
      </div>

      <div class="rv-panel card" id="forumPanel" style="padding:0; overflow:hidden;">
        <!-- Dynamic Panel Header -->
        <div class="rv-panel-header" id="forumPanelHeader" style="display:flex; align-items:center; gap:10px; padding:16px 24px; border-bottom:1px solid var(--border-default); background:var(--surface-secondary);">
          <span style="font-size:16px;"><i class="ph ph-chat-circle"></i></span>
          <h3 id="forumPanelTitle" style="margin:0; font-size:15px; font-weight:700;">Community Forum</h3>
          <span class="badge badge-info" id="threadCount" style="margin-left:auto;">0 threads</span>
          <button class="btn btn-primary" id="forumNewBtn" style="padding:4px 10px; font-size:12px;">+ New Thread</button>
        </div>

        <div class="rv-panel-body" id="forumBody" style="padding:24px;">
          <!-- VIEW A: Threads List -->
          <div id="forumViewList">
            <!-- Category Filter Chips -->
            <div class="forum-category-chips" id="forumCategoryFilter" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px;">
              <button class="badge active" data-cat="" style="cursor:pointer; border:none; padding:4px 12px; background:var(--brand-primary); color:#fff;">All</button>
              <button class="badge badge-secondary" data-cat="General" style="cursor:pointer; border:none; padding:4px 12px;">General</button>
              <button class="badge badge-secondary" data-cat="Question" style="cursor:pointer; border:none; padding:4px 12px;">Q&amp;A</button>
              <button class="badge badge-secondary" data-cat="Study" style="cursor:pointer; border:none; padding:4px 12px;">Study</button>
              <button class="badge badge-secondary" data-cat="Hospital" style="cursor:pointer; border:none; padding:4px 12px;">Hospital</button>
              <button class="badge badge-secondary" data-cat="Merit" style="cursor:pointer; border:none; padding:4px 12px;">Merit</button>
              <button class="badge badge-secondary" data-cat="Experience" style="cursor:pointer; border:none; padding:4px 12px;">Story</button>
              <button class="badge badge-secondary" data-cat="Concern" style="cursor:pointer; border:none; padding:4px 12px;">Concern</button>
            </div>

            <!-- List container -->
            <div id="threadList" class="thread-list" style="display:flex; flex-direction:column; gap:12px;">
              <div style="text-align:center; padding:40px; color:var(--text-muted);">Loading threads list…</div>
            </div>

            <button class="btn btn-secondary" id="threadLoadMore" style="width:100%; margin-top:16px; display:none;">Load more threads</button>
          </div>

          <!-- VIEW B: New Thread Form -->
          <div id="forumViewNew" style="display:none;">
            <button class="btn btn-secondary" id="forumBackFromNew" style="margin-bottom:16px; padding:6px 12px; font-size:12px;"><i class="ph ph-arrow-left"></i> Back to threads</button>
            <div class="input-grid" style="display:grid; grid-template-columns:1fr; gap:12px;">
              <div class="form-group">
                <label for="threadName">Your Name / Alias</label>
                <input type="text" id="threadName" class="input" placeholder="Dr. Anonymous" maxlength="60" />
              </div>
              <div class="form-group">
                <label for="threadCategory">Category</label>
                <select id="threadCategory" class="select">
                  <option value="General">General Discussion</option>
                  <option value="Question">Question &amp; Advice</option>
                  <option value="Study">Study Tips &amp; FCPS</option>
                  <option value="Hospital">Hospital Insights</option>
                  <option value="Merit">Merit &amp; Induction</option>
                  <option value="Experience">Experience Share</option>
                  <option value="Concern">Concern</option>
                </select>
              </div>
              <div class="form-group">
                <label for="threadYear">Training Year (optional)</label>
                <select id="threadYear" class="select">
                  <option value="">Any / Not Applicable</option>
                  <option value="Aspirant">Aspirant (pre-induction)</option>
                  <option value="R1">R1 — Year 1</option>
                  <option value="R2">R2 — Year 2</option>
                  <option value="R3">R3 — Year 3</option>
                  <option value="R4">R4 — Year 4</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
              <div class="form-group">
                <label for="threadSpecialty">Specialty (optional)</label>
                <input type="text" id="threadSpecialty" class="input" placeholder="E.g. Surgery" list="specialtyList" />
                <datalist id="specialtyList"></datalist>
                <datalist id="hospitalList"></datalist>
              </div>
              <div class="form-group">
                <label for="threadTitle">Thread Title</label>
                <input type="text" id="threadTitle" class="input" placeholder="A clear title for your post…" maxlength="120" />
                <div style="text-align:right; font-size:11px; color:var(--text-tertiary); margin-top:2px;"><span id="threadTitleCount">0</span>/120</div>
              </div>
              <div class="form-group">
                <label for="threadBody">Description</label>
                <textarea id="threadBody" class="input" rows="5" placeholder="Describe your topic in detail…" maxlength="3000"></textarea>
                <div style="text-align:right; font-size:11px; color:var(--text-tertiary); margin-top:2px;"><span id="threadBodyCount">0</span>/3000</div>
              </div>
            </div>
            <button class="btn btn-primary" id="threadSubmitBtn" style="margin-top:16px; width:100%;">Post Thread</button>
            <div id="threadStatus" style="font-size:12.5px; text-align:center; min-height:1.2em; margin-top:8px;"></div>
          </div>

          <!-- VIEW C: Thread Detail & Replies -->
          <div id="forumViewDetail" style="display:none;">
            <button class="btn btn-secondary" id="forumBackFromDetail" style="margin-bottom:16px; padding:6px 12px; font-size:12px;"><i class="ph ph-arrow-left"></i> Back to threads</button>
            <div id="threadDetailCard" class="card" style="margin-bottom:24px; border-color:var(--brand-primary); background:var(--brand-light);"></div>
            <div class="thread-comments-section">
              <div class="thread-comments-header" id="commentCountLabel" style="font-weight:700; font-size:14px; margin-bottom:12px;">0 replies</div>
              <div id="commentsList" style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px;"></div>
              <!-- Reply Form -->
              <div class="card" style="background:var(--surface-secondary);">
                <h4 style="margin:0 0 12px;">Reply to Thread</h4>
                <div style="display:flex; flex-direction:column; gap:12px;">
                  <div class="form-group">
                    <label for="commentName">Your Name / Alias</label>
                    <input type="text" id="commentName" class="input" placeholder="Dr. Anonymous" maxlength="60" />
                  </div>
                  <div class="form-group">
                    <label for="commentText">Your message</label>
                    <textarea id="commentText" class="input" rows="3" placeholder="Share your insights or answer the query…" maxlength="1500"></textarea>
                    <div style="text-align:right; font-size:11px; color:var(--text-tertiary); margin-top:2px;"><span id="commentCharCount">0</span>/1500</div>
                  </div>
                  <button class="btn btn-primary" id="commentSubmitBtn">Post Reply</button>
                  <div id="commentStatus" style="font-size:12.5px; text-align:center; min-height:1.2em;"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Re-trigger event binds inside reviews.js
    if (typeof window.initForumView === 'function') {
      window.initForumView();
    }
  } catch (err) {
    console.error('[Forums View] Initialization failure:', err);
    container.innerHTML = `<div class="card" style="border-color:var(--color-reach); padding:24px; text-align:center;"><p style="color:var(--color-reach);">Failed to load Discussions scripts.</p></div>`;
  }
}

// ═══════════════════════════════════════════════════════
// ROUTE 2: ADMIN PANEL
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
  // Renders the body of admin.html dashboard tab layout
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
        <!-- RENDERED BY ADMIN SCRIPTS -->
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
// ROUTE 3: SUPPORT & DONATIONS PAGE
// ═══════════════════════════════════════════════════════

async function renderDonate(container) {
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; gap: var(--spacing-md);">
      <div class="skeleton-shimmer" style="width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div>
      <p style="color:var(--text-secondary); font-size:14px;">Loading Support Portal…</p>
    </div>
  `;

  try {
    await loadQrCodeScript();

    container.innerHTML = `
      <div class="section-header" style="margin-bottom: var(--spacing-lg); text-align:center;">
        <span class="badge badge-info" style="margin-bottom:8px;">Open Source &middot; No Ads &middot; Community Funded</span>
        <h2>Keep MeritNama Running</h2>
        <p>Supporters keep live merit lists, simulations, and diagnostic tools online for everyone.</p>
      </div>

      <div class="grid grid-2" style="gap: var(--spacing-lg); align-items: flex-start; margin-bottom: var(--spacing-lg);">
        <!-- Banking details -->
        <div class="card">
          <h3>Support Contribution Details</h3>
          <p style="font-size:13px; color:var(--text-secondary); margin-bottom: var(--spacing-md);">Running VMs and scraping proxies to bypass endpoints rate-limits requires resources. Use the banking details below to contribute.</p>
          
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; border-bottom:1px solid var(--border-default); padding-bottom:8px;">
              <span>Bank Name</span>
              <strong>Mashreq Bank Pakistan</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; border-bottom:1px solid var(--border-default); padding-bottom:8px;">
              <span>Account Number</span>
              <div style="display:flex; gap:6px; align-items:center;">
                <code style="font-family:var(--font-mono); font-weight:700;">0891-2007-4774</code>
                <button class="btn btn-ghost" style="padding:2px;" onclick="navigator.clipboard.writeText('089120074774')"><i class="ph ph-copy"></i></button>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px;">
              <span>RAAST ID</span>
              <div style="display:flex; gap:6px; align-items:center;">
                <code style="font-family:var(--font-mono); font-weight:700;">03046774774</code>
                <button class="btn btn-ghost" style="padding:2px;" onclick="navigator.clipboard.writeText('03046774774')"><i class="ph ph-copy"></i></button>
              </div>
            </div>
          </div>

          <div style="display:flex; justify-content:center; margin-top:24px;" id="qrcode"></div>
        </div>

        <!-- Supporters Card Grid -->
        <div class="card" style="padding: var(--spacing-md);">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-default); padding-bottom:8px; margin-bottom:12px;">
            <h3 style="margin:0;">★ MeritNama Supporters</h3>
            <span class="badge badge-info" id="totalContributed">PKR 0</span>
          </div>
          <div id="contributorsGrid" style="display:flex; flex-direction:column; gap:8px; max-height:350px; overflow-y:auto; padding-right:6px;">
            <p style="color:var(--text-muted); font-size:12.5px; text-align:center; padding:20px;">Loading contributors list…</p>
          </div>
        </div>
      </div>
    `;

    // Load QR
    if (window.QRCode) {
      new window.QRCode(document.getElementById('qrcode'), {
        text: '089120074774',
        width: 140,
        height: 140,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }

    // Load Contributors list from Firestore
    loadDonationsList();

  } catch (err) {
    console.error('[Donate View] Load error:', err);
    container.innerHTML = `<div class="card" style="border-color:var(--color-reach); padding:24px; text-align:center;"><p style="color:var(--color-reach);">Failed to initialize support page.</p></div>`;
  }
}

async function loadDonationsList() {
  const grid = document.getElementById('contributorsGrid');
  const totalVal = document.getElementById('totalContributed');
  if (!grid) return;

  try {
    const snap = await db.collection('contributions').orderBy('date', 'desc').limit(40).get();
    if (snap.empty) {
      grid.innerHTML = `<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px;">No contributions logged yet. Be the first!</p>`;
      return;
    }

    let totalPKR = 0;
    grid.innerHTML = snap.docs.map(doc => {
      const d = doc.data();
      totalPKR += d.amountPKR || 0;
      const name = d.name || 'Anonymous';
      const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';
      const date = d.date ? d.date.toDate().toLocaleDateString() : '';

      return `
        <div class="card" style="display:flex; align-items:center; gap: var(--spacing-sm); padding: 8px 12px; border-color:var(--border-subtle); background:var(--surface-secondary);">
          <div style="width:36px; height:36px; border-radius:50%; background:var(--brand-primary); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px;">${initials}</div>
          <div>
            <div style="font-weight:600; font-size:13px;">${name}</div>
            <div style="font-size:11.5px; color:var(--text-tertiary);">PKR ${d.amountPKR?.toLocaleString() || '—'} &middot; ${date}</div>
          </div>
        </div>
      `;
    }).join('');

    if (totalVal) {
      totalVal.textContent = `PKR ${totalPKR.toLocaleString()}`;
    }
  } catch (err) {
    console.error('Failed to load contributions:', err);
    grid.innerHTML = `<p style="color:var(--color-reach); font-size:12.5px; text-align:center;">Failed to load contributors.</p>`;
  }
}

// ═══════════════════════════════════════════════════════
// ROUTE 4: SNAPSHOT CHANGES LOG
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
// ROUTE 5: DIAGNOSTIC SHARE CARD GENERATOR
// ═══════════════════════════════════════════════════════

let _shareTplId = 'gradient';
const SHARE_TEMPLATES = [
  { id: 'gradient', label: 'Sunset Orange', bg: ['#1c0c05', '#2b1003'], accent: '#ea580c', textColor: '#fbf5f2', barColor: 'rgba(234,88,12,0.15)', glowColor: 'rgba(234,88,12,0.25)' },
  { id: 'dark', label: 'Obsidian Zinc', bg: ['#09090b', '#18181b'], accent: '#ea580c', textColor: '#fafafa', barColor: 'rgba(234,88,12,0.12)', glowColor: 'rgba(234,88,12,0.2)' },
  { id: 'minimal', label: 'Polar Light', bg: ['#ffffff', '#f4f4f5'], accent: '#09090b', textColor: '#09090b', barColor: 'rgba(9,9,11,0.06)', glowColor: 'rgba(9,9,11,0.1)' }
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
    const profile = getSessionProfile(); // wait, check if profile exists
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
  const name = document.getElementById('shName').value.trim() || 'Dr. Candidate';
  const id = document.getElementById('shId').value.trim() || '—';
  const marks = document.getElementById('shMarks').value.trim() || '—';
  const pct = document.getElementById('shPercentile').value.trim() || '—';
  const parent = document.getElementById('shParent').value.trim() || '—';

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
    { label: 'Candidate Name', value: name },
    { label: 'Applicant ID', value: id },
    { label: 'Total merit score', value: marks },
    { label: 'Percentile Rank', value: pct },
    { label: 'Parent Hospital', value: parent }
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

// ═══════════════════════════════════════════════════════
// ROUTE 6: CREDENTIALS ACCESS REQUEST
// ═══════════════════════════════════════════════════════

async function renderRequestAccess(container) {
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; gap: var(--spacing-md);">
      <div class="skeleton-shimmer" style="width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div>
      <p style="color:var(--text-secondary); font-size:14px;">Loading Verification gate…</p>
    </div>
  `;

  try {
    await loadRequestAccessScripts();

    container.innerHTML = `
      <div class="section-header" style="margin-bottom: var(--spacing-lg);">
        <h2>Request Verification credentials</h2>
        <p>Submit details to request account access or manually upload supporting tokens.</p>
      </div>

      <div class="grid grid-2" style="gap: var(--spacing-lg); align-items: flex-start;">
        <!-- Form card -->
        <div class="card">
          <h3>Verification Request</h3>
          <div style="display:flex; flex-direction:column; gap:12px; margin-top:12px;" class="req-access-form">
            <div class="form-group">
              <label for="reqEmail">Registered Email</label>
              <input type="email" id="reqEmail" class="input" placeholder="dr.doe@example.com" />
            </div>
            <div class="form-group">
              <label for="reqId">Applicant ID</label>
              <input type="number" id="reqId" class="input" placeholder="E.g. 35183" />
            </div>
            <p id="reqPrev" style="font-size:13px; color:var(--brand-primary); font-weight:600; min-height:1.2em; margin:0;"></p>

            <div id="reqPay" style="margin-top:8px;"></div>

            <button class="btn btn-primary" id="reqSubmitBtn" style="margin-top:12px; width:100%;">Submit Verification Request</button>
            <div id="reqError" style="font-size:12.5px; text-align:center; color:var(--color-reach); min-height:1.2em; margin-top:8px;"></div>
            <div id="reqSuccess" style="display:none; font-size:12.5px; text-align:center; color:var(--color-safe); min-height:1.2em; margin-top:8px;"></div>
          </div>
        </div>

        <!-- Support Info panel -->
        <div class="card" id="proofPanel">
          <h3>Submit Contribution Proof</h3>
          <p style="font-size:13px; color:var(--text-secondary); margin-bottom: var(--spacing-md);">If you made a bank/RAAST transfer, enter your email and attach payment proof receipt.</p>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div class="form-group">
              <label for="proofEmailStandalone">Account Email</label>
              <input type="email" id="proofEmailStandalone" class="input" placeholder="dr.doe@example.com" />
            </div>
            <div class="form-group">
              <label for="proofMessageStandalone">Reference Message (optional)</label>
              <textarea id="proofMessageStandalone" class="input" rows="2" placeholder="E.g. ref #10029381…"></textarea>
            </div>
            <div class="form-group">
              <label>Receipt Screenshot</label>
              <input type="file" id="proofPhotoStandalone" accept="image/*" class="input" style="padding:4px 10px;" />
              <div id="proofPhotoPreviewStandalone" style="display:none; margin-top:8px;"></div>
            </div>
            <button class="btn btn-secondary" id="proofSubmitStandalone">Upload Proof</button>
            <div id="proofErrorStandalone" style="font-size:12px; text-align:center; color:var(--color-reach); min-height:1.2em; margin-top:6px;"></div>
            <div id="proofSuccessStandalone" style="display:none; font-size:12px; text-align:center; color:var(--color-safe); min-height:1.2em; margin-top:6px;"></div>
          </div>
        </div>
      </div>
    `;

    // Hook listeners (matches index.html/request-access.html script logic)
    const reqEmail = document.getElementById('reqEmail');
    const reqId = document.getElementById('reqId');
    const reqPrev = document.getElementById('reqPrev');
    const reqPay = document.getElementById('reqPay');
    const reqBtn = document.getElementById('reqSubmitBtn');
    const reqErr = document.getElementById('reqError');
    const reqOk = document.getElementById('reqSuccess');

    let verifyTimer = null;
    const AR = window.MNAccessRequest;
    let accessConfig = null;

    AR.loadAccessConfig(db).then((cfg) => {
      accessConfig = cfg;
      reqPay.innerHTML = AR.renderPaymentBlock(cfg, '');
    });

    async function runVerify() {
      reqPrev.textContent = '';
      if (!reqEmail.value.trim() || !reqId.value.trim()) return;
      try {
        const result = await AR.verifyCandidate(reqEmail.value, reqId.value);
        if (result.ok) {
          reqPrev.innerHTML = `✓ Matched: <strong>${result.nameFull || result.email}</strong><br>Applicant ID: <strong>${result.applicantId}</strong>`;
          if (accessConfig) {
            reqPay.innerHTML = AR.renderPaymentBlock(accessConfig, result.applicantId);
          }
        }
      } catch (e) {}
    }

    function scheduleVerify() {
      if (verifyTimer) clearTimeout(verifyTimer);
      verifyTimer = setTimeout(runVerify, 400);
    }

    reqEmail.addEventListener('input', scheduleVerify);
    reqId.addEventListener('input', scheduleVerify);

    // Binds proof uploader receipt
    const proofPhoto = document.getElementById('proofPhotoStandalone');
    const proofPreview = document.getElementById('proofPhotoPreviewStandalone');
    let proofBase64 = '';

    proofPhoto.addEventListener('change', () => {
      const file = proofPhoto.files[0];
      if (!file) {
        proofPreview.style.display = 'none';
        proofBase64 = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        proofBase64 = e.target.result;
        proofPreview.style.display = 'block';
        proofPreview.innerHTML = `<img src="${proofBase64}" style="max-width:100%; max-height:160px; display:block; border-radius:6px;" alt="Receipt proof" />`;
      };
      reader.readAsDataURL(file);
    });

    // Upload proof button
    const proofBtn = document.getElementById('proofSubmitStandalone');
    const proofErr = document.getElementById('proofErrorStandalone');
    const proofOk = document.getElementById('proofSuccessStandalone');
    const proofEmail = document.getElementById('proofEmailStandalone');
    const proofMsg = document.getElementById('proofMessageStandalone');

    proofBtn.addEventListener('click', async () => {
      proofErr.textContent = '';
      proofOk.style.display = 'none';
      const email = proofEmail.value.trim().toLowerCase();
      if (!email) {
        proofErr.textContent = 'Enter email used for request.';
        return;
      }
      proofBtn.disabled = true;
      proofBtn.textContent = 'Uploading…';

      try {
        const result = await AR.submitPaymentProof(db, email, proofBase64, proofMsg.value);
        if (!result.ok) {
          proofErr.textContent = result.error || 'Failed to submit.';
          return;
        }
        proofOk.style.display = 'block';
        proofOk.textContent = 'Payment proof receipt uploaded!';
        proofBtn.textContent = 'Uploaded';
        proofPhoto.value = '';
        proofBase64 = '';
        proofPreview.style.display = 'none';
        proofMsg.value = '';
      } catch(e) {
        proofErr.textContent = 'Upload failed. Try again.';
      } finally {
        if (proofBtn.textContent === 'Uploading…') {
          proofBtn.disabled = false;
          proofBtn.textContent = 'Upload Proof';
        }
      }
    });

    // Submit request button
    reqBtn.addEventListener('click', async () => {
      reqErr.textContent = '';
      reqOk.style.display = 'none';
      reqBtn.disabled = true;
      reqBtn.textContent = 'Submitting…';

      try {
        const result = await AR.submitAccessRequest(db, {
          email: reqEmail.value,
          applicantId: reqId.value,
          paymentDeclared: !!document.getElementById('authPayDeclared')?.checked,
          paymentAmountPKR: document.getElementById('authPayAmountPKR')?.value || '',
          paymentReference: document.getElementById('authPayRef')?.value || '',
          message: document.getElementById('authMsg')?.value || ''
        });

        if (!result.ok) {
          reqErr.textContent = result.error || 'Request failed.';
          reqBtn.disabled = false;
          reqBtn.textContent = 'Submit Request';
          return;
        }

        reqOk.style.display = 'block';
        reqOk.innerHTML = `Request submitted! Admin will verify and email credentials.`;
        reqBtn.textContent = 'Submitted';
      } catch(e) {
        reqErr.textContent = 'Submission failed. Try again.';
        reqBtn.disabled = false;
        reqBtn.textContent = 'Submit Request';
      }
    });

  } catch(err) {
    console.error('[Request Access View] Load failure:', err);
    container.innerHTML = `<div class="card" style="border-color:var(--color-reach); padding:24px; text-align:center;"><p style="color:var(--color-reach);">Failed to load Verification module.</p></div>`;
  }
}

// Expose renderers globally
window.renderDiscussion = renderDiscussion;
window.renderAdmin = renderAdmin;
window.renderDonate = renderDonate;
window.renderChangesLog = renderChangesLog;
window.renderAnimationSandbox = renderAnimationSandbox;
window.renderRequestAccess = renderRequestAccess;
