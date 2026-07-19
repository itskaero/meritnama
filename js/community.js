'use strict';
// ═══════════════════════════════════════════════════════
// Community Feed — Firebase/Firestore backend
// Collections:
//   social_posts/{id}                 — structured posts (question/review/resource/result)
//   social_posts/{id}/comments/{id}   — post comments
//   social_posts/{id}/likes/{email}   — like toggle, doc ID = liker's email
//
// New, standalone, additive — mirrors reviews.js's structure/patterns
// (view toggling, thread-card markup, comment subcollection listener) but
// does not modify reviews.js, sim-chat.js, or the discussions/hospital_reviews
// collections at all.
// ═══════════════════════════════════════════════════════

(function () {
  const POSTS_LIMIT    = 25;
  const COMMENTS_LIMIT = 50;

  const TYPE_META = {
    question: { icon: '❓', label: 'Question' },
    review:   { icon: '🏥', label: 'Hospital Review' },
    resource: { icon: '📚', label: 'Resource/Tip' },
    result:   { icon: '🏆', label: 'Result Update' },
  };

  // ── State ────────────────────────────────────────────
  let db;
  let allPosts        = [];
  let postCursor       = null;
  let activeTypeFilter = '';
  let selectedStars    = 0;
  let activePostType    = 'question';
  let currentPostId    = null;
  let currentPost      = null;
  let commentsUnsubscribe = null;
  let likedByMe        = false;

  // ── Helpers (mirrors reviews.js's esc/timeAgo/avatarInitials) ──────
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function timeAgo(date) {
    if (!date) return '';
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    return date.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function avatarInitials(name) {
    if (!name) return '?';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.trim().slice(0, 2).toUpperCase();
  }
  function typeBadge(type) {
    const m = TYPE_META[type] || TYPE_META.question;
    return `<span class="cf-type cf-type-${esc(type)}">${m.icon} ${esc(m.label)}</span>`;
  }
  function setStatus(elId, msg, type) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.className = 'rv-status ' + (type || '');
  }
  function getSessionEmail() {
    try {
      const raw = localStorage.getItem('meritnama_auth_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return (s && typeof s.email === 'string') ? s.email : null;
    } catch (e) { return null; }
  }

  const profileCache = {};
  async function getUserProfile(email) {
    if (!email) return null;
    if (profileCache[email] !== undefined) return profileCache[email];
    try {
      const doc = await db.collection('user_profiles').doc(email).get();
      profileCache[email] = doc.exists ? doc.data() : null;
    } catch (e) { profileCache[email] = null; }
    return profileCache[email];
  }

  // ── Populate specialty/hospital datalists (same source as reviews.js) ──
  async function loadDataLists() {
    try {
      const res  = await fetch('data/flat_lookup.json');
      const data = await res.json();
      const specialties = [...new Set(data.map(d => d.specialty))].filter(Boolean).sort();
      const hospitals   = [...new Set(data.map(d => d.hospital))].filter(Boolean).sort();
      const specList = document.getElementById('specialtyList');
      const hospList = document.getElementById('hospitalList');
      specialties.forEach(s => { const o = document.createElement('option'); o.value = s; specList.appendChild(o); });
      hospitals.forEach(h => { const o = document.createElement('option'); o.value = h; hospList.appendChild(o); });
    } catch (e) { console.warn('Could not load specialty/hospital lists:', e); }
  }

  function initCharCounters() {
    [['postTitle', 'postTitleCount', 120], ['postBody', 'postBodyCount', 3000], ['postCommentText', 'postCommentCharCount', 1500],
     ['threadTitle', 'threadTitleCount', 120], ['threadBody', 'threadBodyCount', 3000], ['discCommentText', 'discCommentCharCount', 1500]]
      .forEach(([inputId, countId, max]) => {
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

  // ── Post-type picker (drives which extra fields show) ──────────────
  function initTypePicker() {
    const picker = document.getElementById('postTypePicker');
    if (!picker) return;
    picker.addEventListener('click', e => {
      const btn = e.target.closest('.cf-type-btn');
      if (!btn) return;
      activePostType = btn.dataset.type;
      picker.querySelectorAll('.cf-type-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('postRatingField').style.display  = activePostType === 'review'   ? '' : 'none';
      document.getElementById('postProgramField').style.display = activePostType === 'result'   ? '' : 'none';
      document.getElementById('postLinkField').style.display    = activePostType === 'resource' ? '' : 'none';
    });
  }

  function initStarRating() {
    const container = document.getElementById('postStarRating');
    const label = document.getElementById('postStarLabel');
    if (!container) return;
    const buttons = container.querySelectorAll('button');
    const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
    function paint(n) { buttons.forEach((b, i) => { b.classList.toggle('active', i < n); b.innerHTML = i < n ? '&#9733;' : '&#9734;'; }); }
    container.addEventListener('mouseover', e => { const btn = e.target.closest('button'); if (btn) paint(parseInt(btn.dataset.star, 10)); });
    container.addEventListener('mouseout', () => paint(selectedStars));
    container.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      selectedStars = parseInt(btn.dataset.star, 10);
      label.textContent = STAR_LABELS[selectedStars] || '';
      paint(selectedStars);
    });
  }

  // ══════════════════════════════════════════════════════
  // VIEW SWITCHING
  // ══════════════════════════════════════════════════════
  function showView(view) {
    document.getElementById('feedViewList').style.display   = view === 'list'   ? '' : 'none';
    document.getElementById('feedViewNew').style.display    = view === 'new'    ? '' : 'none';
    document.getElementById('feedViewDetail').style.display = view === 'detail' ? '' : 'none';

    const title   = document.getElementById('feedPanelTitle');
    const newBtn  = document.getElementById('feedNewBtn');
    const countEl = document.getElementById('postCount');

    if (view === 'list') {
      title.textContent = 'Community Feed'; newBtn.style.display = ''; countEl.style.display = '';
    } else if (view === 'new') {
      title.textContent = 'New Post'; newBtn.style.display = 'none'; countEl.style.display = 'none';
    } else {
      title.textContent = 'Post'; newBtn.style.display = 'none'; countEl.style.display = 'none';
    }
  }

  // ══════════════════════════════════════════════════════
  // FEED LIST
  // ══════════════════════════════════════════════════════
  function buildPostCard(data) {
    const dateStr = data.timestamp ? timeAgo(data.timestamp.toDate()) : '';
    const comments = data.commentCount || 0;
    const likes = data.likeCount || 0;
    const type = typeBadge(data.type);
    const specTag = data.specialty ? `<span class="rv-tag rv-tag-spec">${esc(data.specialty)}</span>` : '';
    const hospTag  = data.hospital  ? `<span class="rv-tag rv-tag-hosp">&#127968; ${esc(data.hospital)}</span>` : '';
    const snippet = (data.body || '').substring(0, 180);
    const initials = avatarInitials(data.authorName || 'Anonymous');
    return `
      <div class="fb-post-card" data-pid="${esc(data._id)}">
        <div class="fb-post-header">
          <div class="fb-post-avatar">${esc(initials)}</div>
          <div class="fb-post-header-text">
            <div class="fb-post-author">${esc(data.authorName || 'Anonymous')}</div>
            <div class="fb-post-meta">${type}<span>&middot;</span><span>${dateStr}</span></div>
          </div>
        </div>
        <div class="fb-post-title">${esc(data.title)}</div>
        ${snippet ? `<div class="fb-post-snippet">${esc(snippet)}${data.body && data.body.length > 180 ? '…' : ''}</div>` : ''}
        ${(specTag || hospTag) ? `<div class="fb-post-tags">${specTag}${hospTag}</div>` : ''}
        <div class="fb-post-actionbar">
          <button class="fb-action-btn" type="button">&#10084; ${likes} ${likes === 1 ? 'Like' : 'Likes'}</button>
          <button class="fb-action-btn" type="button">&#128172; ${comments} ${comments === 1 ? 'Comment' : 'Comments'}</button>
        </div>
      </div>`;
  }

  function renderPostList() {
    const list = document.getElementById('postList');
    const specFilter = (document.getElementById('feedSpecFilter').value || '').toLowerCase().trim();
    const hospFilter = (document.getElementById('feedHospFilter').value || '').toLowerCase().trim();

    let filtered = activeTypeFilter ? allPosts.filter(p => p.type === activeTypeFilter) : allPosts;
    if (specFilter) filtered = filtered.filter(p => (p.specialty || '').toLowerCase().includes(specFilter));
    if (hospFilter) filtered = filtered.filter(p => (p.hospital  || '').toLowerCase().includes(hospFilter));

    if (filtered.length === 0) {
      list.innerHTML = `<div class="rv-empty"><span class="rv-empty-icon">&#127760;</span>No posts yet &mdash; start the conversation!</div>`;
    } else {
      list.innerHTML = filtered.map(buildPostCard).join('');
      list.querySelectorAll('.fb-post-card').forEach(card => {
        card.addEventListener('click', () => openPost(card.dataset.pid));
      });
    }
    const count = document.getElementById('postCount');
    if (count) count.textContent = allPosts.length + ' post' + (allPosts.length !== 1 ? 's' : '');
  }

  async function loadPosts(reset) {
    if (reset) { allPosts = []; postCursor = null; }
    try {
      let query = db.collection('social_posts').orderBy('timestamp', 'desc').limit(POSTS_LIMIT);
      if (postCursor) query = query.startAfter(postCursor);
      const snap = await query.get();
      snap.forEach(doc => allPosts.push({ _id: doc.id, ...doc.data() }));
      if (!snap.empty) postCursor = snap.docs[snap.docs.length - 1];
      const loadMore = document.getElementById('postLoadMore');
      if (loadMore) loadMore.style.display = snap.size === POSTS_LIMIT ? '' : 'none';
      renderPostList();
    } catch (err) {
      console.error('Load posts error:', err);
      document.getElementById('postList').innerHTML = '<div class="rv-empty">Failed to load posts.</div>';
    }
  }

  function initTypeChips() {
    const container = document.getElementById('feedTypeFilter');
    if (!container) return;
    container.addEventListener('click', e => {
      const chip = e.target.closest('.forum-chip');
      if (!chip) return;
      activeTypeFilter = chip.dataset.type || '';
      container.querySelectorAll('.forum-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderPostList();
    });
  }

  function initFeedFilters() {
    ['feedSpecFilter', 'feedHospFilter'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', renderPostList);
    });
  }

  // Apply a specialty pre-filter from ?specialty=X (candidate.html cross-link)
  function applyUrlSpecialtyFilter() {
    const params = new URLSearchParams(window.location.search);
    const spec = params.get('specialty');
    if (!spec) return;
    const input = document.getElementById('feedSpecFilter');
    if (input) input.value = spec;
  }

  // ══════════════════════════════════════════════════════
  // NEW POST
  // ══════════════════════════════════════════════════════
  async function submitPost() {
    const authorName = (document.getElementById('postName').value.trim() || 'Anonymous').substring(0, 60);
    const specialty   = document.getElementById('postSpecialty').value.trim().substring(0, 80);
    const hospital    = document.getElementById('postHospital').value.trim().substring(0, 120);
    const title       = document.getElementById('postTitle').value.trim().substring(0, 120);
    const body        = document.getElementById('postBody').value.trim().substring(0, 3000);

    if (!title)           { setStatus('postStatus', 'Please enter a title.', 'error'); return; }
    if (title.length < 5) { setStatus('postStatus', 'Title is too short.', 'error'); return; }
    if (!body)            { setStatus('postStatus', 'Please write some details.', 'error'); return; }
    if (body.length < 10) { setStatus('postStatus', 'Details are too short (min 10 characters).', 'error'); return; }
    if (activePostType === 'review' && selectedStars === 0) {
      setStatus('postStatus', 'Please select a star rating.', 'error'); return;
    }

    const btn = document.getElementById('postSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Posting…';
    setStatus('postStatus', '', '');

    try {
      const email = getSessionEmail() || '';
      const profile = email ? await getUserProfile(email) : null;

      const payload = {
        type: activePostType,
        authorName, authorEmail: email,
        authorSpecialty: (profile && profile.isPublic && profile.specialty) || '',
        authorHospital:  (profile && profile.isPublic && profile.hospital)  || '',
        specialty, hospital, title, body,
        commentCount: 0,
        likeCount: 0,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      };
      if (activePostType === 'review') payload.rating = selectedStars;
      if (activePostType === 'result') payload.program = document.getElementById('postProgram').value || '';
      if (activePostType === 'resource') payload.linkUrl = document.getElementById('postLink').value.trim().substring(0, 300) || '';

      await db.collection('social_posts').add(payload);

      setStatus('postStatus', '✓ Posted!', 'success');
      resetPostForm();
      setTimeout(() => { setStatus('postStatus', '', ''); showView('list'); loadPosts(true); }, 1000);
    } catch (err) {
      console.error('Post submit error:', err);
      setStatus('postStatus', 'Failed to post. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Post';
    }
  }

  function resetPostForm() {
    ['postName', 'postSpecialty', 'postHospital', 'postTitle', 'postBody', 'postLink'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('postProgram').value = '';
    document.getElementById('postTitleCount').textContent = '0';
    document.getElementById('postBodyCount').textContent = '0';
    selectedStars = 0;
    document.querySelectorAll('#postStarRating button').forEach(b => { b.classList.remove('active'); b.innerHTML = '&#9734;'; });
    document.getElementById('postStarLabel').textContent = 'No rating';
  }

  // ══════════════════════════════════════════════════════
  // POST DETAIL + COMMENTS + LIKES
  // ══════════════════════════════════════════════════════

  // Loose keyword match against sim-chat.js's fixed room set
  // (js/sim-chat.js:59-69) — falls back to 'general'. sim-chat.js now reads
  // this via a real ?room= URL param (_applyChatRoomFromURL, js/sim-chat.js)
  // validated against CHAT.ROOMS, so an unrecognized id here just falls
  // through to whatever room the visitor already had selected.
  function chatRoomForSpecialty(specialty) {
    const s = (specialty || '').toLowerCase();
    if (/surg|gynae|ortho/.test(s)) return 'surgery-allied';
    if (/medic|cardio|neuro|derma|psych|pulmo|nephro|onco|paed/.test(s)) return 'medicine-allied';
    return 'general';
  }

  async function openPost(postId) {
    currentPostId = postId;
    currentPost   = allPosts.find(p => p._id === postId) || null;
    likedByMe = false;

    showView('detail');

    const card = document.getElementById('postDetailCard');
    if (currentPost) {
      await renderPostDetailCard(currentPost, card);
    } else {
      const doc = await db.collection('social_posts').doc(postId).get();
      if (doc.exists) {
        currentPost = { _id: doc.id, ...doc.data() };
        await renderPostDetailCard(currentPost, card);
      }
    }

    if (commentsUnsubscribe) { commentsUnsubscribe(); commentsUnsubscribe = null; }
    document.getElementById('postCommentsList').innerHTML = '<div class="rv-loading">Loading comments…</div>';
    commentsUnsubscribe = db.collection('social_posts').doc(postId)
      .collection('comments').orderBy('timestamp', 'asc').limit(COMMENTS_LIMIT)
      .onSnapshot(snap => {
        const comments = [];
        snap.forEach(doc => comments.push({ _id: doc.id, ...doc.data() }));
        renderComments(comments);
      }, err => console.warn('Comments snapshot error:', err));

    document.getElementById('feedPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function renderPostDetailCard(data, container) {
    const type = typeBadge(data.type);
    const dateStr = data.timestamp ? timeAgo(data.timestamp.toDate()) : '';
    const specTag = data.specialty ? `<span class="rv-tag rv-tag-spec">${esc(data.specialty)}</span>` : '';
    const hospTag = data.hospital ? `<span class="rv-tag rv-tag-hosp">&#127968; ${esc(data.hospital)}</span>` : '';
    let extra = '';
    if (data.type === 'review' && data.rating) {
      extra = `<div style="color:var(--neon-gold);margin-bottom:0.5rem;">${'★'.repeat(data.rating)}${'☆'.repeat(5 - data.rating)}</div>`;
    }
    if (data.type === 'result' && data.program) {
      extra = `<span class="rv-tag" style="color:var(--neon-cyan);border-color:rgba(77,184,217,0.3);background:rgba(77,184,217,0.07);">${esc(data.program)}</span>`;
    }
    if (data.type === 'resource' && data.linkUrl) {
      extra = `<a href="${esc(data.linkUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--neon-purple);word-break:break-all;">${esc(data.linkUrl)}</a>`;
    }

    const email = getSessionEmail();
    let likeDoc = null;
    if (email) {
      try { likeDoc = await db.collection('social_posts').doc(data._id).collection('likes').doc(email).get(); } catch (e) {}
    }
    likedByMe = !!(likeDoc && likeDoc.exists);

    const isOwn = email && data.authorEmail && email === data.authorEmail;
    const room = chatRoomForSpecialty(data.specialty);

    const initials = avatarInitials(data.authorName || 'Anonymous');
    container.innerHTML = `
      <div class="fb-post-header" style="margin-bottom:0.9rem;">
        <div class="fb-post-avatar">${esc(initials)}</div>
        <div class="fb-post-header-text">
          <div class="fb-post-author">${esc(data.authorName || 'Anonymous')}</div>
          <div class="fb-post-meta">${type}<span>&middot;</span><span>${dateStr}</span></div>
        </div>
      </div>
      ${(specTag || hospTag) ? `<div class="thread-detail-cat-row">${specTag}${hospTag}</div>` : ''}
      <div class="thread-detail-title">${esc(data.title)}</div>
      ${extra ? `<div style="margin-bottom:0.7rem;">${extra}</div>` : ''}
      <div class="thread-detail-body">${esc(data.body)}</div>
      <div class="thread-detail-footer">
        <button class="cf-like-btn${likedByMe ? ' active' : ''}" id="postLikeBtn">&#10084; <span id="postLikeCount">${data.likeCount || 0}</span></button>
        <a class="cf-chat-link" href="simulation.html?tab=community&room=${esc(room)}" target="_blank" rel="noopener">&#9889; Discuss live in Chat &rarr;</a>
        ${isOwn ? `<button class="cf-delete-btn" id="postDeleteBtn">Delete</button>` : ''}
      </div>`;

    document.getElementById('postLikeBtn')?.addEventListener('click', toggleLike);
    document.getElementById('postDeleteBtn')?.addEventListener('click', deleteCurrentPost);
  }

  async function toggleLike() {
    const email = getSessionEmail();
    if (!email) {
      (window.MN ? MN.toast.warning : alert)('Please log in to like posts.');
      return;
    }
    if (!currentPostId) return;
    const btn = document.getElementById('postLikeBtn');
    const countEl = document.getElementById('postLikeCount');
    const postRef = db.collection('social_posts').doc(currentPostId);
    const likeRef = postRef.collection('likes').doc(email);

    btn.disabled = true;
    try {
      if (likedByMe) {
        await likeRef.delete();
        await postRef.update({ likeCount: firebase.firestore.FieldValue.increment(-1) });
        likedByMe = false;
      } else {
        await likeRef.set({ createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        await postRef.update({ likeCount: firebase.firestore.FieldValue.increment(1) });
        likedByMe = true;
      }
      btn.classList.toggle('active', likedByMe);
      countEl.textContent = Math.max(0, (parseInt(countEl.textContent, 10) || 0) + (likedByMe ? 1 : -1));
    } catch (err) {
      console.error('Like toggle error:', err);
      (window.MN ? MN.toast.danger : alert)('Could not update like. Please try again.');
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteCurrentPost() {
    if (!currentPostId) return;
    const email = getSessionEmail();
    if (!email || !currentPost || currentPost.authorEmail !== email) return;

    const confirmed = window.MN
      ? await MN.dialog.confirm('Delete this post? This cannot be undone.', { title: 'Delete post', danger: true, confirmLabel: 'Delete' })
      : confirm('Delete this post? This cannot be undone.');
    if (!confirmed) return;

    try {
      await db.collection('social_posts').doc(currentPostId).delete();
      (window.MN ? MN.toast.success : alert)('Post deleted.');
      if (commentsUnsubscribe) { commentsUnsubscribe(); commentsUnsubscribe = null; }
      currentPostId = null; currentPost = null;
      showView('list');
      loadPosts(true);
    } catch (err) {
      console.error('Delete post error:', err);
      (window.MN ? MN.toast.danger : alert)('Could not delete post. Please try again.');
    }
  }

  function renderComments(comments) {
    const list = document.getElementById('postCommentsList');
    const label = document.getElementById('postCommentCountLabel');
    if (label) label.textContent = comments.length + ' comment' + (comments.length === 1 ? '' : 's');

    if (comments.length === 0) {
      list.innerHTML = `<div class="rv-empty" style="padding:1rem;"><span style="font-size:1.5rem;display:block;margin-bottom:0.3rem;opacity:0.4;">&#128172;</span>No comments yet &mdash; be the first!</div>`;
      return;
    }
    const email = getSessionEmail();
    list.innerHTML = comments.map(c => {
      const dateStr = c.timestamp ? timeAgo(c.timestamp.toDate()) : '';
      const initials = avatarInitials(c.authorName || 'An');
      const isOwn = email && c.authorEmail && email === c.authorEmail;
      return `
        <div class="comment-card">
          <div class="comment-avatar">${esc(initials)}</div>
          <div class="comment-bubble">
            <div class="comment-bubble-top">
              <span class="comment-author">${esc(c.authorName || 'Anonymous')}</span>
              <span class="comment-time">${dateStr}</span>
            </div>
            <div class="comment-text">${esc(c.body)}</div>
            ${isOwn ? `<button class="cf-delete-btn" style="margin-left:0;margin-top:4px;" data-comment-id="${esc(c._id)}">Delete</button>` : ''}
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-comment-id]').forEach(btn => {
      btn.addEventListener('click', () => deleteComment(btn.dataset.commentId));
    });
  }

  async function deleteComment(commentId) {
    if (!currentPostId) return;
    const confirmed = window.MN
      ? await MN.dialog.confirm('Delete this comment?', { title: 'Delete comment', danger: true, confirmLabel: 'Delete' })
      : confirm('Delete this comment?');
    if (!confirmed) return;

    try {
      const postRef = db.collection('social_posts').doc(currentPostId);
      await postRef.collection('comments').doc(commentId).delete();
      await postRef.update({ commentCount: firebase.firestore.FieldValue.increment(-1) });
    } catch (err) {
      console.error('Delete comment error:', err);
      (window.MN ? MN.toast.danger : alert)('Could not delete comment. Please try again.');
    }
  }

  async function submitComment() {
    if (!currentPostId) return;
    const authorName = (document.getElementById('postCommentName').value.trim() || 'Anonymous').substring(0, 60);
    const body = document.getElementById('postCommentText').value.trim().substring(0, 1500);

    if (!body)           { setStatus('postCommentStatus', 'Please write a comment.', 'error'); return; }
    if (body.length < 3) { setStatus('postCommentStatus', 'Comment is too short.', 'error'); return; }

    const btn = document.getElementById('postCommentSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Posting…';
    setStatus('postCommentStatus', '', '');

    try {
      const postRef = db.collection('social_posts').doc(currentPostId);
      await postRef.collection('comments').add({
        authorName, body,
        authorEmail: getSessionEmail() || '',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await postRef.update({ commentCount: firebase.firestore.FieldValue.increment(1) });
      setStatus('postCommentStatus', '✓ Comment posted!', 'success');
      document.getElementById('postCommentText').value = '';
      document.getElementById('postCommentCharCount').textContent = '0';
      setTimeout(() => setStatus('postCommentStatus', '', ''), 3000);
    } catch (err) {
      console.error('Comment submit error:', err);
      setStatus('postCommentStatus', 'Failed to post. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Post Comment';
    }
  }

  // ══════════════════════════════════════════════════════
  // HUB TAB SWITCHING (Feed / Discussion / Chat)
  // ══════════════════════════════════════════════════════
  let discInitialized = false;
  let chatInitialized = false;

  function cfSwitchTab(tab) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (!btn) return;
    document.querySelectorAll('#mainNav .tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`)?.classList.add('active');

    if (tab === 'discussion' && !discInitialized) {
      discInitialized = true;
      initDiscussionTab();
    }
    if (tab === 'chat' && !chatInitialized) {
      chatInitialized = true;
      initChatTab();
    }
  }

  function initHubTabs() {
    document.querySelectorAll('#mainNav .tab-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => cfSwitchTab(btn.dataset.tab));
    });
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    if (urlTab && document.getElementById(`tab-${urlTab}`)) cfSwitchTab(urlTab);
  }

  // ══════════════════════════════════════════════════════
  // DISCUSSION TAB — ported from reviews.js, same `discussions`
  // collection (reviews.html is untouched and unaffected).
  // ══════════════════════════════════════════════════════
  const THREADS_LIMIT = 25;
  const DISC_COMMENTS_LIMIT = 50;
  const CAT_META = {
    General:    { icon: '💬', label: 'General' },
    Question:   { icon: '❓', label: 'Q&A' },
    Study:      { icon: '📚', label: 'Study' },
    Hospital:   { icon: '🏥', label: 'Hospital' },
    Merit:      { icon: '📋', label: 'Merit' },
    Experience: { icon: '⭐', label: 'Story' },
    Concern:    { icon: '⚠️', label: 'Concern' },
  };
  let allThreads = [];
  let threadCursor = null;
  let activeCatFilter = '';
  let currentThreadId = null;
  let currentThread = null;
  let discCommentsUnsubscribe = null;

  function catBadge(cat) {
    const m = CAT_META[cat] || { icon: '💬', label: cat || 'General' };
    return `<span class="forum-cat forum-cat-${esc(cat || 'General')}">${m.icon} ${esc(m.label)}</span>`;
  }

  function showDiscView(view) {
    document.getElementById('discViewList').style.display   = view === 'list'   ? '' : 'none';
    document.getElementById('discViewNew').style.display    = view === 'new'    ? '' : 'none';
    document.getElementById('discViewDetail').style.display = view === 'detail' ? '' : 'none';
    const title = document.getElementById('discPanelTitle');
    const newBtn = document.getElementById('discNewBtn');
    const countEl = document.getElementById('threadCount');
    if (view === 'list') { title.textContent = 'Discussion'; newBtn.style.display = ''; countEl.style.display = ''; }
    else if (view === 'new') { title.textContent = 'New Thread'; newBtn.style.display = 'none'; countEl.style.display = 'none'; }
    else { title.textContent = 'Thread'; newBtn.style.display = 'none'; countEl.style.display = 'none'; }
  }

  function buildThreadCard(data) {
    const dateStr = data.timestamp ? timeAgo(data.timestamp.toDate()) : '';
    const replies = data.commentCount || 0;
    const cat = catBadge(data.category);
    const specTag = data.specialty ? `<span class="rv-tag rv-tag-spec">${esc(data.specialty)}</span>` : '';
    const snippet = (data.body || '').substring(0, 140);
    return `
      <div class="thread-card" data-tid="${esc(data._id)}">
        <div class="thread-card-top">
          ${cat}
          <span class="thread-card-title">${esc(data.title)}</span>
        </div>
        ${snippet ? `<div class="thread-card-snippet">${esc(snippet)}${data.body && data.body.length > 140 ? '…' : ''}</div>` : ''}
        <div class="thread-card-meta">
          <span class="thread-card-author">${esc(data.name || 'Anonymous')}</span>
          <span class="thread-card-time">&middot; ${dateStr}</span>
          ${specTag}
          <span class="thread-card-stats">&#128172; ${replies} repl${replies === 1 ? 'y' : 'ies'}</span>
        </div>
      </div>`;
  }

  function renderThreadList() {
    const list = document.getElementById('threadList');
    const filtered = activeCatFilter ? allThreads.filter(t => t.category === activeCatFilter) : allThreads;
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
    if (reset) { allThreads = []; threadCursor = null; }
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
    db.collection('discussions').orderBy('timestamp', 'desc').limit(5).onSnapshot(snap => {
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

  async function submitThread() {
    const name = (document.getElementById('threadName').value.trim() || 'Anonymous').substring(0, 60);
    const cat = document.getElementById('threadCategory').value || 'General';
    const specialty = document.getElementById('threadSpecialty').value.trim().substring(0, 80);
    const title = document.getElementById('threadTitle').value.trim().substring(0, 120);
    const body = document.getElementById('threadBody').value.trim().substring(0, 3000);

    if (!title)           { setStatus('threadStatus', 'Please enter a thread title.', 'error'); return; }
    if (title.length < 5) { setStatus('threadStatus', 'Title is too short.', 'error'); return; }
    if (!body)            { setStatus('threadStatus', 'Please write a description.', 'error'); return; }
    if (body.length < 10) { setStatus('threadStatus', 'Description is too short (min 10 characters).', 'error'); return; }

    const btn = document.getElementById('threadSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Posting…';
    setStatus('threadStatus', '', '');

    try {
      await db.collection('discussions').add({
        name, category: cat, year: '', specialty, title, body,
        email: getSessionEmail() || '',
        commentCount: 0,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      });
      setStatus('threadStatus', '✓ Thread posted!', 'success');
      ['threadName', 'threadSpecialty', 'threadTitle', 'threadBody'].forEach(id => { document.getElementById(id).value = ''; });
      document.getElementById('threadCategory').value = 'General';
      document.getElementById('threadTitleCount').textContent = '0';
      document.getElementById('threadBodyCount').textContent = '0';
      setTimeout(() => { setStatus('threadStatus', '', ''); showDiscView('list'); }, 1200);
    } catch (err) {
      console.error('Thread submit error:', err);
      setStatus('threadStatus', 'Failed to post. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Post Thread';
    }
  }

  function openThread(threadId) {
    currentThreadId = threadId;
    currentThread = allThreads.find(t => t._id === threadId) || null;
    showDiscView('detail');

    const card = document.getElementById('threadDetailCard');
    if (currentThread) {
      renderThreadDetailCard(currentThread, card);
    } else {
      db.collection('discussions').doc(threadId).get().then(doc => {
        if (doc.exists) { currentThread = { _id: doc.id, ...doc.data() }; renderThreadDetailCard(currentThread, card); }
      });
    }

    if (discCommentsUnsubscribe) { discCommentsUnsubscribe(); discCommentsUnsubscribe = null; }
    document.getElementById('discCommentsList').innerHTML = '<div class="rv-loading">Loading replies…</div>';
    discCommentsUnsubscribe = db.collection('discussions').doc(threadId)
      .collection('comments').orderBy('timestamp', 'asc').limit(DISC_COMMENTS_LIMIT)
      .onSnapshot(snap => {
        const comments = [];
        snap.forEach(doc => comments.push({ _id: doc.id, ...doc.data() }));
        renderDiscComments(comments);
      }, err => console.warn('Comments snapshot error:', err));

    document.getElementById('discPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderThreadDetailCard(data, container) {
    const cat = catBadge(data.category);
    const dateStr = data.timestamp ? timeAgo(data.timestamp.toDate()) : '';
    const specTag = data.specialty ? `<span class="rv-tag rv-tag-spec">&#127968; ${esc(data.specialty)}</span>` : '';
    container.innerHTML = `
      <div class="thread-detail-cat-row">${cat}${specTag}</div>
      <div class="thread-detail-title">${esc(data.title)}</div>
      <div class="thread-detail-body">${esc(data.body)}</div>
      <div class="thread-detail-footer">
        <span class="thread-detail-author">✍ ${esc(data.name || 'Anonymous')}</span>
        <span>&middot;</span>
        <span>${dateStr}</span>
      </div>`;
  }

  function renderDiscComments(comments) {
    const list = document.getElementById('discCommentsList');
    const label = document.getElementById('discCommentCountLabel');
    if (label) label.textContent = comments.length + ' repl' + (comments.length === 1 ? 'y' : 'ies');
    if (comments.length === 0) {
      list.innerHTML = `<div class="rv-empty" style="padding:1rem;"><span style="font-size:1.5rem;display:block;margin-bottom:0.3rem;opacity:0.4;">&#128172;</span>No replies yet &mdash; be the first!</div>`;
      return;
    }
    list.innerHTML = comments.map(c => {
      const dateStr = c.timestamp ? timeAgo(c.timestamp.toDate()) : '';
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

  async function submitDiscComment() {
    if (!currentThreadId) return;
    const name = (document.getElementById('discCommentName').value.trim() || 'Anonymous').substring(0, 60);
    const text = document.getElementById('discCommentText').value.trim().substring(0, 1500);
    if (!text)           { setStatus('discCommentStatus', 'Please write a reply.', 'error'); return; }
    if (text.length < 3) { setStatus('discCommentStatus', 'Reply is too short.', 'error'); return; }

    const btn = document.getElementById('discCommentSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Posting…';
    setStatus('discCommentStatus', '', '');

    try {
      const threadRef = db.collection('discussions').doc(currentThreadId);
      await threadRef.collection('comments').add({
        name, text,
        email: getSessionEmail() || '',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await threadRef.update({ commentCount: firebase.firestore.FieldValue.increment(1) });
      setStatus('discCommentStatus', '✓ Reply posted!', 'success');
      document.getElementById('discCommentText').value = '';
      document.getElementById('discCommentCharCount').textContent = '0';
      setTimeout(() => setStatus('discCommentStatus', '', ''), 3000);
    } catch (err) {
      console.error('Comment submit error:', err);
      setStatus('discCommentStatus', 'Failed to post. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Post Reply';
    }
  }

  function initCategoryChips() {
    const container = document.getElementById('discCategoryFilter');
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

  function initDiscussionTab() {
    initCategoryChips();
    loadThreads(true);
    subscribeThreads();

    document.getElementById('discNewBtn')?.addEventListener('click', () => showDiscView('new'));
    document.getElementById('discBackFromNew')?.addEventListener('click', () => showDiscView('list'));
    document.getElementById('discBackFromDetail')?.addEventListener('click', () => {
      if (discCommentsUnsubscribe) { discCommentsUnsubscribe(); discCommentsUnsubscribe = null; }
      currentThreadId = null; currentThread = null;
      showDiscView('list');
      loadThreads(true);
    });
    document.getElementById('threadLoadMore')?.addEventListener('click', () => loadThreads(false));
    document.getElementById('threadSubmitBtn')?.addEventListener('click', submitThread);
    document.getElementById('discCommentSubmitBtn')?.addEventListener('click', submitDiscComment);

    const sessionEmail = getSessionEmail();
    if (sessionEmail) {
      getUserProfile(sessionEmail).then(profile => {
        if (profile && profile.name) {
          const n1 = document.getElementById('threadName');
          if (n1 && !n1.value) n1.value = profile.name;
          const n2 = document.getElementById('discCommentName');
          if (n2 && !n2.value) n2.value = profile.name;
        }
      });
    }
  }

  // ══════════════════════════════════════════════════════
  // CHAT TAB — toned-down single-room embed of the SAME sim21_chat
  // collection simulation.html's full Chat uses (general room only).
  // Reuses the same localStorage identity keys sim-chat.js uses
  // (_chat_uid/_chat_name) so "who you are" is consistent between both.
  // ══════════════════════════════════════════════════════
  const CHAT_COLLECTION = 'sim21_chat';
  const CHAT_ROOM_ID = 'general';
  const CHAT_MESSAGES_LIMIT = 60;
  let chatUnsubscribe = null;

  function chatUID() {
    let uid = localStorage.getItem('_chat_uid');
    if (!uid) {
      uid = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem('_chat_uid', uid);
    }
    return uid;
  }

  function chatName() {
    return localStorage.getItem('_chat_name') || null;
  }

  function promptChatName() {
    const entered = window.prompt('Enter your display name for community chat:', chatName() || '');
    if (!entered || !entered.trim()) return null;
    const cleaned = entered.trim().slice(0, 40);
    localStorage.setItem('_chat_name', cleaned);
    return cleaned;
  }

  function renderChatMessages(messages) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const myUid = chatUID();
    if (!messages.length) {
      container.innerHTML = `<div class="rv-empty" style="padding:1rem;">No messages yet &mdash; say hello!</div>`;
      return;
    }
    const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 40;
    container.innerHTML = messages.map(m => {
      const isOwn = m.uid === myUid;
      const dateStr = m.ts ? timeAgo(m.ts.toDate()) : '';
      const initials = avatarInitials(m.name || 'An');
      return `
        <div class="chat-msg${isOwn ? ' chat-msg-own' : ''}">
          <div class="chat-msg-avatar">${esc(initials)}</div>
          <div class="chat-msg-bubble">
            ${!isOwn ? `<div class="chat-msg-name">${esc(m.name || 'Anonymous')}</div>` : ''}
            <div class="chat-msg-text">${esc(m.text || '')}</div>
            <div class="chat-msg-time">${dateStr}</div>
          </div>
        </div>`;
    }).join('');
    if (wasAtBottom) container.scrollTop = container.scrollHeight;
  }

  function loadChatMessages() {
    if (chatUnsubscribe) return;
    // Mirrors sim-chat.js's query shape (orderBy('ts') + limitToLast, no
    // `where` clause) so this doesn't need a new composite index — a
    // roomId-equality + ts-orderBy query would require one that doesn't
    // exist yet. Filter to the general room client-side instead, same as
    // sim-chat.js does per-room.
    chatUnsubscribe = db.collection(CHAT_COLLECTION)
      .orderBy('ts', 'asc').limitToLast(CHAT_MESSAGES_LIMIT)
      .onSnapshot(snap => {
        const messages = [];
        snap.forEach(doc => {
          const data = doc.data();
          if ((data.roomId || 'general') === CHAT_ROOM_ID) messages.push(data);
        });
        renderChatMessages(messages);
      }, err => {
        console.warn('Chat snapshot error:', err);
        const container = document.getElementById('chatMessages');
        if (container) container.innerHTML = '<div class="rv-empty">Could not load messages.</div>';
      });
  }

  async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim().substring(0, 1000);
    if (!text) return;

    if (!chatName() && !promptChatName()) return;

    const btn = document.getElementById('chatSendBtn');
    btn.disabled = true;
    try {
      await db.collection(CHAT_COLLECTION).add({
        text,
        name: chatName(),
        uid: chatUID(),
        email: getSessionEmail() || '',
        roomId: CHAT_ROOM_ID,
        roomLabel: 'General',
        type: 'text',
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      input.value = '';
    } catch (err) {
      console.error('Send chat message error:', err);
      (window.MN ? MN.toast.danger : alert)('Could not send message. Please try again.');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  function initChatTab() {
    loadChatMessages();
    document.getElementById('chatSendBtn')?.addEventListener('click', sendChatMessage);
    document.getElementById('chatInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });

    if (!chatName()) {
      const sessionEmail = getSessionEmail();
      if (sessionEmail) {
        getUserProfile(sessionEmail).then(profile => {
          if (profile && profile.name && !chatName()) {
            localStorage.setItem('_chat_name', profile.name.trim().slice(0, 40));
          }
        });
      }
    }
  }

  // ── Bootstrap ────────────────────────────────────────
  function init() {
    if (!window.firebase || !firebase.firestore) { setTimeout(init, 100); return; }
    db = firebase.firestore();

    loadDataLists();
    initCharCounters();
    initTypePicker();
    initStarRating();
    initTypeChips();
    initFeedFilters();
    applyUrlSpecialtyFilter();

    const sessionEmail = getSessionEmail();
    if (sessionEmail) {
      getUserProfile(sessionEmail).then(profile => {
        if (profile && profile.name) {
          const nameField = document.getElementById('postName');
          if (nameField && !nameField.value) nameField.value = profile.name;
          const cNameField = document.getElementById('postCommentName');
          if (cNameField && !cNameField.value) cNameField.value = profile.name;
        }
      });
    }

    loadPosts(true);
    renderPostList();

    document.getElementById('feedNewBtn')?.addEventListener('click', () => showView('new'));
    document.getElementById('feedBackFromNew')?.addEventListener('click', () => showView('list'));
    document.getElementById('feedBackFromDetail')?.addEventListener('click', () => {
      if (commentsUnsubscribe) { commentsUnsubscribe(); commentsUnsubscribe = null; }
      currentPostId = null; currentPost = null;
      showView('list');
      loadPosts(true);
    });
    document.getElementById('postLoadMore')?.addEventListener('click', () => loadPosts(false));
    document.getElementById('postSubmitBtn')?.addEventListener('click', submitPost);
    document.getElementById('postCommentSubmitBtn')?.addEventListener('click', submitComment);

    initHubTabs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
