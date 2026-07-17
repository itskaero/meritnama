'use strict';
// ═══════════════════════════════════════════════════════════════════
// EDITORIAL ADMIN — Article CRUD, markdown editor, image upload
// ═══════════════════════════════════════════════════════════════════

const edAdmin = {
  db: null,
  storage: null,
  articles: [],
  currentId: null,
  currentSlug: null,
  autosaveTimer: null,
  coverFile: null,
  coverUrl: null,
  COLLECTION: 'editorial_articles',
  STORAGE_PATH: 'editorial/covers',
};

// ── Helpers ──────────────────────────────────────────────────────
function edaEsc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function edaToast(msg, type) {
  const el = document.getElementById('edToast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'ed-toast ' + (type || '');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function edaFormatDate(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function getSessionEmail() {
  try {
    const raw = localStorage.getItem('meritnama_auth_session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    return (s && typeof s.email === 'string') ? s.email : null;
  } catch (e) { return null; }
}

async function isAdminUser() {
  const email = getSessionEmail();
  if (!email) { console.log('[ed-admin] No session email'); return false; }
  try {
    const doc = await firebase.firestore().collection('authorized_users').doc(email).get();
    if (!doc.exists) { console.log('[ed-admin] No authorized_users doc for', email); return false; }
    const data = doc.data();
    const admin = data.admin === true || data.isAdmin === true;
    console.log('[ed-admin] admin check:', email, '→', admin, 'admin:', data.admin, 'isAdmin:', data.isAdmin);
    return admin;
  } catch (e) { console.error('[ed-admin] Firestore error:', e); return false; }
}

// ── Slug generation ──────────────────────────────────────────────
function edaSlugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 120);
}

