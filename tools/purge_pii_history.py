#!/usr/bin/env python3
"""Rewrite ALL git history to drop CNIC and phone fields from every JSON file.

DESTRUCTIVE once pushed: every commit hash changes, all existing clones and
forks go stale, and open pull requests must be recreated. Read
docs/HISTORY_PURGE.md first.

Requirements: Python 3.9+, git, and `pip install git-filter-repo`.
Works on Windows (PowerShell), macOS and Linux.

Usage (run OUTSIDE your normal working copy):
  git clone --mirror https://github.com/itskaero/meritnama meritnama-purge.git
  python3 meritnama/tools/purge_pii_history.py meritnama-purge.git            # rewrite + verify, no push
  python3 meritnama/tools/purge_pii_history.py meritnama-purge.git --push     # then force-push branches and tags
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from strip_pii import CNIC_DASHED, CNIC_PLAIN, detect_indent, looks_sensitive, strip  # noqa: E402

MOBILE_ANY = re.compile(r"(?<!\d)(?:\+?92|0)3\d{2}[- ]?\d{7}(?!\d)")


def looks_like_csv(text: str) -> bool:
    """Plain/undashed numbers are only redacted in tabular exports, never in code
    (JavaScript millisecond timestamps are also 13 digits)."""
    first = text.split("\n", 1)[0]
    return first.count(",") >= 3 and not any(c in first for c in "<>{}();=")


def clean_blob(data: bytes):
    """Return (new_bytes, changes) for one file version; (data, 0) if untouched."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data, 0  # binary (images, video)
    try:
        obj = json.loads(text)
    except ValueError:
        obj = None
    if obj is not None and isinstance(obj, (dict, list)):
        if not looks_sensitive(text):
            return data, 0
        removed = strip(obj)
        if not removed:
            return data, 0
        indent = detect_indent(text)
        out = json.dumps(obj, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))
        return (out + ("\n" if text.endswith("\n") else "")).encode("utf-8"), removed
    # Non-JSON text (CSV exports, generated HTML reports): redact the values themselves.
    out, n = CNIC_DASHED.subn("#####-#######-#", text)
    if looks_like_csv(text):
        out, n2 = CNIC_PLAIN.subn("#############", out)
        out, n3 = MOBILE_ANY.subn("03#########", out)
        n += n2 + n3
    return (out.encode("utf-8"), n) if n else (data, 0)


def git(repo: Path, *args: str, **kw) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, **kw).stdout


def rewrite(repo: Path) -> None:
    try:
        import git_filter_repo as fr
    except ImportError:
        sys.exit("git-filter-repo is not installed: pip install git-filter-repo")

    stats = {"blobs": 0, "fields": 0}

    def blob_callback(blob, _metadata):
        new, removed = clean_blob(blob.data)
        if removed:
            blob.data = new
            stats["blobs"] += 1
            stats["fields"] += removed

    # Pull-request refs are read-only on GitHub; leave them out of the rewrite.
    for ref in git(repo, "for-each-ref", "--format=%(refname)", "refs/pull/").split():
        git(repo, "update-ref", "-d", ref)

    origin = subprocess.run(["git", "-C", str(repo), "remote", "get-url", "origin"], capture_output=True, text=True).stdout.strip()
    args = fr.FilteringOptions.parse_args(["--force", "--quiet"])
    original_cwd = Path.cwd()
    try:
        os.chdir(repo)
        fr.RepoFilter(args, blob_callback=blob_callback).run()
    finally:
        os.chdir(original_cwd)
    # git-filter-repo removes `origin` as a safety measure; restore it for the push step.
    if origin and not subprocess.run(["git", "-C", str(repo), "remote", "get-url", "origin"], capture_output=True).stdout:
        git(repo, "remote", "add", "origin", origin)
    print(f"Rewrote {stats['blobs']} JSON blob versions, removing {stats['fields']} fields.")


def verify(repo: Path) -> bool:
    """Re-scan every file version reachable from branches and tags."""
    lines = git(repo, "rev-list", "--objects", "--all").splitlines()
    paths = {ln.split(" ", 1)[0]: (ln.split(" ", 1)[1] if " " in ln else "") for ln in lines if ln}
    proc = subprocess.run(
        ["git", "-C", str(repo), "cat-file", "--batch"],
        input="\n".join(paths).encode() + b"\n", capture_output=True, check=True,
    )
    out, pos, bad = proc.stdout, 0, []
    while pos < len(out):
        header_end = out.index(b"\n", pos)
        sha, kind, size = out[pos:header_end].split(b" ")
        start = header_end + 1
        body = out[start:start + int(size)]
        pos = start + int(size) + 1
        if kind == b"blob":
            _, remaining = clean_blob(body)
            if remaining:
                bad.append(f"{paths.get(sha.decode(), '?')} ({remaining})")
    print(f"Verify: {len(paths)} objects scanned; file versions still holding CNIC/phone data: {len(bad)}")
    for item in sorted(set(bad))[:50]:
        print("  ", item)
    return not bad


def push(repo: Path) -> None:
    git(repo, "push", "--force", "--all", "origin")
    git(repo, "push", "--force", "--tags", "origin")
    print("Force-pushed all branches and tags.")


def main(argv: list[str]) -> int:
    if not argv or argv[0].startswith("--"):
        print(__doc__)
        return 2
    repo = Path(argv[0]).resolve()
    if git(repo, "rev-parse", "--is-bare-repository").strip() != "true":
        sys.exit("Run this on a fresh `git clone --mirror`, not on your working copy.")

    rewrite(repo)
    git(repo, "reflog", "expire", "--expire=now", "--all")
    git(repo, "gc", "--prune=now", "--aggressive", "--quiet")
    if not verify(repo):
        print("Verification failed — NOT pushing. Inspect the blobs above before continuing.")
        return 1
    if "--push" in argv:
        push(repo)
        print("Next: follow the 'After pushing' steps in docs/HISTORY_PURGE.md (GitHub Support, re-clone).")
    else:
        print("Dry run complete. Re-run with --push to publish the rewritten history.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
