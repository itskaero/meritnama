// ═══════════════════════════════════════════════════════════════════
// CANDIDATES TAB
// ═══════════════════════════════════════════════════════════════════
function _countProfileStatusByType(all, typeId) {
  let accepted = 0, pending = 0, rejected = 0;
  const td = SIM.profileStatus.types[String(typeId)];
  if (!td) return { accepted, pending, rejected };
  for (const c of all) {
    const st = td.byId[String(c.applicantId)];
    if (!st) continue;
    const sid = Number(st.statusId);
    if (sid === 11) pending++;
    else if (sid === 1) accepted++;
    else if (sid === 2) rejected++;
  }
  return { accepted, pending, rejected };
}

function renderCandStats() {
  const all = allCandidates();
  if (!all.length) return;

  let fcps = 0, ms = 0, md = 0, multi = 0, noPrefs = 0, lowMarks = 0;
  let psAccepted = 0, psPending = 0, psRejected = 0;
  for (const c of all) {
    const ai    = c.applied_in || {};
    const progs = (ai.FCPS ? 1 : 0) + (ai.MS ? 1 : 0) + (ai.MD ? 1 : 0);
    if (ai.FCPS) fcps++;
    if (ai.MS)   ms++;
    if (ai.MD)   md++;
    if (progs >= 2) multi++;
    if (progs === 0) noPrefs++;
    if ((c.marksTotal || 0) < 5) lowMarks++;
    const ps = getProfileStatusForCandidate(c);
    if (ps) {
      if (Number(ps.statusId) === 11) psPending++;
      else if (Number(ps.statusId) === 1) psAccepted++;
      else if (Number(ps.statusId) === 2) psRejected++;
    }
  }

  const bar = document.getElementById('candStats');
  if (!bar) return;
  bar.classList.remove('hidden');

  document.getElementById('cstat-fcps').textContent    = fcps.toLocaleString();
  document.getElementById('cstat-ms').textContent      = ms.toLocaleString();
  document.getElementById('cstat-md').textContent      = md.toLocaleString();
  document.getElementById('cstat-multi').textContent   = multi.toLocaleString();

  document.getElementById('cstat-noprefs').textContent = noPrefs.toLocaleString();
  document.getElementById('cstats-noprefs-item')
    ?.classList.toggle('cstats-ok', noPrefs === 0);

  document.getElementById('cstat-lowmarks').textContent = lowMarks.toLocaleString();
  document.getElementById('cstats-lowmarks-item')
    ?.classList.toggle('cstats-ok', lowMarks === 0);

  renderProfileStatusPanel(psAccepted, psPending, psRejected);
}

function fmtProfileStatusUpdatedAt(raw) {
  if (!raw) return null;
  const d = raw.toDate ? raw.toDate() : (typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : null);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-PK', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function renderProfileStatusPanel(accepted, pending, rejected) {
  const panel = document.getElementById('candProfileStats');
  if (!panel) return;

  const total = Object.keys(SIM.profileStatus.byId || {}).length;
  if (!SIM.profileStatus.loaded || !total) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  const setCount = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = Number(n).toLocaleString();
  };
  setCount('cstat-ps-accepted', accepted);
  setCount('cstat-ps-pending', pending);
  setCount('cstat-ps-rejected', rejected);

  const roundEl = document.getElementById('psStatusRoundLabel');
  if (roundEl) roundEl.textContent = SIM.profileStatus.typeLabel || 'Profile verification';

  const isLive = SIM.profileStatus.source === 'live';
  const badgeEl = document.getElementById('psStatusSourceBadge');
  if (badgeEl) {
    badgeEl.textContent = isLive ? 'Live' : 'Snapshot';
    badgeEl.className = 'ps-source-badge ' + (isLive ? 'ps-source-live' : 'ps-source-snapshot');
    badgeEl.title = isLive
      ? 'Synced from Firestore — updates automatically when admin publishes'
      : 'Loaded from bundled snapshot until a live publish is available';
  }

  const updatedEl = document.getElementById('psStatusUpdatedAt');
  const formatted = fmtProfileStatusUpdatedAt(SIM.profileStatus.updatedAt);
  if (updatedEl) {
    if (formatted) {
      updatedEl.textContent = formatted;
      const iso = SIM.profileStatus.updatedAt?.toDate?.()?.toISOString?.()
        || (typeof SIM.profileStatus.updatedAt === 'string' ? SIM.profileStatus.updatedAt : '');
      if (iso) updatedEl.setAttribute('datetime', iso);
      updatedEl.title = `${isLive ? 'Live' : 'Snapshot'} verification data as of ${formatted}`;
    } else {
      updatedEl.textContent = 'Timing not published';
      updatedEl.removeAttribute('datetime');
      updatedEl.title = 'Publish via admin portal to set an updated timestamp';
    }
  }

  const amendContainer = document.getElementById('candAmendmentStats');
  if (!amendContainer) return;

  const amendType = SIM.profileStatus.types['132'];
  if (!amendType || !Object.keys(amendType.byId).length) {
    amendContainer.classList.add('hidden');
    return;
  }

  const all = allCandidates();
  const amendCounts = _countProfileStatusByType(all, '132');
  amendContainer.classList.remove('hidden');

  const amendRoundEl = document.getElementById('psAmendRoundLabel');
  if (amendRoundEl) amendRoundEl.textContent = amendType.typeLabel || 'Amendment Process';

  const setAmendCount = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = Number(n).toLocaleString();
  };
  setAmendCount('cstat-amend-accepted', amendCounts.accepted);
  setAmendCount('cstat-amend-pending', amendCounts.pending);
  setAmendCount('cstat-amend-rejected', amendCounts.rejected);
}

