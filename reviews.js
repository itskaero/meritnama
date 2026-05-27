'use strict';
// ═══════════════════════════════════════════════════════
// Reviews & Discussion — Firebase/Firestore backend
// Collections:
//   training_reviews — trainee hospital/specialty reviews
//   discussions      — general community messages
// ═══════════════════════════════════════════════════════

(function () {
  // ── Constants ──────────────────────────────────────
  const REVIEWS_LIMIT   = 20;
  const DISC_LIMIT      = 30;
  const PROFANITY_BLOCK = false; // set true to add filter words

  const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

  // ── State ──────────────────────────────────────────
  let db;
  let selectedStars = 0;
  let allReviews    = [];
  let allDisc       = [];
  let reviewCursor  = null;
  let discCursor    = null;

  // ── Helpers ────────────────────────────────────────
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(date) {
    if (!date) return '';
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60)          return 'just now';
    if (diff < 3600)        return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400)       return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7)   return Math.floor(diff / 86400) + 'd ago';
    return date.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderStars(n) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += i <= n
        ? '<span>&#9733;</span>'
        : '<span class="empty">&#9734;</span>';
    }
    return html;
  }

  function setStatus(elId, msg, type) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.className = 'rv-status ' + (type || '');
  }

  // ── Populate datalists from flat_lookup.json ──────
  async function loadDataLists() {
    try {
      const res  = await fetch('data/flat_lookup.json');
      const data = await res.json();

      const specialties = [...new Set(data.map(d => d.specialty))].filter(Boolean).sort();
      const hospitals   = [...new Set(data.map(d => d.hospital))].filter(Boolean).sort();

      const specList  = document.getElementById('specialtyList');
      const hospList  = document.getElementById('hospitalList');

      specialties.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        specList.appendChild(opt);
      });
      hospitals.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        hospList.appendChild(opt);
      });
    } catch (e) {
      console.warn('Could not load specialty/hospital lists:', e);
    }
  }

  // ── Star Rating UI ─────────────────────────────────
  function initStarRating() {
    const container = document.getElementById('starRating');
    const label     = document.getElementById('starLabel');
    if (!container) return;

    const buttons = container.querySelectorAll('button');

    container.addEventListener('mouseover', function (e) {
      const btn = e.target.closest('button');
      if (!btn) return;
      const n = parseInt(btn.dataset.star, 10);
      buttons.forEach((b, i) => b.classList.toggle('active', i < n));
    });

    container.addEventListener('mouseout', function () {
      buttons.forEach((b, i) => b.classList.toggle('active', i < selectedStars));
    });

    container.addEventListener('click', function (e) {
      const btn = e.target.closest('button');
      if (!btn) return;
      selectedStars = parseInt(btn.dataset.star, 10);
      label.textContent = STAR_LABELS[selectedStars] || '';
      buttons.forEach((b, i) => b.classList.toggle('active', i < selectedStars));
    });
  }

  // ── Char counters ──────────────────────────────────
  function initCharCounters() {
    [['rvText', 'rvCharCount', 2000], ['discText', 'discCharCount', 1500]].forEach(([inputId, countId, max]) => {
      const input = document.getElementById(inputId);
      const count = document.getElementById(countId);
      if (!input || !count) return;
      input.addEventListener('input', () => {
        const len = input.value.length;
        count.textContent = len;
        count.style.color = len > max * 0.9 ? 'var(--danger)' : '';
      });
    });
  }

  // ── Get session email ──────────────────────────────
  function getSessionEmail() {
    try {
      const raw = localStorage.getItem('meritnama_auth_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return (s && typeof s.email === 'string') ? s.email : null;
    } catch (e) { return null; }
  }

  // ═══════════════════════════════════════════════════
  // REVIEWS
  // ═══════════════════════════════════════════════════

  async function submitReview() {
    const name      = (document.getElementById('rvName').value.trim()     || 'Anonymous').substring(0, 60);
    const year      = document.getElementById('rvYear').value;
    const specialty = document.getElementById('rvSpecialty').value.trim().substring(0, 80);
    const hospital  = document.getElementById('rvHospital').value.trim().substring(0, 120);
    const text      = document.getElementById('rvText').value.trim().substring(0, 2000);
    const rating    = selectedStars;

    if (!year)       { setStatus('rvStatus', 'Please select your training year.', 'error'); return; }
    if (!specialty)  { setStatus('rvStatus', 'Please enter a specialty.', 'error'); return; }
    if (!hospital)   { setStatus('rvStatus', 'Please enter a hospital.', 'error'); return; }
    if (rating === 0){ setStatus('rvStatus', 'Please select a star rating.', 'error'); return; }
    if (!text)       { setStatus('rvStatus', 'Please write your review.', 'error'); return; }
    if (text.length < 20) { setStatus('rvStatus', 'Review is too short (min 20 characters).', 'error'); return; }

    const btn = document.getElementById('rvSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    setStatus('rvStatus', '', '');

    try {
      await db.collection('training_reviews').add({
        name:      name,
        year:      year,
        specialty: specialty,
        hospital:  hospital,
        rating:    rating,
        text:      text,
        email:     getSessionEmail() || '',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      setStatus('rvStatus', '✓ Review submitted — thank you!', 'success');

      // Reset form
      document.getElementById('rvYear').value      = '';
      document.getElementById('rvSpecialty').value = '';
      document.getElementById('rvHospital').value  = '';
      document.getElementById('rvText').value      = '';
      document.getElementById('rvCharCount').textContent = '0';
      selectedStars = 0;
      document.querySelectorAll('#starRating button').forEach(b => b.classList.remove('active'));
      document.getElementById('starLabel').textContent = 'No rating';

      // Reload list
      loadReviews(true);

    } catch (err) {
      console.error('Review submit error:', err);
      setStatus('rvStatus', 'Failed to submit. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Review';
    }
  }

  function buildReviewCard(data) {
    const stars    = renderStars(data.rating || 0);
    const dateStr  = data.timestamp ? timeAgo(data.timestamp.toDate()) : '';
    const yearTag  = data.year     ? `<span class="rv-tag rv-tag-year">${esc(data.year)}</span>` : '';
    const specTag  = data.specialty ? `<span class="rv-tag rv-tag-spec">&#128488; ${esc(data.specialty)}</span>` : '';
    const hospTag  = data.hospital  ? `<span class="rv-tag rv-tag-hosp">&#127968; ${esc(data.hospital)}</span>` : '';

    return `
      <div class="rv-card">
        <div class="rv-card-top">
          <div>
            <div class="rv-card-author">${esc(data.name || 'Anonymous')}</div>
            <div class="rv-card-stars">${stars}</div>
          </div>
          <div class="rv-card-time">${dateStr}</div>
        </div>
        <div class="rv-card-tags">${yearTag}${specTag}${hospTag}</div>
        <div class="rv-card-text">${esc(data.text)}</div>
      </div>`;
  }

  function renderReviews() {
    const yearFilter = document.getElementById('filterYear').value;
    const specFilter = document.getElementById('filterSpec').value.toLowerCase().trim();
    const hospFilter = document.getElementById('filterHosp').value.toLowerCase().trim();

    let filtered = allReviews;
    if (yearFilter) filtered = filtered.filter(r => r.year === yearFilter);
    if (specFilter) filtered = filtered.filter(r => (r.specialty || '').toLowerCase().includes(specFilter));
    if (hospFilter) filtered = filtered.filter(r => (r.hospital  || '').toLowerCase().includes(hospFilter));

    const list = document.getElementById('reviewsList');
    if (filtered.length === 0) {
      list.innerHTML = `<div class="rv-empty"><span class="rv-empty-icon">&#128196;</span>No reviews yet — be the first!</div>`;
    } else {
      list.innerHTML = filtered.map(buildReviewCard).join('');
    }

    const count = document.getElementById('reviewCount');
    if (count) count.textContent = allReviews.length + ' review' + (allReviews.length === 1 ? '' : 's');
  }

  async function loadReviews(reset) {
    if (reset) {
      allReviews   = [];
      reviewCursor = null;
      document.getElementById('reviewsList').innerHTML = '<div class="rv-loading">Loading reviews&hellip;</div>';
    }

    try {
      let query = db.collection('training_reviews')
        .orderBy('timestamp', 'desc')
        .limit(REVIEWS_LIMIT);

      if (reviewCursor) query = query.startAfter(reviewCursor);

      const snap = await query.get();
      snap.forEach(doc => allReviews.push(doc.data()));

      if (!snap.empty) reviewCursor = snap.docs[snap.docs.length - 1];

      const loadMore = document.getElementById('rvLoadMore');
      if (loadMore) loadMore.style.display = snap.size === REVIEWS_LIMIT ? '' : 'none';

      renderReviews();

    } catch (err) {
      console.error('Load reviews error:', err);
      document.getElementById('reviewsList').innerHTML = '<div class="rv-empty">Failed to load reviews.</div>';
    }
  }

  // Real-time listener for new reviews (only newest 5 shown live)
  function subscribeReviews() {
    db.collection('training_reviews')
      .orderBy('timestamp', 'desc')
      .limit(5)
      .onSnapshot(snap => {
        // Prepend any documents newer than what we already have
        snap.docChanges().forEach(change => {
          if (change.type === 'added') {
            const data = change.doc.data();
            // Avoid duplicates
            if (!allReviews.find(r => r._id === change.doc.id)) {
              allReviews.unshift({ ...data, _id: change.doc.id });
            }
          }
        });
        renderReviews();
      }, err => console.warn('Reviews snapshot error:', err));
  }

  // ═══════════════════════════════════════════════════
  // DISCUSSION
  // ═══════════════════════════════════════════════════

  async function submitComment() {
    const name = (document.getElementById('discName').value.trim() || 'Anonymous').substring(0, 60);
    const text = document.getElementById('discText').value.trim().substring(0, 1500);

    if (!text)            { setStatus('discStatus', 'Please write a message.', 'error'); return; }
    if (text.length < 5)  { setStatus('discStatus', 'Message is too short.', 'error'); return; }

    const btn = document.getElementById('discSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Posting…';
    setStatus('discStatus', '', '');

    try {
      await db.collection('discussions').add({
        name:      name,
        text:      text,
        email:     getSessionEmail() || '',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      setStatus('discStatus', '✓ Message posted!', 'success');
      document.getElementById('discText').value = '';
      document.getElementById('discCharCount').textContent = '0';

    } catch (err) {
      console.error('Discussion submit error:', err);
      setStatus('discStatus', 'Failed to post. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Post Message';
    }
  }

  function buildDiscCard(data) {
    const dateStr = data.timestamp ? timeAgo(data.timestamp.toDate()) : '';
    return `
      <div class="disc-card">
        <div class="disc-card-top">
          <span class="disc-author">${esc(data.name || 'Anonymous')}</span>
          <span class="disc-time">${dateStr}</span>
        </div>
        <div class="disc-text">${esc(data.text)}</div>
      </div>`;
  }

  function renderDisc() {
    const list = document.getElementById('discList');
    if (allDisc.length === 0) {
      list.innerHTML = `<div class="rv-empty"><span class="rv-empty-icon">&#128483;</span>No messages yet — start the discussion!</div>`;
    } else {
      list.innerHTML = allDisc.map(buildDiscCard).join('');
    }
    const count = document.getElementById('discCount');
    if (count) count.textContent = allDisc.length + ' message' + (allDisc.length === 1 ? '' : 's');
  }

  // Live subscription for discussion (real-time)
  function subscribeDiscussion() {
    db.collection('discussions')
      .orderBy('timestamp', 'desc')
      .limit(DISC_LIMIT)
      .onSnapshot(snap => {
        allDisc = [];
        snap.forEach(doc => allDisc.push({ ...doc.data(), _id: doc.id }));
        renderDisc();

        const loadMore = document.getElementById('discLoadMore');
        if (loadMore) loadMore.style.display = snap.size === DISC_LIMIT ? '' : 'none';
      }, err => console.warn('Discussion snapshot error:', err));
  }

  async function loadMoreDiscussion() {
    if (!discCursor) return;
    try {
      const snap = await db.collection('discussions')
        .orderBy('timestamp', 'desc')
        .startAfter(discCursor)
        .limit(DISC_LIMIT)
        .get();

      snap.forEach(doc => allDisc.push({ ...doc.data(), _id: doc.id }));
      if (!snap.empty) discCursor = snap.docs[snap.docs.length - 1];

      const loadMore = document.getElementById('discLoadMore');
      if (loadMore) loadMore.style.display = snap.size === DISC_LIMIT ? '' : 'none';

      renderDisc();
    } catch (err) {
      console.error('Load more discussion error:', err);
    }
  }

  // ── Filter event listeners ─────────────────────────
  function initFilters() {
    ['filterYear', 'filterSpec', 'filterHosp'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', renderReviews);
    });
  }

  // ── Bootstrap ──────────────────────────────────────
  function init() {
    // Wait for Firebase
    if (!window.firebase || !firebase.firestore) {
      setTimeout(init, 100);
      return;
    }

    db = firebase.firestore();

    loadDataLists();
    initStarRating();
    initCharCounters();
    initFilters();
    loadReviews(true);
    subscribeDiscussion();

    // Submit review
    const rvBtn = document.getElementById('rvSubmitBtn');
    if (rvBtn) rvBtn.addEventListener('click', submitReview);

    // Load more reviews
    const rvMore = document.getElementById('rvLoadMore');
    if (rvMore) rvMore.addEventListener('click', () => loadReviews(false));

    // Submit discussion
    const discBtn = document.getElementById('discSubmitBtn');
    if (discBtn) discBtn.addEventListener('click', submitComment);

    // Load more discussion
    const discMore = document.getElementById('discLoadMore');
    if (discMore) discMore.addEventListener('click', loadMoreDiscussion);
  }

  // Start after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
