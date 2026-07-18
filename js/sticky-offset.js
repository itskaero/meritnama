'use strict';
// Sets --sticky-offset to .app-shell's actual distance from the top of the
// document, so .tab-nav's sticky top/height in styles.css always tracks
// whatever really sits above it (header, author-bar, and on some pages an
// async live-update/editorial banner that can appear after load) instead
// of a hardcoded 62px that only accounted for the header.
(function () {
  var shell = null;
  var pending = false;

  function apply() {
    pending = false;
    shell = shell || document.querySelector('.app-shell');
    if (!shell) return;
    var offset = Math.round(shell.getBoundingClientRect().top + window.scrollY);
    document.documentElement.style.setProperty('--sticky-offset', offset + 'px');
  }

  function scheduleApply() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(apply);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
  window.addEventListener('resize', scheduleApply);

  // Banners above .app-shell (live-update, editorial) can be toggled visible
  // by other scripts well after DOMContentLoaded, once async data resolves —
  // watch for that instead of assuming a one-time measurement stays correct.
  //
  // Deliberately scoped to only the specific banner elements that actually
  // sit above .app-shell, NOT the whole document.body: pages like
  // simulation.html mutate their content constantly (live candidate tables,
  // presence indicators, filters), and observing the full body subtree
  // meant every one of those unrelated mutations forced a synchronous
  // layout recalc via getBoundingClientRect() on the next frame — a real
  // scroll-jank regression on exactly the pages with the most going on.
  function watch(el) {
    if (!el) return;
    new MutationObserver(scheduleApply).observe(el, {
      attributes: true, attributeFilter: ['style', 'class'],
      childList: true, subtree: true,
    });
  }

  function startWatching() {
    ['#liveUpdateBanner', '#editorialBanner'].forEach(function (sel) {
      watch(document.querySelector(sel));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWatching);
  } else {
    startWatching();
  }
})();
