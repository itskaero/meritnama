'use strict';

if (typeof firebase !== 'undefined') {
  window.db = window.db || firebase.firestore();
}

/**
 * MeritNama SPA — Training Hospitals Directory & Hospital Detail views.
 * Handles the hospital grid browser, individual hospital pages, specialty
 * seat matrices, and training experience reviews.
 */

// ═══════════════════════════════════════════════════════
// VIEW: HOSPITALS DIRECTORY GRID
// ═══════════════════════════════════════════════════════

async function renderHospitals(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="section-header" style="margin-bottom: var(--spacing-lg);">
      <h2>Training Hospitals Directory</h2>
      <p>Search all PGMI training centers and residency slots inside Punjab. Select hospital to view individual reviews and seat listings.</p>
    </div>

    <!-- Search Tool -->
    <div class="card" style="margin-bottom: var(--spacing-lg);">
      <div style="display:flex; gap: var(--spacing-sm);">
        <input type="text" id="hospSearch" class="input" style="flex:1;" placeholder="Search hospital name or city…" />
      </div>
    </div>

    <!-- Hospitals grid -->
    <div class="grid grid-3" id="hospGrid" style="gap: var(--spacing-md);">
      <div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">Loading directory lists…</div>
    </div>
  `;

  const searchInput = document.getElementById('hospSearch');
  const grid = document.getElementById('hospGrid');

  try {
    const res = await fetch('data/induction21_seats.json');
    const seats = await res.json();

    const map = {};
    for (const entry of seats) {
      const id = entry.hospitalId;
      if (!map[id]) {
        map[id] = {
          id: id,
          name: entry.hospitalName,
          specialties: new Set(),
          types: new Set(),
          totalSeats: 0,
          city: entry.hospitalName.split(',').pop().trim() || 'Punjab'
        };
      }
      map[id].specialties.add(entry.specialityName);
      map[id].types.add(entry.typeName);
      map[id].totalSeats += entry.seats;
    }

    const allHospitals = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));

    const drawGrid = (list) => {
      if (!grid) return;
      if (!list.length) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">No matching training hospitals.</div>`;
        return;
      }

      grid.innerHTML = list.map(h => `
        <a href="#/hospital?id=${h.id}" class="card" style="text-decoration:none; display:flex; flex-direction:column; justify-content:space-between; height:100%; transition: var(--transition-default); hover: border-color: var(--brand-primary);">
          <div>
            <h4 style="margin:0 0 var(--spacing-xs); font-size:15px; color:var(--text-primary); line-height:1.4;">${h.name}</h4>
            <p style="font-size:12.5px; color:var(--text-tertiary); display:flex; align-items:center; gap:4px; margin-bottom:var(--spacing-sm);">
              <i class="ph ph-map-pin"></i> ${h.city}
            </p>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top: auto;">
            <span class="badge badge-info" style="font-family:var(--font-mono); font-size:11px;">${h.totalSeats} seats</span>
            <span class="badge badge-secondary" style="font-size:11px;">${h.specialties.size} specialties</span>
          </div>
        </a>
      `).join('');
    };

    drawGrid(allHospitals);

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        const filtered = allHospitals.filter(h =>
          h.name.toLowerCase().includes(q) || h.city.toLowerCase().includes(q)
        );
        drawGrid(filtered);
      });
    }

  } catch (err) {
    console.error('[Hospitals] Load failure:', err);
    if (grid) grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--color-reach);">Failed to load seats database.</div>`;
  }
}

// ═══════════════════════════════════════════════════════
// VIEW: INDIVIDUAL HOSPITAL PROFILE & REVIEWS
// ═══════════════════════════════════════════════════════

let _currentHospitalId = null;
let _selectedStars = 0;
let _selectedSpecialty = null;

