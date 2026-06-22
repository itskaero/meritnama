// ═══════════════════════════════════════════════════════════════════
// PLACEMENT ALGORITHM  (faithful JS translation of merit.py)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build an empty seat tree from SIM.seats for the given program.
 * If SIM.seats not loaded, falls back to 1 seat per slot derived from prefs.
 */
function buildSeatTree(program) {
  if (SIM.seatsLoaded && SIM.seats[program]) {
    const tree = {};
    const ps = SIM.seats[program];
    for (const [q, specs] of Object.entries(ps)) {
      tree[q] = {};
      for (const [s, hosps] of Object.entries(specs)) {
        tree[q][s] = {};
        for (const [h, n] of Object.entries(hosps)) {
          tree[q][s][h] = { jobs: n, candidates: [], others: [] };
        }
      }
    }
    return tree;
  }
  // Fallback: 1 seat per unique slot found in preferences
  const tree = {};
  allCandidates().forEach(c => {
    (c.preference?.[program] || []).forEach(p => {
      tree[p.quotaName] ??= {};
      tree[p.quotaName][p.specialityName] ??= {};
      tree[p.quotaName][p.specialityName][p.hospitalName] ??= { jobs: 1, candidates: [], others: [] };
    });
  });
  return tree;
}

function normalizeQuotaName(quotaName) {
  return String(quotaName || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function quotaTrack(quotaName) {
  const q = normalizeQuotaName(quotaName);
  if (q.includes('armed force')) return QUOTA_TRACKS.ARMED;
  // Anything outside the Armed Force quota competes as a civilian track.
  // Keep the named set here so alternate spellings stay intentional/documented.
  return CIVILIAN_QUOTA_KEYS.has(q) ? QUOTA_TRACKS.CIVILIAN : QUOTA_TRACKS.CIVILIAN;
}

function quotaTrackLabel(track) {
  return track === QUOTA_TRACKS.ARMED ? 'Armed' : 'Civilian';
}

function trackSort(track) {
  return track === QUOTA_TRACKS.CIVILIAN ? 0 : 1;
}

function simRecordKey(applicantId, track) {
  return `${String(applicantId)}::${track || ''}`;
}

function candidateTrackPrefs(candidate, program, track) {
  return (candidate.preference?.[program] || [])
    .filter(p => quotaTrack(p.quotaName) === track)
    .slice()
    .sort((a, b) => a.preferenceNo - b.preferenceNo);
}

/**
 * Run the PRP placement algorithm.
 *
 * @param {Object[]} candidates - candidates filtered to this program
 * @param {Object}   seatTree   - {quota: {spec: {hosp: {jobs, candidates:[], others:[]}}}}
 * @param {string}   program    - program name for selecting program-specific marks
 * @param {boolean}  parentBonus - add pref.marks to effective marks if true
 * @returns {{ seatTree, candidates }}
 */
function runPlacement(candidates, seatTree, program, parentBonus = false) {
  // Working copies
  const prog = candidates.flatMap(c => {
    return [QUOTA_TRACKS.CIVILIAN, QUOTA_TRACKS.ARMED]
      .map(track => {
        const prefs = candidateTrackPrefs(c, program, track);
        const prefScores = prefs
          .map(pref => effectiveMark(c, program, undefined, undefined, pref))
          .filter(v => v != null);
        const sortMarks = prefScores.length
          ? Math.max(...prefScores)
          : (effectiveMark(c, program) ?? baseMarks(c));
        return {
          applicantId: c.applicantId,
          nameFull:    c.nameFull,
          marksTotal:  sortMarks,
          _sortMarks:  sortMarks,
          _source:     c,
          _program:    program,
          _track:      track,
          _trackLabel: quotaTrackLabel(track),
          _prefs:      prefs,
          placed: false, _q: null, _s: null, _h: null,
        };
      })
      .filter(cw => cw._prefs.length && cw._sortMarks != null);
  });

  const slot   = (q, s, h) => seatTree?.[q]?.[s]?.[h];
  const preferenceMark = (cand, pref) =>
    (cand._source
      ? effectiveMark(cand._source, cand._program || program, undefined, undefined, pref)
      : cand.marksTotal) ?? cand.marksTotal ?? 0;
  const effM   = (cand, pref) => preferenceMark(cand, pref) + (parentBonus ? (pref.marks || 0) : 0);
  const entry  = (cand, pref) => ({
    applicantId:  cand.applicantId,
    nameFull:     cand.nameFull,
    marksTotal:   effM(cand, pref),
    preferenceNo: pref.preferenceNo,
    _track:       cand._track,
    _trackLabel:  cand._trackLabel,
  });

  let prevPlaced = -1;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const unplaced = prog.filter(c => !c.placed)
                        .sort((a, b) => b._sortMarks - a._sortMarks);
    if (!unplaced.length) break;

    let placed = 0;

    for (const cand of unplaced) {
      for (const pref of cand._prefs) {
        const sl = slot(pref.quotaName, pref.specialityName, pref.hospitalName);
        if (!sl) continue;

        const em = effM(cand, pref);

        if (sl.candidates.length < sl.jobs) {
          sl.candidates.push(entry(cand, pref));
          cand.placed = true;
          cand._q = pref.quotaName; cand._s = pref.specialityName; cand._h = pref.hospitalName;
          placed++;
          break;
        } else {
          const lowest = sl.candidates.reduce((m, c) => c.marksTotal < m.marksTotal ? c : m);
          if (em > lowest.marksTotal) {
            sl.candidates = sl.candidates.filter(
              c => !(String(c.applicantId) === String(lowest.applicantId) && c._track === lowest._track)
            );
            const evicted = prog.find(c =>
              String(c.applicantId) === String(lowest.applicantId) &&
              c._track === lowest._track
            );
            if (evicted) {
              evicted.placed = false;
              evicted._q = evicted._s = evicted._h = null;
            }
            sl.candidates.push(entry(cand, pref));
            cand.placed = true;
            cand._q = pref.quotaName; cand._s = pref.specialityName; cand._h = pref.hospitalName;
            placed++;
            break;
          }
        }
      }
    }

    const total = prog.filter(c => c.placed).length;
    if (total === prevPlaced) break;
    prevPlaced = total;
  }

  // Build "others" list for each slot
  const isMe = id => String(id) === SIM.myId;
  for (const cand of prog) {
    const placedPrefNo = cand.placed
      ? cand._prefs.find(p =>
          p.quotaName === cand._q &&
          p.specialityName === cand._s &&
          p.hospitalName === cand._h
        )?.preferenceNo ?? null
      : null;
    for (const pref of cand._prefs) {
      const sl = slot(pref.quotaName, pref.specialityName, pref.hospitalName);
      if (!sl) continue;
      const inC = sl.candidates.some(c => String(c.applicantId) === String(cand.applicantId));
      const inO = sl.others.some(c => String(c.applicantId) === String(cand.applicantId));
      if (!inC && !inO) {
        sl.others.push({
          ...entry(cand, pref),
          placed:   cand.placed,
          placedAtHigherPref: (placedPrefNo !== null && placedPrefNo < pref.preferenceNo),
          placedAt: cand.placed ? { q: cand._q, s: cand._s, h: cand._h } : null,
          _track:   cand._track,
          _trackLabel: cand._trackLabel,
        });
      }
    }
  }

  // Sort placed and others by marks desc
  for (const specs of Object.values(seatTree)) {
    for (const hosps of Object.values(specs)) {
      for (const sl of Object.values(hosps)) {
        sl.candidates.sort((a, b) => b.marksTotal - a.marksTotal);
        sl.others.sort((a, b) => b.marksTotal - a.marksTotal);
      }
    }
  }

  return { seatTree, candidates: prog };
}

// ═══════════════════════════════════════════════════════════════════
// SIMULATION TAB
// ═══════════════════════════════════════════════════════════════════
function setupSimulationTab() {
  document.getElementById('simProgram')?.addEventListener('change', e => {
    SIM.sim.program = e.target.value;
    SIM.sim.result  = null;
    document.getElementById('simResults').innerHTML = '';
    updateSimulationDownloadGate();
  });

  document.getElementById('simParentBonus')?.addEventListener('change', e => {
    SIM.sim.parentBonus = e.target.checked;
    SIM.sim.result = null;
    document.getElementById('simResults').innerHTML = '';
    updateSimulationDownloadGate();
  });

  document.getElementById('simFilter')?.addEventListener('input', e => {
    SIM.sim.filter = e.target.value.trim().toLowerCase();
    if (SIM.sim.result) renderSimResults();
  });

  document.getElementById('runSimBtn')?.addEventListener('click', runSimulation);
  document.getElementById('simDownloadPdfBtn')?.addEventListener('click', downloadSimulationPdf);
  updateSimulationDownloadGate();

  const appInput = document.getElementById('appSimIdInput');
  const appBtn   = document.getElementById('runApplicantSimBtn');
  if (appInput && SIM.myId) appInput.value = SIM.myId;
  appBtn?.addEventListener('click', () => runApplicantSimulation(appInput?.value?.trim()));
  appInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') runApplicantSimulation(appInput.value.trim());
  });
}

