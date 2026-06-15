// ═══════════════════════════════════════════════════════════════════
// SLOT BROWSER
// ═══════════════════════════════════════════════════════════════════
function setupSlotBrowser() {
  const programs = new Set();
  SIM.candidates.forEach(c => Object.keys(c.preference || {}).forEach(p => programs.add(p)));
  if (SIM.customCand) Object.keys(SIM.customCand.preference || {}).forEach(p => programs.add(p));

  const progSel = document.getElementById('sbProgram');
  [...programs].sort().forEach(p => {
    const o = document.createElement('option');
    o.value = p; o.textContent = p;
    progSel?.appendChild(o);
  });

  progSel?.addEventListener('change', e => {
    SIM.sb.program = e.target.value;
    SIM.sb.quota = SIM.sb.spec = SIM.sb.hosp = '';
    refreshSbDropdowns();
    renderSlot();
  });

  document.getElementById('sbQuota')?.addEventListener('change', e => {
    SIM.sb.quota = e.target.value;
    SIM.sb.spec = SIM.sb.hosp = '';
    refreshSbDropdowns('quota');
    renderSlot();
  });

  document.getElementById('sbSpec')?.addEventListener('change', e => {
    SIM.sb.spec = e.target.value;
    SIM.sb.hosp = '';
    refreshSbDropdowns('spec');
    renderSlot();
  });

  document.getElementById('sbHosp')?.addEventListener('change', e => {
    SIM.sb.hosp = e.target.value;
    renderSlot();
  });

  // Default to FCPS
  if (programs.has('FCPS')) {
    progSel.value = 'FCPS';
    SIM.sb.program = 'FCPS';
    refreshSbDropdowns();
  }

  setupSbCandSearch();
  setupSbPdfExport();
  updateSbDownloadGate();
}

function refreshSbDropdowns(from) {
  const prog = SIM.sb.program;
  if (!prog) return;

  // Candidate-preference entries for this program
  const entries = [];
  allCandidates().forEach(c => (c.preference?.[prog] || []).forEach(p => entries.push(p)));

  // Seats-data entries for this program (may include quotas/specs/hosps absent from candidate prefs)
  const seatRows = SIM.seatsLoaded ? SIM.flatSeats.filter(s => s.typeName === prog) : [];

  if (!from || from === 'program') {
    const candQ = new Set(entries.map(e => e.quotaName));
    const seatQ = new Set(seatRows.map(s => s.quotaName));
    const quotas = [...new Set([...candQ, ...seatQ])].filter(Boolean).sort();
    fillSelect('sbQuota', quotas, SIM.sb.quota, '— Quota —');
  }

  const byQ     = SIM.sb.quota ? entries.filter(e => e.quotaName === SIM.sb.quota) : entries;
  const byQSeat = SIM.sb.quota ? seatRows.filter(s => s.quotaName === SIM.sb.quota) : seatRows;
  if (!from || from === 'program' || from === 'quota') {
    const candS = new Set(byQ.map(e => e.specialityName));
    const seatS = new Set(byQSeat.map(s => s.specialityName));
    const specs = [...new Set([...candS, ...seatS])].filter(Boolean).sort();
    fillSelect('sbSpec', specs, SIM.sb.spec, '— Specialty —');
  }

  const byQS     = SIM.sb.spec ? byQ.filter(e => e.specialityName === SIM.sb.spec) : byQ;
  const byQSSeat = SIM.sb.spec ? byQSeat.filter(s => s.specialityName === SIM.sb.spec) : byQSeat;
  if (!from || from === 'program' || from === 'quota' || from === 'spec') {
    const candH = new Set(byQS.map(e => e.hospitalName));
    const seatH = new Set(byQSSeat.map(s => s.hospitalName));
    const hosps = [...new Set([...candH, ...seatH])].filter(Boolean).sort();
    fillSelect('sbHosp', hosps, SIM.sb.hosp, '— Hospital —');
  }
}

