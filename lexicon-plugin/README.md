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
python billboard_tag_v3.py plan --plugin-out "<plugin folder>/Files/pending.json"
```

`<plugin folder>` is wherever this directory ends up installed —
typically `~/Documents/Lexicon/Plugins/billboardtag/`. **Note the
`Files/` subfolder** — that's the directory Lexicon's `_files` API
actually reads from, not the plugin's install folder itself. This was
found by trial and error (writing a probe file with `_files.write` and
locating it on disk); it isn't documented anywhere. Re-run this after
every `load`/`fetch` refresh, same cadence as the CSV plan today.

## Installing

1. Copy this folder into `~/Documents/Lexicon/Plugins/billboardtag/`.
   **Use a real copy, not a symlink** — Lexicon's plugin scanner does
   not follow symlinked folders (confirmed: a symlinked install
   produced no error and no `Plugins` menu entry at all; swapping it
   for `cp -R` fixed it immediately). If you're iterating on the JS,
   re-copy after each edit, or point `development.json`'s
   `reloadBeforeRun` at a real folder some other way.
2. Fully quit and reopen Lexicon (not just close/reopen the window) so
   it picks up the new plugin.
3. Enabling the Local API is *not* required for this plugin — only the
   standalone Python script needs it, for building `pending.json`.

### Dev mode

`~/Documents/Lexicon/Plugins/development.json`:
```json
{ "reloadBeforeRun": true, "loadPluginFolders": true }
```
`loadPluginFolders` is what allows loading a plain folder instead of a
ZIP. After that, use **Plugins → Reload Plugins** in Lexicon's menu bar
to pick up config/action changes without a full restart — a full
restart is only needed the first time a plugin folder is added, or
after a `config.json` change that previously failed validation.

Logs land in `~/Documents/Lexicon/Plugins/Logs/billboardtag/<action
name>.log`, not `Documents/Plugins/Logs` as the plugin docs currently
say.

## Actions

| action | what it does |
|---|---|
| `Apply Billboard Tags` | Merges every `auto` (score-100, exact match) row into the matching track's tags. Skips anything already tagged. Never removes a tag. |
| `Review Billboard Tag Matches` | Walks every `review` (fuzzy, 88–99) row one at a time with an approve/skip prompt. |

Both are safe to re-run — already-applied tags are detected and skipped,
same merge logic as the Python `apply` command.

## `config.json` gotchas found by trial and error

- `author` needs `name` **and** either `email` or `discordUsername` —
  `name` alone fails validation with no other hint.
- An action's `name` may only contain `a-z`, numbers, dots, spaces,
  dash, and underscore — no brackets, no other punctuation.

## Known gaps / things to verify before relying on this

- `_ui.showInputDialog`'s exact option shape (in particular the
  `buttons` key used in `billboardtag.review.js`) wasn't fully
  documented at the time this was written and hasn't been tested yet.
  Sanity-check it against the live docs, Lexicon's Discord
  `#developers` channel, or just run the review action and see what
  the dialog looks like.
