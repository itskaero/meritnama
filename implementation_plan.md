# MeritNama Frontend Redesign - Complete Rebuild (v2, Design-Refined)

Tear down the entire frontend and rebuild from scratch as a unified SPA with a modern, clean design system inspired by Linear/Vercel. Keep the same vanilla JS + Firebase tech stack and all existing features/pages, but completely reimagine the UX, flow, structure, layout, design, and theme.

> [!NOTE]
> **Design Read:** Redesign-overhaul of a residency analytics SPA for medical students/graduates, with a Linear-clean language, leaning toward native CSS custom properties + Geist type family + restrained purposeful motion. Vanilla JS, no framework.

## Design Dials

| Dial | Value | Rationale |
|---|---|---|
| DESIGN_VARIANCE | **6** | Offset layouts, asymmetric hero, varied section composition. Not chaotic. |
| MOTION_INTENSITY | **4** | Fluid CSS transitions, hover states, skeleton loaders, fade-in page transitions. No scroll-hijack, no parallax. |
| VISUAL_DENSITY | **6** | Data-forward analytics tool. Standard app spacing, not art gallery. Monospace for all numeric data values. |

## Design Decisions (Interview + Design Skills Audit)

| Decision | Choice | Skill Note |
|---|---|---|
| Audience | Medical students/graduates, low-moderate tech savvy | |
| Device Priority | Equal (fully responsive, no breakpoint cliffs) | `min-h-[100dvh]`, never `h-screen` |
| Color Mode | System auto-detect + manual toggle (light/dark) | Both modes designed from start |
| Visual Personality | Clean and professional with subtle flair (Linear) | |
| Architecture | Unified SPA with hash-based client-side routing | |
| Navigation | Persistent sidebar (collapsible drawer on mobile) | Phosphor icons, no emoji |
| Landing Page | Asymmetric split hero, varied section layouts | Anti-center bias at VARIANCE 6 |
| Auth System | Keep PIN-per-email, restyle UI only | |
| Auth UI | Full-screen overlay modal with backdrop blur | |
| Typography | **Geist Sans + Geist Mono** | Inter discouraged as default. Geist fits Linear direction. |
| Brand Color | **Burnt Orange (#EA580C)** | Violet killed (LILA RULE). Orange is warm, distinctive, non-AI-coded. |
| Neutral Base | **Zinc** gray family | Single temperature, no warm/cool clash with orange |
| Cards | Purposeful only (interactive widgets, elevated content) | Spacing + dividers for lists/tables |
| Radius System | All-soft: 12px cards, 8px inputs, full-pill buttons/badges | Shape Consistency Lock |
| Animation | Subtle and purposeful, CSS transitions only | MOTION_INTENSITY 4, `prefers-reduced-motion` respected |
| Icons | **Phosphor** via CDN (light weight, 1.5 stroke) | Emoji discouraged, no hand-rolled SVGs |
| Charts | Keep Chart.js, restyle to match new design | |
| Background Themes | Remove 12-theme system, just light/dark toggle | |
| File Strategy | Overwrite in-place on `web-redesign` branch | |
| Analytics Structure | Current 9 tabs as sub-routes under Analytics | |
| Phasing | Phase 1 first, then Phase 2 and 3 in future tasks | |

---

## Phasing Strategy

### Phase 1 (This Task)
- Design system (CSS custom properties, typography, color tokens, both modes)
- SPA shell with hash-based router
- Persistent sidebar navigation with Phosphor icons
- Landing page (full redesign, asymmetric hero)
- Auth gate (PIN-per-email, restyled)
- Core Analytics views:
  - Merit Table
  - My Prediction
  - What Do I Need
  - Calculator
  - Compare
  - Previous Merit Lists
  - Jobs
  - Policy
  - Guide

### Phase 2 (Active / In Progress)
- Simulation Portal Integration (incorporate simulator layout, tabs, panels, chat into SPA; load simulator script engine dynamically)
- My Profile / Candidate page (re-implement profile editor, invite PIN controls, trust scores, public toggles, grievance inbox, background animations)
- Hospital directory + individual hospital profile pages (dynamic `#/hospitals` grid, dynamic `#/hospital?id=ID` profile view, reviews integrations)

### Phase 3 (Future Task)
- Standalone reviews page & community discussion forum (dynamic reviews browser)
- Admin dashboard
- Candidate Changes log
- Donate page / voluntary support
- Request Access workflow page

---

## Proposed Changes

### Design System Foundation

#### [MODIFY] [styles.css](file:///c:/Users/mantis/proj/meritnama/styles.css)
Complete rewrite. New design system:

**Color Tokens (CSS Custom Properties):**
- Dual-mode via `[data-theme="light"]` / `[data-theme="dark"]`, default from `prefers-color-scheme`
- Neutral scale: Zinc-based (50-950), off-white to off-black (never pure `#000` or `#fff`)
- Brand: Burnt Orange scale (50-950), primary = `#EA580C`, hover/active variants
- Semantic: Emerald (success/safe), Red (danger/unlikely), Amber (warning/borderline), Blue (info)
- Surface tokens: `--surface-primary`, `--surface-secondary`, `--surface-elevated`, `--surface-overlay`
- Text tokens: `--text-primary`, `--text-secondary`, `--text-tertiary`
- Border tokens: `--border-default`, `--border-subtle`
- Shadow tokens: tinted to background hue (no pure-black shadows on light backgrounds)
- Focus-ring: `--ring-brand` using orange at reduced opacity

**Typography Scale:**
- Display/headings: `Geist Sans` (variable, 400-700), `tracking-tighter`, `leading-tight`
- Body: `Geist Sans` (variable, 400-500), `leading-relaxed`, `max-width: 65ch` for body paragraphs
- Data/stats/mono: `Geist Mono` for all numeric values, table data, stat counters
- Size scale: xs (12px), sm (14px), base (16px), lg (18px), xl (20px), 2xl (24px), 3xl (30px), 4xl (36px)
- Line-height: tight (1.2 for headings), normal (1.5 for body), relaxed (1.7 for reading)

**Component Styles:**
- `.card` - 12px radius, subtle tinted shadow, 1px `--border-subtle` border. Used ONLY for interactive widgets.
- `.btn-primary` - full-pill, burnt orange bg, off-white text. Hover: scale(0.98) active feedback.
- `.btn-secondary` - full-pill, transparent bg, 1px border, text color. Hover: subtle bg fill.
- `.btn-ghost` - no border, text-only, hover: subtle bg.
- `.input`, `.select`, `.textarea` - 8px radius, label ABOVE input, helper text below, error text below in semantic red. No placeholder-as-label.
- `.badge`, `.chip` - full-pill, small, muted backgrounds.
- `.data-table` - clean table with subtle row dividers (bottom-border only, not every row). Sortable column headers. Sticky headers. `Geist Mono` for numeric cells.
- `.sidebar` - persistent navigation sidebar, off-canvas drawer on mobile.
- `.overlay` - full-screen modal with `backdrop-filter: blur(16px)`.
- `.skeleton` - shimmer loading placeholders matching final layout shape.
- `.toast` - slide-in notification, auto-dismiss.

**Animations (gated behind `prefers-reduced-motion: no-preference`):**
- `@keyframes fadeIn` - opacity 0 to 1, 300ms, custom cubic-bezier(0.16, 1, 0.3, 1)
- `@keyframes slideUp` - translateY(16px) + opacity 0 to translateY(0) + opacity 1, 400ms
- `@keyframes shimmer` - skeleton loading gradient sweep
- Transition preset: `transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1)` (no `linear` or `ease-in-out`)
- Button active: `transform: scale(0.98)` for tactile feedback
- All motion uses only `transform` and `opacity` (GPU-safe)

**Responsive Breakpoints:**
- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px
- Sidebar collapse: < 768px (slides in as drawer overlay)

---

### SPA Shell and Router

#### [MODIFY] [index.html](file:///c:/Users/mantis/proj/meritnama/index.html)
Complete rewrite. Single entry point for the entire app:

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MeritNama - Residency Induction Analytics</title>
  <!-- Geist Sans + Geist Mono (self-hosted or CDN with font-display: swap) -->
  <!-- Phosphor Icons CDN (light weight) -->
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <!-- Auth Overlay (hidden by default) -->
  <div id="authGate" class="overlay hidden">...</div>

  <!-- Landing Page (shown for unauthenticated / root route) -->
  <div id="landing" class="view">...</div>

  <!-- App Shell (shown for authenticated routes) -->
  <div id="appShell" class="app-shell hidden">
    <nav id="sidebar" class="sidebar">...</nav>
    <main id="mainContent" class="main-content">
      <!-- Views injected here by router -->
    </main>
  </div>

  <script src="firebase-config.js"></script>
  <script src="router.js"></script>
  <script src="auth.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

#### [NEW] [router.js](file:///c:/Users/mantis/proj/meritnama/router.js)
Hash-based client-side router:
- Routes: `#/`, `#/analytics/merit-table`, `#/analytics/prediction`, `#/analytics/what-do-i-need`, `#/analytics/calculator`, `#/analytics/compare`, `#/analytics/merit-lists`, `#/analytics/jobs`, `#/analytics/policy`, `#/analytics/guide`, `#/simulation`, `#/profile`, `#/hospitals`, `#/hospital/:id`, `#/reviews`, `#/accreditation`, `#/donate`, `#/admin`
- View lifecycle: `onEnter()`, `onLeave()`, `render()`
- Auth guard: redirects unauthenticated users to landing with auth prompt
- Page transition: fade (opacity 0 to 1, 300ms, custom cubic-bezier)
- Scroll position restoration per route
- Dynamic `document.title` updates per route

---

### Landing Page

The landing page view rendered at `#/` (root route). Completely redesigned:

**Structure (4 sections, 4 different layout families):**

1. **Hero - Asymmetric Split**
   Left side: Headline ("Know where you stand."), subtext (max 20 words), single primary CTA ("Get Started"). Right side: generated visual/graphic showing a stylized data visualization or abstract analytics imagery. Full viewport height (`min-h-[100dvh]`). Collapses to stacked on mobile (headline on top, visual below).

2. **Features - Bento Grid**
   Asymmetric grid of feature tiles (not 3 equal cards). Each tile: Phosphor icon + short headline + one-line description. Varied cell sizes (some span 2 cols). At least 2-3 tiles with tinted background variation (not all white-on-white). Mobile: single column stack.

3. **Stats - Full-width horizontal strip**
   Key metrics (candidates, placements, hospitals) in `Geist Mono` large display numbers with small labels below. No cards, just breathing layout with generous spacing.

4. **Footer - Minimal**
   Credits, built-by link. No decoration strip, no locale/weather, no version labels.

> [!IMPORTANT]
> No eyebrows on the hero. No "Scroll" cue. No "How It Works" numbered steps (generic step labels banned). No "Trusted by" logo wall (no real logos to show). No centered hero. No animated canvas/video background.

---

### Auth Gate

#### [MODIFY] [auth.js](file:///c:/Users/mantis/proj/meritnama/auth.js)
Restyle the auth UI to match the new design. Keep the PIN-per-email logic intact:
- Full-screen overlay with `backdrop-filter: blur(16px)`
- Centered card (12px radius) with clean form
- Email input (label above, 8px radius) then Send PIN then Enter PIN flow
- Geist Sans typography, burnt orange accent on primary button
- Loading: skeleton shimmer matching form shape
- Error: inline below input in semantic red
- Both light and dark mode aware

#### [DELETE] [auth.css](file:///c:/Users/mantis/proj/meritnama/auth.css)
Auth styles integrated into the main `styles.css` design system.

---

### Sidebar Navigation

Persistent sidebar with Phosphor icons (light weight, 1.5 stroke):

```
[Logo - MeritNama wordmark or SVG]

ANALYTICS
  [chart-bar]    Merit Table
  [target]       My Prediction
  [magnifying-glass] What Do I Need
  [calculator]   Calculator
  [scales]       Compare
  [list-bullets] Merit Lists
  [briefcase]    Jobs
  [file-text]    Policy

EXPLORE
  [game-controller] Simulation        [coming soon]
  [user]            My Profile        [coming soon]
  [buildings]       Hospitals         [coming soon]
  [check-circle]    Accreditation
  [chat-circle]     Discussion        [coming soon]

SUPPORT
  [heart]    Donate                    [coming soon]
  [question] Guide

---
[sun/moon]  Theme toggle
[user-circle + name]  Logout
```

- Desktop: persistent, collapsible to icon-only rail (user preference stored in localStorage)
- Mobile (< 768px): hidden by default, slides in as drawer overlay with backdrop blur
- Active route: burnt orange text + subtle orange-tinted background on active item
- "Coming soon" items: muted text, no hover effect, small muted badge
- Navigation fits on ONE line per item, sidebar height max 80px for header area
- Nav section labels ("ANALYTICS", "EXPLORE", "SUPPORT"): `Geist Mono`, 10px, uppercase, tracking-wide, muted color. Max 1 eyebrow per 3 items.

---

### Core Analytics Views

#### [MODIFY] [app.js](file:///c:/Users/mantis/proj/meritnama/app.js)
Rewrite the rendering logic. Each tab becomes a standalone view function:
- `renderMeritTable()` - data table with sortable headers, grouped by spacing (not card-wrapped). `Geist Mono` for numeric cells.
- `renderPrediction()` - prediction form in a card (interactive widget), results displayed below with semantic color coding
- `renderWhatDoINeed()` - reverse prediction form card with results
- `renderCalculator()` - merit score calculator card with live preview
- `renderCompare()` - side-by-side comparison in a 2-column grid (cards here, since distinct interactive panels)
- `renderMeritLists()` - historical merit list browser, list with dividers
- `renderJobs()` - job listings with subtle dividers, not cards
- `renderPolicy()` - policy information, editorial-style reading layout (max-width 65ch)
- `renderGuide()` - onboarding/help content, reading layout

Each view uses purposeful layout: cards for interactive widgets, spacing and dividers for content and lists. All transitions use the CSS custom cubic-bezier.

#### [MODIFY] [charts.js](file:///c:/Users/mantis/proj/meritnama/charts.js)
Restyle Chart.js defaults:
- Burnt orange brand color for primary data series
- Zinc/gray for secondary series
- Semantic colors for safe (emerald) / borderline (amber) / unlikely (red) bands
- Subtle gridlines (zinc-200 light / zinc-800 dark, dashed)
- `Geist Sans` for axis labels
- `Geist Mono` for data values
- Responsive sizing
- Dual-mode config (reads CSS custom properties for colors)

---

### Files to Remove (Phase 1 Cleanup)

These files are superseded by the SPA architecture:

#### [DELETE] [app.html](file:///c:/Users/mantis/proj/meritnama/app.html)
Merged into index.html SPA shell.

#### [DELETE] [accreditation.html](file:///c:/Users/mantis/proj/meritnama/accreditation.html)
Will become a view within the SPA.

> [!WARNING]
> The following files will NOT be deleted yet (Phase 2 and Phase 3):
> - `simulation.html` and all `js/sim-*.js` files (Phase 2)
> - `candidate.html` (Phase 2)
> - `hospital.html`, `hospitals.html` (Phase 2)
> - `reviews.html`, `reviews.js` (Phase 3)
> - `admin.html` and all `js/admin-*.js` files (Phase 3)
> - `donate.html` (Phase 3)
> - `candidatesChanges.html` (Phase 3)
> - `animation.html` (Phase 3)
> - `request-access.html`, `access-request.js` (Phase 3)

---

### Files Untouched

These backend/data files remain completely unchanged:
- `firebase-config.js`, `firebase-config.template.js`
- `firebase.json`, `firestore.rules`, `firestore.indexes.json`
- `data/` directory (all JSON data files)
- `scripts/` directory (Python pipeline)
- `notifications.js` (will be restyled later)
- `presence.js`
- `screenshot-guard.js`
- `logo.svg`, `logo.png`
- `policy.json`
- `README.md`, `FIREBASE_SETUP.md`, `FUTURE_FEATURES.md`

---

## Pre-Flight Checklist (from Design Skills)

These will be verified before shipping each view:

- [ ] Zero em-dashes (`-`) anywhere on the page
- [ ] Page theme lock: ONE theme (auto-detect), no mid-page inversions
- [ ] Color consistency lock: burnt orange used identically across all sections
- [ ] Shape consistency lock: 12px cards, 8px inputs, full-pill buttons
- [ ] Button contrast check: every CTA passes WCAG AA (4.5:1)
- [ ] Form contrast check: inputs, placeholders, labels all pass WCAG AA
- [ ] Hero fits viewport: headline 2 lines max, subtext 20 words max, CTA visible without scroll
- [ ] Hero top padding capped (no floating content halfway down)
- [ ] No 3-equal-feature-card rows (varied grid instead)
- [ ] No section-number eyebrows (`001`, `002`)
- [ ] No scroll cues ("Scroll", down arrows)
- [ ] No generic step labels ("Step 1", "Phase 01")
- [ ] No emoji in UI (Phosphor icons instead)
- [ ] No `window.addEventListener('scroll')` (IntersectionObserver for reveals)
- [ ] All motion gated behind `prefers-reduced-motion: no-preference`
- [ ] All animations use only `transform` and `opacity`
- [ ] `backdrop-blur` only on fixed/sticky elements (nav, overlay)
- [ ] Mobile collapse explicit for every multi-column layout
- [ ] `min-h-[100dvh]` for hero, never `h-screen`
- [ ] Loading/empty/error states provided for data views
- [ ] Both light and dark modes tested before shipping
- [ ] Copy self-audit: no AI-hallucinated phrases, no filler verbs ("Elevate", "Seamless", "Unleash")

## Phase 2 Proposed Changes

We will merge and convert `simulation.html`, `candidate.html`, `hospitals.html`, and `hospital.html` into dynamic SPA views.

### User Review Required
> [!IMPORTANT]
> - **Preserving Simulator Logic**: All complex simulator and consent engine code (`js/sim-*.js`) is preserved. They are loaded sequentially on demand when the user visits the `#/simulation` route for the first time.
> - **Animated Background Layer**: The candidate profile background animations (`#profileAnimLayer` featuring aurora, vortex, drift, etc.) will be retained and refactored to consume theme and primary-color CSS properties.

### Open Questions
> [!NOTE]
> - **Styles Consolidation**: We plan to move all profile and hospital styles from inline `<style>` tags directly into `styles.css` to maintain theme synchronization.

### Proposed Changes

#### [MODIFY] [index.html](file:///c:/Users/mantis/proj/meritnama/index.html)
- Enable the sidebar navigation elements for:
  - Simulation (`#/simulation`)
  - My Profile (`#/profile`)
  - Hospitals (`#/hospitals`)
- Remove `.disabled` class, remove `Soon` badges, and remove click preventers (`onclick="return false"`).

#### [NEW] [js/app-phase2.js](file:///c:/Users/mantis/proj/meritnama/js/app-phase2.js)
Create the rendering engine for Phase 2:
- `renderSimulation(container)`: Mounts simulator panels and tab interfaces (Guide, Slot Browser, Simulation, Config, Schedule, Competition, Hospitals, Profiles, Community). Uses dynamic script element injection to load all `js/sim-*.js` dependencies in order.
- `renderProfile(container)`: Mounts profile details form, custom photo upload encoder, trust score panels, animated canvas picker, invite PIN generator, and Firestore grievance threads inbox.
- `renderHospitals(container)`: Renders hospital directory search box and cards, linking each hospital to the dynamic route `#/hospital?id=ID`.
- `renderHospitalDetail(container)`: Renders individual hospital seat capacity tables and integrates specialty review cards with rating star selections.

#### [MODIFY] [app.js](file:///c:/Users/mantis/proj/meritnama/app.js)
- Register Phase 2 routes in the Router config block:
  - `#/simulation`
  - `#/profile`
  - `#/hospitals`
  - `#/hospital`

#### [MODIFY] [styles.css](file:///c:/Users/mantis/proj/meritnama/styles.css)
- Append profile page animation rules and styling definitions for profile editor and hospital matrix.
- Ensure strict compliance with 12px cards, 8px inputs, pill badges, Zinc background scales, and Geist Sans/Mono typography.

#### [DELETE] [simulation.html](file:///c:/Users/mantis/proj/meritnama/simulation.html)
#### [DELETE] [candidate.html](file:///c:/Users/mantis/proj/meritnama/candidate.html)
#### [DELETE] [hospitals.html](file:///c:/Users/mantis/proj/meritnama/hospitals.html)
#### [DELETE] [hospital.html](file:///c:/Users/mantis/proj/meritnama/hospital.html)

## Phase 3 Proposed Changes

We will merge and convert the remaining user-facing and administrator modules (`reviews.html`, `admin.html`, `donate.html`, `candidatesChanges.html`, `animation.html`, `request-access.html`) into unified, dynamic SPA views.

### User Review Required
> [!IMPORTANT]
> - **Preserving Admin & Forum Logic**: The interactive Firebase-driven features (specialty reviews, community discussion threads, administrative configuration controls, manual credentials verification requests, and local diagnostic share-card canvas generators) are fully preserved. They are routed and rendered client-side under dynamic templates.
> - **Dynamic Script Loading**: To keep the initial SPA load lightweight, complex script components such as reviews (`reviews.js`), administrator utilities (`js/admin-induction.js`, `js/admin-toggles.js`, `js/app-jobs.js`), and request helpers (`access-request.js`) will be loaded dynamically on route transitions.

### Proposed Changes

#### [MODIFY] [index.html](file:///c:/Users/mantis/proj/meritnama/index.html)
- Enable the sidebar navigation elements for:
  - Discussion (`#/reviews`)
  - Donate (`#/donate`)
- Remove `.disabled` class, remove `Soon` badges, and remove click preventers (`onclick="return false"`).
- Append the `js/app-phase3.js` module script tag below `js/app-phase2.js`.

#### [NEW] [js/app-phase3.js](file:///c:/Users/mantis/proj/meritnama/js/app-phase3.js)
Create the rendering engine for Phase 3:
- `renderDiscussion(container)`: Renders discussion threads filterable by categories (General, Q&A, Study, Hospital, Merit, Story, Concern) with thread replies, text area editors, and reviews list. Loads `reviews.js` dynamically.
- `renderAdmin(container)`: Renders admin gate login card. Once authenticated, renders dashboard counters, settings toggles (induction stages, active config), database syncer logs, and jobs scraper sync feeds. Loads `js/admin-induction.js`, `js/admin-toggles.js`, and `js/app-jobs.js` dynamically.
- `renderDonate(container)`: Renders voluntary support tiers (Supporter, Advocate, Benefactor), bank account numbers, RAAST credentials, QR codes, and payment proof submission buttons.
- `renderChangesLog(container)`: Renders candidate data snapshot logs, previous/current pool metrics cards, and lists of added/removed/updated records.
- `renderAnimationSandbox(container)`: Renders diagnostic card share generator (`#/share`). Binds parameters (Candidate name, applicant ID, total marks, percentile, parent hospital) to a canvas renderer, allowing users to select styling themes and download the image.
- `renderRequestAccess(container)`: Renders request verification access forms, matching candidate indexes, and payment proofs. Loads `access-request.js` dynamically.

#### [MODIFY] [app.js](file:///c:/Users/mantis/proj/meritnama/app.js)
- Register Phase 3 routes in the Router config block:
  - `#/reviews`
  - `#/admin`
  - `#/donate`
  - `#/changes`
  - `#/share`
  - `#/request-access`

#### [MODIFY] [styles.css](file:///c:/Users/mantis/proj/meritnama/styles.css)
- Add styling definitions for discussion thread comments list, admin controls card matrix, support tiers, and share card canvas preview sheets.
- Maintain strict shape/spacing lock rules (12px card borders, 8px inputs, pill badges).

#### [DELETE] [reviews.html](file:///c:/Users/mantis/proj/meritnama/reviews.html)
#### [DELETE] [admin.html](file:///c:/Users/mantis/proj/meritnama/admin.html)
#### [DELETE] [donate.html](file:///c:/Users/mantis/proj/meritnama/donate.html)
#### [DELETE] [candidatesChanges.html](file:///c:/Users/mantis/proj/meritnama/candidatesChanges.html)
#### [DELETE] [animation.html](file:///c:/Users/mantis/proj/meritnama/animation.html)
#### [DELETE] [request-access.html](file:///c:/Users/mantis/proj/meritnama/request-access.html)

---

## Verification Plan

### Manual Verification
1. Navigate to `#/simulation` - verify simulator tabs and interactive panel views operate correctly.
2. Navigate to `#/profile` - verify form saving, invite generation, and backdrop background animated visual drift/glow.
3. Navigate to `#/hospitals` - verify live filter search list is active.
4. Click hospital card - verify routing to `#/hospital?id=ID` draws detail statistics and reviews history.
5. Submit specialty reviews - verify Firestore insertion works.
6. Navigate to `#/reviews` - verify categories lists and sub-forum posts render and thread detail modal slides open.
7. Navigate to `#/admin` - verify credential card login gates and admin sync controls function.
8. Navigate to `#/donate` - verify banking info and QR codes load correctly.
9. Navigate to `#/changes` - verify data pool metrics and added/removed candidate delta tables render correctly.
10. Navigate to `#/share` - verify share card canvas draws names/marks/badges dynamically and exports image correctly.
11. Navigate to `#/request-access` - verify credentials request triggers index verification check.

### Automated Tests
- Run style checks and validation across JS and CSS:
  ```powershell
  npx biome check .
  ```
