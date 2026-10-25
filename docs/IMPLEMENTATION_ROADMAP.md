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

## Additional MVPs (beyond deliveries 1–5)

Most of these reuse code or data that already exists in this repository, so their data
work is largely done. Ranked by value for effort.

| # | MVP | Builds on | Effort | Needs verified accounts |
|---|---|---|---|---|
| 1 | **Induction live tracker + alerts** — stage timeline with countdowns, alerts when a list is published | `induction21_schedule.json`, `notifications.js`, existing push setup | Low–Med | No |
| 2 | **Round-by-round status for each candidate** — consent, upgrade, joining and cutoff movement between rounds | `candidates_changes`, consent rounds, joining status, round-to-round report | Med | Yes |
| 3 | **Policy impact explainer** — a score under the old vs. the new policy; public aggregate charts | `policy_impact.json`, `app-policy-compare.js`, all policies since 2020 | Low | No |
| 4 | **Eligibility and document checklist** — certificate rules, attempt marks, missing-document warnings | `induction21_certificate_policy.json`, FUTURE_FEATURES §3 | Low | No |
| 5 | **Programme comparison** — 2–4 hospital + specialty + quota choices side by side | Historical cutoffs, gazettes, `cpsp_accreditation.json` | Low | No |
| 6 | **Seat watchlist** — alerts when a followed cutoff moves or a seat frees up | #1, #2 | Med | Yes |
| 7 | **Personal merit report (PDF)** — breakdown, safe/target/reach, labelled simulation summary | Candidate MVP, share cards, FUTURE_FEATURES §6 | Low | Yes |
| 8 | **Grievance and verification status** — own record only, plus a guide to filing a grievance | `grievance_verification.json`, `responder_sources.json` | Low–Med | Yes |
| 9 | **Publication monitor (admin)** — detect a new official list, diff it, flag anomalies before release | `induction21_revisions.json`, `build_candidates_changes.py`, pipeline | Med | Admin |
| 10 | **"Plan B" for unplaced candidates** — job listings plus readiness for the next induction | `jobs.json` (check the source's terms, or link out) | Low–Med | No |
| 11 | **Verified hospital profiles and reviews** — moderated ratings from verified trainees | `hospital.html`, review collections, FUTURE_FEATURES §1 | High | Yes |
| 12 | **Mentorship / ask seniors** | `mentors`, `mentorship_requests` collections | High | Yes |

The existing community forum and live chat move into the app as a migration item, with
moderation and server-side rules, not as a new MVP.

### Recommended order

- **Before the next induction window:** #1, #3, #4. Cheap, mostly public or aggregate,
  and they bring people in at peak time.
- **With the candidate MVP (delivery 4):** #2, #5, #7, #8.
- **Alongside the admin MVP (delivery 3):** #9.
- **After hardening (delivery 5):** #6, #10, then #11 and #12 once moderation and
  identity verification exist.

Shared dependencies: #1 and #6 need one email/push notification service in the app;
#2, #8 and #11 depend on the verified candidate-record linking from delivery 2.
Lookups of personal records move behind verified accounts — never by applicant ID alone.
