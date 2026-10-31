{"id": "files-and-editor", "title": "Files & editing", "summary": "A single editor group. Reliable saves. Explicit failure.", "order": 2, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Open and edit

The explorer lists every entry in a folder, including dotfiles and paths ignored by Git such as node_modules, with no entry-count limit. Select a file from the tree to open a tab. Monaco provides undo, find, multiple cursors, and syntax highlighting. A dot marks unsaved changes. Save with Cmd/Ctrl+S. Closing a dirty tab requires an explicit discard decision.

## Safe save

The native service checks the on-disk content hash before saving, writes a temporary file in the same directory, preserves permissions, then persists the replacement. Failure leaves your buffer dirty. A conflict requires explicit overwrite. Compare and Save As are pending.

## Formats and limits

UTF-8, a UTF-8 BOM, and consistent LF/CRLF endings are preserved. Binary or unsupported encodings fail explicitly. Files above 10 MiB are rejected in this early build instead of risking an unbounded load. New files can be created in the root. Rename and trash backend operations are not yet exposed in the explorer.

## Current tab behavior

Every open file is pinned in this build. Preview tabs, automatic external-change reload, recovery buffers, and session restoration are pending. Keep important edits saved before quitting.
