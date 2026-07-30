// billboardtag.changelog
//
// Shows the contents of changelog.log (written by billboardtag.apply.js
// and billboardtag.review.js) so you don't have to go find it on disk.
// Read-only — doesn't touch tracks, doesn't need track permissions.
//
// The file itself is chronological (oldest first, natural to read in a
// text editor); this view reverses to newest-first and caps the count,
// since a growing-forever log dumped unformatted into a small dialog is
// illegible otherwise (confirmed the hard way - the raw log line format
// with timestamps/track ids/brackets, one continuous run of text with no
// spacing, was unreadable in the dialog).

const CHANGELOG_FILE = "changelog.log";
const MAX_SHOWN = 20;

const names = _files.list();
if (!names.includes(CHANGELOG_FILE)) {
  _helpers.Report("No changelog yet — run Apply or Review at least once first.");
} else {
  const content = _files.read(CHANGELOG_FILE).trim();
  if (!content) {
    _helpers.Report("Changelog is empty.");
  } else {
    const entries = content.split("\n\n").filter((e) => e.trim());
    const shown = entries.slice(-MAX_SHOWN).reverse();
    const header = entries.length > MAX_SHOWN
      ? `Showing the ${MAX_SHOWN} most recent of ${entries.length}, newest first. Full history in changelog.log.\n\n`
      : `${entries.length} total, newest first.\n\n`;

    await _ui.showInputDialog({
      title: "Billboard Tag changelog",
      message: header + shown.join("\n\n"),
    });
  }
}
