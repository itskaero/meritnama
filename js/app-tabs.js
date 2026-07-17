
// ═══════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════

function switchToTab(tab) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  App.ui.activeTab = tab;
  localStorage.setItem('mn_last_tab', tab);
  onTabActivated(tab);
  btn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

function setupTabNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
  });
  document.querySelectorAll('.start-actions [data-tab], .start-link[data-tab]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      switchToTab(link.dataset.tab);
    });
  });
  const urlTab  = new URLSearchParams(window.location.search).get('tab');
  const lastTab = localStorage.getItem('mn_last_tab');
  if (urlTab)       switchToTab(urlTab);
  else if (lastTab) switchToTab(lastTab);
}

function onTabActivated(tab) {
  if (tab === 'merit')       renderMeritTable();
  if (tab === 'current')     renderCurrentMerit();
  if (tab === 'policy')      renderPolicyTab();
  if (tab === 'competition') renderCompetitionTab();
  if (tab === 'seatmatrix')  renderSeatMatrixTab();
  if (tab === 'hospitals')   renderHospitalsTab();
  if (tab === 'jobs')        initJobsTab();

}

// ═══════════════════════════════════════════════════════
// MERIT TABLE
// ═══════════════════════════════════════════════════════

function populateInductionFilter() {
  const sel = document.getElementById('mtInduction');
  if (!sel) return;
  const allYears = getYears();
  const first = formatYearShort(allYears[0]), last = formatYearShort(allYears[allYears.length - 1]);
  sel.innerHTML = `
    <option value="all">All Cycles (${first}–${last})</option>
    <option value="last1">${formatYearShort(allYears[allYears.length - 1])} (Last 1)</option>
    <option value="last3">${formatYearShort(allYears[allYears.length - 3])}–${last} (Last 3)</option>
    <option value="last5" selected>${formatYearShort(allYears[allYears.length - 5])}–${last} (Last 5)</option>
    <option value="last10">${formatYearShort(allYears[Math.max(0, allYears.length - 10)])}–${last} (Last 10)</option>
  `;
}

function setupMeritTable() {
  const mtProgram = document.getElementById('mtProgram');
  const mtQuota   = document.getElementById('mtQuota');
  const mtInduction = document.getElementById('mtInduction');
  if (!mtProgram || !mtQuota) return;

  populateInductionFilter();

  mtProgram.addEventListener('change', () => {
    populateSelect(mtQuota, getQuotas(mtProgram.value));
    renderMeritTable();
  });
  mtQuota.addEventListener('change', renderMeritTable);
  if (mtInduction) mtInduction.addEventListener('change', renderMeritTable);
  document.getElementById('mtSpecSearch').addEventListener('input', renderMeritTable);
  document.getElementById('mtHospSearch').addEventListener('input', renderMeritTable);

  document.querySelectorAll('.mt-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      MT.displayMode = btn.dataset.view;
      document.querySelectorAll('.mt-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderMeritTable();
    });
  });

  document.getElementById('mtSidebarClose').addEventListener('click', closeMeritSidebar);
}

