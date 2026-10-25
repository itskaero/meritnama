# Purging CNIC and phone data from git history

The current files are clean, but every earlier commit still contains national ID
(CNIC) numbers and phone numbers. Anyone can fetch them from history. This runbook
rewrites history so those values no longer exist in any branch.

**Tested (25 Oct 2026)** on a full mirror of this repository: 207 file versions
rewritten, 470,240 values removed, 0 left. Only data files changed — no code, pages
or images — and login hashes in `candidate_auth_index.json` were untouched.

## What gets removed

From every version of every JSON file: CNIC and phone keys; phone-only values under
any key (e.g. `number` in consent rounds); CNICs typed into name fields; CNIC edits in
change logs; links into the official portal's admin panel (`imgPic`, `view`).
From CSV exports: CNIC and mobile numbers. From other text files: dashed CNICs.

Emails and PMDC numbers are **not** removed (the legacy app still needs them).

## Before you start

- Merge PR #54 first, so `main` already has the clean files and the guard workflow.
- Tell anyone who has cloned the repo: after the purge their clone is stale and must
  be re-cloned, not pulled. Open PRs from old branches must be recreated.
- Pause pushes to the repository until you finish.

## Steps (Windows PowerShell; same commands work in a macOS/Linux terminal)

```powershell
pip install git-filter-repo
cd $HOME
git clone --mirror https://github.com/itskaero/meritnama meritnama-purge.git

# Get the script from the up-to-date repo (after PR #54 is merged):
git clone https://github.com/itskaero/meritnama meritnama-tools

# 1. Dry run: rewrites the mirror locally and verifies. Pushes nothing. ~3–5 min.
python meritnama-tools/tools/purge_pii_history.py meritnama-purge.git
```

You should see `file versions still holding CNIC/phone data: 0` and
`Dry run complete`. If verification fails, stop and send me the output.

```powershell
# 2. Publish: force-pushes every branch and tag.
python meritnama-tools/tools/purge_pii_history.py meritnama-purge.git --push
```

Running it again on the already-rewritten mirror is safe (it finds nothing to change).
If you prefer to keep the dry-run result, just push it:
`git -C meritnama-purge.git push --force --all origin` and `--tags`.

## After pushing

1. **Contact GitHub Support** (https://support.github.com/contact → "Remove sensitive
   data"). Ask them to remove cached views and dereference old commits for
   `itskaero/meritnama`. Pull-request refs (`refs/pull/1` … `refs/pull/54`) are
   read-only for you and still point at the old commits until Support removes them.
   Mention that the data is national ID and phone numbers of medical candidates.
2. **Forks**: check `https://github.com/itskaero/meritnama/network/members`. Forks
   keep their own copy; ask owners to delete them, or report them to Support.
3. **Re-clone everywhere** (your PC, any server, this tool's sessions). Delete old
   clones; do not `git pull` into them, or the old history comes back on the next push.
4. **Published site**: GitHub Pages only serves the latest deploy, but earlier deploys
   served the merit lists and gazettes with these fields. Search engines and archive
   services may have copies; request removal where you find them.
5. **Keep it clean**: run `python tools/strip_pii.py` on every new data upload before
   committing. The *PII guard* workflow fails any push that adds these fields back,
   and the deploy strips them from the published copy regardless.

## What this does not fix

- People who already downloaded the data keep it. Treat it as exposed.
- Emails, PMDC numbers and names remain in the repository until the legacy app's
  candidate data moves to the private app.
- The Firestore access rules are a separate fix (see docs/SECURITY.md).
