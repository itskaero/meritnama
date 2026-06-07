#!/usr/bin/env python3
"""Build data/candidates_changes.json from old vs new induction21 candidate snapshots."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OLD_PATH = ROOT / "data" / "old-induction21_candidates.json"
NEW_PATH = ROOT / "data" / "induction21_candidates.json"
OUT_PATH = ROOT / "data" / "candidates_changes.json"

# Excluded from diffs: emailId, pmdcNo, contactNumber (private contact / registration data)
SCALAR_KEYS = [
    "nameFull",
    "programMarks",
    "applied_in",
    "degree",
    "houseJob",
    "experience",
    "research",
    "position",
    "hardAreas",
    "matric",
    "fsc",
    "attempts",
    "mdcat",
    "marksTotal",
    "scrutiny",
]

PREF_ITEM_KEYS = [
    "preferenceNo",
    "quotaName",
    "typeName",
    "specialityName",
    "instituteName",
    "hospitalName",
    "marks",
    "parentInstitute",
]


def pref_key(item: dict) -> tuple:
    return (
        item.get("preferenceNo"),
        item.get("quotaName"),
        item.get("specialityName"),
        item.get("hospitalName"),
    )


def diff_preferences(old_pref: dict | None, new_pref: dict | None) -> list[dict]:
    old_pref = old_pref or {}
    new_pref = new_pref or {}
    changes: list[dict] = []
    all_programs = sorted(set(old_pref) | set(new_pref))

    for program in all_programs:
        old_list = old_pref.get(program) or []
        new_list = new_pref.get(program) or []
        if old_list == new_list:
            continue

        old_by_no = {p.get("preferenceNo"): p for p in old_list if p.get("preferenceNo") is not None}
        new_by_no = {p.get("preferenceNo"): p for p in new_list if p.get("preferenceNo") is not None}
        old_nos = set(old_by_no)
        new_nos = set(new_by_no)

        for no in sorted(old_nos - new_nos):
            changes.append(
                {
                    "program": program,
                    "kind": "removed",
                    "preferenceNo": no,
                    "old": {k: old_by_no[no].get(k) for k in PREF_ITEM_KEYS if k in old_by_no[no]},
                }
            )
        for no in sorted(new_nos - old_nos):
            changes.append(
                {
                    "program": program,
                    "kind": "added",
                    "preferenceNo": no,
                    "new": {k: new_by_no[no].get(k) for k in PREF_ITEM_KEYS if k in new_by_no[no]},
                }
            )
        for no in sorted(old_nos & new_nos):
            o, n = old_by_no[no], new_by_no[no]
            field_changes = []
            for k in PREF_ITEM_KEYS:
                if o.get(k) != n.get(k):
                    field_changes.append({"field": k, "old": o.get(k), "new": n.get(k)})
            if field_changes:
                changes.append(
                    {
                        "program": program,
                        "kind": "modified",
                        "preferenceNo": no,
                        "fields": field_changes,
                    }
                )

        if not changes or (len(old_list) != len(new_list) and not (old_nos ^ new_nos)):
            if len(old_list) != len(new_list):
                changes.append(
                    {
                        "program": program,
                        "kind": "count",
                        "oldCount": len(old_list),
                        "newCount": len(new_list),
                    }
                )

    return changes


def scalar_changes(old: dict, new: dict) -> list[dict]:
    out = []
    for key in SCALAR_KEYS:
        ov, nv = old.get(key), new.get(key)
        if ov != nv:
            out.append({"field": key, "old": ov, "new": nv})
    return out


def build_entry(status: str, old: dict | None, new: dict | None) -> dict:
    record = new if new is not None else old
    entry: dict = {
        "applicantId": record.get("applicantId"),
        "nameFull": (record.get("nameFull") or "").strip() or None,
        "status": status,
        "fields": [],
        "preferences": [],
    }
    if status == "added":
        entry["fields"] = [{"field": "_record", "old": None, "new": "new applicant"}]
        return entry
    if status == "removed":
        entry["fields"] = [{"field": "_record", "old": "removed", "new": None}]
        return entry

    entry["fields"] = scalar_changes(old, new)
    entry["preferences"] = diff_preferences(old.get("preference"), new.get("preference"))
    return entry


def main() -> None:
    if not OLD_PATH.is_file():
        raise SystemExit(f"Missing {OLD_PATH}")
    if not NEW_PATH.is_file():
        raise SystemExit(f"Missing {NEW_PATH}")

    old_data = json.loads(OLD_PATH.read_text(encoding="utf-8"))
    new_data = json.loads(NEW_PATH.read_text(encoding="utf-8"))

    old_ids = set(old_data)
    new_ids = set(new_data)
    candidates = []

    for key in sorted(new_ids - old_ids, key=lambda x: int(x)):
        candidates.append(build_entry("added", None, new_data[key]))

    for key in sorted(old_ids - new_ids, key=lambda x: int(x)):
        candidates.append(build_entry("removed", old_data[key], None))

    for key in sorted(old_ids & new_ids, key=lambda x: int(x)):
        o, n = old_data[key], new_data[key]
        if o == n:
            continue
        candidates.append(build_entry("changed", o, n))

    candidates.sort(key=lambda c: (c["status"] != "changed", c.get("applicantId") or 0))

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "oldSource": "data/old-induction21_candidates.json",
        "newSource": "data/induction21_candidates.json",
        "summary": {
            "oldCount": len(old_data),
            "newCount": len(new_data),
            "added": len(new_ids - old_ids),
            "removed": len(old_ids - new_ids),
            "changed": sum(1 for k in old_ids & new_ids if old_data[k] != new_data[k]),
            "totalUpdates": len(candidates),
        },
        "candidates": candidates,
    }

    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(candidates)} updates)")


if __name__ == "__main__":
    main()