function setupCandidateFilters() {
  const search  = document.getElementById('candSearch');
  const progSel = document.getElementById('candProgram');
  const statusSel = document.getElementById('candProfileStatus');

  search?.addEventListener('input', () => {
    SIM.cand.filter = search.value.trim().toLowerCase();
    SIM.cand.page   = 0;
    applyAndRenderCandidates();
  });

  progSel?.addEventListener('change', () => {
    SIM.cand.program = progSel.value;
    SIM.cand.page    = 0;
    applyAndRenderCandidates();
  });

  statusSel?.addEventListener('change', () => {
    SIM.profileStatus.filter = statusSel.value;
    SIM.cand.page = 0;
    applyAndRenderCandidates();
    updateCandStatusHint();
  });

  document.getElementById('candTable')?.querySelector('thead')
    ?.addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const key = th.dataset.sort;
      if (SIM.cand.sortKey === key) SIM.cand.sortDir *= -1;
      else { SIM.cand.sortKey = key; SIM.cand.sortDir = -1; }
      SIM.cand.page = 0;
      applyAndRenderCandidates();
    });
  document.getElementById('candDownloadPdfBtn')?.addEventListener('click', downloadCandidatePoolPdf);
  updateCandidateDownloadGate();
  updateCandStatusHint();
}

function updateCandStatusHint() {
  const hint = document.getElementById('candProfileStatusHint');
  if (!hint) return;
  const filter = SIM.profileStatus.filter;
  if (!SIM.profileStatus.loaded) {
    hint.innerHTML = '<span class="hint-icon"></span><span class="hint-count pending">⟳</span><span class="hint-desc">Loading status data…</span>';
    return;
  }
  const all = allCandidates();
  const count = filter
    ? all.filter(c => {
        const st = getEffectiveProfileStatusForCandidate(c);
        return st && Number(st.statusId) === Number(filter);
      }).length
    : all.length;
  const label = filter
    ? (document.getElementById('candProfileStatus')?.selectedOptions?.[0]?.textContent || 'Filtered')
    : 'All candidates';
  const countPill = '<span class="hint-count">' + count.toLocaleString() + '</span>';
  const desc = '<span class="hint-label">' + esc(label) + '</span>';
  hint.innerHTML = '<span class="hint-icon"></span>' + countPill + ' ' + desc;
}

function applyAndRenderCandidates() {
  let list = allCandidates().slice();

  if (SIM.cand.filter) {
    list = list.filter(c => c.nameFull.toLowerCase().includes(SIM.cand.filter));
  }
  if (SIM.cand.program) {
    list = list.filter(c => effectiveMark(c, SIM.cand.program) != null);
  }
  if (SIM.profileStatus.filter) {
    const want = Number(SIM.profileStatus.filter);
    list = list.filter(c => {
      const st = getEffectiveProfileStatusForCandidate(c);
      return st && Number(st.statusId) === want;
    });
  }

  const { sortKey: key, sortDir: dir } = SIM.cand;
  list.sort((a, b) => {
    let av, bv;
    if (key === 'nameFull') { av = a.nameFull; bv = b.nameFull; }
    else if (['FCPS','MS','MD'].includes(key)) {
      av = effectiveMark(a, key) ?? 0; bv = effectiveMark(b, key) ?? 0;
    } else if (key === 'marksTotal') {
      av = baseMarks(a); bv = baseMarks(b);
    } else {
      av = a[key] ?? 0; bv = b[key] ?? 0;
    }
    return typeof av === 'string'
      ? av.localeCompare(bv) * dir
      : (av - bv) * dir;
  });

  SIM.cand.filtered = list;

  const total = list.length;
  const slice = list.slice(SIM.cand.page * PAGE_SIZE, (SIM.cand.page + 1) * PAGE_SIZE);
  renderCandidateTable(slice, total);
  updateCandidateDownloadGate();
}

