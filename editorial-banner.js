(function () {
  const STORAGE_KEY = 'editorial_banner_dismissed';
  const DISMISS_TTL = 3 * 24 * 60 * 60 * 1000; // 3 days

  function dismissedRecently() {
    try {
      const ts = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
      return Date.now() - ts < DISMISS_TTL;
    } catch (_) { return false; }
  }

  function markDismissed() {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (_) {}
  }

  async function init() {
    if (dismissedRecently()) return;

    const banner = document.getElementById('editorialBanner');
    const titleEl = document.getElementById('ebTitle');
    const ctaEl = document.getElementById('ebCta');
    const closeBtn = document.getElementById('ebClose');
    if (!banner || !titleEl) return;

    // Wait for Firebase
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      setTimeout(init, 200);
      return;
    }

    try {
      const snap = await firebase.firestore()
        .collection('editorial_articles')
        .where('status', '==', 'published')
        .orderBy('publishedAt', 'desc')
        .limit(1)
        .get();

      if (snap.empty) return;

      const doc = snap.docs[0];
      const latestData = doc.data();
      const slug = latestData.slug || doc.id;
      const title = latestData.title || 'New article';
      const link = 'editorial.html#' + slug;

      titleEl.innerHTML = '<a href="' + link + '">' + title + '</a>';
      if (ctaEl) ctaEl.href = link;
      banner.style.display = 'flex';
    } catch (e) {
      // Index not ready yet, silently skip
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        banner.style.display = 'none';
        markDismissed();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 600); });
  } else {
    setTimeout(init, 600);
  }
})();
