"""Where does the per-request time actually go?"""
import time, requests, billboard

URL = "https://www.billboard.com/charts/hot-100/2015-06-06/"
print("raw HTTP GET only:")
for _ in range(3):
    t = time.time()
    r = requests.get(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    print(f"   {time.time()-t:5.1f}s   {r.status_code}   {len(r.content)/1000:.0f} KB")

print("\nfull billboard.py ChartData (fetch + parse):")
for _ in range(3):
    t = time.time()
    c = billboard.ChartData("hot-100", date="2015-06-06")
    print(f"   {time.time()-t:5.1f}s   n={len(c)}")