function updateCandidateDownloadGate() {
  const btn = document.getElementById('candDownloadPdfBtn');
  const note = document.getElementById('candDownloadNote');
  if (!btn || !note) return;
  const isDonor = !!SIM.donor.current;
  const hasRows = !!SIM.cand.filtered?.length;
  btn.disabled = !(isDonor && hasRows);
  note.textContent = isDonor
    ? (hasRows ? 'Watermarked to your login' : 'No candidates in current filter')
    : 'Supporter-only export';
}

async function downloadCandidatePoolPdf() {
  if (!SIM.donor.current) {
    showToast('PDF downloads are available for verified supporters only.', 'error');
    return;
  }
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    showToast('PDF library did not load. Check internet connection and retry.', 'error');
    return;
  }
  const rows = (SIM.cand.filtered || []).slice(0, 500);
  if (!rows.length) {
    showToast('No candidates match the current filter.', 'error');
    return;
  }
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const email = getSessionEmail() || 'registered user';
  let y = 48;
  const left = 42;
  const maxY = 760;
  const addFooter = () => {
    doc.setFontSize(8);
    doc.setTextColor(150, 65, 80);
    doc.text(`Generated for ${email}. If this report is found circulating, access may be revoked.`, left, 810);
    doc.setTextColor(20, 35, 55);
  };
  const addPageIfNeeded = () => {
    if (y <= maxY) return;
    addFooter();
    doc.addPage();
    y = 48;
  };
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('MeritNama Candidate Pool Export', left, y);
  y += 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString('en-PK')} · Owner: ${email}`, left, y);
  y += 14;
  doc.setTextColor(150, 65, 80);
  doc.text('Private donor export. Unauthorized circulation may result in access revocation.', left, y);
  doc.setTextColor(20, 35, 55);
  y += 22;
  y = drawPdfTable(doc, [
    { label: '#', w: 28, value: (_, i) => i + 1 },
    { label: 'Name', w: 190, value: c => c.nameFull },
    { label: 'ID', w: 58, value: c => c.applicantId },
    { label: 'Base', w: 52, value: c => fmtM(baseMarks(c)) },
    { label: 'Programs', w: 88, value: c => ['FCPS', 'MS', 'MD'].filter(p => effectiveMark(c, p) != null).join('/') || '—' },
    { label: 'Support', w: 76, value: c => supporterBadgeForCandidate(c) ? 'Supporter' : '' },
  ], rows, y, { title: 'MeritNama Candidate Pool Export', reportType: 'candidate_pool' });
  if ((SIM.cand.filtered || []).length > rows.length) {
    y += 8;
    doc.text(`Note: Export limited to first ${rows.length} rows of current filtered result.`, left, y);
  }
  addFooter();
  await logPdfDownload('candidate_pool');
  doc.save('meritnama-candidate-pool.pdf');
}

function renderCandidateTable(slice, total) {
  const tbody = document.getElementById('candBody');
  if (!tbody) return;

  const PROGS = ['FCPS', 'MS', 'MD'];
  tbody.innerHTML = slice.map(c => {
    const isMe   = String(c.applicantId) === SIM.myId;
    const rank   = SIM.cand.filtered.indexOf(c) + 1;
    const tags   = PROGS.filter(p => effectiveMark(c, p) != null)
                        .map(p => `<span class="prog-tag prog-${p.toLowerCase()}">${p}</span>`).join('');
    const custom = c._custom ? '<span class="custom-tag">manual</span>' : '';
    const allPs = getAllProfileStatusesForCandidate(c);
    const psTag = allPs.length > 1
      ? allPs.map(st => profileStatusTagHtml(st)).join('<span class="ps-trail-arrow"> → </span>')
      : profileStatusTagHtml(getProfileStatusForCandidate(c));
    return `<tr class="${isMe ? 'row-me' : ''}" data-id="${c.applicantId}" style="cursor:pointer">
      <td class="td-num">${rank}</td>
      <td>${esc(c.nameFull)} ${psTag}${supporterBadgeForCandidate(c)}${custom}${isMe ? '<span class="me-tag">YOU</span>' : ''}</td>
      <td class="td-num">${fmtM(baseMarks(c))}</td>
      <td class="td-num">${fmtM(effectiveMark(c, 'FCPS'))}</td>
      <td class="td-num">${fmtM(effectiveMark(c, 'MS'))}</td>
      <td class="td-num">${fmtM(effectiveMark(c, 'MD'))}</td>
      <td>${tags}</td>
      <td><button class="btn btn-sm view-btn" data-id="${c.applicantId}">View</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--text-muted)">No candidates match the filter.</td></tr>';

  const countEl = document.getElementById('candCount');
  if (countEl) countEl.textContent = `${total.toLocaleString()} candidates`;

  renderPagination('candPager', total, SIM.cand.page, PAGE_SIZE, p => {
    SIM.cand.page = p;
    applyAndRenderCandidates();
  });

  tbody.querySelectorAll('.view-btn').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openCandidateDetail(btn.dataset.id); })
  );
  tbody.querySelectorAll('tr[data-id]').forEach(row =>
    row.addEventListener('click', () => openCandidateDetail(row.dataset.id))
  );
}

