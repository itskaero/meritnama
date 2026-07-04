'use strict';

/**
 * MeritNama SPA Router
 * Hash-based router with client-side transitions, auth guard,
 * active link updates, and scroll restoration.
 */

const Router = {
  routes: {},
  currentRoute: null,
  scrollPositions: {},

  init() {
    window.addEventListener('hashchange', () => this.handleRouting());
    window.addEventListener('load', () => this.handleRouting());
    this.setupLinkInterceptors();
  },

  register(hash, config) {
    this.routes[hash] = config;
  },

  isAuthenticated() {
    try {
      const raw = localStorage.getItem('meritnama_auth_session');
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (s && s.email && typeof s.ts === 'number') {
        const sessionDuration = 24 * 60 * 60 * 1000; // 24 hours
        return (Date.now() - s.ts) < sessionDuration;
      }
    } catch (e) {
      return false;
    }
    return false;
  },

  async handleRouting() {
    let hash = window.location.hash || '#/';
    
    // Normalize path (strip query params if any for route matching, but preserve them in state)
    const queryIdx = hash.indexOf('?');
    let path = queryIdx !== -1 ? hash.substring(0, queryIdx) : hash;
    
    // Route validation
    if (!this.routes[path]) {
      // Fallback
      path = '#/';
      window.location.hash = '#/';
    }

    const route = this.routes[path];
    const isAuthed = this.isAuthenticated();

    // Save scroll position for the current route before navigating away
    if (this.currentRoute) {
      this.scrollPositions[this.currentRoute] = window.scrollY;
      const prevRouteConfig = this.routes[this.currentRoute];
      if (prevRouteConfig && typeof prevRouteConfig.onLeave === 'function') {
        prevRouteConfig.onLeave();
      }
    }

    // Auth Guard check
    if (path !== '#/' && !isAuthed) {
      // Gate the user, redirect to landing and trigger the login gate
      window.location.hash = '#/';
      
      // Delay slightly to allow landing layout to mount before auth gate triggers
      setTimeout(() => {
        if (typeof window.showAuthGate === 'function') {
          window.showAuthGate();
        }
      }, 100);
      return;
    }

    // App Shell vs Landing page visibility toggle
    const landingEl = document.getElementById('landing');
    const appShellEl = document.getElementById('appShell');
    const mainContent = document.getElementById('mainContent');

    if (path === '#/') {
      // If authenticated and visiting root, auto-redirect to default dashboard route
      if (isAuthed) {
        window.location.hash = '#/analytics/merit-table';
        return;
      }
      // Show landing, hide app shell
      if (landingEl) landingEl.classList.remove('hidden');
      if (appShellEl) appShellEl.classList.add('hidden');
      document.body.classList.remove('in-app');
    } else {
      // Show app shell, hide landing
      if (landingEl) landingEl.classList.add('hidden');
      if (appShellEl) appShellEl.classList.remove('hidden');
      document.body.classList.add('in-app');
    }

    // Trigger page transition (fade-out, render, fade-in)
    if (mainContent && path !== '#/') {
      mainContent.style.opacity = '0';
      mainContent.style.transform = 'translateY(8px)';
      
      // Delay render until fade-out finishes
      await new Promise(resolve => setTimeout(resolve, 150));
      
      this.renderRouteView(path, route, mainContent);
      
      // Force layout recalculation to ensure transition triggers
      mainContent.offsetHeight;
      
      mainContent.style.transition = 'opacity 0.3s var(--transition-bezier), transform 0.3s var(--transition-bezier)';
      mainContent.style.opacity = '1';
      mainContent.style.transform = 'translateY(0)';
    } else if (path === '#/') {
      // Landing page does not transition inside mainContent container
      this.renderRouteView(path, route, null);
    }

    // Update current route indicator
    this.currentRoute = path;

    // Restore scroll position
    const savedScroll = this.scrollPositions[path] || 0;
    setTimeout(() => {
      window.scrollTo({ top: savedScroll, behavior: 'instant' });
    }, 50);
  },

  renderRouteView(path, route, container) {
    // Update Page title
    document.title = route.title || 'MeritNama — Residency Induction Analytics';

    // Render components
    if (typeof route.render === 'function') {
      route.render(container);
    }

    // Call onEnter lifecycle
    if (typeof route.onEnter === 'function') {
      route.onEnter();
    }

    // Update active navigation state in sidebar
    this.updateActiveNavigation(path);
  },

  updateActiveNavigation(path) {
    document.querySelectorAll('.sidebar-item').forEach(item => {
      const routeAttr = item.getAttribute('data-route');
      if (routeAttr) {
        const expectedHash = '#/' + routeAttr.replace(/^\//, '');
        item.classList.toggle('active', expectedHash === path);
      }
    });
  },

  setupLinkInterceptors() {
    // Intercept client CTA or start action buttons that might trigger routing
    document.body.addEventListener('click', e => {
      const target = e.target.closest('[data-tab]');
      if (target) {
        if (target.closest('.sim-tab-nav') || target.closest('#adminSubNav')) {
          return;
        }
        const tab = target.getAttribute('data-tab');
        // Maps the old tab button structure to client-side hash routes
        const tabRouteMap = {
          'start': '#/',
          'merit': '#/analytics/merit-table',
          'predictor': '#/analytics/prediction',
          'reverse': '#/analytics/what-do-i-need',
          'calculator': '#/analytics/calculator',
          'compare': '#/analytics/compare',
          'current': '#/analytics/merit-lists',
          'jobs': '#/analytics/jobs',
          'policy': '#/analytics/policy',
          'guide': '#/analytics/guide',
          'accreditation': '#/analytics/accreditation'
        };
        if (tabRouteMap[tab]) {
          e.preventDefault();
          window.location.hash = tabRouteMap[tab];
        }
      }
    });
  }
};

// Initialize router on load
window.Router = Router;