// ── Init ─────────────────────────────────────────────────────────
async function edaInit() {
  edAdmin.db = firebase.firestore();
  edAdmin.storage = firebase.storage();

  // When embedded as a tab inside admin.html, that page has already
  // verified the visitor via its own admin session before this markup is
  // even reachable — skip the redundant (and differently-sourced) check
  // below. Standalone editorial-admin.html still gates normally.
  if (!window.__MN_ADMIN_EMBEDDED__ && !(await isAdminUser())) {
    document.getElementById('edAdminMain').innerHTML =
      '<div class="ed-empty"><span class="ed-empty-icon">&#128274;</span>Admin access required.<br><a href="editorial.html" style="color:var(--neon-cyan);">Back to Editorial</a></div>';
    return;
  }

  setupHamburger();
  setupCoverUpload();
  setupAutosave();
  setupLivePreview();
  setupSlugAuto();
  loadAllArticles();

  // Handle hash navigation for editing
  handleHashNav();
  window.addEventListener('hashchange', handleHashNav);
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

function handleHashNav() {
  const hash = window.location.hash;
  if (hash.startsWith('#edit=')) {
    const slug = hash.replace('#edit=', '');
    editBySlug(slug);
  }
}

// ── Load all articles ────────────────────────────────────────────
async function loadAllArticles() {
  try {
    const snap = await edAdmin.db.collection(edAdmin.COLLECTION)
      .orderBy('updatedAt', 'desc')
      .get();

    edAdmin.articles = [];
    snap.forEach(doc => {
      const data = doc.data();
      data.id = doc.id;
      edAdmin.articles.push(data);
    });

    document.getElementById('edAdminCount').textContent = edAdmin.articles.length;
    renderArticleList();
  } catch (err) {
    console.error('Failed to load articles:', err);
    document.getElementById('edAdminList').innerHTML =
      '<div class="ed-empty">Failed to load articles.</div>';
  }
}

function renderArticleList() {
  const el = document.getElementById('edAdminList');
  if (!el) return;

  if (edAdmin.articles.length === 0) {
    el.innerHTML = '<div class="ed-empty"><span class="ed-empty-icon">&#128196;</span>No articles yet.<br>Create your first article!</div>';
    return;
  }

  el.innerHTML = edAdmin.articles.map(a => {
    const statusClass = 'ed-status-' + (a.status || 'draft');
    const statusLabel = (a.status || 'draft').charAt(0).toUpperCase() + (a.status || 'draft').slice(1);
    return `
      <div class="ed-admin-list-item" onclick="edAdmin.edit('${edaEsc(a.id)}')">
        <span class="ed-admin-list-title">${edaEsc(a.title || 'Untitled')}</span>
        <span class="ed-admin-list-status ${statusClass}">${statusLabel}</span>
        <span class="ed-admin-list-date">${edaFormatDate(a.updatedAt)}</span>
      </div>`;
  }).join('');
}

// ── New article ──────────────────────────────────────────────────
function edaNewArticle() {
  edAdmin.currentId = null;
  edAdmin.currentSlug = null;
  edAdmin.coverFile = null;
  edAdmin.coverUrl = null;

  document.getElementById('edAdminListView').style.display = 'none';
  document.getElementById('edAdminEditorView').style.display = 'block';
  document.getElementById('edEditorTitle').textContent = 'New Article';
  document.getElementById('edArchiveBtn').style.display = 'none';
  document.getElementById('edDeleteBtn').style.display = 'none';

  // Clear form
  document.getElementById('edTitle').value = '';
  document.getElementById('edSubtitle').value = '';
  document.getElementById('edSlug').value = '';
  document.getElementById('edCategory').value = 'analysis';
  document.getElementById('edTags').value = '';
  document.getElementById('edAuthorName').value = 'MeritNama';
  document.getElementById('edExcerpt').value = '';
  document.getElementById('edContent').value = '';
  document.getElementById('edSeoTitle').value = '';
  document.getElementById('edSeoDesc').value = '';
  document.getElementById('edRelatedSlugs').value = '';
  document.getElementById('edPreview').innerHTML = '';
  document.getElementById('edCoverPreview').style.display = 'none';
  document.getElementById('edCoverText').style.display = 'block';
  document.getElementById('edAutosaveHint').textContent = '';

  window.location.hash = '';
}

// ── Edit article ─────────────────────────────────────────────────
function edaEdit(id) {
  const article = edAdmin.articles.find(a => a.id === id);
  if (!article) return;

  edAdmin.currentId = id;
  edAdmin.currentSlug = article.slug;
  edAdmin.coverUrl = article.coverImage || null;
  edAdmin.coverFile = null;

  document.getElementById('edAdminListView').style.display = 'none';
  document.getElementById('edAdminEditorView').style.display = 'block';
  document.getElementById('edEditorTitle').textContent = 'Edit Article';
  document.getElementById('edArchiveBtn').style.display = article.status === 'published' ? '' : 'none';
  document.getElementById('edDeleteBtn').style.display = '';

  document.getElementById('edTitle').value = article.title || '';
  document.getElementById('edSubtitle').value = article.subtitle || '';
  document.getElementById('edSlug').value = article.slug || '';
  document.getElementById('edCategory').value = article.category || 'analysis';
  document.getElementById('edTags').value = (article.tags || []).join(', ');
  document.getElementById('edAuthorName').value = article.authorName || 'MeritNama';
  document.getElementById('edExcerpt').value = article.excerpt || '';
  document.getElementById('edContent').value = article.content || '';
  document.getElementById('edSeoTitle').value = article.seo?.title || '';
  document.getElementById('edSeoDesc').value = article.seo?.description || '';
  document.getElementById('edRelatedSlugs').value = (article.relatedSlugs || []).join(', ');
  document.getElementById('edAutosaveHint').textContent = '';

  // Cover preview
  if (article.coverImage) {
    document.getElementById('edCoverPreview').src = article.coverImage;
    document.getElementById('edCoverPreview').style.display = 'block';
    document.getElementById('edCoverText').style.display = 'none';
  } else {
    document.getElementById('edCoverPreview').style.display = 'none';
    document.getElementById('edCoverText').style.display = 'block';
  }

  updatePreview();
  window.location.hash = 'edit=' + (article.slug || '');
}

async function editBySlug(slug) {
  const article = edAdmin.articles.find(a => a.slug === slug);
  if (article) {
    edaEdit(article.id);
    return;
  }
  // Load from Firestore
  try {
    const snap = await edAdmin.db.collection(edAdmin.COLLECTION)
      .where('slug', '==', slug)
      .limit(1)
      .get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = doc.data();
      data.id = doc.id;
      edAdmin.articles.push(data);
      edaEdit(doc.id);
    }
  } catch (err) {
    console.error('Failed to load article:', err);
  }
}

