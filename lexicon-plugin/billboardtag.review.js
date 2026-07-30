// billboardtag.review
//
// Walks the "review" rows from pending.json — fuzzy Billboard matches
// (score below AUTO_APPROVE) — one at a time so you can approve or skip
// each before anything is written. Replaces hand-editing the `apply`
// column in billboard_plan.csv.
//
// NOTE: the exact shape of _ui.showInputDialog()'s options (in particular
// whether "buttons" is the right key for a Yes/No prompt) wasn't fully
// documented where this was written. Verify against the live plugin docs
// or #developers on the Lexicon Discord before relying on this, and adjust
// the _ui.showInputDialog call below if the signature differs.

const DATA_FILE = "pending.json";

const names = _files.list();
if (!names.includes(DATA_FILE)) {
  throw new Error(
    `${DATA_FILE} not found in this plugin's folder. Generate it with:\n` +
    `  python billboard_tag_v3.py plan --plugin-out "<this folder>/${DATA_FILE}"`
  );
}

const data = JSON.parse(_files.read(DATA_FILE));
const review = data.review || [];

if (review.length === 0) {
  _helpers.Report("Nothing to review — no fuzzy-match rows in pending.json.");
} else {
  // One full pass to index tracks by id, so approved rows can be written
  // without a second library read per track.
  const byId = new Map();
  while (true) {
    const batch = await _library.track.getNextAllBatch();
    if (batch.length === 0) break;
    for (const track of batch) byId.set(track.id, track);
  }

  let approved = 0;
  let skipped = 0;
  let missing = 0;

  for (let i = 0; i < review.length; i++) {
    const row = review[i];
    const track = byId.get(row.track_id);
    if (!track) {
      missing++;
      continue;
    }

    const answer = await _ui.showInputDialog({
      title: `Billboard match ${i + 1} of ${review.length} — score ${row.score}`,
      message:
        `${row.artist} — ${row.title}\n` +
        `matched: ${row.billboard_match}\n` +
        `charted on: ${row.charted_on}\n` +
        `would add: ${row.tags_to_add.join(", ")}`,
      buttons: ["Approve", "Skip"],
    });

    if (answer !== "Approve") {
      skipped++;
      continue;
    }

    const current = track.tags || [];
    const add = row.tag_ids.filter((id) => !current.includes(id));
    if (add.length > 0) {
      track.tags = [...current, ...add];
      approved++;
    }

    _ui.progress((i + 1) / review.length);
  }

  _helpers.Report(
    `Reviewed ${review.length}: ${approved} approved, ${skipped} skipped` +
    (missing > 0 ? `, ${missing} not found in library.` : ".")
  );
}
