# Billboard chart tagging for Lexicon

Tags tracks in a Lexicon DJ library with the Billboard charts they appeared on,
using the chart tags that already exist in the library's `Charts` category.

Script version: `2026-07-28.3`

Nothing is written to Lexicon until you run `apply` without `--dry-run` and
confirm. Every other command is read-only.

**The script only ever adds tags. It never removes any.** See
[Known limitations](#known-limitations).

---

## How it works

Billboard has no "what charts was this song on" lookup, so the script works
backwards:

1. **Build an index** of every charting song — from bulk datasets where they
   exist, by scraping week-by-week where they don't.
2. **Match your library against it** with fuzzy artist/title comparison.
3. **Write a plan** to CSV so you can review every proposed change.
4. **Apply** the rows you approved, merging tags rather than replacing them.

`billboard_cache.json` holds the index and accumulates across runs. Datasets
and scrapes both write to it.

---

## Install

On a new machine, or if you're not the author:

```bash
git clone <this repo> billboard-tag
cd billboard-tag
./bootstrap.sh
```

`bootstrap.sh` creates the virtualenv, installs dependencies, finds the shared
chart cache already in the repo (so you skip the multi-hour scrape), checks
that Lexicon is reachable, and — if you don't have a `chart_map.json` — proposes
one from your own tag names.

Then:

```bash
source billboard-env/bin/activate
python billboard_tag_v3.py charts     # verify the slugs still resolve
python billboard_tag_v3.py plan       # read-only
```

### Using this with a different Lexicon library

Chart *slugs* are universal; your *tag names* are not. `chart_map.json` bridges
the two, and the version in this repo uses the author's names (`US Hot 100`,
`US Hot R&B/Hip-hop`, …). Generate your own:

```bash
python billboard_tag_v3.py init          # propose, print only
python billboard_tag_v3.py init --yes    # write chart_map.json
```

`init` matches Billboard's canonical chart names against every tag in your
library, assigns one-to-one best-first, and only writes matches scoring 85+.
Anything weaker is printed with a copy-pasteable JSON line so you can decide.
Charts you have no tag for are listed too — create the tag in Lexicon and
re-run.

If `chart_map.json` is absent the script falls back to the built-in mapping, so
nothing breaks; it just won't match your tags.

---

## Setup details

### 1. Enable the Lexicon API

Lexicon → Settings → Integrations → enable the Local API. Leave Lexicon
running. Verify:

```
http://localhost:48624/v1/tracks?limit=1
```

### 2. Virtual environment

Modern Python refuses to install into the system interpreter
(`error: externally-managed-environment`).

```bash
python3 -m venv billboard-env
source billboard-env/bin/activate      # Windows: billboard-env\Scripts\Activate.ps1
pip install -r requirements.txt
```

Activation is per-terminal. Your prompt shows `(billboard-env)` when it's on.

### 3. Check you're running the file you think you are

Every command prints `billboard_tag v<VERSION>` first. Browsers append `(1)`
rather than overwriting, which will silently cost you an hour.

```bash
ls -lt *.py | head
```

---

## Commands

| command | writes? | what it does |
|---|---|---|
| `init` | `chart_map.json` | Proposes a tag→chart mapping from your library |
| `probe` | no | Dumps raw API responses so you can confirm field names |
| `tags` | no | Lists Lexicon tags with ids and categories |
| `charts` | no | Probes each slug at three dates, reports usability |
| `verify` | no | Checks specific tracks against a narrow date window |
| `load` | cache | Ingests bulk datasets. Seconds, not hours |
| `fetch` | cache | Scrapes charts with no dataset |
| `plan` | CSV | Matches library against cache, writes the review file |
| `apply` | **Lexicon** | Writes approved tags |

### Flags

