'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Editorial data charts — shared by editorial.js (published article view)
// and editorial-admin.js (live preview while editing). marked.parse()
// passes raw HTML straight through, so authors embed a placeholder div
// directly in the markdown body and this scans for it after render:
//
//   <div class="ed-chart-embed" data-chart="trend"
//        data-specialty="Cardiology" data-program="FCPS" data-quota="Punjab"
//        data-hospital="Jinnah Hospital, Lahore"></div>
//
// data-hospital is optional — omit it to show the specialty's average
// trend aggregated across every hospital instead of one specific slot.
// ═══════════════════════════════════════════════════════════════════════

(function () {
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  var _flatLookupCache = null;
  function fetchFlatLookup() {
    if (_flatLookupCache) return Promise.resolve(_flatLookupCache);
    return fetch('data/flat_lookup.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { _flatLookupCache = data; return data; });
  }

  function aggregateSpecialtyRow(rows, specialty) {
    var yearly_merit = {}, yearly_percentile = {}, counts = {};
    rows.forEach(function (r) {
      Object.entries(r.yearly_merit || {}).forEach(function (entry) {
        var y = entry[0], v = entry[1];
        if (v == null) return;
        yearly_merit[y] = (yearly_merit[y] || 0) + v;
        counts[y] = (counts[y] || 0) + 1;
      });
      Object.entries(r.yearly_percentile || {}).forEach(function (entry) {
        var y = entry[0], v = entry[1];
        if (v == null) return;
        yearly_percentile[y] = (yearly_percentile[y] || 0) + v;
      });
    });
    Object.keys(yearly_merit).forEach(function (y) { yearly_merit[y] /= counts[y]; });
    Object.keys(yearly_percentile).forEach(function (y) { yearly_percentile[y] /= counts[y]; });
    return { specialty: specialty, hospital: 'Average across ' + rows.length + ' hospitals', yearly_merit: yearly_merit, yearly_percentile: yearly_percentile };
  }

  // containerSelector scopes which embeds to render (article view vs admin preview).
  function render(containerSelector) {
    var embeds = document.querySelectorAll(containerSelector + ' .ed-chart-embed');
    if (!embeds.length || typeof Charts === 'undefined') return Promise.resolve();

    return fetchFlatLookup().then(function (lookup) {
      embeds.forEach(function (el, i) {
        var type = el.dataset.chart || 'trend';
        var specialty = el.dataset.specialty || '';
        var hospital = el.dataset.hospital || '';
        var program = el.dataset.program || '';
        var quota = el.dataset.quota || '';
        if (!specialty) return;

        var matches = lookup.filter(function (r) {
          return r.specialty.toLowerCase() === specialty.toLowerCase() &&
            (!program || r.program === program) &&
            (!quota || r.quota === quota) &&
            (!hospital || r.hospital.toLowerCase() === hospital.toLowerCase());
        });
        if (!matches.length) {
          el.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;text-align:center;padding:1rem;">No historical data found for "' + esc(specialty) + '"' + (hospital ? ' at ' + esc(hospital) : '') + '.</p>';
          return;
        }

        var row = hospital ? matches[0] : aggregateSpecialtyRow(matches, specialty);
        var canvasId = 'edChart' + i + '_' + Math.random().toString(36).slice(2, 8);
        el.className = 'ed-chart-embed-rendered';
        el.innerHTML =
          '<div style="height:280px;"><canvas id="' + canvasId + '"></canvas></div>' +
          '<p style="color:var(--text-muted);font-size:0.76rem;text-align:center;margin-top:0.5rem;">' +
            esc(specialty) + (hospital ? ' — ' + esc(hospital) : ' (average across ' + matches.length + ' hospitals)') +
            (program ? ' · ' + esc(program) : '') + (quota ? ' · ' + esc(quota) : '') +
          '</p>';

        if (type === 'trend') {
          Charts.drawTrendLineChart([row], 'percentile', canvasId);
        }
      });
    }).catch(function (e) { console.warn('Editorial chart data unavailable:', e); });
  }

  window.EdCharts = { render: render };
})();
