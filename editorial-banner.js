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
        .limit(1)
        .get();

      if (snap.empty) return;

      const doc = snap.docs[0];
      let latest = doc;
      let latestData = doc.data();
      if (snap.size > 1) {
        let best = latestData;
        snap.forEach(d => {
          const dd = d.data();
          const tb = dd.publishedAt ? (dd.publishedAt.toMillis ? dd.publishedAt.toMillis() : new Date(dd.publishedAt).getTime()) : 0;
          const ta = best.publishedAt ? (best.publishedAt.toMillis ? best.publishedAt.toMillis() : new Date(best.publishedAt).getTime()) : 0;
          if (tb > ta) { best = dd; latest = d; latestData = dd; }
        });
      }
      const slug = latestData.slug || latest.id;
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
