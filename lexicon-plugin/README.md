# Billboard Tag — Lexicon plugin

Applies the tags `billboard_tag_v3.py` computes, from inside Lexicon,
using the documented `_library` track API instead of the undocumented
`PATCH /v1/track` the standalone script uses.

This plugin does **not** scrape or match anything itself — it only
consumes `pending.json`, a queue the Python side writes. All the fuzzy
matching, chart scraping, and cache maintenance still happen the way
they always have; see the [main README](../README.md).

## Generating the queue

On the machine that runs `plan` (the one with the chart cache):

```bash
python billboard_tag_v3.py plan --plugin-out "<plugin folder>/pending.json"
```

`<plugin folder>` is wherever this directory ends up installed —
typically `~/Documents/Lexicon/Plugins/billboardtag/`. Re-run this
after every `load`/`fetch` refresh, same cadence as the CSV plan today.

## Installing

1. Copy this folder into `Documents/Lexicon/Plugins/billboardtag/`
   (or zip it — see Lexicon's [plugin docs](https://www.lexicondj.com/docs/developers/plugin)
   for the exact install mechanics, which may have changed since this
   was written).
2. Restart Lexicon so it picks up the new plugin.
3. Enable the Local API is *not* required for this plugin — only the
   standalone Python script needs it, for building `pending.json`.

## Actions

| action | what it does |
|---|---|
| `Apply Billboard Tags` | Merges every `auto` (score-100, exact match) row into the matching track's tags. Skips anything already tagged. Never removes a tag. |
| `Review Billboard Tag Matches` | Walks every `review` (fuzzy, 88–99) row one at a time with an approve/skip prompt. |

Both are safe to re-run — already-applied tags are detected and skipped,
same merge logic as the Python `apply` command.

## Known gaps / things to verify before relying on this

- `_ui.showInputDialog`'s exact option shape (in particular the
  `buttons` key used in `billboardtag.review.js`) wasn't fully
  documented at the time this was written. Sanity-check it against the
  live docs or Lexicon's Discord `#developers` channel, or just run the
  action once and see what the dialog looks like.
- The runtime location `_files` reads/writes from (i.e. exactly where
  to point `--plugin-out`) is described as "the plugin's dedicated
  folder" but not given as a literal path. If `pending.json` isn't
  found, check Lexicon's plugin logs (`Documents/Plugins/Logs`) for
  where it actually looked.
