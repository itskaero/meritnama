// ═══════════════════════════════════════════════════════════════════
// TRAINING SEATS TAB
// ═══════════════════════════════════════════════════════════════════
let _smSetup = false;

function renderSeatMatrixTab() {
  const seats = SIM.flatSeats;
  if (!seats.length) {
    document.getElementById('smResults').innerHTML =
      '<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)">Seat data not loaded.</div>';
    return;
  }

  if (!_smSetup) {
    // Populate filter dropdowns
    const programs = [...new Set(seats.map(s => s.typeName))].filter(Boolean).sort();
    const quotas   = [...new Set(seats.map(s => s.quotaName))].filter(Boolean).sort();
    const smProg  = document.getElementById('smProgram');
    const smQuota = document.getElementById('smQuota');
    programs.forEach(p => { const o = document.createElement('option'); o.value = o.textContent = p; smProg.appendChild(o); });
    quotas.forEach(q => {   const o = document.createElement('option'); o.value = o.textContent = q; smQuota.appendChild(o); });
    smProg.addEventListener('change',  renderSeatMatrixTab);
    smQuota.addEventListener('change', renderSeatMatrixTab);
    document.getElementById('smSearch').addEventListener('input', renderSeatMatrixTab);
    _smSetup = true;
  }

  const prog   = document.getElementById('smProgram').value;
  const quota  = document.getElementById('smQuota').value;
  const search = (document.getElementById('smSearch').value || '').toLowerCase();

  const filtered = seats.filter(s =>
    (!prog  || s.typeName === prog) &&
    (!quota || s.quotaName === quota) &&
    (!search || s.specialityName.toLowerCase().includes(search) || s.hospitalName.toLowerCase().includes(search))
  );

  // Group by specialty
  const bySpec = {};
  for (const s of filtered) {
    if (!bySpec[s.specialityName]) bySpec[s.specialityName] = { total: 0, rows: [] };
    bySpec[s.specialityName].total += s.seats;
    bySpec[s.specialityName].rows.push(s);
  }

  const totalSeats  = filtered.reduce((sum, s) => sum + s.seats, 0);
  const totalHospitals = new Set(filtered.map(s => s.hospitalName)).size;
  const specCount   = Object.keys(bySpec).length;

  // Summary bar
  const summary = document.getElementById('smSummary');
  summary.style.display = '';
  summary.innerHTML = `
    <div class="card" style="padding:1rem;">
      <div style="display:flex;gap:2rem;flex-wrap:wrap;font-size:0.85rem;">
        <div><strong style="color:var(--neon-cyan);">${totalSeats.toLocaleString()}</strong> total seats</div>
        <div><strong style="color:var(--neon-purple);">${specCount}</strong> specialties</div>
        <div><strong style="color:var(--neon-green);">${totalHospitals}</strong> hospitals</div>
        <div><strong>${filtered.length}</strong> slots</div>
      </div>
    </div>`;

  const cards = Object.entries(bySpec).sort((a, b) => a[0].localeCompare(b[0])).map(([spec, d]) => {
    const hospRows = d.rows.sort((a, b) => b.seats - a.seats).map(h => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:0.8rem;">${esc(h.hospitalName)}</span>
        <span style="font-size:0.8rem;font-weight:700;color:var(--neon-cyan);min-width:30px;text-align:right;">${h.seats}</span>
      </div>`).join('');
    return `<div class="card" style="margin-bottom:0.75rem;padding:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <strong style="font-size:0.92rem;">${esc(spec)}</strong>
        <span style="background:rgba(77,184,217,0.1);color:var(--neon-cyan);padding:2px 10px;border-radius:100px;font-weight:700;font-size:0.82rem;">${d.total} seats</span>
      </div>
      <div style="max-height:200px;overflow-y:auto;">${hospRows}</div>
    </div>`;
  }).join('');

  document.getElementById('smResults').innerHTML =
    cards || '<div style="text-align:center;color:var(--text-muted);padding:2rem;">No seats found.</div>';
}

// ═══════════════════════════════════════════════════════════════════
// COMPETITION TAB
// ═══════════════════════════════════════════════════════════════════
let _compData  = null;
let _compSetup = false;

function buildCompetitionData() {
  if (_compData) return _compData;
  const seats      = SIM.flatSeats;
  const candidates = SIM.candidates;
  if (!seats.length || !candidates.length) return null;

  // Build seat lookup: prog|quota|specialty → seats
  const seatMap = {};
  for (const s of seats) {
    const key = `${s.typeName}|${s.quotaName}|${s.specialityName}`;
    seatMap[key] = (seatMap[key] || 0) + s.seats;
  }

  // Count applicants per slot (unique per candidate)
  const applicantMap = {};
  for (const c of candidates) {
    if (!c.preference) continue;
    for (const [prog, prefs] of Object.entries(c.preference)) {
      const seen = new Set();
      for (const p of prefs) {
        const key = `${prog}|${p.quotaName}|${p.specialityName}`;
        if (!seen.has(key)) { seen.add(key); applicantMap[key] = (applicantMap[key] || 0) + 1; }
      }
    }
  }

  const allKeys = new Set([...Object.keys(seatMap), ...Object.keys(applicantMap)]);
  _compData = [];
  for (const key of allKeys) {
    const [prog, quota, specialty] = key.split('|');
    const totalSeats = seatMap[key] || 0;
    const applicants = applicantMap[key] || 0;
    const ratio = totalSeats > 0 ? applicants / totalSeats : (applicants > 0 ? Infinity : 0);
    _compData.push({ prog, quota, specialty, totalSeats, applicants, ratio });
  }
  return _compData;
}

function renderCompetitionTab() {
  const container = document.getElementById('compResults');
  const data = buildCompetitionData();
  if (!data) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)">Competition data unavailable. Candidates or seat data not loaded.</div>';
    return;
  }

  if (!_compSetup) {
    const programs = [...new Set(SIM.flatSeats.map(s => s.typeName))].filter(Boolean).sort();
    const quotas   = [...new Set(SIM.flatSeats.map(s => s.quotaName))].filter(Boolean).sort();
    const cp = document.getElementById('compProgram');
    const cq = document.getElementById('compQuota');
    programs.forEach(p => { const o = document.createElement('option'); o.value = o.textContent = p; cp.appendChild(o); });
    quotas.forEach(q => {   const o = document.createElement('option'); o.value = o.textContent = q; cq.appendChild(o); });
    cp.addEventListener('change',  renderCompetitionTab);
    cq.addEventListener('change',  renderCompetitionTab);
    document.getElementById('compSearch').addEventListener('input',  renderCompetitionTab);
    document.getElementById('compSort').addEventListener('change', renderCompetitionTab);
    _compSetup = true;
  }

  const prog   = document.getElementById('compProgram').value;
  const quota  = document.getElementById('compQuota').value;
  const search = (document.getElementById('compSearch').value || '').toLowerCase();
  const sort   = document.getElementById('compSort').value;

  let filtered = data.filter(r =>
    (!prog  || r.prog === prog) &&
    (!quota || r.quota === quota) &&
    (!search || r.specialty.toLowerCase().includes(search))
  );

  if (sort === 'ratio-desc')       filtered.sort((a, b) => b.ratio - a.ratio);
  else if (sort === 'ratio-asc')   filtered.sort((a, b) => a.ratio - b.ratio);
  else if (sort === 'specialty')   filtered.sort((a, b) => a.specialty.localeCompare(b.specialty));
  else if (sort === 'applicants-desc') filtered.sort((a, b) => b.applicants - a.applicants);

  if (!filtered.length) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--text-muted)">No results.</div>';
    return;
  }

  const totalApps  = filtered.reduce((s, r) => s + r.applicants, 0);
  const totalSeats = filtered.reduce((s, r) => s + r.totalSeats, 0);
  const avgRatio   = totalSeats > 0 ? (totalApps / totalSeats).toFixed(1) : '—';
  const finite     = filtered.filter(r => isFinite(r.ratio)).map(r => r.ratio);
  const maxRatio   = finite.length ? Math.max(...finite) : 1;

  const rows = filtered.slice(0, 150).map(r => {
    const ratioStr  = r.ratio === Infinity ? '∞' : r.ratio.toFixed(1);
    const barW      = maxRatio > 0 ? Math.min(100, ((isFinite(r.ratio) ? r.ratio : maxRatio) / maxRatio) * 100) : 0;
    const heatColor = r.ratio > 10 ? '#dc3c3c' : r.ratio > 5 ? 'var(--neon-gold)' : 'var(--neon-green)';
    return `<tr>
      <td>${esc(r.specialty)}</td><td>${esc(r.prog)}</td><td>${esc(r.quota)}</td>
      <td style="text-align:right">${r.totalSeats}</td>
      <td style="text-align:right">${r.applicants}</td>
      <td style="text-align:right;font-weight:700;color:${heatColor};">${ratioStr}:1</td>
      <td><div style="background:${heatColor};height:8px;border-radius:4px;width:${barW}%;opacity:0.7;"></div></td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card" style="margin-bottom:1rem;padding:1rem;">
      <div style="display:flex;gap:2rem;flex-wrap:wrap;font-size:0.85rem;">
        <div><strong style="color:var(--neon-cyan);">${filtered.length}</strong> specialties shown</div>
        <div>Total seats: <strong>${totalSeats.toLocaleString()}</strong></div>
        <div>Total applications: <strong>${totalApps.toLocaleString()}</strong></div>
        <div>Average ratio: <strong>${avgRatio}:1</strong></div>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Specialty</th><th>Program</th><th>Quota</th>
          <th style="text-align:right">Seats</th><th style="text-align:right">Applicants</th>
          <th style="text-align:right">Ratio</th><th>Demand</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${filtered.length > 150 ? '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.5rem;">Showing top 150 results.</p>' : ''}`;
}

// ═══════════════════════════════════════════════════════════════════
// HOSPITALS TAB
// ═══════════════════════════════════════════════════════════════════
let _hospData       = null;
let _hospSearchWired = false;

function renderHospitalsTab() {
  const grid = document.getElementById('hospTabGrid');
  if (!grid) return;

  if (!_hospData) {
    const seats = SIM.flatSeats;
    if (!seats.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">Seat data not loaded.</div>';
      return;
    }
    const map = {};
    for (const s of seats) {
      const id = s.hospitalId ?? s.hospitalName;
      if (!map[id]) map[id] = { id, name: s.hospitalName, specialties: new Set(), types: new Set(), totalSeats: 0 };
      map[id].specialties.add(s.specialityName);
      map[id].types.add(s.typeName);
      map[id].totalSeats += s.seats;
    }
    _hospData = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }

  if (!_hospSearchWired) {
    const inp = document.getElementById('hospTabSearch');
    if (inp) inp.addEventListener('input', function () {
      const q = this.value.trim().toLowerCase();
      renderHospGrid(q ? _hospData.filter(h => h.name.toLowerCase().includes(q)) : _hospData);
    });
    _hospSearchWired = true;
  }

  renderHospGrid(_hospData);
}

function renderHospGrid(hospitals) {
  const grid = document.getElementById('hospTabGrid');
  if (!grid) return;
  if (!hospitals.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">No hospitals found.</div>';
    return;
  }
  grid.innerHTML = hospitals.map(h => {
    const types = Array.from(h.types).sort().join(', ');
    const specs = Array.from(h.specialties).sort().join(', ');
    return `<a href="hospital.html?id=${encodeURIComponent(h.id)}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.2rem 1.4rem;text-decoration:none;color:var(--text);display:flex;flex-direction:column;gap:0.6rem;transition:border-color 0.2s,transform 0.15s;" onmouseover="this.style.borderColor='var(--border-hover)';this.style.transform='translateY(-2px)';" onmouseout="this.style.borderColor='var(--border)';this.style.transform='';">
      <div style="font-size:1rem;font-weight:700;color:var(--neon-cyan);line-height:1.3;">${esc(h.name)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;font-size:0.78rem;">
        <span style="padding:2px 8px;border-radius:100px;border:1px solid rgba(62,207,142,0.3);background:rgba(62,207,142,0.07);color:var(--neon-green);">&#129681; ${h.totalSeats} seats</span>
        <span style="padding:2px 8px;border-radius:100px;border:1px solid rgba(124,101,196,0.3);background:rgba(124,101,196,0.07);color:var(--neon-purple);">&#129657; ${h.specialties.size} specialties</span>
        <span style="padding:2px 8px;border-radius:100px;border:1px solid rgba(232,166,39,0.3);background:rgba(232,166,39,0.07);color:var(--neon-gold);">&#128220; ${esc(types)}</span>
      </div>
      <div style="font-size:0.77rem;color:var(--text-muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(specs)}</div>
    </a>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// INDUCTION SCHEDULE TAB (Firestore / static JSON — no direct portal API)
// ═══════════════════════════════════════════════════════════════════
const SCHEDULE = {
  unsubscribe: null,
  tickTimer:   null,
};

function normalizeScheduleSteps(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw?.Table && Array.isArray(raw.Table)) return raw.Table;
  if (raw?.steps && Array.isArray(raw.steps)) return raw.steps;
  return null;
}

function isSchedulePlaceholder(step) {
  const sid = step.statusId ?? 0;
  const sidd = step.statusIdd ?? 0;
  if (sid !== 0 || sidd !== 0) return false;
  const startMs = Date.parse(step.startDate);
  const endMs = Date.parse(step.endDate || step.endDated);
  return Number.isFinite(startMs) && startMs === endMs;
}

function parseScheduleBoundary(step, which) {
  const dateStr = which === 'start'
    ? step.startDate
    : (step.endDated || step.endDate);
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const h = which === 'start' ? step.startH : step.endH;
  const m = which === 'start' ? step.startM : step.endM;
  if (Number.isFinite(Number(h))) d.setHours(Number(h), Number.isFinite(Number(m)) ? Number(m) : 0, 0, 0);
  return d;
}

function getScheduleStepPhase(step, now = new Date()) {
  if (isSchedulePlaceholder(step)) return 'pending';
  const sid = step.statusId ?? step.statusIdd ?? 0;
  const start = parseScheduleBoundary(step, 'start');
  const end = parseScheduleBoundary(step, 'end');

  if (sid === 21) return end && now > end ? 'closed' : 'closed';
  if (sid === 11) {
    if (end && now > end) return 'closed';
    if (start && now < start) return 'upcoming';
    return 'active';
  }
  if (sid === 0) return 'pending';

  if (end && now > end) return 'closed';
  if (start && now < start) return 'upcoming';
  if (start && end && now >= start && now <= end) return 'active';
  return 'pending';
}

function schedulePhaseLabel(phase) {
  return {
    active:   'Open now',
    upcoming: 'Upcoming',
    closed:   'Closed',
    pending:  'Not scheduled',
  }[phase] || phase;
}

function fmtScheduleWhen(step) {
  if (isSchedulePlaceholder(step)) return 'Dates not published yet';
  const start = parseScheduleBoundary(step, 'start');
  const end = parseScheduleBoundary(step, 'end');
  const fmt = d => d.toLocaleString('en-PK', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (step.endTimer) return String(step.endTimer);
  return '—';
}

function fmtScheduleCountdown(endDate, now = new Date()) {
  if (!endDate) return '';
  const ms = endDate.getTime() - now.getTime();
  if (ms <= 0) return 'Ended';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h remaining`;
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

function applySchedulePayload(payload, sourceLabel) {
  const steps = normalizeScheduleSteps(payload);
  if (!steps?.length) return false;
  SIM.schedule.steps = steps.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  SIM.schedule.source = sourceLabel || 'unknown';
  SIM.schedule.updatedAt = payload?.updated || payload?.updatedAt || null;
  SIM.schedule.loaded = true;
  SIM.schedule.error = null;
  return true;
}

async function loadScheduleData() {
  if (SIM.schedule.loading) return;
  SIM.schedule.loading = true;

  try {
    const snap = await firebase.firestore().collection('notifications').doc('induction_schedule').get();
    if (snap.exists && applySchedulePayload(snap.data(), 'live')) {
      SIM.schedule.loading = false;
      if (SIM.activeTab === 'schedule') renderScheduleTab();
      return;
    }
  } catch (e) {
    console.warn('[Schedule] Firestore load failed:', e);
  }

  try {
    const res = await fetch('data/induction21_schedule.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (applySchedulePayload(data, data.source || 'static_snapshot')) {
        SIM.schedule.loading = false;
        if (SIM.activeTab === 'schedule') renderScheduleTab();
        return;
      }
    }
  } catch (e) {
    console.warn('[Schedule] Static JSON load failed:', e);
  }

  SIM.schedule.error = 'Schedule data unavailable.';
  SIM.schedule.loaded = true;
  SIM.schedule.loading = false;
  if (SIM.activeTab === 'schedule') renderScheduleTab();
}

function initScheduleTab() {
  loadScheduleData();
  try {
    if (SCHEDULE.unsubscribe) SCHEDULE.unsubscribe();
    SCHEDULE.unsubscribe = firebase.firestore()
      .collection('notifications').doc('induction_schedule')
      .onSnapshot(snap => {
        if (!snap.exists) return;
        if (applySchedulePayload(snap.data(), 'live')) {
          if (SIM.activeTab === 'schedule') renderScheduleTab();
        }
      });
  } catch (_) {}

  document.getElementById('schedFilter')?.addEventListener('change', e => {
    SIM.schedule.filter = e.target.value;
    renderScheduleTab();
  });
  document.getElementById('schedSearch')?.addEventListener('input', e => {
    SIM.schedule.search = e.target.value.trim().toLowerCase();
    renderScheduleTab();
  });
  document.getElementById('schedRefreshBtn')?.addEventListener('click', () => {
    SIM.schedule.loaded = false;
    loadScheduleData();
  });
}

function _startScheduleTick() {
  _stopScheduleTick();
  SCHEDULE.tickTimer = setInterval(() => {
    if (SIM.activeTab === 'schedule') renderScheduleTab();
  }, 60000);
}

function _stopScheduleTick() {
  if (SCHEDULE.tickTimer) {
    clearInterval(SCHEDULE.tickTimer);
    SCHEDULE.tickTimer = null;
  }
}

function renderScheduleTab() {
  const root = document.getElementById('schedResults');
  if (!root) return;

  if (!SIM.schedule.loaded || SIM.schedule.loading) {
    root.innerHTML = '<p class="sched-empty">Loading induction schedule…</p>';
    _stopScheduleTick();
    return;
  }

  if (SIM.schedule.error || !SIM.schedule.steps.length) {
    root.innerHTML = `<p class="sched-empty">${esc(SIM.schedule.error || 'No schedule steps found.')}</p>`;
    _stopScheduleTick();
    return;
  }

  const now = new Date();
  const filter = SIM.schedule.filter || 'all';
  const q = SIM.schedule.search;

  const enriched = SIM.schedule.steps.map(step => ({
    step,
    phase: getScheduleStepPhase(step, now),
  }));

  const filtered = enriched.filter(({ step, phase }) => {
    if (filter !== 'all' && phase !== filter) return false;
    if (!q) return true;
    const hay = `${step.title || ''} ${step.detail || ''}`.toLowerCase();
    return hay.includes(q);
  });

  const activeNow = enriched.filter(x => x.phase === 'active');

  const updatedLabel = SIM.schedule.updatedAt
    ? (typeof SIM.schedule.updatedAt === 'string'
        ? SIM.schedule.updatedAt
        : SIM.schedule.updatedAt.toDate?.().toLocaleString?.('en-PK') || '')
    : '';
  const sourceLabel = SIM.schedule.source === 'live' ? 'Live update' : 'Snapshot';

  root.innerHTML = `
    <div class="sched-meta-bar">
      <span>${filtered.length} step${filtered.length !== 1 ? 's' : ''} shown</span>
      <span>${esc(sourceLabel)}${updatedLabel ? ` · Updated ${esc(updatedLabel)}` : ''}</span>
    </div>
    ${activeNow.length ? `
      <div class="sched-hero">
        <div class="sched-hero-title">Open now</div>
        ${activeNow.slice(0, 4).map(({ step }) => {
          const end = parseScheduleBoundary(step, 'end');
          return `<div class="sched-hero-item">
            <strong>${esc(step.title)}</strong>
            <span>${fmtScheduleCountdown(end, now)}</span>
          </div>`;
        }).join('')}
      </div>` : ''}
    <div class="sched-list">
      ${filtered.length ? filtered.map(({ step, phase }) => {
        const end = parseScheduleBoundary(step, 'end');
        const countdown = phase === 'active' ? fmtScheduleCountdown(end, now) : '';
        return `<article class="sched-row sched-${phase}">
          <div class="sched-row-main">
            <div class="sched-row-head">
              <h3>${esc(step.title || 'Untitled step')}</h3>
              <span class="sched-badge sched-badge-${phase}">${schedulePhaseLabel(phase)}</span>
            </div>
            ${step.detail ? `<p class="sched-detail">${esc(step.detail)}</p>` : ''}
            <p class="sched-when">${esc(fmtScheduleWhen(step))}</p>
          </div>
          <div class="sched-row-side">
            ${countdown ? `<span class="sched-countdown">${esc(countdown)}</span>` : ''}
            <span class="sched-order">#${step.sortOrder ?? '—'}</span>
          </div>
        </article>`;
      }).join('') : '<p class="sched-empty">No steps match this filter.</p>'}
    </div>
    <p class="sched-footnote">Status codes from the portal: <strong>11</strong> open/active · <strong>21</strong> closed · <strong>0</strong> not scheduled yet. Data is synced via MeritNama admin — the public site does not call the portal API directly.</p>
  `;

  _startScheduleTick();
}
