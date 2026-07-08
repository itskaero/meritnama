'use strict';

(function () {

  let db;
  let merritListActive = false;
  let meritData = [];
  let originalMeritData = [];
  let filteredData = [];
  let consentBySlot = {};
  let userOverrides = {};
  let cumulativeRejected = new Set();
  let cumulativeInactiveAids = new Set();
  let cumulativeDroppedByProgram = new Set();
  let seatsData = null;
  let currentRound = 1;
  let userSelectedRound = false;
  let consentFileUpdatedAt = null;
  let meritFileUpdatedAt = null;
  let candidatesData = [];
  let candidatesMap = {};
  let specialtyNameToId = {};
  let certificatesData = {};

  // pqshKey (program::quota::specialty::hospital) -> { aid, name, marks, prefNo, isUpgrade, fromSlot, rowNo }
  let replacementMap = new Map();

  let $tabContent, $tabBtn;

  function consentFile() {
    return 'data/induction21_consent_round' + currentRound + '.json';
  }

  function meritFile() {
    return 'data/induction21_merit_round' + currentRound + '.json';
  }

  function consentFileFor(round) {
    return 'data/induction21_consent_round' + round + '.json';
  }

  function meritFileFor(round) {
    return 'data/induction21_merit_round' + round + '.json';
  }

  // Probe for available round files by fetching until 404
  let availableRounds = [];

  async function detectAvailableRounds() {
    if (availableRounds.length) return availableRounds;
    const rounds = [];
    for (let r = 1; r <= 10; r++) {
      try {
        const res = await fetch(meritFileFor(r), { cache: 'no-store' });
        if (!res.ok) break;
        // Consume the body to free the connection
        await res.text();
        rounds.push(r);
      } catch (_) { break; }
    }
    availableRounds = rounds;
    return rounds;
  }

  // ── Helpers ──

  function fval(obj, ...keys) {
    for (const k of keys) {
      const v = obj[k];
      if (v != null) return v;
    }
    return null;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setStatus(msg, color) {
    const el = document.getElementById('mlStatus');
    if (el) { el.textContent = msg; if (color) el.style.color = color; }
  }

  function slotKey(entry) {
    const id = fval(entry, 'applicantId');
    const p = fval(entry, 'typeName', 'type', 'program') || '';
    const q = fval(entry, 'quotaName', 'quota') || '';
    const s = fval(entry, 'specialityName', 'speciality', 'specialty') || '';
    const h = fval(entry, 'hospitalName', 'hospital') || '';
    return `${id}::${p}::${q}::${s}::${h}`;
  }

  function slotKeyFor(aid, program, quota, specialty, hospital) {
    return `${aid}::${program || ''}::${quota || ''}::${specialty || ''}::${hospital || ''}`;
  }

  function programQuotaSpecHospitalKey(entry) {
    const p = fval(entry, 'typeName', 'type', 'program') || '';
    const q = fval(entry, 'quotaName', 'quota') || '';
    const s = fval(entry, 'specialityName', 'speciality', 'specialty') || '';
    const h = fval(entry, 'hospitalName', 'hospital') || '';
    return `${p}::${q}::${s}::${h}`;
  }

  // ── Consent parsing (reused from original) ──

  function norm(s) {
    if (s == null) return '';
    return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function canonicalLabel(raw) {
    if (raw === 'Accepted') return 'Accepted';
    if (raw === 'Rejected') return 'Rejected';
    return 'Awaited';
  }

  function getEffectiveProfileStatusId(candidate) {
    if (!candidate || typeof getEffectiveProfileStatusForCandidate !== 'function') return null;
    const eff = getEffectiveProfileStatusForCandidate(candidate);
    return eff ? Number(eff.statusId) : null;
  }

  function isEffectivelyProfileAccepted(candidate) {
    return getEffectiveProfileStatusId(candidate) === 1;
  }

  function parseInfoTitle(infoTitle, fallbackProgram) {
    const parts = String(infoTitle || '').split(' - ');
    while (parts.length < 5) parts.push('');
    const program = (parts[0] || '').trim() || fallbackProgram || '';
    const quota = (parts[1] || '').trim();
    const speciality = (parts[2] || '').trim();
    const hospital = (parts[4] || '').trim();
    return [program, quota, speciality, hospital];
  }

  function parseConsentRaw(rawRows) {
    const exact = new Map();
    const byAidProgramQuota = new Map();
    const aidPrograms = new Map();
    const rejectedAids = new Set();
    const acceptedAids = new Set();
    if (!Array.isArray(rawRows)) return { exact, byAidProgramQuota, aidPrograms, rejectedAids, acceptedAids };

    for (const row of rawRows) {
      const aidRaw = row.applicantId ?? row.applicantID;
      if (aidRaw == null) continue;
      const aid = String(aidRaw);
      const [program, quota, speciality, hospital] = parseInfoTitle(row.infoTitle, row.program);
      if (!program) continue;
      const label = canonicalLabel(row.status);

      const key = [aid, norm(program), norm(quota), norm(speciality), norm(hospital)].join('\x00');
      exact.set(key, label);

      const ppqKey = aid + '\x00' + norm(program) + '\x00' + norm(quota);
      if (!byAidProgramQuota.has(ppqKey)) byAidProgramQuota.set(ppqKey, new Set());
      byAidProgramQuota.get(ppqKey).add(label);

      if (!aidPrograms.has(aid)) aidPrograms.set(aid, new Set());
      aidPrograms.get(aid).add(norm(program));

      if (label === 'Rejected') rejectedAids.add(aid);
      if (label === 'Accepted') acceptedAids.add(aid);
    }
    return { exact, byAidProgramQuota, aidPrograms, rejectedAids, acceptedAids };
  }

  function resolveMeritRow(entry, parsed) {
    const aid = String(entry.applicantId ?? entry.applicantID ?? '');
    if (!aid) return 'Awaited';
    const program = entry.typeName || entry.type || entry.program || '';
    const quota = entry.quotaName || entry.quota || '';
    const speciality = entry.specialityName || entry.speciality || entry.specialty || '';
    const hospital = entry.hospitalName || entry.hospital || '';

    const nProgram = norm(program);
    const nQuota = norm(quota);
    const nSpec = norm(speciality);
    const nHosp = norm(hospital);
    const exactKey = [aid, nProgram, nQuota, nSpec, nHosp].join('\x00');

    if (parsed.exact.has(exactKey)) return parsed.exact.get(exactKey);
    if (parsed.acceptedAids.has(aid)) return 'Dropped';

    const ppqKey = aid + '\x00' + nProgram + '\x00' + nQuota;
    const sameTrackLabels = parsed.byAidProgramQuota.get(ppqKey);
    if (sameTrackLabels && sameTrackLabels.has('Rejected')) return 'Rejected';

    const progs = parsed.aidPrograms.get(aid);
    if (progs && progs.size && !progs.has(nProgram)) return 'Dropped';

    return 'Awaited';
  }

  function buildConsentBySlot(parsed) {
    const bySlot = {};
    for (const entry of meritData) {
      const key = slotKey(entry);
      bySlot[key] = resolveMeritRow(entry, parsed);
    }
    return bySlot;
  }

  async function buildCumulativeConsentSets(upToRound) {
    const rejected = new Set();
    const inactiveAids = new Set();
    const droppedByProgram = new Set();
    for (let r = 1; r <= upToRound; r++) {
      try {
        const res = await fetch('data/induction21_consent_round' + r + '.json', { cache: 'no-store' });
        if (!res.ok) continue;
        const rows = await res.json();
        const parsed = parseConsentRaw(rows);
        for (const aid of parsed.rejectedAids) rejected.add(aid);
        if (r < upToRound && Array.isArray(rows)) {
          for (const row of rows) {
            const aidRaw = row.applicantId ?? row.applicantID;
            if (aidRaw == null) continue;
            if (canonicalLabel(row.status) !== 'Accepted') inactiveAids.add(String(aidRaw));
          }
        }
        for (const entry of meritData) {
          const status = resolveMeritRow(entry, parsed);
          if (status !== 'Dropped' && status !== 'Rejected') continue;
          const aid = String(entry.applicantId ?? entry.applicantID ?? '');
          const program = entry.typeName || entry.type || entry.program || '';
          if (!aid || !program) continue;
          droppedByProgram.add(aid + '::' + program);
        }
      } catch (_) {}
    }
    return { rejected, inactiveAids, droppedByProgram };
  }

  function bestPublishedPlacementForApplicant(applicantId) {
    let best = null;
    for (const m of meritData) {
      if (String(fval(m, 'applicantId')) !== String(applicantId)) continue;
      const program = fval(m, 'typeName', 'type', 'program');
      const quota = fval(m, 'quotaName', 'quota') || '';
      const specialty = fval(m, 'specialityName', 'speciality', 'specialty') || '';
      const hospital = fval(m, 'hospitalName', 'hospital') || '';
      const prefNo = prefNoFromCandidate(applicantId, program, quota, specialty, hospital);
      if (!best || (prefNo != null && (best.prefNo == null || prefNo < best.prefNo))) {
        best = { applicantId, program, quota, specialty, hospital, prefNo, row: m };
      }
    }
    return best;
  }

  // ── Candidate pool helpers ──

  function candidateForApplicant(applicantId) {
    return candidatesMap[String(applicantId)] || null;
  }

  function candidatePreferenceForSlot(candidate, program, quota, specialty, hospital) {
    if (!candidate || !Array.isArray(candidate.preferences)) return null;
    const qLower = (quota || '').toLowerCase();
    const hLower = (hospital || '').toLowerCase();
    const specId = specialtyNameToId[(specialty || '').toLowerCase().trim()];
    for (const p of candidate.preferences) {
      if (p.typeName !== program) continue;
      if ((p.quotaName || '').toLowerCase() !== qLower) continue;
      if ((p.hospitalName || '').toLowerCase() !== hLower) continue;
      if (specId != null) {
        if (p.specialityId === specId) return p;
      } else if ((p.specialityName || '').toLowerCase() === (specialty || '').toLowerCase()) {
        return p;
      }
    }
    return null;
  }

  function prefNoFromCandidate(applicantId, program, quota, specialty, hospital) {
    const c = candidateForApplicant(applicantId);
    const pref = candidatePreferenceForSlot(c, program, quota, specialty, hospital);
    return pref ? pref.preferenceNo : null;
  }

  function prefMatchFromCandidate(applicantId, program, quota, specialty, hospital) {
    const c = candidateForApplicant(applicantId);
    return !!candidatePreferenceForSlot(c, program, quota, specialty, hospital);
  }

  function effectiveMark(candidate, program, quota, specialty, hospital) {
    if (!candidate) return null;
    const pref = candidatePreferenceForSlot(candidate, program, quota, specialty, hospital);
    if (!pref) return null;
    const aid = String(candidate.applicantId);
    const certs = certificatesData[aid] || [];
    const cert = certForPreference(pref, certs);
    // Start with base marks
    let base = parseFloat(candidate.marksTotal);
    if (!Number.isFinite(base)) base = 0;
    // Add certificate/program bonus
    let bonus = 0;
    if (cert) {
      const portalMarks = parseFloat(cert.certificateMarks);
      if (Number.isFinite(portalMarks) && portalMarks > 0) bonus = portalMarks;
      else {
        const compMarks = parseFloat(cert.computerizedMarks);
        if (Number.isFinite(compMarks) && compMarks > 0) bonus = compMarks;
      }
    }
    if (bonus <= 0) {
      const pm = parseFloat(pref.programMarks) || parseFloat(pref.marks);
      if (Number.isFinite(pm) && pm > 0) bonus = pm;
    }
    if (bonus <= 0) {
      const progMarks = parseFloat(candidate.programMarks?.[program]);
      if (Number.isFinite(progMarks) && progMarks > 0) bonus = progMarks;
    }
    return base + bonus;
  }

  function certForPreference(pref, certs) {
    if (!pref || !Array.isArray(certs)) return null;
    const pType = pref.typeId != null ? pref.typeId : null;
    const pDisciplines = Array.isArray(pref.disciplineIds) ? pref.disciplineIds : [];
    for (const c of certs) {
      if (pType != null && c.typeId === pType && pDisciplines.includes(c.disciplineId)) return c;
      if (pType == null && c.typeName === pref.typeName && pDisciplines.includes(c.disciplineId)) return c;
    }
    return null;
  }

  // ── Consent resolution ──

  function getRowConsentVal(d) {
    const key = slotKey(d);
    if (userOverrides[key] !== undefined) return userOverrides[key];
    const bySlot = consentBySlot[key];
    if (bySlot === 'Accepted') return 'Accepted';
    if (bySlot === 'Dropped') return 'Excluded';
    if (bySlot === 'Rejected') return 'Excluded';
    return 'Awaited';
  }

  // ── Cascade Simulation ──

  let simCascadeResult = null;
  let showingSimulated = false;
  let simulatedRound = 0;        // 0 = published, 1+ = simulated round number
  let simRejectedAids = new Set(); // carry-forward rejected candidates across simulated rounds
  let cascadeHistory = [];       // array of { round, result, meritSnapshot }

  // ── Tidbits / sidebar state ──
  let multiTrackAids = new Set();  // candidates in both Armed + Civilian
  let multiProgramAids = new Set(); // candidates in multiple typeNames
  let highlightAid = null;          // currently highlighted applicantId
  let expandedNextInLine = new Set(); // expanded slot keys for next-in-line

  function computeTidbits() {
    multiTrackAids = new Set();
    multiProgramAids = new Set();
    const aidQuotas = {};  // aid -> Set of normalized quota tracks
    const aidPrograms = {}; // aid -> Set of typeNames
    for (const d of meritData) {
      const aid = String(fval(d, 'applicantId'));
      const quota = (fval(d, 'quotaName', 'quota') || '').toLowerCase();
      const prog = fval(d, 'typeName', 'type', 'program') || '';
      if (!aidQuotas[aid]) aidQuotas[aid] = new Set();
      aidQuotas[aid].add(quota.includes('armed') ? 'armed' : 'civilian');
      if (!aidPrograms[aid]) aidPrograms[aid] = new Set();
      aidPrograms[aid].add(prog);
    }
    for (const [aid, tracks] of Object.entries(aidQuotas)) {
      if (tracks.size > 1) multiTrackAids.add(aid);
    }
    for (const [aid, progs] of Object.entries(aidPrograms)) {
      if (progs.size > 1) multiProgramAids.add(aid);
    }
  }

  function isArmedQuota(quota) {
    return (quota || '').toLowerCase().includes('armed');
  }

  function getCandidateTags(d) {
    const tags = [];
    const aid = String(fval(d, 'applicantId'));
    const quota = fval(d, 'quotaName', 'quota') || '';
    tags.push(isArmedQuota(quota)
      ? { label: 'Armed', cls: 'ml-tag-armed' }
      : { label: 'Civilian', cls: 'ml-tag-civilian' });
    if (multiTrackAids.has(aid)) tags.push({ label: 'Multi-track', cls: 'ml-tag-multitrack' });
    if (multiProgramAids.has(aid)) tags.push({ label: 'Multi-program', cls: 'ml-tag-multiprog' });
    const cand = candidateForApplicant(aid);
    if (cand && !isEffectivelyProfileAccepted(cand)) {
      tags.push({ label: 'Profile rejected', cls: 'ml-tag-rejected' });
    }
    return tags;
  }

  // ── Next-in-line: find eligible candidates for a slot ──
  function findNextInLine(program, quota, specialty, hospital) {
    const eligible = [];
    const placedHere = new Set();
    for (const m of meritData) {
      if ((fval(m, 'typeName', 'type', 'program') || '') === program &&
          (fval(m, 'quotaName', 'quota') || '') === quota &&
          (fval(m, 'specialityName', 'speciality', 'specialty') || '') === specialty &&
          (fval(m, 'hospitalName', 'hospital') || '') === hospital) {
        placedHere.add(String(fval(m, 'applicantId')));
      }
    }

    // Build consent accepted programs map: aid -> consented program
    const consentProgMap = {};
    for (const m of meritData) {
      const cv = getRowConsentVal(m);
      if (cv === 'Accepted') {
        const aid = String(fval(m, 'applicantId'));
        consentProgMap[aid] = fval(m, 'typeName', 'type', 'program') || '';
      }
    }

    for (const c of candidatesData) {
      const aid = String(c.applicantId);
      if (placedHere.has(aid)) continue;
      const pref = candidatePreferenceForSlot(c, program, quota, specialty, hospital);
      if (!pref) continue;
      if (!isEffectivelyProfileAccepted(c)) continue;
      const mark = effectiveMark(c, program, quota, specialty, hospital);
      if (mark == null) continue;
      const currentPlacement = meritData.find(m => String(fval(m, 'applicantId')) === aid);
      let currentSlot = null, currentPref = null;
      let isPlaced = false;
      let isHigherPref = false; // already at a better (lower number) preference
      let isLockedToOther = false; // consented to a different program
      if (currentPlacement) {
        isPlaced = true;
        const cpProg = fval(currentPlacement, 'typeName', 'type', 'program') || '';
        const cpQuota = fval(currentPlacement, 'quotaName', 'quota') || '';
        const cpSpec = fval(currentPlacement, 'specialityName', 'speciality', 'specialty') || '';
        const cpHosp = fval(currentPlacement, 'hospitalName', 'hospital') || '';
        currentSlot = `${cpSpec} @ ${cpHosp} (${cpProg}, ${cpQuota})`;
        currentPref = prefNoFromCandidate(aid, cpProg, cpQuota, cpSpec, cpHosp);
        // If current preference is lower number (better) than this slot's pref, they won't move
        if (currentPref != null && currentPref < pref.preferenceNo) {
          isHigherPref = true;
        }
        // If multi-track candidate consented to a different program than this slot
        if (multiTrackAids.has(aid) && consentProgMap[aid] && consentProgMap[aid] !== program) {
          isLockedToOther = true;
        }
      }
      eligible.push({
        aid, name: fval(c, 'nameFull', 'name') || '', marks: mark, prefNo: pref.preferenceNo,
        currentSlot, currentPref,
        isPlaced, isHigherPref, isLockedToOther,
        currentProg: currentPlacement ? fval(currentPlacement, 'typeName', 'type', 'program') : null,
        currentQuota: currentPlacement ? fval(currentPlacement, 'quotaName', 'quota') : null,
        currentSpec: currentPlacement ? fval(currentPlacement, 'specialityName', 'speciality', 'specialty') : null,
        currentHosp: currentPlacement ? fval(currentPlacement, 'hospitalName', 'hospital') : null,
      });
    }
    eligible.sort((a, b) => b.marks - a.marks);

    // Assign queue numbers to candidates who have a real chance
    // "Has chance" = not at higher preference, not locked to other program
    let queueNum = 0;
    for (const c of eligible) {
      if (!c.isHigherPref && !c.isLockedToOther) {
        queueNum++;
        c.queueNo = queueNum;
        c.hasChance = true;
      } else {
        c.queueNo = null;
        c.hasChance = false;
      }
    }
    return eligible;
  }

  function showNextInLineModal(program, quota, specialty, hospital) {
    const nextInLine = findNextInLine(program, quota, specialty, hospital);
    const withChance = nextInLine.filter(c => c.hasChance);
    const atHigher = nextInLine.filter(c => c.isHigherPref);
    const locked = nextInLine.filter(c => c.isLockedToOther);

    let modal = document.getElementById('mlNextInLineModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'mlNextInLineModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(10,14,26,0.8);backdrop-filter:blur(4px);';
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    const slotTitle = `${esc(specialty)} @ ${esc(hospital)} (${esc(program)}, ${esc(quota)})`;

    let rowsHtml = '';
    for (const c of nextInLine) {
      const currentInfo = c.isPlaced
        ? `P${c.currentPref} at ${esc(c.currentSlot)}`
        : 'Not placed';
      let queueBadge = '';
      if (c.hasChance) {
        const qColor = c.queueNo <= 3 ? 'var(--neon-green)' : 'var(--neon-cyan)';
        queueBadge = `<span class="ml-tag" style="background:rgba(77,184,217,0.12);color:${qColor};border:1px solid rgba(77,184,217,0.2);">Q${c.queueNo}</span>`;
      }
      let extraTags = '';
      if (c.isHigherPref) {
        extraTags += `<span class="ml-tag" style="background:rgba(120,120,120,0.10);color:var(--text-muted);border:1px solid rgba(120,120,120,0.15);">At higher pref &mdash; won&apos;t move</span>`;
      }
      if (c.isLockedToOther) {
        extraTags += `<span class="ml-tag" style="background:rgba(220,60,60,0.10);color:var(--neon-red);border:1px solid rgba(220,60,60,0.15);">Locked to other program</span>`;
      }
      if (!c.isPlaced && c.hasChance) {
        extraTags += `<span class="ml-tag" style="background:rgba(62,207,142,0.10);color:var(--neon-green);border:1px solid rgba(62,207,142,0.12);">Fresh placement</span>`;
      }
      if (c.isPlaced && c.hasChance) {
        extraTags += `<span class="ml-tag" style="background:rgba(232,166,39,0.10);color:var(--neon-gold);border:1px solid rgba(232,166,39,0.15);">Upgrade chance</span>`;
      }
      const rowOpacity = c.hasChance ? '1' : '0.5';
      rowsHtml += `<div class="ml-nextinline-row" data-aid="${esc(c.aid)}" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:6px 12px;cursor:pointer;border-radius:4px;opacity:${rowOpacity};" onmouseover="this.style.background='rgba(77,184,217,0.06)'" onmouseout="this.style.background=''">
        ${queueBadge}
        <span class="ml-row-id">${esc(c.aid)}</span>
        <span class="sim-row-name"><strong>${esc(c.name)}</strong></span>
        <span class="sim-row-marks">${c.marks.toFixed(2)}</span>
        <span class="ml-row-pref">P${c.prefNo}</span>
        <span style="font-size:0.6rem;color:var(--text-muted);">${currentInfo}</span>
        ${extraTags}
      </div>`;
    }

    modal.innerHTML = `<div style="background:var(--bg-card,rgba(20,25,40,0.97));border:1px solid rgba(77,184,217,0.25);border-radius:12px;max-width:700px;width:90%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div>
          <div style="font-size:0.9rem;font-weight:700;color:var(--neon-cyan);">${slotTitle}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${nextInLine.length} candidates &middot; <span style="color:var(--neon-green);">${withChance.length} can take slot</span> &middot; <span style="color:var(--text-muted);">${atHigher.length} at higher pref</span> &middot; <span style="color:var(--neon-red);">${locked.length} locked</span></div>
        </div>
        <button id="mlModalClose" style="font-size:1.2rem;background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px 8px;">&times;</button>
      </div>
      <div style="overflow-y:auto;padding:4px 0;">
        ${rowsHtml || '<div style="padding:2rem;text-align:center;color:var(--text-muted);">No eligible candidates</div>'}
      </div>
    </div>`;
    document.body.appendChild(modal);

    document.getElementById('mlModalClose')?.addEventListener('click', () => modal.remove());
    modal.querySelectorAll('.ml-nextinline-row').forEach(row => {
      row.addEventListener('click', () => {
        const aid = row.dataset.aid;
        const placement = meritData.find(m => String(fval(m, 'applicantId')) === aid);
        const entry = {
          aid,
          currentProg: placement ? fval(placement, 'typeName', 'type', 'program') || null : null,
          currentQuota: placement ? fval(placement, 'quotaName', 'quota') || null : null,
          currentSpec: placement ? fval(placement, 'specialityName', 'speciality', 'specialty') || null : null,
          currentHosp: placement ? fval(placement, 'hospitalName', 'hospital') || null : null,
        };
        modal.remove();
        navigateToCandidate(entry);
      });
    });
  }

  function navigateToCandidate(entry) {
    const prog = entry.currentProg;
    const spec = entry.currentSpec;
    const hosp = entry.currentHosp;
    const quota = entry.currentQuota;
    if (prog) document.getElementById('mlProgram').value = prog;
    if (spec) document.getElementById('mlSpecialty').value = spec;
    if (hosp) document.getElementById('mlHospital').value = hosp;
    if (quota) document.getElementById('mlQuota').value = quota;
    document.getElementById('mlSearch').value = String(entry.aid);
    document.getElementById('mlConsent').value = '';
    highlightAid = String(entry.aid);
    applyFilters();
  }

  // ── Simulation change log ──
  function buildSimLog() {
    if (!simCascadeResult || !originalMeritData.length) return null;
    const prevData = cascadeHistory.length > 1
      ? cascadeHistory[cascadeHistory.length - 2].placements
      : originalMeritData;
    const prevMap = {};
    for (const e of prevData) {
      if (typeof e.applicantId !== 'undefined') {
        prevMap[String(e.applicantId)] = `${e.typeName}|${e.specialityName}|${e.hospitalName}|${(e.quotaName || '').trim()}`;
      }
    }
    const simMap = {};
    for (const p of simCascadeResult.placements) {
      simMap[String(p.applicantId)] = `${p.typeName}|${p.specialityName}|${p.hospitalName}|${p.quotaName}`;
    }
    const newPlacements = [], upgrades = [], removals = [];
    for (const [aid, sk] of Object.entries(simMap)) {
      if (!prevMap[aid]) {
        newPlacements.push({ aid, seat: sk });
      } else if (prevMap[aid] !== sk) {
        upgrades.push({ aid, from: prevMap[aid], to: sk });
      }
    }
    for (const [aid, sk] of Object.entries(prevMap)) {
      if (!simMap[aid]) removals.push({ aid, seat: sk });
    }
    return { newPlacements, upgrades, removals };
  }

  function renderSimLog() {
    if (!showingSimulated) return '';
    const log = buildSimLog();
    if (!log) return '';
    const { newPlacements, upgrades, removals } = log;
    const parts = sk => { const p = sk.split('|'); return `${p[1]} @ ${p[2]} (${p[0]}, ${p[3]})`; };
    let html = `<div class="ml-simlog" style="margin-bottom:12px;padding:10px 14px;background:rgba(77,184,217,0.06);border:1px solid rgba(77,184,217,0.18);border-radius:8px;">
      <div style="font-size:0.78rem;font-weight:700;color:var(--neon-cyan);margin-bottom:6px;">Simulation Changes (Round ${simulatedRound})</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.72rem;">
        <span style="color:var(--neon-green);"><strong>${newPlacements.length}</strong> new</span>
        <span style="color:var(--neon-gold);"><strong>${upgrades.length}</strong> upgraded</span>
        <span style="color:var(--neon-red);"><strong>${removals.length}</strong> removed</span>
      </div>`;
    if (newPlacements.length) {
      html += `<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:0.7rem;color:var(--neon-green);">New placements (${newPlacements.length})</summary><div style="font-size:0.68rem;color:var(--text-muted);padding:4px 0 0 16px;">`;
      for (const e of newPlacements.slice(0, 30)) html += `<div>#${esc(e.aid)} &rarr; ${esc(parts(e.seat))}</div>`;
      if (newPlacements.length > 30) html += `<div>...and ${newPlacements.length - 30} more</div>`;
      html += `</div></details>`;
    }
    if (upgrades.length) {
      html += `<details style="margin-top:4px;"><summary style="cursor:pointer;font-size:0.7rem;color:var(--neon-gold);">Upgrades (${upgrades.length})</summary><div style="font-size:0.68rem;color:var(--text-muted);padding:4px 0 0 16px;">`;
      for (const e of upgrades.slice(0, 30)) html += `<div>#${esc(e.aid)}: ${esc(parts(e.from))} &rarr; ${esc(parts(e.to))}</div>`;
      if (upgrades.length > 30) html += `<div>...and ${upgrades.length - 30} more</div>`;
      html += `</div></details>`;
    }
    if (removals.length) {
      html += `<details style="margin-top:4px;"><summary style="cursor:pointer;font-size:0.7rem;color:var(--neon-red);">Removals (${removals.length})</summary><div style="font-size:0.68rem;color:var(--text-muted);padding:4px 0 0 16px;">`;
      for (const e of removals.slice(0, 30)) html += `<div>#${esc(e.aid)} left ${esc(parts(e.seat))}</div>`;
      if (removals.length > 30) html += `<div>...and ${removals.length - 30} more</div>`;
      html += `</div></details>`;
    }
    html += `</div>`;
    return html;
  }

  function renderSidebar() {
    const multiTrackList = [...multiTrackAids].map(aid => {
      const c = candidateForApplicant(aid);
      const entries = meritData.filter(d => String(fval(d, 'applicantId')) === aid);
      return { aid, name: c ? (fval(c, 'nameFull', 'name') || '—') : '—', entries };
    });
    const multiProgList = [...multiProgramAids].map(aid => {
      const c = candidateForApplicant(aid);
      const entries = meritData.filter(d => String(fval(d, 'applicantId')) === aid);
      const progs = [...new Set(entries.map(e => fval(e, 'typeName', 'type', 'program') || ''))];
      return { aid, name: c ? (fval(c, 'nameFull', 'name') || '—') : '—', progs, entries };
    });

    let html = `<div id="mlSidebar" style="width:260px;flex-shrink:0;">
      <div class="card" style="padding:12px;margin-bottom:12px;">
        <div style="font-size:0.82rem;font-weight:700;color:var(--neon-cyan);margin-bottom:8px;">Tidbits</div>
        <details open>
          <summary style="cursor:pointer;font-size:0.75rem;font-weight:700;color:var(--neon-pink);">Multi-track (${multiTrackList.length})</summary>
          <div style="font-size:0.68rem;color:var(--text-muted);margin-top:4px;">In both Armed &amp; Civilian</div>`;
    for (const item of multiTrackList) {
      const tracks = [...new Set(item.entries.map(e => isArmedQuota(fval(e, 'quotaName', 'quota')) ? 'Armed' : 'Civilian'))];
      html += `<div class="ml-tidbit-item" data-aid="${esc(item.aid)}" style="padding:4px 6px;margin:2px 0;border-radius:4px;cursor:pointer;transition:background 0.12s;" onmouseover="this.style.background='rgba(77,184,217,0.08)'" onmouseout="if(this.dataset.highlighted!=='1')this.style.background=''">
        <span style="color:var(--neon-cyan);">#${esc(item.aid)}</span> ${esc(item.name)}
        <span style="font-size:0.6rem;color:var(--text-muted);">${tracks.join(' + ')}</span>
      </div>`;
    }
    html += `</details>
        <details open style="margin-top:10px;">
          <summary style="cursor:pointer;font-size:0.75rem;font-weight:700;color:var(--neon-gold);">Multi-program (${multiProgList.length})</summary>
          <div style="font-size:0.68rem;color:var(--text-muted);margin-top:4px;">In multiple programs</div>`;
    for (const item of multiProgList) {
      html += `<div class="ml-tidbit-item" data-aid="${esc(item.aid)}" style="padding:4px 6px;margin:2px 0;border-radius:4px;cursor:pointer;transition:background 0.12s;" onmouseover="this.style.background='rgba(77,184,217,0.08)'" onmouseout="if(this.dataset.highlighted!=='1')this.style.background=''">
        <span style="color:var(--neon-cyan);">#${esc(item.aid)}</span> ${esc(item.name)}
        <span style="font-size:0.6rem;color:var(--text-muted);">${item.progs.join(' + ')}</span>
      </div>`;
    }
    html += `</details>
      </div>
    </div>`;
    return html;
  }

  function bindSidebarClicks() {
    document.querySelectorAll('.ml-tidbit-item').forEach(el => {
      el.addEventListener('click', () => {
        const aid = el.dataset.aid;
        highlightAid = aid;
        document.getElementById('mlSearch').value = aid;
        document.getElementById('mlProgram').value = '';
        document.getElementById('mlSpecialty').value = '';
        document.getElementById('mlHospital').value = '';
        document.getElementById('mlQuota').value = '';
        document.getElementById('mlConsent').value = '';
        applyFilters();
        // Mark sidebar item
        document.querySelectorAll('.ml-tidbit-item').forEach(e2 => { e2.dataset.highlighted = '0'; e2.style.background = ''; });
        el.dataset.highlighted = '1';
        el.style.background = 'rgba(77,184,217,0.15)';
      });
    });
  }

  function buildConsentRowsForCascade() {
    const rows = [];
    const byAid = {};
    for (const entry of meritData) {
      const aid = String(fval(entry, 'applicantId'));
      if (!byAid[aid]) byAid[aid] = [];
      byAid[aid].push(entry);
    }
    const processedAids = new Set();
    for (const [aid, entries] of Object.entries(byAid)) {
      processedAids.add(aid);
      const cid = Number(aid);
      let hasAccepted = false;
      let allRejected = true;
      for (const entry of entries) {
        const cv = getRowConsentVal(entry);
        if (cv === 'Accepted') {
          hasAccepted = true;
          allRejected = false;
          const program = fval(entry, 'typeName', 'type', 'program') || '';
          const quota = fval(entry, 'quotaName', 'quota') || '';
          const spec = fval(entry, 'specialityName', 'speciality', 'specialty') || '';
          const hosp = fval(entry, 'hospitalName', 'hospital') || '';
          const sk = `${program}|${spec}|${hosp}|${quota.trim()}`;
          rows.push({
            applicantId: cid,
            status: 'Accepted',
            seatKey: sk,
            infoTitle: `${program} - ${quota} - ${spec} - - ${hosp}`,
            preferenceNo: prefNoFromCandidate(cid, program, quota, spec, hosp) || 1,
          });
        } else if (cv === 'Excluded') {
          // Rejected for this slot
        } else {
          allRejected = false;
        }
      }
      if (!hasAccepted && allRejected) {
        rows.push({ applicantId: cid, status: 'Rejected', infoTitle: '', preferenceNo: 0 });
      } else if (!hasAccepted && !allRejected) {
        rows.push({ applicantId: cid, status: 'Awaited', infoTitle: '', preferenceNo: 0 });
      }
    }
    // Carry forward: candidates rejected in previous rounds but no longer in merit
    for (const aid of simRejectedAids) {
      const aidStr = String(aid);
      if (!processedAids.has(aidStr)) {
        rows.push({ applicantId: aid, status: 'Rejected', infoTitle: '', preferenceNo: 0 });
      }
    }
    return rows;
  }

  function buildSpecIdToNameMap() {
    const map = {};
    for (const [name, id] of Object.entries(specialtyNameToId)) {
      map[id] = name;
    }
    if (typeof SIM !== 'undefined' && SIM.disciplineData) {
      for (const disc of SIM.disciplineData) {
        for (const sp of (disc.specialities || [])) {
          if (sp.specialityId) map[sp.specialityId] = sp.specialityName;
        }
      }
    }
    return map;
  }

  function profileStatusFn(cid) {
    if (typeof getEffectiveProfileStatusForCandidate !== 'function') return null;
    const cand = candidateForApplicant(cid);
    if (!cand) return null;
    const eff = getEffectiveProfileStatusForCandidate(cand);
    return eff ? Number(eff.statusId) : null;
  }

  // ── Progress overlay ──

  function showProgressOverlay(label) {
    let overlay = document.getElementById('mlCascadeOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mlCascadeOverlay';
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
        background:rgba(10,14,26,0.85);backdrop-filter:blur(4px);`;
      overlay.innerHTML = `
        <div style="background:var(--bg-card,rgba(20,25,40,0.95));border:1px solid rgba(77,184,217,0.25);border-radius:16px;padding:32px 40px;max-width:420px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
          <div style="font-size:1.1rem;font-weight:700;color:var(--neon-cyan,#4db8d9);margin-bottom:16px;" id="mlCascadeLabel">${esc(label)}</div>
          <div style="position:relative;width:280px;height:8px;border-radius:4px;background:rgba(255,255,255,0.06);overflow:hidden;margin:0 auto 16px;">
            <div id="mlCascadeBar" style="position:absolute;left:0;top:0;height:100%;width:0%;border-radius:4px;background:linear-gradient(90deg,var(--neon-cyan,#4db8d9),var(--neon-blue,#5b8def));transition:width 0.3s ease;"></div>
          </div>
          <div id="mlCascadeDetail" style="font-size:0.78rem;color:var(--text-muted,#8b9bb4);font-family:var(--mono,monospace);">Initializing…</div>
        </div>`;
      document.body.appendChild(overlay);
    } else {
      overlay.style.display = 'flex';
      const lbl = document.getElementById('mlCascadeLabel');
      if (lbl) lbl.textContent = label;
    }
  }

  function updateProgressOverlay(pct, detail) {
    const bar = document.getElementById('mlCascadeBar');
    if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    const det = document.getElementById('mlCascadeDetail');
    if (det && detail) det.textContent = detail;
  }

  function hideProgressOverlay() {
    const overlay = document.getElementById('mlCascadeOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ── Run cascade (async, with progress) ──

  async function runCascadeSimulation() {
    if (typeof SimCascade === 'undefined') {
      setStatus('Cascade engine not loaded.', 'var(--neon-red)');
      return;
    }
    if (!meritData.length || !seatsData || !candidatesData.length) {
      setStatus('Missing data for cascade.', 'var(--neon-red)');
      return;
    }

    const nextRound = (showingSimulated ? simulatedRound : currentRound) + 1;
    showProgressOverlay(`Simulating Round ${nextRound}…`);
    updateProgressOverlay(2, 'Building consent data…');

    // Use current meritData for chained rounds, originalMeritData for first simulation
    const baseMerit = showingSimulated ? meritData : originalMeritData;
    const consentRows = buildConsentRowsForCascade();
    const specMap = buildSpecIdToNameMap();

    // Track newly excluded candidates before running cascade
    const newlyExcluded = new Set();
    for (const entry of meritData) {
      const cv = getRowConsentVal(entry);
      if (cv === 'Excluded') {
        newlyExcluded.add(Number(fval(entry, 'applicantId')));
      }
    }

    try {
      const result = await SimCascade.runCascade(
        baseMerit,
        consentRows,
        seatsData,
        candidatesMap,
        certificatesData,
        specMap,
        profileStatusFn,
        (progress) => {
          const { wave, changesThisPass, totalPlacements, totalUpgrades, done } = progress;
          if (done) {
            updateProgressOverlay(100, `Done — ${totalPlacements} placements, ${totalUpgrades} upgrades`);
          } else {
            // Heuristic progress: early waves have more changes, convergence is ~15-20 waves
            const pct = Math.min(90, (wave / 15) * 100);
            updateProgressOverlay(pct, `Wave ${wave}: ${changesThisPass} changes | ${totalPlacements} placements, ${totalUpgrades} upgrades`);
          }
        },
        simRejectedAids  // carry-forward rejected set
      );

      simCascadeResult = result;
      showingSimulated = true;
      simulatedRound = nextRound;

      // Carry forward rejected candidates
      if (result.consentRejected) {
        for (const cid of result.consentRejected) simRejectedAids.add(cid);
      }
      for (const cid of newlyExcluded) simRejectedAids.add(cid);

      // Save history snapshot
      cascadeHistory.push({
        round: simulatedRound,
        placements: result.placements.slice(),
        stats: { ...result.stats },
      });

      const s = result.stats;
      hideProgressOverlay();
      setStatus(
        `Round ${simulatedRound} simulated: ${s.waves} waves, ${s.totalPlacements} placements, ${s.totalUpgrades} upgrades, ${s.finalUnfilled} unfilled.`,
        'var(--neon-cyan)'
      );

      // Switch meritData to simulated output
      meritData = result.placements.map(p => ({
        applicantId: p.applicantId,
        nameFull: p.nameFull,
        marksTotal: p.marksTotal,
        typeName: p.typeName,
        specialityName: p.specialityName,
        hospitalName: p.hospitalName,
        quotaName: p.quotaName,
        preferenceNo: p.preferenceNo,
        rowNo: 0,
        _simulated: true,
        _effectiveMark: p.effectiveMark,
        _certBonus: p.certBonus,
      }));

      // Reset consent state for simulated view — all "Accepted"
      consentBySlot = {};
      userOverrides = {};
      for (const p of meritData) {
        const key = slotKey(p);
        consentBySlot[key] = 'Accepted';
      }

      renderMeritListUI();
      updateMeta();
    } catch (err) {
      console.error('[Cascade] Error:', err);
      hideProgressOverlay();
      setStatus('Cascade error: ' + err.message, 'var(--neon-red)');
    }
  }

  function showPublishedMerit() {
    if (!showingSimulated) return;
    showingSimulated = false;
    simulatedRound = 0;
    simCascadeResult = null;
    simRejectedAids = new Set();
    cascadeHistory = [];
    meritData = JSON.parse(JSON.stringify(originalMeritData));
    userOverrides = {};
    replacementMap.clear();
    setStatus('Restored published merit list.', 'var(--neon-green)');
    renderMeritListUI();
  }

  function showPreviousSimRound() {
    if (cascadeHistory.length < 2) {
      showPublishedMerit();
      return;
    }
    // Pop current round from history
    cascadeHistory.pop();
    const prev = cascadeHistory[cascadeHistory.length - 1];
    simulatedRound = prev.round;
    meritData = prev.placements.map(p => ({
      applicantId: p.applicantId,
      nameFull: p.nameFull,
      marksTotal: p.marksTotal,
      typeName: p.typeName,
      specialityName: p.specialityName,
      hospitalName: p.hospitalName,
      quotaName: p.quotaName,
      preferenceNo: p.preferenceNo,
      rowNo: 0,
      _simulated: true,
      _effectiveMark: p.effectiveMark,
      _certBonus: p.certBonus,
    }));
    consentBySlot = {};
    userOverrides = {};
    for (const p of meritData) {
      const key = slotKey(p);
      consentBySlot[key] = 'Accepted';
    }
    replacementMap.clear();
    setStatus(`Reverted to simulated Round ${simulatedRound}.`, 'var(--neon-gold)');
    renderMeritListUI();
  }

  // ── Replacement Algorithm ──

  function runReplacements() {
    // 1. Identify excluded/vacant slots from the merit list
    const vacantSlots = []; // { slotKey, program, quota, specialty, hospital, rowNo }
    const excludedAids = new Set();

    for (const entry of meritData) {
      const cv = getRowConsentVal(entry);
      if (cv === 'Excluded') {
        const sk = slotKey(entry);
        vacantSlots.push({
          slotKey: sk,
          program: fval(entry, 'typeName', 'type', 'program') || '',
          quota: fval(entry, 'quotaName', 'quota') || '',
          specialty: fval(entry, 'specialityName', 'speciality', 'specialty') || '',
          hospital: fval(entry, 'hospitalName', 'hospital') || '',
          rowNo: entry.rowNo
        });
        excludedAids.add(String(fval(entry, 'applicantId')));
      }
    }

    // Track candidate-slot assignments: slotPqshKey -> [{ aid, name, marks, prefNo, fromPqshKey?, rowNo }]
    const placements = new Map();
    const slotByAid = new Map(); // aid -> [pqshKey] (support multiple slots per candidate)
    const lockedAids = new Set(); // candidates at Preference 1

    // Initialize placements from merit list (Accepted rows only)
    for (const entry of meritData) {
      const cv = getRowConsentVal(entry);
      if (cv !== 'Accepted') continue;
      const aid = String(fval(entry, 'applicantId'));
      const pqsh = programQuotaSpecHospitalKey(entry);
      const prefNo = prefNoFromCandidate(aid, fval(entry, 'typeName', 'type', 'program') || '',
        fval(entry, 'quotaName', 'quota') || '', fval(entry, 'specialityName', 'speciality', 'specialty') || '',
        fval(entry, 'hospitalName', 'hospital') || '');
      if (!placements.has(pqsh)) placements.set(pqsh, []);
      placements.get(pqsh).push({ aid, name: fval(entry, 'nameFull', 'name') || '', marks: fval(entry, 'marksTotal', 'marks'), prefNo, rowNo: entry.rowNo });
      if (!slotByAid.has(aid)) slotByAid.set(aid, []);
      slotByAid.get(aid).push(pqsh);
      if (prefNo === 1) lockedAids.add(aid);
    }

    // Remove excluded slots from placements
    for (const v of vacantSlots) {
      const pqsh = `${v.program}::${v.quota}::${v.specialty}::${v.hospital}`;
      const arr = placements.get(pqsh);
      if (arr) {
        for (const occ of arr) {
          const list = slotByAid.get(occ.aid);
          if (list) {
            const idx = list.indexOf(pqsh);
            if (idx !== -1) list.splice(idx, 1);
          }
        }
      }
      placements.delete(pqsh);
    }

    // 2. Build queue of vacant pqsh keys
    const queue = vacantSlots.map(v => `${v.program}::${v.quota}::${v.specialty}::${v.hospital}`);
    const visited = new Set();

    // Helper: get the WORST occupant (lowest marks / highest prefNo) for a slot
    // This is the most replaceable occupant.
    function worstOccupant(arr) {
      if (!arr || !arr.length) return null;
      return arr.reduce((worst, o) => {
        if (o.marks < worst.marks) return o;
        if (o.marks === worst.marks && o.prefNo > worst.prefNo) return o;
        return worst;
      });
    }

    // Helper: find the slot pqsh for a candidate within the same (quota, programType)
    // that has the WORST preference number among their slots.
    function worstSlotForCandidate(aid, program, quota) {
      const pqshList = slotByAid.get(aid);
      if (!pqshList) return null;
      let worst = null;
      let worstPn = -1;
      for (const spqsh of pqshList) {
        const sparts = spqsh.split('::');
        if (sparts[0] !== program || sparts[1] !== quota) continue;
        const arr = placements.get(spqsh);
        if (!arr) continue;
        const occ = arr.find(o => String(o.aid) === aid);
        if (!occ) continue;
        if (occ.prefNo != null && (worstPn === -1 || occ.prefNo > worstPn)) {
          worst = spqsh;
          worstPn = occ.prefNo;
        }
      }
      return worst;
    }

    while (queue.length) {
      const pqsh = queue.shift();
      if (visited.has(pqsh)) continue;
      visited.add(pqsh);

      const parts = pqsh.split('::');
      const program = parts[0], quota = parts[1], specialty = parts[2], hospital = parts[3];

      // Build eligible candidate list
      const eligible = [];
      for (const c of candidatesData) {
        const aid = String(c.applicantId);
        if (lockedAids.has(aid)) continue;
        if (excludedAids.has(aid)) continue;
        if (cumulativeInactiveAids.has(aid)) continue;
        const pref = candidatePreferenceForSlot(c, program, quota, specialty, hospital);
        if (!pref) continue;
        const prefNo = pref.preferenceNo;
        if (prefNo == null) continue;
        const cand = candidateForApplicant(aid);
        if (!isEffectivelyProfileAccepted(cand)) continue;
        const marks = effectiveMark(c, program, quota, specialty, hospital);
        if (marks == null) continue;
        eligible.push({ aid, name: fval(c, 'nameFull', 'name') || '', marks, prefNo });
      }

      // Sort by marks descending
      eligible.sort((a, b) => b.marks - a.marks);

      for (const cand of eligible) {
        const occupiedSlots = slotByAid.get(cand.aid);

        if (!occupiedSlots || !occupiedSlots.length) {
          // Candidate not currently placed → place them here
          const v = vacantSlots.find(vv => `${vv.program}::${vv.quota}::${vv.specialty}::${vv.hospital}` === pqsh);
          if (!placements.has(pqsh)) placements.set(pqsh, []);
          placements.get(pqsh).push({ aid: cand.aid, name: cand.name, marks: cand.marks, prefNo: cand.prefNo, rowNo: v ? v.rowNo : null });
          if (!slotByAid.has(cand.aid)) slotByAid.set(cand.aid, []);
          slotByAid.get(cand.aid).push(pqsh);
          break;
        }

        // Candidate is placed elsewhere → find their worst slot in this (program, quota)
        const worstPqsh = worstSlotForCandidate(cand.aid, program, quota);
        if (!worstPqsh) continue;
        const worstArr = placements.get(worstPqsh);
        const worstOcc = worstArr ? worstArr.find(o => String(o.aid) === cand.aid) : null;
        if (!worstOcc) continue;
        const currentPrefNo = worstOcc.prefNo;

        if (cand.prefNo != null && currentPrefNo != null && cand.prefNo < currentPrefNo) {
          // This slot is a better preference → move them here
          const v = vacantSlots.find(vv => `${vv.program}::${vv.quota}::${vv.specialty}::${vv.hospital}` === pqsh);
          if (!placements.has(pqsh)) placements.set(pqsh, []);
          placements.get(pqsh).push({ aid: cand.aid, name: cand.name, marks: cand.marks, prefNo: cand.prefNo, isUpgrade: true, fromSlot: worstPqsh, rowNo: v ? v.rowNo : null });

          // Remove from old slot
          const oldArr = placements.get(worstPqsh);
          if (oldArr) {
            const idx = oldArr.findIndex(o => String(o.aid) === cand.aid);
            if (idx !== -1) oldArr.splice(idx, 1);
            if (oldArr.length === 0) placements.delete(worstPqsh);
          }

          // Update slotByAid
          const list = slotByAid.get(cand.aid);
          if (list) {
            const idx = list.indexOf(worstPqsh);
            if (idx !== -1) list.splice(idx, 1);
            list.push(pqsh);
          }

          // Old slot (now maybe empty) → add to queue
          if (!visited.has(worstPqsh)) queue.push(worstPqsh);

          break;
        }
        // else: candidate is in a better slot → skip
      }
    }

    // 3. Build replacementMap (pqsh -> occupant) for rendering
    // For display, we store only the primary occupant (lowest marks = most replaceable)
    // per slot so the UI can show "Next in line" for excluded slots.
    replacementMap.clear();
    for (const [pqsh, arr] of placements) {
      if (arr.length) {
        replacementMap.set(pqsh, arr[arr.length - 1]); // last = lowest marks (desc sorted)
      }
    }

    // 4. Mark displaced entries as excluded so getRowConsentVal reflects new state
    // An entry is displaced if:
    //   - The slot no longer exists in placements (was vacated by upgrade, no one filled it), OR
    //   - The slot exists but this candidate is no longer an occupant of it
    for (const entry of meritData) {
      const pqsh = programQuotaSpecHospitalKey(entry);
      const aid = String(fval(entry, 'applicantId'));
      const arr = placements.get(pqsh);
      const stillOccupant = arr && arr.some(o => String(o.aid) === aid);
      if (!stillOccupant) {
        const sk = slotKey(entry);
        if (getRowConsentVal(entry) === 'Accepted') {
          userOverrides[sk] = 'Excluded';
        }
      }
    }
  }

  // ── Filter ──

  function applyFilters() {
    const prog = (document.getElementById('mlProgram')?.value || '').toLowerCase();
    const spec = (document.getElementById('mlSpecialty')?.value || '').toLowerCase();
    const hosp = (document.getElementById('mlHospital')?.value || '').toLowerCase();
    const quota = (document.getElementById('mlQuota')?.value || '').toLowerCase();
    const search = (document.getElementById('mlSearch')?.value || '').toLowerCase().trim();
    const consentFilter = document.getElementById('mlConsent')?.value || '';

    filteredData = meritData.filter(d => {
      if (prog) { if ((fval(d, 'typeName', 'type', 'program') || '').toLowerCase() !== prog) return false; }
      if (spec) { if ((fval(d, 'specialityName', 'speciality', 'specialty') || '').toLowerCase() !== spec) return false; }
      if (hosp) { if ((fval(d, 'hospitalName', 'hospital') || '').toLowerCase() !== hosp) return false; }
      if (quota) { if ((fval(d, 'quotaName', 'quota') || '').toLowerCase() !== quota) return false; }
      if (search) {
        const name = (fval(d, 'nameFull', 'name') || '').toLowerCase();
        const id = String(fval(d, 'applicantId') || '');
        const pmdc = (fval(d, 'pmdcNo') || '').toLowerCase();
        if (!name.includes(search) && !id.includes(search) && !pmdc.includes(search)) return false;
      }
      if (consentFilter) {
        const cv = getRowConsentVal(d);
        if (cv !== consentFilter) return false;
      }
      return true;
    });
    updateMeta();
    renderMeritGrid();
  }

  // ── UI: Meta ──

  function updateMeta() {
    const metaEl = document.getElementById('meritListMeta');
    if (!metaEl) return;

    let accepted = 0, excluded = 0, awaited = 0;
    for (const entry of meritData) {
      const v = getRowConsentVal(entry);
      if (v === 'Accepted') accepted++;
      else if (v === 'Excluded') excluded++;
      else awaited++;
    }

    const fmt = d => d ? new Date(d).toLocaleString() : '—';
    const meritLabel = meritFileUpdatedAt ? fmt(meritFileUpdatedAt) : '—';
    const consentAt = consentFileUpdatedAt ? ' (updated ' + fmt(consentFileUpdatedAt) + ')' : '';

    const displayRound = showingSimulated ? simulatedRound : currentRound;
    const isSim = showingSimulated;
    const cascadeInfo = isSim && simCascadeResult ? ` | ${simCascadeResult.stats.waves} waves, ${simCascadeResult.stats.totalUpgrades} upgrades, ${simCascadeResult.stats.finalUnfilled} unfilled` : '';

    metaEl.innerHTML = `
      <div class="cur-meta-grid">
        <div><span class="cur-meta-lbl">${isSim ? 'Sim Round' : 'Round'}</span><span class="cur-meta-val" style="${isSim ? 'color:var(--neon-cyan);' : ''}">${displayRound}</span></div>
        <div><span class="cur-meta-lbl">Total</span><span class="cur-meta-val">${meritData.length.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-green);">Accepted</span><span class="cur-meta-val">${accepted.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-red);">Excluded</span><span class="cur-meta-val">${excluded.toLocaleString()}</span></div>
        <div><span class="cur-meta-lbl" style="color:var(--neon-gold);">Awaited</span><span class="cur-meta-val">${awaited.toLocaleString()}</span></div>
        ${seatsData ? `<div><span class="cur-meta-lbl">Seats</span><span class="cur-meta-val">${seatsData.length} slots</span></div>` : ''}
        ${isSim
          ? `<div><span class="cur-meta-lbl">Source</span><span class="cur-meta-val" style="font-family:var(--mono);font-size:0.72rem;color:var(--neon-cyan);">Simulated from Round ${cascadeHistory.length > 1 ? simulatedRound - 1 : currentRound}</span></div>`
          : `<div><span class="cur-meta-lbl">Merit File</span><span class="cur-meta-val" style="font-family:var(--mono);font-size:0.72rem;color:var(--neon-cyan);">${meritLabel}</span></div>`
        }
        <div><span class="cur-meta-lbl">${isSim ? 'Carry-forward' : 'Consent File'}</span><span class="cur-meta-val" style="font-family:var(--mono);font-size:0.72rem;color:var(--neon-pink);">${isSim ? `${simRejectedAids.size} rejected` : `Round ${currentRound}${consentAt}`}</span></div>
      </div>
      <div class="cur-meta-note" style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);font-size:0.75rem;line-height:1.5;color:var(--text-muted);">
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">
          <span><span style="color:var(--neon-green);font-weight:700;">&#9679; Accepted</span> — consented to this slot</span>
          <span><span style="color:var(--neon-red);font-weight:700;">&#9679; Excluded</span> — rejected / dropped / manually excluded</span>
          <span><span style="color:var(--neon-gold);font-weight:700;">&#9679; Awaited</span> — awaiting decision</span>
        </div>
        <div>${isSim
          ? `<strong style="color:var(--neon-cyan);">Simulated Round ${displayRound}</strong>${cascadeInfo}. Toggle consent pills to simulate accept/reject decisions, then click <strong>Simulate Round ${displayRound + 1}</strong> to chain the next round. Rejected candidates carry forward.`
          : 'Click a pill to cycle states. Excluded slots are filled via replacement chain. Candidates at Preference 1 stay locked. <strong>Run Chain</strong> to batch-fill all vacancies.'
        }</div>
      </div>`;
  }

  // ── UI: Grid ──

  function renderMeritGrid() {
    const grid = document.getElementById('mlGrid');
    const caption = document.getElementById('mlCaption');
    const countEl = document.getElementById('mlCount');
    if (!grid) return;

    if (!filteredData.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">No entries match filters.</div>';
      if (caption) caption.textContent = '';
      if (countEl) countEl.textContent = '0 entries';
      return;
    }

    const slotMap = {};
    for (const d of filteredData) {
      const gk = programQuotaSpecHospitalKey(d);
      if (!slotMap[gk]) slotMap[gk] = [];
      slotMap[gk].push(d);
    }

    const cards = [];
    for (const [groupKey, entries] of Object.entries(slotMap)) {
      const parts = groupKey.split('::');
      const program = parts[0], quota = parts[1], specialty = parts[2], hospital = parts[3];

      const occupants = [], vacated = [], awaited = [];
      for (const d of entries) {
        const v = getRowConsentVal(d);
        if (v === 'Accepted') occupants.push(d);
        else if (v === 'Excluded') vacated.push(d);
        else awaited.push(d);
      }

      const activeCount = occupants.length;
      const vacatedCount = vacated.length;

      function rowHtml(d, opts) {
        opts = opts || {};
        const isVacated = !!opts.isVacated;
        const consentVal = getRowConsentVal(d);
        const applicantId = String(fval(d, 'applicantId') || '');
        const name = fval(d, 'nameFull', 'name') || '—';
        const marks = fval(d, 'marksTotal', 'marks');
        const marksStr = marks != null ? Number(marks).toFixed(2) : '—';
        const prefDisplay = opts.prefNo != null ? 'P' + opts.prefNo : 'P?';
        const rowKey = slotKey(d);
        const isHighlighted = highlightAid === applicantId;

        let stateClass, stateLabel, pillClass;
        if (isVacated || consentVal === 'Excluded') {
          stateClass = 'ml-row-excluded'; stateLabel = 'Excluded'; pillClass = 'ml-pill-excluded';
        } else if (consentVal === 'Awaited') {
          stateClass = 'ml-row-awaiting'; stateLabel = 'Awaited'; pillClass = 'ml-pill-awaiting';
        } else {
          stateClass = 'ml-row-accepted'; stateLabel = 'Accepted'; pillClass = 'ml-pill-accepted';
        }

        const tags = getCandidateTags(d);
        const tagsHtml = tags.map(t => `<span class="ml-tag ${t.cls}">${t.label}</span>`).join('');

        return `<div class="sim-row ${stateClass} ${isHighlighted ? 'ml-row-highlight' : ''}" data-key="${esc(rowKey)}" data-aid="${esc(applicantId)}">
          <span class="ml-state-bar"></span>
          <span class="ml-row-id">${esc(applicantId)}</span>
          <span class="sim-row-name"><strong>${esc(name)}</strong></span>
          <span class="sim-row-marks">${marksStr}</span>
          <span class="ml-row-pref">${prefDisplay}</span>
          <span class="ml-state-pill ${pillClass}" data-key="${esc(rowKey)}">${stateLabel}</span>
          ${tagsHtml}
        </div>`;
      }

      const slotCardKey = groupKey;
      const isExpanded = expandedNextInLine.has(slotCardKey);
      let cardHtml = `<div class="ml-slot-card">
        <div class="ml-slot-header">
          <span class="ml-slot-title">${esc(specialty)} @ ${esc(hospital)} (${esc(program)}, ${esc(quota)})</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="ml-slot-count">${activeCount} occupant${activeCount !== 1 ? 's' : ''}</span>
            <button class="ml-next-btn" data-slot="${esc(slotCardKey)}" data-program="${esc(program)}" data-quota="${esc(quota)}" data-specialty="${esc(specialty)}" data-hospital="${esc(hospital)}" style="font-size:0.62rem;padding:2px 8px;border-radius:4px;background:rgba(77,184,217,0.12);color:var(--neon-cyan);border:1px solid rgba(77,184,217,0.2);cursor:pointer;">${isExpanded ? '&#9650; Hide' : '&#9660; Next in line'}</button>
          </span>
        </div>`;

      if (isExpanded) {
        const nextInLine = findNextInLine(program, quota, specialty, hospital);
        const withChance = nextInLine.filter(c => c.hasChance);
        const atHigher = nextInLine.filter(c => c.isHigherPref);
        const locked = nextInLine.filter(c => c.isLockedToOther);
        if (nextInLine.length) {
          cardHtml += `<div class="ml-nextinline-section">
            <div class="ml-section-label" style="color:var(--neon-cyan);">&#9679; Next in line (${nextInLine.length})</div>`;
          if (withChance.length) {
            cardHtml += `<div style="font-size:0.6rem;color:var(--neon-green);padding:3px 10px 2px;font-weight:700;">${withChance.length} can take this slot</div>`;
          }
          for (const c of nextInLine.slice(0, 20)) {
            const currentInfo = c.isPlaced
              ? `P${c.currentPref} at ${esc(c.currentSlot)}`
              : 'Not placed';
            // Queue badge
            let queueBadge = '';
            if (c.hasChance) {
              const qColor = c.queueNo <= 3 ? 'var(--neon-green)' : 'var(--neon-cyan)';
              queueBadge = `<span class="ml-tag" style="background:rgba(77,184,217,0.12);color:${qColor};border:1px solid rgba(77,184,217,0.2);">Q${c.queueNo}</span>`;
            }
            // Tags
            let extraTags = '';
            if (c.isHigherPref) {
              extraTags += `<span class="ml-tag" style="background:rgba(120,120,120,0.10);color:var(--text-muted);border:1px solid rgba(120,120,120,0.15);">At higher pref &mdash; won&apos;t move</span>`;
            }
            if (c.isLockedToOther) {
              extraTags += `<span class="ml-tag" style="background:rgba(220,60,60,0.10);color:var(--neon-red);border:1px solid rgba(220,60,60,0.15);">Locked to other program</span>`;
            }
            if (!c.isPlaced && c.hasChance) {
              extraTags += `<span class="ml-tag" style="background:rgba(62,207,142,0.10);color:var(--neon-green);border:1px solid rgba(62,207,142,0.12);">Fresh placement</span>`;
            }
            if (c.isPlaced && c.hasChance) {
              extraTags += `<span class="ml-tag" style="background:rgba(232,166,39,0.10);color:var(--neon-gold);border:1px solid rgba(232,166,39,0.15);">Upgrade chance</span>`;
            }
            const rowOpacity = c.hasChance ? '1' : '0.5';
            cardHtml += `<div class="ml-nextinline-row" data-aid="${esc(c.aid)}" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:4px 10px;cursor:pointer;border-radius:4px;opacity:${rowOpacity};" onmouseover="this.style.background='rgba(77,184,217,0.06)'" onmouseout="this.style.background=''">
              ${queueBadge}
              <span class="ml-row-id">${esc(c.aid)}</span>
              <span class="sim-row-name"><strong>${esc(c.name)}</strong></span>
              <span class="sim-row-marks">${c.marks.toFixed(2)}</span>
              <span class="ml-row-pref">P${c.prefNo}</span>
              <span style="font-size:0.58rem;color:var(--text-muted);">${currentInfo}</span>
              ${extraTags}
            </div>`;
          }
          if (nextInLine.length > 20) {
            cardHtml += `<div style="font-size:0.6rem;color:var(--text-muted);padding:4px 10px;display:flex;align-items:center;gap:8px;">...and ${nextInLine.length - 20} more (${Math.max(0, withChance.length - 20)} with chance) <button class="ml-show-all-btn" data-program="${esc(program)}" data-quota="${esc(quota)}" data-specialty="${esc(specialty)}" data-hospital="${esc(hospital)}" style="font-size:0.6rem;padding:2px 8px;border-radius:4px;background:rgba(77,184,217,0.12);color:var(--neon-cyan);border:1px solid rgba(77,184,217,0.2);cursor:pointer;">Show all ${nextInLine.length}</button></div>`;
          }
          cardHtml += `</div>`;
        } else {
          cardHtml += `<div class="ml-nextinline-section"><div class="ml-next-candidate ml-next-empty"><span class="sim-next-lbl">No eligible candidates for this slot</span></div></div>`;
        }
      }

      if (occupants.length) {
        cardHtml += `<div class="ml-occupants-section">
          <div class="ml-section-label occupants">&#9679; Occupants</div>`;
        for (const d of occupants) {
          cardHtml += rowHtml(d, { prefNo: prefNoFromCandidate(fval(d, 'applicantId'), program, quota, specialty, hospital) });
        }
        cardHtml += `</div>`;
      }

      if (vacated.length) {
        cardHtml += `<div class="ml-vacated-section">
          <div class="ml-section-label vacated">&#9679; Excluded</div>`;
        for (const d of vacated) {
          cardHtml += rowHtml(d, { isVacated: true, prefNo: prefNoFromCandidate(fval(d, 'applicantId'), program, quota, specialty, hospital) });
          // Show next-in-line
          const nextOcc = replacementMap.get(groupKey);
          if (nextOcc && String(nextOcc.aid) !== String(fval(d, 'applicantId'))) {
            cardHtml += `<div class="ml-next-candidate">
              <span class="sim-next-lbl">&#8595; Next in line:</span>
              <span class="sim-next-name">#${esc(nextOcc.aid)} ${esc(nextOcc.name)}</span>
              <span class="sim-next-marks">${Number(nextOcc.marks).toFixed(2)}</span>
              <span class="sim-next-pref">P${nextOcc.prefNo}</span>
            </div>`;
          } else {
            cardHtml += `<div class="ml-next-candidate ml-next-empty">
              <span class="sim-next-lbl">&#8595; No eligible replacement</span>
            </div>`;
          }
        }
        cardHtml += `</div>`;
      }

      if (awaited.length) {
        cardHtml += `<div class="ml-awaited-section">
          <div class="ml-section-label awaited">&#9679; Awaited</div>`;
        for (const d of awaited) {
          cardHtml += rowHtml(d, { prefNo: prefNoFromCandidate(fval(d, 'applicantId'), program, quota, specialty, hospital) });
        }
        cardHtml += `</div>`;
      }

      cardHtml += `</div>`;
      cards.push(cardHtml);
    }

    grid.innerHTML = cards.join('\n');
    if (caption) caption.textContent = '';
    if (countEl) countEl.textContent = filteredData.length.toLocaleString() + ' entries';

    // Bind pill clicks
    grid.querySelectorAll('.ml-state-pill').forEach(pill => {
      pill.addEventListener('click', function (e) {
        e.stopPropagation();
        const key = this.dataset.key;
        if (!key) return;
        const current = userOverrides[key] !== undefined ? userOverrides[key] : consentBySlot[key] || 'Awaited';
        if (current === 'Accepted') { userOverrides[key] = 'Excluded'; }
        else if (current === 'Excluded') { userOverrides[key] = 'Awaited'; }
        else if (current === 'Awaited') { userOverrides[key] = 'Accepted'; }
        else { userOverrides[key] = 'Awaited'; }
        applyFilters();
        updateMeta();
        setStatus('Toggled ' + key, '');
      });
    });

    // Bind next-in-line button clicks
    grid.querySelectorAll('.ml-next-btn').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const sk = this.dataset.slot;
        if (expandedNextInLine.has(sk)) {
          expandedNextInLine.delete(sk);
        } else {
          expandedNextInLine.add(sk);
        }
        renderMeritGrid();
      });
    });

    // Bind next-in-line row clicks → navigate to candidate's placement
    grid.querySelectorAll('.ml-nextinline-row').forEach(row => {
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        const aid = this.dataset.aid;
        const entry = {
          aid,
          currentProg: null, currentQuota: null, currentSpec: null, currentHosp: null,
        };
        // Find their current placement in meritData
        const placement = meritData.find(m => String(fval(m, 'applicantId')) === aid);
        if (placement) {
          entry.currentProg = fval(placement, 'typeName', 'type', 'program') || null;
          entry.currentQuota = fval(placement, 'quotaName', 'quota') || null;
          entry.currentSpec = fval(placement, 'specialityName', 'speciality', 'specialty') || null;
          entry.currentHosp = fval(placement, 'hospitalName', 'hospital') || null;
        }
        navigateToCandidate(entry);
      });
    });

    // Bind "Show all" button → modal
    grid.querySelectorAll('.ml-show-all-btn').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showNextInLineModal(
          this.dataset.program,
          this.dataset.quota,
          this.dataset.specialty,
          this.dataset.hospital
        );
      });
    });
  }

  // ── UI: Restore ──

  function restoreInitial() {
    if (showingSimulated) {
      showPublishedMerit();
      return;
    }
    userOverrides = {};
    replacementMap.clear();
    meritData = JSON.parse(JSON.stringify(originalMeritData));
    setStatus('Consent states restored to initial (round ' + currentRound + ').', 'var(--neon-green)');
    applyFilters();
  }

  // ── UI: Render ──

  function renderMeritListUI() {
    if (!$tabContent) return;

    computeTidbits();

    const programs = [...new Set(meritData.map(d => fval(d, 'typeName', 'type', 'program')).filter(Boolean))].sort();
    const specialties = [...new Set(meritData.map(d => fval(d, 'specialityName', 'speciality', 'specialty')).filter(Boolean))].sort();
    const hospitals = [...new Set(meritData.map(d => fval(d, 'hospitalName', 'hospital')).filter(Boolean))].sort();
    const quotas = [...new Set(meritData.map(d => fval(d, 'quotaName', 'quota')).filter(Boolean))].sort();

    const isSimView = showingSimulated;
    const nextRound = (isSimView ? simulatedRound : currentRound) + 1;
    const simBtn = document.getElementById('mlSimNextBtn');
    if (simBtn) {
      if (isSimView) {
        simBtn.innerHTML = `&#9889; Simulate Round ${nextRound + 1}`;
      } else {
        simBtn.innerHTML = `&#9889; Simulate Round ${nextRound}`;
      }
    }

    $tabContent.innerHTML = `
      <style>
        .ml-state-pill { display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:100px;font-size:0.65rem;font-weight:700;letter-spacing:0.01em;white-space:nowrap;cursor:pointer;user-select:none; }
        .ml-state-pill:hover { filter:brightness(1.25); }
        .ml-pill-accepted { background:rgba(62,207,142,0.12);color:var(--neon-green);border:1px solid rgba(62,207,142,0.15); }
        .ml-pill-excluded { background:rgba(220,60,60,0.10);color:var(--neon-red);border:1px solid rgba(220,60,60,0.15); }
        .ml-pill-awaiting { background:rgba(232,166,39,0.10);color:var(--neon-gold);border:1px solid rgba(232,166,39,0.15); }
        .ml-state-bar { display:inline-block;width:3px;height:24px;border-radius:2px;flex-shrink:0; }
        .ml-row-accepted .ml-state-bar { background:var(--neon-green); }
        .ml-row-excluded .ml-state-bar { background:var(--neon-red); }
        .ml-row-awaiting .ml-state-bar { background:var(--neon-gold); }
        #mlGrid .sim-row { display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:6px 10px;border-radius:6px;cursor:default;transition:background 0.12s; }
        #mlGrid .sim-row:hover { background:rgba(77,184,217,0.08); }
        .ml-row-highlight { background:rgba(77,184,217,0.15) !important;box-shadow:0 0 0 1px rgba(77,184,217,0.3); }
        .ml-slot-card { background:var(--bg-card);border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden; }
        .ml-slot-header { display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06); }
        .ml-slot-title { font-weight:700;font-size:0.78rem; }
        .ml-slot-count { font-size:0.65rem;color:var(--text-muted);padding:2px 8px;border-radius:100px;background:rgba(255,255,255,0.05); }
        .ml-section-label { display:flex;align-items:center;gap:6px;padding:5px 10px 3px;font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted); }
        .ml-section-label.occupants { color:var(--neon-green); }
        .ml-section-label.vacated { color:var(--neon-red); }
        .ml-section-label.awaited { color:var(--neon-gold); }
        .ml-vacated-section { border-top:1px dashed rgba(220,60,60,0.18);margin-top:6px;padding-top:4px; }
        .ml-awaited-section { border-top:1px dashed rgba(232,166,39,0.18);margin-top:6px;padding-top:4px; }
        .ml-nextinline-section { border-top:1px dashed rgba(77,184,217,0.18);margin-top:6px;padding-top:4px; }
        .ml-next-candidate { display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 10px 6px 16px;font-size:0.7rem;color:var(--neon-cyan);background:rgba(77,184,217,0.04);border-radius:0 0 6px 6px;margin:0 2px 2px;border-left:2px solid rgba(77,184,217,0.3); }
        .ml-next-empty { color:var(--text-muted);font-style:italic; }
        .sim-next-lbl { font-size:0.62rem;text-transform:uppercase;letter-spacing:0.03em;opacity:0.7; }
        .ml-tag { display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.55rem;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;white-space:nowrap; }
        .ml-tag-armed { background:rgba(220,60,60,0.10);color:var(--neon-red);border:1px solid rgba(220,60,60,0.15); }
        .ml-tag-civilian { background:rgba(62,207,142,0.10);color:var(--neon-green);border:1px solid rgba(62,207,142,0.12); }
        .ml-tag-multitrack { background:rgba(220,80,180,0.10);color:#dc50b4;border:1px solid rgba(220,80,180,0.15); }
        .ml-tag-multiprog { background:rgba(232,166,39,0.10);color:var(--neon-gold);border:1px solid rgba(232,166,39,0.15); }
        .ml-tag-rejected { background:rgba(180,60,60,0.10);color:#b43c3c;border:1px solid rgba(180,60,60,0.15); }
        .ml-next-btn:hover { filter:brightness(1.3); }
      </style>
      <div class="section-header">
        <h2>${showingSimulated ? 'Simulated' : 'Merit List'} — Round ${showingSimulated ? simulatedRound : currentRound}</h2>
        <p>${showingSimulated ? 'Cascade simulation output — ' + meritData.length.toLocaleString() + ' placements.' : 'Published merit placements for Induction 21 — ' + meritData.length.toLocaleString() + ' entries.'}</p>
      </div>
      <div id="meritListMeta" class="current-meta-card"></div>
      ${renderSimLog()}
      <details id="mlGuide" style="margin-bottom:12px;">
        <summary style="cursor:pointer;font-size:0.8rem;font-weight:700;color:var(--neon-cyan);padding:8px 14px;background:rgba(77,184,217,0.06);border:1px solid rgba(77,184,217,0.15);border-radius:8px;list-style:none;display:flex;align-items:center;gap:6px;">
          <span style="font-size:1rem;">&#9432;</span> How to use this page
        </summary>
        <div style="padding:12px 16px;background:rgba(20,25,40,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:0 0 8px 8px;font-size:0.75rem;line-height:1.6;color:var(--text-muted);">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:4px;">
            <div>
              <div style="font-weight:700;color:var(--neon-green);margin-bottom:4px;">Browsing</div>
              <ul style="margin:0;padding-left:18px;">
                <li><strong>Round dropdown</strong> switches between published merit rounds (loads matching consent file too).</li>
                <li><strong>Filters</strong> (Program, Specialty, Hospital, Quota) narrow the grid. Search by name, PMDC, or applicant ID.</li>
                <li><strong>Consent pills</strong> show each candidate's status: <span style="color:var(--neon-green);font-weight:700;">Accepted</span> (consented to this slot), <span style="color:var(--neon-red);font-weight:700;">Excluded</span> (rejected/dropped), <span style="color:var(--neon-gold);font-weight:700;">Awaited</span> (pending). Click to cycle: Accepted &rarr; Excluded &rarr; Awaited.</li>
                <li><strong>Tidbits sidebar</strong> lists multi-track (Armed + Civilian) and multi-program candidates. Click one to filter and highlight them.</li>
              </ul>
            </div>
            <div>
              <div style="font-weight:700;color:var(--neon-cyan);margin-bottom:4px;">Next in Line</div>
              <ul style="margin:0;padding-left:18px;">
                <li>Each slot card has a <strong>&#9660; Next in line</strong> button showing all eligible candidates who prefer that slot.</li>
                <li>Candidates get <strong>Q#</strong> queue badges &mdash; Q1 is first in line by marks.</li>
                <li><span style="color:var(--neon-green);">Fresh placement</span> = not currently placed, can take the slot directly.</li>
                <li><span style="color:var(--neon-gold);">Upgrade chance</span> = currently at a worse preference, can upgrade here.</li>
                <li><span style="color:var(--text-muted);">At higher pref</span> = already at a better slot, won't move (shown dimmed).</li>
                <li><span style="color:var(--neon-red);">Locked to other program</span> = multi-track candidate consented elsewhere.</li>
                <li>Click <strong>Show all</strong> for the full list in a modal. Click any candidate to jump to their current placement.</li>
              </ul>
            </div>
            <div>
              <div style="font-weight:700;color:var(--neon-gold);margin-bottom:4px;">Simulation</div>
              <ul style="margin:0;padding-left:18px;">
                <li><strong>Simulate Next Round</strong> runs the cascade engine in-browser: fills vacated seats, upgrades candidates to better preferences, and evicts weaker occupants &mdash; matching the Python algorithm at 93.9% accuracy.</li>
                <li>Before simulating, toggle consent pills to model accept/reject decisions. Excluded candidates vacate their seats; the cascade fills them.</li>
                <li>Rejected candidates <strong>carry forward</strong> across simulated rounds &mdash; they stay ineligible.</li>
                <li>You can <strong>chain rounds</strong>: simulate Round 3 from the Round 2 output, then Round 4 from Round 3, etc.</li>
                <li><strong>Previous Round</strong> reverts to the prior simulation. <strong>Reset All</strong> returns to the published merit list.</li>
                <li>The <strong>change log</strong> bar (above the grid, when simulating) shows new placements, upgrades, and removals with expandable details.</li>
              </ul>
            </div>
            <div>
              <div style="font-weight:700;color:var(--neon-pink);margin-bottom:4px;">Tags</div>
              <ul style="margin:0;padding-left:18px;">
                <li><span class="ml-tag ml-tag-armed">Armed</span> / <span class="ml-tag ml-tag-civilian">Civilian</span> &mdash; quota track.</li>
                <li><span class="ml-tag ml-tag-multitrack">Multi-track</span> &mdash; candidate holds seats in both Armed &amp; Civilian.</li>
                <li><span class="ml-tag ml-tag-multiprog">Multi-program</span> &mdash; candidate placed in multiple programs (FCPS + MS, etc.).</li>
                <li><span class="ml-tag ml-tag-rejected">Profile rejected</span> &mdash; profile status not accepted (excluded from allocation).</li>
              </ul>
            </div>
          </div>
        </div>
      </details>
      <div style="display:flex;gap:16px;align-items:flex-start;">
        ${renderSidebar()}
        <div style="flex:1;min-width:0;">
      <div class="card filter-card">
        <div class="input-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
          <div class="form-group">
            <label>Round</label>
            <select id="mlRound" ${showingSimulated ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
              ${availableRounds.map(r => `<option value="${r}" ${r === currentRound ? 'selected' : ''}>Round ${r}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Program</label>
            <select id="mlProgram"><option value="">All Programs</option>${programs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label>Specialty</label>
            <select id="mlSpecialty"><option value="">All Specialties</option>${specialties.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label>Hospital</label>
            <select id="mlHospital"><option value="">All Hospitals</option>${hospitals.map(h => `<option value="${esc(h)}">${esc(h)}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label>Quota</label>
            <select id="mlQuota"><option value="">All Quotas</option>${quotas.map(q => `<option value="${esc(q)}">${esc(q)}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label>Search</label>
            <input type="text" id="mlSearch" placeholder="Name, PMDC, ID…" class="mt-filter-input" />
          </div>
          <div class="form-group">
            <label>Consent</label>
            <select id="mlConsent">
              <option value="">All</option>
              <option value="Accepted">Accepted</option>
              <option value="Excluded">Excluded</option>
              <option value="Awaited">Awaited</option>
            </select>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <span id="mlCount" style="font-size:0.82rem;color:var(--text-muted);">${meritData.length.toLocaleString()} entries</span>
        <span style="font-size:0.72rem;color:var(--text-muted);padding:6px 0;">Click a pill to toggle: <span style="color:var(--neon-green);">Accepted</span> &rarr; <span style="color:var(--neon-red);">Excluded</span> &rarr; <span style="color:var(--neon-gold);">Awaited</span></span>
        <button id="mlSimNextBtn" style="font-size:0.85rem;padding:6px 16px;background:rgba(77,184,217,0.12);color:var(--neon-cyan);border:1px solid rgba(77,184,217,0.28);border-radius:8px;cursor:pointer;">&#9889; Simulate Next Round</button>
        ${showingSimulated ? `<button id="mlBackBtn" style="font-size:0.82rem;padding:6px 14px;background:rgba(245,200,66,0.12);color:#f5c842;border:1px solid rgba(245,200,66,0.28);border-radius:8px;cursor:pointer;">&#8592; ${cascadeHistory.length > 1 ? 'Previous Round' : 'Show Published'}</button>` : ''}
        <button id="mlRestoreBtn" style="font-size:0.82rem;padding:6px 14px;background:rgba(245,200,66,0.12);color:#f5c842;border:1px solid rgba(245,200,66,0.28);border-radius:8px;cursor:pointer;">&#8635; ${showingSimulated ? 'Reset All' : 'Restore Initial'}</button>
        <span id="mlStatus" style="font-size:0.78rem;color:var(--text-muted);"></span>
      </div>
      <div id="mlGrid" class="sim-grid">
        <div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">Loading…</div>
      </div>
      <p id="mlCaption" class="table-caption"></p>
        </div>
      </div>`;

    document.getElementById('mlRound')?.addEventListener('change', (e) => {
      const r = parseInt(e.target.value, 10);
      if (r > 0 && r !== currentRound) {
        currentRound = r;
        userSelectedRound = true;
        loadMeritData();
      }
    });
    document.getElementById('mlProgram')?.addEventListener('change', applyFilters);
    document.getElementById('mlSpecialty')?.addEventListener('change', applyFilters);
    document.getElementById('mlHospital')?.addEventListener('change', applyFilters);
    document.getElementById('mlQuota')?.addEventListener('change', applyFilters);
    document.getElementById('mlSearch')?.addEventListener('input', applyFilters);
    document.getElementById('mlConsent')?.addEventListener('change', applyFilters);
    document.getElementById('mlRestoreBtn')?.addEventListener('click', restoreInitial);
    document.getElementById('mlSimNextBtn')?.addEventListener('click', () => {
      runCascadeSimulation();
    });
    document.getElementById('mlBackBtn')?.addEventListener('click', () => {
      if (cascadeHistory.length > 1) {
        showPreviousSimRound();
      } else {
        showPublishedMerit();
      }
    });
    bindSidebarClicks();

    updateMeta();
    applyFilters();
  }

  // ── Data Loading ──

  async function loadMeritData() {
    if (!$tabContent) return;
    showingSimulated = false;
    simCascadeResult = null;
    simulatedRound = 0;
    simRejectedAids = new Set();
    cascadeHistory = [];
    highlightAid = null;
    expandedNextInLine = new Set();

    // Detect available rounds if not yet done
    await detectAvailableRounds();
    // Clamp currentRound to available range
    if (availableRounds.length && !availableRounds.includes(currentRound)) {
      currentRound = availableRounds[availableRounds.length - 1];
    }

    $tabContent.innerHTML = `
      <div class="section-header">
        <h2>Merit List — Round ${currentRound}</h2>
        <p>Published merit placements for Induction 21. Data from <code>${meritFile()}</code>.</p>
      </div>
      <div style="text-align:center;padding:3rem;color:var(--text-muted);">Loading merit data…</div>`;

    try {
      const [meritRes, consentRes, seatsRes, candRes, discRes, certRes] = await Promise.all([
        fetch(meritFile(), { cache: 'no-store' }),
        fetch(consentFile(), { cache: 'no-store' }),
        fetch('data/induction21_seats.json', { cache: 'no-store' }),
        fetch('data/induction21_candidates.json', { cache: 'no-store' }),
        fetch('data/disciplineFullData.json', { cache: 'no-store' }),
        fetch('data/induction21_certificates.json', { cache: 'no-store' }),
      ]);

      if (!meritRes.ok) throw new Error('Failed to load merit list: HTTP ' + meritRes.status);

      const raw = await meritRes.json();
      meritData = Array.isArray(raw) ? raw : (raw.Table5 || []);
      originalMeritData = JSON.parse(JSON.stringify(meritData));

      const meritDate = meritRes.headers.get('Last-Modified');
      if (meritDate) meritFileUpdatedAt = meritDate;

      let consentRawRows = [];
      if (consentRes.ok) {
        consentRawRows = await consentRes.json();
        if (!Array.isArray(consentRawRows)) consentRawRows = [];
        const consentDate = consentRes.headers.get('Last-Modified');
        if (consentDate) consentFileUpdatedAt = consentDate;
      }
      const parsed = parseConsentRaw(consentRawRows);
      consentBySlot = buildConsentBySlot(parsed);
      const cumulative = await buildCumulativeConsentSets(currentRound);
      cumulativeRejected = cumulative.rejected;
      cumulativeInactiveAids = cumulative.inactiveAids;
      cumulativeDroppedByProgram = cumulative.droppedByProgram;

      if (seatsRes.ok) seatsData = await seatsRes.json();

      if (candRes.ok) {
        const rawCands = await candRes.json();
        candidatesData = Array.isArray(rawCands) ? rawCands : (Object.values(rawCands) || []);
        candidatesMap = {};
        for (const c of candidatesData) {
          candidatesMap[String(c.applicantId)] = c;
          if (c.preferences && typeof c.preferences === 'object' && !Array.isArray(c.preferences)) {
            const prefArr = Object.values(c.preferences).filter(p => p && typeof p === 'object');
            c.preferences = prefArr;
            if (!c.preference || typeof c.preference !== 'object') c.preference = {};
            for (const pref of prefArr) {
              const prog = pref.typeName || pref.program || '';
              if (!prog) continue;
              if (!Array.isArray(c.preference[prog])) c.preference[prog] = [];
              c.preference[prog].push(pref);
            }
          }
        }
      }

      if (discRes.ok) {
        const discList = await discRes.json();
        specialtyNameToId = {};
        if (Array.isArray(discList)) {
          for (const d of discList) {
            for (const sp of (d.specialities || [])) {
              const name = (sp.specialityName || '').toLowerCase().trim();
              if (name) specialtyNameToId[name] = sp.specialityId;
            }
          }
        }
      }

      if (certRes.ok) {
        const rawCerts = await certRes.json();
        certificatesData = rawCerts && typeof rawCerts === 'object' && !Array.isArray(rawCerts) ? rawCerts : {};
      }

      renderMeritListUI();
    } catch (err) {
      console.error('[MeritList] Load error:', err);
      if ($tabContent) {
        $tabContent.innerHTML = `
          <div class="section-header">
            <h2>Merit List — Round ${currentRound}</h2>
          </div>
          <div class="card" style="text-align:center;padding:2rem;color:var(--neon-pink);">
            Failed to load merit list: ${esc(err.message)}
          </div>`;
      }
    }
  }

  // ── Watermark ──

  function applyWatermark(enabled) {
    const guard = document.querySelector('.watermark-overlay, #watermarkOverlay');
    if (guard) guard.style.display = enabled ? '' : 'none';
    if (typeof setWatermarkEnabled === 'function') setWatermarkEnabled(enabled);
  }

  // ── Mode ──

  function applyMode(mode) {
    const isMerit = mode === 'merit-list';
    if (isMerit === merritListActive) return;
    merritListActive = isMerit;
    $tabBtn = $tabBtn || document.querySelector('[data-tab="simulation"]');
    $tabContent = $tabContent || document.getElementById('tab-simulation');
    if (isMerit) {
      if ($tabBtn) $tabBtn.textContent = '\u{1F4CA} Merit List';
      // Hide irrelevant tabs in merit-list mode
      document.querySelectorAll('[data-tab="slotbrowser"], [data-tab="consent"]').forEach(btn => {
        btn.style.display = 'none';
      });
      // Rename Guide tab and replace its content with merit-list guide
      const guideBtn = document.querySelector('[data-tab="guide"]');
      if (guideBtn) guideBtn.innerHTML = '\u{1F4CB} Overview';
      const guideTab = document.getElementById('tab-guide');
      if (guideTab) {
        guideTab.classList.add('active');
        const simTab = document.getElementById('tab-simulation');
        if (simTab) simTab.classList.remove('active');
        guideTab.innerHTML = buildMeritListGuideHtml();
      }
      // Make guide the active tab initially
      if (guideBtn) guideBtn.classList.add('active');
      if ($tabBtn) $tabBtn.classList.remove('active');
      loadMeritData();
    } else {
      if ($tabBtn) $tabBtn.textContent = '\u26A1 Seat Allocation';
      window.location.reload();
    }
  }

  function buildMeritListGuideHtml() {
    return `
    <div class="section-header">
      <h2>Merit List Mode &mdash; Overview</h2>
      <p>Published merit placements with consent tracking, next-in-line analysis, and multi-round cascade simulation.</p>
    </div>

    <div class="portal-guide-hero">
      <div class="portal-guide-copy">
        <span class="portal-guide-kicker">What this mode shows</span>
        <h3>Published merit list with consent and simulation.</h3>
        <p>This mode displays the official published merit list for each round, overlaid with consent data (who accepted, rejected, or is awaiting). You can browse by program/specialty/hospital/quota, see who occupies each slot, check who is next in line, and run a cascade simulation to predict the next round.</p>
        <div class="portal-guide-actions">
          <button class="btn btn-primary portal-guide-action" data-tab="simulation">Open Merit List</button>
        </div>
      </div>
      <div class="portal-guide-side">
        <strong>Quick start</strong>
        <ol>
          <li>Open the <strong>Merit List</strong> tab to see published placements.</li>
          <li>Use <strong>filters</strong> (Round, Program, Specialty, Hospital, Quota) to narrow down.</li>
          <li>Click <strong>&#9660; Next in line</strong> on any slot to see eligible candidates.</li>
          <li>Toggle <strong>consent pills</strong> to model accept/reject decisions.</li>
          <li>Click <strong>&#9889; Simulate Next Round</strong> to run the cascade engine.</li>
        </ol>
      </div>
    </div>

    <div class="portal-guide-goals">
      <article class="portal-goal-card">
        <h3>Browsing the merit list</h3>
        <p>Each slot card shows its occupants with consent pills: <span style="color:var(--neon-green);font-weight:700;">Accepted</span> (consented), <span style="color:var(--neon-red);font-weight:700;">Excluded</span> (rejected/dropped), <span style="color:var(--neon-gold);font-weight:700;">Awaited</span> (pending). Click pills to cycle states. Use the <strong>Round</strong> dropdown to switch between published rounds.</p>
      </article>
      <article class="portal-goal-card">
        <h3>Next in line</h3>
        <p>Every slot has a <strong>&#9660; Next in line</strong> button. It shows all eligible candidates ranked by marks with <strong>Q#</strong> queue badges. Tags indicate <span style="color:var(--neon-green);">Fresh placement</span>, <span style="color:var(--neon-gold);">Upgrade chance</span>, <span style="color:var(--text-muted);">At higher pref</span> (won't move), or <span style="color:var(--neon-red);">Locked to other program</span>. Click any candidate to jump to their current placement.</p>
      </article>
      <article class="portal-goal-card">
        <h3>Cascade simulation</h3>
        <p>Toggle consent pills to model decisions, then click <strong>&#9889; Simulate Next Round</strong>. The cascade engine fills vacated seats and upgrades candidates to better preferences &mdash; 93.9% accurate vs official merit. Rejected candidates <strong>carry forward</strong> across rounds. Chain multiple rounds: simulate Round 3 from Round 2 output, then Round 4, etc.</p>
      </article>
      <article class="portal-goal-card">
        <h3>Tidbits sidebar</h3>
        <p>The sidebar lists <strong style="color:var(--neon-pink);">multi-track</strong> candidates (in both Armed &amp; Civilian) and <strong style="color:var(--neon-gold);">multi-program</strong> candidates (in multiple programs). Click any name to filter the grid and highlight that candidate across all their slots.</p>
      </article>
      <article class="portal-goal-card">
        <h3>Change log</h3>
        <p>After running a simulation, a <strong style="color:var(--neon-cyan);">change log bar</strong> appears above the grid showing new placements (green), upgrades (gold), and removals (red). Each category expands to show specific candidates and their seat changes.</p>
      </article>
      <article class="portal-goal-card">
        <h3>Tags on candidates</h3>
        <p><span class="ml-tag ml-tag-armed">Armed</span> / <span class="ml-tag ml-tag-civilian">Civilian</span> &mdash; quota track.<br>
        <span class="ml-tag ml-tag-multitrack">Multi-track</span> &mdash; in both Armed &amp; Civilian.<br>
        <span class="ml-tag ml-tag-multiprog">Multi-program</span> &mdash; in multiple programs.<br>
        <span class="ml-tag ml-tag-rejected">Profile rejected</span> &mdash; not accepted in profile status.</p>
      </article>
    </div>

    <div class="portal-guide-mini">
      <h3>Key concepts</h3>
      <div class="portal-guide-mini-grid">
        <div class="portal-mini-item">
          <strong>Published merit</strong>
          <span>Official placements from the portal. Each round is a snapshot.</span>
        </div>
        <div class="portal-mini-item">
          <strong>Consent overlay</strong>
          <span>Accepted = keeps the seat. Excluded = seat vacated. Awaited = pending decision.</span>
        </div>
        <div class="portal-mini-item">
          <strong>Cascade engine</strong>
          <span>Fills vacated seats in merit order. Candidates upgrade to better preferences. 93.9% accurate.</span>
        </div>
        <div class="portal-mini-item">
          <strong>Carry-forward</strong>
          <span>Rejected candidates stay ineligible across simulated rounds.</span>
        </div>
      </div>
    </div>

    <details class="portal-guide-reference">
      <summary>Detailed reference: consent resolution, queue logic, and cascade algorithm</summary>
      <div class="guide-grid">
        <div class="guide-card">
          <div class="guide-card-icon">&#128203;</div>
          <h3>Consent resolution</h3>
          <p>Each merit entry is matched against the consent file by <code>applicantId + program + quota + specialty + hospital</code>:</p>
          <ul class="guide-ul">
            <li><strong>Exact match</strong> &mdash; the consent status for this specific slot.</li>
            <li><strong>Accepted elsewhere</strong> &mdash; candidate consented to a different slot &rarr; marked Excluded (seat vacated).</li>
            <li><strong>Rejected in same track</strong> &mdash; rejected for this program+quota &rarr; Excluded.</li>
            <li><strong>No match</strong> &mdash; Awaiting decision.</li>
          </ul>
        </div>
        <div class="guide-card">
          <div class="guide-card-icon">&#127919;</div>
          <h3>Queue logic (Next in line)</h3>
          <p>For each slot, eligible candidates are sorted by effective marks (base + certificate bonus):</p>
          <ul class="guide-ul">
            <li><strong>Q1, Q2, Q3&hellip;</strong> &mdash; queue position. Q1 = highest marks, first to take the seat.</li>
            <li><strong>Fresh placement</strong> &mdash; not currently placed anywhere, can take this slot directly.</li>
            <li><strong>Upgrade chance</strong> &mdash; currently at a worse preference, can upgrade here (displacing their old seat).</li>
            <li><strong>At higher pref</strong> &mdash; already at a better (lower-numbered) preference. Won't move. Shown dimmed for reference.</li>
            <li><strong>Locked to other program</strong> &mdash; multi-track candidate who consented to a different program. Cannot take this slot.</li>
          </ul>
        </div>
        <div class="guide-card guide-card-highlight">
          <div class="guide-card-icon">&#9889;</div>
          <h3>Cascade algorithm</h3>
          <p>The cascade engine (JS port of <code>merit_cascade.py</code>) runs in-browser:</p>
          <ol class="guide-ol">
            <li>Load published merit as initial occupancy (all seats filled).</li>
            <li>Generate vacancies: consent removals + profile-status rejections.</li>
            <li>Multi-pass: each wave processes all vacated seats &mdash; fill with best candidate or upgrade existing occupants.</li>
            <li>Specialty-specific sorting prevents unrelated certificate bonuses from inflating priority.</li>
            <li>Single-track candidates can hold seats in both Armed and Civilian quotas independently.</li>
            <li>Multi-track candidates are restricted to their consented quota.</li>
            <li>Repeat until stable (no changes in a wave).</li>
          </ol>
          <div class="guide-note"><strong>93.9% agreement</strong> with official Round 2 merit. Remaining differences are cross-specialty placements and portal-specific tiebreakers.</div>
        </div>
        <div class="guide-card">
          <div class="guide-card-icon">&#128260;</div>
          <h3>Multi-round chaining</h3>
          <ul class="guide-ul">
            <li><strong>Round N &rarr; N+1:</strong> Uses published Round N as starting point, applies your consent toggles, runs cascade.</li>
            <li><strong>Round N+1 &rarr; N+2:</strong> Uses the simulated N+1 output as the new starting point.</li>
            <li><strong>Carry-forward rejected:</strong> Candidates rejected in any round stay ineligible for all subsequent rounds.</li>
            <li><strong>Previous Round button:</strong> Reverts to the prior simulation step.</li>
            <li><strong>Reset All:</strong> Returns to the published merit list, clears all simulation state.</li>
          </ul>
        </div>
        <div class="guide-card" style="grid-column: 1 / -1">
          <div class="guide-card-icon">&#128218;</div>
          <h3>Glossary</h3>
          <div class="guide-glossary">
            <div class="guide-gloss-item"><dt>Consent round</dt><dd>The portal publishes a merit list, then candidates accept or reject their assigned seat. Rejections create vacancies for the next round.</dd></div>
            <div class="guide-gloss-item"><dt>Effective mark</dt><dd>Base marks (MBBS aggregate) + certificate bonus for the specific program/specialty. Determines queue ranking.</dd></div>
            <div class="guide-gloss-item"><dt>Multi-track</dt><dd>Candidate who holds seats in both Armed Force and Civilian quotas within the same program. Restricted to their consented quota during simulation.</dd></div>
            <div class="guide-gloss-item"><dt>Multi-program</dt><dd>Candidate placed in multiple programs (e.g., FCPS + MD). If they consent to one, they are restricted to that program in the cascade.</dd></div>
            <div class="guide-gloss-item"><dt>Locked (P#1)</dt><dd>Candidate at Preference #1 who accepted &mdash; cannot be displaced from that slot. Blocks cross-program upgrades only.</dd></div>
            <div class="guide-gloss-item"><dt>Profile status</dt><dd>Verification/amendment status (Accepted/Rejected/Pending). Only Accepted candidates are eligible for allocation.</dd></div>
          </div>
        </div>
      </div>
    </details>`;
  }

  // ── Init ──

  function init() {
    if (typeof firebase === 'undefined') { setTimeout(init, 500); return; }
    try { db = firebase.firestore(); } catch (_) { setTimeout(init, 500); return; }

    // URL parameter override for Firestore-independent access
    const urlParams = new URLSearchParams(window.location.search);
    const urlMode = urlParams.get('mode');
    const urlRound = urlParams.get('round');

    if (urlMode === 'merit-list') {
      if (urlRound) { const r = parseInt(urlRound, 10); if (r > 0) currentRound = r; }
      // Detect available rounds and default to latest if not specified
      detectAvailableRounds().then(rounds => {
        if (rounds.length && !urlRound) {
          currentRound = rounds[rounds.length - 1];
        }
        applyMode('merit-list');
      });
      // Keep listening to Firestore for live updates (non-blocking)
    }

    db.collection('notifications').doc('simulation_mode').onSnapshot(snap => {
      const mode = snap.exists ? snap.data().mode : 'seat-allocation';
      if (urlMode === 'merit-list') return; // URL param takes precedence
      applyMode(mode);
    }, err => {
      console.warn('[MeritList] Firestore error, defaulting to seat-allocation:', err);
      if (urlMode === 'merit-list') return;
      applyMode('seat-allocation');
    });

    db.collection('notifications').doc('watermark_config').onSnapshot(snap => {
      const enabled = snap.exists ? snap.data().enabled !== false : true;
      applyWatermark(enabled);
    }, err => { applyWatermark(true); });

    db.collection('notifications').doc('consent_round').onSnapshot(snap => {
      const data = snap.exists ? snap.data() : {};
      if (data.fileUpdatedAt) consentFileUpdatedAt = data.fileUpdatedAt;
      // Don't override if user manually selected a round or URL param is set
      if (userSelectedRound || urlRound) {
        if (merritListActive) updateMeta();
        return;
      }
      const fsRound = parseInt(data.round, 10) || 0;
      // Use Firestore round if valid, else latest available, else 1
      let round = fsRound;
      if (round <= 0 && availableRounds.length) round = availableRounds[availableRounds.length - 1];
      if (round <= 0) round = 1;
      if (round !== currentRound) {
        currentRound = round;
        if (merritListActive && meritData.length) {
          loadMeritData();
        }
      }
      if (merritListActive) updateMeta();
    }, err => {
      console.warn('[MeritList] consent_round Firestore error, using round', currentRound);
    });
  }

  // Inject modal animations
  if (!document.getElementById('mlSimAnimStyle')) {
    const st = document.createElement('style');
    st.id = 'mlSimAnimStyle';
    st.textContent = `
      @keyframes mlFadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes mlSlideUp { from { opacity:0; transform:translateY(24px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }
    `;
    document.head.appendChild(st);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
