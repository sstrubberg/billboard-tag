// billboardtag.review
//
// Walks the "review" rows from pending.json — fuzzy Billboard matches
// (score below AUTO_APPROVE) — one at a time so you can approve or skip
// each before anything is written. Replaces hand-editing the `apply`
// column in billboard_plan.csv.
//
// See billboardtag.apply.js for where pending.json needs to live
// (the plugin's "Files" subfolder) and why this avoids `continue`/`break`.
//
// IMPORTANT: track objects must be mutated *while still inside the same
// getNextAllBatch() batch they came from*. An earlier version indexed
// every track into a Map first and mutated them in a later, separate
// loop — the action reported "approved" but nothing was actually
// written. Lexicon's "updating a field tracks the modification" only
// seems to apply within the batch currently being iterated; edits made
// after paging past it are silently dropped. So this shows the dialog
// and writes the tag inline, in the same batch loop, same as apply.js.
//
// _ui.showInputDialog is a free-text prompt with built-in Submit/Skip
// controls (confirmed by running it), not a custom-buttons chooser.
// Skip/Esc resolves to `null`; Submit resolves to whatever was typed
// (including "").

const DATA_FILE = "pending.json";

const names = _files.list();
if (!names.includes(DATA_FILE)) {
  throw new Error(
    `${DATA_FILE} not found in this plugin's folder. Generate it with:\n` +
    `  python billboard_tag_v3.py plan --plugin-out "<this plugin's folder>/Files/${DATA_FILE}"`
  );
} else {
  const data = JSON.parse(_files.read(DATA_FILE));
  const queue = new Map((data.review || []).map((row) => [row.track_id, row]));

  if (queue.size === 0) {
    _helpers.Report("Nothing to review — no fuzzy-match rows in pending.json.");
  } else {
    const remaining = new Set(queue.keys());
    let approved = 0;
    let skipped = 0;
    let seen = 0;
    const total = _vars.tracksAllAmount || 0;

    let batch = await _library.track.getNextAllBatch();
    while (batch.length > 0) {
      for (const track of batch) {
        seen++;
        const row = queue.get(track.id);
        if (row) {
          remaining.delete(track.id);

          const answer = await _ui.showInputDialog({
            title: `Billboard match — score ${row.score}`,
            message:
              `${row.artist} — ${row.title}\n` +
              `matched: ${row.billboard_match}\n` +
              `charted on: ${row.charted_on}\n` +
              `would add: ${row.tags_to_add.join(", ")}\n\n` +
              `Submit to approve, Skip to skip.`,
          });

          if (answer === null || answer === undefined) {
            skipped++;
          } else {
            const current = track.tags || [];
            const add = row.tag_ids.filter((id) => !current.includes(id));
            if (add.length > 0) {
              // Merge, never replace — `tags` is a flat array, so a bare
              // assignment would wipe every other tag on the track.
              track.tags = [...current, ...add];
              approved++;
            }
          }
        }
      }

      if (total) _ui.progress(seen / total);
      batch = await _library.track.getNextAllBatch();
    }

    const missing = remaining.size;
    _helpers.Report(
      `Reviewed ${queue.size - missing}: ${approved} approved, ${skipped} skipped` +
      (missing > 0 ? `, ${missing} not found in library.` : ".")
    );
  }
}