const MARKS_FIELD_LABELS = {
  degree: 'Degree',
  houseJob: 'House Job',
  experience: 'Experience',
  research: 'Research',
  position: 'Position',
  hardAreas: 'Hard Areas',
  matric: 'Matric',
  fsc: 'FSC',
  attempts: 'Attempts',
  mdcat: 'MDCAT',
};

function _marksFieldLabel(field) {
  return MARKS_FIELD_LABELS[field] || String(field || '').replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

function _renderMarksExplanationHtml(c) {
  const exp = c?.marksExplanation;
  if (!exp) return '';

  if (typeof exp === 'string') {
    return `
    <details class="marks-explanation">
      <summary>Marks explanation</summary>
      <div class="marks-exp-body">
        <p class="marks-exp-note">${esc(exp)}</p>
      </div>
    </details>`;
  }

  if (typeof exp !== 'object') return '';

  const included = Array.isArray(exp.includedComponents) ? exp.includedComponents : [];
  const excluded = Array.isArray(exp.excludedComponents) ? exp.excludedComponents : [];
  const summaryRows = [
    ['Total marks source', exp.usedMarksTotalSource],
    ['Official agg. marks', exp.officialAggMarks],
    ['Calculated total', exp.calculatedMarksTotal],
    ['Difference', exp.differenceFromCalculated],
  ].filter(([, v]) => v != null && v !== '');

  const renderItems = (items, emptyText) => {
    if (!items.length) return `<p style="margin:0;font-size:0.76rem;color:var(--text-muted)">${emptyText}</p>`;
    return `<div class="marks-exp-list">${items.map(item => `
      <div class="marks-exp-item">
        <div class="marks-exp-item-hdr">
          <span class="marks-exp-item-field">${esc(_marksFieldLabel(item.field))}</span>
          <span class="marks-exp-item-val">${fmtM(item.value)}</span>
        </div>
        ${item.reason ? `<div class="marks-exp-item-reason">${esc(item.reason)}</div>` : ''}
      </div>`).join('')}</div>`;
  };

  return `
    <details class="marks-explanation">
      <summary>Marks explanation</summary>
      <div class="marks-exp-body">
        ${summaryRows.length ? `
        <div>
          <p class="marks-exp-section-title">Portal total breakdown</p>
          <div class="marks-exp-grid">
            ${summaryRows.map(([label, value]) => `
              <span>${esc(label)}</span>
              <span class="marks-exp-val">${typeof value === 'number' ? fmtM(value) : esc(value)}</span>
            `).join('')}
          </div>
        </div>` : ''}
        <div>
          <p class="marks-exp-section-title">Included in official total</p>
          ${renderItems(included, 'No included components listed.')}
        </div>
        <div>
          <p class="marks-exp-section-title">Excluded from official total</p>
          ${renderItems(excluded, 'No excluded components listed.')}
        </div>
        ${exp.programMarksNote ? `<p class="marks-exp-note">${esc(exp.programMarksNote)}</p>` : ''}
      </div>
    </details>`;
}

function getProgramAttemptDict(c) {
  return c?.programAttempt || c?.programAttempts || null;
}

function getProgramAttemptDisplay(c, program) {
  const dict = getProgramAttemptDict(c);
  if (!dict || program == null) return null;
  const v = dict[program];
  return v == null || v === '' ? null : String(v);
}

function getProgramPercentageDisplay(c, program) {
  const dict = c?.programPercentage;
  if (!dict || program == null) return null;
  const v = dict[program];
  return v == null || v === '' ? null : String(v);
}

const ADJUSTED_PROGRAM_KEYS = ['FCPS', 'MS', 'MD', 'MDS', 'FCPSD'];
const UHS_ADJUSTED_PROGRAMS = new Set(['MS', 'MD']);

function ensureCandidateAdjusted(c) {
  if (!c || typeof c !== 'object') return c;
  const pm = c.programMarks || {};
  const legacy = c.uhsAdjusted || c.uhsAdjustment || {};
  if (!c.adjusted || typeof c.adjusted !== 'object') c.adjusted = {};

  for (const p of ADJUSTED_PROGRAM_KEYS) {
    if (c.adjusted[p] != null && c.adjusted[p] !== '') continue;
    if (UHS_ADJUSTED_PROGRAMS.has(p) && legacy[p] != null && legacy[p] !== '') {
      c.adjusted[p] = legacy[p];
    } else if (pm[p] != null) {
      c.adjusted[p] = pm[p];
    }
  }
  return c;
}

function getAdjustedDisplay(c, program) {
  ensureCandidateAdjusted(c);
  const dict = c?.adjusted;
  if (!dict || program == null) return null;
  const v = dict[program];
  return v == null || v === '' ? null : String(v);
}

function isAttemptProgram(program) {
  return /^FCPS/i.test(String(program || ''));
}

function isPercentageProgram(program) {
  return /^(MD|MS|MDS)\b/i.test(String(program || '').trim());
}

function parseProgramAttemptNumeric(raw) {
  if (raw == null || raw === '') return 0;
  const n = parseFloat(raw);
  if (!isNaN(n)) return n;
  const ord = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };
  return ord[String(raw).toLowerCase()] ?? 0;
}

