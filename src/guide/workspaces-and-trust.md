{"id": "workspaces-and-trust", "title": "Workspaces & trust", "summary": "Open a folder safely. Decide when its code may execute.", "order": 1, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Open a workspace

The desktop app automatically opens the directory it was launched from. Click the workspace control in the top bar to see open folders. The Add workspace button stays at the bottom of the dropdown and opens the native folder picker. Adding a folder keeps existing files, unsaved edits, and terminals open. Selecting an already open folder does not duplicate it. Use the × beside a folder in the dropdown to remove it from the workbench. Its files and terminals close; the folder stays on disk. Modified files offer Save all & remove, Don’t save & remove, or Cancel. Running terminals require confirmation. Other workspaces stay open.

All workspace roots appear as separate, collapsible folders in Files. Each workspace has its own highlight color around its root name and along its open editor tabs. The dropdown selects the workspace used for Search, Git, new files, and the trust control. File tabs keep their own workspace association.

Selecting a worktree in Git asks whether to Add workspace or Replace workspace. Replace affects only the selected workspace, closes its files and terminals, and prompts to save or discard unsaved edits. Cancel leaves it unchanged. A failed save or unavailable destination preserves the current workspace.

On macOS, a fresh launch with open -a 'RTcode' uses the shell's current folder. If RTcode is already running, that command only activates it; use the workspace picker or open -n -a 'RTcode' for a new instance from the current folder.

## Restricted mode

File browsing, editing, search, and read-only Git are available. Terminals, SSH, formatting, and Git mutations are blocked. The bottom-left trust control reviews the exact canonical folder before granting access.

## Revoke trust

Settings → Security can revoke trust and end that workspace’s active terminal sessions. Exact-root trust is stored locally. Parent trust and automatic workspace restoration are not implemented in this build.
