const fs = require('fs');
const path = require('path');

// ── Load data ──
const DATA = path.resolve(__dirname, '..', 'data');
const candidates = JSON.parse(fs.readFileSync(path.join(DATA, 'induction21_candidates.json'), 'utf8'));
const seats = JSON.parse(fs.readFileSync(path.join(DATA, 'induction21_seats.json'), 'utf8'));
const certificatePolicy = JSON.parse(fs.readFileSync(path.join(DATA, 'induction21_certificate_policy.json'), 'utf8'));
const specialtyGroups = JSON.parse(fs.readFileSync(path.join(DATA, 'induction21_specialty_groups.json'), 'utf8'));

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
function normalizeProgramName(program) {
  return String(program || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function programAliases(program) {
  const p = String(program || '').trim();
  const normalized = normalizeProgramName(p);
  if (normalized === 'FCPSD' || normalized === 'FCPS DENTISTRY') return ['FCPS Dentistry', 'FCPSD'];
  return [p].filter(Boolean);
}

function programMatches(a, b) {
  const aa = new Set(programAliases(a).map(normalizeProgramName));
  return programAliases(b).some(alias => aa.has(normalizeProgramName(alias)));
}

function normalizedLookupText(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bgynaecology\b/g, 'gynecology')
    .replace(/\borthopaedics\b/g, 'orthopedic surgery')
    .replace(/\s+/g, ' ')
    .trim();
}

function legacyProgramBonus(c, program) {
  for (const alias of programAliases(program)) {
    const val = c.programMarks?.[alias];
    if (val != null && val !== '') {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

let specialtyGroupIndex = null;
function getSpecialtyGroupIndex() {
  if (specialtyGroupIndex) return specialtyGroupIndex;
  specialtyGroupIndex = {};
  for (const [program, cfg] of Object.entries(specialtyGroups.programs || {})) {
    const labels = {};
    for (const [groupId, group] of Object.entries(cfg.groups || {})) {
      for (const value of [...(group.labels || []), ...(group.specialties || [])]) {
        const key = normalizedLookupText(value);
        if (key) labels[key] = groupId;
      }
    }
    specialtyGroupIndex[normalizeProgramName(program)] = labels;
  }
  return specialtyGroupIndex;
}

function specialtyGroupFor(program, specialty) {
  const key = normalizedLookupText(specialty);
  if (!key) return null;
  const index = getSpecialtyGroupIndex();
  for (const alias of programAliases(program)) {
    const labels = index[normalizeProgramName(alias)];
    if (labels?.[key]) return labels[key];
  }
  return key;
}

function certificateMatchesPreference(cert, program, pref) {
  if (!cert || !programMatches(cert.program, program)) return false;
  if (!pref?.specialityName) return false;
  const prefGroup = specialtyGroupFor(program, pref.specialityName);
  const certGroup = specialtyGroupFor(program, cert.specialty);
  if (prefGroup && certGroup && prefGroup === certGroup) return true;
  return normalizedLookupText(pref.specialityName) === normalizedLookupText(cert.specialty);
}

function isCertificatePass(cert) {
  return normalizedLookupText(cert?.status) === 'pass';
}

function isMarch2026Pass(cert) {
  if (!isCertificatePass(cert)) return false;
  if (normalizedLookupText(cert?.session) === 'march 2026') return true;
  const m = String(cert?.passingDate || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return !!(m && Number(m[2]) === 3 && Number(m[3]) === 2026);
}

function fcpsCertificateBonus(cert) {
  const cfg = certificatePolicy.fcps || {};
  if (cfg.requirePass !== false && !isCertificatePass(cert)) return null;
  const attempt = Number(cert?.attempt);
  if (!Number.isFinite(attempt)) return null;
  const marks = Number(cfg.attemptMarks?.[String(attempt)]);
  return Number.isFinite(marks) ? marks : null;
}

function msmdCertificateBonus(cert) {
  const cfg = certificatePolicy.msmd || {};
  if (cfg.requirePass !== false && !isCertificatePass(cert)) return null;
  if (cfg.specialRules?.March2026Pass != null && isMarch2026Pass(cert)) {
    const marks = Number(cfg.specialRules.March2026Pass);
    if (Number.isFinite(marks)) return marks;
  }
  const pct = Number(cert?.percentage);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  for (const rule of cfg.percentageMarks || []) {
    const min = Number(rule.min);
    const marks = Number(rule.marks);
    if (Number.isFinite(min) && Number.isFinite(marks) && pct >= min) return marks;
  }
  return null;
}

function certificateBonusForProgram(cert, program) {
  const normalized = normalizeProgramName(program);
  if (normalized.startsWith('FCPS')) return fcpsCertificateBonus(cert);
  if (['MS', 'MD', 'MDS'].includes(normalized)) return msmdCertificateBonus(cert);
  return null;
}

function resolveProgramBonus(c, pref, program) {
  const legacy = legacyProgramBonus(c, program);
  if (!pref?.specialityName || !Array.isArray(c.certificates) || !c.certificates.length) return legacy;
  const matches = c.certificates
    .filter(cert => certificateMatchesPreference(cert, program, pref))
    .map(cert => certificateBonusForProgram(cert, program))
    .filter(v => v != null);
  if (!matches.length) return legacy;
  return Math.max(...matches);
}

function effectiveMark(c, program, pref) {
  const appliedIn = c.applied_in || {};
  const aliases = programAliases(program);
  const hasExplicitFlag = Object.prototype.hasOwnProperty.call(appliedIn, program);
  const hasProgramPrefs = (c.preference?.[program] || []).length > 0;
  const applied = aliases.some(alias => appliedIn[alias]);
  if (!applied && (hasExplicitFlag || !hasProgramPrefs)) return null;
  return (c.marksTotal ?? 0) + (pref ? resolveProgramBonus(c, pref, program) : legacyProgramBonus(c, program));
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
    return [QUOTA_TRACKS.CIVILIAN, QUOTA_TRACKS.ARMED]
      .map(track => {
        const prefs = candidateTrackPrefs(c, program, track);
        const prefScores = prefs.map(pref => effectiveMark(c, program, pref)).filter(v => v != null);
        const sortMarks = prefScores.length ? Math.max(...prefScores) : effectiveMark(c, program);
        return {
          applicantId: c.applicantId,
          nameFull: c.nameFull || c.name || '',
          pmdcNo: c.pmdcNo || c.pmdc_no || '',
          marksTotal: sortMarks,
          _sortMarks: sortMarks,
          _source: c,
          _track: track,
          _trackLabel: track === QUOTA_TRACKS.CIVILIAN ? 'Civilian' : 'Armed',
          _prefs: prefs,
          placed: false, _q: null, _s: null, _h: null,
        };
      })
      .filter(cw => cw._prefs.length && cw._sortMarks != null);
  });

  const slot = (q, s, h) => seatTree?.[q]?.[s]?.[h];
  const scoreForPref = (cand, pref) => effectiveMark(cand._source || cand, program, pref) ?? cand.marksTotal ?? 0;
  const entry = (cand, pref) => ({
    applicantId: cand.applicantId,
    nameFull: cand.nameFull,
    pmdcNo: cand.pmdcNo,
    marksTotal: scoreForPref(cand, pref),
    preferenceNo: pref.preferenceNo,
    _track: cand._track,
    _trackLabel: cand._trackLabel,
    quotaName: pref.quotaName,
    specialityName: pref.specialityName,
    hospitalName: pref.hospitalName,
  });

  let prevPlaced = -1;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const unplaced = prog.filter(c => !c.placed).sort((a, b) => b._sortMarks - a._sortMarks);
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
          const em = scoreForPref(cand, pref);
          if (em > lowest.marksTotal) {
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
