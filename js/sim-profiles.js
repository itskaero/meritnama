// ═══════════════════════════════════════════════════════════════════
// COMMUNITY PROFILES TAB
// ═══════════════════════════════════════════════════════════════════
let _profilesLoaded = false;
let _allProfiles = [];
let _profilesWired = false;
// Pre-computed merit rankings: Map<applicantId string, {rank, total, pctile, tier, tierColor, programs}>
let _meritRankCache = new Map();
let _profileDonors = new Map();

function _getAuthSessionEmail() {
  try {
    const raw = localStorage.getItem('meritnama_auth_session');
    const session = raw ? JSON.parse(raw) : null;
    return (session && typeof session.email === 'string') ? session.email.toLowerCase().trim() : '';
  } catch (_) {
    return '';
  }
}

function _profileCompletion(p) {
  const checks = [
    !!p?.name,
    !!p?.specialty,
    !!p?.hospital,
    typeof p?.inducted === 'boolean',
    !!p?.profilePicBase64,
    p?.isPublic === true,
  ];
  const done = checks.filter(Boolean).length;
  return { done, total: checks.length, pct: Math.round((done / checks.length) * 100) };
}

function _renderMyProfilePanel(allProfileDocs) {
  const titleEl = document.getElementById('profilesSelfTitle');
  const metaEl = document.getElementById('profilesSelfMeta');
  const chipsEl = document.getElementById('profilesSelfChips');
  const avatarEl = document.getElementById('profilesSelfAvatar');
  if (!titleEl || !metaEl || !chipsEl || !avatarEl) return;

  const email = _getAuthSessionEmail();
  const profile = email
    ? allProfileDocs.find(p => String(p.email || '').toLowerCase() === email)
    : null;
  const displayName = profile?.name || email || 'Your profile';
  const initial = (displayName || '?').charAt(0).toUpperCase();
  const completion = _profileCompletion(profile || {});
  const visibility = profile?.isPublic ? 'Public' : 'Private';
  const status = profile?.inducted ? 'Inducted' : 'Applicant';
  const donor = email ? _profileDonors.get(email) : null;

  avatarEl.innerHTML = profile?.profilePicBase64
    ? `<img src="${profile.profilePicBase64}" alt="" />`
    : esc(initial);
  titleEl.textContent = profile
    ? `${displayName}`
    : 'Create your MeritNama profile';
  metaEl.textContent = profile
    ? `${visibility} profile · ${status}${profile.specialty ? ' · ' + profile.specialty : ''}${profile.hospital ? ' · ' + profile.hospital : ''}`
    : 'Add your specialty, hospital, status, photo, and visibility so others can understand your background.';

  const visibilityClass = profile?.isPublic ? ' good' : '';
  chipsEl.innerHTML = `
    <span class="profiles-self-chip${completion.pct >= 80 ? ' good' : ''}">${completion.pct}% complete</span>
    <span class="profiles-self-chip${visibilityClass}">${visibility}</span>
    <span class="profiles-self-chip">${status}</span>
    ${donor ? '<span class="profiles-self-chip good">Supporter</span>' : ''}
    ${profile?.updatedAt ? '<span class="profiles-self-chip">Recently saved</span>' : ''}
  `;
}

function _buildProfileDonorMap(contributionDocs) {
  _profileDonors.clear();
  contributionDocs.forEach(doc => {
    const d = doc.data ? doc.data() : doc;
    const email = String(d.email || '').toLowerCase().trim();
    if (!email) return;
    const prev = _profileDonors.get(email) || { count: 0, amountPKR: 0, amountUSD: 0 };
    prev.count += 1;
    prev.amountPKR += Number(d.amountPKR) || 0;
    prev.amountUSD += Number(d.amountUSD) || 0;
    _profileDonors.set(email, prev);
  });
}

function _buildMeritCache() {
  if (!SIM.candidates?.length) return;
  const sorted = SIM.candidates.slice().sort((a, b) => (b.marksTotal ?? 0) - (a.marksTotal ?? 0));
  const total = sorted.length;
  _meritRankCache.clear();
  sorted.forEach((c, idx) => {
    const rank   = idx + 1;
    const pctile = Math.round(((total - rank) / total) * 100);
    let tier, tierColor;
    if (pctile >= 95)      { tier = 'Top 5%';    tierColor = '#3ecf8e'; }
    else if (pctile >= 90) { tier = 'Top 10%';   tierColor = '#3ecf8e'; }
    else if (pctile >= 75) { tier = 'Top 25%';   tierColor = '#4db8d9'; }
    else if (pctile >= 50) { tier = 'Top 50%';   tierColor = '#4db8d9'; }
    else                   { tier = 'Lower 50%'; tierColor = '#a0a0b0'; }
    const programs = ['FCPS','MS','MD'].filter(prog => c.applied_in?.[prog]);
    _meritRankCache.set(String(c.applicantId), { rank, total, pctile, tier, tierColor, programs });
  });
}

