'use strict';

/**
 * Joining Status — dedicated tab built directly from the final selected-seats
 * export (data/induction21_joining_status.json, converted from joined/selected.xlsx
 * + joined/joined.xlsx + joined/pending.xlsx via scripts/convert_joining_status.py).
 *
 * Deliberately NOT layered onto the round-based Merit List: selected.xlsx is a
 * separate, final dataset that doesn't correspond to any one simulated round, and
 * it already carries its own status/joiningDate — no consent-matching needed.
 * Whole tab shows/hides based on notifications/joining_status_config.enabled.
 */

(function () {

  let db;
  let joiningData = [];
  let joiningDataLoaded = false;
  let joiningNotifiedAids = new Set();
  let joiningStatusConfig = { enabled: false, listPublishedAt: null, deadlineDays: 3 };
  let filtered = [];

  // Slots present in the last merit round that have zero candidates anywhere in
  // the final selected list — computed fresh from both files every render, never
  // hard-coded, so it stays correct as new merit rounds / selected.xlsx exports land.
  let emptySlots = [];
  let emptySlotsRound = null;
  let filteredEmptySlots = [];

  // Bulk email is an admin-only action, even though the rest of this tab is
  // visible to any authenticated portal user (same as the rest of Merit List).
  // Mirrors the isAdminEmail()/resolveAdminStatus() pattern in editorial.js.
  let isAdmin = false;

  async function resolveAdminStatus() {
    const email = typeof _getAuthSessionEmail === 'function' ? _getAuthSessionEmail() : '';
    if (!email || !db) { isAdmin = false; return; }
    try {
      const doc = await db.collection('authorized_users').doc(email).get();
      isAdmin = doc.exists && (doc.data().admin === true || doc.data().isAdmin === true);
    } catch (e) {
      isAdmin = false;
    }
  }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Collapse whitespace before matching — the merit-round export and the
  // selected.xlsx export don't always agree on trailing/double spaces in the
  // same real specialty/hospital name (e.g. "...Sahiwal" vs "...Sahiwal "),
  // which would otherwise show a filled slot as falsely empty.
  function normKeyPart(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function groupKey(row) {
    return `${row.typeName || ''}::${row.quotaName || ''}::${row.specialityName || ''}::${row.hospitalName || ''}`;
  }

  function matchKey(row) {
    return `${normKeyPart(row.typeName)}::${normKeyPart(row.quotaName)}::${normKeyPart(row.specialityName)}::${normKeyPart(row.hospitalName)}`;
  }

  // ── Last merit round vs. final selected list ──

  async function detectLatestMeritRound() {
    let latest = null;
    for (let r = 1; r <= 20; r++) {
      try {
        const res = await fetch(`data/induction21_merit_round${r}.json`, { cache: 'no-store' });
        if (!res.ok) break;
        await res.text();
        latest = r;
      } catch (_) { break; }
    }
    return latest;
  }

  async function loadEmptySlots() {
    emptySlots = [];
    emptySlotsRound = await detectLatestMeritRound();
    if (!emptySlotsRound) return;
    try {
      const res = await fetch(`data/induction21_merit_round${emptySlotsRound}.json`, { cache: 'no-store' });
      if (!res.ok) return;
      const raw = await res.json();
      const meritRows = Array.isArray(raw) ? raw : (raw.Table5 || []);

      const meritBySlot = {};
      for (const row of meritRows) {
        const key = matchKey(row);
        if (!meritBySlot[key]) meritBySlot[key] = [];
        meritBySlot[key].push(row);
      }

      const selectedSlots = new Set(joiningData.map(r => matchKey(r)));

      emptySlots = Object.entries(meritBySlot)
        .filter(([key]) => !selectedSlots.has(key))
        .map(([key, rows]) => {
          // Display the raw (unnormalized) values from an actual row, not the matchKey.
          const first = rows[0];
          return {
            key,
            typeName: first.typeName || '',
            quotaName: first.quotaName || '',
            specialityName: first.specialityName || '',
            hospitalName: first.hospitalName || '',
            meritCandidateCount: rows.length,
          };
        })
        .sort((a, b) => b.meritCandidateCount - a.meritCandidateCount);
    } catch (e) {
      console.warn('[JoiningStatus] Failed to compare merit round vs. final list:', e.message);
    }
  }

  // 'joined' | 'awaiting' | 'wasted'
  function computeJoiningRisk(row) {
    if (!row) return null;
    if (row.status === 'Joined') return 'joined';
    if (!joiningStatusConfig.listPublishedAt) return 'awaiting';
    const deadlineMs = new Date(joiningStatusConfig.listPublishedAt).getTime() +
      (joiningStatusConfig.deadlineDays || 3) * 86400000;
    return Date.now() > deadlineMs ? 'wasted' : 'awaiting';
  }

  function joinTierLabel(row) {
    const tier = computeJoiningRisk(row);
    if (tier === 'joined') {
      const d = row.joiningDate ? new Date(row.joiningDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      return { tier, cls: 'jst-pill-joined', label: `&#10003; Joined${d ? ' &middot; ' + esc(d) : ''}` };
    }
    if (tier === 'wasted') {
      const deadlineMs = new Date(joiningStatusConfig.listPublishedAt).getTime() + (joiningStatusConfig.deadlineDays || 3) * 86400000;
      const overdueDays = Math.max(1, Math.floor((Date.now() - deadlineMs) / 86400000));
      return { tier, cls: 'jst-pill-wasted', label: `Not joined &middot; overdue ${overdueDays}d` };
    }
    let dayLabel = '';
    if (joiningStatusConfig.listPublishedAt) {
      const dayNo = Math.max(1, Math.floor((Date.now() - new Date(joiningStatusConfig.listPublishedAt).getTime()) / 86400000) + 1);
      dayLabel = ` &middot; Day ${dayNo}/${joiningStatusConfig.deadlineDays || 3}`;
    }
    return { tier, cls: 'jst-pill-awaiting', label: `Not joined yet${dayLabel}` };
  }

  // ── Data loading ──

  async function loadJoiningData() {
    if (joiningDataLoaded) return;
    try {
      const res = await fetch('data/induction21_joining_status.json', { cache: 'no-store' });
      if (res.ok) joiningData = await res.json();
      joiningDataLoaded = true;
    } catch (e) {
      console.warn('[JoiningStatus] Failed to load joining status data:', e.message);
      joiningDataLoaded = true;
    }
  }

  async function loadNotifiedAids() {
    if (!db) return;
    try {
      const snap = await db.collection('joining_notifications').get();
      joiningNotifiedAids = new Set(snap.docs.map(d => d.id));
    } catch (e) {
      console.warn('[JoiningStatus] Could not load joining_notifications:', e.message);
    }
  }

  // ── Filtering ──

  function applyFilters() {
    const prog = (document.getElementById('jstProgram')?.value || '').toLowerCase();
    const spec = (document.getElementById('jstSpecialty')?.value || '').toLowerCase();
    const hosp = (document.getElementById('jstHospital')?.value || '').toLowerCase();
    const quota = (document.getElementById('jstQuota')?.value || '').toLowerCase();
    const search = (document.getElementById('jstSearch')?.value || '').toLowerCase().trim();
    const joinFilter = document.getElementById('jstJoinStatus')?.value || '';

    filtered = joiningData.filter(r => {
      if (prog && (r.typeName || '').toLowerCase() !== prog) return false;
      if (spec && (r.specialityName || '').toLowerCase() !== spec) return false;
      if (hosp && (r.hospitalName || '').toLowerCase() !== hosp) return false;
      if (quota && (r.quotaName || '').toLowerCase() !== quota) return false;
      if (search) {
        const name = (r.name || '').toLowerCase();
        const id = String(r.applicantId || '');
        const pmdc = (r.pmdcNo || '').toLowerCase();
        if (!name.includes(search) && !id.includes(search) && !pmdc.includes(search)) return false;
      }
      if (joinFilter && computeJoiningRisk(r) !== joinFilter) return false;
      return true;
    });

    // Empty slots have no candidate, so name/PMDC/ID search never matches them,
    // and they only belong under "All" or "Likely wasted".
    filteredEmptySlots = (search || (joinFilter && joinFilter !== 'wasted')) ? [] : emptySlots.filter(s => {
      if (prog && (s.typeName || '').toLowerCase() !== prog) return false;
      if (spec && (s.specialityName || '').toLowerCase() !== spec) return false;
      if (hosp && (s.hospitalName || '').toLowerCase() !== hosp) return false;
      if (quota && (s.quotaName || '').toLowerCase() !== quota) return false;
      return true;
    });

    renderGrid();
  }

  // ── Bulk email ──

  function computeUnemailedJoined() {
    return joiningData.filter(r => r.status === 'Joined' && !joiningNotifiedAids.has(String(r.applicantId)));
  }

  async function sendHappyResidencyEmails(list) {
    if (!isAdmin) return { sent: 0, failed: list.length }; // belt-and-suspenders; button is already admin-gated
    const actor = (typeof _getAuthSessionEmail === 'function' && _getAuthSessionEmail()) || 'admin';
    let sent = 0, failed = 0;
    for (const row of list) {
      const aid = String(row.applicantId);
      try {
        if (!row.emailId) throw new Error('no email on file');
        await db.collection('mail').add({
          to: [row.emailId],
          template: {
            name: 'happy_residency',
            data: {
              name: row.name,
              program: row.typeName,
              specialty: row.specialityName,
              hospital: row.hospitalName,
              preferenceNo: row.preferenceNo,
              joiningDate: row.joiningDate,
              portalUrl: 'https://itskaero.github.io/meritnama/',
            },
          },
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          source: 'joining_status_welcome_email',
        });
        await db.collection('joining_notifications').doc(aid).set({
          emailedAt: firebase.firestore.FieldValue.serverTimestamp(),
          emailedBy: actor,
          template: 'happy_residency',
        }, { merge: true });
        joiningNotifiedAids.add(aid);
        sent++;
      } catch (e) {
        console.error('[JoiningStatus] Failed to queue welcome email for', aid, e);
        failed++;
      }
    }
    return { sent, failed };
  }

  function renderBulkBar() {
    const el = document.getElementById('jstBulkBar');
    if (!el) return;
    if (!isAdmin) { el.innerHTML = ''; return; } // bulk email is admin-only; rest of the tab is not
    const list = computeUnemailedJoined();
    if (!list.length) {
      el.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);">No joined candidates awaiting a welcome email right now.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="jst-bulkbar">
        <div class="jst-bulkbar-msg"><strong style="color:var(--neon-green);">${list.length}</strong> joined candidate${list.length !== 1 ? 's' : ''} ${list.length !== 1 ? "haven't" : "hasn't"} received a welcome email yet.</div>
        <button id="jstSendBtn" class="jst-send-btn">&#9993; Send Happy Residency Email (${list.length})</button>
      </div>
      <div class="jst-confirm" id="jstConfirm"></div>`;
    document.getElementById('jstSendBtn')?.addEventListener('click', () => openConfirm(list));
  }

  function openConfirm(list) {
    const panel = document.getElementById('jstConfirm');
    if (!panel) return;
    const names = list.slice(0, 6).map(r => esc(r.name)).join(', ') + (list.length > 6 ? `, +${list.length - 6} more` : '');
    panel.innerHTML = `
      <div class="jst-confirm-inner">
        <strong>Confirm before sending</strong> — this emails real candidates at their registered address.
        <div style="color:var(--text-muted);margin:8px 0 12px;">Recipients: ${names}</div>
        <div style="display:flex;gap:8px;">
          <button id="jstConfirmBtn" class="jst-send-btn">Confirm &amp; send</button>
          <button id="jstCancelBtn" class="jst-cancel-btn">Cancel</button>
        </div>
        <div id="jstSendStatus" style="margin-top:8px;font-size:0.78rem;"></div>
      </div>`;
    document.getElementById('jstCancelBtn')?.addEventListener('click', () => { panel.innerHTML = ''; });
    document.getElementById('jstConfirmBtn')?.addEventListener('click', async () => {
      const statusEl = document.getElementById('jstSendStatus');
      const btn = document.getElementById('jstConfirmBtn');
      btn.disabled = true;
      statusEl.textContent = 'Queuing ' + list.length + ' emails…';
      const result = await sendHappyResidencyEmails(list);
      statusEl.textContent = `Sent ${result.sent}${result.failed ? ', ' + result.failed + ' failed' : ''}. Logged to joining_notifications.`;
      statusEl.style.color = 'var(--neon-green)';
      renderBulkBar();
    });
  }

  // ── Grid ──

  function renderGrid() {
    const grid = document.getElementById('jstGrid');
    const countEl = document.getElementById('jstCount');
    if (!grid) return;

    if (!filtered.length && !filteredEmptySlots.length) {
      grid.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No entries match filters.</div>';
      if (countEl) countEl.textContent = '0 entries';
      return;
    }
    if (countEl) countEl.textContent = filtered.length.toLocaleString() + ' entries';

    const slots = {};
    for (const r of filtered) {
      const gk = groupKey(r);
      if (!slots[gk]) slots[gk] = [];
      slots[gk].push(r);
    }

    const cards = [];
    for (const [gk, rows] of Object.entries(slots)) {
      const [program, quota, specialty, hospital] = gk.split('::');
      const tiers = rows.map(r => computeJoiningRisk(r));
      const joined = tiers.filter(t => t === 'joined').length;
      const wasted = tiers.filter(t => t === 'wasted').length;

      const badge = wasted > 0
        ? `<span class="jst-slot-badge wasted">${wasted} at risk of waste</span>`
        : joined === rows.length
          ? `<span class="jst-slot-badge all-joined">All joined</span>`
          : `<span class="jst-slot-badge partial">${joined}/${rows.length} joined</span>`;

      const riskBanner = wasted > 0
        ? `<div class="jst-risk-banner">&#9888; ${wasted} candidate${wasted !== 1 ? 's' : ''} in this seat group ${wasted !== 1 ? "haven't" : "hasn't"} joined and the joining deadline has passed — at risk of going unfilled.</div>`
        : '';

      const rowsHtml = rows.map(r => {
        const pill = joinTierLabel(r);
        const mismatchTag = r.profileMismatch
          ? `<span class="jst-tag jst-tag-mismatch" title="Profile status export disagrees with the seat-allocation export">Profile mismatch</span>`
          : '';
        const emailedTag = (r.status === 'Joined' && joiningNotifiedAids.has(String(r.applicantId)))
          ? `<span class="jst-tag jst-tag-emailed">Emailed</span>` : '';
        return `<div class="jst-row">
          <span class="jst-state-bar ${pill.tier}"></span>
          <span class="jst-row-id">${esc(r.applicantId)}</span>
          <span class="jst-row-name"><strong>${esc(r.name)}</strong></span>
          <span class="jst-row-marks">${r.marks != null ? Number(r.marks).toFixed(2) : '—'}</span>
          <span class="jst-row-pref">P${esc(r.preferenceNo)}</span>
          <span class="jst-pill ${pill.cls}">${pill.label}</span>
          ${mismatchTag}
          ${emailedTag}
        </div>`;
      }).join('');

      cards.push(`<div class="jst-slot-card">
        ${riskBanner}
        <div class="jst-slot-header">
          <span class="jst-slot-title">${esc(specialty)} @ ${esc(hospital)} (${esc(program)}, ${esc(quota)})</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="jst-slot-count">${rows.length} candidate${rows.length !== 1 ? 's' : ''}</span>
            ${badge}
          </span>
        </div>
        ${rowsHtml}
      </div>`);
    }

    for (const s of filteredEmptySlots) {
      cards.push(`<div class="jst-slot-card">
        <div class="jst-risk-banner">&#9888; No candidate in the final list — ${s.meritCandidateCount} candidate${s.meritCandidateCount !== 1 ? 's' : ''} placed here in Round ${emptySlotsRound}, none carried through.</div>
        <div class="jst-slot-header">
          <span class="jst-slot-title">${esc(s.specialityName)} @ ${esc(s.hospitalName)} (${esc(s.typeName)}, ${esc(s.quotaName)})</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="jst-slot-count">0 candidates</span>
            <span class="jst-slot-badge wasted">No candidate selected</span>
          </span>
        </div>
      </div>`);
    }

    grid.innerHTML = cards.join('\n');
  }

  // ── Summary + risk callout ──

  function renderSummary() {
    const el = document.getElementById('jstSummary');
    if (!el) return;

    let joined = 0, awaiting = 0, wasted = 0;
    const bySlot = {};
    for (const r of joiningData) {
      const tier = computeJoiningRisk(r);
      if (tier === 'joined') joined++;
      else if (tier === 'wasted') { wasted++; const gk = groupKey(r); bySlot[gk] = (bySlot[gk] || 0) + 1; }
      else awaiting++;
    }
    const total = joiningData.length;
    const topRisk = Object.entries(bySlot).sort((a, b) => b[1] - a[1]).slice(0, 3);

    el.innerHTML = `
      <div class="jst-statstrip">
        <div class="jst-stat"><div class="jst-stat-label">Seats Tracked</div><div class="jst-stat-value">${total.toLocaleString()}</div></div>
        <div class="jst-stat"><div class="jst-stat-label">Joined</div><div class="jst-stat-value" style="color:var(--neon-green);">${joined.toLocaleString()}</div></div>
        <div class="jst-stat"><div class="jst-stat-label">Not Joined Yet</div><div class="jst-stat-value" style="color:var(--neon-cyan);">${awaiting.toLocaleString()}</div></div>
        <div class="jst-stat"><div class="jst-stat-label">Likely Wasted</div><div class="jst-stat-value" style="color:var(--neon-red);">${wasted.toLocaleString()}</div></div>
        ${emptySlotsRound ? `<div class="jst-stat"><div class="jst-stat-label">No Candidate Selected</div><div class="jst-stat-value" style="color:var(--neon-red);">${emptySlots.length.toLocaleString()}</div></div>` : ''}
      </div>
      ${wasted > 0 ? `
      <div class="jst-risk-callout">
        <div class="jst-risk-callout-head">&#9888; ${wasted} seat${wasted !== 1 ? 's' : ''} likely to go unfilled</div>
        <ul class="jst-risk-list">
          ${topRisk.map(([gk, n]) => {
            const parts = gk.split('::');
            return `<li><span>${esc(parts[2])} @ ${esc(parts[3])} (${esc(parts[0])}, ${esc(parts[1])})</span><span>${n} unjoined</span></li>`;
          }).join('')}
        </ul>
      </div>` : ''}
      ${emptySlots.length ? `
      <div class="jst-risk-callout">
        <div class="jst-risk-callout-head">&#9888; ${emptySlots.length} slot${emptySlots.length !== 1 ? 's' : ''} from Round ${emptySlotsRound} have no candidate in the final list</div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:8px;">These had candidates placed in the last merit round, but none appear anywhere in the final selected list &mdash; likely fully vacated, not just unjoined.</div>
        <ul class="jst-risk-list">
          ${emptySlots.slice(0, 10).map(({ key, meritCandidateCount }) => {
            const parts = key.split('::');
            return `<li><span>${esc(parts[2])} @ ${esc(parts[3])} (${esc(parts[0])}, ${esc(parts[1])})</span><span>${meritCandidateCount} in Round ${emptySlotsRound}, 0 selected</span></li>`;
          }).join('')}
          ${emptySlots.length > 10 ? `<li style="color:var(--text-muted);">&hellip;and ${emptySlots.length - 10} more</li>` : ''}
        </ul>
      </div>` : ''}`;
  }

  function renderLog() {
    const el = document.getElementById('jstLog');
    if (!el) return;
    const rows = joiningData
      .filter(r => r.status === 'Joined')
      .sort((a, b) => new Date(b.joiningDate || 0) - new Date(a.joiningDate || 0))
      .slice(0, 200);
    el.innerHTML = `
      <details class="jst-log">
        <summary>&#128220; Joining &amp; notification log (${rows.length})</summary>
        <table class="jst-logtable">
          <thead><tr><th>Candidate</th><th>Seat</th><th>Joined</th><th>Email</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td class="name">${esc(r.name)}</td>
              <td>${esc(r.specialityName)} &middot; ${esc(r.hospitalName)}</td>
              <td>${r.joiningDate ? new Date(r.joiningDate).toLocaleDateString() : '—'}</td>
              <td class="${joiningNotifiedAids.has(String(r.applicantId)) ? 'pos' : ''}">${joiningNotifiedAids.has(String(r.applicantId)) ? 'Sent' : 'Pending'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </details>`;
  }

  // ── Main render ──

  async function renderJoiningStatusTab() {
    const root = document.getElementById('joiningStatusRoot');
    if (!root) return;
    root.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-muted);">Loading…</div>';

    await loadJoiningData();
    await Promise.all([loadNotifiedAids(), loadEmptySlots(), resolveAdminStatus()]);

    const programs = [...new Set(joiningData.map(r => r.typeName).filter(Boolean))].sort();
    const specialties = [...new Set(joiningData.map(r => r.specialityName).filter(Boolean))].sort();
    const hospitals = [...new Set(joiningData.map(r => r.hospitalName).filter(Boolean))].sort();
    const quotas = [...new Set(joiningData.map(r => r.quotaName).filter(Boolean))].sort();

    root.innerHTML = `
      <style>
        .jst-statstrip{display:flex;align-items:stretch;gap:0;flex-wrap:wrap;}
        .jst-stat{flex:1;min-width:120px;padding:2px 18px;border-left:1px solid var(--border);}
        .jst-stat:first-child{border-left:none;padding-left:0;}
        .jst-stat-label{font-size:0.66rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;}
        .jst-stat-value{font-size:1.4rem;font-weight:800;letter-spacing:-0.01em;}
        .jst-risk-callout{margin-top:14px;padding:12px 16px;border-radius:8px;background:rgba(220,60,60,0.07);border:1px solid rgba(220,60,60,0.22);}
        .jst-risk-callout-head{font-weight:700;color:#f0899b;font-size:0.8rem;margin-bottom:8px;}
        .jst-risk-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;}
        .jst-risk-list li{display:flex;justify-content:space-between;gap:10px;font-size:0.76rem;color:var(--text);}
        .jst-risk-list li span:last-child{color:var(--text-muted);white-space:nowrap;}
        .jst-bulkbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;background:rgba(62,207,142,0.05);border:1px solid rgba(62,207,142,0.18);border-radius:8px;}
        .jst-bulkbar-msg{font-size:0.82rem;}
        .jst-send-btn{font-size:0.8rem;font-weight:700;padding:7px 16px;border-radius:8px;background:var(--neon-green);color:#04140c;border:none;cursor:pointer;}
        .jst-send-btn:hover{filter:brightness(1.1);}
        .jst-send-btn:disabled{opacity:0.5;cursor:not-allowed;}
        .jst-cancel-btn{font-size:0.8rem;padding:7px 14px;border-radius:8px;background:transparent;border:1px solid var(--border);color:var(--text-muted);cursor:pointer;}
        .jst-confirm-inner{margin-top:8px;padding:12px 14px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px dashed var(--border-hover);font-size:0.78rem;animation:mlFadeIn 0.25s ease;}
        .jst-slot-card{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden;}
        .jst-slot-header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border);flex-wrap:wrap;}
        .jst-slot-title{font-size:0.82rem;font-weight:700;}
        .jst-slot-count{font-size:0.7rem;color:var(--text-muted);}
        .jst-slot-badge{font-size:0.62rem;font-weight:700;padding:2px 9px;border-radius:100px;}
        .jst-slot-badge.all-joined{background:rgba(62,207,142,0.1);color:var(--neon-green);}
        .jst-slot-badge.partial{background:rgba(232,166,39,0.1);color:var(--neon-gold);}
        .jst-slot-badge.wasted{background:rgba(220,60,60,0.14);color:var(--neon-red);}
        .jst-risk-banner{padding:8px 14px;font-size:0.72rem;color:var(--neon-red);background:rgba(220,60,60,0.08);border-bottom:1px solid rgba(220,60,60,0.18);}
        .jst-row{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:0.8rem;flex-wrap:wrap;}
        .jst-row:last-child{border-bottom:none;}
        .jst-state-bar{display:inline-block;width:3px;height:22px;border-radius:2px;flex-shrink:0;}
        .jst-state-bar.joined{background:var(--neon-green);}
        .jst-state-bar.awaiting{background:var(--neon-cyan);}
        .jst-state-bar.wasted{background:var(--neon-red);}
        .jst-row-id{color:var(--text-muted);font-size:0.74rem;width:52px;}
        .jst-row-marks{color:var(--text-muted);width:52px;font-size:0.76rem;}
        .jst-row-pref{color:var(--text-muted);width:28px;font-size:0.76rem;}
        .jst-pill{font-size:0.68rem;font-weight:700;padding:2px 10px;border-radius:100px;white-space:nowrap;}
        .jst-pill-joined{background:rgba(62,207,142,0.12);color:var(--neon-green);border:1px solid rgba(62,207,142,0.25);}
        .jst-pill-awaiting{background:rgba(77,184,217,0.1);color:var(--neon-cyan);border:1px solid rgba(77,184,217,0.22);}
        .jst-pill-wasted{background:rgba(220,60,60,0.14);color:var(--neon-red);border:1px solid rgba(220,60,60,0.32);}
        .jst-tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.55rem;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;white-space:nowrap;}
        .jst-tag-mismatch{background:rgba(124,101,196,0.1);color:var(--neon-purple);border:1px solid rgba(124,101,196,0.18);}
        .jst-tag-emailed{background:rgba(62,207,142,0.1);color:var(--neon-green);border:1px solid rgba(62,207,142,0.18);}
        .jst-log{border:1px solid var(--border);border-radius:12px;background:var(--bg-card);overflow:hidden;margin-top:14px;}
        .jst-log summary{padding:12px 16px;cursor:pointer;font-weight:700;font-size:0.82rem;list-style:none;display:flex;align-items:center;gap:8px;user-select:none;}
        .jst-log summary::-webkit-details-marker{display:none;}
        .jst-logtable{width:100%;border-collapse:collapse;font-size:0.76rem;}
        .jst-logtable th{text-align:left;color:var(--text-light);text-transform:uppercase;letter-spacing:0.04em;font-size:0.62rem;padding:6px 16px;border-top:1px solid var(--border);}
        .jst-logtable td{padding:8px 16px;border-top:1px solid rgba(255,255,255,0.04);color:var(--text-muted);}
        .jst-logtable td.name{color:var(--text);font-weight:600;}
        .jst-logtable td.pos{color:var(--neon-green);}
      </style>
      <div class="section-header">
        <h2>Joining Status</h2>
        <p>Who has actually reported to their selected seat, from the final seat-allocation export — ${joiningData.length.toLocaleString()} candidates tracked.</p>
      </div>
      <div class="card" id="jstSummary"></div>
      <div class="card filter-card">
        <div class="input-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
          <div class="form-group"><label>Program</label><select id="jstProgram"><option value="">All Programs</option>${programs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Specialty</label><select id="jstSpecialty"><option value="">All Specialties</option>${specialties.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Hospital</label><select id="jstHospital"><option value="">All Hospitals</option>${hospitals.map(h => `<option value="${esc(h)}">${esc(h)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Quota</label><select id="jstQuota"><option value="">All Quotas</option>${quotas.map(q => `<option value="${esc(q)}">${esc(q)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Search</label><input type="text" id="jstSearch" placeholder="Name, PMDC, ID…" class="mt-filter-input" /></div>
          <div class="form-group">
            <label>Join Status</label>
            <select id="jstJoinStatus">
              <option value="">All</option>
              <option value="joined">Joined</option>
              <option value="awaiting">Not joined — within window</option>
              <option value="wasted">Likely wasted</option>
            </select>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <span id="jstCount" style="font-size:0.82rem;color:var(--text-muted);">${joiningData.length.toLocaleString()} entries</span>
      </div>
      <div id="jstBulkBar" style="margin-bottom:12px;"></div>
      <div id="jstGrid"></div>
      <div id="jstLog"></div>`;

    document.getElementById('jstProgram')?.addEventListener('change', applyFilters);
    document.getElementById('jstSpecialty')?.addEventListener('change', applyFilters);
    document.getElementById('jstHospital')?.addEventListener('change', applyFilters);
    document.getElementById('jstQuota')?.addEventListener('change', applyFilters);
    document.getElementById('jstSearch')?.addEventListener('input', applyFilters);
    document.getElementById('jstJoinStatus')?.addEventListener('change', applyFilters);

    renderSummary();
    renderBulkBar();
    renderLog();
    filtered = joiningData.slice();
    filteredEmptySlots = emptySlots.slice();
    renderGrid();
  }
  window.renderJoiningStatusTab = renderJoiningStatusTab;

  // ── Tab visibility + config subscription ──

  function setTabVisible(visible) {
    const btn = document.getElementById('joiningTabBtn');
    if (btn) btn.style.display = visible ? '' : 'none';
    if (!visible) {
      const activeBtn = document.querySelector('.tab-btn.active');
      if (activeBtn && activeBtn.dataset.tab === 'joining') {
        document.querySelector('.tab-btn[data-tab="guide"]')?.click();
      }
    }
  }

  function init() {
    if (typeof firebase === 'undefined') { setTimeout(init, 500); return; }
    try { db = firebase.firestore(); } catch (_) { setTimeout(init, 500); return; }

    const urlJoin = new URLSearchParams(window.location.search).get('join');
    if (urlJoin) {
      // Deadline = listPublishedAt + deadlineDays. Real joining deadline for this
      // list is today, so anchor listPublishedAt 3 days back instead of "now" —
      // otherwise the preview deadline would sit 3 days in the future.
      const previewDeadlineDays = 3;
      joiningStatusConfig = {
        enabled: true,
        listPublishedAt: new Date(Date.now() - previewDeadlineDays * 86400000).toISOString(),
        deadlineDays: previewDeadlineDays,
      };
      setTabVisible(true);
      // setupTabs() (sim-notifications.js) attaches tab-btn click listeners inside
      // an async DOMContentLoaded handler that awaits loadData() first, so it may
      // not have run yet — activate the tab directly instead of a synthetic .click().
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      document.querySelector('.tab-btn[data-tab="joining"]')?.classList.add('active');
      document.getElementById('tab-joining')?.classList.add('active');
      renderJoiningStatusTab();
    }

    db.collection('notifications').doc('joining_status_config').onSnapshot(snap => {
      if (urlJoin) return; // URL param takes precedence, same as ?mode=merit-list elsewhere
      const data = snap.exists ? snap.data() : {};
      joiningStatusConfig = {
        enabled: data.enabled === true, // fails closed: partial data coverage + drives real email
        listPublishedAt: data.listPublishedAt || null,
        deadlineDays: data.deadlineDays || 3,
      };
      setTabVisible(joiningStatusConfig.enabled);
      if (joiningStatusConfig.enabled && document.querySelector('.tab-btn[data-tab="joining"]')?.classList.contains('active')) {
        renderJoiningStatusTab();
      }
    }, err => {
      console.warn('[JoiningStatus] joining_status_config Firestore error:', err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