async function renderHospitalDetail(container) {
  if (!container) return;

  const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const hospitalId = urlParams.get('id');

  if (!hospitalId) {
    container.innerHTML = `<div class="card" style="padding:40px; text-align:center;"><p style="color:var(--color-reach);">No Hospital ID specified in parameters.</p></div>`;
    return;
  }

  _currentHospitalId = hospitalId;
  _selectedStars = 0;
  _selectedSpecialty = null;

  // Initial spinner state
  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; gap: var(--spacing-md);">
      <div class="skeleton-shimmer" style="width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div>
      <p style="color:var(--text-secondary); font-size:14px;">Loading Hospital Details…</p>
    </div>
  `;

  try {
    const res = await fetch('data/induction21_seats.json');
    const seats = await res.json();

    // Grouping
    const matched = seats.filter(s => String(s.hospitalId) === String(hospitalId));
    if (!matched.length) {
      container.innerHTML = `<div class="card" style="padding:40px; text-align:center;"><p style="color:var(--color-reach);">Hospital details matching ID not found.</p></div>`;
      return;
    }

    const hospitalName = matched[0].hospitalName;
    const city = hospitalName.split(',').pop().trim() || 'Punjab';

    const specialtiesMap = {};
    let totalSeats = 0;
    matched.forEach(s => {
      const spec = s.specialityName;
      if (!specialtiesMap[spec]) {
        specialtiesMap[spec] = { name: spec, FCPS: 0, MS: 0, MD: 0, total: 0 };
      }
      specialtiesMap[spec][s.typeName] = (specialtiesMap[spec][s.typeName] || 0) + s.seats;
      specialtiesMap[spec].total += s.seats;
      totalSeats += s.seats;
    });

    const specialtiesList = Object.values(specialtiesMap).sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = `
      <div style="margin-bottom: var(--spacing-lg);">
        <a href="#/hospitals" class="btn btn-secondary" style="margin-bottom: var(--spacing-md); padding:6px 12px; font-size:12.5px;"><i class="ph ph-arrow-left"></i> Back to directory</a>
        <h2>${hospitalName}</h2>
        <p style="color:var(--text-secondary); font-size:14px; display:flex; align-items:center; gap:4px; margin-top:4px;">
          <i class="ph ph-map-pin"></i> ${city} &middot; <strong style="color:var(--brand-primary);">${totalSeats} seats</strong> across ${specialtiesList.length} fields
        </p>
      </div>

      <div class="grid grid-3" style="gap: var(--spacing-lg); align-items: flex-start;">
        <!-- Specialties matrix list (spans 2 columns) -->
        <div class="card" style="grid-column: span 2; padding:0; overflow:hidden;">
          <div style="padding: var(--spacing-md) var(--spacing-lg); border-bottom:1px solid var(--border-default);">
            <h3 style="margin:0;">Allocated Specialties Matrix</h3>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Speciality Program</th>
                  <th class="num">FCPS seats</th>
                  <th class="num">MS seats</th>
                  <th class="num">MD seats</th>
                  <th class="num">Total</th>
                </tr>
              </thead>
              <tbody>
                ${specialtiesList.map(s => `
                  <tr style="cursor:pointer;" class="hp-spec-row" data-spec="${s.name}">
                    <td><strong>${s.name}</strong></td>
                    <td class="num font-mono">${s.FCPS || '—'}</td>
                    <td class="num font-mono">${s.MS || '—'}</td>
                    <td class="num font-mono">${s.MD || '—'}</td>
                    <td class="num font-mono" style="font-weight:700; color:var(--brand-primary);">${s.total}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Reviews Sidebar -->
        <div style="display:flex; flex-direction:column; gap: var(--spacing-lg);">
          <!-- Review input form -->
          <div class="card">
            <h4>Share Training Experience</h4>
            <div style="display:flex; flex-direction:column; gap: var(--spacing-sm); margin-top: var(--spacing-sm);">
              <div class="form-group">
                <label>Rating Score</label>
                <div id="starPicker" style="display:flex; gap:4px; margin-top:4px;">
                  ${[1, 2, 3, 4, 5].map(n => `
                    <button class="btn btn-ghost" data-val="${n}" style="padding:4px; font-size:20px; color:var(--text-tertiary);" type="button"><i class="ph ph-star"></i></button>
                  `).join('')}
                </div>
                <span id="starLabel" style="font-size:12px; color:var(--text-tertiary);">Select rating</span>
              </div>
              <div class="form-group">
                <label for="revSpec">Specialty Filter Badge</label>
                <div id="revSpecBadge" class="badge badge-info" style="display:none; margin-top:4px;">
                  <span id="revSpecLabel"></span>
                  <button id="revSpecClear" class="btn btn-ghost" style="padding:2px; font-size:10px; color:#fff;" type="button">&times;</button>
                </div>
                <span id="revSpecHint" style="font-size:12px; color:var(--text-tertiary);">Click specialty row on table to link review</span>
              </div>
              <input type="text" id="revName" class="input" placeholder="Display name (default Anonymous)…" />
              <textarea id="revText" class="input" rows="3" placeholder="Write feedback details…"></textarea>
              <button id="revSubmit" class="btn btn-primary">Submit Review</button>
              <div id="revStatus" style="font-size:12px; min-height:1.2em;"></div>
            </div>
          </div>

          <!-- Reviews Feed List -->
          <div class="card" style="padding: var(--spacing-md);">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-default); padding-bottom:8px; margin-bottom:8px;">
              <h4 id="reviewsHeading" style="margin:0;">Training Reviews</h4>
              <button id="reviewsShowAll" class="btn btn-ghost" style="font-size:11px; padding:2px 6px; display:none;">Show all</button>
            </div>
            <div id="reviewsList" style="display:flex; flex-direction:column; gap: var(--spacing-sm);">
              <p style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px;">No reviews uploaded yet.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Wire up events
    setupHospitalDetailEvents(hospitalName);
    loadHospitalReviews();

  } catch (err) {
    console.error('[Hospital Detail] Load failure:', err);
    container.innerHTML = `<div class="card" style="border-color:var(--color-reach); padding: var(--spacing-lg); text-align:center;"><p style="color:var(--color-reach);">Failed to load details database.</p></div>`;
  }
}

// ═══════════════════════════════════════════════════════
// HELPER METHODS FOR REVIEWS & SEATS DETAILS
// ═══════════════════════════════════════════════════════

function setupHospitalDetailEvents(hospitalName) {
  // Star Picker
  const stars = document.querySelectorAll('#starPicker button');
  const starLabel = document.getElementById('starLabel');
  const STAR_LABELS = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very Good', 5: 'Excellent' };

  stars.forEach(btn => {
    btn.addEventListener('click', () => {
      _selectedStars = parseInt(btn.dataset.val, 10);
      stars.forEach((b, i) => {
        const icon = b.querySelector('i');
        if (i < _selectedStars) {
          icon.className = 'ph ph-star-fill';
          b.style.color = '#e8a627';
        } else {
          icon.className = 'ph ph-star';
          b.style.color = 'var(--text-tertiary)';
        }
      });
      starLabel.textContent = STAR_LABELS[_selectedStars] || 'Select rating';
    });
  });

  // Table Specialty selection click
  document.querySelectorAll('.hp-spec-row').forEach(row => {
    row.addEventListener('click', () => {
      const spec = row.dataset.spec;
      _selectedSpecialty = spec;

      // Highlight row selection
      document.querySelectorAll('.hp-spec-row').forEach(r => {
        r.style.background = r.dataset.spec === spec ? 'var(--brand-light)' : '';
      });

      // Update Form Badge
      const badge = document.getElementById('revSpecBadge');
      const label = document.getElementById('revSpecLabel');
      const hint = document.getElementById('revSpecHint');
      const showAllBtn = document.getElementById('reviewsShowAll');

      if (badge && label && hint) {
        label.textContent = spec;
        badge.style.display = '';
        hint.style.display = 'none';
      }

      if (showAllBtn) showAllBtn.style.display = '';

      // Reload matching reviews
      loadHospitalReviews(spec);
    });
  });

  // Clear Specialty badge
  const clearBadgeBtn = document.getElementById('revSpecClear');
  const showAllBtn = document.getElementById('reviewsShowAll');
  if (clearBadgeBtn) {
    clearBadgeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _selectedSpecialty = null;
      document.querySelectorAll('.hp-spec-row').forEach(r => r.style.background = '');

      const badge = document.getElementById('revSpecBadge');
      const hint = document.getElementById('revSpecHint');
      if (badge && hint) {
        badge.style.display = 'none';
        hint.style.display = '';
      }
      if (showAllBtn) showAllBtn.style.display = 'none';

      loadHospitalReviews();
    });
  }

  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      _selectedSpecialty = null;
      document.querySelectorAll('.hp-spec-row').forEach(r => r.style.background = '');

      const badge = document.getElementById('revSpecBadge');
      const hint = document.getElementById('revSpecHint');
      if (badge && hint) {
        badge.style.display = 'none';
        hint.style.display = '';
      }
      showAllBtn.style.display = 'none';

      loadHospitalReviews();
    });
  }

  // Submit Review Click
  const submitBtn = document.getElementById('revSubmit');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => submitHospitalReview(hospitalName));
  }
}

async function loadHospitalReviews(filterSpec = null) {
  const list = document.getElementById('reviewsList');
  if (!list) return;

  list.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted); font-size:12.5px;">Loading reviews…</div>`;

  try {
    let query = db.collection('hospital_reviews')
      .where('hospitalId', '==', _currentHospitalId)
      .limit(30);

    if (filterSpec) {
      query = db.collection('hospital_reviews')
        .where('hospitalId', '==', _currentHospitalId)
        .where('specialty', '==', filterSpec)
        .limit(30);
    }

    const snap = await query.get();

    if (snap.empty) {
      list.innerHTML = `<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px;">No reviews yet${filterSpec ? ' for this specialty' : ''}. Be the first to add!</p>`;
      return;
    }

    // Sort descending by date client-side to save Firestore index creation
    const docs = snap.docs.slice().sort((a, b) => {
      const ta = a.data().createdAt?.toMillis() ?? 0;
      const tb = b.data().createdAt?.toMillis() ?? 0;
      return tb - ta;
    });

    list.innerHTML = docs.map(doc => {
      const d = doc.data();
      const date = d.createdAt ? d.createdAt.toDate().toLocaleDateString() : 'Just now';
      const specTag = d.specialty ? `<span class="badge badge-info" style="font-size:10px; margin-top:4px;">📌 ${d.specialty}</span>` : '';

      // Star builder helper
      let starsHtml = '';
      for (let i = 1; i <= 5; i++) {
        starsHtml += `<i class="ph ph-star${i <= (d.rating || 0) ? '-fill' : ''}" style="color:${i <= (d.rating || 0) ? '#e8a627' : 'var(--text-tertiary)'}; font-size:13px;"></i>`;
      }

      return `
        <div class="card" style="padding: var(--spacing-sm) var(--spacing-md); border-color: var(--border-subtle); display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
            <strong style="color:var(--text-primary);">${d.author || 'Anonymous'}</strong>
            <span style="color:var(--text-tertiary);">${date}</span>
          </div>
          <div style="display:flex; gap:2px;">${starsHtml}</div>
          ${specTag}
          <p style="font-size:13px; color:var(--text-secondary); margin:4px 0 0; line-height:1.4; word-break:break-word;">${d.text}</p>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('[Hospitals Reviews] Load error:', err);
    list.innerHTML = `<p style="color:var(--color-reach); font-size:12.5px; text-align:center;">Unable to load reviews feed.</p>`;
  }
}

async function submitHospitalReview(hospitalName) {
  const status = document.getElementById('revStatus');
  const textInput = document.getElementById('revText');
  const nameInput = document.getElementById('revName');
  const text = textInput ? textInput.value.trim() : '';
  const author = nameInput ? nameInput.value.trim() : 'Anonymous';

  if (!status) return;

  if (!_selectedStars) {
    status.className = 'error';
    status.style.color = 'var(--color-reach)';
    status.textContent = 'Please choose a star rating.';
    return;
  }
  if (!text) {
    status.className = 'error';
    status.style.color = 'var(--color-reach)';
    status.textContent = 'Please type your experience feedback.';
    return;
  }

  const btn = document.getElementById('revSubmit');
  if (btn) btn.disabled = true;
  status.textContent = 'Submitting feedback…';
  status.style.color = 'var(--text-secondary)';

  try {
    await db.collection('hospital_reviews').add({
      hospitalId: _currentHospitalId,
      hospitalName: hospitalName,
      specialty: _selectedSpecialty || null,
      author: author || 'Anonymous',
      rating: _selectedStars,
      text: text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    status.textContent = 'Review submitted! Thank you.';
    status.style.color = 'var(--color-safe)';
    if (textInput) textInput.value = '';

    // Refresh list
    setTimeout(() => loadHospitalReviews(_selectedSpecialty), 1000);

  } catch (err) {
    console.error('[Hospitals Reviews] Submission error:', err);
    status.textContent = 'Failed to submit review. Try again.';
    status.style.color = 'var(--color-reach)';
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Expose render helpers globally
window.renderHospitals = renderHospitals;
window.renderHospitalDetail = renderHospitalDetail;
