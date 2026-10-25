#!/usr/bin/env python3
"""Remove national ID and phone fields from JSON datasets.

Usage:
  python3 tools/strip_pii.py              # strip in place: data/ and inductions/
  python3 tools/strip_pii.py --check      # exit 1 if any file still contains them
  python3 tools/strip_pii.py DIR_OR_FILE  # limit to given paths

Run it on every new upload before committing. The Pages workflow runs --check
and refuses to deploy if these fields come back.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATHS = [ROOT / "data", ROOT / "inductions"]
# Never needed by any public page. Emails and PMDC numbers are still used by the
# legacy app and move to the private app instead (see docs/SECURITY.md).
FIELDS = {"cnic", "CNIC", "contactNumber", "contact_number", "phone", "mobile"}


def strip(obj) -> int:
    removed = 0
    if isinstance(obj, dict):
        for key in [k for k in obj if k in FIELDS]:
            del obj[key]
            removed += 1
        for value in obj.values():
            removed += strip(value)
    elif isinstance(obj, list):
        for item in obj:
            removed += strip(item)
    return removed


def detect_indent(text: str):
    """Keep each file's existing style: minified, or the indent of its 2nd line."""
    lines = text.splitlines()
    if len(lines) < 2:
        return None
    second = lines[1]
    return len(second) - len(second.lstrip(" ")) or None


def json_files(paths):
    for p in paths:
        if p.is_file() and p.suffix == ".json":
            yield p
        elif p.is_dir():
            yield from sorted(p.rglob("*.json"))


def main(argv):
    check = "--check" in argv
    args = [Path(a).resolve() for a in argv if not a.startswith("--")]
    total_files = total_fields = 0
    for path in json_files(args or DEFAULT_PATHS):
        text = path.read_text(encoding="utf-8")
        if not any(f'"{f}"' in text for f in FIELDS):
            continue
        data = json.loads(text)
        removed = strip(data)
        if not removed:
            continue
        total_files += 1
        total_fields += removed
        rel = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
        if check:
            print(f"PII fields present: {rel} ({removed})")
            continue
        indent = detect_indent(text)
        out = json.dumps(data, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))
        path.write_text(out + ("\n" if text.endswith("\n") else ""), encoding="utf-8")
        print(f"stripped {removed:>6} fields  {rel}")

    if check and total_files:
        print(f"\n{total_fields} CNIC/phone fields in {total_files} files. Run: python3 tools/strip_pii.py")
        return 1
    print(f"{'Found' if check else 'Removed'} {total_fields} fields in {total_files} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