function runSimulation() {
  const prog  = SIM.sim.program;
  if (!allCandidates().some(c => effectiveMark(c, prog) != null)) {
    showToast('No candidates for this program.', 'warning');
    return;
  }

  const btn = document.getElementById('runSimBtn');
  btn.disabled = true; btn.textContent = 'Running…';

  // Defer so the browser has time to update the button state
  setTimeout(() => {
    try {
      SIM.sim.result = runSimulationForProgram(prog);
      renderSimResults();
      if (SIM.sb.program === prog) renderSlot();
    } catch (e) {
      showToast(`Simulation error: ${e.message}`, 'error');
      console.error(e);
    }
    btn.disabled = false; btn.textContent = '⚡ Run Simulation';
  }, 30);
}

function runSimulationForProgram(program) {
  const cands = allCandidates().filter(c => effectiveMark(c, program) != null);
  if (!cands.length) return null;
  const tree = buildSeatTree(program);
  return runPlacement(cands, tree, program, SIM.sim.parentBonus);
}

function renderSimResults() {
  const { result, program, filter } = SIM.sim;
  if (!result) return;

  const { seatTree, candidates } = result;
  const container = document.getElementById('simResults');
  if (!container) return;

  // My result banner
  const meRecords = SIM.myId ? candidates.filter(c => String(c.applicantId) === SIM.myId) : [];
  let myHtml = '';
  if (meRecords.length) {
    const placedMe = meRecords.filter(c => c.placed);
    if (placedMe.length) {
      myHtml = `<div class="sim-my placed">
        ✅ <strong>Projected placement${placedMe.length > 1 ? 's' : ''}:</strong>
        ${placedMe.map(me => {
          const prefNo = me._prefs?.find(p =>
            p.quotaName === me._q && p.specialityName === me._s && p.hospitalName === me._h
          )?.preferenceNo ?? '?';
          return `${esc(me._trackLabel)}: ${esc(me._s)} at ${esc(me._h)} (${esc(me._q)} &middot; Pref #${prefNo})`;
        }).join(' &nbsp; | &nbsp; ')}
      </div>`;
    } else {
      myHtml = `<div class="sim-my unplaced">
        ⚠️ <strong>Not placed</strong> in this simulation.
        All your preferences are full with higher-scoring candidates.
      </div>`;
    }
  }

  const placed  = candidates.filter(c => c.placed).length;
  const total   = candidates.length;

  // Flatten tree to rows, apply filter
  const rows = [];
  for (const [q, specs] of Object.entries(seatTree)) {
    for (const [s, hosps] of Object.entries(specs)) {
      for (const [h, sl] of Object.entries(hosps)) {
        if (filter) {
          const hay = `${s} ${h} ${q}`.toLowerCase();
          if (!hay.includes(filter)) continue;
        }
        const cutoff = sl.candidates.length
          ? Math.min(...sl.candidates.map(c => c.marksTotal))
          : null;
        const eligibleOthers = sl.others.filter(o => !o.placedAtHigherPref);
        const nextInLine = eligibleOthers[0] ?? null;
        const skippedHigherPrefCount = sl.others.length - eligibleOthers.length;
        const meInSlot   = meRecords.length ? sl.candidates.some(c => String(c.applicantId) === SIM.myId) : false;
        rows.push({ q, s, h, sl, cutoff, nextInLine, meInSlot, eligibleOthers, skippedHigherPrefCount });
      }
    }
  }
  rows.sort((a, b) => a.s.localeCompare(b.s) || a.h.localeCompare(b.h));

  const filledSlots = rows.filter(r => r.sl.candidates.length > 0).length;

  container.innerHTML = `
    ${myHtml}
    <div class="sim-summary card">
      <div class="sim-summary-grid">
        <div><span class="sim-sum-val">${placed.toLocaleString()}</span><span class="sim-sum-lbl">Placed</span></div>
        <div><span class="sim-sum-val">${(total - placed).toLocaleString()}</span><span class="sim-sum-lbl">Unplaced</span></div>
        <div><span class="sim-sum-val">${filledSlots}</span><span class="sim-sum-lbl">Slots filled</span></div>
        <div><span class="sim-sum-val">${rows.length}</span><span class="sim-sum-lbl">Total slots</span></div>
      </div>
      <p style="margin-top:10px;font-size:0.72rem;color:var(--text-muted)">Merit basis: <strong>${esc(getActiveMarksLabel())}</strong>${SIM.sim.parentBonus ? ' · Parent institute bonus on' : ''}</p>
    </div>
    <div class="sim-grid">
      ${rows.map(r => renderSimCard(r, program)).join('')}
    </div>
  `;

  container.querySelectorAll('.sim-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.sim-card');
      const expanded = card.classList.toggle('expanded');
      btn.textContent = expanded ? '▲ Fewer' : `▼ ${btn.dataset.count} others`;
    });
  });

  // Delegate clicks on candidate rows → open placement detail modal
  container.addEventListener('click', e => {
    const el = e.target.closest('[data-sim-cand]');
    if (el) openSimCandidateDetail(el.dataset.simCand, el.dataset.simTrack);
  });
  updateSimulationDownloadGate();
}

function updateSimulationDownloadGate() {
  const btn = document.getElementById('simDownloadPdfBtn');
  const note = document.getElementById('simDownloadNote');
  if (!btn || !note) return;
  const isDonor = !!SIM.donor.current;
  const hasResult = !!SIM.sim.result;
  btn.disabled = !(isDonor && hasResult);
  note.textContent = isDonor
    ? (hasResult ? 'Watermarked to your login' : 'Run simulation first')
    : 'Supporter-only export';
}

function addPdfHeader(doc, title, reportType) {
  const email = getSessionEmail() || 'registered user';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20, 35, 55);
  doc.text('MeritNama', 42, 48);
  doc.setFontSize(13);
  doc.text(title, 42, 70);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 90, 105);
  doc.text(`Generated: ${new Date().toLocaleString('en-PK')} · Owner: ${email}`, 42, 88);
  doc.text(`Report: ${reportType}`, 42, 102);
  doc.setTextColor(150, 65, 80);
  doc.text('Private donor export. Unauthorized circulation may result in access revocation.', 42, 118);
}

function addPdfFooter(doc) {
  const email = getSessionEmail() || 'registered user';
  doc.setFontSize(8);
  doc.setTextColor(150, 65, 80);
  doc.text(`Generated for ${email}. If this report is found circulating, access may be revoked.`, 42, 810);
  doc.setTextColor(20, 35, 55);
}

function pdfText(doc, value, x, y, width) {
  const lines = doc.splitTextToSize(String(value ?? ''), width);
  doc.text(lines, x, y);
  return lines.length;
}

function drawPdfTable(doc, columns, rows, yStart, opts = {}) {
  let y = yStart;
  const left = opts.left || 42;
  const rowH = opts.rowH || 18;
  const headerH = opts.headerH || 20;
  const maxY = opts.maxY || 760;
  const title = opts.title || '';
  const reportType = opts.reportType || '';
  const tableW = columns.reduce((s, c) => s + c.w, 0);
  const repeatHeader = () => {
    doc.setFillColor(20, 35, 55);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.rect(left, y, tableW, headerH, 'F');
    let x = left + 4;
    columns.forEach(c => {
      doc.text(c.label, x, y + 13);
      x += c.w;
    });
    y += headerH;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(20, 35, 55);
  };
  const newPage = () => {
    addPdfFooter(doc);
    doc.addPage();
    if (title) addPdfHeader(doc, title, reportType);
    y = opts.pageStart || 145;
    repeatHeader();
  };
  repeatHeader();
  rows.forEach((row, idx) => {
    const lineCounts = columns.map(c => {
      const raw = typeof c.value === 'function' ? c.value(row, idx) : row[c.key];
      return doc.splitTextToSize(String(raw ?? ''), c.w - 8).length;
    });
    const h = Math.max(rowH, Math.max(...lineCounts) * 10 + 8);
    if (y + h > maxY) newPage();
    if (idx % 2 === 0) {
      doc.setFillColor(245, 248, 252);
      doc.rect(left, y, tableW, h, 'F');
    }
    doc.setDrawColor(225, 232, 242);
    doc.line(left, y + h, left + tableW, y + h);
    let x = left + 4;
    columns.forEach(c => {
      const raw = typeof c.value === 'function' ? c.value(row, idx) : row[c.key];
      pdfText(doc, raw, x, y + 12, c.w - 8);
      x += c.w;
    });
    y += h;
  });
  return y;
}

async function downloadSimulationPdf() {
  if (!SIM.donor.current) {
    showToast('PDF downloads are available for verified supporters only.', 'error');
    return;
  }
  if (!SIM.sim.result) {
    showToast('Run simulation first.', 'error');
    return;
  }
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    showToast('PDF library did not load. Check internet connection and retry.', 'error');
    return;
  }
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  addPdfHeader(doc, `Seat Allocation Simulation: ${SIM.sim.program}`, 'simulation_summary');
  let y = 145;
  const addPage = () => {
    addPdfFooter(doc);
    doc.addPage();
    addPdfHeader(doc, `Seat Allocation Simulation: ${SIM.sim.program}`, 'simulation_summary');
    y = 145;
  };
  const { seatTree, candidates } = SIM.sim.result;
  const placed = candidates.filter(c => c.placed).length;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(20, 35, 55);
  doc.text(`Placed: ${placed} · Unplaced: ${candidates.length - placed} · Merit basis: ${getActiveMarksLabel()}${SIM.sim.parentBonus ? ' · Parent bonus ON' : ''}`, 42, y);
  y += 24;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const rows = [];
  for (const [q, specs] of Object.entries(seatTree)) {
    for (const [s, hosps] of Object.entries(specs)) {
      for (const [h, sl] of Object.entries(hosps)) {
        if (!sl.candidates.length) continue;
        const cutoff = Math.min(...sl.candidates.map(c => c.marksTotal));
        rows.push({ q, s, h, sl, cutoff });
      }
    }
  }
  rows.sort((a, b) => a.s.localeCompare(b.s) || a.h.localeCompare(b.h));
  const simRows = rows.slice(0, 180).map(r => ({
    slot: `${r.s} / ${r.h}`,
    quota: r.q,
    seats: `${r.sl.candidates.length}/${r.sl.jobs}`,
    cutoff: fmtM(r.cutoff),
    selected: r.sl.candidates.slice(0, 5).map(c => `• ${c.nameFull} (${fmtM(c.marksTotal)}, P${c.preferenceNo})`).join('\n'),
  }));
  y = drawPdfTable(doc, [
    { label: 'Slot', w: 175, key: 'slot' },
    { label: 'Quota', w: 70, key: 'quota' },
    { label: 'Seats', w: 42, key: 'seats' },
    { label: 'Cutoff', w: 48, key: 'cutoff' },
    { label: 'Selected candidates', w: 215, key: 'selected' },
  ], simRows, y, { title: `Seat Allocation Simulation: ${SIM.sim.program}`, reportType: 'simulation_summary' });
  if (rows.length > 180) {
    if (y > 755) addPage();
    doc.text(`Export limited to first 180 filled slots out of ${rows.length}.`, 42, y);
  }
  addPdfFooter(doc);
  await logPdfDownload('simulation_summary');
  doc.save(`meritnama-simulation-${SIM.sim.program.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
}

function renderSimCard({ q, s, h, sl, cutoff, nextInLine, meInSlot, eligibleOthers, skippedHigherPrefCount }, program) {
  const isMe    = id => String(id) === SIM.myId;
  const seats   = sl.jobs;
  const filled  = sl.candidates.length;
  const vacancy = Math.max(0, seats - filled);

  return `<div class="sim-card ${meInSlot ? 'sim-card-me' : ''} ${vacancy > 0 ? 'sim-card-open' : ''}">
    <div class="sim-card-head">
      <div class="sim-card-title">
        <span class="sim-card-spec">${esc(s)}</span>
        <span class="sim-card-hosp">${esc(h)}</span>
        <span class="sim-card-meta">${esc(program)} &middot; ${esc(q)}</span>
      </div>
      <div class="sim-card-badges">
        <span class="sim-badge ${vacancy > 0 ? 'badge-open' : 'badge-full'}">${filled}/${seats}</span>
        ${cutoff !== null ? `<span class="sim-badge badge-cutoff">Cutoff: ${fmtM(cutoff)}</span>` : ''}
      </div>
    </div>

    <div class="sim-placed">
      ${sl.candidates.length
        ? sl.candidates.map(c => `
          <div class="sim-row ${isMe(c.applicantId) ? 'sim-row-me' : ''}" data-sim-cand="${c.applicantId}" data-sim-track="${esc(c._track)}">
            <span class="sim-row-name">${esc(c.nameFull)}${isMe(c.applicantId) ? ' <span class="me-tag">YOU</span>' : ''}</span>
            <span class="sim-row-marks">${fmtM(c.marksTotal)}</span>
            <span class="sim-row-pref">P${c.preferenceNo}</span>
          </div>`).join('')
        : '<span class="sim-empty-slot">— no placements —</span>'
      }
    </div>

    ${nextInLine ? `
    <div class="sim-next-line ${isMe(nextInLine.applicantId) ? 'sim-next-me' : ''} ${nextInLine.placed ? 'sim-next-placed-elsewhere' : ''}" data-sim-cand="${nextInLine.applicantId}" data-sim-track="${esc(nextInLine._track)}">
      <span class="sim-next-lbl">Next in line:</span>
      <span class="sim-next-name">${esc(nextInLine.nameFull)}${isMe(nextInLine.applicantId) ? ' <span class="me-tag">YOU</span>' : ''}${nextInLine.placed ? ` <span class="custom-tag">→ ${esc(nextInLine.placedAt?.s ?? '?')}</span>` : ''}</span>
      <span class="sim-next-marks">${fmtM(nextInLine.marksTotal)}</span>
    </div>` : ''}

    ${eligibleOthers.length ? `
    <button class="btn btn-sm sim-expand-btn" data-count="${eligibleOthers.length}">▼ ${eligibleOthers.length} others</button>
    <div class="sim-others">
      ${eligibleOthers.map(o => `
        <div class="sim-other-row ${isMe(o.applicantId) ? 'sim-row-me' : ''}" data-sim-cand="${o.applicantId}" data-sim-track="${esc(o._track)}">
          <span class="sim-other-name">${esc(o.nameFull)}${isMe(o.applicantId) ? ' <span class="me-tag">YOU</span>' : ''}</span>
          <span class="sim-other-marks">${fmtM(o.marksTotal)}</span>
          <span class="sim-other-status">${o.placed ? `→ ${esc(o.placedAt?.s ?? o.placedAt?.h ?? '?')}` : 'unplaced'}</span>
        </div>`).join('')}
    </div>` : ''}
    ${skippedHigherPrefCount ? `<div class="sim-empty-slot">${skippedHigherPrefCount} hidden (already placed at higher preferences)</div>` : ''}
  </div>`;
}

function runApplicantSimulation(idStr) {
  const id = String(idStr || '').trim();
  if (!id) {
    showToast('Enter an Applicant ID first.', 'warning');
    return;
  }

  const cand = allCandidates().find(c => String(c.applicantId) === id);
  if (!cand) {
    showToast(`ID ${id} not in dataset. Use "Add Manually" to add yourself.`, 'warning');
    return;
  }

  SIM.myId = id;
  localStorage.setItem(MY_ID_KEY, id);
  updateMyBadge();
  if (SIM.activeTab === 'candidates') applyAndRenderCandidates();

  const btn = document.getElementById('runApplicantSimBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Running applicant result...'; }

  setTimeout(() => {
    try {
      const programs = applicantPrograms(cand);
      const results = programs.map(program => {
        const result = runSimulationForProgram(program);
        const tracks = result
          ? result.candidates
              .filter(c => String(c.applicantId) === id)
              .sort((a, b) => trackSort(a._track) - trackSort(b._track))
              .map(workCand => ({
                track: workCand._track,
                trackLabel: workCand._trackLabel,
                workCand,
                history: buildApplicantPreferenceRows(workCand, result.seatTree),
              }))
          : [];
        return {
          program,
          result,
          tracks,
        };
      });

      renderApplicantSimulationModal(cand, results);
    } catch (e) {
      showToast(`Applicant simulation error: ${e.message}`, 'error');
      console.error(e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Run Applicant Result'; }
    }
  }, 30);
}

function applicantPrograms(cand) {
  const prefPrograms = Object.keys(cand.preference || {})
    .filter(p => (cand.preference?.[p] || []).length);
  const appliedPrograms = Object.entries(cand.applied_in || {})
    .filter(([, v]) => !!v)
    .map(([p]) => p);
  const programs = new Set();

  for (const p of appliedPrograms) {
    if (effectiveMark(cand, p) != null || prefPrograms.includes(p)) programs.add(p);
  }
  for (const p of prefPrograms) {
    const hasExplicitFlag = Object.prototype.hasOwnProperty.call(cand.applied_in || {}, p);
    if (effectiveMark(cand, p) != null || !hasExplicitFlag) programs.add(p);
  }

  const order = ['FCPS', 'FCPS Dentistry', 'MS', 'MD', 'MDS'];
  return [...programs].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b);
  });
}

