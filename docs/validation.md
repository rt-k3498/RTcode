# Development validation — 2026-10-29

Environment: Apple Silicon macOS, Node 24.18.0, pnpm 11.18.0, Rust 1.99.1. Rust was installed in isolated temporary directories; shell profiles were not modified.

Passed:

- TypeScript strict typecheck.
- Prettier source-format check.
- Rustfmt and Clippy with warnings denied.
- 15 Rust tests: canonical path/parent/symlink escapes, filename rules, revision hashes, UTF-8 BOM/CRLF save, conflict refusal, Restricted Mode execution rejection, Git porcelain/conflicts/detached/unborn parsing, actual Git staging of an option-like path, direct argument safety, timeout/output bounds, and a real PTY output/resize/exit-code test.
- 7 frontend tests: sample-tree laziness, literal/UTF-16 search, language fallback, sample documents, required offline Guide articles/anchors, and semantic contrast.
- 2 Playwright E2E flows in installed Chrome: Guide routing and search, command palette, workspace search navigation, terminal placement, responsive width, dirty edits preserved through Settings, canceled close, and save. No page errors in the main workflow.
- Production Vite build, offline Guide compilation (17 articles), optimized native compile, and macOS app bundle (15.80 MiB).

Visually inspected screenshots: workbench, Guide, and 820×560 narrow layout. Source font is bundled JetBrains Mono. The input-boundary token was strengthened after contrast calculation showed the original starting token below 3:1.

The 3.67 MB uncompressed lazy Monaco chunk still emits Vite's size warning. No published startup/RSS/typing performance claim is made.

Not verified: packaged interactive WKWebView behavior, native picker end-to-end flow, SSH authentication against a real server, Windows/Linux native behavior, IME, accessibility assistive technologies, signing/notarization, updates, crash cleanup of arbitrary descendants, or the complete specification acceptance matrix. CI workflows are provided but have not run remotely. Browser screenshots do not replace packaged cross-webview testing.

## Code review and corrective pass — 2026-10-30

Reviewed the SolidJS workbench, Monaco and terminal adapters, IPC bridge and samples, Rust workspace/file/search/Git/process/PTY modules, settings storage, build scripts, capabilities, and CI. This is a review of the implemented application, not certification of the full PRODUCT.md specification. All project files were already untracked at the start; no commit or baseline reset was performed.

Corrections:

- Save completion now records the saved snapshot separately from the current buffer, preserving newer edits and their dirty marker. Concurrent saves are suppressed; pending saves prevent tab closure and workspace changes. Conflict overwrite callbacks retain the original document identity.
- Editor initialization now establishes reactive option dependencies. Active models are not redundantly reattached on every edit. Read-only diff models refresh their content, and saved comparisons normalize line endings.
- Asynchronous file/tree/Git/diff responses check workspace identity; duplicate file opens cannot create duplicate tabs. Formatting rejects read-only documents and overlapping requests. Native close-listener cleanup is registered synchronously.
- Terminal cleanup releases exited backend sessions, handles sessions closed during creation, prevents overlapping creation, and clears resize timers. PTY reader/writer allocation happens before process launch; a disconnected output channel kills the child.
- Git uses literal pathspecs so filenames containing glob characters cannot stage unrelated files. Repository-selection environment variables are removed. Branch switching verifies a local branch and disables automatic remote guessing.
- Rename/trash resolve the parent while preserving the final directory entry, so symlinks themselves are mutated. Rename updates backend path/document handles and rejects existing dangling symlink destinations. Saves enforce the final encoded byte limit including BOM and CRLF expansion.
- Search registrations use scope-based cleanup, duplicate IDs are rejected, timeouts return an error, and closed stdout cannot bypass the process deadline. Browser sample searches stop at the result cap and reject inherited object properties as document handles.
- CI now checks frontend formatting alongside typechecking, tests, and builds.

Regression coverage added: literal Git pathspecs; final-component symlink mutation scope; encoded save size; sample handle validation and result cap; delayed save with intervening edits and undo; editor preferences after asynchronous initialization.

Remaining release gates, in priority order:

1. Packaged native interaction tests on macOS, Windows, and Linux, including trust revocation during process startup, workspace switching during native dialogs, terminal failure/restart, and SSH authentication. Rust unit tests and browser tests cover different boundaries.
2. File watcher/reload behavior, crash recovery of dirty buffers, and atomic filesystem operations robust against concurrent external path replacement. Canonicalization plus revision checks does not eliminate filesystem TOCTOU races.
3. Sustained PTY output/backpressure and descendant-process cleanup on all platforms; backend document handles also need a bounded close lifecycle for very long sessions.
4. Persisted settings schema validation/migrations, malformed/non-UTF-8 search fixtures, exact browser/native glob parity, assistive-technology and IME testing.
5. Monaco bundle/performance budgets, release signing, notarization, dependency/license audit, and remote CI execution.

Use small changes with a reproducible failing case, a focused regression test, passing checks, and explicit acceptance criteria for each remaining gate. No claim of 100% correctness or production readiness is made.

Validation of this pass: 18 Rust tests, 9 Vitest tests, 4 Node launcher tests, and 4 Chrome Playwright flows passed. TypeScript checking, production Vite build, Prettier, Rustfmt, and Clippy with warnings denied passed. Cargo dependency access and the browser test server required sandbox escalation. The existing Monaco chunk-size warning remains. A new packaged desktop bundle was not built or interactively tested in this pass.