```
--workers N        parallel requests during fetch (4 is the ceiling)
--library-years    only scrape years your library contains
--charts a,b,c     restrict to specific slugs; overrides the dataset skip
--start-year YYYY  how far back to walk
--weeks N          stop after N weeks per chart (testing)
--cache PATH       alternate cache file
--plan PATH        alternate plan CSV
--only-changes     omit NO MATCH and ALREADY TAGGED rows from the plan
--refresh          on load: re-download datasets

--dry-run          on apply: write wave_preview.csv, change nothing
--limit N          on apply: stop after N successful writes (waves)
--min-score N      on apply: only rows scoring >= N (100 = exact only)
--yes              on apply: skip the confirmation prompt (for scripts)
```

---

## First run

```bash
python billboard_tag_v3.py probe
python billboard_tag_v3.py tags --filter chart

python billboard_tag_v3.py load                    # ~90 s, 7 charts
python billboard_tag_v3.py fetch --workers 4       # ~4 h, resumable
python billboard_tag_v3.py fetch --workers 4 --start-year 2018 \
  --charts r-b-hip-hop-songs,country-songs,pop-songs,hot-rock-songs

python cache_audit.py                              # verify coverage
python billboard_tag_v3.py plan

# review billboard_plan.csv, then:
python billboard_tag_v3.py apply --dry-run --limit 100
python billboard_tag_v3.py apply --limit 100       # repeat per wave
python verify_applied.py
```

`fetch` is resumable — progress lives in `billboard_cache.progress.json`,
flushed after every batch. Ctrl-C, sleep, or a reboot costs you nothing.

---

## Reviewing in waves

`--limit N` stops after N successful writes. Re-run the same command and it
advances, because the "already done" count is recomputed from a fresh library
read each time. No state file, and you can stop mid-way.

```bash
python billboard_tag_v3.py apply --dry-run --limit 100   # -> wave_preview.csv
python billboard_tag_v3.py apply --limit 100
```

`wave_preview.csv` holds exactly the tracks that wave would touch, plus
`tags_before` and `tags_after`. **`tags_after` must always be larger** — equal
or smaller means a merge bug.

To drop a track, set its `apply` to `0` in `billboard_plan.csv`, not in the
preview, which is regenerated each run.

---

## Reading the plan CSV

| column | meaning |
|---|---|
| `track_id` | Lexicon id |
| `my_artist` / `my_title` | the track as it exists in your library |
| `score` | 100 = exact after normalizing; 88–99 = fuzzy |
| `action` | verdict, below |
| `tags_to_add` | chart tags that would be added |
| `chart_tags_now` | chart tags it already has |
| `all_tags_now` | every tag, for context |
| `billboard_match` | the Billboard entry it matched |
| `charted_on` | e.g. `hot-100 #4 1983` — **years unreliable, see limitations** |
| `apply` | **the only column you edit** |

Verdicts, sorted to the top of the file in this order:

- **REVIEW** — fuzzy match below 95. Defaults to `apply=0`.
- **ADD** — 95+. Defaults to `apply=1`.
- **ALREADY TAGGED** — matched, tag already present.
- **SKIPPED** — excluded by title.
- **NO MATCH** — nothing found.

---

## Configuration

| setting | value | notes |
|---|---|---|
| `START_YEAR` | 1958 | Hot 100 begins Aug 1958 |
| `STEP_WEEKS` | 2 | Near-lossless; chart runs are long |
| `STEP_WEEKS_BY_SLUG` | Bubbling Under: 1<br>Dance Singles Sales: 1 | Short-run charts need every week |
| `FUZZ_THRESHOLD` | 88 | Below this, no match proposed |
| `AUTO_APPROVE` | 95 | At or above, `apply` defaults to 1 |
| `EXCLUDE_TAG_MATCHES` | `[]` | Tag-based exclusion, off |
| `EXCLUDE_TITLE_MATCHES` | `mashup`, `transition`, `blend` | DJ tools built *from* a song |
| `ARTIST_ALIASES` | Hall & Oates, Janet Jackson | Extend as you find more |
| `WORKERS` | 1 | Override per-run |
| `VERIFY_BLANKS` | True | See below |