function buildApplicantPreferenceRows(workCand, seatTree) {
  const placedPref = workCand.placed
    ? workCand._prefs.find(p => sameSlot(p, workCand._q, workCand._s, workCand._h))
    : null;
  const placedPrefNo = placedPref?.preferenceNo ?? Infinity;

  return workCand._prefs.map(pref => {
    const sl = seatTree?.[pref.quotaName]?.[pref.specialityName]?.[pref.hospitalName] || null;
    const score = scoreForPreference(workCand, pref);
    const cutoff = sl?.candidates?.length
      ? Math.min(...sl.candidates.map(c => c.marksTotal))
      : null;
    const isPlacedHere = workCand.placed && sameSlot(pref, workCand._q, workCand._s, workCand._h);
    let status = 'beaten';
    if (!sl) status = 'no_slot';
    else if (isPlacedHere) status = 'placed';
    else if (pref.preferenceNo > placedPrefNo) status = 'not_attempted';
    else if (cutoff == null) status = 'no_cutoff';

    return {
      pref,
      status,
      score,
      cutoff,
      delta: cutoff == null ? null : score - cutoff,
      filled: sl?.candidates?.length ?? 0,
      seats: sl?.jobs ?? null,
    };
  });
}

function scoreForPreference(workCand, pref) {
  const program = workCand._program || SIM.sim.program;
  const mark = workCand._source
    ? effectiveMark(workCand._source, program, undefined, undefined, pref)
    : workCand.marksTotal;
  return (mark ?? workCand.marksTotal ?? 0) + (SIM.sim.parentBonus ? (pref.marks || 0) : 0);
}

