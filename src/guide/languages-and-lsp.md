{"id": "languages-and-lsp", "title": "Languages & IntelliSense", "summary": "Completion, hints, navigation, and real diagnostics from bundled language services.", "order": 7, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Built-in language services

TypeScript and JavaScript use Monaco's bundled TypeScript service for completion, hover types, signature help, inlay hints, definitions, references, symbol rename, quick fixes, and syntax/type diagnostics. JSON includes syntax validation and completion. CSS, SCSS, and Less include validation and completion. HTML includes completion and hover help; this is not a complete HTML linter.

These services run locally in dedicated workers. They do not execute project scripts or require workspace trust. Remote JSON schema fetching is disabled.

## Using hints and diagnostics

Ctrl+Space requests completion. Hover a symbol to inspect its type. Parameter hints appear while entering function calls. F12 goes to a definition and F2 renames supported symbols. The editor context menu offers the language actions available at the current cursor. Lightbulbs offer available quick fixes.

Errors are red; warnings, diagnostic hints, and inline type/parameter hints are yellow. These colors apply to the editor and Problems independently of the accent palette. Select the status bar's diagnostic counts, or press Cmd/Ctrl+Shift+M, to open Problems. Select a problem to jump to its file and location. F8 and Shift+F8 navigate diagnostics within the editor. Diagnostics update as you type and disappear when the problem is fixed.

## Scope and project configuration

The desktop app indexes workspace sources, JSON configs, and installed dependency declarations. TypeScript reads tsconfig.json or jsconfig.json (including JSON comments, extends, baseUrl, paths, include/exclude, and module resolution settings). Nested projects keep their own configurations; solution configs can refer to app-specific configs. Package metadata supplies types and exports. Imports and Go to Definition work for indexed files even before you open them. Unsaved open buffers take precedence over disk snapshots. Symbol rename requires all affected files to be open so every changed buffer can be reviewed and saved.

Projects refresh after saving and when the app regains focus. The status bar shows INDEXING, PROJECT, PARTIAL, or INDEX ERROR. Indexing is limited to 20,000 files, 64 MiB, 2 MiB per file, and 15 seconds. Git/build caches are excluded, and symlinks outside the workspace are not read. Open a smaller workspace if a limit is reached. Dependencies must already be installed. Browser samples still use bundled defaults and open files.

This uses the bundled TypeScript version, not a project's custom compiler or executable plugins. Framework-generated types must exist on disk; Svelte/Vue plugins and ESLint are not loaded. These checks do not replace your project's compiler, tests, or lint command.

Rust, Python, Go, Java, and other languages retain syntax highlighting. Their semantic intelligence requires external language servers, which are not yet integrated. The status bar distinguishes project TypeScript support, BUILT-IN services, and SYNTAX ONLY. VS Code extension and language-server parity is not claimed.

## Formatting

Format Document uses a configured external formatter when present. Otherwise it tries the active language's built-in formatter. External processes require a trusted workspace; bundled formatters run locally without executing workspace tools.
