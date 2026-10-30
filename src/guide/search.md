{"id": "search", "title": "Workspace search", "summary": "Find text on demand, without a permanent content index.", "order": 3, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Search a folder

Choose Search and enter a query. Results update after 180 ms. Aa enables case sensitivity, ab enables whole-word matching, and .* enables regular expressions. Include and exclude fields accept comma-separated glob patterns, such as src/**, **/*.{ts,tsx}. A plain folder name matches that folder at any depth; prefix ./ to anchor it to the workspace root. Invalid expressions and filters appear inline.

## Bounded results

Search runs inside the desktop app without an external executable. It respects .gitignore and .ignore, and skips hidden files, symlinks, and binary/non-UTF-8 files. Search has no time, file-size, line-length, query/filter-length, or result-count limit. Long result previews are shortened around each match; the full line is searched. A new request cancels the previous search. Select a result to jump to the highlighted UTF-16 editor range. Search reads saved files; save edits to include them. The Rust regex engine supports captures and Unicode matching, but not lookaround or backreferences in patterns.

## Replace matches

Select Replace to show the replacement field. Use the arrow beside a result to replace one match, or Replace all to replace the current complete result set. Empty replacement text deletes matches. In regex mode, $1 and ${name} insert capture groups; $$ inserts a literal dollar sign. In literal mode, replacement text is used as typed.

Review the match/file count before confirming. Save or close modified matching tabs first. Each file is checked against its search revision and saved atomically, preserving BOM and line endings. Changed or unwritable files are skipped with visible errors; successful files are reported and open buffers refresh. A multi-file replacement is not one atomic transaction and is limited to 64 MiB of updated content. Opening and replacing matching files still uses the 10 MiB editor file limit. Browser samples replace only in-memory sample content.
