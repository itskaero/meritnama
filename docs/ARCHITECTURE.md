# MeritNama ecosystem — architecture

MeritNama is two deliberately separate projects:

| | **meritnama** (this repo) | **meritNAMA-app** |
|---|---|---|
| Visibility | Public | Private |
| Purpose | Product information, methodology, announcements, entry gate | The product: candidate portal, admin workspace, data management, simulation |
| Stack | Static HTML/CSS/JS, no build step | Next.js (App Router) + TypeScript, PostgreSQL, Docker Compose |
| Hosting | GitHub Pages (any static host works) | Self-hosted on a NAS, behind a reverse proxy |
| Holds secrets / private data | Never | Yes, outside version control (`.env`, mounted volumes) |

## Boundary

```
                 Internet
                    │
   ┌────────────────┴─────────────────┐
   │                                  │
   ▼                                  ▼
┌──────────────────────────┐   ┌──────────────────────────────────────────┐
│ meritnama  (PUBLIC)      │   │ meritNAMA-app  (PRIVATE)                 │
│ GitHub Pages             │   │ NAS · Docker Compose                     │
│                          │   │                                          │
│ index.html  landing      │   │  reverse proxy (HTTPS)                   │
│ privacy / terms          │   │      │                                   │
│ hospitals / accreditation│   │      ▼                                   │
│ site.config.js ──────────┼──►│  app  (Next.js)   /api/health  (public)  │
│   appUrl, appHealthUrl   │   │      │            /portal/*   (candidate)│
│                          │   │      │            /admin/*    (admin)    │
│ No private source        │   │      ▼                                   │
│ No candidate-level data  │   │  PostgreSQL   ·   storage volume         │
│ No secrets               │   │  (internal network only)                 │
└──────────────────────────┘   └──────────────────────────────────────────┘
     links only — no proxying, no shared code, no shared deploy
```

The only things that cross the boundary:

1. **Links.** "Sign in" and similar CTAs point at `appUrl` from `site.config.js`.
2. **Availability probe.** If `appHealthUrl` is set, the landing page calls the app's
   unauthenticated `GET /api/health`, which returns only `{"status","database"}`. The app
   allows that call cross-origin for `PUBLIC_SITE_ORIGIN` only. When the app is down, the
   landing page shows a plain availability notice; it never surfaces errors.
3. **Design tokens.** `assets/css/tokens.css` is copied (not shared) into the app as
   `src/styles/tokens.css`. See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

The private repository is never a submodule, subdirectory, package or build input of
this repository.

## Responsibilities

**Public website (this repo)**
- Landing page, product overview, methodology and data-source transparency
- FAQ, privacy policy, terms, contact
- Public resources that use only published, non-personal data (hospital directory,
  accreditation list)
- Entry point to the app via a configurable URL

**Private application**
- Authentication, accounts and verified candidate-record linking
- Candidate dashboard, merit profile, preference planner, simulation, historical
  cutoffs, saved workspace
- Admin: candidate and induction data, scoring policies, reference data, processing
  and simulation runs, audit history, settings and health
- The canonical datasets, the scoring calculation engine and the allocation engine

## Current state (October 2026) and transition

This repository still contains the **legacy application** — `app.html`,
`simulation.html`, `candidate.html`, `admin.html`, `js/`, the Python pipeline,
Firebase configuration and the full `data/` and `inductions/` datasets. It is the
production product today and is left working.

The transition is incremental (see [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)):

1. ✅ New public landing page, design tokens, configurable app URL (this change).
2. Port data contracts, the scoring engine and the allocation engine into the private
   app, with regression tests against the legacy outputs.
3. Move candidate-level datasets and privileged pages out of this repository once the
   private app serves them. **This step is required** before the public/private
   boundary above is actually true — see [SECURITY.md](SECURITY.md).
4. Switch `appUrl` to the private app and turn off `legacySessionRedirect`.

Until step 3, treat everything under `data/`, `inductions/` and the gated pages as
legacy-app material, not as part of the public website.

## Configuration

All public-site configuration is in [`site.config.js`](../site.config.js). It is
public; never put secrets, internal hostnames or API keys in it.

| Key | Purpose |
|---|---|
| `appUrl` | Target of every `[data-app-link]` (Sign in, final CTA, footer). Currently `app.html`. |
| `appHealthUrl` | Optional health URL of the private app; enables the availability notice. |
| `legacySessionRedirect` | Keeps the old "signed-in users skip the landing page" behaviour. `?home` bypasses it. |
| `homepageContentUrl` | Read-only Firestore document with the admin-edited hero subhead and snapshot figures. |
