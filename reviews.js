'use strict';
// ═══════════════════════════════════════════════════════
// Reviews & Discussion — Firebase/Firestore backend
// Collections:
//   training_reviews                  — trainee hospital/specialty reviews
//   discussions/{id}                  — forum threads
//   discussions/{id}/comments/{id}    — thread replies
// ═══════════════════════════════════════════════════════

(function () {
  // ── Constants ────────────────────────────────────────
  const REVIEWS_LIMIT  = 20;
  const THREADS_LIMIT  = 25;
  const COMMENTS_LIMIT = 50;

  const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

  const CAT_META = {
    General:    { icon: '💬', label: 'General' },
    Question:   { icon: '❓', label: 'Q&A' },
    Study:      { icon: '📚', label: 'Study' },
    Hospital:   { icon: '🏥', label: 'Hospital' },
    Merit:      { icon: '📋', label: 'Merit' },
    Experience: { icon: '⭐', label: 'Story' },
    Concern:    { icon: '⚠️', label: 'Concern' },
  };

  // ── State ────────────────────────────────────────────
  let db;
  let selectedStars       = 0;
  let allReviews          = [];
  let reviewCursor        = null;

  // Forum state
  let allThreads          = [];
  let threadCursor        = null;
  let activeCatFilter     = '';
  let currentThreadId     = null;
  let currentThread       = null;
  let commentsUnsubscribe = null;

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
  function avatarInitials(name) {
    if (!name) return '?';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.trim().slice(0, 2).toUpperCase();
  }

  function catBadge(cat) {
    const m = CAT_META[cat] || { icon: '💬', label: cat || 'General' };
    return `<span class="forum-cat forum-cat-${esc(cat || 'General')}">${m.icon} ${esc(m.label)}</span>`;
  }

  function initCharCounters() {
    [
      ['rvText',      'rvCharCount',      2000],
      ['threadTitle', 'threadTitleCount', 120],
      ['threadBody',  'threadBodyCount',  3000],
      ['commentText', 'commentCharCount', 1500],
    ].forEach(([inputId, countId, max]) => {
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

  function initReviewFilters() {
    ['filterYear', 'filterSpec', 'filterHosp'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', renderReviews);
    });
  }

  // ══════════════════════════════════════════════════════
  // FORUM — THREAD LIST
  // ══════════════════════════════════════════════════════

  function showView(view) {
    document.getElementById('forumViewList').style.display   = view === 'list'   ? '' : 'none';
    document.getElementById('forumViewNew').style.display    = view === 'new'    ? '' : 'none';
    document.getElementById('forumViewDetail').style.display = view === 'detail' ? '' : 'none';

    const title  = document.getElementById('forumPanelTitle');
    const newBtn = document.getElementById('forumNewBtn');
    const countEl= document.getElementById('threadCount');

    if (view === 'list') {
      title.textContent     = 'Community Forum';
      newBtn.style.display  = '';
      countEl.style.display = '';
    } else if (view === 'new') {
      title.textContent     = 'New Thread';
      newBtn.style.display  = 'none';
      countEl.style.display = 'none';
    } else {
      title.textContent     = 'Thread';
      newBtn.style.display  = 'none';
      countEl.style.display = 'none';
    }
  }

  function buildThreadCard(data) {
    const dateStr = data.timestamp ? timeAgo(data.timestamp.toDate()) : '';
    const replies = data.commentCount || 0;
    const cat     = catBadge(data.category);
    const yearTag = data.year      ? `<span class="rv-tag rv-tag-year">${esc(data.year)}</span>` : '';
    const specTag = data.specialty ? `<span class="rv-tag rv-tag-spec">${esc(data.specialty)}</span>` : '';
    const snippet = (data.body || '').substring(0, 140);
    return `
      <div class="thread-card" data-tid="${esc(data._id)}">
        <div class="thread-card-top">
          ${cat}
          <span class="thread-card-title">${esc(data.title)}</span>
        </div>
        ${snippet ? `<div class="thread-card-snippet">${esc(snippet)}${data.body && data.body.length > 140 ? '\u2026' : ''}</div>` : ''}
        <div class="thread-card-meta">
          <span class="thread-card-author">${esc(data.name || 'Anonymous')}</span>
          <span class="thread-card-time">&middot; ${dateStr}</span>
          ${yearTag}${specTag}
          <span class="thread-card-replies">&#128172; ${replies} repl${replies === 1 ? 'y' : 'ies'}</span>
        </div>
      </div>`;
  }

  function renderThreadList() {
    const list = document.getElementById('threadList');
    const filtered = activeCatFilter
      ? allThreads.filter(t => t.category === activeCatFilter)
      : allThreads;

    if (filtered.length === 0) {
      list.innerHTML = `<div class="rv-empty"><span class="rv-empty-icon">&#128172;</span>No threads yet &mdash; start the discussion!</div>`;
    } else {
      list.innerHTML = filtered.map(buildThreadCard).join('');
      list.querySelectorAll('.thread-card').forEach(card => {
        card.addEventListener('click', () => openThread(card.dataset.tid));
      });
    }
    const count = document.getElementById('threadCount');
    if (count) count.textContent = allThreads.length + ' thread' + (allThreads.length !== 1 ? 's' : '');
  }

  async function loadThreads(reset) {
    if (reset) {
      allThreads   = [];
      threadCursor = null;
    }
    try {
      let query = db.collection('discussions').orderBy('timestamp', 'desc').limit(THREADS_LIMIT);
      if (threadCursor) query = query.startAfter(threadCursor);
      const snap = await query.get();
      snap.forEach(doc => allThreads.push({ _id: doc.id, ...doc.data() }));
      if (!snap.empty) threadCursor = snap.docs[snap.docs.length - 1];
      const loadMore = document.getElementById('threadLoadMore');
      if (loadMore) loadMore.style.display = snap.size === THREADS_LIMIT ? '' : 'none';
      renderThreadList();
    } catch (err) {
      console.error('Load threads error:', err);
      document.getElementById('threadList').innerHTML = '<div class="rv-empty">Failed to load threads.</div>';
    }
  }

  function subscribeThreads() {
    db.collection('discussions')
      .orderBy('timestamp', 'desc')
      .limit(5)
      .onSnapshot(snap => {
        snap.docChanges().forEach(change => {
          if (change.type === 'added') {
            const data = { _id: change.doc.id, ...change.doc.data() };
            if (!allThreads.find(t => t._id === change.doc.id)) allThreads.unshift(data);
          }
          if (change.type === 'modified') {
            const idx = allThreads.findIndex(t => t._id === change.doc.id);
            if (idx !== -1) allThreads[idx] = { _id: change.doc.id, ...change.doc.data() };
          }
        });
        renderThreadList();
      }, err => console.warn('Thread snapshot error:', err));
  }

  function initCategoryChips() {
    const container = document.getElementById('forumCategoryFilter');
    if (!container) return;
    container.addEventListener('click', e => {
      const chip = e.target.closest('.forum-chip');
      if (!chip) return;
      activeCatFilter = chip.dataset.cat || '';
      container.querySelectorAll('.forum-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderThreadList();
    });
  }

  // ══════════════════════════════════════════════════════
  // FORUM — NEW THREAD
  // ══════════════════════════════════════════════════════

  async function submitThread() {
    const name      = (document.getElementById('threadName').value.trim()      || 'Anonymous').substring(0, 60);
    const cat       = document.getElementById('threadCategory').value           || 'General';
    const year      = document.getElementById('threadYear').value;
    const specialty = document.getElementById('threadSpecialty').value.trim().substring(0, 80);
    const title     = document.getElementById('threadTitle').value.trim().substring(0, 120);
    const body      = document.getElementById('threadBody').value.trim().substring(0, 3000);

    if (!title)           { setStatus('threadStatus', 'Please enter a thread title.', 'error'); return; }
    if (title.length < 5) { setStatus('threadStatus', 'Title is too short.', 'error'); return; }
    if (!body)            { setStatus('threadStatus', 'Please write a description.', 'error'); return; }
    if (body.length < 10) { setStatus('threadStatus', 'Description is too short (min 10 characters).', 'error'); return; }

    const btn = document.getElementById('threadSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Posting\u2026';
    setStatus('threadStatus', '', '');

    try {
      await db.collection('discussions').add({
        name, category: cat, year, specialty, title, body,
        email:        getSessionEmail() || '',
        commentCount: 0,
        timestamp:    firebase.firestore.FieldValue.serverTimestamp(),
      });

      setStatus('threadStatus', '\u2713 Thread posted!', 'success');
      document.getElementById('threadName').value      = '';
      document.getElementById('threadCategory').value  = 'General';
      document.getElementById('threadYear').value      = '';
      document.getElementById('threadSpecialty').value = '';
      document.getElementById('threadTitle').value     = '';
      document.getElementById('threadBody').value      = '';
      document.getElementById('threadTitleCount').textContent = '0';
      document.getElementById('threadBodyCount').textContent  = '0';

      setTimeout(() => { setStatus('threadStatus', '', ''); showView('list'); }, 1200);

    } catch (err) {
      console.error('Thread submit error:', err);
      setStatus('threadStatus', 'Failed to post. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Post Thread';
    }
  }

  // ══════════════════════════════════════════════════════
  // FORUM — THREAD DETAIL + COMMENTS
  // ══════════════════════════════════════════════════════

  function openThread(threadId) {
    currentThreadId = threadId;
    currentThread   = allThreads.find(t => t._id === threadId) || null;

    showView('detail');

    const card = document.getElementById('threadDetailCard');
    if (currentThread) {
      renderThreadDetailCard(currentThread, card);
    } else {
      db.collection('discussions').doc(threadId).get().then(doc => {
        if (doc.exists) {
          currentThread = { _id: doc.id, ...doc.data() };
          renderThreadDetailCard(currentThread, card);
        }
      });
    }

    if (commentsUnsubscribe) { commentsUnsubscribe(); commentsUnsubscribe = null; }

    document.getElementById('commentsList').innerHTML = '<div class="rv-loading">Loading replies\u2026</div>';
    commentsUnsubscribe = db.collection('discussions').doc(threadId)
      .collection('comments')
      .orderBy('timestamp', 'asc')
      .limit(COMMENTS_LIMIT)
      .onSnapshot(snap => {
        const comments = [];
        snap.forEach(doc => comments.push({ _id: doc.id, ...doc.data() }));
        renderComments(comments);
      }, err => console.warn('Comments snapshot error:', err));

    document.getElementById('forumPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderThreadDetailCard(data, container) {
    const cat     = catBadge(data.category);
    const dateStr = data.timestamp ? timeAgo(data.timestamp.toDate()) : '';
    const yearTag = data.year      ? `<span class="rv-tag rv-tag-year">${esc(data.year)}</span>` : '';
    const specTag = data.specialty ? `<span class="rv-tag rv-tag-spec">\uD83C\uDFE5 ${esc(data.specialty)}</span>` : '';
    container.innerHTML = `
      <div class="thread-detail-cat-row">${cat}${yearTag}${specTag}</div>
      <div class="thread-detail-title">${esc(data.title)}</div>
      <div class="thread-detail-body">${esc(data.body)}</div>
      <div class="thread-detail-footer">
        <span class="thread-detail-author">\u270D ${esc(data.name || 'Anonymous')}</span>
        <span>&middot;</span>
        <span>${dateStr}</span>
      </div>`;
  }

  function renderComments(comments) {
    const list  = document.getElementById('commentsList');
    const label = document.getElementById('commentCountLabel');
    if (label) label.textContent = comments.length + ' repl' + (comments.length === 1 ? 'y' : 'ies');

    if (comments.length === 0) {
      list.innerHTML = `<div class="rv-empty" style="padding:1rem;"><span style="font-size:1.5rem;display:block;margin-bottom:0.3rem;opacity:0.4;">&#128172;</span>No replies yet &mdash; be the first!</div>`;
      return;
    }
    list.innerHTML = comments.map(c => {
      const dateStr  = c.timestamp ? timeAgo(c.timestamp.toDate()) : '';
      const initials = avatarInitials(c.name || 'An');
      return `
        <div class="comment-card">
          <div class="comment-avatar">${esc(initials)}</div>
          <div class="comment-bubble">
            <div class="comment-bubble-top">
              <span class="comment-author">${esc(c.name || 'Anonymous')}</span>
              <span class="comment-time">${dateStr}</span>
            </div>
            <div class="comment-text">${esc(c.text)}</div>
          </div>
        </div>`;
    }).join('');
  }

  async function submitComment() {
    if (!currentThreadId) return;
    const name = (document.getElementById('commentName').value.trim() || 'Anonymous').substring(0, 60);
    const text = document.getElementById('commentText').value.trim().substring(0, 1500);

    if (!text)           { setStatus('commentStatus', 'Please write a reply.', 'error'); return; }
    if (text.length < 3) { setStatus('commentStatus', 'Reply is too short.', 'error'); return; }

    const btn = document.getElementById('commentSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Posting\u2026';
    setStatus('commentStatus', '', '');

    try {
      const threadRef = db.collection('discussions').doc(currentThreadId);
      await threadRef.collection('comments').add({
        name, text,
        email:     getSessionEmail() || '',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      });
      // Increment reply count on the thread document atomically
      await threadRef.update({
        commentCount: firebase.firestore.FieldValue.increment(1),
      });
      setStatus('commentStatus', '\u2713 Reply posted!', 'success');
      document.getElementById('commentText').value = '';
      document.getElementById('commentCharCount').textContent = '0';
      setTimeout(() => setStatus('commentStatus', '', ''), 3000);
    } catch (err) {
      console.error('Comment submit error:', err);
      setStatus('commentStatus', 'Failed to post. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Post Reply';
    }
  }

  // ── Bootstrap ────────────────────────────────────────
  function init() {
    if (!window.firebase || !firebase.firestore) { setTimeout(init, 100); return; }
    db = firebase.firestore();

    loadDataLists();
    initStarRating();
    initCharCounters();
    initReviewFilters();
    initCategoryChips();

    // Reviews
    loadReviews(true);
    const rvBtn  = document.getElementById('rvSubmitBtn');
    if (rvBtn)  rvBtn.addEventListener('click', submitReview);
    const rvMore = document.getElementById('rvLoadMore');
    if (rvMore) rvMore.addEventListener('click', () => loadReviews(false));

    // Forum \u2014 thread list
    loadThreads(true);
    subscribeThreads();

    const newBtn = document.getElementById('forumNewBtn');
    if (newBtn)  newBtn.addEventListener('click', () => showView('new'));

    const backFromNew = document.getElementById('forumBackFromNew');
    if (backFromNew)  backFromNew.addEventListener('click', () => showView('list'));

    const backFromDetail = document.getElementById('forumBackFromDetail');
    if (backFromDetail) {
      backFromDetail.addEventListener('click', () => {
        if (commentsUnsubscribe) { commentsUnsubscribe(); commentsUnsubscribe = null; }
        currentThreadId = null; currentThread = null;
        showView('list');
        loadThreads(true);
      });
    }

    const threadMore = document.getElementById('threadLoadMore');
    if (threadMore) threadMore.addEventListener('click', () => loadThreads(false));

    const threadSubmit = document.getElementById('threadSubmitBtn');
    if (threadSubmit) threadSubmit.addEventListener('click', submitThread);

    const commentSubmit = document.getElementById('commentSubmitBtn');
    if (commentSubmit) commentSubmit.addEventListener('click', submitComment);
  }

  // Start after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
