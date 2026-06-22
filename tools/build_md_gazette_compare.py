"""Build an Induction 21 MD gazette from local candidate JSON and compare it.

The PHF gazette page can be supplied as a URL or as a downloaded HTML/JSON file.
When the URL is unreachable from the current environment, the script still
writes the local MD gazette and records the fetch error in the comparison report.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import ssl
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CANDIDATES = ROOT / "data" / "induction21_candidates.json"
DEFAULT_POLICY = ROOT / "data" / "induction21_certificate_policy.json"
DEFAULT_OFFICIAL_GAZETTE = ROOT / "inductions" / "21" / "gazette" / "gazette_21.json"
DEFAULT_OUT_JSON = ROOT / "data" / "induction21_md_gazette.json"
DEFAULT_OUT_CSV = ROOT / "data" / "induction21_md_gazette.csv"
DEFAULT_COMPARE_OUT = ROOT / "data" / "induction21_md_gazette_compare.json"
DEFAULT_PHF_URL = "https://prp.phf.gop.pk/en/gazette-list?tp=md&qs=1fcb4ee4-249c-41d7-9500-984d39e085bd"
OFFICIAL_COMPONENT_FIELD_PAIRS = (
    ("degree", "degree"),
    ("houseJob", "houseJob"),
    ("experience", "experience"),
    ("hardArea", "hardArea"),
    ("research", "research"),
    ("position", "position"),
    ("marksTotal", "baseMarksTotal"),
)


def read_json(path: Path) -> Any:
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


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def normalize_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def is_pass(cert: dict[str, Any]) -> bool:
    return normalize_key(cert.get("status")) == "pass"


def is_march_2026(cert: dict[str, Any]) -> bool:
    if normalize_key(cert.get("session")) == "march 2026":
        return True
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", str(cert.get("passingDate") or "").strip())
    return bool(match and int(match.group(2)) == 3 and int(match.group(3)) == 2026)


def md_bonus(candidate: dict[str, Any], cert: dict[str, Any], policy: dict[str, Any]) -> float:
    legacy = as_float((candidate.get("programMarks") or {}).get("MD"))
    cfg = policy.get("msmd") or {}
    if cfg.get("requirePass", True) and not is_pass(cert):
        return legacy
    march_rule = (cfg.get("specialRules") or {}).get("March2026Pass")
    if march_rule is not None and is_march_2026(cert):
        return as_float(march_rule)
    pct = as_float(cert.get("percentage"), default=-1)
    if pct <= 0:
        pct = as_float((candidate.get("programPercentage") or {}).get("MD"), default=-1)
    for rule in cfg.get("percentageMarks") or []:
        if pct >= as_float(rule.get("min"), default=10**9):
            return as_float(rule.get("marks"))
    return legacy


def candidate_is_md(candidate: dict[str, Any]) -> bool:
    if (candidate.get("applied_in") or {}).get("MD"):
        return True
    if candidate.get("preference", {}).get("MD"):
        return True
    return as_float((candidate.get("programMarks") or {}).get("MD")) > 0


def md_certificates(candidate: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        cert for cert in candidate.get("certificates") or []
        if str(cert.get("program") or "").strip().upper() == "MD"
    ]


def build_local_md_gazette(candidates: dict[str, Any], policy: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for applicant_id, candidate in candidates.items():
        if not candidate_is_md(candidate):
            continue
        certs = md_certificates(candidate) or [{
            "program": "MD",
            "specialty": None,
            "status": None,
            "session": None,
            "passingDate": None,
            "percentage": (candidate.get("programPercentage") or {}).get("MD"),
            "reference": None,
        }]
        for cert in certs:
            marks_program = md_bonus(candidate, cert, policy)
            base_total = as_float(candidate.get("marksTotal"))
            rows.append({
                "rowNo": 0,
                "totalCount": 0,
                "typeName": "MD",
                "applicantId": int(applicant_id),
                "nameFull": clean_text(candidate.get("nameFull")),
                "pmdcNo": clean_text(candidate.get("pmdcNo")),
                "specialityName": clean_text(cert.get("specialty")),
                "mdcat": as_float(candidate.get("mdcat")),
                "degree": as_float(candidate.get("degree")),
                "houseJob": as_float(candidate.get("houseJob")),
                "experience": as_float(candidate.get("experience")),
                "hardArea": as_float(candidate.get("hardAreas")),
                "research": as_float(candidate.get("research")),
                "position": as_float(candidate.get("position")),
                "marksProgram": marks_program,
                "baseMarksTotal": base_total,
                "marksTotal": round(base_total + marks_program, 6),
                "programPercentage": cert.get("percentage") if cert.get("percentage") is not None else (candidate.get("programPercentage") or {}).get("MD"),
                "certificateStatus": clean_text(cert.get("status")),
                "session": clean_text(cert.get("session")),
                "passingDate": clean_text(cert.get("passingDate")),
                "reference": clean_text(cert.get("reference")),
            })
    rows.sort(key=lambda r: (-as_float(r.get("marksTotal")), r.get("applicantId"), normalize_key(r.get("specialityName"))))
    total = len(rows)
    for idx, row in enumerate(rows, 1):
        row["rowNo"] = idx
        row["totalCount"] = total
    return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys()) if rows else []
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def read_csv_rows(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._in_table = False
        self._in_row = False
        self._in_cell = False
        self._table: list[list[str]] = []
        self._row: list[str] = []
        self._cell: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self._in_table = True
            self._table = []
        elif self._in_table and tag == "tr":
            self._in_row = True
            self._row = []
        elif self._in_row and tag in {"td", "th"}:
            self._in_cell = True
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._in_cell:
            self._row.append(clean_text(html.unescape("".join(self._cell))))
            self._cell = []
            self._in_cell = False
        elif tag == "tr" and self._in_row:
            if self._row:
                self._table.append(self._row)
            self._row = []
            self._in_row = False
        elif tag == "table" and self._in_table:
            if self._table:
                self.tables.append(self._table)
            self._table = []
            self._in_table = False


def fetch_url(url: str) -> tuple[str | None, str | None]:
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://prp.phf.gop.pk/en/gazette-list",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=30, context=ssl._create_unverified_context()) as resp:
            return resp.read().decode("utf-8", errors="replace"), None
    except Exception as exc:  # noqa: BLE001 - report exact fetch failure to comparison file.
        return None, repr(exc)


def extract_rows_from_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("Table5", "data", "rows", "Table"):
            value = payload.get(key)
            if isinstance(value, list) and value and isinstance(value[0], dict):
                return value
    return []


def parse_remote_text(text: str) -> list[dict[str, Any]]:
    stripped = text.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        return extract_rows_from_payload(json.loads(text))
    parser = TableParser()
    parser.feed(text)
    rows: list[dict[str, Any]] = []
    for table in parser.tables:
        if len(table) < 2:
            continue
        headers = [normalize_key(h).replace(" ", "_") or f"col_{i}" for i, h in enumerate(table[0])]
        if not any("applicant" in h or "pmdc" in h for h in headers):
            continue
        for raw in table[1:]:
            row = {headers[i] if i < len(headers) else f"col_{i}": raw[i] for i in range(len(raw))}
            rows.append(row)
    return rows


def read_remote_rows(remote_file: Path | None, source_url: str | None) -> tuple[list[dict[str, Any]], str | None]:
    if remote_file:
        text = remote_file.read_text(encoding="utf-8")
        return parse_remote_text(text), None
    if not source_url:
        return [], None
    text, error = fetch_url(source_url)
    if error:
        return [], error
    return parse_remote_text(text or ""), None


def row_applicant_id(row: dict[str, Any]) -> str:
    for key in ("applicantId", "applicant_id", "applicantid", "ApplicantId", "applicant"):
        if row.get(key) not in (None, ""):
            match = re.search(r"\d+", str(row.get(key)))
            return match.group(0) if match else str(row.get(key))
    return ""


def row_specialty(row: dict[str, Any]) -> str:
    for key in ("specialityName", "specialtyName", "speciality", "specialty", "discipline", "program"):
        if row.get(key):
            return normalize_key(row.get(key))
    return ""


def compare_rows(local_rows: list[dict[str, Any]], remote_rows: list[dict[str, Any]]) -> dict[str, Any]:
    local_ids = {str(r["applicantId"]) for r in local_rows}
    remote_ids = {row_applicant_id(r) for r in remote_rows if row_applicant_id(r)}
    local_keys = {(str(r["applicantId"]), row_specialty(r)) for r in local_rows}
    remote_keys = {(row_applicant_id(r), row_specialty(r)) for r in remote_rows if row_applicant_id(r)}
    return {
        "localRowCount": len(local_rows),
        "remoteRowCount": len(remote_rows),
        "localApplicantCount": len(local_ids),
        "remoteApplicantCount": len(remote_ids),
        "missingFromRemoteByApplicantId": sorted(local_ids - remote_ids, key=lambda v: int(v) if v.isdigit() else v)[:200],
        "missingFromLocalByApplicantId": sorted(remote_ids - local_ids, key=lambda v: int(v) if v.isdigit() else v)[:200],
        "missingFromRemoteByApplicantSpecialty": sorted(local_keys - remote_keys)[:200] if any(k[1] for k in remote_keys) else [],
        "missingFromLocalByApplicantSpecialty": sorted(remote_keys - local_keys)[:200] if any(k[1] for k in remote_keys) else [],
    }


def compare_official_csv_filtered_to_md(local_rows: list[dict[str, Any]], official_rows: list[dict[str, Any]]) -> dict[str, Any]:
    local_by_id: dict[str, list[dict[str, Any]]] = {}
    for row in local_rows:
        local_by_id.setdefault(str(row.get("applicantId")), []).append(row)
    for rows in local_by_id.values():
        rows.sort(key=lambda r: as_float(r.get("marksTotal")), reverse=True)

    official_by_id = {
        row_applicant_id(row): row
        for row in official_rows
        if row_applicant_id(row)
    }
    md_ids = set(local_by_id)
    official_md = {
        applicant_id: official_by_id[applicant_id]
        for applicant_id in md_ids
        if applicant_id in official_by_id
    }
    missing_from_official = sorted(
        md_ids - set(official_by_id),
        key=lambda v: int(v) if str(v).isdigit() else str(v),
    )

    mismatches = []
    for applicant_id, official in official_md.items():
        generated = local_by_id[applicant_id][0]
        diffs = {}
        for official_field, generated_field in OFFICIAL_COMPONENT_FIELD_PAIRS:
            official_value = as_float(official.get(official_field))
            generated_value = as_float(generated.get(generated_field))
            if abs(official_value - generated_value) > 1e-6:
                diffs[official_field] = {
                    "official": official_value,
                    "generated": generated_value,
                    "delta": round(generated_value - official_value, 6),
                }
        if diffs:
            mismatches.append({
                "applicantId": applicant_id,
                "name": generated.get("nameFull"),
                "diffs": diffs,
            })

    multi_rows = {
        applicant_id: rows
        for applicant_id, rows in local_by_id.items()
        if len(rows) > 1
    }

    return {
        "officialRowsTotal": len(official_rows),
        "generatedMdRows": len(local_rows),
        "generatedMdApplicants": len(local_by_id),
        "officialRowsAfterMdFilter": len(official_md),
        "missingGeneratedMdApplicantsInOfficial": len(missing_from_official),
        "fieldMismatchApplicants": len(mismatches),
        "generatedApplicantsWithMultipleMdRows": len(multi_rows),
        "sampleMissing": missing_from_official[:50],
        "sampleMismatches": mismatches[:50],
        "sampleMultiRows": [
            {
                "applicantId": applicant_id,
                "rows": [
                    {
                        "specialityName": row.get("specialityName"),
                        "marksProgram": row.get("marksProgram"),
                        "marksTotal": row.get("marksTotal"),
                    }
                    for row in rows
                ],
            }
            for applicant_id, rows in sorted(
                multi_rows.items(),
                key=lambda item: int(item[0]) if str(item[0]).isdigit() else str(item[0]),
            )[:20]
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--source-url", default=DEFAULT_PHF_URL)
    parser.add_argument("--remote-file", type=Path, default=None)
    parser.add_argument("--official-csv", type=Path, default=None, help="Official all-programme Gazette CSV; filtered to generated MD applicant IDs before comparison")
    parser.add_argument("--official-gazette", type=Path, default=DEFAULT_OFFICIAL_GAZETTE)
    parser.add_argument("--out-json", type=Path, default=DEFAULT_OUT_JSON)
    parser.add_argument("--out-csv", type=Path, default=DEFAULT_OUT_CSV)
    parser.add_argument("--compare-out", type=Path, default=DEFAULT_COMPARE_OUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    candidates = read_json(args.candidates)
    policy = read_json(args.policy)
    local_rows = build_local_md_gazette(candidates, policy)
    write_json(args.out_json, local_rows)
    write_csv(args.out_csv, local_rows)

    remote_rows, fetch_error = read_remote_rows(args.remote_file, args.source_url)
    comparison = {
        "sourceUrl": args.source_url,
        "remoteFile": str(args.remote_file) if args.remote_file else None,
        "remoteFetchError": fetch_error,
        "comparison": compare_rows(local_rows, remote_rows) if remote_rows else None,
    }
    if args.official_gazette.exists():
      official = read_json(args.official_gazette)
      official_rows = extract_rows_from_payload(official)
      comparison["fallbackOfficialGazetteComparison"] = compare_rows(local_rows, official_rows)
    if args.official_csv and args.official_csv.exists():
      comparison["officialCsvMdFilteredComparison"] = compare_official_csv_filtered_to_md(
          local_rows,
          read_csv_rows(args.official_csv),
      )

    write_json(args.compare_out, comparison)
    print(f"local MD rows: {len(local_rows)} -> {args.out_json}")
    print(f"local MD csv: {args.out_csv}")
    if fetch_error:
        print(f"remote fetch failed: {fetch_error}")
    else:
        print(f"remote rows: {len(remote_rows)}")
    print(f"comparison: {args.compare_out}")


if __name__ == "__main__":
    main()