/**
 * Resolve a marks-formula field for a candidate.
 * Per-programme dicts (programAttempt, programPercentage, programMarks, adjusted) use the
 * active simulation programme for bare names, or an explicit dotted subkey.
 * Missing subkeys resolve to 0 — not every programme has every dict entry.
 */
function resolveCandidateField(c, field, program, revision) {
  const selectedRevision = arguments.length >= 4 ? revision : getActiveCandidateRevisionId();
  if (!field) return 0;
  const f = String(field).trim();
  if (f === 'marksTotal') return getCandidateField(c, 'marksTotal', selectedRevision) ?? 0;
  if (MARKS_COMPONENT_FIELDS.includes(f)) return getCandidateField(c, f, selectedRevision) ?? 0;

  let dictName = null;
  let progKey  = null;
  const dotted = f.match(/^([a-zA-Z][a-zA-Z0-9]*)\.(.+)$/);
  if (dotted && PROGRAM_DICT_ROOTS.includes(dotted[1])) {
    dictName = normalizeProgramDictRoot(dotted[1]);
    progKey = dotted[2];
  } else if (PROGRAM_DICT_FIELDS.includes(f)) {
    dictName = normalizeProgramDictRoot(f);
    progKey = program;
  }

  if (!dictName || !progKey) return 0;

  const dictRoots = dictName === 'programAttempt'
    ? ['programAttempt', 'programAttempts']
    : [dictName];
  let raw;
  for (const root of dictRoots) {
    raw = getCandidateField(c, `${root}.${progKey}`, selectedRevision);
    if (raw !== undefined) break;
  }
  return parseProgramDictNumeric(dictName, raw);
}

function getCandidateProgrammes(c) {
  return [...new Set([
    ...Object.keys(c.preference || {}),
    ...Object.entries(c.applied_in || {}).filter(([, v]) => !!v).map(([p]) => p),
    ...Object.keys(c.programMarks || {}),
    ...Object.keys(getProgramAttemptDict(c) || {}),
    ...Object.keys(c.programPercentage || {}),
    ...Object.keys(c.adjusted || {}),
  ])].sort();
}

function formatProgramPortalMetaLine(c, program) {
  const bits = [];
  const attempt = getProgramAttemptDisplay(c, program);
  if (attempt) bits.push(`Attempt: ${attempt}`);
  const pct = getProgramPercentageDisplay(c, program);
  if (pct) {
    const pn = parseFloat(pct);
    bits.push(`Percentage: ${isNaN(pn) ? pct : `${pn.toFixed(2)}%`}`);
  }
  const adj = getAdjustedDisplay(c, program);
  const pm  = c.programMarks?.[program];
  if (adj && isPercentageProgram(program)) {
    const an = parseFloat(adj);
    const pn = pm != null ? parseFloat(pm) : NaN;
    if (isNaN(pn) || an !== pn) {
      bits.push(`Adjusted: ${isNaN(an) ? adj : an.toFixed(2)}`);
    }
  }
  return bits.join(' · ');
}

