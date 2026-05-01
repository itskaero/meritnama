/**
 * PRP Merit Intelligence – Chart.js Integration
 * All chart drawing functions.
 */

'use strict';

// ═══════════════════════════════════════════════════════
// CHART REGISTRY
// ═══════════════════════════════════════════════════════

const _chartInstances = {};

function getOrDestroyChart(canvasId) {
  if (_chartInstances[canvasId]) {
    _chartInstances[canvasId].destroy();
    delete _chartInstances[canvasId];
  }
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  return canvas.getContext('2d');
}

function registerChart(canvasId, instance) {
  _chartInstances[canvasId] = instance;
}

// ═══════════════════════════════════════════════════════
// PALETTE
// ═══════════════════════════════════════════════════════

const COLORS = [
  '#4db8d9', '#7c65c4', '#3ecf8e', '#e8a627',
  '#e05470', '#d44f7e', '#73cadf', '#a08ee0',
  '#34b87e', '#c7773a', '#65a8c8', '#9d85d4',
  '#2aa87e', '#c25570', '#d9a040', '#5590b8',
];

function colorAt(i, alpha = 1) {
  const hex = COLORS[i % COLORS.length];
  if (alpha < 1) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hex;
}

// ═══════════════════════════════════════════════════════
// SHARED DEFAULTS
// ═══════════════════════════════════════════════════════

const BASE_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400, easing: 'easeInOutQuart' },
  plugins: {
    legend: {
      labels: {
        font: { family: "'Segoe UI', sans-serif", size: 12 },
        color: '#7a94b4',
        boxWidth: 12,
      },
    },
    tooltip: {
      backgroundColor: 'rgba(13,20,42,0.96)',
      borderColor: 'rgba(77,184,217,0.28)',
      borderWidth: 1,
      titleFont: { size: 13, weight: 'bold' },
      titleColor: '#4db8d9',
      bodyFont: { size: 12 },
      bodyColor: '#6b84a8',
      padding: 12,
      cornerRadius: 8,
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
      border: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: '#6a80a0', font: { size: 11 } },
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
      border: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: '#6a80a0', font: { size: 11 } },
    },
  },
};

// ═══════════════════════════════════════════════════════
// 1. TREND LINE CHART (Trends tab)
// ═══════════════════════════════════════════════════════

