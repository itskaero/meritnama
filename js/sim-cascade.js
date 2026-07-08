'use strict';

// ═══════════════════════════════════════════════════════════════════
// sim-cascade.js — JS port of merit_cascade.py
// Multi-pass upgrade cascade with all 5 bug fixes:
//   Bug 1: Real preference numbers (not FM dummy preferenceNo:0)
//   Bug 2: Beat-check only on full seats
//   Bug 3: Multi-track quota restriction to consent quota
//   Bug 4: Specialty-specific sorting (no unrelated bonus inflation)
//   Bug 5: Per-quota seat holding for single-track candidates
// ═══════════════════════════════════════════════════════════════════

(function () {

  const MISSING_SPEC_IDS = {
    63: 'Physical Medicine & Rehablitation',
    69: 'Nuclear Medicine',
    70: 'Immunology',
    71: 'Virology',
  };

  // ── Helpers ──

  function seatKey(entry) {
    const q = (entry.quotaName || '').trim();
    return `${entry.typeName}|${entry.specialityName}|${entry.hospitalName}|${q}`;
  }

  function seatKeyFromParts(typeName, specName, hospName, quotaName) {
    return `${typeName}|${specName}|${hospName}|${(quotaName || '').trim()}`;
  }

  function parseConsentTitle(title) {
    const parts = String(title || '').split(' - ').map(p => p.trim());
    if (parts.length >= 4) {
      return { typeName: parts[0], quotaName: parts[1], specialityName: parts[2], hospitalName: parts[parts.length - 1] };
    }
    return null;
  }

  function consentSeatKey(consentRow) {
    // Direct seatKey takes precedence (used for simulated rounds)
    if (consentRow.seatKey) return consentRow.seatKey;
    const p = parseConsentTitle(consentRow.infoTitle);
    if (!p) return null;
    return seatKeyFromParts(p.typeName, p.specialityName, p.hospitalName, p.quotaName);
  }

  // ── Main cascade function ──
  //
  // Inputs:
  //   meritData:       array of published merit entries (round N)
  //   consentRaw:      array of consent rows (round N)
  //   seatsRaw:        array of seat capacity entries
  //   candidatesMap:   { cid_string: candidate }
  //   certificatesData:{ cid_string: [cert, ...] }
  //   specMap:         { specialityId: specialityName }
  //   profileStatusFn: function(cid) -> statusId (1=Accepted, 2=Rejected, 11=Pending, null=none)
  //
  // Returns:
  //   {
  //     placements: [{ applicantId, typeName, specialityName, hospitalName, quotaName, preferenceNo, marksTotal, effectiveMark, certBonus, nameFull }],
  //     stats: { waves, totalPlacements, totalUpgrades, initialVacancies, finalUnfilled },
  //     seats: internal seat state (for debugging)
  //   }

  async function runCascade(meritData, consentRaw, seatsRaw, candidatesMap, certificatesData, specMapInput, profileStatusFn, onProgress, extraRejected) {
    const specMap = Object.assign({}, specMapInput, MISSING_SPEC_IDS);

    // ── Build seat capacity map ──
    const seatCapacity = {};
    for (const s of seatsRaw) {
      const sk = seatKey(s);
      seatCapacity[sk] = s.seats;
    }

    // ── Build candidate marks ──
    const candidateMarks = {};
    const allCandidateIds = [];
    for (const [cidStr, cand] of Object.entries(candidatesMap)) {
      const cid = Number(cidStr);
      candidateMarks[cid] = cand.marksTotal || 0;
      allCandidateIds.push(cid);
    }

    // ── Build cert bonus maps ──
    // certBonus[cid] = { "typeId_discId": bonus }
    const certBonus = {};
    for (const cid of allCandidateIds) {
      const bonusMap = {};
      const certs = certificatesData[String(cid)] || [];
      for (const cert of certs) {
        const bonus = cert.certificateMarks || cert.computerizedMarks || 0;
        const key = `${cert.typeId}_${cert.disciplineId}`;
        if (!(key in bonusMap) || bonus > bonusMap[key]) {
          bonusMap[key] = bonus;
        }
      }
      certBonus[cid] = bonusMap;
    }

    // ── Build effective marks per seat ──
    // effMarkForSeat[cid][seatKey] = marksTotal + cert bonus
    const effMarkForSeat = {};
    for (const cid of allCandidateIds) {
      const base = candidateMarks[cid] || 0;
      const prefMap = {};
      const cand = candidatesMap[String(cid)];
      if (!cand || !Array.isArray(cand.preferences)) continue;
      for (const pref of cand.preferences) {
        const specName = specMap[pref.specialityId];
        if (!specName) continue;
        const sk = seatKeyFromParts(pref.typeName, specName, pref.hospitalName, pref.quotaName);
        if (!(sk in seatCapacity)) continue;
        let bonus = 0;
        for (const discId of (pref.disciplineIds || [])) {
          const key = `${pref.typeId}_${discId}`;
          const b = certBonus[cid]?.[key] || 0;
          if (b > bonus) bonus = b;
        }
        prefMap[sk] = base + bonus;
      }
      if (Object.keys(prefMap).length) effMarkForSeat[cid] = prefMap;
    }

    // ── Build candidate preference maps ──
    // prefMap[cid] = { seatKey: prefNo }
    // candidatePrograms[cid] = Set of typeNames
    const candidatePrefMap = {};
    const candidatePrograms = {};
    for (const cid of allCandidateIds) {
      const prefMap = {};
      const progs = new Set();
      const cand = candidatesMap[String(cid)];
      if (!cand || !Array.isArray(cand.preferences)) continue;
      for (const p of cand.preferences) {
        const specName = specMap[p.specialityId];
        if (!specName) continue;
        const sk = seatKeyFromParts(p.typeName, specName, p.hospitalName, p.quotaName);
        if (sk in seatCapacity) {
          prefMap[sk] = p.preferenceNo;
          progs.add(p.typeName);
        }
      }
      candidatePrefMap[cid] = prefMap;
      candidatePrograms[cid] = progs;
    }

    // ── Effective mark helper ──
    function effectiveMark(cid, sk) {
      return effMarkForSeat[cid]?.[sk] ?? candidateMarks[cid] ?? 0;
    }

    // ── Profile status eligibility ──
    function isCandidateEligible(cid) {
      const s = profileStatusFn(cid);
      if (s !== 1) return false;
      if (consentRejected.has(cid) || consentAwaited.has(cid)) return false;
      return true;
    }

    // ── Consent processing ──
    const candidateConsents = {};
    for (const row of consentRaw) {
      const cid = row.applicantId;
      if (!candidateConsents[cid]) candidateConsents[cid] = [];
      candidateConsents[cid].push(row);
    }

    const consentApproved = {};
    const consentRejected = new Set();
    const consentAwaited = new Set();

    for (const [cid, rows] of Object.entries(candidateConsents)) {
      const accepted = rows.filter(r => r.status === 'Accepted');
      if (accepted.length) {
        accepted.sort((a, b) => a.preferenceNo - b.preferenceNo);
        consentApproved[cid] = accepted[0];
      }
      if (rows.every(r => r.status === 'Rejected')) {
        consentRejected.add(Number(cid));
      }
      if (rows.every(r => r.status === 'Awaited')) {
        consentAwaited.add(Number(cid));
      }
    }

    // Merge carry-forward rejected candidates from previous simulated rounds
    if (extraRejected && extraRejected.size) {
      for (const cid of extraRejected) {
        consentRejected.add(cid);
      }
    }

    // ── Initialize seats ──
    const seats = {};
    for (const [sk, cap] of Object.entries(seatCapacity)) {
      seats[sk] = { capacity: cap, occupants: {} };
    }

    // ── Load published merit as initial occupancy ──
    const candidateState = {}; // cid -> { seatKey: prefNo }
    const fmCandidateEntries = {}; // cid -> [entries]
    let initialFmCandidateCount = 0;
    let initialFmOccupancy = 0;

    for (const e of meritData) {
      const cid = e.applicantId;
      const sk = seatKey(e);
      const prefNo = candidatePrefMap[cid]?.[sk] ?? 0;
      if (seats[sk]) {
        seats[sk].occupants[cid] = prefNo;
        if (!candidateState[cid]) candidateState[cid] = {};
        candidateState[cid][sk] = prefNo;
      }
      if (!fmCandidateEntries[cid]) {
        fmCandidateEntries[cid] = [];
        initialFmCandidateCount++;
      }
      fmCandidateEntries[cid].push(e);
      initialFmOccupancy++;
    }

    // ── Track FM programs and quotas ──
    const candidateFmPrograms = {}; // cid -> Set of typeNames
    for (const e of meritData) {
      const cid = e.applicantId;
      if (!candidateFmPrograms[cid]) candidateFmPrograms[cid] = new Set();
      candidateFmPrograms[cid].add(e.typeName);
    }
    const multiProgramFm = new Set();
    for (const [cid, progs] of Object.entries(candidateFmPrograms)) {
      if (progs.size > 1) multiProgramFm.add(Number(cid));
    }

    const candidateFmQuotas = {}; // cid -> { typeName: Set of quotaNames }
    for (const e of meritData) {
      const cid = e.applicantId;
      if (!candidateFmQuotas[cid]) candidateFmQuotas[cid] = {};
      const tn = e.typeName;
      const q = (e.quotaName || '').trim();
      if (!candidateFmQuotas[cid][tn]) candidateFmQuotas[cid][tn] = new Set();
      candidateFmQuotas[cid][tn].add(q);
    }

    const multiTrackInType = {}; // cid -> Set of typeNames
    for (const [cidStr, tq] of Object.entries(candidateFmQuotas)) {
      const cid = Number(cidStr);
      for (const [tn, qs] of Object.entries(tq)) {
        if (qs.size > 1) {
          if (!multiTrackInType[cid]) multiTrackInType[cid] = new Set();
          multiTrackInType[cid].add(tn);
        }
      }
    }

    // ── Generate vacancies ──
    const vacantQueue = [];

    function vacate(cid, seatKey, reason) {
      if (seats[seatKey]?.occupants[cid] != null) {
        delete seats[seatKey].occupants[cid];
        if (candidateState[cid]?.[seatKey] != null) {
          delete candidateState[cid][seatKey];
        }
        vacantQueue.push(seatKey);
        return true;
      }
      return false;
    }

    function vacateAllCandidateSeats(cid, reason) {
      const held = candidateState[cid] ? Object.keys(candidateState[cid]) : [];
      for (const sk of held) {
        vacate(cid, sk, reason);
      }
    }

    for (const cid of Object.keys(candidateState).map(Number)) {
      // Step 1: Effective status
      const eff = profileStatusFn(cid);
      if (eff != null && eff !== 1) {
        vacateAllCandidateSeats(cid, `ProfileStatus=${eff}`);
        continue;
      }

      // Step 2: Consent Rejected/Awaited
      if (consentRejected.has(cid) || consentAwaited.has(cid)) {
        vacateAllCandidateSeats(cid, `Consent ${consentRejected.has(cid) ? 'Rejected' : 'Awaited'}`);
        continue;
      }

      // Step 3: Consent Accepted — keep consent seat, vacate others
      if (consentApproved[cid]) {
        const accSk = consentSeatKey(consentApproved[cid]);
        if (!accSk) continue;

        const heldSeats = candidateState[cid] ? Object.keys(candidateState[cid]) : [];
        for (const sk of heldSeats) {
          if (sk !== accSk && seats[sk]?.occupants[cid] != null) {
            vacate(cid, sk, 'Vacated for consent seat');
          }
        }

        // Ensure candidate is at consent seat
        if (accSk in seatCapacity) {
          const seat = seats[accSk];
          if (seat && seat.occupants[cid] == null) {
            if (Object.keys(seat.occupants).length < seat.capacity) {
              const prefNo = candidatePrefMap[cid]?.[accSk] ?? 999;
              seat.occupants[cid] = prefNo;
              if (!candidateState[cid]) candidateState[cid] = {};
              candidateState[cid][accSk] = prefNo;
            }
          }
        }
      }
    }

    // ── Determine allowed programs ──
    const candidateAllowedPrograms = {};
    for (const cid of Object.keys(candidateState).map(Number)) {
      if (consentApproved[cid]) {
        const accSk = consentSeatKey(consentApproved[cid]);
        if (accSk) {
          const consentProg = accSk.split('|')[0];
          if (multiProgramFm.has(cid)) {
            candidateAllowedPrograms[cid] = new Set([consentProg]);
          } else {
            candidateAllowedPrograms[cid] = candidateFmPrograms[cid] || new Set([consentProg]);
          }
        }
      } else {
        candidateAllowedPrograms[cid] = candidateFmPrograms[cid] || new Set();
      }
    }

    // ── Multi-track quota restriction ──
    const candidateAllowedQuotas = {};
    for (const cid of Object.keys(multiTrackInType).map(Number)) {
      if (!consentApproved[cid]) continue;
      const accSk = consentSeatKey(consentApproved[cid]);
      if (!accSk) continue;
      const consentType = accSk.split('|')[0];
      if (!multiTrackInType[cid]?.has(consentType)) continue;
      const consentQuota = accSk.split('|')[3];
      candidateAllowedQuotas[cid] = new Set([consentQuota]);
      if (!candidateAllowedPrograms[cid]?.has(consentType)) {
        candidateAllowedPrograms[cid] = new Set([consentType]);
      }
    }

    // ── Locked candidates (P#1 + accepted) ──
    const locked = new Set();
    for (const cid of Object.keys(candidateState).map(Number)) {
      if (!consentApproved[cid]) continue;
      const accSk = consentSeatKey(consentApproved[cid]);
      if (!accSk) continue;
      if (candidateState[cid]?.[accSk] != null) {
        const prefNo = candidatePrefMap[cid]?.[accSk];
        if (prefNo === 1) locked.add(cid);
      }
    }

    const initialVacancies = vacantQueue.length;

    // ── Can candidate take seat? ──
    function canCandidateTakeSeat(cid, sk) {
      if (!candidatePrefMap[cid]?.[sk] != null) {
        if (!(sk in (candidatePrefMap[cid] || {}))) return false;
      }
      const parts = sk.split('|');
      const seatProg = parts[0];
      const allowed = candidateAllowedPrograms[cid];
      if (allowed && allowed.size > 0 && !allowed.has(seatProg)) return false;
      const seatQuota = parts[3];
      const allowedQ = candidateAllowedQuotas[cid];
      if (allowedQ && !allowedQ.has(seatQuota)) return false;
      return true;
    }

    // ── Seat holding helpers ──
    function candidateSeatsInProgram(cid, typeName) {
      const result = [];
      const state = candidateState[cid];
      if (!state) return result;
      for (const sk of Object.keys(state)) {
        if (sk.split('|')[0] === typeName) {
          result.push([sk, state[sk]]);
        }
      }
      return result;
    }

    function candidateSeatsInQuota(cid, typeName, quota) {
      const result = [];
      const state = candidateState[cid];
      if (!state) return result;
      for (const sk of Object.keys(state)) {
        const parts = sk.split('|');
        if (parts[0] === typeName && parts[3] === quota) {
          result.push([sk, state[sk]]);
        }
      }
      return result;
    }

    // ── Specialty-specific sorted candidate lists ──
    // sortedBySpecialty["typeName|specName"] = [cid, ...] sorted by best mark DESC
    const bestMarkBySpecialty = {}; // "typeName|specName" -> { cid: bestMark }
    for (const cid of allCandidateIds) {
      const effMap = effMarkForSeat[cid] || {};
      for (const [sk, em] of Object.entries(effMap)) {
        const parts = sk.split('|');
        const key = `${parts[0]}|${parts[1]}`;
        if (!bestMarkBySpecialty[key]) bestMarkBySpecialty[key] = {};
        if (!(cid in bestMarkBySpecialty[key]) || em > bestMarkBySpecialty[key][cid]) {
          bestMarkBySpecialty[key][cid] = em;
        }
      }
    }

    const sortedBySpecialty = {};
    for (const [key, markDict] of Object.entries(bestMarkBySpecialty)) {
      sortedBySpecialty[key] = allCandidateIds.slice().sort((a, b) => {
        const ma = markDict[a] || 0;
        const mb = markDict[b] || 0;
        if (mb !== ma) return mb - ma;
        return a - b;
      });
    }

    // ── Main cascade loop ──
    let wave = 0;
    let totalPlacements = 0;
    let totalUpgrades = 0;

    while (true) {
      wave++;
      let changesThisPass = 0;

      const uniqueVacant = [...new Set(vacantQueue)];
      vacantQueue.length = 0;

      for (const sk of uniqueVacant) {
        const seat = seats[sk];
        if (!seat) continue;
        if (Object.keys(seat.occupants).length >= seat.capacity) continue;
        const vacancies = seat.capacity - Object.keys(seat.occupants).length;

        const parts = sk.split('|');
        const typeName = parts[0];
        const specKey = `${parts[0]}|${parts[1]}`;
        const sortedForSeat = sortedBySpecialty[specKey] || allCandidateIds;

        for (let v = 0; v < vacancies; v++) {
          let placed = false;
          for (const cid of sortedForSeat) {
            if (!isCandidateEligible(cid)) continue;
            if (!canCandidateTakeSeat(cid, sk)) continue;
            if (seat.occupants[cid] != null) continue;

            const newPref = candidatePrefMap[cid]?.[sk];
            if (newPref == null) continue;

            // Check existing seats: per-quota for single-track, per-program for multi-track
            const seatQuota = parts[3];
            let heldSeats;
            if (multiTrackInType[cid]?.has(typeName)) {
              heldSeats = candidateSeatsInProgram(cid, typeName);
            } else {
              heldSeats = candidateSeatsInQuota(cid, typeName, seatQuota);
            }

            if (!heldSeats.length) {
              seat.occupants[cid] = newPref;
              if (!candidateState[cid]) candidateState[cid] = {};
              candidateState[cid][sk] = newPref;
              totalPlacements++;
              changesThisPass++;
              placed = true;
              break;
            }

            const currentBestPref = Math.min(...heldSeats.map(h => h[1]));

            // Locked: P#1 + accepted → block cross-PROGRAM upgrades only
            if (locked.has(cid)) {
              const accSk = consentSeatKey(consentApproved[cid]);
              if (accSk) {
                const consentProg = accSk.split('|')[0];
                if (typeName !== consentProg) continue;
              }
            }

            if (newPref < currentBestPref) {
              const cidEff = effectiveMark(cid, sk);

              // Beat-check: only when seat is FULL (displacement needed)
              if (Object.keys(seat.occupants).length >= seat.capacity) {
                const occupantIds = Object.keys(seat.occupants).map(Number);
                let lowestOcc = occupantIds[0];
                let lowestMark = effectiveMark(lowestOcc, sk);
                for (const occ of occupantIds) {
                  const m = effectiveMark(occ, sk);
                  if (m < lowestMark) { lowestMark = m; lowestOcc = occ; }
                }
                if (cidEff <= lowestMark) continue;
              }

              // Vacate old seats in this scope
              for (const [oldSk] of heldSeats) {
                if (seats[oldSk]?.occupants[cid] != null) {
                  delete seats[oldSk].occupants[cid];
                  if (candidateState[cid]?.[oldSk] != null) {
                    delete candidateState[cid][oldSk];
                  }
                  if (!vacantQueue.includes(oldSk)) vacantQueue.push(oldSk);
                }
              }

              seat.occupants[cid] = newPref;
              if (!candidateState[cid]) candidateState[cid] = {};
              candidateState[cid][sk] = newPref;
              totalPlacements++;
              totalUpgrades++;
              changesThisPass++;
              placed = true;
              break;
            }
          }
          if (placed) continue;
          break;
        }
      }

      if (changesThisPass === 0) break;
      if (wave > 100) break;

      // Report progress and yield to browser for rendering
      if (onProgress) onProgress({ wave, changesThisPass, totalPlacements, totalUpgrades });
      await new Promise(r => setTimeout(r, 0));
    }

    // Final progress report
    if (onProgress) onProgress({ wave, changesThisPass: 0, totalPlacements, totalUpgrades, done: true });

    // ── Build output ──
    const placements = [];
    for (const [sk, seat] of Object.entries(seats)) {
      const parts = sk.split('|');
      for (const [cidStr, prefNo] of Object.entries(seat.occupants)) {
        const cid = Number(cidStr);
        const effMark = effectiveMark(cid, sk);
        const base = candidateMarks[cid] || 0;
        const cand = candidatesMap[String(cid)] || {};
        placements.push({
          applicantId: cid,
          typeName: parts[0],
          specialityName: parts[1],
          hospitalName: parts[2],
          quotaName: parts[3],
          preferenceNo: prefNo,
          marksTotal: base,
          effectiveMark: effMark,
          certBonus: Math.round((effMark - base) * 10000) / 10000,
          nameFull: cand.nameFull || '',
        });
      }
    }

    placements.sort((a, b) => (b.marksTotal - a.marksTotal) || (a.applicantId - b.applicantId));

    let unfilled = 0;
    for (const seat of Object.values(seats)) {
      const occCount = Object.keys(seat.occupants).length;
      if (occCount < seat.capacity) unfilled += seat.capacity - occCount;
    }

    return {
      placements,
      stats: {
        waves: wave,
        totalPlacements,
        totalUpgrades,
        initialVacancies,
        finalUnfilled: unfilled,
        initialFmCandidates: initialFmCandidateCount,
        initialFmOccupancy,
        multiProgramFm: multiProgramFm.size,
        multiTrackFm: Object.keys(multiTrackInType).length,
        locked: locked.size,
        simPlaced: placements.length,
      },
      seats,
      consentRejected: new Set(consentRejected),
      consentAwaited: new Set(consentAwaited),
    };
  }

  // ── Compare sim vs actual ──
  function compareWithActual(simPlacements, actualMerit, candidatePrefMap) {
    const simMap = {};
    for (const p of simPlacements) {
      simMap[p.applicantId] = {
        seatKey: `${p.typeName}|${p.specialityName}|${p.hospitalName}|${p.quotaName}`,
        prefNo: p.preferenceNo,
        effMark: p.effectiveMark,
      };
    }

    const actualMap = {};
    for (const e of actualMerit) {
      const cid = e.applicantId;
      const sk = `${e.typeName}|${e.specialityName}|${e.hospitalName}|${(e.quotaName || '').trim()}`;
      if (actualMap[cid]) continue; // first entry only
      actualMap[cid] = { seatKey: sk, prefNo: e.preferenceNo || 0, effMark: 0 };
    }

    const common = Object.keys(simMap).filter(cid => actualMap[cid]).map(Number);
    let sameSeat = 0, simBetter = 0, actualBetter = 0;
    const mismatches = [];

    for (const cid of common) {
      const sim = simMap[cid];
      const act = actualMap[cid];
      if (sim.seatKey === act.seatKey) {
        sameSeat++;
      } else {
        const simPref = sim.prefNo;
        const actPref = candidatePrefMap?.[cid]?.[act.seatKey] ?? 999;
        if (simPref < actPref) simBetter++;
        else if (actPref < simPref) actualBetter++;
        else if (sim.effMark > act.effMark) simBetter++;
        else if (act.effMark > sim.effMark) actualBetter++;
        else actualBetter++;

        mismatches.push({
          cid,
          sim: sim.seatKey,
          actual: act.seatKey,
          simPref: sim.prefNo,
          actPref,
          simEff: sim.effMark,
        });
      }
    }

    const agreement = common.length ? (sameSeat / common.length * 100) : 0;
    return { common: common.length, sameSeat, simBetter, actualBetter, agreement, mismatches };
  }

  // ── Expose ──
  window.SimCascade = {
    runCascade,
    compareWithActual,
    seatKey,
    parseConsentTitle,
    consentSeatKey,
  };

})();