function fillSelect(id, options, selected, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    options.map(v => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
}

function jumpToSlot(prog, quota, spec, hosp) {
  // Switch to Slot Browser tab and pre-fill dropdowns
  document.querySelector('.tab-btn[data-tab="slotbrowser"]')?.click();
  SIM.sb.program = prog; SIM.sb.quota = quota; SIM.sb.spec = spec; SIM.sb.hosp = hosp;
  const progSel = document.getElementById('sbProgram');
  if (progSel) progSel.value = prog;
  refreshSbDropdowns();
  renderSlot();
}

function buildSimCandidateMap(program) {
  if (!SIM.sim.result || SIM.sim.program !== program) return null;
  const simMap = {};
  for (const sc of SIM.sim.result.candidates) {
    simMap[simRecordKey(sc.applicantId, sc._track)] = sc;
  }
  return simMap;
}

function annotateApplicantWithSim(a, quota, spec, hosp, simMap) {
  if (!simMap) return;
  const slotTrack = quotaTrack(quota);
  const sc = simMap[simRecordKey(a.applicantId, slotTrack)];
  if (!sc) { a._simStatus = null; return; }
  if (sc.placed && sc._q === quota && sc._s === spec && sc._h === hosp) {
    a._simStatus = 'selected';
  } else if (sc.placed) {
    const placedPref = sc._prefs?.find(
      p => p.quotaName === sc._q && p.specialityName === sc._s && p.hospitalName === sc._h
    );
    a._simStatus = (placedPref && placedPref.preferenceNo < a.preferenceNo)
      ? 'higher-pref' : 'elsewhere';
    a._placedAt = `${sc._s} @ ${sc._h.split(',')[0].trim()}`;
  } else {
    a._simStatus = 'unplaced';
  }
}

function getSimSlotData(quota, spec, hosp) {
  const sl = SIM.sim.result?.seatTree?.[quota]?.[spec]?.[hosp];
  if (!sl) return { selected: [], cutoff: null };
  const selected = sl.candidates || [];
  const cutoff = selected.length ? Math.min(...selected.map(c => c.marksTotal)) : null;
  return { selected, cutoff };
}

function buildSimDisplayList(applicants, useSimData) {
  if (!useSimData) return applicants;
  const selectedGroup = applicants.filter(a => a._simStatus === 'selected');
  const restGroup     = applicants.filter(a => a._simStatus !== 'selected');
  return selectedGroup.length ? [...selectedGroup, ...restGroup] : applicants;
}

function renderSbSimTag(a) {
  if (a._simStatus === 'higher-pref') {
    return `<span class="sb-sim-tag sb-sim-elsewhere" title="Placed at higher-preference: ${esc(a._placedAt || '')}">↑ higher pref</span>`;
  }
  if (a._simStatus === 'elsewhere') {
    return `<span class="sb-sim-tag sb-sim-elsewhere" title="Placed elsewhere: ${esc(a._placedAt || '')}">placed elsewhere</span>`;
  }
  if (a._simStatus === 'selected') {
    return `<span class="sb-sim-tag sb-sim-selected">✓ selected</span>`;
  }
  return '';
}

function formatGroupCutoffBadge(slots, quota) {
  const cutoffs = slots
    .map(sl => getSimSlotData(quota, sl.spec, sl.hosp).cutoff)
    .filter(c => c != null);
  if (!cutoffs.length) return '';
  const min = Math.min(...cutoffs);
  const max = Math.max(...cutoffs);
  const label = min === max ? fmtM(min) : `${fmtM(min)}–${fmtM(max)}`;
  return `<span class="sim-badge badge-cutoff sb-partial-cutoff">Cutoff: ${label}</span>`;
}

function setupSbPdfExport() {
  document.getElementById('sbDownloadPdfBtn')?.addEventListener('click', downloadWhereMeritFallsPdf);
}

function updateSbDownloadGate() {
  const btn = document.getElementById('sbDownloadPdfBtn');
  const note = document.getElementById('sbDownloadNote');
  const donate = document.getElementById('sbDonateLink');
  if (!btn || !note) return;
  const hasFilters = !!(SIM.sb.program && SIM.sb.quota);
  const isDonor = !!SIM.donor.current;
  btn.disabled = !(hasFilters && isDonor);
  if (!hasFilters) {
    note.textContent = 'Choose programme and quota to prepare a PDF report.';
  } else if (!isDonor) {
    note.textContent = 'PDF downloads are available for verified supporters only. Your report will be watermarked to your login.';
  } else {
    const donor = SIM.donor.current;
    note.textContent = `Supporter access active (${donor.count} contribution${donor.count !== 1 ? 's' : ''}). PDF will be watermarked to your login.`;
  }
  if (donate) donate.style.display = isDonor ? 'none' : '';
}

function sbCurrentTitle() {
  const { program, quota, spec, hosp } = SIM.sb;
  return [program, quota, spec, hosp].filter(Boolean).join(' / ');
}

function getSlotReportRows() {
  const { program, quota, spec, hosp } = SIM.sb;
  if (!program || !quota) return [];
  const useSimData = !!(SIM.sim.result && SIM.sim.program === program);

  if (spec && hosp) {
    const applicants = [];
    allCandidates().forEach(c => {
      const em = effectiveMark(c, program);
      if (em == null) return;
      const pref = (c.preference?.[program] || []).find(
        p => p.quotaName === quota && p.specialityName === spec && p.hospitalName === hosp
      );
      if (!pref) return;
      applicants.push({
        applicantId: c.applicantId,
        nameFull: c.nameFull,
        emailId: candidateEmail(c),
        marksTotal: em,
        preferenceNo: pref.preferenceNo,
      });
    });
    applicants.sort((a, b) => b.marksTotal - a.marksTotal);
    applicants.forEach((a, i) => { a._meritRank = i + 1; });
    const simMap = useSimData ? buildSimCandidateMap(program) : null;
    if (simMap) applicants.forEach(a => annotateApplicantWithSim(a, quota, spec, hosp, simMap));
    return applicants.map(a => ({
      rank: a._meritRank,
      name: a.nameFull,
      marks: fmtM(a.marksTotal),
      pref: a.preferenceNo,
      status: a._simStatus === 'selected' ? 'Selected' : a._simStatus === 'higher-pref' ? 'Higher pref' : a._simStatus === 'elsewhere' ? 'Placed elsewhere' : '',
      note: a._simStatus === 'higher-pref'
        ? 'Do not count here; selected at higher preference'
        : a._simStatus === 'elsewhere'
          ? 'Do not count here; selected elsewhere'
          : a._simStatus === 'selected'
            ? 'Counts in this slot'
            : '',
      supporter: candidateEmail(a) && SIM.donor.byEmail.has(candidateEmail(a)) ? 'Supporter' : '',
    }));
  }

  const rows = [];
  const groups = new Map();
  allCandidates().forEach(c => {
    const em = effectiveMark(c, program);
    if (em == null) return;
    (c.preference?.[program] || []).forEach(p => {
      if (p.quotaName !== quota) return;
      if (spec && p.specialityName !== spec) return;
      if (hosp && p.hospitalName !== hosp) return;
      const key = spec ? p.hospitalName : p.specialityName;
      if (!groups.has(key)) groups.set(key, { key, applicants: [], selected: 0, cutoff: null });
      groups.get(key).applicants.push({ candidate: c, pref: p, marksTotal: em });
    });
  });
  const useSim = useSimData ? buildSimCandidateMap(program) : null;
  for (const grp of groups.values()) {
    grp.applicants.sort((a, b) => b.marksTotal - a.marksTotal);
    if (useSim) {
      const selected = grp.applicants.filter(row => {
        const a = { applicantId: row.candidate.applicantId };
        annotateApplicantWithSim(a, quota, row.pref.specialityName, row.pref.hospitalName, useSim);
        return a._simStatus === 'selected';
      });
      grp.selected = selected.length;
      grp.cutoff = selected.length ? Math.min(...selected.map(s => s.marksTotal)) : null;
    }
    rows.push({
      group: grp.key,
      applicants: grp.applicants.length,
      selected: grp.selected || '',
      cutoff: grp.cutoff != null ? fmtM(grp.cutoff) : '',
      top: grp.applicants.slice(0, 3).map(a => `• ${a.candidate.nameFull} (${fmtM(a.marksTotal)})`).join('\n'),
    });
  }
  return rows.sort((a, b) => String(a.group).localeCompare(String(b.group)));
}

async function logPdfDownload(reportType) {
  try {
    await firebase.firestore().collection('download_logs').add({
      email: getSessionEmail() || '',
      reportType,
      filters: { ...SIM.sb },
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      userAgent: navigator.userAgent.substring(0, 200),
    });
  } catch (_) {}
}

async function downloadWhereMeritFallsPdf() {
  if (!SIM.donor.current) {
    showToast('PDF downloads are available for verified supporters only.', 'error');
    return;
  }
  if (!SIM.sb.program || !SIM.sb.quota) {
    showToast('Select programme and quota first.', 'error');
    return;
  }
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    showToast('PDF library did not load. Check internet connection and retry.', 'error');
    return;
  }
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const email = getSessionEmail() || 'registered user';
  const rows = getSlotReportRows();
  const title = `Where Merit Falls: ${sbCurrentTitle()}`;
  const generated = new Date().toLocaleString('en-PK');
  let y = 48;
  const left = 42;
  const maxY = 760;

  const addFooter = () => {
    doc.setFontSize(8);
    doc.setTextColor(150, 65, 80);
    doc.text(`Generated for ${email}. If this report is found circulating, access may be revoked.`, left, 810);
    doc.setTextColor(205, 215, 230);
  };
  const addPageIfNeeded = (need = 24) => {
    if (y + need <= maxY) return;
    addFooter();
    doc.addPage();
    y = 48;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20, 35, 55);
  doc.text('MeritNama', left, y);
  y += 22;
  doc.setFontSize(13);
  doc.text(title, left, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 90, 105);
  doc.text(`Generated: ${generated}`, left, y);
  y += 14;
  doc.text(`Report owner: ${email}`, left, y);
  y += 18;
  doc.setTextColor(150, 65, 80);
  doc.text('Private donor export. Unauthorized circulation may result in access revocation.', left, y);
  y += 24;

  doc.setTextColor(20, 35, 55);
  doc.setFont('helvetica', 'bold');
  doc.text(SIM.sb.spec && SIM.sb.hosp ? 'Applicants' : 'Grouped cutoff summary', left, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(90, 100, 115);
  doc.text(doc.splitTextToSize('Status guide: Selected = predicted to occupy this slot. Higher pref / Placed elsewhere candidates should not be counted as active competitors here after simulation de-duplication.', 510), left, y);
  y += 26;
  doc.setTextColor(20, 35, 55);
  if (!rows.length) {
    doc.text('No rows match this filter.', left, y);
  } else if (SIM.sb.spec && SIM.sb.hosp) {
    y = drawPdfTable(doc, [
      { label: '#', w: 28, key: 'rank' },
      { label: 'Name', w: 150, key: 'name' },
      { label: 'Marks', w: 46, key: 'marks' },
      { label: 'Pref', w: 36, key: 'pref' },
      { label: 'Status', w: 82, key: 'status' },
      { label: 'How to count', w: 155, key: 'note' },
      { label: 'Support', w: 55, key: 'supporter' },
    ], rows, y, { title, reportType: 'where_merit_falls' });
  } else {
    y = drawPdfTable(doc, [
      { label: 'Group', w: 150, key: 'group' },
      { label: 'Applicants', w: 58, key: 'applicants' },
      { label: 'Selected', w: 54, value: r => r.selected || 'Run sim' },
      { label: 'Cutoff', w: 52, value: r => r.cutoff || '—' },
      { label: 'Top applicants', w: 238, key: 'top' },
    ], rows, y, { title, reportType: 'where_merit_falls' });
  }
  addFooter();
  await logPdfDownload('where_merit_falls');
  const slug = sbCurrentTitle().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  doc.save(`meritnama-${slug || 'where-merit-falls'}.pdf`);
}

function renderSlot() {
  const { program, quota, spec, hosp } = SIM.sb;
  const container = document.getElementById('sbResult');
  if (!container) return;
  updateSbDownloadGate();

  if (!program || !quota) {
    container.innerHTML = '<p class="sb-placeholder">Select a programme and quota above (specialty and hospital are optional) to see applicants.</p>';
    return;
  }
  if (!spec || !hosp) {
    renderPartialSlot();
    return;
  }

  const applicants = [];
  allCandidates().forEach(c => {
    // Skip candidates who did not apply in this program (programMarks === 0)
    const em = effectiveMark(c, program);
    if (em == null) return;
    const pref = (c.preference?.[program] || []).find(
      p => p.quotaName === quota && p.specialityName === spec && p.hospitalName === hosp
    );
    if (pref) {
      applicants.push({
        applicantId:     c.applicantId,
        nameFull:        c.nameFull,
        emailId:         candidateEmail(c),
        marksTotal:      em,
        preferenceNo:    pref.preferenceNo,
        parentInstitute: pref.parentInstitute,
        _custom:         c._custom,
      });
    }
  });

  applicants.sort((a, b) => b.marksTotal - a.marksTotal);
  applicants.forEach((a, i) => { a._meritRank = i + 1; });

  // ── Simulation overlay ─────────────────────────────────────────
  const useSimData = !!(SIM.sim.result && SIM.sim.program === program);
  const simMap     = useSimData ? buildSimCandidateMap(program) : null;
  if (simMap) {
    for (const a of applicants) annotateApplicantWithSim(a, quota, spec, hosp, simMap);
  }

  const selectedGroup = useSimData ? applicants.filter(a => a._simStatus === 'selected') : [];
  const displayList   = buildSimDisplayList(applicants, useSimData);
  const simCutoff     = useSimData ? getSimSlotData(quota, spec, hosp).cutoff : null;

  const seats   = SIM.seats?.[program]?.[quota]?.[spec]?.[hosp] ?? null;
  const isMe    = id => String(id) === SIM.myId;
  const myPos   = SIM.myId ? applicants.findIndex(a => isMe(a.applicantId)) + 1 : 0;
  // Effective applicants excludes those already placed at a higher-preference slot
  const effectiveCount = useSimData
    ? applicants.filter(a => a._simStatus !== 'higher-pref').length
    : applicants.length;
  const ratio = seats ? (effectiveCount / seats).toFixed(1) : null;

  container.innerHTML = `
    <div class="sb-header">
      <div class="sb-title-block">
        <span class="sb-spec">${esc(spec)}</span>
        <span class="sb-hosp">${esc(hosp)}</span>
        <span class="sb-meta">${esc(program)} &middot; ${esc(quota)}</span>
      </div>
      <div class="sb-stats">
        <div class="sb-stat">
          <span class="sb-stat-v">${applicants.length}${useSimData && effectiveCount !== applicants.length ? `<span class="sb-eff-count"> (${effectiveCount} eff.)</span>` : ''}</span>
          <span class="sb-stat-l">Applicants</span>
        </div>
        <div class="sb-stat ${seats === null ? 'sb-stat-unknown' : ''}">
          <span class="sb-stat-v">${seats ?? '?'}</span>
          <span class="sb-stat-l">Seats</span>
        </div>
        ${ratio ? `<div class="sb-stat"><span class="sb-stat-v">${ratio}:1</span><span class="sb-stat-l">Competition</span></div>` : ''}
        ${simCutoff != null ? `<div class="sb-stat"><span class="sb-stat-v">${fmtM(simCutoff)}</span><span class="sb-stat-l">Sim. cutoff</span></div>` : ''}
        ${myPos ? `<div class="sb-stat sb-stat-me"><span class="sb-stat-v">#${myPos}</span><span class="sb-stat-l">Your rank</span></div>` : ''}
      </div>
    </div>
    ${useSimData
      ? `<p class="sb-sim-note">Simulation active &mdash; &#10003; selected candidates and merit cutoff shown. Dimmed = placed at a higher-preference slot.</p>`
      : `<p class="sb-sim-note sb-merit-hint">&#9432; Sorted by marks only &mdash; run the <strong>Simulation</strong> tab for merit-accurate predictions.</p>`}
    ${!SIM.seatsLoaded ? '<p class="sb-no-seats">⚠️ Seat count not loaded — cutoff line unavailable.</p>' : ''}
    <div class="sb-list">
      ${(() => {
        if (!displayList.length) return '<p class="sb-empty">No applicants listed this slot.</p>';
        const rows = [];
        let cutoffShown = false;
        displayList.forEach((a, di) => {
          if (di === 0 && selectedGroup.length)
            rows.push(`<div class="sb-section-hdr sb-section-sel"><span>&#10003; Selected by simulation</span></div>`);
          if (di === selectedGroup.length && selectedGroup.length)
            rows.push(`<div class="sb-section-hdr"><span>All applicants by merit</span></div>`);
          if (!cutoffShown) {
            if (useSimData && selectedGroup.length && di === selectedGroup.length) {
              cutoffShown = true;
              const cutoffLabel = simCutoff != null ? fmtM(simCutoff) : 'simulation cutoff';
              rows.push(`<div class="sb-cutoff"><span>─── Merit closes here (${cutoffLabel}) ───</span></div>`);
            } else if (!useSimData && seats && a._meritRank > seats) {
              cutoffShown = true;
              rows.push(`<div class="sb-cutoff"><span>─── Merit closes here (estimated) ───</span></div>`);
            }
          }
          const topN      = seats != null;
          const elsewhere = a._simStatus === 'higher-pref' || a._simStatus === 'elsewhere';
          const selected  = a._simStatus === 'selected';
          const above     = useSimData ? selected : (topN && a._meritRank <= seats && !elsewhere);
          const me        = isMe(a.applicantId);
          const searched  = SIM.sb.candidateId && String(a.applicantId) === SIM.sb.candidateId;
          const simTag    = renderSbSimTag(a);
          rows.push(`<div class="sb-row ${above ? 'sb-above' : topN && !elsewhere ? 'sb-below' : ''} ${me ? 'sb-row-me' : ''} ${searched ? 'sb-row-search' : ''} ${elsewhere ? 'sb-row-elsewhere' : ''} ${selected ? 'sb-row-selected' : ''}" data-cand-id="${a.applicantId}">
            <span class="sb-rank">#${a._meritRank}</span>
            <span class="sb-pref-no">Pref ${a.preferenceNo}</span>
            ${a.parentInstitute ? '<span class="sb-parent">⭐</span>' : '<span></span>'}
            <span class="sb-name">${esc(a.nameFull)}${supporterBadgeForCandidate(a)}${me ? ' <span class="me-tag">YOU</span>' : ''}${a._custom ? ' <span class="custom-tag">manual</span>' : ''}${searched && !me ? ' <span class="custom-tag">↑ found</span>' : ''}${simTag}</span>
            <span class="sb-marks">${fmtM(a.marksTotal)}</span>
          </div>`);
        });
        return rows.join('');
      })()}
    </div>
  `;

  // Candidate row click → modal
  container.querySelectorAll('.sb-row[data-cand-id]').forEach(row => {
    row.addEventListener('click', () => showSbCandQuickView(row.dataset.candId));
  });
  // Refresh modal if already open (slot context may have changed)
  if (SIM.sb.clickedCandId) renderSbQuickViewContent();
}

// ═══════════════════════════════════════════════════════════════════
// SLOT BROWSER — partial view (prog + quota, spec and/or hosp optional)
// ═══════════════════════════════════════════════════════════════════
function renderPartialSlot() {
  const { program, quota, spec, hosp } = SIM.sb;
  const container = document.getElementById('sbResult');
  if (!container) return;

  const useSimData = !!(SIM.sim.result && SIM.sim.program === program);

  // Determine grouping dimension
  // spec set → group by hospital | hosp set → group by specialty | neither → group by specialty
  const groupKey   = spec ? 'hospitalName' : 'specialityName';
  const groupLabel = spec ? 'Hospital'     : 'Specialty';

  // Collect groups from seats data first
  const groupMap = new Map();
  const seatRows = SIM.flatSeats.filter(s =>
    s.typeName  === program &&
    s.quotaName === quota &&
    (!spec || s.specialityName === spec) &&
    (!hosp || s.hospitalName   === hosp)
  );
  for (const s of seatRows) {
    const key = s[groupKey];
    if (!groupMap.has(key)) groupMap.set(key, { key, seats: 0, slots: [] });
    const g = groupMap.get(key);
    g.seats += s.seats;
    g.slots.push({ spec: s.specialityName, hosp: s.hospitalName, seats: s.seats });
  }

  // Supplement with candidate-preference slots not in seats
  allCandidates().forEach(c => {
    const em = effectiveMark(c, program);
    if (em == null) return;
    (c.preference?.[program] || []).forEach(p => {
      if (p.quotaName !== quota) return;
      if (spec && p.specialityName !== spec) return;
      if (hosp && p.hospitalName  !== hosp) return;
      const key = p[groupKey];
      if (!groupMap.has(key)) groupMap.set(key, { key, seats: 0, slots: [] });
    });
  });

  // Build applicant list per group
  for (const [, grp] of groupMap) {
    const applicants = [];
    allCandidates().forEach(c => {
      const em = effectiveMark(c, program);
      if (em == null) return;
      const matched = (c.preference?.[program] || []).find(p =>
        p.quotaName === quota &&
        (!spec || p.specialityName === spec) &&
        (!hosp || p.hospitalName   === hosp) &&
        p[groupKey] === grp.key
      );
      if (matched) {
        applicants.push({
          applicantId:     c.applicantId,
          nameFull:        c.nameFull,
          emailId:         candidateEmail(c),
          marksTotal:      em,
          preferenceNo:    matched.preferenceNo,
          slotSpec:        matched.specialityName,
          slotHosp:        matched.hospitalName,
          parentInstitute: matched.parentInstitute,
        });
      }
    });
    applicants.sort((a, b) => b.marksTotal - a.marksTotal);
    applicants.forEach((a, i) => { a._meritRank = i + 1; });
    grp.applicants = applicants;
  }

  const groups   = [...groupMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const isMe     = id => String(id) === SIM.myId;
  const simMap   = useSimData ? buildSimCandidateMap(program) : null;

  if (simMap) {
    for (const grp of groups) {
      for (const a of grp.applicants) {
        annotateApplicantWithSim(a, quota, a.slotSpec, a.slotHosp, simMap);
      }
    }
  }

  const totalSeats = groups.reduce((s, g) => s + g.seats, 0);

  let html = `
    <div class="sb-header">
      <div class="sb-title-block">
        <span class="sb-spec">${spec ? esc(spec) : hosp ? esc(hosp) : esc(program) + ' \u00b7 ' + esc(quota)}</span>
        <span class="sb-hosp">${spec ? 'All hospitals \u00b7 ' + esc(quota) : hosp ? esc(hosp) + ' \u2014 all specialties' : 'All slots \u00b7 ' + esc(quota)}</span>
        <span class="sb-meta">${esc(program)} \u00b7 ${esc(quota)}${spec ? ' \u00b7 ' + esc(spec) : ''}${hosp ? ' \u00b7 ' + esc(hosp) : ''}</span>
      </div>
      <div class="sb-stats">
        <div class="sb-stat"><span class="sb-stat-v">${groups.length}</span><span class="sb-stat-l">${groupLabel}s</span></div>
        <div class="sb-stat ${totalSeats === 0 ? 'sb-stat-unknown' : ''}"><span class="sb-stat-v">${totalSeats || '?'}</span><span class="sb-stat-l">Total Seats</span></div>
      </div>
    </div>
    ${!useSimData
      ? `<div class="sb-partial-warn">&#9888;&#65039; Without running the <strong>Simulation</strong> first, the same candidate may appear in multiple slots below. Run the Simulation tab for a de-duplicated, merit-accurate view.</div>`
      : `<p class="sb-sim-note">Simulation active &mdash; showing selected candidates and merit cutoffs per slot.</p>`}
    <div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
  `;

  if (!groups.length) {
    html += '<p class="sb-empty">No slots or applicants found for this filter.</p>';
  } else {
    for (const grp of groups) {
      const displayList = buildSimDisplayList(grp.applicants, useSimData);
      const top5        = displayList.slice(0, 5);
      const extra       = grp.applicants.length - 5;
      const myIdx       = SIM.myId ? grp.applicants.findIndex(a => isMe(a.applicantId)) : -1;
      const cutoffBadge = useSimData ? formatGroupCutoffBadge(grp.slots, quota) : '';
      const selectedCount = useSimData ? grp.applicants.filter(a => a._simStatus === 'selected').length : 0;
      // Jump button(s): link directly into the full slot view
      const canSingleJump = grp.slots.length === 1 && grp.slots[0].spec && grp.slots[0].hosp;
      const jumpBtns = canSingleJump
        ? `<button class="btn btn-sm sb-partial-jump-btn" data-prog="${esc(program)}" data-quota="${esc(quota)}" data-spec="${esc(grp.slots[0].spec)}" data-hosp="${esc(grp.slots[0].hosp)}">View slot &rarr;</button>`
        : grp.slots.map(sl =>
            `<button class="btn btn-sm sb-partial-jump-btn" style="font-size:0.7rem" data-prog="${esc(program)}" data-quota="${esc(quota)}" data-spec="${esc(sl.spec)}" data-hosp="${esc(sl.hosp)}">${esc(spec ? sl.hosp.split(',')[0].trim() : sl.spec)} &rarr;</button>`
          ).join('');

      html += `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">
          <div class="sb-partial-group-hdr">
            <div>
              <span class="sb-spec" style="font-size:0.95rem">${esc(grp.key)}</span>
              <span class="sb-meta" style="display:block;margin-top:2px">
                ${grp.slots.length > 1 ? grp.slots.length + ' slots · ' : ''}${grp.seats || '?'} seat${grp.seats !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; ${grp.applicants.length} applicant${grp.applicants.length !== 1 ? 's' : ''}${useSimData && selectedCount ? ` &nbsp;&middot;&nbsp; ${selectedCount} selected` : ''}
              </span>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              ${cutoffBadge}
              ${myIdx >= 0 ? `<span class="sim-me-badge" style="font-size:0.72rem">YOU #${myIdx + 1}</span>` : ''}
              ${jumpBtns}
            </div>
          </div>
          <div class="sb-list" style="padding:6px 12px">
            ${top5.length ? (() => {
              const rows = [];
              let sectionSelShown = false;
              top5.forEach((a, i) => {
                if (useSimData && a._simStatus === 'selected' && !sectionSelShown) {
                  sectionSelShown = true;
                  rows.push(`<div class="sb-section-hdr sb-section-sel"><span>&#10003; Selected by simulation</span></div>`);
                }
                if (useSimData && sectionSelShown && i > 0 && top5[i - 1]._simStatus === 'selected' && a._simStatus !== 'selected') {
                  rows.push(`<div class="sb-section-hdr"><span>Next in line</span></div>`);
                }
                const elsewhere = a._simStatus === 'higher-pref' || a._simStatus === 'elsewhere';
                const selected  = a._simStatus === 'selected';
                const above     = useSimData ? selected : (grp.seats > 0 && a._meritRank <= grp.seats);
                const showSlot  = grp.slots.length > 1;
                rows.push(`<div class="sb-row ${above ? 'sb-above' : useSimData ? '' : 'sb-below'} ${isMe(a.applicantId) ? 'sb-row-me' : ''} ${elsewhere ? 'sb-row-elsewhere' : ''} ${selected ? 'sb-row-selected' : ''}">
                  <span class="sb-rank">#${a._meritRank}</span>
                  <span class="sb-marks">${fmtM(a.marksTotal)}</span>
                  <span class="sb-pref-no sb-parent">${a.parentInstitute ? '\u2605' : ''}</span>
                  <span class="sb-name">${esc(a.nameFull)}${supporterBadgeForCandidate(a)}${isMe(a.applicantId) ? ' <span class="me-tag">YOU</span>' : ''}${showSlot ? `<span style="font-size:0.7rem;color:var(--text-muted);margin-left:5px">${esc(spec ? a.slotHosp.split(',')[0].trim() : a.slotSpec)}</span>` : ''}${useSimData ? renderSbSimTag(a) : ''}</span>
                  <span></span>
                </div>`);
              });
              return rows.join('');
            })() : '<p class="sb-empty">No applicants listed this slot.</p>'}
            ${extra > 0 ? `<p style="text-align:center;font-size:0.74rem;color:var(--text-muted);padding:4px 0 8px">+${extra} more &mdash; view the full slot for complete list</p>` : ''}
          </div>
        </div>
      `;
    }
  }

  html += '</div>';
  container.innerHTML = html;

  // Wire up jump buttons
  container.querySelectorAll('.sb-partial-jump-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      jumpToSlot(btn.dataset.prog, btn.dataset.quota, btn.dataset.spec, btn.dataset.hosp);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// SLOT BROWSER — candidate search
// ═══════════════════════════════════════════════════════════════════
function setupSbCandSearch() {
  const input = document.getElementById('sbCandSearch');
  const btn   = document.getElementById('sbCandFindBtn');
  const clr   = document.getElementById('sbCandClearBtn');

  const doSearch = () => {
    const q = input?.value?.trim();
    if (!q) { clearSbCandidatePanel(); return; }
    sbSearchCandidate(q);
  };

  btn?.addEventListener('click', doSearch);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  clr?.addEventListener('click', () => {
    if (input) input.value = '';
    clearSbCandidatePanel();
    if (clr) clr.classList.add('hidden');
  });
}

function sbSearchCandidate(query) {
  const q = query.toLowerCase();
  const isIdSearch = /^\d+$/.test(query.trim());
  const matches = allCandidates().filter(c =>
    isIdSearch
      ? String(c.applicantId) === query.trim()
      : c.nameFull.toLowerCase().includes(q)
  );

  const panel = document.getElementById('sbCandPanel');
  const clr   = document.getElementById('sbCandClearBtn');
  if (!panel) return;
  if (clr) clr.classList.remove('hidden');

  if (!matches.length) {
    panel.innerHTML = `<p style="color:var(--neon-gold);font-size:0.82rem">No candidate found for "${esc(query)}".</p>`;
    panel.classList.remove('hidden');
    return;
  }

  if (matches.length === 1) {
    renderSbCandidatePanel(matches[0]);
    return;
  }

  // Multiple matches — show pick list
  panel.innerHTML = `
    <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">${matches.length} candidates match — select one:</p>
    <div class="sb-pick-list">
      ${matches.slice(0, 12).map(c =>
        `<button class="sb-pick-btn" data-id="${c.applicantId}">
          ${esc(c.nameFull.split(' ').slice(0, 3).join(' '))}
          <span style="opacity:0.5;font-size:0.88em"> (${c.applicantId})</span>
        </button>`).join('')}
      ${matches.length > 12
        ? `<span style="font-size:0.74rem;color:var(--text-muted);align-self:center">+${matches.length - 12} more — be more specific</span>`
        : ''}
    </div>
  `;
  panel.classList.remove('hidden');
  panel.querySelectorAll('.sb-pick-btn').forEach(b => {
    b.addEventListener('click', () => {
      const c = allCandidates().find(c => String(c.applicantId) === b.dataset.id);
      if (c) renderSbCandidatePanel(c);
    });
  });
}

function renderSbCandidatePanel(c) {
  const panel = document.getElementById('sbCandPanel');
  if (!panel) return;

  const prog  = SIM.sb.program || 'FCPS';
  const prefs = (c.preference?.[prog] || []).slice().sort((a, b) => a.preferenceNo - b.preferenceNo);

  SIM.sb.candidateId = String(c.applicantId);

  // Highlight in current slot view
  renderSlot();

  const portalMetaLine = formatProgramPortalMetaHtml(c, prog);
  const portalMetaHtml = portalMetaLine
    ? `<span class="sb-cand-portal-meta">${portalMetaLine}</span>`
    : '';

  if (!prefs.length) {
    panel.innerHTML = `
      <div class="sb-cand-hdr">
        <span class="sb-cand-name">${esc(c.nameFull)}</span>
        <span class="sb-cand-meta">ID ${c.applicantId}${portalMetaHtml ? ` &nbsp;·&nbsp; ${portalMetaHtml}` : ''}</span>
        <button class="btn btn-sm sb-cand-full-btn" type="button">Profile</button>
        <button class="btn btn-sm" style="margin-left:auto" onclick="clearSbCandidatePanel()">✕ Clear</button>
      </div>
      <p style="font-size:0.8rem;color:var(--text-muted)">No ${esc(prog)} preferences found.</p>
    `;
    panel.classList.remove('hidden');
    panel.querySelector('.sb-cand-full-btn')?.addEventListener('click', () => openCandidateDetail(c.applicantId));
    return;
  }

  panel.innerHTML = `
    <div class="sb-cand-hdr">
      <span class="sb-cand-name">${esc(c.nameFull)}</span>
      <span class="sb-cand-meta">ID ${c.applicantId} &nbsp;·&nbsp; ${esc(prog)} marks: <strong>${fmtM(effectiveMark(c, prog))}</strong>${portalMetaHtml ? ` &nbsp;·&nbsp; ${portalMetaHtml}` : ''}</span>
      <button class="btn btn-sm sb-cand-full-btn" type="button">Profile</button>
      <button class="btn btn-sm" style="margin-left:auto" id="sbClearPanelBtn">✕ Clear</button>
    </div>
    <p class="sb-cand-prefs-lbl">${prefs.length} ${esc(prog)} preferences — click any to jump to that slot and highlight this candidate:</p>
    <div class="sb-cand-prefs">
      ${prefs.map(p => `
        <button class="sb-jump-btn"
          data-prog="${esc(prog)}" data-quota="${esc(p.quotaName)}"
          data-spec="${esc(p.specialityName)}" data-hosp="${esc(p.hospitalName)}"
          title="${esc(p.quotaName)} · ${esc(p.specialityName)} · ${esc(p.hospitalName)}">
          <span class="pno">#${p.preferenceNo}</span>${esc(p.specialityName.split(' ').slice(0, 2).join(' '))}
          <span style="opacity:0.45;font-size:0.72em"> @ ${esc(p.hospitalName.split(',')[0])}</span>
        </button>`).join('')}
    </div>
  `;
  panel.classList.remove('hidden');

  panel.querySelector('.sb-cand-full-btn')?.addEventListener('click', () => openCandidateDetail(c.applicantId));

  panel.querySelector('#sbClearPanelBtn')?.addEventListener('click', () => {
    const input = document.getElementById('sbCandSearch');
    if (input) input.value = '';
    const clr = document.getElementById('sbCandClearBtn');
    if (clr) clr.classList.add('hidden');
    clearSbCandidatePanel();
  });

  panel.querySelectorAll('.sb-jump-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SIM.sb.candidateId = String(c.applicantId);
      jumpToSlot(btn.dataset.prog, btn.dataset.quota, btn.dataset.spec, btn.dataset.hosp);
    });
  });
}

function clearSbCandidatePanel() {
  const panel = document.getElementById('sbCandPanel');
  if (panel) { panel.innerHTML = ''; panel.classList.add('hidden'); }
  SIM.sb.candidateId = null;
  renderSlot();
}

// ═══════════════════════════════════════════════════════════════════
// SLOT BROWSER — candidate quick-view (click a row)
// ═══════════════════════════════════════════════════════════════════
function showSbCandQuickView(applicantId) {
  if (SIM.sb.clickedCandId === String(applicantId)) { closeSbModal(); return; }
  SIM.sb.clickedCandId = String(applicantId);
  renderSbQuickViewContent();
}

function closeSbModal() {
  SIM.sb.clickedCandId = null;
  document.getElementById('sbCandModal')?.classList.add('hidden');
}

function renderSbQuickViewContent() {
  const modal = document.getElementById('sbCandModal');
  const inner = document.getElementById('sbCandModalInner');
  if (!modal || !inner || !SIM.sb.clickedCandId) return;

  const { program, quota, spec, hosp } = SIM.sb;
  const c = allCandidates().find(c => String(c.applicantId) === SIM.sb.clickedCandId);
  if (!c) { modal.classList.add('hidden'); return; }

  const prefs = (c.preference?.[program] || []).slice().sort((a, b) => a.preferenceNo - b.preferenceNo);
  const marks = effectiveMark(c, program);

  const simRecords = (SIM.sim.result && SIM.sim.program === program)
    ? SIM.sim.result.candidates.filter(sc => String(sc.applicantId) === SIM.sb.clickedCandId)
    : [];
  const simByTrack = {};
  simRecords.forEach(sc => { simByTrack[sc._track] = sc; });
  const simCand = simByTrack[quotaTrack(quota)] || simRecords[0] || null;
  const placedPrefNo = simCand?.placed
    ? (simCand._prefs?.find(p =>
        p.quotaName === simCand._q && p.specialityName === simCand._s && p.hospitalName === simCand._h
      )?.preferenceNo ?? null)
    : null;

  const simSummary = simCand
    ? (simCand.placed
        ? `<span class="sbqv-status-placed">&#10003; Pref #${placedPrefNo ?? '?'} &mdash; ${esc(simCand._s)} @ ${esc(simCand._h.split(',')[0].trim())}</span>`
        : `<span class="sbqv-status-unplaced">Not placed</span>`)
    : '';
  const portalMetaLine = formatProgramPortalMetaHtml(c, program);
  const portalMetaBlock = renderProgramPortalMetaHtml(c);

  inner.innerHTML = `
    <div class="sbqv-header">
      <div class="sbqv-header-main">
        <span class="sbqv-name">${esc(c.nameFull)}</span>
        <span class="sbqv-meta">${esc(program)} &middot; ${fmtM(marks)}${portalMetaLine ? ` &middot; ${portalMetaLine}` : ''}${simSummary ? ` &middot; ${simSummary}` : ''}</span>
      </div>
      <button class="sbqv-close" aria-label="Close">&#10005;</button>
    </div>
    ${portalMetaBlock ? `<div class="sbqv-portal-meta">${portalMetaBlock}</div>` : ''}
    ${renderAdjustedMarksHtml(c)}
    <div class="sbqv-actions">
      <button class="btn btn-sm sbqv-full-btn" type="button">Open full candidate profile</button>
    </div>
    <div class="sbqv-prefs">
      ${prefs.length ? prefs.map(p => {
        const isCurrent = p.quotaName === quota && p.specialityName === spec && p.hospitalName === hosp;
        const seats = SIM.seats?.[program]?.[p.quotaName]?.[p.specialityName]?.[p.hospitalName] ?? null;
        const prefSimCand = simByTrack[quotaTrack(p.quotaName)] || null;
        const prefPlacedPrefNo = prefSimCand?.placed
          ? (prefSimCand._prefs?.find(pp =>
              pp.quotaName === prefSimCand._q && pp.specialityName === prefSimCand._s && pp.hospitalName === prefSimCand._h
            )?.preferenceNo ?? null)
          : null;
        let statusTag = '';
        if (prefSimCand) {
          if (prefSimCand.placed && prefSimCand._q === p.quotaName && prefSimCand._s === p.specialityName && prefSimCand._h === p.hospitalName) {
            statusTag = '<span class="sbqv-tag sbqv-tag-placed">&#10003; Selected</span>';
          } else if (prefSimCand.placed && prefPlacedPrefNo !== null && p.preferenceNo > prefPlacedPrefNo) {
            statusTag = '<span class="sbqv-tag sbqv-tag-skip">&#8593; skipped</span>';
          } else if (prefSimCand.placed) {
            statusTag = '<span class="sbqv-tag sbqv-tag-miss">not placed</span>';
          }
        }
        return `<div class="sbqv-pref-row${isCurrent ? ' sbqv-pref-current' : ''}">
          <span class="sbqv-pref-no">${p.preferenceNo}</span>
          <div class="sbqv-pref-info">
            <span class="sbqv-pref-spec">${esc(p.specialityName)}</span>
            <span class="sbqv-pref-hosp">${esc(p.hospitalName)}${isCurrent ? ' <span class="sbqv-viewing-tag">viewing</span>' : ''}</span>
            <span class="sbqv-pref-quota">${esc(p.quotaName)}${seats ? ` &middot; ${seats} seat${seats > 1 ? 's' : ''}` : ''}</span>
          </div>
          <div class="sbqv-pref-status">${statusTag}</div>
        </div>`;
      }).join('') : `<p style="padding:12px;font-size:0.82rem;color:var(--text-muted)">No ${esc(program)} preferences found.</p>`}
    </div>
  `;
  modal.classList.remove('hidden');
  inner.querySelector('.sbqv-close')?.addEventListener('click', closeSbModal);
  inner.querySelector('.sbqv-full-btn')?.addEventListener('click', () => {
    closeSbModal();
    openCandidateDetail(c.applicantId);
  });
  modal.onclick = e => { if (e.target === modal) closeSbModal(); };
}