Tag and title matching normalizes both sides — lowercased, punctuation
stripped — so `mashup` matches `Mash-up` or `Mash Up`.

---

## Matching

Normalization strips parentheticals, featured artists, and punctuation, then
compares artist and title with `rapidfuzz`. Details that were expensive to
learn:

- **`ft` must be in the artist split.** Without it, `Lady Gaga ft Colby
  O'Donis` never matches Billboard's `Lady Gaga Featuring Colby O'Donis`.
  Adding it recovered 129 tracks on the Hot 100 alone.
- **The slash clause needs surrounding spaces**, or `AC/DC` collapses to `AC`.
- **Commas don't split before corporate suffixes**, or `Lipps, Inc.` becomes
  `Lipps` and stops matching a file tagged `Lipps Inc.`. The lookahead sits
  before the whitespace so it can't backtrack past the space.
- **`&` is spelled out**, so `Sexy & I Know It` matches `Sexy And I Know It`.
  Same for `$` → `s` (Ke$ha) and `+` → `and`.
- **Double A-sides are indexed both ways.** Billboard lists `Down On The
  Corner/Fortunate Son`; your file holds one side. Built at match time from
  the existing cache, so it needs no re-scraping. Added 515 variants.
- **`ARTIST_ALIASES`** handles credits your files spell differently —
  `Hall & Oates` vs Billboard's `Daryl Hall John Oates`, and `Janet Jackson`
  vs `Janet` (her credit 1993–2001).

Remaining NO MATCH rows are mostly correct: album tracks that were never
singles. Michael Jackson's "Baby Be Mine", "Carousel", and "Xscape" should not
match anything.

---

## Decisions

**Renamed charts use Billboard's current name.** A 1974 soul hit charted on
what is now Hot R&B/Hip-Hop Songs, so it gets `US Hot R&B/Hip-hop`. Charts
discontinued *without* a successor keep their historical name — but Billboard
hosts no archive under dead names, so those stay manual regardless.

Retired as a result:

| tag | period | superseded by |
|---|---|---|
| US Hot Soul Singles | Jul 1973 – Jun 1982 | US Hot R&B/Hip-hop |
| US Hot Black Singles | Jun 1982 – Oct 1990 | US Hot R&B/Hip-hop |
| US R&B Singles | Oct 1990 – Jan 1999 | US Hot R&B/Hip-hop |
| US Easy Listening | 1961 – 1979 | US Adult Contemporary |

`US Hot Disco Singles` was **kept** — not a clean rename. The Dance/Disco chart
split in March 1985 into Club Play and 12-inch Singles Sales, so pre-1985 disco
entries are ancestors of two modern charts.

**Remixes are included; mashups and tools are not.** A remix of a #1 is still
that song to a crowd. Mashups, transitions, and blends are different records
built from a song.

**Exclusion is title-based, not tag-based** — tag coverage was inconsistent,
and plenty of edits carried no identifying tag.

**Tags merge, never replace.** `apply` reads each track's live tag array and
appends. Lexicon's `tags` field is a flat array; sending a bare list would
wipe every genre tag on the track.

**The script never creates tags.** Creating one needs a `categoryId`, so the
tag must exist in Lexicon already. `apply` exits with instructions if not.

---

## Chart coverage

17 charts in the cache. Of 41 library tags, 18 are automatable.

**Dataset-backed**

| tag | slug | coverage |
|---|---|---|
| US Hot 100 | `hot-100` | 1958 → current |
| US Hot R&B/Hip-hop | `r-b-hip-hop-songs` | 1958 → current |
| US Hot Country | `country-songs` | 1958 → current |
| US Pop Airplay | `pop-songs` | 1992 → current |
| US Hot Rock & Alternative | `hot-rock-songs` | 2009 → current |
| US Hot Latin Songs | `hot-latin-songs` | 1986 → 2018, **frozen** |
| US Hot Dance/Electronic | `hot-dance-electronic-songs` | 2013 → 2018, **frozen** |

The frozen two have no navigable archive; scraping can't extend them. Don't
pass them to `fetch`.

**Scrape-only** — Adult Alternative Airplay (`triple-a`), Adult Contemporary,
Adult Pop Airplay, Dance Club (`dance-club-play-songs`, ends 2020-03), Dance
Single Sales (`hot-dance-singles-sales`, archive ends ~2013 — see limitations),
Hot Dance/Pop (`hot-dance-pop-songs`, 2025+, which is its whole lifetime),
Hot Rap (`rap-song`), Latin Pop Airplay, Rhythmic Airplay (`rhythmic-40`),
Rock & Alternative Airplay (`rock-airplay`), Tropical Airplay
(`latin-tropical-airplay`).

**No Billboard data** — Alternative Airplay, Bubbling Under Hot 100, Dance/Mix
Show Airplay, Mainstream Rock, Smooth Jazz Airplay. These serve the current
week for any date requested. Pop 100, Hot Crossover, and Hot Singles Sales were
discontinued with no archive. The five UK charts are Official Charts Company.
Billboard 200 is an albums chart needing a different join.

Re-check any of these with `charts --charts <slug>` if Billboard restores
archives.

---

## Performance

Measured July 2026 on `rap-song`:

| workers | rate |
|---|---|
| 1 | 3.4 s/week |
| 4 | 1.6 s/week |
| 8 | 1.7 s/week — no gain, Billboard serializes server-side |

Use `--workers 4`.

### Concurrency safety

A throttled request and a nonexistent chart both return nothing. Unchecked,
twenty throttled weeks in a row makes the script conclude "chart predates this"
and quit early — silent data loss with no error.

`VERIFY_BLANKS` re-fetches any blank week once, sequentially, before believing
it. **Fallbacks are exempt**: when Billboard is asked for a date outside a
chart's lifetime it returns a *different* week, which the script detects by
comparing the returned date against the requested one. That's definitive, needs
no re-check, and — importantly — does **not** count toward the give-up limit.
Treating fallbacks as failures is what originally caused four charts to capture
nothing at all.

Verified: byte-identical output at 1, 4, and 8 workers.

---

## Helper scripts

| script | what it does |
|---|---|
| `cache_audit.py` | Per-chart song counts and coverage. Flags charts that fetched but produced nothing |
| `verify_applied.py` | Re-reads Lexicon and confirms every planned tag is actually present |
| `make_sample.py` | Carves a 10-track sample out of the plan for a trial apply |
| `timing_test.py` | Measures whether Billboard or the parser is the bottleneck |

Run `cache_audit.py` after any long fetch. A chart that silently captured
nothing looks identical to "those songs didn't chart."

---

## Keeping it current

New tracks arrive; charts publish weekly. Two moving parts, in different
places.

### What runs where

**GitHub Actions cannot tag your library.** Lexicon's API is on `localhost` on
your machine, and a cloud runner has no route to it. So:

| | runs where | does what |
|---|---|---|
| `.github/workflows/refresh-cache.yml` | GitHub, Sundays 08:00 UTC | Refreshes chart data, commits `billboard_cache.json` |
| `weekly_update.sh` | your Mac, Sundays 09:00 | Refreshes data, tags new tracks, flags fuzzy matches |

**The repo is the shared copy of the chart data.** `weekly_update.sh` commits
the refreshed cache and pushes — so the repo always holds a current
index and any machine that clones it starts in seconds rather than scraping for
four hours. Set `PUSH_CACHE=0` to disable that.

The GitHub Action does the same thing from the cloud, which keeps the cache
fresh even in a week where you never open your laptop. Running both is fine —
they touch the same files and git handles it — but if you're on one Mac that's
on most weeks, the local job alone is enough.

### Local weekly job

`weekly_update.sh` refreshes datasets, fetches the handful of new weeks (the
progress file means it only asks for weeks it hasn't seen), rebuilds the plan,
and applies **exact matches only**:

```bash
python billboard_tag_v3.py apply --min-score 100 --yes
```

Score-100 rows matched exactly after normalization, which is safe unattended.
Anything fuzzy stays in `billboard_plan.csv`, and you get a macOS notification
with the count. Review those by hand.

If Lexicon isn't running, the script refreshes chart data and exits without
tagging rather than failing.

### Scheduling

macOS: use launchd, not cron. Both work, but launchd runs a missed job when the
Mac wakes; cron just skips it.

```bash
# edit BOTH paths in the plist first
cp com.billboardtag.weekly.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.billboardtag.weekly.plist