function formatProgramPortalMetaHtml(c, program) {
  const line = formatProgramPortalMetaLine(c, program);
  if (!line) return '';
  return line.split(' · ').map(part => {
    const idx = part.indexOf(': ');
    if (idx === -1) return esc(part);
    return `${esc(part.slice(0, idx + 1))} <strong>${esc(part.slice(idx + 2))}</strong>`;
  }).join(' · ');
}

function programMarksDifferFromAdjusted(c, program) {
  const pm  = c.programMarks?.[program];
  const adj = c.adjusted?.[program];
  if (pm == null || adj == null) return false;
  const pmN = parseFloat(pm);
  const adjN = parseFloat(adj);
  return !isNaN(pmN) && !isNaN(adjN) && pmN !== adjN;
}

function formatProgramBonusLabel(c, program) {
  const m = c.programMarks?.[program];
  if (m == null) return '';
  if (programMarksDifferFromAdjusted(c, program)) {
    return ` (+${fmtM(m)} → adj ${fmtM(c.adjusted[program])})`;
  }
  return ` (+${fmtM(m)})`;
}

function getAdjustedProgrammeList(c) {
  ensureCandidateAdjusted(c);
  return [...new Set([
    ...ADJUSTED_PROGRAM_KEYS,
    ...Object.keys(c.programMarks || {}),
    ...Object.keys(c.adjusted || {}),
    ...getCandidateProgrammes(c),
  ])].filter(p => {
    const pm  = c.programMarks?.[p];
    const adj = c.adjusted?.[p];
    return pm != null || adj != null;
  }).sort();
}

