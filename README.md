# MeritNama — Maintainer Guide

> **For users:** open `index.html` in a browser — no server needed.  
> **This document is for the person updating the data** after each new induction.

---

## Project layout

```
meritnama/
├── index.html                  ← Single-page app (open this)
├── app.js / charts.js          ← All frontend logic
├── styles.css
│
├── data/                       ← Auto-generated JSON (do NOT edit by hand)
│   ├── flat_lookup.json        ← Main data the app reads
│   ├── scoring_policy.json     ← ✅ EDIT THIS manually when policy changes
│   ├── closing_merit.json
│   ├── normalized_merit.json
│   ├── trends.json
│   ├── specialty_ranking.json
│   ├── policy_impact.json
│   └── current_merit.json      ← Live current-induction data (update manually)
│
├── officialMeritList/          ← Source merit list JSONs
│   └── <induction_number>/
│       ├── round_01/
│       │   ├── title.json
│       │   ├── fcps_merit.json
│       │   ├── ms_merit.json
│       │   └── mdd_merit.json
│       ├── round_02/ …
│       └── round_0N/
│
├── officialGazette/            ← Gazette notification JSONs (seat counts)
│   └── <induction_number>/
│       ├── fcps_gazat.json
│       ├── ms_gazat.json
│       └── …
│
└── scripts/
    ├── process_data.py         ← Main pipeline — run this after adding new data
    ├── extract_policy_pdfs.py  ← Helper to read text from policy PDFs
    ├── render_policy_pages.py
    └── fix_encoding.py         ← Run if you see garbled characters in JSON
```

---

## One-time setup

```powershell
cd "e:\Projects\Coding Projects\meritnama"
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install pdfplumber          # only needed for extract_policy_pdfs.py
```

---

## How to update for a new induction

### Step 1 — Add the merit list files

Create a new folder under `officialMeritList/` named after the **induction number**:

```
officialMeritList/
└── 21/                         ← new induction folder (Induction 21)
    └── round_01/
        ├── title.json          ← metadata (see format below)
        ├── fcps_merit.json
        ├── ms_merit.json
        └── mdd_merit.json
```

**`title.json` format:**
```json
{
  "Authority": "PHF",
  "Year": 2026,
  "Month": "July",
  "Round": "01"
}
```
> `Year` must be the **calendar year** (e.g. `2026`), not the induction number.  
> Add a `title.json` for every round folder — the pipeline reads `Year` from it.

**Merit file format** (same structure already used in Induction 20):
```json
[
  {
    "specialty": "Anaesthesia",
    "hospital": "Lahore General Hospital, Lahore",
    "quota": "Punjab",
    "closing_merit": 23.57,
    "seats": 2
  },
  ...
]
```

Repeat for `round_02`, `round_03` etc. as each round closes.

---

### Step 2 — Add the gazette file (seat counts)

```
officialGazette/
└── 21/
    ├── fcps_gazat.json
    ├── ms_gazat.json
    └── mdd_gazat.json
```

Format matches existing gazette files under `officialGazette/20/`.

---

### Step 3 — Update `scoring_policy.json` if the formula changed

Open `data/scoring_policy.json` and make **all** of the following edits:

#### 3a. Update `active_policy`
Point it to the policy key for the upcoming induction:
```json
"active_policy": "2027"
```
> This controls which policy the **Calculator** and **Predictor** tabs use.

#### 3b. Add the new year to `year_total_max`
```json
"year_total_max": {
  ...
  "2026": 35,
  "2027": 30
}
```
> `year_total_max` drives the **% of max** normalisation for historical data rows.  
> Use the marks for the **dominant induction** of that calendar year.

#### 3c. Add the induction to `_induction_max`
```json
"_induction_max": {
  ...
  "21": 30,
  "22": 30
}
```
> This is the **per-induction override** used when two inductions share a calendar year.  
> Always keep this in sync. The JS reads `row.yearly_induction[year]` first, then falls back to `year_total_max`.

#### 3d. Add a new policy block
```json
"policies": {
  ...
  "2027": {
    "label": "2027 (Induction 22 – July 2027)",
    "induction": 22,
    "total_marks": 30,
    "policy_ref": "SO(ME-I) notification dated ...",
    "components": [ ... ],
    "notes": "...",
    "tidbits": [ ... ]
  }
}
```
> Copy the `"2026"` block as a template. Update `label`, `induction`, `total_marks`, and `components`.  
> If **two inductions happen in one calendar year** (like 2026 had Ind 20 and 21):
> - Key the first as `"2027-1"` and the second as `"2027"`
> - `active_policy` should point to `"2027"` (the upcoming one)
> - `year_total_max["2027"]` should use the **first** induction's marks (the one with historical data)

---

### Step 4 — Run the pipeline

```powershell
cd "e:\Projects\Coding Projects\meritnama"
.venv\Scripts\Activate.ps1
python scripts/process_data.py
```

This regenerates all files in `data/` (except `scoring_policy.json` and `current_merit.json`).  
Watch the console output — it prints warnings for missing files or unrecognised hospitals.

---

### Step 5 — Update `current_merit.json` during live rounds

While an induction is in progress, manually maintain `data/current_merit.json` to power the **Current Merit** tab. Format:

```json
[
  {
    "specialty": "Anaesthesia",
    "hospital": "Lahore General Hospital, Lahore",
    "program": "FCPS",
    "quota": "Punjab",
    "round": 1,
    "opening_merit": 22.5,
    "closing_merit": 24.1,
    "seats": 2,
    "status": "open"
  }
]
```

---

### Step 6 — Verify in browser

Open `index.html`. Check:
- [ ] **Merit Table** shows the new induction year column
- [ ] **% of Max** values for the new year look reasonable (not >100%, not all 0%)
- [ ] **My Prediction** calculator uses the new `total_marks`
- [ ] The **Policy** tab shows the new policy block
- [ ] The **Current Merit** tab reflects live data if applicable

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| New year column missing in Merit Table | `title.json` has wrong `Year` or folder not discovered | Check `title.json` in every round folder |
| `% of max` > 100% for new year | `year_total_max` is too low | Update `year_total_max` in `scoring_policy.json` |
| Same hospital in Safe **and** Reach | No quota selected in Predictor | Expected — the app shows a warning. Select a quota. |
| Calculator uses wrong total marks | `active_policy` points to wrong key | Set `active_policy` to the current upcoming induction's key |
| Two inductions share a year and one is wrong | `_induction_max` not updated | Add both induction numbers to `_induction_max` |
| Garbled characters in JSON | Encoding issue from copy-paste | Run `python scripts/fix_encoding.py` |

---

## Key files to never overwrite manually

| File | Reason |
|---|---|
| `data/scoring_policy.json` | Source of truth — the pipeline reads it, never writes it |
| `data/current_merit.json` | Manually maintained live data — pipeline does not touch it |

---

## Contact

Built by [@itskaero](https://github.com/itskaero) · itskaero@gmail.com  
Originally derived from **prpdatastat** (live API approach) — now purely trend-based from official PHF gazette and merit list publications.
