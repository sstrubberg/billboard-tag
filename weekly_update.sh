#!/bin/bash
# Weekly refresh + tag pass. Run by launchd, or by hand any time.
#
# Refreshes chart data, matches the library, and applies only EXACT (score 100)
# matches unattended. Anything fuzzy is left in billboard_plan.csv for you to
# review, because an unattended fuzzy match is how a wrong tag gets in.
#
# Safe to run repeatedly - already-tagged tracks are skipped.

set -uo pipefail
cd "$(dirname "$0")"

LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%Y-%m-%d).log"
exec > >(tee -a "$LOG") 2>&1

echo "=================================================="
echo "billboard tag weekly run - $(date)"
echo "=================================================="

# --- venv ---------------------------------------------------------------
if [ ! -d billboard-env ]; then
  echo "creating virtualenv..."
  python3 -m venv billboard-env
  ./billboard-env/bin/pip install -q -r requirements.txt
fi
PY=./billboard-env/bin/python

# --- is Lexicon reachable? ----------------------------------------------
if ! curl -s -o /dev/null -m 5 "http://localhost:48624/v1/tracks?limit=1"; then
  echo "Lexicon API not reachable on :48624."
  echo "Refreshing chart data only; no tagging this run."
  LEXICON_UP=0
else
  LEXICON_UP=1
fi

# --- refresh chart data -------------------------------------------------
# `load` re-pulls the Hot 100 dataset, which updates continuously.
echo
echo "--- refreshing bulk datasets ---"
$PY billboard_tag_v3.py load --refresh

# Scrape-only charts: the progress file means this fetches just the weeks
# added since the last run - normally one or two.
echo
echo "--- fetching new weeks for scrape-only charts ---"
$PY billboard_tag_v3.py fetch --workers 4 --start-year 2024

if [ "$LEXICON_UP" = "0" ]; then
  echo
  echo "done (data only). Start Lexicon and re-run to tag."
  exit 0
fi

# --- match and apply ----------------------------------------------------
echo
echo "--- building plan ---"
$PY billboard_tag_v3.py plan

echo
echo "--- applying exact matches only ---"
$PY billboard_tag_v3.py apply --min-score 100 --yes

# --- what still needs a human -------------------------------------------
echo
REVIEW=$($PY - <<'EOF'
import csv
rows = list(csv.DictReader(open("billboard_plan.csv", encoding="utf-8")))
pending = [r for r in rows if r["action"] == "REVIEW"]
print(len(pending))
for r in pending[:25]:
    print(f"  [{r['score']}] {r['my_artist']} - {r['my_title'][:44]}")
    print(f"        vs {r['billboard_match']}  -> {r['tags_to_add']}")
EOF
)
COUNT=$(echo "$REVIEW" | head -1)
echo "--- $COUNT fuzzy matches need review ---"
echo "$REVIEW" | tail -n +2

if [ "${COUNT:-0}" -gt 0 ]; then
  echo
  echo "Review billboard_plan.csv, then:"
  echo "  $PY billboard_tag_v3.py apply"
  # macOS notification
  osascript -e "display notification \"$COUNT tracks need review\" \
    with title \"Billboard tagging\"" 2>/dev/null || true
fi

# --- publish the refreshed cache --------------------------------------
# The repo is the shared copy: a new machine clones and runs immediately
# instead of scraping for hours.
if [ -d .git ] && [ "${PUSH_CACHE:-1}" = "1" ]; then
  echo
  echo "--- publishing cache to git ---"
  # Committed uncompressed on purpose - git deltas it. See README.
  git add billboard_cache.json billboard_cache.progress.json 2>/dev/null
  if git diff --staged --quiet; then
    echo "no cache change to publish"
  else
    SONGS=$($PY -c 'import json;print(len(json.load(open("billboard_cache.json"))))')
    git commit -q -m "chore: refresh chart cache ($SONGS songs, $(date -u +%Y-%m-%d))"
    if git push -q 2>/dev/null; then
      echo "pushed"
    else
      echo "commit made but push failed - push by hand when convenient"
    fi
  fi
fi

echo
echo "finished $(date)"
