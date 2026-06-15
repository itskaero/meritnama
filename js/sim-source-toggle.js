'use strict';

/**
 * Data Source Toggle — switch between Unofficial (scraped) and Official (gazette) mode.
 *
 * In OFFICIAL mode:
 *   - Gale-Shapley simulation is disabled
 *   - Published merit results (gazette JSONs) are loaded and displayed
 *   - "Seat Allocation" tab shows the actual official results instead of simulation
 *   - "Where Merit Falls" shows the official slot assignments
 *
 * In UNOFFICIAL mode (default):
 *   - Everything works as before: scraped data + Gale-Shapley simulation
 */

const DS_KEY = 'mn_data_source';
const DS_MODES = { UNOFFICIAL: 'unofficial', OFFICIAL: 'official' };

let currentSource = DS_MODES.UNOFFICIAL;

function getDataSource() {
  return localStorage.getItem(DS_KEY) || DS_MODES.UNOFFICIAL;
}

function setDataSource(mode) {
  currentSource = mode;
  localStorage.setItem(DS_KEY, mode);
  updateSourceToggleUI(mode);
  onSourceChanged(mode);
}

function updateSourceToggleUI(mode) {
  const input = document.getElementById('sourceToggleInput');
  const badge = document.getElementById('sourceToggleBadge');
  const labelOff = document.getElementById('stLabelOff');
  const labelOn = document.getElementById('stLabelOn');
  if (!input) return;

  const isOfficial = mode === DS_MODES.OFFICIAL;
  input.checked = isOfficial;

  if (badge) {
    badge.textContent = isOfficial ? 'Gazette (Official)' : 'Scraped';
    badge.className = 'source-toggle-badge ' + (isOfficial ? 'official' : 'unofficial');
  }
  if (labelOff) labelOff.className = 'source-toggle-label ' + (isOfficial ? 'inactive-source' : 'active-source');
  if (labelOn) labelOn.className = 'source-toggle-label ' + (isOfficial ? 'active-source' : 'inactive-source');
}

function onSourceChanged(mode) {
  const isOfficial = mode === DS_MODES.OFFICIAL;

  // Show/hide simulation-related UI
  const simTab = document.querySelector('[data-tab="simulation"]');
  const findMeBar = document.querySelector('.sim-findme-bar');

  if (isOfficial) {
    // In official mode, hide the Gale-Shapley simulation UI
    if (simTab) simTab.textContent = '\u{1F4CB} Merit List (Official)';
    if (findMeBar) findMeBar.style.display = 'none';

    // Load official gazette data
    loadOfficialData();
  } else {
    if (simTab) simTab.textContent = '\u26A1 Seat Allocation';
    if (findMeBar) findMeBar.style.display = '';

    // Reload original simulation data
    if (typeof loadData === 'function') loadData();
  }
}

async function loadOfficialData() {
  // Try to load the latest available gazette + merit JSONs
  const inductionIds = [21, 20, 19, 18, 17];
  let loaded = false;

  for (const id of inductionIds) {
    try {
      const gazetteRes = await fetch(`../gazette_${id}.json`, { cache: 'no-store' });
      const meritRes = await fetch(`../merit_round1_${id}.json`, { cache: 'no-store' });

      if (gazetteRes.ok && meritRes.ok) {
        const gazette = await gazetteRes.json();
        const merit = await meritRes.json();

        // Store in window.SIM if available, otherwise window scope
        if (typeof SIM !== 'undefined') {
          SIM.officialGazette = gazette;
          SIM.officialMerit = merit;
          SIM.officialInductionId = id;
        }

        window.__officialData = { gazette, merit, inductionId: id };

        // Update UI status
        const statusEl = document.getElementById('dataStatus');
        if (statusEl) {
          const table5 = merit.Table5 || [];
          statusEl.textContent = `Official Ind ${id} — ${table5.length} placements`;
        }

        loaded = true;
        break;
      }
    } catch (_) {
      continue;
    }
  }

  if (!loaded) {
    const statusEl = document.getElementById('dataStatus');
    if (statusEl) statusEl.textContent = 'No official data found';
  }
}

function setupSourceToggle() {
  const input = document.getElementById('sourceToggleInput');
  if (!input) return;

  // Restore saved mode
  const savedMode = getDataSource();
  currentSource = savedMode;
  updateSourceToggleUI(savedMode);

  input.addEventListener('change', function () {
    const mode = this.checked ? DS_MODES.OFFICIAL : DS_MODES.UNOFFICIAL;
    setDataSource(mode);
  });

  // Apply initial mode after a short delay to let other init code run
  setTimeout(() => onSourceChanged(currentSource), 500);
}

// Auto-setup on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupSourceToggle);
} else {
  setupSourceToggle();
}
