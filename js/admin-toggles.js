'use strict';

/**
 * Admin Toggles — Watermark and Simulation Mode controls for MeritNama.
 *
 * Adds two toggle sections to the Broadcast & Config tab:
 * 1. Watermark toggle → notifications/watermark_config
 * 2. Simulation Mode toggle → notifications/simulation_mode
 */

(function () {

  let db;
  let watermarkEnabled = true;
  let simMode = 'seat-allocation';

  // ── Init: wait for admin page to be ready ──

  function init() {
    if (typeof firebase === 'undefined') { setTimeout(init, 500); return; }
    try {
      db = firebase.firestore();
    } catch (_) {
      setTimeout(init, 500);
      return;
    }
    // Check every 500ms until the broadcast tab exists
    const check = setInterval(() => {
      const container = document.querySelector('#tab-broadcast .dash-content') ||
                        document.querySelector('#tab-broadcast');
      if (container) {
        clearInterval(check);
        injectUI(container);
        loadConfigs();
      }
    }, 500);
  }

  // ── Inject UI sections ──

  function injectUI(container) {
    const frag = document.createDocumentFragment();
    frag.appendChild(buildSection({
      id: 'watermark-config',
      icon: '\u{1F6A8}',
      title: 'Watermark Overlay',
      desc: 'Controls the screenshot-deterrence watermark overlay on the simulation page. Stored in <code>notifications/watermark_config</code>.',
      html: `
        <label class="toggle-row" style="margin-bottom:0.75rem;">
          <input type="checkbox" id="watermarkEnabled" checked />
          <span style="font-weight:600;">Enable watermark overlay</span>
          <span style="font-size:0.78rem;color:var(--text-muted);margin-left:0.5rem;">(shown on simulation page to deter screenshot sharing)</span>
        </label>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <button id="watermarkSaveBtn" class="btn-primary" style="padding:8px 20px;background:var(--accent);color:#0a0e1a;border:none;border-radius:8px;font-weight:700;cursor:pointer;">Save Watermark Setting</button>
          <span id="watermarkStatus" style="font-size:0.8rem;color:var(--text-muted);align-self:center;"></span>
        </div>`,
    }));

    frag.appendChild(buildSection({
      id: 'sim-mode-config',
      icon: '\u{2699}\u{FE0F}',
      title: 'Simulation Page Mode',
      desc: 'Controls which view the Simulation Portal shows. Stored in <code>notifications/simulation_mode</code>.',
      html: `
        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:0.75rem;">
          <label class="toggle-row" style="gap:0.75rem;">
            <input type="radio" name="simMode" value="seat-allocation" checked />
            <div>
              <div style="font-weight:600;">Seat Allocation</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">Full Gale-Shapley simulation with candidate pool, preferences, and matching algorithm.</div>
            </div>
          </label>
          <label class="toggle-row" style="gap:0.75rem;">
            <input type="radio" name="simMode" value="merit-list" />
            <div>
              <div style="font-weight:600;">Merit List</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">Table-based merit list view with candidate details, consent management, and re-run capability.</div>
            </div>
          </label>
        </div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <button id="simModeSaveBtn" class="btn-primary" style="padding:8px 20px;background:var(--accent);color:#0a0e1a;border:none;border-radius:8px;font-weight:700;cursor:pointer;">Save Mode</button>
          <button id="simModeReloadBtn" style="padding:8px 16px;background:rgba(77,184,217,0.12);color:var(--neon-cyan);border:1px solid rgba(77,184,217,0.3);border-radius:8px;cursor:pointer;">Reload Config</button>
          <span id="simModeStatus" style="font-size:0.8rem;color:var(--text-muted);align-self:center;"></span>
        </div>`,
    }));

    frag.appendChild(buildSection({
      id: 'cand-verification-config',
      icon: '\u{1F50D}',
      title: 'Candidate Verification Data',
      desc: 'Controls whether grievance verification records appear in the candidate detail modal (candidate pool tab). Stored in <code>notifications/candidate_verification_config</code>.',
      html: `
        <label class="toggle-row" style="margin-bottom:0.75rem;">
          <input type="checkbox" id="candVerifEnabled" checked />
          <span style="font-weight:600;">Show grievance verification data in candidate modal</span>
          <span style="font-size:0.78rem;color:var(--text-muted);margin-left:0.5rem;">(when enabled, verification records from grievance_verification.json appear when viewing a candidate in the pool tab)</span>
        </label>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <button id="candVerifSaveBtn" class="btn-primary" style="padding:8px 20px;background:var(--accent);color:#0a0e1a;border:none;border-radius:8px;font-weight:700;cursor:pointer;">Save Verification Setting</button>
          <span id="candVerifStatus" style="font-size:0.8rem;color:var(--text-muted);align-self:center;"></span>
        </div>`,
    }));

    // Insert before the last child (usually the script area)
    container.appendChild(frag);

    // Wire events after DOM insertion
    setTimeout(() => {
      const watermarkBtn = document.getElementById('watermarkSaveBtn');
      if (watermarkBtn) watermarkBtn.addEventListener('click', saveWatermarkConfig);

      const simSaveBtn = document.getElementById('simModeSaveBtn');
      if (simSaveBtn) simSaveBtn.addEventListener('click', saveSimModeConfig);

      const simReloadBtn = document.getElementById('simModeReloadBtn');
      if (simReloadBtn) simReloadBtn.addEventListener('click', loadSimModeConfig);

      const candVerifBtn = document.getElementById('candVerifSaveBtn');
      if (candVerifBtn) candVerifBtn.addEventListener('click', saveCandVerifConfig);
    }, 100);
  }

  function buildSection(opts) {
    const details = document.createElement('details');
    details.className = 'broadcast-section';
    details.open = true;
    details.innerHTML = `
      <summary>${opts.icon} ${opts.title}</summary>
      <div class="broadcast-section-body">
        <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 1rem;max-width:760px;">
          ${opts.desc}
        </p>
        ${opts.html}
      </div>`;
    return details;
  }

  // ── Watermark Config ──

  function setWatermarkStatus(msg, color) {
    const el = document.getElementById('watermarkStatus');
    if (el) { el.textContent = msg; if (color) el.style.color = color; }
  }

  async function loadWatermarkConfig() {
    try {
      const snap = await db.collection('notifications').doc('watermark_config').get();
      if (snap.exists) {
        watermarkEnabled = snap.data().enabled !== false;
      } else {
        watermarkEnabled = true;
      }
      const cb = document.getElementById('watermarkEnabled');
      if (cb) cb.checked = watermarkEnabled;
      setWatermarkStatus('Loaded watermark config.', 'var(--neon-green)');
    } catch (e) {
      console.error('[AdminToggles] Error loading watermark config:', e);
      setWatermarkStatus('Error loading: ' + e.message, 'var(--neon-pink)');
    }
  }

  async function saveWatermarkConfig() {
    const cb = document.getElementById('watermarkEnabled');
    if (!cb) return;
    watermarkEnabled = cb.checked;
    setWatermarkStatus('Saving...');
    try {
      await db.collection('notifications').doc('watermark_config').set({ enabled: watermarkEnabled }, { merge: true });
      setWatermarkStatus('Watermark config saved. Simulation page updates live.', 'var(--neon-green)');
    } catch (e) {
      setWatermarkStatus('Error saving: ' + e.message, 'var(--neon-pink)');
    }
  }

  // ── Simulation Mode Config ──

  function setSimModeStatus(msg, color) {
    const el = document.getElementById('simModeStatus');
    if (el) { el.textContent = msg; if (color) el.style.color = color; }
  }

  async function loadSimModeConfig() {
    try {
      const snap = await db.collection('notifications').doc('simulation_mode').get();
      if (snap.exists) {
        simMode = snap.data().mode || 'seat-allocation';
      } else {
        simMode = 'seat-allocation';
      }
      const radios = document.querySelectorAll('input[name="simMode"]');
      radios.forEach(r => { r.checked = r.value === simMode; });
      setSimModeStatus('Loaded simulation mode: ' + simMode, 'var(--neon-green)');
    } catch (e) {
      console.error('[AdminToggles] Error loading sim mode:', e);
      setSimModeStatus('Error loading: ' + e.message, 'var(--neon-pink)');
    }
  }

  async function saveSimModeConfig() {
    const selected = document.querySelector('input[name="simMode"]:checked');
    if (!selected) return;
    simMode = selected.value;
    setSimModeStatus('Saving...');
    try {
      await db.collection('notifications').doc('simulation_mode').set({ mode: simMode }, { merge: true });
      setSimModeStatus('Simulation mode saved to notifications/simulation_mode. Users must refresh simulation page.', 'var(--neon-green)');
    } catch (e) {
      setSimModeStatus('Error saving: ' + e.message, 'var(--neon-pink)');
    }
  }

  // ── Candidate Verification Config ──

  function setCandVerifStatus(msg, color) {
    const el = document.getElementById('candVerifStatus');
    if (el) { el.textContent = msg; if (color) el.style.color = color; }
  }

  async function loadCandVerifConfig() {
    try {
      const snap = await db.collection('notifications').doc('candidate_verification_config').get();
      const enabled = snap.exists ? snap.data().enabled !== false : true;
      const cb = document.getElementById('candVerifEnabled');
      if (cb) cb.checked = enabled;
      setCandVerifStatus('Loaded verification config.', 'var(--neon-green)');
    } catch (e) {
      console.error('[AdminToggles] Error loading verification config:', e);
      setCandVerifStatus('Error loading: ' + e.message, 'var(--neon-pink)');
    }
  }

  async function saveCandVerifConfig() {
    const cb = document.getElementById('candVerifEnabled');
    if (!cb) return;
    setCandVerifStatus('Saving...');
    try {
      await db.collection('notifications').doc('candidate_verification_config').set({ enabled: cb.checked }, { merge: true });
      setCandVerifStatus('Verification config saved. Candidate pool updates live.', 'var(--neon-green)');
    } catch (e) {
      setCandVerifStatus('Error saving: ' + e.message, 'var(--neon-pink)');
    }
  }

  function loadConfigs() {
    loadWatermarkConfig();
    loadSimModeConfig();
    loadCandVerifConfig();
  }

  // ── Start ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
