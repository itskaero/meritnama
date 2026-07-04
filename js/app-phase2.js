'use strict';

/**
 * MeritNama SPA - Phase 2 View Renderers
 * Integrates Simulation Portal, My Profile, and Hospitals Directory.
 */

// ═══════════════════════════════════════════════════════
// DYNAMIC SCRIPT LOADER FOR SIMULATION
// ═══════════════════════════════════════════════════════

const SIMULATION_SCRIPTS = [
  'notifications.js',
  'js/sim-core.js',
  'js/sim-data.js',
  'js/sim-nav.js',
  'js/sim-findme.js',
  'js/sim-candidates.js',
  'js/sim-slot-browser.js',
  'js/sim-placement.js',
  'js/sim-extras.js',
  'js/sim-profiles.js',
  'js/sim-chat.js',
  'js/sim-notifications.js',
  'js/sim-merit-list.js',
  'js/sim-consent.js',
  'js/sim-config.js'
];

let _simScriptsPromise = null;

function loadSimulationScripts() {
  if (_simScriptsPromise) return _simScriptsPromise;

  _simScriptsPromise = (async () => {
    for (const url of SIMULATION_SCRIPTS) {
      if (document.querySelector(`script[src="${url}"]`)) continue;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load simulator file: ${url}`));
        document.body.appendChild(script);
      });
    }
  })();

  return _simScriptsPromise;
}

// ═══════════════════════════════════════════════════════
// ROUTE 1: SIMULATION PORTAL
// ═══════════════════════════════════════════════════════

async function renderSimulation(container) {
  if (!container) return;

  // Show inline loading state before scripts load
  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; gap: var(--spacing-md);">
      <div class="skeleton-shimmer" style="width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div>
      <p style="color:var(--text-secondary); font-size:14px;">Loading Simulation Engine…</p>
    </div>
  `;

  try {
    await loadSimulationScripts();
    
    // Inject full simulator dashboard layout
    container.innerHTML = `
      <div class="section-header" style="margin-bottom: var(--spacing-md);">
        <h2>Induction Portal Simulator</h2>
        <p>Deferred-Acceptance seat allocation engine. Reruns PMDC/PRP algorithm based on candidate preferences and seats.</p>
      </div>

      <!-- Simulator Tabs Nav Bar -->
      <nav class="tab-nav sim-tab-nav" id="mainNav" style="margin-bottom: var(--spacing-lg);">
        <div class="sim-nav-section sim-nav-primary">
          <button class="tab-btn active" data-tab="guide"><i class="ph ph-book-open"></i> Guide</button>
          <button class="tab-btn" data-tab="candidates"><i class="ph ph-users"></i> Candidates</button>
          <button class="tab-btn" data-tab="slotbrowser"><i class="ph ph-target"></i> Where Merit Falls</button>
          <button class="tab-btn" data-tab="simulation"><i class="ph ph-lightning"></i> Allocation</button>
          <button class="tab-btn" data-tab="consent"><i class="ph ph-arrows-left-right"></i> Consent What-If</button>
          <button class="tab-btn" data-tab="config"><i class="ph ph-gear"></i> Config</button>
        </div>
        <div class="sim-nav-section sim-nav-secondary">
          <span class="sim-nav-label">Plan</span>
          <button class="tab-btn" data-tab="schedule"><i class="ph ph-calendar"></i> Schedule</button>
          <button class="tab-btn" data-tab="profiles"><i class="ph ph-user-list"></i> Community Profiles</button>
          <button class="tab-btn" data-tab="community"><i class="ph ph-chat-circle"></i> Chat</button>
        </div>
        <div class="sim-nav-section sim-nav-more">
          <span class="sim-nav-label">More</span>
          <button class="tab-btn" data-tab="competition"><i class="ph ph-chart-line"></i> Competition</button>
          <button class="tab-btn" data-tab="seatmatrix"><i class="ph ph-layout"></i> Seats Matrix</button>
        </div>
      </nav>

      <!-- Data Update Ticker -->
      <div class="update-ticker" style="margin-bottom: var(--spacing-md); border-radius: var(--radius-card); border: 1px solid var(--border-subtle); padding: var(--spacing-sm) var(--spacing-md);">
        <span class="ticker-dot"></span>
        <span class="ticker-label">Data Sync Status:</span>
        <span class="ticker-value" id="dataStatus">Synchronised</span>
        <span class="ticker-sep">&middot;</span>
        <span class="ticker-info" id="dataSyncCounts">Loading metadata…</span>
      </div>

      <!-- Live Fetch Progress -->
      <div id="fetchProgressWrap" class="fetch-progress-wrap hidden" style="margin-bottom: var(--spacing-md);">
        <div class="fetch-progress-inner card">
          <div class="fetch-progress-top">
            <span id="fetchProgressIcon" class="fetch-progress-icon">⌛</span>
            <div>
              <div id="fetchProgressTitle" class="fetch-progress-title">Fetching Live Data</div>
              <div id="fetchProgressMessage" class="fetch-progress-message">Please wait…</div>
            </div>
            <span id="fetchProgressStatus" class="fetch-progress-status">Syncing</span>
          </div>
          <div class="fetch-progress-bar-wrap">
            <div id="fetchProgressBar" class="fetch-progress-bar"></div>
          </div>
        </div>
      </div>

      <!-- Find Me Position Bar -->
      <div class="sim-findme-bar card" style="display:flex; align-items:center; gap: var(--spacing-sm); flex-wrap:wrap; margin-bottom: var(--spacing-lg);">
        <span style="font-weight:600; font-size:13px; color:var(--text-secondary);">Find position:</span>
        <input type="number" id="findMeInput" class="input" style="max-width:180px; padding: 6px 12px; font-size:13px;" placeholder="Applicant ID…" />
        <button id="findMeBtn" class="btn btn-primary" style="padding: 6px 12px; font-size:12px;">Search</button>
        <span id="myBadge" class="sim-me-badge hidden"></span>
        <button id="clearMeBtn" class="btn btn-secondary hidden" style="padding: 6px 12px; font-size:12px;">Clear</button>
        <button id="addManuallyBtn" class="btn btn-secondary" style="margin-left:auto; padding: 6px 12px; font-size:12px;">+ Custom Candidate</button>
      </div>

      <!-- Main Tab-Contents Grid -->
      <div class="sim-main-content">
        <!-- 1. GUIDE -->
        <section class="tab-content active" id="tab-guide">
          <div class="card" style="margin-bottom: var(--spacing-lg);">
            <h3>Deferred-Acceptance simulator</h3>
            <p>Use this view to explore seat layouts, applicant parameters, and project allocation placements. Candidate records stay entirely local to your browser session.</p>
          </div>
          <div class="grid grid-2" style="gap: var(--spacing-lg); margin-bottom: var(--spacing-lg);">
            <div class="card">
              <h4>Quickstart Checklists</h4>
              <ol style="margin-left: var(--spacing-md); line-height: 1.6; font-size: 13.5px; color: var(--text-secondary);">
                <li>Search your <strong>Applicant ID</strong> in the search bar above.</li>
                <li>Verify your scores and preference listings in the <strong>Candidates Pool</strong>.</li>
                <li>Examine available seats in the <strong>Seats Matrix</strong>.</li>
                <li>Go to <strong>Seat Allocation</strong> and run the matching algorithm to simulate matches.</li>
              </ol>
            </div>
            <div class="card">
              <h4>Simulation Rules</h4>
              <ul style="margin-left: var(--spacing-md); line-height: 1.6; font-size: 13.5px; color: var(--text-secondary);">
                <li>Deferred-Acceptance matches applicants based on descending merit ranks.</li>
                <li>Trainees are allocated their best available preference.</li>
                <li>Optional 5-mark parent institute bonus is computed dynamically where selected.</li>
              </ul>
            </div>
          </div>
        </section>

        <!-- 2. CANDIDATE POOL -->
        <section class="tab-content" id="tab-candidates">
          <div class="card" style="margin-bottom: var(--spacing-lg);">
            <div class="input-grid">
              <div class="form-group">
                <label for="candSearch">Search candidate name or ID</label>
                <input type="text" id="candSearch" class="input" placeholder="Type a search query…" />
              </div>
              <div class="form-group">
                <label for="candProgram">Filter program</label>
                <select id="candProgram" class="select">
                  <option value="">All programs</option>
                  <option value="FCPS">FCPS</option>
                  <option value="MS">MS</option>
                  <option value="MD">MD</option>
                </select>
              </div>
            </div>
          </div>
          <div class="card" style="padding:0; overflow:hidden;">
            <div class="table-wrap">
              <table class="data-table" id="candTable">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th class="num">Base Marks</th>
                    <th class="num">FCPS Marks</th>
                    <th class="num">MS/MD Marks</th>
                    <th>Preferences</th>
                  </tr>
                </thead>
                <tbody id="candTableBody">
                  <tr><td colspan="6" style="padding:40px; text-align:center; color:var(--text-muted);">Loading candidates pool…</td></tr>
                </tbody>
              </table>
            </div>
            <div id="candPagination" style="display:flex; justify-content:space-between; align-items:center; padding: var(--spacing-md); border-top:1px solid var(--border-default);"></div>
          </div>
        </section>

        <!-- 3. WHERE MERIT FALLS -->
        <section class="tab-content" id="tab-slotbrowser">
          <div class="card" style="margin-bottom: var(--spacing-lg);">
            <div class="input-grid">
              <div class="form-group">
                <label for="sbProgram">Program</label>
                <select id="sbProgram" class="select"><option value="">All</option></select>
              </div>
              <div class="form-group">
                <label for="sbQuota">Quota</label>
                <select id="sbQuota" class="select"><option value="">All</option></select>
              </div>
              <div class="form-group">
                <label for="sbSpec">Speciality</label>
                <select id="sbSpec" class="select"><option value="">All</option></select>
              </div>
              <div class="form-group">
                <label for="sbHosp">Hospital</label>
                <select id="sbHosp" class="select"><option value="">All</option></select>
              </div>
            </div>
            <div style="display:flex; gap: var(--spacing-sm); margin-top: var(--spacing-md); flex-wrap:wrap;">
              <input type="text" id="sbCandSearch" class="input" style="flex:1;" placeholder="Search candidate inside this slot…" />
              <button id="sbRunSimBtn" class="btn btn-primary">Run Simulation</button>
              <button id="sbCandFindBtn" class="btn btn-secondary">Find</button>
              <button id="sbCandClearBtn" class="btn btn-secondary hidden">Clear</button>
            </div>
            <div id="sbCandPanel" class="card hidden" style="margin-top: var(--spacing-md); background:var(--brand-light);"></div>
          </div>
          <div id="sbResult" class="card">
            <p style="color:var(--text-muted); text-align:center; padding:40px;">Select program and quota options to inspect slot demand.</p>
          </div>
        </section>

        <!-- 4. SEAT ALLOCATION -->
        <section class="tab-content" id="tab-simulation">
          <div class="card" style="margin-bottom: var(--spacing-lg);">
            <div class="input-grid">
              <div class="form-group">
                <label for="simProgram">Program</label>
                <select id="simProgram" class="select">
                  <option value="FCPS">FCPS</option>
                  <option value="FCPS Dentistry">FCPS Dentistry</option>
                  <option value="MS">MS</option>
                  <option value="MD">MD</option>
                </select>
              </div>
              <div class="form-group">
                <label for="simFilter">Filter results</label>
                <input type="text" id="simFilter" class="input" placeholder="Specialty or hospital…" />
              </div>
              <div class="form-group">
                <label>Parent Bonus</label>
                <label style="display:inline-flex; align-items:center; gap:8px; margin-top:8px; cursor:pointer;">
                  <input type="checkbox" id="simParentBonus" /> Add +5 Marks for parent hospital
                </label>
              </div>
            </div>
            <div style="display:flex; gap: var(--spacing-sm); margin-top: var(--spacing-md); flex-wrap:wrap; align-items:center;">
              <button id="runSimBtn" class="btn btn-primary">Run Simulation</button>
              <button id="simDownloadPdfBtn" class="btn btn-secondary" disabled>Download Report PDF</button>
              <span style="font-size:12px; color:var(--text-tertiary);" id="simDownloadNote">Supporter-only export</span>
            </div>
            <div class="app-sim-tool" style="margin-top: var(--spacing-md); padding-top: var(--spacing-md); border-top:1px solid var(--border-default);">
              <span style="font-weight:600; font-size:13px; color:var(--text-secondary);">Individual simulation journey:</span>
              <div style="display:flex; gap: var(--spacing-sm); margin-top: var(--spacing-xs);">
                <input type="number" id="appSimIdInput" class="input" style="max-width:180px;" placeholder="Applicant ID…" />
                <button id="runApplicantSimBtn" class="btn btn-secondary">Trace candidate pathway</button>
              </div>
            </div>
          </div>
          <div id="simResults"></div>
        </section>

        <!-- 5. CONSENT WHAT-IF -->
        <section class="tab-content" id="tab-consent">
          <div class="card" style="margin-bottom: var(--spacing-lg);">
            <div class="input-grid">
              <div class="form-group">
                <label for="consentProgram">Program</label>
                <select id="consentProgram" class="select">
                  <option value="FCPS">FCPS</option>
                  <option value="MS">MS</option>
                  <option value="MD">MD</option>
                </select>
              </div>
              <div class="form-group">
                <label for="consentCandidateId">Applicant ID</label>
                <input type="number" id="consentCandidateId" class="input" placeholder="E.g. 35183…" />
              </div>
            </div>
            <div style="display:flex; gap: var(--spacing-sm); margin-top: var(--spacing-md);">
              <button id="runConsentNoBtn" class="btn btn-primary">Rerun: Candidate withdraws consent</button>
              <button id="runConsentYesBtn" class="btn btn-secondary">Rerun: Candidate consents</button>
              <button id="consentUseMeBtn" class="btn btn-secondary">Use my ID</button>
            </div>
          </div>
          <div id="consentResults" class="card" style="color:var(--text-muted); text-align:center; padding:40px;">
            Input a candidate ID to check chain reactions of seat allocation updates.
          </div>
        </section>

        <!-- 6. CONFIG -->
        <section class="tab-content" id="tab-config">
          <div class="card" id="configControls">
            <h3>Configuration Panel</h3>
            <div class="config-editor-grid input-grid">
              <div class="config-editor-field form-group">
                <label for="cfgMarksBasis">Merit formula</label>
                <select id="cfgMarksBasis" class="select"></select>
              </div>
              <div class="config-editor-field form-group">
                <label for="cfgSimStatusScope">verification status scope</label>
                <select id="cfgSimStatusScope" class="select"></select>
              </div>
            </div>
          </div>
          <div id="configContent" class="card" style="margin-top: var(--spacing-lg);"></div>
        </section>

        <!-- 7. SCHEDULE -->
        <section class="tab-content" id="tab-schedule">
          <div class="card" style="margin-bottom: var(--spacing-lg);">
            <div class="input-grid">
              <div class="form-group">
                <label for="schedFilter">State filter</label>
                <select id="schedFilter" class="select">
                  <option value="all">All steps</option>
                  <option value="active">Open now</option>
                  <option value="upcoming">Upcoming</option>
                </select>
              </div>
              <div class="form-group">
                <label for="schedSearch">Search schedules</label>
                <input type="text" id="schedSearch" class="input" placeholder="Search steps…" />
              </div>
            </div>
          </div>
          <div id="schedResults" class="card"></div>
        </section>

        <!-- 8. PROFILES -->
        <section class="tab-content" id="tab-profiles">
          <div class="card" style="margin-bottom: var(--spacing-lg);">
            <div class="input-grid">
              <div class="form-group">
                <label for="profilesSearch">Search profiles</label>
                <input type="text" id="profilesSearch" class="input" placeholder="Search name or specialty…" />
              </div>
              <div class="form-group">
                <label for="profilesStatusFilter">Induction status</label>
                <select id="profilesStatusFilter" class="select">
                  <option value="">All</option>
                  <option value="inducted">Inducted</option>
                  <option value="applicant">Applicant</option>
                </select>
              </div>
            </div>
          </div>
          <div id="profilesGrid"></div>
        </section>

        <!-- 9. COMMUNITY CHAT -->
        <section class="tab-content" id="tab-community">
          <div class="card" style="margin-bottom: var(--spacing-lg); padding: var(--spacing-md);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: var(--spacing-md);">
              <h3 style="margin:0;"><i class="ph ph-chat-circle"></i> Chat Rooms</h3>
              <select id="chatTabRoomSelect" class="select" style="max-width:200px; padding: 4px 8px; font-size:12px;"></select>
            </div>
            <div style="display:grid; grid-template-columns: 240px 1fr; gap: var(--spacing-md); min-height:450px;">
              <aside style="border-right:1px solid var(--border-default); padding-right: var(--spacing-md);">
                <div id="chatRoomList" style="display:flex; flex-direction:column; gap:4px;"></div>
              </aside>
              <div style="display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                  <div id="chatTabNameBar" style="font-weight:700; border-bottom:1px solid var(--border-default); padding-bottom:8px; margin-bottom:8px;"></div>
                  <div id="chatActiveRoomMeta" style="font-size:12px; color:var(--text-tertiary); margin-bottom:8px;"></div>
                  <div id="chatTabPin" class="card hidden" style="background:var(--brand-light); border-color:var(--brand-primary); font-size:12px; padding:8px; margin-bottom:8px;"></div>
                  <div id="chatTabMessages" style="max-height:280px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:8px;"></div>
                  <div id="chatTabTyping" style="font-size:11px; color:var(--text-muted); font-style:italic;" class="hidden"></div>
                </div>
                <div style="margin-top: var(--spacing-md); border-top:1px solid var(--border-default); padding-top: var(--spacing-md);">
                  <div id="chatTabReplyBar" class="hidden" style="font-size:11px; background:var(--surface-secondary); padding:4px 8px; border-radius:4px; margin-bottom:6px; display:flex; justify-content:space-between;"></div>
                  <div id="chatTabAttachPreview" class="hidden" style="margin-bottom:6px;"></div>
                  <div style="display:flex; gap:8px;">
                    <textarea id="chatTabInput" class="input" style="flex:1; resize:none;" rows="2" placeholder="Write a message… (Enter to send)"></textarea>
                    <button id="chatTabSendBtn" class="btn btn-primary" style="align-self: flex-end;">Send</button>
                  </div>
                  <input type="file" id="chatTabImageInput" accept="image/*" hidden />
                  <div style="display:flex; gap:12px; margin-top:8px; align-items:center;">
                    <button id="chatTabImageBtn" class="btn btn-secondary" style="padding:4px 8px; font-size:12px;"><i class="ph ph-camera"></i> Upload Image</button>
                    <span id="chatTabCharCount" style="font-size:11px; color:var(--text-muted); margin-left:auto;">0/500</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 10. COMPETITION -->
        <section class="tab-content" id="tab-competition">
          <div class="card" style="margin-bottom: var(--spacing-lg);">
            <div class="input-grid">
              <div class="form-group">
                <label for="compProgram">Program</label>
                <select id="compProgram" class="select"><option value="">All</option></select>
              </div>
              <div class="form-group">
                <label for="compQuota">Quota</label>
                <select id="compQuota" class="select"><option value="">All</option></select>
              </div>
              <div class="form-group">
                <label for="compSearch">Search Specialty</label>
                <input type="text" id="compSearch" class="input" placeholder="Type specialty…" />
              </div>
              <div class="form-group">
                <label for="compSort">Sort by</label>
                <select id="compSort" class="select">
                  <option value="ratio-desc">Highest Competition</option>
                  <option value="ratio-asc">Lowest Competition</option>
                  <option value="specialty">Specialty A-Z</option>
                </select>
              </div>
            </div>
          </div>
          <div id="compResults"></div>
        </section>

        <!-- 11. TRAINING SEATS -->
        <section class="tab-content" id="tab-seatmatrix">
          <div class="card" style="margin-bottom: var(--spacing-lg);">
            <div class="input-grid">
              <div class="form-group">
                <label for="smProgram">Program</label>
                <select id="smProgram" class="select"><option value="">All</option></select>
              </div>
              <div class="form-group">
                <label for="smQuota">Quota</label>
                <select id="smQuota" class="select"><option value="">All</option></select>
              </div>
              <div class="form-group">
                <label for="smSearch">Search Seat</label>
                <input type="text" id="smSearch" class="input" placeholder="Type hospital or specialty…" />
              </div>
            </div>
          </div>
          <div id="smResults"></div>
        </section>
      </div>

      <!-- Modals for Simulation scripts -->
      <div class="modal hidden" id="candidateModal">
        <div class="modal-overlay" id="candidateModalOverlay"></div>
        <div class="modal-box card" style="max-width:760px; max-height:85vh; overflow-y:auto; position: relative;">
          <button class="modal-close btn btn-ghost" id="candidateModalClose" style="position:absolute; top:8px; right:8px; font-size:18px;">&times;</button>
          <div id="candidateModalBody"></div>
        </div>
      </div>

      <div class="modal hidden" id="appSimModal" role="dialog" aria-modal="true">
        <div class="modal-overlay" id="appSimModalOverlay"></div>
        <div class="modal-box card app-sim-modal-box" style="max-width:600px; position: relative; margin: auto;">
          <button class="modal-close btn btn-ghost" id="appSimModalClose" style="position:absolute; top:8px; right:8px; font-size:18px;">&times;</button>
          <div id="appSimModalBody"></div>
        </div>
      </div>

      <div id="profileViewModal" class="sbm-backdrop hidden" role="dialog" aria-modal="true">
        <div class="modal-overlay" onclick="document.getElementById('profileViewModal').classList.add('hidden')"></div>
        <div class="sbm-sheet card" style="max-width:420px; margin: auto; position: relative; z-index:10;" id="profileViewSheet"></div>
      </div>

      <div class="modal hidden" id="customModal">
        <div class="modal-overlay" id="customModalOverlay" onclick="document.getElementById('customModal').classList.add('hidden')"></div>
        <div class="custom-modal-box card" style="max-width:600px; margin: auto; position: relative; z-index:10;">
          <button class="modal-close btn btn-ghost" id="customModalClose" style="position:absolute; top:8px; right:8px; font-size:18px;" onclick="document.getElementById('customModal').classList.add('hidden')">&times;</button>
          <h3>Add Manual Candidate</h3>
          <p style="font-size:13px; color:var(--text-secondary); margin-bottom: var(--spacing-md);">Add yourself to the candidate simulation pool (saved only locally in this browser).</p>
          <div class="input-grid">
            <div class="form-group">
              <label for="customId">Applicant ID</label>
              <input type="number" id="customId" class="input" />
            </div>
            <div class="form-group">
              <label for="customName">Display Name</label>
              <input type="text" id="customName" class="input" />
            </div>
            <div class="form-group">
              <label for="customMarksTotal">Marks Total</label>
              <input type="number" id="customMarksTotal" class="input" step="0.01" />
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap: var(--spacing-sm); margin-top: var(--spacing-md);">
            <button id="customBlankBtn" class="btn btn-secondary">Clear</button>
            <button id="customLoadByIdBtn" class="btn btn-primary">Save to Pool</button>
          </div>
        </div>
      </div>
    `;

    // Initialize scripts
    if (typeof window.setupTabs === 'function') window.setupTabs();
    if (typeof window._initQuoteStrip === 'function') window._initQuoteStrip();
    if (typeof window.initSimulationNotificationFeed === 'function') window.initSimulationNotificationFeed();
    if (typeof window.loadData === 'function' && (!SIM.candidates || !SIM.candidates.length)) {
      window.loadData();
    }

    // Select default tab
    document.querySelector('.tab-btn[data-tab="guide"]')?.click();

  } catch (err) {
    console.error('[Simulation View] Initialisation failure:', err);
    container.innerHTML = `<div class="card" style="border-color:var(--color-reach); padding:var(--spacing-lg); text-align:center;"><p style="color:var(--color-reach); font-weight:700;">Failed to load Simulation scripts.</p></div>`;
  }
}

// ═══════════════════════════════════════════════════════
// ROUTE 2: CANDIDATE PROFILE PAGE
// ═══════════════════════════════════════════════════════

async function renderProfile(container) {
  if (!container) return;

  container.innerHTML = `
    <div id="profileAnimLayer"></div>
    <div class="section-header" style="margin-bottom: var(--spacing-lg);">
      <h2>My Candidate Profile</h2>
      <p>Configure your preferences, MBBS verification codes, trust scores, and dynamic visual indicators.</p>
    </div>

    <div class="grid grid-2" style="gap: var(--spacing-lg); align-items: flex-start;">
      <!-- Profile Card -->
      <div class="card">
        <div style="display:flex; gap: var(--spacing-md); align-items:center; margin-bottom: var(--spacing-lg);">
          <div class="profile-avatar" id="profileAvatar" style="width:72px; height:72px; border-radius:50%; background:var(--brand-primary); color:#fff; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:700; cursor:pointer;" title="Tap to upload image">?</div>
          <div>
            <h3 id="profileDisplayName" style="margin:0;">Loading Profile…</h3>
            <p id="profileEmail" style="margin:0; font-size:13px; color:var(--text-tertiary);">—</p>
            <div id="profileHeroChips" style="margin-top:6px; display:flex; gap:4px;"></div>
          </div>
        </div>

        <!-- Identity Form -->
        <form class="profile-form" id="profileForm" onsubmit="return false;" style="display:flex; flex-direction:column; gap: var(--spacing-md);">
          <div class="form-group">
            <label for="pfName">Full Name</label>
            <input type="text" id="pfName" class="input" placeholder="Your name" />
          </div>
          <div class="form-group">
            <label for="pfSpecialty">Aspiring Specialty</label>
            <input type="text" id="pfSpecialty" class="input" placeholder="E.g. Cardiology" list="specialtyList" />
            <datalist id="specialtyList"></datalist>
          </div>
          <div class="form-group">
            <label for="pfHospital">Aspiring Hospital</label>
            <input type="text" id="pfHospital" class="input" placeholder="E.g. Mayo Hospital" list="hospitalList" />
            <datalist id="hospitalList"></datalist>
          </div>
          <div class="form-group">
            <label for="pfInducted">Induction status</label>
            <select id="pfInducted" class="select">
              <option value="">Not yet inducted</option>
              <option value="inducted">Already inducted</option>
            </select>
          </div>
          <div class="form-group">
            <label for="pfApplicantId">Applicant ID (links gazette data)</label>
            <input type="number" id="pfApplicantId" class="input" placeholder="E.g. 35183" />
          </div>

          <!-- Color Mode / Canvas Animation -->
          <div class="form-group">
            <label>Background Canvas Animation</label>
            <div class="pf-anim-grid" id="animPicker" style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top:6px;"></div>
          </div>

          <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
            <input type="checkbox" id="pfPublic" style="cursor:pointer;" />
            <label for="pfPublic" style="font-size:13.5px; color:var(--text-secondary); cursor:pointer;">Publish profile to community directory</label>
          </div>

          <button class="btn btn-primary" id="profileSaveBtn" style="margin-top: var(--spacing-md);">Save Profile Settings</button>
          <div id="profileStatus" style="font-size:13px; text-align:center; min-height:1.2em;"></div>
        </form>
      </div>

      <!-- Trust Metrics & Sidebar Grid -->
      <div style="display:flex; flex-direction:column; gap: var(--spacing-lg);">
        <!-- Trust Signal Strength -->
        <div class="card">
          <h4>Profile trust score</h4>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:13px; font-weight:600;">
            <span>Completeness</span>
            <span id="profileStrengthScore">0%</span>
          </div>
          <div style="height:6px; background:var(--border-default); border-radius:3px; overflow:hidden; margin-bottom:8px;">
            <div id="profileStrengthFill" style="height:100%; width:0%; background:var(--brand-primary); transition: width 0.3s;"></div>
          </div>
          <p id="profileStrengthSummary" style="font-size:12.5px; color:var(--text-tertiary); margin:0;">Complete details to build credibility.</p>
        </div>

        <!-- Grievance Message System -->
        <div class="card">
          <h4><i class="ph ph-chat-text"></i> Support &amp; Grievance inbox</h4>
          <p style="font-size:12.5px; color:var(--text-tertiary); margin-bottom: var(--spacing-md);">Submit request questions directly to PGMI website admin reviews.</p>
          <div style="display:flex; flex-direction:column; gap: var(--spacing-sm);">
            <select id="grSource" class="select" aria-label="Request type"><option value="">Loading requests options…</option></select>
            <input type="number" id="grApplicantId" class="input" placeholder="Query ID to verify…" />
            <textarea id="grMessage" class="input" rows="3" placeholder="Message content details…"></textarea>
            <button id="grSendBtn" class="btn btn-secondary">Send Message</button>
            <div id="grStatus" style="font-size:12px; min-height:1.2em;"></div>
          </div>
          <div style="margin-top: var(--spacing-md); border-top:1px solid var(--border-default); padding-top: var(--spacing-md);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-weight:600; font-size:13px;">My Inbox requests:</span>
              <span class="badge" id="grInboxBadge">0 threads</span>
            </div>
            <div id="grInboxList" style="display:flex; flex-direction:column; gap:8px;"></div>
          </div>
        </div>

        <!-- Invite Panel -->
        <div class="card">
          <h4><i class="ph ph-envelope-open"></i> Colleague Manual Invites</h4>
          <p style="font-size:12.5px; color:var(--text-tertiary); margin-bottom: var(--spacing-md);">Create access codes to help colleagues register without sending emails.</p>
          <div style="display:flex; flex-direction:column; gap: var(--spacing-sm);">
            <input type="text" id="inviteName" class="input" placeholder="Name…" />
            <input type="email" id="inviteEmail" class="input" placeholder="Email…" />
            <div style="display:flex; gap:6px;">
              <input type="text" id="invitePin" class="input" placeholder="Access PIN code…" style="flex:1;" />
              <button id="inviteGeneratePinBtn" class="btn btn-secondary" style="padding:6px 12px; font-size:12px;">Generate</button>
            </div>
            <button id="inviteSubmitBtn" class="btn btn-secondary">Create Invite PIN</button>
            <div id="inviteStatus" style="font-size:12px; min-height:1.2em;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Pre-load logic from candidate.html script blocks
  if (typeof window.loadProfile === 'function') window.loadProfile();
  if (typeof window.initResponderSources === 'function') window.initResponderSources();
  if (typeof window.subscribeGrievanceInbox === 'function') window.subscribeGrievanceInbox();
}

// ═══════════════════════════════════════════════════════
// ROUTE 3: HOSPITALS DIRECTORY GRID
// ═══════════════════════════════════════════════════════

async function renderHospitals(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header" style="margin-bottom: var(--spacing-lg);">
      <h2>Training Hospitals Directory</h2>
      <p>Search all PGMI training centers and residency slots inside Punjab. Select hospital to view individual reviews and seat listings.</p>
    </div>

    <!-- Search Tool -->
    <div class="card" style="margin-bottom: var(--spacing-lg);">
      <div style="display:flex; gap: var(--spacing-sm);">
        <input type="text" id="hospSearch" class="input" style="flex:1;" placeholder="Search hospital name or city…" />
      </div>
    </div>

    <!-- Hospitals grid -->
    <div class="grid grid-3" id="hospGrid" style="gap: var(--spacing-md);">
      <div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">Loading directory lists…</div>
    </div>
  `;

  const searchInput = document.getElementById('hospSearch');
  const grid = document.getElementById('hospGrid');

  try {
    const res = await fetch('data/induction21_seats.json');
    const seats = await res.json();

    const map = {};
    for (const entry of seats) {
      const id = entry.hospitalId;
      if (!map[id]) {
        map[id] = {
          id: id,
          name: entry.hospitalName,
          specialties: new Set(),
          types: new Set(),
          totalSeats: 0,
          city: entry.hospitalName.split(',').pop().trim() || 'Punjab'
        };
      }
      map[id].specialties.add(entry.specialityName);
      map[id].types.add(entry.typeName);
      map[id].totalSeats += entry.seats;
    }

    const allHospitals = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));

    const drawGrid = (list) => {
      if (!grid) return;
      if (!list.length) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">No matching training hospitals.</div>`;
        return;
      }

      grid.innerHTML = list.map(h => `
        <a href="#/hospital?id=${h.id}" class="card" style="text-decoration:none; display:flex; flex-direction:column; justify-content:space-between; height:100%; transition: var(--transition-default); hover: border-color: var(--brand-primary);">
          <div>
            <h4 style="margin:0 0 var(--spacing-xs); font-size:15px; color:var(--text-primary); line-height:1.4;">${h.name}</h4>
            <p style="font-size:12.5px; color:var(--text-tertiary); display:flex; align-items:center; gap:4px; margin-bottom:var(--spacing-sm);">
              <i class="ph ph-map-pin"></i> ${h.city}
            </p>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top: auto;">
            <span class="badge badge-info" style="font-family:var(--font-mono); font-size:11px;">${h.totalSeats} seats</span>
            <span class="badge badge-secondary" style="font-size:11px;">${h.specialties.size} specialties</span>
          </div>
        </a>
      `).join('');
    };

    drawGrid(allHospitals);

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        const filtered = allHospitals.filter(h => 
          h.name.toLowerCase().includes(q) || h.city.toLowerCase().includes(q)
        );
        drawGrid(filtered);
      });
    }

  } catch (err) {
    console.error('[Hospitals] Load failure:', err);
    if (grid) grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--color-reach);">Failed to load seats database.</div>`;
  }
}

