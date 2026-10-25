# Implementation roadmap

Incremental migration from the legacy static app (this repo) to the private
`meritNAMA-app`. Each delivery is independently reviewable and leaves production
working. Nothing is ported by rewriting from scratch: the existing pipeline and
engines are the reference, and ports are proven against their outputs.

## Delivery 1 — Scaffold ✅ (this change)

- Repository audit and architecture docs (this folder)
- Public landing page redesign, cinematic background, design tokens
- Configurable app entry URL and availability notice (`site.config.js`)
- Draft privacy policy and terms pages
- Private app: Next.js + TypeScript scaffold, guarded route structure for portal and
  admin, server-side role checks, env validation, PostgreSQL schema + migrations,
  scoring-policy data contract validated against the real `scoring_policy.json`,
  health endpoint, Docker Compose stack, backup/restore scripts, tests

Not done in delivery 1 (deliberately): authentication, any data import, any port of
the scoring or allocation logic.

## Delivery 2 — Data foundations

**Must start with the data-exposure remediation in [SECURITY.md](SECURITY.md).**

- Map every legacy dataset to a contract (zod schema + Postgres table):
  merit lists (`inductions/*/merit`), gazettes (`inductions/*/gazette`),
  `induction21_candidates`, consent rounds, joining status, seats, specialty groups,
  CPSP accreditation, hospital/specialty normalisation from `scripts/process_data.py`
- Canonical identifiers and alias tables for hospitals, specialties, quotas,
  programmes (FCPS, FCPS Dentistry, MS, MD, MDS)
- Versioned dataset imports (source file hash, importer, timestamp) with validation
  reports; restricted files imported from the NAS storage volume, never committed
- Golden-file tests: run the legacy pipeline and engines on frozen inputs, record
  outputs, assert the ported code matches (candidate counts, programme-specific marks,
  preference ordering, seat constraints, simulation placements)
- Port the scoring calculator (`js/app-predict-calc.js`) into a pure, tested module
- Choose and integrate authentication (see app `docs/ARCHITECTURE.md`)

## Delivery 3 — Admin MVP

- Overview with real figures (active induction, dataset versions, counts,
  validation issues, active policy, recent changes, health)
- Candidate search and inspection; controlled corrections that require a reason and
  write audit entries
- Induction browsing: rounds, merit lists, gazette seats, before/after comparisons
- Scoring-policy editor: schema-validated drafts, impact preview through the engine,
  explicit activation, rollback
- Audit history view
- Controlled CSV/JSON import and export
- Background worker for long imports and simulation runs

## Delivery 4 — Candidate MVP

- Secure onboarding: account → verified link to an official record (proof of control
  of the record's registered email, not applicant ID alone)
- Merit profile with component breakdown; official vs. user-entered data separated
- Preference planner: search, filters, ordering, duplicate and eligibility warnings,
  drafts (save, duplicate, rename, compare)
- Simulation using the ported allocation engine, with assumptions and the deciding
  preference shown; saved, comparable runs; every result labelled *Simulated*
- Historical cutoff explorer; candidate score vs. cutoff
- Personal workspace stored server-side and scoped to the account

## Delivery 5 — Hardening and cut-over

- Security tests (authorization matrix per route and data function, upload
  validation, session handling), dependency and container scanning
- Simulation regression suite in CI
- Performance budgets, mobile and accessibility audit
- NAS deployment rehearsal: fresh install, update, rollback, backup restore drill
- Public site: set `appUrl` and `appHealthUrl` to the NAS app, turn off
  `legacySessionRedirect`, remove legacy app pages and datasets from this repository
