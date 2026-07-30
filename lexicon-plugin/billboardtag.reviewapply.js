// billboardtag.reviewapply
//
// Single action: reviews fuzzy matches and applies exact matches in one
// pass, one menu item. Replaces the earlier separate Review/Apply
// actions - auto and review rows are disjoint by construction on the
// Python side, so there's no ordering ambiguity: each track is either a
// review row (gets a dialog) or an auto row (merged silently), never both.
//
// pending.json is produced on the machine that maintains the chart cache:
//   python billboard_tag.py plan --plugin-out "<this plugin's folder>/Files/pending.json"
//
// It goes in the "Files" subfolder specifically — that's the directory
// _files.read/_files.list actually operate on, not the plugin's install
// folder itself (found by trial and error; not documented anywhere).
//
// NOTE: avoids `continue`/`break` inside loops on purpose — Lexicon's
// action runtime rejected a `continue` inside a `for...of` with
// "Illegal continue statement" even though the same code is valid,
// ordinary JS. Using if/else and loop conditions instead sidesteps it.
//
// IMPORTANT: track objects must be mutated *while still inside the same
// getNextAllBatch() batch they came from* - edits made after paging past
// a batch are silently dropped. So both the review and auto paths mutate
// inline, in the same batch loop.
//
// _ui.showInputDialog is a free-text prompt with built-in Submit/Skip
// controls (confirmed by running it), not a custom-buttons chooser.
// Skip/Esc resolves to `null`; Submit resolves to whatever was typed
// (including ""). `title` doesn't appear to render - only `message` does.
//
// This plugin is deliberately scoped to small batches only - a handful
// of tracks at a time. It has no equivalent of the CLI's resumable
// `apply --limit N` waves, and walking a huge library from inside the
// JS sandbox is untested at scale. For a bulk change, use the CLI's CSV
// workflow instead:
//   python billboard_tag.py apply --limit 100 --min-score 100
const MAX_BATCH_SIZE = 50;

// Every decision also appends an entry to changelog.log in this plugin's
// Files folder - see billboardtag.changelog.js for the viewer.
const CHANGELOG_FILE = "changelog.log";

function friendlyStamp() {
  return new Date().toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function appendChangelog(entries) {
  if (entries.length === 0) return;
  const existing = _files.list().includes(CHANGELOG_FILE)
    ? _files.read(CHANGELOG_FILE).trimEnd()
    : "";
  const sep = existing ? "\n\n" : "";
  _files.write(CHANGELOG_FILE, existing + sep + entries.join("\n\n") + "\n");
}

const DATA_FILE = "pending.json";

const names = _files.list();
if (!names.includes(DATA_FILE)) {
  throw new Error(
    `${DATA_FILE} not found in this plugin's folder. Generate it with:\n` +
    `  python billboard_tag.py plan --plugin-out "<this plugin's folder>/Files/${DATA_FILE}"`
  );
} else {
  const data = JSON.parse(_files.read(DATA_FILE));
  const totalRows = (data.auto || []).length + (data.review || []).length;

  if (totalRows > MAX_BATCH_SIZE) {
    throw new Error(
      `pending.json has ${totalRows} rows (auto + review) — over this ` +
      `plugin's ${MAX_BATCH_SIZE}-row batch limit. For a change this size, ` +
      `use the CLI instead:\n` +
      `  python billboard_tag.py apply --limit 100 --min-score 100\n` +
      `then hand-review billboard_plan.csv for the fuzzy rows.`
    );
  }

  const autoQueue = new Map((data.auto || []).map((row) => [row.track_id, row]));
  const reviewQueue = new Map((data.review || []).map((row) => [row.track_id, row]));

  if (autoQueue.size === 0 && reviewQueue.size === 0) {
    _helpers.Report("Nothing to do — pending.json has no auto or review rows.");
  } else {
    let applied = 0;
    let alreadyDone = 0;
    let approved = 0;
    let skipped = 0;
    let seen = 0;
    const total = _vars.tracksAllAmount || 0;
    const remaining = new Set([...autoQueue.keys(), ...reviewQueue.keys()]);
    const changes = [];

    let batch = await _library.track.getNextAllBatch();
    while (batch.length > 0) {
      for (const track of batch) {
        seen++;

        const reviewRow = reviewQueue.get(track.id);
        const autoRow = autoQueue.get(track.id);

        if (reviewRow) {
          remaining.delete(track.id);

          // `title` doesn't render - everything lives in `message`,
          // grouped with blank lines since there's no bold/size to lean
          // on for hierarchy.
          const answer = await _ui.showInputDialog({
            title: `Billboard match`,
            message:
              `${reviewRow.title}\n${reviewRow.artist}\n\n` +
              `Billboard match (${reviewRow.score}% confidence): ${reviewRow.billboard_match}\n\n` +
              `Charted: ${reviewRow.charted_on}\n\n` +
              `→ Add tag: ${reviewRow.tags_to_add.join(", ")}\n\n` +
              `Submit to approve · Skip to skip`,
          });

          if (answer === null || answer === undefined) {
            skipped++;
            changes.push(
              `✗ ${friendlyStamp()}   ${reviewRow.artist} — ${reviewRow.title}\n  skipped`
            );
          } else {
            const current = track.tags || [];
            const add = reviewRow.tag_ids.filter((id) => !current.includes(id));
            if (add.length > 0) {
              // Merge, never replace — `tags` is a flat array, so a bare
              // assignment would wipe every other tag on the track.
              track.tags = [...current, ...add];
              approved++;
              changes.push(
                `✓ ${friendlyStamp()}   ${reviewRow.artist} — ${reviewRow.title}\n  approved · +${reviewRow.tags_to_add.join(", ")}`
              );
            }
          }
        } else if (autoRow) {
          remaining.delete(track.id);

          const current = track.tags || [];
          const add = autoRow.tag_ids.filter((id) => !current.includes(id));
          if (add.length === 0) {
            alreadyDone++;
          } else {
            track.tags = [...current, ...add];
            applied++;
            changes.push(
              `✓ ${friendlyStamp()}   ${autoRow.artist} — ${autoRow.title}\n  applied · +${autoRow.tags_to_add.join(", ")}`
            );
          }
        }
      }

      if (total) _ui.progress(seen / total);
      batch = await _library.track.getNextAllBatch();
    }

    appendChangelog(changes);

    const missing = remaining.size;
    _helpers.Report(
      `Applied ${applied} (${alreadyDone} already tagged) · Reviewed ${approved + skipped} (${approved} approved, ${skipped} skipped)` +
      (missing > 0 ? ` · ${missing} not found in library.` : ".") +
      (changes.length > 0 ? ` See ${CHANGELOG_FILE} for details.` : "")
    );
  }
}
