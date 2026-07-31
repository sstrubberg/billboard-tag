#!/usr/bin/env python3
"""view_changelog.py — open the Lexicon plugin's changelog.log in your
default text app, instead of the in-app "View Billboard Changelog" action.

That action shows the same content via _ui.showInputDialog, which turns
out not to be built for long content - it just keeps expanding instead of
scrolling in a bounded box, so anything past a handful of entries becomes
an unreadable, unbounded wall of text. Opening the raw file avoids
Lexicon's UI entirely.

    python view_changelog.py                       # default plugin location
    python view_changelog.py --path /custom/path
"""

import argparse
import subprocess
import sys
from pathlib import Path

DEFAULT_PATH = Path.home() / "Documents/Lexicon/Plugins/billboardtag/Files/changelog.log"

p = argparse.ArgumentParser()
p.add_argument("--path", type=Path, default=DEFAULT_PATH,
               help="alternate changelog.log location")
a = p.parse_args()

if not a.path.exists():
    sys.exit(f"no changelog at {a.path} - run the plugin's "
             f"'Review and Apply Billboard Tags' action at least once first")

# macOS only, matching the rest of this repo's tooling (launchd plist, etc).
subprocess.run(["open", str(a.path)])
