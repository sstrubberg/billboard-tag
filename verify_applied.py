"""Confirm every tag the plan proposed is actually present in Lexicon.
Read-only. Compares plan against live library state, tag by tag."""
import csv, sys
from collections import Counter
from pathlib import Path
import requests

LEX = "http://localhost:48624/v1"
PLAN = Path(sys.argv[1] if len(sys.argv) > 1 else "billboard_plan.csv")

def get(path, **params):
    r = requests.get(f"{LEX}{path}", params=params, timeout=60)
    r.raise_for_status()
    b = r.json()
    return b.get("data", b)

tagdoc = get("/tags")
by_id = {t["id"]: (t.get("label") or t.get("name") or "") for t in tagdoc.get("tags", [])}
by_label = {v.lower(): k for k, v in by_id.items()}

live, offset = {}, 0
while True:
    page = get("/tracks", limit=1000, offset=offset)
    rows = page.get("tracks", []) if isinstance(page, dict) else page
    if not rows:
        break
    for t in rows:
        live[t.get("id")] = set(t.get("tags") or [])
    offset += len(rows)
    if len(rows) < 1000:
        break
print(f"library: {len(live)} tracks")

planned = [r for r in csv.DictReader(PLAN.open(encoding="utf-8"))
           if r["apply"] == "1" and r["tags_to_add"].strip()]
print(f"plan:    {len(planned)} tracks marked apply=1\n")

missing_rows, missing_by_tag, expected, confirmed = [], Counter(), 0, 0
absent_tracks = []
for r in planned:
    tid = int(r["track_id"])
    if tid not in live:
        absent_tracks.append(r)
        continue
    want = [l.strip() for l in r["tags_to_add"].split(",") if l.strip()]
    gaps = []
    for lab in want:
        expected += 1
        tid_tag = by_label.get(lab.lower())
        if tid_tag is None:
            gaps.append(f"{lab} (tag missing from Lexicon)")
        elif tid_tag in live[tid]:
            confirmed += 1
        else:
            gaps.append(lab)
            missing_by_tag[lab] += 1
    if gaps:
        missing_rows.append((r, gaps))

print(f"expected tag writes : {expected}")
print(f"confirmed present   : {confirmed}")
print(f"MISSING             : {expected - confirmed}")
print(f"tracks fully done   : {len(planned) - len(missing_rows) - len(absent_tracks)}"
      f" of {len(planned)}")

if absent_tracks:
    print(f"\n{len(absent_tracks)} planned tracks no longer in library:")
    for r in absent_tracks[:10]:
        print(f"   id {r['track_id']}  {r['my_artist']} - {r['my_title'][:40]}")

if missing_by_tag:
    print("\nmissing writes by tag:")
    for t, n in missing_by_tag.most_common():
        print(f"   {t:<32}{n}")
    print("\nfirst 20 affected tracks:")
    for r, gaps in missing_rows[:20]:
        print(f"   id {r['track_id']}  {r['my_artist']} - {r['my_title'][:34]}")
        print(f"      missing: {', '.join(gaps)}")
else:
    print("\nEvery proposed tag is present. Nothing outstanding.")
