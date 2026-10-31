# Implementation status — 0.1.0

The user's v1.2 specification is the target contract. This repository implements an initial local IDE, not all acceptance criteria or a production release.

| Area | Implemented | Remaining |
|---|---|---|
| Identity | RTcode name, original R_> logo, configurable base colors with orange/teal defaults, locally bundled typography, Monaco/xterm adapters, Settings, Guide, dialogs, notices, high contrast, reduced motion | Cross-webview visual baselines and independent recognition review |
| Workspace | Native picker, opaque IDs, exact-root restricted/trusted decisions | Parent trust, recent workspace restoration, persisted workspace-scoped layouts |
| Files | Lazy tree, root creation, backend rename/trash, UTF-8 BOM and EOL, content-hash conflict checks, same-directory atomic replacement | Explorer operation menus, Compare/Save As, watcher integration, race-resistant directory handles, large-file/read-only encoding modes, full non-UTF-8 path support |
| Editor | Single group, pinned tabs, model/view state, dirty markers, keyboard editing, undo, close prompts | Preview tabs, recent-tab restore, independent language selector, richer diffs |
| Search | Built-in Rust content search and ranked file-name search (best 200 matches with a total) with a mode toggle, run only on Enter or the Search button, cancellation, regex/case/word controls, comma-separated globs, UTF-16 ranges, revision-checked single/all replacement | Paging, virtualized rows, multiline/PCRE patterns, cross-platform performance tests |
| Git | Worktree listing and workspace switching with save/discard/cancel protection, filename-to-editor navigation, patch views, porcelain-v2 status, refs, history, stage/unstage, local branch switch | Worktree creation/removal, tracking-branch UI, mutation serialization, event-driven refresh, broader cross-platform repository fixtures |
| PTY/SSH | Actual local shell/SSH, capped sessions/scrollback, independent persistent right/bottom panes, simultaneous placement, hide-all, title isolation, clipboard sequence suppression | Reconnect UI, graceful shutdown escalation, job objects/descendant cleanup on Windows, authentication state negotiation, favorites and SSH external document handle |
| Formatting | Built-in language formatting plus trusted executable/argv, stdin/stdout, timeout/output bounds, version guard, undo edit | Format-on-save, LSP/range providers, complete platform process supervision |
| Language intelligence | Bundled TS/JS services with tsconfig/jsconfig, inherited aliases, nested configs, lazily loaded project and dependency files (no workspace snapshot) and unopened-file navigation; JSON/CSS validation; HTML completion; Problems panel | External LSP broker/server lifecycle (including Rust/Python), framework/ESLint plugins, continuous file watching, cross-platform conformance tests |
| Extensions | Honest limitations UI; no extension execution | VSIX staging and inspection, archive limits, reports, allowlisted declarative install and rollback |
| Metadata | Backend-only SQLite preferences and exact-root trust | Full schema, versioned transactional migrations, backup/corruption recovery, recent documents |
| Guide | 17 offline source articles, sanitized static build output, search, navigation, history, contextual entry routes | Full implementation-ready reference corpus, stable restart-persisted deep links/scroll, all action/error/setting coverage, external-link broker |
| Release | Local macOS build, frontend/browser tests, native unit tests | Signed installers/updater, notarization, three-platform packaged E2E, IME/accessibility audits, SBOM, measured budgets |

## Validation boundary

Checks executed on the available Apple Silicon development environment are recorded in the task handoff. Browser tests use Chrome and cannot validate WKWebView, WebView2, or WebKitGTK. Native compilation does not prove packaged interaction behavior. Windows and Linux builds remain unverified until CI and hardware tests execute.

The browser preview cannot operate the local filesystem or create PTYs. It deliberately uses an in-memory sample workspace and displays SAMPLE in the toolbar. Git data and SSH connection success are never fabricated.

## Known engineering limitations

File canonicalization defends against obvious scope escapes and is repeated for saves, but does not close every TOCTOU race. A hostile process sharing the OS account remains outside the intended security boundary. Rename/trash now preserve the final symlink entry; their UI and cross-platform integration tests remain pending. Content search runs without time, file-size, or result-count caps and file-name search lists the best 200 matches; invalid UTF-8 paths need broader fixtures. PTY output uses bounded batches but channel backpressure needs sustained-output tests. Dirty buffers remain in memory only.

Do not present this build as a completed, signed, or security-audited MVP. Conditional web extensions and remote workspaces have not been started.
