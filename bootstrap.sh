#!/bin/bash
# One-command setup on a fresh machine.
#
#   git clone <repo> && cd billboard-tag && ./bootstrap.sh
#
# Creates the venv, installs dependencies, unpacks the shared chart cache,
# and checks that Lexicon is reachable. Safe to re-run.

set -uo pipefail
cd "$(dirname "$0")"

echo "=============================================="
echo " Billboard chart tagging for Lexicon — setup"
echo "=============================================="
echo

# --- python -------------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found."
  echo "  macOS:  brew install python3   (or python.org installer)"
  echo "  Linux:  sudo apt install python3 python3-venv"
  exit 1
fi
echo "python: $(python3 --version)"

VER=$(python3 -c 'import sys; print(f"{sys.version_info[0]}{sys.version_info[1]:02d}")')
if [ "$VER" -lt 309 ]; then
  echo "Python 3.9+ required."
  exit 1
fi

# --- venv ---------------------------------------------------------------
if [ ! -d billboard-env ]; then
  echo "creating virtualenv..."
  python3 -m venv billboard-env
else
  echo "virtualenv already present"
fi
PY=./billboard-env/bin/python
echo "installing dependencies..."
$PY -m pip install -q --upgrade pip
$PY -m pip install -q -r requirements.txt
echo "  done"

# --- chart cache --------------------------------------------------------
echo
if [ -f billboard_cache.json ]; then
  echo "chart cache present: $(du -h billboard_cache.json | cut -f1) — no scraping needed"
else
  echo "no cache in repo. You'll need to build one:"
  echo "    $PY billboard_tag_v3.py load"
  echo "    $PY billboard_tag_v3.py fetch --workers 4    # several hours"
fi

# --- lexicon ------------------------------------------------------------
echo
if curl -s -o /dev/null -m 5 "http://localhost:48624/v1/tracks?limit=1"; then
  echo "Lexicon API: reachable"
  LEX=1
else
  echo "Lexicon API: NOT reachable on :48624"
  echo "  Start Lexicon, then Settings -> Integrations -> enable Local API"
  LEX=0
fi

# --- chart map ----------------------------------------------------------
echo
if [ -f chart_map.json ]; then
  echo "chart_map.json present ($($PY -c '
import json;print(len(json.load(open("chart_map.json"))["charts"]))') charts)"
  echo "  If these tag names are not yours, regenerate:"
  echo "    $PY billboard_tag_v3.py init"
elif [ "$LEX" = "1" ]; then
  echo "no chart_map.json — proposing one from your Lexicon tags:"
  echo
  $PY billboard_tag_v3.py init
fi

# --- launchd ------------------------------------------------------------
echo
if [ "$(uname)" = "Darwin" ]; then
  REPO="$(pwd)"
  sed -e "s|/Users/YOURNAME/billboard-tag|$REPO|g" \
      com.billboardtag.weekly.plist > /tmp/com.billboardtag.weekly.plist
  echo "To schedule the weekly run:"
  echo "    cp /tmp/com.billboardtag.weekly.plist ~/Library/LaunchAgents/"
  echo "    launchctl load ~/Library/LaunchAgents/com.billboardtag.weekly.plist"
  echo "  (paths already rewritten to $REPO)"
fi

echo
echo "=============================================="
echo " Next:"
echo "   source billboard-env/bin/activate"
echo "   python billboard_tag_v3.py charts     # verify chart slugs"
echo "   python billboard_tag_v3.py plan       # read-only"
echo "=============================================="
