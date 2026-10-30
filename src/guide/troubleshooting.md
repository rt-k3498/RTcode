{"id": "troubleshooting", "title": "Troubleshooting & recovery", "summary": "Failures should preserve your work and explain the next step.", "order": 14, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Missing tool

tool_missing means the executable was not found. Install Git, OpenSSH, or your formatter separately and restart the app so PATH is refreshed. Workspace search is built in and does not need ripgrep. The IDE does not download executables.

## Save failures

conflict means disk content changed since the load or last save. Cancel to preserve both versions until you decide. permission_denied and internal errors leave the buffer dirty. Copy the buffer before closing if the filesystem cannot be repaired.

## PTY and formatter failures

workspace_untrusted requires reviewing trust. tool_failed means the child exited unsuccessfully. timeout stops an overlong formatter. unsupported marks a file or operation outside the supported subset.

## Data location

The native database is under the Tauri application-data directory for dev.r-console.ide: Application Support on macOS, APPDATA on Windows, and XDG data on Linux. Back it up before manual recovery. Automated corruption recovery and diagnostics bundles remain pending.