async function renderProfilesTab() {
  const grid = document.getElementById('profilesGrid');
  if (!grid) return;

  // Wire search/filter controls once
  if (!_profilesWired) {
    const searchEl = document.getElementById('profilesSearch');
    const statusEl = document.getElementById('profilesStatusFilter');
    if (searchEl) searchEl.addEventListener('input', _applyProfileFilters);
    if (statusEl) statusEl.addEventListener('change', _applyProfileFilters);
    _profilesWired = true;
  }

  if (_profilesLoaded) { _applyProfileFilters(); return; }

  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">Loading profiles…</div>';

  try {
    const db = firebase.firestore();
    const [profilesSnap, adminsSnap, contribSnap] = await Promise.all([
      db.collection('user_profiles').orderBy('updatedAt', 'desc').get(),
      db.collection('authorized_users').where('isAdmin', '==', true).get(),
      db.collection('contributions').get().catch(() => ({ docs: [] })),
    ]);
    _buildProfileDonorMap(contribSnap.docs || []);
    const adminEmails = new Set(adminsSnap.docs.map(d => d.id));
    const allProfileDocs = profilesSnap.docs.map(d => ({ email: d.id, isAdmin: adminEmails.has(d.id), ...d.data() }));
    const totalWithData  = allProfileDocs.filter(p => p.name || p.specialty || p.hospital).length;
    _allProfiles = allProfileDocs.filter(p => p.isPublic && (p.name || p.specialty || p.hospital));
    const privateCount = totalWithData - _allProfiles.length;
    _renderMyProfilePanel(allProfileDocs);

    // Build merit rank cache once (O(n log n) sort, done here not per click)
    _buildMeritCache();

    // Show private-profile ticker
    if (privateCount > 0) {
      const ticker = document.getElementById('profilesTicker');
      const tickerText = document.getElementById('profilesTickerText');
      if (ticker && tickerText) {
        tickerText.textContent = `${privateCount} member${privateCount !== 1 ? 's have' : ' has'} a profile but ${privateCount !== 1 ? 'have' : 'has'} set it to private. Only public profiles are shown below.`;
        ticker.style.display = '';
      }
    }

    _profilesLoaded = true;
    _applyProfileFilters();
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">Could not load profiles — ${esc(e.message)}</div>`;
  }
}

function _applyProfileFilters() {
  const q      = (document.getElementById('profilesSearch')?.value || '').trim().toLowerCase();
  const status = document.getElementById('profilesStatusFilter')?.value || '';

  let list = _allProfiles;
  if (q) {
    list = list.filter(p =>
      (p.name      || '').toLowerCase().includes(q) ||
      (p.specialty || '').toLowerCase().includes(q) ||
      (p.hospital  || '').toLowerCase().includes(q)
    );
  }
  if (status === 'inducted')  list = list.filter(p => p.inducted);
  if (status === 'applicant') list = list.filter(p => !p.inducted);

  _renderProfileGrid(list);
}

// Returns pre-computed merit insight for a profile (O(1) lookup, no re-sort per click)
function _profileMeritInsight(p) {
  if (!p.applicantId) return null;
  return _meritRankCache.get(String(p.applicantId)) ?? null;
}

