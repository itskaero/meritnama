// ═══════════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════════
function setupTabs() {
  const nav = document.getElementById('mainNav');
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tab;
      document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${t}`)?.classList.add('active');
      SIM.activeTab = t;
      // Lazy-render induction-data tabs on first activation
      if (t === 'seatmatrix')  renderSeatMatrixTab();
      if (t === 'competition') renderCompetitionTab();
      if (t === 'schedule')    renderScheduleTab();
      if (t === 'hospitals')   renderHospitalsTab();
      if (t === 'profiles')    renderProfilesTab();
      if (t === 'config')      renderConfigTab();
      if (t === 'community') {
        CHAT.tabActive = true;
        _resetUnread();
        _renderAllChatMessages();
        _chatScrollBottom('chatTabMessages');
      } else {
        CHAT.tabActive = false;
      }
      // close hamburger menu after tab selection on mobile
      nav?.classList.remove('nav-open');
      document.getElementById('hamburgerBtn')?.setAttribute('aria-expanded', 'false');
    });
  });
  document.querySelectorAll('.portal-guide-action[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector(`.tab-btn[data-tab="${btn.dataset.tab}"]`)?.click();
    });
  });
}

function setupHamburger() {
  const btn = document.getElementById('hamburgerBtn');
  const nav = document.getElementById('mainNav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // close when clicking outside
  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && !btn.contains(e.target)) {
      nav.classList.remove('nav-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}