function renderAdjustedMarksHtml(c) {
  const progs = getAdjustedProgrammeList(c);
  if (!progs.length) return '';

  const hasDiff = progs.some(p => programMarksDifferFromAdjusted(c, p));

  return `
    <div class="cand-adj-marks">
      <p class="cand-adj-marks-lbl">
        Programme marks
        ${hasDiff ? '<span class="cand-adj-note">MS/MD adjusted per UHS policy</span>' : ''}
      </p>
      <div class="cand-adj-grid">
        <div class="cand-adj-hdr">
          <span>Programme</span>
          <span>Portal</span>
          <span>Adjusted</span>
        </div>
        ${progs.map(p => {
          const differs = programMarksDifferFromAdjusted(c, p);
          return `
            <div class="cand-adj-row ${differs ? 'cand-adj-diff' : ''}">
              <span class="linked-prog-tag">${esc(p)}</span>
              <span class="cand-adj-val">${fmtM(c.programMarks?.[p])}</span>
              <span class="cand-adj-val ${differs ? 'cand-adj-val-hl' : ''}">${fmtM(c.adjusted?.[p])}</span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderProgramScoreCardsHtml(c) {
  const progs = getCandidateProgrammes(c);
  if (!progs.length) return '';

  return `<div class="cand-scores-grid">
    ${progs.map(p => {
      const eff = effectiveMark(c, p);
      const applied = c.applied_in?.[p];
      const bonusLbl = formatProgramBonusLabel(c, p);
      const meta = formatProgramPortalMetaHtml(c, p);
      return `
        <div class="cand-score-card ${applied ? 'applied' : ''}" data-prog="${esc(p)}">
          <span class="cand-score-prog">${esc(p)}</span>
          <span class="cand-score-val">${eff != null ? fmtM(eff) : '—'}</span>
          <span class="cand-score-lbl">${applied ? `✓ Applied${bonusLbl}` : (eff != null ? 'Applied' : 'Not applied')}${meta ? `<br><span class="cand-portal-meta-inline">${meta}</span>` : ''}</span>
        </div>`;
    }).join('')}
  </div>`;
}

function renderProgramPortalMetaHtml(c) {
  const rows = getCandidateProgrammes(c).map(p => {
    const meta = formatProgramPortalMetaHtml(c, p);
    if (!meta) return '';
    return `<div class="linked-prog-meta-row"><span class="linked-prog-tag">${esc(p)}</span><span>${meta}</span></div>`;
  }).filter(Boolean);

  if (!rows.length) return '';
  return `
    <div class="cand-portal-meta">
      <p class="cand-portal-meta-lbl">Programme portal data</p>
      <div class="linked-prog-meta">${rows.join('')}</div>
    </div>`;
}

function openCandidateDetail(idStr) {
  const c = ensureCandidateAdjusted(allCandidates().find(c => String(c.applicantId) === String(idStr)));
  if (!c) return;

  const modal = document.getElementById('candidateModal');
  const body  = document.getElementById('candidateModalBody');
  if (!modal || !body) return;

  const isMe   = String(c.applicantId) === SIM.myId;
  const progs  = Object.keys(c.programMarks || {}).filter(p => effectiveMark(c, p) != null);

  const scoreRows = [
    ['MBBS',       c.degree],
    ['House Job',  c.houseJob],
    ['Experience', c.experience],
    ['Research',   c.research],
    ['Position',   c.position],
    ['Hard Areas', c.hardAreas],
    ['MDCAT',      c.mdcat],
  ].filter(([, v]) => v);

  const allStatuses = getAllProfileStatusesForCandidate(c);

  body.innerHTML = `
    <div class="cand-detail-hdr">
      <div>
        <h3>${esc(c.nameFull)} ${isMe ? '<span class="me-tag">YOU</span>' : ''}
          ${c._custom ? '<span class="custom-tag">manual</span>' : ''}</h3>
        <p class="cand-detail-meta">ID: ${c.applicantId} &nbsp;·&nbsp; ${esc(getActiveMarksLabel())}: <strong>${fmtM(baseMarks(c))}</strong> &nbsp;·&nbsp; Portal marksTotal: ${fmtM(c.marksTotal)}</p>
        ${profileStatusesDetailHtml(allStatuses)}
      </div>
    </div>

    ${renderProgramScoreCardsHtml(c)}

    ${renderAdjustedMarksHtml(c)}

    ${renderProgramPortalMetaHtml(c)}

    ${scoreRows.length ? `
    <details class="score-breakdown">
      <summary>Score breakdown</summary>
      <div class="score-bk-grid">
        ${scoreRows.map(([l, v]) => `<span>${l}</span><span class="score-bk-val">${fmtM(v)}</span>`).join('')}
        <span><strong>Portal marksTotal</strong></span><span class="score-bk-val">${fmtM(c.marksTotal)}</span>
        <span><strong>Merit base (${esc(getActiveMarksLabel())})</strong></span><span class="score-bk-val"><strong>${fmtM(baseMarks(c))}</strong></span>
      </div>
    </details>` : ''}

    ${_renderMarksExplanationHtml(c)}

    ${candVerifEnabled && candVerifRecords ? getCandidateVerificationHtml(idStr) : '<div id="verif-placeholder" style="display:none"></div>'}

    ${progs.map(prog => {
      const prefs = (c.preference[prog] || []).slice().sort((a, b) => a.preferenceNo - b.preferenceNo);
      if (!prefs.length) return '';
      return `<div class="pref-section">
        <h4><span class="prog-tag prog-${prog.toLowerCase()}">${prog}</span> Preferences (${prefs.length})</h4>
        <div class="pref-list">
          ${prefs.map(p => `
            <div class="pref-item ${p.parentInstitute ? 'pref-parent' : ''}">
              <span class="pref-no">${p.preferenceNo}</span>
              <div class="pref-details">
                <span class="pref-spec">${esc(p.specialityName)}</span>
                <span class="pref-hosp">${esc(p.hospitalName)}</span>
                <span class="pref-quota-tag">${esc(p.quotaName)}${p.parentInstitute ? ' ⭐' : ''}</span>
              </div>
              <button class="btn btn-sm pref-browse-btn"
                data-prog="${esc(prog)}" data-quota="${esc(p.quotaName)}"
                data-spec="${esc(p.specialityName)}" data-hosp="${esc(p.hospitalName)}">
                Browse slot →
              </button>
            </div>`).join('')}
        </div>
      </div>`;
    }).join('')}
  `;

  // "Browse slot" buttons jump to Slot Browser
  body.querySelectorAll('.pref-browse-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { prog, quota, spec, hosp } = btn.dataset;
      closeModal();
      jumpToSlot(prog, quota, spec, hosp);
    });
  });

  modal.classList.remove('hidden');

  // If verification data wasn't loaded by the time template rendered, insert later
  if (candVerifEnabled && !candVerifRecords) {
    var _pendingId = idStr;
    ensureCandVerifRecords().then(function () {
      // Check this modal still shows the same applicant (user may have opened another)
      var bodyEl = document.getElementById('candidateModalBody');
      if (!bodyEl || !bodyEl.innerHTML.includes('ID: ' + _pendingId + ' ')) return;
      var vHtml = getCandidateVerificationHtml(_pendingId);
      if (vHtml) {
        var ph = document.getElementById('verif-placeholder');
        if (ph) ph.insertAdjacentHTML('afterend', vHtml);
        if (ph) ph.remove();
      }
    });
  }
}