function sameSlot(pref, quota, spec, hosp) {
  return pref.quotaName === quota && pref.specialityName === spec && pref.hospitalName === hosp;
}

function renderApplicantSimulationModal(cand, results) {
  const modal = document.getElementById('appSimModal');
  const body  = document.getElementById('appSimModalBody');
  if (!modal || !body) return;
  SIM.sim.applicantReport = { cand, results };

  const validResults = results.filter(r => r.result && r.tracks.length);
  const trackResults = validResults.flatMap(r => r.tracks);
  const placedCount = trackResults.filter(r => r.workCand.placed).length;
  const trackCount = trackResults.length;
  const prefCount = trackResults.reduce((sum, r) => sum + r.history.length, 0);
  const skippedPrograms = results.filter(r => !r.result || !r.tracks.length).map(r => r.program);

  body.innerHTML = `
    <div class="app-sim-modal-head">
      <div>
        <h3>Applicant simulation result</h3>
        <p class="app-sim-meta">
          ${esc(cand.nameFull)} &middot; ID: ${esc(cand.applicantId)}
          &middot; Merit basis: <strong>${esc(getActiveMarksLabel())}</strong>
          &middot; Base marks: <strong>${fmtM(baseMarks(cand))}</strong>
          &middot; Portal marksTotal: <strong>${fmtM(cand.marksTotal)}</strong>
          &middot; Parent bonus: <strong>${SIM.sim.parentBonus ? 'On' : 'Off'}</strong>
        </p>
      </div>
      <div class="app-sim-summary-pills">
        <span class="app-sim-pill ${placedCount ? 'placed' : 'unplaced'}">${placedCount}/${trackCount || 0} tracks placed</span>
        <span class="app-sim-pill">${prefCount} preferences checked</span>
        <span class="app-sim-pill">${SIM.seatsLoaded ? 'Seat data loaded' : 'Fallback seats'}</span>
      </div>
    </div>
    ${skippedPrograms.length ? `
      <div class="sim-my unplaced" style="margin-bottom:12px">
        No runnable candidate pool found for: ${skippedPrograms.map(esc).join(', ')}.
      </div>` : ''}
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:0 0 1rem;">
      <button class="btn btn-sm btn-primary" id="appSimDownloadPdfBtn" ${SIM.donor.current ? '' : 'disabled'}>Download applicant PDF</button>
      <span style="font-size:0.74rem;color:var(--text-muted);align-self:center;">${SIM.donor.current ? 'Watermarked to your login' : 'Supporter-only export'}</span>
    </div>
    <div class="app-sim-programs">
      ${validResults.length
        ? validResults.map(renderApplicantProgramCard).join('')
        : '<div class="app-sim-empty">No applied programs with preferences were found for this Applicant ID.</div>'}
    </div>
  `;

  modal.classList.remove('hidden');
  body.querySelector('#appSimDownloadPdfBtn')?.addEventListener('click', downloadApplicantSimulationPdf);
}