## Terminal startup correction

Local zsh startup probes outside the sandbox measured approximately 2.2 seconds for interactive non-login startup; interactive login startup exceeded a 15-second timeout. A clean shell took approximately 13 ms. These are shell-command probes, not packaged-app first-prompt benchmarks, and timings vary with user startup scripts.

Unix terminal tabs now request interactive non-login shells, preserving interactive aliases/plugins without rerunning login profiles. PTY allocation and spawn run on a blocking worker, outside the UI thread and the terminal registry lock. Registration rechecks workspace trust and capacity. Workspace replacement and trust revocation invalidate admission before cleaning up existing sessions. The bundled Terminal guide explains environment inheritance and login-only configuration behavior.

A macOS PTY regression fixture verifies that .zshrc loads, .zprofile does not run, and the shell is interactive. Interactive startup files can still dominate prompt latency; user shell configuration is not modified.

Startup-fix validation: both native terminal tests passed, including the new interactive/non-login PTY regression; the offline Guide regenerated successfully. The subsequent Clippy invocation was waiting for the shared target-directory build lock used by another development process at handoff. No packaged first-prompt benchmark was performed.

## RTcode interface and language-service update

Implemented the requested collapsed-by-default Git groups; working-file navigation on filenames; separate eye buttons for staged, unstaged, and untracked patches; independent right/bottom terminal panes with hide-all and persistent mounted sessions; RTcode product/window branding with the original R_> logo; and persistent customizable accent/background/surface/text colors defaulting to orange and teal. Legacy single-position layout preferences migrate when read. Appearance changes propagate to the workbench, Monaco, and existing xterm instances.

Bundled TypeScript/JavaScript language workers now supply completion, semantic/syntax diagnostics, hover information, signature help, inlay hints, definitions/references, rename and code actions. JSON/CSS workers provide validation, and HTML provides completion/hover. A Problems panel lists open-file diagnostics and navigates to their source positions. Built-in formatting is used when no external formatter is configured. JSON schema network fetching remains disabled.

Language scope is explicitly limited to open-file models and built-in compiler defaults. This does not implement the entire VS Code feature set: external Rust/Python servers, project tsconfig/dependency type discovery, ESLint, and extension compatibility remain outstanding. The bundled TypeScript worker adds about 7 MB before compression and is started when its language service is needed.

Validation: 20 Rust tests, 12 Vitest tests, 4 Node launcher tests, and 10 Chrome Playwright flows passed. Typechecking, production build, Prettier, and Rustfmt passed. Browser coverage includes collapsing Git sections with keyboard controls, editable-file versus diff navigation, simultaneous terminal panes at 1440 and 820 pixels, hide/show without reconstruction, restored logo, custom colors/reset/persistence payloads, actual TypeScript worker diagnostics/completion/hover/definition resolution, and JSON errors. Screenshots were inspected for combined terminal layouts, Git groups, custom Appearance colors, and the Problems panel. Rust validation used an isolated target directory and matching toolchain to avoid collisions with the user's running development launcher. Native packaged interaction and full VS Code parity are not claimed.

## Multi-workspace review and simplification — 2026-10-30

Reviewed the current workbench, editor/project worker, settings, terminal and IPC code; Rust file, workspace, search, Git, process and project boundaries; and build/CI configuration. All source files were already untracked. No commit or reset was performed.

Fixed findings:

- Definition navigation now opens unopened source files using the active editor's workspace, even when Search/Git follows another selected root. A regression reproduced the previous wrong-workspace failure.
- Refresh Files reloads expanded descendants. Folder reads share one update function, reject responses for closed workspaces, and reject superseded responses. Git refreshes likewise apply only the newest request.
- Persisted preference/layout parsing moved into a small independent module. It validates types and finite numbers, bounds font/pane sizes, normalizes colors, and retains legacy terminal-placement migration.
- Settings now uses a native modal dialog with contained keyboard focus, named switches, and focus restoration. Workbench shortcuts cannot close or alter background tabs through an open dialog. Settings notifications and confirmation failures render inside the active modal. Save and Format are disabled for read-only diffs and blocked operations.
- Rust replacement builds the output in one forward pass and counts UTF-16 columns incrementally. This avoids repeated prefix scans and string shifts, and fixes incorrect rejection when intermediate reverse edits exceed the file limit despite a valid final result. Regression coverage includes the 10 MiB boundary and selective replacement across a dense Unicode line.

Four browser regressions and the Rust size-limit regression were observed failing before their fixes. The project-resolution test now waits for asynchronous TypeScript registration before querying its worker, removing a startup race in the test itself.

Final checks passed: 25 Vitest tests, 4 Node launcher tests, 26 Chrome Playwright tests, 42 Rust tests, strict TypeScript checking, Prettier, production Vite build, Rustfmt, and Clippy with warnings denied. Visually inspected the Guide, multi-workspace layout, narrow workbench, and Settings at 820 × 560. The existing Monaco chunk-size warning remains.

Packaged WKWebView interaction, Windows/Linux native behavior, real SSH authentication, and the previously listed release gates remain outside this validation. This review does not certify the application as bug-free.
