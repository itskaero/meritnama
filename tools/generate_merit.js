const fs = require('fs');
const path = require('path');

// ── Load data ──
const DATA = path.resolve(__dirname, '..', 'data');
const candidates = JSON.parse(fs.readFileSync(path.join(DATA, 'induction21_candidates.json'), 'utf8'));
const seats = JSON.parse(fs.readFileSync(path.join(DATA, 'induction21_seats.json'), 'utf8'));

const candIds = Object.keys(candidates);
console.log(`Candidates: ${candIds.length}`);
console.log(`Seat entries: ${seats.length}`);
const totalSeats = seats.reduce((s, sl) => s + sl.seats, 0);
console.log(`Total seats: ${totalSeats}`);

// ── Constants (from sim-core.js) ──
const MAX_PASSES = 200;
const QUOTA_TRACKS = { ARMED: 'armed', CIVILIAN: 'civilian' };
const CIVILIAN_QUOTA_KEYS = new Set([
  'kpk sindh balochistan', 'punjab', 'disable', 'foreign', 'foriegn',
  'ajk gb ict', 'ajk g b ict', 'dental', 'placement',
]);

function normalizeQuotaName(qn) {
  return String(qn || '').trim().toLowerCase().replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function quotaTrack(qn) {
  const q = normalizeQuotaName(qn);
  if (q.includes('armed force')) return QUOTA_TRACKS.ARMED;
  return CIVILIAN_QUOTA_KEYS.has(q) ? QUOTA_TRACKS.CIVILIAN : QUOTA_TRACKS.CIVILIAN;
}

// ── Marks ──
function effectiveMark(c, program) {
  const appliedIn = c.applied_in || {};
  const hasExplicitFlag = Object.prototype.hasOwnProperty.call(appliedIn, program);
  const hasProgramPrefs = (c.preference?.[program] || []).length > 0;
  if (!appliedIn[program] && (hasExplicitFlag || !hasProgramPrefs)) return null;
  return (c.marksTotal ?? 0) + (c.programMarks?.[program] ?? 0);
}

// ── Seat tree ──
function buildSeatTree(program) {
  const tree = {};
  for (const sl of seats) {
    if (sl.typeName !== program) continue;
    const q = sl.quotaName;
    const s = sl.specialityName;
    const h = sl.hospitalName;
    tree[q] = tree[q] || {};
    tree[q][s] = tree[q][s] || {};
    tree[q][s][h] = { jobs: sl.seats, candidates: [] };
  }
  return tree;
}

// ── Placement ──
function candidateTrackPrefs(c, program, track) {
  return (c.preference?.[program] || [])
    .filter(p => quotaTrack(p.quotaName) === track)
    .slice()
    .sort((a, b) => a.preferenceNo - b.preferenceNo);
}

function runPlacement(candidates, seatTree, program) {
  const prog = candidates.flatMap(c => {
    const marksTotal = effectiveMark(c, program);
    if (marksTotal == null) return [];
    return [QUOTA_TRACKS.CIVILIAN, QUOTA_TRACKS.ARMED]
      .map(track => ({
        applicantId: c.applicantId,
        nameFull: c.nameFull || c.name || '',
        pmdcNo: c.pmdcNo || c.pmdc_no || '',
        marksTotal,
        _track: track,
        _trackLabel: track === QUOTA_TRACKS.CIVILIAN ? 'Civilian' : 'Armed',
        _prefs: candidateTrackPrefs(c, program, track),
        placed: false, _q: null, _s: null, _h: null,
      }))
      .filter(cw => cw._prefs.length);
  });

  const slot = (q, s, h) => seatTree?.[q]?.[s]?.[h];
  const entry = (cand, pref) => ({
    applicantId: cand.applicantId,
    nameFull: cand.nameFull,
    pmdcNo: cand.pmdcNo,
    marksTotal: cand.marksTotal,
    preferenceNo: pref.preferenceNo,
    _track: cand._track,
    _trackLabel: cand._trackLabel,
    quotaName: pref.quotaName,
    specialityName: pref.specialityName,
    hospitalName: pref.hospitalName,
  });

  let prevPlaced = -1;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const unplaced = prog.filter(c => !c.placed).sort((a, b) => b.marksTotal - a.marksTotal);
    if (!unplaced.length) break;
    let placed = 0;
    for (const cand of unplaced) {
      for (const pref of cand._prefs) {
        const sl = slot(pref.quotaName, pref.specialityName, pref.hospitalName);
        if (!sl) continue;
        if (sl.candidates.length < sl.jobs) {
          sl.candidates.push(entry(cand, pref));
          cand.placed = true;
          cand._q = pref.quotaName; cand._s = pref.specialityName; cand._h = pref.hospitalName;
          placed++;
          break;
        } else {
          const lowest = sl.candidates.reduce((m, c) => c.marksTotal < m.marksTotal ? c : m);
          if (cand.marksTotal > lowest.marksTotal) {
            sl.candidates = sl.candidates.filter(
              c => !(String(c.applicantId) === String(lowest.applicantId) && c._track === lowest._track)
            );
            const evicted = prog.find(c =>
              String(c.applicantId) === String(lowest.applicantId) && c._track === lowest._track
            );
            if (evicted) { evicted.placed = false; evicted._q = evicted._s = evicted._h = null; }
            sl.candidates.push(entry(cand, pref));
            cand.placed = true;
            cand._q = pref.quotaName; cand._s = pref.specialityName; cand._h = pref.hospitalName;
            placed++;
            break;
          }
        }
      }
    }
    const totalPlaced = prog.filter(c => c.placed).length;
    if (totalPlaced === prevPlaced) break;
    prevPlaced = totalPlaced;
  }

  return { seatTree, candidates: prog };
}

// ── Collect programs ──
const programs = [...new Set(seats.map(s => s.typeName))].sort();
console.log(`Programs: ${programs.join(', ')}`);

// ── Run for each program ──
const meritEntries = [];
let rank = 0;

for (const program of programs) {
  console.log(`\nRunning ${program}...`);
  const cands = candIds
    .map(id => ({ id, ...candidates[id] }))
    .filter(c => effectiveMark(c, program) != null);
  console.log(`  Candidates: ${cands.length}`);

  const tree = buildSeatTree(program);
  const totalJobs = Object.values(tree).reduce((sum, specs) =>
    sum + Object.values(specs).reduce((s2, hosps) =>
      s2 + Object.values(hosps).reduce((s3, sl) => s3 + sl.jobs, 0), 0), 0);
  console.log(`  Seats: ${totalJobs}`);

  if (!cands.length || !totalJobs) continue;

  const result = runPlacement(cands, tree, program);
  const placed = result.candidates.filter(c => c.placed);
  console.log(`  Placed: ${placed.length}`);

  for (const c of placed) {
    rank++;
    const pref = c._prefs.find(p =>
      p.quotaName === c._q && p.specialityName === c._s && p.hospitalName === c._h
    );
    meritEntries.push({
      rowNo: rank,
      applicantId: Number(c.applicantId),
      nameFull: c.nameFull,
      pmdcNo: c.pmdcNo,
      marksTotal: c.marksTotal,
      typeName: program,
      specialityName: c._s,
      hospitalName: c._h,
      quotaName: c._q,
      preferenceNo: pref ? pref.preferenceNo : null,
    });
  }
}

// ── Write ──
const outputPath = path.join(DATA, 'induction21_merit.json');
fs.writeFileSync(outputPath, JSON.stringify(meritEntries, null, 2), 'utf8');
console.log(`\nWrote ${meritEntries.length} merit entries to ${outputPath}`);