function _renderProfileGrid(profiles) {
  const grid = document.getElementById('profilesGrid');
  if (!grid) return;

  if (!profiles.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);">No profiles match your search.</div>';
    return;
  }

  grid.innerHTML = profiles.map((p, i) => {
    const initial = (p.name || p.email || '?').charAt(0).toUpperCase();
    const profileKey = String(p.email || i);
    const hue = p.profileHue ?? 205;
    const avatarBorder = p.profilePicBase64
      ? `border:2px solid rgba(77,184,217,0.4)`
      : `border:2px solid hsl(${hue},60%,55%)`;
    const avatarBg = p.profilePicBase64
      ? ''
      : `background:linear-gradient(135deg,hsla(${hue},60%,50%,0.2),hsla(${hue+60},60%,50%,0.15));`;
    const avatarHtml = p.profilePicBase64
      ? `<img src="${p.profilePicBase64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="" />`
      : `<span style="font-size:1.3rem;font-weight:700;color:hsl(${hue},70%,65%);">${esc(initial)}</span>`;

    const statusTag = p.inducted
      ? `<span style="padding:2px 8px;border-radius:100px;background:rgba(62,207,142,0.1);border:1px solid rgba(62,207,142,0.25);color:var(--neon-green);font-size:0.68rem;font-weight:700;">✔ Ind.${p.inductionYear ? ' ' + esc(String(p.inductionYear)) : ''}</span>`
      : `<span style="padding:2px 8px;border-radius:100px;background:rgba(77,184,217,0.08);border:1px solid rgba(77,184,217,0.2);color:var(--neon-cyan);font-size:0.68rem;font-weight:700;">Applicant</span>`;
    const adminBadge = p.isAdmin
      ? `<span style="padding:2px 7px;border-radius:100px;background:rgba(232,166,39,0.12);border:1px solid rgba(232,166,39,0.35);color:var(--neon-gold,#e8a627);font-size:0.65rem;font-weight:700;">⚡ Admin</span>`
      : '';
    const donor = _profileDonors.get(String(p.email || '').toLowerCase());
    const donorBadge = donor
      ? `<span style="padding:2px 8px;border-radius:100px;background:linear-gradient(135deg,rgba(232,166,39,0.18),rgba(244,114,182,0.1));border:1px solid rgba(232,166,39,0.42);color:var(--neon-gold,#e8a627);font-size:0.66rem;font-weight:800;">★ Supporter</span>`
      : '';

    // Merit insight (only if candidate data loaded)
    const insight = _profileMeritInsight(p);
    const tierPill = insight
      ? `<span style="padding:2px 8px;border-radius:100px;background:rgba(0,0,0,0.2);border:1px solid ${insight.tierColor}44;color:${insight.tierColor};font-size:0.65rem;font-weight:700;">📊 ${insight.tier}</span>`
      : '';

    const progPills = insight?.programs.length
      ? insight.programs.map(pr =>
          `<span style="padding:2px 6px;border-radius:4px;background:rgba(124,101,196,0.1);border:1px solid rgba(124,101,196,0.25);color:var(--neon-purple,#7c65c4);font-size:0.65rem;font-weight:600;">${pr}</span>`
        ).join('')
      : '';

    const specialty = p.specialty ? `<div style="display:flex;align-items:center;gap:0.35rem;font-size:0.78rem;color:var(--text-muted);">🩺 <span style="color:var(--text);">${esc(p.specialty)}</span></div>` : '';
    const hospital  = p.hospital  ? `<div style="display:flex;align-items:center;gap:0.35rem;font-size:0.78rem;color:var(--text-muted);">🏥 <span style="color:var(--text-muted);">${esc(p.hospital)}</span></div>` : '';

    return `<div data-profile-key="${esc(profileKey)}" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.1rem 1.2rem;display:flex;flex-direction:column;gap:0.6rem;cursor:pointer;transition:border-color 0.18s,transform 0.15s,box-shadow 0.18s;" onmouseover="this.style.borderColor='hsl(${hue},50%,45%)';this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 24px rgba(0,0,0,0.3)';" onmouseout="this.style.borderColor='var(--border)';this.style.transform='';this.style.boxShadow='';">
      <div style="display:flex;align-items:center;gap:0.8rem;">
        <div style="width:48px;height:48px;border-radius:50%;${avatarBg}${avatarBorder};flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">${avatarHtml}</div>
        <div style="min-width:0;flex:1;">
          <div style="font-size:0.92rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:0.3rem;">${esc(p.name || '(no name)')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:0.28rem;">${statusTag}${adminBadge}${donorBadge}${tierPill}</div>
        </div>
      </div>
      ${specialty || hospital ? `<div style="display:flex;flex-direction:column;gap:0.18rem;padding-top:0.15rem;border-top:1px solid rgba(255,255,255,0.04);">${specialty}${hospital}</div>` : ''}
      ${progPills ? `<div style="display:flex;gap:0.3rem;flex-wrap:wrap;">${progPills}</div>` : ''}
    </div>`;
  }).join('');

  // Click to open profile modal
  grid.querySelectorAll('[data-profile-key]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.profileKey || '';
      const profile = profiles.find(p => String(p.email || '') === key)
        || profiles.find((p, idx) => String(p.email || idx) === key);
      _showProfileModal(profile);
    });
  });
}

