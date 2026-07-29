"""Carve a 10-track sample out of billboard_plan.csv for a trial apply."""
import csv
from pathlib import Path

SRC, OUT, N = Path("billboard_plan.csv"), Path("sample_plan.csv"), 10

rows = list(csv.DictReader(SRC.open(encoding="utf-8")))
cand = [r for r in rows if r["apply"] == "1" and r["tags_to_add"].strip()]

def ntags(r):
    return len([x for x in r["tags_to_add"].split(", ") if x])

# Spread across tag counts; prefer tracks that already have tags, so the
# sample proves the merge preserves them.
cand.sort(key=lambda r: (-ntags(r), -len(r["all_tags_now"])))
buckets, picked = {}, []
for r in cand:
    buckets.setdefault(min(ntags(r), 5), []).append(r)
i = 0
while len(picked) < min(N, len(cand)):
    for k in sorted(buckets, reverse=True):
        if i < len(buckets[k]) and len(picked) < N:
            picked.append(buckets[k][i])
    i += 1

with OUT.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys())
    w.writeheader()
    w.writerows(picked)

print(f"{OUT}  ->  {len(picked)} tracks, "
      f"{sum(ntags(r) for r in picked)} tag writes\n")
for r in picked:
    print(f"  id {r['track_id']:<6} +{ntags(r)}  {r['my_artist']} - {r['my_title'][:36]}")
    print(f"       adding: {r['tags_to_add']}")
    print(f"       has:    {r['all_tags_now'][:76]}")
