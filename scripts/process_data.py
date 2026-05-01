"""
Residency Induction Merit Intelligence - Data Pipeline
Processes officialMeritList data to generate static JSON files for the frontend.

Usage:
    python process_data.py

Source of truth for scoring policy:
    ../data/scoring_policy.json   ← edit THIS file to update calculator/policy,
                                    then re-run this script to regenerate outputs.

Outputs (in ../data/):
    closing_merit.json      - Raw closing merit per year/program/quota/specialty/hospital
    normalized_merit.json   - Percentile-normalized closing merit (cross-year comparable)
    trends.json             - Per specialty+hospital trend data (avg, stddev, yearly)
    specialty_ranking.json  - Specialty competitiveness ranking per program
    flat_lookup.json        - Flat array of all trend records (fast frontend access)
    policy_impact.json      - Per-year distribution stats showing how policy changes affected merit

NOTE: scoring_policy.json is NOT overwritten by this script.  It is the source of
truth and must be edited directly when policies change.
"""

import json
import os
import math
from pathlib import Path
from collections import defaultdict

# ---------------------------------------------------------------------------
# PATHS
# ---------------------------------------------------------------------------
BASE_DIR   = Path(__file__).resolve().parent.parent  # workspace root (meritnama/)
MERIT_DIR  = BASE_DIR / "officialMeritList"
GAZETTE_DIR = BASE_DIR / "officialGazette"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"
SCORING_POLICY_PATH = Path(__file__).resolve().parent.parent / "data" / "scoring_policy.json"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# LOAD SCORING POLICY (single source of truth — edit ../data/scoring_policy.json)
# ---------------------------------------------------------------------------