function _showProfileModal(p) {
  const modal = document.getElementById('profileViewModal');
  const sheet = document.getElementById('profileViewSheet');
  if (!modal || !sheet || !p) return;

  const initial = (p.name || p.email || '?').charAt(0).toUpperCase();
  const hue = p.profileHue ?? 205;
  const avatarBg = p.profilePicBase64
    ? ''
    : `background:linear-gradient(135deg,hsla(${hue},60%,50%,0.22),hsla(${hue+60},60%,50%,0.15));`;
  const avatarBorder = `border:2px solid hsl(${hue},55%,50%)`;
  const avatarHtml = p.profilePicBase64
    ? `<img src="${p.profilePicBase64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="" />`
    : `<span style="font-size:2rem;font-weight:700;color:hsl(${hue},70%,65%);">${esc(initial)}</span>`;

  const statusTag = p.inducted
    ? `<span style="padding:3px 11px;border-radius:100px;background:rgba(62,207,142,0.12);border:1px solid rgba(62,207,142,0.3);color:var(--neon-green);font-size:0.75rem;font-weight:700;">✔ Inducted${p.inductionYear ? ' ' + esc(String(p.inductionYear)) : ''}</span>`
    : `<span style="padding:3px 11px;border-radius:100px;background:rgba(77,184,217,0.1);border:1px solid rgba(77,184,217,0.22);color:var(--neon-cyan);font-size:0.75rem;font-weight:700;">Applicant</span>`;
  const adminBadge = p.isAdmin
    ? `<span style="padding:3px 10px;border-radius:100px;background:rgba(232,166,39,0.12);border:1px solid rgba(232,166,39,0.35);color:var(--neon-gold,#e8a627);font-size:0.73rem;font-weight:700;">⚡ Admin</span>`
    : '';
  const donor = _profileDonors.get(String(p.email || '').toLowerCase());
  const donorBadge = donor
    ? `<span style="padding:3px 11px;border-radius:100px;background:linear-gradient(135deg,rgba(232,166,39,0.2),rgba(244,114,182,0.1));border:1px solid rgba(232,166,39,0.45);color:var(--neon-gold,#e8a627);font-size:0.75rem;font-weight:800;">★ MeritNama Supporter</span>`
    : '';

  // ── Projected placement from simulation result ─────────────────
  let placementHtml = '';
  if (p.applicantId) {
    const simResult = SIM.sim?.result;
    if (simResult) {
      const simCands = simResult.candidates.filter(
        c => String(c.applicantId) === String(p.applicantId)
      );
      if (simCands.length) {
        const prog = SIM.sim.program || '';
        const placedCands = simCands.filter(c => c.placed);
        if (placedCands.length) {
          placementHtml = `
            <div style="margin:0.5rem 0;padding:0.9rem 1rem;border-radius:10px;background:rgba(62,207,142,0.05);border:1px solid rgba(62,207,142,0.2);">
              <div style="font-size:0.72rem;font-weight:700;color:var(--neon-green);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:0.55rem;">✅ Projected Placement${placedCands.length > 1 ? 's' : ''} <span style="opacity:0.6;font-weight:500;text-transform:none;">(${esc(prog)} simulation)</span></div>
              ${placedCands.map(simCand => `
                <div style="padding:0.35rem 0;border-top:1px solid rgba(255,255,255,0.06);">
                  <div style="font-size:0.78rem;color:var(--neon-green);font-weight:700;">${esc(simCand._trackLabel || 'Quota')} track</div>
                  <div style="font-size:0.97rem;font-weight:700;color:var(--text);margin-bottom:0.2rem;">${esc(simCand._s)}</div>
                  <div style="font-size:0.82rem;color:var(--text-muted);">🏥 ${esc(simCand._h)}</div>
                  <div style="font-size:0.77rem;color:var(--text-muted);margin-top:0.25rem;">Quota: ${esc(simCand._q)}</div>
                </div>`).join('')}
            </div>`;
        } else {
          placementHtml = `
            <div style="margin:0.5rem 0;padding:0.8rem 1rem;border-radius:10px;background:rgba(232,100,100,0.05);border:1px solid rgba(232,100,100,0.18);">
              <div style="font-size:0.72rem;font-weight:700;color:#e87070;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:0.3rem;">⚠️ Not Placed <span style="opacity:0.6;font-weight:500;text-transform:none;">(${esc(prog)} simulation)</span></div>
              <div style="font-size:0.8rem;color:var(--text-muted);">All preferences were filled by higher-scoring candidates in this run.</div>
            </div>`;
        }
      }
      // if simCand not found: candidate applied for a different program — silently omit placement block
    } else {
      // Simulation not yet run — show a nudge
      placementHtml = `
        <div style="margin:0.5rem 0;padding:0.75rem 1rem;border-radius:10px;background:rgba(77,184,217,0.04);border:1px solid rgba(77,184,217,0.14);">
          <div style="font-size:0.78rem;color:var(--text-muted);">💡 Run the <strong style="color:var(--neon-cyan);">Simulation</strong> tab to see projected specialty &amp; hospital placement for this candidate.</div>
        </div>`;
    }
  }

  // ── Static merit standing (percentile bar) ─────────────────────
  const insight = _profileMeritInsight(p);
  let meritHtml = '';
  if (insight) {
    const barPct = insight.pctile;
    const progBadges = insight.programs.map(pr =>
      `<span style="padding:3px 9px;border-radius:4px;background:rgba(124,101,196,0.12);border:1px solid rgba(124,101,196,0.3);color:var(--neon-purple,#7c65c4);font-size:0.72rem;font-weight:600;">${pr}</span>`
    ).join('');
    meritHtml = `
      <div style="margin:0.5rem 0;padding:0.9rem 1rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:0.6rem;">📊 Merit Standing</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
          <span style="font-size:0.82rem;color:var(--text-muted);">Rank among applicants</span>
          <span style="font-size:0.88rem;font-weight:700;color:${insight.tierColor};">${insight.tier}</span>
        </div>
        <div style="height:6px;border-radius:100px;background:rgba(255,255,255,0.08);overflow:hidden;margin-bottom:0.5rem;">
          <div style="height:100%;width:${barPct}%;border-radius:100px;background:linear-gradient(90deg,rgba(77,184,217,0.4),${insight.tierColor});"></div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:0.75rem;color:var(--text-muted);">Better than <strong style="color:var(--text);">${barPct}%</strong> of applicants</span>
          ${progBadges ? `<div style="display:flex;gap:0.3rem;">${progBadges}</div>` : ''}
        </div>
      </div>`;
  }

  // Info rows
  const rows = [];
  if (p.specialty) rows.push(['🩺', 'Specialty', esc(p.specialty)]);
  if (p.hospital)  rows.push(['🏥', 'Hospital',  esc(p.hospital)]);
  if (p.inducted && p.inductionYear) rows.push(['📅', 'Induction Year', esc(String(p.inductionYear))]);
  if (p.updatedAt) {
    const d = p.updatedAt.toDate ? p.updatedAt.toDate() : new Date(p.updatedAt);
    rows.push(['🕒', 'Profile updated', d.toLocaleDateString('en-PK', { year:'numeric', month:'short', day:'numeric' })]);
  }

  const rowsHtml = rows.map(([icon, label, val]) => `
    <div style="display:flex;align-items:center;gap:0.65rem;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <span style="font-size:0.95rem;min-width:22px;text-align:center;">${icon}</span>
      <span style="font-size:0.77rem;color:var(--text-muted);min-width:100px;">${label}</span>
      <span style="font-size:0.86rem;color:var(--text);font-weight:500;">${val}</span>
    </div>`).join('');

  sheet.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid rgba(255,255,255,0.07);position:sticky;top:0;z-index:1;background:var(--bg-card);">
      <span style="font-size:0.8rem;font-weight:600;color:var(--text-muted);letter-spacing:0.06em;text-transform:uppercase;">Community Member</span>
      <button onclick="document.getElementById('profileViewModal').classList.add('hidden')" style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer;line-height:1;padding:2px 6px;">&times;</button>
    </div>
    <div style="padding:1.4rem 1.4rem 0.6rem;display:flex;flex-direction:column;align-items:center;gap:0.7rem;text-align:center;">
      <div style="width:82px;height:82px;border-radius:50%;${avatarBg}${avatarBorder};display:flex;align-items:center;justify-content:center;overflow:hidden;">${avatarHtml}</div>
      <div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--text);margin-bottom:0.4rem;">${esc(p.name || '(no name)')}</div>
        <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0.35rem;">${statusTag}${adminBadge}${donorBadge}</div>
      </div>
    </div>
    <div style="padding:0 1.2rem 1.5rem;">
      ${placementHtml}
      ${meritHtml}
      ${rowsHtml || (!meritHtml && !placementHtml ? '<div style="padding:1rem 0;text-align:center;color:var(--text-muted);font-size:0.85rem;">No additional information provided.</div>' : '')}
    </div>
  `;

  modal.classList.remove('hidden');
}