launchctl start com.billboardtag.weekly     # run now, don't wait
tail -f logs/$(date +%Y-%m-%d).log
```

Unload with `launchctl unload ~/Library/LaunchAgents/com.billboardtag.weekly.plist`.

### Creating the repo

```bash
cd ~/billboard-tag
git init
git add .
git commit -m "Billboard chart tagging for Lexicon"
gh repo create billboard-tag --public --source=. --push
```

`billboard_cache.json` is committed **uncompressed**. See below.

### Cache and repo size

The cache is ~21 MB of JSON and gets rewritten weekly, so the obvious move is
to gzip it before committing. That is measurably wrong.

Twelve simulated weekly commits, same data, same changes:

| | working file | `.git` after 12 commits |
|---|---|---|
| raw JSON | 14 MB | **2.5 MB** |
| gzipped | 2.2 MB | **27 MB** |

Gzipping made the repo **11x larger**. Git already zlib-compresses every blob,
and it delta-compresses between versions — but gzip output is opaque binary
that changes wholesale each week, so git stores a full new blob every time.
Raw JSON with sorted keys deltas down to a few KB, because only a few hundred
lines actually change.

For a 21 MB cache that means roughly **3–4 MB in git for the first commit and a
few hundred KB per year** thereafter. GitHub's limits are 100 MB per file
(hard) and about 1 GB per repo (soft), so there is no capacity problem.

This only holds because the cache is written deterministically — `sort_keys`
and fixed indentation. If you ever change how it's serialized, re-check that
`git gc` still packs it small.

**If it ever does grow past comfort**, in order of preference: attach the cache
to a GitHub Release that gets overwritten instead of committed (no history at
all); or commit only the scraped charts and let `load` rebuild the
dataset-backed ones in 90 seconds, since roughly two thirds of the cache is
re-downloadable for free; or squash the cache's commit history periodically.
Git LFS is the obvious answer and the worst one — 1 GB free, and it bills for
bandwidth on every clone.

### On publishing

There are no credentials in here — the Lexicon API is unauthenticated and
local-only, so nothing sensitive ships with the repo.

Two things to think about before making it public. `billboard_cache.json` is
a substantial derived copy of Billboard's chart data, assembled by scraping
their site and by redistributing two third-party datasets. That's fine for
personal use and almost certainly fine to share, but it is republication, and
Billboard could reasonably object. If that matters to you, publish the code and
leave the cache out — `bootstrap.sh` already handles a missing cache by telling
the user how to build one.

Worth flagging to the Lexicon team when you share it: this depends on
`PATCH /v1/track` with an `{"id":…, "edits":{…}}` body and on `tags` being a
flat array of ids, neither of which is in their published docs. Both were found
by trial and error and could change without notice.

### When you add new tracks

Nothing special. The next weekly run picks them up. To do it immediately:

```bash
python billboard_tag_v3.py plan --only-changes
python billboard_tag_v3.py apply --dry-run
python billboard_tag_v3.py apply
```

Already-tagged tracks are skipped, so this is always safe to re-run.

---

## Known limitations

**The script only adds tags — it never removes any.** If you've hand-tagged a
song with a chart it didn't appear on, nothing here will tell you. A removal
audit found 172 existing tags unsupported by the chart data, but spot-checking
showed roughly half were false positives (double A-side titles, `STEP_WEEKS=2`
sampling gaps, charts with no data). Not actionable without a much stricter
test. Adding is safe because every proposed tag traces to a positive match;
removing rests on absence of evidence, and the evidence has holes.

**The `charted_on` years are unreliable on nine charts.** When Billboard is
asked for a date outside a chart's lifetime it returns the current week, and
early runs filed those songs under the *requested* date. The songs are
genuinely on those charts — the slug is in the URL, so you can't get another
chart's data — but the dates are fiction. Affects display only, not which tags
get applied. Charts showing a `1958-01` start in `cache_audit.py` are the ones
concerned.

**`hot-dance-singles-sales` captures nothing.** Its archive ends around 2013,
and because it's pinned to `STEP_WEEKS = 1` the 400-blank-week budget only
reaches back to late 2018. It gives up ~250 weeks short. Fix would be a
per-chart start year.

**`STEP_WEEKS = 2` samples half of all weeks.** A song that charted for only
one or two weeks in a skipped slot is missed. Deliberate trade — halves the
scrape time and chart runs are usually long.

---

## Troubleshooting

**`error: externally-managed-environment`** — use the venv.

**`ModuleNotFoundError: No module named 'requests'`** — venv isn't active. Look
for `(billboard-env)` on your prompt.

**`command not found: python`** — same. New tab, new terminal, or a reboot all
drop it.

**`No such file or directory`** — check the filename. Downloads arrive with
spaces or a `(1)` suffix. `ls *.py`.

**Output doesn't match the version banner** — two copies. `ls -lt *.py`.

**`400 Bad Request` on a track write** — the API is `PATCH /v1/track` with
`{"id": N, "edits": {"tags": [...]}}`. There is no `/v1/tracks/{id}` route.
`apply` negotiates the body shape on its first write and prints which one
worked.

**`chart_tags_now` empty for every track** — the script can't see your tags.
Run `probe` and check which key holds them; `tags` is expected.

**Blank weeks in a range you know has data** — throttling. Lower `--workers`.
Delete `billboard_cache.progress.json` to force a clean sweep; the cache
merges, so you lose only time.

**A chart quits with "no data and no fallbacks — dead slug?"** — expected for
unreachable charts. Confirm with `charts --charts <slug>`.

---

## Files

| file | tracked? | what |
|---|---|---|
| `billboard_tag_v3.py` | yes | the script |
| `cache_audit.py`, `verify_applied.py`, `make_sample.py`, `timing_test.py` | yes | helpers |
| `bootstrap.sh` | yes | one-command setup on a new machine |
| `chart_map.json` | yes | your tag names → Billboard slugs |
| `weekly_update.sh` | yes | local weekly job |
| `LICENSE` | yes | MIT |
| `com.billboardtag.weekly.plist` | yes | launchd schedule |
| `billboard_cache.json` | yes | the chart index — uncompressed, see above |
| `billboard_cache.progress.json` | yes | which chart-weeks are done |
| `dataset_*.csv` | no | re-downloaded by `load` |
| `billboard_plan.csv`, `wave_preview.csv` | no | regenerated |
| `logs/` | no | weekly run output |

The cache is the only expensive artifact — hours to rebuild. Everything else is
cheap.

---

## Data sources

- Hot 100: [`utdata/rwd-billboard-data`](https://github.com/utdata/rwd-billboard-data) — updated continuously
- Genre charts: [`pdp2600/chartscraper`](https://github.com/pdp2600/chartscraper) — through 2018
- Everything else: scraped from billboard.com via [`billboard.py`](https://github.com/guoguo12/billboard-charts)
