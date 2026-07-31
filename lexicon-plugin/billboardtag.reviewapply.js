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
// MAX_BATCH_SIZE guards `review` only, not `auto`. Auto-apply is
// idempotent and self-resuming - already-tagged tracks are skipped on
// every run, so even a bad interruption just means re-running picks up
// where it left off - so there's no real reason to cap it. Confirmed
// working at real scale: 694 auto rows in one run, no timeout, no
// hang, completed cleanly. Review is different: no resumability, no
// memory of a prior decision, and each row is a blocking dialog - a
// large review batch means either powering through all of it in one
// sitting or losing your place entirely.
//
// Going over the limit does NOT block the whole run - only review gets
// skipped for that run; auto still applies in full. An earlier version
// threw and stopped everything here, which meant a single oversized
// review batch could block hundreds of perfectly safe auto rows too.
// For a big batch of fuzzy matches, use the CLI's CSV workflow instead:
//   python billboard_tag.py apply --limit 100 --min-score 100
//   (then hand-review billboard_plan.csv for the fuzzy rows)
const MAX_BATCH_SIZE = 50;

// Every decision also appends an entry to changelog.log in this plugin's
// Files folder - see ../view_changelog.py (repo root) to read it. There
// used to be an in-app viewer action too; removed because
// _ui.showInputDialog isn't built for content that long (see README).
const CHANGELOG_FILE = "changelog.log";

function friendlyStamp() {
  return new Date().toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

// Appends `entries` (may be empty) and returns the changelog's total entry
// count afterward, so the caller can always mention it - not just on runs
// that added something. A historical changelog you only hear about on the
// run that wrote to it is easy to forget exists.
function appendChangelog(entries) {
  const existing = _files.list().includes(CHANGELOG_FILE)
    ? _files.read(CHANGELOG_FILE).trimEnd()
    : "";
  let combined = existing;
  if (entries.length > 0) {
    const sep = existing ? "\n\n" : "";
    combined = existing + sep + entries.join("\n\n") + "\n";
    _files.write(CHANGELOG_FILE, combined);
  }
  return combined ? combined.trim().split("\n\n").filter((e) => e.trim()).length : 0;
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
  const reviewRows = data.review || [];
  // Over the limit: skip review entirely this run rather than block the
  // whole action. auto isn't capped and shouldn't be held hostage by a
  // large review batch - see MAX_BATCH_SIZE's comment. reviewQueue stays
  // empty in this case, which just means the batch loop below never
  // takes the review branch - every match falls through to auto as usual,
  // no special-casing needed there.
  const reviewOverLimit = reviewRows.length > MAX_BATCH_SIZE;
  const reviewNote = reviewOverLimit
    ? `Review skipped — ${reviewRows.length} rows is over this plugin's ` +
      `${MAX_BATCH_SIZE}-row limit. Hand-review billboard_plan.csv instead:\n` +
      `  python billboard_tag.py apply --limit 100 --min-score 100`
    : null;

  const autoQueue = new Map((data.auto || []).map((row) => [row.track_id, row]));
  const reviewQueue = reviewOverLimit
    ? new Map()
    : new Map(reviewRows.map((row) => [row.track_id, row]));

  if (autoQueue.size === 0 && reviewQueue.size === 0) {
    const total = appendChangelog([]);   // no-op write, just reads the count
    _helpers.Report(
      (reviewNote || "Nothing to do — pending.json has no auto or review rows.") +
      (total > 0 ? ` Changelog has ${total} entries — run "python view_changelog.py" to see them.` : "")
    );
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

    const logTotal = appendChangelog(changes);

    const missing = remaining.size;
    _helpers.Report(
      `Applied ${applied} (${alreadyDone} already tagged) · ` +
      (reviewOverLimit
        ? reviewNote
        : `Reviewed ${approved + skipped} (${approved} approved, ${skipped} skipped)`) +
      (missing > 0 ? ` · ${missing} not found in library.` : ".") +
      // Always mentioned, not just on runs that changed something - a
      // historical changelog you only hear about on the run that wrote to
      // it is easy to forget exists. Points at the CLI viewer, not the
      // removed in-app one - _ui.showInputDialog isn't built for content
      // this long (see README).
      (logTotal > 0 ? ` Changelog has ${logTotal} entries — run "python view_changelog.py" to see them.` : "")
    );
  }
}