function renderMeritTable() {
  const prog  = document.getElementById('mtProgram').value;
  const quota = document.getElementById('mtQuota').value;
  const spec  = document.getElementById('mtSpecSearch').value.toLowerCase().trim();
  const hosp  = document.getElementById('mtHospSearch').value.toLowerCase().trim();
  const indFilter = document.getElementById('mtInduction')?.value || 'last5';

  let rows = App.data.flatLookup.filter(r =>
    (!prog  || r.program  === prog)  &&
    (!quota || r.quota    === quota) &&
    (!spec  || r.specialty.toLowerCase().includes(spec)) &&
    (!hosp  || r.hospital.toLowerCase().includes(hosp))
  );

  if (MT.sortKey) {
    rows = [...rows].sort((a, b) => {
      let av = a[MT.sortKey], bv = b[MT.sortKey];
      if (typeof av === 'string') return av.localeCompare(bv) * MT.sortDir;
      return ((av ?? -Infinity) - (bv ?? -Infinity)) * MT.sortDir;
    });
  }

  MT.filteredRows = rows;
  document.getElementById('mtCount').textContent = `${rows.length.toLocaleString()} records`;

  // Determine induction cycles to show
  const allYears = getYears();
  let years = allYears;
  if (indFilter === 'last1')      years = allYears.slice(-1);
  else if (indFilter === 'last3') years = allYears.slice(-3);
  else if (indFilter === 'last5') years = allYears.slice(-5);
  else if (indFilter === 'last10') years = allYears.slice(-10);
  // else 'all' — show all years

  // Build header
  const thead = document.getElementById('mtHead');
  thead.innerHTML = `<tr>
    ${thSort('specialty',  'Specialty')}
    ${thSort('hospital',   'Hospital')}
    <th>Prog</th>
    <th>Quota</th>
    ${years.map(y => `<th class="mt-yr-col" title="${formatInductionLabel(y)}">${formatYearShort(y)}</th>`).join('')}
    ${thSort('trend',      'Trend')}
    ${thSort('confidence', 'Conf')}
  </tr>`;

  thead.querySelectorAll('th[data-sort]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (MT.sortKey === k) MT.sortDir *= -1;
      else { MT.sortKey = k; MT.sortDir = 1; }
      renderMeritTable();
    });
  });

  // Build body (cap 400 for performance)
  const visible = rows.slice(0, 400);
  const isPct   = MT.displayMode === 'pct';
  const tbody   = document.getElementById('mtBody');

  tbody.innerHTML = visible.map((r, i) => {
    const yearCells = years.map(y => {
      const val = isPct ? r.yearly_pct_of_max?.[String(y)] : r.yearly_merit?.[String(y)];
      if (val == null) return '<td class="mt-yr-cell mt-no-data">—</td>';
      const pct  = r.yearly_pct_of_max?.[String(y)];
      const cls  = pct != null ? meritCellClass(pct) : '';
      const disp = isPct ? num(val, 1) + '%' : num(val, 1);
      return `<td class="mt-yr-cell ${cls}">${disp}</td>`;
    }).join('');

    const sel = MT.selectedIdx === i;
    return `<tr class="mt-row${sel ? ' mt-row-selected' : ''}" data-idx="${i}">
      <td class="mt-cell-spec">
        <button class="mn-shortlist-btn" style="width:20px;height:20px;font-size:0.72rem;vertical-align:middle;margin-right:4px;"
          data-shortlist-id="${slotShortlistId(r)}" data-shortlist-type="specialty"
          data-shortlist-label="${esc(r.specialty)} — ${esc(r.hospital)}"
          data-shortlist-meta="${esc(r.program)}${r.quota ? ' · ' + esc(r.quota) : ''}"
          title="Save to shortlist">&#9734;</button>${esc(r.specialty)}</td>
      <td class="mt-cell-hosp">${esc(r.hospital)}</td>
      <td class="mt-cell-sm">${esc(r.program)}</td>
      <td class="mt-cell-sm">${esc(r.quota)}</td>
      ${yearCells}
      <td>${trendBadge(r.trend)}</td>
      <td>${confBadge(r.confidence)}</td>
    </tr>`;
  }).join('');

  if (rows.length > 400) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="${4 + years.length + 2}" class="mt-overflow-note">
      Showing 400 of ${rows.length} — use filters to narrow down
    </td>`;
    tbody.appendChild(tr);
  }

  // Row click → sidebar
  tbody.querySelectorAll('.mt-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = parseInt(tr.dataset.idx);
      if (MT.selectedIdx === idx) {
        closeMeritSidebar();
      } else {
        MT.selectedIdx = idx;
        tbody.querySelectorAll('.mt-row').forEach(r => r.classList.remove('mt-row-selected'));
        tr.classList.add('mt-row-selected');
        openMeritSidebar(MT.filteredRows[idx]);
      }
    });
  });
}

function thSort(key, label) {
  const active = MT.sortKey === key;
  const arrow  = active ? (MT.sortDir > 0 ? ' ↑' : ' ↓') : '';
  return `<th data-sort="${key}" class="mt-th-sort${active ? ' active' : ''}">${label}${arrow}</th>`;
}

function meritCellClass(pct) {
  if (pct >= 75) return 'mt-merit-high';
  if (pct >= 55) return 'mt-merit-mid';
  if (pct >= 35) return 'mt-merit-low';
  return 'mt-merit-vlow';
}

// ── Sidebar ──

function openMeritSidebar(row) {
  const sidebar = document.getElementById('mtSidebar');
  const layout  = document.getElementById('mtLayout');
  sidebar.classList.remove('hidden');
  layout.classList.add('sidebar-open');

  const years = Object.keys(row.yearly_merit || {}).map(Number).sort((a, b) => a - b);
  const latY  = years[years.length - 1];

  // Stats row
  const statsHtml = `
    <div class="sidebar-stats">
      <div class="sidebar-stat">
        <span class="sidebar-stat-val">${row.avg_pct_of_max != null ? num(row.avg_pct_of_max, 1) + '%' : num(row.avg_closing_merit)}</span>
        <span class="sidebar-stat-lbl">Avg (% max)</span>
      </div>
      <div class="sidebar-stat">
        <span class="sidebar-stat-val">${row.latest_pct_of_max != null ? num(row.latest_pct_of_max, 1) + '%' : num(row.latest_merit)}</span>
        <span class="sidebar-stat-lbl" title="${formatInductionLabel(latY)}">Latest (${formatYearShort(latY)})</span>
      </div>
      <div class="sidebar-stat">
        <span class="sidebar-stat-val">${row.data_points ?? years.length}</span>
        <span class="sidebar-stat-lbl">Years data</span>
      </div>
      <div class="sidebar-stat">
        <span class="sidebar-stat-val">${volBadge(row.volatility)}</span>
        <span class="sidebar-stat-lbl">Volatility</span>
      </div>
    </div>`;

  // Year-by-year history table
  const yearRows = years.map(y => {
    const raw    = row.yearly_merit[y];
    const pct    = row.yearly_pct_of_max?.[y];
    const pctile = row.yearly_percentile?.[y];
    const seats  = row.yearly_seats?.[y];
    const max    = YEAR_TOTAL_MAX[Number(y)];
    const rowCls = pct != null ? meritCellClass(pct) : '';
    return `<tr>
      <td title="${formatInductionLabel(y)}">${formatYearShort(y)}</td>
      <td class="${rowCls}"><strong>${raw != null ? num(raw, 2) : '—'}</strong>${max ? `<small class="yr-max"> / ${max}</small>` : ''}</td>
      <td class="${rowCls}">${pct != null ? num(pct, 1) + '%' : '—'}</td>
      <td>${pctile != null ? pctile + 'th' : '—'}</td>
      <td>${seats ?? '—'}</td>
    </tr>`;
  }).join('');

  // Policy note for this record's latest induction
  const sp = App.data.scoringPolicy;
  let polNote = '';
  if (sp?.policies) {
    const indYear = getInductionYearMap()[latY] || latY;
    const pol = sp.policies[`${indYear}-1`] || sp.policies[indYear] || sp.policies[String(indYear)];
    if (pol) polNote = `<div class="sidebar-pol-note">Policy: ${esc(pol.label || indYear)} &middot; ${pol.total_marks} marks max</div>`;
  }

  document.getElementById('mtSidebarContent').innerHTML = `
    <div class="sidebar-header">
      <h3>${esc(row.specialty)}</h3>
      <p class="sidebar-hosp">${esc(row.hospital)}</p>
      <p class="sidebar-meta">${esc(row.program)} &middot; ${esc(row.quota)} &middot; ${confBadge(row.confidence)} confidence</p>
    </div>
    ${statsHtml}
    <div class="sidebar-trend-label">Year-by-year closing merit (chart below)</div>
    ${polNote}
    <div class="sidebar-year-table">
      <table class="data-table">
        <thead>
          <tr><th>Year</th><th>Closing Merit</th><th>% of Max</th><th>Percentile</th><th>Seats</th></tr>
        </thead>
        <tbody>${yearRows}</tbody>
      </table>
    </div>
  `;

  // Draw chart
  Charts.drawSidebarTrendChart('mtSidebarChart', row);

  // Scroll sidebar into view on mobile
  sidebar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeMeritSidebar() {
  document.getElementById('mtSidebar').classList.add('hidden');
  document.getElementById('mtLayout').classList.remove('sidebar-open');
  MT.selectedIdx = null;
  document.querySelectorAll('.mt-row-selected').forEach(r => r.classList.remove('mt-row-selected'));
}
// ═══════════════════════════════════════════════════════
// MISC UI
// ═══════════════════════════════════════════════════════

function updateHeaderMeta() {
  const el = document.getElementById('dataStatus');
  if (!el) return;
  const years = getYears();
  const n     = App.data.flatLookup.length;
  const first = formatYearShort(years[0]), last = formatYearShort(years[years.length - 1]);
  el.textContent = `${n.toLocaleString()} records · ${first}–${last}`;
  el.title = `${years[0]}–${years[years.length - 1]}`;
  el.className = 'badge badge-success';
}

function updateFooterStats() {
  const el = document.getElementById('footerStats');
  if (!el) return;
  const years  = getYears();
  const progs  = getPrograms();
  const specs  = getSpecialties();
  const first = formatYearShort(years[0]), last = formatYearShort(years[years.length - 1]);
  el.textContent = `${progs.join(', ')} · ${first}–${last} (${years.length} cycles) · ${specs.length} specialties`;
}

function setupBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  window.addEventListener('scroll', () => btn.classList.toggle('visible', window.scrollY > 400), { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function setupHamburger() {
  const btn = document.getElementById('hamburgerBtn');
  const nav = document.getElementById('mainNav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('click', e => {
    if (e.target.classList.contains('tab-btn')) {
      nav.classList.remove('nav-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

function setupKeyboardShortcuts() {
  const TABS = ['merit', 'predictor', 'calculator', 'current', 'policy', 'guide'];
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= TABS.length) { e.preventDefault(); switchToTab(TABS[n - 1]); }
    if (e.key === 'Escape') closeMeritSidebar();
  });
}

// Simple tooltip system
const TOOLTIPS = {
  closing:  { title: 'Closing Merit (Cutoff)', body: 'The lowest score that got a seat in this specialty/hospital in the given year. If your score ≥ this, you would have qualified.' },
  opening:  { title: 'Opening Merit',          body: 'The highest score admitted — i.e., the first candidate selected.' },
  pctofmax: { title: '% of Max',               body: 'Closing merit expressed as a % of the maximum possible marks for that year. Allows fair cross-year comparison even when the formula changed.' },
};

function initTooltips() {
  const el = document.getElementById('tooltipEl');
  if (!el) return;
  document.body.addEventListener('mouseover', e => {
    const btn = e.target.closest('[data-tip]');
    if (!btn) return;
    const tip = TOOLTIPS[btn.dataset.tip];
    if (!tip) return;
    el.querySelector('.tooltip-title').textContent = tip.title;
    el.querySelector('.tooltip-body').textContent  = tip.body;
    const ex = el.querySelector('.tooltip-example');
    ex.textContent = tip.example || '';
    ex.style.display = tip.example ? '' : 'none';
    el.classList.remove('hidden');
    const r = btn.getBoundingClientRect();
    const tw = el.offsetWidth  || 270;
    const th = el.offsetHeight || 80;
    let left = r.left + r.width / 2 - tw / 2;
    let top  = r.top - th - 10;
    left = Math.max(8, Math.min(left, window.innerWidth  - tw - 8));
    top  = top < 8 ? r.bottom + 8 : top;
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  });
  document.body.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-tip]')) return;
    el.classList.add('hidden');
  });
}
