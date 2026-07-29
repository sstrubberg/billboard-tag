import json, sys
from collections import defaultdict
from pathlib import Path

cache = Path(sys.argv[1] if len(sys.argv) > 1 else "billboard_cache.json")
data = json.loads(cache.read_text())

per = defaultdict(lambda: {"songs": 0, "first": "9999", "last": "0000"})
for rec in data.values():
    for slug, info in rec["charts"].items():
        p = per[slug]
        p["songs"] += 1
        p["first"] = min(p["first"], info["first"])
        p["last"] = max(p["last"], info["last"])

print(f"{cache} - {len(data)} unique songs across {len(per)} charts\n")
print(f"{'chart':<32}{'songs':>8}   coverage")
for slug in sorted(per, key=lambda s: -per[s]["songs"]):
    p = per[slug]
    flag = "  <-- suspiciously few" if p["songs"] < 50 else ""
    print(f"{slug:<32}{p['songs']:>8}   {p['first'][:7]} .. {p['last'][:7]}{flag}")

prog = cache.with_suffix(".progress.json")
if prog.exists():
    pr = json.loads(prog.read_text())
    print(f"\nchart-weeks fetched: {sum(len(v) for v in pr.values())}")
    for slug in sorted(pr):
        got = per.get(slug, {}).get("songs", 0)
        note = "  <-- fetched but produced NOTHING" if not got else ""
        print(f"   {slug:<32}{len(pr[slug]):>6} weeks{note}")
