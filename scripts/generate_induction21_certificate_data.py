"""Generate Induction 21 component and certificate sidecar datasets.

The runtime remains backward-compatible: existing candidate programme fields are
preserved, while authoritative Gazette components and factual certificate rows
are added for certificate-aware simulation scoring.
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DEFAULT_CANDIDATES = DATA_DIR / "induction21_candidates.json"
DEFAULT_COMPONENTS_OUT = DATA_DIR / "induction21_components.json"
DEFAULT_CERTIFICATES_OUT = DATA_DIR / "induction21_certificates.json"

COMPONENT_FIELDS = (
    "degree",
    "houseJob",
    "position",
    "mdcat",
    "experience",
    "research",
    "hardAreas",
    "attempts",
    "marksTotal",
)

MSMD_PROGRAMS = {"MS", "MD", "MDS"}


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def as_float(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def clean_string(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def parse_attempt(value: Any) -> int | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    if "more" in text and "3" in text:
        return 4
    if text[0].isdigit():
        return int(text[0])
    return None


def parse_date(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def session_label(program: str, passing_date: str | None) -> str | None:
    dt = parse_date(passing_date)
    if not dt:
        return passing_date
    if program in MSMD_PROGRAMS:
        return dt.strftime("%B %Y")
    return str(dt.year)


def build_components(gazette_csv: Path) -> dict[str, dict[str, float]]:
    components: dict[str, dict[str, float]] = {}
    with gazette_csv.open("r", encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            applicant_id = clean_string(row.get("applicantId"))
            if not applicant_id:
                continue
            degree = as_float(row.get("degree"))
            house_job = as_float(row.get("houseJob"))
            position = as_float(row.get("position"))
            marks_total = as_float(row.get("marksTotal"))
            # The Gazette export does not expose MDCAT as a named column. In the
            # current Induction 21 formula, the residual after degree/house job/
            # position is MDCAT.
            mdcat = marks_total - degree - house_job - position
            components[applicant_id] = {
                "degree": degree,
                "houseJob": house_job,
                "position": position,
                "mdcat": round(mdcat, 6),
                "experience": as_float(row.get("experience")),
                "research": as_float(row.get("research")),
                "hardAreas": as_float(row.get("hardArea")),
                "attempts": as_float(row.get("attempts")),
                "marksTotal": marks_total,
            }
    return components


def legacy_percentage(candidates: dict[str, Any], applicant_id: str, program: str) -> float | None:
    candidate = candidates.get(applicant_id) or {}
    raw = (candidate.get("programPercentage") or {}).get(program)
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def build_certificates(
    certificates_csv: Path,
    candidates: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    by_applicant: dict[str, list[dict[str, Any]]] = {}
    with certificates_csv.open("r", encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            applicant_id = clean_string(row.get("applicantId"))
            program = clean_string(row.get("program"))
            if not applicant_id or not program:
                continue
            specialty = clean_string(row.get("discipline"))
            status = clean_string(row.get("status"))
            reference = clean_string(row.get("reff"))
            passing_date = clean_string(row.get("passingDate"))
            cert: dict[str, Any] = {
                "program": program,
                "specialty": specialty,
                "status": status,
                "session": session_label(program, passing_date),
                "passingDate": passing_date,
                "reference": reference,
            }
            attempt = parse_attempt(reference)
            if attempt is not None:
                cert["attempt"] = attempt
            percentage = legacy_percentage(candidates, applicant_id, program)
            if program in MSMD_PROGRAMS and percentage is not None:
                cert["percentage"] = percentage
            by_applicant.setdefault(applicant_id, []).append(cert)

    for certs in by_applicant.values():
        certs.sort(key=lambda c: (
            str(c.get("program") or ""),
            str(c.get("specialty") or ""),
            str(c.get("passingDate") or ""),
            c.get("attempt") or 99,
        ))
    return by_applicant


def update_candidates(
    candidates: dict[str, Any],
    components: dict[str, dict[str, float]],
    certificates: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    for applicant_id, candidate in candidates.items():
        comp = components.get(str(applicant_id))
        if comp:
            for field in COMPONENT_FIELDS:
                candidate[field] = comp[field]
        candidate["certificates"] = certificates.get(str(applicant_id), [])
    return candidates


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gazette", type=Path, required=True, help="Gazette CSV path")
    parser.add_argument("--certificates", type=Path, required=True, help="Level3 applicant certificate CSV path")
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES, help="Candidate JSON to augment")
    parser.add_argument("--components-out", type=Path, default=DEFAULT_COMPONENTS_OUT)
    parser.add_argument("--certificates-out", type=Path, default=DEFAULT_CERTIFICATES_OUT)
    parser.add_argument("--update-candidates", action="store_true", help="Write augmented candidates JSON")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    candidates = read_json(args.candidates)
    components = build_components(args.gazette)
    certificates = build_certificates(args.certificates, candidates)
    write_json(args.components_out, components)
    write_json(args.certificates_out, certificates)
    if args.update_candidates:
        write_json(args.candidates, update_candidates(candidates, components, certificates))
    print(f"components: {len(components)} -> {args.components_out}")
    print(f"certificate applicants: {len(certificates)} -> {args.certificates_out}")
    if args.update_candidates:
        print(f"updated candidates: {len(candidates)} -> {args.candidates}")


if __name__ == "__main__":
    main()
