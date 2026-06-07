#!/usr/bin/env python3
"""Strip unused PII from candidate JSON and build email → SHA-256(applicantId) auth index."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CANDIDATE_PATHS = [
    ROOT / "data" / "induction21_candidates.json",
    ROOT / "induction21_candidates.json",
]
OUT_PATH = ROOT / "data" / "candidate_auth_index.json"
STRIP_FIELDS = ("cnic", "contactNumber")


def pin_hash(applicant_id) -> str:
    text = str(applicant_id).strip()
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sanitize_candidates(data: dict) -> tuple[dict, int]:
    """Return sanitized copy and count of stripped field instances."""
    stripped = 0
    out = {}
    for key, cand in data.items():
        if not isinstance(cand, dict):
            out[key] = cand
            continue
        cleaned = dict(cand)
        for field in STRIP_FIELDS:
            if field in cleaned:
                del cleaned[field]
                stripped += 1
        out[key] = cleaned
    return out, stripped


def build_auth_index(data: dict) -> dict:
    by_email: dict[str, dict] = {}
    skipped = 0
    for cand in data.values():
        if not isinstance(cand, dict):
            skipped += 1
            continue
        email = (cand.get("emailId") or "").strip().lower()
        applicant_id = cand.get("applicantId")
        if not email or applicant_id is None:
            skipped += 1
            continue
        by_email[email] = {
            "pinHash": pin_hash(applicant_id),
            "nameFull": (cand.get("nameFull") or "").strip() or None,
        }
    return {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "candidateCount": len(by_email),
        "skipped": skipped,
        "pinNote": "SHA-256 hex of applicantId string; used for candidate login window only",
        "byEmail": dict(sorted(by_email.items())),
    }


def process_file(path: Path) -> dict | None:
    if not path.is_file():
        print(f"Skip missing {path}")
        return None
    print(f"Loading {path} …")
    data = json.loads(path.read_text(encoding="utf-8"))
    sanitized, stripped = sanitize_candidates(data)
    path.write_text(
        json.dumps(sanitized, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  Wrote sanitized JSON ({len(sanitized)} candidates, {stripped} PII fields removed)")
    return sanitized


def main() -> None:
    canonical = None
    for path in CANDIDATE_PATHS:
        result = process_file(path)
        if result is not None and path == CANDIDATE_PATHS[0]:
            canonical = result

    if canonical is None:
        raise SystemExit(f"No candidate file found at {CANDIDATE_PATHS[0]}")

    index = build_auth_index(canonical)
    OUT_PATH.write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"Wrote {OUT_PATH} ({index['candidateCount']} emails, {size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
