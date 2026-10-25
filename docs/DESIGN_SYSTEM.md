# MeritNama design system

Direction: a calm, premium analytics product — deep navy surfaces, one signal colour
(cyan), restrained amber for warnings — set against the cinematic landing image.
No neon glow, no decorative charts.

References (supplied by the product owner):

- **Public landing** — the "Haven" layout: floating centred pill navigation, a small
  chip above a centred headline, one solid pill CTA plus a text CTA, a "Scroll" cue,
  full-bleed imagery.
- **Application** — the two dark dashboards: a quiet sidebar with a profile card and
  grouped menu (active item is a raised, bordered row), content framed in a large
  rounded panel with a breadcrumb bar, a dark pill on the right of that bar, pill-shaped
  metric cards (small label, large number, small unit), chip lists, and one teal
  gradient feature panel per screen at most.

## Tokens

Canonical file: [`assets/css/tokens.css`](../assets/css/tokens.css).
The private app keeps a byte-identical copy at `src/styles/tokens.css` and maps it
into Tailwind (`bg-surface`, `text-muted`, `text-signal`, …). Change both together;
the app's `tests/tokens.test.ts` checks contrast on every change.

| Token | Value | Use |
|---|---|---|
| `--mn-navy-950` | `#07111F` | Page background |
| `--mn-navy-900` | `#0E1B2C` | Main surface (cards, panels) |
| `--mn-navy-800` | `#14253A` | Elevated surface, table headers |
| `--mn-navy-700` | `#1B3049` | Hover / pressed |
| `--mn-border` | `#26394E` | Dividers, card borders |
| `--mn-text` | `#F2F6FC` | Primary text |
| `--mn-text-muted` | `#A8B8CA` | Secondary text |
| `--mn-text-subtle` | `#7D90A6` | Meta text ≥ 12px only |
| `--mn-cyan` | `#42D6D0` | Primary actions, selection, active nav, key highlights |
| `--mn-amber` | `#E8B878` | Warnings, "simulated" labels, sparing distinctions |

Contrast (WCAG 2.x, verified by test): text, muted text, cyan and amber are all
≥ 4.5:1 on every navy surface; `--mn-cyan-ink` on cyan is ≥ 4.5:1.

Typography: **Plus Jakarta Sans** (UI and headings, weights 400–800) and
**IBM Plex Mono** (eyebrows, badges, figures that need alignment). The app
self-hosts both through `next/font`; the public site loads them from Google Fonts.

Spacing is a 4px scale (`--mn-space-1` … `--mn-space-9`). Radii: 6 / 10 / 14px for
controls, 20px (`--mn-radius-xl`) for public cards, 24px for app panels and metric
cards, 28px for the app's framing panel, and pills for navigation, buttons, chips and
badges.

## Data provenance labels

Every figure that could be mistaken for an official result carries a label:

| Badge | Meaning |
|---|---|
| **Historical** (neutral) | From a published merit list or gazette for a completed round |
| **Current** (cyan) | From the induction in progress; may change |
| **Simulated** (amber) | Produced by MeritNama's model; never an official decision |

Never show a made-up number. When data does not exist yet, render an em dash with
"Available after data import" (app `Metric value={null}`).

## Components

| Component | Public site (`site.css`) | App (`src/components/ui`) |
|---|---|---|
| Navigation + mobile menu | Floating pill `.nav`, dropdown panel < 860px | `SideNav`: profile card, grouped items with icons, drawer < 1024px (Escape closes) |
| Layout / containers | `.container`, `.section`, `.split` | `AppShell` (framed panel), `PageHeader` (breadcrumb bar + status pill + title) |
| Chips | `.chip` (hero), `.chips` | Planned-scope chip list, `StatusPill` |
| Buttons | `.btn-primary/secondary/ghost` | `Button`, `ButtonLink` |
| Cards / metrics | `.card`, `.snapshot` | `Card`, `Metric` |
| Badges | `.badge-historical/current/simulated` | `Badge tone=…` |
| Notices | `.callout`, `.app-status` | `Notice` |
| Tables | — | `DataTable` (captioned, scrollable) |
| Empty / loading | — | `EmptyState`, `Skeleton` |
| FAQ | native `<details>` | — |

Planned with the admin and candidate MVPs (built when a real screen needs them, not
before): form inputs with validation messages, search/sort/filter/pagination for
`DataTable`, tabs and segmented controls, dialogs and drawers with confirmation flows,
toasts, charts, audit-history timeline.

### Charts

Use a chart only when it answers a question better than a table (trend of a cutoff
across years, seat counts over time). Cyan for the candidate's own series, neutral
greys for comparison series, amber reserved for simulated values. Always provide the
underlying numbers in an accessible table.

## Accessibility and motion

- Visible focus ring on every interactive element (`--mn-focus-ring`).
- Skip link on every page; landmarks (`header`, `nav`, `main`, `footer`).
- Touch targets ≥ 44px; no horizontal scroll at 360px width.
- `prefers-reduced-motion` sets `--mn-duration: 0ms` and disables smooth scroll.

## Landing background

Source: the supplied generated image (no embedded text, logos or numbers), kept at
`assets/images/source/meritnama-hero-source.png` (excluded from the Pages deploy).

| File | Size | Use |
|---|---|---|
| `assets/images/meritnama-hero.webp` | 1536×1024, ~76 KB | Desktop |
| `assets/images/meritnama-hero-960.webp` | 960×640, ~35 KB | ≤ 760px |
| `assets/images/meritnama-hero.jpg` | 1536×1024, ~128 KB | No-WebP fallback, social preview |

Applied in `.hero` with `background-size: cover`, a solid navy fallback colour, a
soft elliptical vignette behind the centred copy (fading to the page colour at the
bottom) on desktop and a top-to-bottom gradient on mobile, and a different focal
point per breakpoint. Static image — nothing to reduce for motion.