async function downloadApplicantSimulationPdf() {
  if (!SIM.donor.current) {
    showToast('PDF downloads are available for verified supporters only.', 'error');
    return;
  }
  const report = SIM.sim.applicantReport;
  if (!report?.cand) {
    showToast('Run applicant result first.', 'error');
    return;
  }
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    showToast('PDF library did not load. Check internet connection and retry.', 'error');
    return;
  }
  const { cand, results } = report;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  addPdfHeader(doc, `Applicant Result: ${cand.nameFull}`, 'applicant_result');
  let y = 145;
  const addPage = () => {
    addPdfFooter(doc);
    doc.addPage();
    addPdfHeader(doc, `Applicant Result: ${cand.nameFull}`, 'applicant_result');
    y = 145;
  };
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`Applicant ID: ${cand.applicantId} · Merit basis: ${getActiveMarksLabel()}${SIM.sim.parentBonus ? ' · Parent bonus ON' : ''}`, 42, y);
  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const validResults = results.filter(r => r.result && r.tracks.length);
  if (!validResults.length) {
    doc.text('No applied programs with preferences were found for this applicant.', 42, y);
  }
  validResults.forEach(programResult => {
    if (y > 735) addPage();
    doc.setFont('helvetica', 'bold');
    doc.text(programResult.program, 42, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    programResult.tracks.forEach(track => {
      if (y > 735) addPage();
      const wc = track.workCand;
      const placement = wc.placed
        ? `${wc._trackLabel}: placed at ${wc._s} / ${wc._h} (${wc._q})`
        : `${wc._trackLabel}: not placed`;
      doc.text(doc.splitTextToSize(placement, 510), 54, y);
      y += 13;
      const prefRows = track.history.slice(0, 12).map(row => ({
        prefNo: row.pref.preferenceNo,
        slot: `${row.pref.specialityName} @ ${row.pref.hospitalName.split(',')[0]}`,
        score: fmtM(row.score),
        cutoff: fmtM(row.cutoff),
        margin: formatApplicantDelta(row.delta, row.status),
        status: applicantStatusLabel(row.status),
      }));
      y = drawPdfTable(doc, [
        { label: 'Pref', w: 32, key: 'prefNo' },
        { label: 'Slot', w: 205, key: 'slot' },
        { label: 'Score', w: 48, key: 'score' },
        { label: 'Cutoff', w: 48, key: 'cutoff' },
        { label: 'Margin', w: 78, key: 'margin' },
        { label: 'Status', w: 88, key: 'status' },
      ], prefRows, y, { title: `Applicant Result: ${cand.nameFull}`, reportType: 'applicant_result', pageStart: 145 });
      y += 8;
    });
  });
  addPdfFooter(doc);
  await logPdfDownload('applicant_result');
  doc.save(`meritnama-applicant-${cand.applicantId}.pdf`);
}

