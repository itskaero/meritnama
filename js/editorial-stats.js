'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Editorial statistical tests — same embed pattern as js/editorial-charts.js.
// Authors embed a placeholder div in article markdown and this scans for it
// after render, computing a real (if simplified) statistical test against
// data/flat_lookup.json and rendering a plain-English result card.
//
//   <div class="ed-stat-embed" data-stat="trend"
//        data-specialty="Cardiology" data-program="FCPS" data-quota="Punjab"
//        data-hospital="Jinnah Hospital, Lahore"></div>
//
//   <div class="ed-stat-embed" data-stat="correlation"
//        data-specialty-a="Cardiology" data-specialty-b="Neurology"
//        data-program="FCPS" data-quota="Punjab"></div>
//
// "trend" omits data-hospital the same way editorial-charts.js does —
// aggregates across every hospital for that specialty instead.
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

  // Two-tailed 5% critical t-values by degrees of freedom — a standard
  // textbook lookup table, used instead of computing an exact p-value via
  // the incomplete beta function (overkill for an editorial significance
  // note). df > 30 falls back to the normal approximation (1.96).
  var T_CRIT_05 = [null, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  function criticalT(df) {
    if (df < 1) return null;
    if (df <= 30) return T_CRIT_05[df];
    return 1.96;
  }

  function mean(arr) { return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length; }

  // Simple linear regression of y over x, with a significance test on the
  // slope (does merit/percentile move consistently over time, or is any
  // apparent trend indistinguishable from noise at this sample size?).
  function linearRegressionTrend(xs, ys) {
    var n = xs.length;
    if (n < 3) return null; // need at least 3 points for a meaningful df
    var xbar = mean(xs), ybar = mean(ys);
    var sxx = 0, sxy = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = xs[i] - xbar, dy = ys[i] - ybar;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (sxx === 0) return null;
    var slope = sxy / sxx;
    var intercept = ybar - slope * xbar;
    var sse = 0;
    for (i = 0; i < n; i++) {
      var pred = intercept + slope * xs[i];
      sse += (ys[i] - pred) * (ys[i] - pred);
    }
    var r2 = syy === 0 ? 0 : 1 - sse / syy;
    var df = n - 2;
    var seSlope = Math.sqrt(sse / df) / Math.sqrt(sxx);
    // A perfect fit (sse=0) makes seSlope 0 and t mathematically infinite —
    // real merit data is never this clean, but guard the edge case (e.g. a
    // specialty with only 3 data points that happen to be collinear) so the
    // result stays a finite, displayable number instead of "Infinity".
    var t = seSlope === 0 ? (slope === 0 ? 0 : (slope > 0 ? 999 : -999)) : slope / seSlope;
    var crit = criticalT(df);
    var significant = crit != null && Math.abs(t) >= crit;
    return { n: n, slope: slope, r2: r2, t: t, df: df, significant: significant };
  }

  function pearsonCorrelation(a, b) {
    var n = Math.min(a.length, b.length);
    if (n < 3) return null;
    a = a.slice(0, n); b = b.slice(0, n);
    var abar = mean(a), bbar = mean(b);
    var sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < n; i++) {
      var da = a[i] - abar, db = b[i] - bbar;
      sab += da * db; saa += da * da; sbb += db * db;
    }
    if (saa === 0 || sbb === 0) return null;
    return { n: n, r: sab / Math.sqrt(saa * sbb) };
  }

  function strengthLabel(r) {
    var abs = Math.abs(r);
    if (abs >= 0.7) return 'strong';
    if (abs >= 0.4) return 'moderate';
    if (abs >= 0.2) return 'weak';
    return 'negligible';
  }

  function findRows(lookup, specialty, hospital, program, quota) {
    return lookup.filter(function (r) {
      return r.specialty.toLowerCase() === specialty.toLowerCase() &&
        (!program || r.program === program) &&
        (!quota || r.quota === quota) &&
        (!hospital || r.hospital.toLowerCase() === hospital.toLowerCase());
    });
  }

  function seriesFromRows(rows) {
    // Average yearly_percentile across matched rows (same aggregation as editorial-charts.js).
    var byYear = {}, counts = {};
    rows.forEach(function (r) {
      Object.entries(r.yearly_percentile || {}).forEach(function (entry) {
        var y = entry[0], v = entry[1];
        if (v == null) return;
        byYear[y] = (byYear[y] || 0) + v;
        counts[y] = (counts[y] || 0) + 1;
      });
    });
    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    var values = years.map(function (y) { return byYear[y] / counts[y]; });
    return { years: years, values: values };
  }

  function renderTrendCard(el, lookup) {
    var specialty = el.dataset.specialty || '';
    var hospital = el.dataset.hospital || '';
    var program = el.dataset.program || '';
    var quota = el.dataset.quota || '';
    if (!specialty) return;

    var rows = findRows(lookup, specialty, hospital, program, quota);
    if (!rows.length) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;text-align:center;padding:1rem;">No historical data found for "' + esc(specialty) + '"' + (hospital ? ' at ' + esc(hospital) : '') + '.</p>';
      return;
    }
    var series = seriesFromRows(hospital ? [rows[0]] : rows);
    var result = linearRegressionTrend(series.years, series.values);
    var label = esc(specialty) + (hospital ? ' — ' + esc(hospital) : ' (all hospitals)');

    if (!result) {
      el.innerHTML = statCard('&#128202;', label, 'Not enough years of data (' + series.years.length + ') for a reliable trend test — need at least 3.');
      return;
    }

    var dir = result.slope > 0 ? 'rising' : result.slope < 0 ? 'falling' : 'flat';
    var icon = dir === 'rising' ? '&#128200;' : dir === 'falling' ? '&#128201;' : '&#8594;';
    var verdict = result.significant
      ? 'a <strong>statistically significant ' + dir + ' trend</strong> (p&lt;0.05)'
      : 'no statistically significant trend — apparent movement is within normal year-to-year noise';
    var detail = 'Slope: ' + result.slope.toFixed(2) + ' percentile pts/year &middot; R&sup2; = ' + result.r2.toFixed(2) +
      ' &middot; t(' + result.df + ') = ' + result.t.toFixed(2) + ' &middot; n = ' + result.n + ' years';
    el.innerHTML = statCard(icon, label, 'This slot shows ' + verdict + '.<br><span style="font-size:0.74rem;opacity:0.75;">' + detail + '</span>');
  }

  function renderCorrelationCard(el, lookup) {
    var specA = el.dataset.specialtyA || '';
    var specB = el.dataset.specialtyB || '';
    var program = el.dataset.program || '';
    var quota = el.dataset.quota || '';
    if (!specA || !specB) return;

    var rowsA = findRows(lookup, specA, '', program, quota);
    var rowsB = findRows(lookup, specB, '', program, quota);
    if (!rowsA.length || !rowsB.length) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;text-align:center;padding:1rem;">No historical data found for "' + esc(!rowsA.length ? specA : specB) + '".</p>';
      return;
    }
    var seriesA = seriesFromRows(rowsA), seriesB = seriesFromRows(rowsB);
    // Align by shared years only.
    var yearsA = {}; seriesA.years.forEach(function (y, i) { yearsA[y] = seriesA.values[i]; });
    var sharedYears = seriesB.years.filter(function (y) { return yearsA[y] != null; });
    var alignedA = sharedYears.map(function (y) { return yearsA[y]; });
    var alignedB = sharedYears.map(function (y) {
      var idx = seriesB.years.indexOf(y);
      return seriesB.values[idx];
    });

    var result = pearsonCorrelation(alignedA, alignedB);
    var label = esc(specA) + ' vs ' + esc(specB);
    if (!result) {
      el.innerHTML = statCard('&#128279;', label, 'Not enough overlapping years (' + sharedYears.length + ') for a reliable correlation — need at least 3.');
      return;
    }
    var strength = strengthLabel(result.r);
    var direction = result.r > 0 ? 'positive' : 'negative';
    var verdict = strength === 'negligible'
      ? 'no meaningful relationship — these move independently'
      : 'a <strong>' + strength + ' ' + direction + ' correlation</strong>' + (strength !== 'negligible' && Math.abs(result.r) >= 0.4 ? ' — their cutoffs tend to move together' : '');
    var detail = 'r = ' + result.r.toFixed(2) + ' &middot; n = ' + result.n + ' shared years';
    el.innerHTML = statCard('&#128279;', label, 'These two slots show ' + verdict + '.<br><span style="font-size:0.74rem;opacity:0.75;">' + detail + '</span>');
  }

  function statCard(icon, label, body) {
    return '<div class="ed-stat-card" style="border:1px solid var(--border,#2a3a52);border-radius:10px;padding:1rem 1.2rem;background:var(--bg-card,#1a2236);">' +
      '<div style="font-weight:700;margin-bottom:0.4rem;">' + icon + ' ' + label + '</div>' +
      '<div style="font-size:0.85rem;color:var(--text,#e0e6ef);line-height:1.6;">' + body + '</div>' +
      '</div>';
  }

  function render(containerSelector) {
    var embeds = document.querySelectorAll(containerSelector + ' .ed-stat-embed');
    if (!embeds.length) return Promise.resolve();
    return fetchFlatLookup().then(function (lookup) {
      embeds.forEach(function (el) {
        el.className = 'ed-stat-embed-rendered';
        var type = el.dataset.stat || 'trend';
        if (type === 'trend') renderTrendCard(el, lookup);
        else if (type === 'correlation') renderCorrelationCard(el, lookup);
      });
    }).catch(function (e) { console.warn('Editorial stats data unavailable:', e); });
  }

  window.EdStats = { render: render, linearRegressionTrend: linearRegressionTrend, pearsonCorrelation: pearsonCorrelation };
})();
