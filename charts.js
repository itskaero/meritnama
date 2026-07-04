/**
 * MeritNama – Chart.js Integration
 * Theme-aware chart rendering engine using CSS variables.
 */

'use strict';

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
// DYNAMIC THEME ACCESSOR
// ═══════════════════════════════════════════════════════

function getThemeColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  
  return {
    grid: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)',
    border: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
    text: isDark ? '#a1a1aa' : '#71717a', // Zinc-400 vs Zinc-500
    tooltipBg: isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    tooltipBorder: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
    tooltipText: isDark ? '#f4f4f5' : '#18181b', // Zinc-100 vs Zinc-900
    accent: '#ea580c', // Burnt Orange
    primary: isDark ? '#f4f4f5' : '#18181b',
    palette: [
      '#ea580c', '#3b82f6', '#10b981', '#f59e0b',
      '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'
    ]
  };
}

function getBaseOptions() {
  const theme = getThemeColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: {
        labels: {
          font: { family: "Geist Sans, system-ui, -apple-system, sans-serif", size: 11, weight: '500' },
          color: theme.text,
          boxWidth: 10,
          padding: 8
        },
      },
      tooltip: {
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        titleFont: { family: "Geist Sans, system-ui, -apple-system, sans-serif", size: 12, weight: '600' },
        titleColor: theme.accent,
        bodyFont: { family: "Geist Sans, system-ui, -apple-system, sans-serif", size: 11 },
        bodyColor: theme.tooltipText,
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { color: theme.grid, drawBorder: false },
        border: { color: theme.border },
        ticks: { color: theme.text, font: { family: "Geist Mono, monospace", size: 10 } },
      },
      y: {
        grid: { color: theme.grid, drawBorder: false },
        border: { color: theme.border },
        ticks: { color: theme.text, font: { family: "Geist Mono, monospace", size: 10 } },
      },
    },
  };
}

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
    const dataField = isPercentile ? 'yearly_percentile' : 'yearly_merit';

    const allYears = new Set();
    for (const row of rows) {
      Object.keys(row.yearly_merit || {}).forEach(y => allYears.add(Number(y)));
    }
    const years = [...allYears].sort((a, b) => a - b);
    const theme = getThemeColors();

    const datasets = rows.slice(0, 15).map((row, i) => {
      const color = theme.palette[i % theme.palette.length];
      return {
        label: rows.length === 1 ? row.specialty : row.hospital,
        data: years.map(y => row[dataField]?.[String(y)] ?? row[dataField]?.[y] ?? null),
        borderColor: color,
        backgroundColor: color + '14', // 8% opacity
        pointBackgroundColor: color,
        tension: 0.3,
        spanGaps: false,
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
      };
    });

    const yAxisLabel = isPercentile ? 'Percentile Rank' : 'Closing Merit';

    const chart = new Chart(ctx, {
      type: 'line',
      data: { labels: years.map(String), datasets },
      options: {
        ...getBaseOptions(),
        plugins: {
          ...getBaseOptions().plugins,
          legend: {
            ...getBaseOptions().plugins.legend,
            display: datasets.length <= 10,
          },
        },
        scales: {
          ...getBaseOptions().scales,
          y: {
            ...getBaseOptions().scales.y,
            min: isPercentile ? 0 : undefined,
            max: isPercentile ? 100 : undefined,
            title: { display: true, text: yAxisLabel, color: theme.text, font: { size: 10, family: "Geist Sans" } },
          },
        },
      },
    });

    registerChart('trendLineChart', chart);
  },

  // ─── Distribution histogram (Predictor tab) ───
  drawDistributionChart(allMerits, userMerit, canvasId = 'distributionChart') {
    const ctx = getOrDestroyChart(canvasId);
    if (!ctx) return;

    if (!allMerits || allMerits.length === 0) return;
    const theme = getThemeColors();

    const maxVal = Math.max(...allMerits);
    const isPct = maxVal <= 100 && maxVal > 0;
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

    const userBin = Math.min(Math.floor((userMerit - min) / step), bins - 1);
    const bgColors = counts.map((_, i) =>
      i === userBin ? 'rgba(234, 88, 12, 0.85)' : 'rgba(113, 113, 122, 0.4)'
    );

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Hospitals',
          data: counts,
          backgroundColor: bgColors,
          borderColor: bgColors.map(c => c.replace('0.4', '0.7').replace('0.85', '1')),
          borderWidth: 1,
        }],
      },
      options: {
        ...getBaseOptions(),
        plugins: {
          ...getBaseOptions().plugins,
          legend: { display: false },
          tooltip: {
            ...getBaseOptions().plugins.tooltip,
            callbacks: {
              title: ctx => isPct ? `~${ctx[0].label} of max` : `Merit ≈ ${ctx[0].label}`,
              label: ctx => `${ctx.parsed.y} placements`,
            },
          },
        },
        scales: {
          ...getBaseOptions().scales,
          x: { ...getBaseOptions().scales.x, title: { display: true, text: xLabel, color: theme.text } },
          y: { ...getBaseOptions().scales.y, title: { display: true, text: 'Count', color: theme.text } },
        },
      },
    });
    registerChart(canvasId, chart);
  },

  drawPredDistributionChart(canvasId, allMerits, userMerit) {
    this.drawDistributionChart(allMerits, userMerit, canvasId);
  },

  // ─── Sidebar trend chart (merit table row detail) ───
  drawSidebarTrendChart(canvasId, row) {
    const ctx = getOrDestroyChart(canvasId);
    if (!ctx) return;

    const years = Object.keys(row.yearly_merit || {}).sort().map(Number);
    if (!years.length) return;
    
    const pctData = years.map(y => row.yearly_pct_of_max?.[String(y)] ?? null);
    const pctileData = years.map(y => row.yearly_percentile?.[String(y)] ?? null);
    const seatsData = years.map(y => row.yearly_seats?.[String(y)] ?? null);
    const theme = getThemeColors();

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years.map(String),
        datasets: [
          {
            label: '% of Max',
            data: pctData,
            borderColor: '#ea580c', // Burnt Orange
            backgroundColor: 'rgba(234, 88, 12, 0.08)',
            tension: 0.3,
            fill: true,
            yAxisID: 'yPct',
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 2,
            spanGaps: false,
          },
          {
            label: 'Percentile',
            data: pctileData,
            borderColor: '#3b82f6', // Blue
            borderDash: [4, 3],
            tension: 0.3,
            fill: false,
            yAxisID: 'yPct',
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 1.5,
            spanGaps: false,
          },
          {
            label: 'Seats',
            data: seatsData,
            borderColor: '#10b981', // Emerald Green
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            tension: 0.2,
            fill: false,
            yAxisID: 'ySeats',
            pointRadius: 4,
            borderWidth: 1.5,
            type: 'bar',
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: { duration: 300 },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { 
              font: { family: "Geist Sans, system-ui", size: 10, weight: '500' }, 
              color: theme.text, 
              boxWidth: 8,
              padding: 4
            },
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            titleColor: theme.accent,
            bodyColor: theme.tooltipText,
            callbacks: {
              label(c) {
                if (c.dataset.label === '% of Max') return `% of Max: ${c.parsed.y != null ? c.parsed.y.toFixed(1) + '%' : '—'}`;
                if (c.dataset.label === 'Percentile') return `Percentile: ${c.parsed.y != null ? c.parsed.y + 'th' : '—'}`;
                return `Seats: ${c.parsed.y ?? '—'}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: theme.grid },
            ticks: { color: theme.text, font: { family: "Geist Mono", size: 10 } },
          },
          yPct: {
            type: 'linear',
            position: 'left',
            min: 0,
            max: 100,
            grid: { color: theme.grid },
            ticks: { color: theme.text, font: { family: "Geist Mono", size: 10 }, callback: v => v + '%' },
          },
          ySeats: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: theme.text, font: { family: "Geist Mono", size: 10 } },
            min: 0,
          },
        },
      },
    });
    registerChart(canvasId, chart);
  },
};

window.Charts = Charts;
