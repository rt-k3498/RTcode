# RTcode

A native Tauri v2 / SolidJS / TypeScript / Rust operator console. The workbench uses Monaco, xterm.js, a single editor group, an amber/teal visual system, and a 17-article offline Guide behind the `R_>` logo.

**Status: early implementation, not the complete specified MVP.** See [implementation status](docs/implementation-status.md) for the shipped boundary and release gates.

## Run

Requires Node.js 22+, pnpm 11, Rust stable, and the platform's Tauri development prerequisites. Git and OpenSSH must be installed separately. Workspace search is built in and does not require ripgrep. No Node runtime is embedded in the desktop application.

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

The desktop app opens its launch directory as the workspace automatically. On macOS, a fresh `open -a 'RTcode'` launch uses the shell's inherited `PWD`, even when LaunchServices resets the process working directory. If RTcode is already running, macOS only activates that instance; quit it first, use the workspace picker, or start a new instance:

```sh
cd /path/to/project
open -n -a 'RTcode'
```

You can also run the built executable from a project folder:

```sh
cd /path/to/project
/path/to/RTcode/src-tauri/target/release/r-console
```

Development launches through `pnpm tauri dev` preserve the invoking directory too. New folders open in Restricted Mode until you trust them; previously saved exact-folder trust is respected. You can still switch folders with the workspace picker.

A browser preview is also available:

```sh
pnpm dev
```

Open `http://127.0.0.1:1420`. It uses a visibly labeled sample workspace. Edits stay in memory, search runs over the samples, and no native shell or filesystem operation is simulated.

`pnpm tauri` detects a working Rust installation on PATH or in your Cargo home. It also reuses the isolated development-session installation under `/private/tmp/r-console-cargo` and `/private/tmp/r-console-rustup` when a regular installation is absent. No manual exports or shell-profile changes are needed for this checkout.

Those temporary directories may be removed by the operating system. For ongoing development, install Rust stable using rustup from `https://rustup.rs` and reopen your terminal. The launcher prefers that regular installation and reports actionable instructions if no working toolchain is available. Explicit `CARGO_HOME` and `RUSTUP_HOME` selections are preserved.

## Working features

- Native folder picker, opaque workspace/path/document handles, restricted mode, exact-root trust.
- Lazy first-level tree that lists every entry including Git-ignored paths such as node_modules with no entry-count cap, root file/folder creation, syntax-aware Monaco tabs, undo, dirty markers, close confirmation, BOM/EOL preservation, hash conflict detection, atomic same-directory saves.
- Built-in file-name search with ranked results and a one-click toggle to the content filter, plus workspace content search with cancellation, regex/case/word controls, comma-separated glob filters, no search time, file-size, or result-count caps, UTF-16 navigation, and individual/all-result replacement with revision checks.
- Git porcelain-v2 status, worktree listing and workspace switching with save/discard/cancel handling, separate local/remote refs, ten commits, patch views, trusted staging/unstaging and local branch switching.
- Rust-owned PTYs rendered by xterm, up to eight sessions, right/bottom/hidden placement without reconstruction, OpenSSH launch, simple config-alias discovery.
- Bundled TS/JS completion, diagnostics and navigation using tsconfig/jsconfig, inherited path aliases, nested projects, unopened sources and installed dependency types; JSON/CSS validation, HTML suggestions, and a Problems panel. Project files load lazily as the language service asks for them, with no workspace snapshot, and refresh on save/window focus. External language servers and framework plugins remain pending.
- Explicit stdin/stdout formatter profiles with caps, timeouts, trust, document-version checks, and one undo edit.
- Backend SQLite preferences/trust, local fonts and workers, restricted CSP/capabilities, consistent Settings and Guide, command palette, keyboard shortcuts, high contrast and reduced motion.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Browser tests start a dev server automatically and reuse an existing local one. On macOS they can use installed Chrome; elsewhere install Playwright Chromium with `pnpm exec playwright install chromium`. Screenshots are written under `test-results/`.

```sh
pnpm tauri build --bundles app  # macOS local app bundle
```

The local macOS bundle is `src-tauri/target/release/bundle/macos/RTcode.app`. This is not a notarized distribution or signed-update release.

## Source map

- `src/app`: workbench and Settings/Guide routes
- `src/editor`: lazy Monaco adapter and syntax modules
- `src/terminal`: persistent xterm views
- `src/ipc`: typed narrow native bridge and explicit browser samples
- `src/guide`: offline source articles, generated static data and manifest
- `src/theme`: shared console styling
- `src-tauri/src`: workspace authority, files, Git, search, process supervision, PTYs, formatting, metadata
- `src-tauri/capabilities/main.json`: the single webview's permissions

## Documentation sources

Architecture decisions follow the supplied specification and the official [Tauri channel documentation](https://v2.tauri.app/develop/calling-frontend/) and [Vite integration guidance](https://v2.tauri.app/start/frontend/vite/). The Guide describes this build's behavior, including limitations, rather than advertising roadmap capabilities.

JetBrains Mono is bundled locally under the SIL Open Font License through `@fontsource/jetbrains-mono`. All other dependency licenses remain in their pinned package/crate sources. A full release SBOM and license bundle are still required.