function closeModal() {
  document.getElementById('candidateModal')?.classList.add('hidden');
}

// ── Candidate verification data (grievance records) ──

var candVerifEnabled = true;
var candVerifRecords = null;
var candVerifDataLoading = false;

function subscribeCandVerifConfig() {
  try {
    var db = firebase.firestore();
    db.collection('notifications').doc('candidate_verification_config').onSnapshot(function (snap) {
      candVerifEnabled = snap.exists ? snap.data().enabled !== false : true;
    }, function () {
      candVerifEnabled = true;
    });
  } catch (_) {}
}

function ensureCandVerifRecords() {
  if (candVerifRecords) return Promise.resolve(candVerifRecords);
  if (candVerifDataLoading) return candVerifDataLoading;
  candVerifDataLoading = fetch('data/grievance_verification.json', { cache: 'no-store' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      candVerifRecords = data.records || data;
      candVerifDataLoading = false;
      return candVerifRecords;
    })
    .catch(function () {
      candVerifRecords = [];
      candVerifDataLoading = false;
      return [];
    });
  return candVerifDataLoading;
}

function getCandidateVerificationHtml(idStr) {
  if (!candVerifEnabled || !candVerifRecords) return '';
  var matches = candVerifRecords.filter(function (r) {
    return String(r.applicantId) === String(idStr);
  });
  if (!matches.length) return '';
  var sid = 'verif-spoiler-' + idStr;
  var rows = matches.map(function (r) {
    var title = esc(r.title || '');
    var comments = esc(r.comments || '');
    var rawStatus = (r.status || '').trim().toLowerCase();
    var status = esc(r.status || 'No verification outcome recorded');
    var dated = esc(r.dated || '');
    var name = esc(r.name || '');
    var relation = esc(r.relation || '');
    var badgeCls = rawStatus === 'accepted' ? 'accepted' : rawStatus === 'pending' ? 'pending' : 'other';
    return '<div class="grievance-record">' +
      (title ? '<div><strong>Title:</strong> ' + title + '</div>' : '') +
      (comments ? '<div><strong>Comments:</strong> ' + comments + '</div>' : '') +
      (dated ? '<div><strong>Filed:</strong> ' + dated + '</div>' : '') +
      '<div><strong>Status:</strong> <span class="grievance-status-badge ' + badgeCls + '">' + status + '</span></div>' +
      (name ? '<div><strong>Filed by:</strong> ' + name + '</div>' : '') +
      (relation ? '<div><strong>Relation:</strong> ' + relation + '</div>' : '') +
      '</div>';
  }).join('');
  return '<details class="grievance-records verif-spoiler" id="' + sid + '">' +
    '<summary>' +
      '<span class="verif-spoiler-label">Grievance / verification records (' + matches.length + ')</span>' +
      ' <span class="verif-spoiler-hint grievance-hint">— click to reveal</span>' +
    '</summary>' +
    '<div class="grievance-body">' + rows + '</div></details>';
}

// Register one global click handler for all verification spoilers (auto-hide)
document.addEventListener('click', function (e) {
  var det = e.target.closest('.verif-spoiler');
  if (!det) return;
  // Clear any existing timer for this spoiler
  if (det._verifTimer) clearTimeout(det._verifTimer);
  // Auto-hide after 12 seconds when open
  if (det.open) {
    var hint = det.querySelector('.verif-spoiler-hint');
    if (hint) hint.textContent = '— auto-hide in 12s';
    det._verifTimer = setTimeout(function () {
      det.removeAttribute('open');
      if (hint) hint.textContent = '— click to reveal';
      det._verifTimer = null;
    }, 12000);
  } else {
    var hint2 = det.querySelector('.verif-spoiler-hint');
    if (hint2) hint2.textContent = '— click to reveal';
    if (det._verifTimer) { clearTimeout(det._verifTimer); det._verifTimer = null; }
  }
});

subscribeCandVerifConfig();
// Warm the cache so verification data is ready when user opens a modal
ensureCandVerifRecords();
