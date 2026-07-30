// billboardtag.apply
//
// Applies only the "auto" rows from pending.json — exact matches
// (score 100) that billboard_tag_v3.py's `plan --plugin-out` already
// decided are safe unattended. Fuzzy rows live in "review" and are handled
// by billboardtag.review instead.
//
// pending.json is produced on the machine that maintains the chart cache:
//   python billboard_tag_v3.py plan --plugin-out "<this plugin's folder>/Files/pending.json"
//
// It goes in the "Files" subfolder specifically — that's the directory
// _files.read/_files.list actually operate on, not the plugin's install
// folder itself (found by trial and error; not documented anywhere).
//
// NOTE: avoids `continue`/`break` inside loops on purpose — Lexicon's
// action runtime rejected a `continue` inside a `for...of` with
// "Illegal continue statement" even though the same code is valid,
// ordinary JS. Using if/else and loop conditions instead sidesteps it.

const DATA_FILE = "pending.json";

const names = _files.list();
if (!names.includes(DATA_FILE)) {
  throw new Error(
    `${DATA_FILE} not found in this plugin's folder. Generate it with:\n` +
    `  python billboard_tag_v3.py plan --plugin-out "<this plugin's folder>/Files/${DATA_FILE}"`
  );
} else {
  const data = JSON.parse(_files.read(DATA_FILE));
  const queue = new Map((data.auto || []).map((row) => [row.track_id, row]));

  if (queue.size === 0) {
    _helpers.Report("Nothing to apply — no auto-approved rows in pending.json.");
  } else {
    let updated = 0;
    let alreadyDone = 0;
    let seen = 0;
    const total = _vars.tracksAllAmount || 0;

    let batch = await _library.track.getNextAllBatch();
    while (batch.length > 0) {
      for (const track of batch) {
        seen++;
        const row = queue.get(track.id);
        if (row) {
          const current = track.tags || [];
          const add = row.tag_ids.filter((id) => !current.includes(id));
          if (add.length === 0) {
            alreadyDone++;
          } else {
            // Merge, never replace — `tags` is a flat array, so a bare
            // assignment would wipe every other tag on the track.
            track.tags = [...current, ...add];
            updated++;
          }
        }
      }

      if (total) _ui.progress(seen / total);
      batch = await _library.track.getNextAllBatch();
    }

    const missing = queue.size - updated - alreadyDone;
    _helpers.Report(
      `Billboard tags: ${updated} tracks updated, ${alreadyDone} already tagged` +
      (missing > 0 ? `, ${missing} not found in library.` : ".")
    );
  }
}