function renderApplicantProgramCard(programResult) {
  const { program, tracks } = programResult;
  const placedCount = tracks.filter(t => t.workCand.placed).length;

  return `<div class="app-sim-program-card ${placedCount ? 'is-placed' : 'is-unplaced'}">
    <div class="app-sim-program-head">
      <div>
        <div class="app-sim-program-title">${esc(program)}</div>
        <div class="app-sim-program-result"><strong>${placedCount ? 'Projected placement' : 'No placement'}:</strong> ${placedCount}/${tracks.length} quota tracks placed</div>
      </div>
      <span class="app-sim-pill ${placedCount ? 'placed' : 'unplaced'}">${placedCount ? `${placedCount} placed` : 'Unplaced'}</span>
    </div>
    ${tracks.map(renderApplicantTrackSection).join('')}
  </div>`;
}

function renderApplicantTrackSection(trackResult) {
  const { workCand, history, trackLabel } = trackResult;
  const placed = workCand.placed;
  const placedRow = history.find(r => r.status === 'placed');
  const bestMiss = history
    .filter(r => r.status === 'beaten' && r.delta != null)
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
  const shortfall = bestMiss ? Math.max(0, -bestMiss.delta) : null;
  const resultText = placed && placedRow
    ? `Placed at preference #${placedRow.pref.preferenceNo}: ${esc(placedRow.pref.specialityName)} @ ${esc(shortHospital(placedRow.pref.hospitalName))}`
    : bestMiss
    ? `Not placed; closest shown cutoff shortfall is ${fmtM(shortfall)} marks.`
    : 'Not placed in recorded preferences.';

  return `<div class="app-sim-track-section ${placed ? 'is-placed' : 'is-unplaced'}">
    <div class="app-sim-track-head">
      <div><strong>${esc(trackLabel)} placement</strong><span>${resultText}</span></div>
      <span class="app-sim-pill ${placed ? 'placed' : 'unplaced'}">${placed ? 'Placed' : 'Unplaced'}</span>
    </div>
    ${placed ? '<div class="app-sim-program-note">One final seat is allocated in this quota track. Lower preferences may still show that the applicant would clear the cutoff, but they are skipped after this earlier track placement.</div>' : ''}
    <div class="app-sim-pref-list">
      <div class="app-sim-pref-row app-sim-pref-head">
        <span>Pref</span><span>Slot</span><span>Your marks</span><span>Cutoff</span><span>Margin</span><span>Status</span>
      </div>
      ${history.length ? history.map(renderApplicantPreferenceRow).join('') : '<div class="app-sim-empty">No preferences recorded for this quota track.</div>'}
    </div>
  </div>`;
}