def _load_scoring_policy() -> dict:
    """Load scoring_policy.json.  Aborts with a clear error if missing."""
    if not SCORING_POLICY_PATH.exists():
        raise FileNotFoundError(
            f"scoring_policy.json not found at {SCORING_POLICY_PATH}\n"
            "Create or restore the file before running the pipeline."
        )
    with open(SCORING_POLICY_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


# Loaded once at module level so all functions can reference it.
SCORING_POLICY = _load_scoring_policy()

# Map calendar year → maximum total marks for that year's dominant induction.
# Derived from scoring_policy.json → year_total_max (preferred) or policies block.
YEAR_TOTAL_MAX: dict[int, float] = {}
if "year_total_max" in SCORING_POLICY:
    for _yr, _mx in SCORING_POLICY["year_total_max"].items():
        YEAR_TOTAL_MAX[int(_yr)] = float(_mx)
else:
    for _pk, _pol in SCORING_POLICY.get("policies", {}).items():
        try:
            YEAR_TOTAL_MAX[int(_pk.split("-")[0])] = float(_pol["total_marks"])
        except (ValueError, KeyError):
            pass


def _derive_folder_to_year() -> dict[str, int]:
    """
    Build induction-folder → calendar-year mapping from scoring_policy.json.
    Policy induction fields can be int (20), or range string ("17-19").
    e.g. "2025": { "induction": "17-19" } → {"17": 2025, "18": 2025, "19": 2025}
    """
    mapping: dict[str, int] = {}
    for policy_key, pol in SCORING_POLICY.get("policies", {}).items():
        # base year = first numeric token before any '-' suffix  (e.g. "2026-1" → 2026)
        base_year_str = policy_key.split("-")[0]
        try:
            base_year = int(base_year_str)
        except ValueError:
            continue

        induction = pol.get("induction")
        if induction is None:
            continue
        if isinstance(induction, int):
            nums = [induction]
        elif isinstance(induction, str):
            parts = induction.split("-")
            try:
                start, end = int(parts[0]), int(parts[-1])
                nums = list(range(start, end + 1))
            except ValueError:
                continue
        else:
            continue

        for n in nums:
            mapping[str(n)] = base_year

    return mapping


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def load_json(path: Path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"  [WARN] Could not load {path}: {e}")
        return None


def get_year_from_title(title_path: Path) -> int | None:
    data = load_json(title_path)
    if data and "Year" in data:
        return int(data["Year"])
    return None


def stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(variance)


def percentile_rank(value: float, all_values: list[float]) -> float:
    """Return what percent of values are below `value`."""
    if not all_values:
        return 0.0
    below = sum(1 for v in all_values if v < value)
    return round(below / len(all_values) * 100, 2)


# ---------------------------------------------------------------------------
# STEP 1 - Discover all merit files
# ---------------------------------------------------------------------------

def discover_merit_files():
    """
    Returns list of dicts:
      { year, round, program, path }
    Uses title.json when available, otherwise infers from folder name.
    folder_to_year is derived dynamically from scoring_policy.json induction numbers.
    """
    files = []
    folder_to_year = _derive_folder_to_year()

    for year_dir in sorted(MERIT_DIR.iterdir()):
        if not year_dir.is_dir():
            continue
        year_key = year_dir.name

        for round_dir in sorted(year_dir.iterdir()):
            if not round_dir.is_dir():
                continue
            round_no = round_dir.name  # e.g. round_01

            # Try to get real year from title.json
            title_path = round_dir / "title.json"
            year = get_year_from_title(title_path) if title_path.exists() else None
            if year is None:
                year = folder_to_year.get(year_key)
            if year is None:
                print(f"  [SKIP] Cannot determine year for {round_dir}")
                continue

            for merit_file in round_dir.glob("*_merit.json"):
                program = merit_file.stem.replace("_merit", "").upper()
                files.append({
                    "year": year,
                    "round": round_no,
                    "program": program,
                    "path": merit_file,
                    "year_key": year_key,
                })

    return files


# ---------------------------------------------------------------------------
# STEP 2 - Extract closing merit
# ---------------------------------------------------------------------------

def extract_closing_merit(merit_files):
    """
    Returns closing_merit dict:
      [year][program][quota][specialty][hospital] = {
        closing_merit, seat_count, year, round, program, quota, specialty, hospital
      }
    """
    closing_merit = {}

    for entry in merit_files:
        year = entry["year"]
        round_no = entry["round"]
        program = entry["program"]
        path = entry["path"]

        data = load_json(path)
        if data is None:
            continue

        # The top-level key is program name (e.g. "FCPS", "MS", "MD")
        for prog_key, quotas in data.items():
            if not isinstance(quotas, dict):
                continue
            for quota, specialties in quotas.items():
                if not isinstance(specialties, dict):
                    continue
                for specialty, hospitals in specialties.items():
                    if not isinstance(hospitals, dict):
                        continue
                    for hospital, hosp_data in hospitals.items():
                        if not isinstance(hosp_data, dict):
                            continue

                        candidates = hosp_data.get("candidates", [])
                        if not candidates:
                            continue

                        marks = [
                            float(c["marksTotal"])
                            for c in candidates
                            if isinstance(c.get("marksTotal"), (int, float))
                        ]
                        if not marks:
                            continue

                        closing = min(marks)
                        seat_count = len(marks)

                        # Nested storage
                        y = closing_merit.setdefault(year, {})
                        p = y.setdefault(program, {})
                        q = p.setdefault(quota, {})
                        s = q.setdefault(specialty, {})
                        s[hospital] = {
                            "closing_merit": round(closing, 4),
                            "seat_count": seat_count,
                            "year": year,
                            "round": round_no,
                            "program": program,
                            "quota": quota,
                            "specialty": specialty,
                            "hospital": hospital,
                        }

        print(f"  [OK] {year} {round_no} {program} ({path.name})")

    return closing_merit


# ---------------------------------------------------------------------------
# STEP 3 - Normalize across years (percentile within year+program)
# ---------------------------------------------------------------------------

def normalize_merit(closing_merit):
    """
    For each (year, program), collect all closing merits,
    then compute percentile rank for each entry.
    Returns normalized_merit with same structure but extra fields.
    """
    normalized = {}

    for year, programs in closing_merit.items():
        normalized[year] = {}
        for program, quotas in programs.items():
            # Flatten all closing merits for this year+program
            all_marks = []
            flat_entries = []

            for quota, specialties in quotas.items():
                for specialty, hospitals in specialties.items():
                    for hospital, entry in hospitals.items():
                        all_marks.append(entry["closing_merit"])
                        flat_entries.append((quota, specialty, hospital, entry))

            if not all_marks:
                continue

            min_mark = min(all_marks)
            max_mark = max(all_marks)
            mark_range = max_mark - min_mark if max_mark != min_mark else 1.0

            normalized[year][program] = {}
            for quota, specialty, hospital, entry in flat_entries:
                cm = entry["closing_merit"]
                pct = percentile_rank(cm, all_marks)
                norm_score = round((cm - min_mark) / mark_range * 100, 2)

                q = normalized[year][program].setdefault(quota, {})
                s = q.setdefault(specialty, {})
                s[hospital] = {
                    **entry,
                    "percentile": pct,
                    "normalized_score": norm_score,
                    "year_min": round(min_mark, 4),
                    "year_max": round(max_mark, 4),
                }

    return normalized


# ---------------------------------------------------------------------------
# STEP 4 - Trend data
# ---------------------------------------------------------------------------

def build_trends(closing_merit):
    """
    For each (program, quota, specialty, hospital), collect closing merits
    across all years. Compute avg, stddev, trend direction.
    """
    # Accumulate: key = (program, quota, specialty, hospital)
    accumulator = defaultdict(lambda: {"years": {}, "seat_counts": {}})

    for year, programs in closing_merit.items():
        for program, quotas in programs.items():
            for quota, specialties in quotas.items():
                for specialty, hospitals in specialties.items():
                    for hospital, entry in hospitals.items():
                        key = (program, quota, specialty, hospital)
                        accumulator[key]["years"][year] = entry["closing_merit"]
                        accumulator[key]["seat_counts"][year] = entry["seat_count"]

    trends = {}
    for (program, quota, specialty, hospital), data in accumulator.items():
        year_data = data["years"]
        seat_data = data["seat_counts"]
        marks = list(year_data.values())
        sorted_years = sorted(year_data.keys())

        avg = round(sum(marks) / len(marks), 4)
        sd = round(stddev(marks), 4)
        latest_year = sorted_years[-1]
        latest_merit = year_data[latest_year]

        # Trend direction: compare last 2 years using % of max so thresholds are
        # scale-invariant across policy eras (e.g. 95 → 60 → 30 marks).
        trend = "stable"
        if len(sorted_years) >= 2:
            prev_year = sorted_years[-2]
            prev_max = YEAR_TOTAL_MAX.get(prev_year, 95)
            latest_max = YEAR_TOTAL_MAX.get(latest_year, 95)
            prev_pct = (year_data[prev_year] / prev_max * 100) if prev_max else 0
            latest_pct = (latest_merit / latest_max * 100) if latest_max else 0
            diff_pct = latest_pct - prev_pct
            if diff_pct > 2.0:
                trend = "rising"
            elif diff_pct < -2.0:
                trend = "falling"

        # Volatility: use coefficient of variation (stddev / mean) to be
        # scale-invariant; expressed as % of mean.
        cv = round((sd / avg * 100), 2) if avg else 0.0
        if cv < 3.0:
            volatility = "low"
        elif cv < 8.0:
            volatility = "medium"
        else:
            volatility = "high"

        # Confidence based on data points
        n = len(marks)
        if n >= 4:
            confidence = "high"
        elif n >= 2:
            confidence = "medium"
        else:
            confidence = "low"

        p = trends.setdefault(program, {})
        q = p.setdefault(quota, {})
        s = q.setdefault(specialty, {})
        s[hospital] = {
            "program": program,
            "quota": quota,
            "specialty": specialty,
            "hospital": hospital,
            "yearly_merit": {str(y): v for y, v in sorted(year_data.items())},
            "yearly_seats": {str(y): v for y, v in sorted(seat_data.items())},
            "avg_closing_merit": avg,
            "stddev": sd,
            "latest_merit": round(latest_merit, 4),
            "latest_year": latest_year,
            "trend": trend,
            "volatility": volatility,
            "data_points": n,
            "confidence": confidence,
            # Pre-computed % of max for each year — avoids needing YEAR_TOTAL_MAX in frontend logic
            "yearly_pct_of_max": {
                str(y): round(v / YEAR_TOTAL_MAX[y] * 100, 4)
                for y, v in sorted(year_data.items())
                if y in YEAR_TOTAL_MAX and YEAR_TOTAL_MAX[y]
            },
            # Average % of max across all available years
            "avg_pct_of_max": round(
                sum(
                    v / YEAR_TOTAL_MAX[y] * 100
                    for y, v in year_data.items()
                    if y in YEAR_TOTAL_MAX and YEAR_TOTAL_MAX[y]
                ) / max(1, sum(1 for y in year_data if y in YEAR_TOTAL_MAX and YEAR_TOTAL_MAX[y])),
                4,
            ),
        }

    return trends


# ---------------------------------------------------------------------------
# STEP 5 - Specialty ranking
# ---------------------------------------------------------------------------

def build_specialty_ranking(trends):
    """
    For each (program, quota, specialty), compute:
      - average closing merit across all hospitals
      - volatility
      - competitiveness rank
    """
    specialty_ranking = {}

    for program, quotas in trends.items():
        for quota, specialties in quotas.items():
            for specialty, hospitals in specialties.items():
                all_avg = [h["avg_closing_merit"] for h in hospitals.values()]
                all_sd = [h["stddev"] for h in hospitals.values()]
                all_latest = [h["latest_merit"] for h in hospitals.values()]

                spec_avg = round(sum(all_avg) / len(all_avg), 4)
                spec_sd = round(sum(all_sd) / len(all_sd), 4)
                spec_latest = round(sum(all_latest) / len(all_latest), 4)
                hospital_count = len(hospitals)

                p = specialty_ranking.setdefault(program, {})
                q = p.setdefault(quota, {})
                q[specialty] = {
                    "program": program,
                    "quota": quota,
                    "specialty": specialty,
                    "avg_closing_merit": spec_avg,
                    "latest_avg_closing": spec_latest,
                    "avg_volatility": spec_sd,
                    "hospital_count": hospital_count,
                    "competitiveness": "unknown",  # filled below
                    "rank": 0,  # filled below
                }

    # Rank within each program+quota by avg_closing_merit (desc = more competitive)
    for program, quotas in specialty_ranking.items():
        for quota, specialties in quotas.items():
            sorted_specs = sorted(
                specialties.items(),
                key=lambda x: x[1]["avg_closing_merit"],
                reverse=True,
            )
            n = len(sorted_specs)
            for rank, (spec_name, spec_data) in enumerate(sorted_specs, 1):
                spec_data["rank"] = rank
                pct = (rank - 1) / n if n > 1 else 0
                if pct < 0.25:
                    spec_data["competitiveness"] = "very_high"
                elif pct < 0.50:
                    spec_data["competitiveness"] = "high"
                elif pct < 0.75:
                    spec_data["competitiveness"] = "medium"
                else:
                    spec_data["competitiveness"] = "low"

    return specialty_ranking


# ---------------------------------------------------------------------------
# STEP 6 - Build flat lookup tables for the frontend (faster JS access)
# ---------------------------------------------------------------------------

def build_flat_lookup(closing_merit, trends):
    """
    Flat array of all records for fast JS filtering.
    """
    records = []
    for program, quotas in trends.items():
        for quota, specialties in quotas.items():
            for specialty, hospitals in specialties.items():
                for hospital, data in hospitals.items():
                    records.append(data)
    return records


# ---------------------------------------------------------------------------
# STEP 7 - Add yearly percentiles to flat_lookup records
# ---------------------------------------------------------------------------

def add_yearly_percentiles(flat_records, closing_merit):
    """
    For each flat_lookup record, add yearly_percentile: { "year": percentile }
    Percentile is computed within (year, program) cohort so values are
    comparable across years even when the scoring formula changed.
    """
    # Build (year, program) → list of all closing merits
    year_prog_merits: dict[tuple, list] = defaultdict(list)
    for year, programs in closing_merit.items():
        for program, quotas in programs.items():
            for quota, specs in quotas.items():
                for spec, hospitals in specs.items():
                    for hospital, entry in hospitals.items():
                        year_prog_merits[(year, program)].append(entry["closing_merit"])

    for record in flat_records:
        prog = record["program"]
        yearly_merit = record.get("yearly_merit", {})
        yearly_pct: dict[str, float] = {}
        for year_str, merit_val in yearly_merit.items():
            year = int(year_str)
            all_merits = year_prog_merits.get((year, prog), [])
            if all_merits:
                yearly_pct[year_str] = percentile_rank(merit_val, all_merits)
        record["yearly_percentile"] = yearly_pct

    return flat_records


# ---------------------------------------------------------------------------
# STEP 8 - Per-induction policy impact stats
# ---------------------------------------------------------------------------

def build_policy_impact(closing_merit):
    """
    For each year, compute distribution stats (mean, stddev, p25/50/75, min, max)
    per program. This shows how merit distributions shifted as policies changed.
    """
    impact = {}

    for year, programs in sorted(closing_merit.items()):
        # Get policy info for this year (year key may be int)
        pol_info = SCORING_POLICY["policies"].get(year) or SCORING_POLICY["policies"].get(str(year), {})
        year_entry: dict = {
            "year": year,
            "policy_label": pol_info.get("label", str(year)),
            "policy_notes": pol_info.get("notes", ""),
            "policy_tidbits": pol_info.get("tidbits", []),
            "active_components": [
                c["label"] for c in pol_info.get("components", []) if c.get("included", True)
            ],
            "removed_components": [
                c["label"] for c in pol_info.get("components", []) if not c.get("included", True)
            ],
            "total_marks": pol_info.get("total_marks"),
            "programs": {},
        }

        for program, quotas in programs.items():
            all_merits: list[float] = []
            for quota, specs in quotas.items():
                for spec, hospitals in specs.items():
                    for hospital, entry in hospitals.items():
                        all_merits.append(entry["closing_merit"])

            if not all_merits:
                continue

            all_merits_sorted = sorted(all_merits)
            n = len(all_merits_sorted)
            mean = round(sum(all_merits) / n, 4)
            sd   = round(stddev(all_merits), 4)

            def pct_val(p: float) -> float:
                idx = int(p * (n - 1))
                return round(all_merits_sorted[idx], 4)

            year_entry["programs"][program] = {
                "count":  n,
                "mean":   mean,
                "stddev": sd,
                "min":    round(all_merits_sorted[0],    4),
                "p25":    pct_val(0.25),
                "p50":    pct_val(0.50),
                "p75":    pct_val(0.75),
                "max":    round(all_merits_sorted[-1],   4),
            }

        impact[str(year)] = year_entry

    return impact


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("PRP Merit Intelligence - Data Pipeline")
    print("=" * 60)
    print(f"\nPolicy source: {SCORING_POLICY_PATH}")
    print(f"Active policy: {SCORING_POLICY.get('active_policy', '?')}  |  "
          f"Years in YEAR_TOTAL_MAX: {sorted(YEAR_TOTAL_MAX.keys())}")

    print("\n[1/7] Discovering merit files...")
    merit_files = discover_merit_files()
    print(f"  Found {len(merit_files)} merit files")

    print("\n[2/7] Extracting closing merits...")
    closing_merit = extract_closing_merit(merit_files)

    total_entries = sum(
        1
        for y in closing_merit.values()
        for p in y.values()
        for q in p.values()
        for s in q.values()
        for h in s.values()
    )
    print(f"  Extracted {total_entries} hospital-specialty entries")

    print("\n[3/7] Normalizing merits (percentile within year+program)...")
    normalized_merit = normalize_merit(closing_merit)

    print("\n[4/7] Building trend data...")
    trends = build_trends(closing_merit)

    print("\n[5/7] Building specialty rankings...")
    specialty_ranking = build_specialty_ranking(trends)

    print("\n[6/7] Building flat lookup + yearly percentiles...")
    flat = build_flat_lookup(closing_merit, trends)
    flat = add_yearly_percentiles(flat, closing_merit)

    print("\n[7/7] Building policy impact stats...")
    policy_impact = build_policy_impact(closing_merit)

    print("\n[WRITING] Output files...")

    # closing_merit.json
    out_cm = OUTPUT_DIR / "closing_merit.json"
    with open(out_cm, "w", encoding="utf-8") as f:
        json.dump(closing_merit, f, ensure_ascii=False, indent=2)
    print(f"  Written: {out_cm} ({out_cm.stat().st_size // 1024} KB)")

    # normalized_merit.json
    out_nm = OUTPUT_DIR / "normalized_merit.json"
    with open(out_nm, "w", encoding="utf-8") as f:
        json.dump(normalized_merit, f, ensure_ascii=False, indent=2)
    print(f"  Written: {out_nm} ({out_nm.stat().st_size // 1024} KB)")

    # trends.json
    out_tr = OUTPUT_DIR / "trends.json"
    with open(out_tr, "w", encoding="utf-8") as f:
        json.dump(trends, f, ensure_ascii=False, indent=2)
    print(f"  Written: {out_tr} ({out_tr.stat().st_size // 1024} KB)")

    # specialty_ranking.json
    out_sr = OUTPUT_DIR / "specialty_ranking.json"
    with open(out_sr, "w", encoding="utf-8") as f:
        json.dump(specialty_ranking, f, ensure_ascii=False, indent=2)
    print(f"  Written: {out_sr} ({out_sr.stat().st_size // 1024} KB)")

    # flat_lookup.json (for fast frontend access)
    out_fl = OUTPUT_DIR / "flat_lookup.json"
    with open(out_fl, "w", encoding="utf-8") as f:
        json.dump(flat, f, ensure_ascii=False, indent=2)
    print(f"  Written: {out_fl} ({out_fl.stat().st_size // 1024} KB)")

    # policy_impact.json
    out_pi = OUTPUT_DIR / "policy_impact.json"
    with open(out_pi, "w", encoding="utf-8") as f:
        json.dump(policy_impact, f, ensure_ascii=False, indent=2)
    print(f"  Written: {out_pi} ({out_pi.stat().st_size // 1024} KB)")

    print("\n[DONE] All files generated successfully.")
    print(f"Output directory: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
