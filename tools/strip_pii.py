#!/usr/bin/env python3
"""Remove national ID (CNIC) and phone data from JSON datasets.

Drops CNIC/phone keys, phone-only values under any key, CNICs typed into
name fields, CNIC edits in change logs, and links into the official
portal's admin panel.

Usage:
  python3 tools/strip_pii.py              # strip in place: data/ and inductions/
  python3 tools/strip_pii.py --check      # exit 1 if any file still contains them
  python3 tools/strip_pii.py DIR_OR_FILE  # limit to given paths

Run it on every new upload before committing. The Pages workflow runs --check
and refuses to deploy if these fields come back.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATHS = [ROOT / "data", ROOT / "inductions"]
# Never needed by any public page. Emails and PMDC numbers are still used by the
# legacy app and move to the private app instead (see docs/SECURITY.md).
FIELDS = {"cnic", "CNIC", "contactNumber", "contact_number", "phone", "mobile"}
# Links into the official portal's admin panel (applicant photos, application views).
ADMIN_LINK_FIELDS = {"imgPic"}

# Pakistani CNIC (5-7-1 digits, dashed or plain) and mobile numbers (03xx / +923xx).
CNIC_DASHED = re.compile(r"(?<!\d)\d{5}-\d{7}-\d(?!\d)")
CNIC_PLAIN = re.compile(r"(?<!\d)\d{13}(?!\d)")
MOBILE_ONLY = re.compile(r"^(?:\+?92|0)3\d{2}[- ]?\d{7}$")
# Keys that hold a phone number in the official exports; any digits-only value goes.
PHONE_KEYS = {"number"}
DIGITS_ONLY = re.compile(r"^\+?[\d -]{7,15}$")
# Free-text fields where candidates sometimes typed their CNIC (seen in official data).
TEXT_FIELDS = {"name", "nameFull", "publishedName", "fatherName", "relation", "pmdcNo", "old", "new"}
NEVER_TOUCH = {"pinHash", "emailId", "email"}


def _clean_text(key: str, value: str):
    """Return (new_value, changes). new_value None means drop the key."""
    if key in NEVER_TOUCH:
        return value, 0
    if MOBILE_ONLY.match(value.strip()) or (key in PHONE_KEYS and DIGITS_ONLY.match(value.strip())):
        return None, 1
    changes = 0
    out, n = CNIC_DASHED.subn("", value)
    changes += n
    if key in TEXT_FIELDS:
        out, n = CNIC_PLAIN.subn("", out)
        changes += n
    if changes:
        out = re.sub(r"\s{2,}", " ", out).strip()
    return out, changes


def strip(obj) -> int:
    """Remove CNIC/phone data in place. Returns the number of changes made."""
    removed = 0
    if isinstance(obj, dict):
        for key in [k for k in obj if k in FIELDS or k in ADMIN_LINK_FIELDS]:
            del obj[key]
            removed += 1
        if isinstance(obj.get("view"), str) and "admin-view-application" in obj["view"]:
            del obj["view"]
            obj.pop("pic", None)
            removed += 1
        for key in list(obj):
            value = obj[key]
            if isinstance(value, str):
                new, n = _clean_text(key, value)
                if n:
                    removed += n
                    if new is None:
                        del obj[key]
                    else:
                        obj[key] = new
            else:
                removed += strip(value)
    elif isinstance(obj, list):
        # Change logs record edits as {"field": "cnic", "old": ..., "new": ...}.
        keep = [x for x in obj if not (isinstance(x, dict) and x.get("field") in FIELDS and ("old" in x or "new" in x))]
        removed += len(obj) - len(keep)
        obj[:] = keep
        for item in obj:
            removed += strip(item)
    return removed


def looks_sensitive(text: str) -> bool:
    """Cheap pre-filter before parsing a file."""
    return (
        any(f'"{f}"' in text for f in FIELDS | ADMIN_LINK_FIELDS | PHONE_KEYS)
        or "admin-view-application" in text
        or bool(CNIC_DASHED.search(text) or CNIC_PLAIN.search(text) or re.search(r'"(?:\+?92|0)3\d{2}[- ]?\d{7}"', text))
    )


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
        if not looks_sensitive(text):
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
        print(f"\n{total_fields} CNIC/phone values in {total_files} files. Run: python3 tools/strip_pii.py")
        return 1
    print(f"{'Found' if check else 'Removed'} {total_fields} CNIC/phone values in {total_files} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