// ── Save article ─────────────────────────────────────────────────
async function edaSave(status) {
  const title = document.getElementById('edTitle').value.trim();
  const content = document.getElementById('edContent').value.trim();

  if (!title) { edaToast('Title is required.', 'error'); return; }
  if (!content && status === 'published') { edaToast('Content is required to publish.', 'error'); return; }

  let slug = document.getElementById('edSlug').value.trim();
  if (!slug) slug = edaSlugify(title);
  if (!slug) { edaToast('Slug is required.', 'error'); return; }

  const tags = document.getElementById('edTags').value
    .split(',').map(t => t.trim()).filter(Boolean);

  const relatedSlugs = document.getElementById('edRelatedSlugs').value
    .split(',').map(s => s.trim()).filter(Boolean);

  // Upload cover if pending
  let coverUrl = edAdmin.coverUrl;
  if (edAdmin.coverFile) {
    try {
      coverUrl = await uploadCover(edAdmin.coverFile, slug);
    } catch (err) {
      console.error('Cover upload failed:', err);
      edaToast('Cover image upload failed. Saving without cover.', 'error');
    }
  }

  const now = firebase.firestore.FieldValue.serverTimestamp();
  const readingTime = edaEstimateReadingTime(content);

  const data = {
    title: title,
    subtitle: document.getElementById('edSubtitle').value.trim(),
    slug: slug,
    category: document.getElementById('edCategory').value,
    tags: tags,
    authorName: document.getElementById('edAuthorName').value.trim() || 'MeritNama',
    authorEmail: getSessionEmail() || '',
    excerpt: document.getElementById('edExcerpt').value.trim(),
    content: content,
    coverImage: coverUrl || null,
    readingTime: readingTime,
    status: status,
    relatedSlugs: relatedSlugs,
    seo: {
      title: document.getElementById('edSeoTitle').value.trim() || title,
      description: document.getElementById('edSeoDesc').value.trim() || document.getElementById('edExcerpt').value.trim(),
    },
    updatedAt: now,
  };

  if (status === 'published' && !edAdmin.currentId) {
    data.publishedAt = now;
  }
  if (status === 'published' && edAdmin.currentId) {
    // Check if it was previously draft/archived
    const existing = edAdmin.articles.find(a => a.id === edAdmin.currentId);
    if (existing && existing.status !== 'published') {
      data.publishedAt = now;
    }
  }

  try {
    if (edAdmin.currentId) {
      await edAdmin.db.collection(edAdmin.COLLECTION).doc(edAdmin.currentId).update(data);
    } else {
      const ref = await edAdmin.db.collection(edAdmin.COLLECTION).add({
        ...data,
        createdAt: now,
      });
      edAdmin.currentId = ref.id;
    }

    edAdmin.coverFile = null;
    document.getElementById('edAutosaveHint').textContent = 'Saved ' + new Date().toLocaleTimeString();

    const statusMsg = status === 'published' ? 'Published!' :
                      status === 'archived' ? 'Archived.' : 'Draft saved.';
    edaToast(statusMsg, 'success');

    await loadAllArticles();
    document.getElementById('edArchiveBtn').style.display = status === 'published' ? '' : 'none';
    document.getElementById('edDeleteBtn').style.display = '';

  } catch (err) {
    console.error('Save error:', err);
    edaToast('Failed to save. Please try again.', 'error');
  }
}

// ── Delete article ───────────────────────────────────────────────
async function edaDeleteArticle() {
  if (!edAdmin.currentId) return;
  if (!confirm('Permanently delete this article? This cannot be undone.')) return;

  try {
    await edAdmin.db.collection(edAdmin.COLLECTION).doc(edAdmin.currentId).delete();
    edaToast('Article deleted.', 'success');
    edAdmin.currentId = null;
    edAdmin.currentSlug = null;
    await loadAllArticles();
    edaShowList();
  } catch (err) {
    console.error('Delete error:', err);
    edaToast('Failed to delete.', 'error');
  }
}

// ── Show list view ───────────────────────────────────────────────
function edaShowList() {
  edAdmin.currentId = null;
  edAdmin.currentSlug = null;
  document.getElementById('edAdminListView').style.display = 'block';
  document.getElementById('edAdminEditorView').style.display = 'none';
  window.location.hash = '';
}

