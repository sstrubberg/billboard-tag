# Billboard Tag — Lexicon plugin

Applies the tags `billboard_tag.py` computes, from inside Lexicon,
using the documented `_library` track API instead of the undocumented
`PATCH /v1/track` the standalone script uses.

This plugin does **not** scrape or match anything itself — it only
consumes `pending.json`, a queue the Python side writes. All the fuzzy
matching, chart scraping, and cache maintenance still happen the way
they always have; see the [main README](../README.md).

## Scope: small batches only

This plugin is **not** a replacement for the CLI's bulk `apply --limit
N` workflow, but the two halves of a run don't carry the same risk.
Auto-apply (exact matches) is idempotent and self-resuming — already-
tagged tracks are skipped on every run, so an interruption just means
re-running picks up where it left off — so it's **not** batch-capped.
Confirmed working at real scale: 694 auto rows in one run, no timeout,
no hang, completed cleanly. Review is the part with no resumability
and no memory of a prior decision — each row
is a blocking dialog with no way to save progress and come back later.
`MAX_BATCH_SIZE` (50) caps **review only**: over that, review is
skipped for that run (with a message pointing at the CLI's
`apply --limit N` + hand-reviewed `billboard_plan.csv`) but auto still
applies in full. An earlier version threw and stopped the whole action
here, which meant one oversized review batch could block hundreds of
perfectly safe auto rows too — fixed after realizing that's exactly
what would happen with, say, 51 review rows.

What this plugin is for: the small, recurring review case — a handful
of fuzzy matches to approve or skip since the last refresh — where
opening Lexicon's native UI beats opening a CSV. Bulk exact-match
tagging (a full library import, a large tag-mapping change) can go
through the plugin fine; it's specifically a big pile of *fuzzy*
matches that should go through the CLI instead.

## Generating the queue

On the machine that runs `plan` (the one with the chart cache):

```bash
python billboard_tag.py plan --plugin-out "<plugin folder>/Files/pending.json"
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

One action: `Review and Apply Billboard Tags`. It used to be two separate
menu items (`Apply`, `Review`) — merged since `auto` and `review` are
disjoint sets of tracks, so there was never a real ordering dependency
between them, but running an auto-write action *before* a review action
still read as backwards. One pass through the library, review dialogs
for fuzzy matches interleaved with silent merges for exact matches as
each track comes up. Never removes a tag.

There used to be a second action, `View Billboard Changelog`, a
read-only dialog viewer. It's gone — see [Changelog](#changelog) below
for why, and what replaced it.

Safe to re-run — already-applied tags are detected and skipped, same
merge logic as the Python `apply` command. Note it does *not* remember a
skipped review row between runs — re-running it (e.g. after another
`plan --plugin-out`) will ask about the same unskipped rows again.

## Changelog

The action appends to `changelog.log` in this plugin's `Files` folder (so,
next to `pending.json`) — one entry per track actually touched, oldest at
the top (natural to read in a text editor), timestamped. This is the only
durable record of what a run did; the popup summary at the end disappears
once closed.

```
✓ 7/30/26, 11:16 AM   The Jackson 5/The Jacksons — Dancing Machine (CLEAN) (MM Edit)
  applied · +US Hot 100, US Hot R&B/Hip-hop

✓ 7/30/26, 11:16 AM   The Jackson 5/The Jacksons — Can You Feel It (CLEAN) (MM Edit)
  approved · +US Hot 100, US Hot R&B/Hip-hop

✗ 7/30/26, 11:20 AM   The Jackson 5/The Jacksons — Walk Right Now (CLEAN) (MM Edit)
  skipped
```

**`python view_changelog.py`** (repo root, no venv needed) opens the file
in your default text app directly. This plugin used to also have an
in-app `View Billboard Changelog` action showing the same content via
`_ui.showInputDialog`, capped to the 20 most recent entries — removed,
because that dialog turns out not to be built for content this long:
rather than scrolling in a bounded box, it just kept expanding, so a
real run (27 entries, one batch) produced an unreadable, mostly
off-screen wall of text with the Submit/Skip controls pushed out of
view. Confirmed by running it twice, not by inspection.

It grows forever (no rotation/truncation) — fine at this plugin's small-batch
scale, but delete it by hand if it bothers you.

## `config.json` gotchas found by trial and error

- `author` needs `name` **and** either `email` or `discordUsername` —
  `name` alone fails validation with no other hint.
- An action's `name` may only contain `a-z`, numbers, dots, spaces,
  dash, and underscore — no brackets, no other punctuation.

## `_ui.showInputDialog` behavior, confirmed by running it

It's a free-text prompt with built-in **Submit**/**Skip** controls, not
a custom-buttons chooser — a `buttons` option is silently ignored.
Skip/Esc resolves the promise to `null`; Submit resolves to whatever
was typed, including `""`. `title` doesn't appear to render; only
`message` shows up in the dialog.
