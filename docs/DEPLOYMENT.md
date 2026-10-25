# Deployment — public website

The public site is static and has no build step. Any static host works; production
uses GitHub Pages.

## GitHub Pages

Workflow: `.github/workflows/render-firebase-config.yml` (runs on push to `main`).

1. Renders `firebase-config.js` and `firebase-messaging-sw.js` from repository secrets
   (needed by the legacy app pages, not by the landing page).
2. Runs the legacy candidate-data steps (`build_candidate_auth_index.py`, stamping
   `simulation.html`). These leave with the legacy app — see ARCHITECTURE.md.
3. Copies the repo to `_site/`, excluding `.github/`, `scripts/`, `docs/`,
   `assets/images/source/`, `*.md`, rules and templates.
4. Deploys `_site/` to Pages.

### Base paths

The site is served from `https://itskaero.github.io/meritnama/`. Every asset and
link on the public pages is **relative** (`assets/…`, `privacy.html`, `./`), so the
same files work at a sub-path, at a custom domain root, or opened from disk. Do not
introduce root-absolute paths (`/assets/…`).

## Pointing at the private app

Edit `site.config.js`:

```js
appUrl: "https://app.example.org/",
appHealthUrl: "https://app.example.org/api/health",
legacySessionRedirect: false,
```

In the app's `.env`, set `PUBLIC_SITE_ORIGIN=https://itskaero.github.io` so the
health probe is allowed cross-origin. If the app is only reachable over a VPN, leave
`appHealthUrl` empty — the probe would fail for every public visitor.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000/index.html?home
```

`?home` skips the legacy "already signed in" redirect.

The private application's deployment (Docker Compose on a NAS) is documented in the
private repository: `meritNAMA-app/docs/DEPLOYMENT.md`.
