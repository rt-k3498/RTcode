{"id": "languages-and-lsp", "title": "Languages & IntelliSense", "summary": "Completion, hints, navigation, and real diagnostics from bundled language services.", "order": 7, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Built-in language services

TypeScript and JavaScript use Monaco's bundled TypeScript service for completion, hover types, signature help, inlay hints, definitions, references, symbol rename, quick fixes, and syntax/type diagnostics. JSON includes syntax validation and completion. CSS, SCSS, and Less include validation and completion. HTML includes completion and hover help; this is not a complete HTML linter.

These services run locally in dedicated workers. They do not execute project scripts or require workspace trust. Remote JSON schema fetching is disabled.

## Using hints and diagnostics

Ctrl+Space requests completion. Hover a symbol to inspect its type. Parameter hints appear while entering function calls. F12 goes to a definition and F2 renames supported symbols. The editor context menu offers the language actions available at the current cursor. Lightbulbs offer available quick fixes.

Errors are red; warnings, diagnostic hints, and inline type/parameter hints are yellow. These colors apply to the editor and Problems independently of the accent palette. Select the status bar's diagnostic counts, or press Cmd/Ctrl+Shift+M, to open Problems. Select a problem to jump to its file and location. F8 and Shift+F8 navigate diagnostics within the editor. Diagnostics update as you type and disappear when the problem is fixed.

## Scope and project configuration

The desktop app loads workspace sources, JSON configs, and installed dependency declarations on demand. TypeScript reads tsconfig.json or jsconfig.json (including JSON comments, extends, baseUrl, paths, include/exclude, and module resolution settings). Nested projects keep their own configurations; solution configs can refer to app-specific configs. Package metadata supplies types and exports. Imports and Go to Definition work for files you have not opened, because the language service asks for them when it needs them. Unsaved open buffers take precedence over files on disk. Symbol rename requires all affected files to be open so every changed buffer can be reviewed and saved.

There is no project snapshot. When you open a file, the language service looks for the configs above it and for the files it imports, and only those are read from disk, a few at a time, until nothing is missing. Files you never import are never read, so large workspaces and node_modules cost nothing until something uses them. Editing an import loads the new target shortly after you stop typing. Loaded files refresh after saving and when the app regains focus. The status bar shows INDEXING while files load, then PROJECT, or PARTIAL if loading stopped early, or INDEX ERROR. Symlinks outside the workspace are not read. Dependencies must already be installed. Packages installed later are found when the app regains focus; Reload project configuration in the command palette also drops dependency files that were already loaded, for example after upgrading one. Whole-project features such as references or diagnostics for files you have not opened only cover files that have been loaded. Browser samples still use bundled defaults and open files.

This uses the bundled TypeScript version, not a project's custom compiler or executable plugins. Framework-generated types must exist on disk; Svelte/Vue plugins and ESLint are not loaded. These checks do not replace your project's compiler, tests, or lint command.

Rust, Python, Go, Java, and other languages retain syntax highlighting. Their semantic intelligence requires external language servers, which are not yet integrated. The status bar distinguishes project TypeScript support, BUILT-IN services, and SYNTAX ONLY. VS Code extension and language-server parity is not claimed.

## Formatting

Format Document uses a configured external formatter when present. Otherwise it tries the active language's built-in formatter. External processes require a trusted workspace; bundled formatters run locally without executing workspace tools.
