{"id": "security-and-privacy", "title": "Security & privacy", "summary": "Rust owns authority. The webview requests narrow operations.", "order": 13, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Workspace scope

Opaque workspace, document, and path IDs scope native file commands. Paths are validated and canonicalized under the workspace root. Symlink directory traversal is disabled. The main webview has no generic shell, filesystem, or SQL capability.

## Execution

Terminals, SSH, formatters, and Git mutations require workspace trust checked in Rust. Children use executable and argument arrays. Read-only Git disables external diff/textconv and filesystem monitor helpers.

## Local data

SQLite stores metadata and settings only. No passwords, private keys, passphrases, file buffers, terminal input, or transcripts enter it. Telemetry is absent. The Guide contains bundled static data and no executable Markdown.

## Release status

This is a development build, not a security-audited release. Remaining hardening includes race-resistant directory handles, platform process-group cleanup, archive defenses, updater signatures, and the full cross-platform threat test matrix.