// ── Cover image upload ───────────────────────────────────────────
function setupCoverUpload() {
  const uploadEl = document.getElementById('edCoverUpload');
  const input = document.getElementById('edCoverInput');
  if (!uploadEl || !input) return;

  uploadEl.addEventListener('click', () => input.click());
  uploadEl.addEventListener('dragover', e => { e.preventDefault(); uploadEl.style.borderColor = 'var(--neon-cyan)'; });
  uploadEl.addEventListener('dragleave', () => { uploadEl.style.borderColor = ''; });
  uploadEl.addEventListener('drop', e => {
    e.preventDefault();
    uploadEl.style.borderColor = '';
    if (e.dataTransfer.files.length) handleCoverFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => {
    if (input.files.length) handleCoverFile(input.files[0]);
  });
}

function handleCoverFile(file) {
  if (!file.type.startsWith('image/')) {
    edaToast('Please select an image file.', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    edaToast('Image must be under 5MB.', 'error');
    return;
  }

  edAdmin.coverFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('edCoverPreview');
    const text = document.getElementById('edCoverText');
    if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
    if (text) text.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function uploadCover(file, slug) {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = edAdmin.STORAGE_PATH + '/' + slug + '-' + Date.now() + '.' + ext;
  const ref = edAdmin.storage.ref().child(path);
  await ref.put(file);
  return await ref.getDownloadURL();
}

// ── Autosave ─────────────────────────────────────────────────────
function setupAutosave() {
  const fields = ['edTitle', 'edSubtitle', 'edContent', 'edExcerpt', 'edCategory', 'edTags'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        if (edAdmin.autosaveTimer) clearTimeout(edAdmin.autosaveTimer);
        document.getElementById('edAutosaveHint').textContent = 'Unsaved changes...';
        edAdmin.autosaveTimer = setTimeout(() => {
          if (edAdmin.currentId) edaSave('draft');
        }, 5000);
      });
    }
  });
}

// ── Live preview ─────────────────────────────────────────────────
function setupLivePreview() {
  const content = document.getElementById('edContent');
  if (!content) return;
  content.addEventListener('input', updatePreview);
}

function updatePreview() {
  const content = document.getElementById('edContent');
  const preview = document.getElementById('edPreview');
  if (!content || !preview) return;

  try {
    preview.innerHTML = typeof marked !== 'undefined'
      ? marked.parse(content.value || '')
      : (content.value || '').replace(/\n/g, '<br>');
  } catch (e) {
    preview.innerHTML = (content.value || '').replace(/\n/g, '<br>');
  }

  if (window.EdCharts) EdCharts.render('#edPreview');
}

// ── Slug auto-generation ─────────────────────────────────────────
function setupSlugAuto() {
  const title = document.getElementById('edTitle');
  const slug = document.getElementById('edSlug');
  if (!title || !slug) return;
  let userEdited = false;
  slug.addEventListener('input', () => { userEdited = true; });
  title.addEventListener('input', () => {
    if (!userEdited && !edAdmin.currentId) {
      slug.value = edaSlugify(title.value);
    }
  });
}

// ── Reading time estimate ────────────────────────────────────────
function edaEstimateReadingTime(markdown) {
  if (!markdown) return 1;
  const plain = markdown.replace(/[#*`_\[\]()>~|-]/g, ' ').replace(/\s+/g, ' ');
  const words = plain.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

// ── Preview in new tab ───────────────────────────────────────────
function edaPreviewInNewTab() {
  const slug = document.getElementById('edSlug').value.trim();
  if (slug) {
    window.open('editorial.html#' + slug, '_blank');
  } else {
    edaToast('Save the article first to preview.', 'error');
  }
}

// ── Expose to global ─────────────────────────────────────────────
// Bridge for onclick handlers in HTML
edAdmin.showList = edaShowList;
edAdmin.newArticle = edaNewArticle;
edAdmin.edit = edaEdit;
edAdmin.save = edaSave;
edAdmin.deleteArticle = edaDeleteArticle;
edAdmin.previewInNewTab = edaPreviewInNewTab;

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  function waitForFirebase(cb) {
    if (window.firebase && firebase.firestore) return cb();
    var iv = setInterval(function () {
      if (window.firebase && firebase.firestore) { clearInterval(iv); cb(); }
    }, 100);
  }
  function waitForAuth(cb) {
    // auth.js removes auth-locked once session is verified
    if (!document.body.classList.contains('auth-locked')) return cb();
    var iv = setInterval(function () {
      if (!document.body.classList.contains('auth-locked')) { clearInterval(iv); cb(); }
    }, 150);
    // fallback: if auth-locked never removes (no session), still proceed after 4s
    setTimeout(function () { clearInterval(iv); cb(); }, 4000);
  }
  waitForFirebase(function () {
    waitForAuth(edaInit);
  });
});