function renderApplicantPreferenceRow(row) {
  const { pref, status, score, cutoff, delta } = row;
  const statusLabel = applicantStatusLabel(status);
  const deltaClass = delta == null ? '' : (delta >= 0 ? 'good' : 'bad');
  return `<div class="app-sim-pref-row status-${esc(status)}">
    <span class="app-sim-pref-no">#${pref.preferenceNo}</span>
    <div class="app-sim-pref-slot">
      <span class="app-sim-pref-spec">${esc(pref.specialityName)}</span>
      <span class="app-sim-pref-hosp">${esc(pref.hospitalName)}</span>
      <span class="app-sim-pref-quota">${esc(pref.quotaName)}${row.seats != null ? ` &middot; ${row.filled}/${row.seats} seats` : ''}</span>
    </div>
    <span class="app-sim-num">${fmtM(score)}</span>
    <span class="app-sim-num">${fmtM(cutoff)}</span>
    <span class="app-sim-delta ${deltaClass}">${formatApplicantDelta(delta, status)}</span>
    <span class="app-sim-status ${esc(status)}">${statusLabel}</span>
  </div>`;
}

function applicantStatusLabel(status) {
  if (status === 'placed') return 'Placed';
  if (status === 'beaten') return 'Fell short';
  if (status === 'not_attempted') return 'Skipped';
  if (status === 'no_cutoff') return 'No cutoff';
  return 'No seats';
}

function formatApplicantDelta(delta, status) {
  if (delta == null) return '—';
  if (status === 'not_attempted') {
    return delta >= 0 ? `Would clear +${fmtM(delta)}` : `Would short ${fmtM(Math.abs(delta))}`;
  }
  if (status === 'beaten' && delta < 0) return `Short ${fmtM(Math.abs(delta))}`;
  return `${delta >= 0 ? '+' : '-'}${fmtM(Math.abs(delta))}`;
}

function shortHospital(hospitalName) {
  return String(hospitalName || '').split(',')[0].trim();
}

function closeApplicantSimulationModal() {
  document.getElementById('appSimModal')?.classList.add('hidden');
}