const Charts = {

  clearChart(canvasId) {
    const ctx = getOrDestroyChart(canvasId);
    if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  },

  // ─── Trend: closing merit over years ───
  drawTrendLineChart(rows, mode = 'raw') {
    const ctx = getOrDestroyChart('trendLineChart');
    if (!ctx) return;

    const isPercentile = mode === 'percentile';
    const dataField    = isPercentile ? 'yearly_percentile' : 'yearly_merit';

    // Collect all years across all rows
    const allYears = new Set();
    for (const row of rows) {
      Object.keys(row.yearly_merit || {}).forEach(y => allYears.add(Number(y)));
    }
    const years = [...allYears].sort((a, b) => a - b);

    const datasets = rows.slice(0, 15).map((row, i) => ({
      label: rows.length === 1 ? row.specialty : row.hospital,
      data: years.map(y => row[dataField]?.[String(y)] ?? row[dataField]?.[y] ?? null),
      borderColor: colorAt(i),
      backgroundColor: colorAt(i, 0.08),
      pointBackgroundColor: colorAt(i),
      tension: 0.3,
      spanGaps: false,
      borderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 6,
    }));

    const yAxisLabel = isPercentile
      ? 'Percentile rank within year (cross-year comparable)'
      : 'Closing Merit (raw — not cross-year comparable)';

    const chart = new Chart(ctx, {
      type: 'line',
      data: { labels: years.map(String), datasets },
      options: {
        ...BASE_OPTIONS,
        plugins: {
          ...BASE_OPTIONS.plugins,
          legend: {
            ...BASE_OPTIONS.plugins.legend,
            display: datasets.length <= 10,
          },
          tooltip: {
            ...BASE_OPTIONS.plugins.tooltip,
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                if (v == null) return `${ctx.dataset.label}: N/A`;
                return isPercentile
                  ? `${ctx.dataset.label}: ${v.toFixed(1)}th percentile`
                  : `${ctx.dataset.label}: ${v.toFixed(3)}`;
              },
            },
          },
        },
        scales: {
          ...BASE_OPTIONS.scales,
          y: {
            ...BASE_OPTIONS.scales.y,
            min: isPercentile ? 0 : undefined,
            max: isPercentile ? 100 : undefined,
            title: { display: true, text: yAxisLabel, color: '#5a6e85', font: { size: 11 } },
          },
          x: {
            ...BASE_OPTIONS.scales.x,
            title: { display: true, text: 'Year', color: '#5a6e85', font: { size: 11 } },
          },
        },
      },
    });

    registerChart('trendLineChart', chart);
  },

  // ─── Distribution histogram (Predictor tab) ───
  drawDistributionChart(allMerits, userMerit) {
    const ctx = getOrDestroyChart('distributionChart');
    if (!ctx) return;

    if (!allMerits || allMerits.length === 0) return;

    // Detect if values are pct-of-max (0–100) or raw merit
    const maxVal = Math.max(...allMerits);
    const isPct  = maxVal <= 100 && maxVal > 0;
    const xLabel = isPct ? 'Avg Closing (% of Max)' : 'Closing Merit';

    const min = Math.floor(Math.min(...allMerits));
    const max = Math.ceil(maxVal);
    const bins = 20;
    const step = (max - min) / bins;

    const labels = [];
    const counts = [];
    for (let i = 0; i < bins; i++) {
      const lo = min + i * step;
      const hi = lo + step;
      labels.push(isPct ? lo.toFixed(0) + '%' : lo.toFixed(1));
      counts.push(allMerits.filter(v => v >= lo && v < hi).length);
    }

    // Find which bin userMerit falls in
    const userBin = Math.min(Math.floor((userMerit - min) / step), bins - 1);
    const bgColors = counts.map((_, i) =>
      i === userBin ? 'rgba(230, 57, 70, 0.8)' : 'rgba(15, 76, 129, 0.6)'
    );

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Hospitals',
          data: counts,
          backgroundColor: bgColors,
          borderColor: bgColors.map(c => c.replace('0.6', '1').replace('0.8', '1')),
          borderWidth: 1,
        }],
      },
      options: {
        ...BASE_OPTIONS,
        plugins: {
          ...BASE_OPTIONS.plugins,
          legend: { display: false },
          tooltip: {
            ...BASE_OPTIONS.plugins.tooltip,
            callbacks: {
              title: ctx => isPct ? `~${ctx[0].label} of max` : `Merit ≈ ${ctx[0].label}`,
              label: ctx => `${ctx.parsed.y} hospitals`,
            },
          },
        },
        scales: {
          ...BASE_OPTIONS.scales,
          x: { ...BASE_OPTIONS.scales.x, title: { display: true, text: xLabel, color: '#5a6e85' } },
          y: { ...BASE_OPTIONS.scales.y, title: { display: true, text: 'Count', color: '#5a6e85' } },
        },
      },
    });
    registerChart('distributionChart', chart);
  },

  // ─── Volatility scatter/bar (Trends tab) ───
  drawVolatilityChart(rows) {
    const ctx = getOrDestroyChart('volatilityChart');
    if (!ctx) return;

    const data = rows
      .filter(r => r.stddev > 0)
      .sort((a, b) => b.stddev - a.stddev)
      .slice(0, 20);

    const labels = data.map(r => r.specialty.length > 18 ? r.specialty.slice(0, 18) + '…' : r.specialty);
    const values = data.map(r => r.stddev);
    const colors = values.map(v =>
      v >= 3 ? 'rgba(230,57,70,0.7)' : v >= 1 ? 'rgba(244,162,97,0.7)' : 'rgba(42,157,143,0.7)'
    );

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Std Dev',
          data: values,
          backgroundColor: colors,
          borderColor: colors.map(c => c.replace('0.7', '1')),
          borderWidth: 1,
        }],
      },
      options: {
        ...BASE_OPTIONS,
        indexAxis: 'y',
        plugins: {
          ...BASE_OPTIONS.plugins,
          legend: { display: false },
          tooltip: {
            ...BASE_OPTIONS.plugins.tooltip,
            callbacks: {
              label: ctx => `σ = ${ctx.parsed.x.toFixed(3)}`,
            },
          },
        },
        scales: {
          x: { ...BASE_OPTIONS.scales.x, title: { display: true, text: 'Std Dev (σ)', color: '#5a6e85' } },
          y: { ...BASE_OPTIONS.scales.y, ticks: { ...BASE_OPTIONS.scales.y.ticks, font: { size: 10 } } },
        },
      },
    });
    registerChart('volatilityChart', chart);
  },

  // ─── Specialty ranking bar chart (Rankings tab) ───
  drawRankingBarChart(entries) {
    const ctx = getOrDestroyChart('rankingBarChart');
    if (!ctx) return;

    const labels = entries.map(e =>
      e.specialty.length > 22 ? e.specialty.slice(0, 22) + '…' : e.specialty
    );
    const avgValues    = entries.map(e => e.avg_closing_merit);
    const latestValues = entries.map(e => e.latest_avg_closing);

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Avg Closing Merit',
            data: avgValues,
            backgroundColor: 'rgba(15,76,129,0.7)',
            borderColor: '#0f4c81',
            borderWidth: 1,
          },
          {
            label: 'Latest Avg Merit',
            data: latestValues,
            backgroundColor: 'rgba(0,168,150,0.7)',
            borderColor: '#00a896',
            borderWidth: 1,
          },
        ],
      },
      options: {
        ...BASE_OPTIONS,
        plugins: {
          ...BASE_OPTIONS.plugins,
          tooltip: {
            ...BASE_OPTIONS.plugins.tooltip,
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)}`,
            },
          },
        },
        scales: {
          x: {
            ...BASE_OPTIONS.scales.x,
            ticks: { ...BASE_OPTIONS.scales.x.ticks, maxRotation: 60, font: { size: 10 } },
          },
          y: { ...BASE_OPTIONS.scales.y, title: { display: true, text: 'Closing Merit', color: '#5a6e85' } },
        },
      },
    });
    registerChart('rankingBarChart', chart);
  },

  // ─── Specialty modal trend chart ───
  drawSpecTrendChart(hospitalRows, specialty, displayMode = 'pct', yearFilter = null) {
    const ctx = getOrDestroyChart('specTrendChart');
    if (!ctx) return;

    const allYears = new Set();
    hospitalRows.forEach(r => Object.keys(r.yearly_merit || {}).forEach(y => allYears.add(Number(y))));
    let years = [...allYears].sort((a, b) => a - b);
    if (yearFilter) years = years.filter(y => y === yearFilter);

    const isPct = displayMode === 'pct';
    const yLabel = isPct ? '% of Max' : 'Closing Merit';

    const datasets = hospitalRows.slice(0, 12).map((row, i) => ({
      label: row.hospital.length > 30 ? row.hospital.slice(0, 30) + '…' : row.hospital,
      data: years.map(y => {
        const raw = row.yearly_merit?.[y] ?? null;
        if (raw == null) return null;
        if (isPct) {
          const max = YEAR_TOTAL_MAX[y];
          return max ? parseFloat(((raw / max) * 100).toFixed(2)) : raw;
        }
        return raw;
      }),
      borderColor: colorAt(i),
      backgroundColor: colorAt(i, 0.07),
      tension: 0.3,
      spanGaps: false,
      borderWidth: 2,
      pointRadius: 3,
    }));

    const chart = new Chart(ctx, {
      type: 'line',
      data: { labels: years.map(String), datasets },
      options: {
        ...BASE_OPTIONS,
        plugins: {
          ...BASE_OPTIONS.plugins,
          legend: { ...BASE_OPTIONS.plugins.legend, display: hospitalRows.length <= 8, position: 'bottom' },
          title: {
            display: true,
            text: `${isPct ? '% of Max' : 'Closing Merit'} Trend – ${specialty}`,
            color: '#0f4c81', font: { size: 13, weight: 'bold' },
          },
          tooltip: {
            ...BASE_OPTIONS.plugins.tooltip,
            callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y != null ? c.parsed.y.toFixed(1) + (isPct ? '%' : '') : '—'}` },
          },
        },
        scales: {
          ...BASE_OPTIONS.scales,
          y: { ...BASE_OPTIONS.scales.y, title: { display: true, text: yLabel, color: '#5a6e85' } },
        },
      },
    });
    registerChart('specTrendChart', chart);
  },

  // ─── Hospital modal chart ───
  drawHospSpecChart(rows, hospital, displayMode = 'pct', yearFilter = null) {
    const ctx = getOrDestroyChart('hospSpecChart');
    if (!ctx) return;

    const isPct = displayMode === 'pct';
    const sorted = [...rows].sort((a, b) => {
      const av = isPct ? (b.avg_pct_of_max ?? b.avg_closing_merit) : b.avg_closing_merit;
      const bv = isPct ? (a.avg_pct_of_max ?? a.avg_closing_merit) : a.avg_closing_merit;
      return av - bv;
    }).slice(0, 20);

    const labels = sorted.map(r =>
      r.specialty.length > 20 ? r.specialty.slice(0, 20) + '…' : r.specialty
    );

    const getVal = (r, yr) => {
      if (yr) {
        const raw = r.yearly_merit?.[String(yr)] ?? null;
        if (raw == null) return null;
        return isPct ? (YEAR_TOTAL_MAX[yr] ? (raw / YEAR_TOTAL_MAX[yr]) * 100 : raw) : raw;
      }
      return isPct ? (r.avg_pct_of_max ?? r.avg_closing_merit) : r.avg_closing_merit;
    };
    const getLatest = r => isPct ? (r.latest_pct_of_max ?? r.latest_merit) : r.latest_merit;

    const yLabel = isPct ? '% of Max' : 'Closing Merit';

    const datasets = yearFilter
      ? [{
          label: `${yearFilter} ${yLabel}`,
          data: sorted.map(r => getVal(r, yearFilter)),
          backgroundColor: sorted.map((_, i) => colorAt(i, 0.7)),
          borderColor:     sorted.map((_, i) => colorAt(i)),
          borderWidth: 1,
        }]
      : [
          {
            label: `Avg ${yLabel}`,
            data: sorted.map(r => getVal(r)),
            backgroundColor: sorted.map((_, i) => colorAt(i, 0.7)),
            borderColor:     sorted.map((_, i) => colorAt(i)),
            borderWidth: 1,
          },
          {
            label: `Latest ${yLabel}`,
            data: sorted.map(r => getLatest(r)),
            backgroundColor: sorted.map((_, i) => colorAt(i, 0.3)),
            borderColor:     sorted.map((_, i) => colorAt(i, 0.6)),
            borderWidth: 1,
          },
        ];

    const chart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        ...BASE_OPTIONS,
        plugins: {
          ...BASE_OPTIONS.plugins,
          title: {
            display: true,
            text: `Specialties at ${hospital.length > 40 ? hospital.slice(0, 40) + '…' : hospital}`,
            color: '#0f4c81', font: { size: 13, weight: 'bold' },
          },
          tooltip: {
            ...BASE_OPTIONS.plugins.tooltip,
            callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y != null ? c.parsed.y.toFixed(1) + (isPct ? '%' : '') : '—'}` },
          },
        },
        scales: {
          x: { ...BASE_OPTIONS.scales.x, ticks: { ...BASE_OPTIONS.scales.x.ticks, maxRotation: 50, font: { size: 10 } } },
          y: { ...BASE_OPTIONS.scales.y, title: { display: true, text: yLabel, color: '#5a6e85' } },
        },
      },
    });
    registerChart('hospSpecChart', chart);
  },

  // ─── Drill-down: single row yearly trend (used by both specialty & hospital modals) ───
  drawDrillYearlyChart(canvasId, row, displayMode = 'pct') {
    const ctx = getOrDestroyChart(canvasId);
    if (!ctx) return;

    const isPct = displayMode === 'pct';
    const yearlyMerit = row.yearly_merit || {};
    const yearlySeats = row.yearly_seats || {};
    const years = Object.keys(yearlyMerit).map(Number).sort((a, b) => a - b);

    const meritData = years.map(y => {
      const raw = yearlyMerit[y];
      if (isPct) {
        const max = YEAR_TOTAL_MAX[y];
        return max ? parseFloat(((raw / max) * 100).toFixed(2)) : raw;
      }
      return raw;
    });

    const seatsData = years.map(y => yearlySeats[y] ?? null);
    const yLabel = isPct ? '% of Max' : 'Closing Merit';

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: years.map(String),
        datasets: [
          {
            label: yLabel,
            data: meritData,
            backgroundColor: meritData.map((_, i) => colorAt(i, 0.65)),
            borderColor:     meritData.map((_, i) => colorAt(i)),
            borderWidth: 1,
            yAxisID: 'yMerit',
          },
          {
            label: 'Seats',
            data: seatsData,
            type: 'line',
            borderColor: 'rgba(233,196,106,0.9)',
            backgroundColor: 'rgba(233,196,106,0.15)',
            borderWidth: 2,
            pointRadius: 4,
            fill: false,
            tension: 0.2,
            yAxisID: 'ySeats',
          },
        ],
      },
      options: {
        ...BASE_OPTIONS,
        plugins: {
          ...BASE_OPTIONS.plugins,
          legend: { ...BASE_OPTIONS.plugins.legend, display: true, position: 'top' },
          tooltip: {
            ...BASE_OPTIONS.plugins.tooltip,
            callbacks: {
              label: c => c.datasetIndex === 0
                ? `${yLabel}: ${c.parsed.y != null ? c.parsed.y.toFixed(1) + (isPct ? '%' : '') : '—'}`
                : `Seats: ${c.parsed.y ?? '—'}`,
            },
          },
        },
        scales: {
          x: { ...BASE_OPTIONS.scales.x },
          yMerit: {
            ...BASE_OPTIONS.scales.y,
            position: 'left',
            title: { display: true, text: yLabel, color: '#5a6e85' },
          },
          ySeats: {
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: 'rgba(233,196,106,0.8)', font: { size: 10 } },
            title: { display: true, text: 'Seats', color: 'rgba(233,196,106,0.8)' },
          },
        },
      },
    });
    registerChart(canvasId, chart);
  },

  // ─── Strategy chart ───
  drawStrategyChart(userMerit, results) {
    const ctx = getOrDestroyChart('strategyChart');
    if (!ctx) return;

    // Use % of max if available (centile mode), else fall back to raw closing merit
    const usesPct = results[0]?.used_pct_of_max != null;
    const sorted = [...results].sort((a, b) => {
      const av = usesPct ? (b.used_pct_of_max ?? 0) : b.used_closing_merit;
      const bv = usesPct ? (a.used_pct_of_max ?? 0) : a.used_closing_merit;
      return av - bv;
    }).slice(0, 35);
    const labels = sorted.map(r =>
      r.specialty.length > 18 ? r.specialty.slice(0, 18) + '…' : r.specialty
    );
    const values = sorted.map(r => usesPct ? (r.used_pct_of_max ?? r.avg_pct_of_max) : r.used_closing_merit);
    const bgColors = sorted.map(r => {
      if (r.outcome === 'likely')     return 'rgba(42,157,143,0.7)';
      if (r.outcome === 'borderline') return 'rgba(233,196,106,0.7)';
      return 'rgba(231,111,81,0.7)';
    });

    const yLabel = usesPct ? '% of Max' : 'Merit Score';
    const valFmt = (v) => usesPct ? v.toFixed(1) + '%' : v.toFixed(2);

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: usesPct ? 'Avg Closing (% of Max)' : 'Closing Merit',
            data: values,
            backgroundColor: bgColors,
            borderColor: bgColors.map(c => c.replace('0.7', '1')),
            borderWidth: 1,
          },
          {
            label: usesPct ? 'Your Score (% of Max)' : 'Your Merit',
            data: labels.map(() => userMerit),
            type: 'line',
            borderColor: '#e63946',
            borderWidth: 2.5,
            borderDash: [8, 4],
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
        ],
      },
      options: {
        ...BASE_OPTIONS,
        plugins: {
          ...BASE_OPTIONS.plugins,
          legend: { ...BASE_OPTIONS.plugins.legend, display: true },
          tooltip: {
            ...BASE_OPTIONS.plugins.tooltip,
            callbacks: {
              label: ctx => {
                if (ctx.datasetIndex === 1) return `Your Score: ${valFmt(userMerit)}`;
                return `Avg Closing: ${valFmt(ctx.parsed.y)}`;
              },
            },
          },
        },
        scales: {
          x: { ...BASE_OPTIONS.scales.x, ticks: { ...BASE_OPTIONS.scales.x.ticks, maxRotation: 60, font: { size: 10 } } },
          y: { ...BASE_OPTIONS.scales.y, title: { display: true, text: yLabel, color: '#5a6e85' } },
        },
      },
    });
    registerChart('strategyChart', chart);
  },

};