// ═══════════════════════════════════════════════════════
// ROUTE 4: INDIVIDUAL HOSPITAL PROFILE & REVIEWS
// ═══════════════════════════════════════════════════════

let _currentHospitalId = null;
let _selectedStars = 0;
let _selectedSpecialty = null;

async function renderHospitalDetail(container) {
  if (!container) return;

  const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const hospitalId = urlParams.get('id');

  if (!hospitalId) {
    container.innerHTML = `<div class="card" style="padding:40px; text-align:center;"><p style="color:var(--color-reach);">No Hospital ID specified in parameters.</p></div>`;
    return;
  }

  _currentHospitalId = hospitalId;
  _selectedStars = 0;
  _selectedSpecialty = null;

  // Initial spinner state
  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; gap: var(--spacing-md);">
      <div class="skeleton-shimmer" style="width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div>
      <p style="color:var(--text-secondary); font-size:14px;">Loading Hospital Details…</p>
    </div>
  `;

  try {
    const res = await fetch('data/induction21_seats.json');
    const seats = await res.json();

    // Grouping
    const matched = seats.filter(s => String(s.hospitalId) === String(hospitalId));
    if (!matched.length) {
      container.innerHTML = `<div class="card" style="padding:40px; text-align:center;"><p style="color:var(--color-reach);">Hospital details matching ID not found.</p></div>`;
      return;
    }

    const hospitalName = matched[0].hospitalName;
    const city = hospitalName.split(',').pop().trim() || 'Punjab';

    const specialtiesMap = {};
    let totalSeats = 0;
    matched.forEach(s => {
      const spec = s.specialityName;
      if (!specialtiesMap[spec]) {
        specialtiesMap[spec] = { name: spec, FCPS: 0, MS: 0, MD: 0, total: 0 };
      }
      specialtiesMap[spec][s.typeName] = (specialtiesMap[spec][s.typeName] || 0) + s.seats;
      specialtiesMap[spec].total += s.seats;
      totalSeats += s.seats;
    });

    const specialtiesList = Object.values(specialtiesMap).sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = `
      <div style="margin-bottom: var(--spacing-lg);">
        <a href="#/hospitals" class="btn btn-secondary" style="margin-bottom: var(--spacing-md); padding:6px 12px; font-size:12.5px;"><i class="ph ph-arrow-left"></i> Back to directory</a>
        <h2>${hospitalName}</h2>
        <p style="color:var(--text-secondary); font-size:14px; display:flex; align-items:center; gap:4px; margin-top:4px;">
          <i class="ph ph-map-pin"></i> ${city} &middot; <strong style="color:var(--brand-primary);">${totalSeats} seats</strong> across ${specialtiesList.length} fields
        </p>
      </div>

      <div class="grid grid-3" style="gap: var(--spacing-lg); align-items: flex-start;">
        <!-- Specialties matrix list (spans 2 columns) -->
        <div class="card" style="grid-column: span 2; padding:0; overflow:hidden;">
          <div style="padding: var(--spacing-md) var(--spacing-lg); border-bottom:1px solid var(--border-default);">
            <h3 style="margin:0;">Allocated Specialties Matrix</h3>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Speciality Program</th>
                  <th class="num">FCPS seats</th>
                  <th class="num">MS seats</th>
                  <th class="num">MD seats</th>
                  <th class="num">Total</th>
                </tr>
              </thead>
              <tbody>
                ${specialtiesList.map(s => `
                  <tr style="cursor:pointer;" class="hp-spec-row" data-spec="${s.name}">
                    <td><strong>${s.name}</strong></td>
                    <td class="num font-mono">${s.FCPS || '—'}</td>
                    <td class="num font-mono">${s.MS || '—'}</td>
                    <td class="num font-mono">${s.MD || '—'}</td>
                    <td class="num font-mono" style="font-weight:700; color:var(--brand-primary);">${s.total}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Reviews Sidebar -->
        <div style="display:flex; flex-direction:column; gap: var(--spacing-lg);">
          <!-- Review input form -->
          <div class="card">
            <h4>Share Training Experience</h4>
            <div style="display:flex; flex-direction:column; gap: var(--spacing-sm); margin-top: var(--spacing-sm);">
              <div class="form-group">
                <label>Rating Score</label>
                <div id="starPicker" style="display:flex; gap:4px; margin-top:4px;">
                  ${[1, 2, 3, 4, 5].map(n => `
                    <button class="btn btn-ghost" data-val="${n}" style="padding:4px; font-size:20px; color:var(--text-tertiary);" type="button"><i class="ph ph-star"></i></button>
                  `).join('')}
                </div>
                <span id="starLabel" style="font-size:12px; color:var(--text-tertiary);">Select rating</span>
              </div>
              <div class="form-group">
                <label for="revSpec">Specialty Filter Badge</label>
                <div id="revSpecBadge" class="badge badge-info" style="display:none; margin-top:4px;">
                  <span id="revSpecLabel"></span> 
                  <button id="revSpecClear" class="btn btn-ghost" style="padding:2px; font-size:10px; color:#fff;" type="button">&times;</button>
                </div>
                <span id="revSpecHint" style="font-size:12px; color:var(--text-tertiary);">Click specialty row on table to link review</span>
              </div>
              <input type="text" id="revName" class="input" placeholder="Display name (default Anonymous)…" />
              <textarea id="revText" class="input" rows="3" placeholder="Write feedback details…"></textarea>
              <button id="revSubmit" class="btn btn-primary">Submit Review</button>
              <div id="revStatus" style="font-size:12px; min-height:1.2em;"></div>
            </div>
          </div>

          <!-- Reviews Feed List -->
          <div class="card" style="padding: var(--spacing-md);">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-default); padding-bottom:8px; margin-bottom:8px;">
              <h4 id="reviewsHeading" style="margin:0;">Training Reviews</h4>
              <button id="reviewsShowAll" class="btn btn-ghost" style="font-size:11px; padding:2px 6px; display:none;">Show all</button>
            </div>
            <div id="reviewsList" style="display:flex; flex-direction:column; gap: var(--spacing-sm);">
              <p style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px;">No reviews uploaded yet.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Wire up events
    setupHospitalDetailEvents(hospitalName);
    loadHospitalReviews();

  } catch (err) {
    console.error('[Hospital Detail] Load failure:', err);
    container.innerHTML = `<div class="card" style="border-color:var(--color-reach); padding: var(--spacing-lg); text-align:center;"><p style="color:var(--color-reach);">Failed to load details database.</p></div>`;
  }
}

// ═══════════════════════════════════════════════════════
// HELPER METHODS FOR REVIEWS & SEATS DETAILS
// ═══════════════════════════════════════════════════════

function setupHospitalDetailEvents(hospitalName) {
  // Star Picker
  const stars = document.querySelectorAll('#starPicker button');
  const starLabel = document.getElementById('starLabel');
  const STAR_LABELS = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very Good', 5: 'Excellent' };

  stars.forEach(btn => {
    btn.addEventListener('click', () => {
      _selectedStars = parseInt(btn.dataset.val, 10);
      stars.forEach((b, i) => {
        const icon = b.querySelector('i');
        if (i < _selectedStars) {
          icon.className = 'ph ph-star-fill';
          b.style.color = '#e8a627';
        } else {
          icon.className = 'ph ph-star';
          b.style.color = 'var(--text-tertiary)';
        }
      });
      starLabel.textContent = STAR_LABELS[_selectedStars] || 'Select rating';
    });
  });

  // Table Specialty selection click
  document.querySelectorAll('.hp-spec-row').forEach(row => {
    row.addEventListener('click', () => {
      const spec = row.dataset.spec;
      _selectedSpecialty = spec;

      // Highlight row selection
      document.querySelectorAll('.hp-spec-row').forEach(r => {
        r.style.background = r.dataset.spec === spec ? 'var(--brand-light)' : '';
      });

      // Update Form Badge
      const badge = document.getElementById('revSpecBadge');
      const label = document.getElementById('revSpecLabel');
      const hint = document.getElementById('revSpecHint');
      const showAllBtn = document.getElementById('reviewsShowAll');

      if (badge && label && hint) {
        label.textContent = spec;
        badge.style.display = '';
        hint.style.display = 'none';
      }

      if (showAllBtn) showAllBtn.style.display = '';

      // Reload matching reviews
      loadHospitalReviews(spec);
    });
  });

  // Clear Specialty badge
  const clearBadgeBtn = document.getElementById('revSpecClear');
  const showAllBtn = document.getElementById('reviewsShowAll');
  if (clearBadgeBtn) {
    clearBadgeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _selectedSpecialty = null;
      document.querySelectorAll('.hp-spec-row').forEach(r => r.style.background = '');

      const badge = document.getElementById('revSpecBadge');
      const hint = document.getElementById('revSpecHint');
      if (badge && hint) {
        badge.style.display = 'none';
        hint.style.display = '';
      }
      if (showAllBtn) showAllBtn.style.display = 'none';

      loadHospitalReviews();
    });
  }

  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      _selectedSpecialty = null;
      document.querySelectorAll('.hp-spec-row').forEach(r => r.style.background = '');

      const badge = document.getElementById('revSpecBadge');
      const hint = document.getElementById('revSpecHint');
      if (badge && hint) {
        badge.style.display = 'none';
        hint.style.display = '';
      }
      showAllBtn.style.display = 'none';

      loadHospitalReviews();
    });
  }

  // Submit Review Click
  const submitBtn = document.getElementById('revSubmit');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => submitHospitalReview(hospitalName));
  }
}

async function loadHospitalReviews(filterSpec = null) {
  const list = document.getElementById('reviewsList');
  if (!list) return;

  list.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted); font-size:12.5px;">Loading reviews…</div>`;

  try {
    let query = db.collection('hospital_reviews')
      .where('hospitalId', '==', _currentHospitalId)
      .limit(30);

    if (filterSpec) {
      query = db.collection('hospital_reviews')
        .where('hospitalId', '==', _currentHospitalId)
        .where('specialty', '==', filterSpec)
        .limit(30);
    }

    const snap = await query.get();

    if (snap.empty) {
      list.innerHTML = `<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px;">No reviews yet${filterSpec ? ' for this specialty' : ''}. Be the first to add!</p>`;
      return;
    }

    // Sort descending by date client-side to save Firestore index creation
    const docs = snap.docs.slice().sort((a, b) => {
      const ta = a.data().createdAt?.toMillis() ?? 0;
      const tb = b.data().createdAt?.toMillis() ?? 0;
      return tb - ta;
    });

    list.innerHTML = docs.map(doc => {
      const d = doc.data();
      const date = d.createdAt ? d.createdAt.toDate().toLocaleDateString() : 'Just now';
      const specTag = d.specialty ? `<span class="badge badge-info" style="font-size:10px; margin-top:4px;">📌 ${d.specialty}</span>` : '';
      
      // Star builder helper
      let starsHtml = '';
      for (let i = 1; i <= 5; i++) {
        starsHtml += `<i class="ph ph-star${i <= (d.rating || 0) ? '-fill' : ''}" style="color:${i <= (d.rating || 0) ? '#e8a627' : 'var(--text-tertiary)'};"></i>`;
      }

      return `
        <div class="card" style="padding: var(--spacing-sm) var(--spacing-md); border-color: var(--border-subtle); display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
            <strong style="color:var(--text-primary);">${d.author || 'Anonymous'}</strong>
            <span style="color:var(--text-tertiary);">${date}</span>
          </div>
          <div style="display:flex; gap:2px; font-size:13px;">
            ${starsHtml}
          </div>
          ${specTag}
          <p style="font-size:13px; color:var(--text-secondary); margin:4px 0 0; line-height:1.4; word-break:break-word;">${d.text}</p>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('[Hospitals Reviews] Load error:', err);
    list.innerHTML = `<p style="color:var(--color-reach); font-size:12.5px; text-align:center;">Unable to load reviews feed.</p>`;
  }
}

async function submitHospitalReview(hospitalName) {
  const status = document.getElementById('revStatus');
  const textInput = document.getElementById('revText');
  const nameInput = document.getElementById('revName');
  const text = textInput ? textInput.value.trim() : '';
  const author = nameInput ? nameInput.value.trim() : 'Anonymous';

  if (!status) return;

  if (!_selectedStars) {
    status.className = 'error';
    status.style.color = 'var(--color-reach)';
    status.textContent = 'Please choose a star rating.';
    return;
  }
  if (!text) {
    status.className = 'error';
    status.style.color = 'var(--color-reach)';
    status.textContent = 'Please type your experience feedback.';
    return;
  }

  const btn = document.getElementById('revSubmit');
  if (btn) btn.disabled = true;
  status.textContent = 'Submitting feedback…';
  status.style.color = 'var(--text-secondary)';

  try {
    await db.collection('hospital_reviews').add({
      hospitalId: _currentHospitalId,
      hospitalName: hospitalName,
      specialty: _selectedSpecialty || null,
      author: author || 'Anonymous',
      rating: _selectedStars,
      text: text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    status.textContent = 'Review submitted! Thank you.';
    status.style.color = 'var(--color-safe)';
    if (textInput) textInput.value = '';
    
    // Refresh list
    setTimeout(() => loadHospitalReviews(_selectedSpecialty), 1000);

  } catch (err) {
    console.error('[Hospitals Reviews] Submission error:', err);
    status.textContent = 'Failed to submit review. Try again.';
    status.style.color = 'var(--color-reach)';
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Expose render helpers globally
window.renderSimulation = renderSimulation;
window.renderProfile = renderProfile;
window.renderHospitals = renderHospitals;
window.renderHospitalDetail = renderHospitalDetail;
