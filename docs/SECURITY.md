# Security — public website

## Rules for this repository

This repository is public. Everything in it — including history — must be safe to
publish.

- **No secrets.** No service-account keys, SMTP credentials, database URLs, tokens or
  private hostnames. Firebase *web* config is rendered at deploy time from repository
  secrets; it identifies the project but is not an authorization mechanism, so
  security must come from server-side rules.
- **No private application source.** The private app is never copied, vendored,
  submoduled or bundled here.
- **No candidate-level or restricted data.** Only aggregate, non-identifying figures
  and published reference data (hospital lists, accreditation, scoring policies).
- **No privileged functionality.** Admin features belong in the private app, behind
  server-side authorization.
- `site.config.js` is public by definition. It may contain URLs, nothing else.

## Required remediation (blocking delivery 2)

The legacy app still lives in this repository and predates these rules. Before more
features are built, the maintainer must:

1. ✅ *Done 25 Oct 2026:* national ID and phone data removed from every dataset at
   HEAD — including phones stored under `number`, CNICs typed into name fields, CNIC
   edits in change logs, and links into the official portal's admin panel; `tools/strip_pii.py` strips new uploads, the deploy strips the published
   copy, and the **PII guard** workflow fails any commit that adds them back.
   Still to do: move the remaining candidate-level records (emails, PMDC numbers)
   out of this repository with the private app.
2. Purge them from git history: tested script and runbook in
   [HISTORY_PURGE.md](HISTORY_PURGE.md) (maintainer runs it). Then ask GitHub Support
   to clear cached views and pull-request refs. Treat previously published copies as
   exposed.
3. Lock down Firestore rules so that no collection is world-writable and privileged
   collections are not world-readable; route privileged writes through server-side
   code (see `functions/README.md`).
4. Retire client-side-only authentication in favour of the private app's server-side
   sessions.

Detailed findings are tracked privately (private app `docs/SECURITY.md`) rather than
here.

## Reporting a vulnerability

Email **itskaero@gmail.com** with "Security" in the subject. Please do not open a
public issue for security problems.
