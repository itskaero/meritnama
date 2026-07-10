'use strict';
// ═══════════════════════════════════════════════════════════════════
// EDITORIAL MODULE — Reading page logic
// Firestore-backed articles, comments, votes
// ═══════════════════════════════════════════════════════════════════

const ED = {
  db: null,
  articles: [],
  currentSlug: null,
  currentArticle: null,
  unsubscribeComments: null,
  votesCache: {},
  activeCategory: 'all',
  COLLECTION_ARTICLES: 'editorial_articles',
  COLLECTION_COMMENTS: 'editorial_comments',
  COLLECTION_VOTES: 'editorial_votes',
};

// ── Helpers ──────────────────────────────────────────────────────
function edEsc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function edTimeAgo(ts) {
  if (!ts) return '';
  const now = Date.now();
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  const months = Math.floor(days / 30);
  if (months < 12) return months + 'mo ago';
  return Math.floor(months / 12) + 'y ago';
}

function edFormatDate(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function edReadingTime(text) {
  if (!text) return 1;
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

function edEstimateReadingTime(markdown) {
  if (!markdown) return 1;
  // Strip markdown syntax for word count
  const plain = markdown.replace(/[#*`_\[\]()>~|-]/g, ' ').replace(/\s+/g, ' ');
  return edReadingTime(plain);
}

function edToast(msg, type) {
  const el = document.getElementById('edToast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'ed-toast ' + (type || '');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function getSessionEmail() {
  try {
    const raw = localStorage.getItem('meritnama_auth_session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    return (s && typeof s.email === 'string') ? s.email : null;
  } catch (e) { return null; }
}

function isAdminEmail(email) {
  return false; // resolved async via resolveAdminStatus()
}

async function resolveAdminStatus() {
  const email = getSessionEmail();
  if (!email) { isAdminEmail = () => false; return; }
  try {
    const doc = await ED.db.collection('authorized_users').doc(email).get();
    const admin = doc.exists && (doc.data().admin === true || doc.data().isAdmin === true);
    isAdminEmail = () => admin;
  } catch (e) {
    isAdminEmail = () => false;
  }
}

// ── Init ─────────────────────────────────────────────────────────
function edInit() {
  ED.db = firebase.firestore();
  setupHamburger();
  setupAiPanel();
  resolveAdminStatus();
  loadArticles();
  setupFilters();
  handleHashNavigation();

  window.addEventListener('hashchange', handleHashNavigation);
}

function setupHamburger() {
  const btn = document.getElementById('hamburgerBtn');
  const nav = document.getElementById('mainNav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && !btn.contains(e.target)) {
      nav.classList.remove('nav-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

// ── Hash routing ─────────────────────────────────────────────────
function handleHashNavigation() {
  const hash = window.location.hash.replace('#', '');
  if (hash) {
    showArticle(hash);
  } else {
    showListing();
  }
}

// ── Load articles ────────────────────────────────────────────────
async function loadArticles() {
  try {
    const snap = await ED.db.collection(ED.COLLECTION_ARTICLES)
      .where('status', '==', 'published')
      .get();

    ED.articles = [];
    const cats = new Set();
    snap.forEach(doc => {
      const data = doc.data();
      data.id = doc.id;
      ED.articles.push(data);
      if (data.category) cats.add(data.category);
    });
    ED.articles.sort((a, b) => {
      const ta = a.publishedAt ? (a.publishedAt.toMillis ? a.publishedAt.toMillis() : new Date(a.publishedAt).getTime()) : 0;
      const tb = b.publishedAt ? (b.publishedAt.toMillis ? b.publishedAt.toMillis() : new Date(b.publishedAt).getTime()) : 0;
      return tb - ta;
    });

    renderFilters(cats);
    renderGrid();
  } catch (err) {
    console.error('Failed to load articles:', err);
    document.getElementById('edGrid').innerHTML =
      '<div class="ed-empty"><span class="ed-empty-icon">&#128196;</span>Failed to load articles.</div>';
  }
}

// ── Render category filters ──────────────────────────────────────
function renderFilters(categories) {
  const el = document.getElementById('edFilters');
  if (!el) return;

  const cats = Array.from(categories).sort();
  const labels = {
    analysis: 'Analysis', policy: 'Policy', trend: 'Trend',
    comparison: 'Comparison', opinion: 'Opinion', guide: 'Guide', data: 'Data'
  };

  el.innerHTML = '<button class="ed-chip active" data-cat="all">All</button>';
  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'ed-chip';
    btn.dataset.cat = cat;
    btn.textContent = labels[cat] || cat;
    el.appendChild(btn);
  });

  setupFilters();
}

function setupFilters() {
  const el = document.getElementById('edFilters');
  if (!el) return;
  el.querySelectorAll('.ed-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      el.querySelectorAll('.ed-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      ED.activeCategory = chip.dataset.cat;
      renderGrid();
    });
  });
}

// ── Render article grid ──────────────────────────────────────────
function renderGrid() {
  const el = document.getElementById('edGrid');
  if (!el) return;

  const filtered = ED.activeCategory === 'all'
    ? ED.articles
    : ED.articles.filter(a => a.category === ED.activeCategory);

  if (filtered.length === 0) {
    el.innerHTML = '<div class="ed-empty"><span class="ed-empty-icon">&#128214;</span>No articles yet.</div>';
    return;
  }

  el.innerHTML = filtered.map(article => {
    const tagClass = 'ed-tag-' + (article.category || 'analysis');
    const tagLabel = (article.category || 'analysis').charAt(0).toUpperCase() +
                     (article.category || 'analysis').slice(1);
    const coverHtml = article.coverImage
      ? `<img class="ed-card-cover" src="${edEsc(article.coverImage)}" alt="${edEsc(article.title)}" loading="lazy" />`
      : '';
    const readTime = article.readingTime || edEstimateReadingTime(article.content) || 1;

    return `
      <article class="ed-card" data-slug="${edEsc(article.slug)}" onclick="window.location.hash='${edEsc(article.slug)}'">
        ${coverHtml}
        <div class="ed-card-body">
          <span class="ed-card-tag ${tagClass}">${edEsc(tagLabel)}</span>
          <h3 class="ed-card-title">${edEsc(article.title)}</h3>
          <p class="ed-card-excerpt">${edEsc(article.excerpt || '')}</p>
          <div class="ed-card-meta">
            <span class="ed-card-author">${edEsc(article.authorName || 'MeritNama')}</span>
            <span class="ed-card-dot">&middot;</span>
            <span>${readTime} min read</span>
            <span class="ed-card-dot">&middot;</span>
            <span>${edFormatDate(article.publishedAt)}</span>
          </div>
        </div>
      </article>`;
  }).join('');
}

// ── Show article detail ──────────────────────────────────────────
function showArticle(slug) {
  const article = ED.articles.find(a => a.slug === slug);
  if (!article) {
    // Try loading from Firestore directly (deep link)
    loadArticleBySlug(slug);
    return;
  }
  renderArticle(article);
}

async function loadArticleBySlug(slug) {
  try {
    const snap = await ED.db.collection(ED.COLLECTION_ARTICLES)
      .where('slug', '==', slug)
      .where('status', '==', 'published')
      .limit(1)
      .get();

    if (snap.empty) {
      showListing();
      edToast('Article not found.', 'error');
      return;
    }
    const doc = snap.docs[0];
    const data = doc.data();
    data.id = doc.id;
    renderArticle(data);
  } catch (err) {
    console.error('Failed to load article:', err);
    showListing();
    edToast('Failed to load article.', 'error');
  }
}

function renderArticle(article) {
  ED.currentSlug = article.slug;
  ED.currentArticle = article;

  const listView = document.getElementById('edListView');
  const detailView = document.getElementById('edDetailView');
  const articleEl = document.getElementById('edArticle');

  listView.style.display = 'none';
  detailView.style.display = 'block';

  const tagClass = 'ed-tag-' + (article.category || 'analysis');
  const tagLabel = (article.category || 'article').charAt(0).toUpperCase() +
                   (article.category || 'article').slice(1);
  const readTime = article.readingTime || edEstimateReadingTime(article.content) || 1;
  const coverHtml = article.coverImage
    ? `<img class="ed-article-cover" src="${edEsc(article.coverImage)}" alt="${edEsc(article.title)}" />`
    : '';

  // Render markdown
  let mdContent = '';
  try {
    mdContent = typeof marked !== 'undefined'
      ? marked.parse(article.content || '')
      : (article.content || '').replace(/\n/g, '<br>');
  } catch (e) {
    mdContent = (article.content || '').replace(/\n/g, '<br>');
  }

  // Tags
  const tagsHtml = (article.tags && article.tags.length)
    ? `<div class="ed-article-tags">${article.tags.map(t =>
        `<span class="ed-article-tag-pill">#${edEsc(t)}</span>`).join('')}</div>`
    : '';

  // Related articles
  let relatedHtml = '';
  if (article.relatedSlugs && article.relatedSlugs.length) {
    const related = article.relatedSlugs
      .map(s => ED.articles.find(a => a.slug === s))
      .filter(Boolean)
      .slice(0, 3);
    if (related.length) {
      relatedHtml = `
        <div class="ed-related">
          <h3>Related Articles</h3>
          <div class="ed-related-grid">
            ${related.map(r => `
              <div class="ed-related-card" onclick="window.location.hash='${edEsc(r.slug)}'">
                <h4>${edEsc(r.title)}</h4>
                <p>${edEsc(r.excerpt || '')}</p>
              </div>`).join('')}
          </div>
        </div>`;
    }
  }

  // Author initial
  const authorInitial = (article.authorName || 'M').charAt(0).toUpperCase();

  articleEl.innerHTML = `
    <button class="ed-back-btn" onclick="window.location.hash='';showListing()">&#8592; Back</button>
    ${coverHtml}
    <span class="ed-article-tag ${tagClass}">${edEsc(tagLabel)}</span>
    <h1>${edEsc(article.title)}</h1>
    ${article.subtitle ? `<p class="ed-article-subtitle">${edEsc(article.subtitle)}</p>` : ''}
    <div class="ed-article-byline">
      <div class="ed-byline-avatar">${edEsc(authorInitial)}</div>
      <div class="ed-byline-info">
        <div class="ed-byline-name">${edEsc(article.authorName || 'MeritNama')}</div>
        <div class="ed-byline-detail">${edFormatDate(article.publishedAt)} &middot; ${readTime} min read</div>
      </div>
    </div>
    <div class="ed-md" id="edArticleContent">${mdContent}</div>
    ${tagsHtml}
    <div class="ed-actions">
      <button class="ed-action-btn" id="edVoteBtn" onclick="edToggleVote()">
        &#9825; <span id="edVoteCount">0</span>
      </button>
      <button class="ed-action-btn" onclick="edShare()">&#128279; Share</button>
      <button class="ed-action-btn" onclick="window.print()">&#128424; Print</button>
      <span class="ed-action-spacer"></span>
      ${isAdminEmail(getSessionEmail()) ? `<a href="editorial-admin.html#edit=${edEsc(article.slug)}" class="ed-action-btn" style="text-decoration:none;">&#9998; Edit</a>` : ''}
    </div>
    ${relatedHtml}
    <div class="ed-comments" id="edComments">
      <h3>Discussion <span class="ed-comment-count" id="edCommentCount">0</span></h3>
      <div class="ed-comment-form" id="edCommentFormWrap">
        <textarea id="edCommentInput" placeholder="Share your thoughts&hellip;" rows="3"></textarea>
        <div class="ed-comment-form-actions">
          <span class="ed-comment-form-hint">Be respectful. Markdown supported.</span>
          <button class="ed-comment-submit" id="edCommentSubmit" onclick="edSubmitComment()">Post Comment</button>
        </div>
      </div>
      <div id="edCommentList"></div>
    </div>`;

  // Update SEO
  document.title = (article.title || 'Article') + ' — MeritNama Editorial';
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && article.excerpt) metaDesc.setAttribute('content', article.excerpt);

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Load votes and comments
  edLoadVotes(article.id);
  edSubscribeComments(article.id);
}

// ── Show listing ─────────────────────────────────────────────────
function showListing() {
  ED.currentSlug = null;
  ED.currentArticle = null;
  if (ED.unsubscribeComments) { ED.unsubscribeComments(); ED.unsubscribeComments = null; }

  document.getElementById('edListView').style.display = 'block';
  document.getElementById('edDetailView').style.display = 'none';
  document.title = 'Editorial — MeritNama';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Votes ────────────────────────────────────────────────────────
async function edLoadVotes(articleId) {
  try {
    const snap = await ED.db.collection(ED.COLLECTION_VOTES)
      .where('articleId', '==', articleId)
      .get();
    let count = 0;
    snap.forEach(() => count++);
    const el = document.getElementById('edVoteCount');
    if (el) el.textContent = count;

    // Check if current user voted
    const email = getSessionEmail();
    if (email) {
      const userVote = await ED.db.collection(ED.COLLECTION_VOTES)
        .where('articleId', '==', articleId)
        .where('email', '==', email)
        .limit(1)
        .get();
      if (!userVote.empty) {
        const btn = document.getElementById('edVoteBtn');
        if (btn) btn.classList.add('voted');
      }
    }
  } catch (err) {
    console.error('Vote load error:', err);
  }
}

async function edToggleVote() {
  const email = getSessionEmail();
  if (!email) { edToast('Sign in to vote.', 'error'); return; }
  if (!ED.currentArticle) return;

  const btn = document.getElementById('edVoteBtn');
  const isVoted = btn.classList.contains('voted');

  try {
    if (isVoted) {
      // Remove vote
      const snap = await ED.db.collection(ED.COLLECTION_VOTES)
        .where('articleId', '==', ED.currentArticle.id)
        .where('email', '==', email)
        .limit(1)
        .get();
      snap.forEach(doc => doc.ref.delete());
      btn.classList.remove('voted');
    } else {
      // Add vote
      await ED.db.collection(ED.COLLECTION_VOTES).add({
        articleId: ED.currentArticle.id,
        email: email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      btn.classList.add('voted');
    }
    edLoadVotes(ED.currentArticle.id);
  } catch (err) {
    console.error('Vote error:', err);
    edToast('Failed to update vote.', 'error');
  }
}

// ── Share ────────────────────────────────────────────────────────
function edShare() {
  const url = window.location.href;
  if (navigator.share) {
    navigator.share({ title: ED.currentArticle?.title, url: url });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url);
    edToast('Link copied to clipboard!', 'success');
  }
}

// ── Comments ─────────────────────────────────────────────────────
function edSubscribeComments(articleId) {
  if (ED.unsubscribeComments) ED.unsubscribeComments();

  ED.unsubscribeComments = ED.db.collection(ED.COLLECTION_COMMENTS)
    .where('articleId', '==', articleId)
    .orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      const comments = [];
      snap.forEach(doc => {
        const data = doc.data();
        data.id = doc.id;
        comments.push(data);
      });
      edRenderComments(comments);
    }, err => {
      console.error('Comments snapshot error:', err);
    });
}

function edRenderComments(comments) {
  const el = document.getElementById('edCommentList');
  const countEl = document.getElementById('edCommentCount');
  if (!el) return;

  // Filter to top-level only (no parentId)
  const topLevel = comments.filter(c => !c.parentId);
  const replies = comments.filter(c => c.parentId);
  const replyMap = {};
  replies.forEach(r => {
    if (!replyMap[r.parentId]) replyMap[r.parentId] = [];
    replyMap[r.parentId].push(r);
  });

  if (countEl) countEl.textContent = comments.length;

  if (topLevel.length === 0) {
    el.innerHTML = '<div class="ed-empty" style="padding:1.5rem;"><span class="ed-empty-icon">&#128172;</span>No comments yet. Be the first!</div>';
    return;
  }

  el.innerHTML = topLevel.map(c => edCommentHtml(c, replyMap)).join('');
}

function edCommentHtml(comment, replyMap) {
  const email = getSessionEmail();
  const isAdmin = isAdminEmail(email);
  const isAuthor = email && comment.email === email;
  const replies = (replyMap[comment.id] || []);
  const authorInitial = (comment.authorName || 'A').charAt(0).toUpperCase();

  let badgeHtml = '';
  if (comment.isAdmin) badgeHtml = '<span class="ed-comment-badge ed-badge-admin">Admin</span>';
  else if (comment.isVerified) badgeHtml = '<span class="ed-comment-badge ed-badge-verified">Verified</span>';

  const actionBtns = [];
  if (email) {
    actionBtns.push(`<button class="ed-comment-action" onclick="edStartReply('${comment.id}')">&#8618; Reply</button>`);
    actionBtns.push(`<button class="ed-comment-action" onclick="edVoteComment('${comment.id}', this)">&#9825; ${comment.votes || 0}</button>`);
  }
  if (isAuthor || isAdmin) {
    actionBtns.push(`<button class="ed-comment-action" onclick="edDeleteComment('${comment.id}')">&#128465;</button>`);
  }

  const repliesHtml = replies.length > 0
    ? `<div class="ed-replies">${replies.map(r => edCommentHtml(r, replyMap)).join('')}</div>`
    : '';

  return `
    <div class="ed-comment" data-id="${edEsc(comment.id)}">
      <div class="ed-comment-head">
        <span class="ed-comment-author">${edEsc(comment.authorName || 'Anonymous')}</span>
        ${badgeHtml}
        <span class="ed-comment-time">${edTimeAgo(comment.createdAt)}</span>
      </div>
      <div class="ed-comment-text">${edEsc(comment.text || '')}</div>
      <div class="ed-comment-actions">${actionBtns.join('')}</div>
      <div class="ed-reply-form-slot" data-parent="${edEsc(comment.id)}"></div>
      ${repliesHtml}
    </div>`;
}

async function edSubmitComment() {
  const email = getSessionEmail();
  if (!email) { edToast('Sign in to comment.', 'error'); return; }
  if (!ED.currentArticle) return;

  const input = document.getElementById('edCommentInput');
  const text = (input?.value || '').trim();
  if (!text) { edToast('Please write a comment.', 'error'); return; }
  if (text.length > 2000) { edToast('Comment too long (max 2000 chars).', 'error'); return; }

  const btn = document.getElementById('edCommentSubmit');
  btn.disabled = true;

  try {
    // Resolve admin status
    let isAdmin = false;
    try {
      const userDoc = await ED.db.collection('authorized_users').doc(email).get();
      isAdmin = userDoc.exists && (userDoc.data().admin === true || userDoc.data().isAdmin === true);
    } catch (e) {}

    await ED.db.collection(ED.COLLECTION_COMMENTS).add({
      articleId: ED.currentArticle.id,
      email: email,
      authorName: email.split('@')[0],
      text: text,
      isAdmin: isAdmin,
      isVerified: false,
      votes: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    input.value = '';
  } catch (err) {
    console.error('Comment error:', err);
    edToast('Failed to post comment.', 'error');
  } finally {
    btn.disabled = false;
  }
}

function edStartReply(parentId) {
  const slot = document.querySelector(`.ed-reply-form-slot[data-parent="${parentId}"]`);
  if (!slot || slot.innerHTML) return;

  slot.innerHTML = `
    <div class="ed-reply-form">
      <textarea class="ed-reply-text" placeholder="Write a reply&hellip;" rows="2"></textarea>
      <div class="ed-reply-form-actions">
        <button class="ed-reply-cancel" onclick="this.closest('.ed-reply-form').remove()">Cancel</button>
        <button class="ed-reply-submit" onclick="edSubmitReply('${parentId}', this)">Reply</button>
      </div>
    </div>`;
  slot.querySelector('.ed-reply-text').focus();
}

async function edSubmitReply(parentId, btn) {
  const email = getSessionEmail();
  if (!email || !ED.currentArticle) return;

  const form = btn.closest('.ed-reply-form');
  const text = (form.querySelector('.ed-reply-text')?.value || '').trim();
  if (!text) return;

  btn.disabled = true;
  try {
    let isAdmin = false;
    try {
      const userDoc = await ED.db.collection('authorized_users').doc(email).get();
      isAdmin = userDoc.exists && (userDoc.data().admin === true || userDoc.data().isAdmin === true);
    } catch (e) {}

    await ED.db.collection(ED.COLLECTION_COMMENTS).add({
      articleId: ED.currentArticle.id,
      parentId: parentId,
      email: email,
      authorName: email.split('@')[0],
      text: text,
      isAdmin: isAdmin,
      isVerified: false,
      votes: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    form.remove();
  } catch (err) {
    console.error('Reply error:', err);
    edToast('Failed to post reply.', 'error');
    btn.disabled = false;
  }
}

async function edVoteComment(commentId, btn) {
  const email = getSessionEmail();
  if (!email) return;

  try {
    const ref = ED.db.collection(ED.COLLECTION_COMMENTS).doc(commentId);
    const doc = await ref.get();
    if (doc.exists) {
      const current = doc.data().votes || 0;
      await ref.update({ votes: current + 1 });
      btn.innerHTML = '&#9825; ' + (current + 1);
      btn.classList.add('voted');
    }
  } catch (err) {
    console.error('Vote comment error:', err);
  }
}

async function edDeleteComment(commentId) {
  if (!confirm('Delete this comment?')) return;
  try {
    await ED.db.collection(ED.COLLECTION_COMMENTS).doc(commentId).delete();
    edToast('Comment deleted.', 'success');
  } catch (err) {
    console.error('Delete comment error:', err);
    edToast('Failed to delete.', 'error');
  }
}

// ── AI Panel ─────────────────────────────────────────────────────
function setupAiPanel() {
  const fab = document.getElementById('edAiFab');
  const panel = document.getElementById('edAiPanel');
  const close = document.getElementById('edAiClose');
  const sendBtn = document.getElementById('edAiSend');
  const input = document.getElementById('edAiInput');

  if (fab && panel) {
    fab.addEventListener('click', () => panel.classList.toggle('open'));
  }
  if (close && panel) {
    close.addEventListener('click', () => panel.classList.remove('open'));
  }
  if (sendBtn && input) {
    const send = () => {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      const body = document.getElementById('edAiBody');
      if (body) {
        body.innerHTML += `<p style="margin:0.5rem 0;"><strong style="color:var(--neon-cyan);">You:</strong> ${edEsc(q)}</p>`;
        body.innerHTML += `<p style="margin:0.5rem 0;color:var(--text-muted);font-style:italic;">AI responses coming soon. This feature is under development.</p>`;
        body.scrollTop = body.scrollHeight;
      }
    };
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }
}

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  function waitForFirebase(cb) {
    if (window.firebase && firebase.firestore) return cb();
    var iv = setInterval(function () {
      if (window.firebase && firebase.firestore) { clearInterval(iv); cb(); }
    }, 100);
  }
  waitForFirebase(edInit);
});
